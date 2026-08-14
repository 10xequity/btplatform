/**
 * Boomtown Platform — Tournament API routes
 * Version: v0.4.0 · Date: 2026-07-24 (v0.4.0/M12B: schedule generation auto-claims courts on the
 *   facility calendar via facility.js — default courts, moved to open courts on conflict,
 *   drag-editable like any booking. v0.3.0: export refreshStandings for captain self-scoring)
 * Mounted by worker/src/index.js. All writes require admin/staff role in the event's org.
 * Reads: published events are public; drafts require staff.
 */
import {
  FORMAT_TEMPLATES, feasibility, generatePairings, scheduleMatches, computeStandings,
} from "./scheduler.js";
import { autoClaimForEvent, releaseAutoClaims } from "./facility.js";
import { advanceBracketFor } from "./brackets.js"; // v0.67.0 — brackets.js imports only scheduler.js, no cycle
import { personName, CAPTAIN_JOIN, CAPTAIN_COLS } from "./names.js"; // T2-3 — one captain shape, one place
import { notifyEventCancelled, externalPriceConflict, cleanMinSignups } from "./events_admin.js"; // B16 — one recipient rule for all three cancel writers; PM-1 — one price/external rule for both write paths; SG-2 — one threshold spelling for both write paths; events_admin imports nothing, no cycle
import { activeRegistrationCount } from "./waitlists.js"; // SG-2 — the ONE count the capacity gate, sheet and roster already read; waitlists imports only push.js, no cycle

export async function tournamentRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;

  if (p === "/api/formats" && m === "GET") return json({ formats: FORMAT_TEMPLATES });

  if (p === "/api/events" && m === "GET") return listEvents(request, env, ctx);
  if (p === "/api/events" && m === "POST") return createEvent(request, env, ctx);

  let match;
  if ((match = p.match(/^\/api\/events\/(\d+)$/))) {
    if (m === "GET") return getEvent(env, ctx, +match[1]);
    if (m === "PATCH") return patchEvent(request, env, ctx, +match[1]);
  }
  if ((match = p.match(/^\/api\/events\/(\d+)\/teams$/))) {
    if (m === "GET") return listTeams(env, +match[1]);
    if (m === "POST") return addTeams(request, env, ctx, +match[1]);
  }
  if ((match = p.match(/^\/api\/events\/(\d+)\/schedule$/))) {
    if (m === "GET") return getSchedule(env, ctx, +match[1]);
    if (m === "POST") return generateSchedule(request, env, ctx, +match[1]);
  }
  if ((match = p.match(/^\/api\/events\/(\d+)\/standings$/)) && m === "GET") {
    return getStandings(env, +match[1]);
  }
  // v0.121.0 (T2-5): the legacy POST /api/events/:id/bracket route is REMOVED, not orphaned.
  // It wrote only first-round games and skipped byes; the modern engine at
  // /api/admin/events/:id/brackets (brackets.js) owns generation, and bracket_rewire.test.mjs
  // asserts this door answers 404 so the two paths can never drift back apart.
  if ((match = p.match(/^\/api\/matches\/(\d+)$/)) && m === "PATCH") {
    return patchMatch(request, env, ctx, +match[1]);
  }
  if ((match = p.match(/^\/api\/matches\/(\d+)\/score$/)) && m === "POST") {
    return scoreMatch(request, env, ctx, +match[1]);
  }
  return null; // not a tournament route
}

/* ---------- handlers ---------- */

async function listEvents(request, env, ctx) {
  const orgId = ctx.orgId;
  const staff = await isStaff(env, ctx, orgId);
  const rows = (await env.DB.prepare(
    staff
      ? "SELECT id, org_id, type, name, starts_at, location, court_count, format_template, status FROM events WHERE org_id=?1 AND deleted_at IS NULL ORDER BY starts_at DESC, id DESC"
      : "SELECT id, org_id, type, name, starts_at, location, status FROM events WHERE org_id=?1 AND status IN ('published','in_progress','completed') AND deleted_at IS NULL ORDER BY starts_at DESC, id DESC"
  ).bind(orgId).all()).results;
  return json({ events: rows });
}

