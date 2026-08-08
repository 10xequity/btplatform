/**
 * Boomtown Platform — authorization matrix by role (roadmap §-1e priority 2)
 * File: worker/test/authorization_matrix.test.mjs · Version: v1.0 · Date: 2026-08-08 · Ships in: v0.103.0
 *
 * WHAT v0.102.0 LEFT UNDONE, IN ITS OWN WORDS.
 * `admin_route_gating.test.mjs` proves every one of the 102 `/api/admin/*` dispatch sites REACHES
 * a gate. Its header states the limit plainly: it "asserts a gate is REACHED, not that it refuses
 * the right people (that is §-1e item 2, the authorization matrix)". This file is item 2.
 *
 * THE QUESTION IT ANSWERS. `requireStaff` admits admin OR staff; `requireAdmin` admits admin ONLY.
 * Both are in use, and until this file nothing checked that a route needing admin had not settled
 * for staff. "Is there a gate" cannot tell the two apart — which is why `gateKindCallsIn` exists
 * beside `gateCallsIn` in the shared extractor rather than replacing it.
 *
 * ── THE MEASUREMENT THAT SHAPED THIS FILE ────────────────────────────────────────────────────
 * `requireAdmin` has EXACTLY FOUR call sites in the entire worker, all four in `admin.js`
 * (listUsers, addUser, setRole, revokeRole). Every other admin route in all 38 modules — roughly
 * 190 gate calls — admits staff. So the admin-only surface is two route SHAPES out of 102.
 *
 * THIS FILE DOES NOT JUDGE THAT. Which routes deserve admin is an OWNER decision, and §-1e is
 * explicit that a judgement question goes to the handoff as a question rather than being encoded
 * as a rule someone invented. What this file does instead is pin what the CODEBASE ITSELF already
 * decided, so the decision cannot be reversed silently:
 *   · the admin-only set may GROW freely (tightening needs no permission)
 *   · it may never SHRINK (a route downgraded admin→staff reddens this file)
 * The open policy questions are recorded in the handoff §5 (S-2b/S-2c), not here.
 *
 * ── THE INVARIANT HAD TO BE DISCOVERED, NOT ASSUMED (the v0.102.0 lesson, in a new shape) ─────
 * The obvious precedence — "a module-level gate above the dispatch decides the route" — is WRONG
 * here, and wrong in the dangerous direction. `adminRoutes` in `admin.js` gates `/api/admin/
 * permissions` with an INLINE `requireStaff` at line 60, and the four requireAdmin routes are
 * dispatched BELOW it at lines 65-72. Module-level-first would let that one `requireStaff` vouch
 * for all four and report the admin-only set as EMPTY — a check that passes while proving nothing,
 * which is precisely the failure class §-1e was opened to kill. So kind resolution runs
 * MOST-SPECIFIC FIRST: inline region (iii) → delegated handler (ii) → module-level (i).
 * `resolvesAdminUnderAnInlineStaffGate` below is the regression test for exactly that ordering.
 *
 * ── PART 2 IS BEHAVIOURAL, THROUGH THE REAL ROUTER ───────────────────────────────────────────
 * A static map of gate names is still a claim about source text. Part 2 signs in real users over
 * the in-memory D1 shim and calls the real dispatch, asserting the actual status codes — the
 * "assert the 403s" the roadmap asked for. Static and behavioural must agree; if they ever
 * disagree, one of them is wrong and neither should be believed.
 *
 * THE TRAP THAT WOULD HAVE MADE ALL OF PART 2 VACUOUS, and it is already documented in
 * `org_honesty.test.mjs`: the FIRST-EVER user is bootstrapped admin of ALL active orgs
 * (`index.js` verifyLink, F-12). A matrix that signed in its "staff" user first would have tested
 * an admin wearing a staff label and reported a clean 200 everywhere. `burnBootstrap` spends the
 * bootstrap on a throwaway account before any user under test exists.
 *
 * SCOPE, STATED BECAUSE A CHECK THAT REPORTS CLEAN MUST SAY WHAT IT DID NOT COVER: this asserts
 * WHICH ROLE each admin route admits. It does not assert org-scoping of every read and write
 * (§-1e item 3; §-1c D-8 is a known live instance), and it does not assert that the capability
 * NAMES in `PERMISSIONS` map onto the right routes — that mapping is the owner question in §5.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import {
  blankComments, lineOf, functionRanges, enclosing,
  adminDispatchesIn, dispatchRegion, calleeNames,
  gateKindCallsIn, handlerGateKind,
} from "../testkit/route-extract.mjs";

const SRC_DIR = new URL("../src/", import.meta.url);
const readSrc = (f) => readFileSync(new URL(f, SRC_DIR), "utf8");
const srcFiles = () => readdirSync(SRC_DIR).filter((f) => f.endsWith(".js"));

/* ═══════════════════ PART 1 — the static matrix ═══════════════════ */

