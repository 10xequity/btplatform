/**
 * Boomtown Platform — Looking-For-Group (LFG) & Community Play
 * File: worker/src/lfg.js · Version: v1.0 · Date: 2026-08-01 · Ships in: v0.45.0
 *
 * Owner spec (2026-08-01, verbatim answers on the requirements doc §4):
 *   - Any member may post a team need (not captains/staff only).
 *   - Casual play is free-form date/place — community use, no facility/court link.
 *   - Bail window: withdrawing within 12h of game time counts as a "bail"
 *     (BAIL_WINDOW_HOURS below — one edit to make it 24).
 *   - Captain (listing owner) reports no-shows. First no-show → yellow ⚠ caution by the
 *     member's name for 14 days. Second → 30-day ban from LFG + red ⚠ shown whenever the
 *     person appears in groups. Auto-unban after 30 days; the strikes are consumed by the ban.
 *   - Contact between parties is in-app messaging only (messages.js /api/messages/start).
 *   - The pool is 18+ initially — fail closed on unknown birthdate (family.js isMinor).
 *   - "Need a team →" creates the team shell IMMEDIATELY (the listing itself, forming=1);
 *     joiners surface an "on N team(s)" chip so double-rostering is visible at commit time.
 *   - Reliability is a SIGNAL, never a skill rating: showed / bailed counts only.
 *
 * Member routes (session required):
 *   GET    /api/lfg/listings?kind=team_need|player_avail|casual   → open listings, org-scoped
 *   POST   /api/lfg/listings                                      → create (18+ gate, ban gate, flood guard)
 *   POST   /api/lfg/listings/:id/join                             → commit to a listing
 *   POST   /api/lfg/listings/:id/withdraw                         → leave; inside the window = bail
 *   POST   /api/lfg/listings/:id/close                            → owner (or staff) closes/fills
 *   POST   /api/lfg/listings/:id/report-no-show {contact_id}      → owner only, after game time
 *   GET    /api/lfg/me                                            → my listings, commitments, reliability
 *   GET    /api/lfg/opportunities                                 → newest open listings for the home card
 * Staff routes:
 *   GET    /api/admin/lfg/strikes                                 → active strikes + bans with names
 *   POST   /api/admin/lfg/unban {contact_id}                      → lift a ban early
 *
 * Rules baked in (standards §4/§8):
 *   - Every read and write scoped to ctx.orgId; no route accepts an org_id for scoping from
 *     the client (report-no-show takes a contact_id, but only one committed to the owner's
 *     own listing inside the same org).
 *   - Member-visible names are "First L." (family.js displayName); no emails in member bodies.
 *   - Flood guard: OPEN_LISTINGS_MAX open listings per member per org (messages.js precedent).
 *   - Fail closed: unknown DOB = minor = blocked (family.js isMinor contract).
 *   - sendEmail is NOT needed here — notification is in-app only, per the owner.
 * Pure (unit-tested): isBail · cautionFor · banActiveUntil · normalizeListing · reliabilityFrom
 */

import { isMinor, displayName, contactWithDob } from "./family.js"; // one age gate, one name rule
import { SKILLS, GENDERS, GAME_TYPES, notPastSql } from "./subs.js"; // shared volleyball vocab (0026) + one staleness rule

let json, contactForSession, audit, isStaff, requireStaff;
export function wireLfg(helpers) {
  ({ json, contactForSession, audit, isStaff, requireStaff } = helpers);
}

/** Withdrawing this close to game time counts as a bail. Owner: 12 (potentially 24). */
export const BAIL_WINDOW_HOURS = 12;
/** Yellow ⚠ caution shown for this many days after a reported no-show. */
export const STRIKE_DAYS = 14;
/** Second no-show inside the caution logic = ban for this many days, then auto-unban. */
export const BAN_DAYS = 30;
/** Flood guard: open listings one member may hold per org. */
export const OPEN_LISTINGS_MAX = 5;
export const KINDS = ["team_need", "player_avail", "casual"];

/* ============================ pure helpers (unit-tested) ============================ */

