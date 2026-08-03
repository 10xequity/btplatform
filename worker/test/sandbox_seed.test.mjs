/* Boomtown Platform — test-data fixture tests
   File: worker/test/sandbox_seed.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.67.0

   THE FIXTURE IS A PRODUCT. The owner uses it to try features before real registrations exist, so
   when it is wrong they cannot tell a broken feature from a broken fixture — and they reasonably
   assume the feature. That happened: the v1 seed gave the upcoming tournament four registrations
   and zero teams, so there was nothing to build a pool from, and the drag editor looked dead when
   it was fine.

   So these tests assert the seed is parked at the WORKFLOW, not merely that rows exist:
   somewhere to generate pools, somewhere to generate a bracket, somewhere to watch a winner
   advance. Counting rows would have passed on the broken v1 set. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
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
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
  return { status: res.status, data };
}

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  const u = env.DB.one("SELECT id FROM users WHERE email = 's@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

async function seeded() {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/testdata/generate", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { env, token, r };
}

/* ---------------- the three workflow positions ---------------- */

test("Summer Open is ready to have pools generated — teams, courts, no schedule", async () => {
  // The v1 defect, asserted directly: registrations without teams is a tournament you cannot build.
  const { env } = await seeded();
  const ev = env.DB.one("SELECT court_count FROM events WHERE id=90002");
  assert.equal(ev.court_count, 5, "12-on-5 is the owner's configuration");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM teams WHERE event_id=90002").n, 12);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE event_id=90002").n, 0,
    "nothing scheduled yet — this is the event you point the pool generator at");
  assert.ok(env.DB.one("SELECT COUNT(*) AS n FROM registrations WHERE event_id=90002").n >= 4);
  env.DB.close();
});

test("pools really can be generated and then dragged on Summer Open", async () => {
  // The fixture's whole purpose. Run the actual generator against it, then move a match.
  const { env, token } = await seeded();
  const gen = await call(env, "POST", "/api/admin/events/90002/generate-schedule", {
    token, body: { courts: 5, rounds: 12, assign_refs: true },
  });
  assert.equal(gen.status, 200, JSON.stringify(gen.data));
  assert.equal(gen.data.report.gamesPerTeam.equal, true, "12-on-5 must give every team the same count");

  const first = env.DB.one("SELECT id FROM matches WHERE event_id=90002 ORDER BY round, court LIMIT 1");
  const moved = await call(env, "POST", "/api/admin/events/90002/schedule/move", {
    token, body: { match_id: first.id, round: 1, court: 5 },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  env.DB.close();
});

test("Fall Classic is ready to bracket — pools all scored, standings ranked", async () => {
  const { env } = await seeded();
  const m = env.DB.one("SELECT COUNT(*) AS n, SUM(score_a IS NULL) AS unscored FROM matches WHERE event_id=90004");
  assert.equal(m.n, 28, "a round-robin of 8 is 28 games");
  assert.equal(m.unscored, 0, "all of them scored, or there is nothing to seed from");
  const ranks = env.DB.query("SELECT rank FROM standings WHERE event_id=90004 ORDER BY rank").map((r) => r.rank);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8]);
  env.DB.close();
});

test("the fixture's standings agree with the fixture's own scores", async () => {
  // A hand-written standings table that disagrees with the results would make every bracket-seeding
  // demo quietly meaningless — the bracket would look right and be seeded off fiction.
  const { env } = await seeded();
  const rows = env.DB.query("SELECT team_a_id a, team_b_id b, score_a sa, score_b sb FROM matches WHERE event_id=90004");
  const wins = new Map();
  for (const r of rows) {
    for (const t of [r.a, r.b]) if (!wins.has(t)) wins.set(t, 0);
    wins.set(r.sa > r.sb ? r.a : r.b, wins.get(r.sa > r.sb ? r.a : r.b) + 1);
  }
  for (const s of env.DB.query("SELECT team_id, wins FROM standings WHERE event_id=90004")) {
    assert.equal(s.wins, wins.get(s.team_id), `standings disagree with the scores for team ${s.team_id}`);
  }
  env.DB.close();
});

test("Winter Jam arrives with a real bracket, drawn by the real generator", async () => {
  const { env, r } = await seeded();
  assert.equal(r.data.bracket_ok, true, "the seed must not silently ship without its bracket");
  const b = env.DB.query("SELECT bracket_round, bracket_slot, score_a FROM matches WHERE event_id=90005 AND bracket_id IS NOT NULL");
  assert.equal(b.length, 7, "8 teams is 7 bracket games");
  assert.equal(b.filter((x) => x.bracket_round === 3).length, 4, "four quarter-finals");
  assert.equal(b.filter((x) => x.score_a !== null).length, 0, "left unscored — that is the thing to try");
  env.DB.close();
});