/** Which role a single admin dispatch admits, resolved MOST-SPECIFIC FIRST.
 *  Returns "admin" | "staff" | null (null = ungated, which is the S-1a ratchet's business).
 *  The ordering is the whole correctness argument — see the header. */
export function gateKindAt(t, index) {
  const region = dispatchRegion(t, index);
  const inline = gateKindCallsIn(region);
  if (inline.length) return inline.some((g) => g.kind === "admin") ? "admin" : "staff";

  // WEAKEST GATE WINS among delegated handlers, and this is a correctness argument, not a style
  // choice. One dispatch can front several handlers: the users/:id/role regex is a SINGLE match
  // whose block calls setRole (admin) and revokeRole (admin). Taking the FIRST handler's kind
  // would let setRole vouch for revokeRole, so downgrading revokeRole alone would leave this file
  // green — a false negative, which for a security ratchet is the failure that reports clean
  // forever. A dispatch admits whoever its most permissive path admits.
  //   (Line comments, not a block: the route shape contains a star-slash, which ends a block
  //    comment early. That is not a footnote — it is exactly why blankComments exists, and it
  //    broke this file's first parse.)
  const handlerKinds = calleeNames(region).map((n) => handlerGateKind(t, n)).filter(Boolean);
  if (handlerKinds.length) return handlerKinds.includes("staff") ? "staff" : "admin";

  const fn = enclosing(functionRanges(t), index);
  if (fn) {
    const above = gateKindCallsIn(t).filter((g) => g.index > fn.start && g.index < index);
    if (above.length) return above.some((g) => g.kind === "admin") ? "admin" : "staff";
  }
  return null;
}

/** Every admin dispatch in one module, with the role it admits. */
export function matrixIn(src, file) {
  const t = blankComments(src);
  return adminDispatchesIn(t).map((d) => ({
    shape: d.shape, file, line: lineOf(t, d.index), kind: gateKindAt(t, d.index),
  }));
}

const corpus = () => srcFiles().map((f) => ({ file: f, src: readSrc(f) }));
const fullMatrix = (c = corpus()) => c.flatMap(({ file, src }) => matrixIn(src, file));

/** Admin-only DISPATCH COUNTS per shape — not a set of shapes, and the difference is the whole
 *  point. `/api/admin/users` is TWO dispatches (`=== "/api/admin/users"` for GET and again for
 *  POST). A set would still contain that shape after listUsers alone was downgraded to staff,
 *  because addUser still requires admin — the ratchet would stay GREEN through a real downgrade.
 *  THIS FILE'S OWN FIRST RUN PROVED THAT: NC-M1 mutated listUsers, and the set-based verdict did
 *  not notice. Counting dispatches per shape is precise where a set is merely convenient, and for
 *  a security guard a false negative costs far more than a false positive. */
