/* Boomtown Platform — bracket tests
   File: worker/test/brackets.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.66.0

   Two things here are worth more than the rest.

   1. BYES GO TO THE TOP SEEDS AND THERE ARE NO PLAY-IN GAMES. Owner, 2026-08-03: "we try to avoid
      pigtails as often as possible with too many people waiting." A generator that quietly adds a
      play-in round satisfies every count-based assertion and breaks the actual requirement, so the
      seeding is asserted directly.

   2. ADVANCEMENT IS RECOMPUTED, NOT ACCUMULATED. Running it twice must change nothing, and
      correcting a score that was typed in backwards must fix the round above it. An implementation
      that pushes a winner forward once at score time passes the happy path and strands the wrong
      team in the semi-final forever. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { buildTree, feedsInto, winnerOf, pendingAdvances, stageForRound } from "../src/brackets.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const IDX = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot(teamCount = 8) {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'tournament','Test Cup','published',4)");
  for (let i = 1; i <= teamCount; i++) {
    DB.exec(`INSERT INTO teams (id, org_id, event_id, name, seed) VALUES (${i},1,1,'Team ${i}',${i})`);
  }
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 200) }; }
  return { status: res.status, data };
}

async function staff(env, email = "s@bt.test") {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", email);
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

/** Type a result into a bracket match, straight into the table — score entry is not what's on trial. */
function score(env, matchId, a, b) {
  env.DB.exec(`UPDATE matches SET score_a=${a}, score_b=${b} WHERE id=${matchId}`);
}

/* ================================ the pure engine ================================ */

test("a bracket of n teams has exactly n-1 games, for every field size", () => {
  // Every game eliminates exactly one team, and everyone but the winner is eliminated. If this
  // count is ever wrong the tree has either a phantom fixture or a missing one.
  for (let n = 2; n <= 33; n++) {
    const t = buildTree(n);
    assert.equal(t.ok, true, `n=${n} failed to build`);
    assert.equal(t.matches.length, n - 1, `n=${n}: expected ${n - 1} games, got ${t.matches.length}`);
  }
});

test("byes go to the TOP seeds, and no play-in game is ever created", () => {
  // 12 teams in a 16 bracket = 4 byes. Seeds 1-4 must not play in the round of 16; seeds 5-12 must.
  const t = buildTree(12);
  assert.equal(t.size, 16);
  assert.equal(t.depth, 4);
  assert.equal(t.byes, 4);

  const first = t.matches.filter((m) => m.round === t.depth);
  const playingFirst = new Set(first.flatMap((m) => [m.a, m.b]));
  for (const seed of [1, 2, 3, 4]) {
    assert.ok(!playingFirst.has(seed), `seed ${seed} should have a bye, not a first-round game`);
  }
  for (let seed = 5; seed <= 12; seed++) {
    assert.ok(playingFirst.has(seed), `seed ${seed} should be playing in the first round`);
  }
  // A play-in would mean more first-round games than the bracket half-size allows.
  assert.equal(first.length, 4, "12 teams in a 16 bracket is 4 first-round games — never a play-in round");
});

test("a bye team is placed into the next round, not given a phantom game", () => {
  const t = buildTree(6);                      // size 8, 2 byes: seeds 1 and 2
  assert.equal(t.byes, 2);
  assert.equal(t.matches.filter((m) => m.round === 3).length, 2, "only two real quarter-finals");
  // Seeds 1 and 2 must already be sitting in the semi-finals.
  const semis = t.matches.filter((m) => m.round === 2);
  const seated = semis.flatMap((m) => [m.a, m.b]).filter((s) => s !== null);
  assert.deepEqual(seated.sort((a, b) => a - b), [1, 2]);
  // And no match anywhere may have a team on one side and nothing on the other in the first round.
  for (const m of t.matches.filter((x) => x.round === t.depth)) {
    assert.ok(m.a && m.b, "a first-round game with one team is a bye, and a bye is not a game");
  }
});

