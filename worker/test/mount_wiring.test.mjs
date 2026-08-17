/**
 * Boomtown Platform — every module is MOUNTED AND WIRED, asserted in one place
 * File: worker/test/mount_wiring.test.mjs · Version: v1.0 · Date: 2026-08-17 · Ships in: v0.169.0
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * "Is this module actually mounted?" was asserted by ten module guards, each with its own
 * hand-rolled literal anchor. v0.168.0 changed the mount call shape once and broke all ten at
 * once. A fact asserted in ten places is a fact that must be corrected in ten places.
 *
 * AND ALL TEN WERE WRONG IN THE SAME WAY, WHICH IS THE REAL FINDING. They matched RAW source, so
 * a mount commented out with `//` still contained the bytes they were looking for. Measured
 * 2026-08-17: eleven of eleven anchors accepted a commented-out mount. Every "the module is
 * actually mounted (failure class 1)" guard in this suite would have reported clean while the
 * module served nothing — a guard that cannot see the disabling of the thing it guards.
 *
 * The gate scanners in `route-extract.mjs` have blanked comments since v0.102.0, for exactly this
 * reason and after exactly this kind of miss. The mount guards never got the same treatment.
 * `mountsAndWires` does, and NC-3 below pins the defect so it cannot come back quietly.
 *
 * SCOPE. This answers "is it wired at all" — failure class 1. It deliberately does NOT check which
 * grant key a mount is bound to; `staff_gate_wiring.test.mjs` owns that with a paren-balanced
 * parser and pins every mount in both directions.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountsAndWires } from "../testkit/route-extract.mjs";

const INDEX = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

/* Every module whose own test file asserts its mount. Bound and unbound both appear: the question
   here is whether the wire call exists, which is orthogonal to whether it carries a grant key. */
const MOUNTED = [
  "Announcements", "Brackets", "Divisions", "Faq", "Kotc", "MemberFields",
  "Passes", "StaffPay", "Sms", "Tryouts", "Lfg", "Registrations", "Admin", "Orgs",
];

test("the corpus is real — index.js was read and carries a wire block", () => {
  assert.ok(INDEX.length > 10_000, `index.js read as ${INDEX.length} bytes — that is not the router`);
  assert.ok(INDEX.includes("const wiredHelpers"), "index.js has no wiredHelpers bag — the corpus moved");
});

test("every module in the list is MOUNTED AND WIRED", () => {
  const missing = MOUNTED.filter((n) => !mountsAndWires(INDEX, n));
  assert.deepEqual(missing, [], `these modules are not wired in index.js: ${missing.join(", ")}`);
});

/* ---------------- negative controls — each mutates the REAL index.js ---------------- */

test("NC-1: a DELETED mount is caught", () => {
  const mutated = INDEX.replace(/^wireTryouts\(.*$/m, "");
  assert.equal(mountsAndWires(mutated, "Tryouts"), false, "deleting the mount must fail the check");
  assert.equal(mountsAndWires(mutated, "Brackets"), true, "...and must not disturb its neighbours");
});

test("NC-2: a mount call with NO helpers is not a mount", () => {
  const mutated = INDEX.replace(/^wireTryouts\(.*$/m, "wireTryouts();");
  assert.equal(mountsAndWires(mutated, "Tryouts"), false,
    "`wireTryouts()` passes no helpers — the module's gates would be undefined");
});

test("NC-3: a COMMENTED-OUT mount is not a mount — the defect this file was built for", () => {
  const mutated = INDEX.replace(/^(wireTryouts\(.*)$/m, "// $1");
  assert.equal(mountsAndWires(mutated, "Tryouts"), false,
    "a mount disabled with // must not satisfy the check");

  // The anchor this replaced. Kept as an executable record of the defect: it PASSES on the same
  // mutated source, which is why ten guards could report clean against a disabled mount.
  assert.match(mutated, /wireTryouts\(\s*\{?\s*(?:\.\.\.)?wiredHelpers/,
    "the raw-source anchor should still match here — if it does not, this control has stopped " +
    "demonstrating the difference and the comparison below is vacuous");
});

test("NC-4: a block-commented mount is caught too, not just line comments", () => {
  const mutated = INDEX.replace(/^(wireTryouts\(.*)$/m, "/* $1 */");
  assert.equal(mountsAndWires(mutated, "Tryouts"), false, "a /* */ disabled mount must not pass");
});

test("NC-5: the check is not vacuous — a module that was never wired reports false", () => {
  assert.equal(mountsAndWires(INDEX, "ModuleThatDoesNotExist"), false);
});

test("NC-6: BOTH call shapes are accepted — bound and unbound", () => {
  assert.equal(mountsAndWires("wireX(wiredHelpers);", "X"), true, "unbound shape");
  assert.equal(mountsAndWires('wireX({ ...wiredHelpers, requireStaff: staffGateFor("k") });', "X"), true, "bound shape");
  assert.equal(mountsAndWires("wireXY(wiredHelpers);", "X"), false, "must not match a longer sibling name");
});
