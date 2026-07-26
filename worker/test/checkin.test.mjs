/* Boomtown Platform — Check-in unit tests
   File: worker/test/checkin.test.mjs · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.21.0
   Pure-function tests (same pattern as waitlists.test.mjs — no DB, no network). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceCents, OWED_STATUSES } from "../src/checkin.js";

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

/* Changelog: v1.0 (2026-07-25) — balanceCents + OWED_STATUSES coverage (7 tests). */

/* ---------- v1.2 waiver gate (D-WV-7) ---------- */
import { waiverGateDecision, OVERRIDE_MIN_CHARS } from "../src/checkin.js";

test("a valid waiver passes cleanly with no override recorded", () => {
  const g = waiverGateDecision(true, null, true);
  assert.equal(g.allow, true);
  assert.equal(g.overridden, false);
  assert.equal(g.reason, null);
});

test("a valid waiver ignores a supplied override reason", () => {
  const g = waiverGateDecision(true, "signed at desk anyway", true);
  assert.equal(g.overridden, false, "must not log an override that wasn't needed");
});

test("no waiver and no reason is refused", () => {
  const g = waiverGateDecision(false, null, true);
  assert.equal(g.allow, false);
  assert.match(g.error, /waiver/i);
});

test("a too-short override reason is refused and says so", () => {
  const g = waiverGateDecision(false, "ok", true);
  assert.equal(g.allow, false);
  assert.match(g.error, new RegExp(String(OVERRIDE_MIN_CHARS)));
});

test("whitespace padding does not satisfy the minimum", () => {
  assert.equal(waiverGateDecision(false, "   " + "a".repeat(3) + "   ", true).allow, false);
});

test("a real override reason is allowed and captured for the audit row", () => {
  const g = waiverGateDecision(false, "signed paper copy at front desk", true);
  assert.equal(g.allow, true);
  assert.equal(g.overridden, true);
  assert.equal(g.reason, "signed paper copy at front desk");
});

test("the override reason is trimmed before it is stored", () => {
  assert.equal(waiverGateDecision(false, "  paper copy on file  ", true).reason, "paper copy on file");
});

test("the public self-check-in path can NEVER override", () => {
  const g = waiverGateDecision(false, "just let me in please", false);
  assert.equal(g.allow, false, "a player must not be able to wave themselves through");
  assert.equal(g.overridden, false);
});

test("public path with a valid waiver still passes", () => {
  assert.equal(waiverGateDecision(true, null, false).allow, true);
});
