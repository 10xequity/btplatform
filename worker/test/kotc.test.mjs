/* Boomtown Platform — King / Queen of the Court engine tests
   File: worker/test/kotc.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.76.0

   THE CLAIMS IN `kotc.js` ARE COMBINATORIAL, SO THEY ARE PROVED HERE, NOT DESCRIBED.
   Two of them look obviously true and are the whole format:
     - four players on a net partner each of the other three exactly once;
     - five players partner each of the other four exactly once and each sit out exactly one game.
   The second is genuinely easy to get wrong — pairing the four non-sitting players any other way
   repeats some pairs and never forms others, and the result still LOOKS like a rotation: five games,
   everyone plays four, everyone sits once. It just quietly stops being fair. So the pairs are counted.

   Everything in this file is pure. No database, no fixture, no clock. */
import { test } from "node:test";
import { mountsAndWires } from "../testkit/route-extract.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rotation, gamesPerNet, netPlan, seedRound, gamesForRound,
  tally, rankPlayers, partnerHistory, nextRound, NET_SIZES,
} from "../src/kotc.js";

const SRC = readFileSync(new URL("../src/kotc.js", import.meta.url), "utf8");

/** Every unordered pair in a list, as "low:high" keys. */
const allPairs = (xs) => {
  const out = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    out.push(xs[i] < xs[j] ? `${xs[i]}:${xs[j]}` : `${xs[j]}:${xs[i]}`);
  }
  return out;
};

/* ================================ the rotation ================================ */

test("a net of four plays three games and every pair partners exactly once", () => {
  const games = rotation(4);
  assert.equal(games.length, 3);
  const partnered = [];
  for (const g of games) {
    partnered.push(g.a.slice().sort().join(":"), g.b.slice().sort().join(":"));
    assert.equal(g.out, null, "nobody sits out on a net of four");
    assert.deepEqual([...g.a, ...g.b].sort(), [0, 1, 2, 3], "all four players are on court");
  }
  assert.deepEqual(partnered.sort(), allPairs([0, 1, 2, 3]).sort(),
    "the three games must use all six pairs — each player partnering each other exactly once");
  assert.equal(new Set(partnered).size, 6, "no pair may repeat inside one round");
});

test("a net of five plays five games, every pair partners once, everyone sits out once", () => {
  /* THE CLAIM WORTH PROVING. C(5,2) = 10 pairs; 5 games × 2 pairs = 10. So a complete rotation is
     possible at five, and the construction either achieves it exactly or is wrong — there is no
     partial credit. A wrong pairing of the four non-sitting players gives five games in which
     everybody still plays four and sits once, which is why eyeballing it proves nothing. */
  const games = rotation(5);
  assert.equal(games.length, 5);

  const partnered = [];
  const sat = [];
  for (const g of games) {
    partnered.push(g.a.slice().sort().join(":"), g.b.slice().sort().join(":"));
    sat.push(g.out);
    assert.equal([...g.a, ...g.b].length, 4, "four on court");
    assert.ok(!([...g.a, ...g.b].includes(g.out)), "the player sitting out cannot also be playing");
    assert.deepEqual([...g.a, ...g.b, g.out].sort(), [0, 1, 2, 3, 4], "all five accounted for");
  }

  assert.deepEqual(partnered.sort(), allPairs([0, 1, 2, 3, 4]).sort(),
    "the five games must use all TEN pairs exactly once — this is the whole claim");
  assert.equal(new Set(partnered).size, 10);
  assert.deepEqual(sat.slice().sort(), [0, 1, 2, 3, 4], "each player sits out exactly one game");
});

test("NC: the pair-counting check can fail — a plausible wrong rotation is rejected", () => {
  /* Without this, `allPairs` could be comparing something against itself and every assertion above
     would be decoration. This is the rotation a reasonable person writes first: sit out k, then pair
     the remaining four as (k+1, k+2) against (k+3, k+4). It gives five games, everyone plays four and
     sits once — and it forms only five distinct pairs, each twice. */
  const wrong = [];
  const sat = [];
  for (let k = 0; k < 5; k++) {
    const at = (n) => (k + n) % 5;
    wrong.push([at(1), at(2)].sort().join(":"), [at(3), at(4)].sort().join(":"));
    sat.push(k);
  }
  assert.deepEqual(sat.slice().sort(), [0, 1, 2, 3, 4], "the wrong rotation still sits everyone once");
  assert.equal(wrong.length, 10, "and still plays ten pair-slots");
  assert.notDeepEqual(wrong.slice().sort(), allPairs([0, 1, 2, 3, 4]).sort(),
    "so only the PAIR COUNT distinguishes it — and it must be caught");
  assert.ok(new Set(wrong).size < 10, `it forms ${new Set(wrong).size} distinct pairs, not 10`);
});