test("the best two teams cannot meet before the final", () => {
  // The whole point of seeding. If 1 and 2 land in the same half, the bracket is wrong.
  for (const n of [4, 5, 8, 11, 16, 24, 32]) {
    const t = buildTree(n);
    // Walk seed 1 and seed 2 forward through byes and wins; they must first collide at round 1.
    const half = (seed) => {
      const first = t.matches.find((m) => m.round === t.depth && (m.a === seed || m.b === seed));
      if (first) return first.slot <= 2 ** (t.depth - 2) ? "top" : "bottom";
      const seated = t.matches.find((m) => m.round === t.depth - 1 && (m.a === seed || m.b === seed));
      return seated.slot <= 2 ** (t.depth - 3) || t.depth === 2 ? "top" : "bottom";
    };
    assert.notEqual(half(1), half(2), `n=${n}: seeds 1 and 2 are in the same half`);
  }
});

test("feeds-into is derived, and the final feeds nothing", () => {
  assert.deepEqual(feedsInto(3, 1), { round: 2, slot: 1, side: "a" });
  assert.deepEqual(feedsInto(3, 2), { round: 2, slot: 1, side: "b" });
  assert.deepEqual(feedsInto(3, 3), { round: 2, slot: 2, side: "a" });
  assert.deepEqual(feedsInto(3, 4), { round: 2, slot: 2, side: "b" });
  assert.equal(feedsInto(1, 1), null);
});

test("stage stays inside the column's CHECK, and clamps rather than lying loudly", () => {
  assert.equal(stageForRound(1), "final");
  assert.equal(stageForRound(2), "semi");
  assert.equal(stageForRound(3), "quarter");
  // Round of 16 has no legal `stage` value; it clamps. bracket_round carries the truth.
  assert.equal(stageForRound(4), "quarter");
  for (const r of [1, 2, 3, 4, 5]) {
    assert.ok(["pool", "quarter", "semi", "final"].includes(stageForRound(r)),
      "every stage written must satisfy the live CHECK constraint");
  }
});

test("a tie is not a winner", () => {
  // Volleyball plays to a two-point margin. An equal score means unfinished or mis-typed, and
  // guessing would put the wrong team into the next round.
  assert.equal(winnerOf(25, 23), "a");
  assert.equal(winnerOf(23, 25), "b");
  assert.equal(winnerOf(25, 25), null);
  assert.equal(winnerOf(null, null), null);
  assert.equal(winnerOf(25, null), null);
  assert.equal(winnerOf(0, 0), null, "0-0 is a game that has not started, not a draw");
});

test("advancement is idempotent, and self-heals a corrected score", () => {
  const tree = [
    { id: 11, bracket_round: 2, bracket_slot: 1, team_a_id: 1, team_b_id: 2, score_a: 25, score_b: 20 },
    { id: 12, bracket_round: 2, bracket_slot: 2, team_a_id: 3, team_b_id: 4, score_a: 18, score_b: 25 },
    { id: 21, bracket_round: 1, bracket_slot: 1, team_a_id: null, team_b_id: null, score_a: null, score_b: null },
  ];
  const first = pendingAdvances(tree.map((m) => ({ ...m })));
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((c) => c.team_id).sort(), [1, 4]);

  // Apply, then run again: nothing left to do.
  const applied = tree.map((m) => ({ ...m }));
  applied[2].team_a_id = 1; applied[2].team_b_id = 4;
  assert.equal(pendingAdvances(applied).length, 0, "running advance twice must change nothing");

  // Now the director realises the semi was typed in backwards and fixes it.
  const corrected = applied.map((m) => ({ ...m }));
  corrected[0].score_a = 20; corrected[0].score_b = 25;
  const fix = pendingAdvances(corrected);
  assert.equal(fix.length, 1, "a corrected score must move the right team up");
  assert.equal(fix[0].team_id, 2);
  assert.equal(fix[0].replaced_team_id, 1);
});

