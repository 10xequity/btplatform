/* Boomtown Platform — test-data delete-order guard
   File: worker/test/wipe_order.test.mjs · Version: v1.0 · Date: 2026-08-05 · Ships in: v0.88.0

   WHAT THIS EXISTS TO CATCH, and why 1258 tests did not catch it.

   `WIPE_SQL` deleted `brackets` before the `matches` that carry `bracket_id`. On live that is a
   hard `FOREIGN KEY constraint failed`; `D1.batch()` is one transaction, so the entire
   wipe-and-reseed rolled back and `POST /api/admin/testdata/generate` answered 500. And the rows
   that triggered it were written by `generate` ITSELF — its last step draws Winter Jam's bracket
   through the real generator. So press #1 on an empty range succeeded and every press after it
   failed, permanently, including `wipe`, which shares the list.

   TWO REASONS THE SUITE STAYED GREEN, and this file closes both:

   1. `sandbox_seed.test.mjs` calls generate ONCE, against an empty database. The defect only
      exists on the SECOND press. A fixture test that never runs twice cannot see an idempotency
      bug — the state that breaks a reseed is the state the previous reseed left behind.
   2. The in-memory D1 shim ran `PRAGMA foreign_keys = OFF` and its comment claimed that matched
      D1's default. It does not. Real D1 enforces foreign keys, so the harness was strictly more
      permissive than production on exactly the axis under test. These tests opt in with
      `{ foreignKeys: true }`.

   So there are two independent guards below, deliberately not sharing a mechanism:

   - a MECHANICAL one, which reads the foreign-key graph out of `sqlite_master` and proves the
     order is topologically valid — a hand-checked list is correct only until the next migration
     adds a key, and this one caught a real second defect while it was being written
     (`teams.pool_id`, so `teams` must precede `pools`);
   - a BEHAVIOURAL one, which presses the real button twice through the real router.

   Both ship negative controls that MUTATE THE REAL INPUT (standards §6): the real `WIPE_SQL` is
   reordered back to the shipped-broken arrangement and each guard must go red. Without that, "the
   order is valid" would pass for the boring reason that the check never fails. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { WIPE_SQL } from "../src/sandbox.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

/* ─────────────── helpers ─────────────── */

