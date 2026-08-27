/**
 * Boomtown Platform — League Manager (Module 8, RECOVERY BUILD)
 * File: worker/src/leagues_admin.js · Version: v1.3.0 · Date: 2026-08-24
 * v1.3.0 (§-1r RF-2 Unit B, owner rule 2026-08-24): a league NIGHT can hold more than one
 *   rotation. `roundsPerNight` (1-3) re-runs the pairing over ALL teams per rotation — meetCount
 *   and games are updated between rotations, so rotation 2 prefers fresh opponents and a
 *   rotation-1 bye gets priority — and `gamesPerMatch` (1-2) writes that many game rows per
 *   pairing (same court, back to back). The whole night stays ONE `round` (round = the week
 *   number; every board/print/standings surface groups by it); the play order rides
 *   `game_number` (the axis tournament pools already write): (rotation-1)*gamesPerMatch + game.
 *   The facility claim's DEFAULT window scales with rotations (180min each); explicit
 *   weekMinutes still wins.
 * v1.2.0 (M12B): week generation auto-claims courts for that week night on the facility
 *   calendar (window = starts_at time + weekMinutes, default 180); deleting a week releases it.
 * The original v1.0 shipped in the v0.7.0 ZIP, which was never uploaded to the
 * repo; this rebuild restores the module against the SAME live schema
 * (migration 0005: teams.level_num, events.staff_contact_id) and the same
 * wire() pattern. Mounted by worker/src/index.js as leagueRoutes/wireLeagues.
 *
 * Staff routes (admin/staff role in the org):
 *   GET    /api/admin/leagues              league events + team counts + weeks played
 *   GET    /api/leagues/:id/board          teams (levels + record), weeks, standings, staff options
 *   POST   /api/leagues/:id/levels         { levels: [{ team_id, level_num }] } bulk save
 *   POST   /api/leagues/:id/week           generate next week's matchups (level-gap ≤ 2)
 *   DELETE /api/leagues/:id/week/:round    remove an UNSCORED week (409 if any score exists)
 *   POST   /api/leagues/:id/staff          { contact_id | null } assign the night's staff
 *
 * Scoring reuses the existing 2-tap contract: POST /api/matches/:id/score
 * { winner: 'a'|'b', diff ≥ 1 } (tournaments.js), which refreshes standings.
 *
 * Scheduler: weekly pairing with a hard level-gap cap of 2 (teams.level_num,
 * 1 = strongest). Priorities: fewest previous meetings between the pair, then
 * smallest level gap. Odd team count → the team with the most games sits (bye).
 */

import { autoClaimForEvent, releaseAutoClaims, eventWindow } from "./facility.js";

let json, audit, isStaff, requireStaff;
export function wireLeagues(helpers) { ({ json, audit, isStaff, requireStaff } = helpers); }

const MAX_LEVEL_GAP = 2;

/* ── v1.6 (owner 2026-08-26): the WINS-RANKED PODS format, integrated from the QC Schedule
   Generator. A second `pairingMode` alongside the level-capped default: rank the ladder by WINS,
   cut it into rank-adjacent pods of 4 (a 6 absorbs the awkward remainder), and play a partial
   round-robin so every team gets exactly 3 distinct opponents that night, no repeats. The pod
   templates give 3 game-slots for BOTH sizes (POD4 is a full RR; POD6 is truncated to 3 rounds so
   everyone still plays exactly 3, never 5). The level-gap cap does NOT apply here — the pods are by
   standing, not skill level. Pure functions, exported for league_wins_pods.test.mjs. */
const POD4 = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
const POD6_3RD = [[[0, 5], [1, 4], [2, 3]], [[0, 4], [5, 3], [1, 2]], [[0, 3], [4, 2], [5, 1]]];

export function podSizes(n) {
  if (n <= 0) return { sizes: [], bye: 0 };
  const bye = n % 2 === 1 ? 1 : 0;
  let rem = n - bye;
  const sizes = [];
  if (rem % 4 === 2 && rem >= 6) { sizes.push(6); rem -= 6; }
  while (rem >= 4) { sizes.push(4); rem -= 4; }
  if (rem === 2) sizes.push(2);
  return { sizes, bye };
}

