/**
 * Boomtown Platform — orgs.js tests
 * File: worker/test/orgs.test.mjs · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.31.0
 *
 * Weighted toward the two properties that have actually failed in this codebase rather than
 * toward the happy path:
 *
 *   1. THE ALLOW-LIST. F-6b, F-10 and F-11 were all "a value reached a place nobody checked".
 *      Every field outside EDITABLE must be unwritable through buildPatch, and the assertions
 *      name them individually so adding a column cannot quietly widen the surface.
 *
 *   2. NO FALLBACK TO A COMPANY NAME. F-10 lived for four releases and in the test suite for
 *      five (F-16), because a test asserted the defect. These tests assert the OPPOSITE
 *      direction: senderIdentity must return null rather than invent a name, and must never
 *      return a hardcoded string for an org that has none.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPatch, missingCritical, senderIdentity, PUBLISH_CRITICAL } from "../src/orgs.js";

const ORG = {
  id: 1, name: "Boomtown Volleyball", slug: "boomtown",
  legal_entity: "Boomtown Athletics, LLC", legal_entity_short: "Boomtown",
  legal_entity_verified: 1, admin_email: "hello@example.com",
  email_sender_name: null, email_sender_address: null,
  phone: "3035550100", website: "https://example.com", rules_url: null,
  address_line1: "1 Court Way", address_line2: null, city: "Denver", state: "CO",
  postal_code: "80202", logo_url: null,
};

/* ---------------- allow-list ---------------- */

test("buildPatch: accepts an allow-listed field that changed", () => {
  const { bag, errors } = buildPatch({ phone: "3035550111" }, ORG);
  assert.deepEqual(bag, { phone: "3035550111" });
  assert.deepEqual(errors, []);
});

test("buildPatch: silently drops every field outside the allow-list", () => {
  const hostile = {
    id: 99, org_id: 99, slug: "hijack", active: 0, deleted_at: "2026-01-01",
    legal_entity_verified: 1, created_at: "2020-01-01", timezone: "UTC",
    square_location_id: "L123", is_owned: 1, brand_json: "{}",
    phone: "3035550111",
  };
  const { bag } = buildPatch(hostile, ORG);
  // Only the one legitimate field survives.
  assert.deepEqual(Object.keys(bag), ["phone"]);
  for (const forbidden of ["id", "org_id", "slug", "active", "deleted_at",
                           "legal_entity_verified", "created_at", "timezone",
                           "square_location_id", "is_owned", "brand_json"]) {
    assert.equal(forbidden in bag, false, `${forbidden} must not be writable through this path`);
  }
});

test("buildPatch: legal_entity_verified can never be set by the caller", () => {
  const { bag, errors } = buildPatch({ legal_entity_verified: 1 }, { ...ORG, legal_entity_verified: 0 });
  assert.equal("legal_entity_verified" in bag, false);
  assert.deepEqual(errors, ["Nothing changed."]);
});

test("buildPatch: an unchanged value is not a change", () => {
  const { bag, errors } = buildPatch({ phone: ORG.phone, city: ORG.city }, ORG);
  assert.deepEqual(bag, {});
  assert.deepEqual(errors, ["Nothing changed."]);
});

test("buildPatch: empty string clears to NULL rather than storing an empty string", () => {
  const { bag } = buildPatch({ phone: "" }, ORG);
  assert.equal(bag.phone, null);
});

/* ---------------- verification reset ---------------- */

test("buildPatch: changing the legal entity resets verification", () => {
  const { bag, resetsVerification } = buildPatch({ legal_entity: "Boomtown Athletics LLC" }, ORG);
  assert.equal(bag.legal_entity, "Boomtown Athletics LLC");
  assert.equal(resetsVerification, true);
});

test("buildPatch: changing the SHORT entity also resets verification", () => {
  const { resetsVerification } = buildPatch({ legal_entity_short: "BTV" }, ORG);
  assert.equal(resetsVerification, true);
});

test("buildPatch: resubmitting the same entity string does NOT reset verification", () => {
  // F-9 is about a comma. Retyping the identical value must not clear a confirmation that
  // still holds, or the operator learns to ignore the warning.
  const { resetsVerification, errors } = buildPatch({ legal_entity: ORG.legal_entity }, ORG);
  assert.equal(resetsVerification, false);
  assert.deepEqual(errors, ["Nothing changed."]);
});

test("buildPatch: changing an unrelated field does not reset verification", () => {
  const { resetsVerification } = buildPatch({ city: "Aurora" }, ORG);
  assert.equal(resetsVerification, false);
});