function boot({ foreignKeys = false } = {}) {
  const DB = createD1(SCHEMA, { foreignKeys });
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
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

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  const u = env.DB.one("SELECT id FROM users WHERE email = 's@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

/* v1.1: the list carries exactly ONE non-DELETE — the cycle breaker (families ↔ contacts is a
   real FK cycle, so no delete order alone can satisfy it; an UPDATE nulls contacts.family_id
   into wiped families first). tableOf returns null for it; order/completeness skip nulls, and
   the cycle edge it breaks is exempted ONLY while the UPDATE is present (NC below). */
const CYCLE_BREAKER = /^\s*UPDATE\s+contacts\s+SET\s+family_id\s*=\s*NULL/i;
const tableOf = (sql) => (sql.match(/^\s*DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/i) || [])[1] || null;

/** The foreign-key graph, read from the schema itself: child → Set(parent tables). */
function fkGraph() {
  const db = createD1(SCHEMA);
  const rows = db.query("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL");
  const graph = new Map();
  for (const { name, sql } of rows) {
    const parents = new Set();
    for (const m of String(sql).matchAll(/REFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)) {
      if (m[1].toLowerCase() !== name.toLowerCase()) parents.add(m[1]);
    }
    graph.set(name, parents);
  }
  db.close();
  return graph;
}

/** Every (parent-deleted-before-child) violation in a delete order. */
function orderViolations(list) {
  const graph = fkGraph();
  // The contacts→families edge is satisfiable ONLY by the cycle-breaking UPDATE (a genuine FK
  // cycle has no valid delete order); the edge is exempt exactly while that UPDATE is present.
  if (list.some((s) => CYCLE_BREAKER.test(s))) graph.get("contacts")?.delete("families");
  const tables = list.map(tableOf);
  const bad = [];
  for (let i = 0; i < tables.length; i++) {
    if (!tables[i]) continue;
    for (let j = i + 1; j < tables.length; j++) {
      if (!tables[j]) continue;
      // tables[j] is deleted later; if it REFERENCES tables[i], we deleted the parent first.
      if (graph.get(tables[j])?.has(tables[i])) {
        bad.push(`${tables[i]} (position ${i}) is deleted before its child ${tables[j]} (position ${j})`);
      }
    }
  }
  return bad;
}

/** The exact broken arrangement that shipped: brackets/pools/divisions ahead of their children. */
function brokenOrder() {
  const byTable = new Map(WIPE_SQL.map((s) => [tableOf(s), s]));
  const first = ["attendance", "checkins", "pools", "brackets", "division_moves", "divisions",
                 "registrations", "standings", "matches", "team_members", "teams", "events",
                 "waivers", "contacts"];
  const head = first.map((t) => byTable.get(t)).filter(Boolean);
  const rest = WIPE_SQL.filter((s) => !first.includes(tableOf(s)));
  return [...head, ...rest];
}

/* ─────────────── 1. the mechanical guard ─────────────── */

test("WIPE_SQL deletes every child before its parent (schema graph, not a hand-check)", () => {
  const bad = orderViolations(WIPE_SQL);
  assert.deepEqual(bad, [], `referential order violations:\n  ${bad.join("\n  ")}`);
});

test("NEGATIVE CONTROL: the shipped-broken order is reported as invalid", () => {
  const bad = orderViolations(brokenOrder());
  assert.ok(bad.length > 0, "the broken order must be caught, or this guard proves nothing");
  assert.ok(
    bad.some((b) => /^brackets .* before its child matches/.test(b)),
    `the live 500's exact cause must be named. got:\n  ${bad.join("\n  ")}`,
  );
});

test("every WIPE_SQL statement is a range-scoped DELETE — or the ONE named cycle breaker", () => {
  let breakers = 0;
  for (const sql of WIPE_SQL) {
    if (CYCLE_BREAKER.test(sql)) { breakers++; }
    else assert.match(sql, /^\s*DELETE\s+FROM\s/i, `not a DELETE: ${sql.slice(0, 60)}`);
    assert.match(sql, /BETWEEN 90000 AND 90999/,
      `unscoped statement would touch real data: ${sql.slice(0, 90)}`);
  }
  assert.equal(breakers, 1, "exactly one cycle-breaking UPDATE — a second non-DELETE is drift");
});

test("NC: without the cycle breaker, the contacts↔families cycle is flagged again", () => {
  const withoutBreaker = WIPE_SQL.filter((s) => !CYCLE_BREAKER.test(s));
  if (withoutBreaker.length !== WIPE_SQL.length) {
    const bad = orderViolations(withoutBreaker);
    assert.ok(bad.some((b) => /families|contacts/.test(b)),
      `dropping the UPDATE must expose the cycle. got:\n  ${bad.join("\n  ")}`);
  } else {
    // Pre-fix: no breaker in the list yet — the order test above is the red.
    assert.ok(!WIPE_SQL.some((s) => CYCLE_BREAKER.test(s)));
  }
});

test("the delete list covers the tables the seeder and its testers actually write", () => {
  const covered = new Set(WIPE_SQL.map(tableOf));
  // kotc_* and tryout_* are here because a tester using those screens on a TEST event used to
  // leave rows that blocked the next reseed. They were measured empty on live 2026-08-05, which
  // is exactly why this was cheap to fix then and would not have been later.
  for (const t of ["matches", "brackets", "pools", "teams", "divisions", "events", "contacts",
                   "registrations", "standings", "team_members", "waitlists",
                   "tryout_evaluations", "tryout_profiles", "tryout_squads", "tryout_squad_members",
                   "kotc_games", "kotc_slots", "kotc_rounds", "kotc_players", "kotc_sessions"]) {
    assert.ok(covered.has(t), `WIPE_SQL does not cover ${t}`);
  }
});

/* ─────────────── 2. the behavioural guard: press it twice ─────────────── */

test("generate is idempotent — a SECOND press succeeds with foreign keys enforced", async () => {
  const env = boot({ foreignKeys: true });
  const token = await staff(env);

  const first = await call(env, "POST", "/api/admin/testdata/generate", { token });
  assert.equal(first.status, 200, `press #1: ${JSON.stringify(first.data)}`);

  // generate's own last step draws Winter Jam's bracket, which is what used to block press #2.
  const drew = env.DB.one("SELECT COUNT(*) AS n FROM brackets WHERE event_id BETWEEN 90000 AND 90999");
  assert.ok(drew.n > 0, "press #1 must leave a bracket behind, or press #2 proves nothing");
  const linked = env.DB.one(
    "SELECT COUNT(*) AS n FROM matches WHERE bracket_id IS NOT NULL AND event_id BETWEEN 90000 AND 90999");
  assert.ok(linked.n > 0, "the bracket must have matches pointing at it — that is the constraint");

  const second = await call(env, "POST", "/api/admin/testdata/generate", { token });
  assert.equal(second.status, 200, `press #2: ${JSON.stringify(second.data)}`);
  assert.equal(second.data.replaced, true, "press #2 should report that it replaced a seed");

  // and the fixture is whole afterwards, not half-written
  const c = env.DB.one("SELECT COUNT(*) AS n FROM contacts WHERE id BETWEEN 90000 AND 90999");
  const e = env.DB.one("SELECT COUNT(*) AS n FROM events   WHERE id BETWEEN 90000 AND 90999");
  assert.equal(c.n, 48, "contacts after a reseed");
  assert.equal(e.n, 6, "events after a reseed");
});

test("wipe clears the range with foreign keys enforced, after a bracket has been drawn", async () => {
  const env = boot({ foreignKeys: true });
  const token = await staff(env);
  assert.equal((await call(env, "POST", "/api/admin/testdata/generate", { token })).status, 200);

  const wiped = await call(env, "POST", "/api/admin/testdata/wipe", { token });
  assert.equal(wiped.status, 200, `wipe: ${JSON.stringify(wiped.data)}`);
  for (const t of ["contacts", "events", "teams", "brackets"]) {
    const n = env.DB.one(
      `SELECT COUNT(*) AS n FROM ${t} WHERE ${t === "brackets" ? "event_id" : "id"} BETWEEN 90000 AND 90999`).n;
    assert.equal(n, 0, `${t} should be empty after wipe`);
  }
  // and generate works again from clean — the recovery path the owner did not have
  assert.equal((await call(env, "POST", "/api/admin/testdata/generate", { token })).status, 200);
});

test("NEGATIVE CONTROL: the shipped-broken order really does fail on live's engine", () => {
  const env = boot({ foreignKeys: true });
  // Minimum real shape: an event, a team, a bracket, and a match pointing at the bracket.
  env.DB.exec(`INSERT INTO events (id, org_id, type, name, status) VALUES (90005,1,'tournament','TEST',' published')`
    .replace("' published'", "'published'"));
  env.DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (90301,1,90005,'TEST A'),(90302,1,90005,'TEST B')");
  env.DB.exec("INSERT INTO brackets (org_id, event_id, name) VALUES (1,90005,'A')");
  const b = env.DB.one("SELECT id FROM brackets WHERE event_id = 90005");
  env.DB.exec(`INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id, bracket_id)
               VALUES (1,90005,'quarter',1,1,90301,90302,${b.id})`);

  assert.throws(
    () => { for (const sql of brokenOrder()) env.DB.exec(sql); },
    /FOREIGN KEY constraint failed/,
    "the broken order must still fail against an FK-enforcing engine",
  );

  // and the fixed order clears the same state cleanly
  const env2 = boot({ foreignKeys: true });
  env2.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (90005,1,'tournament','TEST','published')");
  env2.DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (90301,1,90005,'TEST A'),(90302,1,90005,'TEST B')");
  env2.DB.exec("INSERT INTO brackets (org_id, event_id, name) VALUES (1,90005,'A')");
  const b2 = env2.DB.one("SELECT id FROM brackets WHERE event_id = 90005");
  env2.DB.exec(`INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id, bracket_id)
                VALUES (1,90005,'quarter',1,1,90301,90302,${b2.id})`);
  for (const sql of WIPE_SQL) env2.DB.exec(sql);
  assert.equal(env2.DB.one("SELECT COUNT(*) AS n FROM matches WHERE event_id = 90005").n, 0);
  assert.equal(env2.DB.one("SELECT COUNT(*) AS n FROM brackets WHERE event_id = 90005").n, 0);
});

/* ─────────────── 3. the harness claim that hid all of this ─────────────── */

test("the D1 shim can enforce foreign keys, and does not by default", () => {
  const off = createD1(SCHEMA);
  const on = createD1(SCHEMA, { foreignKeys: true });
  assert.equal(off.one("PRAGMA foreign_keys").foreign_keys, 0);
  assert.equal(on.one("PRAGMA foreign_keys").foreign_keys, 1);
  off.close(); on.close();
});

/* ─────────────── 4. COMPLETENESS — v1.1 (2026-08-25, live wipe 500) ───────────────
   The order guard above judges only the tables IN the list — a referencing table absent from
   the list is invisible to it. That blind spot fired on live 2026-08-25: `booking_spaces`
   (33 rows, written by the FACILITY module against seeded events — not by the seeder, which is
   why the double-press test above never sees them) references `space_bookings`, so the wipe's
   batch failed `FOREIGN KEY constraint failed` and every generate/wipe press 500'd. The rule:
   any table that references a wiped table — TRANSITIVELY, since listing a new child gives that
   child's own children the same power — must itself be in WIPE_SQL, where the order guard then
   places it. */

test("COMPLETENESS: every table that (transitively) references a wiped table is itself wiped", () => {
  const graph = fkGraph();
  const listed = new Set(WIPE_SQL.map(tableOf));
  const missing = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [child, parents] of graph) {
      if (listed.has(child) || missing.has(child)) continue;
      for (const p of parents) {
        if (listed.has(p) || missing.has(p)) { missing.add(child); grew = true; break; }
      }
    }
  }
  assert.deepEqual([...missing].sort(), [],
    "these tables reference wiped tables but are never wiped — one row in any of them 500s the reseed");
});

test("NC: a list without booking_spaces is caught by the completeness check", () => {
  const shorter = WIPE_SQL.filter((s) => tableOf(s) !== "booking_spaces");
  if (shorter.length !== WIPE_SQL.length) {
    const graph = fkGraph();
    const listed = new Set(shorter.map(tableOf));
    const missing = [];
    for (const [child, parents] of graph) {
      if (!listed.has(child) && [...parents].some((p) => listed.has(p))) missing.push(child);
    }
    assert.ok(missing.includes("booking_spaces"), "removing booking_spaces must redden completeness");
  } else {
    // Pre-fix: booking_spaces is not in the list yet — the completeness test above is the red.
    assert.ok(!WIPE_SQL.some((s) => tableOf(s) === "booking_spaces"));
  }
});
