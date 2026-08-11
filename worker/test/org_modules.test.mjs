/**
 * Boomtown Platform — §-1l P-1: per-organization module visibility
 * File: worker/test/org_modules.test.mjs · Version: v1.0 · Date: 2026-08-10 · Ships in: v0.128.0
 *
 * Owner 2026-08-10 (§-1l): every organization gets the identical admin menu — Point of Sale,
 * Staff Pay, Marketing, Tryouts — whether it uses them or not, and with six orgs live and only
 * org 1 holding data, "the menu promises a dozen modules and every one opens on nothing." The
 * proposal he actually made (make the org a branding option inside leagues/tournaments) would be
 * an authorization rewrite; THIS delivers the navigation benefit he wants as a VIEW filter.
 *
 * THE THREE PROPERTIES, EACH A PAID-FOR LESSON, EACH PINNED HERE:
 *
 *  1. A VIEW FILTER, NEVER A PERMISSION. Hiding a module changes ZERO route behaviour — asserted
 *     by calling a real staff route from a "hidden" module before and after and demanding
 *     identical answers. A missing menu item must never be the thing preventing access (D-21's
 *     lesson in a new costume), and conversely nothing here may be MISTAKEN for access control.
 *
 *  2. NEVER A LOCKOUT. The registry structurally cannot name the way back: admin.html,
 *     admin-org-settings.html, settings.html, admin-security.html, admin-users.html and
 *     admin-events.html are asserted ABSENT from it, and the org-settings link is asserted
 *     PRESENT in the static rail — the exit is pinned by presence, not implied by omission
 *     (v0.123.0/v0.126.0: a rule that only forbids can delete the last way out).
 *
 *  3. DEFAULT ON. A NULL column and an empty list both hide nothing — new orgs and every
 *     existing org see everything until someone chooses otherwise, so the deploy itself changes
 *     no screen.
 *
 * ONE SOURCE. `BT_MODULES` is defined once, in admin-nav.js (which every admin page already
 *  loads); the settings screen consumes window.BT_MODULES and carries NO list of its own. The
 *  server stores an opaque sanitized slug array and never keeps a second registry — one list,
 *  two consumers, zero copies (D-22's corpus lesson applied at design time instead of after).
 *
 * THE DECISION LOGIC RUNS AS SHIPPED BYTES. `pagesToHide` is extracted from admin-nav.js with
 *  functionBodyAfter and executed via new Function — a text scan cannot see behaviour, and the
 *  multi-owner rule (a page shared by leagues AND tournaments hides only when EVERY owner is
 *  off) is exactly the kind of logic a grep would vacuously bless.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const WEB = new URL("../../web/", import.meta.url);
const read = (f) => readFileSync(new URL(f, WEB), "utf8");
const NAV = read("assets/admin-nav.js");
const SETTINGS_JS = read("assets/admin-org-settings.js");
const SETTINGS_HTML = read("admin-org-settings.html");
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
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1),(2,'Match Point Social','match-point',1)");
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

// The harness bootstraps the FIRST account as admin of every org; sign staff in first, member second.
async function tokens(env) {
  const staff = await signIn(env, "staff@bt.test");
  const member = await signIn(env, "member@bt.test");
  return { staff, member };
}

/* ==================== the registry: one source, and the exits are unnameable ============= */

/** Parse the shipped registry out of admin-nav.js by executing its own literal. */
function shippedRegistry() {
  const m = blankComments(NAV).match(/window\.BT_MODULES\s*=\s*(\[[\s\S]*?\]);/);
  assert.ok(m, "admin-nav.js no longer defines window.BT_MODULES as a literal array");
  return new Function("return " + m[1])();
}

