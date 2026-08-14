/**
 * Boomtown Platform — schema gate tests
 * File: worker/test/schema_gate.test.mjs · Version: v1.7 · Date: 2026-08-02 · Ships in: v0.50.0 (v1.0 shipped in v0.33.0)
 *
 * v1.7: directory ratchet 32 → 33 (migration 0033, R3 announcements + mutes + sub availability).
 *
 * v1.6: directory ratchet 30 → 31 (migration 0031, LFG & community play). The file for 0031
 *       was reconstructed from live D1 — it was applied 2026-08-01 but its release ZIP was
 *       never uploaded; this bump lands in the same package as the file (standards §3).
 *
 * v1.6: directory ratchet 31 → 32 (migration 0032, org reconciliation — D-ORG-5..9).
 * v1.5: directory ratchet 29 → 30 (migration 0030, Marketing SMS scope C — req #17).
 *
 * v1.4: directory ratchet 28 → 29 (migration 0029, SMS — req #17 phase 3). Shipped as a
 *       corrective: the v0.42.0 ZIP carried migration 0029 without this bump — the ratchet
 *       fired exactly as designed and CI blocked the deploy.
 *
 * v1.3: directory ratchet 27 → 28 (migration 0028, FAQ — req #21 phase 1).
 *
 * v1.2: directory ratchet 26 → 27 (migration 0027, kiosk check-in).
 * v1.1: directory ratchet 25 → 26 (migration 0026, sub finder). The ratchet is deliberate:
 * adding a migration MUST break this test until the same release bumps it — proof the release
 * author knows a schema change is in flight and has applied it to live D1 before deploy.
 *
 * The gate's whole value is that it says NO. So most of these assert a BLOCK, and the one that
 * matters most is `repo 0025 / D1 24` — the exact state that let run #31 deploy v0.32.0 against
 * a 24-migration schema on 2026-07-27.
 *
 * The filename cases are not hypothetical. db/migrations/ carries two live conventions and
 * `parseInt("2026-07-21_0001-foundation_v0.1.sql")` is 2026, not 1.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { migrationNumber, isNonMigration, gateDecision, scanMigrations, pad, DEFAULT_DIR }
  from "../scripts/schema-gate.mjs";

/* ---------------------- filename parsing ---------------------- */

test("migrationNumber reads the bare convention", () => {
  assert.equal(migrationNumber("0025_guardian_invite.sql"), 25);
  assert.equal(migrationNumber("0003_admin_schedule.sql"), 3);
  assert.equal(migrationNumber("0026_something.sql"), 26);
});

test("migrationNumber reads the date-prefixed convention and does NOT return the year", () => {
  assert.equal(migrationNumber("2026-07-21_0001-foundation_v0.1.sql"), 1);
  assert.equal(migrationNumber("2026-07-24_0008_facility_v1_0.sql"), 8);
  assert.equal(migrationNumber("2026-07-26_0024_uploads-and-reg-price_v1_0.sql"), 24);
  // The trap, stated as an assertion so it can never regress.
  assert.notEqual(migrationNumber("2026-07-21_0001-foundation_v0.1.sql"), 2026);
});

test("migrationNumber returns null for anything it does not recognise", () => {
  assert.equal(migrationNumber("25_short.sql"), null);   // not 4 digits
  assert.equal(migrationNumber("0025.sql"), null);       // no separator
  assert.equal(migrationNumber("notes.md"), null);       // not .sql
  assert.equal(migrationNumber("README.sql"), null);     // no number
});

test("a dated NON-migration must not be read as migration 2026 — the deploy-blocking bug", () => {
  // /^(\d{4})[-_]/ matched the YEAR of a rollback filename and returned 2026, which would have
  // made the repo look like it were at migration 2026 and blocked every deploy forever. The
  // rollback SQL genuinely lives in db/migrations/, so this is not hypothetical.
  const rollback = "2026-07-27_rollback-0025_v1_0.sql";
  assert.equal(migrationNumber(rollback), null);
  assert.notEqual(migrationNumber(rollback), 2026);
  assert.equal(isNonMigration(rollback), true);
});

test("recognised non-migrations are SKIPPED, unknown files are still BLOCKED", () => {
  assert.equal(isNonMigration("2026-07-27_rollback-0025_v1_0.sql"), true);
  assert.equal(isNonMigration("rollback_0021.sql"), true);
  assert.equal(isNonMigration("mystery.sql"), false);
  assert.equal(isNonMigration("0025_guardian_invite.sql"), false);
});

/* ---------------------- the break this exists to stop ---------------------- */

test("BLOCKS the exact 2026-07-27 state: repo 0025, D1 applied 24", () => {
  const d = gateDecision(25, "24");
  assert.equal(d.pass, false);
  assert.equal(d.code, 1);
  assert.match(d.reason, /0025/);
  assert.match(d.reason, /0024/);
});

