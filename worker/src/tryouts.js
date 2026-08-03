/**
 * Boomtown Platform — Tryouts: player card, coach evaluation, team building
 * File: worker/src/tryouts.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.60.0
 * Requires migration 0036.
 *
 * Owner spec (2026-08-03, verbatim intent):
 *   "when they try out or register for try out, this should populate a coaches or evaluator page
 *    which is simply name - position - age - prev club (asked during registration) - then a blank
 *    area for coaches to write or type - then a quick check to offer not offer mark."
 *   Team builder blocks show "players name, position, height, rating (coach assigned), age group
 *    willing to play … a small note section from notes recorded", squads show what they still
 *    need, and the director gets an aggregate they can pivot.
 *
 * THREE SURFACES, ONE EVENT:
 *   1. the CARD    — what the player told us at registration (tryout_profiles)
 *   2. the EVAL    — what one coach wrote after watching (tryout_evaluations, one per coach)
 *   3. the BOARD   — squads being assembled (tryout_squads + members)
 *
 * WHY A COACH ONLY EVER SEES AND EDITS THEIR OWN EVALUATION. Showing coach B what coach A wrote
 * before B has written anything turns three independent judgements into one anchored one, which is
 * the whole value gone. `/api/admin/tryouts/:eventId/board` returns MY evaluation only. The
 * director's roll-up (`/summary`) shows everybody's — that view is for after, and it is the only
 * place the split is visible.
 *
 * THE RATING IS A COACH'S PRIVATE 1–5 AND NEVER LEAVES STAFF. It exists to sort blocks on the
 * board. It is not a player rating, is never shown to the player, and is never averaged into
 * anything public — owner 2026-08-03: results belong to a team, so a number on a person is a lie
 * about who earned it.
 *
 * Routes (all staff — requireStaff, org-scoped):
 *   GET    /api/admin/tryouts/:eventId/board          → cards + MY evaluation, for evaluating
 *   PUT    /api/admin/tryouts/:eventId/card/:contactId → the player's card (staff can correct it)
 *   PUT    /api/admin/tryouts/:eventId/eval/:contactId → my notes, rating, offer/no-offer
 *   GET    /api/admin/tryouts/:eventId/summary        → every coach's verdicts, per player
 *   GET    /api/admin/tryouts/:eventId/squads         → the board: squads, members, needs
 *   POST   /api/admin/tryouts/:eventId/squads         → create a squad
 *   PATCH  /api/admin/squads/:id                      → rename, recolour, retarget, set needs
 *   DELETE /api/admin/squads/:id                      → soft delete (members released)
 *   POST   /api/admin/squads/:id/assign               → drop a player in (moves them if placed)
 *   POST   /api/admin/squads/:id/remove               → take a player off the board
 *
 * Pure (unit-tested): POSITIONS · parseList · normalizeCard · normalizeEval · squadNeeds ·
 *                     rollUp · cmToImperial
 */

let json, audit, requireStaff, contactForSession;
export function wireTryouts(h) {
  ({ json, audit, requireStaff, contactForSession } = h);
}

/** Indoor volleyball positions. Setter, Outside, Opposite, Middle, Libero, Defensive Specialist. */
export const POSITIONS = ["S", "OH", "RS", "MB", "L", "DS"];
export const VERDICTS = ["offer", "no_offer", "undecided"];
export const MAX_NOTE = 4000;

/* ============================ pure helpers (unit-tested) ============================ */

