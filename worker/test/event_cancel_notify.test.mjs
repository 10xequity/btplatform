/**
 * Boomtown Platform — §-0 B16: cancelling an event TELLS the people registered for it
 * File: worker/test/event_cancel_notify.test.mjs · Version: v1.0 · Date: 2026-08-10 · Ships in: v0.129.0
 *
 * P-C's genuinely missing half (measured iteration 54): the Cancel button, series-cancel and the
 * bulk editor all flip `status='cancelled'` and notify NOBODY. The people who paid find out at
 * the door. This is also the exact workflow the owner's correspondent lives — cancel a session
 * when not enough people sign up — and the substrate for §-1o SG-2 (threshold + cancel) and for
 * the owner's 2026-08-10 requirement that an event screen can "contact and email the participants
 * with information or news": ONE helper that messages an event's active registrants, whose first
 * caller is cancellation.
 *
 * THE EGRESS WAS ENUMERATED, NOT ASSUMED — and the prompt's "two sites" was WRONG; there are THREE
 * writers of status='cancelled':
 *   1. tournaments.js patchEvent   — PATCH /api/events/:id      (the UI's Cancel button)
 *   2. events_admin.js cancelSeries — DELETE /api/admin/series/:sid
 *   3. events_admin.js bulkEdit     — PATCH /api/admin/events/bulk with fields.status
 * All three call the ONE helper; a fourth writer added later without it is what the
 * transition-only tests below exist to catch quickly.
 *
 * THE RULES, EACH PINNED:
 *  · ACTIVE registrants only — statuses read from the SCHEMA's CHECK constraint
 *    ('pending','email-sent','paid','cash-pending','comped'), never guessed. A registration the
 *    member already cancelled hears nothing.
 *  · TRANSITION only — re-saving an already-cancelled event notifies nobody twice.
 *  · ONE notification per member per event — two teams, one message.
 *  · HONEST about email — sendEmail returns false with no BREVO_API_KEY (read, not assumed), so
 *    the response must SAY nothing was emailed and that the in-app inbox still carries it. A
 *    control that reports success it did not achieve is this project's most-paid-for defect.
 *    (The actual Brevo send stays untested here like every other sendEmail caller — the suite
 *    runs keyless by design; `with_email` pins the who-would-be-emailed logic instead.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

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

async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const v = await call(env, "POST", "/api/auth/verify", {
    body: { token: String(asked.data.dev_link).split("token=")[1] },
  });
  return v.data.token;
}

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec(`INSERT INTO events (id, org_id, type, name, starts_at, status) VALUES
    (50,1,'league','Thursday Coed 4s',datetime('now','+7 days'),'published'),
    (53,1,'tournament','Fall Classic',datetime('now','+14 days'),'published')`);
  DB.exec(`INSERT INTO events (id, org_id, type, name, starts_at, status, series_id) VALUES
    (51,1,'training','Tuesday Skills',datetime('now','+3 days'),'published','ser-1'),
    (52,1,'training','Tuesday Skills',datetime('now','+10 days'),'published','ser-1')`);
  DB.exec(`INSERT INTO contacts (id, org_id, email, full_name) VALUES
    (900,1,'ava@bt.test','Ava Stone'),(901,1,'ben@bt.test','Ben Marsh'),(903,1,'dee@bt.test','Dee Cruz')`);
  DB.exec("INSERT INTO contacts (id, org_id, full_name) VALUES (902,1,'Cam Reyes')"); // no email — W-G's real shape
  DB.exec(`INSERT INTO registrations (org_id, event_id, contact_id, status) VALUES
    (1,50,900,'paid'),
    (1,50,900,'pending'),
    (1,50,901,'cancelled'),
    (1,50,902,'pending'),
    (1,51,903,'paid'),
    (1,52,900,'paid'),
    (1,53,901,'paid')`);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function tokens(env) {
  const staff = await signIn(env, "staff@bt.test"); // first account bootstraps admin (test fixture rule)
  const member = await signIn(env, "member@bt.test");
  return { staff, member };
}

const cancelled = (env, eventId) => env.DB.query(
  "SELECT contact_id FROM notifications WHERE kind='event_cancelled' AND json_extract(payload_json,'$.event_id')=?1 ORDER BY contact_id",
  eventId).map((r) => r.contact_id);

/* ==================== the fixture can exhibit the defect ==================== */

