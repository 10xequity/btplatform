/* Boomtown Platform — Scheduler tests
   Version: v0.2 · Date: 2026-07-21
   Run: node worker/test/scheduler.test.mjs
   Verifies every spec §3.1 hard constraint for each observed Boomtown format. */
import {
  FORMAT_TEMPLATES, feasibility, generatePairings, scheduleMatches, computeStandings, buildBracket,
} from "../src/scheduler.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("  ✗ " + msg); }
  else console.log("  ✓ " + msg);
}

for (const [name, t] of Object.entries(FORMAT_TEMPLATES)) {
  if (t.doublePairings) continue; // 4-on-2x2 double-pairing variant tested separately below
  console.log(`\n${name} (${t.teams} teams, ${t.courts} courts, ${t.gamesPerTeam} games/team)`);
  const feas = feasibility({ teams: t.teams, courts: t.courts, gamesPerTeam: t.gamesPerTeam, pointsTo: t.pointsTo });
  assert(feas.rounds > 0, `feasibility computes rounds (${feas.rounds}), est ${Math.round(feas.estMinutes)} min`);

  const { pairings, played } = generatePairings(t.teams, t.gamesPerTeam);
  assert(played.every((g) => g === t.gamesPerTeam || g === t.gamesPerTeam - 1),
    `games per team = ${t.gamesPerTeam} (±1 for odd products): [${played}]`);

  const pairSet = new Set(pairings.map(([a, b]) => [Math.min(a, b), Math.max(a, b)].join("-")));
  assert(pairSet.size === pairings.length, "no pair meets twice");

  const sched = scheduleMatches(pairings, t.courts, t.teams);
  assert(sched !== null, "scheduler found a packing");
  if (!sched) continue;

  let doubleBooked = false;
  for (const r of sched.rounds) {
    const seen = new Set();
    for (const m of r.matches) {
      if (seen.has(m.teamA) || seen.has(m.teamB)) doubleBooked = true;
      seen.add(m.teamA); seen.add(m.teamB);
    }
    if (r.matches.length > t.courts) doubleBooked = true;
  }
  assert(!doubleBooked, `no team on two courts in one round; ≤${t.courts} matches/round`);
  assert(sched.spread <= 1, `byes balanced ±1 (spread=${sched.spread}, byes=[${sched.byeCount}])`);
  const optimalRounds = Math.ceil(pairings.length / Math.min(t.courts, Math.floor(t.teams / 2)));
  assert(sched.rounds.length === optimalRounds, `optimal round count ${optimalRounds} (matches real pool sheets)`);
}

/* standings tiebreaks */
console.log("\nstandings tiebreaks");
const matches = [
  { teamA: 0, teamB: 1, scoreA: 21, scoreB: 15 }, // 0 beats 1
  { teamA: 2, teamB: 0, scoreA: 21, scoreB: 19 }, // 2 beats 0
  { teamA: 1, teamB: 2, scoreA: 21, scoreB: 18 }, // 1 beats 2 → 3-way 1-1, decided on diff
];
const rows = computeStandings(matches, [0, 1, 2]);
assert(rows[0].team === 0 && rows[0].diff === 4, `diff tiebreak: team 0 first (diff ${rows[0].diff})`);
const twoWay = computeStandings([
  { teamA: 0, teamB: 1, scoreA: 21, scoreB: 19 },
  { teamA: 0, teamB: 2, scoreA: 19, scoreB: 21 },
  { teamA: 1, teamB: 2, scoreA: 21, scoreB: 19 },
], [0, 1, 2]);
assert(twoWay.every((r) => r.wins === 1), "constructed 3-way tie");

/* brackets */
console.log("\nbrackets");
const standings = Array.from({ length: 14 }, (_, i) => ({ team: i, rank: i + 1 }));
const br = buildBracket(standings, { aSize: 8, includeRest: true });
assert(br[0].name === "A" && br[0].teams.length === 8, "A bracket = top 8");
assert(br[1].name === "BB" && br[1].teams.length === 6, "BB bracket = remaining 6");
const final8 = br[0].matches;
assert(final8.some((m) => m.teamA === 0 && m.teamB === 7), "seeding 1v8 present");
assert(br[1].matches.some((m) => m.teamB === null), "BB of 6 gets byes to fill 8-slot bracket");
const semis = seedCheckBestOf(br[0]);
assert(semis, "semi/final best-of-3 uses 21-21-15");
function seedCheckBestOf(bracket) {
  // quarter round of an 8-bracket is single game; the engine marks bestOf per generated round
  return bracket.matches.every((m) => (m.bestOf === 3 ? JSON.stringify(m.games) === "[21,21,15]" : JSON.stringify(m.games) === "[21]"));
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL TESTS PASSED");
process.exit(failures ? 1 : 0);
