/* Boomtown Platform — KOTC scoring: everyone is a captain, and the gaps are solved for
   File: worker/test/kotc_scoring.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.79.0

   Owner 2026-08-03: "each individual is a captain, 1 person can input scores for everyone or each person
   can put in scores. If most of the data is entered, build the math logic to calculate the final missing
   person(s) based on constraints or given data for the algebra."

   A SOLVER THAT GUESSES IS WORSE THAN NO SOLVER, so the tests are built around two properties and not
   around examples:

     1. ROUND TRIP. Take a real round, throw away the scores, keep only what a person would have typed,
        and the solver must recover the original EXACTLY — or say honestly that it cannot. Run over every
        combination of what might be missing, not three hand-picked cases.
     2. NEVER INVENT. Where the evidence genuinely admits two answers, the game must come back
        unresolved with its candidates. A plausible invented scoreline looks like a result, ranks
        people, and nobody ever finds out it was fiction.

   No clock, no database, no randomness in the assertions — every "random" round below is generated from
   a fixed integer sequence so a failure is reproducible. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeCandidates, marginsFromTotals, solveNet, reconcile } from "../src/kotc.js";

const SEATS = [1, 2, 3, 4];
/** The three pairings of a net of four, in seat-id terms. */
const NET4 = [
  { game_no: 1, a1: 1, a2: 2, b1: 3, b2: 4 },
  { game_no: 2, a1: 1, a2: 3, b1: 2, b2: 4 },
  { game_no: 3, a1: 1, a2: 4, b1: 2, b2: 3 },
];
const blank = () => NET4.map((g) => ({ ...g, score_a: null, score_b: null }));

/** Player totals implied by a real set of three scorelines. */
function totalsFor(scores, games = NET4) {
  const t = {};
  games.forEach((g, i) => {
    const [a, b] = scores[i];
    for (const id of [g.a1, g.a2]) t[id] = (t[id] || 0) + a;
    for (const id of [g.b1, g.b2]) t[id] = (t[id] || 0) + b;
  });
  return t;
}

/** Every shape-valid scoreline, as [winner, loser] pairs, for pointsTo = 21 win-by-2. */
function legalScorelines() {
  const out = [];
  for (let l = 0; l <= 19; l++) out.push([21, l]);
  for (let w = 22; w <= 31; w++) out.push([w, w - 2]);
  return out;
}

