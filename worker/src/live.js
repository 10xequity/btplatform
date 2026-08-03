/**
 * Boomtown Platform — Live board (public read)
 * File: worker/src/live.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.73.0
 *
 * Owner 2026-08-03: "there needs to be 2 views, an admin view where they are created, then a display
 * view for members and public for those who are wanting to see. similar to volleyballlife."
 *
 * This is the second view. It is READ ONLY and NEEDS NO LOGIN — a parent standing by court 3 with one
 * bar of signal is not going to sign in, and a wall display cannot.
 *
 * ONE REQUEST RETURNS THE WHOLE BOARD. A display screen polls, and a screen that polls five endpoints
 * shows five different moments of the same tournament — the standings from four seconds ago beside a
 * bracket from now. One payload is one consistent picture.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *   - No player names. Team names only. A public board that lists who is on which team publishes a
 *     roster of minors to anyone who loads the page, and nobody asked for that.
 *   - No email, no phone, no notes. `teams.note` is a director's private aide-memoire ("two players
 *     have a flight at 4") and has no business on a wall.
 *   - No draft events. Only published, in progress, or completed — a draft is a plan, not news.
 *
 * The org comes from the same X-Org-Id header every other route uses, so a white-labelled site shows
 * only its own events.
 */

let json;
export function wireLive(h) { ({ json } = h); }

/** Only these are public. A draft event is somebody's unfinished thought. */
const PUBLIC_STATUS = ["published", "in_progress", "completed"];