/** Milliseconds for a DB/ISO timestamp; NaN-safe. */
function ms(v) {
  if (!v) return NaN;
  return Date.parse(String(v).trim().replace(" ", "T") + (/[Zz]|[+-]\d{2}:?\d{2}$/.test(String(v)) ? "" : "Z"));
}

/**
 * A withdrawal is a bail when game time is known, still ahead of us, and closer than the
 * window. Unknown or past game time is NOT a bail — you cannot bail on a game already played
 * (that is a no-show, reported by the owner), and free-form listings without a time carry no
 * window to violate.
 */
export function isBail(playAt, now = new Date(), windowHours = BAIL_WINDOW_HOURS) {
  const t = ms(playAt);
  if (Number.isNaN(t)) return false;
  const n = now.getTime();
  if (t <= n) return false;
  return (t - n) <= windowHours * 3600 * 1000;
}

/**
 * Caution state from a member's UNCLEARED no-show strikes.
 *   none   — no live strike inside STRIKE_DAYS
 *   yellow — one live strike inside STRIKE_DAYS
 *   red    — banned (computed by the caller from lfg_bans) OR 2+ live strikes
 * Strike rows carry created_at + cleared_at; cleared strikes were consumed by a ban.
 */
export function cautionFor(strikeRows, now = new Date()) {
  const live = (strikeRows || []).filter(s =>
    s && s.kind === "no_show" && !s.cleared_at && !s.deleted_at &&
    (now.getTime() - ms(s.created_at)) <= STRIKE_DAYS * 86400 * 1000
  );
  if (live.length >= 2) return "red";
  if (live.length === 1) return "yellow";
  return "none";
}

/** The active ban's end, or null. A ban whose ends_at has passed is auto-lifted by time. */
export function banActiveUntil(banRows, now = new Date()) {
  for (const b of banRows || []) {
    if (!b || b.deleted_at || b.lifted_at) continue;
    const end = ms(b.ends_at);
    if (!Number.isNaN(end) && end > now.getTime()) return b.ends_at;
  }
  return null;
}

/** Showed / bailed counts from a member's history. Never a rating. */
export function reliabilityFrom({ showedCount = 0, bailCount = 0, noShowCount = 0 } = {}) {
  return { showed: Number(showedCount) || 0, bailed: Number(bailCount) || 0, no_shows: Number(noShowCount) || 0 };
}

/** Validate + normalize a new-listing body. Returns {ok, listing} or {ok:false, error}. */
export function normalizeListing(b) {
  const kind = String(b && b.kind || "").trim();
  if (!KINDS.includes(kind)) return { ok: false, error: "Pick what you're posting: a team that needs players, that you're available to play, or a casual game." };
  const pick = (v, allowed) => allowed.includes(String(v || "any").toLowerCase()) ? String(v || "any").toLowerCase() : "any";
  const clip = (v, n) => (v == null ? null : String(v).slice(0, n).trim() || null);
  const spots = b.spots == null || b.spots === "" ? null : Math.max(1, Math.min(50, Number(b.spots) | 0)) || null;
  let playAt = clip(b.play_at, 40);
  if (playAt && Number.isNaN(ms(playAt))) playAt = null; // free text dates stay in location_note
  const teamName = kind === "team_need" ? clip(b.team_name, 80) : null;
  if (kind === "team_need" && !teamName) return { ok: false, error: "Give the team a name, even a working one. It becomes the team when it fills." };
  return {
    ok: true,
    listing: {
      kind,
      forming: kind === "team_need" ? 1 : 0, // the shell exists the moment the listing does
      team_name: teamName,
      skill_level: pick(b.skill_level, SKILLS),
      gender_requirement: pick(b.gender_requirement, GENDERS),
      game_type: pick(b.game_type, GAME_TYPES),
      positions: clip(b.positions, 120),
      spots,
      play_at: playAt,
      location_note: clip(b.location_note, 160),
      note: clip(b.note, 500),
    },
  };
}

/* ============================ gates ============================ */