async function createEvent(request, env, ctx) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const b = await request.json();
  const tpl = b.format_template && FORMAT_TEMPLATES[b.format_template];
  const cfg = {
    pointsTo: b.pointsTo ?? tpl?.pointsTo ?? 21,
    cap: b.cap ?? tpl?.cap ?? 23,
    gamesPerTeam: b.gamesPerTeam ?? tpl?.gamesPerTeam ?? 8,
    budgetMinutes: b.budgetMinutes ?? 420,
  };
  const r = await env.DB.prepare(
    `INSERT INTO events (org_id, type, name, starts_at, location, court_count, format_template, config_json, status, cash_option_enabled)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'draft',?9)`
  ).bind(ctx.orgId, b.type || "tournament", b.name, b.starts_at || null, b.location || null,
         b.court_count ?? tpl?.courts ?? 4, b.format_template || null, JSON.stringify(cfg),
         b.cash_option_enabled ? 1 : 0).run();
  await audit(env, ctx, "event.create", "events", r.meta.last_row_id, { name: b.name });
  return json({ id: r.meta.last_row_id });
}

async function getEvent(env, ctx, id) {
  const ev = await env.DB.prepare("SELECT * FROM events WHERE id=?1 AND deleted_at IS NULL").bind(id).first();
  if (!ev) return json({ error: "Event not found." }, 404);
  if (ev.status === "draft" && !(await isStaff(env, ctx, ev.org_id))) return json({ error: "Not available." }, 403);
  // SG-2 (§-1o): the count IS Cathy's decision, so the event carries it — activeRegistrationCount
  // is the capacity gate's own number (registration ROWS, the same units as `capacity`, so
  // "9 of 12" and "full at 12" can never contradict). Unconditional: the sheet already shows
  // this number publicly for drop-ins, and a field only staff receive is a field a caller can
  // forget to be staff for.
  ev.active_signups = await activeRegistrationCount(env, id);
  return json({ event: ev });
}

async function patchEvent(request, env, ctx, id) {
  // v0.147.0 (PM-1): `price_cents` and `external_url` are both read now, because rule 3 is a
  // comparison between them and it must be evaluated on the RESULT of this write.
  const ev = await env.DB.prepare(
    "SELECT org_id, status, price_cents, external_url FROM events WHERE id=?1 AND deleted_at IS NULL"
  ).bind(id).first();
  if (!ev) return json({ error: "Event not found." }, 404);
  const deny = await requireStaff(env, ctx, ev.org_id);
  if (deny) return deny;
  const b = await request.json();
  // `external_url` and `external_label` join this list. `price_cents` deliberately does NOT:
  // this route has never written it, the admin page has been sending it and being ignored, and
  // quietly fixing that here would be a second change riding on this one (§-1c D-34). So the
  // conflict this route can create is "a URL onto an already-priced event", and that is what the
  // check below compares — the incoming URL against the price ALREADY STORED.
  // SG-2: `min_signups` joins the list the day its field ships, or the event page would tell the
  // operator "Saved." while dropping it — D-34's exact defect worn by the new field. Normalised
  // through the ONE spelling (events_admin.js) that the bag path also uses.
  const allowed = ["name", "starts_at", "location", "court_count", "status", "cash_option_enabled",
    "config_json", "external_url", "external_label", "min_signups"];
  if ("min_signups" in b) b.min_signups = cleanMinSignups(b.min_signups);
  const conflict = externalPriceConflict({
    external_url: "external_url" in b ? b.external_url : ev.external_url,
    price_cents: ev.price_cents,
  });
  if (conflict) return json({ error: conflict }, 400);
  const sets = [], vals = [];
  for (const k of allowed) if (k in b) { sets.push(`${k}=?${sets.length + 1}`); vals.push(b[k]); }
  if (!sets.length) return json({ error: "Nothing to update." }, 400);
  vals.push(id);
  await env.DB.prepare(`UPDATE events SET ${sets.join(",")}, updated_at=datetime('now') WHERE id=?${vals.length}`).bind(...vals).run();
  await audit(env, ctx, "event.update", "events", id, b);
  // B16 (v0.129.0): cancelling is the one status change the registered people must HEAR about,
  // and only on the TRANSITION — re-saving an already-cancelled event is not news. The event's
  // own org scopes the recipients (this route gates on ev.org_id, which may not be ctx.orgId).
  if (b.status === "cancelled" && ev.status !== "cancelled") {
    const notice = await notifyEventCancelled(env, ctx, [id], ev.org_id);
    return json({ ok: true, cancelled_notice: notice });
  }
  return json({ ok: true });
}

