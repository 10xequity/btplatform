/**
 * Boomtown Platform — registration pure-helper tests
 * File: worker/test/registrations.test.mjs · Version: v1.0 · Date: 2026-07-29 · Ships in: v0.34.0
 *
 * First coverage for a 54 KB module. Scope is deliberately what v1.7 made pure and exported —
 * the status gate shared by remind/rerun, the webhook signature comparison, and escapeHtml —
 * not a D1 fake driving the router (Option C was declined 2026-07-29; nothing in this repo
 * fakes D1, and an untested harness is a new unguarded surface).
 *
 * The minor/DOB gate inside submitRegistration is NOT re-tested here: it delegates to
 * family.js validateBirthdate/guardianGate, which family.test.mjs already guards. Testing it
 * again through a different door is how F-16 got a second copy of a defect into the suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REMINDABLE_STATUSES, canRemind, timingSafeEqual, escapeHtml,
} from "../src/registrations.js";

/* ---------- canRemind — one list, two gates (remind + retry-payment) ---------- */

test("canRemind: exactly pending and email-sent, nothing else", () => {
  assert.deepEqual(REMINDABLE_STATUSES, ["pending", "email-sent"]);
  assert.equal(canRemind("pending"), true);
  assert.equal(canRemind("email-sent"), true);
  for (const s of ["paid", "cancelled", "cash-pending", "", undefined, null, "PENDING"]) {
    assert.equal(canRemind(s), false, `'${s}' must not be remindable`);
  }
});

test("canRemind: cash-pending is excluded on purpose — a nudge to pay online contradicts req 9", () => {
  // Requirement 9's cash flag exists so staff settle these at the desk. A payment-link reminder
  // to a cash registrant is the system arguing with itself.
  assert.equal(canRemind("cash-pending"), false);
});

/* ---------- timingSafeEqual — the Square webhook comparison ---------- */

test("timingSafeEqual: equal strings true, unequal false", () => {
  assert.equal(timingSafeEqual("abc123", "abc123"), true);
  assert.equal(timingSafeEqual("abc123", "abc124"), false);
  assert.equal(timingSafeEqual("", ""), true);
});

test("timingSafeEqual: length mismatch is false, never a throw", () => {
  assert.equal(timingSafeEqual("short", "longer-value"), false);
  assert.equal(timingSafeEqual("longer-value", "short"), false);
});

/* ---------- escapeHtml — every registrant-typed string passes through this ---------- */

test("escapeHtml: the five HTML metacharacters, and nothing invented", () => {
  assert.equal(escapeHtml(`<script>alert("x&y'z")</script>`),
    "&lt;script&gt;alert(&quot;x&amp;y&#39;z&quot;)&lt;/script&gt;");
  assert.equal(escapeHtml("Team Ace & Co"), "Team Ace &amp; Co");
});

test("escapeHtml: idempotence is NOT expected — double-escaping is visible, not exploitable", () => {
  // If a template ever escapes twice the user sees '&amp;amp;' — ugly and safe. The dangerous
  // direction is zero escapes; this pins the single-pass output so a 'helpful' unescape shows up.
  assert.equal(escapeHtml(escapeHtml("&")), "&amp;amp;");
});

test("escapeHtml: null/undefined coerce to safe strings rather than crashing an email render", () => {
  assert.equal(typeof escapeHtml(null), "string");
  assert.equal(typeof escapeHtml(undefined), "string");
  assert.ok(!escapeHtml(null).includes("<"));
});
