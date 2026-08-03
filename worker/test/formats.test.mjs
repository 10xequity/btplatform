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
