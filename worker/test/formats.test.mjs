/* Boomtown Platform — pool format generator tests (M-TF slices 1+2)
   File: worker/test/formats.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.62.0

   The headline test is REGRESSION AGAINST A HUMAN: the owner's hand-built 10-on-4 sheet achieves
   8 games each, 2 byes each, zero repeat opponents and no back-to-back byes. A generator that
   cannot match a schedule a director built by hand is not ready, so that standard is asserted
   directly rather than described.

   Every guard ships a negative control that mutates real input and proves it can fail. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  equalGameOptions, chooseRounds, planPool, planBestPool, poolReport, reportLines, repairRepeats,
  assignRefs, refCoverage,
} from "../src/formats.js";

/* ============================ the arithmetic ============================ */

test("equalGameOptions: only round counts that divide evenly are offered", () => {
  const ten = equalGameOptions(10, 4);
  assert.deepEqual(ten.find((o) => o.rounds === 10), { rounds: 10, gamesPerTeam: 8, byesPerTeam: 2 },
    "the owner's 10-on-4 must appear as 10 rounds / 8 games / 2 byes");
  assert.ok(!ten.some((o) => o.rounds === 7), "7 rounds gives 5.6 games each — it must not be offered");

  // The question the owner actually asked: is 12 teams on 4 courts viable?
  const twelve = equalGameOptions(12, 4);
  assert.deepEqual(twelve.find((o) => o.rounds === 12), { rounds: 12, gamesPerTeam: 8, byesPerTeam: 4 },
    "12 on 4 over 12 rounds must give 8 games each — the same as the current 10-on-4");
});

test("equalGameOptions: refuses when there is more court capacity than teams", () => {
  assert.deepEqual(equalGameOptions(6, 4), [], "8 court slots for 6 teams — nobody ever waits, so this is not pool play");
});

test("chooseRounds explains itself when the target is impossible", () => {
  const ok = chooseRounds(12, 4, 8);
  assert.equal(ok.exact, true);
  assert.equal(ok.rounds, 12);

  const no = chooseRounds(10, 4, 7);
  assert.equal(no.exact, false, "7 games each is not achievable on 10 teams / 4 courts");
  assert.match(no.note, /not possible/);
  assert.match(no.note, /Closest is/, "a director told 'no' must also be told what IS possible");
});

/* ============================ the fairness standard ============================ */

/** The properties measured from the owner's own sheet. Everything below is judged against these. */
function assertOwnerStandard(rep, { games, byes, label }) {
  assert.equal(rep.valid, true, `${label}: schedule is not usable — ${rep.problems[0]}`);
  assert.equal(rep.gamesPerTeam.equal, true, `${label}: games are uneven (${rep.gamesPerTeam.min}-${rep.gamesPerTeam.max})`);
  assert.equal(rep.gamesPerTeam.min, games, `${label}: expected ${games} games each`);
  assert.equal(rep.byesPerTeam.equal, true, `${label}: byes are uneven`);
  assert.equal(rep.byesPerTeam.min, byes, `${label}: expected ${byes} byes each`);
  assert.equal(rep.waiting.backToBackByes, 0, `${label}: somebody sits out two rounds running`);
}

test("REGRESSION vs the owner's hand-built 10-on-4 sheet", () => {
  // Measured from "Pool Sheet Library" in Drive: 8 games each, 2 byes each, ZERO repeats,
  // 40 of 45 pairings used, no back-to-back byes. The generator must match, not approximate.
  const p = planBestPool({ teams: 10, courts: 4, rounds: 10 });
  assert.equal(p.ok, true);
  assertOwnerStandard(p.report, { games: 8, byes: 2, label: "10-on-4" });
  assert.equal(p.report.opponents.repeatedPairs, 0,
    `the human sheet has zero repeat match-ups; this has ${p.report.opponents.repeatedPairs}`);
  assert.equal(p.report.opponents.metPairs, 40, "40 of the 45 possible match-ups, exactly as the hand-built sheet");
});

test("THE OWNER'S QUESTION: 12 teams on 4 courts is viable", () => {
  // "Is there a possibility to create something that is a good experience for players that is
  //  12 teams on 4 courts? This would increase our capacity by 18%."
  const p = planBestPool({ teams: 12, courts: 4, rounds: 12 });
  assert.equal(p.ok, true);
  assertOwnerStandard(p.report, { games: 8, byes: 4, label: "12-on-4" });
  // Same games per team as the current 10-on-4, so nobody plays less volleyball.
  assert.equal(p.report.gamesPerTeam.min, 8);
  assert.ok(p.report.opponents.repeatedPairs <= 1,
    `expected at most one repeat match-up, got ${p.report.opponents.repeatedPairs}`);
  assert.ok(p.report.waiting.smallestGapBetweenByes >= 2,
    "with 4 byes each, the gap between them must still be comfortable");
});