test("changing the teams in a game that already has a score is flagged, not hidden", () => {
  const tree = [
    { id: 11, bracket_round: 2, bracket_slot: 1, team_a_id: 1, team_b_id: 2, score_a: 20, score_b: 25 },
    { id: 12, bracket_round: 2, bracket_slot: 2, team_a_id: 3, team_b_id: 4, score_a: 25, score_b: 20 },
    { id: 21, bracket_round: 1, bracket_slot: 1, team_a_id: 1, team_b_id: 3, score_a: 25, score_b: 22 },
  ];
  const changes = pendingAdvances(tree);
  const moved = changes.find((c) => c.match_id === 21 && c.side === "a");
  assert.ok(moved, "the corrected semi winner must move into the final");
  assert.equal(moved.disturbs_played_match, true,
    "the final already had a score — a human has to re-decide what that game meant");
});

/* ================================ live routes ================================ */

test("generate a bracket from entry seeds when no pool has been played", async () => {
  const env = boot(8);
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.seeded_by, "entry seed");
  assert.equal(r.data.matches_written, 7, "8 teams is 7 games");
  assert.equal(r.data.brackets[0].rounds, 3);

  const rows = env.DB.query("SELECT bracket_round, bracket_slot, stage FROM matches WHERE bracket_id IS NOT NULL ORDER BY bracket_round DESC, bracket_slot");
  assert.equal(rows.length, 7);
  assert.equal(rows.filter((x) => x.stage === "final").length, 1);
  assert.equal(rows.filter((x) => x.stage === "semi").length, 2);
  assert.equal(rows.filter((x) => x.stage === "quarter").length, 4);
  env.DB.close();
});

test("pool finish beats entry seed when standings exist", async () => {
  const env = boot(4);
  const token = await staff(env);
  // Reverse the pool result: team 4 finished first.
  const order = [4, 3, 2, 1];
  order.forEach((id, i) => env.DB.exec(
    `INSERT INTO standings (org_id, event_id, team_id, rank) VALUES (1,1,${id},${i + 1})`));

  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token });
  assert.equal(r.data.seeded_by, "pool finish");
  // Standard seeding puts 1 v 4: here that is team 4 (rank 1) against team 1 (rank 4).
  const semi = env.DB.query("SELECT team_a_id, team_b_id FROM matches WHERE bracket_round=2 ORDER BY bracket_slot");
  assert.deepEqual([semi[0].team_a_id, semi[0].team_b_id], [4, 1],
    "the team that WON the pool must be seeded first, whatever its entry seed said");
  env.DB.close();
});

test("A and BB brackets: the field is split so tenth place still has a day", async () => {
  const env = boot(12);
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { a_size: 8 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.brackets.length, 2);
  assert.deepEqual(r.data.brackets.map((b) => b.name), ["A", "BB"]);
  assert.equal(r.data.brackets[0].teams, 8);
  assert.equal(r.data.brackets[1].teams, 4);
  assert.equal(r.data.matches_written, 7 + 3);
  env.DB.close();
});

/* ================================ courts and times ================================
   A DOUBLE-BOOKED COURT IS INVISIBLE UNTIL TWO TEAMS WALK TO THE SAME NET. Nothing in the schema
   forbids it, no route complains, and the court grid draws both games happily. So it is asserted
   directly, on the widest set: every bracket game on the event, grouped by when and where. */

/** Every (round, court) pair holding more than one bracket game. Empty is the only acceptable answer. */
const clashes = (env) => env.DB.query(
  `SELECT round, court, COUNT(*) AS n FROM matches
    WHERE event_id=1 AND bracket_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY round, court HAVING n > 1 ORDER BY round, court`);

test("no two bracket games share a court at the same time — one bracket, more games than courts", async () => {
  // 16 teams on 4 courts. The round of 16 is EIGHT games; `slot mod courts` gave every court two of
  // them, all in the same schedule round. Now the round splits into waves instead.
  const env = boot(16);
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.matches_written, 15, "16 teams is 15 games");
  assert.deepEqual(clashes(env), [], "two bracket games were put on one court at one time");

  const rows = env.DB.query("SELECT DISTINCT round FROM matches WHERE event_id=1 AND bracket_id IS NOT NULL ORDER BY round");
  assert.ok(rows.length >= 5, `8 first-round games on 4 courts needs two waves, so at least 5 rounds — got ${rows.length}`);
  env.DB.close();
});