const adminOnlyCounts = (m = fullMatrix()) => {
  const out = {};
  for (const r of m) if (r.kind === "admin") out[r.shape] = (out[r.shape] || 0) + 1;
  return out;
};

/* THE PIN. Measured on the v0.102.0 tree, not projected: the only admin-ONLY routes in the whole
   worker are the four user/role-management handlers in admin.js. They occupy three dispatch sites
   across two shapes — `/api/admin/users` twice (GET→listUsers, POST→addUser) and the role regex
   once (its block fronts both setRole and revokeRole).
   These counts may GROW. They may never SHRINK. */
const ADMIN_ONLY = { "/api/admin/users": 2, "/api/admin/users/*/role": 1 };

test("the matrix has not collapsed — every one of the 102+ dispatches resolves to a role", () => {
  const m = fullMatrix();
  assert.ok(m.length >= 102, `only ${m.length} dispatches resolved — extraction drift, not a clean scan`);
  const unresolved = m.filter((r) => r.kind === null);
  assert.deepEqual(unresolved.map((r) => `${r.file}:${r.line} ${r.shape}`), [],
    "a dispatch resolved to NO gate. Either the S-1a ratchet is now red too, or this file's " +
    "resolution is blind to a fourth gating style — read the code before believing either.");
});

test("no admin-only route has been downgraded to staff (§-1e priority 2 ratchet)", () => {
  const now = adminOnlyCounts();
  const lost = Object.entries(ADMIN_ONLY)
    .filter(([shape, n]) => (now[shape] || 0) < n)
    .map(([shape, n]) => `${shape}: ${n} admin dispatch(es) pinned, ${now[shape] || 0} found`);
  assert.deepEqual(lost, [],
    "a route that required ADMIN now settles for STAFF. requireStaff admits staff OR admin, so " +
    "this WIDENS who can call it. If the downgrade is deliberate, change ADMIN_ONLY in the same " +
    "commit and say why — do not let it happen silently.");
});

test("the admin-only surface is exactly what was measured — growth is fine, but it must be recorded", () => {
  assert.deepEqual(adminOnlyCounts(), ADMIN_ONLY,
    "the admin-only surface changed. Growing it is GOOD (tightening needs no permission) — update " +
    "ADMIN_ONLY. Shrinking it is the defect the test above catches.");
});

test("resolution is most-specific-first: an inline staff gate ABOVE a route must not mask its admin handler", () => {
  /* The real shape in admin.js: requireStaff inline at :60 for /api/admin/permissions, then the
     four requireAdmin routes dispatched below it in the SAME function. Module-level-first
     resolution reports the admin-only set as empty — a green test proving nothing. */
  const t = blankComments(readSrc("admin.js"));
  const users = adminDispatchesIn(t).filter((d) => d.shape === "/api/admin/users");
  assert.ok(users.length >= 2, "expected GET and POST dispatches for /api/admin/users");
  for (const d of users) {
    assert.equal(gateKindAt(t, d.index), "admin",
      `/api/admin/users at line ${lineOf(t, d.index)} resolved as staff — the inline requireStaff ` +
      "above it has been allowed to vouch for it. This is the S-1a failure with a different mask.");
  }
  assert.equal(
    gateKindAt(t, adminDispatchesIn(t).find((d) => d.shape === "/api/admin/permissions").index), "staff",
    "/api/admin/permissions is inline-gated with requireStaff and must still resolve as staff");
});

/* ---------- negative controls: each mutates the REAL source of a REAL module ---------- */

