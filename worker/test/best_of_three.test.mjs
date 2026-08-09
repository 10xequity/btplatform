/* Boomtown Platform — best-of-3 matches, the engine (roadmap §-1d)
   File: worker/test/best_of_three.test.mjs · Version: v1.0 · Date: 2026-08-09 · Ships in: v0.112.0

   Owner, 2026-08-08, asked whether the SCHEDULE should actually contain the best-of-3 games: "yes".
   The template has said since v0.110.0 that semis and finals ARE best-of-3, while
   `generateBracketFor` wrote ONE match per bracket node — so the planner counted 2.25 games the
   schedule did not contain. That gap is the repo's most likely hollow feature and this closes it.

   THIS FILE IS STAGE ONE: THE ENGINE. A bracket node stops being one row and becomes a SET of game
   rows sharing bracket_round and bracket_slot, and the question "who won this match" stops being
   "who won this game". Everything downstream — the writer, the read path, the screen — depends on
   that question having one correct answer, so it is settled here first, in pure functions, with
   negative controls that prove each can fail.

   THE FAILURE THIS IS SHAPED AGAINST, NAMED BEFORE IT CAN HAPPEN. `pendingAdvances` keys matches by
   round and slot and iterates every row of a round. The moment a node holds three rows, the OLD
   code sees three separate matches at the same coordinates and advances whoever won GAME ONE — then
   game two's row advances somebody else over the top of it. That is not a crash. It is a bracket
   that quietly promotes the wrong team, on a day nobody can re-play, and it would pass every
   existing test because every existing fixture has exactly one row per node.

   BACKWARD COMPATIBILITY IS PART OF THE CONTRACT, NOT A COURTESY. Every bracket already live in D1
   has one row per node, and a single game is best-of-1: first to one game wins. The same function
   must answer both shapes, and a test asserts the old shape still resolves — otherwise this release
   silently freezes every bracket drawn before it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  winnerOf, matchWinnerOf, gamesNeeded, gamesForRound, pendingAdvances,
  BEST_OF_3_FROM_ROUND, BEST_OF_3_GAMES,
} from "../src/brackets.js";

/** One game row as the advancement engine sees it. */
const g = (round, slot, gameNumber, a, b, ids = { team_a_id: 10, team_b_id: 20 }) => ({
  id: round * 1000 + slot * 10 + gameNumber,
  bracket_round: round, bracket_slot: slot, game_number: gameNumber,
  score_a: a, score_b: b, ...ids,
});

/* ===================== how many games win a match ===================== */

test("a best-of-3 needs two games; a single game needs one", () => {
  assert.equal(gamesNeeded(3), 2, "best-of-3 is first to two");
  assert.equal(gamesNeeded(1), 1, "a single game is first to one");
  assert.equal(gamesNeeded(undefined), 1, "an unspecified format is the legacy single game");
});

test("the template decides which rounds are best-of-3, and it is the constant the planner uses", () => {
  // If these ever disagree, the schedule contains a different tournament from the one the planner
  // described — which is the exact gap this release closes.
  assert.equal(BEST_OF_3_FROM_ROUND, 2);
  assert.equal(gamesForRound(1), BEST_OF_3_GAMES, "final");
  assert.equal(gamesForRound(2), BEST_OF_3_GAMES, "semi");
  assert.equal(gamesForRound(3), 1, "quarter-final is one game to 25");
});

/* ===================== who won the match ===================== */

test("a match is won by games, not by points", () => {
  const twoNil = [g(2, 1, 1, 25, 23), g(2, 1, 2, 25, 23)];
  assert.equal(matchWinnerOf(twoNil, 3), "a");

  // b took the first two games. a's third-game blowout gives a the larger point total and must not
  // win the match — the case a points-based winner gets wrong.
  const blowout = [g(2, 1, 1, 21, 25), g(2, 1, 2, 21, 25), g(2, 1, 3, 15, 2)];
  assert.equal(matchWinnerOf(blowout, 3), "b");
});

test("a best-of-3 that is 1-1 has no winner until the third game is played", () => {
  const split = [g(2, 1, 1, 25, 20), g(2, 1, 2, 18, 25)];
  assert.equal(matchWinnerOf(split, 3), null, "1-1 is unfinished; a guess promotes the wrong team");
  assert.equal(matchWinnerOf([...split, g(2, 1, 3, 15, 12)], 3), "a");
});

