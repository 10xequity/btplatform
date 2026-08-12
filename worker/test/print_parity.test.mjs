/**
 * Boomtown Platform — §-0 B28 / §-1p WF-6: anywhere there is a print, there is also email and CSV
 * File: worker/test/print_parity.test.mjs · Version: v1.0 · Date: 2026-08-12 · Ships in: v0.138.0
 *
 * The owner, 2026-08-11 13:48, verbatim: *"Ensure anywhere there is a print, we also have email and
 * download to CSV."* That sentence is a RULE about a set, not a request for three buttons — so this
 * guard states it as a set rule: **any page whose own scripts call print() must also offer a CSV
 * download and the shared email hand-off.** A fourth print surface added next year fails here on
 * the day it is added, which is the whole point of writing it this way.
 *
 * MEASURED BEFORE BUILDING (iteration 65, and the recording from iteration 61 held):
 * three print surfaces — `tournament.html` (pool sheet), `admin-league.html` (weeks),
 * `admin-score-links.html` (cards). Only the pool sheet had a CSV; none had email.
 * *A grep for `window.print()` finds only two of the three — `tournament.js:333` calls bare
 * `print()`. The corpus below matches the call, not the spelling, and the NC plants a bare call.*
 *
 * THE EMAIL HALF IS A REUSE, NOT A SEND STACK, AND THAT IS THE DESIGN DECISION THIS FILE PINS.
 * `marketing.js` already ships event-scoped segments (W-F, v0.99.0: `filter.event`), campaigns, and
 * a `sendCampaign` that is ALREADY keyless-honest — and `admin-marketing.js` already accepts an
 * `?event=` deep link that opens the segment form with that event chosen, arriving today from the
 * registrations screen. So the email button hands the printed document to the path that exists.
 * Reusing it inherits the keyless honesty instead of restating it, which is why no assertion here
 * re-checks "says what was not emailed": that judgement lives in ONE place and is pinned by
 * marketing.test.mjs. A second sender would have needed its own copy of it, and would have drifted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");

/* Scripts a page loads, buster stripped. Deliberately duplicated from dangling_refs.test.mjs
   rather than imported: importing an export from a test FILE re-registers that file's tests in
   this run (route-extract.mjs's header records the cost). That header also sets the exit
   condition — "if a THIRD consumer ever needs it, move it to worker/testkit/". This is the
   second. When a third arrives, move it; until then four lines beat a foreign test suite. */
const scriptsOf = (html) =>
  [...html.matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^"]*)?"/g)].map((m) => m[1]);

/* ── pure verdicts ── */

/** A print CONTROL, not the word "print" in prose: an actual call to print() in the page's code.
 *  Matches `print()`, `window.print()` and `document.execCommand`-free spellings alike, but not
 *  `sprint()` or `printTitle` — the boundary is what makes prose and ids safe. */
export const callsPrint = (code) => /(^|[^.\w])(?:window\s*\.\s*)?print\s*\(\s*\)/.test(code);

/** A CSV download offered by this page's own code. */
export const offersCsv = (code) => /\.csv/.test(code);

/** The shared email hand-off, however the page gets its hands on it. Matches both the
 *  `BT_ADMIN.emailDocument(...)` spelling and the destructure-then-call idiom that three of the
 *  four callers use — the first draft pinned only the former and reddened against two correct
 *  pages. Pin that the page CALLS the shared helper, never how it spells the reference. */