test("BT_MODULES is defined exactly once, in admin-nav.js, and the settings screen carries no copy", () => {
  const defs = (blankComments(NAV).match(/window\.BT_MODULES\s*=/g) || []).length;
  assert.equal(defs, 1, `admin-nav.js defines BT_MODULES ${defs} times`);
  assert.match(blankComments(SETTINGS_JS), /window\.BT_MODULES/,
    "the settings screen does not consume the shared registry");
  assert.doesNotMatch(blankComments(SETTINGS_JS), /pages\s*:\s*\[/,
    "the settings screen carries its own module→pages list — two lists is how they drift apart");
});

test("NC — a literal pages list injected into the settings screen is caught", () => {
  const mutated = blankComments(SETTINGS_JS) + '\nconst SNEAK = [{ key: "pos", pages: ["admin-pos.html"] }];';
  assert.match(mutated, /pages\s*:\s*\[/,
    "the mutation did not land — the detector above proves nothing");
});

test("the registry can NEVER name the way back — exits absent from it, and pinned present in the rail", () => {
  const reg = shippedRegistry();
  const allPages = reg.flatMap((mod) => mod.pages);
  for (const exit of ["admin.html", "admin-org-settings.html", "settings.html",
                      "admin-security.html", "admin-users.html", "admin-events.html"]) {
    assert.ok(!allPages.includes(exit),
      `${exit} is in the hideable registry — an org that turns everything off loses its way back`);
  }
  // The presence half: the switch that turns modules back on is reachable from the static rail
  // of the page that owns it (and sync-rail keeps rails identical across admin pages).
  assert.match(SETTINGS_HTML, /href="admin-org-settings\.html"/,
    "the org-settings rail link is gone — the sanctioned exit must exist, not merely be unhidden");
  // And every registry entry is shaped: slug key, label, at least one page.
  for (const mod of reg) {
    assert.match(mod.key, /^[a-z][a-z0-9_-]{0,31}$/, `registry key ${mod.key} is not a slug`);
    assert.ok(mod.label && mod.pages.length >= 1, `registry entry ${mod.key} is malformed`);
  }
});

/* ==================== the decision logic, executed as shipped bytes ==================== */

function loadPagesToHide() {
  const body = functionBodyAfter(blankComments(NAV), "function pagesToHide");
  assert.ok(body, "pagesToHide is gone or no longer a plain function declaration");
  return new Function("registry", "off", body.slice(1, -1));
}

test("a page owned by two modules hides only when EVERY owner is off — the shipped bytes say so", () => {
  const fn = loadPagesToHide();
  const reg = shippedRegistry();
  const owners = (page) => reg.filter((mod) => mod.pages.includes(page)).map((mod) => mod.key);
  const shared = reg.flatMap((mod) => mod.pages).find((pg) => owners(pg).length > 1);
  assert.ok(shared, "no page in the registry has two owners — the multi-owner rule is untestable and the schedule editor should have two");
  const [a, b] = owners(shared);
  assert.ok(!fn(reg, [a]).includes(shared), `${shared} hid while ${b} still owns it`);
  assert.ok(fn(reg, [a, b]).includes(shared), `${shared} did not hide with every owner off`);
});

test("default ON: an empty or absent off-list hides nothing", () => {
  const fn = loadPagesToHide();
  const reg = shippedRegistry();
  assert.deepEqual(fn(reg, []), []);
  assert.deepEqual(fn(reg, null), []);
});

test("unknown keys hide nothing — the filter fails OPEN on config it does not understand", () => {
  const fn = loadPagesToHide();
  assert.deepEqual(fn(shippedRegistry(), ["not-a-module"]), []);
});

test("the nav filter REMOVES nodes, never sets [hidden] — the v0.119.0 cascade trap", () => {
  // [hidden] loses to any author display rule; .nav-item carries one. Removal has no cascade.
  const body = functionBodyAfter(blankComments(NAV), "function applyModuleFilter");
  assert.ok(body, "applyModuleFilter is gone or renamed");
  assert.match(body, /\.remove\(\)/, "the filter no longer removes nodes");
  assert.doesNotMatch(body, /hidden\s*=\s*true|setAttribute\(\s*["']hidden/,
    "the filter hides with the hidden attribute, which author CSS on .nav-item defeats");
});

/* ==================== the server: storage, sanitation, and the view/permission line ====== */

test("GET modules defaults to an empty off-list on a NULL column", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const r = await call(env, "GET", "/api/admin/org/modules", { token: staff });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.deepEqual(r.data.off, []);
});

test("PUT stores the off-list, GET and /api/orgs both read it back, and the write is audited", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const put = await call(env, "PUT", "/api/admin/org/modules", { token: staff, body: { off: ["pos", "marketing"] } });
  assert.equal(put.status, 200, JSON.stringify(put.data).slice(0, 200));

  const got = await call(env, "GET", "/api/admin/org/modules", { token: staff });
  assert.deepEqual(got.data.off.sort(), ["marketing", "pos"]);

  const orgs = await call(env, "GET", "/api/orgs", { token: staff });
  const one = (orgs.data.orgs || []).find((o) => o.id === 1);
  assert.ok(one, "/api/orgs no longer returns org 1");
  assert.deepEqual((one.modules_off || []).sort(), ["marketing", "pos"],
    "the rail reads /api/orgs — if the off-list is not there, the filter runs on nothing");
  const two = (orgs.data.orgs || []).find((o) => o.id === 2);
  assert.deepEqual(two.modules_off || [], [], "org 2 inherited org 1's off-list");

  const row = env.DB.one("SELECT detail_json FROM audit_log WHERE action='org.modules.update' ORDER BY id DESC LIMIT 1");
  assert.ok(row, "the module change is not audited — nav-shaping is config a director will ask about");
  env.DB.close();
});

test("NC — flipping the column directly changes what /api/orgs reports, so the feed reads the COLUMN", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  env.DB.exec(`UPDATE orgs SET modules_off_json='["tryouts"]' WHERE id=2`);
  assert.equal(env.DB.one("SELECT modules_off_json FROM orgs WHERE id=2").modules_off_json, '["tryouts"]',
    "mutation did not land");
  const orgs = await call(env, "GET", "/api/orgs", { token: staff });
  const two = (orgs.data.orgs || []).find((o) => o.id === 2);
  assert.deepEqual(two.modules_off, ["tryouts"]);
  env.DB.close();
});

test("junk is refused wholesale and writes nothing: non-array, oversize, bad slugs", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  for (const bad of [{ off: "pos" }, { off: { pos: true } }, {},
                     { off: Array.from({ length: 33 }, (_, i) => `m${i}`) },
                     { off: ["POS!"] }, { off: ["a".repeat(40)] }, { off: [7] }]) {
    const r = await call(env, "PUT", "/api/admin/org/modules", { token: staff, body: bad });
    assert.equal(r.status, 400, `accepted ${JSON.stringify(bad).slice(0, 60)}`);
  }
  assert.equal(env.DB.one("SELECT modules_off_json FROM orgs WHERE id=1").modules_off_json, null,
    "a refused PUT still wrote the column");
  env.DB.close();
});

