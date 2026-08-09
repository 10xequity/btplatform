/**
 * Boomtown Platform — §-1i S-3c: security headers on every response the worker returns
 * File: worker/test/security_headers.test.mjs · Version: v1.0 · Date: 2026-08-09 · Ships in: v0.118.0
 *
 * WHY. Until v0.118.0 only uploads.js and calendar.js set any protective header at all.
 * Absent everywhere else: Content-Security-Policy, X-Frame-Options (a framed privileged
 * surface is a clickjacking target), Referrer-Policy (a magic-link URL leaking via Referer
 * is a token leak), X-Content-Type-Options, Strict-Transport-Security.
 *
 * PLACEMENT IS THE POINT (the S-3b lesson, one layer up). The headers live at the fetch
 * EGRESS — the same choke point that merges CORS onto every response — NOT inside json().
 * json() never sees the avatar bytes, the three CSV exports, the ICS feeds, the SMS TwiML,
 * or marketing's unsubscribe page, which is the only HTML this worker serves and therefore
 * the surface that needs CSP most. A json()-level control would report the API armoured
 * while exactly those paths went out bare — a control reporting success it did not achieve.
 * The calendar-404 test below fails against a json()-level implementation by construction.
 *
 * SET-IF-ABSENT, NOT CLOBBER. uploads.js serves user-uploaded bytes under its own,
 * deliberately DIFFERENT CSP (sandboxed, img/style allowances for viewing); marketing's
 * page styles itself with inline style attributes, which die under the API-wide
 * default-src 'none'. A module that sets its own header keeps it; the egress fills gaps.
 *
 * THE DIMENSION NOT TOUCHED IS PINNED (the v0.115.0 rule). This release adds RESPONSE
 * headers; it must not disturb WHO MAY CALL. An origin outside ALLOWED_ORIGINS still
 * receives zero allow-origin headers — asserted here, in the same commit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";
const API = "https://api.boomtown.test";

/* One judgement, stated once: the five headers and their exact values. The implementation
   must agree byte-for-byte — a near-miss value (say, SAMEORIGIN) is a different policy. */
const ARMOUR = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

/* marketing.js's own CSP: its page carries inline style attributes, so it must keep
   style-src 'unsafe-inline' or ship an unstyled page — the same module-owns-its-header
   shape uploads.js has had since v0.30.0. */
const MARKETING_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

function makeEnv() {
  const env = {
    DB: createD1(SCHEMA), APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN,
    API_ORIGIN: API, ALLOWED_ORIGINS: ORIGIN,
  };
  env.DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1)");
  return env;
}

function hit(env, method, path, headers = {}) {
  return worker.fetch(new Request(API + path, {
    method, headers: { Origin: ORIGIN, "X-Org-Id": "1", ...headers },
  }), env);
}

/** Assert all five headers, exact values, allowing a named override where a module owns one. */
function assertArmoured(res, where, overrides = {}) {
  const expected = { ...ARMOUR, ...overrides };
  for (const [name, value] of Object.entries(expected)) {
    const got = res.headers.get(name);
    assert.ok(got, `${where}: ${name} is MISSING — this response reaches browsers bare`);
    assert.equal(got, value, `${where}: ${name} carries a different policy than the one decided`);
  }
}

test("every egress is armoured: a 200 JSON route, a 404, and the OPTIONS preflight", async () => {
  const env = makeEnv();

  assertArmoured(await hit(env, "GET", "/api/health"), "GET /api/health (200)");
  assertArmoured(await hit(env, "GET", "/api/no-such-route"), "GET unknown route (404)");
  assertArmoured(
    await hit(env, "OPTIONS", "/api/admin/programs/1", { "Access-Control-Request-Method": "DELETE" }),
    "OPTIONS preflight (204) — returned BEFORE the router, the easiest exit to forget");
});

test("the control sits at the EGRESS, not in json(): calendar's own text/plain 404 is armoured", async () => {
  // /api/calendar/absent.ics resolves in calendar.js and never touches json() — it builds its
  // own Response. If the five lived inside json(), this response would be bare and this test
  // is the one that says so.
  const res = await hit(makeEnv(), "GET", "/api/calendar/absent.ics");
  assert.equal(res.status, 404, "the probe token unexpectedly resolved — the test needs a dead feed");
  assert.match(res.headers.get("content-type") || "", /text\/plain/,
    "expected calendar's own non-JSON response; a JSON content-type means json() answered and the probe proves nothing");
  assertArmoured(res, "GET /api/calendar/absent.ics (non-json() path)");
});

test("a module that sets its own header KEEPS it: marketing's page CSP survives, json() gets the default", async () => {
  const env = makeEnv();

  // The one HTML page the worker serves. Its inline styles need style-src 'unsafe-inline';
  // the API-wide default-src 'none' would render it unstyled — set-if-absent must yield.
  const page = await hit(env, "GET", "/api/unsubscribe?c=1&t=not-a-real-token");
  assert.match(page.headers.get("content-type") || "", /text\/html/,
    "expected marketing's HTML page — a JSON answer means the route moved and this probe is dead");
  assertArmoured(page, "GET /api/unsubscribe (module-owned CSP)", {
    "content-security-policy": MARKETING_CSP,
  });

  // The contrast pair — the if-ABSENT branch on a real response: health sets no CSP of its
  // own, so the egress default must land there. Both branches now proven on live paths.
  const health = await hit(env, "GET", "/api/health");
  assert.equal(health.headers.get("content-security-policy"), ARMOUR["content-security-policy"],
    "json() responses must carry the API-wide CSP — the set-if-absent branch never fired");
});

test("WHO MAY CALL is untouched: an out-of-allowlist origin still gets zero allow-origin headers", async () => {
  const env = makeEnv();

  const evilGet = await hit(env, "GET", "/api/health", { Origin: "https://evil.example" });
  assert.equal(evilGet.headers.get("access-control-allow-origin"), null,
    "adding security headers LOOSENED the origin gate — evil.example was granted allow-origin");
  const evilPre = await hit(env, "OPTIONS", "/api/health",
    { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" });
  assert.equal(evilPre.headers.get("access-control-allow-origin"), null,
    "the preflight granted allow-origin to an origin outside ALLOWED_ORIGINS");

  // Both directions: the allowlisted origin still gets its echo, and stays armoured.
  const good = await hit(env, "GET", "/api/health");
  assert.equal(good.headers.get("access-control-allow-origin"), ORIGIN,
    "the allowlisted origin lost its allow-origin echo — the gate tightened by accident");
  assertArmoured(good, "allowlisted GET /api/health");
  assertArmoured(evilGet, "out-of-allowlist GET /api/health — armour does not depend on the caller");
});

test("NC — the checker fires: strip one header from a REAL response and assertArmoured throws", async () => {
  const res = await hit(makeEnv(), "GET", "/api/health");
  assertArmoured(res, "pre-mutation sanity");

  // Mutate the real input the checker reads, then prove the mutation landed before using it.
  res.headers.delete("referrer-policy");
  assert.equal(res.headers.has("referrer-policy"), false,
    "the mutation did not land — the NC would be testing an unmutated response");
  assert.throws(() => assertArmoured(res, "post-mutation"),
    /referrer-policy is MISSING/,
    "assertArmoured accepted a response with a stripped header — every green above is void");
});