export const offersEmail = (code) => /emailDocument\s*\(/.test(code);

/** THE HELPER MODULE IS EXCLUDED FROM EVERY PAGE'S CORPUS, AND THAT IS LOAD-BEARING.
 *  admin-nav.js DEFINES emailDocument and is loaded by every admin page, so a scan that included
 *  it would find the definition on all 40-odd of them and report a clean sweep while the buttons
 *  did not exist. What a page OFFERS is what its own scripts do, never what a shared module
 *  contains. NC-5 below plants that exact mistake and proves the exclusion is what catches it. */
const HELPER = "assets/admin-nav.js";

/** Every page, with the blanked bytes of every script it loads. */
function pages(includeHelper = false) {
  const out = new Map();
  for (const f of readdirSync(WEB)) {
    if (!f.endsWith(".html")) continue;
    const html = read(f);
    const code = scriptsOf(html)
      .filter((p) => includeHelper || p !== HELPER)
      .map((p) => { try { return blankComments(read(p)); } catch { return ""; } })
      .join("\n");
    out.set(f, { html, code });
  }
  return out;
}

const printSurfaces = (corpus) => [...corpus].filter(([, p]) => callsPrint(p.code)).map(([n]) => n);

/* ── the rule ── */

test("every page that can PRINT can also download a CSV and email it (the owner's sentence, as a set rule)", () => {
  const corpus = pages();
  assert.ok(corpus.size >= 50, `page corpus shrank to ${corpus.size} — this guard would pass by scanning nothing`);
  const surfaces = printSurfaces(corpus);
  // Positive control anchored on what the DESIGN guarantees, not on a page that might legitimately
  // move: printing is a real feature of this product, so the scan must find it in several places.
  assert.ok(surfaces.length >= 3,
    `only ${surfaces.length} print surface(s) found — the detector is not reading the corpus (grep for print( by hand before believing this)`);
  const missing = [];
  for (const name of surfaces) {
    const { code } = corpus.get(name);
    if (!offersCsv(code)) missing.push(`${name} can print but offers no CSV download`);
    if (!offersEmail(code)) missing.push(`${name} can print but offers no email hand-off`);
  }
  assert.deepEqual(missing, [], "the owner asked for all three wherever there is one:\n" + missing.join("\n"));
});

test("the email hand-off is ONE helper, and it hands off to the path that already exists", () => {
  const nav = blankComments(read("assets/admin-nav.js"));
  assert.match(nav, /emailDocument/, "BT_ADMIN lost emailDocument — the three callers have no helper");
  assert.match(nav, /admin-marketing\.html\?event=/,
    "the hand-off stopped pointing at the campaign composer — a second send stack is the thing this design refuses");
  assert.match(nav, /BT_ADMIN\s*=\s*\{[^}]*emailDocument/,
    "emailDocument exists but is not exported on BT_ADMIN, so no page can call it");
});

test("the composer still honours the OLD deep link and now also picks up a handed-off draft", () => {
  const mkt = blankComments(read("assets/admin-marketing.js"));
  assert.match(mkt, /segmentModal\(null, fromEvent\)/,
    "the registrations screen's existing ?event= entry point broke — W-F's contract is not ours to drop");
  assert.match(mkt, /BT_PRINT_DRAFT|bt_print_draft/,
    "the composer never reads the handed-off document, so every email button lands on an empty form");
});

test("all three known surfaces are wired — named, so a silent regression to two is loud", () => {
  const corpus = pages();
  const surfaces = printSurfaces(corpus);
  for (const page of ["tournament.html", "admin-league.html", "admin-score-links.html"]) {
    assert.ok(surfaces.includes(page), `${page} stopped offering print — if that was deliberate, strike it here`);
  }
});

/* ── negative controls — each mutates real input, and each asserts the mutation landed ── */

test("NC-1: a print surface with no siblings is caught — planted into a REAL page's code", () => {
  const corpus = pages();
  const victim = [...corpus].find(([, p]) => !callsPrint(p.code) && !offersEmail(p.code));
  assert.ok(victim, "every page already prints — the NC has nothing to plant into");
  const [name, page] = victim;
  const mutated = page.code + "\n$('x').onclick = () => print();";
  assert.notEqual(mutated, page.code, `the plant did not change ${name}'s code`);
  assert.ok(callsPrint(mutated), "the print detector cannot fire");
  assert.equal(offersEmail(mutated), false, "and this page would be reported, which is the point");
});

test("NC-2: the detector reads calls, not prose or identifiers", () => {
  assert.equal(callsPrint("Print the cards and hand them out"), false, "prose must never count as a control");
  assert.equal(callsPrint('$("printTitle").textContent = x'), false, "an id containing print is not a call");
  assert.equal(callsPrint("sprint()"), false, "a longer word ending in print is not print");
  assert.ok(callsPrint("$('printBtn').onclick = () => print();"), "a bare print() IS the call tournament.js makes");
  assert.ok(callsPrint("window.print()"), "and so is the spelling the other two use");
});

test("NC-3: stripping the helper off BT_ADMIN is caught", () => {
  const nav = read("assets/admin-nav.js");
  const stripped = nav.replace(/emailDocument/g, "emailDocumentXX");
  assert.notEqual(stripped, nav, "the strip control found no emailDocument to remove");
  assert.equal(/BT_ADMIN\s*=\s*\{[^}]*emailDocument[,\s}]/.test(stripped), false,
    "the export detector cannot fail");
});

test("NC-5: including the helper module would make the email check vacuous — the exclusion is the check", () => {
  // The mistake this plants is the one a reader would most plausibly make: scan everything the
  // page loads. admin-nav.js defines emailDocument, so every admin page would "offer" it.
  const naive = pages(true);
  const real = pages();                       // built once — the first draft rebuilt it per page
  const wrongly = [...naive].filter(([n, p]) => offersEmail(p.code) && !offersEmail(real.get(n).code));
  assert.ok(wrongly.length >= 10,
    `only ${wrongly.length} page(s) would be wrongly cleared by including the helper — the exclusion may no longer be doing anything`);
  assert.ok(!offersEmail(real.get(wrongly[0][0]).code),
    `${wrongly[0][0]} must NOT count as offering email once the helper is excluded`);
});

test("NC-4: the comment stripper works and does not eat code", () => {
  assert.equal(callsPrint(blankComments("// window.print()")), false, "a commented-out call must not count");
  assert.ok(callsPrint(blankComments("print(); // the pool sheet")), "and a real call beside a comment must");
  const nav = blankComments(read("assets/admin-nav.js"));
  assert.match(nav, /downloadText/, "stripping removed real code from admin-nav.js");
});
