/**
 * Boomtown Platform — the wins-ranked pods-of-4 league format (QC integration, owner 2026-08-26)
 * File: worker/test/league_wins_pods.test.mjs · Version: v1.0 · Date: 2026-08-26 · Ships in: v0.206.0
 *
 * Owner (2026-08-26): "add the format and integrate it." The QC Schedule Generator's weekly format —
 * rank the ladder by WINS, cut it into rank-adjacent pods of 4 (or 6), and play a partial
 * round-robin so every team gets exactly 3 distinct opponents that night, no repeats — is now a
 * second `pairingMode` on the League Manager alongside the level-capped default. No schema change:
 * it reads the standings/wins that already exist. This tests the pure pairing algorithm directly
 * (podSizes + pairWinsPods, exported from leagues_admin.js), which is a stronger guard than a source
 * scan; the mode wiring in generateWeek is pinned by the route/source checks at the end.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { podSizes, pairWinsPods } from "../src/leagues_admin.js";

test("podSizes cuts the ladder into pods of 4 (a 6 for the awkward remainder), with a bye for odd", () => {
  assert.deepEqual(podSizes(8),  { sizes: [4, 4], bye: 0 }, "8 → two pods of 4");
  assert.deepEqual(podSizes(6),  { sizes: [6], bye: 0 },    "6 → one pod of 6");
  assert.deepEqual(podSizes(4),  { sizes: [4], bye: 0 },    "4 → one pod");
  assert.deepEqual(podSizes(10), { sizes: [6, 4], bye: 0 }, "10 → a 6 then a 4 (10%4==2)");
  assert.deepEqual(podSizes(9),  { sizes: [4, 4], bye: 1 }, "9 odd → one sits, the rest are two pods of 4");
  assert.deepEqual(podSizes(5),  { sizes: [4], bye: 1 },    "5 odd → one sits, a pod of 4");
  assert.deepEqual(podSizes(2),  { sizes: [2], bye: 0 },    "2 → a single pairing");
});

/** A ranked team list, strongest first. */
const ranked = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `T${i + 1}`, wins: n - i }));

test("pairWinsPods gives every team exactly 3 distinct opponents, no repeat that night", () => {
  const { rounds, byes } = pairWinsPods(ranked(8));
  assert.equal(rounds.length, 3, "a pod night is 3 game-slots");
  assert.equal(byes.length, 0, "8 is even and divisible — nobody sits");
  const opps = new Map();  // teamId → Set of opponents
  const seen = new Set();  // unordered pair key → count
  for (const rd of rounds) for (const [a, b] of rd) {
    (opps.get(a) || opps.set(a, new Set()).get(a)).add(b);
    (opps.get(b) || opps.set(b, new Set()).get(b)).add(a);
    const k = [Math.min(a, b), Math.max(a, b)].join("-");
    assert.ok(!seen.has(k), `pair ${k} played twice in one night`);
    seen.add(k);
  }
  for (const [id, set] of opps) assert.equal(set.size, 3, `team ${id} did not get exactly 3 opponents (${set.size})`);
});

test("pods are RANK-ADJACENT — you play the teams nearest you in the wins ladder", () => {
  // Ranks 1–4 form pod 1, 5–8 pod 2. So team 1 (id 1) only ever meets ids 2,3,4 — never 5+.
  const { rounds } = pairWinsPods(ranked(8));
  const oppsOf1 = new Set();
  for (const rd of rounds) for (const [a, b] of rd) { if (a === 1) oppsOf1.add(b); if (b === 1) oppsOf1.add(a); }
  assert.deepEqual([...oppsOf1].sort((x, y) => x - y), [2, 3, 4],
    "the top team met someone outside its rank-adjacent pod");
});

test("a pod of 6 is truncated to 3 rounds — everyone still plays exactly 3, nobody plays 5", () => {
  const { rounds } = pairWinsPods(ranked(6));
  const count = new Map();
  for (const rd of rounds) for (const [a, b] of rd) { count.set(a, (count.get(a) || 0) + 1); count.set(b, (count.get(b) || 0) + 1); }
  for (const [id, n] of count) assert.equal(n, 3, `team ${id} played ${n} games in a pod of 6 (must be 3)`);
});

test("an odd ladder sits the lowest-ranked team (the bye), the rest pod up", () => {
  const { byes } = pairWinsPods(ranked(9));
  assert.equal(byes.length, 1, "9 teams → exactly one bye");
  assert.equal(byes[0].id, 9, "the bye is the lowest-ranked team (id 9 has the fewest wins)");
});

/* v0.207.0 (Gemini review of v0.206.0's build, finding C4): a lone 2-team pod — which only occurs
   at N=2, or N=3 with the odd bye — must still fill the night. The old template played it ONCE and
   left both teams idle for game-slots 2 and 3 while every other pod played three. The only opponent
   is each other, so the degenerate round-robin is best-of-3: both teams play all three slots. */
test("a 2-team pod plays best-of-3 across the night — neither team sits idle", () => {
  const { rounds } = pairWinsPods(ranked(2));
  assert.equal(rounds.length, 3, "a pod night is 3 game-slots");
  const count = new Map();
  for (const rd of rounds) for (const [a, b] of rd) { count.set(a, (count.get(a) || 0) + 1); count.set(b, (count.get(b) || 0) + 1); }
  assert.equal(count.get(1), 3, "team 1 did not play 3 games in a 2-team pod (idle rounds)");
  assert.equal(count.get(2), 3, "team 2 did not play 3 games in a 2-team pod (idle rounds)");
});

/* ── the mode is wired into week generation ── */
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";
const ADMIN_SRC = blankComments(readFileSync(new URL("../src/leagues_admin.js", import.meta.url), "utf8"));
const UI_SRC = blankComments(readFileSync(new URL("../../web/assets/admin-league.js", import.meta.url), "utf8"));

test("generateWeek branches on pairingMode and wins-pods skips the level-gap cap", () => {
  assert.match(ADMIN_SRC, /pairingMode/, "generateWeek never reads pairingMode — the format can't be selected");
  assert.match(ADMIN_SRC, /wins-pods/, "the wins-pods mode value is absent");
  assert.match(ADMIN_SRC, /pairWinsPods\(/, "generateWeek never calls the wins-pods pairing");
});

test("the UI offers the mode and sends it with the generate press", () => {
  assert.match(UI_SRC, /pairingMode/, "admin-league.js never sends pairingMode to the server");
});
