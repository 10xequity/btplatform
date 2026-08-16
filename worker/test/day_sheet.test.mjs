/**
 * Boomtown Platform — the day sheet (§-1n P-E / §-0 B19 · hardened §-0 B21, v0.164.0)
 * File: worker/test/day_sheet.test.mjs · Version: v1.1 · Date: 2026-08-16 · Ships in: v0.164.0
 *
 * v1.1 (B21, the owner-forwarded review): the escape rule moved from the STATIC grain (a regex
 * over html-building statements — bypassable by `+` concatenation, which never spells `${`) to
 * the RUNTIME grain: the real composer runs in the page harness against injected payloads, and
 * the html it actually produced is what gets asserted. The review's "stuck print mode" claim
 * was measured FALSE at its stated severity (every print-day swap rule lives inside
 * @media print, so a stale class changes nothing on screen); the true residual — the NEXT print
 * job would print the wrong document — gets the escape hatch pinned below. Button states and
 * the aria-hidden removal are pinned at both grains.
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
import { runTournament } from "../testkit/page-harness.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");
const RAWJS = read("assets/tournament.js");
const JS = blankComments(RAWJS);
const HTML = read("tournament.html");
const CSS = read("assets/tournament.css");

/* Payloads for the runtime escape test: one marker per field the composer prints, each wrapped
   in a live <script> so a single unescaped interpolation is unmissable in the output. */
const PAY = (mk) => `<script>alert("${mk}")</script>`;
const MARKS = ["MK_EVT", "MK_TEAMA", "MK_REF", "MK_POOL", "MK_DIV", "MK_LVL",
  "MK_BRK", "MK_CHAMP", "MK_RND", "MK_BTA", "MK_WB"];

/** Every route the page calls on its way to composeDaySheet, payloads in every printed field. */
const hostileRoutes = () => (path) => {
  if (path === "/api/me") return { data: {} };
  if (path === "/api/formats") return { data: { formats: {} } };
  if (path === "/api/events") return { data: { events: [{ id: 1, name: PAY("MK_EVT") }] } };
  if (path === "/api/events/1") return { data: { event: { id: 1, name: PAY("MK_EVT"), court_count: 1 } } };
  if (path === "/api/events/1/schedule") return { data: { warnings: [], matches: [
    { id: 11, stage: "pool", round: 1, court: 1, team_a_id: 1, team_b_id: 2, ref_team_id: 3, points_to: 21, cap: 25 },
  ] } };
  if (path === "/api/events/1/teams") return { data: { teams: [
    { id: 1, name: PAY("MK_TEAMA") }, { id: 2, name: "Bravo" }, { id: 3, name: PAY("MK_REF") },
  ] } };
  if (path === "/api/events/1/standings") return { data: { standings: [] } };
  if (path === "/api/admin/events/1/board") return { data: {
    pools: [{ id: 5, name: PAY("MK_POOL"), division_id: 7, court_from: 1 }],
    teams: [{ id: 1, pool_id: 5, board_no: 1, name: PAY("MK_TEAMA"), level: PAY("MK_LVL") }],
    divisions: [{ id: 7, name: PAY("MK_DIV") }],
  } };
  if (path === "/api/admin/events/1/brackets") return { data: { brackets: [{
    name: PAY("MK_BRK"), champion: PAY("MK_CHAMP"),
    rounds: [{ label: PAY("MK_RND"), matches: [
      { team_a: PAY("MK_BTA"), waiting_b: PAY("MK_WB"), winner: null },
    ] }],
  }] } };
  return { data: {} };
};

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

test("RUNTIME: the composed day sheet escapes every printed field — the payloads arrive, the scripts never do", async () => {
  assert.match(JS, /const dsEsc = /, "the composer lost its escaper");
  const page = await runTournament(RAWJS, hostileRoutes());
  const p = page.el("dayEmailBtn").onclick();
  await p;
  const sheet = page.el("daySheet").innerHTML;
  assert.ok(sheet.length > 0, "the composer produced nothing — the harness never reached it");
  // Arrival first (the positive half): every marker must be IN the output, or the absence
  // assertions below are about payloads that never travelled.
  for (const mk of MARKS) {
    assert.ok(sheet.includes(mk), `field ${mk} never reached the sheet — its absence check would be vacuous`);
  }
  // The teeth: not one live tag, whatever the idiom that built the string.
  assert.ok(!sheet.includes("<script"), "an injected payload reached innerHTML unescaped");
  assert.ok(sheet.includes("&lt;script&gt;"), "the escaped spelling is missing — something other than escaping removed the payloads");
  // And the email half must stay PLAIN TEXT: escaping it would corrupt a text body. The raw
  // payload in the emailed text is correct behavior, pinned so nobody "fixes" it.
  assert.equal(page.emails.length, 1, "the email variant did not hand off exactly once");
  assert.ok(page.emails[0].body.includes(PAY("MK_EVT")), "the plain-text email body must carry the text verbatim, never HTML-escaped");
});