test("PRE-FIX CHECK — event 50 has active registrants who could be notified, and one who must not be", () => {
  const env = boot();
  const active = env.DB.query(
    "SELECT DISTINCT contact_id FROM registrations WHERE event_id=50 AND status IN ('pending','email-sent','paid','cash-pending','comped')");
  assert.equal(active.length, 2, "the fixture lost its active registrants — every test below could go vacuous");
  assert.equal(env.DB.query("SELECT 1 AS x FROM registrations WHERE event_id=50 AND status='cancelled'").length, 1,
    "the fixture lost its cancelled registration — the active-only rule would be untestable");
  env.DB.close();
});

/* ==================== the UI's own path: PATCH /api/events/:id ==================== */

test("cancelling an event notifies ACTIVE registrants only — one message per member, none for the cancelled", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const r = await call(env, "PATCH", "/api/events/50", { token: staff, body: { status: "cancelled" } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));

  assert.deepEqual(cancelled(env, 50), [900, 902],
    "expected exactly Ava (deduped from two registrations) and Cam; Ben's registration was already cancelled");
  const row = env.DB.one("SELECT title, body, target FROM notifications WHERE kind='event_cancelled' AND contact_id=900");
  assert.match(row.title, /Thursday Coed 4s/, "the notification does not name the event");
  assert.equal(row.target, "member");
  env.DB.close();
});

test("the response is HONEST about email: keyless means it says so, and counts who has an address", async () => {
  // sendEmail returns false without BREVO_API_KEY (read from its source, not assumed). The suite
  // runs keyless, so the truthful report is: notified in-app, N have addresses, nothing emailed.
  const env = boot();
  const { staff } = await tokens(env);
  const r = await call(env, "PATCH", "/api/events/50", { token: staff, body: { status: "cancelled" } });
  const n = r.data.cancelled_notice;
  assert.ok(n, "cancelling returned no cancelled_notice — the UI has nothing to show the director");
  assert.equal(n.notified, 2);
  assert.equal(n.with_email, 1, "Ava has an address, Cam does not — with_email pins the would-email logic keyless");
  assert.equal(n.emailed, 0);
  assert.match(n.note, /nothing was emailed/i,
    "no mail key is set and the note does not say so — success it did not achieve");
  assert.match(n.note, /inbox/i, "the note should say members still see it in their member inbox");
  env.DB.close();
});

test("TRANSITION only — re-saving an already-cancelled event notifies nobody twice", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  await call(env, "PATCH", "/api/events/50", { token: staff, body: { status: "cancelled" } });
  const after1 = env.DB.one("SELECT COUNT(*) AS n FROM notifications WHERE kind='event_cancelled'").n;
  assert.ok(after1 > 0, "precondition: the first cancel notified someone");

  const r2 = await call(env, "PATCH", "/api/events/50", { token: staff, body: { status: "cancelled" } });
  assert.equal(r2.status, 200);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM notifications WHERE kind='event_cancelled'").n, after1,
    "a second save of the same status re-notified everyone — cancel is a transition, not a state");
  env.DB.close();
});

test("NC — reactivating Ben's registration puts him INTO the notified set, so the filter reads the rows", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  env.DB.exec("UPDATE registrations SET status='paid' WHERE event_id=50 AND contact_id=901");
  assert.equal(env.DB.one("SELECT status FROM registrations WHERE event_id=50 AND contact_id=901").status, "paid",
    "mutation did not land");
  await call(env, "PATCH", "/api/events/50", { token: staff, body: { status: "cancelled" } });
  assert.deepEqual(cancelled(env, 50), [900, 901, 902],
    "Ben's registration was made active and he still heard nothing — the status filter is not reading the data");
  env.DB.close();
});

/* ==================== the other two writers ==================== */

test("series-cancel notifies every future instance's registrants", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const r = await call(env, "DELETE", "/api/admin/series/ser-1?from_event_id=51", { token: staff });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.deepEqual(cancelled(env, 51), [903]);
  assert.deepEqual(cancelled(env, 52), [900]);
  assert.ok(r.data.cancelled_notice && r.data.cancelled_notice.notified === 2,
    "the series response does not carry the combined notice");
  env.DB.close();
});

