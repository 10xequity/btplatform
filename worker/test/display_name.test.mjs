/**
 * Boomtown Platform — §-0 B2 / K-11(ii): a member sets their own display name
 * File: worker/test/display_name.test.mjs · Version: v1.0 · Date: 2026-08-11 · Ships in: v0.130.0
 *
 * THE PREMISE WAS RE-MEASURED AND THE RECORD WAS WRONG ONE LEVEL DEEPER. K-11 recorded two halves:
 * (i) "an admin can fix his name today, no release required" and (ii) "a member cannot set their
 * own display name". Half (i) is FALSE: a positive-controlled grep for `UPDATE users` matches
 * NOTHING in the worker (the sole hit is a PLANTED sabotage string inside
 * auth_surface_honesty.test.mjs) — `admin.js addUser` sets display_name only when it INSERTS a
 * brand-new user and silently discards it for an existing one, returning ok anyway (recorded as
 * §-1c D-27, the "success it did not achieve" family). So `users.display_name` has been
 * UNWRITABLE for every existing account since the column was born, and the owner's `vvisuth`
 * was fixable by no path at all. This unit is therefore the FIRST writer of the column for
 * existing users, and self-service is the fix for both halves.
 *
 * THE D-18 DECISION, TAKEN AT BUILD TIME AND PINNED BELOW: editing your display name does NOT
 * touch `contacts.full_name`. The display name is account presentation (greetings, what a passkey
 * is registered under); `full_name` is the identity spine two resolvers already disagree about
 * (D-18), members already edit it on the Profile page (`profiles.js update()`), and coupling the
 * two here would deepen the disagreement before B20 settles it.
 *
 * THE BOUNDARY: the route writes the SESSION'S user, full stop. It never reads an id from the
 * body — asserted by sending someone else's id and proving their row did not move.
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
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

// First account bootstraps admin (fixture rule) — burn it, then the member this file is about.
async function tokens(env) {
  const burn = await signIn(env, "burn@bt.test");
  const member = await signIn(env, "mia@bt.test");
  return { burn, member };
}

const rowOf = (env, email) => env.DB.one("SELECT id, display_name FROM users WHERE email=?1", email);
const patchMe = (env, token, body) => call(env, "PATCH", "/api/me", { token, body });

/* ==================== the happy path, and what /api/me reports ==================== */

