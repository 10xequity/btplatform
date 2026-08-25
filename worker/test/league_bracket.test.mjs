/* Boomtown Platform — the end-of-league tournament (roadmap §-1d, Shape A)
   File: worker/test/league_bracket.test.mjs · Version: v3.0 · Date: 2026-08-08 · Ships in: v0.109.0

   v3.0 — THE OWNER REVERSED v0.108.0's CORE UNIT: "however do not use time as the core unit of
   measure." The measure is GAMES PER TEAM against a floor of 8. Three v2.0 tests asserted the old
   minutes-first rule and were REWRITTEN rather than deleted — the surfaces they covered still need
   cover; what changed is the correct answer on each. N-6 is answered here too: a bracket that was
   not seeded by pool play now says so.

   v1.0 SHIPPED WITH NO VERSION BUMP, DELIBERATELY: it pinned behaviour the worker already had, and a
   release number with no shipped change would have made the changelog claim a capability arrived in
   v0.108.0 when it had been there since v0.66.0. v2.0 adds the timeframe estimate, which IS new code,
   so this file now ships with a release.

   WHY THIS FILE EXISTS. Owner, 2026-08-08: "We do a tournament at the end of the leagues. It changes
   based on participants and timeframe available." §-1d had this queued behind an unanswered question
   — "what marks an event as Shape A" — on the assumption that a league-night tournament needs a
   SECOND event row linked back to the league, and therefore a new column to carry the link.

   THAT ASSUMPTION IS WHAT THIS FILE TESTS, AND IT IS FALSE. A bracket already hangs off an event by
   `brackets.event_id`, `generateBracketFor` never looks at `events.type`, and the Brackets screen's
   picker lists every event with no type filter. So the end-of-league tournament is not a second
   event that must be linked to the league — it is a bracket drawn ON the league event, and the
   league's own teams are already the only teams that event has. Roster source, which is the owner's
   discriminator, is satisfied by construction rather than by a foreign key.

   The point of asserting it rather than reading it: "no type gate" is a claim about an absence, and
   an absence is exactly the thing a code read gets wrong. A gate could be added tomorrow in
   `generateBracketFor`, in the route, or in the picker, and nothing else in the suite would notice.

   WHAT EACH TEST IS DEFENDING.

   1. THE FIXTURE'S PREMISE IS ASSERTED DIRECTLY. A test that draws a bracket on an event it merely
      believes is a league proves nothing. The type and the emptiness of `standings` are read back
      from the database, because every later assertion is only interesting if those two hold.

   2. "IT CHANGES BASED ON PARTICIPANTS" IS THE FIELD SIZE, AND IT IS ALREADY SOLVED. Whoever is
      standing there at the end of the night is the field. `buildTree` takes any n and gives byes to
      the top seeds — so this asserts n-1 games across awkward sizes, not just powers of two, and
      asserts that the byes landed on the top seeds rather than on a play-in round.

   3. NO POOL IS NOT A REFUSAL ON THIS PATH — which is half of N-6 answered in code. `seedOrder`
      falls back to entry seed. The OLD `tournaments.createBracket` still hard-refuses without
      standings, so the two paths disagree; this pins the behaviour of the one the UI actually calls.

   4. WHEN THE LEAGUE HAS BEEN SCORED, THE LEAGUE'S OWN FINISH IS THE SEEDING. That is the Shape A
      requirement stated as behaviour: the bracket comes out of the league standings, not out of a
      separate registration.

   NEGATIVE CONTROLS. Each one mutates the real input and asserts the mutation landed first, because
   an NC whose edit silently missed reports "clean" forever. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

/** A LEAGUE event with `teamCount` teams and, deliberately, no pool play scored. */
function boot(teamCount = 10, type = "league") {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec(
    "INSERT INTO events (id, org_id, type, name, status, court_count) VALUES " +
    `(1,1,'${type}','Thursday Night League','published',3)`
  );
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

/* The first-ever user is bootstrapped admin of every active org (index.js verifyLink, F-12). That is
   harmless for a staff-positive test like this one, but the fixture should not depend on it by
   accident — so a throwaway account burns the bootstrap before the account under test exists. */
async function burnBootstrap(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "burn@bt.test" } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
}

