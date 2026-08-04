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

/* ---------------- the 12-court, three-division event ---------------- */

test("the 12-Court Classic really is 12 courts, 3 divisions of 10, on 4 courts each", async () => {
  const { env } = await seeded();
  assert.equal(env.DB.one("SELECT court_count FROM events WHERE id=90006").court_count, 12);
  const divs = env.DB.query("SELECT name, rank, court_from, court_to FROM divisions WHERE event_id=90006 ORDER BY rank");
  assert.deepEqual(divs.map((d) => d.name), ["Open", "A", "BB"]);
  assert.deepEqual(divs.map((d) => [d.court_from, d.court_to]), [[1, 4], [5, 8], [9, 12]]);
  for (const d of divs) {
    const n = env.DB.one("SELECT COUNT(*) AS n FROM teams t JOIN divisions v ON v.id=t.division_id WHERE v.name=?1 AND t.event_id=90006", d.name).n;
    assert.equal(n, 10, `${d.name} should have 10 teams`);
  }
  env.DB.close();
});

test("every division has played a complete round-robin, so the balancer has real records", async () => {
  const { env } = await seeded();
  const m = env.DB.one("SELECT COUNT(*) AS n, SUM(score_a IS NULL) AS unscored FROM matches WHERE event_id=90006");
  assert.equal(m.n, 45 * 3, "three round-robins of 10 is 135 games");
  assert.equal(m.unscored, 0);
  env.DB.close();
});

test("the fixture makes all three balancing rules fire at once", async () => {
  // The sample data exists to demonstrate the feature. If the rules do not fire against it, the
  // owner is looking at a screen that says nothing and has no way to tell whether that is correct.
  const { env, token } = await seeded();
  const r = await call(env, "GET", "/api/admin/events/90006/divisions/plan", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const byDiv = (name) => r.data.proposals.filter((p) => p.from_division === name);

  // Open: the top-division trim. 10 teams, 9th and 10th have played a full day.
  const open = byDiv("Open");
  assert.equal(open.length, 2, "Open should trim its 9th and 10th");
  assert.ok(open.every((p) => p.kind === "drop_from_bracket"), `got ${open.map((p) => p.kind).join(",")}`);
  assert.ok(open.every((p) => p.games_played >= 8), "the trim must only apply to teams that have had their day");

  // A: outliers with somewhere to go.
  assert.equal(byDiv("A").length, 2, "A is seeded with 2 adrift teams");
  assert.ok(byDiv("A").every((p) => p.kind === "move_down" && p.to_division === "BB"));

  // BB: outliers with nowhere to go.
  assert.equal(byDiv("BB").length, 2, "BB is seeded with 2 adrift teams");
  assert.ok(byDiv("BB").every((p) => p.kind === "mini_bracket"),
    "BB is the bottom division — its outliers play each other rather than being sent home");

  // And the top bracket lands on 8 after the trim.
  const openPlan = r.data.divisions.find((d) => d.name === "Open");
  assert.deepEqual(openPlan.brackets.map((b) => b.size), [8]);
  env.DB.close();
});

test("the seeded plan still moves nobody until it is accepted", async () => {
  const { env, token } = await seeded();
  const before = env.DB.query("SELECT id, division_id FROM teams WHERE event_id=90006 ORDER BY id");
  await call(env, "GET", "/api/admin/events/90006/divisions/plan", { token });
  const after = env.DB.query("SELECT id, division_id FROM teams WHERE event_id=90006 ORDER BY id");
  assert.deepEqual(after, before);
  env.DB.close();
});

/* ---------------- housekeeping ---------------- */

test("generating twice CONVERGES rather than refusing — it must never stack a second copy", async () => {
  // v0.83.0 replaced the 409 this test used to assert. The refusal was the bug: it made a seed from
  // an older version of sandbox.js a dead end whose only exit was a Wipe you had to know to look for.
  // The property that actually matters was never "it refuses", it was "you never get two copies".
  const { env, token } = await seeded();
  const counts = () => env.DB.one(
    `SELECT (SELECT COUNT(*) FROM events   WHERE id BETWEEN 90000 AND 90999) e,
            (SELECT COUNT(*) FROM contacts WHERE id BETWEEN 90000 AND 90999) c,
            (SELECT COUNT(*) FROM teams    WHERE event_id BETWEEN 90000 AND 90999) t,
            (SELECT COUNT(*) FROM matches  WHERE event_id BETWEEN 90000 AND 90999) m`);
  const first = counts();
  const again = await call(env, "POST", "/api/admin/testdata/generate", { token });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.replaced, true, "the second run must report that it replaced a seed");
  assert.deepEqual(counts(), first, "a second generate must land on the same fixture, not double it");
  env.DB.close();
});

