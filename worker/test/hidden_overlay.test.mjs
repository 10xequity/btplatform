/**
 * Boomtown Platform — tester round 2 item 6 / queue E1: the unclosable "Who plays here?" overlay
 * File: worker/test/hidden_overlay.test.mjs · Version: v1.0 · Date: 2026-08-09 · Ships in: v0.119.0
 *
 * WHY. The owner reported the brackets sheet "still broken — cannot get past who plays here pop
 * up, cannot be closed." E1's close mechanics were ALL BUILT and wired (Close button, backdrop
 * click, Escape) — and none of them worked on screen, because the dialog is hidden with the
 * `hidden` ATTRIBUTE while the stylesheet says `.br-pick { display: grid; position: fixed;
 * inset: 0 }`. Author CSS `display` beats the user-agent's `[hidden] { display: none }` in the
 * cascade, so the overlay painted from PAGE LOAD and `closeChooser()` "succeeded" in JS while
 * the user stayed trapped — a control reporting success it did not achieve, in CSS form.
 *
 * NO ROUTE-LEVEL TEST COULD SEE THIS (the named blindness: the suite cannot render a cascade),
 * so the guard is static and mechanical: any element that relies on the `hidden` attribute while
 * its class carries an author `display:` rule must also ship the `.class[hidden]` override —
 * the idiom admin-waivers.html:52 already models. Checked across EVERY web/*.html inline style.
 *
 * SECOND DEFECT, SAME ROOT: the chooser's list buttons ALSO carried class "br-pick"
 * (admin-brackets.js), so each button inherited position:fixed inset:0 and stacked as its own
 * full-screen overlay INSIDE the dialog. The overlay class must appear on exactly one element.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const html = (name) => readFileSync(new URL(name, WEB), "utf8");
const BRACKETS_HTML = html("admin-brackets.html");
const BRACKETS_JS = readFileSync(new URL("assets/admin-brackets.js", WEB), "utf8");

/* ---------- the checker: hidden-attribute elements vs author display rules ---------- */

/* v0.145.0 — CSS COMMENTS ARE STRIPPED NOW, AND THIS GUARD USED TO SCORE THEM AS RULES.
   `classHasAuthorDisplay` looks for `.cls` then `{` then `display:`, and its `[^{}]*` window
   happily spans from a class name MENTIONED IN A COMMENT to the next real rule's display. K-14
   added a comment reading "Press feedback comes from .btn/.tab, which already carry it" above a
   `display: flex` rule, and this guard reported `.btn` as defeating its own hidden attribute —
   a false positive whose only other cure would have been rewording prose to appease a broken
   check. Standards guard-discipline instance 3, which tokens.test.mjs already strips for.

   Only block comments are blanked, never `//`: a style block can carry `url(https://...)`, and
   blanking from `//` to end of line would delete real declarations and turn this guard into a
   source of false CLEANS — the worst failure a guard can have. NC-COMMENT proves it both ways. */
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ");

function styleText(doc) {
  return stripCssComments(
    [...doc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"));
}

/** Classes of elements that carry the `hidden` attribute in markup. */
function hiddenElementClasses(doc) {
  const out = new Set();
  for (const m of doc.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const tag = m[0];
    if (!/\shidden(\s|>|\/)/.test(tag)) continue;
    const cls = tag.match(/class="([^"]*)"/);
    if (cls) for (const c of cls[1].split(/\s+/).filter(Boolean)) out.add(c);
  }
  return out;
}

/** Does this file's inline CSS give .cls an author display other than none? */
function classHasAuthorDisplay(css, cls) {
  // Bodies are brace-bounded (no nesting inside a rule body in these files), so [^}] is a
  // bounded window, not a distance anchor — the shape D-17b asks for.
  const rx = new RegExp("\\." + cls + "(?![\\w-])[^{}]*\\{[^}]*display\\s*:\\s*(?!none)", "g");
  return rx.test(css);
}

function classHasHiddenOverride(css, cls) {
  const rx = new RegExp("\\." + cls + "(?![\\w-])[^{}]*\\[hidden\\][^{}]*\\{[^}]*display\\s*:\\s*none");
  return rx.test(css);
}

/** All violations in one document: hidden-reliant classes whose display rule has no override. */
function hiddenDisplayViolations(doc) {
  const css = styleText(doc);
  const bad = [];
  for (const cls of hiddenElementClasses(doc)) {
    if (classHasAuthorDisplay(css, cls) && !classHasHiddenOverride(css, cls)) bad.push(cls);
  }
  return bad;
}

/* ---------- the guard, repo-wide ---------- */

test("no element that relies on `hidden` has an author display rule without the [hidden] override — every web page", () => {
  const pages = readdirSync(WEB).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length > 30, `only ${pages.length} pages found — the web/ path is wrong and this guard is scanning nothing`);
  const violations = [];
  for (const p of pages) {
    for (const cls of hiddenDisplayViolations(html(p))) violations.push(`${p} → .${cls}`);
  }
  assert.deepEqual(violations, [],
    "these classes defeat their own `hidden` attribute — the element paints even when hidden, " +
    "which is exactly the unclosable brackets overlay: " + violations.join(", "));
});