async function staff(env, email = "director@bt.test") {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", email);
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

const drawn = (env) =>
  env.DB.query("SELECT * FROM matches WHERE bracket_id IS NOT NULL AND deleted_at IS NULL");

/* ===================== 1 · the fixture's own premise ===================== */

test("Shape A premise: the event under test really is a league, with no pool play scored", async () => {
  const env = boot(10);
  const ev = env.DB.one("SELECT type, court_count FROM events WHERE id = 1");
  assert.equal(ev.type, "league", "the fixture must be a LEAGUE or nothing below is about Shape A");
  const st = env.DB.query("SELECT team_id FROM standings WHERE event_id = 1");
  assert.equal(st.length, 0, "no pool play may be scored — the fallback path is what is on trial");
  const teams = env.DB.query("SELECT id FROM teams WHERE event_id = 1 AND deleted_at IS NULL");
  assert.equal(teams.length, 10, "the league's own teams are the roster source");
});

/* ===================== 2 · a bracket draws on a league event ===================== */

test("the end-of-league tournament is a bracket ON the league event — no second event, no new column", async () => {
  const env = boot(10);
  await burnBootstrap(env);
  const token = await staff(env);

  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 21, courts: 3 } });
  assert.equal(r.status, 200, `generating on a league event was refused: ${JSON.stringify(r.data)}`);
  assert.equal(r.data.ok, true);

  // Ten teams, single elimination: nine games, and the bracket rows hang off the LEAGUE event.
  assert.equal(r.data.matches_written, 9, "n teams must produce exactly n-1 games");
  const games = drawn(env);
  assert.equal(games.length, 9);
  assert.ok(games.every((g) => g.event_id === 1), "every bracket game belongs to the league event itself");

  const brs = env.DB.query("SELECT event_id FROM brackets WHERE deleted_at IS NULL");
  assert.ok(brs.length >= 1 && brs.every((b) => b.event_id === 1),
    "the bracket is attached to the league event by brackets.event_id — the link already exists");
});

/* ===================== 3 · "it changes based on participants" ===================== */

