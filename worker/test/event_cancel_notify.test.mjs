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
