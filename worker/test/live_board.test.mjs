/* Boomtown Platform — public live board
   File: worker/test/live_board.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.73.0

   Owner 2026-08-03: "there needs to be 2 views, an admin view where they are created, then a display
   view for members and public for those who are wanting to see. similar to volleyballlife."

   THE TESTS THAT MATTER MOST ARE THE ONES ABOUT WHAT IS *NOT* IN THE RESPONSE. This endpoint needs no
   login, so anything it returns is published to anyone who loads the page. A public board that leaks a
   roster publishes a list of minors and their contact details to the internet, and it would do it
   quietly — there is no error, no warning, just a field nobody meant to send.

   So: no player names, no emails, no phones, no director's notes, and no draft events. Each of those
   is asserted against the actual JSON rather than against the query that produced it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../../web/assets/live.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../web/live.html", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

/** A tournament with a division, a pool, scores, a bracket, and a private note on a team. */
function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count, location) VALUES (1,1,'tournament','Summer Open','in_progress',4,'Boomtown Courts')");
  DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (2,1,'tournament','Secret Plan','draft')");
  DB.exec("INSERT INTO divisions (id, org_id, event_id, name, rank, court_from, court_to) VALUES (7,1,1,'Open',1,1,4)");
  DB.exec("INSERT INTO pools (id, org_id, event_id, name, division_id) VALUES (9,1,1,'Pool A',7)");
  for (let i = 1; i <= 4; i++) {
    DB.exec(`INSERT INTO teams (id, org_id, event_id, name, pool_id, division_id, note, score_token)
             VALUES (${i},1,1,'Team ${i}',9,7,'PRIVATE flight at 4pm','deadbeef0000000${i}')`);
    DB.exec(`INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, rank)
             VALUES (1,1,${i},${4 - i},${i},${10 - i * 3},${i})`);
    DB.exec(`INSERT INTO contacts (id, org_id, email, full_name, phone) VALUES (${100 + i},1,'kid${i}@example.com','Minor Child ${i}','555-999${i}')`);
    DB.exec(`INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email)
             VALUES (1,${i},${100 + i},'Minor Child ${i}','kid${i}@example.com')`);
  }
  // Round 1 played, round 2 not.
  DB.exec("INSERT INTO matches (id,org_id,event_id,stage,round,court,team_a_id,team_b_id,points_to,score_a,score_b) VALUES (10,1,1,'pool',1,1,1,2,21,21,15)");
  DB.exec("INSERT INTO matches (id,org_id,event_id,stage,round,court,team_a_id,team_b_id,points_to,score_a,score_b) VALUES (11,1,1,'pool',1,2,3,4,21,21,18)");
  DB.exec("INSERT INTO matches (id,org_id,event_id,stage,round,court,team_a_id,team_b_id,points_to,ref_team_id) VALUES (12,1,1,'pool',2,1,1,3,21,4)");
  DB.exec("INSERT INTO matches (id,org_id,event_id,stage,round,court,team_a_id,team_b_id,points_to) VALUES (13,1,1,'pool',3,1,2,4,21)");
  DB.exec("INSERT INTO brackets (id,org_id,event_id,name,division_id) VALUES (3,1,1,'A',7)");
  DB.exec("INSERT INTO matches (id,org_id,event_id,stage,round,court,team_a_id,team_b_id,points_to,bracket_id,bracket_round,bracket_slot,score_a,score_b) VALUES (20,1,1,'final',4,1,1,3,25,3,1,1,25,20)");
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

/** No Authorization header, ever. That is the point of these routes. */
async function pub(env, path) {
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    headers: { Origin: ORIGIN, "X-Org-Id": "1" },
  }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
  return { status: res.status, data, headers: res.headers, raw: t };
}

/* ================================ it works without a login ================================ */

test("the board loads with no Authorization header at all", async () => {
  const env = boot();
  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.event.name, "Summer Open");
  env.DB.close();
});

test("the event list is public too, and excludes drafts", async () => {
  const env = boot();
  const r = await pub(env, "/api/live/events");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.events.map((e) => e.name), ["Summer Open"]);
  env.DB.close();
});

/* ================================ what must NOT be in there ================================ */

test("no player name, email, phone or director's note appears anywhere in the payload", async () => {
  // Asserted against the raw JSON, not against the queries. A join added later that pulls a name in
  // has to fail here, whatever shape it arrives in.
  const env = boot();
  const r = await pub(env, "/api/live/events/1");
  for (const secret of ["Minor Child", "kid1@example.com", "555-9991", "PRIVATE flight", "deadbeef"]) {
    assert.ok(!r.raw.includes(secret),
      `the public board leaked "${secret}" — this endpoint needs no login, so that is published to anyone`);
  }
  env.DB.close();
});

test("a draft event answers 404, not 403", async () => {
  // 403 confirms the thing exists. An unannounced tournament is exactly what is not worth confirming.
  const env = boot();
  const r = await pub(env, "/api/live/events/2");
  assert.equal(r.status, 404);
  assert.match(r.data.error, /No such event/);
  env.DB.close();
});

