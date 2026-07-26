/* Boomtown Platform — Waitlists unit tests
   File: worker/test/waitlists.test.mjs · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.19.0
   Pure-function tests (same pattern as pos.test.mjs — no DB, no network). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIsFull, offerExpired, normalizeJoin, nextOfferExpiry } from "../src/waitlists.js";

/* ---------- computeIsFull ---------- */
test("no capacity (NULL/0) is never full", () => {
  assert.equal(computeIsFull(null, 999), false);
  assert.equal(computeIsFull(0, 999), false);
  assert.equal(computeIsFull(undefined, 5), false);
});
test("full exactly at capacity and beyond", () => {
  assert.equal(computeIsFull(12, 11), false);
  assert.equal(computeIsFull(12, 12), true);
  assert.equal(computeIsFull(12, 13), true);
});
test("string capacity from the DB row still works", () => {
  assert.equal(computeIsFull("10", 10), true);
  assert.equal(computeIsFull("10", 9), false);
});

/* ---------- offerExpired ---------- */
test("no expiry never expires; an unparseable expiry FAILS CLOSED", () => {
  assert.equal(offerExpired("2026-07-25T12:00:00Z", null), false);
  // Was false. A corrupt expires_at meant the claim link never expired — same fail-open
  // class as the capability-token defect in handoff 2.8 section 2a.
  assert.equal(offerExpired("2026-07-25T12:00:00Z", "not-a-date"), true);
  assert.equal(offerExpired("2026-07-25T12:00:00Z", ""), false);
});
test("expiry boundary — expired only strictly after", () => {
  assert.equal(offerExpired("2026-07-25T12:00:00Z", "2026-07-25 12:00:00"), false);
  assert.equal(offerExpired("2026-07-25T12:00:01Z", "2026-07-25 12:00:00"), true);
  assert.equal(offerExpired("2026-07-24T12:00:00Z", "2026-07-25 12:00:00"), false);
});

/* ---------- normalizeJoin ---------- */
test("valid join normalizes email + trims", () => {
  const v = normalizeJoin({ email: " Cap@Team.COM ", name: "  Ace Squad  ", phone: "719-555-0100", team_name: "Aces" });
  assert.equal(v.ok, true);
  assert.equal(v.value.email, "cap@team.com");
  assert.equal(v.value.name, "Ace Squad");
  assert.equal(v.value.team_name, "Aces");
});
test("bad email / missing name rejected", () => {
  assert.equal(normalizeJoin({ email: "nope", name: "X" }).ok, false);
  assert.equal(normalizeJoin({ email: "a@b.co", name: "  " }).ok, false);
  assert.equal(normalizeJoin({}).ok, false);
});
test("optional fields default to null, long values clamped", () => {
  const v = normalizeJoin({ email: "a@b.co", name: "N".repeat(300) });
  assert.equal(v.value.phone, null);
  assert.equal(v.value.team_name, null);
  assert.equal(v.value.name.length, 120);
});

/* ---------- nextOfferExpiry ---------- */
test("default TTL is 48h, SQLite format", () => {
  const t0 = Date.UTC(2026, 6, 25, 12, 0, 0);
  assert.equal(nextOfferExpiry(t0, undefined), "2026-07-27 12:00:00");
});
test("TTL clamps to 1..168 hours", () => {
  const t0 = Date.UTC(2026, 6, 25, 12, 0, 0);
  assert.equal(nextOfferExpiry(t0, 0.001), "2026-07-25 13:00:00");   // floor 1h
  assert.equal(nextOfferExpiry(t0, 100000), "2026-08-01 12:00:00");  // ceiling 168h
  assert.equal(nextOfferExpiry(t0, 24), "2026-07-26 12:00:00");
});