/** `teams` must already be ranked strongest-first. Returns { rounds: [[ [aId,bId], … ] × 3], byes }.
 *  The odd-count bye is the lowest-ranked team (it sorts last). */
export function pairWinsPods(teams) {
  const { sizes, bye } = podSizes(teams.length);
  const byeTeam = bye ? teams[teams.length - 1] : null;
  const pool = bye ? teams.slice(0, -1) : teams.slice();
  const pods = []; let idx = 0;
  for (const s of sizes) { pods.push(pool.slice(idx, idx + s)); idx += s; }
  const rounds = [[], [], []];
  for (const pod of pods) {
    // A lone 2-team pod (only at N=2, or N=3 with the odd bye) plays best-of-3 across all three
    // game-slots — its only opponent is each other, so the degenerate round-robin fills the night
    // rather than playing once and sitting idle for slots 2-3 (v0.207.0, Gemini C4).
    const tmpl = pod.length === 6 ? POD6_3RD : pod.length === 4 ? POD4 : [[[0, 1]], [[0, 1]], [[0, 1]]];
    for (let r = 0; r < 3; r++) for (const [i, j] of (tmpl[r] || []))
      if (pod[i] && pod[j]) rounds[r].push([pod[i].id, pod[j].id]);
  }
  const byes = byeTeam ? [{ id: byeTeam.id, name: byeTeam.name, reason: "odd count: the lowest-ranked team sits" }] : [];
  return { rounds, byes };
}

export async function leagueRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;
  let match;

  if (p === "/api/admin/leagues" && m === "GET") return listLeagues(env, ctx);
  if ((match = p.match(/^\/api\/leagues\/(\d+)\/board$/)) && m === "GET") return board(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/leagues\/(\d+)\/levels$/)) && m === "POST") return saveLevels(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/leagues\/(\d+)\/week$/)) && m === "POST") return generateWeek(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/leagues\/(\d+)\/week\/(\d+)$/)) && m === "DELETE") return deleteWeek(env, ctx, +match[1], +match[2]);
  if ((match = p.match(/^\/api\/leagues\/(\d+)\/staff$/)) && m === "POST") return assignStaff(request, env, ctx, +match[1]);
  return null; // not a league route
}

async function loadLeague(env, ctx, id) {
  const ev = await env.DB.prepare(
    "SELECT * FROM events WHERE id=?1 AND type='league' AND deleted_at IS NULL"
  ).bind(id).first();
  return ev && ev.org_id === ctx.orgId ? ev : null;
}

async function listLeagues(env, ctx) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const rows = (await env.DB.prepare(
    `SELECT e.id, e.name, e.starts_at, e.ends_at, e.location, e.status, e.court_count,
            e.staff_contact_id, sc.full_name AS staff_name,
            (SELECT COUNT(*) FROM teams t WHERE t.event_id=e.id AND t.deleted_at IS NULL) AS team_count,
            (SELECT COALESCE(MAX(m.round),0) FROM matches m WHERE m.event_id=e.id AND m.deleted_at IS NULL) AS weeks_played
     FROM events e LEFT JOIN contacts sc ON sc.id=e.staff_contact_id
     WHERE e.org_id=?1 AND e.type='league' AND e.deleted_at IS NULL
     ORDER BY e.status='in_progress' DESC, e.starts_at DESC`
  ).bind(ctx.orgId).all()).results;
  return json({ leagues: rows });
}

