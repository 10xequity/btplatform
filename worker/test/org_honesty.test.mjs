/**
 * Boomtown Platform — org honesty (roadmap §-1 Block B, audit R1)
 * File: worker/test/org_honesty.test.mjs · Version: v1.0 · Date: 2026-08-05 · Ships in: v0.89.0
 *
 * WHY (audit §1, the tester round's biggest root cause)
 * The org switcher offered an org the caller had no role in, the choice was sticky in
 * localStorage, and all seed data is org 1 — so one click put every module into "No events yet"
 * or a 403 that read as "Couldn't load your events." The 2026-08-05 handoff's earned rule:
 * "No test ran twice, and no test ran as a second org. A multi-tenant app needs a test that runs
 * as a user in an EMPTY org and a user with NO role." This file is that test, plus the guard
 * over the client fixes.
 *
 * PART 1 — SERVER TRUTH, through the real router (e2e_journey harness pattern; nothing under
 * test is mocked). Runs the two states no test had ever been in:
 *   · staff of an EMPTY org: staff endpoints answer 200 with empty lists — and never leak
 *     another org's rows (F-11).
 *   · a user with NO role on the org: staff endpoints answer 403.
 * The client's Block B behaviors (orgEmptyState on empty, loadFail naming the org on 403) are
 * built ON these two contracts, so a drift here silently breaks both.
 *
 * PART 2 — CLIENT SINGLE-SOURCE GUARD (header_shell string-scan pattern). Asserts admin-nav.js
 * filters the switcher through /api/me roles and self-heals a stored org outside them, that the
 * helpers are exported (the wiring line, not the definition), and that the six event-driven
 * modules call them — scanning the WIDEST set (all of web/assets) for the retired
 * blame-the-module string. Every verdict carries a negative control that mutates real input.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

/* ═══════════════════ PART 1 — server truth on a second org ═══════════════════ */

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function makeEnv() {
  return {
    DB: createD1(SCHEMA),
    APP_URL: ORIGIN,
    SITE_ORIGIN: ORIGIN,
    API_ORIGIN: "https://api.boomtown.test",
    ALLOWED_ORIGINS: ORIGIN,
  };
}

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

function expectStatus(r, want, what) {
  assert.equal(r.status, want,
    `${what}: expected ${want}, got ${r.status} — ${JSON.stringify(r.data).slice(0, 300)}`);
}

