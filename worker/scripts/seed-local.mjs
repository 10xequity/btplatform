/**
 * Boomtown Platform — Local D1 seeder
 * File: worker/scripts/seed-local.mjs · Version: v1.0 · Date: 2026-08-17
 *
 * WHY THIS EXISTS
 * ---------------
 * `.gitignore` says the local `.wrangler/` state is "a THROWAWAY replica... Deleting it costs
 * nothing but a re-seed (see below)." There was no below. Nothing in this repo could rebuild a
 * local database, so the re-seed was a one-off somebody ran by hand and did not write down.
 *
 * It shows. Measured on 2026-08-17, the local D1 carried **88 of the fixture's 98 tables** — the
 * entire messaging and forum cluster (`messages`, `message_threads`, `thread_participants`,
 * `member_blocks`, `member_mutes`, `content_flags`, `community_moderators`, `forum_categories`,
 * `forum_threads`, `forum_posts`) was absent. Every route in `messages.js` would 500 locally
 * against a database that looked, from the outside, seeded and fine. That is the failure class
 * this repo keeps naming: a partial thing that reports clean.
 *
 * WHY THE FIXTURE AND NOT db/migrations/
 * --------------------------------------
 * Because replaying the migration folder CANNOT rebuild this schema, and this is settled, not a
 * preference. Migrations 0004–0007 and 0011 were pruned from the repo after being applied
 * (library §3); `schema_migrations` is the record, not the folder. `worker/testkit/journey-schema.sql`
 * says so in its own header, and it is the maintained, provenance-verified copy: every CREATE TABLE
 * in it was read VERBATIM from live D1 via `sqlite_master`. It is also already the schema the 2000+
 * test suite runs against, so seeding local dev from it means `wrangler dev` and `node --test`
 * disagree about nothing.
 *
 * The fixture is a SNAPSHOT and says so. When it drifts from live, the fix belongs there — one
 * schema source for the harness and for local dev, never two.
 *
 * IT CANNOT TOUCH PRODUCTION
 * --------------------------
 * Every `wrangler` call this script makes hardcodes `--local`, and it refuses to start if `--remote`
 * appears anywhere in its own argv. The whole point of a local database is that a mistake here costs
 * a re-seed instead of real member data, and that guarantee should be structural rather than a
 * habit. See assertLocalOnly.
 *
 * CONTRACT
 * --------
 *   node worker/scripts/seed-local.mjs [--reset] [--json]
 *
 *   --reset   DELETE the local D1 state first, then seed. Required when a database already
 *             exists: the fixture is plain `CREATE TABLE` (zero `IF NOT EXISTS`), so applying
 *             it over a live local DB errors halfway and leaves a mess.
 *   --json    machine-readable result on stdout, nothing else.
 *
 *   exit 0  seeded and VERIFIED — every fixture table present, ledger max agrees with the repo
 *   exit 1  seeding or verification failed
 *   exit 2  the script could not run at all (bad repo layout, wrangler missing)
 *
 * VERIFICATION IS DERIVED, NEVER HARDCODED. The expected table set is parsed out of the fixture
 * and the expected ledger maximum comes from `scanMigrations` — the same function the CI deploy
 * gate uses to decide whether code is ahead of schema. A number typed into this file would be a
 * number that agrees with itself. And because a check that cannot fail is worse than no check,
 * `selfTest` proves the comparator reports a miss BEFORE any real result is trusted to it.
 */

import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, mkdtempSync, realpathSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { scanMigrations, migrationNumber, isNonMigration, DEFAULT_DIR } from "./schema-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");
const FIXTURE = join(REPO, "worker", "testkit", "journey-schema.sql");
const D1_STATE = join(REPO, ".wrangler", "state", "v3", "d1");
const D1_OBJECT = join(D1_STATE, "miniflare-D1DatabaseObject");
const DB_NAME = "boomtown-prod";

