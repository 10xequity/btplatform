/**
 * Boomtown Platform — §-1r RF-11 (history half): the member event-history surface
 * File: worker/test/member_history.test.mjs · Version: v1.0 · Date: 2026-08-24 · Ships in: v0.191.0
 *
 * RF-11's measured finding: GET /api/profile/attendance (checkin.js → myAttendance) existed with
 * ZERO callers in web/ — per the call-site rule a definition, not a feature. This pins the caller
 * (profile.js's "Event history" card) in BOTH directions: the route has a web consumer, and the
 * consumer renders what the route returns, escaped. Checks run on comment-stripped source so a
 * needle in a comment cannot satisfy a behaviour claim.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const RAW = readFileSync(new URL("../../web/profile.js", import.meta.url), "utf8");
const JS = blankComments(RAW);

test("RF-11 — the attendance route has a web caller (the call-site rule, consumer direction)", () => {
  assert.match(JS, /api\("\/api\/profile\/attendance"\)/,
    "profile.js no longer fetches /api/profile/attendance — the route is a definition again");
  // Stripping control: the needle must live in CODE. If it only survived in a comment, the
  // stripped source would not carry it and the line above would already have failed — this
  // asserts the stripper actually ran on a source that HAS comments to strip.
  assert.notEqual(JS, RAW, "blankComments changed nothing — profile.js has comments, so the stripper did not run");
});

test("RF-11 — the card renders: historyList exists in the shipped template and the loader is booted", () => {
  assert.match(JS, /id="historyList"/, "the Event history card left the profile template");
  assert.match(JS, /loadHistory\(\);/, "loadHistory is defined but never called — the card would show Loading… forever");
  assert.match(JS, /No check-ins yet\./, "the empty state lost its honest sentence");
});

test("RF-11 — what the route returns is escaped before it hits innerHTML", () => {
  assert.match(JS, /esc\(a\.event_name\)/,
    "event_name renders unescaped — a hostile event name would execute in the member's profile");
});

test("RF-11 NC — a dropped caller is caught (mutation on the real source)", () => {
  const mutated = JS.replace('api("/api/profile/attendance")', 'api("/api/profile/attendanceZZ")');
  assert.notEqual(mutated, JS, "the mutation did not land — the caller needle is not in the code");
  assert.ok(!/api\("\/api\/profile\/attendance"\)/.test(mutated),
    "the caller check still passes with the caller gone — the anchor is spelling-blind");
});