test("generate RECOVERS a seed left by an older version of this file", async () => {
  // The owner's actual situation on live: a complete seed written 2026-07-24 by the hand-run v1.0
  // seed SQL — three events, eight contacts, teams with no score_token. The old generate refused
  // outright (409), so the fixture could not be brought up to date from the UI at all.
  const env = boot();
  const token = await staff(env);
  env.DB.exec(`
    INSERT INTO contacts (id, org_id, email, full_name, city, state) VALUES
      (90001,1,'test.ava@example.com','TEST Ava Stone','Colorado Springs','CO'),
      (90002,1,'test.ben@example.com','TEST Ben Ortiz','Colorado Springs','CO');
    INSERT INTO events (id, org_id, type, name, status) VALUES
      (90001,1,'tournament','TEST Spring Slam (sample data)','completed'),
      (90002,1,'tournament','TEST Summer Open (sample data)','published');
    INSERT INTO teams (id, org_id, event_id, name) VALUES (90001,1,90001,'TEST Set to Kill')`);

  const r = await call(env, "POST", "/api/admin/testdata/generate", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.replaced, true);

  // The stale rows are gone and the current fixture is in place, whole.
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM events WHERE name LIKE '%Summer Open (sample data)%'").n, 0,
    "the old event name must not survive — that is what 'stale' means");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM contacts WHERE id BETWEEN 90000 AND 90999").n, 48);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM teams WHERE score_token IS NULL OR score_token=''").n, 0,
    "every team must have a scoring token — the v1 rows had none");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM teams WHERE event_id=90002").n, 12,
    "Summer Open must end up with its twelve teams — the v1 seed gave it zero");
  env.DB.close();
});

test("a seed that fails part way leaves the range EXACTLY as it was", async () => {
  // The property the whole release turns on. D1 runs a batch as a transaction, so a failure must
  // roll the entire sequence back rather than leave the unclearable half-state the previous handoff
  // believed was already on live. Forced by making one real statement throw mid-batch.
  const { env, token } = await seeded();
  const beforeEvents = env.DB.one("SELECT COUNT(*) AS n FROM events WHERE id BETWEEN 90000 AND 90999").n;
  const beforeNames = env.DB.query("SELECT name FROM teams WHERE event_id=90002 ORDER BY id").map((r) => r.name);
  assert.ok(beforeEvents > 0 && beforeNames.length === 12, "fixture must be in place for this control");

  const realPrepare = env.DB.prepare.bind(env.DB);
  let threw = false;
  env.DB.prepare = (sql) => {
    const st = realPrepare(sql);
    if (/INSERT INTO standings/.test(sql)) {
      return { ...st, run: async () => { threw = true; throw new Error("forced mid-batch failure"); } };
    }
    return st;
  };
  await call(env, "POST", "/api/admin/testdata/generate", { token }).catch(() => null);
  env.DB.prepare = realPrepare;

  assert.equal(threw, true, "the mutation never fired — this control was testing nothing");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM events WHERE id BETWEEN 90000 AND 90999").n, beforeEvents,
    "the wipe half of the batch was committed without the seed half — that is the partial state");
  assert.deepEqual(env.DB.query("SELECT name FROM teams WHERE event_id=90002 ORDER BY id").map((r) => r.name),
    beforeNames, "the previous fixture must be intact, untouched, exactly as before");
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
