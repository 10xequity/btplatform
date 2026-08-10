/**
 * Boomtown Platform — §-1j T2-5 residual: round one must not repeat pool play
 * File: worker/test/cross_pool_seeding.test.mjs · Version: v1.0 · Date: 2026-08-10 · Ships in: v0.124.0
 *
 * THE OWNER'S RULE, in his words: "aim to have the system have opponents be from separate pools
 * but still in bracket. Example in 2 pools of 4 teams, #1 A plays #4 B. In 3 pools of 6 each —
 * #1 A plays #4 C and #1 B plays #4 A and etc."
 *
 * WHERE IT LANDS. `buildTree` pairs SEED NUMBERS (1vN, 2vN-1 …) and never sees a team, so the
 * pairing is decided entirely by the ORDER of `seeds.ids`. Cross-pool seeding is therefore a
 * reordering, not a new tree — and it must happen AFTER the A/BB split, because the split is by
 * FINISH (top X into A) and reordering before it would change who makes the A bracket at all.
 *
 * THE PROPERTY, not an example. Two things must hold together, and the second is why the first
 * is not enough on its own:
 *   P1 — no round-one pair shares a pool (when the pools allow it: with 5 of 8 from one pool,
 *        the pigeonhole makes some repeat unavoidable, so the honest assertion is "as few as
 *        arithmetic permits", proven against a computed floor rather than a hoped-for zero).
 *   P2 — TOTAL MAPPING: every team in, exactly once out. A reordering that DROPS a team satisfies
 *        "no same-pool pair" trivially, which is exactly how a seeding bug would hide behind P1.
 *   P3 — NO-OP without pools: an event with one pool, or none, keeps its rank order byte for byte.
 *        Every bracket already live was drawn that way, and a reorder would silently redraw them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { crossPoolOrder, buildTree } from "../src/brackets.js";

/** Round-one pairs as team ids, using the same seed→id mapping generateBracketFor uses. */
function roundOnePairs(ids) {
  const tree = buildTree(ids.length);
  assert.ok(tree.ok, tree.error);
  return tree.matches
    .filter((m) => m.round === tree.depth && m.a != null && m.b != null)
    .map((m) => [ids[m.a - 1], ids[m.b - 1]]);
}

/**
 * A REALISTIC finish order, which is the whole reason the naive path is broken.
 * `standings.rank` is an EVENT-WIDE pool-play finish with no pool or division filter (D-5), so
 * pools do NOT arrive clustered — they interleave by performance, in whatever order the results
 * fell. An "all of A, then all of B" fixture would be a friendly lie: with two equal pools that
 * shape happens to seed perfectly cross-pool on its own, and a test built on it would pass before
 * the fix and prove nothing. These orders are deterministic interleavings that a real day
 * produces — a strong pool taking several of the top places.
 */
const poolsOf = (spec, order) => {
  const poolOf = new Map();
  let id = 1;
  const byPool = {};
  for (const [pool, size] of Object.entries(spec)) {
    byPool[pool] = [];
    for (let i = 0; i < size; i++) { poolOf.set(id, pool); byPool[pool].push(id); id++; }
  }
  // `order` names the pool that takes each successive finishing place; each pool's own teams are
  // handed out in their own rank order, so within-pool finish is faithful.
  const cursor = {};
  const ids = order.map((p) => { cursor[p] = (cursor[p] || 0); return byPool[p][cursor[p]++]; });
  return { ids, poolOf, sizes: Object.values(spec) };
};

const repeatsIn = (pairs, poolOf) => pairs.filter(([a, b]) => poolOf.get(a) === poolOf.get(b)).length;

/**
 * The floor, DERIVED rather than hoped for. Equal pool sizes do NOT mean equal representation in
 * round one: the top seeds take byes, and if they come disproportionately from one pool the
 * remaining field is lopsided. With r_max teams from the biggest pool and r_rest from all others,
 * pairing is a matching problem — every team beyond r_rest must be paired with a poolmate, so
 * ceil((r_max - r_rest) / 2) rematches are arithmetic, not a defect. Asserting 0 everywhere would
 * be demanding the impossible and would have sent me hunting a bug that was a pigeonhole.
 */
function forcedRepeats(ids, poolOf) {
  const n = ids.length;
  const size = 2 ** Math.ceil(Math.log2(n));
  const players = ids.slice(size - n);              // the top (size-n) seeds take the byes
  const counts = new Map();
  for (const id of players) counts.set(poolOf.get(id), (counts.get(poolOf.get(id)) || 0) + 1);
  const sizes = [...counts.values()];
  const max = Math.max(...sizes, 0);
  const rest = sizes.reduce((a, b) => a + b, 0) - max;
  return Math.max(0, Math.ceil((max - rest) / 2));
}

/* Each case: pool sizes, and the pool that took each finishing place — a plausible real day. */
const CASES = [
  { spec: { A: 4, B: 4 }, order: "AABABBAB".split(""), label: "2 pools of 4 (A took two of the top three)" },
  { spec: { A: 6, B: 6 }, order: "ABAABBABBABA".split(""), label: "2 pools of 6" },
  { spec: { A: 6, B: 6, C: 6 }, order: "ABCACBCABBCACBABCA".split(""), label: "3 pools of 6 — the owner's second example" },
  { spec: { A: 4, B: 4, C: 4, D: 4 }, order: "ABCDACBDCADBDCBA".split(""), label: "4 pools of 4" },
  { spec: { A: 3, B: 3 }, order: "AABBAB".split(""), label: "2 pools of 3 (byes in play)" },
  { spec: { A: 5, B: 5 }, order: "AABABBABBA".split(""), label: "2 pools of 5" },
];