/* T2-3 (v0.122.0): the captain rides along so a director can tell two similar team names apart.
   THIS ROUTE CARRIES NO STAFF GATE, so the captain's own visibility decides how their name reads
   — `personName` returns it in full only when they chose 'public', and "First L." otherwise.
   Reading the member's setting rather than the caller's convenience is the whole rule;
   scheduler_ux.test.mjs flips the setting and asserts the output follows it. */
async function listTeams(env, eventId) {
  const rows = (await env.DB.prepare(
    `SELECT t.id, t.name, t.level, t.gender_division, t.seed, ${CAPTAIN_COLS}
       FROM teams t ${CAPTAIN_JOIN}
      WHERE t.event_id=?1 AND t.deleted_at IS NULL ORDER BY t.id`
  ).bind(eventId).all()).results;
  return json({ teams: rows.map(withCaptain) });
}

/** One shape for every ungated team feed, so two screens cannot disagree about a captain. */
function withCaptain(t) {
  return {
    id: t.id, name: t.name, level: t.level, gender_division: t.gender_division, seed: t.seed,
    captain: personName(t.captain_name, { visibility: t.captain_visibility }),
  };
}

async function addTeams(request, env, ctx, eventId) {
  const ev = await env.DB.prepare("SELECT org_id FROM events WHERE id=?1 AND deleted_at IS NULL").bind(eventId).first();
  if (!ev) return json({ error: "Event not found." }, 404);
  const deny = await requireStaff(env, ctx, ev.org_id);
  if (deny) return deny;
  const { names = [] } = await request.json();
  for (const name of names.map((s) => String(s).trim()).filter(Boolean)) {
    await env.DB.prepare("INSERT INTO teams (org_id, event_id, name) VALUES (?1,?2,?3)").bind(ev.org_id, eventId, name).run();
  }
  await audit(env, ctx, "teams.add", "teams", eventId, { count: names.length });
  return listTeams(env, eventId);
}

