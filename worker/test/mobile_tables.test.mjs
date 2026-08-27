/* Boomtown Platform — wide admin tables on a phone (roadmap §-1h M-1)
   File: worker/test/mobile_tables.test.mjs · Version: v1.1 · Date: 2026-08-27 · Ships in: v0.113.0 (v1.1 in v0.212.0: the vw-width scrollbar-bleed ratchet)

   THE DEFECT. `.tbl` is `width: 100%` (admin.css) and the phone breakpoint sets
   `body { overflow-x: hidden }` with the honest comment "Never let a phone-width layout force a
   sideways scroll." The intent is right and the interaction is not: a width-100% table CANNOT
   overflow, so it squashes. `admin-reports`' seven-column revenue table gets roughly 55px a column
   on a 390px phone, and the money columns are the ones that shrink. Twelve of the fourteen pages
   carrying a `<table>` are affected.

   THE FIX THAT LOOKED OBVIOUS AND IS WRONG. `app.css` already has a phone treatment for
   `.score-table` and `.roster-table`: hide `thead`, make each `td` a block, each `tr` a card. It is
   the right pattern for those two — a score row is a handful of self-describing cells. Extending it
   to `.tbl` would hide the column headers of a SEVEN-column financial table, leaving a stack of
   seven anonymous numbers. **That is not better than squashed, it is worse**, because a squashed
   number is still labelled. Restoring the labels needs `data-label` on every cell, which is twelve
   renderers edited — the cost the shared-rule approach exists to avoid.

   SO THE TABLE SCROLLS INSTEAD, AND IT NEEDS NO MARKUP CHANGE. `display: block` turns the table
   into a block box whose table content is laid out in an anonymous table wider than the box, so the
   box scrolls. `white-space: nowrap` stops headers wrapping into unreadable slivers, which is what
   forces the real width — and it is also the affordance: a column visibly sliced at the screen edge
   is what tells a thumb there is more to the right. `body { overflow-x: hidden }` is untouched, so
   the PAGE still never scrolls sideways; only the table does.

   WHAT THIS FILE DEFENDS.
     1. The rule exists, inside the phone breakpoint, and permits horizontal scrolling.
     2. `.tbl thead` is NEVER hidden — the labels trap above, asserted so nobody "tidies" the two
        rules together later.
     3. The `.score-table` / `.roster-table` card pattern still exists, because this release must not
        quietly regress the one surface that was already right.
     4. Negative controls that mutate the real stylesheet and prove each assertion can fail. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statementFrom, blankComments } from "../testkit/route-extract.mjs";

/* COMMENTS ARE BLANKED BEFORE ANY ANCHORING, AND THAT IS NOT HOUSEKEEPING. This file's first run
   failed against a correct stylesheet because `indexOf(".tbl")` matched the phrase ".tbl" inside the
   explanatory comment ABOVE the rule rather than the selector itself — the ambiguous-anchor defect
   the marker sweep closed one release ago, reproduced immediately by prose I had just written.
   `blankComments` preserves LENGTH, so offsets and reported positions stay true. */
const APP = blankComments(readFileSync(new URL("../../web/assets/app.css", import.meta.url), "utf8"));
const ADMIN = blankComments(readFileSync(new URL("../../web/assets/admin.css", import.meta.url), "utf8"));

const PHONE = "@media (max-width: 430px)";

/** The phone breakpoint's whole block, brace-matched — never a character window (§-1c D-17b). */
function phoneBlock(css) {
  assert.equal(css.split(PHONE).length - 1, 1,
    `${PHONE} must occur exactly once in this stylesheet, or the anchor below is ambiguous`);
  return statementFrom(css, css.indexOf(PHONE));
}

test("the premise: .tbl really is width:100%, which is why it squashes rather than overflows", () => {
  // If this ever stops being true the defect has a different shape and this whole file is about
  // the wrong thing. Assert the cause, not just the cure.
  assert.match(ADMIN, /\.tbl\s*\{[^}]*width:\s*100%/,
    ".tbl must be width:100% for the squash described in the header to be the real mechanism");
});

test("a wide table scrolls inside its own box on a phone", () => {
  const block = phoneBlock(APP);
  assert.ok(block.includes(".tbl"), "the phone breakpoint must carry a rule for .tbl at all");
  const rule = statementFrom(block, block.indexOf(".tbl"));
  assert.match(rule, /display:\s*block/, "display:block is what lets the table exceed its box");
  assert.match(rule, /overflow-x:\s*auto/, "and overflow-x:auto is what makes the box scroll");
});