test("no two bracket games share a court at the same time — A and BB drawn together", async () => {
  // Both brackets used to number their own courts from 1, so A's quarter-final 1 and BB's quarter-
  // final 1 were both court 1 in the same round. Sixteen teams split 8/8 collided seven times.
  const env = boot(16);
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { a_size: 8, points_to: 25 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.brackets.map((b) => b.teams), [8, 8]);
  assert.deepEqual(clashes(env), [], "the A and BB brackets were put on the same courts at the same time");
  env.DB.close();
});

test("bracket games still start after pool play, not on top of it", async () => {
  // The reason courts are allocated at all: pool play and the bracket are one continuous day on one
  // court grid. Fixing the collisions must not have detached the bracket from the schedule.
  const env = boot(8);
  const token = await staff(env);
  for (let round = 1; round <= 3; round++) {
    env.DB.exec(`INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id)
                 VALUES (1,1,'pool',${round},1,1,2)`);
  }
  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  const firstBracketRound = env.DB.one(
    "SELECT MIN(round) AS r FROM matches WHERE event_id=1 AND bracket_id IS NOT NULL").r;
  assert.equal(firstBracketRound, 4, "the bracket must begin in the round after the last pool round");
  assert.deepEqual(clashes(env), []);
  env.DB.close();
});

test("NC: the clash detector can fail — a deliberately doubled booking is caught", () => {
  // The three assertions above all read `deepEqual(clashes(env), [])`, and an empty result is also
  // what a detector that queried the wrong table would return. So the detector is fed a real
  // collision and must report it, using the same SQL.
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'tournament','X','published',4)");
  DB.exec("INSERT INTO brackets (id, org_id, event_id, name) VALUES (9,1,1,'A')");
  DB.exec(`INSERT INTO matches (org_id, event_id, stage, round, court, bracket_id, bracket_round, bracket_slot)
           VALUES (1,1,'quarter',7,2,9,3,1),(1,1,'quarter',7,2,9,3,2)`);
  const found = clashes({ DB });
  assert.equal(found.length, 1, "the detector missed a court holding two games in one round");
  assert.deepEqual([found[0].round, found[0].court, found[0].n], [7, 2, 2]);
  DB.close();
});

/* ================================ hand-typed seeds ================================ */

test("a seed list naming the same team twice is refused, not drawn", async () => {
  // [1, 1, 2, 3] is four entries and four teams that exist, so the count check passed and the bracket
  // was built with team 1 in BOTH semi-finals — playing itself in the final. The /slot route already
  // refuses a team on both sides of one game; generation was the way around it.
  const env = boot(8);
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { seeds: [1, 1, 2, 3] } });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /more than once/);
  assert.match(r.data.error, /Team 1/, "the error must name the team, not just the rule");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE bracket_id IS NOT NULL").n, 0,
    "a refused draw must leave nothing behind");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM brackets").n, 0);
  env.DB.close();
});

test("a valid hand-typed seed list is still accepted, in the order given", async () => {
  // The negative control for the check above: if it rejected any explicit list, the refusal proves
  // nothing about duplicates.
  const env = boot(8);
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { seeds: [5, 6, 7, 8] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.seeded_by, "chosen by hand");
  const semi = env.DB.query("SELECT team_a_id, team_b_id FROM matches WHERE bracket_round=2 ORDER BY bracket_slot");
  assert.deepEqual([semi[0].team_a_id, semi[0].team_b_id], [5, 8], "first listed plays last listed");
  env.DB.close();
});

test("the bye count is reported in words the director can act on", async () => {
  const env = boot(6);
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token });
  assert.match(r.data.summary[0], /2 byes to the top seeds — no play-in games/);
  env.DB.close();
});

