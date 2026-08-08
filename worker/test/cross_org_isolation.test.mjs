/**
 * Boomtown Platform — cross-org isolation (roadmap §-1e priority 3)
 * File: worker/test/cross_org_isolation.test.mjs · Version: v1.0 · Date: 2026-08-08 · Ships in: v0.104.0
 *
 * ── WHY THIS IS BEHAVIOURAL AND NOT A SQL SCAN, WHICH IS THE WHOLE DESIGN DECISION ──────────
 * The obvious unit for this track is "every SQL statement touching an org-scoped table must carry
 * an org_id predicate". THAT CHECK WAS WRITTEN FIRST AND THROWN AWAY, and the numbers are why:
 * across `worker/src` it accused **139 of 542** statements, and reading them showed the great
 * majority are correct — `UPDATE contacts SET … WHERE id=?` is safe precisely because the id was
 * already validated against `ctx.orgId` upstream (`admin.js:197-198` is the canonical pattern:
 * fetch the row, compare `row.org_id !== ctx.orgId`, 404). The predicate lives one statement
 * earlier, in another function, so the scan cannot see it.
 *
 * A 139-entry ratchet is not a guard, it is a wall — and the one real defect would be invisible
 * inside it. **Ask what unit the check counts, then ask what a single real defect does to that
 * number.** For the SQL scan the answer was "nothing distinguishable". So the unit under test here
 * is not a statement, it is **REACHABILITY: can a caller holding a role in org 2 read or mutate
 * org 1's rows by id?** That is the question the owner's data actually turns on, it is asserted at
 * CALL SITES through the real router, and no amount of SQL-text cleverness can fake it.
 *
 * ── EVERY PROBE HAS A POSITIVE CONTROL, AND WITHOUT IT THIS FILE WOULD BE WORTHLESS ─────────
 * A 404 from correct isolation and a 404 from a mistyped URL are byte-identical. So each route is
 * exercised TWICE: once against the attacker's OWN org (must not 404 — proves the route exists,
 * the session works, and the role is sufficient) and once against the victim org's id (must not
 * return victim data). A probe whose control fails is reported as a broken probe, not a pass.
 *
 * ── MUTATIONS ARE CHECKED IN THE DATABASE, NOT IN THE STATUS CODE ───────────────────────────
 * A handler may answer 200 while silently updating nothing, which is fine, or 200 while writing to
 * another org's row, which is a breach — and the two are indistinguishable from the response. Every
 * mutating probe re-reads the victim row from D1 afterwards and asserts it is byte-unchanged.
 *
 * ── THE TRAP THAT WOULD MAKE ALL OF THIS VACUOUS ────────────────────────────────────────────
 * The FIRST-EVER user is bootstrapped admin of ALL active orgs (`index.js` verifyLink, F-12).
 * An attacker signed in before that bootstrap is burned is an admin of the victim org too, and
 * every probe below would pass while proving the opposite of what it claims. `burnBootstrap` spends
 * it on a throwaway account. `attackerHasNoRoleInVictimOrg` asserts the premise directly rather
 * than trusting the setup — the fixture is not allowed to vouch for itself.
 *
 * ── SCOPE, STATED PLAINLY BECAUSE A CHECK THAT REPORTS CLEAN MUST SAY WHAT IT DID NOT COVER ──
 * There are **80 id-taking `/api/admin/*` routes**. This file probes **five**, chosen for distinct
 * modules AND distinct tables, including one from the event-keyed family that most modules use:
 *   admin.js/contacts · announcements.js/announcements · faq.js/faqs ·
 *   member_fields.js/member_fields · divisions.js/(events-keyed)
 * The other 75 are NOT covered and this file must not be read as clearing them. Widening the
 * PROBES table below is the cheapest possible follow-up — it is one row per route.
 * Not covered either: the org-scoping of every internal read (§-1c D-8, `refreshStandings`, is a
 * known latent instance reachable only through an already-org-gated route).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

const VICTIM = 1; // org holding the data an attacker must never reach
const ATTACK = 2; // the only org the attacker holds a role in

const makeEnv = () => ({
  DB: createD1(SCHEMA),
  APP_URL: ORIGIN,
  SITE_ORIGIN: ORIGIN,
  API_ORIGIN: "https://api.boomtown.test",
  ALLOWED_ORIGINS: ORIGIN,
});

async function call(env, method, path, { body, token, orgId } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(orgId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.boomtown.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 300) }; }
  return { status: res.status, data };
}

async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email }, orgId: ATTACK });
  assert.equal(asked.status, 200, `request-link for ${email}`);
  const token = String(asked.data.dev_link).split("token=")[1];
  assert.ok(token, `no token in dev_link for ${email}`);
  const ok = await call(env, "POST", "/api/auth/verify", { body: { token }, orgId: ATTACK });
  assert.equal(ok.status, 200, `verify for ${email}`);
  return ok.data.token;
}

/* Identical rows in BOTH orgs at known ids. The attacker's own copy is the positive control;
   the victim's copy is the target. Ids are explicit so a probe can never accidentally address
   the wrong org's row. */
