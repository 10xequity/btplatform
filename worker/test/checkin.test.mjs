/* Boomtown Platform — Check-in unit tests
   File: worker/test/checkin.test.mjs · Version: v1.1 · Date: 2026-07-29 · Ships in: v0.33.1
   Pure-function tests (same pattern as waitlists.test.mjs — no DB, no network). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  balanceCents, OWED_STATUSES,
  waiverAdvisory, WAIVER_IDENTITY_MATCH, WAIVER_LIVE_PREDICATE,
} from "../src/checkin.js";

/* ---------- balanceCents ---------- */
test("owed statuses carry the full event price", () => {
  for (const s of OWED_STATUSES) {
    assert.equal(balanceCents(s, 4000), 4000, s);
  }
});

test("paid / comped / cancelled owe nothing", () => {
  assert.equal(balanceCents("paid", 4000), 0);
  assert.equal(balanceCents("comped", 4000), 0);
  assert.equal(balanceCents("cancelled", 4000), 0);
});

test("no registration at all owes nothing", () => {
  assert.equal(balanceCents(null, 4000), 0);
  assert.equal(balanceCents(undefined, 4000), 0);
  assert.equal(balanceCents("", 4000), 0);
});

test("string price from the DB row still works", () => {
  assert.equal(balanceCents("pending", "4000"), 4000);
});

test("free / garbage / negative prices clamp to zero balance", () => {
  assert.equal(balanceCents("pending", 0), 0);
  assert.equal(balanceCents("pending", null), 0);
  assert.equal(balanceCents("pending", "not-a-price"), 0);
  assert.equal(balanceCents("pending", -500), 0);
});

test("fractional cents round instead of leaking decimals into the chip", () => {
  assert.equal(balanceCents("cash-pending", 3999.6), 4000);
});

/* ---------- v1.3 waiver advisory (D-MIN-8 overrides D-WV-7) ----------
   These nine tests replace v1.0's nine waiverGateDecision tests. The gate is gone;
   what is tested now is that the replacement can never become a gate again. */

test("a live waiver reads as compliant", () => {
  const a = waiverAdvisory(true);
  assert.equal(a.compliant, true);
  assert.equal(a.level, "ok");
  assert.equal(a.detail, null, "nothing to nag about when the waiver is on file");
});

test("a missing waiver reads as non-compliant but still does not block", () => {
  const a = waiverAdvisory(false);
  assert.equal(a.compliant, false);
  assert.equal(a.level, "warn");
  assert.equal(a.blocks, false);
});

test("D-MIN-8: neither branch may ever block", () => {
  for (const ok of [true, false]) {
    assert.equal(waiverAdvisory(ok).blocks, false,
      "no gating anywhere — D-MIN-8, owner confirmation 2026-07-29");
  }
});

test("level is only ever ok or warn, so the chip cannot invent a third token", () => {
  for (const ok of [true, false]) {
    assert.ok(["ok", "warn"].includes(waiverAdvisory(ok).level));
  }
});

test("the missing-waiver message tells the member they can still play", () => {
  const a = waiverAdvisory(false);
  assert.match(a.detail, /can play|checked in/i,
    "a non-blocking chip that reads like a refusal is a gate in the user's head");
});

test("truthy and falsy inputs coerce, so a SQLite 1/0 works unchanged", () => {
  assert.equal(waiverAdvisory(1).compliant, true);
  assert.equal(waiverAdvisory(0).compliant, false);
});

test("advisory returns a fresh object each call — no shared mutable chip", () => {
  const a = waiverAdvisory(false);
  a.label = "mutated";
  assert.notEqual(waiverAdvisory(false).label, "mutated");
});

/* ---------- F-26 regression: one waiver predicate, not two ---------- */

test("F-26: the identity match lowercases BOTH sides of the email compare", () => {
  const sql = WAIVER_IDENTITY_MATCH("?2", "?3");
  assert.match(sql, /lower\(c\.email\)\s*=\s*lower\(\?3\)/,
    "a case-sensitive compare silently misses waivers on captain-entered emails");
});

test("F-26: the identity match still admits a direct contact-id hit", () => {
  assert.match(WAIVER_IDENTITY_MATCH("tm.contact_id", "tm.member_email"),
    /c\.id\s*=\s*tm\.contact_id/);
});

test("the live-waiver predicate excludes both deleted and expired rows", () => {
  assert.match(WAIVER_LIVE_PREDICATE, /w\.deleted_at IS NULL/);
  assert.match(WAIVER_LIVE_PREDICATE, /w\.expires_at\s*>\s*datetime\('now'\)/);
});

test("F-26: no raw case-sensitive email compare survives in any SQL in checkin.js", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../src/checkin.js", import.meta.url)), "utf8");

  // Scan ONLY inside SQL template literals, and only after comments are removed.
  // The first cut of this guard scanned the whole file and flagged four false positives:
  // three plain JS assignments (`email = null`) and the header comment that *describes*
  // the defect. An over-broad guard that fires on prose is the schema-gate `2026` bug
  // again — narrow it to the thing it actually guards.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^[ \t]*\/\/.*$/gm, "");   // line comments
  const sqlLiterals = code.match(/`[^`]*`/g) || [];

  // Matches a bare `<something>email <=>` compare. A compare already wrapped as
  // lower(c.email) = ... has a ')' between the column and the '=', so it cannot match.
  const BARE_EMAIL_COMPARE = /(?:\w+\.)?\w*email\b\s*=/gi;

  const offenders = sqlLiterals
    .filter(sql => /\b(SELECT|WHERE|JOIN)\b/i.test(sql))
    .flatMap(sql => sql.match(BARE_EMAIL_COMPARE) || []);

  assert.deepEqual(offenders, [],
    `case-sensitive email compare(s) reintroduced in SQL: ${JSON.stringify(offenders)}`);
});

test("F-26: the guard above can actually fail (negative control)", () => {
  // A guard that cannot fail is worse than no guard — library_v1_0 §2 failure class 3.
  const BARE_EMAIL_COMPARE = /(?:\w+\.)?\w*email\b\s*=/gi;
  assert.ok("SELECT 1 WHERE c.email = tm.member_email".match(BARE_EMAIL_COMPARE),
    "must flag the exact v1.2 defect");
  assert.equal("SELECT 1 WHERE lower(c.email) = lower(?3)".match(BARE_EMAIL_COMPARE), null,
    "must not flag the v1.3 fix");
});

test("the removed gate exports are gone, not merely unused", async () => {
  const mod = await import("../src/checkin.js");
  assert.equal(mod.waiverGateDecision, undefined,
    "D-WV-7's gate must not linger as a dead export waiting to be re-wired");
  assert.equal(mod.OVERRIDE_MIN_CHARS, undefined);
});

/* Changelog:
   v1.1 (2026-07-29) — removed the 9 waiverGateDecision tests (the gate is gone per
     D-MIN-8) and added 13: 7 covering waiverAdvisory's non-blocking contract, 5 guarding
     F-26's single email-match definition (one reads checkin.js source, because the
     original divergence lived in two SQL literals no behavioural test reached; one is a
     negative control proving that guard can fail), and 1 asserting the retired gate
     exports are absent rather than dormant.
     File goes 15 tests → 19, VERIFIED by running it, not asserted.
     Note: v1.0's changelog claimed 7 balanceCents tests. There are 6. Corrected here
     rather than carried forward.
   v1.0 (2026-07-25) — balanceCents + OWED_STATUSES coverage (6 tests, mislabelled 7). */
