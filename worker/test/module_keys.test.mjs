/* Boomtown Platform — MODULE_KEYS is pinned byte-equal to admin-nav.js's BT_MODULES
   File: worker/test/module_keys.test.mjs · Version: v1.0 · Date: 2026-08-16 · Ships in: (no bump)
   Roadmap §-1q, build unit SG-3a.

   WHAT THIS GUARDS. `MODULE_KEYS` in worker/src/orgs.js is a DELIBERATE COPY of the fourteen keys
   in `window.BT_MODULES` (web/assets/admin-nav.js), plus `events`. The browser and the worker
   cannot import from each other — ACTIVE_REG across events_admin/waitlists is the same pattern —
   so the only thing standing between the two copies and silent divergence is this file.

   WHY DIVERGENCE WOULD BE EXPENSIVE RATHER THAN MERELY UNTIDY. Once `staffGateFor` ships, a key
   that exists in the menu but not in MODULE_KEYS is a module an admin can APPEAR to grant while the
   gate refuses it forever — the grant toggle saves, the host still gets 403, and nothing anywhere
   says why. The reverse (a key in MODULE_KEYS with no menu entry) is a grantable module with no way
   to grant it. Neither shows up as an error; both look like the feature is broken.

   THE CORPUS IS THE REAL FILE, PARSED. Not a hardcoded expectation of what admin-nav.js contains —
   that would be a third copy, and a third copy is a third thing that can drift. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODULE_KEYS } from "../src/orgs.js";
import { blankComments } from "../testkit/route-extract.mjs";

const NAV = readFileSync(new URL("../../web/assets/admin-nav.js", import.meta.url), "utf8");

/** The keys of the real `window.BT_MODULES` literal, read out of the real file.
 *  Comments are blanked first: a `key:` inside a commented-out entry is not a shipped key, and
 *  org_modules.test.mjs already established this idiom against this exact file. */
function navKeys(src = NAV) {
  const m = blankComments(src).match(/window\.BT_MODULES\s*=\s*(\[[\s\S]*?\]);/);
  assert.ok(m, "admin-nav.js no longer defines window.BT_MODULES as a literal array — this guard is blind until that is fixed");
  return [...m[1].matchAll(/\bkey:\s*"([^"]+)"/g)].map((x) => x[1]);
}

/* `events` is grantable but never hideable — the ONE deliberate difference between the two lists.
   Named here as a constant so the asymmetry is declared rather than buried in an off-by-one. */
const GRANT_ONLY = ["events"];

test("the corpus is real — BT_MODULES parses and is big enough to mean something", () => {
  const keys = navKeys();
  assert.ok(keys.length >= 10, `parsed only ${keys.length} keys out of admin-nav.js; the parser, not the list, is wrong`);
  assert.equal(new Set(keys).size, keys.length, `BT_MODULES contains a duplicate key: ${keys.join(", ")}`);
});

test("MODULE_KEYS is BT_MODULES' keys plus exactly the grant-only additions, in order", () => {
  assert.deepEqual(MODULE_KEYS, [...navKeys(), ...GRANT_ONLY]);
});

test("every hideable module is grantable — a menu entry with no key cannot be given to a host", () => {
  const missing = navKeys().filter((k) => !MODULE_KEYS.includes(k));
  assert.deepEqual(missing, [],
    `these modules appear in the admin menu but cannot be granted, so a host can never be given them: ${missing.join(", ")}`);
});

test("MODULE_KEYS invents nothing — every key is either in the menu or a declared grant-only key", () => {
  const known = new Set([...navKeys(), ...GRANT_ONLY]);
  const invented = MODULE_KEYS.filter((k) => !known.has(k));
  assert.deepEqual(invented, [],
    `these keys are grantable but correspond to no module, so granting them would do nothing: ${invented.join(", ")}`);
});

/* ── negative controls. Each MUTATES THE REAL FILE'S TEXT, never a hand-written stand-in. ── */

test("NC-1: a key ADDED to the menu and not to MODULE_KEYS is caught", () => {
  const anchor = '{ key: "waivers",';
  assert.equal(NAV.split(anchor).length - 1, 1, "anchor must occur exactly once or this NC proves nothing");
  const mutated = NAV.replace(anchor, '{ key: "newthing", label: "New", pages: ["x.html"] },\n    { key: "waivers",');
  const keys = navKeys(mutated);
  assert.ok(keys.includes("newthing"), "the mutation must land in the parsed list, or this NC proves nothing");
  assert.ok(!MODULE_KEYS.includes("newthing"), "a menu key absent from MODULE_KEYS must be detectable");
  assert.notDeepEqual(MODULE_KEYS, [...keys, ...GRANT_ONLY]);
});

test("NC-2: a key RENAMED in the menu is caught — not just additions", () => {
  const anchor = '{ key: "kotc",';
  assert.equal(NAV.split(anchor).length - 1, 1, "anchor must be unique");
  const keys = navKeys(NAV.replace(anchor, '{ key: "courtboard",'));
  assert.ok(keys.includes("courtboard") && !keys.includes("kotc"), "the rename must land");
  assert.notDeepEqual(MODULE_KEYS, [...keys, ...GRANT_ONLY]);
});

test("NC-3: the parser reads SHIPPED keys, not commented-out ones", () => {
  // blankComments is doing real work here. Without it a key someone commented out would still be
  // demanded of MODULE_KEYS, and the guard would fail for a module that does not exist.
  const withComment = NAV.replace('window.BT_MODULES = [', 'window.BT_MODULES = [\n    // { key: "ghost", label: "Ghost", pages: [] },');
  assert.ok(!navKeys(withComment).includes("ghost"), "a commented-out entry is not a shipped module");
  assert.deepEqual(navKeys(withComment), navKeys(), "and blanking it must leave the real list untouched");
});