test("scoring a Winter Jam quarter-final advances the winner with no second button", async () => {
  // The owner's actual request: "brackets should auto advance."
  const { env, token } = await seeded();
  const qf = env.DB.one(
    "SELECT id, team_a_id, bracket_slot FROM matches WHERE event_id=90005 AND bracket_round=3 ORDER BY bracket_slot LIMIT 1");
  const semiBefore = env.DB.one("SELECT team_a_id FROM matches WHERE event_id=90005 AND bracket_round=2 AND bracket_slot=1");
  assert.equal(semiBefore.team_a_id, null, "the semi slot starts empty");

  const s = await call(env, "POST", `/api/matches/${qf.id}/score`, { token, body: { winner: "a", diff: 5 } });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.bracket_advanced, 1, "one winner should have moved, without an extra call");

  const semiAfter = env.DB.one("SELECT team_a_id FROM matches WHERE event_id=90005 AND bracket_round=2 AND bracket_slot=1");
  assert.equal(semiAfter.team_a_id, qf.team_a_id, "the quarter-final winner must be sitting in the semi");
  env.DB.close();
});

/* ---------------- captain scoring against the fixture ---------------- */

test("a captain's link shows their BRACKET games, not just pool play", async () => {
  // Was `AND m.stage='pool'`: bracket games were invisible to the teams playing them, so the
  // self-scoring link died at exactly the point in the day the desk is busiest.
  const { env } = await seeded();
  const team = env.DB.one(
    "SELECT t.id, t.score_token FROM teams t JOIN matches m ON m.team_a_id=t.id WHERE m.event_id=90005 AND m.bracket_round=3 LIMIT 1");
  const r = await call(env, "GET", `/api/score/${team.score_token}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const labels = r.data.matches.map((m) => m.stage_label);
  assert.ok(labels.includes("Quarter-final"), `no bracket game in the captain view: ${[...new Set(labels)].join(", ")}`);
  assert.ok(labels.includes("Pool"), "and pool games must still be there");
  env.DB.close();
});

test("the captain view reports what is left, so the page can retire itself", async () => {
  const { env } = await seeded();
  const team = env.DB.one("SELECT score_token FROM teams WHERE event_id=90005 LIMIT 1");
  const r = await call(env, "GET", `/api/score/${team.score_token}`);
  assert.equal(typeof r.data.remaining, "number");
  assert.ok(r.data.remaining > 0, "this team still has bracket games to play");
  assert.equal(r.data.done, false);
  env.DB.close();
});

test("every seeded team has a scoring token", async () => {
  // Without one the link has to be minted by hand before anything can be tried.
  const { env } = await seeded();
  const missing = env.DB.one("SELECT COUNT(*) AS n FROM teams WHERE score_token IS NULL OR score_token = ''");
  assert.equal(missing.n, 0);
  env.DB.close();
});

/* ---------------- housekeeping ---------------- */

test("generating twice is refused rather than stacking a second copy", async () => {
  const { env, token } = await seeded();
  const again = await call(env, "POST", "/api/admin/testdata/generate", { token });
  assert.equal(again.status, 409);
  env.DB.close();
});

test("wipe removes the bracket rows too, even though their ids are outside the test range", async () => {
  // Bracket and match rows created by the real generator get ordinary auto-increment ids. An
  // id-range-only delete would leave them behind and the next generate would refuse forever.
  const { env, token } = await seeded();
  assert.ok(env.DB.one("SELECT COUNT(*) AS n FROM brackets").n > 0);
  const w = await call(env, "POST", "/api/admin/testdata/wipe", { token });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  for (const t of ["events", "teams", "matches", "standings", "registrations", "brackets", "contacts"]) {
    assert.equal(env.DB.one(`SELECT COUNT(*) AS n FROM ${t}`).n, 0, `${t} still has rows after wipe`);
  }
  // And it can be seeded again — proof the wipe was complete, not merely large.
  const re = await call(env, "POST", "/api/admin/testdata/generate", { token });
  assert.equal(re.status, 200, JSON.stringify(re.data));
  env.DB.close();
});

test("wipe only ever touches the test range", async () => {
  // Negative control on the blast radius: a real event beside the fixture must survive.
  const { env, token } = await seeded();
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (7,1,'tournament','Real Event','published')");
  env.DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (7,1,7,'Real Team')");
  await call(env, "POST", "/api/admin/testdata/wipe", { token });
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM events WHERE id=7").n, 1, "a real event was deleted");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM teams WHERE id=7").n, 1, "a real team was deleted");
  env.DB.close();
});
