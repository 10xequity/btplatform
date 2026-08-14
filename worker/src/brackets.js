/**
 * Boomtown Platform — Playable brackets
 * File: worker/src/brackets.js · Version: v1.1 · Date: 2026-08-11 · Ships in: v0.66.0 · v1.1 in v0.134.0
 *
 * v1.1 (2026-08-11, v0.134.0): WF-2 — only ACTIVE brackets reach the board, and generation
 *   self-heals its own debris. Bracket rows are INSERTed before their matches with no
 *   transaction, so a failed attempt strands live matchless rows (production carried 11);
 *   loadBrackets now requires live matches, and generateBracketFor soft-deletes matchless rows
 *   on its write path (a refused 409 stays write-free). Guarded by bracket_active.test.mjs.
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
import { personName, CAPTAIN_JOIN, CAPTAIN_COLS } from "./names.js"; // v0.74.0 — one name rule
import { courtsFor, allocate, slotsFrom, conflicts } from "./courts.js"; // v0.78.0 — fixed ranges, real times
import { MIN_GAMES_PER_TEAM, MAX_GAMES_PER_TEAM } from "./formats.js"; // v0.109.0 / v0.150.0 — ONE definition of the owner's floor AND ceiling

/**
 * A best-of-3 match is worth 2.25 games. Owner, 2026-08-08: "Game matches (best of 3) are
 * considered 2.25 (since there's a 25% chance of it going to 3 games)."
 *
 * The quarter is not a rounding artefact and must not be rounded away — it is exactly the quantity
 * that decides whether a six-game pool reaches the eight-game floor. 6 + 2.25 clears it; 6 + 2 does
 * not, and 6 + 1 is not close.
 */
export const BEST_OF_3_GAMES = 2.25;

/**
 * The games a team is GUARANTEED, which is the number the owner's rule is about.
 *
 * Guaranteed, not expected: a bracket's winner plays every round, but the team that loses its first
 * match plays exactly one. The floor has to hold for that team, so this counts one bracket match —
 * and only if the team is in a bracket at all. A team left out of the draw gets nothing, which is
 * the whole reason "break everyone" is the answer to a short pool rather than "cut to a top 8".
 */
export function guaranteedGames(poolGames, everyoneBreaks, bestOf) {
  const perMatch = Number(bestOf) === 3 ? BEST_OF_3_GAMES : 1;
  return poolGames + (everyoneBreaks ? perMatch : 0);
}

/* ==================== THE STANDARD TOURNAMENT TEMPLATE ====================
   Owner, 2026-08-08, verbatim: "generally in a standard tournament template - we would aim to run 8
   games in pool play, break everyone then best of 3 matches quarters to finals. Usually though, we
   have 9-10 ROUNDS (not games) so we hit the 8 but ten due to time, we do 1 game quater finals to 25,
   then 2 mathes best of 3 for semi and finals. This way the max games players are playing are
   approximately 12-16. More than 16 become physically unplayable."

   ROUNDS ARE NOT GAMES, and the owner said so explicitly. Nine or ten ROUNDS give eight GAMES each,
   because a bye is a round in which a team does not play. `formats.js` has always computed
   gamesPerTeam as 2CR/N rather than R; this comment exists so the distinction survives into the
   wording of anything built on top. */

/* Sixteen games is the wall. A planner that knows only a floor will happily recommend past it.
   The constant moved to formats.js in v0.150.0 (T2-4) so the options route can judge both bounds
   from one home — imported below, exactly as the floor has been since v0.109.0. */

/** Owner, 2026-08-08: "each match taking 20 minutes, Each 15 pt takes 15 minutes (3rd game)." */
export const MINUTES_PER_MATCH = 20;
export const MINUTES_THIRD_GAME = 15;

/**
 * Best-of-3 from this bracket round DOWN to the final. `bracket_round` counts backwards (1 = final,
 * 2 = semi, 3 = quarter), so 2 means "semi and final are best-of-3, quarters and earlier are one
 * game to 25" — which is the owner's template stated exactly, with no arithmetic in between.
 */
export const BEST_OF_3_FROM_ROUND = 2;

/** Games a team plays in one match of the given round, under the template. */
export function gamesForRound(round, bestOfFrom = BEST_OF_3_FROM_ROUND) {
  return round <= bestOfFrom ? BEST_OF_3_GAMES : 1;
}

/**
 * Expected minutes for one match of the given round.
 *
 * DERIVED FROM THE SAME ASSUMPTION AS THE GAME COUNT, ON PURPOSE. A best-of-3 is two games plus a
 * third a quarter of the time — that quarter is why a match counts 2.25 games, and it is the same
 * quarter here: 20 + 0.25 x 15 = 23.75. A separate minutes constant would let the two halves of the
 * same estimate drift apart and start contradicting each other on the same screen.
 */
export function minutesForRound(round, bestOfFrom = BEST_OF_3_FROM_ROUND) {
  const thirdGameChance = BEST_OF_3_GAMES - 2;
  return round <= bestOfFrom
    ? MINUTES_PER_MATCH + thirdGameChance * MINUTES_THIRD_GAME
    : MINUTES_PER_MATCH;
}

/**
 * What a bracket of the given DEPTH costs a team in games.
 *
 * `guaranteed` is the first round played — the team knocked out immediately. `max` is the team that
 * wins it, summing every round down to the final. For the owner's worked example (8 pool games, an
 * eight-team bracket) that is 8 + 1 + 2.25 + 2.25 = 13.5, inside the stated 12-16 band.
 */
export function bracketGames(depth, bestOfFrom = BEST_OF_3_FROM_ROUND) {
  let max = 0;
  for (let r = depth; r >= 1; r--) max += gamesForRound(r, bestOfFrom);
  return { guaranteed: gamesForRound(depth, bestOfFrom), max };
}

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
 * T2-5 (v0.124.0) — ROUND ONE MUST NOT REPEAT POOL PLAY.
 *
 * Owner: "aim to have the system have opponents be from separate pools but still in bracket.
 * Example in 2 pools of 4 teams, #1 A plays #4 B."
 *
 * `buildTree` pairs SEED NUMBERS (1vN, 2vN-1 …) and never sees a team, so the only lever on who
 * meets whom is the ORDER of the id list handed to it. Ranking straight down the pool finish puts
 * a pool's best and worst at opposite ends of that list — which is exactly where standard seeding
 * pairs them, so the naive order maximises rematches instead of avoiding them.
 *
 * The fix is a round-robin deal: take each pool's next-best team in turn (A1, B1, C1, A2, B2, …).
 * Standard seeding then pairs position i with position n+1-i, which land in different pools
 * whenever the arithmetic allows it.
 *
 * TWO INVARIANTS THIS MUST NOT BREAK, both pinned in cross_pool_seeding.test.mjs:
 *  - It is a TOTAL mapping. Every team in, exactly once out. A reorder that quietly dropped a team
 *    would satisfy "no same-pool pair" trivially, which is how such a bug would hide.
 *  - Within a pool, finishing order survives. A team that finished below a poolmate is never
 *    seeded above it — the deal takes them in rank order, so this holds by construction.
 *
 * NO-OP WITHOUT POOLS. One pool, or none, returns the input untouched: every bracket already drawn
 * came out of the rank order, and reordering them on the next regenerate would silently redraw a
 * live day's schedule.
 */