test("an unplayed or tied game counts for nobody", () => {
  assert.equal(matchWinnerOf([g(2, 1, 1, null, null)], 3), null);
  assert.equal(matchWinnerOf([g(2, 1, 1, 21, 21), g(2, 1, 2, 25, 20)], 3), null,
    "a tie is not a win, so one win plus one tie is not two games");
  assert.equal(winnerOf(21, 21), null, "the single-game rule this builds on is unchanged");
});

test("BACKWARD COMPATIBILITY: a node with one row still resolves, or every live bracket freezes", () => {
  assert.equal(matchWinnerOf([g(3, 1, 1, 25, 20)], 1), "a");
  assert.equal(matchWinnerOf([g(3, 1, 1, 20, 25)], 1), "b");
  assert.equal(matchWinnerOf([g(3, 1, 1, null, null)], 1), null);
});

/* ===================== the engine that moves teams forward ===================== */

test("THE DEFECT THIS RELEASE EXISTS TO PREVENT: three rows must advance ONE team, once", () => {
  // Semi-final slot 1 is a best-of-3 that team A won 2-1. The old engine saw three matches at the
  // same coordinates and produced an advance per row — whichever was written last would win.
  const matches = [
    g(2, 1, 1, 25, 20),
    g(2, 1, 2, 20, 25),
    g(2, 1, 3, 15, 10),
    g(1, 1, 1, null, null, { team_a_id: null, team_b_id: null }),
  ];
  const intoFinal = pendingAdvances(matches).filter((c) => c.round === 1 && c.slot === 1);
  assert.equal(intoFinal.length, 1, `exactly one team may advance, got ${intoFinal.length}`);
  assert.equal(intoFinal[0].team_id, 10, "the match winner advances, not game one's winner");
});

test("a split best-of-3 advances nobody — the slot stays open", () => {
  const matches = [
    g(2, 1, 1, 25, 20),
    g(2, 1, 2, 20, 25),
    g(1, 1, 1, null, null, { team_a_id: null, team_b_id: null }),
  ];
  assert.deepEqual(pendingAdvances(matches).filter((c) => c.round === 1), [],
    "1-1 is unfinished; promoting anyone here is promoting a guess");
});

test("a single-game round still advances exactly as it always did", () => {
  const matches = [
    g(3, 1, 1, 25, 20),
    g(2, 1, 1, null, null, { team_a_id: null, team_b_id: null }),
  ];
  const changes = pendingAdvances(matches);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].team_id, 10);
});

test("advancing is idempotent across a multi-game node — running it twice changes nothing", () => {
  // Advancement is recomputed from scores on every score entered anywhere in the event. A second
  // pass that produced changes would mean the tree never settles.
  const matches = [
    g(2, 1, 1, 25, 20), g(2, 1, 2, 25, 20),
    g(1, 1, 1, null, null, { team_a_id: 10, team_b_id: null }),
  ];
  assert.deepEqual(pendingAdvances(matches).filter((c) => c.round === 1), [],
    "the slot already holds the winner, so nothing may be reported as pending");
});

/* ===================== negative controls ===================== */

test("NC-1: scoring the decider the other way advances the other team", () => {
  // If these two runs agreed, the decider's score would not be reaching the engine at all — which
  // is the shape of an assertion that cannot fail.
  const open = g(1, 1, 1, null, null, { team_a_id: null, team_b_id: null });
  const split = [g(2, 1, 1, 25, 20), g(2, 1, 2, 20, 25)];
  const aWins = pendingAdvances([...split, g(2, 1, 3, 15, 10), open]).find((c) => c.round === 1);
  const bWins = pendingAdvances([...split, g(2, 1, 3, 10, 15), open]).find((c) => c.round === 1);
  assert.equal(aWins.team_id, 10);
  assert.equal(bWins.team_id, 20);
  assert.notEqual(aWins.team_id, bWins.team_id);
});

test("NC-2: treating a node as best-of-1 promotes game one's winner — the bug, reproduced", () => {
  // The old behaviour asserted directly, so the difference between right and wrong is visible
  // rather than argued. Game one went to b; the match went to a, 2-1.
  const games = [g(2, 1, 1, 20, 25), g(2, 1, 2, 25, 20), g(2, 1, 3, 15, 12)];
  assert.equal(matchWinnerOf(games, 1), "b", "best-of-1 stops at the first decided game");
  assert.equal(matchWinnerOf(games, 3), "a", "best-of-3 reads the whole match");
});