function seedBothOrgs(env) {
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (${VICTIM}, 'Victim Org', 'victim', 1);
    INSERT INTO orgs (id, name, slug, active) VALUES (${ATTACK}, 'Attacker Org', 'attacker', 1);

    INSERT INTO contacts (id, org_id, full_name, email) VALUES (10, ${VICTIM}, 'Victim Member', 'vm@victim.test');
    INSERT INTO contacts (id, org_id, full_name, email) VALUES (20, ${ATTACK}, 'Attacker Member', 'am@attacker.test');

    INSERT INTO events (id, org_id, type, name, status, starts_at)
      VALUES (11, ${VICTIM}, 'tournament', 'Victim Open', 'published', datetime('now','+7 days'));
    INSERT INTO events (id, org_id, type, name, status, starts_at)
      VALUES (21, ${ATTACK}, 'tournament', 'Attacker Open', 'published', datetime('now','+7 days'));

    INSERT INTO announcements (id, org_id, kind, title) VALUES (12, ${VICTIM}, 'news', 'Victim Notice');
    INSERT INTO announcements (id, org_id, kind, title) VALUES (22, ${ATTACK}, 'news', 'Attacker Notice');

    INSERT INTO faqs (id, org_id, question, answer) VALUES (13, ${VICTIM}, 'Victim Q', 'Victim A');
    INSERT INTO faqs (id, org_id, question, answer) VALUES (23, ${ATTACK}, 'Attacker Q', 'Attacker A');

    INSERT INTO member_fields (id, org_id, field_key, label) VALUES (14, ${VICTIM}, 'vkey', 'Victim Field');
    INSERT INTO member_fields (id, org_id, field_key, label) VALUES (24, ${ATTACK}, 'akey', 'Attacker Field');

    -- The READ probe needs something that can actually leak. NC-X3 caught this: with the event
    -- seeded but no divisions under it, GET …/divisions answered {divisions: []} and the probe
    -- would have passed even against a handler that ignored org_id entirely. An empty response
    -- cannot distinguish "isolated" from "nothing there".
    INSERT INTO divisions (id, org_id, event_id, name) VALUES (15, ${VICTIM}, 11, 'Victim Division');
    INSERT INTO divisions (id, org_id, event_id, name) VALUES (25, ${ATTACK}, 21, 'Attacker Division');
  `);
}

function grantRole(env, email, orgId, role) {
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", email);
  assert.ok(u, `no user row for ${email}`);
  env.DB.exec(
    `INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, ${orgId}, '${role}')
     ON CONFLICT (user_id, org_id) DO UPDATE SET role='${role}', deleted_at=NULL`
  );
}

const ATTACKER = "attacker@attacker.test";

async function setup() {
  const env = makeEnv();
  seedBothOrgs(env);
  await signIn(env, "bootstrap-burn@boomtown.test"); // F-12: burn the all-orgs bootstrap FIRST
  const token = await signIn(env, ATTACKER);
  grantRole(env, ATTACKER, ATTACK, "admin");         // admin of the ATTACK org ONLY
  return { env, token };
}

/* Each probe: a route shape, the victim's id, the attacker's own id (positive control), and —
   for mutations — the table/column whose victim value must survive untouched. */
const PROBES = [
  { what: "PATCH /api/admin/members/:id", method: "PATCH",
    path: (id) => `/api/admin/members/${id}`, victimId: 10, ownId: 20,
    body: { full_name: "PWNED" },
    table: "contacts", col: "full_name", victimValue: "Victim Member" },

  { what: "PUT /api/admin/announcements/:id", method: "PUT",
    path: (id) => `/api/admin/announcements/${id}`, victimId: 12, ownId: 22,
    body: { title: "PWNED" },
    table: "announcements", col: "title", victimValue: "Victim Notice" },

  { what: "PUT /api/admin/faqs/:id", method: "PUT",
    path: (id) => `/api/admin/faqs/${id}`, victimId: 13, ownId: 23,
    body: { answer: "PWNED" },
    table: "faqs", col: "answer", victimValue: "Victim A" },

  { what: "PATCH /api/admin/member-fields/:id", method: "PATCH",
    path: (id) => `/api/admin/member-fields/${id}`, victimId: 14, ownId: 24,
    body: { label: "PWNED" },
    table: "member_fields", col: "label", victimValue: "Victim Field" },

  { what: "GET /api/admin/events/:id/divisions", method: "GET",
    path: (id) => `/api/admin/events/${id}/divisions`, victimId: 11, ownId: 21,
    body: undefined, table: null, col: null, victimValue: null },
];

test("the fixture's premise holds: the attacker has NO role in the victim org", async () => {
  // The setup is not allowed to vouch for itself. If F-12's bootstrap ever leaked a role here,
  // every probe below would pass while proving the opposite of what it claims.
  const { env } = await setup();
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", ATTACKER);
  const rows = env.DB.query("SELECT org_id, role FROM user_org_roles WHERE user_id = ?1 AND deleted_at IS NULL", u.id);
  assert.deepEqual(rows.map((r) => r.org_id), [ATTACK],
    `the attacker holds roles in ${JSON.stringify(rows)} — it must be org ${ATTACK} and nothing else`);
});

test("every probe's POSITIVE CONTROL works — the routes exist and the attacker can use its own org", async () => {
  const { env, token } = await setup();
  const broken = [];
  for (const p of PROBES) {
    const r = await call(env, p.method, p.path(p.ownId), { token, body: p.body, orgId: ATTACK });
    if (r.status === 404 || r.status === 401 || r.status === 403) {
      broken.push(`${p.what}: own-org call returned ${r.status} — ${JSON.stringify(r.data).slice(0, 140)}`);
    }
  }
  assert.deepEqual(broken, [],
    "a probe cannot distinguish isolation from a broken request. Fix the probe before trusting any " +
    "result below it — an uncontrolled 404 is exactly how a check reports clean while testing nothing.");
});

test("a caller with a role in ONE org cannot reach another org's rows by id (§-1e priority 3)", async () => {
  const { env, token } = await setup();
  const leaks = [];

  for (const p of PROBES) {
    const r = await call(env, p.method, p.path(p.victimId), { token, body: p.body, orgId: ATTACK });

    // 200 is not automatically a breach — a handler may answer 200 having matched nothing. What is
    // never acceptable is the victim's DATA coming back, or the victim's ROW changing.
    if (r.status === 200 && p.method === "GET") {
      const blob = JSON.stringify(r.data);
      if (/Victim/.test(blob)) leaks.push(`${p.what}: victim data in a 200 response — ${blob.slice(0, 160)}`);
    }

    if (p.table) {
      const row = env.DB.one(`SELECT ${p.col} AS v FROM ${p.table} WHERE id = ?1`, p.victimId);
      assert.ok(row, `${p.what}: the victim row vanished entirely — that is worse than a read`);
      if (row.v !== p.victimValue) {
        leaks.push(`${p.what}: MUTATED another org's row — ${p.table}.${p.col} is now ${JSON.stringify(row.v)} ` +
                   `(status was ${r.status}, so the response alone would not have shown this)`);
      }
    }
  }

  assert.deepEqual(leaks, [],
    "cross-org reachability: a caller holding a role only in org " + ATTACK + " reached org " + VICTIM + "'s data.");
});