async function generateSchedule(request, env, ctx, eventId) {
  const ev = await env.DB.prepare("SELECT * FROM events WHERE id=?1 AND deleted_at IS NULL").bind(eventId).first();
  if (!ev) return json({ error: "Event not found." }, 404);
  const deny = await requireStaff(env, ctx, ev.org_id);
  if (deny) return deny;
  const b = await request.json().catch(() => ({}));
  let cfg = {}; try { cfg = JSON.parse(ev.config_json || "{}") || {}; } catch { cfg = {}; }
  const teams = (await env.DB.prepare("SELECT id FROM teams WHERE event_id=?1 AND deleted_at IS NULL ORDER BY id").bind(eventId).all()).results;
  const n = teams.length;
  const params = {
    teams: n,
    courts: b.courts ?? ev.court_count,
    gamesPerTeam: b.gamesPerTeam ?? cfg.gamesPerTeam,
    pointsTo: b.pointsTo ?? cfg.pointsTo,
    budgetMinutes: b.budgetMinutes ?? cfg.budgetMinutes ?? 420,
  };
  const feas = feasibility(params);
  if (!feas.ok && !b.force) return json({ feasibility: feas, generated: false });

  // Protect scored games: refuse to wipe unless explicitly confirmed.
  const scored = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM matches WHERE event_id=?1 AND score_a IS NOT NULL AND deleted_at IS NULL"
  ).bind(eventId).first();
  if (scored.n > 0 && !b.confirm_wipe_scores) {
    return json({ error: `${scored.n} scored game(s) exist. Re-send with confirm_wipe_scores:true to regenerate anyway.`, feasibility: feas }, 409);
  }

  const { pairings } = generatePairings(n, params.gamesPerTeam);
  const sched = scheduleMatches(pairings, params.courts, n);
  if (!sched) return json({ error: "Could not pack a valid schedule.", feasibility: feas }, 422);

  await env.DB.prepare("UPDATE matches SET deleted_at=datetime('now') WHERE event_id=?1 AND deleted_at IS NULL").bind(eventId).run();
  for (const r of sched.rounds) {
    for (const mt of r.matches) {
      await env.DB.prepare(
        `INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id, ref_team_id, points_to, cap)
         VALUES (?1,?2,'pool',?3,?4,?5,?6,?7,?8,?9)`
      ).bind(ev.org_id, eventId, mt.round, mt.court,
             teams[mt.teamA].id, teams[mt.teamB].id, mt.ref != null ? teams[mt.ref].id : null,
             params.pointsTo, b.cap ?? cfg.cap ?? params.pointsTo + 2).run();
    }
  }
  await env.DB.prepare("UPDATE events SET court_count=?1, updated_at=datetime('now') WHERE id=?2").bind(params.courts, eventId).run();
  await audit(env, ctx, "schedule.generate", "events", eventId, { ...params, rounds: sched.rounds.length });

  // M12 Phase B: claim courts on the facility calendar. Never blocks schedule generation.
  let facility_claim = null;
  try {
    facility_claim = await autoClaimForEvent(env, ctx, { ...ev, court_count: params.courts },
      { courts: params.courts, budgetMinutes: params.budgetMinutes });
  } catch (e) { console.error("autoclaim failed", e); facility_claim = { skipped: "Court claim failed — book manually on the Facility calendar." }; }

  return json({ generated: true, feasibility: feas, rounds: sched.rounds.length, byeSpread: sched.spread, facility_claim });
}

async function getSchedule(env, ctx, eventId) {
  const ev = await env.DB.prepare("SELECT * FROM events WHERE id=?1 AND deleted_at IS NULL").bind(eventId).first();
  if (!ev) return json({ error: "Event not found." }, 404);
  const rows = (await env.DB.prepare(
    `SELECT m.id, m.stage, m.round, m.court, m.team_a_id, m.team_b_id, m.ref_team_id, m.points_to, m.cap, m.score_a, m.score_b
     FROM matches m WHERE m.event_id=?1 AND m.deleted_at IS NULL ORDER BY m.stage, m.round, m.court`
  ).bind(eventId).all()).results;
  const teams = (await env.DB.prepare(
    `SELECT t.id, t.name, t.level, t.gender_division, t.seed, ${CAPTAIN_COLS}
       FROM teams t ${CAPTAIN_JOIN} WHERE t.event_id=?1 AND t.deleted_at IS NULL`
  ).bind(eventId).all()).results;
  return json({ event: ev, matches: rows, teams: teams.map(withCaptain), warnings: rescheduleWarnings(rows) });
}

function rescheduleWarnings(rows) {
  const warnings = [];
  const meet = new Map(), perRound = new Map();
  for (const m of rows.filter((r) => r.stage === "pool")) {
    const key = [Math.min(m.team_a_id, m.team_b_id), Math.max(m.team_a_id, m.team_b_id)].join("-");
    meet.set(key, (meet.get(key) || 0) + 1);
    const rk = m.round;
    if (!perRound.has(rk)) perRound.set(rk, new Map());
    for (const t of [m.team_a_id, m.team_b_id]) {
      const c = perRound.get(rk).get(t) || 0;
      if (c >= 1) warnings.push({ type: "double-booked", round: rk, team_id: t });
      perRound.get(rk).set(t, c + 1);
    }
  }
  for (const [pair, count] of meet) if (count > 1) warnings.push({ type: "rematch", pair, count });
  return warnings;
}

