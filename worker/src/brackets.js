/**
 * Boomtown Platform — Playable brackets
 * File: worker/src/brackets.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.66.0
 *
 * WHAT WAS ALREADY HERE, AND WHY IT WASN'T ENOUGH. `scheduler.buildBracket` seeded a first round
 * and `tournaments.createBracket` wrote those games into `matches`. Semis and finals were never
 * generated, no winner ever moved anywhere, and the bracket row and its games were not even linked.
 * A director could see the first round and then had to run the rest on paper. That is failure
 * class 1 — built, and not actually usable — and this module is the fix, not a second opinion.
 *
 * BYES, NOT PIGTAILS. Owner, 2026-08-03: "we try to avoid pigtails as often as possible with too
 * many people waiting." When the field is not a power of two you either give the top seeds a bye or
 * you play extra play-in games. Play-ins mean the other fourteen teams stand around watching two of
 * them, which is the exact complaint. So: standard seeding, byes to the top seeds, no play-ins ever.
 * Standard seeding does this on its own — position pairs are (i, size+1-i), so the missing high
 * numbers always fall opposite the best teams.
 *
 * ROUNDS COUNT BACKWARDS FROM THE FINAL. `bracket_round` 1 = final, 2 = semi, 3 = quarter,
 * 4 = round of 16. Numbering forwards would mean "round 1" changes meaning the moment a bracket
 * grows from eight teams to sixteen, and every stored row would silently be about a different game.
 * `matches.stage` stays as the coarse legacy label (clamped at 'quarter') because widening its
 * CHECK needs a non-additive table rebuild — see migration 0037. `bracket_round` is authoritative.
 *
 * ADVANCEMENT IS RECOMPUTED FROM SCORES, NEVER ACCUMULATED. `advanceBracket` derives the whole tree
 * from the scores currently on the table every time it runs. That makes it idempotent, and it makes
 * a corrected score self-healing: fix a quarter-final that was typed in backwards and the semi it
 * feeds is corrected on the next run. An implementation that pushed a winner forward once, at score
 * time, would leave the wrong team in the semi forever and the fix would be a manual edit.
 */
import { bracketOrder } from "./scheduler.js";

/* ---------------- pure engine ---------------- */

/** 1 = final, 2 = semi, 3 = quarter, 4+ = earlier. `stage` has no legal value past 'quarter'. */
export function stageForRound(bracketRound) {
  return bracketRound === 1 ? "final" : bracketRound === 2 ? "semi" : "quarter";
}

/**
 * Where the winner of (round, slot) goes. Derived, never stored — a stored feeds_match_id would be
 * a second copy of a fact arithmetic already gives, and a second copy can drift out of step.
 */
export function feedsInto(bracketRound, slot) {
  if (bracketRound <= 1) return null;                       // the final feeds nothing
  return { round: bracketRound - 1, slot: Math.ceil(slot / 2), side: slot % 2 === 1 ? "a" : "b" };
}

/**
 * Build a single-elimination tree for `n` teams given in seed order (1 = best).
 *
 * Returns every match that will actually be PLAYED. Bye matches are not returned at all — a bye is
 * not a game, and creating a row for it would put a phantom fixture on the court grid and in the
 * schedule editor. The team with the bye is placed straight into the next round instead.
 *
 * Invariant worth knowing: a single-elimination bracket with n teams always has exactly n-1
 * matches, because every match eliminates exactly one team and all but the winner are eliminated.
 */
