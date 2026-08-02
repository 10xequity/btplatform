/* Boomtown Platform — build-status registry guard
   File: worker/test/build_status.test.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.55.0

   WHY
   `web/assets/build-status.js` is the single registry testers read to know what is finished,
   what has a caveat, and what is not built. It is the only file in the repo whose PURPOSE is
   to be believed by a human who cannot read the code. That makes a stale entry more expensive
   than a stale comment: it manufactures bug reports about correct behaviour.

   By v0.54.0 it had drifted badly — 16 of 45 pages missing (so they rendered as "live" with no
   caveat, including admin-sms which cannot send at all), four shipped features still marked
   "soon", and one entry that was flatly WRONG: it told testers the door refuses a member with
   no current waiver, a gate REMOVED in v0.33.1 on the owner's instruction ("no gating").

   This guard holds the two things a machine can actually check:
     1. COVERAGE — every real web/*.html has a registry entry, and no entry is a ghost.
        Scans the widest set and counts itself (failure class 3 + 4).
     2. COPY vs CODE — no tester-facing text may claim a waiver gate while checkin.js has none.
        This is the specific defect that shipped; it gets a permanent ratchet, not a fix-and-hope.

   It cannot check whether a "beta" note is HONEST — that stays a human job. It checks that a
   page cannot go missing, and that the one claim we know went wrong cannot come back.

   Every verdict has a negative control that mutates the real input and proves it fails.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB = new URL("../../web/", import.meta.url);
const statusSrc = readFileSync(new URL("assets/build-status.js", WEB), "utf8");
const checkinSrc = readFileSync(new URL("../src/checkin.js", import.meta.url), "utf8");

/* ── pure verdicts — the real corpus and every NC go through these ── */

/** Registry keys, read from the PAGES block only (FEATURES must not leak in). */
export function pagesKeys(src) {
  const start = src.indexOf("const PAGES = {");
  const end = src.indexOf("2. FEATURES", start);
  assert.ok(start > 0 && end > start, "PAGES block markers missing — the guard would scan the wrong set");
  return new Set([...src.slice(start, end).matchAll(/"([a-z0-9-]+\.html)"\s*:/g)].map((m) => m[1]));
}

/** @returns {{missing:string[], ghost:string[], covered:number}} */
export function coverageVerdict(keys, diskPages) {
  const missing = diskPages.filter((f) => !keys.has(f));
  const ghost = [...keys].filter((k) => !diskPages.includes(k));
  return { missing, ghost, covered: diskPages.length - missing.length };
}

/** Strip JS comments. checkin.js's header DOCUMENTS the removal by naming the exact symbols it
    deleted, so a scan that reads comments finds the gate in the very text saying it is gone —
    the tokens.test.mjs / page_shell NC-4 lesson, in a new place. */
export function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * True when the real check-in source enforces a blocking waiver gate. The removal is recorded
 * as the ABSENCE of a 409 waiver_required response — the exact shape v1.2 used. Code only.
 */
export function checkinHasWaiverGate(src) {
  const code = stripJsComments(src);
  return /waiver_required\s*:\s*true/.test(code) || /waiverGateDecision\s*\(/.test(code);
}

/** Tester-facing sentences that assert a blocking gate. */
export function gateClaimsIn(src) {
  const claims = [];
  for (const re of [
    /refuses? a member with no current waiver/gi,
    /both refuse a member with no current waiver/gi,
    /waiver gate is live/gi,
    /check-in returns a block/gi,
  ]) {
    for (const m of src.matchAll(re)) claims.push(m[0]);
  }
  return claims;
}

/* ── coverage ── */

const diskPages = readdirSync(WEB).filter((f) => f.endsWith(".html"));

test("every page on disk has a build-status entry (widest set, self-counted)", () => {
  const v = coverageVerdict(pagesKeys(statusSrc), diskPages);
  assert.ok(diskPages.length >= 40,
    `guard floor: expected >=40 pages on disk, saw ${diskPages.length} — an empty scan must fail (failure class 4)`);
  assert.deepEqual(v.missing, [],
    `pages with no registry entry render as "live" with no caveat to testers: ${v.missing.join(", ")}`);
});

test("no registry entry points at a page that does not exist", () => {
  const v = coverageVerdict(pagesKeys(statusSrc), diskPages);
  assert.deepEqual(v.ghost, [],
    `registry names pages that are not in web/: ${v.ghost.join(", ")}`);
});

test("NC-1: a page added to web/ with no registry entry fails coverage", () => {
  const v = coverageVerdict(pagesKeys(statusSrc), [...diskPages, "admin-brand-new.html"]);
  assert.deepEqual(v.missing, ["admin-brand-new.html"],
    "a new page must fail until it is registered — this is the drift that produced v1.1");
});

test("NC-2: removing a real key from the registry fails coverage", () => {
  const keys = pagesKeys(statusSrc);
  keys.delete("admin-checkin.html");
  assert.ok(coverageVerdict(keys, diskPages).missing.includes("admin-checkin.html"));
});

test("NC-3: the PAGES scan must not silently swallow a broken block", () => {
  assert.throws(() => pagesKeys("const OTHER = {};"),
    "a missing PAGES block must throw, not return an empty set that passes everything");
});

/* ── copy vs code: the waiver-gate claim ── */

test("check-in still has no blocking waiver gate (owner 2026-07-29, D-MIN-8)", () => {
  assert.equal(checkinHasWaiverGate(checkinSrc), false,
    "a blocking waiver gate reappeared in checkin.js — the owner removed it deliberately; if this is intentional, update build-status copy in the same commit");
});

test("no tester-facing copy claims the door refuses an unwaivered member", () => {
  assert.deepEqual(gateClaimsIn(statusSrc), [],
    "build-status.js tells testers check-in blocks on a missing waiver. It does not (checkin.js v1.3). A tester will file correct behaviour as a bug — this is the v1.1 defect.");
});

test("NC-4: the old wrong sentences are still detectable if they return", () => {
  // Verbatim from build-status.js v1.0 — if the matcher stops catching these, the ratchet is
  // decorative and the exact regression that shipped could ship again unnoticed.
  const old = 'n: "The waiver gate is live: check-in returns a block if the member has no current waiver" ' +
              'n: "Check-in and walk-in both refuse a member with no current waiver."';
  assert.ok(gateClaimsIn(old).length >= 3, `expected to catch the v1.0 sentences, caught ${gateClaimsIn(old).length}`);
});

test("NC-5: the code-side gate detector can actually fire", () => {
  assert.equal(checkinHasWaiverGate('return json({ waiver_required: true }, 409);'), true);
  assert.equal(checkinHasWaiverGate('const d = waiverGateDecision(row);'), true);
});

test("NC-6: a gate named only inside a comment does NOT read as present", () => {
  // checkin.js's real header says: "REMOVED: waiverGateDecision(), … all three 409
  // { waiver_required: true } responses". Scanning raw text finds the gate in the sentence
  // announcing its deletion — the guard would fail forever, for the opposite of the reason
  // it exists. Caught here before it wasted anyone's afternoon.
  assert.equal(checkinHasWaiverGate('/* REMOVED: waiverGateDecision() and { waiver_required: true } */'), false);
  assert.equal(checkinHasWaiverGate('// waiver_required: true was deleted in v1.3'), false);
  // …but a comment must not HIDE a real one either: code after a comment still counts.
  assert.equal(checkinHasWaiverGate('/* gone */\nreturn json({ waiver_required: true }, 409);'), true);
});