test("regenerating without replace is refused; with replace the old tree is soft-deleted", async () => {
  const env = boot(8);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token });
  const again = await call(env, "POST", "/api/admin/events/1/brackets", { token });
  assert.equal(again.status, 409);
  assert.equal(again.data.existing_matches, 7);

  const rep = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { replace: true } });
  assert.equal(rep.status, 200);
  assert.equal(rep.data.matches_replaced, 7);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE bracket_id IS NOT NULL AND deleted_at IS NOT NULL").n, 7,
    "the replaced bracket must be recoverable, not destroyed");
  env.DB.close();
});

test("play the whole thing: scores in, winners forward, a champion at the end", async () => {
  const env = boot(4);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token });

  const semis = env.DB.query("SELECT id, team_a_id, team_b_id FROM matches WHERE bracket_round=2 ORDER BY bracket_slot");
  score(env, semis[0].id, 25, 20);        // team_a of semi 1 wins
  score(env, semis[1].id, 20, 25);        // team_b of semi 2 wins

  const adv = await call(env, "POST", "/api/admin/events/1/brackets/advance", { token });
  assert.equal(adv.status, 200, JSON.stringify(adv.data));
  assert.equal(adv.advanced ?? adv.data.advanced, 2);
  assert.equal(adv.data.disturbed, 0);

  const fin = env.DB.one("SELECT id, team_a_id, team_b_id FROM matches WHERE bracket_round=1");
  assert.equal(fin.team_a_id, semis[0].team_a_id);
  assert.equal(fin.team_b_id, semis[1].team_b_id);

  // Running it again must be a no-op — this is the assertion that catches an accumulating advance.
  const twice = await call(env, "POST", "/api/admin/events/1/brackets/advance", { token });
  assert.equal(twice.data.advanced, 0);
  assert.match(twice.data.note, /Nothing to move/);

  score(env, fin.id, 25, 18);
  const read = await call(env, "GET", "/api/admin/events/1/brackets", { token });
  assert.equal(read.data.brackets[0].champion, `Team ${fin.team_a_id}`);
  assert.equal(read.data.brackets[0].played, 3);
  env.DB.close();
});

test("an empty slot says which game it is waiting on", async () => {
  const env = boot(4);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token });
  const read = await call(env, "GET", "/api/admin/events/1/brackets", { token });
  const final = read.data.brackets[0].rounds.find((r) => r.bracket_round === 1).matches[0];
  // An empty box tells a director nothing; "Winner of Semi-final 1" tells them everything.
  assert.equal(final.waiting_a, "Winner of Semi-final 1");
  assert.equal(final.waiting_b, "Winner of Semi-final 2");
  env.DB.close();
});

test("NC: a tied score advances nobody", async () => {
  const env = boot(4);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token });
  const semis = env.DB.query("SELECT id FROM matches WHERE bracket_round=2 ORDER BY bracket_slot");
  score(env, semis[0].id, 24, 24);
  const adv = await call(env, "POST", "/api/admin/events/1/brackets/advance", { token });
  assert.equal(adv.data.advanced, 0, "24-24 is an unfinished game, not a result");
  env.DB.close();
});

test("advance on an event with no bracket says so instead of pretending", async () => {
  const env = boot(4);
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/brackets/advance", { token });
  assert.equal(r.status, 404);
  assert.match(r.data.error, /no bracket/);
  env.DB.close();
});

test("a member cannot reach any bracket route", async () => {
  const env = boot(4);
  await staff(env);                                   // burn the first-user admin bootstrap
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "m@bt.test" } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  for (const [m, path] of [
    ["GET", "/api/admin/events/1/brackets"],
    ["POST", "/api/admin/events/1/brackets"],
    ["POST", "/api/admin/events/1/brackets/advance"],
  ]) {
    const r = await call(env, m, path, { token: v.data.token, body: m === "GET" ? undefined : {} });
    assert.equal(r.status, 403, `${m} ${path} let a member through (${r.status})`);
  }
  env.DB.close();
});