/** 18+ fail-closed gate + active-ban gate. Returns a Response to send, or null to proceed. */
async function memberGate(env, ctx, contact) {
  const withDob = await contactWithDob(env, ctx.orgId, contact.id);
  if (isMinor(withDob && withDob.date_of_birth)) {
    return json({ error: "Community play is 18+ for now. Add your date of birth on your profile if it's missing; accounts without one can't join." }, 403);
  }
  const bans = await env.DB.prepare(
    "SELECT ends_at, lifted_at, deleted_at FROM lfg_bans WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
  ).bind(ctx.orgId, contact.id).all();
  const until = banActiveUntil(bans.results || []);
  if (until) {
    return json({ error: `You're paused from community play until ${String(until).slice(0, 10)} after two reported no-shows. It lifts automatically.` }, 403);
  }
  return null;
}

/* ============================ shared queries ============================ */

/** Live team memberships for the "on N team(s)" chip. */
async function teamsCount(env, orgId, contactId) {
  const r = await env.DB.prepare(
    "SELECT COUNT(DISTINCT team_id) AS n FROM team_members WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
  ).bind(orgId, contactId).first();
  return (r && r.n) || 0;
}

/** Caution + ban chips for a set of contact ids → Map(contact_id → {caution, banned_until}). */
async function chipsFor(env, orgId, contactIds, now = new Date()) {
  const out = new Map();
  if (!contactIds.length) return out;
  const marks = contactIds.map((_, i) => `?${i + 2}`).join(",");
  const strikes = await env.DB.prepare(
    `SELECT contact_id, kind, created_at, cleared_at, deleted_at FROM lfg_strikes
      WHERE org_id=?1 AND contact_id IN (${marks}) AND deleted_at IS NULL`
  ).bind(orgId, ...contactIds).all();
  const bans = await env.DB.prepare(
    `SELECT contact_id, ends_at, lifted_at, deleted_at FROM lfg_bans
      WHERE org_id=?1 AND contact_id IN (${marks}) AND deleted_at IS NULL`
  ).bind(orgId, ...contactIds).all();
  for (const id of contactIds) {
    const s = (strikes.results || []).filter(r => r.contact_id === id);
    const b = (bans.results || []).filter(r => r.contact_id === id);
    const bannedUntil = banActiveUntil(b, now);
    out.set(id, { caution: bannedUntil ? "red" : cautionFor(s, now), banned_until: bannedUntil });
  }
  return out;
}

/* ============================ routes ============================ */

export async function lfgRoutes(request, env, url, ctx) {
  const p = url.pathname;
  if (!p.startsWith("/api/lfg") && !p.startsWith("/api/admin/lfg")) return null;
  const m = request.method;

  if (p.startsWith("/api/admin/lfg")) {
    const gate = await requireStaff(env, ctx); if (gate) return gate;
    if (p === "/api/admin/lfg/strikes" && m === "GET") return adminStrikes(env, ctx);
    if (p === "/api/admin/lfg/unban" && m === "POST") return adminUnban(request, env, ctx);
    return json({ error: "Not found." }, 404);
  }

  const contact = await contactForSession(env, ctx);
  if (!contact) return json({ error: "Sign in to see community play." }, 401);

  if (p === "/api/lfg/listings" && m === "GET") return listListings(env, ctx, url, contact);
  if (p === "/api/lfg/listings" && m === "POST") return createListing(request, env, ctx, contact);
  if (p === "/api/lfg/me" && m === "GET") return myLfg(env, ctx, contact);
  if (p === "/api/lfg/opportunities" && m === "GET") return opportunities(env, ctx);

  const act = p.match(/^\/api\/lfg\/listings\/(\d+)\/(join|withdraw|close|report-no-show)$/);
  if (act && m === "POST") {
    const id = Number(act[1]);
    if (act[2] === "join") return joinListing(env, ctx, contact, id);
    if (act[2] === "withdraw") return withdrawListing(env, ctx, contact, id);
    if (act[2] === "close") return closeListing(request, env, ctx, contact, id);
    if (act[2] === "report-no-show") return reportNoShow(request, env, ctx, contact, id);
  }
  return json({ error: "Not found." }, 404);
}

/* ---------- read side ---------- */

