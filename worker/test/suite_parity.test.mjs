/**
 * Boomtown Platform — suite-parity guard
 * File: worker/test/suite_parity.test.mjs · Version: v1.0 · Date: 2026-07-29 · Ships in: v0.34.0
 *
 * F-37. v0.33.2 shipped 13 tests in a file named 'tokens.test.mjs,' — trailing comma. The CI
 * glob `test/*.mjs` could not match it, Node could not even load it (ERR_UNKNOWN_FILE_EXTENSION),
 * and the suite reported 360/360 green while the new tests contributed zero. Failure classes 1
 * and 4, landing on the release that shipped the gate.
 *
 * deploy-worker.yml v0.4.0 carries the CI-side parity step. This file is the LOCAL copy of the
 * same rule, so `node --test test/*.mjs` on a laptop refuses too — a gate that only exists in CI
 * is a gate you skip every day until push. And per guard discipline, the negative control below
 * proves the check can actually fail; a guard that cannot fail is F-11 wearing a test's clothes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

const LAWFUL = /^[A-Za-z0-9_.-]+\.(test\.)?mjs$/;
const TEST_DIR = new URL("./", import.meta.url);

test("every file in worker/test/ is loadable by the CI glob test/*.mjs (F-37)", () => {
  const files = readdirSync(TEST_DIR);
  const offenders = files.filter((f) => !f.endsWith(".mjs") || !LAWFUL.test(f));
  assert.deepEqual(offenders, [],
    `these files escape 'test/*.mjs' and will silently not run: ${offenders.join(", ")}`);
  assert.ok(files.length >= 24, `expected the v0.34.0 suite's 24+ files, saw ${files.length} — ` +
    "a shrinking test directory is its own finding");
});

test("negative control: the parity rule actually rejects the v0.33.2 filename", () => {
  assert.equal(LAWFUL.test("tokens.test.mjs,"), false, "the exact F-37 filename must fail");
  assert.equal("tokens.test.mjs,".endsWith(".mjs"), false);
  assert.equal(LAWFUL.test("tokens.test.mjs"), true, "and the lawful name must pass");
});
