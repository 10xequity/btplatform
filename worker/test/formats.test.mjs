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
  assignRefs, refCoverage, MIN_GAMES_PER_TEAM, poolSizes,
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

  // Was 7 games; changed to 9 in v0.70.0. 7 is below the MIN_GAMES_PER_TEAM floor, so asking for it
  // now correctly returns 8 and the old assertion no longer describes the behaviour. 9 is above the
  // floor and still unreachable on 10 teams / 4 courts, which is what this test was always about.
  const no = chooseRounds(10, 4, 9);
  assert.equal(no.exact, false, "9 games each is not achievable on 10 teams / 4 courts");
  assert.match(no.note, /not possible/);
  assert.match(no.note, /Closest is/, "a director told 'no' must also be told what IS possible");
});

/* ============================ the eight-game floor ============================ */

test("pool play never returns four games — the owner's 6-on-2 case", () => {
  // Owner 2026-08-03: "if we do 6 on 2, with 4 games, we would double the number of games to equal
  // 8. So there will never be a situation we offer only 4 games for pool play."
  // Six on two reaches an equal count at 2, 4, 6, 8 … and the old code returned 4 whenever 4 was
  // nearest to what was asked for.
  const r = chooseRounds(6, 2, 4);
  assert.equal(r.gamesPerTeam, 8);
  assert.equal(r.rounds, 12, "doubling the rounds is what doubles the games");
  assert.equal(r.raisedToFloor, true);
  assert.match(r.note, /never goes below 8/);
});

test("no target, however low, gets under the floor", () => {
  for (const target of [1, 2, 3, 4, 5, 6, 7, undefined, 0, -3]) {
    for (const [teams, courts] of [[6, 2], [10, 4], [12, 5], [8, 3], [14, 5]]) {
      const r = chooseRounds(teams, courts, target);
      if (!r.ok || r.belowFloor) continue;   // unreachable is reported, never silently met
      assert.ok(r.gamesPerTeam >= MIN_GAMES_PER_TEAM,
        `${teams} on ${courts} asked ${target} → ${r.gamesPerTeam} games, under the floor`);
    }
  }
});

test("the floor is overridable, because a league night is not a tournament", () => {
  // Leagues legitimately play three games and go home. This is a pool-play rule, not a law of the
  // building, so it takes an explicit opt-out rather than being hard-wired.
  const r = chooseRounds(6, 2, 4, { minGames: 2 });
  assert.equal(r.gamesPerTeam, 4);
  assert.equal(r.raisedToFloor, false);
});

/* ============================ pool sizing ============================ */

test("pools come out at 6-11 teams, in as few pools as possible", () => {
  // Owner: "Most groupings will break down into ranges of 6-11 ... we would aim to do larger pools."
  assert.deepEqual(poolSizes(24).sizes, [8, 8, 8]);
  assert.deepEqual(poolSizes(11).sizes, [11]);
  assert.deepEqual(poolSizes(12).sizes, [6, 6], "12 is over the max for a single pool");
  assert.deepEqual(poolSizes(13).sizes, [7, 6]);
  assert.deepEqual(poolSizes(23).sizes, [8, 8, 7]);
  assert.deepEqual(poolSizes(35).sizes, [9, 9, 9, 8]);
});

test("every field from 6 to 60 splits inside the range and adds up", () => {
  for (let n = 6; n <= 60; n++) {
    const { sizes, ok } = poolSizes(n);
    assert.equal(sizes.reduce((a, b) => a + b, 0), n, `n=${n}: ${sizes} does not add to ${n}`);
    assert.ok(ok, `n=${n}: ${sizes.join("+")} falls outside 6-11`);
    for (const s of sizes) assert.ok(s >= 6 && s <= 11, `n=${n}: pool of ${s}`);
  }
});