test("PASSES when repo and D1 agree at 25", () => {
  const d = gateDecision(25, "25");
  assert.equal(d.pass, true);
  assert.equal(d.code, 0);
});

test("PASSES when D1 is ahead — applied migrations are pruned from the repo", () => {
  const d = gateDecision(24, "25");
  assert.equal(d.pass, true);
  assert.match(d.reason, /ahead of the repo/);
});

test("BLOCKS a gap of more than one", () => {
  assert.equal(gateDecision(30, "24").pass, false);
});

/* ---------------------- fail closed ---------------------- */

test("BLOCKS when --applied is absent — an unreadable D1 is not a passing D1", () => {
  for (const bad of [undefined, null, "", "   "]) {
    const d = gateDecision(25, bad);
    assert.equal(d.pass, false, `expected block for ${JSON.stringify(bad)}`);
    assert.match(d.reason, /not a whole number/);
  }
});

test("BLOCKS when --applied is not a whole number", () => {
  for (const bad of ["abc", "1.5", "-2", "NaN", "0x19", "25abc", "2 5"]) {
    assert.equal(gateDecision(25, bad).pass, false, `expected block for ${bad}`);
  }
});

test("BLOCKS on an unparseable filename rather than skipping it", () => {
  const d = gateDecision(25, "25", ["0026_weird_convention.SQL.bak"]);
  assert.equal(d.pass, false);
  assert.match(d.reason, /Cannot parse/);
});

test("BLOCKS when the migration directory yielded nothing", () => {
  const d = gateDecision(-1, "25");
  assert.equal(d.pass, false);
  assert.match(d.reason, /No migrations found/);
});

test("an unparseable filename blocks even when the numbers would otherwise pass", () => {
  // Ordering matters: the parse failure must win over a numerically fine comparison,
  // because the unreadable file could itself be a newer migration.
  const d = gateDecision(25, "25", ["mystery.sql"]);
  assert.equal(d.pass, false);
});

/* ---------------------- helpers and the real directory ---------------------- */

test("pad produces the 4-digit form used in filenames and the ledger", () => {
  assert.equal(pad(1), "0001");
  assert.equal(pad(25), "0025");
  assert.equal(pad(2026), "2026");
});

test("the real db/migrations directory parses cleanly and reports 0049", () => {
  // This number is a deliberate ratchet, not a nuisance: it reddens on every new migration and
  // makes whoever added one confirm the scanner still reads the whole directory. Bump it in the
  // same commit as the migration, AFTER the ledger row exists in live D1 (v0.60.0 → 0036;
  // v0.66.0 → 0037; v0.69.0 → 0038; v0.70.0 → 0039; v0.76.0 → 0040; v0.78.0 → 0041; v0.80.0 → 0042;
  // v0.107.0 → 0043 — in every case the
  // ledger row was read back from live D1 before this line moved. It earned its keep twice on
  // 2026-08-03: the KOTC migration and then the bracket-locks one each landed in the tree, the next
  // full run went red here, and the number moved only after `SELECT MAX(version) FROM
  // schema_migrations` came back with it. It earned it a third time on 2026-08-08: migration 0043
  // (sessions.acting_role) went in, this line went red on the next full run, and it moved only
  // after live D1 answered MAX(id)=43, COUNT(*)=43, MAX(version)='0043' and sqlite_master showed
  // the column present on `sessions`. Fourth time 2026-08-10: migration 0044 (orgs.modules_off_json,
  // P-1) — moved only after live D1 answered MAX(id)=44, COUNT(*)=44, MAX(version)='0044' and
  // pragma_table_info('orgs') showed the column, with every row NULL: default-ON, deploy changes
  // no screen. FIFTH time 2026-08-13: migration 0045 (teams.team_no, K-1 tier 2 / §-0 B5) — it
  // reddened here on the run straight after the file landed, and moved only once live D1 answered
  // MAX(id)=45, COUNT(*)=45, MAX(version)='0045', pragma_table_info('teams') showed the column,
  // and `COUNT(*) WHERE team_no IS NOT NULL` came back 0 of 70: every team keeps the number it
  // already displayed until a director saves a board. SIXTH time 2026-08-13: migration 0046
  // (events.external_url + events.external_label, PM-1 / §-0 B6) — two ALTERs in one migration,
  // reddened here on the next run, and moved only once live D1 answered MAX(id)=46, COUNT(*)=46,
  // MAX(version)='0046', pragma_table_info('events') showed BOTH columns, and the non-NULL count
  // came back 0 of 7: no event points anywhere else until an operator says so. SEVENTH time
  // 2026-08-13: migration 0047 (events.square_item_id + events.square_variation_id, K-15 / §-0
  // B22) — moved only once live D1 answered MAX(id)=47, COUNT(*)=47, MAX(version)='0047',
  // pragma_table_info('events') showed both columns, and the non-NULL count came back 0 of 7:
  // no event has a Square catalog item until its next pricing action creates one. EIGHTH time
  // 2026-08-14: migration 0048 (webauthn_credentials.uv_required, S-4a / §-0 B12) — moved only
  // once live D1 answered MAX(id)=48, COUNT(*)=48, MAX(version)='0048', pragma_table_info showed
  // the column, and the ratcheted count came back 0 of 1: no login behaviour changes until a
  // credential demonstrates Face ID/PIN once. NINTH time 2026-08-14: migration 0049
  // (events.min_signups, SG-2 / §-1o) — moved only once live D1 answered MAX(id)=49,
  // COUNT(*)=49, MAX(version)='0049', pragma_table_info('events') showed the column, and the
  // non-NULL count came back 0 of 7: no event has a minimum until an operator types one, so the
  // deploy changes no screen.)
  const { highest, files, unparseable } = scanMigrations(DEFAULT_DIR);
  assert.deepEqual(unparseable, [], `unparseable migration filenames: ${unparseable.join(", ")}`);
  assert.equal(highest, 49);
  assert.ok(files >= 20, `expected at least 20 .sql files, saw ${files}`);
});