async function listListings(env, ctx, url, contact) {
  const kind = url.searchParams.get("kind");
  // ?2 is now always the viewer, so the optional kind filter moves to ?3.
  const where = KINDS.includes(kind) ? "AND l.kind = ?3" : "";
  // A game whose day has passed leaves the board — but NEVER leaves its own poster's view.
  // `web/assets/lfg.js:112` renders "Report a no-show" only for a listing that is `mine && past`,
  // from THIS payload, and it is the only trigger in the client. Filtering own rows out here would
  // make `report-no-show` unreachable and kill the no-show accountability feature silently. The
  // poster also needs to see the post to close it, because OPEN_LISTINGS_MAX counts it.
  const stmt = env.DB.prepare(
    `SELECT l.*, c.full_name AS poster_name,
            (SELECT COUNT(*) FROM lfg_members mm
              WHERE mm.org_id = l.org_id AND mm.listing_id = l.id
                AND mm.status='committed' AND mm.deleted_at IS NULL) AS committed
       FROM lfg_listings l
       JOIN contacts c ON c.id = l.created_by_contact_id AND c.deleted_at IS NULL
      WHERE l.org_id = ?1 AND l.status = 'open' AND l.deleted_at IS NULL
        AND (l.created_by_contact_id = ?2 OR ${notPastSql("l.play_at")}) ${where}
      ORDER BY l.created_at DESC LIMIT 100`
  );
  const rows = (KINDS.includes(kind)
    ? await stmt.bind(ctx.orgId, contact.id, kind).all()
    : await stmt.bind(ctx.orgId, contact.id).all()).results || [];

  // roster + chips for the listings shown
  const ids = rows.map(r => r.id);
  let members = [];
  if (ids.length) {
    const marks = ids.map((_, i) => `?${i + 2}`).join(",");
    members = (await env.DB.prepare(
      `SELECT mm.listing_id, mm.contact_id, mm.joined_at, c.full_name
         FROM lfg_members mm JOIN contacts c ON c.id = mm.contact_id AND c.deleted_at IS NULL
        WHERE mm.org_id = ?1 AND mm.listing_id IN (${marks})
          AND mm.status='committed' AND mm.deleted_at IS NULL`
    ).bind(ctx.orgId, ...ids).all()).results || [];
  }
  const chipIds = [...new Set([...rows.map(r => r.created_by_contact_id), ...members.map(mb => mb.contact_id)])];
  const chips = await chipsFor(env, ctx.orgId, chipIds);

  const shape = r => ({
    id: r.id, kind: r.kind, forming: r.forming, team_name: r.team_name,
    skill_level: r.skill_level, gender_requirement: r.gender_requirement, game_type: r.game_type,
    positions: r.positions, spots: r.spots, play_at: r.play_at, location_note: r.location_note,
    note: r.note, status: r.status, created_at: r.created_at, committed: r.committed,
    poster: displayName(r.poster_name),
    poster_contact_id: r.created_by_contact_id, // for in-app "Message" — messages.js hides emails
    poster_caution: (chips.get(r.created_by_contact_id) || {}).caution || "none",
    mine: r.created_by_contact_id === contact.id,
    joined: members.some(mb => mb.listing_id === r.id && mb.contact_id === contact.id),
    roster: members.filter(mb => mb.listing_id === r.id).map(mb => ({
      contact_id: mb.contact_id,
      name: displayName(mb.full_name),
      caution: (chips.get(mb.contact_id) || {}).caution || "none",
    })),
  });
  return json({ listings: rows.map(shape) });
}

/** The home-card feed: newest few open listings per category, cheap and anonymous-safe. */
async function opportunities(env, ctx) {
  const rows = (await env.DB.prepare(
    `SELECT l.id, l.kind, l.team_name, l.skill_level, l.game_type, l.play_at, l.location_note,
            l.created_at, c.full_name AS poster_name
       FROM lfg_listings l JOIN contacts c ON c.id = l.created_by_contact_id AND c.deleted_at IS NULL
      WHERE l.org_id = ?1 AND l.status='open' AND l.deleted_at IS NULL
        AND ${notPastSql("l.play_at")}
      ORDER BY l.created_at DESC LIMIT 24`
  ).bind(ctx.orgId).all()).results || [];
  return json({
    opportunities: rows.map(r => ({
      id: r.id, kind: r.kind, team_name: r.team_name, skill_level: r.skill_level,
      game_type: r.game_type, play_at: r.play_at, location_note: r.location_note,
      created_at: r.created_at, poster: displayName(r.poster_name),
    })),
  });
}