test("bulk-edit to cancelled notifies — and an already-cancelled event in the batch stays silent", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  env.DB.exec("UPDATE events SET status='cancelled' WHERE id=50"); // cancelled BEFORE the bulk, outside any route
  const r = await call(env, "PATCH", "/api/admin/events/bulk", {
    token: staff, body: { ids: [50, 53], fields: { status: "cancelled" } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.deepEqual(cancelled(env, 53), [901], "event 53's registrant was not notified by the bulk cancel");
  assert.deepEqual(cancelled(env, 50), [],
    "event 50 entered the bulk already cancelled — its registrants must not be notified by a re-save");
  env.DB.close();
});

/* ==================== access, audit ==================== */

test("a member can trigger none of the three writers, and nobody gets notified by a refusal", async () => {
  const env = boot();
  const { member } = await tokens(env);
  assert.equal((await call(env, "PATCH", "/api/events/50", { token: member, body: { status: "cancelled" } })).status, 403);
  assert.equal((await call(env, "DELETE", "/api/admin/series/ser-1?from_event_id=51", { token: member })).status, 403);
  assert.equal((await call(env, "PATCH", "/api/admin/events/bulk", { token: member, body: { ids: [53], fields: { status: "cancelled" } } })).status, 403);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM notifications WHERE kind='event_cancelled'").n, 0,
    "a refused cancel still notified someone");
  env.DB.close();
});

test("the notification pass is audited with its counts, from ONE place", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  await call(env, "PATCH", "/api/events/50", { token: staff, body: { status: "cancelled" } });
  const row = env.DB.one(
    "SELECT detail_json FROM audit_log WHERE action='event.cancel_notified' ORDER BY id DESC LIMIT 1");
  assert.ok(row, "no audit row for the notification pass");
  const d = JSON.parse(row.detail_json || "{}");
  assert.equal(d.notified, 2);
  assert.equal(d.emailed, 0);
  env.DB.close();
});

/* ==================== SG-2 (§-1o): the threshold ==================== */
/* Cathy's decision is a COUNT against a MINIMUM — "What is your count for Sunday?" → go / no-go.
   The column is events.min_signups (NULL = no minimum). It is the FLOOR of a band whose CEILING,
   capacity, shipped long ago — SG-2 adds the missing end, not a third number. The count is
   activeRegistrationCount (waitlists.js) — the ONE judgement the capacity gate, the sheet and
   the roster already read; SG-2 adds NO second counter. UNITS DIVERGE BY DESIGN and stay
   diverged: the count is registration ROWS (capacity's own units, so "9 of 12" and "full at 12"
   can never contradict), while the cancel notice is distinct PEOPLE (B16's one-message-per-
   member). Both read ONE status set, and the tests below pin both the agreement and the
   divergence so neither is ever "fixed" into the other. */

test("SG-2 PRE-FIX — the fixture can trip a threshold: 3 active rows, 2 active people on event 50", () => {
  const env = boot();
  const rows = env.DB.one(
    "SELECT COUNT(*) AS n FROM registrations WHERE event_id=50 AND deleted_at IS NULL AND status IN ('pending','email-sent','paid','cash-pending','comped')").n;
  assert.equal(rows, 3, "the fixture lost Ava's double sign-up or Cam — the rows-vs-people tests below would go vacuous");
  const people = env.DB.one(
    "SELECT COUNT(DISTINCT contact_id) AS n FROM registrations WHERE event_id=50 AND deleted_at IS NULL AND status IN ('pending','email-sent','paid','cash-pending','comped')").n;
  assert.equal(people, 2, "the fixture lost the row/person split — 3 rows must belong to 2 people");
  env.DB.close();
});

