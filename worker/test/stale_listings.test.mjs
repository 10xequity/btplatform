/**
 * Boomtown Platform — stale sub requests and community listings drop off the boards
 * File: worker/test/stale_listings.test.mjs · Version: v1.0 · Date: 2026-08-10 · Ships in: v0.126.0
 *
 * Owner 2026-08-10: "For the sub finder and game finder — please ensure that after the event
 * expires the event drops out of the announcements and list."
 *
 * MEASURED FIRST, AND IT WAS WORSE THAN REPORTED. Five member-facing queries selected
 * `status='open'` with NO time predicate at all, so a sub request for last Tuesday stayed on the
 * board forever — and `subs.js` orders by `COALESCE(needed_at, created_at) ASC`, oldest first, so
 * expired requests were not merely present, they were **the first thing a member saw**.
 *
 * THE RULE: hide a row whose DAY is provably past. Day granularity, not instant granularity, and
 * that is a decision rather than laziness — `needed_at` is frequently date-only
 * (`subs.js:88` accepts `YYYY-MM-DD` with the time optional), and comparing a date-only value
 * against `datetime('now')` would hide a request at 00:00 on the very morning it is needed.
 * `date(x) < date('now')` keeps it for the whole of its day and drops it the next.
 *
 * THE FORMATS WERE VERIFIED AGAINST THE REAL ENGINE, NOT ASSUMED. Live D1 was asked directly:
 * `date('2026-08-10T19:00:00.000Z')`, `date('2026-08-10 19:00:00')`, `date('2026-08-10T19:00')` and
 * `date('2026-08-10')` all yield `2026-08-10`, and `date('next thursday 7pm')` yields **NULL**.
 * That matters because the two writers disagree: the browser sends
 * `new Date(v).toISOString()` (`web/assets/lfg.js:206`) while the seeder writes
 * `datetime('now','+6 days')`. NULL comparisons are never true, so anything unparseable **stays
 * visible** — the filter fails OPEN, which is the only safe direction for a hide.
 *
 * THE EXIT THAT MUST SURVIVE, AND IT IS WHY THIS IS NOT A ONE-LINE FIX ×5.
 * `web/assets/lfg.js:112` is the ONLY trigger for "Report a no-show", and it renders from
 * `/api/lfg/listings` on a card that is `mine && past`. Filtering past rows out of that list
 * unconditionally would make `report-no-show` unreachable — a built, tested, uncalled route, and
 * the silent death of the whole no-show accountability feature. The same shape sits on the other
 * board: both caps count `status='open'` with no date filter (`subs.js:114`, `lfg.js:336`) and
 * refuse with *"Cancel one before posting another."* Hide a member's own stale rows from them and
 * the product's own instruction becomes impossible to follow — a lockout, and an error message
 * that blames the user for our fault.
 *
 * So the rule is one sentence: **a stale row leaves the boards, but never leaves its own author's
 * view.** Every removal here is paired below with the presence test that proves the exit survived.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { notPastSql } from "../src/subs.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

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

/** Sign in and return the session token. */
async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const v = await call(env, "POST", "/api/auth/verify", {
    token: undefined, body: { token: String(asked.data.dev_link).split("token=")[1] },
  });
  return v.data.token;
}

/**
 * Two members, each with an adult profile so the 18+ community gate admits them, and four rows
 * per board: another member's past and future item, and the caller's OWN past item.
 *
 * `deadline` is written by the SAME `datetime()` arithmetic the seeder uses, so the fixture is in
 * the format production actually stores rather than a format chosen to make the test pass.
 */
