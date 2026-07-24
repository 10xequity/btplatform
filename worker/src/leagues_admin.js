/**
 * Boomtown Platform — League Manager (Module 8, RECOVERY BUILD)
 * File: worker/src/leagues_admin.js · Version: v1.1 · Date: 2026-07-24
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

let json, audit, isStaff, requireStaff;
export function wireLeagues(helpers) { ({ json, audit, isStaff, requireStaff } = helpers); }

const MAX_LEVEL_GAP = 2;

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
            ta.name AS team_a, tb.name AS team_b
     FROM matches m
     LEFT JOIN teams ta ON ta.id=m.team_a_id
     LEFT JOIN teams tb ON tb.id=m.team_b_id
     WHERE m.event_id=?1 AND m.deleted_at IS NULL
     ORDER BY m.round DESC, m.court`
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
            (SELECT COUNT(*) FROM matches m WHERE (m.team_a_id=t.id OR m.team_b_id=t.id)
              AND m.event_id=?1 AND m.deleted_at IS NULL) AS games
     FROM teams t WHERE t.event_id=?1 AND t.deleted_at IS NULL`
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

  const { pairs, byes, warnings } = pairWeek(teams, meetCount);
  if (!pairs.length) return json({ error: "Couldn't build matchups from these teams." }, 422);

  const maxRound = await env.DB.prepare(
    "SELECT COALESCE(MAX(round),0) AS r FROM matches WHERE event_id=?1 AND deleted_at IS NULL"
  ).bind(id).first();
  const round = (maxRound.r || 0) + 1;
  const cfg = JSON.parse(ev.config_json || "{}");
  const pointsTo = Number(b.pointsTo) || cfg.pointsTo || 21;
  const cap = Number(b.cap) || cfg.cap || pointsTo + 2;
  const courts = Math.max(1, Number(b.courts) || ev.court_count || 4);

  let court = 1;
  for (const [a, bb] of pairs) {
    await env.DB.prepare(
      `INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id, points_to, cap)
       VALUES (?1,?2,'pool',?3,?4,?5,?6,?7,?8)`
    ).bind(ev.org_id, id, round, court, a, bb, pointsTo, cap).run();
    court = court % courts + 1;
  }
  await audit(env, ctx, "league.week.generate", "events", id, { round, matches: pairs.length, byes: byes.length });
  return json({ ok: true, round, matches: pairs.length, byes, warnings });
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