async function board(env, ctx, id) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const ev = await loadLeague(env, ctx, id);
  if (!ev) return json({ error: "League not found in this org." }, 404);

  const teams = (await env.DB.prepare(
    `SELECT t.id, t.name, COALESCE(t.level_num, 3) AS level_num,
            COALESCE(s.wins,0) AS wins, COALESCE(s.losses,0) AS losses,
            COALESCE(s.point_diff,0) AS point_diff, s.rank
     FROM teams t
     LEFT JOIN standings s ON s.event_id=t.event_id AND s.team_id=t.id AND s.deleted_at IS NULL
     WHERE t.event_id=?1 AND t.deleted_at IS NULL
     ORDER BY COALESCE(t.level_num,3), t.name COLLATE NOCASE`
  ).bind(id).all()).results;

  const matches = (await env.DB.prepare(
    `SELECT m.id, m.round, m.court, m.team_a_id, m.team_b_id, m.score_a, m.score_b, m.points_to,
            m.game_number, m.forfeit_by,
            ta.name AS team_a, tb.name AS team_b
     FROM matches m
     LEFT JOIN teams ta ON ta.id=m.team_a_id
     LEFT JOIN teams tb ON tb.id=m.team_b_id
     WHERE m.event_id=?1 AND m.deleted_at IS NULL
     ORDER BY m.round DESC, m.game_number, m.court`
  ).bind(id).all()).results;
  const weeks = [];
  for (const mt of matches) {
    let w = weeks.find(x => x.round === mt.round);
    if (!w) { w = { round: mt.round, matches: [] }; weeks.push(w); }
    w.matches.push(mt);
  }

  const standings = (await env.DB.prepare(
    `SELECT s.rank, s.team_id, t.name, s.wins, s.losses, s.point_diff
     FROM standings s JOIN teams t ON t.id=s.team_id
     WHERE s.event_id=?1 AND s.deleted_at IS NULL ORDER BY s.rank`
  ).bind(id).all()).results;

  const staffOptions = (await env.DB.prepare(
    `SELECT DISTINCT c.id AS contact_id, c.full_name
     FROM contacts c
     JOIN users u ON u.id=c.user_id AND u.deleted_at IS NULL
     JOIN user_org_roles r ON r.user_id=u.id AND r.org_id=?1
       AND r.role IN ('admin','staff') AND r.deleted_at IS NULL
     WHERE c.org_id=?1 AND c.deleted_at IS NULL
     ORDER BY c.full_name COLLATE NOCASE`
  ).bind(ctx.orgId).all()).results;

  return json({
    event: { id: ev.id, name: ev.name, starts_at: ev.starts_at, status: ev.status,
             court_count: ev.court_count || 4, staff_contact_id: ev.staff_contact_id },
    teams, weeks, standings, staff_options: staffOptions,
  });
}

async function saveLevels(request, env, ctx, id) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const ev = await loadLeague(env, ctx, id);
  if (!ev) return json({ error: "League not found in this org." }, 404);
  const b = await request.json().catch(() => ({}));
  const levels = Array.isArray(b.levels) ? b.levels : [];
  if (!levels.length) return json({ error: "Nothing to save." }, 400);
  let updated = 0;
  for (const row of levels) {
    const teamId = Number(row.team_id), lvl = Number(row.level_num);
    if (!teamId || !(lvl >= 1 && lvl <= 9)) continue;
    const r = await env.DB.prepare(
      "UPDATE teams SET level_num=?1, updated_at=datetime('now') WHERE id=?2 AND event_id=?3 AND deleted_at IS NULL"
    ).bind(lvl, teamId, id).run();
    updated += r.meta.changes;
  }
  await audit(env, ctx, "league.levels", "events", id, { updated });
  return json({ ok: true, updated });
}

/** Pairing (original v0.7.0 rules, per CHANGELOG): HARD — teams more than
 *  MAX_LEVEL_GAP levels apart never play (a team sits before crossing the gap);
 *  SOFT — rematches are avoided until unavoidable, then flagged. Sort by games
 *  played so byes rotate; odd counts and stranded teams become byes (flagged). */