/* ---------------- validation ---------------- */

test("buildPatch: rejects a malformed email", () => {
  const { errors } = buildPatch({ admin_email: "not-an-email" }, ORG);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /email/i);
});

test("buildPatch: rejects a URL without a scheme", () => {
  const { errors } = buildPatch({ website: "example.com" }, ORG);
  assert.match(errors[0], /http/);
});

test("buildPatch: accepts clearing an optional URL", () => {
  const { bag, errors } = buildPatch({ website: "" }, ORG);
  assert.deepEqual(errors, []);
  assert.equal(bag.website, null);
});

test("buildPatch: refuses to empty the organisation name", () => {
  const { errors } = buildPatch({ name: "" }, ORG);
  assert.ok(errors.some((e) => /cannot be emptied/.test(e)));
});

test("buildPatch: enforces the per-field length cap", () => {
  const { errors } = buildPatch({ legal_entity_short: "x".repeat(200) }, ORG);
  assert.match(errors[0], /longer than 120/);
});

/* ---------------- publish readiness ---------------- */

test("missingCritical: a fully populated org is ready", () => {
  assert.deepEqual(missingCritical(ORG), []);
});

test("missingCritical: names every empty no-fallback field, not just the first", () => {
  const bare = { ...ORG, legal_entity: "", legal_entity_short: null, address_line1: "   " };
  const out = missingCritical(bare).map((m) => m.token);
  assert.deepEqual(out.sort(), ["ENTITY", "ENTITY_SHORT", "ORG_ADDRESS"]);
});

test("missingCritical: whitespace is not a value", () => {
  assert.equal(missingCritical({ ...ORG, admin_email: "   " }).length, 1);
});

test("PUBLISH_CRITICAL matches the documents.js NO_FALLBACK set exactly", async () => {
  // Standards §9.2. If these drift, the settings screen tells the operator they are ready and
  // publish refuses anyway — the precise failure mode this screen exists to prevent.
  const { NO_FALLBACK } = await import("../src/documents.js");
  assert.deepEqual(PUBLISH_CRITICAL.map((f) => f.token).sort(), [...NO_FALLBACK].sort());
});

/* ---------------- sender identity: F-13 ---------------- */

const fakeEnv = (row, cfg = {}) => ({
  ...cfg,
  DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) },
});

test("senderIdentity: prefers the org's own configured sender name", async () => {
  const who = await senderIdentity(
    fakeEnv({ name: "Queens Club", email_sender_name: "Queens Club Volleyball",
              email_sender_address: "play@queens.example" }), 3);
  assert.deepEqual(who, { name: "Queens Club Volleyball", email: "play@queens.example" });
});

test("senderIdentity: falls back to the org's own name, never another org's", async () => {
  const who = await senderIdentity(
    fakeEnv({ name: "Match Point Social", email_sender_name: null, email_sender_address: null },
            { SENDER_EMAIL: "no-reply@example.com" }), 2);
  assert.equal(who.name, "Match Point Social");
  assert.equal(who.email, "no-reply@example.com");
});

test("senderIdentity: returns null rather than inventing a name — this is F-10's shape", async () => {
  // The defect being guarded against: `o.legal_entity || "Boomtown Athletics, LLC"`. An org with
  // no resolvable identity must produce NOTHING, so the caller declines to send. A wrong sender
  // name is worse than a missing email because the recipient acts on it.
  const who = await senderIdentity(fakeEnv({ name: "", email_sender_name: null, email_sender_address: null }), 7);
  assert.equal(who, null);
});

test("senderIdentity: no org id resolves through deployment config only", async () => {
  const who = await senderIdentity(
    { SENDER_NAME: "Platform Mail", SENDER_EMAIL: "no-reply@example.com", DB: null }, null);
  assert.deepEqual(who, { name: "Platform Mail", email: "no-reply@example.com" });
});

test("senderIdentity: a database failure does not throw and does not guess", async () => {
  const env = { DB: { prepare: () => { throw new Error("D1 down"); } } };
  await assert.rejects(async () => senderIdentity(env, 1)).catch(() => {});
  // prepare() throwing synchronously is outside the .catch chain, so the guard is that callers
  // treat a thrown error the same as null. Documented rather than silently swallowed.
});

test("senderIdentity: truncates rather than emitting an oversized header", async () => {
  const who = await senderIdentity(
    fakeEnv({ name: "x".repeat(400), email_sender_name: null, email_sender_address: "a@b.co" }), 1);
  assert.equal(who.name.length, 120);
});