/* Two orgs. Org 1 carries data; org 2 is EMPTY — the state the tester round lived in. */
function seedTwoOrgs(env) {
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
    INSERT INTO orgs (id, name, slug, active) VALUES (2, 'Match Point Social', 'matchpoint', 1);
    INSERT INTO events (id, org_id, type, name, status, capacity, court_count, price_cents, cash_option_enabled, starts_at)
      VALUES (1, 1, 'tournament', 'Org-1 Open', 'published', 16, 2, 4000, 1, datetime('now','+7 days'));
  `);
}

/* The FIRST-EVER user is bootstrapped admin of ALL active orgs (index.js verifyLink, F-12) —
   this test found that the hard way: its first draft signed in one user and the "no role"
   request passed requireStaff everywhere. Burn the bootstrap on a throwaway account so the
   user under test carries only the roles the test grants. */
async function burnBootstrap(env) {
  await signIn(env, "bootstrap-burn@boomtown.test");
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

function grantRole(env, email, orgId, role) {
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", email);
  assert.ok(u, `no user row for ${email}`);
  env.DB.exec(
    `INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, ${orgId}, '${role}')
     ON CONFLICT (user_id, org_id) DO UPDATE SET role='${role}', deleted_at=NULL`
  );
}

test("a staff endpoint answers 403 — not an empty success — on an org where the caller has NO role", async () => {
  const env = makeEnv();
  seedTwoOrgs(env);
  await burnBootstrap(env);
  const token = await signIn(env, "orgtest@boomtown.test");
  grantRole(env, "orgtest@boomtown.test", 1, "admin");

  const home = await call(env, "GET", "/api/admin/dashboard", { token, orgId: 1 });
  expectStatus(home, 200, "dashboard on the role org (control — the 403 below must be about the ROLE)");
  const denied = await call(env, "GET", "/api/admin/dashboard", { token, orgId: 2 });
  expectStatus(denied, 403, "dashboard on a no-role org");
  assert.ok(denied.data && denied.data.error, "the 403 must carry a human sentence the client can show");
});

test("an EMPTY org answers 200 with empty lists — and never another org's rows (F-11)", async () => {
  const env = makeEnv();
  seedTwoOrgs(env);
  await burnBootstrap(env);
  const token = await signIn(env, "orgtest2@boomtown.test");
  grantRole(env, "orgtest2@boomtown.test", 1, "admin");
  grantRole(env, "orgtest2@boomtown.test", 2, "admin");

  const one = await call(env, "GET", "/api/events", { token, orgId: 1 });
  expectStatus(one, 200, "events on the data org");
  assert.ok((one.data.events || []).some((e) => e.name === "Org-1 Open"), "org 1 must see its own event");

  const two = await call(env, "GET", "/api/events", { token, orgId: 2 });
  expectStatus(two, 200, "events on the empty org");
  assert.deepEqual(two.data.events || [], [],
    "the empty org must be EMPTY — a leaked row here is a cross-org read, the F-11 class");

  const dash = await call(env, "GET", "/api/admin/dashboard", { token, orgId: 2 });
  expectStatus(dash, 200, "dashboard on an empty org must succeed — empty is a state, not an error");
});

/* ═══════════════════ PART 2 — client single-source guard ═══════════════════ */

const WEB_DIR = new URL("../../web/", import.meta.url);
const read = (p) => readFileSync(new URL(p, WEB_DIR), "utf8");

/* The six event-driven modules the tester report named — each must use the org-honest pair. */
const MODULES = [
  "admin-tryouts.js", "admin-brackets.js", "admin-divisions.js",
  "admin-pool-board.js", "admin-score-links.js", "admin-schedule-editor.js",
];

/* Verdicts are pure so the negative controls can run the REAL source, mutated. */
const switcherFilterVerdict = (src) =>
  src.includes('x.role === "admin" || x.role === "staff"') && // the role set the shell admits
  src.includes("roleIds.has(Number(o.id))");                   // the filter applied to /api/orgs
const selfHealVerdict = (src) =>
  src.includes("orgs.some((o) => Number(o.id) === current)") && // detect a stored org outside the role list
  src.includes("location.reload(); return;");                    // and re-fetch the page under the healed org
const exportVerdict = (src) =>
  /window\.BT_ADMIN = \{[^}]*loadFail[^}]*orgEmptyState[^}]*\}/.test(src); // the WIRING, not the definitions
const moduleVerdict = (src) => ({
  loadFail: src.includes("BT_ADMIN.loadFail("),
  emptyState: src.includes("BT_ADMIN.orgEmptyState("),
  blame: src.includes("Couldn't load your events."),
});

test("admin-nav.js filters the switcher through /api/me roles and self-heals a poisoned bt_org", () => {
  const src = read("assets/admin-nav.js");
  assert.ok(switcherFilterVerdict(src),
    "the role filter is gone — the switcher would again offer an org with no role (audit R1)");
  assert.ok(selfHealVerdict(src),
    "the self-heal is gone — a poisoned localStorage bt_org would stick across reloads again");
  assert.ok(exportVerdict(src),
    "loadFail/orgEmptyState missing from the BT_ADMIN export — six modules just lost their org states");
});

test("the six event-driven modules use loadFail + orgEmptyState; nothing in web/assets blames the module", () => {
  for (const f of MODULES) {
    const v = moduleVerdict(read("assets/" + f));
    assert.ok(v.loadFail, `${f}: no BT_ADMIN.loadFail call — a 403 would blame the module again`);
    assert.ok(v.emptyState, `${f}: no BT_ADMIN.orgEmptyState call — an empty org would render a blank board again`);
  }
  // Widest set: the retired string must not survive ANYWHERE that ships (C13 — location is part
  // of whether a guard can see it). admin-nav.js itself may not reintroduce it either.
  const files = readdirSync(new URL("assets/", WEB_DIR)).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 25, `assets corpus shrank: ${files.length} js files (failure class 4)`);
  const offenders = files.filter((f) => read("assets/" + f).includes("Couldn't load your events."));
  assert.deepEqual(offenders, [],
    `the blame-the-module string returned in: ${offenders.join(", ")}`);
});

/* ── negative controls — every verdict must be provable-false on mutated REAL input ── */

test("NC-1: stripping the role filter from admin-nav.js fails the switcher verdict", () => {
  const mutated = read("assets/admin-nav.js").replace("roleIds.has(Number(o.id))", "true");
  assert.equal(switcherFilterVerdict(mutated), false, "an unfiltered switcher must fail");
});

test("NC-2: stripping the self-heal reload from admin-nav.js fails the self-heal verdict", () => {
  const mutated = read("assets/admin-nav.js").replace("location.reload(); return;", "");
  assert.equal(selfHealVerdict(mutated), false, "a heal that never re-fetches must fail");
});

test("NC-3: dropping loadFail from the BT_ADMIN export fails the wiring verdict", () => {
  const mutated = read("assets/admin-nav.js").replace(/(window\.BT_ADMIN = \{[^}]*?)loadFail, /, "$1");
  assert.equal(exportVerdict(mutated), false, "a defined-but-unexported helper must fail — failure class 1");
});

test("NC-4: reintroducing the blame string into a real module fails the module verdict", () => {
  const real = read("assets/admin-tryouts.js");
  const mutated = real.replace('BT_ADMIN.loadFail("tList", r, "events")', 'fail("tList", "Couldn\'t load your events.")');
  assert.notEqual(mutated, real, "mutation did not land — NC is vacuous");
  const v = moduleVerdict(mutated);
  assert.ok(!v.loadFail || v.blame, "the reverted module must fail at least one verdict");
  assert.equal(v.loadFail, false, "the loadFail call is gone and the verdict must say so");
});

test("NC-5: stripping the orgEmptyState call from a real module fails the module verdict", () => {
  const real = read("assets/admin-brackets.js");
  const mutated = real.replace(/if \(!eventId\) return BT_ADMIN\.orgEmptyState\([^)]*\);[^\n]*\n/, "");
  assert.notEqual(mutated, real, "mutation did not land — NC is vacuous");
  assert.equal(moduleVerdict(mutated).emptyState, false, "an empty org rendering nothing must fail");
});
