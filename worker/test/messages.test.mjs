// Boomtown Platform — messages.js unit tests (M14 Phase B)
// File: worker/test/messages.test.mjs · Version: v1.1 · Date: 2026-07-25 · Ships in: v0.21.0
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";
import { tierClause, buildLibraryWhere, relayEmailHtml, overFlood, muteUntilIso, normalizeMuteBody, LIBRARY_ADULT_PREDICATE,
         MESSAGE_FLAG_SCOPE, FLAG_STATUSES, flagStatusOf } from "../src/messages.js";

const SRC = blankComments(readFileSync(new URL("../src/messages.js", import.meta.url), "utf8")); // D-45

test("tierClause: anonymous visitors only see public profiles", () => {
  const c = tierClause(false, false);
  assert.match(c, /p\.visibility = 'public'/);
  assert.doesNotMatch(c, /'members'/);
});

/* ---------------- F-39 guards (v0.36.0, decision A: fail closed) ---------------- */

test("F-39: the adult predicate FAILS CLOSED — a NULL date_of_birth can never pass", () => {
  // 'IS NOT NULL' must be a conjunct, so an unknown age is a minor, not an adult.
  assert.match(LIBRARY_ADULT_PREDICATE, /date_of_birth IS NOT NULL/);
  assert.match(LIBRARY_ADULT_PREDICATE, /date_of_birth <= date\('now','-18 years'\)/);
  assert.match(LIBRARY_ADULT_PREDICATE, /AND/);
});

test("F-39: both non-staff library tiers carry the adult predicate; staff tier does not filter", () => {
  assert.ok(tierClause(false, false).includes(LIBRARY_ADULT_PREDICATE), "anonymous tier missing the age gate");
  assert.ok(tierClause(true, false).includes(LIBRARY_ADULT_PREDICATE), "member tier missing the age gate");
  assert.equal(tierClause(true, true), "1=1");
});

test("F-39: startThread gates the DM recipient on the SAME predicate (guard as wide as the thing)", () => {
  // Source-slice guard, same pattern as registrations.test.mjs's F-27 guard: the listing
  // filter hiding minors while the relay still delivers to them is failure class 3.
  const fn = SRC.slice(SRC.indexOf("async function startThread"), SRC.indexOf("async function reply"));
  assert.ok(fn.includes("LIBRARY_ADULT_PREDICATE"), "recipient query no longer computes adult_ok from the canonical predicate");
  assert.ok(/!to\.adult_ok/.test(fn), "recipient refusal no longer checks adult_ok");
});

test("F-39 negative control: the source-slice guard can actually fail", () => {
  // Prove the guard above is not a regex self-check: strip the predicate from a copy
  // of the slice and assert the same checks now fail on it.
  const fn = SRC.slice(SRC.indexOf("async function startThread"), SRC.indexOf("async function reply"));
  const mutated = fn.replace(/LIBRARY_ADULT_PREDICATE/g, "'1=1'").replace(/!to\.adult_ok/g, "false");
  assert.ok(!mutated.includes("LIBRARY_ADULT_PREDICATE"));
  assert.ok(!/!to\.adult_ok/.test(mutated));
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

/* ---------------- v0.56.0: admin flag count (the ✉ badge endpoint) ---------------- */

test("flagStatusOf: known statuses pass, everything else falls back to 'open'", () => {
  assert.equal(flagStatusOf("open"), "open");
  assert.equal(flagStatusOf("resolved"), "resolved");
  assert.equal(flagStatusOf("dismissed"), "dismissed");
  assert.equal(flagStatusOf(null), "open");
  assert.equal(flagStatusOf(""), "open");
  assert.equal(flagStatusOf("OPEN"), "open", "case must not smuggle a status through");
  assert.equal(flagStatusOf("open' OR 1=1 --"), "open", "an injection attempt resolves to the safe default");
});

test("the badge count and the queue select through ONE predicate (F-26)", () => {
  // A badge reading 3 over a queue showing 2 is worse than no badge: the operator stops
  // trusting the number, then stops looking. Both call sites must use MESSAGE_FLAG_SCOPE.
  assert.match(MESSAGE_FLAG_SCOPE, /f\.org_id=\?1/, "the shared predicate must be org-scoped");
  assert.match(MESSAGE_FLAG_SCOPE, /f\.target_type='message'/);
  assert.match(MESSAGE_FLAG_SCOPE, /f\.status=\?2/);
  const uses = (SRC.match(/\$\{MESSAGE_FLAG_SCOPE\}/g) || []).length;
  assert.equal(uses, 2, `expected the queue AND the count to interpolate the shared predicate, saw ${uses}`);
});

test("NC: no second, hand-written copy of the flag WHERE clause survives", () => {
  // The literal predicate must appear ONLY in the MESSAGE_FLAG_SCOPE definition itself.
  const literal = (SRC.match(/f\.org_id=\?1 AND f\.target_type='message'/g) || []).length;
  assert.equal(literal, 1,
    `the flag predicate is written out ${literal} times — a second copy is exactly the drift MESSAGE_FLAG_SCOPE exists to prevent`);
});

test("the flag-count route is mounted, staff-gated and org-scoped", () => {
  assert.match(SRC, /p === "\/api\/admin\/messages\/flags\/count" && m === "GET"/,
    "the endpoint is defined but never dispatched — built-but-uncalled (failure class 1)");
  const fn = SRC.slice(SRC.indexOf("async function adminFlagCount"), SRC.indexOf("async function adminFlags"));
  assert.match(fn, /H\.requireStaff/, "an unauthenticated caller could count another org's reports");
  assert.match(fn, /\.bind\(ctx\.orgId,/, "the count must bind ctx.orgId — never an org id from the client (F-11)");
  assert.doesNotMatch(fn, /url\.searchParams/, "the badge counts open reports only; it must not take a status from the caller");
});

test("NC: the flag-count mount assertion can fail", () => {
  const mutated = SRC.replace('p === "/api/admin/messages/flags/count" && m === "GET"', 'false');
  assert.notEqual(mutated, SRC, "mutation did not land — NC is vacuous");
  assert.doesNotMatch(mutated, /p === "\/api\/admin\/messages\/flags\/count" && m === "GET"/);
});
