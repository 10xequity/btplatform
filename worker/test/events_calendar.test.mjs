/**
 * Boomtown Platform — §-1p WF-1 (§-0 B23): the Events & Programs page
 * File: worker/test/events_calendar.test.mjs · Version: v1.0 · Date: 2026-08-11 · Ships in: v0.133.0
 *
 * The owner's 2026-08-11 item 1, measured into two defects on one page:
 *  (a) THE CALENDAR HAS NO PER-DAY CAP AND NO UNIFORM ROWS — a busy day stacks .cal-ev nodes
 *      unbounded and stretches its whole grid row, so busy weeks tower over empty ones ("not even
 *      rows"). The fix: a day cell shows at most CAL_DAY_CAP events plus an honest "+N more"
 *      opener, and the stylesheet pins the six week rows to equal heights.
 *  (b) THE VIEWS & EMBED TAB IS DEAD — renderViews()/viewModal() reference a global `orgs` that no
 *      script on the page defines (admin-nav's copy is closure-scoped), so every loadAll() ends in
 *      an unhandled ReferenceError. The calendar and list render first, which is exactly why
 *      nobody saw it: the page LOOKS alive. Found measuring (a); as old as v0.52.0.
 *
 * THE RULES, EACH PINNED:
 *  · The cell builder is executed as SHIPPED BYTES (functionBodyAfter + new Function) with its
 *    dependencies composed in — a text scan cannot see behaviour.
 *  · The cap must not orphan an event: the "+N more" path opens the whole day with a manage link
 *    per event — a filter that hides must never delete the way in.
 *  · Visible tiles stay draggable — the cap must not silently kill reschedule-by-drag.
 *  · The negative controls MUTATE THE REAL INPUT: the same day grown past the cap must drop the
 *    overflow names and say so; the declaration detector is run against a copy of the source with
 *    the declaration stripped and must fail there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

const JS = readFileSync(new URL("../../web/assets/admin-events.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../web/assets/admin.css", import.meta.url), "utf8");
const js = blankComments(JS);

function pure(name) {
  const body = functionBodyAfter(js, `function ${name}`);
  assert.ok(body, `${name} is gone or no longer a plain function declaration`);
  return body;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The shipped cap, read from the source so the tests cannot drift from the page. */
function shippedCap() {
  const m = js.match(/const CAL_DAY_CAP\s*=\s*(\d+)/);
  assert.ok(m, "CAL_DAY_CAP is gone — the cap must be one named constant, not a scattered literal");
  return Number(m[1]);
}

const cellFn = () => new Function("ds", "dayNum", "classes", "dayEvents", "esc", "CAL_DAY_CAP",
  pure("dayCellHtml").slice(1, -1));

const EVENTS = (n) => Array.from({ length: n }, (_, i) => ({
  id: 100 + i, name: `Event Number ${i + 1}`, status: "published",
}));

/* ==================== (a) the day cell, executed as shipped bytes ==================== */

test("a quiet day renders every event as a draggable manage link, and no more-button", () => {
  const cap = shippedCap();
  const html = cellFn()("2026-08-15", 15, "", EVENTS(cap), esc, cap);
  assert.equal((html.match(/class="cal-ev/g) || []).length, cap, "a day at the cap must show all of them");
  assert.equal((html.match(/draggable="true"/g) || []).length, cap, "visible tiles must stay draggable — reschedule-by-drag is a shipped feature");
  assert.ok(html.includes("admin-event.html?id=100"), "a tile must still link to its manage page");
  assert.ok(!html.includes("data-more"), "a day with nothing hidden must not offer a more-button");
});

test("a busy day caps the stack and says how many more — the overflow names leave the cell", () => {
  const cap = shippedCap();
  const fn = cellFn();
  const before = fn("2026-08-15", 15, "", EVENTS(cap), esc, cap);
  assert.ok(before.includes(esc(`Event Number ${cap}`)), "precondition: at the cap, the last event is visible");

  // NEGATIVE CONTROL — mutate the real input: the same day grows two more events.
  const grown = EVENTS(cap + 2);
  const after = fn("2026-08-15", 15, "", grown, esc, cap);
  assert.equal((after.match(/class="cal-ev/g) || []).length, cap, "the cap did not hold");
  assert.ok(!after.includes(esc(`Event Number ${cap + 1}`)), "an overflow event's name is still in the cell — the mutation did not land");
  assert.ok(!after.includes(esc(`Event Number ${cap + 2}`)), "the last event leaked past the cap");
  assert.match(after, /data-more="2026-08-15"/, "the hidden events must be reachable through the day opener");
  assert.match(after, /\+2 more/, "the button must say honestly how many are hidden");
});

test("an empty day is just a day", () => {
  const html = cellFn()("2026-08-15", 15, " other", [], esc, shippedCap());
  assert.ok(!html.includes("cal-ev"), "an empty day rendered an event");
  assert.ok(!html.includes("data-more"));
  assert.match(html, /class="cal-day other"/, "the month-position class must survive the builder");
});

test("renderCalendar builds cells through the ONE builder and wires the day opener to a modal with manage links", () => {
  const rc = pure("renderCalendar");
  assert.match(rc, /dayCellHtml\(/, "renderCalendar no longer uses the capped builder — the cap is decoration");
  assert.match(rc, /data-more/, "the more-button has no click wiring in renderCalendar");
  const dm = pure("dayModal");
  assert.match(dm, /admin-event\.html\?id=/,
    "the day modal must carry a manage link per event — the cap hides tiles, the modal is the way in");
});

test("even rows are the stylesheet's contract: header row auto, six week rows equal", () => {
  const rule = CSS.match(/\.cal-grid\s*\{[^}]*\}/);
  assert.ok(rule, ".cal-grid rule is gone from admin.css");
  assert.match(rule[0], /grid-template-rows:\s*auto\s+repeat\(6,\s*1fr\)/,
    "the six week rows must share the grid's height equally — this is the 'not even rows' fix");
  assert.match(CSS, /\.cal-more/, ".cal-more is unstyled in admin.css — a dangling class (D-23's class)");
});

/* ==================== (b) the Views tab defines the orgs it renders ==================== */

test("the orgs the Views tab renders are DECLARED and FETCHED by this page", () => {
  // Positive control first: the usage that crashed is still present — if it vanishes, the two
  // assertions below stop guarding anything real and this test must be rethought.
  assert.match(js, /orgs\.(find|map)\(/,
    "renderViews/viewModal no longer read orgs — rewrite this guard around whatever replaced them");
  assert.match(js, /\b(let|const)\s+orgs\b/,
    "admin-events.js uses a global `orgs` that no script on the page defines — the Views tab dies with a ReferenceError (WF-1b)");
  assert.match(js, /\/api\/orgs/,
    "declaring orgs is not enough — the page must FETCH them or the select renders empty");
});

test("NEGATIVE CONTROL — the declaration detector fails on a copy of the source with the declaration stripped", () => {
  const declRe = /\b(let|const)\s+orgs\b/;
  const stripped = js.replace(declRe, "STRIPPED_FOR_CONTROL");
  assert.notEqual(stripped, js,
    "the strip found nothing to remove — there is no declaration to control against (pre-fix this is the defect itself)");
  assert.equal(declRe.test(stripped), false,
    "the detector still matches after the declaration was removed — it is not detecting the declaration");
});