function pairWeek(teams, meetCount) {
  const pool = [...teams].sort((a, b) => a.games - b.games || a.level_num - b.level_num);
  const used = new Set();
  const pairs = [], warnings = [], byes = [];
  // fewest-games first get priority picking; iterate a copy so byes can collect
  for (const t of pool) {
    if (used.has(t.id)) continue;
    used.add(t.id);
    let best = null;
    for (const c of pool) {
      if (used.has(c.id) || c.id === t.id) continue;
      const gap = Math.abs(t.level_num - c.level_num);
      if (gap > MAX_LEVEL_GAP) continue; // HARD rule — never pair across the gap
      const met = meetCount.get(keyOf(t.id, c.id)) || 0;
      const score = met * 10 + gap;
      if (!best || score < best.score) best = { c, gap, met, score };
    }
    if (!best) {
      const anyoneLeft = pool.some(c => !used.has(c.id) && c.id !== t.id);
      byes.push({ id: t.id, name: t.name, reason: anyoneLeft ? "no opponent within 2 levels" : null });
      continue;
    }
    used.add(best.c.id);
    pairs.push([t.id, best.c.id]);
    if (best.met > 0) warnings.push({ type: "rematch", teams: [t.name, best.c.name], count: best.met + 1 });
  }
  for (const b of byes) {
    // A bye is "stranded" (not rotation) when NO team in the league is within the gap cap.
    const me = pool.find(t => t.id === b.id);
    const anyCompatible = pool.some(c => c.id !== b.id && Math.abs(c.level_num - me.level_num) <= MAX_LEVEL_GAP);
    if (b.reason || !anyCompatible) warnings.push({ type: "stranded", teams: [b.name], note: b.reason || "no opponent within 2 levels" });
  }
  return { pairs, byes, warnings };
}
const keyOf = (a, b) => [Math.min(a, b), Math.max(a, b)].join("-");

