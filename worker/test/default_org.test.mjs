/**
 * Boomtown Platform — the account's own default organization (§6 item 1, owner raised 2026-08-06)
 * File: worker/test/default_org.test.mjs · Version: v1.1 · Date: 2026-08-24 · Ships in: v0.169.0
 * v1.1 (D-46, v0.191.0): the forbidding assertion widened `[^)]*` → `[^;\n]*` so it reaches the
 * paren-ful arrow and single-line function spellings, with a positive control planted PER spelling.
 * Measured before widening: live NAV has zero `all.some(`/`all.find(` sites — no false red possible.
 *
 * WHAT THIS PINS. `users.default_org_id` (migration 0052) is a PREFERENCE, not a permission. The
 * column's `REFERENCES orgs(id)` proves only that the org exists; it says nothing about whether
 * this account may see it. So the rule is enforced twice, independently, and both halves are
 * asserted here:
 *   · THE WRITE refuses an org the caller holds no live role in.
 *   · THE READ (admin-nav.js) consults the default only if it survives the role filter it already
 *     computes, so a default whose role was revoked degrades to the existing first-org fallback
 *     rather than granting anything.
 *
 * A NOTE ABOUT THE TEST FIXTURE, NOT ABOUT PRODUCTION: the first account ever created in the
 * in-memory fixture is bootstrapped as admin of every active org (index.js verifyLink, F-12). A
 * test that signs its subject in first therefore measures nothing, because that account already
 * holds every role. `burnBootstrap` spends that on a throwaway address — the same guard
 * `org_honesty.test.mjs` learned to use the hard way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const NAV = readFileSync(new URL("../../web/assets/admin-nav.js", import.meta.url), "utf8");
/* TWO VIEWS, and which one each assertion takes is the point (§-1c D-45, 2026-08-18). `NAV_LIVE`
   drops comment bytes, so an assertion that a call site EXISTS cannot be satisfied by a line
   switched off with `//`. `NAV` stays raw for the assertion BELOW that forbids a shape, because for
   a forbidding assertion raw is the STRICTER view — blanking it would let a commented-out access
   path through. Measured before this change: with `location.reload(); return;` commented out in the
   real admin-nav.js, this file stayed green at 10/10. */
const NAV_LIVE = blankComments(NAV);
const ORIGIN = "https://boomtown.test";

const makeEnv = () => ({
  DB: createD1(SCHEMA), APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN,
  API_ORIGIN: "https://api.boomtown.test", ALLOWED_ORIGINS: ORIGIN,
});

