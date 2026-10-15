/**
 * Boomtown Platform — the 2026-10-15 external code review (ChatGPT/Codex), worker findings
 * File: worker/test/review_hardening.test.mjs · Version: v1.0 · Date: 2026-10-15 · Ships in: v0.215.0
 *
 * Four findings the review REPRODUCED against this harness, each pinned here behaviourally
 * through the real router (no mocks), each watched red before the fix:
 *
 *   F3  cookie sessions carried SameSite=None and the worker never looked at Origin, so a
 *       cookie-authenticated write from a foreign page was accepted (CSRF). Now: a token that
 *       arrived via the cookie is honoured on an unsafe method ONLY when the request's Origin is
 *       in ALLOWED_ORIGINS. Bearer tokens are unaffected (a foreign page cannot read them), and
 *       safe methods (GET/HEAD/OPTIONS) are unaffected (they do not mutate).
 *   F5  PATCH /api/matches/:id accepted score_a/score_b (and any round/court value) unvalidated
 *       and skipped standings/bracket refresh. Now: scores are refused there with their own
 *       sentence (the /score route is the one writer), and round/court must be positive ints.
 *   F4  the legacy public event reads returned SELECT * (including checkin_token) and the
 *       schedule read had no draft gate. Now: checkin_token and the Square ids never leave the
 *       public reads, and a draft's schedule/teams/standings refuse to anyone but staff.
 *   F10 the check-in roster priced every balance at the EVENT's current price, ignoring the
 *       price the registration snapshotted (discounts, later price edits). Now: the registration's
 *       own price wins; the event price is the fallback for pre-0024 rows with NULL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";
const EVIL = "https://evil.example";

function makeEnv() {
  const DB = createD1(SCHEMA);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: "https://api.boomtown.test", ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token, cookie, origin = ORIGIN, orgId = 1 } = {}) {
  const headers = { "Content-Type": "application/json", "X-Org-Id": String(orgId) };
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = `bt_session=${cookie}`;
  const req = new Request(`https://api.boomtown.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 400) }; }
  return { status: res.status, data };
}

/** A published 4-team event on 2 courts with one pool match, plus an admin session token. */
async function seed(env, { status = "published" } = {}) {
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
    INSERT INTO events (id, org_id, type, name, status, court_count, starts_at, price_cents, checkin_token, square_item_id)
      VALUES (7, 1, 'tournament', 'Tuesday Placement', '${status}', 2, datetime('now','-1 hour'), 4000, 'abcdef0123456789abcdef0123456789', 'SQ-ITEM');
  `);
  for (let i = 1; i <= 4; i++) {
    env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, level_num) VALUES (${i}, 1, 7, 'Team ${i}', 3);`);
  }
  env.DB.exec(`INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id)
    VALUES (100, 1, 7, 'pool', 1, 1, 1, 2);`);
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "ops@boomtown.test" } });
  const linkToken = String(asked.data.dev_link).split("token=")[1];
  const verified = await call(env, "POST", "/api/auth/verify", { body: { token: linkToken } });
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", "ops@boomtown.test");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, 1, 'admin')
    ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin', deleted_at=NULL`);
  return verified.data.token;
}

/* ---------- F3: cookie-authenticated writes need a trusted Origin ---------- */