test("members can neither read nor write the module config", async () => {
  const env = boot();
  const { member } = await tokens(env);
  assert.equal((await call(env, "GET", "/api/admin/org/modules", { token: member })).status, 403);
  assert.equal((await call(env, "PUT", "/api/admin/org/modules", { token: member, body: { off: [] } })).status, 403);
});

test("A VIEW FILTER, NEVER A PERMISSION — a hidden module's routes answer exactly as before", async () => {
  const env = boot();
  const { staff, member } = await tokens(env);
  const probe = async () => ({
    staff: (await call(env, "GET", "/api/admin/marketing/overview", { token: staff })).status,
    member: (await call(env, "GET", "/api/admin/marketing/overview", { token: member })).status,
  });
  const before = await probe();
  assert.equal(before.member, 403, "precondition: the member is refused before the experiment");

  const put = await call(env, "PUT", "/api/admin/org/modules", { token: staff, body: { off: ["marketing"] } });
  assert.equal(put.status, 200);
  assert.match(env.DB.one("SELECT modules_off_json FROM orgs WHERE id=1").modules_off_json, /marketing/,
    "mutation did not land");

  const after = await probe();
  assert.deepEqual(after, before,
    "hiding the marketing MENU changed a marketing ROUTE's answer — the view filter has become a permission, or worse, an outage");
  env.DB.close();
});