async function patchMatch(request, env, ctx, matchId) {
  const mt = await env.DB.prepare("SELECT * FROM matches WHERE id=?1 AND deleted_at IS NULL").bind(matchId).first();
  if (!mt) return json({ error: "Match not found." }, 404);
  const deny = await requireStaff(env, ctx, mt.org_id);
  if (deny) return deny;
  const b = await request.json();
  const allowed = ["round", "court", "score_a", "score_b", "ref_team_id"];
  const sets = [], vals = [];
  for (const k of allowed) if (k in b) { sets.push(`${k}=?${sets.length + 1}`); vals.push(b[k]); }
  if (!sets.length) return json({ error: "Nothing to update." }, 400);
  vals.push(matchId);
  await env.DB.prepare(`UPDATE matches SET ${sets.join(",")}, updated_at=datetime('now') WHERE id=?${vals.length}`).bind(...vals).run();
  await audit(env, ctx, "match.update", "matches", matchId, b);
  // Live re-validation — warnings only, operator override always wins (spec §3.1)
  const rows = (await env.DB.prepare(
    "SELECT id, stage, round, court, team_a_id, team_b_id FROM matches WHERE event_id=?1 AND deleted_at IS NULL"
  ).bind(mt.event_id).all()).results;
  return json({ ok: true, warnings: rescheduleWarnings(rows) });
}

/**
 * Score, or CORRECT, one game.
 *
 * Two ways in, ONE definition of what a score is:
 *   { winner: 'a'|'b', diff: N }   — the 2-tap contract, right for a captain at the net on a phone.
 *   { score_a: N, score_b: N }     — exact, which is the only way to fix a mistake.
 *
 * Owner 2026-08-03: "Add admin edit scores if incorrect." The 2-tap form CANNOT express a correction —
 * a game entered as 21–15 that was really 23–21 is unreachable through "winner and margin", because
 * that form assumes the winner scored exactly `points_to`. A separate edit route would have been a
 * second definition of a score, and the day the two disagree is the day the standings and the bracket
 * disagree about who won a game.
 *
 * Editing needs no special permission and no separate audit action: `requireStaff` already gates this,
 * and the audit row carries the old and new values, so a correction is legible AS a correction.
 */