test("another org's event is invisible", async () => {
  const env = boot();
  env.DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (2,'Other','other',1)");
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (50,2,'tournament','Theirs','published')");
  const r = await pub(env, "/api/live/events/50");
  assert.equal(r.status, 404);
  const list = await pub(env, "/api/live/events");
  assert.ok(!list.raw.includes("Theirs"));
  env.DB.close();
});

/* ================================ "on now" is the whole point ================================ */

test("on-now is the earliest round with an unplayed game, not the time of day", async () => {
  // Tournaments run late. A board that decided what was current from the clock would be wrong all
  // afternoon. Round 1 is played, so round 2 is on and round 3 is next.
  const env = boot();
  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.data.current_round, 2);
  assert.deepEqual(r.data.on_now.map((m) => m.court), [1]);
  assert.deepEqual(r.data.up_next.map((m) => m.court), [1]);
  assert.equal(r.data.on_now[0].team_a, "Team 1");
  assert.equal(r.data.on_now[0].ref_team, "Team 4", "who is refereeing is part of a court call");
  env.DB.close();
});

test("when everything has been played, on-now is empty rather than wrong", async () => {
  const env = boot();
  env.DB.exec("UPDATE matches SET score_a=21, score_b=15 WHERE score_a IS NULL");
  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.data.current_round, null);
  assert.deepEqual(r.data.on_now, []);
  env.DB.close();
});

test("a bracket game is labelled by its round, not called 'Pool'", async () => {
  const env = boot();
  env.DB.exec("UPDATE matches SET score_a=21, score_b=15 WHERE id IN (12,13)");
  env.DB.exec("UPDATE matches SET score_a=NULL, score_b=NULL WHERE id=20");
  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.data.on_now[0].stage, "Final");
  env.DB.close();
});

/* ================================ standings and brackets ================================ */

test("standings arrive grouped by division and pool", async () => {
  const env = boot();
  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.data.divisions.length, 1);
  assert.equal(r.data.divisions[0].name, "Open");
  assert.equal(r.data.divisions[0].pools[0].name, "Pool A");
  assert.equal(r.data.divisions[0].pools[0].standings.length, 4);
  env.DB.close();
});

test("there is a flat table too, because a small event has no divisions at all", async () => {
  // Without this, an event that never set up divisions shows an empty screen and looks broken.
  const env = boot();
  env.DB.exec("UPDATE teams SET division_id=NULL, pool_id=NULL");
  env.DB.exec("UPDATE divisions SET deleted_at=datetime('now')");
  env.DB.exec("UPDATE pools SET deleted_at=datetime('now')");
  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.data.overall.length, 4);
  assert.equal(r.data.overall[0].name, "Team 1", "best record first");
  env.DB.close();
});

test("a team in a division but not yet in a pool still shows up", async () => {
  // Otherwise somebody looks for their team, cannot find it, and concludes the board is broken.
  const env = boot();
  env.DB.exec("UPDATE teams SET pool_id=NULL WHERE id=4");
  const r = await pub(env, "/api/live/events/1");
  assert.deepEqual(r.data.divisions[0].unpooled.map((t) => t.name), ["Team 4"]);
  env.DB.close();
});

test("the bracket comes through with its winner and champion", async () => {
  const env = boot();
  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.data.brackets.length, 1);
  assert.equal(r.data.brackets[0].champion, "Team 1");
  assert.equal(r.data.brackets[0].rounds[0].label, "Final");
  assert.equal(r.data.brackets[0].rounds[0].matches[0].winner, "Team 1");
  env.DB.close();
});

test("a tie is not a winner on the public board either", async () => {
  const env = boot();
  env.DB.exec("UPDATE matches SET score_a=24, score_b=24 WHERE id=20");
  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.data.brackets[0].champion, null);
  assert.equal(r.data.brackets[0].rounds[0].matches[0].winner, null);
  env.DB.close();
});

/* ================================ caching ================================ */

test("the public board is briefly cacheable; the rest of the API still is not", async () => {
  // A wall display polls all day. 20 seconds of staleness on a scoreboard is fine; a cached copy of
  // anything behind a login is not, so the default must be untouched.
  const env = boot();
  const live = await pub(env, "/api/live/events/1");
  assert.match(live.headers.get("cache-control") || "", /max-age=20/);

  const health = await worker.fetch(new Request(`${ORIGIN}/api/health`, { headers: { Origin: ORIGIN } }), env);
  assert.equal(health.headers.get("cache-control"), "no-store",
    "extending json() must not have changed the default for every other route");
  env.DB.close();
});

/* ================================ the page ================================ */

test("the page never sends an Authorization header", () => {
  // The moment it does, it stops working for the people it exists for.
  assert.ok(!/Authorization/i.test(PAGE), "the public board must not authenticate");
  assert.ok(!/sessionStorage/.test(PAGE), "and must not depend on a session");
});

