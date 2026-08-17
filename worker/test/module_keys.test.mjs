/* Boomtown Platform — MODULE_KEYS is pinned byte-equal to admin-nav.js's BT_MODULES
   File: worker/test/module_keys.test.mjs · Version: v1.1 · Date: 2026-08-17 · Ships in: (no bump)
   v1.1 — external review 2026-08-17: all three quote styles parsed (was double-quote only), the
   pin compares as a SET rather than by order (reordering the menu was a false positive), duplicates
   asserted separately since a set hides them, and NC-4/NC-5 added for the two new properties.
   NC-3 was challenged as possibly vacuous and MEASURED SOUND: without blankComments the naive
   regex really does find a commented-out key.
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
 *
 *  Comments are blanked first: a `key:` inside a commented-out entry is not a shipped key, and
 *  org_modules.test.mjs already established this idiom against this exact file. NC-3 proves the
 *  blanking is load-bearing rather than decorative — measured 2026-08-17, a naive regex without it
 *  really does find a commented-out key.
 *
 *  ALL THREE QUOTE STYLES (v1.1, external review 2026-08-17). The first version demanded double
 *  quotes. That was not SILENT — single-quoting the whole file drops the parse to zero keys and the
 *  corpus-size assertion below fires — but it fails with the WRONG STORY: the suite would report
 *  that MODULE_KEYS disagrees with the menu when what actually happened is that a formatter
 *  normalised the quotes. A guard that reddens for the wrong reason costs a session. The quote
 *  character is captured and back-referenced so `'a"b'` cannot be mis-split. */
function navKeys(src = NAV) {
  const m = blankComments(src).match(/window\.BT_MODULES\s*=\s*(\[[\s\S]*?\]);/);
  assert.ok(m, "admin-nav.js no longer defines window.BT_MODULES as a literal array — this guard is blind until that is fixed");
  return [...m[1].matchAll(/\bkey\s*:\s*(["'`])(.+?)\1/g)].map((x) => x[2]);
}

/** Order-free comparison. See the ordering test for why this is not `deepEqual`. */
const sorted = (a) => [...a].sort();

/* `events` is grantable but never hideable — the ONE deliberate difference between the two lists.
   Named here as a constant so the asymmetry is declared rather than buried in an off-by-one. */
const GRANT_ONLY = ["events"];

test("the corpus is real — BT_MODULES parses and is big enough to mean something", () => {
  const keys = navKeys();
  assert.ok(keys.length >= 10, `parsed only ${keys.length} keys out of admin-nav.js; the parser, not the list, is wrong`);
  assert.equal(new Set(keys).size, keys.length, `BT_MODULES contains a duplicate key: ${keys.join(", ")}`);
});

test("MODULE_KEYS is BT_MODULES' keys plus exactly the grant-only additions", () => {
  // SET comparison, not order-sensitive (v1.1, external review 2026-08-17). MODULE_KEYS is a
  // VOCABULARY — the gate asks "is this key in the list", never "is it the fourth entry". The
  // menu's own order is display order and a designer may reorder it; failing the build for that
  // is a false positive that teaches people the guard cries wolf. Duplicates are asserted
  // separately below, because a Set comparison alone would hide them.
  assert.deepEqual(sorted(MODULE_KEYS), sorted([...navKeys(), ...GRANT_ONLY]));
});

test("neither list contains a duplicate — the thing a set comparison would otherwise hide", () => {
  assert.equal(new Set(MODULE_KEYS).size, MODULE_KEYS.length, `MODULE_KEYS has a duplicate: ${MODULE_KEYS.join(", ")}`);
  const nav = navKeys();
  assert.equal(new Set(nav).size, nav.length, `BT_MODULES has a duplicate key: ${nav.join(", ")}`);
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
  assert.notDeepEqual(sorted(MODULE_KEYS), sorted([...keys, ...GRANT_ONLY]));
});

test("NC-2: a key RENAMED in the menu is caught — not just additions", () => {
  const anchor = '{ key: "kotc",';
  assert.equal(NAV.split(anchor).length - 1, 1, "anchor must be unique");
  const keys = navKeys(NAV.replace(anchor, '{ key: "courtboard",'));
  assert.ok(keys.includes("courtboard") && !keys.includes("kotc"), "the rename must land");
  assert.notDeepEqual(sorted(MODULE_KEYS), sorted([...keys, ...GRANT_ONLY]));
});

test("NC-4: single-quoted and backtick keys are still read — a formatter must not blind this", () => {
  // The gap the external review pointed at: nothing proved the quote assumption either way.
  const real = navKeys();
  const single = NAV.replace(/\bkey: "([a-z]+)"/g, "key: '$1'");
  assert.notEqual(single, NAV, "the mutation must land, or this NC proves nothing");
  assert.deepEqual(navKeys(single), real, "single-quoting the menu must not change the parsed keys");
  const tick = NAV.replace(/\bkey: "([a-z]+)"/g, "key: `$1`");
  assert.deepEqual(navKeys(tick), real, "backtick keys must parse identically too");
});

test("NC-5: REORDERING the menu is deliberately NOT a failure — the false positive being avoided", () => {
  // This is the property the set comparison buys, asserted rather than left implicit. If someone
  // later "tightens" this back to deepEqual, this test goes red and explains why not to.
  const keys = navKeys();
  const reversed = [...keys].reverse();
  assert.notDeepEqual(reversed, keys, "the reversal must actually change the order");
  assert.deepEqual(sorted(MODULE_KEYS), sorted([...reversed, ...GRANT_ONLY]),
    "reordering the menu must NOT fail the pin — MODULE_KEYS is a vocabulary, not a sequence");
});

test("NC-3: the parser reads SHIPPED keys, not commented-out ones", () => {
  // blankComments is doing real work here. Without it a key someone commented out would still be
  // demanded of MODULE_KEYS, and the guard would fail for a module that does not exist.
  const withComment = NAV.replace('window.BT_MODULES = [', 'window.BT_MODULES = [\n    // { key: "ghost", label: "Ghost", pages: [] },');
  assert.ok(!navKeys(withComment).includes("ghost"), "a commented-out entry is not a shipped module");
  assert.deepEqual(navKeys(withComment), navKeys(), "and blanking it must leave the real list untouched");
});