async function call(env, method, path, { body, token, orgId = 1 } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(orgId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://api.boomtown.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 400) }; }
  return { status: res.status, data };
}
const expectStatus = (r, want, what) =>
  assert.equal(r.status, want, `${what}: expected ${want}, got ${r.status} — ${JSON.stringify(r.data).slice(0, 300)}`);

function seedOrgs(env) {
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
    INSERT INTO orgs (id, name, slug, active) VALUES (2, 'Match Point Social', 'matchpoint', 1);
    INSERT INTO orgs (id, name, slug, active) VALUES (3, 'Queens Club', 'queens', 1);
  `);
}
async function signIn(env, email, orgId = 1) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email }, orgId });
  expectStatus(asked, 200, "request-link");
  const token = String(asked.data.dev_link).split("token=")[1];
  assert.ok(token, `no token in dev_link: ${asked.data.dev_link}`);
  const verified = await call(env, "POST", "/api/auth/verify", { body: { token }, orgId });
  expectStatus(verified, 200, "auth/verify");
  return verified.data.token;
}
const burnBootstrap = (env) => signIn(env, "bootstrap-burn@boomtown.test");
function grantRole(env, email, orgId, role) {
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", email);
  assert.ok(u, `no user row for ${email}`);
  env.DB.exec(
    `INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, ${orgId}, '${role}')
     ON CONFLICT (user_id, org_id) DO UPDATE SET role='${role}', deleted_at=NULL`
  );
}
async function subject(env) {
  await burnBootstrap(env);
  const token = await signIn(env, "defaultorg@boomtown.test");
  grantRole(env, "defaultorg@boomtown.test", 1, "admin");
  grantRole(env, "defaultorg@boomtown.test", 2, "staff");
  return token; // roles in orgs 1 and 2; NEVER in org 3
}

/* ───────────────────────── the column reaches the client ───────────────────────── */

test("GET /api/me carries default_org_id, and it starts NULL — nobody gets a guessed preference", async () => {
  const env = makeEnv(); seedOrgs(env);
  const token = await subject(env);
  const me = await call(env, "GET", "/api/me", { token });
  expectStatus(me, 200, "GET /api/me");
  assert.ok(me.data.user, "no user object on /api/me");
  assert.ok("default_org_id" in me.data.user,
    `/api/me does not carry default_org_id — the switcher cannot prefer what it never receives. Got: ${Object.keys(me.data.user).join(", ")}`);
  assert.equal(me.data.user.default_org_id, null, "a fresh account must have NO default, not org 1");
});

/* ───────────────────────── the write, both directions ───────────────────────── */

test("PUT /api/me/default-org sets a default the caller has a role in, and /api/me reflects it", async () => {
  const env = makeEnv(); seedOrgs(env);
  const token = await subject(env);
  const put = await call(env, "PUT", "/api/me/default-org", { token, body: { org_id: 2 } });
  expectStatus(put, 200, "PUT default-org on a role org");
  assert.equal(put.data.default_org_id, 2, "the route must echo what it stored");
  const me = await call(env, "GET", "/api/me", { token });
  assert.equal(me.data.user.default_org_id, 2, "the write did not reach /api/me");
});

test("it REFUSES an org the caller holds no role in — and writes nothing", async () => {
  const env = makeEnv(); seedOrgs(env);
  const token = await subject(env);
  await call(env, "PUT", "/api/me/default-org", { token, body: { org_id: 1 } }); // a known-good default first
  const denied = await call(env, "PUT", "/api/me/default-org", { token, body: { org_id: 3 } });
  expectStatus(denied, 403, "default-org on a no-role org");
  assert.ok(denied.data && denied.data.error, "the refusal must carry a sentence the client can show");
  const me = await call(env, "GET", "/api/me", { token });
  assert.equal(me.data.user.default_org_id, 1, "a refused write must leave the previous default intact");
});

test("an org that does not exist is refused the same way — the reply never reveals which ids exist", async () => {
  const env = makeEnv(); seedOrgs(env);
  const token = await subject(env);
  const ghost = await call(env, "PUT", "/api/me/default-org", { token, body: { org_id: 99999 } });
  expectStatus(ghost, 403, "default-org on a nonexistent org");
  const noRole = await call(env, "PUT", "/api/me/default-org", { token, body: { org_id: 3 } });
  assert.equal(ghost.status, noRole.status, "a missing org and a no-role org must be indistinguishable");
});

test("null CLEARS the default — a preference must be removable", async () => {
  const env = makeEnv(); seedOrgs(env);
  const token = await subject(env);
  await call(env, "PUT", "/api/me/default-org", { token, body: { org_id: 2 } });
  const cleared = await call(env, "PUT", "/api/me/default-org", { token, body: { org_id: null } });
  expectStatus(cleared, 200, "clearing the default");
  assert.equal(cleared.data.default_org_id, null, "clear must report null");
  const me = await call(env, "GET", "/api/me", { token });
  assert.equal(me.data.user.default_org_id, null, "the clear did not reach /api/me");
});

test("junk is refused with 400, not coerced into an org id", async () => {
  const env = makeEnv(); seedOrgs(env);
  const token = await subject(env);
  for (const bad of ["two", 1.5, true, [], {}]) {
    const r = await call(env, "PUT", "/api/me/default-org", { token, body: { org_id: bad } });
    expectStatus(r, 400, `org_id = ${JSON.stringify(bad)}`);
  }
});

test("it requires a SESSION — anonymous cannot set anyone's default", async () => {
  const env = makeEnv(); seedOrgs(env);
  await subject(env);
  const anon = await call(env, "PUT", "/api/me/default-org", { body: { org_id: 1 } });
  expectStatus(anon, 401, "anonymous default-org");
});

test("the default is PER ACCOUNT — one user's choice is not another's", async () => {
  const env = makeEnv(); seedOrgs(env);
  const a = await subject(env);
  const b = await signIn(env, "other@boomtown.test");
  grantRole(env, "other@boomtown.test", 1, "admin");
  await call(env, "PUT", "/api/me/default-org", { token: a, body: { org_id: 2 } });
  const meB = await call(env, "GET", "/api/me", { token: b });
  assert.equal(meB.data.user.default_org_id, null, "one account's default leaked into another's");
});

/* ───────────────────────── the read side, in the switcher ───────────────────────── */

test("admin-nav.js CONSULTS the default, and only inside the role-filtered list", () => {
  assert.match(NAV_LIVE, /default_org_id/,
    "admin-nav.js never mentions default_org_id in live code — the column reaches the client and is ignored");
  // The preference is only ever honoured through `orgs`, which is already role-filtered above it.
  // Reading it off `all` (every org on the instance) would turn a preference into an access grant.
  // D-46 (v0.191.0): widened from `[^)]*` — which could not cross a `)`, so it saw the paren-less
  // arrow only — to `[^;\n]*`, which reaches every same-statement spelling: `o =>`, `(o) =>`, and a
  // single-line `function (o) {…}`. Measured before widening: live NAV has ZERO `all.some(`/`all.find(`
  // sites, so the wider net cannot redden correct code. Residual (named, not hidden): a callback
  // whose default_org_id sits on a LATER line still evades — the controls below plant the shapes
  // this regex is claimed to see, so the claim stays measured.
  assert.doesNotMatch(NAV, /all\.(some|find)\([^;\n]*default_org_id/,
    "the default is being resolved against the UNFILTERED org list — that is an access path, not a preference");
});

test("the two literals org_honesty.test.mjs pins are untouched — the self-heal still reads as before", () => {
  // Recorded in handoff §6 as the hazard for this unit: a rewrite of that block reddens the suite
  // ON A CORRECT FIX. Pinned here too so the constraint is visible from the unit that must respect it.
  assert.ok(NAV_LIVE.includes("orgs.some((o) => Number(o.id) === current)"), "the self-heal detector was rewritten");
  assert.ok(NAV_LIVE.includes("location.reload(); return;"), "the self-heal reload was rewritten");
});

test("NC: those two literals COMMENTED OUT fail this guard — they are code, not text", () => {
  /* The hole this file shared with org_honesty until 2026-08-18: both assertions above read raw
     source, so `// location.reload(); return;` satisfied them and the whole suite stayed green.
     Each anchor is asserted unique before it is used, because a control whose anchor matched twice
     proves nothing. */
  for (const anchor of ["orgs.some((o) => Number(o.id) === current)", "location.reload(); return;"]) {
    const hits = NAV.split(anchor).length - 1;
    assert.equal(hits, 1, `control anchor must appear exactly once, found ${hits}: ${anchor}`);
    const off = blankComments(NAV.split(anchor).join("// " + anchor));
    assert.ok(!off.includes(anchor), `a commented-out ${anchor} must not read as live code`);
  }
  /* And the forbidding assertion above must NOT be blanked — pinned, so a later "consistency" edit
     goes red carrying its reason. */
  /* D-46 CLOSED (v0.191.0): the regex was `[^)]*`, which cannot cross a `)`, so it reached the
     paren-less arrow only — the OTHER spellings are the ones the rest of NAV actually uses, so the
     likelier regression was invisible. Now `[^;\n]*`, and every spelling it is claimed to see is
     planted here as its own positive control. A control tests the check that exists. */
  const FORBID = /all\.(some|find)\([^;\n]*default_org_id/;
  const SPELLINGS = [
    "const x = all.some(o => o.default_org_id);",                       // paren-less arrow (the old reach)
    "const x = all.some((o) => o.id === me.default_org_id);",           // paren-ful arrow (D-46's blind spot)
    "const x = all.find((o) => o.id === me.default_org_id);",           // find, same shape
    "const x = all.some(function (o) { return o.default_org_id; });",   // single-line function callback
  ];
  for (const s of SPELLINGS) {
    assert.match(NAV + "\n// " + s + "\n", FORBID,
      `raw view: this spelling evades the forbidding check — the widening regressed: ${s}`);
  }
  assert.doesNotMatch(blankComments(NAV + "\n// " + SPELLINGS[0] + "\n"), FORBID,
    "blanked view: it disappears — which is why that check reads NAV, not NAV_LIVE");
});