async function scoreMatch(request, env, ctx, matchId) {
  const mt = await env.DB.prepare("SELECT * FROM matches WHERE id=?1 AND deleted_at IS NULL").bind(matchId).first();
  if (!mt) return json({ error: "Match not found." }, 404);
  const deny = await requireStaff(env, ctx, mt.org_id);
  if (deny) return deny;
  const body = await request.json().catch(() => ({}));
  const { winner, diff } = body;

  let sa, sb;
  const exact = body.score_a !== undefined || body.score_b !== undefined;
  if (exact) {
    sa = Number(body.score_a); sb = Number(body.score_b);
    const bad = (n) => !Number.isInteger(n) || n < 0 || n > 200;
    if (bad(sa) || bad(sb)) {
      return json({ error: "Send both scores as whole numbers, 0 to 200." }, 400);
    }
    if (sa === sb) {
      // A tie is not a result anywhere else here — `winnerOf` returns null and a bracket refuses to
      // advance on one — so accepting it would write a row every other module reads as UNPLAYED, and
      // the game would sit there looking un-entered while the sheet says it was played.
      return json({ error: "A tied score can't be recorded — volleyball is won by two. Check the sheet." }, 400);
    }
  } else {
    if (!["a", "b"].includes(winner) || !(diff >= 1)) {
      return json({ error: "Send winner ('a' or 'b') and diff ≥ 1, or send score_a and score_b." }, 400);
    }
    const w = mt.points_to, l = Math.max(0, mt.points_to - diff);
    [sa, sb] = winner === "a" ? [w, l] : [l, w];
  }

  const wasScored = mt.score_a !== null && mt.score_b !== null;
  await env.DB.prepare("UPDATE matches SET score_a=?1, score_b=?2, updated_at=datetime('now') WHERE id=?3").bind(sa, sb, matchId).run();
  await audit(env, ctx, "match.score", "matches", matchId,
    wasScored
      ? { corrected: true, from: `${mt.score_a}-${mt.score_b}`, to: `${sa}-${sb}`, exact }
      : { winner, diff, score: `${sa}-${sb}`, exact });
  await refreshStandings(env, mt.event_id, mt.org_id);
  // Owner 2026-08-03: "brackets should auto advance." A director typing in a quarter-final result
  // has their hands full; a second button to move the winner is a step that gets skipped, and a
  // skipped step means the next court call is wrong. No-op on pool-only events.
  //
  // A CORRECTION SELF-HEALS THE TREE, which is the reason advancement is recomputed rather than
  // accumulated: fix a quarter-final typed in backwards and the semi it feeds is right on this pass.
  // Sides a director is HOLDING are left alone, and reported (v0.78.0).
  const adv = await advanceBracketFor(env, mt.org_id, mt.event_id);
  return json({
    ok: true, score_a: sa, score_b: sb,
    corrected: wasScored,
    bracket_advanced: adv.advanced,
    bracket_held: adv.held || 0,
    note: wasScored
      ? `Corrected from ${mt.score_a}–${mt.score_b} to ${sa}–${sb}.` +
        (adv.advanced ? ` ${adv.advanced} later game${adv.advanced === 1 ? "" : "s"} updated to match.` : "") +
        (adv.held ? ` ${adv.held} slot${adv.held === 1 ? " is" : "s are"} being held by hand and did not change.` : "")
      : undefined,
  });
}

/* v0.104.0 — roadmap §-1c D-8, closed under §-1e priority 3. Both reads below were scoped by
   event_id ALONE while the write beneath them pinned org_id, so this function trusted its caller
   to have already proved the event belongs to the org. Every route reaching it does — which is why
   this was a latent defect and not a live leak — but "org-scoped by default" is not a property you
   inherit from your callers, and the orgId needed to fix it was already a parameter. Free. */
export async function refreshStandings(env, eventId, orgId) {
  const rows = (await env.DB.prepare(
    "SELECT team_a_id AS teamA, team_b_id AS teamB, score_a AS scoreA, score_b AS scoreB FROM matches WHERE event_id=?1 AND org_id=?2 AND stage='pool' AND deleted_at IS NULL"
  ).bind(eventId, orgId).all()).results;
  const teams = (await env.DB.prepare("SELECT id FROM teams WHERE event_id=?1 AND org_id=?2 AND deleted_at IS NULL").bind(eventId, orgId).all()).results.map((t) => t.id);
  const table = computeStandings(rows, teams);
  for (const r of table) {
    await env.DB.prepare(
      `INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, points_against, rank)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
       ON CONFLICT(event_id, team_id) DO UPDATE SET wins=?4, losses=?5, point_diff=?6, points_for=?7, points_against=?8, rank=?9, updated_at=datetime('now')`
    ).bind(orgId, eventId, r.team, r.wins, r.losses, r.diff, r.pf, r.pa, r.rank).run();
  }
}

async function getStandings(env, eventId) {
  const rows = (await env.DB.prepare(
    `SELECT s.rank, s.team_id, t.name, s.wins, s.losses, s.point_diff, s.points_for, s.points_against
     FROM standings s JOIN teams t ON t.id = s.team_id
     WHERE s.event_id=?1 AND s.deleted_at IS NULL ORDER BY s.rank`
  ).bind(eventId).all()).results;
  return json({ standings: rows });
}

/* ---------- shared helpers (injected by index.js via ctx) ---------- */
let json, audit, isStaff, requireStaff;
export function wire(helpers) { ({ json, audit, isStaff, requireStaff } = helpers); }