export function buildTree(n) {
  if (!Number.isInteger(n) || n < 2) {
    return { ok: false, error: "A bracket needs at least two teams." };
  }
  const size = 2 ** Math.ceil(Math.log2(n));
  const depth = Math.log2(size);                 // number of rounds; also the first bracket_round
  const order = bracketOrder(size);              // seed numbers in bracket position order
  const byes = size - n;

  // Positions hold a seed number, or null for "whoever wins the feeding match".
  const placed = new Map();                      // "round:slot:side" -> seed
  const matches = [];

  for (let i = 0; i < size / 2; i++) {
    const slot = i + 1;
    const sa = order[2 * i], sb = order[2 * i + 1];
    const aIn = sa <= n, bIn = sb <= n;

    if (aIn && bIn) {
      matches.push({ round: depth, slot, a: sa, b: sb });
      continue;
    }
    // Standard seeding pairs (i, size+1-i) with i <= size/2 < n, so the low seed of a pair is
    // always a real team and both sides can never be absent. Assert it rather than assume it.
    if (!aIn && !bIn) {
      return { ok: false, error: "Bracket seeding produced an empty match — refusing to generate." };
    }
    const through = aIn ? sa : sb;
    const to = feedsInto(depth, slot);
    placed.set(`${to.round}:${to.slot}:${to.side}`, through);
  }

  // Every later round exists from the start, so the director can see the shape of the day before a
  // single ball is served — and so a bye team has a real fixture to be placed into.
  for (let r = depth - 1; r >= 1; r--) {
    for (let slot = 1; slot <= 2 ** (r - 1); slot++) {
      matches.push({
        round: r,
        slot,
        a: placed.get(`${r}:${slot}:a`) ?? null,
        b: placed.get(`${r}:${slot}:b`) ?? null,
      });
    }
  }

  matches.sort((x, y) => y.round - x.round || x.slot - y.slot);
  return { ok: true, size, depth, byes, teams: n, matches };
}

/**
 * Who won, by score. Returns "a", "b", or null when it has not been played or is tied.
 * A tie is not a winner: volleyball plays to a two-point margin, so an equal score means the game
 * is unfinished or mis-typed, and guessing would put the wrong team in the next round.
 */
export function winnerOf(scoreA, scoreB) {
  if (scoreA === null || scoreB === null || scoreA === undefined || scoreB === undefined) return null;
  if (scoreA === scoreB) return null;
  return scoreA > scoreB ? "a" : "b";
}

/**
 * Given the bracket's matches (each {round, slot, team_a_id, team_b_id, score_a, score_b}), work out
 * what every later-round slot SHOULD hold. Returns only the slots whose current occupant is wrong.
 *
 * Pure, so the same function answers "what would change" for a preview and "what to write" for the
 * real thing. Highest round first, so a winner can move two rounds in one pass.
 */
export function pendingAdvances(matches) {
  const byKey = new Map(matches.map((m) => [`${m.bracket_round}:${m.bracket_slot}`, m]));
  const rounds = [...new Set(matches.map((m) => m.bracket_round))].sort((a, b) => b - a);
  const changes = [];

  for (const r of rounds) {
    if (r <= 1) continue;
    for (const m of matches.filter((x) => x.bracket_round === r)) {
      const side = winnerOf(m.score_a, m.score_b);
      if (!side) continue;
      const teamId = side === "a" ? m.team_a_id : m.team_b_id;
      if (!teamId) continue;
      const to = feedsInto(r, m.bracket_slot);
      const next = byKey.get(`${to.round}:${to.slot}`);
      if (!next) continue;
      const current = to.side === "a" ? next.team_a_id : next.team_b_id;
      if (current === teamId) continue;                     // already correct — idempotent

      changes.push({
        match_id: next.id,
        round: to.round,
        slot: to.slot,
        side: to.side,
        team_id: teamId,
        from_match_id: m.id,
        replaced_team_id: current || null,
        // Changing the teams in a game that already has a score means someone corrected an earlier
        // result after this one was played. It is allowed — the score is the truth — but it is
        // never silent, because a human has to go and re-decide what that later game meant.
        disturbs_played_match: next.score_a !== null && next.score_b !== null,
      });
      // Keep the in-memory copy current so the same pass can carry a winner further up the tree.
      if (to.side === "a") next.team_a_id = teamId; else next.team_b_id = teamId;
    }
  }
  return changes;
}

/* ---------------- applying advances ---------------- */

/**
 * Move every winner to where it belongs, and report what moved.
 *
 * ONE definition of "apply the advances", called from three places: the explicit advance route, and
 * both score-write paths (staff at the desk, captain on their phone). The owner asked for brackets
 * that advance on their own; wiring that up by copying this loop into each caller would give three
 * copies to keep in step, and the one that drifts would be found on a Saturday.
 *
 * Safe to call on an event with no bracket — pool-only events hit this on every score.
 */
