/**
 * Boomtown Platform — guards for worker/scripts/seed-local.mjs
 * File: worker/test/seed_local.test.mjs · Version: v1.0 · Date: 2026-08-17
 *
 * The seeder's job is to rebuild the local database and then PROVE it rebuilt it. These tests
 * cover the proving half, because that is the half that can lie: a verifier which cannot report
 * a miss will report clean forever, which is exactly how the local database came to be missing
 * ten tables while looking seeded.
 *
 * Nothing here touches wrangler, the filesystem state, or the network. Every export under test is
 * pure, which is why they were written as exports.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { tablesIn, compareTables, ledgerRows, assertLocalOnly, REPO } from "../scripts/seed-local.mjs";
import { scanMigrations, DEFAULT_DIR } from "../scripts/schema-gate.mjs";

const FIXTURE = new URL("../testkit/journey-schema.sql", import.meta.url);

test("tablesIn reads every DDL form sqlite_master actually emits", () => {
  const sql = [
    "CREATE TABLE alpha (id INTEGER);",
    'CREATE TABLE IF NOT EXISTS "beta" (id INTEGER);',
    "create table `gamma` (id INTEGER);",
    "CREATE TABLE [delta] (id INTEGER);",
    "CREATE INDEX ix_alpha ON alpha(id);", // must NOT be counted as a table
  ].join("\n");
  assert.deepEqual(tablesIn(sql), ["alpha", "beta", "gamma", "delta"]);
});

test("tablesIn parses the real fixture, and the fixture still carries the messaging cluster", () => {
  const names = tablesIn(readFileSync(FIXTURE, "utf8"));
  // The floor is deliberately well under the true count so a legitimate schema change does not
  // redden this, but far above zero so an empty or misparsed read cannot pass (failure class 4).
  assert.ok(names.length > 90, `fixture parsed to only ${names.length} tables`);

  // These ten are the cluster the hand-built local database was missing on 2026-08-17. If the
  // fixture ever stops carrying them, seeding from it silently reproduces that hole.
  for (const t of [
    "messages", "message_threads", "thread_participants", "member_blocks", "member_mutes",
    "content_flags", "community_moderators", "forum_categories", "forum_threads", "forum_posts",
  ]) {
    assert.ok(names.includes(t), `fixture no longer creates ${t}`);
  }
  assert.ok(names.includes("schema_migrations"), "fixture must create the ledger table");
});

test("compareTables REPORTS A MISS — the check must be able to fail", () => {
  const r = compareTables(["a", "b", "c"], ["a", "c"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["b"]);
  assert.deepEqual(r.extra, []);
});

test("compareTables reports an unexpected table", () => {
  const r = compareTables(["a"], ["a", "surprise"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.extra, ["surprise"]);
});

test("compareTables ignores the engine's own bookkeeping tables, not arbitrary ones", () => {
  assert.equal(compareTables(["a"], ["a", "sqlite_sequence", "_cf_METADATA"]).ok, true);
  // ...but only those. A table that merely looks internal is still drift.
  assert.equal(compareTables(["a"], ["a", "_cf_SOMETHING_ELSE"]).ok, false);
});

test("compareTables agrees with itself on an exact match", () => {
  assert.equal(compareTables(["a", "b"], ["b", "a"]).ok, true);
});

test("ledgerRows is ascending, skips rollbacks, and tops out at the repo's highest migration", () => {
  const rows = ledgerRows(DEFAULT_DIR);
  const { highest } = scanMigrations(DEFAULT_DIR);

  assert.ok(rows.length > 0, "no ledger rows derived from db/migrations/");
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].version >= rows[i - 1].version, `not ascending at index ${i}`);
  }
  // The whole reason this is derived rather than typed: it has to agree with the function the CI
  // deploy gate uses to decide whether code is ahead of schema.
  assert.equal(rows[rows.length - 1].version, highest);

  // A rollback replayed in lexical order would UNDO the migration it reverses. 0025's rollback
  // sits between 0025 and 0026 by date, so this is not hypothetical.
  assert.equal(rows.filter((r) => /rollback/i.test(r.filename)).length, 0);
  assert.equal(rows.filter((r) => r.version === null).length, 0);
});

test("assertLocalOnly refuses anything that could aim wrangler at production", () => {
  for (const argv of [["--remote"], ["--reset", "--remote"], ["--env", "production"], ["--env=production"]]) {
    assert.throws(() => assertLocalOnly(argv), /Refusing to run/, `accepted ${argv.join(" ")}`);
  }
});

test("assertLocalOnly allows the flags the script actually takes", () => {
  assert.doesNotThrow(() => assertLocalOnly([]));
  assert.doesNotThrow(() => assertLocalOnly(["--reset"]));
  assert.doesNotThrow(() => assertLocalOnly(["--reset", "--json"]));
});

test("the seeder never spells --remote, and pins wrangler instead of resolving it at call time", () => {
  const src = readFileSync(new URL("../scripts/seed-local.mjs", import.meta.url), "utf8");
  const body = src.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // Positive control: the needle must be findable in text that HAS it, or this guard proves nothing.
  assert.ok(/"--remote"/.test('const x = "--remote";'), "needle cannot match — guard is vacuous");

  const execArgs = /execFileSync\([\s\S]*?\)/g;
  for (const call of body.match(execArgs) || []) {
    assert.ok(!/--remote/.test(call), `a wrangler invocation mentions --remote:\n${call}`);
    assert.ok(/"--local"/.test(call), `a wrangler invocation omits --local:\n${call}`);
  }
  assert.ok(!/wrangler@\d/.test(body), "seeder resolves wrangler at call time; it must use the pinned install");
});

test("the repo root the seeder computes is the real repo root", () => {
  assert.ok(existsSync(`${REPO}/wrangler.toml`), `REPO resolved to ${REPO}, which has no wrangler.toml`);
  assert.ok(existsSync(`${REPO}/package.json`), `REPO resolved to ${REPO}, which has no package.json`);
});