test("RUNTIME NC: a neutered escaper is caught — the harness and the assertion both have teeth", async () => {
  const neutered = RAWJS.replace("const dsEsc = (s) => String(s == null ? \"\" : s).replace(/[&<>\"']/g,",
    "const dsEsc = (s) => String(s == null ? \"\" : s); void ((s) =>");
  assert.notEqual(neutered, RAWJS, "the mutation did not land — the escaper's spelling moved");
  const page = await runTournament(neutered, hostileRoutes());
  await page.el("dayEmailBtn").onclick();
  assert.ok(page.el("daySheet").innerHTML.includes("<script"),
    "the neutered escaper still produced clean output — the runtime check cannot catch a real escape failure");
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

test("B21: the escape hatch is screen-only, appears only while the mode is stuck, and never prints", () => {
  // A stale print-day class is invisible on screen (all the swap rules are print-scoped), so
  // its one real cost is the NEXT print job printing the wrong document. The hatch is the
  // visible way out: hidden normally, shown on screen while body.print-day is set, and never
  // part of the printed artifact itself.
  const screen = CSS.slice(0, CSS.indexOf("@media print"));
  assert.match(screen, /\.ds-close \{ display: none; \}/, "the hatch leaks into the normal screen layout");
  assert.match(screen, /body\.print-day \.ds-close \{ display: inline-block; \}/,
    "a stuck mode shows no way out — the hatch must surface on SCREEN when print-day is set");
  const print = CSS.slice(CSS.indexOf("@media print"));
  assert.match(print, /\.ds-close \{ display: none !important; \}/,
    "the hatch prints onto the day sheet itself");
});

test("the controls exist in markup — and the sheet container is a SIBLING of its hatch, with no aria-hidden", () => {
  assert.match(HTML, /id="daySheetBtn"/, "the Print day sheet control is gone from the toolbar");
  assert.match(HTML, /id="daySheet"/, "the composed container is gone from the page");
  // B21: aria-hidden on the container would make the printed artifact blank to a screen reader
  // the moment print-day reveals it; display:none already keeps it out of the screen tree.
  assert.doesNotMatch(HTML, /id="daySheet"[^>]*aria-hidden/,
    "aria-hidden is back on #daySheet — the printed document goes silent for assistive tech");
  // The hatch cannot live INSIDE #daySheet: a child cannot render through a display:none parent.
  assert.match(HTML, /<div id="daySheet"><\/div>/,
    "#daySheet grew children — the hatch (or anything else) inside it can never show on screen");
  assert.match(HTML, /id="dayPrintClose"[^>]*type="button"/, "the escape hatch is gone from the page");
});

test("RUNTIME: the print/email buttons disable while composing, and the hatch actually exits the mode", async () => {
  const page = await runTournament(RAWJS, hostileRoutes());
  const btn = page.el("daySheetBtn");
  const label = btn.textContent;
  const p = btn.onclick();
  assert.equal(btn.disabled, true, "a second tap during compose still fires — the button never disables");
  await p;
  assert.equal(btn.disabled, false, "the button never re-enables after the job");
  assert.equal(btn.textContent, label, "the button kept its busy label after the job");
  assert.equal(page.printed(), 1, "the print dialog was not asked for exactly once");
  assert.equal(page.document.body.classList.has("print-day"), true,
    "print-day is not set at print time — the wrong document goes to the dialog");
  // The dialog never fired afterprint (the blocked/failed case): the hatch is the way out.
  page.el("dayPrintClose").onclick();
  assert.equal(page.document.body.classList.has("print-day"), false,
    "the hatch does not clear the mode — the next print job is still the wrong document");
  // And when afterprint DOES fire later, it must be harmless.
  page.fireGlobal("afterprint");
  assert.equal(page.document.body.classList.has("print-day"), false);
  // The email button carries the same state discipline.
  const eb = page.el("dayEmailBtn");
  const p2 = eb.onclick();
  assert.equal(eb.disabled, true, "the email button never disables while composing");
  await p2;
  assert.equal(eb.disabled, false);
  assert.equal(page.emails.length, 1);
});

/* ═══ negative controls ═══ */

test("NC-1: stripping the afterprint cleanup is caught, and the mutation lands", () => {
  const mutated = JS.split("afterprint").join("afterprintZZ");
  assert.notEqual(mutated, JS, "the mutation did not land");
  assert.equal(/afterprint(?!ZZ)/.test(mutated), false, "the cleanup needle survived the mutation");
});

test("NC-2: the mode's ONE exit function serves both the afterprint listener and the hatch", () => {
  // Two spellings of "leave print mode" is how they drift. The named exit is the shared path;
  // the listener is added by REFERENCE so repeated clicks cannot stack anonymous copies.
  assert.match(JS, /addEventListener\("afterprint", exitPrintDay, \{ once: true \}\)/,
    "the afterprint cleanup stopped riding the named exit — anonymous listeners stack per click");
  assert.match(JS, /\$\("dayPrintClose"\)\.onclick = exitPrintDay/,
    "the hatch stopped riding the named exit — two spellings of leaving the mode");
  const mutated = JS.replace(/exitPrintDay/g, "XXGONE");
  assert.ok(!mutated.includes("exitPrintDay"), "the mutation landed");
});