export async function advanceBracketFor(env, orgId, eventId) {
  const rows = (await env.DB.prepare(
    `SELECT id, bracket_id, bracket_round, bracket_slot, team_a_id, team_b_id, score_a, score_b
       FROM matches WHERE org_id=?1 AND event_id=?2 AND bracket_id IS NOT NULL AND deleted_at IS NULL
      ORDER BY bracket_id, bracket_round DESC, bracket_slot`
  ).bind(orgId, eventId).all()).results || [];
  if (!rows.length) return { hasBracket: false, advanced: 0, disturbed: 0, changes: [] };

  const changes = [];
  for (const bid of [...new Set(rows.map((r) => r.bracket_id))]) {
    changes.push(...pendingAdvances(rows.filter((r) => r.bracket_id === bid)));
  }
  for (const c of changes) {
    const col = c.side === "a" ? "team_a_id" : "team_b_id";
    await env.DB.prepare(
      `UPDATE matches SET ${col}=?1, updated_at=datetime('now') WHERE id=?2 AND org_id=?3`
    ).bind(c.team_id, c.match_id, orgId).run();
  }
  return {
    hasBracket: true,
    advanced: changes.length,
    disturbed: changes.filter((c) => c.disturbs_played_match).length,
    changes,
  };
}

/* ---------------- routes ---------------- */

let json, requireStaff, audit;
export function wireBrackets(h) { ({ json, requireStaff, audit } = h); }

/** Read the seed order for an event: explicit list, else pool standings, else the teams' own seeds. */
async function seedOrder(env, ctx, eventId, explicit) {
  const teams = (await env.DB.prepare(
    `SELECT id, name, seed FROM teams WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL`
  ).bind(ctx.orgId, eventId).all()).results || [];
  const known = new Map(teams.map((t) => [t.id, t]));

  if (Array.isArray(explicit) && explicit.length) {
    const picked = explicit.map(Number).filter((id) => known.has(id));
    if (picked.length !== explicit.length) return { error: "One of those teams isn't in this event." };
    return { source: "chosen by hand", ids: picked, names: known };
  }

  const standings = (await env.DB.prepare(
    `SELECT team_id AS id FROM standings
      WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL ORDER BY rank`
  ).bind(ctx.orgId, eventId).all()).results || [];
  const ranked = standings.map((r) => r.id).filter((id) => known.has(id));
  if (ranked.length >= 2) return { source: "pool finish", ids: ranked, names: known };

  // No pool played yet — fall back to entry seeds so a bracket-only event still works.
  const bySeed = [...teams].sort((a, b) => (a.seed ?? 9999) - (b.seed ?? 9999) || a.id - b.id);
  return { source: "entry seed", ids: bySeed.map((t) => t.id), names: known };
}

/**
 * Draw the bracket(s) for an event and write them into `matches`.
 *
 * Separated from the route so the sandbox test-data generator can build its demo bracket through
 * exactly this code rather than through hand-written SQL. Test data assembled by a second, parallel
 * implementation is test data that can pass while the real thing is broken — which is the only way
 * a fixture can actively lie to you.
 *
 * Returns `{ ok:false, error, status }` on refusal; the caller owns the HTTP shape.
 */