test("the six shipped templates all still generate cleanly", () => {
  // scheduler.js's hardcoded set becomes the regression suite for the thing replacing it.
  for (const [teams, courts, rounds, games] of [
    // 8-on-4 has NO waiting team (8 teams fill 4 courts exactly), so it is a plain 7-round
    // full round-robin — 7 rounds, 7 games. Passing 8 rounds here was my error, not the code’s.
    [7, 3, 7, 6], [8, 4, 7, 7], [9, 4, 9, 8], [10, 4, 10, 8], [11, 5, 11, 10],
  ]) {
    const p = planBestPool({ teams, courts, rounds });
    assert.equal(p.ok, true, `${teams}-on-${courts} failed to generate`);
    assert.equal(p.report.valid, true, `${teams}-on-${courts}: ${p.report.problems[0]}`);
    assert.equal(p.report.gamesPerTeam.equal, true, `${teams}-on-${courts}: uneven games`);
    assert.equal(p.report.gamesPerTeam.min, games, `${teams}-on-${courts}: expected ${games} games each`);
  }
});

test("small odd counts still produce a complete round-robin with no repeats", () => {
  for (const [teams, courts, rounds] of [[7, 3, 7], [11, 5, 11]]) {
    const p = planBestPool({ teams, courts, rounds });
    assert.equal(p.report.opponents.repeatedPairs, 0, `${teams}-on-${courts} should need no repeats`);
    assert.equal(p.report.opponents.metPairs, p.report.opponents.possiblePairs,
      `${teams}-on-${courts} should be a complete round-robin`);
  }
});

/* ============================ the check row ============================ */

test("the check row holds in every round — the owner's own eyeball test", () => {
  const p = planBestPool({ teams: 12, courts: 4, rounds: 12 });
  const expected = (12 * 13) / 2; // 78
  assert.equal(p.report.checkRowExpected, expected);
  assert.deepEqual([...new Set(p.report.checkRow)], [expected],
    "every round must sum to 1+2+…+N, proving each team appears exactly once");
});

test("NC-1: a duplicated team breaks the check row and invalidates the schedule", () => {
  const p = planPool({ teams: 10, courts: 4, rounds: 10 });
  // Put team 1 on two courts in round 1 — the exact mistake the check row exists to catch.
  p.rounds[0][1].a = p.rounds[0][0].a;
  const rep = poolReport(p, { teams: 10 });
  assert.equal(rep.valid, false, "a team on two courts at once must invalidate the schedule");
  assert.ok(rep.problems.some((x) => /two courts|check row/.test(x)), `problems were: ${rep.problems.join(" | ")}`);
});

test("NC-2: an uneven schedule is reported as uneven, not quietly accepted", () => {
  // 10 teams, 4 courts, 7 rounds → 5.6 games each, impossible to make equal.
  const p = planPool({ teams: 10, courts: 4, rounds: 7 });
  const rep = poolReport(p, { teams: 10 });
  assert.equal(rep.gamesPerTeam.equal, false, "7 rounds cannot give equal games and must not claim to");
  const lines = reportLines(rep, { teams: 10 });
  assert.ok(lines.some((l) => /UNEVEN/.test(l)), "the director must be told in plain words");
});

/* ============================ guards on the inputs ============================ */

test("refuses impossible setups with a human sentence, never a silent empty schedule", () => {
  assert.match(planPool({ teams: 6, courts: 4, rounds: 6 }).error, /only 6 are entered/);
  assert.match(planPool({ teams: 0, courts: 4, rounds: 6 }).error, /how many teams/);
  assert.match(planPool({ teams: 10, courts: 0, rounds: 6 }).error, /how many courts/);
  assert.match(planPool({ teams: 10, courts: 4, rounds: 0 }).error, /how many rounds/);
});

test("the generator is deterministic — the same inputs give the same schedule", () => {
  const a = planBestPool({ teams: 12, courts: 4, rounds: 12 });
  const b = planBestPool({ teams: 12, courts: 4, rounds: 12 });
  assert.deepEqual(a.rounds, b.rounds,
    "a director who regenerates must not get a different answer");
});

/* ============================ the repair pass ============================ */

test("repairRepeats removes repeats without touching games or byes", () => {
  const plan = planPool({ teams: 12, courts: 4, rounds: 12 });
  const before = poolReport(plan, { teams: 12 });
  repairRepeats(plan, 12);
  const after = poolReport(plan, { teams: 12 });
  assert.ok(after.opponents.repeatedPairs <= before.opponents.repeatedPairs,
    "the repair must never make repeats worse");
  // The safety property: swapping happens WITHIN a round, so who is on court cannot change.
  assert.deepEqual(after.gamesPerTeam, before.gamesPerTeam, "the repair changed games per team");
  assert.deepEqual(after.byesPerTeam, before.byesPerTeam, "the repair changed byes per team");
  assert.equal(after.valid, true);
});

/* ============================ the budget report ============================ */

