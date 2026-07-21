/**
 * Boomtown Platform — Tournament API routes
 * Version: v0.2 · Date: 2026-07-21
 * Mounted by worker/src/index.js. All writes require admin/staff role in the event's org.
 * Reads: published events are public; drafts require staff.
 */
import {
  FORMAT_TEMPLATES, feasibility, generatePairings, scheduleMatches, computeStandings, buildBracket,
} from "./scheduler.js";

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
  if ((match = p.match(/^\/api\/events\/(\d+)\/bracket$/)) && m === "POST") {
    return createBracket(request, env, ctx, +match[1]);
  }
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
  return json({ event: ev });
}

async function patchEvent(request, env, ctx, id) {
  const ev = await env.DB.prepare("SELECT org_id FROM events WHERE id=?1 AND deleted_at IS NULL").bind(id).first();
  if (!ev) return json({ error: "Event not found." }, 404);
  const deny = await requireStaff(env, ctx, ev.org_id);
  if (deny) return deny;
  const b = await request.json();
  const allowed = ["name", "starts_at", "location", "court_count", "status", "cash_option_enabled", "config_json"];
  const sets = [], vals = [];
  for (const k of allowed) if (k in b) { sets.push(`${k}=?${sets.length + 1}`); vals.push(b[k]); }
  if (!sets.length) return json({ error: "Nothing to update." }, 400);
  vals.push(id);
  await env.DB.prepare(`UPDATE events SET ${sets.join(",")}, updated_at=datetime('now') WHERE id=?${vals.length}`).bind(...vals).run();
  await audit(env, ctx, "event.update", "events", id, b);
  return json({ ok: true });
}

async function listTeams(env, eventId) {
  const rows = (await env.DB.prepare(
    "SELECT id, name, level, gender_division, seed FROM teams WHERE event_id=?1 AND deleted_at IS NULL ORDER BY id"
  ).bind(eventId).all()).results;
  return json({ teams: rows });
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
  const cfg = JSON.parse(ev.config_json || "{}");
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
  return json({ generated: true, feasibility: feas, rounds: sched.rounds.length, byeSpread: sched.spread });
}

async function getSchedule(env, ctx, eventId) {
  const ev = await env.DB.prepare("SELECT * FROM events WHERE id=?1 AND deleted_at IS NULL").bind(eventId).first();
  if (!ev) return json({ error: "Event not found." }, 404);
  const rows = (await env.DB.prepare(
    `SELECT m.id, m.stage, m.round, m.court, m.team_a_id, m.team_b_id, m.ref_team_id, m.points_to, m.cap, m.score_a, m.score_b
     FROM matches m WHERE m.event_id=?1 AND m.deleted_at IS NULL ORDER BY m.stage, m.round, m.court`
  ).bind(eventId).all()).results;
  const teams = (await env.DB.prepare(
    "SELECT id, name, seed FROM teams WHERE event_id=?1 AND deleted_at IS NULL"
  ).bind(eventId).all()).results;
  return json({ event: ev, matches: rows, teams, warnings: rescheduleWarnings(rows) });
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

/** 2-tap score entry: { winner: 'a'|'b', diff: N }. Winner gets points_to; loser points_to − diff. */
async function scoreMatch(request, env, ctx, matchId) {
  const mt = await env.DB.prepare("SELECT * FROM matches WHERE id=?1 AND deleted_at IS NULL").bind(matchId).first();
  if (!mt) return json({ error: "Match not found." }, 404);
  const deny = await requireStaff(env, ctx, mt.org_id);
  if (deny) return deny;
  const { winner, diff } = await request.json();
  if (!["a", "b"].includes(winner) || !(diff >= 1)) return json({ error: "Send winner ('a'|'b') and diff ≥ 1." }, 400);
  const w = mt.points_to, l = Math.max(0, mt.points_to - diff);
  const [sa, sb] = winner === "a" ? [w, l] : [l, w];
  await env.DB.prepare("UPDATE matches SET score_a=?1, score_b=?2, updated_at=datetime('now') WHERE id=?3").bind(sa, sb, matchId).run();
  await audit(env, ctx, "match.score", "matches", matchId, { winner, diff });
  await refreshStandings(env, mt.event_id, mt.org_id);
  return json({ ok: true, score_a: sa, score_b: sb });
}

async function refreshStandings(env, eventId, orgId) {
  const rows = (await env.DB.prepare(
    "SELECT team_a_id AS teamA, team_b_id AS teamB, score_a AS scoreA, score_b AS scoreB FROM matches WHERE event_id=?1 AND stage='pool' AND deleted_at IS NULL"
  ).bind(eventId).all()).results;
  const teams = (await env.DB.prepare("SELECT id FROM teams WHERE event_id=?1 AND deleted_at IS NULL").bind(eventId).all()).results.map((t) => t.id);
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

async function createBracket(request, env, ctx, eventId) {
  const ev = await env.DB.prepare("SELECT * FROM events WHERE id=?1 AND deleted_at IS NULL").bind(eventId).first();
  if (!ev) return json({ error: "Event not found." }, 404);
  const deny = await requireStaff(env, ctx, ev.org_id);
  if (deny) return deny;
  const { aSize = 8, includeRest = true } = await request.json().catch(() => ({}));
  const st = (await env.DB.prepare(
    "SELECT team_id AS team, rank FROM standings WHERE event_id=?1 AND deleted_at IS NULL ORDER BY rank"
  ).bind(eventId).all()).results;
  if (st.length < 2) return json({ error: "Standings are empty — score pool play first." }, 400);
  const brackets = buildBracket(st, { aSize, includeRest });
  const poolRounds = await env.DB.prepare(
    "SELECT MAX(round) AS r FROM matches WHERE event_id=?1 AND deleted_at IS NULL"
  ).bind(eventId).first();
  let round = (poolRounds.r || 0) + 1;
  for (const br of brackets) {
    const ins = await env.DB.prepare(
      "INSERT INTO brackets (org_id, event_id, name, split_rule, config_json) VALUES (?1,?2,?3,?4,?5)"
    ).bind(ev.org_id, eventId, br.name, `top${aSize}`, JSON.stringify({ bestOfSemisFinals: [21, 21, 15] })).run();
    let court = 1;
    for (const m of br.matches) {
      if (m.teamA == null || m.teamB == null) continue; // byes advance silently
      await env.DB.prepare(
        `INSERT INTO matches (org_id, event_id, pool_id, stage, round, court, team_a_id, team_b_id, points_to, cap, game_number)
         VALUES (?1,?2,NULL,?3,?4,?5,?6,?7,?8,?9,1)`
      ).bind(ev.org_id, eventId, m.stage, round, court++, m.teamA, m.teamB,
             m.bestOf === 3 ? 21 : 21, 23).run();
      if (court > (ev.court_count || 4)) { court = 1; round++; }
    }
    round++;
  }
  await audit(env, ctx, "bracket.create", "brackets", eventId, { aSize, includeRest });
  return json({ ok: true, brackets: brackets.map((b) => ({ name: b.name, teams: b.teams.length })) });
}

/* ---------- shared helpers (injected by index.js via ctx) ---------- */
let json, audit, isStaff, requireStaff;
export function wire(helpers) { ({ json, audit, isStaff, requireStaff } = helpers); }