test("NC-M1: downgrading ONE method of a two-dispatch shape FAILS the ratchet", () => {
  /* listUsers only — `requireAdmin(env, ctx)` with no orgId is unique to it, so addUser, setRole
     and revokeRole are untouched. This is the mutation that exposed the original set-based
     verdict as a false negative: the SHAPE `/api/admin/users` survives as admin-only through
     addUser, so only a per-dispatch COUNT can see the downgrade. */
  const src = readSrc("admin.js");
  const mutated = src.replace(/const gate = await requireAdmin\(env, ctx\);/, "const gate = await requireStaff(env, ctx);");
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");

  const counts = adminOnlyCounts(matrixIn(mutated, "admin.js"));
  assert.equal(counts["/api/admin/users"], 1,
    "listUsers was downgraded to staff and the shape still reports both dispatches as admin-only");
  const lost = Object.entries(ADMIN_ONLY).filter(([shape, n]) => (counts[shape] || 0) < n);
  assert.ok(lost.length > 0, "the ratchet must report a LOST admin dispatch after the downgrade");
});

test("NC-M5: downgrading revokeRole alone FAILS — one handler must not vouch for its neighbour", () => {
  /* setRole and revokeRole sit under ONE regex dispatch. First-handler-wins resolution would let
     setRole's requireAdmin cover a downgraded revokeRole and report clean. Weakest-gate-wins is
     what makes this visible, and this NC is the reason that rule is in gateKindAt. */
  const src = readSrc("admin.js");
  const mutated = src.replace(
    /(async function revokeRole\(env, ctx, userId, url\) \{\s*\n\s*const orgId = Number\(url\.searchParams\.get\("org_id"\)\);\s*\n\s*const gate = await )requireAdmin/,
    "$1requireStaff"
  );
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  const counts = adminOnlyCounts(matrixIn(mutated, "admin.js"));
  assert.ok(!counts["/api/admin/users/*/role"],
    "revokeRole was downgraded to staff but setRole's requireAdmin still vouched for the dispatch — " +
    "this is the S-1a failure shape (a neighbour vouching for an ungated peer) at role granularity");
});

test("NC-M2: a gate DEFINITION never sets a route's kind", () => {
  assert.deepEqual(gateKindCallsIn("async function requireAdmin(env, ctx) { return null; }\n"), [],
    "a definition was counted as a call site — this is the §-1e failure, reproduced for KINDS");
  const withCall = "async function requireAdmin(env, ctx) { return null; }\nconst d = await requireAdmin(env, ctx);\n";
  assert.deepEqual(gateKindCallsIn(withCall).map((g) => g.kind), ["admin"], "the call after it must still be found");
});

test("NC-M3: comments never set a route's kind", () => {
  assert.deepEqual(gateKindCallsIn(blankComments("// requireAdmin(env, ctx)\n")), [],
    "a gate named only in a comment set a route's role");
});

/* ═══════════════════ PART 2 — behavioural, through the real router ═══════════════════ */

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

const makeEnv = () => ({
  DB: createD1(SCHEMA),
  APP_URL: ORIGIN,
  SITE_ORIGIN: ORIGIN,
  API_ORIGIN: "https://api.boomtown.test",
  ALLOWED_ORIGINS: ORIGIN,
});

async function call(env, method, path, { body, token, orgId = 1 } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(orgId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.boomtown.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 400) }; }
  return { status: res.status, data };
}

function seedOrg(env) {
  env.DB.exec(`INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);`);
}

/* The FIRST-EVER user is bootstrapped admin of ALL active orgs (index.js verifyLink, F-12).
   Without this, the "staff" user below is a disguised admin and every 403 assertion passes for
   the wrong reason. org_honesty.test.mjs found this the hard way; it is repeated, not inherited. */
const burnBootstrap = (env) => signIn(env, "bootstrap-burn@boomtown.test");

async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  assert.equal(asked.status, 200, `request-link for ${email}: ${JSON.stringify(asked.data).slice(0, 200)}`);
  const token = String(asked.data.dev_link).split("token=")[1];
  assert.ok(token, `no token in dev_link for ${email}`);
  const verified = await call(env, "POST", "/api/auth/verify", { body: { token } });
  assert.equal(verified.status, 200, `verify for ${email}`);
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