async function myLfg(env, ctx, contact) {
  const mine = (await env.DB.prepare(
    `SELECT * FROM lfg_listings WHERE org_id=?1 AND created_by_contact_id=?2 AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 50`
  ).bind(ctx.orgId, contact.id).all()).results || [];
  const commits = (await env.DB.prepare(
    `SELECT mm.listing_id, mm.status, mm.is_bail, mm.joined_at, mm.withdrawn_at,
            l.kind, l.team_name, l.play_at, l.status AS listing_status
       FROM lfg_members mm JOIN lfg_listings l ON l.id = mm.listing_id AND l.deleted_at IS NULL
      WHERE mm.org_id=?1 AND mm.contact_id=?2 AND mm.deleted_at IS NULL
      ORDER BY mm.joined_at DESC LIMIT 100`
  ).bind(ctx.orgId, contact.id).all()).results || [];
  const strikes = (await env.DB.prepare(
    "SELECT kind, created_at, cleared_at, deleted_at FROM lfg_strikes WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
  ).bind(ctx.orgId, contact.id).all()).results || [];
  const bans = (await env.DB.prepare(
    "SELECT ends_at, lifted_at, deleted_at FROM lfg_bans WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
  ).bind(ctx.orgId, contact.id).all()).results || [];

  const now = new Date();
  const showed = commits.filter(cm =>
    cm.status === "committed" && cm.play_at && ms(cm.play_at) < now.getTime() &&
    !strikes.some(s => s.kind === "no_show" && !s.deleted_at)
  ).length;
  const bailed = commits.filter(cm => cm.is_bail).length;
  const bannedUntil = banActiveUntil(bans, now);
  return json({
    listings: mine, commitments: commits,
    reliability: reliabilityFrom({ showedCount: showed, bailCount: bailed, noShowCount: strikes.filter(s => s.kind === "no_show").length }),
    caution: bannedUntil ? "red" : cautionFor(strikes, now),
    banned_until: bannedUntil,
    teams_count: await teamsCount(env, ctx.orgId, contact.id),
  });
}

/* ---------- write side ---------- */

async function createListing(request, env, ctx, contact) {
  const gate = await memberGate(env, ctx, contact); if (gate) return gate;
  const open = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM lfg_listings WHERE org_id=?1 AND created_by_contact_id=?2 AND status='open' AND deleted_at IS NULL"
  ).bind(ctx.orgId, contact.id).first();
  if ((open && open.n) >= OPEN_LISTINGS_MAX) {
    return json({ error: `You have ${OPEN_LISTINGS_MAX} open posts already. Close one before posting another.` }, 429);
  }
  const b = await request.json().catch(() => null);
  const norm = normalizeListing(b || {});
  if (!norm.ok) return json({ error: norm.error }, 400);
  const L = norm.listing;
  const ins = await env.DB.prepare(
    `INSERT INTO lfg_listings (org_id, kind, forming, created_by_contact_id, team_name, skill_level,
       gender_requirement, game_type, positions, spots, play_at, location_note, note)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`
  ).bind(ctx.orgId, L.kind, L.forming, contact.id, L.team_name, L.skill_level, L.gender_requirement,
         L.game_type, L.positions, L.spots, L.play_at, L.location_note, L.note).run();
  const id = ins.meta.last_row_id;
  // The poster is the first committed member of their own listing (the shell has its captain).
  await env.DB.prepare(
    "INSERT INTO lfg_members (org_id, listing_id, contact_id) VALUES (?1,?2,?3)"
  ).bind(ctx.orgId, id, contact.id).run();
  await audit(env, ctx, "lfg.post", "lfg_listing", id, L.kind);
  return json({ ok: true, id, teams_count: await teamsCount(env, ctx.orgId, contact.id) });
}

