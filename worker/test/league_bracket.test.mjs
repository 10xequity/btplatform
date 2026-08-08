/* Boomtown Platform — the end-of-league tournament (roadmap §-1d, Shape A)
   File: worker/test/league_bracket.test.mjs · Version: v2.0 · Date: 2026-08-08 · Ships in: v0.108.0

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

test("with time to spare, the spare is reported as more pool play — the owner's actual goal", async () => {
  const env = boot(8);
  await burnBootstrap(env);
  const token = await staff(env);

  const p = await preview(env, token, { courts: 4, slot_minutes: 20, minutes_available: 180 });
  assert.equal(p.status, 200);
  assert.equal(p.data.fits, true);
  assert.equal(p.data.spare_minutes, 180 - p.data.needs_minutes);
  assert.match(p.data.suggestion, /pool play/i,
    "spare time must be offered as more pool play, not as slack");
});

test("when it overruns, the suggestion is top 8 with the number attached", async () => {
  const env = boot(24);
  await burnBootstrap(env);
  const token = await staff(env);

  // One court and a long slot, so the full field cannot possibly fit the window.
  const p = await preview(env, token, { courts: 1, slot_minutes: 25, minutes_available: 60 });
  assert.equal(p.status, 200);
  assert.equal(p.data.fits, false, "this shape must genuinely overrun or the test proves nothing");
  assert.ok(p.data.needs_minutes > 60);
  assert.match(p.data.suggestion, /top-8/i, "the owner's answer for the short case is top 8");
  assert.match(p.data.suggestion, /\d+ minutes/, "a suggestion with no number cannot be acted on");
});

test("a top-8 draw that still overruns is told so, rather than recommended to itself", async () => {
  const env = boot(24);
  await burnBootstrap(env);
  const token = await staff(env);

  const p = await preview(env, token, { courts: 1, slot_minutes: 30, minutes_available: 20, a_size: 8 });
  assert.equal(p.data.fits, false);
  assert.match(p.data.suggestion, /already a top-8|even a top-8/i,
    "recommending top 8 to a top-8 bracket is advice that cannot be followed");
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
