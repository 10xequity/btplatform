/**
 * Boomtown Platform — the day sheet (§-1n P-E / §-0 B19)
 * File: worker/test/day_sheet.test.mjs · Version: v1.0 · Date: 2026-08-16 · Ships in: v0.163.0
 *
 * P-E's whole sentence: "the printed artifact a tournament desk holds: schedule, pools and
 * bracket on one page. No new data." Shipped as a PRINT MODE of Tournament Ops (H-3's
 * mode-of-the-page precedent — no new page, no rail entry, no new route), composed from THREE
 * reads that already exist and are already called by existing screens: the ops page's own
 * schedule/teams state, the pool board's GET .../board, and admin-brackets' GET .../brackets.
 * "One page" is read as ONE PRINT JOB with page breaks between sections — the existing pool
 * sheet already page-breaks its standings, so literal-single-sheet was never this product's
 * meaning. This file pins the composition, the mode mechanics, and the no-new-data rule.
 * print_parity.test.mjs keeps covering the page's print/CSV/email trio by construction (its
 * rule is set-derived), so nothing here restates parity.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");
const JS = blankComments(read("assets/tournament.js"));
const HTML = read("tournament.html");
const CSS = read("assets/tournament.css");

/* ═══ the composition: three sections, three EXISTING reads ═══ */

test("the day sheet composes Schedule, Pools and Bracket — and only from reads that already exist", () => {
  assert.match(JS, /function composeDaySheet/, "tournament.js lost the day-sheet composer");
  for (const section of ["Schedule", "Pools", "Bracket"]) {
    assert.ok(new RegExp(`ds-h">${section}`).test(JS), `the composer lost its ${section} section heading`);
  }
  // The two fetches are the EXISTING routes other screens already call — P-E says no new data,
  // and a new route would also move the D-4 reachability baseline.
  assert.match(JS, /\/api\/admin\/events\/\$\{currentEvent\.id\}\/board/, "the Pools section stopped reading the pool board's own route");
  assert.match(JS, /\/api\/admin\/events\/\$\{currentEvent\.id\}\/brackets`\)/, "the Bracket section stopped reading admin-brackets' own GET");
});

/** Every HTML-building STATEMENT in the composer (`let html =` / `html +=` through its `;`),
 *  so multi-line appends are covered whole. The text-builder (`text.push`) is deliberately OUT
 *  of scope: it feeds emailDocument's plain-text body, where HTML-escaping would corrupt. */
function htmlStatements(src) {
  const out = [];
  const re = /(?:let html =|html \+=)/g;
  let m;
  while ((m = re.exec(src))) out.push(src.slice(m.index, src.indexOf(";\n", m.index)));
  return out;
}

test("every interpolation on an HTML-building statement routes through dsEsc — the new code never inherits the raw idiom", () => {
  // tournament.js predates the esc discipline for its grid; the day sheet does NOT get to.
  assert.match(JS, /const dsEsc = /, "the composer lost its escaper");
  const composer = JS.slice(JS.indexOf("function composeDaySheet"));
  const stmts = htmlStatements(composer.slice(0, composer.indexOf("$(\"daySheet\").innerHTML")));
  assert.ok(stmts.length >= 5, `the statement extractor found only ${stmts.length} html statements — it is not reading the composer`);
  const raw = stmts.flatMap((s) => [...s.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]))
    .filter((x) => !x.startsWith("dsEsc(") && !x.includes("dsEsc("));
  assert.deepEqual(raw, [], `interpolations reaching innerHTML without the escaper: ${raw.join(" · ")}`);
});

/* ═══ the print-mode mechanics ═══ */

test("printing the day sheet is a body MODE with cleanup — the pool sheet's print is untouched", () => {
  assert.match(JS, /classList\.add\("print-day"\)/, "nothing enters the day-sheet print mode");
  assert.match(JS, /afterprint/, "the mode is never cleaned up — the NEXT print would be the wrong document");
  // The existing pool-sheet button keeps its one-liner: () => print(); with no mode.
  assert.match(JS, /\$\("printBtn"\)\.onclick = \(\) => print\(\);/,
    "the pool sheet's own print changed — the day sheet is an addition, not a replacement");
});

test("the day-sheet email variant rides the ONE hand-off, with its own document name", () => {
  assert.match(JS, /emailDocument\(currentEvent\.id, `\$\{currentEvent\.name\} — day sheet`/,
    "the day sheet lost its email variant, or grew a second send stack");
});

/* ═══ the CSS: hidden on screen, exclusive in print ═══ */

test("the day sheet is invisible on screen and swaps with the normal region ONLY in print-day mode", () => {
  assert.match(CSS, /#daySheet \{ display: none; \}/, "the sheet leaks into the screen layout");
  const print = CSS.slice(CSS.indexOf("@media print"));
  assert.match(print, /body\.print-day #daySheet \{ display: block; \}/,
    "print-day mode never shows the sheet — the mode prints a blank document");
  assert.match(print, /body\.print-day #gridPanel[^}]*display: none/,
    "print-day mode still prints the pool grid — two documents in one job");
  assert.match(print, /\.ds-section \{ break-before: page/,
    "the sections lost their page breaks — 30 teams of schedule, pools and bracket on one sheet is illegible");
});

test("the control exists in markup, inside the toolbar's no-print region", () => {
  assert.match(HTML, /id="daySheetBtn"/, "the Print day sheet control is gone from the toolbar");
  assert.match(HTML, /id="daySheet"/, "the composed container is gone from the page");
});

/* ═══ negative controls ═══ */

test("NC-1: stripping the afterprint cleanup is caught, and the mutation lands", () => {
  const mutated = JS.split("afterprint").join("afterprintZZ");
  assert.notEqual(mutated, JS, "the mutation did not land");
  assert.equal(/afterprint(?!ZZ)/.test(mutated), false, "the cleanup needle survived the mutation");
});

test("NC-2: an unescaped interpolation planted onto an html statement is caught, and the extractor is positive-controlled", () => {
  const planted = 'html += `<td>${p.team_name}</td>`;\n';
  const stmts = htmlStatements(planted);
  assert.equal(stmts.length, 1, "the extractor missed a statement it must find");
  const raw = [...stmts[0].matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1])
    .filter((x) => !x.startsWith("dsEsc(") && !x.includes("dsEsc("));
  assert.deepEqual(raw, ["p.team_name"], "the escape scan cannot fire on a planted raw interpolation");
  // And a dsEsc-wrapped plant must NOT fire — the rule reads the escaper, not the tag.
  const clean = [...htmlStatements('html += `<td>${dsEsc(p.team_name)}</td>`;\n')[0].matchAll(/\$\{([^}]*)\}/g)]
    .map((x) => x[1]).filter((x) => !x.startsWith("dsEsc(") && !x.includes("dsEsc("));
  assert.deepEqual(clean, []);
});