/* ══════════ THE HARNESS SCHEMA MUST COVER EVERY TABLE THE MIGRATIONS CREATE ══════════
   Added v0.81.0, after `journey-schema.sql` was found carrying 46 of live D1's 97 tables while its own
   header claimed to be "the real production schema, read verbatim from live".

   HOW THAT SURVIVED 1127 PASSING TESTS is the part that matters. Every test needing one of the missing
   tables built its own fixture by hand, so it passed. Every test not needing one never asked. NOTHING
   compared the file against the thing it claims to mirror — so the gap was not a failing test, it was
   the ABSENCE of a test, and absences never go red.

   The cost: 29 endpoints across 16 admin pages returned 500 in a harness that reported itself healthy.
   A page whose first fetch 500s stops rendering, which is exactly what "the screens all terminate"
   describes. With the schema complete, all 29 return 2xx and nothing else changed.

   This guard reads the MIGRATIONS rather than live D1, deliberately: it must run offline and in CI
   without a D1 token, and the migrations are the definition of what live is supposed to contain. */

test("journey-schema.sql contains every table the migrations create", () => {
  const migDir = new URL("../../db/migrations/", import.meta.url);
  const created = new Map();          // table -> migration that created it
  /* COMMENTS ARE STRIPPED FIRST, and the first draft of this guard did not do that — it read the line
     "-- Full CREATE TABLE statements are documented below." in the foundation migration and reported a
     table called `statements` that has never existed. A guard that scans prose as if it were code
     reports defects nobody can fix, and the cure for that is people stopping trusting the guard. */
  const stripComments = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = stripComments(readFileSync(new URL(f, migDir), "utf8"));
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?/gi)) {
      if (!created.has(m[1])) created.set(m[1], f);
    }
  }
  const schema = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
  const inHarness = new Set(
    [...schema.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?/gi)].map((m) => m[1]));

  assert.ok(created.size >= 40, `expected the migrations to create 40+ tables, found ${created.size}`);
  const missing = [...created.keys()].filter((t) => !inHarness.has(t)).sort();
  assert.deepEqual(missing, [],
    "these tables exist in db/migrations but NOT in the test harness schema, so every endpoint that " +
    "touches them returns 500 in tests while looking healthy:\n  " +
    missing.map((t) => `${t} (${created.get(t)})`).join("\n  "));
});

test("NC: that coverage check can fail — a table removed from the harness is caught", () => {
  // The assertion above is `deepEqual(missing, [])`, which is also what a check reading the wrong
  // directory returns. So a real table is removed from a copy of the schema and must be reported.
  const schema = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
  assert.match(schema, /CREATE TABLE (?:IF NOT EXISTS )?announcements\b/i, "precondition: the table is there");

  const mutated = schema.replace(/CREATE TABLE (?:IF NOT EXISTS )?announcements\b/i, "CREATE TABLE zzz_gone");
  assert.notEqual(mutated, schema, "the mutation must land, or this control proves nothing");
  const inMutated = new Set(
    [...mutated.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?[`"']?([A-Za-z_][A-Za-z0-9_]*)[`"']?/gi)].map((m) => m[1]));
  assert.ok(!inMutated.has("announcements"), "a removed table must be detectable as missing");
  assert.ok(inMutated.has("campaigns"), "and its neighbours must be unaffected");
});
