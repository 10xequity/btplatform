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
