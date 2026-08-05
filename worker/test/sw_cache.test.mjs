/**
 * Boomtown Platform — service-worker cache honesty (roadmap §-1 Block C, audit R3)
 * File: worker/test/sw_cache.test.mjs · Version: v1.0 · Date: 2026-08-05 · Ships in: v0.89.0
 *
 * WHY (audit §3): web/sw.js pinned CACHE = "bt-shell-v1" from v0.20.0 through v0.87.0 — 67
 * releases — and `activate` only evicts keys !== CACHE, so the cache was NEVER invalidated.
 * The offline fallback matched with `ignoreSearch: true`, so a cached ?v=0.60.0 asset could
 * satisfy a ?v=0.87.0 request: one failed fetch left new HTML running old JS/CSS, which is the
 * best explanation for tester breakage a clean browser could not reproduce.
 *
 * WHAT THIS GUARDS:
 *   1. The cache name DERIVES from the release buster (the literal sweep-buster.mjs rewrites),
 *      so every deploy invalidates, and the first activation of this SW purges the poisoned
 *      "bt-shell-v1" in every tester browser. (asset_versions.test.mjs already ties the buster
 *      VALUE to the version index.js reports — this file guards the DERIVATION, not the value,
 *      per C14: two guards must not assert the same thing from the same source.)
 *   2. The fallback match is EXACT — `ignoreSearch` must not return anywhere in sw.js.
 *   3. `activate` still evicts every cache whose key differs from the current name.
 * Negative controls mutate the REAL file and reconstruct the REAL historical defect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SW = readFileSync(new URL("../../web/sw.js", import.meta.url), "utf8");

/* Check the set that ships BEHAVIOUR (standing rule, five instances now): sw.js's own header
   documents the retired ignoreSearch defect, so a raw string scan trips on the comment about
   the rule. Strip comments first — and NC-4 proves the stripping can fail, so it cannot become
   a quiet way of switching the check off. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/* Pure verdicts so the NCs can run the real source, mutated. */
const derivedCacheVerdict = (src) =>
  /const V = \("\?v=[0-9][0-9.]*"\)\.slice\(3\)/.test(src) && // the swept literal…
  src.includes('const CACHE = "bt-shell-v" + V') &&           // …feeding the cache name
  !/const CACHE = "bt-shell-v\d+"/.test(src);                 // and never a frozen name again
const exactFallbackVerdict = (src) => !stripComments(src).includes("ignoreSearch");
const evictionVerdict = (src) =>
  src.includes("for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);");

test("sw.js derives its cache name from the swept release buster (never a frozen literal)", () => {
  assert.ok(derivedCacheVerdict(SW),
    "the cache name no longer derives from the buster — the next 67 releases would share one cache again (audit R3)");
});

test("sw.js offline fallback matches the exact URL — ignoreSearch is retired", () => {
  assert.ok(exactFallbackVerdict(SW),
    "ignoreSearch returned — a cached ?v=old asset could satisfy a ?v=new request again");
});

test("sw.js activate still evicts every cache that is not the current one", () => {
  assert.ok(evictionVerdict(SW),
    "the activate eviction loop is gone — old caches (including bt-shell-v1) would survive a deploy");
});

/* ── negative controls — the REAL historical defect, reconstructed in the real file ── */

test("NC-1: the v1.0 frozen cache name fails the derivation verdict", () => {
  const mutated = SW
    .replace(/const V = \("\?v=[0-9][0-9.]*"\)\.slice\(3\);[^\n]*\n/, "")
    .replace('const CACHE = "bt-shell-v" + V', 'const CACHE = "bt-shell-v1"');
  assert.notEqual(mutated, SW, "mutation did not land — NC is vacuous");
  assert.equal(derivedCacheVerdict(mutated), false,
    "the exact defect that lived 67 releases must fail this guard");
});

test("NC-2: reintroducing ignoreSearch on the real fallback line fails the exact-match verdict", () => {
  const mutated = SW.replace("await caches.match(req)", "await caches.match(req, { ignoreSearch: true })");
  assert.notEqual(mutated, SW, "mutation did not land — NC is vacuous");
  assert.equal(exactFallbackVerdict(mutated), false);
});

test("NC-3: dropping the eviction loop fails the eviction verdict", () => {
  const mutated = SW.replace("for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);", "");
  assert.notEqual(mutated, SW, "mutation did not land — NC is vacuous");
  assert.equal(evictionVerdict(mutated), false);
});

test("NC-4: the comment-stripper itself can fail — ignoreSearch in CODE is seen, in a COMMENT is not", () => {
  // Both halves, so the stripper can neither hide real code nor be quietly deleted:
  const inCode = SW.replace("await caches.match(req)", "await caches.match(req, { ignoreSearch: true })");
  assert.equal(exactFallbackVerdict(inCode), false, "ignoreSearch in shipping code must fail even with stripping");
  assert.ok(SW.includes("ignoreSearch"), "the raw file mentions ignoreSearch in its header — the fixture NC-4 depends on");
  assert.equal(exactFallbackVerdict(SW), true, "a comment-only mention must pass — otherwise the guard trips on its own documentation");
});