test("SG-2 — PATCH persists min_signups; junk and zero clear it to NULL rather than poisoning it", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const r1 = await call(env, "PATCH", "/api/events/50", { token: staff, body: { min_signups: 12 } });
  assert.equal(r1.status, 200, JSON.stringify(r1.data).slice(0, 200));
  assert.equal(env.DB.one("SELECT min_signups AS m FROM events WHERE id=50").m, 12,
    "the threshold never reached the row — the allow-list dropped it, D-34's defect worn by SG-2's own field");
  // NC — the junk lands on a row PROVEN to hold 12 above, so a pass here cannot be vacuous
  const r2 = await call(env, "PATCH", "/api/events/50", { token: staff, body: { min_signups: "volleyball" } });
  assert.equal(r2.status, 200, JSON.stringify(r2.data).slice(0, 200));
  assert.equal(env.DB.one("SELECT min_signups AS m FROM events WHERE id=50").m, null,
    "junk neither cleared nor refused — a NaN threshold makes every count line lie");
  await call(env, "PATCH", "/api/events/50", { token: staff, body: { min_signups: 12 } });
  await call(env, "PATCH", "/api/events/50", { token: staff, body: { min_signups: 0 } });
  assert.equal(env.DB.one("SELECT min_signups AS m FROM events WHERE id=50").m, null,
    "zero is 'no minimum', not 'a minimum of zero' — the UI sends 0 for an emptied field");
  env.DB.close();
});

test("SG-2 — getEvent surfaces active_signups: the capacity gate's own number, in ROWS", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const e50 = (await call(env, "GET", "/api/events/50", { token: staff })).data.event;
  assert.equal(e50.active_signups, 3,
    "expected Ava's two active rows + Cam's one; Ben's cancelled row must not count");
  const e53 = (await call(env, "GET", "/api/events/53", { token: staff })).data.event;
  assert.equal(e53.active_signups, 1, "event 53 has exactly Ben, paid");
  env.DB.close();
});

test("SG-2 — the count and the cancel notice read ONE status set: rows for capacity, people for messages", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  // where every active row is a distinct person, the two numbers MUST agree — same set, same rows
  const before = (await call(env, "GET", "/api/events/53", { token: staff })).data.event.active_signups;
  const r = await call(env, "PATCH", "/api/events/53", { token: staff, body: { status: "cancelled" } });
  assert.equal(r.data.cancelled_notice.notified, before,
    "distinct-person event: count said one thing, the notice said another — the status sets have drifted apart");
  // and the divergence where they SHOULD differ, pinned so nobody equalises it later
  const e50 = (await call(env, "GET", "/api/events/50", { token: staff })).data.event;
  assert.equal(e50.active_signups, 3, "rows — capacity's units");
  await call(env, "PATCH", "/api/events/50", { token: staff, body: { status: "cancelled" } });
  assert.equal(cancelled(env, 50).length, 2,
    "people — one message per member; Ava's two sign-ups are one Ava. If this now equals the row count, the dedup died");
  env.DB.close();
});

