/**
 * Boomtown Platform — §-1r RF-10 (half 2): your league tonight
 * File: worker/test/league_tonight.test.mjs · Version: v1.0 · Date: 2026-08-22 · Ships in: v0.179.0
 *
 * THE FINDING (RF-10's measurement): the member Leagues page showed NOTHING about tonight —
 * row() emitted date/name/meta/CTA only, while the public court+opponent payload existed
 * (live.js on_now/up_next) with exactly one caller. The read is member-scoped over two EXISTING
 * routes: /api/profile/teams names the member's teams (with event_id), and /api/live/events/:id
 * names who is on which court — by team NAME only, deliberately (the payload's no-personal-data
 * walker), so the member's game is found by exact name match within their own event.
 *
 * THE TWO RULES PINNED HERE:
 *  · ONE JUDGEMENT for "in progress": paint() groups by groupOf() and tonight() reads the same
 *    function — a banner claiming a league is live while the heading says Upcoming is the
 *    two-readers drift this repo keeps paying for.
 *  · THE DECORATION RULE: tonight() is wrapped so ANY failure — signed out, no teams, fetch
 *    error, name mismatch — renders nothing. This page's job is the list; a banner must never
 *    take the page down or leave an error where a greeting goes.
 *
 * (RF-10's OTHER half — a Subs rail entry — needs the owner's word on which of the three
 * existing subs surfaces folds in; queued as a question, deliberately not built.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const LG = readFileSync(new URL("../../web/assets/leagues.js", import.meta.url), "utf8");
const LGHTML = readFileSync(new URL("../../web/leagues.html", import.meta.url), "utf8");

const tonightBody = (src) => {
  const t = blankComments(src);
  const at = t.indexOf("async function tonight");
  if (at === -1) return null;
  return t.slice(at, t.indexOf("\n  }", at));
};

test("RF-10: the member-scoped read exists — both existing routes, no new server surface", () => {
  const t = blankComments(LG);
  assert.ok(t.includes('"/api/profile/teams"'), "leagues.js no longer asks whose teams the member is on");
  assert.ok(t.includes("/api/live/events/"), "leagues.js no longer reads the live board payload — tonight is invisible again");
  assert.ok(LGHTML.includes('id="lgTonight"'), "leagues.html lost the banner mount — tonight() would write into nothing");
});

test("RF-10: ONE judgement decides 'in progress' — the banner and the heading cannot disagree", () => {
  const t = blankComments(LG);
  assert.match(t, /function groupOf\(/, "groupOf is gone — the grouping judgement is scattered again");
  const calls = (t.match(/groupOf\(/g) || []).length - 1; // minus the definition
  assert.ok(calls >= 2, `groupOf has ${calls} call site(s); paint() and tonight() make at least 2`);
  const body = tonightBody(LG);
  assert.ok(body, "tonight() is gone or changed shape — update this extractor with it");
  assert.ok(body.includes("groupOf("), "tonight() no longer reads the shared judgement");
  assert.ok(!body.includes('"in_progress"'),
    "tonight() grew its own in-progress literal — the second spelling groupOf exists to prevent");
});

test("RF-10: the decoration rule — any failure renders nothing, and the banner links the live board", () => {
  const body = tonightBody(LG);
  assert.match(body, /catch\s*\(/, "tonight() is unguarded — one failed fetch leaves an error where a greeting goes");
  const catchPart = body.slice(body.lastIndexOf("catch"));
  assert.ok(!/innerHTML\s*=/.test(catchPart), "tonight()'s catch writes to the page — decoration must fail to NOTHING");
  assert.ok(body.includes("live.html?event="), "the banner no longer links the live board");
  assert.ok(body.includes("sessionStorage.getItem(\"bt_token\")"),
    "tonight() no longer checks for a session first — a signed-out visitor would burn a 401 round trip");
});

test("NC-T1: a tonight() that re-implements the in-progress test FAILS the one-judgement pin", () => {
  const src = blankComments(LG);
  const mutated = src.replace(/(async function tonight[\s\S]*?)groupOf\(([^)]*)\) === "In progress"/,
    '$1$2.status === "in_progress"');
  assert.notEqual(mutated, src, "mutation did not land — tonight()'s groupOf call changed shape; update this NC");
  const body = tonightBody(mutated);
  assert.ok(!body.includes("groupOf(") || body.includes('"in_progress"'),
    "the mutated copy still reads as one-judgement — the NC mutated something else");
});