test("F3: a cookie-authenticated write from a foreign Origin is treated as anonymous", async () => {
  const env = makeEnv();
  const token = await seed(env);
  const r = await call(env, "PATCH", "/api/matches/100", { body: { round: 2 }, cookie: token, origin: EVIL });
  assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status} ${JSON.stringify(r.data)}`);
  assert.equal(env.DB.one("SELECT round FROM matches WHERE id = 100").round, 1, "the row must not move");
});

test("F3: the same cookie write from the app's own Origin still works", async () => {
  const env = makeEnv();
  const token = await seed(env);
  const r = await call(env, "PATCH", "/api/matches/100", { body: { round: 2 }, cookie: token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(env.DB.one("SELECT round FROM matches WHERE id = 100").round, 2);
});

test("F3: a Bearer token is not a CSRF vector, so a foreign Origin does not block it", async () => {
  const env = makeEnv();
  const token = await seed(env);
  const r = await call(env, "PATCH", "/api/matches/100", { body: { round: 3 }, token, origin: EVIL });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test("F3: a cookie READ from a foreign Origin is still a read (safe methods pass)", async () => {
  const env = makeEnv();
  const token = await seed(env);
  const r = await call(env, "GET", "/api/me", { cookie: token, origin: EVIL });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

/* ---------- F5: the generic match PATCH is for scheduling, never scores ---------- */

test("F5: PATCH /api/matches/:id refuses scores with its own sentence and writes nothing", async () => {
  const env = makeEnv();
  const token = await seed(env);
  const r = await call(env, "PATCH", "/api/matches/100", { body: { score_a: -10, score_b: 1.5 }, token });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(String(r.data.error), /score/i);
  const row = env.DB.one("SELECT score_a, score_b FROM matches WHERE id = 100");
  assert.equal(row.score_a, null); assert.equal(row.score_b, null);
});

test("F5: round and court must be positive integers", async () => {
  const env = makeEnv();
  const token = await seed(env);
  for (const bad of [{ round: 0 }, { court: -1 }, { round: 2.5 }, { court: "two" }, { ref_team_id: "x" }]) {
    const r = await call(env, "PATCH", "/api/matches/100", { body: bad, token });
    assert.equal(r.status, 400, `${JSON.stringify(bad)} → ${r.status} ${JSON.stringify(r.data)}`);
  }
  const ok = await call(env, "PATCH", "/api/matches/100", { body: { round: 2, court: 2, ref_team_id: 3 }, token });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const row = env.DB.one("SELECT round, court, ref_team_id FROM matches WHERE id = 100");
  assert.deepEqual([row.round, row.court, row.ref_team_id], [2, 2, 3]);
});

/* ---------- F4: public event reads carry no operational secrets; drafts stay staff-only ---------- */

test("F4: GET /api/events/:id and /schedule never return checkin_token or Square ids", async () => {
  const env = makeEnv();
  const token = await seed(env);
  for (const [path, key] of [["/api/events/7", "event"], ["/api/events/7/schedule", "event"]]) {
    for (const t of [null, token]) {
      const r = await call(env, "GET", path, { token: t });
      assert.equal(r.status, 200, `${path} ${t ? "staff" : "anon"}: ${JSON.stringify(r.data).slice(0, 200)}`);
      const ev = r.data[key];
      assert.equal(ev.name, "Tuesday Placement");
      assert.equal(ev.checkin_token, undefined, `${path} leaked checkin_token`);
      assert.equal(ev.square_item_id, undefined, `${path} leaked square_item_id`);
    }
  }
});

test("F4: a draft's schedule, teams and standings refuse anonymous callers but serve staff", async () => {
  const env = makeEnv();
  const token = await seed(env, { status: "draft" });
  for (const path of ["/api/events/7/schedule", "/api/events/7/teams", "/api/events/7/standings"]) {
    const anon = await call(env, "GET", path);
    assert.equal(anon.status, 403, `${path} anon → ${anon.status}`);
    const staff = await call(env, "GET", path, { token });
    assert.equal(staff.status, 200, `${path} staff → ${staff.status} ${JSON.stringify(staff.data).slice(0, 200)}`);
  }
});

/* ---------- F10: the desk balance is the price the registration carries ---------- */

test("F10: the roster balance uses registrations.price_cents, falling back to the event price only when NULL", async () => {
  const env = makeEnv();
  const token = await seed(env);
  env.DB.exec(`
    INSERT INTO contacts (id, org_id, email, full_name) VALUES (11, 1, 'a@x.test', 'Ava A'), (12, 1, 'b@x.test', 'Bea B');
    INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES (1, 1, 11, 'Ava A', 'a@x.test'), (1, 2, 12, 'Bea B', 'b@x.test');
    INSERT INTO registrations (org_id, event_id, contact_id, team_id, status, price_cents) VALUES (1, 7, 11, 1, 'pending', 3000);
    INSERT INTO registrations (org_id, event_id, contact_id, team_id, status, price_cents) VALUES (1, 7, 12, 2, 'pending', NULL);
  `);
  const r = await call(env, "GET", "/api/events/7/roster", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  const byTeam = Object.fromEntries(r.data.roster.map((x) => [x.team_id, x.balance_cents]));
  assert.equal(byTeam[1], 3000, "discounted registration keeps its own price");
  assert.equal(byTeam[2], 4000, "a NULL snapshot falls back to the event price");
});