test("a net is four players or five, and anything else throws rather than improvising", () => {
  assert.deepEqual(NET_SIZES, [4, 5]);
  assert.equal(gamesPerNet(4), 3);
  assert.equal(gamesPerNet(5), 5);
  for (const bad of [0, 1, 2, 3, 6, 7]) {
    assert.throws(() => rotation(bad), /A net holds four players/, `size ${bad} must throw`);
  }
});

/* ================================ sizing the nets ================================ */

test("a field that divides is all nets of four", () => {
  for (const [n, nets] of [[4, 1], [8, 2], [12, 3], [16, 4], [24, 6], [32, 8]]) {
    const p = netPlan(n);
    assert.ok(p.ok, p.error);
    assert.equal(p.nets, nets);
    assert.deepEqual(p.sizes, new Array(nets).fill(4));
    assert.equal(p.games, nets * 3);
  }
});

test("leftovers JOIN existing nets — 14 players is 4/5/5, never 4/4/4/2", () => {
  // Owner 2026-08-03: "we would fill each person to join an existing net and do a 5 team rotation."
  // The spec had proposed three nets of four and one of two; a net of two is not a net.
  const p = netPlan(14);
  assert.ok(p.ok, p.error);
  assert.equal(p.nets, 3);
  assert.deepEqual(p.sizes, [4, 5, 5], "the fives sit on the BOTTOM nets, so net 1 stays a clean four");
  assert.equal(p.games, 3 + 5 + 5);
  assert.equal(p.sizes.reduce((a, b) => a + b, 0), 14, "every player must be on a net");
});

test("every workable field size seats every player, in nets of only four or five", () => {
  // The widest set, not three hand-picked examples — a sizing rule that is right at 14 and wrong at
  // 26 is a rule nobody can trust on the day.
  const refused = [];
  for (let n = 4; n <= 60; n++) {
    const p = netPlan(n);
    if (!p.ok) { refused.push(n); continue; }
    assert.equal(p.sizes.reduce((a, b) => a + b, 0), n, `${n} players: sizes do not sum to the field`);
    for (const s of p.sizes) assert.ok(s === 4 || s === 5, `${n} players produced a net of ${s}`);
    assert.equal(p.sizes.length, p.nets);
    // Fours before fives, so the ordering claim holds at every size and not just at 14.
    const firstFive = p.sizes.indexOf(5);
    if (firstFive !== -1) {
      assert.ok(p.sizes.slice(firstFive).every((s) => s === 5), `${n} players: a four appears below a five`);
    }
  }
  assert.deepEqual(refused, [6, 7, 11],
    "only 6, 7 and 11 cannot be made of fours and fives — any other refusal is a sizing bug");
});

test("a field that cannot be made of fours and fives says which numbers would work", () => {
  // "Invalid" sends a director looking for a bug. Two numbers sends them looking for a player.
  for (const [n, works] of [[6, [4, 8]], [7, [4, 8]], [11, [8, 12]]]) {
    const p = netPlan(n);
    assert.equal(p.ok, false, `${n} must be refused`);
    assert.match(p.error, /cannot be made into nets of four and five/);
    assert.deepEqual(p.would_work, works, `${n}: the suggested counts are wrong`);
    for (const w of works) assert.ok(netPlan(w).ok, `${n} suggested ${w}, which is itself refused`);
  }
});

test("fewer than four players is refused, and so is a made-up net size", () => {
  for (const n of [0, 1, 2, 3, -4, 4.5, "eight", null]) {
    assert.equal(netPlan(n).ok, false, `${n} must not produce a plan`);
  }
  assert.equal(netPlan(8, { playersPerNet: 6 }).ok, false, "six to a net is not this format");
  assert.match(netPlan(8, { playersPerNet: 6 }).error, /A net holds four players/);
});

/* ================================ seeding and fixtures ================================ */

