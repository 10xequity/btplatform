/**
 * Boomtown Platform — §-1p WF-1 (§-0 B23): the Events & Programs page
 * File: worker/test/events_calendar.test.mjs · Version: v2.1 · Date: 2026-08-24 · Ships in: v0.194.0
 *
 * v2.1 (§-1r RF-14, owner 2026-08-24): "Months view is not even adjusted on calendar" + "The
 * color of tiles does not contrast enough" — both measured on the live page in both themes.
 * Columns pinned to minmax(0, 1fr) (1fr's auto minimum let one nowrap tile blow up its column
 * and clip Friday/Saturday — with their events — out of the wrap), and the tile fill raised
 * 16% → 30% primary (hover 26% → 40%) with the ink pinned to var(--text). NCs prove both pins
 * reject the pre-fix spellings. The window half of RF-14 lives in schedule_window.test.mjs.
 *
 * v2.0 (§-1r RF-7, owner 2026-08-18): "the calendar boxes are STILL not correct" — true for the
 * MEMBER calendar, which never got WF-1's cap, while the admin one has been fixed and guarded
 * since v0.133.0. The cap is promoted to ONE judgement with TWO readers: `BT_CAL` lives in
 * config.js (the one script BOTH shells load — BT_THEME's precedent), admin-events.js and
 * schedule.js both render through BT_CAL.split(), and NEITHER carries its own cap literal.
 * This file now extracts BT_CAL from config.js's shipped bytes and EXECUTES it through the
 * admin cell builder, and pins the member reader: split() called, a "+N more" control, the
 * month pager REFETCHING (it used to call render() over a fixed today-7/+180 window, so paging
 * past the window showed empty boxes because of the REQUEST, not the schedule), and the fetch
 * window following calCursor in month mode.
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

const CONFIG = readFileSync(new URL("../../web/assets/config.js", import.meta.url), "utf8");
const SCHED = readFileSync(new URL("../../web/assets/schedule.js", import.meta.url), "utf8");

/** The ONE judgement, extracted from config.js's shipped bytes and EXECUTED — never re-implemented. */
function shippedBtCal(src = CONFIG) {
  const m = blankComments(src).match(/window\.BT_CAL = (\{[\s\S]*?\n\};)/);
  if (!m) return null;
  return new Function("return " + m[1])();
}

/** The shipped cap, read through the judgement — plus the one-judgement property itself. */
function shippedCap() {
  const cal = shippedBtCal();
  assert.ok(cal, "BT_CAL is gone from config.js — the day cap must be ONE judgement both calendars read");
  assert.ok(Number.isInteger(cal.DAY_CAP) && cal.DAY_CAP > 0, "BT_CAL.DAY_CAP is not a positive integer");
  assert.doesNotMatch(js, /CAL_DAY_CAP\s*=\s*\d/,
    "admin-events.js grew its own cap literal back — the judgement must live once, in config.js");
  assert.doesNotMatch(blankComments(SCHED), /(?:CAL_)?DAY_CAP\s*=\s*\d/,
    "schedule.js grew its own cap literal — the judgement must live once, in config.js");
  return cal.DAY_CAP;
}

const cellFn = () => new Function("ds", "dayNum", "classes", "dayEvents", "esc", "BT_CAL",
  pure("dayCellHtml").slice(1, -1));

const EVENTS = (n) => Array.from({ length: n }, (_, i) => ({
  id: 100 + i, name: `Event Number ${i + 1}`, status: "published",
}));

/* ==================== (a) the day cell, executed as shipped bytes ==================== */