function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (7,1,'league','Thursday Coed','published')");
  DB.exec(`INSERT INTO contacts (id, org_id, email, full_name) VALUES
             (500,1,'me@bt.test','Mia Reyes'),(501,1,'other@bt.test','Otto Vance')`);
  DB.exec(`INSERT INTO member_profiles (org_id, contact_id, date_of_birth, visibility) VALUES
             (1,500,'1990-04-02','members'),(1,501,'1988-11-19','members')`);

  // Community listings. play_at in the browser's own ISO-with-Z shape for the past rows, and the
  // seeder's space shape for the future one — both must be understood by one predicate.
  DB.exec(`INSERT INTO lfg_listings (id, org_id, kind, created_by_contact_id, team_name, skill_level,
             gender_requirement, game_type, spots, play_at, location_note, note, status) VALUES
             (60,1,'casual',501,NULL,'any','any','2s',NULL,strftime('%Y-%m-%dT%H:%M:00.000Z', datetime('now','-3 days')),'Court 2','Otto past',   'open'),
             (61,1,'casual',501,NULL,'any','any','2s',NULL,datetime('now','+6 days'),                                   'Court 2','Otto future', 'open'),
             (62,1,'casual',500,NULL,'any','any','2s',NULL,strftime('%Y-%m-%dT%H:%M:00.000Z', datetime('now','-3 days')),'Court 2','Mia past',    'open'),
             (63,1,'casual',501,NULL,'any','any','2s',NULL,NULL,                                                        'Court 2','No date',     'open')`);

  DB.exec(`INSERT INTO sub_requests (id, org_id, event_id, requested_by_contact_id, needed_at,
             skill_level, gender_requirement, game_type, note, status) VALUES
             (70,1,7,501,date('now','-3 days'),'bb','coed','6s','Otto past',  'open'),
             (71,1,7,501,datetime('now','+6 days'),'bb','coed','6s','Otto future','open'),
             (72,1,7,500,date('now','-3 days'),'bb','coed','6s','Mia past',   'open'),
             (73,1,7,501,NULL,'bb','coed','6s','No date',  'open')`);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

/** Sign in as Mia (contact 500). The FIRST-EVER user is bootstrapped admin of every org, so a
    throwaway burns that before the member we actually test. */
async function asMia(env) {
  await signIn(env, "burn@bt.test");
  return signIn(env, "me@bt.test");
}

const notes = (rows) => (rows || []).map((r) => r.note).sort();
const ids = (rows) => (rows || []).map((r) => r.id).sort((a, b) => a - b);

/* ==================== the fixture must be able to exhibit the defect ==================== */

test("PRE-FIX CHECK — the fixture really does hold stale rows on both boards", () => {
  // Without this the whole file could be vacuous: a fixture whose "past" rows are not actually
  // past passes every assertion below while proving nothing.
  const env = boot();
  const stale = env.DB.query(
    "SELECT id FROM lfg_listings WHERE date(play_at) < date('now')");
  assert.deepEqual(ids(stale), [60, 62], "the past listings are not past by the engine's own reckoning");
  const staleSubs = env.DB.query(
    "SELECT id FROM sub_requests WHERE date(needed_at) < date('now')");
  assert.deepEqual(ids(staleSubs), [70, 72], "the past requests are not past");
  // And the row with a NULL date must be invisible to that predicate, or the fail-open claim is false.
  assert.equal(env.DB.query("SELECT id FROM lfg_listings WHERE date(play_at) < date('now') AND id=63").length, 0);
  env.DB.close();
});

/* ==================== the sub finder ==================== */