test("a member sets their own display name and /api/me carries it back", async () => {
  const env = boot();
  const { member } = await tokens(env);
  const r = await patchMe(env, member, { display_name: "Mia Reyes" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(rowOf(env, "mia@bt.test").display_name, "Mia Reyes");
  const me = await call(env, "GET", "/api/me", { token: member });
  assert.equal(me.data.user.display_name, "Mia Reyes",
    "the greeting surfaces read /api/me — a write it does not reflect fixed nothing visible");
  env.DB.close();
});

test("a blank clears to NULL, never to an empty string — and the fallback chain takes over", async () => {
  // admin-dash.js greets with (display_name || email).split(/[@\s]/)[0]. An empty STRING is truthy
  // enough to break that fallback into a blank greeting; NULL falls through to the email as designed.
  const env = boot();
  const { member } = await tokens(env);
  await patchMe(env, member, { display_name: "Mia Reyes" });
  const r = await patchMe(env, member, { display_name: "   " });
  assert.equal(r.status, 200);
  assert.equal(rowOf(env, "mia@bt.test").display_name, null,
    "whitespace must clear to NULL — an empty string breaks every (display_name || email) fallback");
  env.DB.close();
});

test("surrounding whitespace is trimmed before storing", async () => {
  const env = boot();
  const { member } = await tokens(env);
  await patchMe(env, member, { display_name: "  Mia Reyes  " });
  assert.equal(rowOf(env, "mia@bt.test").display_name, "Mia Reyes");
  env.DB.close();
});

/* ==================== refusals — wholesale, writing nothing ==================== */

test("junk is refused and nothing is written: wrong type, over-long, missing key", async () => {
  const env = boot();
  const { member } = await tokens(env);
  await patchMe(env, member, { display_name: "Mia Reyes" }); // a known-good value to survive the junk
  for (const bad of [{ display_name: 42 }, { display_name: { a: 1 } }, { display_name: "x".repeat(81) }, {}]) {
    const r = await patchMe(env, member, bad);
    assert.equal(r.status, 400, `accepted ${JSON.stringify(bad).slice(0, 40)}`);
  }
  assert.equal(rowOf(env, "mia@bt.test").display_name, "Mia Reyes",
    "a refused PATCH still changed the row");
  env.DB.close();
});

test("anonymous callers are refused", async () => {
  const env = boot();
  await tokens(env);
  const r = await call(env, "PATCH", "/api/me", { body: { display_name: "Nobody" } });
  assert.equal(r.status, 401);
  env.DB.close();
});

/* ==================== the boundary: ONLY the session's own row ==================== */

test("ids in the body are inert — another user's row cannot be renamed from here", async () => {
  const env = boot();
  const { burn, member } = await tokens(env);
  void burn;
  const other = rowOf(env, "burn@bt.test");
  env.DB.exec(`UPDATE users SET display_name='Original Burn' WHERE id=${other.id}`);
  assert.equal(rowOf(env, "burn@bt.test").display_name, "Original Burn", "mutation did not land");

  const r = await patchMe(env, member, { display_name: "Hijack", user_id: other.id, id: other.id });
  assert.equal(r.status, 200, "extra keys must be IGNORED, not an error — the route never reads an id");
  assert.equal(rowOf(env, "burn@bt.test").display_name, "Original Burn",
    "another user's row moved — the route is reading an id from the body");
  assert.equal(rowOf(env, "mia@bt.test").display_name, "Hijack",
    "the caller's own row should have taken the value");
  env.DB.close();
});

test("D-18 PINNED — the display name never touches contacts.full_name", async () => {
  // The profile page already owns full_name (profiles.js update()). Coupling the two here would
  // deepen the resolver disagreement D-18 records, before B20 settles whose rule wins.
  const env = boot();
  const { member } = await tokens(env);
  env.DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (700,1,'mia@bt.test','Mia Contact-Name')");
  await patchMe(env, member, { display_name: "Totally Different" });
  assert.equal(env.DB.one("SELECT full_name FROM contacts WHERE id=700").full_name, "Mia Contact-Name",
    "editing the ACCOUNT display name rewrote the CONTACT identity — the D-18 boundary is breached");
  env.DB.close();
});

/* ==================== audit ==================== */

test("the change is audited with before and after", async () => {
  const env = boot();
  const { member } = await tokens(env);
  await patchMe(env, member, { display_name: "First Name" });
  await patchMe(env, member, { display_name: "Second Name" });
  const row = env.DB.one(
    "SELECT detail_json FROM audit_log WHERE action='user.display_name.update' ORDER BY id DESC LIMIT 1");
  assert.ok(row, "no audit row — a rename is exactly the kind of change support questions ask about");
  const d = JSON.parse(row.detail_json || "{}");
  assert.equal(d.before, "First Name");
  assert.equal(d.after, "Second Name");
  env.DB.close();
});

/* ==================== D-27, PINNED DELIBERATELY as the defect it is ==================== */

test("D-27 PIN — addUser still silently discards display_name for an EXISTING user (fix must rewrite this)", async () => {
  // This is the catalogued "pin an absent control as a green test the future fix must rewrite"
  // pattern. POST /api/admin/users with an existing email returns ok and IGNORES the name — an
  // admin types a correction, reads success, and nothing changed. When D-27 is fixed, this test
  // goes red and must be REWRITTEN to assert the update, not deleted.
  const env = boot();
  const { burn } = await tokens(env);
  env.DB.exec("UPDATE users SET display_name='Keep Me' WHERE email='mia@bt.test'");
  const r = await call(env, "POST", "/api/admin/users", {
    token: burn, body: { email: "mia@bt.test", display_name: "Admin Tried", org_id: 1, role: "member" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(rowOf(env, "mia@bt.test").display_name, "Keep Me",
    "addUser now updates existing users' names — D-27 is fixed, so REWRITE this pin to assert the new contract");
  env.DB.close();
});
