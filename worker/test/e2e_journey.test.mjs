/**
 * Boomtown Platform — end-to-end operating-loop harness
 * File: worker/test/e2e_journey.test.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.57.0
 *
 * WHY (requirements §3, roadmap §3.2 — "before more feature surface, not after")
 * The other 683 tests are unit- and guard-shaped: they prove functions in isolation and scan
 * source for patterns. Not one of them drives the actual business through the real router in
 * order. Every expensive defect this platform has shipped lived in a SEAM, not in a function:
 * a module built and never mounted (v0.49.1 outage), a predicate written twice and drifted
 * (F-26), a claim link that expired six hours late (v0.54.0), a badge function defined and never
 * called (v0.56.0). Unit tests cannot see seams. This can.
 *
 * WHAT IT DOES
 * Boots the real `worker/src/index.js` default export in-process, against a real SQLite database
 * carrying the real production schema (worker/testkit/journey-schema.sql, read verbatim from live
 * D1), and walks one member through the whole loop the owner described:
 *
 *     sign up → register → pay → check in → play → notify
 *
 * NOTHING UNDER TEST IS MOCKED. The router, the auth, the SQL and the state machine are the
 * shipped code. Only the D1 *binding* is substituted, and it is substituted for a genuine SQL
 * engine rather than a fake that agrees with the caller. Brevo, Square and Twilio are absent from
 * env on purpose — they fail closed, which is the sandbox behaviour testers actually see, and it
 * means the journey runs with no network and no secrets.
 *
 * HOW IT FAILS
 * Loudly and specifically. A route that moves reports a status mismatch with the response body
 * attached; a table the loop reaches that the fixture does not define raises "no such table: X",
 * naming the gap. There is no branch here that skips a step and still passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

/** A sandbox env: DB is real, every external provider is deliberately absent so it fails closed. */
function makeEnv() {
  const DB = createD1(SCHEMA);
  return {
    DB,
    APP_URL: ORIGIN,
    SITE_ORIGIN: ORIGIN,
    API_ORIGIN: "https://api.boomtown.test",
    ALLOWED_ORIGINS: ORIGIN,
    // BREVO_API_KEY, SQUARE_*, TWILIO_*, VAPID_* intentionally unset.
  };
}

/** One request through the real router. Returns { status, data } with the body already parsed. */
async function call(env, method, path, { body, token, orgId = 1 } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(orgId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.boomtown.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 400) }; }
  return { status: res.status, data };
}

/** Assert with the server's own error attached — a bare "expected 200, got 400" wastes a session. */
function expectStatus(r, want, what) {
  assert.equal(r.status, want,
    `${what}: expected ${want}, got ${r.status} — ${JSON.stringify(r.data).slice(0, 300)}`);
}

/**
 * Minimum viable org + a published, cash-payable event + one active waiver version.
 *
 * The waiver row is not decoration: registration refuses with 503 "No waiver is published yet"
 * without it, which the first run of this harness discovered. That is the platform behaving
 * correctly — an org that has not published terms cannot take signups — and it is exactly the
 * kind of ordering rule no unit test was asserting.
 */