/**
 * The PINNED wrangler, run as a plain JS file through this same Node.
 *
 * Not `npx wrangler@4`: that re-resolves the newest 4.x on every call, so the tool rebuilding your
 * database could differ from the one that built it yesterday. Not `node_modules/.bin/wrangler.cmd`
 * either — Node refuses to spawn `.cmd`/`.bat` without a shell (the 2024 argument-injection fix),
 * so a `.bin` shim would work everywhere except Windows, which is where this runs.
 */
const WRANGLER = join(REPO, "node_modules", "wrangler", "bin", "wrangler.js");

/* ============================ pure helpers (self-tested below) ============================ */

/**
 * Table names a SQL fixture creates. The fixture is copied verbatim out of `sqlite_master`, so
 * the DDL is whatever SQLite emitted — quoted or bare, `IF NOT EXISTS` or not.
 *
 * @param {string} sql
 * @returns {string[]} table names, in file order
 */
export function tablesIn(sql) {
  const out = [];
  const re = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([A-Za-z0-9_]+)/gim;
  for (const m of sql.matchAll(re)) out.push(m[1]);
  return out;
}

/**
 * Compare what the fixture promises against what the database actually holds.
 * SQLite's own bookkeeping tables are not schema and are excluded by name, not by guessing.
 *
 * @param {string[]} expected table names the fixture creates
 * @param {string[]} actual   table names read from sqlite_master
 * @returns {{ok:boolean, missing:string[], extra:string[], schema:number, engine:number}}
 */
export function compareTables(expected, actual) {
  const ENGINE = new Set(["sqlite_sequence", "sqlite_stat1", "_cf_METADATA", "_cf_KV"]);
  const want = new Set(expected);
  const engine = actual.filter((t) => ENGINE.has(t));
  const have = new Set(actual.filter((t) => !ENGINE.has(t)));
  const missing = [...want].filter((t) => !have.has(t));
  const extra = [...have].filter((t) => !want.has(t));
  // `schema` is the only count that may be printed beside the fixture's. The raw table count is
  // not: it includes SQLite's and miniflare's own bookkeeping, so showing it next to "fixture
  // promises 98" invites the reader to compare two things that were never the same measurement.
  return { ok: missing.length === 0 && extra.length === 0, missing, extra, schema: have.size, engine: engine.length };
}

/**
 * Ledger rows for every numbered migration still present in the repo.
 *
 * The pruned migrations (0004–0007, 0011) are deliberately NOT invented here. Their rows exist in
 * production because they ran; fabricating them locally would be writing a history that did not
 * happen. What has to agree is the MAXIMUM, because that is the only thing the deploy gate compares.
 *
 * @param {string} dir migrations directory
 * @returns {{version:number, filename:string}[]} ascending by version
 */
export function ledgerRows(dir) {
  return readdirSync(dir)
    .filter((n) => /\.sql$/i.test(n) && !isNonMigration(n))
    .map((filename) => ({ version: migrationNumber(filename), filename }))
    .filter((r) => r.version !== null)
    .sort((a, b) => a.version - b.version);
}

/** SQL string literal. No migration filename has ever contained a quote; this is why it stays true. */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Refuse to run if anything on the command line could aim wrangler at live D1.
 * @param {string[]} argv
 */
export function assertLocalOnly(argv) {
  const bad = argv.filter((a) => /^--remote\b/.test(a) || a === "--env" || /^--env=/.test(a));
  if (bad.length) {
    throw new Error(
      `Refusing to run with ${bad.join(" ")}. This script only ever writes the LOCAL miniflare ` +
        `database. If you meant to change production, use the migration + deploy path, not a seeder.`,
    );
  }
}

/**
 * Prove the comparator can report a failure before any real result is trusted to it.
 * The CI gate's syntax step earned this idiom the hard way: it passed unconditionally for
 * two months while printing "N modules OK".
 */