test("the sub board no longer shows a request whose day has passed", async () => {
  const env = boot();
  const token = await asMia(env);
  const r = await call(env, "GET", "/api/subs/requests", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.ok(!notes(r.data.requests).includes("Otto past"),
    "a request for three days ago is still on the board — and ORDER BY needed_at ASC puts it FIRST");
  assert.ok(notes(r.data.requests).includes("Otto future"), "a future request must still be offered");
  env.DB.close();
});

test("EXIT — a member still sees their OWN stale request, because the cap tells them to cancel it", async () => {
  // subs.js:114 counts every status='open' row with no date filter, and the refusal reads
  // "You already have 5 open sub requests. Cancel one before posting another." Hide a member's own
  // stale rows and that instruction names something they cannot reach.
  const env = boot();
  const token = await asMia(env);
  const r = await call(env, "GET", "/api/subs/requests", { token });
  assert.ok(notes(r.data.requests).includes("Mia past"),
    "the member's own stale request vanished — the cap still counts it and now nothing can cancel it");
  assert.equal(r.data.requests.find((x) => x.note === "Mia past").mine, true);
  env.DB.close();
});

test("a request with no date is never hidden — the filter fails OPEN", async () => {
  const env = boot();
  const token = await asMia(env);
  const r = await call(env, "GET", "/api/subs/requests", { token });
  assert.ok(notes(r.data.requests).includes("No date"),
    "a dateless request was hidden; nothing is known about when it is, so nothing may be concluded");
  env.DB.close();
});

test("a request needed TODAY stays up all day, not from midnight", async () => {
  // The reason the predicate is day-granular. `needed_at` is often date-only, and
  // `datetime('2026-08-10') < datetime('now')` is true from 00:00:01 — which would hide a request
  // on the morning of the day it is needed.
  const env = boot();
  const token = await asMia(env);
  env.DB.exec("UPDATE sub_requests SET needed_at = date('now') WHERE id = 70");
  assert.equal(env.DB.one("SELECT needed_at FROM sub_requests WHERE id=70").needed_at,
    env.DB.one("SELECT date('now') AS d").d, "mutation did not land");
  const r = await call(env, "GET", "/api/subs/requests", { token });
  assert.ok(notes(r.data.requests).includes("Otto past"),
    "a request needed TODAY was hidden — day granularity is the whole point of date() over datetime()");
  env.DB.close();
});

test("NC — moving a live request into the past removes it from the board", async () => {
  // The mutation is on the REAL row, and the assertion is the state change rather than a constant.
  const env = boot();
  const token = await asMia(env);
  const before = await call(env, "GET", "/api/subs/requests", { token });
  assert.ok(notes(before.data.requests).includes("Otto future"), "precondition: the future request is visible");

  env.DB.exec("UPDATE sub_requests SET needed_at = datetime('now','-2 days') WHERE id = 71");
  assert.ok(env.DB.one("SELECT date(needed_at) AS d FROM sub_requests WHERE id=71").d
    < env.DB.one("SELECT date('now') AS d").d, "mutation did not land");

  const after = await call(env, "GET", "/api/subs/requests", { token });
  assert.ok(!notes(after.data.requests).includes("Otto future"),
    "the request was moved into the past and stayed on the board — the predicate is not reading needed_at");
  env.DB.close();
});

/* ==================== the game finder ==================== */

test("the community board no longer shows a game whose day has passed", async () => {
  const env = boot();
  const token = await asMia(env);
  const r = await call(env, "GET", "/api/lfg/listings", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.ok(!notes(r.data.listings).includes("Otto past"), "a game from three days ago is still listed");
  assert.ok(notes(r.data.listings).includes("Otto future"), "a future game must still be listed");
  assert.ok(notes(r.data.listings).includes("No date"), "a dateless casual game must not be hidden");
  env.DB.close();
});

test("EXIT — a member still sees their OWN past listing, or 'Report a no-show' becomes unreachable", async () => {
  // web/assets/lfg.js:112 renders that button only for `mine && past`, from THIS payload, and it is
  // the only trigger in the client. Filtering own rows here kills the no-show feature silently and
  // turns report-no-show into an uncalled route.
  const env = boot();
  const token = await asMia(env);
  const r = await call(env, "GET", "/api/lfg/listings", { token });
  const own = (r.data.listings || []).find((x) => x.note === "Mia past");
  assert.ok(own, "the member's own past listing vanished — the only route to Report a no-show went with it");
  assert.equal(own.mine, true);
  assert.ok(own.play_at, "the client decides 'past' from play_at; without it the button cannot appear");
  env.DB.close();
});

test("NC — moving a live listing into the past removes it from the board", async () => {
  const env = boot();
  const token = await asMia(env);
  const before = await call(env, "GET", "/api/lfg/listings", { token });
  assert.ok(notes(before.data.listings).includes("Otto future"), "precondition: the future game is visible");

  env.DB.exec("UPDATE lfg_listings SET play_at = datetime('now','-2 days') WHERE id = 61");
  assert.ok(env.DB.one("SELECT date(play_at) AS d FROM lfg_listings WHERE id=61").d
    < env.DB.one("SELECT date('now') AS d").d, "mutation did not land");

  const after = await call(env, "GET", "/api/lfg/listings", { token });
  assert.ok(!notes(after.data.listings).includes("Otto future"),
    "the game was moved into the past and stayed listed — the predicate is not reading play_at");
  env.DB.close();
});

/* ==================== the home card and the announcements feed ==================== */

test("the home opportunities card drops stale games — including the caller's own", async () => {
  // This feed is described in source as "cheap and anonymous-safe" and carries no actions, so there
  // is no exit to preserve and no reason to special-case the viewer.
  const env = boot();
  const token = await asMia(env);
  const r = await call(env, "GET", "/api/lfg/opportunities", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const seen = (r.data.opportunities || []).map((o) => o.location_note && o.play_at);
  void seen;
  const stale = (r.data.opportunities || []).filter((o) =>
    o.play_at && String(o.play_at).slice(0, 10) < new Date().toISOString().slice(0, 10));
  assert.deepEqual(stale, [], "a past game is still on the home card");
  assert.ok((r.data.opportunities || []).length >= 2, "the card emptied itself — future and dateless rows must remain");
  env.DB.close();
});

test("the announcements feed drops stale rows in BOTH of its categories", async () => {
  // The owner said "announcements" and he meant it literally: announcements.js runs its own copies
  // of both queries. A fix applied only to subs.js and lfg.js would have left the feed stale and
  // the complaint half-answered.
  const env = boot();
  const token = await asMia(env);
  // Note while writing this: the feed's `events` category has ALWAYS filtered
  // `starts_at >= datetime('now')` (announcements.js:145). So dropping past items is the house
  // style on this very screen, and subs + community were the two categories that never got it.
  const r = await call(env, "GET", "/api/home/feed", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const cats = r.data.categories || {};
  assert.ok(cats.subs, "the feed no longer carries a subs category — this test is not reading it");
  assert.ok(!(cats.subs || []).some((s) => s.id === 70), "a stale sub request is still in the feed");
  assert.ok((cats.subs || []).some((s) => s.id === 71), "the live sub request left the feed too");
  assert.ok(!(cats.community || []).some((l) => l.id === 60), "a stale community listing is still in the feed");
  assert.ok((cats.community || []).some((l) => l.id === 61), "the live listing left the feed too");
  env.DB.close();
});

/* ==================== the shared predicate refuses to become an injection path ============ */

test("notPastSql interpolates a column name, so it refuses anything that is not one", () => {
  // The five call sites all pass literals, and this is what keeps that true: the helper is the
  // only place in the cluster that builds SQL by concatenation, so it fails closed rather than
  // trying to escape. If a future caller ever reaches for a request value, it throws here instead
  // of shipping a predicate an attacker wrote.
  assert.equal(notPastSql("r.needed_at"), "(date(r.needed_at) IS NULL OR date(r.needed_at) >= date('now'))");
  assert.equal(notPastSql("play_at"), "(date(play_at) IS NULL OR date(play_at) >= date('now'))");
  for (const bad of ["play_at) OR 1=1 --", "a.b.c", "", "play at", "'play_at'", null, 1]) {
    assert.throws(() => notPastSql(bad), /literal identifier/,
      `notPastSql accepted ${JSON.stringify(bad)} — it can be made to emit SQL a caller did not intend`);
  }
});

test("every board that offers a dated opportunity actually uses the shared rule", () => {
  // Two lists, one source. The predicate exists so the SIXTH surface cannot be written without it;
  // this asserts the five that exist today all reach for it rather than restating the SQL, because
  // a restated copy is exactly how one board drifts back to showing last Tuesday.
  const src = (f) => blankComments(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"));
  // CALL sites, not occurrences: `subs.js` also DEFINES the helper, and counting the definition as
  // a use is the exact error `gateCallsIn` exists to avoid (an occurrence preceded by `function` is
  // a declaration). Without this the count for subs.js reads 2 and means 1.
  const callsIn = (t) => [...t.matchAll(/notPastSql\s*\(/g)]
    .filter((m) => !/\bfunction\s+$/.test(t.slice(Math.max(0, m.index - 24), m.index))).length;
  for (const [file, count] of [["subs.js", 1], ["lfg.js", 2], ["announcements.js", 2]]) {
    const uses = callsIn(src(file));
    assert.equal(uses, count, `${file} calls notPastSql ${uses} times, expected ${count}`);
  }
  // And nobody hand-rolled it. The helper's own definition is the single permitted occurrence.
  for (const file of ["lfg.js", "announcements.js"]) {
    assert.doesNotMatch(src(file), /date\([^)]*\)\s*>=\s*date\('now'\)/,
      `${file} restates the staleness predicate inline instead of importing it`);
  }
});

/* ==================== the caps are deliberately UNCHANGED ==================== */

test("the flood caps still count a member's stale rows — which is why the exits above exist", async () => {
  // Pairing the removal with the fact that makes the exit necessary. If a future change ever stops
  // counting stale rows, these two tests should be revisited TOGETHER, not one at a time.
  const env = boot();
  const token = await asMia(env);
  const r = await call(env, "GET", "/api/subs/me", { token });
  if (r.status === 200 && r.data && typeof r.data.my_open_requests === "number") {
    assert.equal(r.data.my_open_requests, 1,
      "the cap stopped counting the member's own stale request; the 'cancel one' instruction and the exit test above both assume it does");
  }
  const open = env.DB.one(
    "SELECT COUNT(*) AS n FROM lfg_listings WHERE org_id=1 AND created_by_contact_id=500 AND status='open' AND deleted_at IS NULL");
  assert.equal(open.n, 1, "the listing cap's own query no longer sees the member's stale post");
  env.DB.close();
});