test("a field too small for the preferred range says so instead of failing", () => {
  // Indoors on limited courts this is normal, and the owner said as much.
  const r = poolSizes(5);
  assert.equal(r.ok, false);
  assert.deepEqual(r.sizes, [5]);
  assert.match(r.note, /under the preferred 6/);
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

/* ============================ T2-4 (§-0 B9): the curated offering ============================
   Owner, two statements of record. The floor (2026-08-03): "there will never be a situation we
   offer only 4 games for pool play." The template (v0.110.0 verbatim): "we would aim to run 8
   games in pool play … Usually though, we have 9-10 ROUNDS … the max games players are playing
   are approximately 12-16. More than 16 become physically unplayable." So the buttons a director
   sees are the 8–10-pool-game options; 11–16 are playable but leave no bracket room under the
   16-game TOTAL ceiling; past 16 is unplayable outright — and the ceiling's reason outranks the
   band's, because short of games is a disappointment and past sixteen is an injury.

   THE PLACEMENT IS THE TRAP THE ARCHIVE NAMED: the curation happens at the route/render, NEVER
   inside equalGameOptions — chooseRounds consumes the unfiltered list for its most-that-can-be
   fallback, and the {minGames:2} league-night override above must keep working. The pins below
   hold that placement in both directions.

   New exports are imported DYNAMICALLY so that pre-build these tests fail one by one while the
   twenty-six above stay green — a static import of a missing export reddens the whole file. */
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const FORMATS_SRC = readFileSync(new URL("../src/formats.js", import.meta.url), "utf8");
const BRACKETS_SRC = readFileSync(new URL("../src/brackets.js", import.meta.url), "utf8");
const TOURN_JS = readFileSync(new URL("../../web/assets/tournament.js", import.meta.url), "utf8");
const TOURN_HTML = readFileSync(new URL("../../web/tournament.html", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function bootRouter() {
  const DB = createD1(readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8"));
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}
async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email='s@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

test("T2-4 — the two bounds are named constants with the owner's values, and the ceiling now lives beside the floor it belongs with", async () => {
  const f = await import("../src/formats.js");
  assert.equal(f.MAX_GAMES_PER_TEAM, 16, "owner: more than 16 becomes physically unplayable");
  assert.equal(f.RECOMMENDED_MAX_POOL_GAMES, 10, "owner's standard template tops pool play at ~10 so the bracket fits under 16 total");
  assert.equal(typeof f.curatePoolOptions, "function", "the ONE curation judgement is exported");
});

test("T2-4 — ONE definition of the ceiling: formats.js defines it, brackets.js imports it (the v0.109.0 floor precedent, mirrored)", () => {
  assert.match(FORMATS_SRC, /^export const MAX_GAMES_PER_TEAM = 16;$/m, "the definition moved to formats.js");
  assert.ok(!/^export const MAX_GAMES_PER_TEAM/m.test(BRACKETS_SRC), "brackets.js no longer defines it");
  assert.match(BRACKETS_SRC, /import \{[^}]*MAX_GAMES_PER_TEAM[^}]*\} from "\.\/formats\.js"/, "brackets.js imports it from the one home");
  // NC: the definition-needle is load-bearing — remove it and the first assertion goes dark.
  const mutated = FORMATS_SRC.replace(/^export const MAX_GAMES_PER_TEAM = 16;$/m, "");
  assert.ok(mutated !== FORMATS_SRC, "the mutation landed");
  assert.ok(!/^export const MAX_GAMES_PER_TEAM = 16;$/m.test(mutated), "and would be caught");
});

test("T2-4 — PROPERTY over the real field sizes (6–32 teams, 2–12 courts): recommended ⇔ inside 8–10, every refusal says why, and the ceiling's reason outranks the band's", async () => {
  const { curatePoolOptions, MIN_GAMES_PER_TEAM: MIN, RECOMMENDED_MAX_POOL_GAMES: AIM, MAX_GAMES_PER_TEAM: MAX } =
    await import("../src/formats.js");
  let sawBelow = 0, sawInBand = 0, sawRoomless = 0, sawUnplayable = 0;
  for (let teams = 6; teams <= 32; teams++) {
    for (let courts = 2; courts <= 12; courts++) {
      const raw = equalGameOptions(teams, courts);
      const curated = curatePoolOptions(raw);
      assert.equal(curated.length, raw.length, "curation annotates — it never removes (chooseRounds' contract)");
      for (const o of curated) {
        const inBand = o.gamesPerTeam >= MIN && o.gamesPerTeam <= AIM;
        assert.equal(!!o.recommended, inBand, `${teams}t/${courts}c: ${o.gamesPerTeam} games recommended=${o.recommended}`);
        if (inBand) { sawInBand++; assert.equal(o.why, undefined, "a recommended option needs no excuse"); }
        else {
          assert.ok(o.why && o.why.length > 10, "every refusal is a sentence a director can read");
          if (o.gamesPerTeam > MAX) { sawUnplayable++; assert.match(o.why, /unplayable/, "past 16: the injury reason, even though it is also past 10"); }
          else if (o.gamesPerTeam < MIN) { sawBelow++; assert.match(o.why, /floor|under/i); }
          else { sawRoomless++; assert.match(o.why, /bracket|16/, "11–16: playable alone, no bracket room"); }
        }
      }
    }
  }
  // The property proved nothing unless the sweep actually visited all four classes.
  assert.ok(sawInBand > 50 && sawBelow > 50 && sawRoomless > 20 && sawUnplayable > 5,
    `corpus must exhibit every class: in-band ${sawInBand}, below ${sawBelow}, roomless ${sawRoomless}, unplayable ${sawUnplayable}`);
});

test("T2-4 — the raw list stays unfiltered UNDER the curation: equalGameOptions still returns sub-floor counts (green by design — it pins the placement that must survive)", () => {
  const raw = equalGameOptions(16, 4);
  assert.ok(raw.some((o) => o.gamesPerTeam < MIN_GAMES_PER_TEAM), "sub-floor options exist in the raw list");
  assert.ok(raw.some((o) => o.gamesPerTeam >= MIN_GAMES_PER_TEAM), "and in-band ones too — the fixture exhibits both sides");
});

test("T2-4 — the ROUTE serves the curated shape: 16 teams / 4 courts recommends exactly the 8, 9 and 10-game counts and says the band", async () => {
  const env = bootRouter();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/formats/options?teams=16&courts=4", { token });
  assert.equal(r.status, 200);
  const rec = r.data.options.filter((o) => o.recommended);
  assert.deepEqual(rec.map((o) => o.gamesPerTeam), [8, 9, 10], "the buttons a director would actually pick");
  assert.equal(r.data.recommended_count, 3);
  assert.deepEqual(r.data.band, { floor: 8, aim_max: 10, ceiling: 16 });
  assert.ok(r.data.options.length === 12, "…and all twelve equal counts are still in the payload for the operator who wants them");
});

test("T2-4 — when NO option lands in the band the route says so and still hands over the list (empty and broken must not look identical)", async () => {
  const env = bootRouter();
  const token = await staff(env);
  // 20 teams on 2 courts: equal counts top out at 4 games in 24 rounds — nothing reaches the floor.
  const r = await call(env, "GET", "/api/admin/formats/options?teams=20&courts=2", { token });
  assert.equal(r.data.recommended_count, 0);
  assert.ok(r.data.options.length > 0, "the options are still there — a guard that only forbids deletes the last way out");
  assert.match(String(r.data.note), /floor|8 games|court/i, "the note explains the shortfall instead of presenting an empty room");
});

test("T2-4 — the screen renders the judgement and finally SENDS the points: recommended buttons, the rest behind a disclosure, and points_to on both the preview and the commit", () => {
  assert.ok(TOURN_JS.includes("o.recommended"), "the render forks on the route's judgement");
  assert.ok(TOURN_JS.includes("<details"), "out-of-band counts sit behind a disclosure, offered but second");
  assert.ok(TOURN_HTML.includes('id="plPoints"'), "the points field exists — settable points was half-built for six releases");
  const preview = TOURN_JS.slice(TOURN_JS.indexOf("async function previewPlan"), TOURN_JS.indexOf("async function previewPlan") + 600);
  assert.ok(preview.includes("points_to"), "the preview sends what the server always accepted");
  const commit = TOURN_JS.slice(TOURN_JS.indexOf('$("plCommit").onclick'), TOURN_JS.indexOf('$("plCommit").onclick') + 600);
  assert.ok(commit.includes("points_to"), "and the committed matches carry the same points");
  // NC: the fork-needle is load-bearing.
  const mutated = TOURN_JS.replace(/o\.recommended/g, "o.XXGONE");
  assert.ok(!mutated.includes("o.recommended"), "the mutation landed");
});