test("headers are NEVER hidden on .tbl — seven anonymous numbers is worse than seven squashed ones", () => {
  const block = phoneBlock(APP);
  // The card pattern hides thead. If someone ever folds .tbl into that selector list, a financial
  // table loses its column names and every figure becomes unattributable.
  const hidden = [...block.matchAll(/([^{}]*)\{[^}]*display:\s*none[^}]*\}/g)]
    .map((m) => m[1])
    .filter((sel) => /\.tbl\b/.test(sel) && /thead/.test(sel));
  assert.deepEqual(hidden, [], "a .tbl thead must never be display:none");
});

test("the existing .score-table card treatment is not regressed by this release", () => {
  const block = phoneBlock(APP);
  assert.match(block, /\.score-table\s+thead\s*\{[^}]*display:\s*none/,
    "the score table's card pattern is correct for its shape and must survive");
  assert.match(block, /\.score-table\s+tr\s*\{[^}]*display:\s*block/);
});

test("the page itself still never scrolls sideways — only the table does", () => {
  const block = phoneBlock(APP);
  assert.match(block, /body\s*\{[^}]*overflow-x:\s*hidden/,
    "the deliberate rule stays; this release adds an inner scroller, it does not remove the outer guard");
});

/* ---------- negative controls: each mutates the real stylesheet ---------- */

test("NC-1: with overflow-x removed from the .tbl rule, the scroll assertion fails", () => {
  const block = phoneBlock(APP);
  const rule = statementFrom(block, block.indexOf(".tbl"));
  const broken = rule.replace(/overflow-x:\s*auto;?/, "");
  assert.notEqual(broken, rule, "MUTATION DID NOT LAND — overflow-x was not in the rule to remove");
  assert.doesNotMatch(broken, /overflow-x:\s*auto/,
    "without it the table cannot scroll and the guard above must redden");
});

test("NC-2: folding .tbl into the thead-hiding selector is caught", () => {
  const block = phoneBlock(APP);
  const mutated = block.replace(".score-table thead", ".tbl thead, .score-table thead");
  assert.notEqual(mutated, block, "MUTATION DID NOT LAND — the score-table thead rule was not found");
  const hidden = [...mutated.matchAll(/([^{}]*)\{[^}]*display:\s*none[^}]*\}/g)]
    .map((m) => m[1])
    .filter((sel) => /\.tbl\b/.test(sel) && /thead/.test(sel));
  assert.ok(hidden.length >= 1,
    "the labels-trap detector must fire when .tbl is folded in, or it is decoration");
});

/* v1.1 (iteration 153, the owner's mobile pass): A WIDTH IN vw UNITS BLEEDS SIDEWAYS in any
   window with a classic scrollbar — vw includes the scrollbar's width while the content box does
   not, so `width: min(420px, 92vw)` overflowed index.html by 4px at phone width on desktop
   (measured live 2026-08-27; .login-card in app.css, .ck-card in checkin.html, .kk-card in
   kiosk.html all carried the class, every one inside a padded container where `min(Npx, 100%)`
   is strictly better). Font-size clamp()s in vw are deliberate type scaling and are exempt —
   this ratchet is about WIDTHS. Corpus: the shared stylesheets plus every page's inline styles. */
import { readdirSync } from "node:fs";

function widthCorpus() {
  const out = [["app.css", APP], ["admin.css", ADMIN],
    ["tokens.css", blankComments(readFileSync(new URL("../../web/assets/tokens.css", import.meta.url), "utf8"))]];
  const webDir = new URL("../../web/", import.meta.url);
  for (const f of readdirSync(webDir).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(new URL(f, webDir), "utf8");
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) out.push([f, blankComments(m[1])]);
  }
  return out;
}

test("no width rule in the shipped corpus uses vw units (the scrollbar-bleed class)", () => {
  const corpus = widthCorpus();
  assert.ok(corpus.length > 40, `corpus is ${corpus.length} entries — the page glob is broken`);
  const hits = [];
  for (const [name, css] of corpus) {
    for (const m of css.matchAll(/(?:^|[;{])\s*(?:max-|min-)?width\s*:\s*([^;}]*\b\d+(?:\.\d+)?vw\b[^;}]*)/g)) {
      hits.push(`${name}: ${m[1].trim().slice(0, 48)}`);
    }
  }
  assert.deepEqual(hits, [],
    "a vw width bleeds under classic scrollbars — size against the padded container (% or px) instead");
});

test("NC-3: the vw-width detector fires on a planted rule", () => {
  const planted = ".x { width: min(420px, 92vw); }";
  const found = [...planted.matchAll(/(?:^|[;{])\s*(?:max-|min-)?width\s*:\s*([^;}]*\b\d+(?:\.\d+)?vw\b[^;}]*)/g)];
  assert.equal(found.length, 1, "the detector regex cannot see the exact defect it exists for");
});