/* ---------- negative controls: each MUTATES THE REAL INPUT ---------- */

test("NC-X1: granting the attacker a role in the victim org flips the probes — they track the ROLE", async () => {
  const { env, token } = await setup();
  // Prove the refusals above are about org membership and not about the requests being malformed:
  // the SAME calls must start landing once the role exists. This is the mutation that makes the
  // main test non-vacuous.
  const before = await call(env, "GET", `/api/admin/events/11/divisions`, { token, orgId: VICTIM });
  assert.ok(before.status === 403 || before.status === 401,
    `expected a refusal on the victim org before the grant, got ${before.status}`);

  grantRole(env, ATTACKER, VICTIM, "admin"); // MUTATE REAL INPUT
  const after = await call(env, "GET", `/api/admin/events/11/divisions`, { token, orgId: VICTIM });
  assert.notEqual(after.status, 403,
    "still refused after the role was granted — the gate is not reading org membership at all");
});

test("NC-X3: the LEAK DETECTOR is not blind — it reports both a data leak and a mutation when access is real", async () => {
  /* THE CONTROL THIS FILE MOST NEEDED, AND THE REASON THE GREEN ABOVE IS WORTH ANYTHING.
     Every other test here asserts an EMPTY list. A detector that can never produce a non-empty
     list would satisfy all of them forever while testing nothing — the exact failure this track
     was opened to kill. So: give the attacker a genuine role in the victim org, run the identical
     probe logic, and require it to find BOTH failure kinds it claims to detect.
     This does not prove isolation is enforced (the grant makes the access legitimate). It proves
     the instrument works. Those are different claims and only one of them is in doubt here. */
  const { env, token } = await setup();
  grantRole(env, ATTACKER, VICTIM, "admin"); // MUTATE REAL INPUT — access is now legitimate

  const found = [];
  for (const p of PROBES) {
    const r = await call(env, p.method, p.path(p.victimId), { token, body: p.body, orgId: VICTIM });
    if (r.status === 200 && p.method === "GET" && /Victim/.test(JSON.stringify(r.data))) {
      found.push(`data:${p.what}`);
    }
    if (p.table) {
      const row = env.DB.one(`SELECT ${p.col} AS v FROM ${p.table} WHERE id = ?1`, p.victimId);
      if (row && row.v !== p.victimValue) found.push(`mutation:${p.what}`);
    }
  }

  assert.ok(found.some((f) => f.startsWith("mutation:")),
    "the detector never observed a MUTATION even with a legitimate role — the re-read is not " +
    `working, so the main test's 'row unchanged' assertion proves nothing. Saw: ${JSON.stringify(found)}`);
  assert.ok(found.some((f) => f.startsWith("data:")),
    "the detector never observed victim DATA in a 200 even with a legitimate role — the response " +
    `inspection is not working. Saw: ${JSON.stringify(found)}`);
});