test("NC — stripping the real override out of admin-brackets.html makes the checker fire", () => {
  // Sanity: the real file must currently pass.
  assert.deepEqual(hiddenDisplayViolations(BRACKETS_HTML), [], "the shipped page should be clean before mutating");

  // Mutate the REAL input: remove the .br-pick[hidden] override line.
  const mutated = BRACKETS_HTML.replace(/\.br-pick\[hidden\][^}]*\}/, "");
  assert.notEqual(mutated, BRACKETS_HTML, "mutation did not land — no override was removed");
  const fired = hiddenDisplayViolations(mutated);
  assert.ok(fired.includes("br-pick"),
    "the override was stripped and the checker stayed green — every pass above is vacuous");
});

/* ---------- the overlay class appears on exactly one element ---------- */

test("the overlay class br-pick decorates exactly ONE element: the dialog container, never the list buttons", () => {
  // (?<![\w-]) / (?![\w-]) so br-pick-box / br-pick-list do not count as br-pick.
  const inMarkup = [...BRACKETS_HTML.matchAll(/class="([^"]*)"/g)]
    .filter((m) => m[1].split(/\s+/).includes("br-pick")).length;
  assert.equal(inMarkup, 1, `br-pick appears on ${inMarkup} elements in the page — it must be the container alone`);

  const js = blankComments(BRACKETS_JS);
  const inTemplates = [...js.matchAll(/class="([^"]*)"/g)]
    .filter((m) => m[1].split(/\s+/).includes("br-pick")).length;
  assert.equal(inTemplates, 0,
    "a JS template puts the overlay class on child elements — each becomes a full-screen " +
    "position:fixed layer inside the dialog (the second half of the tester-round defect)");
});

/* ---------- the three exits, pinned (enumerate the exits) ---------- */

test("all three ways out of the chooser stay wired: Close button, backdrop click, Escape", () => {
  const js = blankComments(BRACKETS_JS);
  assert.match(js, /\$\("bPickClose"\)\.addEventListener\("click",\s*closeChooser\)/,
    "the Close button no longer calls closeChooser");
  assert.match(js, /e\.target === \$\("bPick"\)\)\s*closeChooser\(\)/,
    "the backdrop click no longer closes the chooser");
  assert.match(js, /e\.key === "Escape"[^)]*\)\s*closeChooser\(\)/,
    "Escape no longer closes the chooser — a dialog with no keyboard exit is a trap");

  // NC: the same three assertions must FAIL against source with the exits removed.
  const gutted = js.replace(/closeChooser/g, "closedChooser");
  assert.notEqual(gutted, js, "mutation did not land");
  assert.doesNotMatch(gutted, /\$\("bPickClose"\)\.addEventListener\("click",\s*closeChooser\)/,
    "the mutated source still matches — the assertion is not reading what it claims to read");
});

test("NC-COMMENT — a class named only in a CSS comment is not scored as a rule, but a real one is", () => {
  // v0.145.0. The false positive that produced the stripper: prose above a display rule. Both
  // halves matter — a stripper that ate real declarations would make this guard report clean.
  const commented = `<style>
    /* Press feedback comes from .btn/.tab, which already carry it. */
    .sched-controls { display: flex; }
    .sched-controls[hidden] { display: none; }
  </style>`;
  assert.deepEqual(hiddenDisplayViolations(
    `<div class="btn" hidden></div><div class="sched-controls" hidden></div>` + commented), [],
    "a class mentioned only in a comment was scored as an author display rule");

  const live = `<style>.btn { display: inline-flex; }</style><button class="btn" hidden></button>`;
  assert.deepEqual(hiddenDisplayViolations(live), ["btn"],
    "the stripper ate a REAL rule — this guard would now report clean on the defect it exists for");
});