/** The four admin-only handlers as real, callable requests.
 *
 *  TWO TRAPS ARE DESIGNED OUT OF THIS LIST, AND THIS FILE'S FIRST RUN WALKED INTO ONE OF THEM.
 *
 *  (1) addUser and setRole VALIDATE THE BODY BEFORE THEY GATE (admin.js:113-118, :134-137) — a
 *      body they reject returns 400 and never reaches requireAdmin, so a lazily-built probe would
 *      report "not 403" and prove nothing. Every body below is deliberately VALID so that the
 *      GATE is what answers. That ordering is itself a finding (handoff §5, S-2d).
 *
 *  (2) THE PROBE MUST NOT MUTATE THE CALLER'S OWN AUTHORIZATION. These targeted user id 2 — the
 *      staffer making the calls — and NC-M4 duly failed: after promotion the setRole call
 *      SUCCEEDED and demoted the caller back to staff, so the DELETE that followed was correctly
 *      403. The gate was reading the role perfectly; the test had revoked its own privilege
 *      mid-run. Target BYSTANDER user 4 (the member), who is nobody's caller. An authorization
 *      test that writes roles is editing the thing it is measuring — order the calls as if that
 *      were true, because it is. */
const BYSTANDER = 4; // player@boomtown.test — granted 'member' in setupRoles, never a caller
const ADMIN_ONLY_CALLS = [
  { what: "GET /api/admin/users",             method: "GET",    path: "/api/admin/users" },
  { what: "POST /api/admin/users",            method: "POST",   path: "/api/admin/users",
    body: { email: "newperson@boomtown.test", org_id: 1, role: "member" } },
  { what: "POST /api/admin/users/:id/role",   method: "POST",   path: `/api/admin/users/${BYSTANDER}/role`,
    body: { org_id: 1, role: "member" } },
  { what: "DELETE /api/admin/users/:id/role", method: "DELETE", path: `/api/admin/users/${BYSTANDER}/role?org_id=1` },
];

/** A representative staff-gated route, used as the control that proves a 403 is about the ROLE
    and not about the request being broken. */
const STAFF_CALL = { what: "GET /api/admin/dashboard", method: "GET", path: "/api/admin/dashboard" };

async function setupRoles(env) {
  seedOrg(env);
  await burnBootstrap(env);
  const staffToken = await signIn(env, "staffer@boomtown.test");
  const adminToken = await signIn(env, "boss@boomtown.test");
  const memberToken = await signIn(env, "player@boomtown.test");
  grantRole(env, "staffer@boomtown.test", 1, "staff");
  grantRole(env, "boss@boomtown.test", 1, "admin");
  grantRole(env, "player@boomtown.test", 1, "member");
  return { staffToken, adminToken, memberToken };
}

test("STAFF is refused (403) on every admin-only route — the unit's core assertion", async () => {
  const env = makeEnv();
  const { staffToken } = await setupRoles(env);

  const control = await call(env, STAFF_CALL.method, STAFF_CALL.path, { token: staffToken });
  assert.notEqual(control.status, 403,
    `CONTROL FAILED: staff cannot reach ${STAFF_CALL.what} either (${control.status}), so the 403s ` +
    "below would prove nothing about admin-only routes");

  for (const c of ADMIN_ONLY_CALLS) {
    const r = await call(env, c.method, c.path, { token: staffToken, body: c.body });
    assert.equal(r.status, 403,
      `${c.what}: staff got ${r.status}, expected 403 — ${JSON.stringify(r.data).slice(0, 200)}`);
  }
});

test("ADMIN is NOT refused on those same routes — so the 403 above is about the role", async () => {
  const env = makeEnv();
  const { adminToken } = await setupRoles(env);
  for (const c of ADMIN_ONLY_CALLS) {
    const r = await call(env, c.method, c.path, { token: adminToken, body: c.body });
    assert.notEqual(r.status, 403,
      `${c.what}: admin got 403 — the gate refuses the people it exists to admit`);
    assert.notEqual(r.status, 401, `${c.what}: admin got 401 — the session did not survive`);
  }
});