async function joinListing(env, ctx, contact, id) {
  const gate = await memberGate(env, ctx, contact); if (gate) return gate;
  const l = await env.DB.prepare(
    "SELECT id, status, spots FROM lfg_listings WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(id, ctx.orgId).first();
  if (!l) return json({ error: "That post is gone." }, 404);
  if (l.status !== "open") return json({ error: "That post already filled or closed." }, 409);
  if (l.spots != null) {
    const c = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM lfg_members WHERE org_id=?1 AND listing_id=?2 AND status='committed' AND deleted_at IS NULL"
    ).bind(ctx.orgId, id).first();
    if ((c && c.n) >= l.spots + 1) return json({ error: "All spots are taken. The poster can add more if plans change." }, 409); // +1 = the poster's own row
  }
  try {
    await env.DB.prepare(
      "INSERT INTO lfg_members (org_id, listing_id, contact_id) VALUES (?1,?2,?3)"
    ).bind(ctx.orgId, id, contact.id).run();
  } catch (e) {
    // ux_lfg_members_live: one live commitment per (listing, contact)
    return json({ error: "You're already committed to this one." }, 409);
  }
  await audit(env, ctx, "lfg.join", "lfg_listing", id, null);
  const n = await teamsCount(env, ctx.orgId, contact.id);
  return json({ ok: true, teams_count: n, teams_note: n > 0 ? `Heads up: you're already on ${n} team${n === 1 ? "" : "s"}.` : null });
}

async function withdrawListing(env, ctx, contact, id) {
  const row = await env.DB.prepare(
    `SELECT mm.id AS member_id, l.play_at
       FROM lfg_members mm JOIN lfg_listings l ON l.id = mm.listing_id AND l.deleted_at IS NULL
      WHERE mm.org_id=?1 AND mm.listing_id=?2 AND mm.contact_id=?3
        AND mm.status='committed' AND mm.deleted_at IS NULL`
  ).bind(ctx.orgId, id, contact.id).first();
  if (!row) return json({ error: "You're not committed to this post." }, 404);
  const bail = isBail(row.play_at) ? 1 : 0;
  await env.DB.prepare(
    "UPDATE lfg_members SET status='withdrawn', is_bail=?1, withdrawn_at=datetime('now'), updated_at=datetime('now') WHERE id=?2 AND org_id=?3"
  ).bind(bail, row.member_id, ctx.orgId).run();
  if (bail) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO lfg_strikes (org_id, contact_id, listing_id, kind) VALUES (?1,?2,?3,'bail')"
    ).bind(ctx.orgId, contact.id, id).run();
  }
  await audit(env, ctx, "lfg.withdraw", "lfg_listing", id, bail ? "bail" : null);
  return json({ ok: true, bail: !!bail, note: bail ? `Withdrawing inside ${BAIL_WINDOW_HOURS} hours of game time counts on your reliability record.` : null });
}