test("a quiet day renders every event as a draggable manage link, and no more-button", () => {
  const cap = shippedCap();
  const html = cellFn()("2026-08-15", 15, "", EVENTS(cap), esc, shippedBtCal());
  assert.equal((html.match(/class="cal-ev/g) || []).length, cap, "a day at the cap must show all of them");
  assert.equal((html.match(/draggable="true"/g) || []).length, cap, "visible tiles must stay draggable — reschedule-by-drag is a shipped feature");
  assert.ok(html.includes("admin-event.html?id=100"), "a tile must still link to its manage page");
  assert.ok(!html.includes("data-more"), "a day with nothing hidden must not offer a more-button");
});

test("a busy day caps the stack and says how many more — the overflow names leave the cell", () => {
  const cap = shippedCap();
  const fn = cellFn();
  const before = fn("2026-08-15", 15, "", EVENTS(cap), esc, shippedBtCal());
  assert.ok(before.includes(esc(`Event Number ${cap}`)), "precondition: at the cap, the last event is visible");

  // NEGATIVE CONTROL — mutate the real input: the same day grows two more events.
  const grown = EVENTS(cap + 2);
  const after = fn("2026-08-15", 15, "", grown, esc, shippedBtCal());
  assert.equal((after.match(/class="cal-ev/g) || []).length, cap, "the cap did not hold");
  assert.ok(!after.includes(esc(`Event Number ${cap + 1}`)), "an overflow event's name is still in the cell — the mutation did not land");
  assert.ok(!after.includes(esc(`Event Number ${cap + 2}`)), "the last event leaked past the cap");
  assert.match(after, /data-more="2026-08-15"/, "the hidden events must be reachable through the day opener");
  assert.match(after, /\+2 more/, "the button must say honestly how many are hidden");
});

test("an empty day is just a day", () => {
  const html = cellFn()("2026-08-15", 15, " other", [], esc, shippedBtCal());
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

/* ==================== v2.0 — RF-7: the MEMBER calendar reads the same judgement ==================== */

test("RF-7: the member calendar renders through BT_CAL.split and offers +N more — the SECOND reader", () => {
  const t = blankComments(SCHED);
  assert.ok(t.includes("BT_CAL.split("),
    "schedule.js no longer calls BT_CAL.split — the member calendar left the one judgement");
  assert.ok(t.includes("window.BT_CAL"),
    "schedule.js reads BT_CAL unguarded — a stale cached config.js without it must degrade to the uncapped cell, not a dead calendar");
  assert.ok(t.includes("cal-more"), "the member calendar lost its +N more control — the cap would hide events with no way in");
});

test("RF-7: the month pager REFETCHES — paging past the fetched window was empty boxes by REQUEST", () => {
  const t = blankComments(SCHED);
  for (const btn of ["#cp", "#cn"]) {
    const at = t.indexOf(`querySelector("${btn}")`);
    assert.notEqual(at, -1, `the ${btn} pager button is gone — update this pin with the pager's new shape`);
    const handler = t.slice(at, t.indexOf("});", at));
    assert.ok(handler.includes("load()"),
      `the ${btn} pager no longer refetches — render() over the old window shows empty boxes for months the request never covered`);
  }
});

test("RF-7: in month mode the fetch window follows calCursor — the reader gets what they are looking at", () => {
  const body = functionBodyAfter(blankComments(SCHED), "async function load");
  assert.ok(body, "schedule.js load() is gone or no longer a plain async function declaration");
  assert.ok(/"month"/.test(body) && body.includes("calCursor"),
    "load() no longer derives its window from calCursor in month mode — the pager refetch fetches the same fixed window forever");
});

test("NC-C1: a pager wired back to render() FAILS the refetch pin", () => {
  const t = blankComments(SCHED);
  const at = t.indexOf('querySelector("#cp")');
  const handler = t.slice(at, t.indexOf("});", at));
  const mutated = t.slice(0, at) + handler.replace("load()", "render()") + t.slice(at + handler.length);
  assert.notEqual(mutated, t, "mutation did not land — the #cp handler changed shape; update this NC with it");
  const h2 = mutated.slice(mutated.indexOf('querySelector("#cp")'));
  assert.ok(!h2.slice(0, h2.indexOf("});")).includes("load()"),
    "the mutated #cp handler still refetches — the NC mutated something else");
});

test("NC-C2: a second cap literal in the member reader FAILS the one-judgement property", () => {
  const withOwnCap = blankComments(SCHED) + "\nconst CAL_DAY_CAP = 4;\n";
  assert.match(withOwnCap, /(?:CAL_)?DAY_CAP\s*=\s*\d/,
    "the forbidden-literal scan cannot see the planted literal — shippedCap()'s one-judgement assertion is blind");
});

/* ==================== v2.1 — RF-14 (owner 2026-08-24): even columns, legible tiles ==================== */

/* "Months view is not even adjusted on calendar" — MEASURED on the live page in both themes
   (2026-08-24): `repeat(7, 1fr)` means minmax(auto, 1fr), so a day cell's automatic minimum is
   the min-content of its widest nowrap tile. One long event name blew its column wide, squeezed
   the others, and pushed FRIDAY AND SATURDAY past the wrap's clipped edge — two of the five live
   events were INVISIBLE in Month view. minmax(0, 1fr) is the fix: columns share equally, tiles
   ellipsize inside them. One stylesheet serves both calendars, so the admin grid heals too. */
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ");
const calGridColumns = (css) => {
  const m = stripCss(css).match(/\.cal-grid \{[^}]*grid-template-columns:\s*([^;]+);/);
  return m ? m[1].trim() : null;
};

test("RF-14: the month grid's 7 columns are minmax(0, 1fr) — a long tile cannot blow up its column", () => {
  assert.equal(calGridColumns(CSS), "repeat(7, minmax(0, 1fr))",
    "the calendar columns lost their 0 minimum — one nowrap event name makes the columns uneven " +
    "and clips whole weekdays (with their events) out of the visible grid");
});

test("NC-RF14a: the pre-fix repeat(7, 1fr) spelling FAILS the column pin", () => {
  /* anchored WITH the selector — .fc-month (the facility calendar) already carries the exact
     minmax(0, 1fr) string, so a bare-declaration replace lands on the wrong rule (measured:
     this NC's first draft mutated .fc-month and reported green against an unfixed .cal-grid) */
  const mutated = CSS.replace(".cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr))",
    ".cal-grid { display: grid; grid-template-columns: repeat(7, 1fr)");
  assert.notEqual(mutated, CSS, "mutation did not land — the .cal-grid rule moved; update this NC");
  assert.notEqual(calGridColumns(mutated), "repeat(7, minmax(0, 1fr))",
    "the verdict must reject the auto-minimum spelling — if it passes, the pin is blind");
});

/* "The color of tiles does not contrast enough" — measured: at a 16% primary mix the dark-theme
   tile is a near-black chip on a near-black cell (~#332D1C on #0B0B0D). 30% (40% hover) keeps the
   ink var(--text) at ≥7:1 on the mixed fill in BOTH shipped themes (computed against tokens.css's
   values before landing) while making the tile itself read as a tile. */
test("RF-14: the event tile's fill mixes 30% primary (40% on hover) — the tile reads in dark theme", () => {
  const flat = stripCss(CSS);
  assert.ok(flat.includes(".cal-ev { display: block;"),
    "the .cal-ev rule moved — update this pin with its new anchor");
  assert.ok(/\.cal-ev \{[^}]*color-mix\(in srgb, var\(--primary\) 30%, var\(--surface\)\)/.test(flat),
    "the tile fill fell back below 30% primary — the owner measured the old 16% as not contrasting enough");
  assert.ok(/\.cal-ev:hover \{[^}]*color-mix\(in srgb, var\(--primary\) 40%, var\(--surface\)\)/.test(flat),
    "the hover fill must sit visibly above the resting fill");
  assert.ok(/\.cal-ev \{[^}]*color: var\(--text\)/.test(flat),
    "the tile ink left var(--text) — the contrast floor was computed against that ink");
});

test("NC-RF14b: the pre-fix 16% fill FAILS the tile pin", () => {
  const mutated = CSS.replace("color-mix(in srgb, var(--primary) 30%, var(--surface))",
    "color-mix(in srgb, var(--primary) 16%, var(--surface))");
  assert.notEqual(mutated, CSS, "mutation did not land — the .cal-ev fill moved; update this NC");
  assert.equal(/\.cal-ev \{[^}]*color-mix\(in srgb, var\(--primary\) 30%, var\(--surface\)\)/.test(stripCss(mutated)), false,
    "the verdict must reject the 16% fill — if it passes, the pin is blind");
});