test("the module is actually mounted (failure class 1)", () => {
  // Built, tested, and never called is the defect this repo keeps rediscovering. Assert the wiring
  // from source, not from a document that claims it was done.
  assert.match(IDX, /import \{ bracketRoutes, wireBrackets \} from "\.\/brackets\.js"/);
  assert.match(IDX, /wireBrackets\(\s*\{?\s*(?:\.\.\.)?wiredHelpers/);
  // v0.77.0: the `||` chain became an isolated dispatch TABLE, so the mount is a table entry.
  assert.match(IDX, /\["bracket",\s+bracketRoutes\],/,
    "bracketRoutes must appear in the dispatch table, not merely on an import line (§6.5)");
});

/* ================================ v0.78.0 — corrections, fixed ranges, real times ================================ */

test("a division's court range is honoured, and two divisions run side by side", async () => {
  // Owner 2026-08-03: "bracket generation should honor the fixed court number."
  const env = boot(16);
  const token = await staff(env);
  env.DB.exec("INSERT INTO divisions (id,org_id,event_id,name,rank,court_from,court_to) VALUES (20,1,1,'Open',1,1,4),(21,1,1,'A',2,5,8)");
  const r = await call(env, "POST", "/api/admin/events/1/brackets", {
    token, body: { a_size: 8, division_id: 20, bb_division_id: 21, points_to: 25 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(clashes(env), [], "two divisions must not be put on the same court at the same time");

  const courtsOf = (name) => env.DB.query(
    "SELECT DISTINCT m.court FROM matches m JOIN brackets b ON b.id=m.bracket_id WHERE b.name=?1 AND m.court>0 ORDER BY m.court", name
  ).map((x) => x.court);
  for (const c of courtsOf("A")) assert.ok(c >= 1 && c <= 4, `the A bracket used court ${c}, outside 1-4`);
  for (const c of courtsOf("BB")) assert.ok(c >= 5 && c <= 8, `the BB bracket used court ${c}, outside 5-8`);

  // Disjoint ranges means simultaneous: both brackets must open in the same schedule round.
  const firstRound = (name) => env.DB.one(
    "SELECT MIN(m.round) AS r FROM matches m JOIN brackets b ON b.id=m.bracket_id WHERE b.name=?1", name).r;
  assert.equal(firstRound("A"), firstRound("BB"), "brackets on their own courts must not queue behind each other");
  env.DB.close();
});

test("a bracket's own court range overrides its division's", async () => {
  // The exception the owner described: hand a finished division's courts to one still going, without
  // editing the division, whose range is a standing fact about the day.
  const env = boot(8);
  const token = await staff(env);
  env.DB.exec("INSERT INTO divisions (id,org_id,event_id,name,rank,court_from,court_to) VALUES (20,1,1,'Open',1,1,2)");
  const r = await call(env, "POST", "/api/admin/events/1/brackets", {
    token, body: { division_id: 20, court_from: 5, court_to: 8, points_to: 25 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const used = env.DB.query("SELECT DISTINCT court FROM matches WHERE bracket_id IS NOT NULL AND court>0 ORDER BY court").map((x) => x.court);
  assert.ok(used.length > 0 && used.every((c) => c >= 5 && c <= 8), `expected courts 5-8, saw ${used}`);
  assert.deepEqual(clashes(env), []);
  env.DB.close();
});

test("wall-clock times are written when asked for, and left NULL when not", async () => {
  // Migration 0041: `starts_at` is nullable on purpose — a fabricated time on a results sheet is worse
  // than no time. Relative base date, because a hardcoded one broke a green suite on a boundary.
  const start = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const env = boot(8);
  const token = await staff(env);
  env.DB.exec(`UPDATE events SET starts_at='${start}' WHERE id=1`);

  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { slot_minutes: 45, points_to: 25 } });
  const timed = env.DB.query("SELECT round, starts_at FROM matches WHERE bracket_id IS NOT NULL AND starts_at IS NOT NULL");
  assert.equal(timed.length, 7, "every bracket game should carry a time when one was asked for");
  const distinct = [...new Set(timed.map((x) => x.starts_at))].sort();
  assert.ok(distinct.length >= 3, `expected several distinct slot times, saw ${distinct.length}`);
  assert.equal(Date.parse(distinct[1]) - Date.parse(distinct[0]), 45 * 60_000, "slots must be 45 minutes apart");
  env.DB.close();
});

test("no slot length means NO times, rather than invented ones", async () => {
  // The negative control for the test above: if times were written unconditionally, that one would pass
  // while `starts_at` quietly became a fiction on every event that never asked for a schedule.
  const start = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const env = boot(8);
  const token = await staff(env);
  env.DB.exec(`UPDATE events SET starts_at='${start}' WHERE id=1`);
  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE bracket_id IS NOT NULL AND starts_at IS NOT NULL").n, 0);
  // And the courts are still allocated — no times must not mean no schedule.
  assert.ok(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE bracket_id IS NOT NULL AND court>0").n > 0);
  assert.deepEqual(clashes(env), []);
  env.DB.close();
});

test("an exact score can be entered, and a wrong one corrected", async () => {
  /* Owner 2026-08-03: "Add admin edit scores if incorrect." The 2-tap contract cannot express a
     correction — a game entered 21-15 that was really 23-21 is unreachable through "winner and margin",
     which assumes the winner scored exactly points_to. */
  const env = boot(4);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  const semi = env.DB.one("SELECT id FROM matches WHERE bracket_round=2 AND bracket_slot=1");

  const first = await call(env, "POST", `/api/matches/${semi.id}/score`, { token, body: { winner: "a", diff: 10 } });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.corrected, false, "a first entry is not a correction");
  assert.deepEqual([first.data.score_a, first.data.score_b], [25, 15]);

  // The real score was 23-21, which winner+diff cannot express.
  const fix = await call(env, "POST", `/api/matches/${semi.id}/score`, { token, body: { score_a: 23, score_b: 21 } });
  assert.equal(fix.status, 200, JSON.stringify(fix.data));
  assert.equal(fix.data.corrected, true);
  assert.match(fix.data.note, /Corrected from 25/);
  const row = env.DB.one("SELECT score_a, score_b FROM matches WHERE id=?1", semi.id);
  assert.deepEqual([row.score_a, row.score_b], [23, 21]);
  env.DB.close();
});

test("a tied score is refused, because every other module reads a tie as unplayed", async () => {
  const env = boot(4);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  const semi = env.DB.one("SELECT id FROM matches WHERE bracket_round=2 AND bracket_slot=1");
  const r = await call(env, "POST", `/api/matches/${semi.id}/score`, { token, body: { score_a: 21, score_b: 21 } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /won by two/);
  assert.equal(env.DB.one("SELECT score_a FROM matches WHERE id=?1", semi.id).score_a, null,
    "a refused score must leave the game unplayed");
  env.DB.close();
});

test("nonsense scores are refused in a sentence, and the 2-tap contract still works", async () => {
  const env = boot(4);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  const semi = env.DB.one("SELECT id FROM matches WHERE bracket_round=2 AND bracket_slot=1");
  for (const body of [{ score_a: -1, score_b: 5 }, { score_a: 1.5, score_b: 0 }, { score_a: 900, score_b: 1 }, { score_a: "x", score_b: 2 }]) {
    const r = await call(env, "POST", `/api/matches/${semi.id}/score`, { token, body });
    assert.equal(r.status, 400, `${JSON.stringify(body)} should be refused`);
    assert.match(r.data.error, /whole numbers/);
  }
  // NC: adding the exact form must not have broken the 2-tap contract a captain uses at the net.
  const ok2 = await call(env, "POST", `/api/matches/${semi.id}/score`, { token, body: { winner: "b", diff: 3 } });
  assert.equal(ok2.status, 200, JSON.stringify(ok2.data));
  assert.deepEqual([ok2.data.score_a, ok2.data.score_b], [22, 25]);
  env.DB.close();
});

test("correcting a score self-heals the game it feeds", async () => {
  // Why advancement is recomputed rather than accumulated: fix a game typed in backwards and the game it
  // feeds is right on the same pass, with no manual repair.
  const env = boot(4);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  const semis = env.DB.query("SELECT id, team_a_id, team_b_id FROM matches WHERE bracket_round=2 ORDER BY bracket_slot");
  await call(env, "POST", `/api/matches/${semis[0].id}/score`, { token, body: { score_a: 25, score_b: 20 } });
  assert.equal(env.DB.one("SELECT team_a_id FROM matches WHERE bracket_round=1").team_a_id, semis[0].team_a_id);

  const fix = await call(env, "POST", `/api/matches/${semis[0].id}/score`, { token, body: { score_a: 20, score_b: 25 } });
  assert.equal(fix.data.corrected, true);
  assert.ok(fix.data.bracket_advanced >= 1, "the final should have been rewritten");
  assert.equal(env.DB.one("SELECT team_a_id FROM matches WHERE bracket_round=1").team_a_id, semis[0].team_b_id,
    "the corrected winner must be the one in the final");
  env.DB.close();
});

test("a game can be moved to another court, and a collision is named rather than refused", async () => {
  /* Owner: "We need ability to assign different courts to players based on availability of courts during
     bracket." Warns and writes, like every other override in this module — a director on court 3 knows
     the net on court 7 is broken, and refusing the move sends them to a paper grid, after which the
     software is no longer the record. */
  const env = boot(8);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  const games = env.DB.query("SELECT id, court, round FROM matches WHERE bracket_round=3 ORDER BY bracket_slot");

  const moved = await call(env, "POST", `/api/admin/events/1/matches/${games[0].id}/court`, { token, body: { court: 9 } });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.court, 9, "a court outside the bracket's range is still allowed by hand");
  assert.deepEqual(moved.data.conflicts, []);
  assert.equal(env.DB.one("SELECT court FROM matches WHERE id=?1", games[0].id).court, 9);

  // Now put a second game on top of it. Written, and reported.
  const onTop = await call(env, "POST", `/api/admin/events/1/matches/${games[1].id}/court`, { token, body: { court: 9 } });
  assert.equal(onTop.status, 200, "a clash must not be refused — flexibility beats correctness here");
  assert.equal(env.DB.one("SELECT court FROM matches WHERE id=?1", games[1].id).court, 9, "and it must actually be written");
  assert.equal(onTop.data.conflicts.length, 1, "but it must be reported");
  assert.match(onTop.data.note, /also on court 9 at the same time/);
  env.DB.close();
});

test("a start time can be set and cleared independently of the court", async () => {
  const when = new Date(Date.now() + 7_200_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const env = boot(4);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  const g = env.DB.one("SELECT id, court FROM matches WHERE bracket_round=2 AND bracket_slot=1");

  const set = await call(env, "POST", `/api/admin/events/1/matches/${g.id}/court`, { token, body: { starts_at: when } });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal(set.data.court, g.court, "omitting the court must leave it alone");
  assert.equal(env.DB.one("SELECT starts_at FROM matches WHERE id=?1", g.id).starts_at, when);

  // An explicit null clears it; omitting it leaves it. The two are different intents, and collapsing
  // them would make clearing a time impossible.
  const cleared = await call(env, "POST", `/api/admin/events/1/matches/${g.id}/court`, { token, body: { starts_at: null } });
  assert.equal(cleared.status, 200);
  assert.equal(env.DB.one("SELECT starts_at FROM matches WHERE id=?1", g.id).starts_at, null);

  const bad = await call(env, "POST", `/api/admin/events/1/matches/${g.id}/court`, { token, body: { starts_at: "next tuesday" } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /date we can read/);
  env.DB.close();
});

test("a member cannot move a game or correct a score", async () => {
  const env = boot(4);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25 } });
  const g = env.DB.one("SELECT id FROM matches WHERE bracket_round=2 AND bracket_slot=1");
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "m@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  for (const [path, body] of [
    [`/api/admin/events/1/matches/${g.id}/court`, { court: 2 }],
    [`/api/matches/${g.id}/score`, { score_a: 25, score_b: 1 }],
  ]) {
    const r = await call(env, "POST", path, { token: v.data.token, body });
    assert.equal(r.status, 403, `${path} let a member through (${r.status})`);
  }
  env.DB.close();
});
