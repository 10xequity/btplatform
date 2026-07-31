/**
 * Boomtown Platform — schema gate tests
 * File: worker/test/schema_gate.test.mjs · Version: v1.2 · Date: 2026-07-30 · Ships in: v0.39.0 (v1.0 shipped in v0.33.0)
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

test("the real db/migrations directory parses cleanly and reports 0027", () => {
  const { highest, files, unparseable } = scanMigrations(DEFAULT_DIR);
  assert.deepEqual(unparseable, [], `unparseable migration filenames: ${unparseable.join(", ")}`);
  assert.equal(highest, 27);
  assert.ok(files >= 20, `expected at least 20 .sql files, saw ${files}`);
});
