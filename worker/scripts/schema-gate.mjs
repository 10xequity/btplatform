/**
 * Boomtown Platform — Pre-deploy schema gate
 * File: worker/scripts/schema-gate.mjs · Version: v1.0 · Date: 2026-07-27 · Ships in: v0.33.0
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-07-27 Deploy Worker run #31 went green and shipped v0.32.0 against a schema that
 * was missing migration 0025. `contacts.activation_state` and the four
 * `guardianships.certified_*` columns did not exist, so every youth registration returned a
 * 500 at registrations.js:163. Step 3 of the install was automatic; step 2 — run the
 * migration — was manual. Prose cannot enforce ordering against a `push:` trigger.
 *
 * This gate refuses to deploy when the repo carries a migration that live D1 has not applied.
 *
 * CONTRACT
 * --------
 *   node worker/scripts/schema-gate.mjs --applied <N> [--dir <path>]
 *
 *   exit 0  repo highest <= applied           → PASS, deploy may proceed
 *   exit 1  repo highest >  applied           → BLOCKED, code is ahead of schema
 *   exit 1  --applied missing or unparseable  → BLOCKED, fails closed
 *   exit 1  migration dir missing or empty    → BLOCKED, fails closed
 *   exit 1  any filename it cannot parse      → BLOCKED, fails closed
 *
 * FAIL CLOSED IS THE WHOLE POINT. A gate that assumes the schema is fine when it cannot
 * read D1 is library_v1_0 §2 failure class 3 — a guard narrower than the thing it guards,
 * which is worse than no guard because it reports clean. If this script cannot prove the
 * schema is current, it says no.
 *
 * THE FILENAME TRAP
 * -----------------
 * `db/migrations/` carries TWO naming conventions, both live:
 *     0025_guardian_invite.sql                  bare number prefix
 *     2026-07-21_0001-foundation_v0.1.sql       date prefix, number second
 * `parseInt(basename)` returns 2026 for the second form. A gate that did that would compute
 * a repo maximum of 2026, compare it against 25, and block every deploy forever. It would
 * fail closed, which is safe, but permanently and for the wrong reason.
 *
 * So an UNPARSEABLE filename is a BLOCK, not a skip. Silently ignoring a file we do not
 * understand is how code ships ahead of schema. If a third convention appears, this script
 * stops the deploy and tells you to teach it the new pattern.
 *
 * Note: db/migrations/ holds 20 files while D1 reports 25 applied. Migrations 0004–0007 and
 * 0011 were deleted from the repo (library_v1_0 §3) — `schema_migrations` is the record, not
 * the directory. That is why this compares MAXIMA and never counts files.
 */

import { readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, derived from this file's own location so the script is CWD-independent. */
const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIR = resolve(HERE, "..", "..", "db", "migrations");

/**
 * Pull the migration number out of a filename. Handles both live conventions and nothing else.
 * Returns null when the name does not match — the caller treats null as a block.
 *
 * @param {string} name basename, e.g. "2026-07-24_0008_facility_v1_0.sql"
 * @returns {number|null}
 */
export function migrationNumber(name) {
  if (!/\.sql$/i.test(name)) return null;

  // Date-prefixed: YYYY-MM-DD_NNNN followed by - or _
  const dated = /^\d{4}-\d{2}-\d{2}_(\d{4})[-_]/.exec(name);
  if (dated) return Number(dated[1]);

  // A name that opens with a date but did NOT match above is a dated artefact that is not a
  // numbered migration — the rollback files. It must NOT fall through to the bare branch:
  // `2026-07-27_rollback-0025_v1_0.sql` would match /^(\d{4})[-_]/ and yield 2026, making the
  // repo look like it were at migration 2026 and blocking every deploy forever. Caught by
  // schema_gate.test.mjs before it ever ran in CI.
  if (/^\d{4}-\d{2}-\d{2}_/.test(name)) return null;

  // Bare: NNNN_ only. No real migration uses NNNN-, and allowing the dash is what let a
  // four-digit year through above.
  const bare = /^(\d{4})_/.exec(name);
  if (bare) return Number(bare[1]);

  return null;
}

/**
 * Files that legitimately live in db/migrations/ without being numbered migrations.
 * Rollbacks are kept next to the migration they reverse, by convention. These are skipped,
 * not blocked — but anything NOT on this list and not parseable is still a block, because a
 * file we do not recognise could be a migration we are about to deploy past.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isNonMigration(name) {
  return /(^|[_-])rollback([_-]|\.)/i.test(name);
}

/**
 * Highest migration number in a directory.
 * @param {string} dir
 * @returns {{ highest: number, files: number, unparseable: string[] }}
 */
export function scanMigrations(dir) {
  const names = readdirSync(dir).filter((n) => /\.sql$/i.test(n));
  const unparseable = [];
  const skipped = [];
  let highest = -1;

  for (const n of names) {
    const num = migrationNumber(n);
    if (num !== null) {
      if (num > highest) highest = num;
      continue;
    }
    if (isNonMigration(n)) { skipped.push(n); continue; }
    unparseable.push(n);
  }
  return { highest, files: names.length, unparseable, skipped };
}

/**
 * Pure decision function — no filesystem, no process, unit-tested directly.
 *
 * @param {number} repoHighest  highest migration number present in db/migrations/
 * @param {unknown} appliedRaw  the --applied value, exactly as received from the workflow
 * @param {string[]} unparseable filenames the scanner could not read
 * @returns {{ pass: boolean, code: number, reason: string }}
 */
export function gateDecision(repoHighest, appliedRaw, unparseable = []) {
  if (unparseable.length) {
    return {
      pass: false, code: 1,
      reason:
        `Cannot parse ${unparseable.length} migration filename(s): ${unparseable.join(", ")}. ` +
        `Expected 0000_name.sql or YYYY-MM-DD_0000_name.sql. Refusing to guess — a migration ` +
        `this gate cannot see is a migration it cannot enforce.`,
    };
  }

  if (repoHighest < 0) {
    return { pass: false, code: 1, reason: "No migrations found. Expected at least one .sql file." };
  }

  // Reject anything that is not a clean non-negative integer. "" , null, "abc", "1.5", "-2", NaN.
  const s = String(appliedRaw ?? "").trim();
  if (!/^\d+$/.test(s)) {
    return {
      pass: false, code: 1,
      reason:
        `--applied was ${JSON.stringify(appliedRaw)}, which is not a whole number. The D1 read ` +
        `failed or returned nothing. Failing closed: check CLOUDFLARE_API_TOKEN carries D1:Read ` +
        `and CLOUDFLARE_ACCOUNT_ID is set.`,
    };
  }
  const applied = Number(s);

  if (repoHighest > applied) {
    return {
      pass: false, code: 1,
      reason:
        `Repo carries migration ${pad(repoHighest)} but D1 has only applied ${pad(applied)}. ` +
        `Deploying now would serve code against a schema that cannot support it — this is the ` +
        `2026-07-27 break. Apply the migration in the D1 console, then re-run.`,
    };
  }

  if (applied > repoHighest) {
    // Not a fault. Migrations get deleted from the repo once applied (library_v1_0 §3).
    return {
      pass: true, code: 0,
      reason: `D1 is at ${pad(applied)}, ahead of the repo's ${pad(repoHighest)}. Fine — applied ` +
              `migrations are pruned from the repo; schema_migrations is the record.`,
    };
  }

  return { pass: true, code: 0, reason: "Repo and D1 agree." };
}

/** Zero-pad to the 4-digit form used in filenames and in the ledger. */
export function pad(n) {
  return String(n).padStart(4, "0");
}

/* ============================ CLI ============================ */

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function main() {
  const dir = arg("--dir") ?? DEFAULT_DIR;
  const appliedRaw = arg("--applied");

  if (!existsSync(dir)) {
    console.error(`SCHEMA GATE: BLOCKED`);
    console.error(`  migration directory not found: ${dir}`);
    process.exit(1);
  }

  const { highest, files, unparseable, skipped } = scanMigrations(dir);
  const d = gateDecision(highest, appliedRaw, unparseable);

  console.log(`  migration directory       : ${dir}`);
  console.log(`  .sql files scanned        : ${files}`);
  if (skipped.length) console.log(`  non-migrations skipped    : ${skipped.join(", ")}`);
  console.log(`  highest migration in repo : ${highest >= 0 ? pad(highest) : "none"}`);
  console.log(`  highest applied in D1     : ${appliedRaw ?? "unreadable"}`);

  if (d.pass) {
    console.log(`SCHEMA GATE: PASS`);
    if (d.reason !== "Repo and D1 agree.") console.log(`  note: ${d.reason}`);
    process.exit(0);
  }

  console.error(`SCHEMA GATE: BLOCKED`);
  console.error(`  ${d.reason}`);
  console.error(`::error::Schema gate blocked the deploy. ${d.reason}`);
  process.exit(d.code);
}

// Only run the CLI when executed directly, so the test file can import the pure functions.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
