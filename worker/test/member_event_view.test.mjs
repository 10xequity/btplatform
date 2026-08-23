/**
 * Boomtown Platform — a member can reach the tournament view from an event (owner req 2026-08-23)
 * File: worker/test/member_event_view.test.mjs · Version: v1.0 · Date: 2026-08-23 · Ships in: v0.181.0
 *
 * His words: "is there a view for members to see the tournament display … they will not edit but
 * receive info" and "members from the event page can click an event and then see a view for members
 * that have the views of pools, and bracket".
 *
 * THE FINDING (measured): that view already EXISTS — live.html?event=N (/api/live/events/:id, team
 * names only, public) renders divisions → pools, brackets and standings, and degrades gracefully
 * for a not-started event. What was missing was the PATH: schedule.js showed a started event with
 * NO action at all, and leagues.js rendered a DEAD "In progress"/"Closed" label. This is the
 * RF-6/RF-9 class — a working view with no way in. The unit wires the way in; it does not rebuild
 * the view.
 *
 * WHAT IS PINNED: a started tournament/league event on the two member event surfaces links to
 * live.html?event=N; the gate is type (tournament|league) + status (started), so an upcoming event
 * still shows Register and a non-tournament type shows nothing. Score entry ("if needed") is NOT
 * built — members have no self-serve scoring-link path today, so it is queued as a question.
 * Source-shape checks (the leagues.js idiom in league_tonight.test.mjs), each with a real-source NC.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const SCHED = readFileSync(new URL("../../web/assets/schedule.js", import.meta.url), "utf8");
const LG = readFileSync(new URL("../../web/assets/leagues.js", import.meta.url), "utf8");

const linksLiveEvent = (src) => blankComments(src).includes("live.html?event=");

/* ── schedule.js: the started tournament/league card links to its live view ── */

test("schedule.js links a started tournament/league event to its live view", () => {
  const t = blankComments(SCHED);
  assert.ok(linksLiveEvent(SCHED), "schedule.js no longer links live.html?event= — the member cannot reach the view");
  // the gate is the point: only tournaments/leagues, and only once play has started
  assert.match(t, /e\.type === "tournament" \|\| e\.type === "league"/,
    "the live link is no longer gated to the types that HAVE pools/brackets");
  assert.match(t, /e\.status === "in_progress" \|\| e\.status === "completed"/,
    "the live link is no longer gated to started events — it would offer a view of nothing");
});

test("schedule.js keeps Register for a published (upcoming) event — the live link did not replace it", () => {
  const t = blankComments(SCHED);
  assert.match(t, /e\.status === "published" \?/, "the published→Register branch is gone");
  assert.ok(t.indexOf('e.status === "published"') < t.indexOf("liveLink(e)"),
    "Register must remain the action for an open event; the live link is the ELSE for a started one");
});

test("NC-1: dropping schedule.js's live link fails the wiring check", () => {
  const mutated = SCHED.replace(/live\.html\?event=/g, "nowhere.html?event=");
  assert.notEqual(mutated, SCHED, "mutation did not land — NC is vacuous");
  assert.equal(linksLiveEvent(mutated), false, "with the destination gone the member has no way into the view");
});

test("NC-2: widening the gate to every type would be caught", () => {
  // If the type gate were removed, a court-rental or training event would sprout a pools/bracket
  // link to an empty board. The gate string is the subject; prove the check sees it.
  const t = blankComments(SCHED);
  const gate = 'e.type === "tournament" || e.type === "league"';
  assert.ok(t.includes(gate), "the real gate must be present or this NC proves nothing");
  const mutated = t.replace(gate, "true");
  assert.ok(!mutated.includes(gate), "the gate must be gone in the mutant so the check would fire");
});

/* ── leagues.js: the dead in-progress/closed label becomes a live link ── */