test("the first round puts the best players on net 1", () => {
  // Scattering the seeds would spend round one re-establishing something already known.
  const r = seedRound([101, 102, 103, 104, 105, 106, 107, 108]);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.nets.map((n) => n.net_no), [1, 2]);
  assert.deepEqual(r.nets[0].seats, [101, 102, 103, 104]);
  assert.deepEqual(r.nets[1].seats, [105, 106, 107, 108]);
});

test("the fixture list names the four players on each game, and who is sitting out", () => {
  const r = seedRound([1, 2, 3, 4, 5, 6, 7, 8, 9]);       // 9 = one net of 4, one of 5
  assert.deepEqual(r.sizes, [4, 5]);
  const games = gamesForRound(r.nets);
  assert.equal(games.length, 3 + 5);

  const net1 = games.filter((g) => g.net_no === 1);
  assert.equal(net1.length, 3);
  for (const g of net1) assert.equal(g.sitting_out_contact_id, null);

  const net2 = games.filter((g) => g.net_no === 2);
  assert.equal(net2.length, 5);
  assert.deepEqual(net2.map((g) => g.sitting_out_contact_id).sort((a, b) => a - b), [5, 6, 7, 8, 9],
    "on a net of five each player sits out exactly one of the five games");

  // The same completeness claim, now in contact ids rather than seat indices — the translation from
  // seats to people is where an off-by-one would hide.
  const partnered = [];
  for (const g of net2) {
    partnered.push([g.a1_contact_id, g.a2_contact_id].sort((a, b) => a - b).join(":"),
                   [g.b1_contact_id, g.b2_contact_id].sort((a, b) => a - b).join(":"));
  }
  assert.deepEqual(partnered.sort(), allPairs([5, 6, 7, 8, 9]).sort());
});

test("no game ever puts the same person on both sides, at either net size", () => {
  for (const n of [4, 5, 8, 9, 14, 20]) {
    const r = seedRound(Array.from({ length: n }, (_, i) => i + 1));
    for (const g of gamesForRound(r.nets)) {
      const four = [g.a1_contact_id, g.a2_contact_id, g.b1_contact_id, g.b2_contact_id];
      assert.equal(new Set(four).size, 4, `${n} players: a game repeated a player — ${JSON.stringify(g)}`);
    }
  }
});

/* ================================ the tally ================================ */

const game = (net, no, a1, a2, b1, b2, sa = null, sb = null) => ({
  net_no: net, game_no: no,
  a1_contact_id: a1, a2_contact_id: a2, b1_contact_id: b1, b2_contact_id: b2,
  score_a: sa, score_b: sb,
});

test("a player's points are what their pair scored, across every game they were in", () => {
  // Owner: "They will enter scores, which tally and then ranked and seeded" — a running total, not a
  // win count. One full round on one net of four.
  const games = [
    game(1, 1, 1, 2, 3, 4, 21, 15),      // 1,2 win
    game(1, 2, 1, 3, 2, 4, 18, 21),      // 2,4 win
    game(1, 3, 1, 4, 2, 3, 21, 19),      // 1,4 win
  ];
  const rows = tally(games);
  const by = Object.fromEntries(rows.map((r) => [r.contact_id, r]));

  assert.equal(by[1].points, 21 + 18 + 21, "player 1 scored in all three games");
  assert.equal(by[1].conceded, 15 + 21 + 19);
  assert.equal(by[1].point_diff, by[1].points - by[1].conceded);
  assert.deepEqual([by[1].wins, by[1].losses, by[1].games], [2, 1, 3]);

  assert.equal(by[2].points, 21 + 21 + 19);
  assert.deepEqual([by[2].wins, by[2].losses], [2, 1]);
  assert.equal(by[3].points, 15 + 18 + 19);
  assert.deepEqual([by[3].wins, by[3].losses], [0, 3]);
  assert.equal(by[4].points, 15 + 21 + 21);
  assert.deepEqual([by[4].wins, by[4].losses], [2, 1]);

  // Conservation: every point scored was conceded by somebody, twice over (two players a side).
  const scored = rows.reduce((t, r) => t + r.points, 0);
  const against = rows.reduce((t, r) => t + r.conceded, 0);
  assert.equal(scored, against, "points scored and points conceded must balance across the net");
  assert.equal(scored, 2 * (21 + 15 + 18 + 21 + 21 + 19));
});