/** JSON text or array → a clean, deduped, whitelisted list. Anything unrecognised is dropped. */
export function parseList(raw, allowed = null, max = 12) {
  let arr = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { arr = String(raw).split(",").map((s) => s.trim()); }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set(), out = [];
  for (const v of arr) {
    const s = String(v ?? "").trim();
    if (!s || seen.has(s)) continue;
    if (allowed && !allowed.includes(s)) continue;
    seen.add(s);
    out.push(s.slice(0, 24));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Height in centimetres → the feet-and-inches a coach in the US actually reads.
 * Stored metric because one unit in the database is one fewer thing to get wrong; rendered
 * imperial because that is the room's language.
 * @returns {string|null} e.g. "5'11\""
 */
export function cmToImperial(cm) {
  const n = Number(cm);
  if (!Number.isFinite(n) || n <= 0) return null;
  const totalInches = Math.round(n / 2.54);
  return `${Math.floor(totalInches / 12)}'${totalInches % 12}"`;
}

/** Validate the player's card. */
export function normalizeCard(body) {
  const height = body?.height_cm === "" || body?.height_cm === null || body?.height_cm === undefined
    ? null : Number(body.height_cm);
  if (height !== null && (!Number.isFinite(height) || height < 90 || height > 250)) {
    return { ok: false, error: "That height doesn't look right — enter it in centimetres, between 90 and 250." };
  }
  return {
    ok: true,
    value: {
      positions: JSON.stringify(parseList(body?.positions, POSITIONS, 6)),
      age_groups: JSON.stringify(parseList(body?.age_groups, null, 6)),
      height_cm: height === null ? null : Math.round(height),
      prev_club: String(body?.prev_club ?? "").trim().slice(0, 120) || null,
      jersey_size: String(body?.jersey_size ?? "").trim().slice(0, 12) || null,
      player_note: String(body?.player_note ?? "").trim().slice(0, 1000) || null,
    },
  };
}

/** Validate one coach's evaluation. */
export function normalizeEval(body) {
  const verdict = String(body?.verdict ?? "undecided");
  if (!VERDICTS.includes(verdict)) return { ok: false, error: `"${verdict}" isn't a verdict we recognise.` };

  let rating = body?.rating;
  if (rating === "" || rating === null || rating === undefined) rating = null;
  else {
    rating = Number(rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { ok: false, error: "Rating is 1 to 5, or leave it blank." };
    }
  }
  const notes = String(body?.notes ?? "").trim();
  if (notes.length > MAX_NOTE) return { ok: false, error: "Those notes are too long to save. Trim them a little." };
  return { ok: true, value: { rating, notes: notes || null, verdict } };
}

/**
 * What a squad still needs.
 * @param {Record<string,number>} needs  position → wanted
 * @param {Array<{position:string|null}>} members
 * @returns {{shortfall:Record<string,number>, filled:number, target:number, full:boolean}}
 */
export function squadNeeds(needs, members, targetSize) {
  const have = {};
  for (const m of members || []) {
    const p = m.position || "?";
    have[p] = (have[p] || 0) + 1;
  }
  const shortfall = {};
  for (const [pos, want] of Object.entries(needs || {})) {
    const gap = Number(want) - (have[pos] || 0);
    if (gap > 0) shortfall[pos] = gap;
  }
  const filled = (members || []).length;
  const target = Number(targetSize) || 0;
  // "Full" means BOTH the headcount is met AND no position is short. A squad of 10 with no setter
  // is not full, and reporting it as full is how a director finds out in week one.
  return { shortfall, filled, target, full: filled >= target && Object.keys(shortfall).length === 0 };
}

/**
 * Director roll-up. Deliberately reports the SPLIT, not an average: "2 of 3 said offer" is a fact
 * a director can act on, where "0.67" is a number that hides a disagreement worth having.
 */
export function rollUp(rows) {
  const byPlayer = new Map();
  for (const r of rows || []) {
    if (!byPlayer.has(r.contact_id)) {
      byPlayer.set(r.contact_id, {
        contact_id: r.contact_id, name: r.full_name,
        offer: 0, no_offer: 0, undecided: 0, evaluations: 0, ratings: [],
      });
    }
    const p = byPlayer.get(r.contact_id);
    if (r.verdict) { p[r.verdict] = (p[r.verdict] || 0) + 1; p.evaluations++; }
    if (r.rating !== null && r.rating !== undefined) p.ratings.push(Number(r.rating));
  }
  return [...byPlayer.values()].map((p) => ({
    ...p,
    // Range, not mean. Two coaches at 2 and 5 is the interesting case, and a mean of 3.5 erases it.
    rating_low: p.ratings.length ? Math.min(...p.ratings) : null,
    rating_high: p.ratings.length ? Math.max(...p.ratings) : null,
    split: p.evaluations ? `${p.offer}/${p.evaluations} offer` : "not evaluated",
    ratings: undefined,
  }));
}

/* ============================ routes ============================ */

const CARD_COLS = "positions, age_groups, height_cm, prev_club, jersey_size, player_note";

export async function tryoutsRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;

  /* ---- the evaluator board: every registrant, their card, and MY evaluation only ---- */
  if ((x = p.match(/^\/api\/admin\/tryouts\/(\d+)\/board$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const me = await contactForSession(env, ctx);

    const rows = (await env.DB.prepare(
      `SELECT c.id AS contact_id, c.full_name, mp.date_of_birth,
              tp.positions, tp.age_groups, tp.height_cm, tp.prev_club, tp.jersey_size, tp.player_note,
              te.rating, te.notes, te.verdict,
              sm.squad_id
         FROM registrations r
         JOIN contacts c ON c.id = r.contact_id AND c.org_id = r.org_id AND c.deleted_at IS NULL
    LEFT JOIN member_profiles mp ON mp.contact_id = c.id AND mp.org_id = c.org_id AND mp.deleted_at IS NULL
    LEFT JOIN tryout_profiles tp ON tp.contact_id = c.id AND tp.org_id = r.org_id
                                AND tp.event_id = r.event_id AND tp.deleted_at IS NULL
    LEFT JOIN tryout_evaluations te ON te.contact_id = c.id AND te.org_id = r.org_id
                                   AND te.event_id = r.event_id AND te.deleted_at IS NULL
                                   AND te.evaluator_contact_id = ?3
    LEFT JOIN tryout_squad_members sm ON sm.contact_id = c.id AND sm.org_id = r.org_id
                                     AND sm.deleted_at IS NULL
        WHERE r.org_id=?1 AND r.event_id=?2 AND r.deleted_at IS NULL AND r.status != 'cancelled'
        ORDER BY c.full_name COLLATE NOCASE
        LIMIT 400`
    ).bind(ctx.orgId, eventId, me ? me.id : 0).all()).results || [];

    return json({
      players: rows.map((r) => ({
        contact_id: r.contact_id,
        name: r.full_name,
        age: ageFrom(r.date_of_birth),
        positions: parseList(r.positions, POSITIONS, 6),
        age_groups: parseList(r.age_groups, null, 6),
        height_cm: r.height_cm,
        height: cmToImperial(r.height_cm),
        prev_club: r.prev_club,
        jersey_size: r.jersey_size,
        player_note: r.player_note,
        squad_id: r.squad_id,
        my_evaluation: { rating: r.rating, notes: r.notes, verdict: r.verdict || "undecided" },
      })),
    });
  }

  /* ---- the player's card ---- */
  if ((x = p.match(/^\/api\/admin\/tryouts\/(\d+)\/card\/(\d+)$/)) && m === "PUT") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const [eventId, contactId] = [+x[1], +x[2]];
    const norm = normalizeCard(await request.json().catch(() => ({})));
    if (!norm.ok) return json({ error: norm.error }, 400);
    const v = norm.value;

    await env.DB.prepare(
      `INSERT INTO tryout_profiles (org_id, event_id, contact_id, ${CARD_COLS})
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
       ON CONFLICT (org_id, event_id, contact_id) WHERE deleted_at IS NULL
       DO UPDATE SET positions=excluded.positions, age_groups=excluded.age_groups,
                     height_cm=excluded.height_cm, prev_club=excluded.prev_club,
                     jersey_size=excluded.jersey_size, player_note=excluded.player_note,
                     updated_at=datetime('now')`
    ).bind(ctx.orgId, eventId, contactId, v.positions, v.age_groups, v.height_cm,
           v.prev_club, v.jersey_size, v.player_note).run();

    await audit(env, ctx, "tryout.card", "tryout_profiles", contactId, { event_id: eventId });
    return json({ ok: true });
  }

  /* ---- my evaluation ---- */
  if ((x = p.match(/^\/api\/admin\/tryouts\/(\d+)\/eval\/(\d+)$/)) && m === "PUT") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const [eventId, contactId] = [+x[1], +x[2]];
    const me = await contactForSession(env, ctx);
    // Without a contact row there is nobody to attribute the judgement to, and an unattributed
    // evaluation is worse than none — a director cannot ask the writer what they meant.
    if (!me) return json({ error: "Your staff account has no member record, so an evaluation can't be attributed. Ask an admin to link it." }, 409);

    const norm = normalizeEval(await request.json().catch(() => ({})));
    if (!norm.ok) return json({ error: norm.error }, 400);
    const v = norm.value;

    await env.DB.prepare(
      `INSERT INTO tryout_evaluations (org_id, event_id, contact_id, evaluator_contact_id, rating, notes, verdict)
       VALUES (?1,?2,?3,?4,?5,?6,?7)
       ON CONFLICT (org_id, event_id, contact_id, evaluator_contact_id) WHERE deleted_at IS NULL
       DO UPDATE SET rating=excluded.rating, notes=excluded.notes, verdict=excluded.verdict,
                     updated_at=datetime('now')`
    ).bind(ctx.orgId, eventId, contactId, me.id, v.rating, v.notes, v.verdict).run();

    await audit(env, ctx, "tryout.eval", "tryout_evaluations", contactId,
      { event_id: eventId, verdict: v.verdict });
    return json({ ok: true });
  }

  /* ---- director roll-up: everybody's verdicts ---- */
  if ((x = p.match(/^\/api\/admin\/tryouts\/(\d+)\/summary$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const rows = (await env.DB.prepare(
      `SELECT te.contact_id, te.rating, te.verdict, c.full_name
         FROM tryout_evaluations te
         JOIN contacts c ON c.id = te.contact_id AND c.org_id = te.org_id
        WHERE te.org_id=?1 AND te.event_id=?2 AND te.deleted_at IS NULL
        LIMIT 2000`
    ).bind(ctx.orgId, eventId).all()).results || [];
    return json({ players: rollUp(rows) });
  }

  /* ---- the board ---- */
  if ((x = p.match(/^\/api\/admin\/tryouts\/(\d+)\/squads$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const squads = (await env.DB.prepare(
      `SELECT id, name, age_group, colour, target_size, needs_json, sort_order
         FROM tryout_squads WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL
        ORDER BY sort_order, id`
    ).bind(ctx.orgId, eventId).all()).results || [];

    const members = (await env.DB.prepare(
      `SELECT sm.squad_id, sm.contact_id, sm.position, c.full_name,
              tp.height_cm, tp.positions, tp.age_groups
         FROM tryout_squad_members sm
         JOIN tryout_squads s ON s.id = sm.squad_id AND s.org_id = sm.org_id AND s.deleted_at IS NULL
         JOIN contacts c ON c.id = sm.contact_id AND c.org_id = sm.org_id
    LEFT JOIN tryout_profiles tp ON tp.contact_id = sm.contact_id AND tp.org_id = sm.org_id
                                AND tp.event_id = s.event_id AND tp.deleted_at IS NULL
        WHERE sm.org_id=?1 AND s.event_id=?2 AND sm.deleted_at IS NULL`
    ).bind(ctx.orgId, eventId).all()).results || [];

    const out = squads.map((s) => {
      let needs = {};
      try { needs = JSON.parse(s.needs_json || "{}"); } catch { needs = {}; }
      const mine = members.filter((mm) => mm.squad_id === s.id).map((mm) => ({
        contact_id: mm.contact_id, name: mm.full_name, position: mm.position,
        height: cmToImperial(mm.height_cm),
        positions: parseList(mm.positions, POSITIONS, 6),
        age_groups: parseList(mm.age_groups, null, 6),
      }));
      return { ...s, needs, members: mine, ...squadNeeds(needs, mine, s.target_size) };
    });

    // The aggregate a director pivots on: how many squads are complete, and what is still missing
    // across all of them. Summed from the same squadNeeds() the cards use — one definition.
    const totals = { squads: out.length, full: out.filter((s) => s.full).length, placed: members.length, shortfall: {} };
    for (const s of out) {
      for (const [pos, gap] of Object.entries(s.shortfall)) totals.shortfall[pos] = (totals.shortfall[pos] || 0) + gap;
    }
    return json({ squads: out, totals });
  }

  if ((x = p.match(/^\/api\/admin\/tryouts\/(\d+)\/squads$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const name = String(b.name ?? "").trim();
    if (!name) return json({ error: "Give the team a name." }, 400);
    let needs = {};
    if (b.needs && typeof b.needs === "object") {
      for (const [k, v] of Object.entries(b.needs)) {
        if (POSITIONS.includes(k) && Number.isInteger(Number(v)) && Number(v) >= 0) needs[k] = Number(v);
      }
    }
    const ins = await env.DB.prepare(
      `INSERT INTO tryout_squads (org_id, event_id, name, age_group, colour, target_size, needs_json, sort_order)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
    ).bind(ctx.orgId, eventId, name.slice(0, 80),
           String(b.age_group ?? "").trim().slice(0, 20) || null,
           String(b.colour ?? "").trim().slice(0, 20) || null,
           Number.isInteger(Number(b.target_size)) ? Number(b.target_size) : 10,
           JSON.stringify(needs), Number(b.sort_order) || 0).run();
    await audit(env, ctx, "tryout.squad.create", "tryout_squads", ins.meta.last_row_id, { event_id: eventId });
    return json({ ok: true, squad_id: ins.meta.last_row_id });
  }

  if ((x = p.match(/^\/api\/admin\/squads\/(\d+)$/)) && m === "PATCH") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const id = +x[1];
    const cur = await env.DB.prepare(
      "SELECT id, name, age_group, colour, target_size, needs_json, sort_order FROM tryout_squads WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(id, ctx.orgId).first();
    if (!cur) return json({ error: "That team doesn't exist." }, 404);
    const b = await request.json().catch(() => ({}));
    let needs = cur.needs_json;
    if (b.needs && typeof b.needs === "object") {
      const clean = {};
      for (const [k, v] of Object.entries(b.needs)) {
        if (POSITIONS.includes(k) && Number.isInteger(Number(v)) && Number(v) >= 0) clean[k] = Number(v);
      }
      needs = JSON.stringify(clean);
    }
    await env.DB.prepare(
      `UPDATE tryout_squads SET name=?1, age_group=?2, colour=?3, target_size=?4, needs_json=?5,
              sort_order=?6, updated_at=datetime('now') WHERE id=?7 AND org_id=?8`
    ).bind(String(b.name ?? cur.name).trim().slice(0, 80) || cur.name,
           b.age_group !== undefined ? (String(b.age_group).trim().slice(0, 20) || null) : cur.age_group,
           b.colour !== undefined ? (String(b.colour).trim().slice(0, 20) || null) : cur.colour,
           Number.isInteger(Number(b.target_size)) ? Number(b.target_size) : cur.target_size,
           needs, Number.isInteger(Number(b.sort_order)) ? Number(b.sort_order) : cur.sort_order,
           id, ctx.orgId).run();
    await audit(env, ctx, "tryout.squad.update", "tryout_squads", id, {});
    return json({ ok: true });
  }

  if ((x = p.match(/^\/api\/admin\/squads\/(\d+)$/)) && m === "DELETE") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const id = +x[1];
    const cur = await env.DB.prepare(
      "SELECT id FROM tryout_squads WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(id, ctx.orgId).first();
    if (!cur) return json({ error: "That team doesn't exist." }, 404);
    // Release the players first — a deleted squad must not strand anyone off the board where the
    // one-squad-per-player index would then silently refuse to re-place them.
    await env.DB.prepare("UPDATE tryout_squad_members SET deleted_at=datetime('now') WHERE squad_id=?1 AND org_id=?2")
      .bind(id, ctx.orgId).run();
    await env.DB.prepare("UPDATE tryout_squads SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2")
      .bind(id, ctx.orgId).run();
    await audit(env, ctx, "tryout.squad.delete", "tryout_squads", id, {});
    return json({ ok: true, note: "Team removed. Everyone on it is back in the unplaced pool." });
  }

  if ((x = p.match(/^\/api\/admin\/squads\/(\d+)\/assign$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const squadId = +x[1];
    const b = await request.json().catch(() => ({}));
    const contactId = Number(b.contact_id);
    if (!contactId) return json({ error: "Pick a player." }, 400);

    const squad = await env.DB.prepare(
      "SELECT id, event_id FROM tryout_squads WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(squadId, ctx.orgId).first();
    if (!squad) return json({ error: "That team doesn't exist." }, 404);

    // Dropping a player into a squad MOVES them: the board is a placement, not a wishlist, and a
    // setter sitting in two squads at once is the confusion this prevents.
    await env.DB.prepare(
      `UPDATE tryout_squad_members SET deleted_at=datetime('now')
        WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL
          AND squad_id IN (SELECT id FROM tryout_squads WHERE org_id=?1 AND event_id=?3)`
    ).bind(ctx.orgId, contactId, squad.event_id).run();

    await env.DB.prepare(
      `INSERT INTO tryout_squad_members (org_id, squad_id, contact_id, position) VALUES (?1,?2,?3,?4)
       ON CONFLICT (org_id, contact_id, squad_id) WHERE deleted_at IS NULL
       DO UPDATE SET position=excluded.position, deleted_at=NULL`
    ).bind(ctx.orgId, squadId, contactId,
           POSITIONS.includes(String(b.position)) ? String(b.position) : null).run();

    await audit(env, ctx, "tryout.squad.assign", "tryout_squad_members", contactId, { squad_id: squadId });
    return json({ ok: true });
  }

  if ((x = p.match(/^\/api\/admin\/squads\/(\d+)\/remove$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const squadId = +x[1];
    const b = await request.json().catch(() => ({}));
    const contactId = Number(b.contact_id);
    if (!contactId) return json({ error: "Pick a player." }, 400);
    await env.DB.prepare(
      "UPDATE tryout_squad_members SET deleted_at=datetime('now') WHERE org_id=?1 AND squad_id=?2 AND contact_id=?3 AND deleted_at IS NULL"
    ).bind(ctx.orgId, squadId, contactId).run();
    await audit(env, ctx, "tryout.squad.remove", "tryout_squad_members", contactId, { squad_id: squadId });
    return json({ ok: true });
  }

  return null;
}

/** Whole years old today, or null. UTC basis, matching profiles.js (F-38). */
function ageFrom(dob) {
  if (!dob) return null;
  const d = new Date(String(dob) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}