test("SG-2 — no second spelling: tournaments.js imports the ONE judgement, never respells the status list", () => {
  const TUPLE = "'pending','email-sent','paid','cash-pending','comped'";
  const wl = readFileSync(new URL("../src/waitlists.js", import.meta.url), "utf8");
  const ea = readFileSync(new URL("../src/events_admin.js", import.meta.url), "utf8");
  const tn = readFileSync(new URL("../src/tournaments.js", import.meta.url), "utf8");
  assert.ok(wl.includes(TUPLE),
    "positive control: the defining spelling left waitlists.js — this guard is searching for nothing");
  assert.ok(ea.includes(TUPLE),
    "events_admin's deliberate no-imports copy drifted from the definition — count and notice can now disagree");
  const code = blankComments(tn);
  assert.ok(!code.includes(TUPLE),
    "tournaments.js respells the active-status list — the ONE judgement now has a second room (green by design until someone sins; the positive control above proves the needle finds the real spelling)");
  assert.match(code, /activeRegistrationCount\(/,
    "getEvent stopped reading the ONE count — whatever replaced it is a second definition of 'signed up'");
});

test("SG-2 — the bag path carries the threshold: bulk-created rows store it, junk stores NULL", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const r = await call(env, "POST", "/api/admin/events/bulk", { token: staff, body: { rows: [
    { name: "Tuesday Skills — threshold", starts_at: "2026-09-01 18:00", type: "training", min_signups: 10 },
    { name: "Tuesday Skills — junk", starts_at: "2026-09-08 18:00", type: "training", min_signups: -5 },
  ] } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.data.created, 2, JSON.stringify(r.data.skipped || []));
  assert.equal(env.DB.one("SELECT min_signups AS m FROM events WHERE name='Tuesday Skills — threshold'").m, 10,
    "cleanEventBag dropped the threshold — create, duplicate, bulk and series paths would all lose it");
  assert.equal(env.DB.one("SELECT min_signups AS m FROM events WHERE name='Tuesday Skills — junk'").m, null,
    "a negative minimum reached the row — the bag path skipped the one normaliser");
  env.DB.close();
});

test("SG-2 — the screen: the field, the save payload, and a count line that is QUIET without a threshold", () => {
  const src = readFileSync(new URL("../../web/assets/admin-event.js", import.meta.url), "utf8");
  assert.ok(src.includes('id="e_min"'), "the Minimum-to-run field is not on the details card");
  const save = functionBodyAfter(src, "async function save");
  assert.ok(save, "save() went missing — the containment check below would read the whole file instead");
  assert.ok(save.includes("min_signups"),
    "save() does not send the threshold — typed and told 'Saved.', stored nowhere (D-34's exact shape)");
  assert.match(src, /if \(!ev\.min_signups\) return ""/,
    "the count line lost its quiet-when-unset gate — an always-on line trains the operator to ignore it (SG-4's lesson)");
  assert.ok(src.includes("needed to run"), "the count sentence left the screen");
  // NC — mutate the real input and prove the needles can fail
  const mutated = src.split("min_signups").join("min_signup_zz");
  assert.ok(mutated !== src, "the mutation did not land — the source never contained the needle");
  assert.ok(!functionBodyAfter(mutated, "async function save").includes("min_signups"),
    "the mutated save() still matches — the containment check cannot fail and proves nothing");
});

/* ==================== SG-5 (§-1o): B16's SECOND CALLER — news to the participants ==================== */
/* The owner, 2026-08-10 23:09: "That screen also needs to be able to contact and email the
   participants with information or news." B16's own header promised this reuse in writing —
   "the recipient selection is the reusable part, the cancellation copy is just this caller's
   message" — so the news sender shares ONE selection with the cancel notifier (extracted, not
   copied), writes kind='event_news' rows carrying the OPERATOR'S words, and reports email
   honesty in the same three sentences. Render safety was measured before letting operator-typed
   text into a notification body: home.js escapes title AND body; the email path runs escapeHtml. */

test("SG-5 — news reaches ACTIVE participants only, one per member, with the operator's words", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const r = await call(env, "POST", "/api/events/50/notify", { token: staff, body: { message: "Bring knee pads on Sunday." } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const got = env.DB.query("SELECT contact_id, title, body FROM notifications WHERE kind='event_news' ORDER BY contact_id");
  assert.deepEqual(got.map((x) => x.contact_id), [900, 902],
    "expected exactly Ava (deduped from two registrations) and Cam; Ben's registration was already cancelled");
  assert.match(got[0].title, /Thursday Coed 4s/, "the notification does not name the event");
  assert.equal(got[0].body, "Bring knee pads on Sunday.", "the body is not the operator's words");
  assert.equal(r.data.notified, 2);
  const row = env.DB.one("SELECT detail_json FROM audit_log WHERE action='event.participants_notified' ORDER BY id DESC LIMIT 1");
  assert.ok(row, "no audit row for the news send");
  assert.equal(JSON.parse(row.detail_json || "{}").notified, 2);
  env.DB.close();
});

test("SG-5 — the response is HONEST about email, keyless: who has an address, that nothing was emailed", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const r = await call(env, "POST", "/api/events/50/notify", { token: staff, body: { message: "Court change: we are on court 2." } });
  assert.equal(r.data.with_email, 1, "Ava has an address, Cam does not — with_email pins the would-email logic keyless");
  assert.equal(r.data.emailed, 0);
  assert.match(r.data.note, /nothing was emailed/i, "no mail key is set and the note does not say so");
  assert.match(r.data.note, /inbox/i, "the note should say members still see it in their member inbox");
  env.DB.close();
});

test("SG-5 — refusals refuse in sentences and write NOTHING: empty, over-long, member, missing event", async () => {
  const env = boot();
  const { staff, member } = await tokens(env);
  const empty = await call(env, "POST", "/api/events/50/notify", { token: staff, body: { message: "   " } });
  assert.equal(empty.status, 400);
  assert.match(String(empty.data.error), /message/i, "the empty-message refusal has no sentence of its own");
  const long = "x".repeat(2001);
  assert.ok(long.length > 2000, "the mutation did not land — the over-long body is not over-long");
  const big = await call(env, "POST", "/api/events/50/notify", { token: staff, body: { message: long } });
  assert.equal(big.status, 400);
  assert.match(String(big.data.error), /2,?000/, "the over-long refusal does not say what the limit is");
  assert.equal((await call(env, "POST", "/api/events/50/notify", { token: member, body: { message: "hi" } })).status, 403);
  assert.equal((await call(env, "POST", "/api/events/999/notify", { token: staff, body: { message: "hi" } })).status, 404);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM notifications WHERE kind='event_news'").n, 0,
    "a refused send still wrote a notification");
  env.DB.close();
});

