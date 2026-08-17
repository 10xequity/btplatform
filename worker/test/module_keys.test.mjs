/* Boomtown Platform — MODULE_KEYS is pinned to admin-nav.js's BT_MODULES
   File: worker/test/module_keys.test.mjs · Version: v1.2 · Date: 2026-08-17 · Ships in: (no bump)
   Roadmap §-1q, build unit SG-3a.

   v1.2 — second external review. The key literal is now located by BRACKET BALANCING and parsed by
   `node:vm`, not by a regex over its contents. NC-4's mutation was too narrow to cover realistic
   key names. A collision check between the two lists was added, plus NC-6 and NC-7.
   v1.1 — first external review: all three quote styles, set comparison instead of order,
   duplicates asserted separately, NC-4 and NC-5 added.

   WHAT THIS GUARDS. `MODULE_KEYS` in worker/src/orgs.js is a DELIBERATE COPY of the fourteen keys
   in `window.BT_MODULES` (web/assets/admin-nav.js), plus `events`. The browser and the worker
   cannot import from each other — ACTIVE_REG across events_admin/waitlists is the same pattern —
   so the only thing standing between the two copies and silent divergence is this file.

   WHY DIVERGENCE WOULD BE EXPENSIVE. Once `staffGateFor` ships, a key in the menu but not in
   MODULE_KEYS is a module an admin can APPEAR to grant while the gate refuses it forever — the
   toggle saves, the host still gets 403, and nothing says why. The reverse is a grantable module
   with no way to grant it. Neither surfaces as an error; both look like the feature is broken.

   ── HOW THE KEYS ARE READ, AND THE OPTION THAT LOST ──────────────────────────────────────────
   A reviewer proposed running admin-nav.js under `node:vm` with a stub context
   (`{ window: {}, document: { addEventListener() {} } }`) to get engine-accurate parsing.
   MEASURED 2026-08-17, that is the wrong shape for THIS file: it carries 60 `document.` uses,
   29 `location.`, 12 `addEventListener` and 2 `navigator.`. A stub thorough enough to survive it
   would be a mock DOM — more code, and more to maintain, than the parsing it replaces. Worse, it
   would EXECUTE the module's side effects in order to read a constant.

   The third option is better than either and is what ships here: find the literal's bounds by
   BALANCING BRACKETS (not by a non-greedy regex that stops at the first `];`), then evaluate ONLY
   that literal with `vm` in a null-prototype context. Engine-accurate, no code executed, no DOM.

   THE DIAGNOSTIC PROPERTY THAT MATTERS: if the extraction ever grabs the wrong span, `vm` throws a
   SyntaxError naming the problem. The old regex would have returned a short list and the suite
   would have blamed MODULE_KEYS for a divergence that never happened. A mis-read is now loud —
   NC-6 pins exactly that.

   Comments are blanked before the scan so a `[` or `]` inside a comment cannot fool the balance.

   THE CORPUS IS THE REAL FILE, PARSED. Not a hardcoded expectation of what admin-nav.js contains —
   that would be a third copy, and a third copy is a third thing that can drift. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { MODULE_KEYS } from "../src/orgs.js";
import { blankComments } from "../testkit/route-extract.mjs";

const NAV = readFileSync(new URL("../../web/assets/admin-nav.js", import.meta.url), "utf8");

/** The `window.BT_MODULES` array literal's exact source text, located by balancing brackets.
 *  @returns {string} the literal, from its opening `[` to its matching `]` inclusive. */
function moduleLiteral(src) {
  const s = blankComments(src);
  const at = s.indexOf("window.BT_MODULES");
  assert.notEqual(at, -1, "admin-nav.js no longer contains `window.BT_MODULES` — this guard is blind until that is fixed");
  const open = s.indexOf("[", at);
  assert.notEqual(open, -1, "`window.BT_MODULES` is no longer assigned an array literal");
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "[") depth++;
    else if (s[i] === "]" && --depth === 0) return s.slice(open, i + 1);
  }
  return assert.fail("`window.BT_MODULES`'s array literal is never closed — brackets are unbalanced");
}

/** The keys of the real `window.BT_MODULES`, engine-parsed. No regex reads the contents, so quote
 *  style, nesting, escapes and line breaks are the JS parser's problem rather than ours. */
function navKeys(src = NAV) {
  const value = vm.runInNewContext(`(${moduleLiteral(src)})`, Object.create(null), { timeout: 1000 });
  assert.ok(Array.isArray(value), "window.BT_MODULES did not evaluate to an array");
  // `Array.from`, NOT `value.map(...)`. THE CROSS-REALM TRAP, and it cost four red tests when this
  // file first moved to `vm`: a value built inside a vm context belongs to ANOTHER REALM and
  // carries that realm's `Array.prototype`. `Array.isArray` still says true — it is
  // realm-agnostic — but `assert/strict`'s deepEqual compares PROTOTYPE IDENTITY, so a
  // cross-realm array never equals a native `[]`, even when both are empty. `.map()` preserves
  // the foreign realm via species; `Array.from` is this realm's, so it hands back a native array.
  // The set-based assertions masked it because `sorted()` spreads into a native array first.
  return Array.from(value, (m) => m && m.key).filter(Boolean);
}