test("the field is whoever showed up: any team count draws, with byes to the top seeds and no play-ins", async () => {
  // Awkward sizes on purpose. A generator that quietly inserts a play-in round satisfies a game
  // count and breaks the owner's actual requirement, so the byes are asserted where they must land.
  for (const n of [5, 6, 7, 11, 13]) {
    const env = boot(n);
    await burnBootstrap(env);
    const token = await staff(env);
    const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { courts: 3 } });
    assert.equal(r.status, 200, `n=${n} was refused: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.matches_written, n - 1, `n=${n} must draw exactly ${n - 1} games`);

    const a = r.data.brackets.find((b) => b.name === "A");
    const size = 1 << Math.ceil(Math.log2(n));
    assert.equal(a.byes, size - n, `n=${n}: every empty slot must be a bye, never a play-in`);
    assert.equal(a.rounds, Math.ceil(Math.log2(n)), `n=${n}: round count must match the tree depth`);
  }
});

/* ===================== 4 · no pool is not a refusal on this path ===================== */

test("with no pool played, the league bracket still draws and says it seeded by entry seed", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { courts: 2 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.seeded_by, "entry seed",
    "N-6, half answered in code: this path falls back rather than refusing without pool play");
});

/* ===================== 5 · when the league IS scored, the league's finish seeds it ===================== */

test("a scored league seeds its own bracket from its own standings, not from a separate registration", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);

  // Reverse the entry seeds: team 8 finishes first. If the bracket were still reading entry seed the
  // top slot would hold Team 1, so this distinguishes the two sources rather than merely agreeing.
  for (let i = 1; i <= 8; i++) {
    env.DB.exec(
      "INSERT INTO standings (org_id, event_id, team_id, wins, losses, rank) VALUES " +
      `(1,1,${i},${i},${8 - i},${9 - i})`
    );
  }
  const check = env.DB.query("SELECT team_id FROM standings WHERE event_id = 1 ORDER BY rank");
  assert.equal(check.length, 8, "the standings mutation must land or this test proves nothing");
  assert.equal(check[0].team_id, 8, "team 8 must be rank 1 for the two seed sources to disagree");

  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { courts: 2 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.seeded_by, "pool finish", "the league's own finish is the roster order");

  const cfg = JSON.parse(env.DB.one("SELECT config_json FROM brackets WHERE name='A' AND deleted_at IS NULL").config_json);
  assert.equal(cfg.seeds[0], 8, "the top seed must be the league's first-place team, not entry seed 1");
});

/* ===================== 6 · type independence, stated as behaviour ===================== */

test("the same field draws identically whether the event is typed league or tournament", async () => {
  // This is the absence the whole file is about. If a type gate is ever introduced, the two runs
  // stop matching and this fails — which a code read of `generateBracketFor` could not promise.
  const results = {};
  for (const type of ["league", "tournament"]) {
    const env = boot(9, type);
    await burnBootstrap(env);
    const token = await staff(env);
    const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { courts: 3 } });
    assert.equal(r.status, 200, `${type} was refused: ${JSON.stringify(r.data)}`);
    results[type] = { written: r.data.matches_written, seeded: r.data.seeded_by, rounds: r.data.brackets[0].rounds };
  }
  assert.deepEqual(results.league, results.tournament,
    "events.type must not change what a bracket does — Shape A depends on that");
});

/* ===================== negative controls ===================== */

test("NC-1: with the teams removed, generation refuses — the success above is not unconditional", async () => {
  const env = boot(10);
  await burnBootstrap(env);
  const token = await staff(env);

  env.DB.exec("UPDATE teams SET deleted_at = datetime('now') WHERE event_id = 1");
  const left = env.DB.query("SELECT id FROM teams WHERE event_id = 1 AND deleted_at IS NULL");
  assert.equal(left.length, 0, "MUTATION DID NOT LAND — the teams are still live, so this NC proves nothing");

  const r = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { courts: 3 } });
  assert.notEqual(r.status, 200, "an empty field must not draw a bracket");
  assert.equal(drawn(env).length, 0, "and nothing may be written on the way to refusing");
});

test("NC-2: a missing event 404s while the live one 200s — so a refusal is never mistaken for a dead route", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);

  const alive = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { courts: 2 } });
  assert.equal(alive.status, 200, "positive control: the route must be reachable for the 404 below to mean anything");

  const gone = await call(env, "POST", "/api/admin/events/4242/brackets", { token, body: { courts: 2 } });
  assert.equal(gone.status, 404);
});

/* ============ v0.108.0 · the timeframe estimate (owner, 2026-08-08) ============

   Owner: the end-of-league tournament "changes based on participants and timeframe available", and
   the goal is "to get everyone sufficient games (so we can double games in pool play if needbe)".
   Asked which knob gives when time is short, the answer was "top 8". Asked per-division or
   league-wide: "Generally, 1 bracket across the league", splitting only for a large unrated field
   with wide skill variation.

   THE ESTIMATE IS ONLY WORTH ANYTHING IF IT MATCHES THE DRAW. An estimate produced by a second
   implementation agrees with reality right up until it doesn't, and on that day it still looks
   exactly like an estimate. So the load-bearing test here is the AGREEMENT test: preview and
   generation must report the same games and the same waves for the same input. */

const preview = (env, token, body, id = 1) =>
  call(env, "POST", `/api/admin/events/${id}/brackets/preview`, { token, body });

test("preview and the real draw agree on games and waves — the estimate is not a second opinion", async () => {
  // Several shapes, including one that splits into A and BB, because the wave count is where a
  // parallel implementation would drift first: two brackets share courts and queue against them.
  for (const body of [{ courts: 3 }, { courts: 2, a_size: 8 }, { courts: 4, a_size: 8, include_rest: true }]) {
    const env = boot(13);
    await burnBootstrap(env);
    const token = await staff(env);

    const p = await preview(env, token, body);
    assert.equal(p.status, 200, `preview refused: ${JSON.stringify(p.data)}`);

    const g = await call(env, "POST", "/api/admin/events/1/brackets", { token, body });
    assert.equal(g.status, 200, `generate refused: ${JSON.stringify(g.data)}`);

    assert.equal(p.data.games, g.data.matches_written, `games disagree for ${JSON.stringify(body)}`);
    assert.equal(p.data.waves, g.data.waves, `waves disagree for ${JSON.stringify(body)}`);
    assert.equal(p.data.seeded_by, g.data.seeded_by);
    assert.deepEqual(p.data.brackets.map((x) => x.name), g.data.brackets.map((x) => x.name));
  }
});

test("preview writes nothing — a director can ask without committing", async () => {
  const env = boot(12);
  await burnBootstrap(env);
  const token = await staff(env);

  const p = await preview(env, token, { courts: 3, slot_minutes: 20 });
  assert.equal(p.status, 200);
  assert.ok(p.data.games > 0, "the preview must actually have computed something");

  assert.equal(drawn(env).length, 0, "preview must not write matches");
  assert.equal(env.DB.query("SELECT id FROM brackets WHERE deleted_at IS NULL").length, 0,
    "preview must not write bracket rows either");
});

test("waves are rounds of simultaneous play, not games — courts change the clock, not the game count", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);

  const wide = await preview(env, token, { courts: 4, slot_minutes: 20 });
  const narrow = await preview(env, token, { courts: 1, slot_minutes: 20 });

  assert.equal(wide.data.games, narrow.data.games, "the same field plays the same number of games");
  assert.ok(narrow.data.waves > wide.data.waves,
    `one court must take more waves than four (got ${narrow.data.waves} vs ${wide.data.waves})`);
  assert.equal(wide.data.needs_minutes, wide.data.waves * 20, "minutes are waves times slot length");
});

/* THESE THREE TESTS ASSERTED THE v0.108.0 RULE AND THE OWNER REVERSED IT ON 2026-08-08.
   They are rewritten rather than deleted: the surfaces they covered (spare time, an overrunning
   draw, an already-minimal field) still need cover — what changed is the correct ANSWER on each. */

/** Write  real pool games for every pair, so the count is measured rather than asserted. */
function seedPool(env, teams, rounds, base) {
  let mid = base;
  for (let round = 1; round <= rounds; round++) {
    for (let t = 1; t <= teams; t += 2) {
      env.DB.exec(
        "INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, points_to, cap, game_number) VALUES " +
        `(${mid++},1,1,'pool',${round},${(t + 1) / 2},${t},${t + 1},25,27,1)`
      );
    }
  }
  const n = env.DB.query("SELECT id FROM matches WHERE stage='pool' AND deleted_at IS NULL").length;
  assert.equal(n, (teams / 2) * rounds, "the pool fixture must land or the test proves nothing");
}

test("once the floor is met, spare time buys MORE POOL PLAY — not a bigger bracket", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);
  seedPool(env, 8, 8, 900);

  const p = await preview(env, token, { courts: 4, slot_minutes: 20, minutes_available: 300 });
  assert.equal(p.status, 200);
  assert.equal(p.data.meets_minimum, true, "eight pool games already clears the floor");
  assert.equal(p.data.fits, true);
  assert.match(p.data.suggestion, /pool play/i,
    "spare time is offered as more pool play, because that is where the games are");
});

test("an overrunning draw reports the overrun and still does not tell you to cut the field", async () => {
  // v0.108.0 answered this with "try a top-8 bracket". The owner reversed the unit on 2026-08-08:
  // time is a boundary, games are the measure, and "we try to break everyone possible".
  const env = boot(16);
  await burnBootstrap(env);
  const token = await staff(env);
  seedPool(env, 16, 8, 1000);

  const p = await preview(env, token, { courts: 1, slot_minutes: 25, minutes_available: 60 });
  assert.equal(p.status, 200);
  assert.equal(p.data.meets_minimum, true, "the games floor is met even though the clock is not");
  assert.equal(p.data.fits, false, "this shape must genuinely overrun or the test proves nothing");
  assert.match(p.data.suggestion, /minutes past the window/i, "the overrun is still reported");
  assert.ok(!/top.?8/i.test(p.data.suggestion),
    "cutting the field is never volunteered — the owner breaks everyone possible");
});
test("league-wide is the default: no division is stamped unless one is asked for", async () => {
  // Owner: "Generally, 1 bracket across the league." The split is the exception, so the default
  // path must not quietly scope to a division.
  const env = boot(10);
  await burnBootstrap(env);
  const token = await staff(env);
  const g = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { courts: 3 } });
  assert.equal(g.status, 200);
  const rows = env.DB.query("SELECT division_id FROM brackets WHERE deleted_at IS NULL");
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.division_id === null || r.division_id === undefined),
    "the default draw is league-wide and must stamp no division");
});

test("NC-3: preview refuses an event that isn't there, while a live one 200s", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);
  const alive = await preview(env, token, { courts: 2 });
  assert.equal(alive.status, 200, "positive control — the preview route must be reachable");
  const gone = await preview(env, token, { courts: 2 }, 4242);
  assert.equal(gone.status, 404);
});

test("NC-4: with the teams gone, preview refuses instead of estimating an empty bracket", async () => {
  const env = boot(10);
  await burnBootstrap(env);
  const token = await staff(env);

  env.DB.exec("UPDATE teams SET deleted_at = datetime('now') WHERE event_id = 1");
  const left = env.DB.query("SELECT id FROM teams WHERE event_id = 1 AND deleted_at IS NULL");
  assert.equal(left.length, 0, "MUTATION DID NOT LAND — this NC would prove nothing");

  const p = await preview(env, token, { courts: 3, slot_minutes: 20 });
  assert.notEqual(p.status, 200, "an empty field has no bracket to estimate");
});

test("NC-5: preview requires staff — an anonymous caller gets no answer", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const anon = await preview(env, undefined, { courts: 2 });
  assert.ok(anon.status === 401 || anon.status === 403, `expected a refusal, got ${anon.status}`);
});

/* ============ v0.109.0 · GAMES, not minutes (owner, 2026-08-08) ============

   The owner reversed v0.108.0's core unit in one clause: "however do not use time as the core unit
   of measure." The measure is GAMES PER TEAM.

   The model, verbatim: "We aim at roughly 8 games x 25 pts in pool play before cutting anyone. If
   they receive less than that, for example 6 or 7, then everyone needs to break to meet the game
   minimum (8 games) that the first bracket games should fulfill. Bracket games usually are 1 to 25
   in normal scenarios, sometimes they are 2 to 21 depending on how we break them. Game matches
   (best of 3) are considered 2.25 (since there's a 25% chance of it going to 3 games)."

   So the bracket's job, when pool play came up short, is to TOP TEAMS UP to the floor — which is
   why "break everyone" is the answer and cutting to a top 8 is not. Time is a boundary (7–8 hours,
   6 with fewer teams), never the unit.

   THE FLOOR ALREADY EXISTED AND MUST NOT BE RE-DECLARED. `formats.js` exports
   MIN_GAMES_PER_TEAM = 8 and the pool generator already refuses a round count that cannot give
   every team an equal number. A second 8 in this file would be a second definition of the owner's
   rule, free to drift. These tests assert the imported constant, not a literal. */
import { MIN_GAMES_PER_TEAM } from "../src/formats.js";
import { BEST_OF_3_GAMES, guaranteedGames } from "../src/brackets.js";

test("the games floor has ONE definition and it is the one formats.js already owned", () => {
  assert.equal(MIN_GAMES_PER_TEAM, 8, "the owner's floor is 8 games");
  // If brackets.js ever hard-codes its own 8, this is the test that should have caught it.
  const src = blankComments(readFileSync(new URL("../src/brackets.js", import.meta.url), "utf8")); // D-45
  assert.ok(/MIN_GAMES_PER_TEAM/.test(src), "brackets.js must import the floor, never restate it");
});

test("a best-of-3 match counts 2.25 games — the owner's number, not a rounded one", () => {
  assert.equal(BEST_OF_3_GAMES, 2.25);
  // 25% of best-of-3 matches go to a third game: 2 + 0.25. Rounding to 2 loses exactly the
  // quantity that decides whether a 6-game pool reaches the floor.
  assert.equal(guaranteedGames(6, true, 3), 8.25, "6 pool + a best-of-3 first round clears 8");
  assert.equal(guaranteedGames(6, true, 1), 7, "6 pool + one single game does NOT clear 8");
  assert.equal(guaranteedGames(7, true, 1), 8, "7 pool + one single game lands exactly on 8");
  assert.equal(guaranteedGames(6, false, 3), 6, "a team that does not break gets nothing from the bracket");
});

test("preview leads with games per team, and counts real pool games from the table", async () => {
  const env = boot(10);
  await burnBootstrap(env);
  const token = await staff(env);

  // Six pool games each, written as real rows so the count is measured, not asserted into being.
  let mid = 500;
  for (let round = 1; round <= 6; round++) {
    for (let t = 1; t <= 10; t += 2) {
      env.DB.exec(
        "INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, points_to, cap, game_number) VALUES " +
        `(${mid++},1,1,'pool',${round},${(t + 1) / 2},${t},${t + 1},25,27,1)`
      );
    }
  }
  const check = env.DB.query("SELECT id FROM matches WHERE stage='pool' AND deleted_at IS NULL");
  assert.equal(check.length, 30, "the pool fixture must land or the count below proves nothing");

  const p = await preview(env, token, { courts: 3 });
  assert.equal(p.status, 200);
  assert.equal(p.data.pool_games_per_team.min, 6, "each team played six pool games");
  assert.equal(p.data.target_games, MIN_GAMES_PER_TEAM);
});

test("six pool games and everyone breaking is still short unless the first round is best of 3", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);
  let mid = 600;
  for (let round = 1; round <= 6; round++) {
    for (let t = 1; t <= 8; t += 2) {
      env.DB.exec(
        "INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, points_to, cap, game_number) VALUES " +
        `(${mid++},1,1,'pool',${round},${(t + 1) / 2},${t},${t + 1},25,27,1)`
      );
    }
  }

  const single = await preview(env, token, { courts: 2 });
  assert.equal(single.data.guaranteed_games, 7, "6 pool + 1 bracket game is 7");
  assert.equal(single.data.meets_minimum, false);
  assert.match(single.data.suggestion, /best of 3|best-of-3/i,
    "the owner's fix for a short pool is a best-of-3 first round, not cutting the field");

  const bo3 = await preview(env, token, { courts: 2, best_of: 3 });
  assert.equal(bo3.data.guaranteed_games, 8.25);
  assert.equal(bo3.data.meets_minimum, true);
});

test("cutting the field is never the suggestion when teams are short of the floor", async () => {
  // "we try to break everyone possible to give them as many games as possible." A top-8 suggestion
  // here would take games AWAY from exactly the teams that do not have enough.
  const env = boot(16);
  await burnBootstrap(env);
  const token = await staff(env);
  let mid = 700;
  for (let round = 1; round <= 5; round++) {
    for (let t = 1; t <= 16; t += 2) {
      env.DB.exec(
        "INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, points_to, cap, game_number) VALUES " +
        `(${mid++},1,1,'pool',${round},${(t + 1) / 2},${t},${t + 1},25,27,1)`
      );
    }
  }
  const p = await preview(env, token, { courts: 4, a_size: 8, include_rest: false });
  assert.equal(p.data.everyone_breaks, false, "this fixture deliberately cuts the field");
  assert.equal(p.data.meets_minimum, false);
  assert.match(p.data.suggestion, /break everyone|everyone breaks|all \d+ teams/i,
    "the fix for a short field is to break everyone, never to cut it further");
  assert.ok(!/top.?8/i.test(p.data.suggestion),
    "recommending a top 8 to teams short of the floor is the opposite of the owner's rule");
});

test("time is reported as a boundary, never as the verdict", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);
  const p = await preview(env, token, { courts: 2, slot_minutes: 20, minutes_available: 30 });
  assert.equal(p.status, 200);
  // The bracket cannot fit 30 minutes, but the verdict field is about GAMES, not the clock.
  assert.equal(typeof p.data.meets_minimum, "boolean");
  assert.ok("guaranteed_games" in p.data, "games is the unit the answer is expressed in");
  assert.ok(p.data.needs_minutes > 30, "the time boundary is still reported");
});

/* ===================== N-6 · brackets come out of pool play ===================== */

test("a bracket not seeded by pool play says so — the two look identical otherwise", async () => {
  // Owner, 2026-08-08: "Please ensure brackets are scored by pool play, that is the whole point of
  // pool play." The fallback is not removed — a bracket-only event needs it — but it must announce
  // itself, because a bracket seeded from entry order is indistinguishable from a real finish.
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);

  const cold = await preview(env, token, { courts: 2 });
  assert.equal(cold.data.seeded_by, "entry seed");
  assert.match(cold.data.seed_warning, /not pool play/i, "an unearned seeding must be named");

  // Now score a real finish and the warning must clear — otherwise it is decoration that always
  // fires, which is the same as never firing.
  for (let i = 1; i <= 8; i++) {
    env.DB.exec(
      "INSERT INTO standings (org_id, event_id, team_id, wins, losses, rank) VALUES " +
      `(1,1,${i},${i},${8 - i},${9 - i})`
    );
  }
  const check = env.DB.query("SELECT team_id FROM standings WHERE event_id = 1");
  assert.equal(check.length, 8, "MUTATION DID NOT LAND — the standings were not written");

  const warm = await preview(env, token, { courts: 2 });
  assert.equal(warm.data.seeded_by, "pool finish");
  assert.equal(warm.data.seed_warning, null, "a bracket that DID come out of pool play must not nag");
});

/* ============ v0.110.0 · THE STANDARD TOURNAMENT TEMPLATE (owner, 2026-08-08) ============

   Verbatim: "generally in a standard tournament template - we would aim to run 8 games in pool play,
   break everyone then best of 3 matches quarters to finals. Usually though, we have 9-10 ROUNDS (not
   games) so we hit the 8 but ten due to time, we do 1 game quater finals to 25, then 2 mathes best of
   3 for semi and finals. This way the max games players are playing are approximately 12-16. More
   than 16 become physically unplayable."

   And the time model: "This is just an estimate with each match taking 20 minutes, Each 15 pt takes
   15 minutes (3rd game of a match)."

   FOUR THINGS THIS ADDS, AND ONE IT CORRECTS.

   1. ROUNDS ARE NOT GAMES. Nine or ten rounds yield eight games each, because byes are rounds in
      which a team does not play. `formats.js` has always known this — gamesPerTeam is 2CR/N, not R.
      The owner's sentence is the reason the distinction has to survive into this module's wording.

   2. THE BRACKET IS NOT ONE FORMAT. Quarters and earlier are ONE game to 25; semi and final are
      best-of-3. `bracket_round` already counts backwards from the final (1 = final, 2 = semi,
      3 = quarter), so "best-of-3 from round 2 down" states the template exactly.

   3. THERE IS A CEILING, NOT ONLY A FLOOR. Sixteen games is "physically unplayable" — a real
      constraint that no previous session had. A planner with only a floor happily recommends more.

   4. TIME IS DERIVED, NOT TYPED. 20 minutes a match, plus 15 for the third game which happens a
      quarter of the time. That is where 2.25 came from, and it makes a best-of-3 match 23.75 minutes
      of expected clock — so the same template drives games AND minutes and they cannot disagree. */
import {
  MINUTES_PER_MATCH, MINUTES_THIRD_GAME, BEST_OF_3_FROM_ROUND,
  gamesForRound, minutesForRound, bracketGames,
} from "../src/brackets.js";
// v0.150.0 (T2-4): the ceiling moved to formats.js beside the floor — one home per bound. This
// file's PURPOSE (pin the value and the over-ceiling behaviour) is unchanged; only the address is.
import { MAX_GAMES_PER_TEAM } from "../src/formats.js";
import { blankComments } from "../testkit/route-extract.mjs";

test("the template: quarters are one game, semi and final are best of 3", () => {
  assert.equal(BEST_OF_3_FROM_ROUND, 2, "round 1 is the final and round 2 the semi");
  assert.equal(gamesForRound(1), BEST_OF_3_GAMES, "final is best of 3");
  assert.equal(gamesForRound(2), BEST_OF_3_GAMES, "semi is best of 3");
  assert.equal(gamesForRound(3), 1, "quarter-final is ONE game to 25 — the owner's time concession");
  assert.equal(gamesForRound(4), 1, "and everything earlier than the quarters likewise");
});

test("the owner's own worked example lands between 12 and 16 games", () => {
  // 8 pool games, break everyone, an 8-team bracket: quarters (1) + semi (2.25) + final (2.25).
  const b = bracketGames(3);
  assert.equal(b.guaranteed, 1, "a team knocked out in the quarters plays one bracket game");
  assert.equal(b.max, 5.5, "a team that goes all the way plays 1 + 2.25 + 2.25");
  assert.equal(8 + b.max, 13.5, "which is inside the owner's stated 12-16 band");
  assert.ok(8 + b.max <= MAX_GAMES_PER_TEAM, "and under the ceiling");
});

test("sixteen games is the ceiling — a planner with only a floor recommends the unplayable", () => {
  assert.equal(MAX_GAMES_PER_TEAM, 16, "owner: more than 16 becomes physically unplayable");
  // Ten pool games into a 16-team bracket: 10 + (1 + 1 + 2.25 + 2.25) = 16.5, over the line.
  const deep = bracketGames(4);
  assert.equal(deep.max, 6.5, "round of 16 and quarters are single games, semi and final best of 3");
  assert.ok(10 + deep.max > MAX_GAMES_PER_TEAM, "this shape must genuinely exceed the ceiling");
});

test("time is DERIVED from the same template that counts the games", () => {
  assert.equal(MINUTES_PER_MATCH, 20);
  assert.equal(MINUTES_THIRD_GAME, 15);
  assert.equal(minutesForRound(3), 20, "a single game to 25 is one 20-minute match");
  // 2 games + a 25% chance of a third: 20 + 0.25 x 15. The same quarter that makes a match 2.25 games.
  assert.equal(minutesForRound(2), 23.75, "a best-of-3 costs 20 plus a quarter of 15");
  assert.equal(minutesForRound(1), 23.75);
});

test("the 2.25 and the 23.75 come from ONE assumption, so they cannot drift apart", () => {
  // If someone changes the third-game probability, both numbers must move together. Deriving the
  // minutes from a separate constant is exactly how a planner starts contradicting itself.
  const thirdGameChance = BEST_OF_3_GAMES - 2;
  assert.equal(thirdGameChance, 0.25);
  assert.equal(minutesForRound(1), MINUTES_PER_MATCH + thirdGameChance * MINUTES_THIRD_GAME);
});

test("preview reports the ceiling as well as the floor, and estimates minutes from the template", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);
  seedPool(env, 8, 8, 2000);

  const p = await preview(env, token, { courts: 2 });
  assert.equal(p.status, 200);
  assert.equal(p.data.pool_games_per_team.min, 8);
  assert.equal(p.data.meets_minimum, true);
  assert.equal(p.data.max_games, 13.5, "the winner plays 8 + 1 + 2.25 + 2.25");
  assert.equal(p.data.max_games_ceiling, MAX_GAMES_PER_TEAM);
  assert.equal(p.data.over_ceiling, false);
  assert.ok(p.data.estimated_minutes > 0, "minutes are derived without anyone typing a slot length");
});

test("a field that would exceed 16 games is told so — the ceiling is a real refusal to recommend", async () => {
  const env = boot(16);
  await burnBootstrap(env);
  const token = await staff(env);
  seedPool(env, 16, 11, 3000);   // eleven pool games each, deliberately deep

  const p = await preview(env, token, { courts: 4 });
  assert.equal(p.data.pool_games_per_team.min, 11);
  assert.ok(p.data.max_games > MAX_GAMES_PER_TEAM, "this fixture must genuinely exceed the ceiling");
  assert.equal(p.data.over_ceiling, true);
  assert.match(p.data.suggestion, /16|unplayable|too many games/i,
    "the ceiling must be said out loud, not merely computed");
});

test("NC-6: the ceiling warning does not fire on a normal day", async () => {
  // An assertion that always fires is the same as one that never fires. The standard template must
  // come back clean, or the test above proves nothing.
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);
  seedPool(env, 8, 8, 4000);
  const p = await preview(env, token, { courts: 2 });
  assert.equal(p.data.over_ceiling, false, "the owner's own standard template must not warn");
  assert.ok(!/unplayable/i.test(p.data.suggestion), "and must not mention the ceiling at all");
});