test("MEMBER is refused on a staff route, and staff is not — the other half of the matrix", async () => {
  const env = makeEnv();
  const { staffToken, memberToken } = await setupRoles(env);
  const asMember = await call(env, STAFF_CALL.method, STAFF_CALL.path, { token: memberToken });
  assert.equal(asMember.status, 403, `${STAFF_CALL.what} as member: expected 403, got ${asMember.status}`);
  const asStaff = await call(env, STAFF_CALL.method, STAFF_CALL.path, { token: staffToken });
  assert.notEqual(asStaff.status, 403, `${STAFF_CALL.what} as staff must be allowed (control)`);
});

test("ANONYMOUS is refused (401) on both tiers, with /api/health as the liveness control", async () => {
  const env = makeEnv();
  seedOrg(env);
  const health = await call(env, "GET", "/api/health");
  assert.equal(health.status, 200, "health must answer 200 — without it a 401 could mean the worker is down");
  const admin = await call(env, ADMIN_ONLY_CALLS[0].method, ADMIN_ONLY_CALLS[0].path);
  assert.equal(admin.status, 401, `anonymous on ${ADMIN_ONLY_CALLS[0].what}: expected 401, got ${admin.status}`);
  const staff = await call(env, STAFF_CALL.method, STAFF_CALL.path);
  assert.equal(staff.status, 401, `anonymous on ${STAFF_CALL.what}: expected 401, got ${staff.status}`);
});

test("NC-M4: promoting the staff user to admin flips every 403 — the 403s track the ROLE, not the route", async () => {
  const env = makeEnv();
  const { staffToken } = await setupRoles(env);
  for (const c of ADMIN_ONLY_CALLS) {
    const before = await call(env, c.method, c.path, { token: staffToken, body: c.body });
    assert.equal(before.status, 403, `${c.what}: expected the staff 403 before promotion`);
  }
  grantRole(env, "staffer@boomtown.test", 1, "admin"); // MUTATE REAL INPUT
  for (const c of ADMIN_ONLY_CALLS) {
    const after = await call(env, c.method, c.path, { token: staffToken, body: c.body });
    assert.notEqual(after.status, 403,
      `${c.what}: still 403 after the same user became admin — the gate is not reading the role at all`);
  }
});

/* ═══════════════════ PART 3 — the declared matrix is not decorative ═══════════════════ */

test("PERMISSIONS declares manage_users as admin-only, and the gates ENFORCE it", async () => {
  /* admin.js ships a PERMISSIONS constant the UI renders as authoritative ("so 'permissions' are
     explicit, not folklore"). Nothing connected it to a gate, so it could drift from reality
     without a single test noticing — a declaration that looks authoritative and is not wired to
     anything is the same failure class as S-1a. This asserts the one mapping that is unambiguous:
     the user/role-management routes ARE manage_users. The other capability names
     (finance_export, crm_export) map onto routes only by a judgement the owner has not made, so
     they are questions in handoff §5, not assertions here. */
  const src = blankComments(readSrc("admin.js"));
  assert.match(src, /staff:\s*\{[^}]*manage_users:\s*false/,
    "PERMISSIONS.staff.manage_users is no longer false — the declaration moved; did the gates?");
  assert.match(src, /admin:\s*\{[^}]*manage_users:\s*true/,
    "PERMISSIONS.admin.manage_users is no longer true");

  const env = makeEnv();
  const { staffToken } = await setupRoles(env);
  for (const c of ADMIN_ONLY_CALLS) {
    const r = await call(env, c.method, c.path, { token: staffToken, body: c.body });
    assert.equal(r.status, 403,
      `PERMISSIONS says staff cannot manage_users, but ${c.what} answered ${r.status} to staff. ` +
      "The declared matrix and the enforced matrix disagree — fix one of them.");
  }
});