test("an unscored game counts for nobody — not as a zero", () => {
  /* A half-typed result is not a result. Counting a blank as 0 would enter a loss against a player who
     has not finished playing, and it is the kind of wrong that only shows up as somebody being moved
     down a net they should have gone up. */
  const rows = tally([
    game(1, 1, 1, 2, 3, 4, 21, 15),
    game(1, 2, 1, 3, 2, 4),                  // not played
    game(1, 3, 1, 4, 2, 3, 21, null),        // half typed in
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.contact_id, r]));
  assert.equal(by[1].games, 1, "only the finished game counts");
  assert.equal(by[1].points, 21);
  assert.equal(by[3].losses, 1, "and the finished game still counts against the losers");
  assert.equal(by[3].games, 1);
  assert.equal(rows.length, 4, "everyone who appeared still gets a row, at zero if need be");
});

test("a tied score is neither a win nor a loss", () => {
  const rows = tally([game(1, 1, 1, 2, 3, 4, 21, 21)]);
  for (const r of rows) {
    assert.deepEqual([r.wins, r.losses], [0, 0], "an equal score is unfinished or mis-typed");
    assert.equal(r.games, 1, "but it was still played, so it counts as a game");
    assert.equal(r.points, 21);
  }
});

/* ================================ ranking ================================ */

test("ranking is total points, then wins, then point difference, then never random", () => {
  // Owner 2026-08-03, asked what breaks a tie on equal totals: "Wins, then point difference."
  const rows = [
    { contact_id: 7, points: 60, wins: 1, point_diff: 10 },
    { contact_id: 3, points: 60, wins: 2, point_diff: -5 },   // fewer points conceded matters less than wins
    { contact_id: 9, points: 61, wins: 0, point_diff: 0 },
    { contact_id: 5, points: 60, wins: 1, point_diff: 10 },   // identical to 7 on every measure
  ];
  assert.deepEqual(rankPlayers(rows).map((r) => r.contact_id), [9, 3, 5, 7],
    "61 points beats 60 whatever the wins; then 2 wins beats 1; then id, so the order never shuffles");

  // Asserted separately because "deterministic" is the property that stops a board reshuffling itself
  // while nobody is touching it.
  const shuffled = [rows[3], rows[1], rows[0], rows[2]];
  assert.deepEqual(rankPlayers(shuffled).map((r) => r.contact_id), rankPlayers(rows).map((r) => r.contact_id));
});

test("point difference only speaks after wins, not before", () => {
  // The distinction the owner actually chose. A player with more wins outranks one with a better
  // margin, on equal points.
  const worseMargin = { contact_id: 1, points: 50, wins: 3, point_diff: -20 };
  const betterMargin = { contact_id: 2, points: 50, wins: 2, point_diff: 40 };
  assert.deepEqual(rankPlayers([betterMargin, worseMargin]).map((r) => r.contact_id), [1, 2]);
});

/* ================================ movement between rounds ================================ */

/** Standings where the listed players score in descending order, best first. */
const scores = (order) => order.map((id, i) => ({ contact_id: id, points: 100 - i * 10, wins: 3, point_diff: 0 }));