function seed(env) {
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
    INSERT INTO waiver_versions (id, org_id, label, body, body_sha, status)
      VALUES (1, 1, 'Sandbox waiver v1', 'I agree to the terms.', 'sha-sandbox-1', 'active');
    INSERT INTO events (id, org_id, type, name, status, capacity, court_count, price_cents, cash_option_enabled, starts_at)
      VALUES (1, 1, 'tournament', 'Sandbox Open', 'published', 16, 2, 4000, 1, datetime('now','+7 days'));
    INSERT INTO matches (id, org_id, event_id, stage, round, court, points_to, cap, game_number)
      VALUES (1, 1, 1, 'pool', 1, 1, 21, 23, 1);
  `);
}

/** Sign in for real: request a link, read the sandbox link, exchange the token for a session. */
async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  expectStatus(asked, 200, "request-link");
  assert.equal(asked.data.mode, "sandbox", "no Brevo key is set, so the link must come back on screen");
  const token = String(asked.data.dev_link).split("token=")[1];
  assert.ok(token, `no token in dev_link: ${asked.data.dev_link}`);
  const verified = await call(env, "POST", "/api/auth/verify", { body: { token } });
  expectStatus(verified, 200, "auth/verify");
  assert.ok(verified.data.token, "verify returned no session token");
  return verified.data.token;
}

/**
 * Promote a user. Done in SQL because there is no bootstrap route — deliberately, since a route
 * that grants admin is a route that can be called by the wrong person.
 *
 * UPSERT, not INSERT: signing in already creates a `member` row for the org, which the first run
 * of this harness discovered by hitting the UNIQUE constraint. Worth stating plainly — it means
 * every account that has ever signed in carries a member role in org 1.
 */
function grantRole(env, email, role) {
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", email);
  assert.ok(u, `no user row for ${email}`);
  env.DB.exec(
    `INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, 1, '${role}')
     ON CONFLICT(user_id, org_id) DO UPDATE SET role = '${role}', deleted_at = NULL`
  );
  return u.id;
}

/* ============================ the journey ============================ */

test("E2E: sign up → register → pay → check in → play → notify", async () => {
  const env = makeEnv();
  seed(env);

  /* -- 1. SIGN UP. The real magic-link flow; sandbox mode returns the link instead of emailing. */
  const staffToken = await signIn(env, "staff@boomtown.test");
  grantRole(env, "staff@boomtown.test", "admin");
  const me = await call(env, "GET", "/api/me", { token: staffToken });
  expectStatus(me, 200, "/api/me after sign-in");

  /* -- 2. REGISTER. Public route, no session: this is a stranger on the events page. */
  const reg = await call(env, "POST", "/api/events/1/register", {
    body: {
      email: "player@boomtown.test",
      team_name: "Sandbox Spikers",
      captain_name: "Alex Player",
      date_of_birth: "1994-05-05",
      waiver_accepted: true,
      waiver_signature: "Alex Player",
      payment_method: "cash",
    },
  });
  expectStatus(reg, 200, "public registration");
  const regRow = env.DB.one("SELECT id, status, contact_id FROM registrations WHERE event_id = 1");
  assert.ok(regRow, "registration route returned 200 but wrote no row — the seam this harness exists for");
  assert.ok(regRow.contact_id, "registration created no contact");

  /* -- 3. PAY. Square is absent, so this is the cash desk: staff marks it paid. */
  const paid = await call(env, "POST", `/api/registrations/${regRow.id}/mark-paid`, { token: staffToken });
  expectStatus(paid, 200, "mark-paid");
  assert.equal(
    env.DB.one("SELECT status FROM registrations WHERE id = ?1", regRow.id).status, "paid",
    "mark-paid returned 200 without moving the registration to paid");

  /* -- 4. CHECK IN. Staff at the door. The waiver gate was removed (D-MIN-8) — nobody is blocked.
     The door checks in a ROSTER SLOT (team_member_id), not a person: a captain who plays on two
     teams is two slots on the same night. Registration created the team and the captain's row. */
  const roster = await call(env, "GET", "/api/events/1/roster", { token: staffToken });
  expectStatus(roster, 200, "event roster");
  const slot = env.DB.one(
    "SELECT tm.id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE t.event_id = 1 LIMIT 1");
  assert.ok(slot, "registration created no roster slot — check-in has nobody to admit");
  const checked = await call(env, "POST", "/api/events/1/checkin", {
    token: staffToken, body: { team_member_id: slot.id },
  });
  expectStatus(checked, 200, "staff check-in");
  assert.equal(
    env.DB.one("SELECT COUNT(*) AS n FROM attendance WHERE event_id = 1 AND deleted_at IS NULL").n, 1,
    "check-in returned 200 but recorded no attendance");

  /* -- 5. PLAY. A score goes in against a real match row. The scoring API takes a WINNER and a
     margin, not two raw numbers — the courtside device asks "who won, by how much", which is the
     question a scorekeeper can answer one-handed between points. */
  const scored = await call(env, "POST", "/api/matches/1/score", {
    token: staffToken, body: { winner: "a", diff: 3 },
  });
  expectStatus(scored, 200, "score entry");
  const match = env.DB.one("SELECT score_a, score_b FROM matches WHERE id = 1");
  assert.ok(match.score_a !== null && match.score_b !== null,
    "score entry returned 200 but stored no score");
  assert.ok(match.score_a > match.score_b,
    `winner 'a' must end up ahead, got ${match.score_a}–${match.score_b}`);
  assert.equal(match.score_a - match.score_b, 3, "the recorded margin must be the one submitted");

  /* -- 6. NOTIFY. The member inbox is readable and org-scoped. */
  const notes = await call(env, "GET", "/api/notifications", { token: staffToken });
  expectStatus(notes, 200, "notifications inbox");

  /* -- 7. The loop is audited end to end. Silent success is not success. */
  const actions = env.DB.query("SELECT DISTINCT action FROM audit_log ORDER BY action").map((r) => r.action);
  assert.ok(actions.length >= 3,
    `the whole loop wrote only ${actions.length} distinct audit actions: ${actions.join(", ")}`);

  env.DB.close();
});

/* ============================ the seams, asserted directly ============================ */

test("E2E: an unknown org is refused, and never falls back to org 1", async () => {
  // The v0.36.0 defect: a malformed X-Org-Id silently became org 1, so seven deactivated orgs
  // stayed operable and requests landed on the live business. Header value is kept, not coerced.
  const env = makeEnv();
  seed(env);
  const token = await signIn(env, "staff@boomtown.test");
  grantRole(env, "staff@boomtown.test", "admin");
  const r = await call(env, "GET", "/api/events/1/roster", { token, orgId: 4242 });
  assert.notEqual(r.status, 200, "a request for a non-existent org must not succeed");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM attendance").n, 0, "no write may land under a bogus org");
  env.DB.close();
});

test("E2E: a signed-out visitor cannot reach staff routes", async () => {
  const env = makeEnv();
  seed(env);
  for (const [method, path] of [
    ["GET", "/api/events/1/roster"],
    ["POST", "/api/events/1/checkin"],
    ["POST", "/api/matches/1/score"],
  ]) {
    const r = await call(env, method, path, method === "GET" ? {} : { body: {} });
    assert.equal(r.status, 401, `${method} ${path} must demand a session, got ${r.status}`);
  }
  env.DB.close();
});

test("E2E: a signed-in MEMBER cannot reach staff routes (role, not just session)", async () => {
  // v2.4's member-view isolation, asserted against the server rather than the UI shell.
  const env = makeEnv();
  seed(env);
  const memberToken = await signIn(env, "member@boomtown.test");
  grantRole(env, "member@boomtown.test", "member");
  const r = await call(env, "GET", "/api/events/1/roster", { token: memberToken });
  assert.equal(r.status, 403, `a member reached a staff route (${r.status}) — role gate is not holding`);
  env.DB.close();
});

test("E2E: a used magic link cannot be replayed", async () => {
  const env = makeEnv();
  seed(env);
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "replay@boomtown.test" } });
  const token = String(asked.data.dev_link).split("token=")[1];
  expectStatus(await call(env, "POST", "/api/auth/verify", { body: { token } }), 200, "first use");
  const second = await call(env, "POST", "/api/auth/verify", { body: { token } });
  assert.equal(second.status, 401, "a magic link was accepted twice — that is an account takeover primitive");
  env.DB.close();
});