/** A deterministic pseudo-random sequence, so a failure is reproducible. */
function seq(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/* ================================ the shape of a volleyball score ================================ */

test("a game can only end on the number, or by exactly two past it", () => {
  /* THE CONSTRAINT THAT MAKES ANY OF THIS SOLVABLE. A game is not two free numbers — it is one unknown
     (its total) plus which side won. Owner chose first-to-21 with no cap, and volleyball is won by two. */
  const c = shapeCandidates({}, { pointsTo: 21 });
  for (const { score_a: a, score_b: b } of c) {
    const w = Math.max(a, b), l = Math.min(a, b);
    assert.ok(w >= 21, `${a}-${b}: nobody wins below the target`);
    assert.ok(w - l >= 2, `${a}-${b}: volleyball is won by two`);
    assert.ok(w === 21 || w - l === 2, `${a}-${b}: past the target, the margin must be exactly two`);
  }
  // Both orientations of every scoreline, and no duplicates.
  assert.equal(new Set(c.map((x) => `${x.score_a}-${x.score_b}`)).size, c.length);
  assert.ok(c.some((x) => x.score_a === 21 && x.score_b === 0), "21-0 is legal");
  assert.ok(c.some((x) => x.score_a === 0 && x.score_b === 21), "so is 0-21");
  assert.ok(!c.some((x) => x.score_a === 21 && x.score_b === 20), "21-20 is not a finished game");
  assert.ok(!c.some((x) => x.score_a === 20 && x.score_b === 19), "and neither is 20-19");
});

test("a known score narrows the candidates to exactly the ones that match", () => {
  // The people who were there outrank any inference: a value that is present is taken as fact.
  const both = shapeCandidates({ score_a: 21, score_b: 15 }, { pointsTo: 21 });
  assert.deepEqual(both, [{ score_a: 21, score_b: 15 }]);

  const oneSide = shapeCandidates({ score_a: 21, score_b: null }, { pointsTo: 21 });
  assert.ok(oneSide.every((x) => x.score_a === 21));
  // 21 beating 0 through 19 is twenty scorelines — AND 21 can also be the LOSING score, in 23-21. So a
  // single known side leaves 21 possibilities, not 20. Worth being exact about: this asymmetry is why
  // one player's total pins one side of a game and not the whole game.
  assert.equal(oneSide.length, 21);
  assert.ok(oneSide.some((x) => x.score_b === 19), "21-19 is the narrowest win");
  assert.ok(oneSide.some((x) => x.score_b === 23), "and 23-21 means the 21 lost");

  const impossible = shapeCandidates({ score_a: 15, score_b: 14 }, { pointsTo: 21 });
  assert.deepEqual(impossible, [], "a scoreline no game can end on has no candidates at all");
});

test("win-by-one is supported, because a director may choose it", () => {
  // Hardcoding volleyball's two-point rule would silently reject every game of a session that did not
  // play it, and the rejection would look like corrupt data rather than a setting.
  const c = shapeCandidates({}, { pointsTo: 21, winBy: 1 });
  assert.ok(c.some((x) => x.score_a === 21 && x.score_b === 20), "21-20 must be legal when winBy is 1");
  assert.ok(!c.some((x) => x.score_a === 21 && x.score_b === 21), "a tie is never a finished game");
});

/* ================================ the closed form ================================ */

test("all three margins and the round total come out of the four player totals", () => {
  /* d1 = (A+B-C-D)/2, d2 = (A+C-B-D)/2, d3 = (A+D-B-C)/2, and T1+T2+T3 = (A+B+C+D)/2.
     Verified over 4000 randomised shape-valid rounds before this was written into the module; asserted
     here over every combination of a representative set, because the formula is the load-bearing claim. */
  const sample = [[21, 15], [18, 21], [21, 12], [21, 19], [23, 21], [21, 0], [26, 24]];
  let checked = 0;
  for (const g1 of sample) for (const g2 of sample) for (const g3 of sample) {
    const scores = [g1, g2, g3];
    const m = marginsFromTotals(SEATS, totalsFor(scores), { pointsTo: 21 });
    assert.equal(m.ok, true, `${JSON.stringify(scores)}: ${m.error}`);
    assert.deepEqual(m.margins, scores.map(([a, b]) => a - b), "a margin came out wrong");
    assert.equal(m.total, scores.reduce((t, [a, b]) => t + a + b, 0), "the round total came out wrong");
    // A margin wider than two can only have come from a game that ended ON the number.
    scores.forEach(([a, b], i) => {
      if (Math.abs(a - b) > 2) assert.equal(m.pinned[i], a + b, "a wide margin must pin that game's total");
      else assert.equal(m.pinned[i], null, "a margin of two must be left ambiguous");
    });
    checked++;
  }
  assert.equal(checked, sample.length ** 3);
});

test("totals that no round could produce are refused, not solved around", () => {
  /* Every margin is (sum ± sum) / 2, so an odd numerator is arithmetic proof that somebody mistyped.
     Saying so is far more useful than solving a system with no solution. */
  const good = totalsFor([[21, 15], [18, 21], [21, 12]]);
  assert.equal(marginsFromTotals(SEATS, good, { pointsTo: 21 }).ok, true, "precondition");

  const off = { ...good, 1: good[1] + 1 };
  const bad = marginsFromTotals(SEATS, off, { pointsTo: 21 });
  assert.equal(bad.ok, false, "one total out by one must be caught");
  assert.match(bad.error, /out by an odd number|odd number/);

  assert.equal(marginsFromTotals(SEATS, { 1: 60, 2: 54, 3: 45 }, {}).ok, false, "a missing total cannot be solved this way");
  assert.equal(marginsFromTotals([1, 2, 3], good, {}).ok, false, "the closed form is for four players");
});

test("totals implying a game won by less than two are refused", () => {
  // A tie or a one-point win is not a finished volleyball game. Totals that imply one are wrong, and the
  // solver must not quietly produce a scoreline for them.
  const r = marginsFromTotals(SEATS, { 1: 42, 2: 42, 3: 42, 4: 42 }, { pointsTo: 21 });
  assert.equal(r.ok, false);
  assert.match(r.error, /cannot happen/);
});

/* ================================ round trip: recover a real round ================================ */

test("four player totals alone reconstruct all six scores, over many real rounds", () => {
  /* THE OWNER'S ACTUAL REQUEST — "calculate the final missing person(s)". The missing person's numbers
     were never independent: with all four totals the whole round follows. Run over 200 deterministic
     rounds rather than a handful, because a solver that is right on 21-15 and wrong on 23-21 is a solver
     that fails on the one game somebody argues about. */
  const legal = legalScorelines();
  const rnd = seq(20260803);
  let recovered = 0, ambiguous = 0;

  for (let t = 0; t < 200; t++) {
    const scores = [0, 1, 2].map(() => {
      const [w, l] = legal[Math.floor(rnd() * legal.length)];
      return rnd() < 0.5 ? [w, l] : [l, w];
    });
    const r = solveNet(blank(), totalsFor(scores), { seats: SEATS, pointsTo: 21 });

    if (r.ok) {
      recovered++;
      r.games.forEach((g, i) => {
        assert.deepEqual([g.score_a, g.score_b], scores[i],
          `round ${t} game ${i + 1}: solved ${g.score_a}-${g.score_b}, actually ${scores[i]}`);
        assert.equal(g.derived, true, "a score nobody typed in must be marked derived");
      });
    } else {
      // Not solvable is allowed — inventing an answer is not. If it declined, the real round must be
      // among the candidates it offered, or the solver is simply wrong rather than cautious.
      ambiguous++;
      assert.equal(r.contradiction, null, `round ${t} was called a contradiction but is real: ${JSON.stringify(scores)}`);
      for (const g of r.games) {
        if (g.resolved) continue;
        const want = `${scores[g.game_no - 1][0]}-${scores[g.game_no - 1][1]}`;
        assert.ok(g.candidates.includes(want),
          `round ${t} game ${g.game_no}: the real score ${want} was not among ${g.candidates}`);
      }
    }
  }
  /* WHY NOT ALL 200, AND WHY THAT IS ARITHMETIC RATHER THAN A SHORTFALL. A margin of exactly two is the
     one thing the totals cannot resolve on their own: 21-19, 22-20, 23-21 and so on all have margin two.
     The closed form pins every game whose margin is WIDER than two, so a round is solvable outright when
     at most ONE of its three games finished by two. In this generator a margin of two comes up in 11 of
     30 scorelines, which puts the solvable share near 70% — and the measured figure sits right there.
     The other 30% are correctly reported unresolved, with the real score among the candidates, which the
     loop above has already asserted. */
  assert.ok(recovered >= 120, `expected roughly 70% to solve outright, got ${recovered}/200`);
  assert.equal(recovered + ambiguous, 200, "every round must be either solved or honestly declined");
});

test("what makes a round ambiguous is the round total, not just the count of narrow margins", () => {
  /* MY FIRST VERSION OF THIS TEST WAS WRONG AND THE SOLVER WAS RIGHT — recorded because the intuition is
     appealing and false. I asserted that two games finishing by exactly two makes a round ambiguous. It
     does not, because those games still have a MINIMUM total: a margin-two game is at least 21-19, i.e.
     40 points. So two margin-two games whose combined total is exactly 80 can only have been 40 and 40,
     and the round is fully determined.

     The real rule: the closed form pins every game whose margin exceeds two, and the round total then has
     to be split among the margin-two games. Ambiguity exists only when that split can be made more than
     one way. */
  const wide = [21, 15];        // margin 6  → total pinned at 36
  const narrow = [21, 19];      // margin 2  → total 40, the floor
  const over = [22, 20];        // margin 2  → total 42

  const cases = [
    [[wide, wide, wide], true, "no narrow margins at all"],
    [[narrow, wide, wide], true, "one narrow margin, resolved by subtraction"],
    [[wide, wide, over], true, "one narrow margin, past the number"],
    [[narrow, narrow, wide], true, "TWO narrow margins, but 80 can only be 40+40"],
    [[narrow, narrow, narrow], true, "three narrow margins, and 120 can only be 40+40+40"],
    [[narrow, over, wide], false, "82 splits as 40+42 or 42+40 — genuinely ambiguous"],
    [[over, over, wide], false, "84 splits three ways"],
  ];
  for (const [scores, shouldSolve, why] of cases) {
    const r = solveNet(blank(), totalsFor(scores), { seats: SEATS, pointsTo: 21 });
    assert.equal(r.ok, shouldSolve,
      `${JSON.stringify(scores)} (${why}): expected ${shouldSolve ? "solvable" : "ambiguous"}, got ${r.ok} — ${r.note}`);
    if (shouldSolve) {
      r.games.forEach((g, i) => assert.deepEqual([g.score_a, g.score_b], scores[i], why));
    } else {
      assert.ok(r.unresolved.length >= 2, why);
      // Never invented: the real scores must still be among the candidates offered.
      for (const g of r.games.filter((x) => !x.resolved)) {
        const want = `${scores[g.game_no - 1][0]}-${scores[g.game_no - 1][1]}`;
        assert.ok(g.candidates.includes(want), `${why}: real score ${want} missing from ${g.candidates}`);
      }
    }
  }
});

test("one player who never reported is no obstacle — three totals plus one game is enough", () => {
  // The literal shape of the owner's request: most of the data is in, one person did not report.
  const scores = [[21, 15], [18, 21], [21, 12]];
  const all = totalsFor(scores);
  const three = { 1: all[1], 2: all[2], 3: all[3] };            // player 4 said nothing

  const games = blank();
  games[0].score_a = 21; games[0].score_b = 15;                  // somebody typed in game 1
  const r = solveNet(games, three, { seats: SEATS, pointsTo: 21 });
  assert.equal(r.ok, true, r.note || r.contradiction);
  r.games.forEach((g, i) => assert.deepEqual([g.score_a, g.score_b], scores[i]));
  assert.equal(r.games[0].derived, false, "a score that was typed in is not derived");
  assert.ok(r.games[1].derived && r.games[2].derived, "the other two must be marked as worked out");
  assert.match(r.note, /Worked out 2 missing scores/);
});

test("two games entered and no totals at all still leaves the third unknown", () => {
  /* AND IT MUST SAY SO. Three games are independent without any totals to tie them together, so the
     third genuinely could have finished many ways. This is the case where a solver that guesses does its
     damage, because two-thirds of the round being right makes the invented third look trustworthy. */
  const games = blank();
  games[0].score_a = 21; games[0].score_b = 15;
  games[1].score_a = 18; games[1].score_b = 21;
  const r = solveNet(games, {}, { seats: SEATS, pointsTo: 21 });
  assert.equal(r.ok, false, "the third game is not determined and must not be reported as solved");
  assert.deepEqual(r.unresolved, [3]);
  assert.equal(r.contradiction, null, "unknown is not the same as contradictory");
  assert.ok(r.games[2].candidates.length > 1, "and the possibilities must be offered");
  assert.match(r.note, /one more score/);
  // The two that WERE entered must come back untouched.
  assert.deepEqual([r.games[0].score_a, r.games[0].score_b], [21, 15]);
  assert.deepEqual([r.games[1].score_a, r.games[1].score_b], [18, 21]);
});

test("ONE player's total pins one side of the last game, not the whole game", () => {
  /* A LIMIT WORTH WRITING DOWN, because the intuition is wrong and I got it wrong first. A player's total
     is the sum of THEIR side's scores, so it determines their side of the missing game and says nothing
     about the opponent's. Then the shape rule still allows 21 to have beaten anything from 0 to 19. So one
     total is not enough, and a solver that answered anyway would be inventing the loser's score. */
  const scores = [[21, 15], [18, 21], [21, 12]];
  const games = blank();
  games[0].score_a = 21; games[0].score_b = 15;
  games[1].score_a = 18; games[1].score_b = 21;
  const t = totalsFor(scores);

  const one = solveNet(games, { 1: t[1] }, { seats: SEATS, pointsTo: 21 });
  assert.equal(one.ok, false, "one total must NOT be treated as enough");
  assert.deepEqual(one.unresolved, [3]);
  assert.ok(one.games[2].candidates.every((c) => c.startsWith("21-")),
    `player 1's side IS pinned at 21 — only the opponent is open: ${one.games[2].candidates}`);
  assert.ok(one.games[2].candidates.includes("21-12"), "and the real score is among them");
});

test("two totals from OPPOSITE sides finish the round", () => {
  // The actual minimum. Player 1 is on side A of game 3 and player 2 is on side B, so between them both
  // scores are determined — and this is the cheapest honest ask of a human at the net.
  const scores = [[21, 15], [18, 21], [21, 12]];
  const games = blank();
  games[0].score_a = 21; games[0].score_b = 15;
  games[1].score_a = 18; games[1].score_b = 21;
  const t = totalsFor(scores);
  const r = solveNet(games, { 1: t[1], 2: t[2] }, { seats: SEATS, pointsTo: 21 });
  assert.equal(r.ok, true, r.note || r.contradiction);
  assert.deepEqual([r.games[2].score_a, r.games[2].score_b], [21, 12]);
  assert.equal(r.games[2].derived, true);
});

test("evidence that cannot all be true is called a contradiction, not solved", () => {
  /* The difference that matters to a director: "I need one more number" and "one of these numbers is
     wrong" are different problems with different actions, and a solver that reports the first for both
     sends somebody hunting for data they already have. */
  const games = blank();
  games[0].score_a = 21; games[0].score_b = 15;
  const r = solveNet(games, { 1: 5 }, { seats: SEATS, pointsTo: 21 });
  assert.equal(r.ok, false);
  assert.ok(r.contradiction, "a player total below a game they already won must be impossible");
  assert.match(r.contradiction, /cannot all be right|Check the sheet/);
});

test("a typed-in score that no game can end on is rejected by shape alone", () => {
  const games = blank();
  games[1].score_a = 15; games[1].score_b = 14;
  const r = solveNet(games, {}, { seats: SEATS, pointsTo: 21 });
  assert.equal(r.ok, false);
  assert.equal(r.from, "shape", "this needs no search — the scoreline is impossible on its face");
  assert.match(r.contradiction, /Game 2/);
});

test("a fully entered round is left exactly as entered", () => {
  // The commonest case of all, and the one where a solver must do nothing at all.
  const games = blank();
  const scores = [[21, 15], [18, 21], [21, 12]];
  games.forEach((g, i) => { g.score_a = scores[i][0]; g.score_b = scores[i][1]; });
  const r = solveNet(games, {}, { seats: SEATS, pointsTo: 21 });
  assert.equal(r.ok, true);
  assert.equal(r.solved, 0, "nothing was missing, so nothing was worked out");
  r.games.forEach((g, i) => {
    assert.deepEqual([g.score_a, g.score_b], scores[i]);
    assert.equal(g.derived, false);
  });
  assert.match(r.note, /already entered/);
});

test("a net of five is solvable too, from its games plus one total", () => {
  // Nets of five happen when the field is not a multiple of four. Five games, ten pairings, and the same
  // machinery — the search prunes on reported totals rather than relying on the closed form, which is a
  // net-of-four result only.
  const seats5 = [1, 2, 3, 4, 5];
  const games5 = [];
  for (let k = 0; k < 5; k++) {
    const at = (n) => seats5[(k + n) % 5];
    games5.push({ game_no: k + 1, a1: at(1), a2: at(4), b1: at(2), b2: at(3), score_a: null, score_b: null });
  }
  const truth = [[21, 15], [12, 21], [21, 8], [19, 21], [21, 17]];
  const t5 = totalsFor(truth, games5);

  const entered = games5.map((g, i) => (i < 4 ? { ...g, score_a: truth[i][0], score_b: truth[i][1] } : { ...g }));
  // Two totals, from players on OPPOSITE sides of the missing game — one total pins one side only.
  const last = games5[4];
  const r = solveNet(entered, { [last.a1]: t5[last.a1], [last.b1]: t5[last.b1] }, { seats: seats5, pointsTo: 21 });
  assert.equal(r.ok, true, r.note || r.contradiction);
  assert.deepEqual([r.games[4].score_a, r.games[4].score_b], truth[4]);
  assert.equal(r.games[4].derived, true);
  // The four that were typed in must be untouched, and the closed form must NOT have been used — it is a
  // net-of-four result and applying it to five players would be silently wrong.
  for (let i = 0; i < 4; i++) assert.deepEqual([r.games[i].score_a, r.games[i].score_b], truth[i]);
  assert.equal(r.from, "search");
});

test("NC: the solver can fail to solve — with no evidence at all it resolves nothing", () => {
  /* Without this, a solver returning a canned success would satisfy the round-trip tests. Nothing
     entered and nothing reported must resolve nothing, and must not be reported as a contradiction
     either — an empty net is a normal state at the start of a round. */
  const r = solveNet(blank(), {}, { seats: SEATS, pointsTo: 21 });
  assert.equal(r.ok, false);
  assert.equal(r.solved, 0);
  assert.deepEqual(r.unresolved, [1, 2, 3]);
  assert.equal(r.contradiction, null, "an empty net is not corrupt data");
});

/* ================================ several people, one net ================================ */

test("everyone agreeing is agreement; anyone differing is a dispute, and the game stays unset", () => {
  /* Owner: "1 person can input scores for everyone or each person can put in scores." On a net of four
     all four players saw every game, so the same game arriving twice is normal — and so is the two
     versions differing. "Last write wins" would silently pick a side in an argument the software never
     told anybody was happening. */
  const r = reconcile([
    { by: 1, games: [{ game_no: 1, score_a: 21, score_b: 15 }, { game_no: 2, score_a: 18, score_b: 21 }] },
    { by: 3, games: [{ game_no: 1, score_a: 21, score_b: 15 }, { game_no: 2, score_a: 19, score_b: 21 }] },
  ]);
  assert.equal(r.agreed.length, 1, "only game 1 was agreed");
  assert.deepEqual([r.agreed[0].game_no, r.agreed[0].score_a, r.agreed[0].score_b], [1, 21, 15]);
  assert.deepEqual(r.agreed[0].reported_by, [1, 3], "who said so must travel with it");

  assert.equal(r.disputes.length, 1);
  assert.equal(r.disputes[0].game_no, 2);
  assert.deepEqual(r.disputes[0].versions.map((v) => v.score).sort(), ["18-21", "19-21"]);
  assert.match(r.note, /somebody needs to say which is right/);
  // The disputed game must NOT appear as agreed — an unset game is visibly unfinished; a wrong one that
  // has quietly picked a side looks finished.
  assert.ok(!r.agreed.some((g) => g.game_no === 2));
});

test("one person entering the whole net is enough, and needs no reconciliation", () => {
  const r = reconcile([
    { by: 2, games: [
      { game_no: 1, score_a: 21, score_b: 15 },
      { game_no: 2, score_a: 18, score_b: 21 },
      { game_no: 3, score_a: 21, score_b: 12 },
    ] },
  ]);
  assert.equal(r.agreed.length, 3);
  assert.deepEqual(r.disputes, []);
  assert.equal(r.note, null, "no dispute means no note at all, not an empty sentence");
});

test("reconciled reports feed straight into the solver", () => {
  // The two halves are meant to compose: several people report fragments, reconcile merges them, the
  // solver finishes the round. Asserted together because each being right alone proves nothing about the
  // pair.
  const scores = [[21, 15], [18, 21], [21, 12]];
  const t = totalsFor(scores);
  // Three of the four reported a total; one game was typed in. Two totals from opposite sides of the
  // missing game would also do — one alone would not, per the limit asserted above.
  const merged = reconcile([
    { by: 1, games: [{ game_no: 1, score_a: 21, score_b: 15 }], totals: { 1: t[1] } },
    { by: 2, totals: { 2: t[2] } },
    { by: 4, games: [{ game_no: 2, score_a: 18, score_b: 21 }], totals: { 4: t[4] } },
  ]);
  assert.deepEqual(merged.disputes, []);
  const games = blank();
  for (const g of merged.agreed) {
    const target = games.find((x) => x.game_no === g.game_no);
    target.score_a = g.score_a; target.score_b = g.score_b;
  }
  const r = solveNet(games, merged.totals, { seats: SEATS, pointsTo: 21 });
  assert.equal(r.ok, true, r.note || r.contradiction);
  assert.deepEqual([r.games[2].score_a, r.games[2].score_b], [21, 12]);
});

test("partial reports with no scores at all are harmless", () => {
  // Somebody opens the screen and submits nothing. Common, and must not produce a phantom game.
  const r = reconcile([{ by: 1, games: [{ game_no: 1, score_a: null, score_b: null }] }, { by: 2 }]);
  assert.deepEqual(r.agreed, []);
  assert.deepEqual(r.disputes, []);
  assert.deepEqual(r.totals, {});
  assert.equal(reconcile([]).agreed.length, 0);
  assert.equal(reconcile(null).agreed.length, 0, "no reports at all must not throw");
});