test("the top player on each net goes up and the bottom one goes down", () => {
  // move_up = 1: the owner's own "usually its 1 per net for equity".
  const prev = [
    { net_no: 1, seats: [1, 2, 3, 4] },
    { net_no: 2, seats: [5, 6, 7, 8] },
    { net_no: 3, seats: [9, 10, 11, 12] },
  ];
  const st = scores([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const r = nextRound(prev, st, { moveUp: 1 });
  assert.ok(r.ok, r.error);
  assert.equal(r.move_up, 1);

  const where = (id) => r.nets.find((n) => n.seats.includes(id)).net_no;
  assert.equal(where(5), 1, "the best player on net 2 moves up to net 1");
  assert.equal(where(4), 2, "the worst on net 1 moves down to net 2");
  assert.equal(where(8), 3, "the worst on net 2 moves down to net 3");
  assert.equal(where(9), 2, "the best on net 3 moves up to net 2");
  assert.equal(where(1), 1, "the best on net 1 has nowhere higher and holds its place");
  assert.equal(where(12), 3, "the worst on the bottom net has nowhere lower");
  assert.equal(where(2), 1, "the middle of a net stays put at move_up = 1");
  assert.equal(r.moved, 4);
});

test("every net keeps its size, including mixed fours and fives, over a whole night", () => {
  /* The property that matters most, and the one an off-by-one destroys silently: a player dropped by
     the movement arithmetic just stops appearing, and the board shows one fewer person with nothing to
     say anything went wrong. Run over ten rounds because a leak of one player per round is invisible
     in a single step. */
  for (const moveUp of [1, 2]) {
    let nets = seedRound(Array.from({ length: 14 }, (_, i) => i + 1)).nets;   // 4 / 5 / 5
    const sizes = nets.map((n) => n.seats.length);
    assert.deepEqual(sizes, [4, 5, 5]);
    const everyone = new Set(nets.flatMap((n) => n.seats));

    for (let round = 1; round <= 10; round++) {
      // Shuffle the scoring order deterministically so movement really happens each round.
      const order = nets.flatMap((n) => n.seats).map((id, i) => [id, (i * 7 + round * 3) % 14]);
      order.sort((a, b) => a[1] - b[1]);
      const r = nextRound(nets, scores(order.map(([id]) => id)), { moveUp });
      assert.ok(r.ok, `move_up ${moveUp}, round ${round}: ${r.error}`);
      assert.deepEqual(r.nets.map((n) => n.seats.length), sizes,
        `move_up ${moveUp}, round ${round}: the nets changed size`);
      const still = new Set(r.nets.flatMap((n) => n.seats));
      assert.equal(still.size, 14, `move_up ${moveUp}, round ${round}: ${14 - still.size} player(s) lost`);
      for (const id of everyone) assert.ok(still.has(id), `player ${id} fell out of the session`);
      nets = r.nets;
    }
  }
});

test("nobody is ever in two nets at once", () => {
  const prev = [
    { net_no: 1, seats: [1, 2, 3, 4] },
    { net_no: 2, seats: [5, 6, 7, 8] },
  ];
  const r = nextRound(prev, scores([1, 2, 3, 4, 5, 6, 7, 8]), { moveUp: 2 });
  assert.ok(r.ok, r.error);
  const flat = r.nets.flatMap((n) => n.seats);
  assert.equal(flat.length, new Set(flat).size, "a player appeared on two nets");
  assert.equal(flat.length, 8);
});

test("asking to move more than half a net is clamped, and says so out loud", () => {
  // move_up = 3 on a net of four would send three of four players up: that is not movement, it is
  // swapping two nets wholesale and undoing the ranking that earned the places.
  const prev = [
    { net_no: 1, seats: [1, 2, 3, 4] },
    { net_no: 2, seats: [5, 6, 7, 8] },
  ];
  const r = nextRound(prev, scores([1, 2, 3, 4, 5, 6, 7, 8]), { moveUp: 3 });
  assert.ok(r.ok, r.error);
  assert.equal(r.move_up, 2, "half a net of four is two");
  assert.equal(r.clamped_from, 3, "the number the director asked for must be reported back");
  assert.match(r.note, /more than half a net/);
});

test("a director's move_up is honoured when it is workable, and is never computed for them", () => {
  /* Owner chose "Director sets it each session" over four candidate formulas, so the engine must not
     quietly impose one. Asserted two ways: the number is used, and no arithmetic on the net count
     appears in the source. */
  const prev = [
    { net_no: 1, seats: [1, 2, 3, 4] },
    { net_no: 2, seats: [5, 6, 7, 8] },
    { net_no: 3, seats: [9, 10, 11, 12] },
  ];
  const one = nextRound(prev, scores([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), { moveUp: 1 });
  const two = nextRound(prev, scores([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), { moveUp: 2 });
  assert.equal(one.move_up, 1);
  assert.equal(two.move_up, 2);
  assert.ok(two.moved > one.moved, "a larger move_up must actually move more people");
  assert.equal(one.clamped_from, null, "a workable number is not reported as clamped");

  // Nothing derives move_up from how many nets there are — no formula was encoded, deliberately.
  assert.ok(!/moveUp\s*=\s*[^;]*nets\.length/.test(SRC),
    "move_up must not be computed from the net count — the owner declined to fix a formula");
  assert.match(SRC, /director sets it each session/i,
    "the source must record whose decision this is");
});

test("an empty previous round is refused rather than producing an empty night", () => {
  assert.equal(nextRound([], [], { moveUp: 1 }).ok, false);
});

test("movement uses the round just played, not entry order", () => {
  // The whole point of "scores, which tally and then ranked and seeded". If the seeding order leaked
  // through, the nets would never change and the format would not be the format.
  const prev = [
    { net_no: 1, seats: [1, 2, 3, 4] },
    { net_no: 2, seats: [5, 6, 7, 8] },
  ];
  // Player 4 had the best round on net 1; player 1 had the worst. Player 8 topped net 2.
  const st = [
    { contact_id: 4, points: 63, wins: 3, point_diff: 30 },
    { contact_id: 3, points: 55, wins: 2, point_diff: 10 },
    { contact_id: 2, points: 50, wins: 1, point_diff: -5 },
    { contact_id: 1, points: 40, wins: 0, point_diff: -35 },
    { contact_id: 8, points: 60, wins: 3, point_diff: 25 },
    { contact_id: 7, points: 52, wins: 2, point_diff: 5 },
    { contact_id: 6, points: 48, wins: 1, point_diff: -10 },
    { contact_id: 5, points: 41, wins: 0, point_diff: -20 },
  ];
  const r = nextRound(prev, st, { moveUp: 1 });
  const where = (id) => r.nets.find((n) => n.seats.includes(id)).net_no;
  assert.equal(where(1), 2, "the seed who had the worst round goes down, whatever their entry order");
  assert.equal(where(8), 1, "and the bottom seed who topped their net goes up");
  assert.equal(r.nets[0].seats[0], 4, "seat 0 of net 1 is whoever actually won the round");
});

/* ================================ partner history ================================ */

test("partner history counts repeats and finds none inside a single round", () => {
  // Within a net every possible pairing is played exactly once, so one round can never contain a
  // repeat. If this ever reports one, the rotation is broken.
  const r = seedRound([1, 2, 3, 4, 5, 6, 7, 8]);
  const games = gamesForRound(r.nets);
  const h = partnerHistory(games);
  assert.deepEqual(h.repeats(), [], "a single round cannot repeat a pairing");
  assert.equal(h.count(1, 2), 1);
  assert.equal(h.count(2, 1), 1, "the pair is the same entry whichever way round it is asked");
  assert.equal(h.count(1, 5), 0, "players on different nets have not partnered");
  assert.equal(h.size, 6 + 6, "six pairs per net of four, two nets");
});

test("partner history accumulates across rounds and reports the worst repeats first", () => {
  // Two identical rounds: everybody has now partnered their net-mates twice.
  const r = seedRound([1, 2, 3, 4]);
  const twice = [...gamesForRound(r.nets), ...gamesForRound(r.nets)];
  const h = partnerHistory(twice);
  assert.equal(h.count(1, 2), 2);
  assert.equal(h.repeats().length, 6, "all six pairs of a net of four have now happened twice");
  assert.deepEqual(h.repeats()[0], { pair: [1, 2], times: 2 });

  const thrice = [...twice, ...gamesForRound(r.nets)];
  assert.equal(partnerHistory(thrice).repeats()[0].times, 3, "and it keeps counting");
});

test("the source records that partner repeats cannot be steered, because that is not obvious", () => {
  /* THE SPEC ASKED FOR SOMETHING THAT CANNOT EXIST. `docs/2026-08-03_spec_kotc_v1_1.md` §7 finding 1 (v1.0 §4 item 5)
     wants partnerHistory "so nextRound can prefer a fresh pairing when it has a free choice". There is
     no free choice: a net plays ALL its pairings. Whoever next reads this file will otherwise go
     looking for the optimiser the spec promised, so the finding is written down in the module and
     asserted here — an explanation nobody can delete by accident. */
  assert.match(SRC, /IT NEVER HAS A FREE CHOICE/,
    "the module must record why the spec's soft-constraint optimiser does not exist");
  assert.match(SRC, /reporting/i);
});

/* ================================ the format, end to end ================================ */

test("a whole night runs: seed, play, tally, move, and nobody is lost or duplicated", () => {
  // The pieces above are each right on their own. This is the assertion that they compose.
  const players = Array.from({ length: 20 }, (_, i) => i + 1);
  let nets = seedRound(players).nets;
  assert.deepEqual(nets.map((n) => n.seats.length), [4, 4, 4, 4, 4]);

  const played = [];
  for (let round = 1; round <= 4; round++) {
    const fixtures = gamesForRound(nets).map((g, i) => ({
      ...g,
      // Deterministic, varied scores — no clock, no randomness, and different every round.
      score_a: 21,
      score_b: (i * 5 + round * 3) % 20,
    }));
    played.push(...fixtures);

    const roundTally = tally(fixtures);
    assert.equal(roundTally.length, 20, `round ${round}: every player must appear in the tally`);
    for (const r of roundTally) assert.equal(r.games, 3, `round ${round}: player ${r.contact_id} played ${r.games} games, not 3`);

    const moved = nextRound(nets, roundTally, { moveUp: 1 });
    assert.ok(moved.ok, `round ${round}: ${moved.error}`);
    nets = moved.nets;

    const flat = nets.flatMap((n) => n.seats);
    assert.equal(flat.length, 20, `round ${round}: the field changed size`);
    assert.equal(new Set(flat).size, 20, `round ${round}: somebody is on two nets`);
  }

  // Four rounds of three games each.
  const night = tally(played);
  assert.equal(night.length, 20);
  for (const r of night) assert.equal(r.games, 12, `player ${r.contact_id} played ${r.games} of 12 games`);
  const leaderboard = rankPlayers(night);
  assert.equal(leaderboard.length, 20);
  assert.ok(leaderboard[0].points >= leaderboard[19].points, "the leaderboard must be ordered");

  // And the eight-game floor is cleared incidentally at four rounds — recorded, not enforced.
  // Owner 2026-08-03: "No — this format sets its own length."
  assert.ok(night.every((r) => r.games >= 8));
  assert.ok(!/MIN_GAMES|GAMES_FLOOR|eight.game floor is enforced/.test(SRC),
    "the pool-play game floor must NOT be enforced here — the owner ruled it does not apply");
});

/* ================================ failure class 1, now closed ================================ */

test("the engine is reachable: kotcplay.js is MOUNTED and WIRED (§6.5)", () => {
  /* THIS TEST REPLACES A RATCHET, EXACTLY AS THE RATCHET INSTRUCTED.
     v0.76.0 shipped this engine with no route and no screen — failure class 1 by construction ("built,
     tested, and uncalled"). Rather than note that in a handoff nobody re-reads, the gap was held open by
     a test asserting `index.js` did NOT mention `kotcRoutes`/`wireKotc`, whose failure message said:
     delete this and put the dispatch-chain assertion in its place. v0.80.0 wired it, that test went red,
     and this is the replacement. The mechanism worked: the gap could not be forgotten, because forgetting
     it was not possible while the suite was green.

     Standards §6.5: assert the CALL SITE, never the import line. Since v0.77.0 the call site is an entry
     in the isolated dispatch TABLE, so that is what is checked. */
  const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(index, /\["kotc",\s+kotcRoutes\],/,
    "kotcRoutes must appear in the dispatch table, not merely on an import line");
  assert.ok(mountsAndWires(index, "Kotc"), "wireKotc must be called, or the helpers are undefined");
  assert.match(index, /import \{[^}]*\bkotcRoutes\b/, "and it must be imported");

  // The ENGINE stays pure. Routes live in kotcplay.js so this module remains testable with no fixture,
  // and so the solver can be exercised without booting a router.
  assert.ok(!/kotcRoutes|wireKotc/.test(SRC),
    "kotc.js must stay a pure engine — routes belong in kotcplay.js");
  assert.ok(!/env\.DB|request\./.test(SRC),
    "kotc.js must not touch the database or a request; that is what makes every claim here provable");
});

test("the dispatch table puts kotc before live, so /api/kotc/:token reaches its owner", () => {
  // Order in the table decides which module wins an overlapping path. Both modules serve public,
  // token-or-header routes; if `live` were asked first and ever grew a /api/kotc prefix, a player's link
  // would resolve to a scoreboard. Cheap to assert, and invisible if it ever regressed.
  const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const kotc = index.indexOf('["kotc",');
  const live = index.indexOf('["live",');
  assert.ok(kotc > 0 && live > 0, "both modules must be mounted");
  assert.ok(kotc < live, "kotc must be dispatched before live");
});