test("SG-5 — an event nobody signed up for reports the honest zero, not an error", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const r = await call(env, "POST", "/api/events/53/notify", { token: staff, body: { message: "hello" } });
  assert.equal(r.status, 200);
  assert.equal(r.data.notified, 1, "event 53 has exactly Ben, paid — precondition for the zero test below");
  env.DB.exec("UPDATE registrations SET status='cancelled' WHERE event_id=53");
  const r2 = await call(env, "POST", "/api/events/53/notify", { token: staff, body: { message: "anyone there?" } });
  assert.equal(r2.status, 200, "an empty guest list must not read as a failure — empty and broken look identical");
  assert.equal(r2.data.notified, 0);
  assert.match(String(r2.data.note), /nobody|no one/i, "the zero case needs its own sentence");
  env.DB.close();
});

test("SG-5 — ONE recipient selection: news and cancel reach the SAME people, and the SQL lives once", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  await call(env, "POST", "/api/events/50/notify", { token: staff, body: { message: "See you Sunday." } });
  const news = env.DB.query("SELECT contact_id FROM notifications WHERE kind='event_news' ORDER BY contact_id").map((x) => x.contact_id);
  await call(env, "PATCH", "/api/events/50", { token: staff, body: { status: "cancelled" } });
  assert.deepEqual(cancelled(env, 50), news,
    "the news sender and the cancel notifier reached different people — the selections have drifted apart");
  const src = readFileSync(new URL("../src/events_admin.js", import.meta.url), "utf8");
  assert.equal(src.split("SELECT DISTINCT r.event_id, r.contact_id").length - 1, 1,
    "the recipient SELECT is spelled more than once — two selections is how news and cancel disagree");
  assert.ok(functionBodyAfter(src, "function activeRegistrantsOf"), "the shared selection helper is gone");
  assert.ok(functionBodyAfter(src, "function notifyEventCancelled").includes("activeRegistrantsOf("),
    "the cancel notifier stopped using the shared selection");
  assert.ok(functionBodyAfter(src, "function notifyEventParticipants").includes("activeRegistrantsOf("),
    "the news sender stopped using the shared selection");
  env.DB.close();
});

test("SG-5 — the screen: the message card, the POST, and the honest note reaching the operator", () => {
  const src = readFileSync(new URL("../../web/assets/admin-event.js", import.meta.url), "utf8");
  assert.ok(src.includes('id="e_msg"'), "the message box is not on the event screen");
  const send = functionBodyAfter(src, "async function sendNews");
  assert.ok(send, "sendNews() went missing — the containment below would read the whole file instead");
  assert.ok(send.includes("/notify"), "sendNews does not call the notify route");
  assert.ok(send.includes(".note"), "the honest email note never reaches the operator — success it did not achieve");
  // NC — mutate the real input and prove the containment can fail. The mutation must REMOVE
  // the needle, not extend it: "/notifyZZ" still CONTAINS "/notify" as a substring, and this
  // NC's first draft did exactly that and failed against the real source. The grain of a
  // mutation is part of its truth, same as a needle's.
  const mutated = src.split("/notify").join("/zz");
  assert.ok(mutated !== src, "the mutation did not land — the source never calls the route");
  assert.ok(!functionBodyAfter(mutated, "async function sendNews").includes("/notify"),
    "the mutated sendNews still matches — the check above cannot fail and proves nothing");
});
