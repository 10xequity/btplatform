/**
 * Boomtown Platform — §-1r RF-2 Unit A: navigating a long league season
 * File: worker/test/league_week_nav.test.mjs · Version: v1.0 · Date: 2026-08-24 · Ships in: v0.190.0
 *
 * RF-2 measured as two units. Unit A is client-only and is what this pins: a season of many weeks
 * scrolled forever with no way around. Each week card now carries an id (#wk-N); the toolbar has a
 * jump-to-week control (hidden until 2+ weeks); each week has an "↑ Top" link back to the toolbar
 * (#weekTop); and a per-week chevron collapses its matches (the pool board's #pbCollapse idiom).
 * Unit B (a second round per night — the pairing engine, a new week axis) is NOT built here; it
 * needs the owner's word on the scheduling behaviour and is recorded, not done.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const HTML = readFileSync(new URL("admin-league.html", WEB), "utf8");
const JS = blankComments(readFileSync(new URL("assets/admin-league.js", WEB), "utf8"));

test("RF-2A — the toolbar carries the jump control and a back-to-top anchor", () => {
  assert.match(HTML, /id="weekTop"/, "the toolbar has no #weekTop anchor — the '↑ Top' links land nowhere");
  assert.match(HTML, /id="weekJump"/, "the jump-to-week control is missing from the toolbar");
});

test("RF-2A — each week card has an id and a collapsible body; the head carries collapse + top", () => {
  assert.match(JS, /class="card wk-card" id="wk-\$\{w\.round\}"/, "week cards have no #wk-N id — jump/top have nowhere to land");
  assert.match(JS, /class="wk-body" id="wkb-\$\{w\.round\}"/, "the matches are not wrapped in a collapsible .wk-body");
  assert.match(JS, /class="[^"]*wk-collapse[^"]*"[^>]*aria-expanded="true"[^>]*aria-controls="wkb-\$\{w\.round\}"/,
    "the collapse chevron is missing or not wired to its week body via aria-controls");
  assert.match(JS, /class="wk-top no-print" href="#weekTop"/, "each week has no '↑ Top' link back to the toolbar");
});

test("RF-2A — the jump control is populated and scrolls, and hides below two weeks", () => {
  assert.match(JS, /jump\.hidden = weeks\.length < 2/, "the jump control never hides when there is nothing to jump between");
  assert.match(JS, /weeks\.map\(w => `<option value="wk-\$\{w\.round\}"/, "the jump options are not built from the weeks");
  assert.match(JS, /jump\.onchange =/, "the jump control has no change handler");
  assert.match(JS, /getElementById\(jump\.value\)/, "the jump handler does not resolve the chosen week");
  assert.match(JS, /scrollIntoView/, "selecting a week does not scroll to it");
});

test("RF-2A — the collapse handler toggles the body and its aria-expanded", () => {
  assert.match(JS, /querySelectorAll\("\.wk-collapse"\)/, "nothing wires the collapse chevrons");
  assert.match(JS, /setAttribute\("aria-expanded", String\(!open\)\)/, "the collapse handler does not maintain aria-expanded");
  assert.match(JS, /body\.hidden = open/, "the collapse handler never hides the week body");
});

test("RF-2A — a collapsed week still prints in full (the sheet is the whole season)", () => {
  const printBlock = HTML.slice(HTML.indexOf("@media print"));
  assert.match(printBlock, /\.wk-body \{ display: block !important; \}/,
    "print does not force .wk-body open — a week collapsed on screen would print empty");
});

test("RF-2A NC — removing the week-card id is caught (jump/top would have no target)", () => {
  const mutated = JS.replace('id="wk-${w.round}"', 'data-nope="${w.round}"');
  assert.notEqual(mutated, JS, "the mutation did not land — update the RF-2A anchor");
  assert.ok(!/class="card wk-card" id="wk-\$\{w\.round\}"/.test(mutated),
    "the week-card id survived the mutation — this check is spelling-blind");
});
