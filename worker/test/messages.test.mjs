// Boomtown Platform — messages.js unit tests (M14 Phase B)
// File: worker/test/messages.test.mjs · Version: v1.1 · Date: 2026-07-25 · Ships in: v0.21.0
import test from "node:test";
import assert from "node:assert/strict";
import { tierClause, buildLibraryWhere, relayEmailHtml, overFlood, muteUntilIso, normalizeMuteBody } from "../src/messages.js";

test("tierClause: anonymous visitors only see public profiles", () => {
  assert.equal(tierClause(false, false), "p.visibility = 'public'");
});

test("tierClause: signed-in members see public + members tiers, never private", () => {
  const c = tierClause(true, false);
  assert.match(c, /'public'/);
  assert.match(c, /'members'/);
  assert.doesNotMatch(c, /'private'/);
});

test("tierClause: staff see everything (spec §3.4 — admin can always view)", () => {
  assert.equal(tierClause(true, true), "1=1");
});

test("buildLibraryWhere: empty filter adds nothing", () => {
  const { where, binds } = buildLibraryWhere({});
  assert.equal(where, "");
  assert.deepEqual(binds, []);
});

test("buildLibraryWhere: one placeholder per active filter, in order", () => {
  const { where, binds } = buildLibraryWhere({ q: "Ana", position: "setter", level: "BB", gender: "womens" });
  assert.equal((where.match(/\?/g) || []).length, 4);
  assert.deepEqual(binds, ["Ana", "setter", "BB", "womens"]);
});

test("buildLibraryWhere: position matches inside the CSV positions field", () => {
  const { where } = buildLibraryWhere({ position: "outside" });
  assert.match(where, /instr\(lower\(coalesce\(p\.positions,''\)\), lower\(\?\)\)/);
});

test("buildLibraryWhere: blank / whitespace filters are ignored", () => {
  const { where, binds } = buildLibraryWhere({ q: "  ", level: "" });
  assert.equal(where, "");
  assert.deepEqual(binds, []);
});

test("relayEmailHtml: escapes HTML in name and body (no injection into the email)", () => {
  const html = relayEmailHtml('<img src=x onerror=1>', 'hi <script>alert(1)</script>', "https://x/inbox");
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
});

test("relayEmailHtml: never contains an email address — relay keeps addresses private", () => {
  const html = relayEmailHtml("Jordan P", "call me maybe", "https://site/member-inbox.html");
  assert.doesNotMatch(html, /@/);
  assert.match(html, /member-inbox\.html/);
  assert.match(html, /Jordan P/);
});

test("relayEmailHtml: preserves line breaks as <br>", () => {
  const html = relayEmailHtml("A", "line1\nline2", "https://x");
  assert.match(html, /line1<br>line2/);
});

test("overFlood: at or above the limit blocks; below passes", () => {
  assert.equal(overFlood(10, 10), true);
  assert.equal(overFlood(11, 10), true);
  assert.equal(overFlood(9, 10), false);
  assert.equal(overFlood(0, 10), false);
  assert.equal(overFlood(undefined, 10), false);
});

/* ---------- v1.1: one-click mute helpers (M16) ---------- */
const NOW = Date.parse("2026-07-25T12:00:00Z");

test("muteUntilIso: default-style 7 days lands exactly a week out, SQL datetime format", () => {
  assert.equal(muteUntilIso(7, NOW), "2026-08-01 12:00:00");
});

test("muteUntilIso: 0 / negative / garbage mean permanent (NULL until unmuted)", () => {
  assert.equal(muteUntilIso(0, NOW), null);
  assert.equal(muteUntilIso(-3, NOW), null);
  assert.equal(muteUntilIso("nope", NOW), null);
});

test("muteUntilIso: clamps to the 1–365 day window; any positive fraction = 1 day", () => {
  assert.equal(muteUntilIso(9999, NOW), muteUntilIso(365, NOW));
  assert.equal(muteUntilIso(0.4, NOW), "2026-07-26 12:00:00"); // positive → clamped up to 1 day
  assert.equal(muteUntilIso(0.6, NOW), "2026-07-26 12:00:00");
});

test("normalizeMuteBody: happy path with defaults", () => {
  assert.deepEqual(normalizeMuteBody({ contact_id: 42 }), { contactId: 42, days: 7, reason: null });
});

test("normalizeMuteBody: rejects missing/garbage contact ids", () => {
  assert.equal(normalizeMuteBody({}).contactId, null);
  assert.equal(normalizeMuteBody({ contact_id: "abc" }).contactId, null);
  assert.equal(normalizeMuteBody({ contact_id: -1 }).contactId, null);
  assert.equal(normalizeMuteBody(null).contactId, null);
});

test("normalizeMuteBody: reason trimmed and capped at 300 chars", () => {
  const long = "x".repeat(500);
  const r = normalizeMuteBody({ contact_id: 1, reason: "  spam  " });
  assert.equal(r.reason, "spam");
  assert.equal(normalizeMuteBody({ contact_id: 1, reason: long }).reason.length, 300);
});