test("leagues.js links an in-progress or past league to its live board (the dead label is gone)", () => {
  const t = blankComments(LG);
  assert.ok(linksLiveEvent(LG), "leagues.js no longer links live.html?event= — the list is a dead end again");
  // v0.183.0: the gate is `liveOk` — in_progress OR completed (Gemini 2026-08-24, aligning with
  // schedule.js) OR the started-date fallback. All three arms must be present.
  assert.match(t, /const liveOk = e\.status === "in_progress" \|\| e\.status === "completed" \|\| \(d && d <= new Date\(\)\)/,
    "the started/completed gate that replaced the dead label is gone or changed shape");
  assert.doesNotMatch(t, /"In progress"<\/span>|>In progress</,
    "the dead 'In progress' text label is back instead of a link");
});

test("leagues.js keeps Register for an open league — the live link did not replace it", () => {
  // (tonight()'s RF-10 banner already uses live.html?event=, so an ordering check against the
  //  first occurrence would measure the wrong link — assert preservation, not position.)
  const t = blankComments(LG);
  assert.match(t, /\$\{open/, "the open ternary is gone — Register no longer gates on an open league");
  assert.ok(t.includes('"Register"'), "the Register label was lost when the live link was added");
  const cta = t.slice(t.indexOf('class="lg-cta"'));
  assert.ok(cta.includes("live.html?event=") && cta.includes(">Closed<"),
    "row()'s CTA must offer the live link for a started league and keep 'Closed' for one that never ran");
});

test("NC-3: dropping leagues.js's live link fails the wiring check", () => {
  const mutated = LG.replace(/live\.html\?event=/g, "nowhere.html?event=");
  assert.notEqual(mutated, LG, "mutation did not land — NC is vacuous");
  assert.equal(linksLiveEvent(mutated), false, "with the destination gone the league list is a dead end");
});

/* ── the live links carry a name-bearing aria-label (Gemini review 2026-08-23/24, WCAG 2.4.4) ── */

// A list of links all reading "Pools & bracket"/"Standings & scores" is ambiguous in a screen
// reader's links list; the aria-label must carry the event NAME, and (Gemini 2026-08-24) fall back
// to the kind alone for a nameless event rather than render a dangling " — ". Both files build a
// `liveAria` from esc(e.name) with a conditional prefix, then set aria-label="${liveAria}".
const nameAriaLabel = (src) => {
  const t = blankComments(src);
  return /aria-label="\$\{liveAria\}"/.test(t) &&
    /const nm = e\.name \? esc\(e\.name\.trim\(\)\)/.test(t) &&
    /const liveAria = nm \?/.test(t);
};

test("both live links carry an event-name aria-label with an empty-name fallback (WCAG 2.4.4)", () => {
  assert.ok(nameAriaLabel(SCHED), "schedule.js's live link is not a name-conditional aria-label — ambiguous, or a dangling separator when nameless");
  assert.ok(nameAriaLabel(LG), "leagues.js's live link is not a name-conditional aria-label — ambiguous, or a dangling separator when nameless");
});

test("NC-4: dropping the name from the aria-label construction fails the check", () => {
  // Force the prefix off (nm always empty) — the exact regression the name prevents.
  const mutated = SCHED.replace(/const nm = e\.name \? esc\(e\.name\.trim\(\)\)/, 'const nm = "" && esc(e.name.trim())');
  assert.notEqual(mutated, SCHED, "mutation did not land — NC is vacuous");
  assert.equal(nameAriaLabel(mutated), false, "with the name derivation gone the label is a constant — the name is the point");
});

test("NC-5: a nameless event does NOT emit a dangling separator (Gemini 2026-08-24)", () => {
  // The fallback must be the kind alone, never "${nm} — kind" with an empty nm. Assert both files
  // carry the `nm ?` conditional so an empty name cannot produce " — standings and scores".
  for (const [name, src] of [["schedule.js", SCHED], ["leagues.js", LG]]) {
    assert.match(blankComments(src), /nm \? `\$\{nm\} —/,
      `${name}: the name prefix is not conditional — a nameless event renders a dangling " — "`);
  }
});