function selfTest() {
  const parsed = tablesIn(
    'CREATE TABLE alpha (id INTEGER);\nCREATE TABLE IF NOT EXISTS "beta" (id INTEGER);\ncreate table `gamma` (id INTEGER);\n',
  );
  if (parsed.join(",") !== "alpha,beta,gamma") {
    throw new Error(`selfTest: tablesIn misparsed the three DDL forms — got [${parsed}]`);
  }
  const miss = compareTables(["a", "b"], ["a", "sqlite_sequence"]);
  if (miss.ok || miss.missing.join() !== "b") {
    throw new Error("selfTest: compareTables failed to report a missing table — refusing to report clean");
  }
  const same = compareTables(["a"], ["a", "_cf_METADATA"]);
  if (!same.ok) throw new Error("selfTest: compareTables flagged an engine table as drift");
}

/* ============================ filesystem / process ============================ */

/**
 * The single local D1 file miniflare keeps for this Worker. Its name is a hash of the database id,
 * so it is found, never constructed. Anything other than exactly one match is a hard stop: guessing
 * which of two databases is "the" one is how a verifier ends up reading a file nobody writes.
 *
 * @returns {string} absolute path
 */
function localDbFile() {
  if (!existsSync(D1_OBJECT)) throw new Error(`no local D1 directory at ${D1_OBJECT}`);
  const hits = readdirSync(D1_OBJECT).filter((n) => n.endsWith(".sqlite") && n !== "metadata.sqlite");
  if (hits.length !== 1) {
    throw new Error(`expected exactly 1 local D1 file, found ${hits.length}: ${hits.join(", ") || "(none)"}`);
  }
  return join(D1_OBJECT, hits[0]);
}

/** Tables currently in the local database, or null when there is no database yet. */
function currentTables() {
  let file;
  try {
    file = localDbFile();
  } catch {
    return null;
  }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("SELECT name FROM sqlite_master WHERE type = ?").all("table").map((r) => r.name);
  } finally {
    db.close();
  }
}

/**
 * Apply one SQL file to the LOCAL database. `--local` is not a parameter and never becomes one.
 * @param {string} file
 */
function applyLocal(file) {
  if (!existsSync(WRANGLER)) {
    throw Object.assign(
      new Error(`wrangler is not installed at ${WRANGLER}. Run \`npm install\` in the repo root first.`),
      { code: 2 },
    );
  }
  execFileSync(
    process.execPath,
    [WRANGLER, "d1", "execute", DB_NAME, "--local", `--file=${file}`],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 10 * 60_000 },
  );
}

/* ============================ main ============================ */

