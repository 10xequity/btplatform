// Boomtown Platform — messages.js unit tests (M14 Phase B)
// File: worker/test/messages.test.mjs · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.17.0
import test from "node:test";
import assert from "node:assert/strict";
import { tierClause, buildLibraryWhere, relayEmailHtml, overFlood } from "../src/messages.js";

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