export function crossPoolOrder(ids, poolOf) {
  if (!Array.isArray(ids) || ids.length < 3) return Array.isArray(ids) ? [...ids] : [];

  // Buckets in finishing order, so each pool's own ranking is preserved as we draw from it.
  const buckets = new Map();
  for (const id of ids) {
    const key = poolOf(id);
    if (key === null || key === undefined) return [...ids];   // unpooled event — leave it alone
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(id);
  }
  if (buckets.size < 2) return [...ids];                      // single pool — nothing to separate

  const n = ids.length;
  const size = 2 ** Math.ceil(Math.log2(n));
  const byeCount = size - n;

  // THE TOP SEEDS KEEP THEIR PLACE. Seeds 1..byeCount are exactly the ones buildTree gives a bye,
  // and a bye is earned by finishing well — reshuffling those to chase a pairing would take a
  // reward away from the teams that played best. Only the seeds that actually PLAY round one are
  // arranged, which is also the only place the owner's rule has anything to say.
  const out = ids.slice(0, byeCount);
  const remaining = new Map();
  for (const [k, list] of buckets) {
    const rest = list.filter((id) => !out.includes(id));
    if (rest.length) remaining.set(k, rest);
  }

  // TWO STEPS, AND THE ORDER OF THEM IS THE WHOLE TRICK.
  //
  // Step 1 decides which POOL sits at each seed position — never which team. Round-one pairs are
  // (i, size+1-i) for i > size-n, so colouring the two ends of each pair with different pools is
  // what the owner's rule actually asks for.
  //
  // Step 2 then fills the positions in ASCENDING order, taking each pool's next-best team. Because
  // better positions are always filled first, a team can never be seeded above a poolmate who
  // finished ahead of it — the rank invariant holds by construction rather than by care.
  const quota = new Map([...remaining].map(([k, v]) => [k, v.length]));
  const poolAt = new Map();
  const pickPool = (exclude) => {
    let best = null;
    for (const [k, left] of quota) {
      if (left <= 0 || k === exclude) continue;
      if (best === null || left > quota.get(best)) best = k;   // fullest pool first; ties keep finish order
    }
    return best;
  };
  for (let hi = size - n + 1; hi <= size / 2; hi++) {
    const lo = size + 1 - hi;
    const a = pickPool(null);
    if (a === null) break;
    quota.set(a, quota.get(a) - 1);
    poolAt.set(hi, a);
    // EXCLUDE the pool just used. Without this the fullest pool is chosen twice and the pair is a
    // rematch — the exact defect this function exists to prevent.
    const b = pickPool(a) ?? pickPool(null);
    if (b === null) break;
    quota.set(b, quota.get(b) - 1);
    poolAt.set(lo, b);
  }

  for (let i = byeCount + 1; i <= n; i++) {
    const key = poolAt.get(i) ?? [...remaining.keys()].find((k) => remaining.get(k).length);
    const list = remaining.get(key);
    out.push(list.shift());
    if (!list.length) remaining.delete(key);
  }
  return out;
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

/** Games that win a match. Best-of-3 is first to two; anything else is the legacy single game. */
export function gamesNeeded(bestOf) {
  return Number(bestOf) === 3 ? 2 : 1;
}

/**
 * Who won a MATCH, given every game row of one bracket node.
 *
 * BY GAMES, NEVER BY POINTS. A team can lose two close games and win one blowout, so a winner
 * derived from point totals promotes the wrong team in exactly the match that matters most. Ties
 * and unplayed games count for nobody, for the same reason `winnerOf` refuses them: an equal score
 * means unfinished or mis-typed, and guessing puts the wrong team in the final.
 *
 * Returns null while the match is undecided — including 1-1, which is not a draw, it is a match
 * with a game still to play.
 */
export function matchWinnerOf(games, bestOf) {
  const need = gamesNeeded(bestOf);
  let a = 0, b = 0;
  // FIRST TO `need`, decided IN GAME ORDER — not a tally of everything on the table. A match that
  // reached 2-0 is over, so a third game scored into it by mistake cannot change the winner, and a
  // legacy single-game node cannot be re-decided by rows that arrive later.
  for (const gm of games) {
    const side = winnerOf(gm.score_a, gm.score_b);
    if (side === "a") a++;
    else if (side === "b") b++;
    if (a >= need) return "a";
    if (b >= need) return "b";
  }
  return null;
}

/**
 * Given the bracket's matches (each {round, slot, team_a_id, team_b_id, score_a, score_b}), work out
 * what every later-round slot SHOULD hold. Returns only the slots whose current occupant is wrong.
 *
 * Pure, so the same function answers "what would change" for a preview and "what to write" for the
 * real thing. Highest round first, so a winner can move two rounds in one pass.
 */
export function pendingAdvances(matches) {
  /* A NODE IS A SET OF GAMES, NOT A ROW (v0.112.0). Before best-of-3 existed every node held one
     row, so keying by round:slot and iterating rows were the same thing. They are not any more: a
     semi-final holds up to three rows at identical coordinates, and the old loop produced ONE
     ADVANCE PER GAME — promoting game one's winner, then overwriting it with game two's. Not a
     crash; a bracket that quietly puts the wrong team in the final on a day nobody can re-play.

     So games are grouped by node first, and the winner is decided across the group. The node's
     games all share the same two teams, so the first row carries the identity of the whole match. */
  const nodes = new Map();                      // "round:slot" -> game rows, in game order
  for (const m of matches) {
    const key = `${m.bracket_round}:${m.bracket_slot}`;
    if (!nodes.has(key)) nodes.set(key, []);
    nodes.get(key).push(m);
  }
  for (const games of nodes.values()) {
    games.sort((x, y) => (x.game_number || 1) - (y.game_number || 1));
  }
  const byKey = new Map([...nodes].map(([k, games]) => [k, games[0]]));
  const rounds = [...new Set(matches.map((m) => m.bracket_round))].sort((a, b) => b - a);
  const changes = [];

  for (const r of rounds) {
    if (r <= 1) continue;
    for (const [key, games] of nodes) {
      const m = games[0];
      if (m.bracket_round !== r) continue;
      void key;
      /* THE NODE'S FORMAT COMES FROM THE ROWS PRESENT, NOT FROM THE TEMPLATE, AND THAT CHOICE IS
         LOAD-BEARING. Defaulting a semi-final to the template's best-of-3 would demand two game
         wins from every bracket already live in D1 — all of which hold ONE row per node — so every
         one of them would stop advancing the moment this shipped. Counting rows instead is exact:
         the writer lays down two rows for a best-of-3 (games one and two are always played) and one
         for a single game, so a multi-row node IS a best-of-3 and a single-row node IS best-of-1.
         No migration, no column that can disagree with the rows beside it. */
      const side = matchWinnerOf(games, games.length > 1 ? 3 : 1);
      if (!side) continue;
      const teamId = side === "a" ? m.team_a_id : m.team_b_id;
      if (!teamId) continue;
      const to = feedsInto(r, m.bracket_slot);
      const next = byKey.get(`${to.round}:${to.slot}`);
      if (!next) continue;
      const current = to.side === "a" ? next.team_a_id : next.team_b_id;
      if (current === teamId) continue;                     // already correct — idempotent

      /* A HELD SIDE IS NOT TOUCHED (v0.78.0, migration 0041).
         Owner 2026-08-03: "allow movement in brackets to fix any errors." An edit that reverts itself
         fixes nothing, and v0.75.0 proved the revert happened within minutes: advance derives the tree
         from scores and runs on every score entered anywhere in the event. So a side a director placed
         by hand is skipped here — deliberately, and only that side, because the other one must keep
         advancing normally or the bracket silently stops moving and looks like scores being ignored. */
      if (to.side === "a" ? next.slot_locked_a : next.slot_locked_b) {
        // Reported as a change that WOULD have happened, flagged `held`, rather than dropped. Silence
        // makes "nothing to move" and "something wanted to move and a human is holding it" identical,
        // and the second is a decision the director made and may well want to undo.
        changes.push({
          match_id: next.id, round: to.round, slot: to.slot, side: to.side,
          team_id: teamId, from_match_id: m.id, replaced_team_id: current || null,
          disturbs_played_match: next.score_a !== null && next.score_b !== null,
          held: true,
        });
        // The in-memory copy is deliberately NOT updated: the held team is who is actually playing, so
        // whatever they win must carry forward from THEM, not from the team advance wanted to put here.
        continue;
      }

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
    `SELECT id, bracket_id, bracket_round, bracket_slot, team_a_id, team_b_id, score_a, score_b,
            slot_locked_a, slot_locked_b
       FROM matches WHERE org_id=?1 AND event_id=?2 AND bracket_id IS NOT NULL AND deleted_at IS NULL
      ORDER BY bracket_id, bracket_round DESC, bracket_slot`
  ).bind(orgId, eventId).all()).results || [];
  if (!rows.length) return { hasBracket: false, advanced: 0, disturbed: 0, held: 0, changes: [] };

  const changes = [];
  for (const bid of [...new Set(rows.map((r) => r.bracket_id))]) {
    changes.push(...pendingAdvances(rows.filter((r) => r.bracket_id === bid)));
  }
  // Only the ones nobody is holding get written. `held` entries are carried in the return so the
  // caller can say so — see migration 0041 for why the lock exists at all.
  const applied = changes.filter((c) => !c.held);
  for (const c of applied) {
    const col = c.side === "a" ? "team_a_id" : "team_b_id";
    await env.DB.prepare(
      `UPDATE matches SET ${col}=?1, updated_at=datetime('now') WHERE id=?2 AND org_id=?3`
    ).bind(c.team_id, c.match_id, orgId).run();
  }
  return {
    hasBracket: true,
    advanced: applied.length,
    disturbed: applied.filter((c) => c.disturbs_played_match).length,
    held: changes.length - applied.length,
    changes,
  };
}

/* ---------------- routes ---------------- */

let json, requireStaff, audit;
export function wireBrackets(h) { ({ json, requireStaff, audit } = h); }

/** Read the seed order for an event: explicit list, else pool standings, else the teams' own seeds. */
async function seedOrder(env, ctx, eventId, explicit) {
  // pool_id rides along for T2-5's cross-pool round one (v0.124.0). It is read here, with the
  // teams, so there is ONE place that knows which pool a team came out of.
  const teams = (await env.DB.prepare(
    `SELECT id, name, seed, pool_id FROM teams WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL`
  ).bind(ctx.orgId, eventId).all()).results || [];
  const known = new Map(teams.map((t) => [t.id, t]));

  if (Array.isArray(explicit) && explicit.length) {
    const picked = explicit.map(Number).filter((id) => known.has(id));
    if (picked.length !== explicit.length) return { error: "One of those teams isn't in this event." };
    // A REPEATED TEAM PASSES THE LENGTH CHECK ABOVE. Four seeds of [1, 1, 2, 3] are four entries and
    // four known teams, so the count matched and the bracket was drawn with team 1 in both
    // semi-finals — a team playing itself one round later. The /slot route refuses exactly that;
    // generation was the way round it.
    const once = new Set(), twice = [];
    for (const id of picked) {
      if (once.has(id) && !twice.includes(id)) twice.push(id);
      once.add(id);
    }
    if (twice.length) {
      const who = twice.map((id) => known.get(id).name).join(", ");
      return { error: `${who} ${twice.length === 1 ? "is" : "are"} in that list more than once — a team can only hold one seed.` };
    }
    // A hand-picked order is a decision already made — never rearranged.
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

/** Which division a group's bracket row is stamped with. A is the caller's; BB may name its own. */
function divisionForGroup(b, name) {
  const d = Number(b.division_id) || null;
  return name === "A" ? d : (Number(b.bb_division_id) || d);
}

/**
 * WHAT WOULD BE PLAYED — decided once, with no writes, so the preview and the draw cannot disagree.
 *
 * Extracted in v0.108.0 for the "what fits in the time we have left" estimate. The alternative was
 * to let the screen do the arithmetic itself, and that is the failure this loop keeps naming: an
 * estimate computed by a second implementation agrees with the real draw right up until it doesn't,
 * and the day it stops agreeing it still looks exactly like an estimate. `generateBracketFor` now
 * calls this and so does `previewBracketFor`, so there is one answer to "how many games".
 *
 * Everything here is either a pure function or a READ. Nothing in it may write, because the whole
 * point is that a director can ask the question without committing to the answer.
 */
async function planFor(env, ctx, ev, b) {
  const seeds = await seedOrder(env, ctx, ev.id, b.seeds);
  if (seeds.error) return { ok: false, error: seeds.error, status: 400 };
  if (seeds.ids.length < 2) {
    return { ok: false, error: "Add the teams first — there is nothing to bracket yet.", status: 409 };
  }

  // "Top X into A, everyone else into BB." Splitting is what keeps a 16-team day meaningful for
  // the teams that finished tenth — one bracket means half the field plays once and goes home.
  const aSize = Number(b.a_size) > 0 ? Math.min(Number(b.a_size), seeds.ids.length) : seeds.ids.length;
  const includeRest = b.include_rest !== false;
  /* T2-5 (v0.124.0) — the rearrangement happens HERE, after the split and never before it.
     The split is by FINISH ("top X into A"), so reordering first would change WHO makes the A
     bracket, not merely who they meet. Each group is then arranged so round one does not repeat
     pool play — within the group, and within each pool's own finishing order.
     A hand-picked seed list is left exactly as the director wrote it. */
  const arrange = (list) =>
    seeds.source === "chosen by hand"
      ? list
      : crossPoolOrder(list, (id) => (seeds.names.get(id) || {}).pool_id ?? null);

  const groups = [{ name: "A", ids: arrange(seeds.ids.slice(0, aSize)) }];
  if (includeRest && seeds.ids.length > aSize) {
    const rest = seeds.ids.slice(aSize);
    if (rest.length >= 2) groups.push({ name: "BB", ids: arrange(rest) });
  }

  const pointsTo = Number(b.points_to) > 0 ? Number(b.points_to) : 25;
  const cap = Number(b.cap) > 0 ? Number(b.cap) : pointsTo + 2;
  const courts = Number(b.courts) > 0 ? Number(b.courts) : (ev.court_count || 4);

  // Every tree is built and checked BEFORE anything is written. A refusal on the second group after
  // the first has already been inserted leaves half a bracket on the table and no way to tell.
  const plans = [];
  for (const g of groups) {
    const tree = buildTree(g.ids.length);
    if (!tree.ok) return { ok: false, error: tree.error, status: 400 };
    plans.push({ g, tree });
  }
  return { ok: true, seeds, aSize, groups, plans, pointsTo, cap, courts };
}

/** The event's divisions, keyed by id — the court ranges the allocator has to respect. */
async function divisionRanges(env, ctx, eventId) {
  return new Map(((await env.DB.prepare(
    "SELECT id, court_from, court_to FROM divisions WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL"
  ).bind(ctx.orgId, eventId).all()).results || []).map((d) => [d.id, d]));
}

/**
 * HOW LONG THE BRACKET TAKES, WITHOUT DRAWING IT.
 *
 * Owner, 2026-08-08: the end-of-league tournament "changes based on participants and timeframe
 * available", and the goal is "to get everyone sufficient games (so we can double games in pool play
 * if needbe)". Those two sentences set the shape of this function and it is worth being explicit
 * about why, because the obvious reading is the wrong one.
 *
 * THE CONSTRAINT IS A FLOOR ON GAMES PLAYED, NOT A CEILING ON MINUTES USED. A director who is short
 * on time does not want to be told "it doesn't fit" — they want to know what to cut, and the answer
 * is the bracket, not pool play, because pool play is where everyone gets their games. So when the
 * draw overruns, the suggestion is the owner's own: TOP 8. And when it underruns, the spare time is
 * reported as what it actually buys — another round of pool play — rather than as slack.
 *
 * `waves` is the number of rounds of simultaneous play, which is what actually consumes clock: eight
 * games on four courts is two waves, not eight slots. `allocate` has always computed it and thrown
 * it away; this returns it, and so does generation now.
 */
export async function previewBracketFor(env, ctx, eventId, b = {}) {
  const ev = await env.DB.prepare(
    "SELECT id, name, court_count, starts_at FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(eventId, ctx.orgId).first();
  if (!ev) return { ok: false, error: "That event doesn't exist.", status: 404 };

  const plan = await planFor(env, ctx, ev, b);
  if (!plan.ok) return plan;

  const alloc = await wavesFor(env, ctx, eventId, plan, b);
  const waves = alloc.slots;
  const games = plan.plans.reduce((n, p) => n + p.tree.matches.length, 0);

  const slotMinutes = Number(b.slot_minutes) > 0 ? Number(b.slot_minutes) : null;
  const needsMinutes = slotMinutes ? waves * slotMinutes : null;
  const haveMinutes = Number(b.minutes_available) > 0 ? Number(b.minutes_available) : null;

  /* THE UNIT IS GAMES. Owner, 2026-08-08: "do not use time as the core unit of measure."
     `bracketed` is the set actually drawn — a team outside it plays no bracket game at all, so
     "everyone breaks" is a property of the draw, not of the intent. */
  const bracketed = plan.plans.reduce((n, p) => n + p.g.ids.length, 0);
  const everyoneBreaks = bracketed >= plan.seeds.ids.length;
  const bestOf = Number(b.best_of) === 3 ? 3 : 1;
  const pool = await poolGamesPerTeam(env, ctx, eventId);
  const guaranteed = guaranteedGames(pool.min, everyoneBreaks, bestOf);
  /* The DEEPEST bracket is what a winner actually walks through, and it is the A bracket whenever
     one exists — a BB bracket is shallower, so taking the max across plans would understate nothing
     but taking the first would understate a split field. */
  const deepest = bracketGames(Math.max(0, ...plan.plans.map((p) => p.tree.depth)));

  const out = {
    ok: true,
    event: ev.name,
    teams: plan.seeds.ids.length,
    seeded_by: plan.seeds.source,
    /* N-6, owner 2026-08-08: "Please ensure brackets are scored by pool play, that is the whole
       point of pool play." `seedOrder` falls back to entry seed when nothing has been scored, which
       a bracket-only event legitimately needs — so the fallback stays, and it says so instead.
       A bracket seeded from entry order LOOKS identical to one seeded from a real finish; the only
       thing that can tell a director which they are holding is this line. */
    seed_warning: plan.seeds.source === "pool finish" ? null
      : `Seeded by ${plan.seeds.source}, not pool play. Score pool play first if this bracket is meant to come out of it.`,
    courts: plan.courts,
    games,
    waves,
    // --- the answer, in games ---
    pool_games_per_team: pool,
    teams_in_bracket: bracketed,
    everyone_breaks: everyoneBreaks,
    bracket_best_of: bestOf,
    bracket_games_per_team: bestOf === 3 ? BEST_OF_3_GAMES : 1,
    guaranteed_games: guaranteed,
    target_games: MIN_GAMES_PER_TEAM,
    meets_minimum: guaranteed >= MIN_GAMES_PER_TEAM,
    games_short: Math.max(0, MIN_GAMES_PER_TEAM - guaranteed),
    // --- the ceiling, which matters as much as the floor (owner: >16 is physically unplayable) ---
    max_games: pool.max + (everyoneBreaks || bracketed > 0 ? deepest.max : 0),
    max_games_ceiling: MAX_GAMES_PER_TEAM,
    over_ceiling: pool.max + (everyoneBreaks || bracketed > 0 ? deepest.max : 0) > MAX_GAMES_PER_TEAM,
    estimated_minutes: bracketMinutes(alloc, BEST_OF_3_FROM_ROUND),
    // --- the boundary, in minutes: reported, never the verdict ---
    slot_minutes: slotMinutes,
    needs_minutes: needsMinutes,
    minutes_available: haveMinutes,
    brackets: plan.plans.map((p) => ({
      name: p.g.name, teams: p.g.ids.length, size: p.tree.size,
      rounds: p.tree.depth, byes: p.tree.byes, games: p.tree.matches.length,
    })),
  };

  if (needsMinutes !== null && haveMinutes !== null) {
    out.fits = needsMinutes <= haveMinutes;
    out.spare_minutes = haveMinutes - needsMinutes;
  }
  out.suggestion = gamesSuggestion(out, slotMinutes);
  return out;
}

/**
 * What to say, in games.
 *
 * Owner, 2026-08-08: "We aim at roughly 8 games x 25 pts in pool play before cutting anyone. If they
 * receive less than that, for example 6 or 7, then everyone needs to break to meet the game minimum
 * (8 games) that the first bracket games should fulfill" — and "we try to break everyone possible to
 * give them as many games as possible."
 *
 * SO A SHORT FIELD IS NEVER TOLD TO CUT ITSELF. The two levers that ADD games are breaking everyone
 * and playing the first round best-of-3, and they are offered in that order because breaking
 * everyone helps the teams who have the fewest games while best-of-3 helps everyone equally.
 * Trimming to a top 8 takes games away from precisely the teams below the floor, so it is not
 * offered here at all — it belongs to the time boundary, and the time boundary is not the verdict.
 *
 * NOTE ON BEST-OF-3: the generator writes ONE match per bracket node. Running a round as best-of-3
 * is something the director does at the scorer's table, which is why this says "run" rather than
 * implying the software will schedule three rows. Auto-scheduling it is not built.
 */
function gamesSuggestion(out, slotMinutes) {
  /* THE CEILING OUTRANKS EVERYTHING ELSE. Owner, 2026-08-08: "More than 16 become physically
     unplayable." Telling a director their field is one game short while the winner is on for
     eighteen would be advice that makes the day worse — so this is checked before the floor. */
  if (out.over_ceiling) {
    return `The team that wins would play about ${out.max_games} games — past the ${out.max_games_ceiling} that is physically playable. Cut a round of pool play, or make the semi and final single games.`;
  }
  if (!out.meets_minimum) {
    const have = `${out.pool_games_per_team.min} pool game${out.pool_games_per_team.min === 1 ? "" : "s"} each`;
    if (!out.everyone_breaks) {
      const left = out.teams - out.teams_in_bracket;
      return `${have}, and ${left} team${left === 1 ? " is" : "s are"} not in the draw — break everyone (all ${out.teams}) and the first bracket game takes them to ${guaranteedGames(out.pool_games_per_team.min, true, out.bracket_best_of)}.`;
    }
    if (out.bracket_best_of !== 3) {
      const bo3 = guaranteedGames(out.pool_games_per_team.min, true, 3);
      return `${have} plus one bracket game is ${out.guaranteed_games} — short of ${out.target_games}. Run the first round best of 3 (counts ${BEST_OF_3_GAMES}) and everyone reaches ${bo3}.`;
    }
    return `${have} plus a best-of-3 first round is ${out.guaranteed_games} — still ${out.games_short} short of ${out.target_games}. Another round of pool play is the only thing that closes it.`;
  }

  const met = `Everyone gets ${out.guaranteed_games} games — the floor is ${out.target_games}.`;
  // Spare clock buys MORE POOL PLAY, which is where the games are. Only when a whole wave fits.
  if (out.fits && slotMinutes && out.spare_minutes >= slotMinutes) {
    const extra = Math.floor(out.spare_minutes / slotMinutes);
    return `${met} About ${out.spare_minutes} spare minutes — room for roughly ${extra} more round${extra === 1 ? "" : "s"} of pool play.`;
  }
  if (out.fits === false) {
    return `${met} It runs about ${out.needs_minutes - out.minutes_available} minutes past the window, so start earlier or shorten the games.`;
  }
  return met;
}

/**
 * Pool games played per team, counted from the rows rather than inferred from the format.
 *
 * A bracket game is not a pool game, so `bracket_id IS NULL` is the whole predicate — `stage` is the
 * coarse legacy label and a bracket row carries 'quarter'/'semi'/'final', but the older generator
 * wrote 'pool' onto rows it later bracketed, so stage alone would miscount.
 *
 * MIN is what matters. The floor is a promise to the worst-off team, and pools are not always even.
 */
async function poolGamesPerTeam(env, ctx, eventId) {
  const rows = (await env.DB.prepare(
    `SELECT t.id AS team, COUNT(m.id) AS n
       FROM teams t
       LEFT JOIN matches m
         ON m.org_id = t.org_id AND m.event_id = t.event_id
        AND m.bracket_id IS NULL AND m.deleted_at IS NULL
        AND (m.team_a_id = t.id OR m.team_b_id = t.id)
      WHERE t.org_id=?1 AND t.event_id=?2 AND t.deleted_at IS NULL
      GROUP BY t.id`
  ).bind(ctx.orgId, eventId).all()).results || [];
  if (!rows.length) return { min: 0, max: 0 };
  const counts = rows.map((r) => Number(r.n) || 0);
  return { min: Math.min(...counts), max: Math.max(...counts) };
}


/**
 * The wave count for a plan.
 *
 * THE COURT RANGE IS SYNTHESISED HERE RATHER THAN READ BACK, AND THAT IS THE ONE PLACE THIS FILE
 * KEEPS TWO COPIES OF A FACT. Generation inserts the bracket row and re-reads it so the allocator
 * sees what the database holds; a preview has no row to read. The values are the same three the
 * INSERT binds, with the same coercions — but "the same" is a claim, so `league_bracket.test.mjs`
 * asserts that preview and generation report identical games and waves for identical input. If they
 * ever drift, that test is what says so.
 */
async function wavesFor(env, ctx, eventId, plan, b) {
  const divisions = await divisionRanges(env, ctx, eventId);
  const alloc = allocate(plan.plans.map((p, i) => {
    const row = {
      division_id: divisionForGroup(b, p.g.name),
      court_from: Number(b.court_from) || null,
      court_to: Number(b.court_to) || null,
    };
    return {
      bracketId: i + 1,
      depth: p.tree.depth,
      matches: p.tree.matches,
      courts: courtsFor(row, divisions.get(row.division_id), plan.courts),
    };
  }));
  return alloc;
}

/**
 * Expected wall-clock for the bracket, from the template rather than from a typed slot length.
 *
 * A wave is one set of simultaneous games, so its length is the LONGEST match in it — a semi-final
 * best-of-3 sharing a wave with a quarter-final single game does not finish when the quarter does.
 */
function bracketMinutes(alloc, bestOfFrom) {
  const perWave = new Map();
  for (const a of alloc.assignments) {
    perWave.set(a.wave, Math.max(perWave.get(a.wave) ?? 0, minutesForRound(a.round, bestOfFrom)));
  }
  let total = 0;
  for (const m of perWave.values()) total += m;
  return total;
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
    "SELECT id, name, court_count, starts_at FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(eventId, ctx.orgId).first();
  if (!ev) return { ok: false, error: "That event doesn't exist.", status: 404 };

  const plan = await planFor(env, ctx, ev, b);
  if (!plan.ok) return plan;
  const { seeds, aSize, plans, pointsTo, cap, courts } = plan;

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

  // WF-2 (v0.134.0): self-heal generation debris. The bracket INSERTs below run BEFORE the match
  // writes with no transaction, so an attempt that dies between the two strands live matchless
  // rows — and the replace-cleanup above is keyed on MATCHES, so it never fired for them
  // (production carried eleven; event 90006 held ten, five failed A/BB pairs). Sweep them here,
  // on the write path only — a refused generation (409, above) stays write-free; loadBrackets
  // keeps lingering strands off the board until a real write heals them.
  await env.DB.prepare(
    `UPDATE brackets SET deleted_at=datetime('now')
      WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM matches m
                        WHERE m.bracket_id = brackets.id AND m.deleted_at IS NULL)`
  ).bind(ctx.orgId, eventId).run();

  const poolMax = await env.DB.prepare(
    `SELECT COALESCE(MAX(round), 0) AS r FROM matches
      WHERE org_id=?1 AND event_id=?2 AND bracket_id IS NULL AND deleted_at IS NULL`
  ).bind(ctx.orgId, eventId).first();

  // K-2 (v0.131.0): STAMP the seed the generator actually used. Until now the seed order lived
  // only in memory while the tree was built — `teams.seed` is read as the entry-seed FALLBACK but
  // no real path ever wrote it, so a tile rendering it would have shown numbers in every fixture
  // and nothing on any real event (the v0.125.0 trap, dodged at design time). 1..n PER GROUP —
  // a tile's number means "within its bracket" — regeneration restamps (this runs after the
  // replace-clearing), and the slot editor never touches it: a dragged team keeps its seed,
  // because "the #6 upset the #1" is how brackets talk.
  for (const p of plans) {
    for (let i = 0; i < p.g.ids.length; i++) {
      await env.DB.prepare(
        "UPDATE teams SET seed=?1, updated_at=datetime('now') WHERE id=?2 AND org_id=?3 AND event_id=?4 AND deleted_at IS NULL"
      ).bind(i + 1, p.g.ids[i], ctx.orgId, eventId).run();
    }
  }

  const built = [];
  for (const p of plans) {
    const ins = await env.DB.prepare(
      `INSERT INTO brackets (org_id, event_id, name, split_rule, config_json, division_id, court_from, court_to)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
    ).bind(ctx.orgId, eventId, p.g.name, aSize < seeds.ids.length ? `top${aSize}` : "all",
           JSON.stringify({ seeded_by: seeds.source, seeds: p.g.ids, points_to: pointsTo }),
           divisionForGroup(b, p.g.name),
           Number(b.court_from) || null, Number(b.court_to) || null).run();
    p.bracketId = ins.meta.last_row_id;
    // Read back rather than trust what we just bound: the allocator must see what the database holds.
    p.bracketRow = await env.DB.prepare(
      "SELECT id, division_id, court_from, court_to FROM brackets WHERE id=?1 AND org_id=?2"
    ).bind(p.bracketId, ctx.orgId).first();
    built.push({
      id: p.bracketId, name: p.g.name, teams: p.g.ids.length,
      size: p.tree.size, rounds: p.tree.depth, byes: p.tree.byes, matches: p.tree.matches.length,
    });
  }

  /* COURTS AND TIMES ARE ALLOCATED ACROSS EVERY BRACKET AT ONCE, NEVER PER BRACKET.
     Numbering each bracket's courts on its own was wrong twice over, and both were invisible in the
     database and discovered by two teams walking to the same net:
       - An A and a BB drawn together each started at slot 1 on court 1 in the same round. Sixteen
         teams split 8/8 on four courts put TWO games on every court for the whole bracket.
       - One bracket whose round has more games than there are courts did the same to itself: a
         16-team round of 16 is eight games, and `slot mod 4` gave every court two of them.
     So the games that play at the same STAGE — the first bracket round of every bracket, then the
     next — are gathered together, laid across the courts in order, and a new schedule round starts
     each time the courts run out. Bracket rounds still continue the schedule's own numbering, so the
     court grid and the drag-and-drop editor show pool play and the bracket as one continuous day.

     Stage is measured from the FIRST game played (`depth - round`), not from the final, so a 4-team
     BB starts alongside an 8-team A's quarter-finals instead of alongside its final. */
  /* v0.78.0 — COURTS ARE ALLOCATED BY RANGE, AND TIME IS A REAL THING NOW.
     Owner 2026-08-03: "bracket generation should honor the fixed court number. However, as brackets
     collapse courts do become avialable. so there's a need for the scheduling time component if we
     overlap."

     v0.75.0 fixed the double bookings by treating every court as one undifferentiated pile: it pooled
     each stage's games and started a new round when the pile ran out. That stopped two teams being
     sent to one net, and it threw away both halves of what the owner is asking for — a division's
     courts were not fixed (an A bracket could be put on the BB division's courts), and the courts a
     collapsing bracket stopped needing were never offered to anyone else.

     `courts.js` does the allocation now: each bracket gets the courts it is ALLOWED (its own range, or
     its division's, or the whole event), and games take the earliest slot with a free allowed court.
     Brackets with disjoint ranges therefore run simultaneously; brackets that share courts queue; and a
     bracket down to its final leaves its other courts free for whoever else may use them. */
  const divisions = await divisionRanges(env, ctx, eventId);

  const alloc = allocate(plans.map((p) => ({
    bracketId: p.bracketId,
    depth: p.tree.depth,
    matches: p.tree.matches,
    courts: courtsFor(p.bracketRow, divisions.get(p.bracketRow && p.bracketRow.division_id), courts),
  })));

  // Wall-clock times only if the event has a start and a slot length. Otherwise `starts_at` stays NULL
  // — migration 0041: a fabricated time on a results sheet is worse than no time.
  const slotMinutes = Number(b.slot_minutes) > 0 ? Number(b.slot_minutes) : null;
  const times = slotMinutes ? slotsFrom(ev.starts_at, slotMinutes, alloc.slots) : null;

  const byKey = new Map(alloc.assignments.map((a) => [`${a.bracketId}:${a.round}:${a.slot}`, a]));
  let written = 0, unplaced = 0;
  for (const p of plans) {
    for (const mt of p.tree.matches) {
      const a = byKey.get(`${p.bracketId}:${mt.round}:${mt.slot}`);
      // No allocation means the bracket's court range was empty or unusable. The game is still written
      // — a missing fixture is worse than one a director has to place by hand — with no court claimed.
      if (!a) unplaced++;
      await env.DB.prepare(
        `INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id,
                              points_to, cap, game_number, bracket_id, bracket_round, bracket_slot, starts_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10,?11,?12,?13)`
      ).bind(ctx.orgId, eventId, stageForRound(mt.round),
             poolMax.r + 1 + (a ? a.wave : 0), a ? a.court : 0,
             mt.a ? p.g.ids[mt.a - 1] : null, mt.b ? p.g.ids[mt.b - 1] : null,
             pointsTo, cap, p.bracketId, mt.round, mt.slot,
             times && a ? times[a.wave] : null).run();
      written++;
    }
  }

  // `waves` is rounds of simultaneous play, which is what consumes clock. It was computed and thrown
  // away until v0.108.0; returning it is what lets the screen say how long the draw will take.
  return { ok: true, event: ev.name, seededBy: seeds.source, built, written, replaced, waves: alloc.slots };
}

export async function bracketRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;
  let x;

  // ---- preview: what would be played, and how long it takes. Writes nothing, on purpose. ----
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/brackets\/preview$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const b = await request.json().catch(() => ({}));
    const g = await previewBracketFor(env, ctx, +x[1], b);
    return g.ok ? json(g) : json({ error: g.error }, g.status || 400);
  }

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
      waves: g.waves,
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
    // `held` is reported separately from `advanced` because "nothing moved" and "something wanted to
    // move and a human is holding it" are different facts, and the second is a decision the director
    // made and may want to undo. Silence would make them identical (v0.78.0, migration 0041).
    const heldNote = r.held
      ? ` ${r.held} slot${r.held === 1 ? " is" : "s are"} held by hand and ${r.held === 1 ? "was" : "were"} left alone — send release: true on the slot to hand ${r.held === 1 ? "it" : "them"} back.`
      : "";
    return json({
      ok: true,
      advanced: r.advanced,
      disturbed: r.disturbed,
      held: r.held || 0,
      note: (r.advanced === 0
        ? "Nothing to move — every finished game already points at the right next game."
        : `Moved ${r.advanced} winner${r.advanced === 1 ? "" : "s"} forward.` +
          (r.disturbed ? ` ${r.disturbed} later game${r.disturbed === 1 ? " already had a score and its teams changed" : "s already had scores and their teams changed"} — check those.` : "")) + heldNote,
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

    /* PLACING BY HAND HOLDS THE SIDE (v0.78.0, migration 0041).
       Owner 2026-08-03: "allow movement in brackets to fix any errors." Until now this route wrote the
       team and the next advance pass wrote over it — v0.75.0 proved that took minutes, because advance
       runs on every score entered anywhere in the event. An edit that reverts itself fixes nothing.

       `release: true` hands the side back to the algorithm, and `team_id: null` (clearing a slot) also
       releases it: a director emptying a slot is not asking to freeze it empty, they are undoing a
       mistake. Only THIS side is affected — the other must keep advancing or the bracket quietly
       stops moving, which looks exactly like the software ignoring scores. */
    const release = b.release === true || teamId === null;
    const lockCol = side === "a" ? "slot_locked_a" : "slot_locked_b";
    await env.DB.prepare(
      `UPDATE matches SET ${side === "a" ? "team_a_id" : "team_b_id"}=?1, ${lockCol}=?2,
                          updated_at=datetime('now')
        WHERE id=?3 AND org_id=?4`
    ).bind(teamId, release ? 0 : 1, matchId, ctx.orgId).run();
    await audit(env, ctx, "bracket.slot", "matches", matchId,
      { side, team_id: teamId, held: !release });

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

    /* THERE ARE TWO WAYS THIS PLACEMENT GETS UNDONE, AND ONLY ONE OF THEM USED TO BE REPORTED.
       The old test was `feeder.score_a === null` — "the feeding game has not been played" — which
       warned about the SLOWER of the two and stayed silent on the faster:

         feeder has no result yet  → scoring it later replaces this team with its winner. Warned.
         feeder ALREADY has a winner → the next advance pass puts that winner straight back, and
                                       advance runs on every score entered anywhere in this event.
                                       So the edit is gone within minutes. Was NOT warned.

       The second case is the one the owner actually described — a team wins its quarter-final and
       then goes home, so somebody is substituted into the semi. That is the whole reason this route
       exists, and it was the case that reported "Placed." and then quietly reverted. A warning aimed
       at the rarer branch is indistinguishable from no warning at all.

       Note this is still a WARNING, not a lock. Advancement is derived from scores by design
       (`advanceBracketFor`), and making a hand-placed slot survive needs somewhere to record that it
       was hand-placed. That is a schema change and an owner decision, not something to infer here. */
    const feederWinner = feeder ? winnerOf(feeder.score_a, feeder.score_b) : null;
    const fragile = !!feeder;
    const feederName = feeder ? feederLabel(mt.bracket_round, mt.bracket_slot, side,
      (r) => (r === 1 ? "Final" : r === 2 ? "Semi-final" : r === 3 ? "Quarter-final" : `Round of ${2 ** r}`)) : null;

    const loaded = await loadBrackets(env, ctx, eventId);
    return json({
      ok: true,
      note: teamId
        ? (release
          ? "Placed, and this slot follows the scores again — the next result that feeds it will take it over."
          : `Placed and held. ${feederName ? feederName.replace(/^Winner of /, "") : "The feeding game"} will not take this slot back, whatever it finishes. Send release: true to hand it back to the bracket.`)
        : "Slot cleared, and it follows the scores again.",
      // Held, so no longer a risk — but the page still needs to know which state it is in.
      slot_held: !release && !!teamId,
      // Kept for the page's benefit: whether a feeding game exists and whether it is already decided.
      overwritten_by_advance_risk: fragile && release,
      advance_reverts_immediately: !!feederWinner && release,
      ...loaded,
    });
  }

  /* ---- move a game to a different court, or a different time ----
     Owner 2026-08-03: "We need ability to assign different courts to players based on availability of
     courts during bracket."

     WARNS, NEVER REFUSES. Every other override in this module works the same way and for the same
     reason the owner gave about bracket seeding: "many people quit at this point too, so we want to
     have flexibility to modify." A director standing on court 3 knows something the schedule does not —
     that court 7's net is broken, that a team has a flight. Refusing the move would send them to a
     paper grid, and then the software is not the record any more. So a double booking is reported in a
     sentence with the game it collides with, and written anyway. */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/matches\/(\d+)\/court$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1], matchId = +x[2];
    const b = await request.json().catch(() => ({}));

    const mt = await env.DB.prepare(
      `SELECT id, court, round, starts_at FROM matches
        WHERE id=?1 AND org_id=?2 AND event_id=?3 AND deleted_at IS NULL`
    ).bind(matchId, ctx.orgId, eventId).first();
    if (!mt) return json({ error: "That game isn't part of this event." }, 404);

    const court = b.court === undefined ? mt.court : Number(b.court);
    if (!Number.isInteger(court) || court < 0 || court > 200) {
      return json({ error: "Send a court number from 1 to 200, or 0 to take it off a court." }, 400);
    }
    // `starts_at: null` clears the time; omitting it leaves the existing one alone. The two are
    // different intents and collapsing them would make clearing a time impossible.
    const startsAt = b.starts_at === undefined ? mt.starts_at
      : (b.starts_at === null || b.starts_at === "" ? null : String(b.starts_at));
    if (startsAt !== null && Number.isNaN(Date.parse(startsAt))) {
      return json({ error: "That start time isn't a date we can read." }, 400);
    }

    await env.DB.prepare(
      "UPDATE matches SET court=?1, starts_at=?2, updated_at=datetime('now') WHERE id=?3 AND org_id=?4"
    ).bind(court, startsAt, matchId, ctx.orgId).run();
    await audit(env, ctx, "match.court", "matches", matchId,
      { from: { court: mt.court, starts_at: mt.starts_at }, to: { court, starts_at: startsAt } });

    // Checked AFTER the write, against what the table now holds — the honest question is "what does the
    // schedule say now", not "what did this request intend".
    const all = (await env.DB.prepare(
      `SELECT id, court, round, starts_at FROM matches
        WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL AND court > 0`
    ).bind(ctx.orgId, eventId).all()).results || [];
    const clash = conflicts(all).filter((c) => c.match_ids.includes(matchId));

    return json({
      ok: true,
      court, starts_at: startsAt,
      conflicts: clash,
      note: clash.length
        ? `Moved to court ${court}. Careful — game ${clash[0].match_ids.filter((i2) => i2 !== matchId).join(", ")} ${clash[0].match_ids.length > 2 ? "are" : "is"} also on court ${court} at the same time.`
        : `Moved to court ${court}.`,
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

  // WF-2 (v0.134.0): only trees that HAVE live matches are brackets — a live row with none is
  // generation debris (rows are INSERTed before matches, no transaction), and rendering it gave
  // the owner a board full of empty trees. This can never hide a real bracket: planFor validates
  // every tree before anything is written and buildTree refuses n < 2, so a legitimate generation
  // always writes matches for every row it inserts. The empty state + Generate button remain the
  // way in when nothing survives the filter.
  const brs = (await env.DB.prepare(
    `SELECT id, name, split_rule, config_json FROM brackets b
      WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM matches m WHERE m.bracket_id = b.id AND m.deleted_at IS NULL)
      ORDER BY id`
  ).bind(ctx.orgId, eventId).all()).results || [];

  // The pool a team came out of travels with it. Owner 2026-08-03: "Please list the pool they were
  // from in their tile." When a team forfeits and somebody has to be pulled in to replace them, the
  // only question that matters is where they came from — a name alone does not answer it, and
  // "Pool B, 2nd" is the difference between a defensible substitution and a guess.
  const rows = (await env.DB.prepare(
    `SELECT m.id, m.bracket_id, m.bracket_round, m.bracket_slot, m.round, m.court,
            m.team_a_id, m.team_b_id, m.score_a, m.score_b, m.points_to,
            ta.name AS team_a, tb.name AS team_b,
            ta.seed AS seed_a, tb.seed AS seed_b,
            pa.name AS pool_a, pb.name AS pool_b,
            sa.rank AS rank_a, sb.rank AS rank_b,
            capa.full_name AS captain_a, capb.full_name AS captain_b
       FROM matches m
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
       LEFT JOIN contacts capa ON capa.id = ta.captain_contact_id AND capa.deleted_at IS NULL
       LEFT JOIN contacts capb ON capb.id = tb.captain_contact_id AND capb.deleted_at IS NULL
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
            // The seed the generator stamped (K-2) — "as seeded", surviving drags on purpose.
            seed_a: x.seed_a, seed_b: x.seed_b,
            // Staff surface, so the captain is named in full — this is who gets found on a court.
            captain_a: personName(x.captain_a, { full: true }),
            captain_b: personName(x.captain_b, { full: true }),
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
            COALESCE(s.wins,0) AS wins, COALESCE(s.losses,0) AS losses, s.rank,
            ${CAPTAIN_COLS}
       FROM teams t
       LEFT JOIN pools p ON p.id = t.pool_id AND p.deleted_at IS NULL
       LEFT JOIN standings s ON s.team_id = t.id AND s.event_id = t.event_id AND s.deleted_at IS NULL
       ${CAPTAIN_JOIN}
      WHERE t.org_id=?1 AND t.event_id=?2 AND t.deleted_at IS NULL
      ORDER BY COALESCE(s.rank, 9999), t.name`
  ).bind(ctx.orgId, eventId).all()).results || [];

  const inBracket = new Set(rows.flatMap((r) => [r.team_a_id, r.team_b_id]).filter(Boolean));
  return {
    event: { id: ev.id, name: ev.name },
    brackets,
    bench: bench.map((t) => ({
      ...t,
      captain: personName(t.captain_name, { full: true }),
      in_bracket: inBracket.has(t.id),
    })),
  };
}

/** "Winner of Quarter-final 2" — the game an empty slot is waiting on. */
function feederLabel(round, slot, side, label) {
  const fromRound = round + 1;
  const fromSlot = side === "a" ? slot * 2 - 1 : slot * 2;
  return `Winner of ${label(fromRound)} ${fromSlot}`;
}