async function closeListing(request, env, ctx, contact, id) {
  const l = await env.DB.prepare(
    "SELECT created_by_contact_id FROM lfg_listings WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(id, ctx.orgId).first();
  if (!l) return json({ error: "That post is gone." }, 404);
  if (l.created_by_contact_id !== contact.id && !(await isStaff(env, ctx))) return json({ error: "Only the poster can close this." }, 403);
  const b = await request.json().catch(() => ({}));
  const status = b && b.filled ? "filled" : "closed";
  await env.DB.prepare(
    "UPDATE lfg_listings SET status=?1, updated_at=datetime('now') WHERE id=?2 AND org_id=?3"
  ).bind(status, id, ctx.orgId).run();
  await audit(env, ctx, "lfg.close", "lfg_listing", id, status);
  return json({ ok: true, status });
}

async function reportNoShow(request, env, ctx, contact, id) {
  const l = await env.DB.prepare(
    "SELECT created_by_contact_id, play_at FROM lfg_listings WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(id, ctx.orgId).first();
  if (!l) return json({ error: "That post is gone." }, 404);
  if (l.created_by_contact_id !== contact.id) return json({ error: "Only the poster can report a no-show for their game." }, 403);
  if (l.play_at && ms(l.play_at) > Date.now()) return json({ error: "The game hasn't happened yet." }, 409);
  const b = await request.json().catch(() => null);
  const target = Number(b && b.contact_id) || 0;
  if (!target || target === contact.id) return json({ error: "Pick who didn't show." }, 400);
  const committed = await env.DB.prepare(
    "SELECT id FROM lfg_members WHERE org_id=?1 AND listing_id=?2 AND contact_id=?3 AND status='committed' AND deleted_at IS NULL"
  ).bind(ctx.orgId, id, target).first();
  if (!committed) return json({ error: "They weren't committed to this game." }, 409);

  await env.DB.prepare(
    "INSERT OR IGNORE INTO lfg_strikes (org_id, contact_id, listing_id, kind, reported_by_contact_id) VALUES (?1,?2,?3,'no_show',?4)"
  ).bind(ctx.orgId, target, id, contact.id).run();

  // Escalation: two live no-shows → 30-day ban, strikes consumed. Auto-unban is time-based.
  const strikes = (await env.DB.prepare(
    "SELECT id, kind, created_at, cleared_at, deleted_at FROM lfg_strikes WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
  ).bind(ctx.orgId, target).all()).results || [];
  let banned = false;
  if (cautionFor(strikes) === "red") {
    const existing = (await env.DB.prepare(
      "SELECT ends_at, lifted_at, deleted_at FROM lfg_bans WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, target).all()).results || [];
    if (!banActiveUntil(existing)) {
      await env.DB.prepare(
        `INSERT INTO lfg_bans (org_id, contact_id, reason, ends_at)
         VALUES (?1,?2,'Two reported no-shows', datetime('now', '+${BAN_DAYS} days'))`
      ).bind(ctx.orgId, target).run();
      await env.DB.prepare(
        "UPDATE lfg_strikes SET cleared_at=datetime('now') WHERE org_id=?1 AND contact_id=?2 AND kind='no_show' AND cleared_at IS NULL AND deleted_at IS NULL"
      ).bind(ctx.orgId, target).run();
      banned = true;
    }
  }
  // In-app notice to the member — fair warning, same table messages.js uses.
  await env.DB.prepare(
    `INSERT INTO notifications (org_id, kind, target, contact_id, title, body, payload_json, sent_at)
     VALUES (?1,'lfg_strike','member',?2,?3,?4,'{}',datetime('now'))`
  ).bind(ctx.orgId, target,
    banned ? "Community play paused" : "No-show reported",
    banned
      ? `Two no-shows were reported, so community play is paused for ${BAN_DAYS} days. It lifts automatically.`
      : `A game organizer reported a no-show. A caution shows by your name for ${STRIKE_DAYS} days. A second one pauses community play for ${BAN_DAYS} days.`
  ).run();

  await audit(env, ctx, "lfg.no_show", "contact", target, banned ? "banned" : "strike");
  return json({ ok: true, banned });
}

/* ---------- staff ---------- */

async function adminStrikes(env, ctx) {
  const strikes = (await env.DB.prepare(
    `SELECT s.id, s.contact_id, c.full_name, c.email, s.kind, s.created_at, s.cleared_at, s.listing_id
       FROM lfg_strikes s JOIN contacts c ON c.id = s.contact_id AND c.deleted_at IS NULL
      WHERE s.org_id=?1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 200`
  ).bind(ctx.orgId).all()).results || [];
  const bans = (await env.DB.prepare(
    `SELECT b.id, b.contact_id, c.full_name, c.email, b.reason, b.starts_at, b.ends_at, b.lifted_at
       FROM lfg_bans b JOIN contacts c ON c.id = b.contact_id AND c.deleted_at IS NULL
      WHERE b.org_id=?1 AND b.deleted_at IS NULL ORDER BY b.starts_at DESC LIMIT 100`
  ).bind(ctx.orgId).all()).results || [];
  return json({ strikes, bans });
}

async function adminUnban(request, env, ctx) {
  const b = await request.json().catch(() => null);
  const target = Number(b && b.contact_id) || 0;
  if (!target) return json({ error: "contact_id required." }, 400);
  await env.DB.prepare(
    "UPDATE lfg_bans SET lifted_at=datetime('now') WHERE org_id=?1 AND contact_id=?2 AND lifted_at IS NULL AND deleted_at IS NULL"
  ).bind(ctx.orgId, target).run();
  await audit(env, ctx, "lfg.unban", "contact", target, null);
  return json({ ok: true });
}
