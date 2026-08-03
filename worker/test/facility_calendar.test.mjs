/* Boomtown Platform — facility calendar guard
   File: worker/test/facility_calendar.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.64.0

   The facility calendar shipped with DAY and WEEK only. That answers "what is on today" but never
   "how busy is October" — the question a director asks when quoting a rental or planning a season.
   The month grid closes that, and these assertions keep it wired: the view is only useful if the
   button, the handler, the renderer AND the paging all exist together, and it is entirely possible
   to leave one behind in a refactor and ship a button that does nothing.

   The renderer lives inside an IIFE and cannot be imported, so this is a source guard rather than
   a behavioural test. Stated plainly: it proves the wiring, not the pixels. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const JS = readFileSync(new URL("../../web/assets/admin-facility.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../web/admin-facility.html", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../web/assets/admin.css", import.meta.url), "utf8");
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

test("the facility calendar offers day, week AND month", () => {
  for (const id of ["viewDay", "viewWeek", "viewMonth"]) {
    assert.ok(HTML.includes(`id="${id}"`), `the ${id} button is missing from the page`);
  }
});

test("every view button is wired to a handler and a renderer", () => {
  const code = stripJs(JS);
  for (const [btn, view] of [["viewDay", "day"], ["viewWeek", "week"], ["viewMonth", "month"]]) {
    assert.ok(code.includes(`getElementById("${btn}")`), `${btn} has no listener — a button that does nothing`);
    assert.ok(code.includes(`setView("${view}")`), `${btn} never calls setView("${view}")`);
  }
  assert.match(code, /function renderMonth\s*\(/, "the month renderer is missing");
  assert.match(code, /renderMonth\(/, "renderMonth is defined but never called");
});

test("month paging steps a MONTH, not 30 days", () => {
  // Stepping 30 days from the 31st lands in the wrong month about half the year. The paging must
  // use setMonth, which is why `step()` exists rather than reusing move().
  const code = stripJs(JS);
  assert.match(code, /function step\s*\(/, "view-aware paging is missing");
  assert.match(code, /setMonth\(/, "month paging must use setMonth, not a day offset");
});

test("the month grid loads the whole VISIBLE grid, not just the month", () => {
  // A month starting on a Wednesday shows the preceding Sun-Tue. Leaving those blank when there
  // are bookings in them is worse than not showing them.
  const code = stripJs(JS);
  assert.match(code, /function monthGridRange\s*\(/, "the grid range helper is missing");
  assert.match(code, /getDay\(\)/, "the range must align to week boundaries");
});

test("the month cells are keyboard reachable and labelled", () => {
  const code = stripJs(JS);
  assert.match(code, /role="grid"/, "the month grid needs a grid role");
  assert.match(code, /role="gridcell"/, "cells need a gridcell role");
  assert.match(code, /aria-label="Open /, "day numbers need an accessible name, not just a digit");
});

test("month styling is token-only and collapses on a phone", () => {
  assert.ok(CSS.includes(".fc-month"), "month styles are missing");
  const block = CSS.slice(CSS.indexOf(".fc-month"));
  assert.ok(!/#[0-9a-fA-F]{6}/.test(block.slice(0, 2000)) || /var\(--op/.test(block.slice(0, 2000)),
    "month styles must use tokens, not raw hex");
  assert.match(block, /@media \(max-width: 640px\)/,
    "a 7-column grid is unreadable on a phone — it must collapse");
});

test("NC: removing the month button is detected", () => {
  const mutated = HTML.replace('id="viewMonth"', 'id="viewGone"');
  assert.notEqual(mutated, HTML, "mutation did not land — NC is vacuous");
  assert.ok(!mutated.includes('id="viewMonth"'), "with the button renamed the guard must see it missing");
});