export async function generateBracketFor(env, ctx, eventId, b = {}) {
  const ev = await env.DB.prepare(
    "SELECT id, name, court_count FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(eventId, ctx.orgId).first();
  if (!ev) return { ok: false, error: "That event doesn't exist.", status: 404 };

  const seeds = await seedOrder(env, ctx, eventId, b.seeds);
  if (seeds.error) return { ok: false, error: seeds.error, status: 400 };
  if (seeds.ids.length < 2) {
    return { ok: false, error: "Add the teams first — there is nothing to bracket yet.", status: 409 };
  }

  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM matches
      WHERE org_id=?1 AND event_id=?2 AND bracket_id IS NOT NULL AND deleted_at IS NULL`
  ).bind(ctx.orgId, eventId).first();
  if (existing.n > 0 && !b.replace) {
    return {
      ok: false, status: 409,
      error: ev.name + " already has a bracket with " + existing.n + " games. Generating again would put a second bracket on top of the first.",
      existing_matches: existing.n,
      hint: "Send replace: true to set the current bracket aside and use this one instead.",
    };
  }
  let replaced = 0;
  if (existing.n > 0 && b.replace) {
    const del = await env.DB.prepare(
      `UPDATE matches SET deleted_at=datetime('now')
        WHERE org_id=?1 AND event_id=?2 AND bracket_id IS NOT NULL AND deleted_at IS NULL`
    ).bind(ctx.orgId, eventId).run();
    replaced = del.meta.changes;
    await env.DB.prepare(
      "UPDATE brackets SET deleted_at=datetime('now') WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, eventId).run();
  }

  // "Top X into A, everyone else into BB." Splitting is what keeps a 16-team day meaningful for
  // the teams that finished tenth — one bracket means half the field plays once and goes home.
  const aSize = Number(b.a_size) > 0 ? Math.min(Number(b.a_size), seeds.ids.length) : seeds.ids.length;
  const includeRest = b.include_rest !== false;
  const groups = [{ name: "A", ids: seeds.ids.slice(0, aSize) }];
  if (includeRest && seeds.ids.length > aSize) {
    const rest = seeds.ids.slice(aSize);
    if (rest.length >= 2) groups.push({ name: "BB", ids: rest });
  }

  const pointsTo = Number(b.points_to) > 0 ? Number(b.points_to) : 25;
  const cap = Number(b.cap) > 0 ? Number(b.cap) : pointsTo + 2;
  const courts = Number(b.courts) > 0 ? Number(b.courts) : (ev.court_count || 4);

  const poolMax = await env.DB.prepare(
    `SELECT COALESCE(MAX(round), 0) AS r FROM matches
      WHERE org_id=?1 AND event_id=?2 AND bracket_id IS NULL AND deleted_at IS NULL`
  ).bind(ctx.orgId, eventId).first();

  const built = [];
  let written = 0;
  for (const g of groups) {
    const tree = buildTree(g.ids.length);
    if (!tree.ok) return { ok: false, error: tree.error, status: 400 };

    const ins = await env.DB.prepare(
      "INSERT INTO brackets (org_id, event_id, name, split_rule, config_json) VALUES (?1,?2,?3,?4,?5)"
    ).bind(ctx.orgId, eventId, g.name, aSize < seeds.ids.length ? `top${aSize}` : "all",
           JSON.stringify({ seeded_by: seeds.source, seeds: g.ids, points_to: pointsTo })).run();
    const bracketId = ins.meta.last_row_id;

    // Bracket rounds continue the schedule's round numbering, so the existing court grid and the
    // drag-and-drop editor show pool play and the bracket as one continuous day.
    for (const mt of tree.matches) {
      const scheduleRound = poolMax.r + (tree.depth - mt.round + 1);
      const court = ((mt.slot - 1) % courts) + 1;
      await env.DB.prepare(
        `INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id,
                              points_to, cap, game_number, bracket_id, bracket_round, bracket_slot)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10,?11,?12)`
      ).bind(ctx.orgId, eventId, stageForRound(mt.round), scheduleRound, court,
             mt.a ? g.ids[mt.a - 1] : null, mt.b ? g.ids[mt.b - 1] : null,
             pointsTo, cap, bracketId, mt.round, mt.slot).run();
      written++;
    }
    built.push({
      id: bracketId, name: g.name, teams: g.ids.length,
      size: tree.size, rounds: tree.depth, byes: tree.byes, matches: tree.matches.length,
    });
  }

  return { ok: true, event: ev.name, seededBy: seeds.source, built, written, replaced };
}

export async function bracketRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;
  let x;

  /* ---- generate ---- */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/brackets$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));

    const g = await generateBracketFor(env, ctx, eventId, b);
    if (!g.ok) {
      const body = { error: g.error };
      if (g.existing_matches !== undefined) { body.existing_matches = g.existing_matches; body.hint = g.hint; }
      return json(body, g.status || 400);
    }
    const { built, written, replaced } = g;

    await audit(env, ctx, "bracket.generate", "events", eventId,
      { brackets: built.map((x2) => x2.name), matches: written, replaced, seeded_by: g.seededBy });

    return json({
      ok: true,
      event: g.event,
      seeded_by: g.seededBy,
      brackets: built,
      matches_written: written,
      matches_replaced: replaced,
      summary: built.map((x2) =>
        `${x2.name}: ${x2.teams} team${x2.teams === 1 ? "" : "s"}, ${x2.matches} game${x2.matches === 1 ? "" : "s"}` +
        (x2.byes ? `, ${x2.byes} bye${x2.byes === 1 ? "" : "s"} to the top seed${x2.byes === 1 ? "" : "s"} — no play-in games` : ", no byes")),
    });
  }

  /* ---- read ---- */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/brackets$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const loaded = await loadBrackets(env, ctx, +x[1]);
    if (loaded.error) return json({ error: loaded.error }, loaded.status || 404);
    return json(loaded);
  }

  /* ---- advance ----
     Separate from score entry on purpose. Recomputing the whole tree from the scores on the table
     is idempotent and self-healing; pushing a winner forward once, at the moment a score is typed,
     leaves the wrong team in the semi forever when that score is later corrected. */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/brackets\/advance$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];

    const r = await advanceBracketFor(env, ctx.orgId, eventId);
    if (!r.hasBracket) return json({ error: "This event has no bracket yet." }, 404);
    if (r.advanced) {
      await audit(env, ctx, "bracket.advance", "events", eventId,
        { moved: r.advanced, disturbed: r.disturbed });
    }

    const loaded = await loadBrackets(env, ctx, eventId);
    return json({
      ok: true,
      advanced: r.advanced,
      disturbed: r.disturbed,
      note: r.advanced === 0
        ? "Nothing to move — every finished game already points at the right next game."
        : `Moved ${r.advanced} winner${r.advanced === 1 ? "" : "s"} forward.` +
          (r.disturbed ? ` ${r.disturbed} later game${r.disturbed === 1 ? " already had a score and its teams changed" : "s already had scores and their teams changed"} — check those.` : ""),
      ...loaded,
    });
  }

  /* ---- manual override of a single bracket slot ----
     Owner 2026-08-03: "brackets should auto populate but can be overrided with drag and drop or type
     entry ... teams might forfeit so we can replace them in the bracket. additionally, this allows us
     to move teams from other pools down as needed or around as desired." And: "The assignment of
     bracket will be dependent on the admin running it, and reviewing the scores of the game. many
     people quit at this point too, so we want to have flexibility to modify."

     So the seeding is a starting point and this is the escape hatch. It accepts ANY team in the event,
     including one from another pool or another division, because on the day that is exactly what has
     to happen — three teams have gone home and the bracket still has to be played. */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/brackets\/slot$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const matchId = Number(b.match_id);
    const side = b.side === "a" || b.side === "b" ? b.side : null;
    if (!matchId || !side) return json({ error: "Say which game and which side." }, 400);

    const mt = await env.DB.prepare(
      `SELECT id, bracket_id, bracket_round, bracket_slot, team_a_id, team_b_id, score_a, score_b
         FROM matches WHERE id=?1 AND org_id=?2 AND event_id=?3 AND deleted_at IS NULL`
    ).bind(matchId, ctx.orgId, eventId).first();
    if (!mt) return json({ error: "That game isn't part of this event." }, 404);
    if (!mt.bracket_id) return json({ error: "That game is pool play, not a bracket game." }, 400);

    // null clears the slot — the way to undo a mistake without inventing a placeholder team.
    let teamId = b.team_id == null || b.team_id === "" ? null : Number(b.team_id);
    if (teamId) {
      const ok = await env.DB.prepare(
        "SELECT id FROM teams WHERE id=?1 AND org_id=?2 AND event_id=?3 AND deleted_at IS NULL"
      ).bind(teamId, ctx.orgId, eventId).first();
      if (!ok) return json({ error: "That team isn't in this event." }, 400);
      const other = side === "a" ? mt.team_b_id : mt.team_a_id;
      if (other && other === teamId) return json({ error: "A team can't play itself." }, 400);
    }

    await env.DB.prepare(
      `UPDATE matches SET ${side === "a" ? "team_a_id" : "team_b_id"}=?1, updated_at=datetime('now')
        WHERE id=?2 AND org_id=?3`
    ).bind(teamId, matchId, ctx.orgId).run();
    await audit(env, ctx, "bracket.slot", "matches", matchId, { side, team_id: teamId });

    // A hand-placed team must NOT be undone by the next advance pass. `advanceBracketFor` derives
    // everything from scores, so it would happily overwrite this slot the moment the feeding game is
    // scored — which is correct for an untouched bracket and wrong for one a director has edited. The
    // warning is explicit rather than silent, because the alternative is a change that reverts itself
    // and looks like the software losing the edit.
    const feeder = await env.DB.prepare(
      `SELECT id, score_a, score_b FROM matches
        WHERE org_id=?1 AND event_id=?2 AND bracket_id=?3 AND bracket_round=?4 AND bracket_slot=?5
          AND deleted_at IS NULL`
    ).bind(ctx.orgId, eventId, mt.bracket_id, mt.bracket_round + 1,
           side === "a" ? mt.bracket_slot * 2 - 1 : mt.bracket_slot * 2).first();
    const fragile = !!(feeder && feeder.score_a === null);

    const loaded = await loadBrackets(env, ctx, eventId);
    return json({
      ok: true,
      note: teamId
        ? "Placed." + (fragile ? " Note: the game that feeds this slot has not been played yet, so scoring it will replace this team with its winner." : "")
        : "Slot cleared.",
      overwritten_by_advance_risk: fragile,
      ...loaded,
    });
  }

  /* ---- forfeit ----
     A team that has gone home is not a slot to be emptied — it is a result. Recording it as a score
     means the bracket advances on its own and the other team is not left waiting for a game that will
     never be played. Replacing the team instead is also supported (the slot route above); which one
     is right depends on whether somebody is available to take their place. */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/brackets\/forfeit$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const matchId = Number(b.match_id);
    const side = b.side === "a" || b.side === "b" ? b.side : null;
    if (!matchId || !side) return json({ error: "Say which game, and which team forfeited." }, 400);

    const mt = await env.DB.prepare(
      `SELECT id, bracket_id, team_a_id, team_b_id, points_to FROM matches
        WHERE id=?1 AND org_id=?2 AND event_id=?3 AND deleted_at IS NULL`
    ).bind(matchId, ctx.orgId, eventId).first();
    if (!mt) return json({ error: "That game isn't part of this event." }, 404);
    if (!mt.bracket_id) return json({ error: "That game is pool play, not a bracket game." }, 400);
    const winnerSide = side === "a" ? "b" : "a";
    if (!(winnerSide === "a" ? mt.team_a_id : mt.team_b_id)) {
      return json({ error: "There is no opponent in that game yet, so nobody can win it." }, 409);
    }

    // A forfeit is the full game to nil. Any other number would be inventing a scoreline nobody played.
    const pts = mt.points_to || 25;
    const [sa, sb] = winnerSide === "a" ? [pts, 0] : [0, pts];
    await env.DB.prepare(
      "UPDATE matches SET score_a=?1, score_b=?2, updated_at=datetime('now') WHERE id=?3 AND org_id=?4"
    ).bind(sa, sb, matchId, ctx.orgId).run();
    await audit(env, ctx, "bracket.forfeit", "matches", matchId, { forfeited_side: side, score: `${sa}-${sb}` });

    const adv = await advanceBracketFor(env, ctx.orgId, eventId);
    const loaded = await loadBrackets(env, ctx, eventId);
    return json({
      ok: true,
      note: `Recorded as ${sa}–${sb}. ` + (adv.advanced
        ? `The other team moves on.`
        : `Nothing to advance yet.`),
      ...loaded,
    });
  }

  return null;
}

/**
 * Read every bracket on an event as a tree the page can draw. Names, not ids, and an explicit
 * "waiting on" label for a slot whose feeding game has not finished — an empty box tells a director
 * nothing, and "winner of QF2" tells them everything.
 */
async function loadBrackets(env, ctx, eventId) {
  const ev = await env.DB.prepare(
    "SELECT id, name FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(eventId, ctx.orgId).first();
  if (!ev) return { error: "That event doesn't exist.", status: 404 };

  const brs = (await env.DB.prepare(
    `SELECT id, name, split_rule, config_json FROM brackets
      WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL ORDER BY id`
  ).bind(ctx.orgId, eventId).all()).results || [];

  // The pool a team came out of travels with it. Owner 2026-08-03: "Please list the pool they were
  // from in their tile." When a team forfeits and somebody has to be pulled in to replace them, the
  // only question that matters is where they came from — a name alone does not answer it, and
  // "Pool B, 2nd" is the difference between a defensible substitution and a guess.
  const rows = (await env.DB.prepare(
    `SELECT m.id, m.bracket_id, m.bracket_round, m.bracket_slot, m.round, m.court,
            m.team_a_id, m.team_b_id, m.score_a, m.score_b, m.points_to,
            ta.name AS team_a, tb.name AS team_b,
            pa.name AS pool_a, pb.name AS pool_b,
            sa.rank AS rank_a, sb.rank AS rank_b
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       LEFT JOIN pools pa ON pa.id = ta.pool_id AND pa.deleted_at IS NULL
       LEFT JOIN pools pb ON pb.id = tb.pool_id AND pb.deleted_at IS NULL
       LEFT JOIN standings sa ON sa.team_id = ta.id AND sa.event_id = m.event_id AND sa.deleted_at IS NULL
       LEFT JOIN standings sb ON sb.team_id = tb.id AND sb.event_id = m.event_id AND sb.deleted_at IS NULL
      WHERE m.org_id=?1 AND m.event_id=?2 AND m.bracket_id IS NOT NULL AND m.deleted_at IS NULL
      ORDER BY m.bracket_id, m.bracket_round DESC, m.bracket_slot`
  ).bind(ctx.orgId, eventId).all()).results || [];

  const label = (r) => (r === 1 ? "Final" : r === 2 ? "Semi-final" : r === 3 ? "Quarter-final" : `Round of ${2 ** r}`);

  const brackets = brs.map((br) => {
    const mine = rows.filter((r) => r.bracket_id === br.id);
    const depth = mine.reduce((n, r) => Math.max(n, r.bracket_round), 0);
    const rounds = [];
    for (let r = depth; r >= 1; r--) {
      rounds.push({
        bracket_round: r,
        label: label(r),
        matches: mine.filter((x) => x.bracket_round === r).map((x) => {
          const w = winnerOf(x.score_a, x.score_b);
          return {
            id: x.id, slot: x.bracket_slot, round: x.round, court: x.court,
            team_a: x.team_a, team_b: x.team_b,
            team_a_id: x.team_a_id, team_b_id: x.team_b_id,
            // Where each team came from, for the substitution decision.
            pool_a: x.pool_a, pool_b: x.pool_b,
            rank_a: x.rank_a, rank_b: x.rank_b,
            score_a: x.score_a, score_b: x.score_b, points_to: x.points_to,
            winner: w ? (w === "a" ? x.team_a : x.team_b) : null,
            // Which game each empty side is waiting on, said out loud.
            waiting_a: x.team_a_id ? null : feederLabel(r, x.bracket_slot, "a", label),
            waiting_b: x.team_b_id ? null : feederLabel(r, x.bracket_slot, "b", label),
          };
        }),
      });
    }
    let config = {};
    try { config = JSON.parse(br.config_json || "{}"); } catch { config = {}; }
    const played = mine.filter((x) => winnerOf(x.score_a, x.score_b)).length;
    const champion = (() => {
      const f = mine.find((x) => x.bracket_round === 1);
      if (!f) return null;
      const w = winnerOf(f.score_a, f.score_b);
      return w ? (w === "a" ? f.team_a : f.team_b) : null;
    })();
    return {
      id: br.id, name: br.name, split_rule: br.split_rule, seeded_by: config.seeded_by || null,
      rounds, total: mine.length, played, champion,
    };
  });

  // Every team in the event, with where they finished — the bench a director substitutes from.
  // ALL of them, not just the unplaced ones: pulling a team from another pool or another division is
  // exactly the move the owner described, and filtering the list would hide the option.
  const bench = (await env.DB.prepare(
    `SELECT t.id, t.name, t.note, p.name AS pool,
            COALESCE(s.wins,0) AS wins, COALESCE(s.losses,0) AS losses, s.rank
       FROM teams t
       LEFT JOIN pools p ON p.id = t.pool_id AND p.deleted_at IS NULL
       LEFT JOIN standings s ON s.team_id = t.id AND s.event_id = t.event_id AND s.deleted_at IS NULL
      WHERE t.org_id=?1 AND t.event_id=?2 AND t.deleted_at IS NULL
      ORDER BY COALESCE(s.rank, 9999), t.name`
  ).bind(ctx.orgId, eventId).all()).results || [];

  const inBracket = new Set(rows.flatMap((r) => [r.team_a_id, r.team_b_id]).filter(Boolean));
  return {
    event: { id: ev.id, name: ev.name },
    brackets,
    bench: bench.map((t) => ({ ...t, in_bracket: inBracket.has(t.id) })),
  };
}

/** "Winner of Quarter-final 2" — the game an empty slot is waiting on. */
function feederLabel(round, slot, side, label) {
  const fromRound = round + 1;
  const fromSlot = side === "a" ? slot * 2 - 1 : slot * 2;
  return `Winner of ${label(fromRound)} ${fromSlot}`;
}
