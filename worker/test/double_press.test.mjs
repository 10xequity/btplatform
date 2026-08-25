/**
 * Boomtown Platform — §-1r RF-23: the repeated-press audit
 * File: worker/test/double_press.test.mjs · Version: v1.0 · Date: 2026-08-25 · Ships in: v0.197.0
 *
 * Owner 2026-08-24 (point 10): "please do button clicking multiple times and look for access or
 * entry bugs." The class: a fast double press (or two tabs) reaching a WRITE route twice with the
 * same payload. Every case below drives the REAL router twice and asserts the second press is
 * either refused in a sentence, answered idempotently, or deduped — never a silent second row.
 *
 * MEASURED FIRST (iteration 137), the whole write surface:
 *   already correct, pinned in their own files or here —
 *     · event registration: "You're already registered" (server dedup)
 *     · sheet signup: "already on this sheet" (signup_sheet.test.mjs)
 *     · sub CLAIM: atomic UPDATE … WHERE status='open' (the race loses safely)
 *     · check-in: already:true (kiosk.test.mjs) · pass grant: already_granted (passes.test.mjs)
 *     · bracket generate: 409 confirm-replace (bracket_rewire) · auth link: rate limit
 *     · league generateWeek: each press deliberately makes the NEXT round; the client disables
 *       the button while composing (admin-league.js genWeek.disabled) — by design, recorded.
 *   the four DEFECTS this file was red against, then fixed (v0.197.0) —
 *     · POST /api/subs/requests ×2       → two identical open requests, each notifying every
 *                                          matching sub (the duplicate NOTIFIES twice)
 *     · POST /api/lfg/listings ×2        → two identical open posts on the community board
 *     · POST /api/messages/start ×2      → TWO THREADS, each carrying the message + a notify
 *     · POST /api/messages/reply ×2      → the same sentence lands twice in the thread
 *   The fix shape, all four: an identical row from the same author inside a short window
 *   (30s posts / 15s messages) is the same CLICK, not a second intent — return the first row
 *   as already-posted. A genuinely different second post (any field differs, or later) still
 *   lands; the scope controls below pin that exit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function makeEnv() {
  const DB = createD1(SCHEMA);
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

async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const token = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token } });
  assert.ok(v.data.token, `sign-in failed for ${email}: ${JSON.stringify(v.data).slice(0, 200)}`);
  return v.data.token;
}

/** Org + waiver + a published event + two ADULT member contacts wired to their sign-ins. */
async function boot() {
  const env = makeEnv();
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown', 'boomtown', 1);
    INSERT INTO waiver_versions (id, org_id, label, body, body_sha, status)
      VALUES (1, 1, 'w1', 'I agree.', 'sha-1', 'active');
    INSERT INTO events (id, org_id, type, name, status, capacity, court_count, price_cents, cash_option_enabled, starts_at)
      VALUES (1, 1, 'tournament', 'Open Night', 'published', 16, 2, 0, 1, datetime('now','+7 days'));
  `);
  const tokA = await signIn(env, "ava@bt.test");
  const tokB = await signIn(env, "bo@bt.test");
  env.DB.exec(`
    INSERT INTO contacts (id, org_id, email, full_name)
      VALUES (60, 1, 'ava@bt.test', 'Ava Stone'), (61, 1, 'bo@bt.test', 'Bo Reyes');
    INSERT INTO member_profiles (org_id, contact_id, visibility, date_of_birth)
      VALUES (1, 60, 'public', date('now','-29 years')), (1, 61, 'public', date('now','-31 years'));
  `);
  return { env, tokA, tokB };
}

const count = (env, sql) => env.DB.one(sql).n;

/* ══════════════ the four fixed duplicates, each watched red pre-fix ══════════════ */

test("RF-23: a sub request pressed twice posts ONCE — the duplicate would notify every matching sub twice", async () => {
  const { env, tokA } = await boot();
  const body = { skill_level: "bb", gender_requirement: "coed", game_type: "6s", note: "Thursday night" };
  const r1 = await call(env, "POST", "/api/subs/requests", { token: tokA, body });
  assert.equal(r1.status, 200, JSON.stringify(r1.data).slice(0, 200));
  const r2 = await call(env, "POST", "/api/subs/requests", { token: tokA, body });
  assert.equal(r2.status, 200, "the second press must not error — it is the same click");
  assert.equal(r2.data.already, true, "the second press must say it was already posted");
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM sub_requests WHERE deleted_at IS NULL"), 1,
    "two identical open sub requests from one double press — the entry bug RF-23 hunts");
  env.DB.close();
});

test("RF-23 scope control: a DIFFERENT second sub request still posts (the dedup is not a cap)", async () => {
  const { env, tokA } = await boot();
  await call(env, "POST", "/api/subs/requests", { token: tokA, body: { note: "for our setter" } });
  const r2 = await call(env, "POST", "/api/subs/requests", { token: tokA, body: { note: "for our libero too" } });
  assert.equal(r2.status, 200, JSON.stringify(r2.data).slice(0, 200));
  assert.notEqual(r2.data.already, true, "a genuinely different request must not be eaten");
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM sub_requests WHERE deleted_at IS NULL"), 2,
    "needing two subs on one night is real — the window dedup must key on the WHOLE payload");
  env.DB.close();
});

test("RF-23: a community post pressed twice lands ONCE on the board", async () => {
  const { env, tokA } = await boot();
  const body = { kind: "player_avail", note: "new in town, any night" };
  const r1 = await call(env, "POST", "/api/lfg/listings", { token: tokA, body });
  assert.equal(r1.status, 200, JSON.stringify(r1.data).slice(0, 200));
  const r2 = await call(env, "POST", "/api/lfg/listings", { token: tokA, body });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.already, true, "the second press must say the post already exists");
  assert.equal(r2.data.id, r1.data.id, "and hand back the SAME post, not a new one");
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM lfg_listings WHERE deleted_at IS NULL"), 1);
  env.DB.close();
});

test("RF-23: starting a conversation twice makes ONE thread — not two, each notifying", async () => {
  const { env, tokA } = await boot();
  const body = { to_contact_id: 61, body: "Want to sub Thursday?" };
  const r1 = await call(env, "POST", "/api/messages/start", { token: tokA, body });
  assert.equal(r1.status, 200, JSON.stringify(r1.data).slice(0, 200));
  const r2 = await call(env, "POST", "/api/messages/start", { token: tokA, body });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.thread_id, r1.data.thread_id, "the second press must return the SAME thread");
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM message_threads WHERE deleted_at IS NULL"), 1,
    "a double press minted a second thread carrying the same message");
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL"), 1,
    "…and the message itself must exist exactly once");
  env.DB.close();
});

test("RF-23: the same reply pressed twice lands ONCE in the thread", async () => {
  const { env, tokA, tokB } = await boot();
  const start = await call(env, "POST", "/api/messages/start", { token: tokA, body: { to_contact_id: 61, body: "hi" } });
  const threadId = start.data.thread_id;
  const body = { thread_id: threadId, body: "See you at court 4." };
  await call(env, "POST", "/api/messages/reply", { token: tokB, body });
  const r2 = await call(env, "POST", "/api/messages/reply", { token: tokB, body });
  assert.equal(r2.status, 200, JSON.stringify(r2.data).slice(0, 200));
  assert.equal(count(env, `SELECT COUNT(*) AS n FROM messages WHERE thread_id=${threadId} AND deleted_at IS NULL`), 2,
    "start's message + ONE reply — the doubled reply must be suppressed");
  env.DB.close();
});

test("RF-23 scope control: a deliberate repeat with DIFFERENT words still sends", async () => {
  const { env, tokA, tokB } = await boot();
  const start = await call(env, "POST", "/api/messages/start", { token: tokA, body: { to_contact_id: 61, body: "hi" } });
  const threadId = start.data.thread_id;
  await call(env, "POST", "/api/messages/reply", { token: tokB, body: { thread_id: threadId, body: "On my way" } });
  const r2 = await call(env, "POST", "/api/messages/reply", { token: tokB, body: { thread_id: threadId, body: "On my way!" } });
  assert.equal(r2.status, 200);
  assert.equal(count(env, `SELECT COUNT(*) AS n FROM messages WHERE thread_id=${threadId} AND deleted_at IS NULL`), 3,
    "a different body is a different message — the window dedup must compare the words");
  env.DB.close();
});

/* ══════════════ the contracts that were already right, held here as the audit's record ══════════════ */

test("RF-23 audit: event registration pressed twice keeps ONE registration and says so", async () => {
  const { env, tokA } = await boot();
  const body = { email: "ava@bt.test", team_name: "Set to Kill", captain_name: "Ava Stone",
                 date_of_birth: "1997-05-05", waiver_accepted: true, waiver_signature: "Ava Stone",
                 payment_method: "cash" };
  const r1 = await call(env, "POST", "/api/events/1/register", { token: tokA, body });
  assert.equal(r1.status, 200, JSON.stringify(r1.data).slice(0, 300));
  const r2 = await call(env, "POST", "/api/events/1/register", { token: tokA, body });
  assert.equal(r2.status, 200, JSON.stringify(r2.data).slice(0, 300));
  assert.match(String(r2.data.message || ""), /already/i, "the second press must say it already happened");
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM registrations WHERE deleted_at IS NULL AND status <> 'cancelled'"), 1);
  env.DB.close();
});

test("RF-23 audit: two presses on 'I can sub' (claim) — the second loses SAFELY, in a sentence", async () => {
  const { env, tokA, tokB } = await boot();
  const req = await call(env, "POST", "/api/subs/requests", { token: tokA, body: { note: "need one" } });
  const id = req.data.request_id;
  const c1 = await call(env, "POST", `/api/subs/requests/${id}/fill`, { token: tokB, body: {} });
  assert.equal(c1.status, 200, JSON.stringify(c1.data).slice(0, 200));
  const c2 = await call(env, "POST", `/api/subs/requests/${id}/fill`, { token: tokB, body: {} });
  assert.equal(c2.status, 409, "the second claim must be refused, not doubled");
  assert.match(String(c2.data.error || ""), /already/i, "…and refused in a sentence");
  env.DB.close();
});
