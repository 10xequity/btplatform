/**
 * Boomtown Platform — tiers.js tests
 * File: worker/test/tiers.test.mjs · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.26.0
 *
 * Entitlement resolution is a credential decision, so the fail-closed direction is asserted
 * explicitly rather than assumed: a corrupt date must never widen access.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveGrant, tierMeetsMin, tierCode, applyTierDiscount,
  validateBulk, withTag, withoutTag, BULK_MAX, TZ_WHITELIST,
} from "../src/tiers.js";
import { SUPPORTED_TZIDS, DEFAULT_TZID } from "../src/calendar.js";

const NOW = new Date("2026-07-26T12:00:00Z");
const g = (o) => ({ id: 1, tier_id: 1, rank: 10, starts_at: "2026-01-01 00:00:00", ends_at: null, deleted_at: null, ...o });

/* ---------- effectiveGrant ---------- */

test("effectiveGrant: no grants means no tier", () => {
  assert.equal(effectiveGrant([], NOW), null);
  assert.equal(effectiveGrant(null, NOW), null);
  assert.equal(effectiveGrant(undefined, NOW), null);
});

test("effectiveGrant: the highest rank wins, not the newest", () => {
  const live = effectiveGrant([
    g({ id: 1, rank: 10, tier_id: 1, starts_at: "2026-07-01 00:00:00" }),
    g({ id: 2, rank: 30, tier_id: 3, starts_at: "2026-01-01 00:00:00" }),
    g({ id: 3, rank: 20, tier_id: 2, starts_at: "2026-07-20 00:00:00" }),
  ], NOW);
  assert.equal(live.tier_id, 3, "rank 30 outranks a more recent rank 20");
});

test("effectiveGrant: among equal ranks the most recent start wins", () => {
  const live = effectiveGrant([
    g({ id: 1, rank: 10, tier_id: 1, starts_at: "2026-01-01 00:00:00" }),
    g({ id: 2, rank: 10, tier_id: 9, starts_at: "2026-07-01 00:00:00" }),
  ], NOW);
  assert.equal(live.tier_id, 9);
});

test("effectiveGrant: a future grant is not yet in force", () => {
  assert.equal(effectiveGrant([g({ starts_at: "2026-12-01 00:00:00" })], NOW), null);
});

test("effectiveGrant: an ended grant is not in force; the boundary is exclusive", () => {
  assert.equal(effectiveGrant([g({ ends_at: "2026-07-25 00:00:00" })], NOW), null);
  assert.equal(effectiveGrant([g({ ends_at: "2026-07-26 12:00:00" })], NOW), null, "ends exactly now = ended");
  assert.ok(effectiveGrant([g({ ends_at: "2026-07-26 12:00:01" })], NOW), "one second left is still live");
});

test("effectiveGrant: a soft-deleted grant is ignored", () => {
  assert.equal(effectiveGrant([g({ deleted_at: "2026-07-01 00:00:00" })], NOW), null);
});

test("effectiveGrant: a NULL ends_at is open-ended, not expired", () => {
  assert.ok(effectiveGrant([g({ ends_at: null })], NOW));
});

test("effectiveGrant: corrupt dates FAIL CLOSED, never granting access", () => {
  // A garbage ends_at must not read as "no end date". Same direction as the capability-token
  // and waitlist-claim fixes — an unparseable timestamp on a credential means denied.
  assert.equal(effectiveGrant([g({ ends_at: "not-a-date" })], NOW), null);
  assert.equal(effectiveGrant([g({ starts_at: "garbage" })], NOW), null);
});

test("effectiveGrant: SQLite datetime and ISO forms both parse", () => {
  assert.ok(effectiveGrant([g({ starts_at: "2026-07-01 00:00:00" })], NOW));
  assert.ok(effectiveGrant([g({ starts_at: "2026-07-01T00:00:00Z" })], NOW));
  assert.ok(effectiveGrant([g({ starts_at: "2026-07-01T00:00:00-06:00" })], NOW));
});

/* ---------- tierMeetsMin ---------- */

test("tierMeetsMin: no gate always passes, even holding nothing", () => {
  assert.equal(tierMeetsMin(null, null), true);
  assert.equal(tierMeetsMin(10, null), true);
});

test("tierMeetsMin: a gate with no tier held is denied", () => {
  assert.equal(tierMeetsMin(null, 10), false);
});

test("tierMeetsMin: equal rank passes, lower is denied", () => {
  assert.equal(tierMeetsMin(10, 10), true);
  assert.equal(tierMeetsMin(20, 10), true);
  assert.equal(tierMeetsMin(9, 10), false);
});