export async function liveRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;

  /* ---- what is on ---- */
  if (p === "/api/live/events" && m === "GET") {
    const rows = (await env.DB.prepare(
      `SELECT id, name, type, starts_at, ends_at, location, status, court_count
         FROM events
        WHERE org_id=?1 AND deleted_at IS NULL AND status IN ('published','in_progress','completed')
        ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
                 starts_at DESC, id DESC
        LIMIT 40`
    ).bind(ctx.orgId).all()).results || [];
    return json({ events: rows }, 200, { "Cache-Control": "public, max-age=30" });
  }

  /* ---- the whole board for one event ---- */
  if ((x = p.match(/^\/api\/live\/events\/(\d+)$/)) && m === "GET") {
    const eventId = +x[1];
    const ev = await env.DB.prepare(
      `SELECT id, name, type, starts_at, ends_at, location, status, court_count
         FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL`
    ).bind(eventId, ctx.orgId).first();
    // A draft event answers 404 rather than 403: "you may not see this" confirms it exists, and an
    // unannounced tournament is exactly the thing not worth confirming.
    if (!ev || !PUBLIC_STATUS.includes(ev.status)) return json({ error: "No such event." }, 404);

    const divisions = (await env.DB.prepare(
      `SELECT id, name, rank, court_from, court_to FROM divisions
        WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL ORDER BY rank`
    ).bind(ctx.orgId, eventId).all()).results || [];

    const pools = (await env.DB.prepare(
      `SELECT id, name, division_id, sort_order FROM pools
        WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL ORDER BY sort_order, id`
    ).bind(ctx.orgId, eventId).all()).results || [];

    // Team names, standing and pool. Nothing about the people on them.
    const teams = (await env.DB.prepare(
      `SELECT t.id, t.name, t.pool_id, t.division_id,
              COALESCE(s.wins,0) AS wins, COALESCE(s.losses,0) AS losses,
              COALESCE(s.point_diff,0) AS point_diff, s.rank
         FROM teams t
         LEFT JOIN standings s ON s.team_id=t.id AND s.event_id=t.event_id AND s.deleted_at IS NULL
        WHERE t.org_id=?1 AND t.event_id=?2 AND t.deleted_at IS NULL
        ORDER BY COALESCE(s.rank, 9999), t.name`
    ).bind(ctx.orgId, eventId).all()).results || [];

    const matches = (await env.DB.prepare(
      `SELECT m.id, m.round, m.court, m.bracket_id, m.bracket_round, m.bracket_slot,
              m.score_a, m.score_b, m.points_to,
              ta.name AS team_a, tb.name AS team_b, tr.name AS ref_team
         FROM matches m
         LEFT JOIN teams ta ON ta.id=m.team_a_id
         LEFT JOIN teams tb ON tb.id=m.team_b_id
         LEFT JOIN teams tr ON tr.id=m.ref_team_id
        WHERE m.org_id=?1 AND m.event_id=?2 AND m.deleted_at IS NULL
        ORDER BY m.round, m.court`
    ).bind(ctx.orgId, eventId).all()).results || [];

    const brs = (await env.DB.prepare(
      `SELECT id, name FROM brackets WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL ORDER BY id`
    ).bind(ctx.orgId, eventId).all()).results || [];

    const done = (mt) => mt.score_a !== null && mt.score_b !== null && mt.score_a !== mt.score_b;
    const roundLabel = (r) => (r === 1 ? "Final" : r === 2 ? "Semi-final" : r === 3 ? "Quarter-final" : `Round of ${2 ** r}`);

    /* WHAT IS ON NOW, WHICH IS THE ONLY QUESTION MOST PEOPLE HAVE.
       "Now" is the earliest round that still has an unplayed game — not a clock. Tournaments run late,
       and a board that decided what was current from the time of day would be wrong all afternoon. */
    const poolPlay = matches.filter((mt) => !mt.bracket_id);
    const unplayed = matches.filter((mt) => !done(mt) && mt.team_a && mt.team_b);
    const currentRound = unplayed.length ? Math.min(...unplayed.map((mt) => mt.round)) : null;
    const onNow = currentRound === null ? [] : matches
      .filter((mt) => mt.round === currentRound && mt.team_a && mt.team_b)
      .sort((a, b) => a.court - b.court);
    const upNext = currentRound === null ? [] : matches
      .filter((mt) => mt.round === currentRound + 1 && mt.team_a && mt.team_b)
      .sort((a, b) => a.court - b.court);

    const inPool = (pid) => teams.filter((t) => t.pool_id === pid);
    const standingsIn = (list) => [...list].sort((a, b) =>
      b.wins - a.wins || b.point_diff - a.point_diff || a.name.localeCompare(b.name));

    const brackets = brs.map((br) => {
      const mine = matches.filter((mt) => mt.bracket_id === br.id);
      const depth = mine.reduce((n, r) => Math.max(n, r.bracket_round || 0), 0);
      const rounds = [];
      for (let r = depth; r >= 1; r--) {
        rounds.push({
          label: roundLabel(r),
          matches: mine.filter((mt) => mt.bracket_round === r).map((mt) => ({
            court: mt.court, team_a: mt.team_a, team_b: mt.team_b,
            score_a: mt.score_a, score_b: mt.score_b,
            winner: done(mt) ? (mt.score_a > mt.score_b ? mt.team_a : mt.team_b) : null,
          })),
        });
      }
      const f = mine.find((mt) => mt.bracket_round === 1);
      return {
        name: br.name, rounds,
        champion: f && done(f) ? (f.score_a > f.score_b ? f.team_a : f.team_b) : null,
      };
    });

    return json({
      event: ev,
      // "Now" and "next" first, because that is what somebody standing in a gym actually opened this for.
      on_now: onNow.map(publicMatch),
      up_next: upNext.map(publicMatch),
      current_round: currentRound,
      divisions: divisions.map((d) => ({
        ...d,
        pools: pools.filter((pl) => pl.division_id === d.id).map((pl) => ({
          id: pl.id, name: pl.name, standings: standingsIn(inPool(pl.id)).map(publicTeam),
        })),
        // Teams in the division but not yet in a pool still have to appear, or somebody looks for
        // their team and concludes the board is broken.
        unpooled: teams.filter((t) => t.division_id === d.id && !t.pool_id).map(publicTeam),
      })),
      loose_pools: pools.filter((pl) => !pl.division_id).map((pl) => ({
        id: pl.id, name: pl.name, standings: standingsIn(inPool(pl.id)).map(publicTeam),
      })),
      // A flat table too: small events never set up divisions at all, and would otherwise show nothing.
      overall: standingsIn(teams).map(publicTeam),
      brackets,
      results: poolPlay.filter(done).length,
      total_games: matches.filter((mt) => mt.team_a && mt.team_b).length,
      // Short cache: a scoreboard 20 seconds stale is fine, and it stops a wall display from
      // hammering the database all day.
    }, 200, { "Cache-Control": "public, max-age=20" });
  }

  return null;
}

const publicTeam = (t) => ({
  name: t.name, wins: t.wins, losses: t.losses, point_diff: t.point_diff, rank: t.rank,
});

const publicMatch = (mt) => ({
  court: mt.court, round: mt.round,
  team_a: mt.team_a, team_b: mt.team_b,
  score_a: mt.score_a, score_b: mt.score_b, points_to: mt.points_to,
  ref_team: mt.ref_team,
  stage: mt.bracket_id
    ? (mt.bracket_round === 1 ? "Final" : mt.bracket_round === 2 ? "Semi-final"
      : mt.bracket_round === 3 ? "Quarter-final" : `Round of ${2 ** mt.bracket_round}`)
    : "Pool",
});