/* ═══════════ §-1c D-8 — refreshStandings, closed in this release ═══════════ */

test("D-8: refreshStandings counts only THIS org's matches and teams", async () => {
  /* The defect: both reads were scoped by event_id alone while the write pinned org_id, so the
     function relied on its callers having already proved the event belongs to the org.
     The test plants the row that distinguishes the two versions — a match and a team carrying the
     victim's event_id but ANOTHER org's org_id. Before the fix both were counted; after, neither.
     The planted row IS the negative control: it mutates real input, and if the predicate were
     removed the assertion below fails immediately. */
  const env = makeEnv();
  seedBothOrgs(env);
  env.DB.exec(`
    INSERT INTO teams (id, org_id, event_id, name) VALUES (101, ${VICTIM}, 11, 'V-A');
    INSERT INTO teams (id, org_id, event_id, name) VALUES (102, ${VICTIM}, 11, 'V-B');
    INSERT INTO teams (id, org_id, event_id, name) VALUES (201, ${ATTACK}, 11, 'FOREIGN');
    INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, score_a, score_b)
      VALUES (301, ${VICTIM}, 11, 'pool', 1, 1, 101, 102, 21, 15);
    INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, score_a, score_b)
      VALUES (302, ${ATTACK}, 11, 'pool', 1, 2, 201, 101, 21, 10);
  `);

  const { refreshStandings } = await import("../src/tournaments.js");
  await refreshStandings(env, 11, VICTIM);

  const standings = env.DB.query("SELECT team_id FROM standings WHERE event_id = ?1", 11);
  const ids = standings.map((s) => s.team_id).sort((a, b) => a - b);

  // CONTROL FIRST: if this org's own teams are missing, the assertion below would pass for the
  // worst possible reason — the function reading nothing at all.
  assert.ok(ids.includes(101) && ids.includes(102),
    `this org's own teams must appear in standings; got ${JSON.stringify(ids)}`);
  assert.ok(!ids.includes(201),
    `a team belonging to org ${ATTACK} was ranked in org ${VICTIM}'s standings — the reads are not ` +
    `org-scoped. Got ${JSON.stringify(ids)}`);
});

/* ═══════════ §-1c D-11 — the played segment filter's events JOIN ═══════════ */

test("D-11: the played segment filter pins the org on its events JOIN, and consumes no new bind", async () => {
  const { buildSegmentWhere } = await import("../src/marketing.js");
  const { where, binds } = buildSegmentWhere({ played: "league" });

  assert.match(where, /e\.org_id = \?1/,
    "the events JOIN does not pin the org — a contact of this org whose registration points at a " +
    "foreign event is miscounted");
  // The bind list is the whole reason this fix was free: ?1 is NUMBERED and reused, so it takes no
  // slot. If this ever grows, every caller's .bind(orgId, ...binds) silently misaligns.
  assert.deepEqual(binds, ["league"],
    "the org pin consumed a bind — ?1 must be reused, not appended");
  assert.match(where, /e\.type = \?/, "the type predicate must survive the change");
});

test("NC-X2: a probe pointed at a NON-EXISTENT id must not be mistaken for isolation", async () => {
  const { env, token } = await setup();
  // The failure mode this file is designed against: 404-because-absent reading as 404-because-denied.
  // 999 belongs to nobody, so a 404 here is meaningless — and the assertion is that our OWN-org
  // control would also 404, which is precisely why the control test above is not optional.
  const ghost = await call(env, "PATCH", "/api/admin/members/999", { token, body: { full_name: "x" }, orgId: ATTACK });
  assert.ok(ghost.status >= 400,
    "a non-existent id answered success — then a 'not found' tells us nothing about isolation");
});