/** Order-free comparison. See NC-5 for why this is not `deepEqual` on the raw arrays. */
const sorted = (a) => [...a].sort();

/* `events` is grantable but never hideable — the ONE deliberate difference between the two lists.
   Named so the asymmetry is declared rather than buried in an off-by-one. */
const GRANT_ONLY = ["events"];

test("the corpus is real — BT_MODULES parses and is big enough to mean something", () => {
  const keys = navKeys();
  assert.ok(keys.length >= 10, `parsed only ${keys.length} keys out of admin-nav.js; the parser, not the list, is wrong`);
});

test("MODULE_KEYS is BT_MODULES' keys plus exactly the grant-only additions", () => {
  // SET comparison. MODULE_KEYS is a VOCABULARY — the gate asks "is this key in the list", never
  // "is it the fourth entry". Menu order is display order and a designer may reorder it; failing
  // the build for that is a false positive that teaches people the guard cries wolf. Duplicates
  // and collisions are asserted separately, because a set comparison hides both.
  assert.deepEqual(sorted(MODULE_KEYS), sorted([...navKeys(), ...GRANT_ONLY]));
});

test("no duplicates, and the two lists do not COLLIDE — what a set comparison would hide", () => {
  assert.equal(new Set(MODULE_KEYS).size, MODULE_KEYS.length, `MODULE_KEYS has a duplicate: ${MODULE_KEYS.join(", ")}`);
  const nav = navKeys();
  assert.equal(new Set(nav).size, nav.length, `BT_MODULES has a duplicate key: ${nav.join(", ")}`);
  // If `events` were ever added to BT_MODULES it would appear twice in the expected list and the
  // comparison above would fail with an opaque diff. This names the real cause instead.
  const collisions = nav.filter((k) => GRANT_ONLY.includes(k));
  assert.deepEqual(collisions, [],
    `these keys are in BT_MODULES AND declared grant-only, so the expected list double-counts them — remove them from GRANT_ONLY: ${collisions.join(", ")}`);
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
  const keys = navKeys(NAV.replace(anchor, '{ key: "newthing", label: "New", pages: ["x.html"] },\n    { key: "waivers",'));
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

test("NC-3: the parser reads SHIPPED keys, not commented-out ones", () => {
  const withComment = NAV.replace("window.BT_MODULES = [", 'window.BT_MODULES = [\n    // { key: "ghost", label: "Ghost", pages: [] },');
  assert.notEqual(withComment, NAV, "the mutation must land, or this NC proves nothing");
  assert.ok(!navKeys(withComment).includes("ghost"), "a commented-out entry is not a shipped module");
  assert.deepEqual(navKeys(withComment), navKeys(), "and removing it must leave the real list untouched");
});

test("NC-4: every quote style parses — a formatter must not blind this guard", () => {
  // MUTATION WIDENED v1.2: it was /\bkey: "([a-z]+)"/g, which silently stopped covering any key
  // containing a digit, hyphen, underscore or capital. `[^"]+` covers whatever the keys become.
  const real = navKeys();
  for (const [name, q] of [["single", "'"], ["backtick", "`"]]) {
    const mutated = NAV.replace(/\bkey:\s*"([^"]+)"/g, (_, k) => `key: ${q}${k}${q}`);
    assert.notEqual(mutated, NAV, `the ${name}-quote mutation must land, or this NC proves nothing`);
    assert.deepEqual(navKeys(mutated), real, `${name}-quoting the menu must not change the parsed keys`);
  }
});

test("NC-5: REORDERING the menu is deliberately NOT a failure — the false positive being avoided", () => {
  // The property the set comparison buys, asserted rather than left implicit. If someone later
  // "tightens" this back to deepEqual on raw arrays, this test goes red and explains why not to.
  const keys = navKeys();
  const reversed = [...keys].reverse();
  assert.notDeepEqual(reversed, keys, "the reversal must actually change the order");
  assert.deepEqual(sorted(MODULE_KEYS), sorted([...reversed, ...GRANT_ONLY]),
    "reordering the menu must NOT fail the pin — MODULE_KEYS is a vocabulary, not a sequence");
});

test("NC-6: a MALFORMED literal throws loudly instead of returning a short list", () => {
  // The whole reason the extractor moved off a contents-regex. A regex that stopped early would
  // return fewer keys and the suite would blame MODULE_KEYS for a divergence that never happened.
  const broken = NAV.replace('{ key: "reports",', '{ key: reports",');
  assert.notEqual(broken, NAV, "the mutation must land, or this NC proves nothing");
  assert.throws(() => navKeys(broken), "a literal that is not valid JavaScript must fail as a parse error, not silently");
});

test("NC-7: nested arrays inside an entry do not truncate the extraction", () => {
  // `pages: [...]` is already nested; this proves the balancer rather than luck. A non-greedy
  // regex terminating on the first `]` would have stopped inside the very first entry.
  assert.ok(moduleLiteral(NAV).includes("pages:"), "the literal must genuinely contain nested arrays, or this NC proves nothing");
  assert.ok(navKeys().includes("library"), "the LAST entry's key must be present — truncation would drop it");
});