test("tierMeetsMin: non-numeric ranks fail closed", () => {
  assert.equal(tierMeetsMin("abc", 10), false);
  assert.equal(tierMeetsMin(10, "abc"), false);
});

/* ---------- tierCode / applyTierDiscount ---------- */

test("tierCode slugs a name into a stable key", () => {
  assert.equal(tierCode("All-Access"), "all_access");
  assert.equal(tierCode("  Silver 2026 !! "), "silver_2026");
  assert.equal(tierCode(""), "tier");
  assert.equal(tierCode("!!!"), "tier");
});

test("applyTierDiscount: basis points, integer cents, never negative", () => {
  assert.equal(applyTierDiscount(5000, 0), 5000);
  assert.equal(applyTierDiscount(5000, 500), 4750);   // 5% off
  assert.equal(applyTierDiscount(5000, 10000), 0);    // 100% off
  assert.equal(applyTierDiscount(5000, 99999), 0, "over 100% clamps to free, never negative");
  assert.equal(applyTierDiscount(5000, -100), 5000, "a negative discount must not raise the price");
  assert.equal(applyTierDiscount(3333, 1000), 3000);
  assert.equal(applyTierDiscount(0, 500), 0);
});

/* ---------- validateBulk ---------- */

test("validateBulk: rejects unknown actions", () => {
  assert.equal(validateBulk({ action: "delete_everything", contact_ids: [1] }).ok, false);
});

test("validateBulk: requires at least one id", () => {
  assert.equal(validateBulk({ action: "export", contact_ids: [] }).ok, false);
  assert.equal(validateBulk({ action: "export" }).ok, false);
});

test("validateBulk: de-duplicates and drops junk ids", () => {
  const v = validateBulk({ action: "export", contact_ids: [3, 3, "4", 0, -1, null, "abc", 5] });
  assert.deepEqual(v.ids, [3, 4, 5]);
});

test("validateBulk: caps the batch size", () => {
  const many = Array.from({ length: BULK_MAX + 1 }, (_, i) => i + 1);
  const v = validateBulk({ action: "export", contact_ids: many });
  assert.equal(v.ok, false);
  assert.match(v.error, /narrow the selection/);
  assert.equal(validateBulk({ action: "export", contact_ids: many.slice(0, BULK_MAX) }).ok, true);
});

test("validateBulk: tag actions need a usable tag", () => {
  assert.equal(validateBulk({ action: "add_tag", contact_ids: [1] }).ok, false);
  assert.equal(validateBulk({ action: "add_tag", contact_ids: [1], tag: "   " }).ok, false);
  assert.equal(validateBulk({ action: "add_tag", contact_ids: [1], tag: "x".repeat(41) }).ok, false);
  assert.equal(validateBulk({ action: "add_tag", contact_ids: [1], tag: "League 2026" }).ok, true);
});

test("validateBulk: grant_tier needs a tier", () => {
  assert.equal(validateBulk({ action: "grant_tier", contact_ids: [1] }).ok, false);
  assert.equal(validateBulk({ action: "grant_tier", contact_ids: [1], tier_id: 2 }).ok, true);
});

/* ---------- tag merge ---------- */

test("withTag adds without duplicating, case-insensitively", () => {
  assert.equal(withTag("[]", "League"), '["League"]');
  assert.equal(withTag('["League"]', "league"), '["League"]', "must not add a case variant twice");
  assert.equal(withTag('["A"]', "B"), '["A","B"]');
});

test("withTag / withoutTag survive corrupt JSON instead of throwing", () => {
  // A malformed tags_json must not take down a bulk action for 400 other members.
  assert.equal(withTag("{not json", "X"), '["X"]');
  assert.equal(withoutTag("{not json", "X"), "[]");
  assert.equal(withTag(null, "X"), '["X"]');
  assert.equal(withTag('{"a":1}', "X"), '["X"]', "a non-array parse is discarded");
});

test("withoutTag removes case-insensitively and leaves the rest", () => {
  assert.equal(withoutTag('["League","Junior"]', "league"), '["Junior"]');
  assert.equal(withoutTag('["Junior"]', "missing"), '["Junior"]');
});

/* ---------- timezone whitelist must not drift from the calendar layer ---------- */

test("every settable timezone can actually be emitted as a VTIMEZONE", () => {
  // The settings route whitelists zones; calendar.js knows the DST rules. If these drift, an
  // owner can save a zone that silently falls back to Denver and every event lands hours off.
  for (const tz of TZ_WHITELIST) {
    assert.ok(SUPPORTED_TZIDS.includes(tz), `${tz} is settable but calendar.js has no rules for it`);
  }
  assert.ok(TZ_WHITELIST.includes(DEFAULT_TZID), "the default zone must be settable");
});