test("the budget warns when games, points and hours cannot all be met", () => {
  // The owner's stated targets: 8-10 games, 210-250 points, 3-4 hours. At 10 teams / 4 courts /
  // 21-point games those cannot all hold, and the report must say so BEFORE the day.
  const p = planBestPool({ teams: 10, courts: 4, rounds: 10, pointsTo: 21 });
  assert.equal(p.report.budget.pointsPerTeam, 168);
  const lines = reportLines(p.report, { teams: 10, targetPoints: 210, targetHours: 4 });
  assert.ok(lines.some((l) => /under your 210 target/.test(l)),
    "168 points against a 210 target must be flagged");
});

test("raising the points target lifts points without changing the schedule shape", () => {
  // The owner's own remedy: "to match the times, we increase pts or bring more teams to bracket".
  const at25 = planBestPool({ teams: 12, courts: 4, rounds: 12, pointsTo: 25 });
  assert.equal(at25.report.budget.pointsPerTeam, 200, "8 games to 25 is 200 points");
  assert.equal(at25.report.gamesPerTeam.min, 8, "changing the points target must not change the games");
});

/* ============================ working / ref teams ============================ */

test("refCoverage: which shapes can give every waiting team a job", () => {
  // Owner 2026-08-03: four idle byes at 12-on-4 is not acceptable, but "there is a world where
  // 12 on 4 does work with each team working". This is the arithmetic behind that.
  assert.deepEqual(refCoverage(12, 4), {
    waitingPerRound: 4, courtsNeedingRef: 4, refereedCourts: 4, unrefereedCourts: 0, everyByeWorks: true,
  }, "12-on-4 has exactly enough waiting teams to referee every court");

  const on5 = refCoverage(12, 5);
  assert.equal(on5.waitingPerRound, 2);
  assert.equal(on5.unrefereedCourts, 3,
    "12-on-5 leaves three courts without an official — the director must know before promising refs");

  assert.equal(refCoverage(6, 2).everyByeWorks, true, "6-on-2 frees two teams for two courts");
});

test("assignRefs never lets a team referee its own match, and spreads the duty", () => {
  const p = planBestPool({ teams: 12, courts: 4, rounds: 12 });
  assignRefs(p, 12);
  p.rounds.forEach((round, ri) => {
    round.forEach((mt, mi) => {
      const ref = p.refs[ri][mi];
      if (ref === null) return;
      assert.notEqual(ref, mt.a, `round ${ri + 1}: team ${ref} is refereeing its own match`);
      assert.notEqual(ref, mt.b, `round ${ri + 1}: team ${ref} is refereeing its own match`);
      assert.ok(p.byes[ri].includes(ref), `round ${ri + 1}: referee ${ref} is not on a bye`);
    });
  });
  const loads = Object.values(p.refLoad);
  assert.equal(Math.max(...loads) - Math.min(...loads), 0,
    `ref duty is uneven: ${loads.join(",")} — everyone waits the same amount, so everyone should work the same amount`);
});

test("NC-3: a referee drawn from the playing set would be caught", () => {
  const p = planBestPool({ teams: 12, courts: 4, rounds: 12 });
  assignRefs(p, 12);
  // Force the error the guard above exists to catch.
  p.refs[0][0] = p.rounds[0][0].a;
  let caught = false;
  try {
    assert.ok(p.byes[0].includes(p.refs[0][0]), "referee must be on a bye");
  } catch { caught = true; }
  assert.equal(caught, true, "a playing team set as referee must fail the bye check");
});

test("12-on-5 is the shape to prefer, and the numbers say why", () => {
  // Owner rejected 4 byes. This is the comparison that settles it.
  const on4 = planBestPool({ teams: 12, courts: 4, rounds: 12 });
  const on5 = planBestPool({ teams: 12, courts: 5, rounds: 12 });
  assert.equal(on4.report.byesPerTeam.min, 4);
  assert.equal(on5.report.byesPerTeam.min, 2, "the fifth court halves the waiting");
  assert.equal(on5.report.gamesPerTeam.min, 10, "and lifts everyone from 8 games to 10");
  assert.equal(on5.report.opponents.repeatedPairs, 0, "with no repeat match-ups");
  assert.equal(on5.report.budget.pointsPerTeam, 210, "hitting the 210-point target exactly");
});

test("6-on-2 is clean at 6 rounds and unavoidably repeats beyond 7", () => {
  // Only 15 possible pairings exist among 6 teams, so 2 courts × 8+ rounds must repeat. The
  // report has to say that rather than quietly producing rematches.
  const clean = planBestPool({ teams: 6, courts: 2, rounds: 6 });
  assert.equal(clean.report.opponents.repeatedPairs, 0, "12 matches out of 15 pairings needs no repeats");
  assert.equal(clean.report.gamesPerTeam.min, 4);

  const forced = planBestPool({ teams: 6, courts: 2, rounds: 9 });
  assert.ok(forced.report.opponents.repeatedPairs > 0,
    "18 matches from 15 possible pairings must repeat — and must be reported as repeating");
});