async function generateWeek(request, env, ctx, id) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const ev = await loadLeague(env, ctx, id);
  if (!ev) return json({ error: "League not found in this org." }, 404);
  const b = await request.json().catch(() => ({}));

  const teams = (await env.DB.prepare(
    `SELECT t.id, t.name, COALESCE(t.level_num,3) AS level_num,
            COALESCE(s.wins,0) AS wins, COALESCE(s.point_diff,0) AS point_diff,
            (SELECT COUNT(*) FROM matches m WHERE (m.team_a_id=t.id OR m.team_b_id=t.id)
              AND m.event_id=?1 AND m.deleted_at IS NULL) AS games
     FROM teams t
     LEFT JOIN standings s ON s.event_id=t.event_id AND s.team_id=t.id AND s.deleted_at IS NULL
     WHERE t.event_id=?1 AND t.deleted_at IS NULL`
  ).bind(id).all()).results;
  if (teams.length < 2) return json({ error: "Add at least 2 teams before generating a week." }, 400);

  const prior = (await env.DB.prepare(
    "SELECT team_a_id, team_b_id FROM matches WHERE event_id=?1 AND deleted_at IS NULL"
  ).bind(id).all()).results;
  const meetCount = new Map();
  for (const m of prior) {
    const k = keyOf(m.team_a_id, m.team_b_id);
    meetCount.set(k, (meetCount.get(k) || 0) + 1);
  }

  let cfg = {}; try { cfg = JSON.parse(ev.config_json || "{}") || {}; } catch { cfg = {}; }

  // v1.6 (owner 2026-08-26): the WINS-RANKED PODS format (QC integration). Its own insert path —
  // game_number carries the pod-RR slot (1-3), the level-gap cap does NOT apply, and cross-week
  // rematch avoidance is intentionally absent (the format re-ranks by wins each week, so who you
  // meet follows the ladder). Early return keeps the level-capped path below byte-identical.
  const pairingMode = (b.pairingMode || cfg.pairingMode) === "wins-pods" ? "wins-pods" : "level-capped";
  if (pairingMode === "wins-pods") {
    const ranked = [...teams].sort((a, bb) =>
      (bb.wins - a.wins) || (bb.point_diff - a.point_diff) || String(a.name).localeCompare(String(bb.name)));
    const { rounds: podRounds, byes: podByes } = pairWinsPods(ranked);
    const maxR = await env.DB.prepare(
      "SELECT COALESCE(MAX(round),0) AS r FROM matches WHERE event_id=?1 AND deleted_at IS NULL"
    ).bind(id).first();
    const roundNo = (maxR.r || 0) + 1;
    const pointsToP = Number(b.pointsTo) || cfg.pointsTo || 21;
    const capP = Number(b.cap) || cfg.cap || pointsToP + 2;
    const courtsP = Math.max(1, Number(b.courts) || ev.court_count || 4);
    // D-59: accumulate the week's inserts and flush them in ONE atomic batch (PROMPT §3, and the
    // test DB batches atomically too), so a pod night is all-or-nothing rather than a partial week
    // if a statement fails mid-loop. The court/game_number logic is unchanged — statements are
    // pushed in the exact order they were previously run.
    const podStmts = [];
    for (let r = 0; r < podRounds.length; r++) {
      let court = 1;
      for (const [a, bb] of podRounds[r]) {
        podStmts.push(env.DB.prepare(
          `INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id, points_to, cap, game_number)
           VALUES (?1,?2,'pool',?3,?4,?5,?6,?7,?8,?9)`
        ).bind(ev.org_id, id, roundNo, court, a, bb, pointsToP, capP, r + 1));
        court = court % courtsP + 1;
      }
    }
    if (!podStmts.length) return json({ error: "Not enough teams for a pod. Add at least 2." }, 422);
    await env.DB.batch(podStmts);
    const insertedP = podStmts.length;
    await audit(env, ctx, "league.week.generate", "events", id,
      { round: roundNo, matches: insertedP, byes: podByes.length, pairingMode: "wins-pods" });
    let claim = null;
    try {
      claim = await autoClaimForEvent(env, ctx, ev,
        { courts: courtsP, budgetMinutes: Number(b.weekMinutes) || cfg.weekMinutes || 180, weekRound: roundNo });
    } catch (e) { console.error("autoclaim failed", e); claim = { skipped: "Court claim failed; book manually on the Facility calendar." }; }
    return json({ ok: true, round: roundNo, matches: insertedP, byes: podByes, warnings: [],
      pairing_mode: "wins-pods", facility_claim: claim });
  }

  // RF-2 Unit B (owner rule 2026-08-24): "rotate through all the teams more than once … 3 rounds
  // with 2 games each" — rotations re-pair EVERYBODY, games multiply the rows per pairing.
  const roundsPerNight = Math.min(3, Math.max(1, Number(b.roundsPerNight) || Number(cfg.roundsPerNight) || 1));
  const gamesPerMatch = Math.min(2, Math.max(1, Number(b.gamesPerMatch) || Number(cfg.gamesPerMatch) || 1));

  // Each rotation pairs the CURRENT state: meetCount grows with the rotations already scheduled
  // tonight (so rotation 2 prefers a fresh opponent — rematches stay the flagged fallback), and
  // `games` grows for whoever got paired (so a rotation-1 bye sorts first in rotation 2).
  const nights = [];
  const byes = [], warnings = [];
  for (let rot = 1; rot <= roundsPerNight; rot++) {
    const result = pairWeek(teams, meetCount);
    if (!result.pairs.length && rot === 1) {
      return json({ error: "Couldn't build matchups from these teams." }, 422);
    }
    nights.push(result.pairs);
    for (const by of result.byes) byes.push(roundsPerNight > 1 ? { ...by, rotation: rot } : by);
    for (const w of result.warnings) warnings.push(roundsPerNight > 1 ? { ...w, rotation: rot } : w);
    for (const [a, bb] of result.pairs) {
      const k = keyOf(a, bb);
      meetCount.set(k, (meetCount.get(k) || 0) + 1);
      for (const t of teams) if (t.id === a || t.id === bb) t.games += gamesPerMatch;
    }
  }

  const maxRound = await env.DB.prepare(
    "SELECT COALESCE(MAX(round),0) AS r FROM matches WHERE event_id=?1 AND deleted_at IS NULL"
  ).bind(id).first();
  const round = (maxRound.r || 0) + 1;
  const pointsTo = Number(b.pointsTo) || cfg.pointsTo || 21;
  const cap = Number(b.cap) || cfg.cap || pointsTo + 2;
  const courts = Math.max(1, Number(b.courts) || ev.court_count || 4);

  // ONE round for the whole night; play order rides game_number. A pairing's games share a court
  // (played back to back); the court cycles per PAIRING so a team lands wherever the night takes
  // it — different courts across rotations is the owner's stated shape, not a defect.
  // D-59: same one-atomic-batch flush as the wins-pods path above (PROMPT §3). Court/game_number
  // logic unchanged — statements are pushed in the exact order they were previously run.
  const weekStmts = [];
  let court = 1;
  for (let rot = 1; rot <= roundsPerNight; rot++) {
    for (const [a, bb] of nights[rot - 1] || []) {
      for (let g = 1; g <= gamesPerMatch; g++) {
        // game_number is NOT NULL DEFAULT 1 on live (measured) — a plain night's single game IS
        // game 1, so the number is always bound; a structured night counts on up from there.
        const gameNo = (rot - 1) * gamesPerMatch + g;
        weekStmts.push(env.DB.prepare(
          `INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id, points_to, cap, game_number)
           VALUES (?1,?2,'pool',?3,?4,?5,?6,?7,?8,?9)`
        ).bind(ev.org_id, id, round, court, a, bb, pointsTo, cap, gameNo));
      }
      court = court % courts + 1;
    }
  }
  if (weekStmts.length) await env.DB.batch(weekStmts);
  const inserted = weekStmts.length;
  await audit(env, ctx, "league.week.generate", "events", id,
    { round, matches: inserted, byes: byes.length, roundsPerNight, gamesPerMatch });

  // M12 Phase B: claim this week's courts on the facility calendar. Never blocks the week.
  // The DEFAULT window scales with the night's rotations; an explicit weekMinutes wins.
  let facility_claim = null;
  try {
    facility_claim = await autoClaimForEvent(env, ctx, ev,
      { courts, budgetMinutes: Number(b.weekMinutes) || cfg.weekMinutes || 180 * roundsPerNight, weekRound: round });
  } catch (e) { console.error("autoclaim failed", e); facility_claim = { skipped: "Court claim failed; book manually on the Facility calendar." }; }

  return json({ ok: true, round, matches: inserted, byes, warnings,
    rounds_per_night: roundsPerNight, games_per_match: gamesPerMatch, facility_claim });
}