test("P1+P2 — round one never repeats pool play when the pools allow it, and nobody is lost", () => {
  for (const { spec, order, label } of CASES) {
    const { ids, poolOf } = poolsOf(spec, order);
    const ordered = crossPoolOrder(ids, (id) => poolOf.get(id));

    // P2 first — a dropped team makes P1 meaningless.
    assert.deepEqual([...ordered].sort((a, b) => a - b), [...ids].sort((a, b) => a - b),
      `${label}: total mapping broken — a team was dropped or duplicated`);

    const pairs = roundOnePairs(ordered);
    const repeats = repeatsIn(pairs, poolOf);
    const floor = forcedRepeats(ids, poolOf);
    assert.equal(repeats, floor,
      `${label}: ${repeats} round-one pair(s) share a pool but only ${floor} is forced by the ` +
      `arithmetic. Pairs: ${pairs.map(([a, b]) => `${poolOf.get(a)}${a}v${poolOf.get(b)}${b}`).join(" ")}`);
  }
});

test("P4 — the teams that earned a bye keep it: the top seeds are untouched by the rearrangement", () => {
  const { spec, order } = CASES[4]; // 6 teams → bracket of 8 → 2 byes
  const { ids, poolOf } = poolsOf(spec, order);
  const ordered = crossPoolOrder(ids, (id) => poolOf.get(id));
  assert.deepEqual(ordered.slice(0, 2), ids.slice(0, 2),
    "the bye seeds were reshuffled — a bye is earned by finishing well, not by which pool you were in");
});

test("the owner's worked example: 2 pools of 4, every pool winner meets the OTHER pool", () => {
  const { spec, order } = CASES[0];
  const { ids, poolOf } = poolsOf(spec, order);
  const rankInPool = (id) => ids.filter((x) => poolOf.get(x) === poolOf.get(id)).indexOf(id) + 1;
  const pairs = roundOnePairs(crossPoolOrder(ids, (id) => poolOf.get(id)));

  for (const winner of ids.filter((id) => rankInPool(id) === 1)) {
    const match = pairs.find(([a, b]) => a === winner || b === winner);
    assert.ok(match, `the winner of pool ${poolOf.get(winner)} has no round-one match`);
    const other = match[0] === winner ? match[1] : match[0];
    assert.notEqual(poolOf.get(other), poolOf.get(winner),
      `pool ${poolOf.get(winner)}'s winner drew a poolmate in round one — they already played`);
    assert.equal(rankInPool(other), 4,
      "a pool winner should meet the other pool's LAST qualifier — the owner's #1 A v #4 B");
  }
});

test("P3 — with one pool, or no pools at all, the rank order is returned untouched", () => {
  const ids = [11, 22, 33, 44, 55, 66];
  assert.deepEqual(crossPoolOrder(ids, () => "A"), ids,
    "a single-pool event was reordered — every bracket already drawn this way would redraw differently");
  assert.deepEqual(crossPoolOrder(ids, () => null), ids,
    "an event with no pool assignments was reordered — pool play is not a precondition for a bracket");
  assert.deepEqual(crossPoolOrder([], () => "A"), [], "empty input must stay empty");
  assert.deepEqual(crossPoolOrder([7], () => "A"), [7], "a single team must survive");
});

test("NC — the shipped RANK order really does repeat pool play, so the property is not vacuous", () => {
  // The pre-fix behaviour is seeds.ids straight off `ORDER BY rank`, which is what these
  // realistic finishes are. At least one case must be broken before the fix, or this whole file
  // is asserting something that was already true.
  // "Broken" means ABOVE the arithmetic floor — a case already at its floor cannot be improved
  // and would be a false accusation against the shipped code.
  const broken = CASES.filter(({ spec, order }) => {
    const { ids, poolOf } = poolsOf(spec, order);
    return repeatsIn(roundOnePairs(ids), poolOf) > forcedRepeats(ids, poolOf);
  });
  assert.ok(broken.length >= 3,
    `only ${broken.length} of ${CASES.length} realistic finishes seed ABOVE the floor under the ` +
    "shipped rank order — the fixtures are too kind and the fix is not being exercised");

  for (const { spec, order, label } of broken) {
    const { ids, poolOf } = poolsOf(spec, order);
    const before = repeatsIn(roundOnePairs(ids), poolOf);
    const after = repeatsIn(roundOnePairs(crossPoolOrder(ids, (id) => poolOf.get(id))), poolOf);
    assert.ok(after < before, `${label}: repeats went ${before} → ${after}; the reordering did not help`);
  }
});

test("rank order WITHIN a pool is preserved — no team is seeded above a poolmate who finished higher", () => {
  for (const { spec, order, label } of CASES) {
    const { ids, poolOf } = poolsOf(spec, order);
    const ordered = crossPoolOrder(ids, (id) => poolOf.get(id));
    for (const p of Object.keys(spec)) {
      const finish = ids.filter((id) => poolOf.get(id) === p);
      const seeded = ordered.filter((id) => poolOf.get(id) === p);
      assert.deepEqual(seeded, finish,
        `${label}: pool ${p}'s order changed — a team that finished below another was seeded above it`);
    }
  }
});