test("it fetches ONE endpoint, so the board is one consistent moment", () => {
  const fetches = [...PAGE.matchAll(/fetch\(/g)].length;
  assert.equal(fetches, 1, "polling several endpoints shows several different moments at once");
  assert.match(PAGE, /\/api\/live\/events\//);
});

test("it says when it last updated, and says so louder when it fails", () => {
  // A scoreboard that has silently stopped is worse than one that is visibly stale.
  assert.match(PAGE, /Updated \$\{hh\}:\$\{mm\}:\$\{ss\}/);
  assert.match(PAGE, /Can't reach the scoreboard — showing the last update/);
  assert.match(PAGE, /classList\.add\("stale"\)/);
  assert.match(HTML, /id="lvStamp"[^>]*aria-live/);
});

test("a failed refresh keeps the last good board on screen", () => {
  // Replacing live scores with an error message is the wrong trade on venue wifi.
  assert.match(PAGE, /if \(!r\.ok\) \{[\s\S]{0,400}?return;\s*\}/);
  assert.ok(!/lvNow"\)\.innerHTML = ""/.test(PAGE), "a blip must not blank the board");
});

test("polling stops while the tab is hidden", () => {
  // A board left open overnight should not keep asking.
  assert.match(PAGE, /visibilitychange/);
  assert.match(PAGE, /clearInterval\(timer\)/);
});

test("on-now is first in the markup, not buried under standings", () => {
  const now = HTML.indexOf('id="lvNow"');
  const stand = HTML.indexOf('id="lvStand"');
  assert.ok(now > 0 && stand > 0 && now < stand,
    "the question people open this for is which court, not point differential");
});

test("compared numbers are tabular, and the page is theme-aware", () => {
  assert.match(HTML, /font-variant-numeric: tabular-nums/);
  assert.match(HTML, /prefers-reduced-motion/);
  assert.match(HTML, /data-theme/);
});

/* ================================ v0.77.0 — the board degrades, it does not collapse ================================
   Owner 2026-08-03: "If modules fail, do not let it break or stop the system, simply allow it process
   as best as possible." A wall display in a gym is the least forgiving place for a 500: nobody is
   watching the logs, and the page just goes blank mid-tournament. */

test("one broken read loses one section, not the whole board", async () => {
  const env = boot();
  // Break exactly one of the six reads by removing the table it needs. `brackets` is chosen because it
  // is the section a spectator can most afford to lose — the standings still mean something without it.
  env.DB.exec("DROP TABLE brackets");

  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.status, 200, "a broken section must NOT turn into a 500");
  assert.equal(r.data.degraded, true, "and the board must admit it is incomplete");
  assert.deepEqual(r.data.unavailable, ["brackets"]);
  assert.match(r.data.degraded_note, /Showing what we can/);
  assert.match(r.data.degraded_note, /bracket could not be loaded/);

  // The parts that still worked must still be there — that is the entire point.
  assert.ok(r.data.event, "the event survived");
  assert.ok(Array.isArray(r.data.overall), "the flat standings survived");
  assert.ok(r.data.overall.length > 0, "and they are populated, not merely present");
  assert.deepEqual(r.data.brackets, [], "the lost section falls back to its own shape");
  env.DB.close();
});

test("a healthy board reports itself as healthy — the flag is not stuck on", async () => {
  // Negative control for the test above. A `degraded` that is always true, or an `unavailable` that
  // always lists something, would satisfy every assertion up there while telling spectators the board
  // is broken all afternoon.
  const env = boot();
  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.status, 200);
  assert.equal(r.data.degraded, false, "nothing was broken, so nothing may be reported as missing");
  assert.deepEqual(r.data.unavailable, []);
  assert.equal(r.data.degraded_note, null, "and no note at all, rather than an empty sentence");
  env.DB.close();
});

test("a missing EVENT is still a 404 — degrading must not invent a tournament", async () => {
  // The line the isolation must not cross. With no event there is nothing to show, and answering 200
  // with an empty board would tell a parent the tournament exists and has no games in it.
  const env = boot();
  const r = await pub(env, "/api/live/events/9999");
  assert.equal(r.status, 404);
  assert.match(r.data.error, /No such event/);
  env.DB.close();
});

test("even with every section broken the board answers, and says everything is missing", async () => {
  const env = boot();
  for (const t of ["brackets", "divisions", "pools", "standings"]) env.DB.exec(`DROP TABLE ${t}`);
  const r = await pub(env, "/api/live/events/1");
  assert.equal(r.status, 200, "the request must survive even a wholesale failure");
  assert.equal(r.data.degraded, true);
  // `teams` joins standings, so dropping standings takes the teams read with it.
  assert.ok(r.data.unavailable.length >= 3, `expected several missing, got ${JSON.stringify(r.data.unavailable)}`);
  assert.ok(r.data.event, "the event is read separately and must survive");
  assert.match(r.data.degraded_note, /Showing what we can/);
  env.DB.close();
});