async function deleteWeek(env, ctx, id, round) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const ev = await loadLeague(env, ctx, id);
  if (!ev) return json({ error: "League not found in this org." }, 404);
  const scored = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM matches WHERE event_id=?1 AND round=?2 AND score_a IS NOT NULL AND deleted_at IS NULL"
  ).bind(id, round).first();
  if (scored.n > 0) {
    return json({ error: `Week ${round} has ${scored.n} scored game(s). Clear those scores at the desk first.` }, 409);
  }
  const r = await env.DB.prepare(
    "UPDATE matches SET deleted_at=datetime('now') WHERE event_id=?1 AND round=?2 AND deleted_at IS NULL"
  ).bind(id, round).run();
  await audit(env, ctx, "league.week.delete", "events", id, { round, removed: r.meta.changes });
  // Release that week's auto-claimed courts (manual bookings are untouched).
  try {
    const win = eventWindow(ev.starts_at, 180, round);
    if (win) await releaseAutoClaims(env, id, win.date);
  } catch (e) { console.error("claim release failed", e); }
  return json({ ok: true, removed: r.meta.changes });
}

async function assignStaff(request, env, ctx, id) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const ev = await loadLeague(env, ctx, id);
  if (!ev) return json({ error: "League not found in this org." }, 404);
  const b = await request.json().catch(() => ({}));
  const contactId = b.contact_id ? Number(b.contact_id) : null;
  if (contactId) {
    const c = await env.DB.prepare(
      "SELECT id FROM contacts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(contactId, ctx.orgId).first();
    if (!c) return json({ error: "That person isn't in this org." }, 404);
  }
  await env.DB.prepare(
    "UPDATE events SET staff_contact_id=?1, updated_at=datetime('now') WHERE id=?2"
  ).bind(contactId, id).run();
  await audit(env, ctx, "league.staff", "events", id, { contact_id: contactId });
  return json({ ok: true });
}
