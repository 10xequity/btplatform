/**
 * Boomtown Platform — §-1c D-39: the "My events" card is filled, not a permanent "Loading…"
 * File: worker/test/home_my_events.test.mjs · Version: v1.0 · Date: 2026-08-24 · Ships in: v0.191.0
 *
 * D-39's measured finding (2026-08-16, building B15): home.html's #myEvList container shipped a
 * "Loading…" line that NO script referenced — v2.0.0 moved my-events into the announcement feed
 * and left the card's stale container behind, so every member's dashboard carried one line that
 * lied. The owner settled the layout decision on 2026-08-24 ("My events not loading" — keep the
 * card, fill it). The fill reads /api/profile/upcoming — the profile page's own source
 * (registrations incl. family), NOT the feed's my_events category, which the server omits
 * entirely when the member mutes it in the What's-happening box; a card fed from the feed would
 * go silently empty on mute. Checks run on comment-stripped source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const RAW = readFileSync(new URL("../../web/home.js", import.meta.url), "utf8");
const JS = blankComments(RAW);
const HTML = readFileSync(new URL("../../web/home.html", import.meta.url), "utf8");

test("D-39 — both halves ship: the container exists and a loader actually fills it", () => {
  assert.match(HTML, /id="myEvList"/, "the My events container left home.html");
  assert.match(JS, /api\("\/api\/profile\/upcoming"\)/,
    "home.js never fetches /api/profile/upcoming — the card is back to a container nothing fills");
  assert.match(JS, /\$\("myEvList"\)/, "no script references #myEvList — D-39's exact defect");
  assert.match(JS, /loadMyEvents\(\);/, "loadMyEvents is defined but never booted — Loading… forever");
});

test("D-39 — the card renders escaped, with honest empty and error sentences", () => {
  assert.match(JS, /esc\(e\.name\)/, "event names render unescaped into the dashboard");
  assert.match(JS, /Nothing on your calendar yet\./, "the empty state lost its honest sentence");
  assert.match(JS, /Couldn't load this just now\./,
    "a failed fetch leaves Loading… standing instead of saying it failed");
});

test("D-39 — the fill does NOT read the feed's my_events category (mute makes that source lie)", () => {
  // The feed omits categories.my_events when muted (announcements.js: `if (!mutedCategories
  // .has("my_events"))`), so a card fed from it would show the empty state to a member who only
  // muted the BOX. Forbid the card loader from reaching into the feed payload.
  const start = JS.indexOf("async function loadMyEvents");
  assert.ok(start > -1, "loadMyEvents is gone");
  const body = JS.slice(start, JS.indexOf("\n  async function", start + 10));
  assert.doesNotMatch(body, /my_events|categories/,
    "the card loader reads the feed's mute-filtered category — a muted box empties the card");
});

test("D-39 NC — a dropped fetch is caught (mutation on the real source)", () => {
  const mutated = JS.replace('api("/api/profile/upcoming")', 'api("/api/profile/upcomingZZ")');
  assert.notEqual(mutated, JS, "the mutation did not land — the fetch needle is not in the code");
  assert.ok(!/api\("\/api\/profile\/upcoming"\)/.test(mutated),
    "the fetch check still passes with the fetch gone — the anchor is spelling-blind");
});