function main(argv) {
  assertLocalOnly(argv);
  selfTest();

  const json = argv.includes("--json");
  const reset = argv.includes("--reset");
  const say = (...a) => { if (!json) console.log(...a); };

  if (!existsSync(FIXTURE)) throw Object.assign(new Error(`fixture missing: ${FIXTURE}`), { code: 2 });

  const fixture = readFileSync(FIXTURE, "utf8");
  const expected = tablesIn(fixture);
  if (expected.length < 50) {
    throw new Error(`fixture parsed to only ${expected.length} tables — refusing to seed from a schema that thin`);
  }

  const { highest } = scanMigrations(DEFAULT_DIR);
  const rows = ledgerRows(DEFAULT_DIR);
  if (highest < 0 || rows.length === 0) throw new Error("no parseable migrations — cannot derive a ledger");
  if (rows[rows.length - 1].version !== highest) {
    throw new Error(`ledger rows top out at ${rows[rows.length - 1].version} but scanMigrations says ${highest}`);
  }

  const before = currentTables();
  if (before !== null && !reset) {
    say(`A local database already exists: ${before.length} tables.`);
    say(`The fixture is plain CREATE TABLE, so it cannot be layered over one.`);
    say(`Re-seed with:  npm run db:reset:local`);
    return { seeded: false, reason: "exists", tables: before.length };
  }

  if (reset && existsSync(D1_STATE)) {
    say(`Removing local D1 state (${before ? before.length : 0} tables) — ${D1_STATE}`);
    try {
      rmSync(D1_STATE, { recursive: true, force: true });
    } catch (e) {
      // A running `wrangler dev` holds these files open. On Windows that is a hard EPERM rather
      // than the silent unlink-on-close POSIX allows, so the reset stops here with the database
      // untouched. Say what is holding it and what to do; an unexplained EPERM reads as a broken
      // script rather than a running server.
      if (["EPERM", "EBUSY", "ENOTEMPTY", "EACCES"].includes(e.code)) {
        throw new Error(
          `cannot remove the local D1 state — the files are in use (${e.code}).\n` +
            `  A \`wrangler dev\` session is almost certainly running and holding them open.\n` +
            `  Stop it (Ctrl-C in that terminal), then run \`npm run db:reset:local\` again.\n` +
            `  Nothing was changed; the existing database is intact.`,
        );
      }
      throw e;
    }
  }

  // One wrangler invocation: the fixture plus the ledger rows it does not carry.
  const tmp = mkdtempSync(join(tmpdir(), "bt-seed-"));
  const bundle = join(tmp, "seed-local.sql");
  const inserts = rows
    .map((r) => `INSERT INTO schema_migrations (version, filename, applied_at, note) VALUES (${q(r.version)}, ${q(r.filename)}, datetime('now'), 'seeded locally by worker/scripts/seed-local.mjs');`)
    .join("\n");
  writeFileSync(bundle, `${fixture}\n\n-- ledger, derived from db/migrations/ --\n${inserts}\n`, "utf8");

  say(`Seeding local D1 "${DB_NAME}" — ${expected.length} tables, ${rows.length} ledger rows (max ${highest})…`);
  try {
    applyLocal(bundle);
  } catch (e) {
    const detail = [e.stdout, e.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`wrangler d1 execute failed:\n${detail || e.message}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // ---- verify. Read the database back; do not trust the exit code that just wrote it. ----
  const actual = currentTables();
  if (actual === null) throw new Error("wrangler reported success but no local database exists");
  const cmp = compareTables(expected, actual);

  const db = new DatabaseSync(localDbFile(), { readOnly: true });
  let ledger;
  try {
    ledger = db.prepare("SELECT COUNT(*) AS rows, MAX(CAST(version AS INTEGER)) AS max FROM schema_migrations").get();
  } finally {
    db.close();
  }

  const problems = [];
  if (!cmp.ok) {
    if (cmp.missing.length) problems.push(`${cmp.missing.length} table(s) missing: ${cmp.missing.join(", ")}`);
    if (cmp.extra.length) problems.push(`${cmp.extra.length} unexpected table(s): ${cmp.extra.join(", ")}`);
  }
  if (Number(ledger.max) !== highest) {
    problems.push(`ledger max is ${ledger.max}, repo highest migration is ${highest}`);
  }

  const result = {
    seeded: true,
    schemaTables: cmp.schema,
    expected: expected.length,
    engineTables: cmp.engine,
    ledgerRows: Number(ledger.rows),
    ledgerMax: Number(ledger.max),
    repoHighest: highest,
    ok: problems.length === 0,
    problems,
  };

  if (problems.length) throw Object.assign(new Error(`VERIFICATION FAILED\n  - ${problems.join("\n  - ")}`), { result });

  say(`OK — ${cmp.schema}/${expected.length} fixture tables present, 0 missing (+${cmp.engine} engine tables), ledger ${ledger.rows} rows, max ${ledger.max}.`);
  say(`Local database is at .wrangler/state/. Start the Worker with:  npm run dev`);
  return result;
}

/** True when this file was run directly rather than imported by a test. Path-shape agnostic. */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const argv = process.argv.slice(2);
  try {
    const result = main(argv);
    if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (e) {
    if (argv.includes("--json")) console.log(JSON.stringify({ ok: false, error: e.message, ...(e.result || {}) }, null, 2));
    else console.error(`\nseed-local: ${e.message}\n`);
    process.exit(e.code === 2 ? 2 : 1);
  }
}
