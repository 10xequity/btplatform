/**
 * Boomtown Platform — live-board motion guard
 * File: worker/test/live_motion.test.mjs · Version: v1.0 · Date: 2026-08-04 · Ships in: v0.84.0
 *
 * Owner item 2, the last of the eight: "add cool animations to the live view so when things are
 * updated there is an animation that is engaging for viewers."
 *
 * WHAT THIS GUARD ASSERTS, STATED PLAINLY, BECAUSE THAT IS THE LESSON OF C11.
 * Two guards stood over twenty-four broken buttons and both passed honestly: one checked token
 * DRIFT (those buttons used no tokens at all) and one forbade REDEFINING `.btn` (those pages merely
 * failed to USE it). A page can fail by using NOTHING, and a drift guard is structurally blind to
 * that. So this file does not ask "did the motion values drift". It asks four things that can each
 * be false while the page still parses, renders, and looks fine in a screenshot:
 *
 *   1. DOES THE MOTION EXIST AT ALL. Every animation name the page references must resolve to an
 *      `@keyframes` that is actually defined. `animation: lv-popp 180ms` is valid CSS, throws
 *      nothing, logs nothing, and animates nothing — the exact shape of the button bug in CSS form.
 *   2. IS IT BUILT ON THE TOKENS. Easing and the movement durations come from tokens.css. A raw
 *      `cubic-bezier(...)` or a bare `ease-in` in this page is drift the token guard cannot see,
 *      because tokens.test.mjs ratchets the tokens, not the pages that ignore them.
 *   3. IS THE MOTION DIFF-DRIVEN. `render()` replaces innerHTML every 25 seconds. If the page
 *      animates the render rather than the DIFF, every card animates every poll forever — which is
 *      the "no enter-animation on high-frequency controls" rule in standards §5, violated on a
 *      wall display nobody is watching. The one line that implements the rule is pinned.
 *   4. IS THE DEGRADED STATE SHOWN RATHER THAN ANIMATED OVER. `degraded`, `degraded_note` and
 *      `current_round` were in the payload for releases with NO page reading them (failure class 1:
 *      built, tested, and uncalled). A board missing a section was silently asserting the section
 *      was empty.
 *
 * WHAT IT CANNOT SEE, SO THAT NOBODY READS A GREEN RESULT AS MORE THAN IT IS: whether the motion
 * looks good. Timing, overlap and feel are judged by eye, in slow motion, on the real board. This
 * guard proves the motion is wired, tokenised, conditional, and honest — not that it is pleasant.
 *
 * Every verdict below is a pure function over source text, so the real files and the synthetic
 * negative controls go through identical code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../../web/live.html", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../../web/assets/live.js", import.meta.url), "utf8");
const TOKENS = readFileSync(new URL("../../web/assets/tokens.css", import.meta.url), "utf8");

/* ── pure verdicts ── */

const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** The page's own <style> blocks, comments stripped — prose must never satisfy a detector. */
export function styleCss(html) {
  return stripCssComments(
    [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"));
}

/** Every `@keyframes NAME` defined in this CSS. */
export function keyframesDefined(css) {
  return new Set([...css.matchAll(/@keyframes\s+([A-Za-z][\w-]*)/g)].map((m) => m[1]));
}

/**
 * Every animation NAME referenced by an `animation:` / `animation-name:` declaration.
 *
 * The shorthand can carry durations, easings, fill modes and counts in any order, so the name is
 * recovered by removing everything that is definitionally not a name: times, `var(...)` calls,
 * numbers, and the CSS-wide animation keywords. Whatever survives is the name.
 */
export function animationsReferenced(css) {
  const KEYWORDS = new Set([
    "none", "both", "forwards", "backwards", "infinite", "alternate", "alternate-reverse",
    "reverse", "normal", "paused", "running", "linear", "ease", "ease-in", "ease-out",
    "ease-in-out", "step-start", "step-end",
  ]);
  const out = new Set();
  for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    const value = m[1]
      .replace(/!\s*important/gi, " ")                   // `animation: none !important` is not a name
      .replace(/var\([^)]*\)/g, " ")
      .replace(/(cubic-bezier|steps)\([^)]*\)/g, " ");
    for (const tok of value.split(/[\s,]+/).filter(Boolean)) {
      if (/^-?[\d.]+m?s?$/.test(tok)) continue;          // 180ms, .5s, 3
      if (KEYWORDS.has(tok.toLowerCase())) continue;
      out.add(tok);
    }
  }
  return out;
}

/** Animation names that are used but never defined — CSS that runs and does nothing. */
export const danglingAnimations = (css) => {
  const defined = keyframesDefined(css);
  return [...animationsReferenced(css)].filter((n) => !defined.has(n));
};

/** Motion values written by hand instead of taken from tokens.css. */
export function hardcodedEasings(css) {
  const bad = [];
  // A literal curve in a page is drift the token guard cannot see: it ratchets tokens.css, not the
  // pages that decline to use it.
  for (const m of css.matchAll(/cubic-bezier\([^)]*\)/g)) bad.push(m[0]);
  // `ease-in` starts slow, so it delays the moment the eye is most on it. `ease-in-out` is excluded
  // because it is a legitimate token for something already on screen moving from A to B.
  for (const m of css.matchAll(/\bease-in\b(?!-out)/g)) bad.push(m[0]);
  return bad;
}

/** Declarations that name an animation or transition but no token easing. */
export function untokenisedMotion(css) {
  const bad = [];
  for (const m of css.matchAll(/(animation|transition)\s*:\s*([^;}]+)/g)) {
    const value = m[2].trim();
    if (/^none\b/.test(value)) continue;                 // `animation: none` is a kill switch
    if (/var\(--ease-/.test(value)) continue;
    bad.push(`${m[1]}: ${value}`);
  }
  return bad;
}

/** Does the reduced-motion block actually switch animation off, or only transition? */
export function reducedMotionCovers(css) {
  const covered = { transition: false, animation: false };
  const at = css.indexOf("prefers-reduced-motion");
  if (at === -1) return covered;
  const body = css.slice(at, at + 400);
  covered.transition = /transition\s*:\s*none|transition-duration\s*:/.test(body);
  covered.animation = /animation\s*:\s*none|animation-duration\s*:/.test(body);
  return covered;
}

/* ── 1. the motion exists at all ── */

test("every animation the page references resolves to a keyframe that exists", () => {
  const css = styleCss(HTML);
  assert.ok(animationsReferenced(css).size >= 3,
    `only ${animationsReferenced(css).size} animations found — a guard over an empty corpus reports clean by knowing nothing`);
  assert.deepEqual(danglingAnimations(css), [],
    "an animation naming a keyframe that does not exist is valid CSS that animates nothing");
});

test("the keyframes that do exist are all used, so none is dead weight", () => {
  const css = styleCss(HTML);
  const referenced = animationsReferenced(css);
  const orphans = [...keyframesDefined(css)].filter((n) => !referenced.has(n));
  assert.deepEqual(orphans, [], "keyframes defined and never referenced — either wire them or delete them");
});

/* ── 2. it is built on the tokens ── */

test("tokens.css still owns the motion vocabulary this page leans on", () => {
  // If these disappear, every assertion about using them passes vacuously.
  for (const t of ["--ease-out", "--ease-in-out", "--dur-pop", "--dur-modal"]) {
    assert.ok(TOKENS.includes(t), `tokens.css no longer declares ${t} — has the motion scale moved?`);
  }
});

test("the page invents no motion values of its own", () => {
  assert.deepEqual(hardcodedEasings(styleCss(HTML)), [],
    "easing belongs in tokens.css; a literal curve here is drift no token guard can see");
});

test("every animation and transition on this page takes its easing from a token", () => {
  assert.deepEqual(untokenisedMotion(styleCss(HTML)), [],
    "a motion declaration with no var(--ease-*) is using the browser default, not the design system");
});

test("nothing appears out of nothing, and nothing animates every property", () => {
  const css = styleCss(HTML);
  assert.ok(!/scale\(0\)/.test(css), "scale(0) entry: nothing in the real world appears from nothing");
  assert.ok(!/transition\s*:\s*all\b/.test(css), "transition: all animates properties nobody chose");
});

/* ── 3. the motion is diff-driven, not render-driven ── */

test("the page diffs payloads and animates only the difference", () => {
  // The whole design in one property. Without a snapshot of the previous payload there is nothing to
  // compare, so the only thing left to animate is the render itself — every card, every 25 seconds.
  assert.match(PAGE, /let prev = null/, "no previous-payload snapshot means nothing to diff against");
  assert.match(PAGE, /function snapshot\(/);
  assert.match(PAGE, /prev = now/, "the snapshot has to be carried forward or every poll looks new");
});

test("a poll that changed nothing animates nothing — the line that makes that true", () => {
  // This single comparison is what keeps a 25-second refresh from becoming a flicker every 25
  // seconds on a display left running all afternoon (standards §5).
  assert.match(PAGE, /if \(had === has\) continue;/,
    "without this, an unchanged card is still marked as changed on every poll");
});

test("motion is gated on prefers-reduced-motion in the script, not only in the stylesheet", () => {
  // The stylesheet neutralises the animation; the script must also skip the layout reads that feed
  // it. Measuring row positions for a FLIP nobody will see is work done to produce nothing.
  assert.match(PAGE, /prefers-reduced-motion/);
  assert.match(PAGE, /reduced\(\)/);
});

test("the reduced-motion block switches OFF animation, not just transition", () => {
  // The previous version of this page covered `transition` alone. Every effect added in v0.84.0 is
  // an @keyframes animation, so that block would have let all of them straight through.
  const cover = reducedMotionCovers(styleCss(HTML));
  assert.ok(cover.transition, "reduced motion must still stop transitions");
  assert.ok(cover.animation, "reduced motion must stop animations too — this page is all keyframes");
});

/* ── 4. the degraded state is shown, not animated over ── */

test("the page renders the degraded flag and note the server has been sending since v0.77.0", () => {
  // Failure class 1: built, tested, and uncalled. The API side is covered by live_board.test.mjs;
  // nothing asserted the page did anything with it, and for several releases it did not.
  assert.match(PAGE, /d\.degraded/, "the page must read the flag");
  assert.match(PAGE, /degraded_note/, "and show the server's own sentence, not one invented here");
  assert.match(HTML, /id="lvDegraded"/, "and there must be somewhere to put it");
  assert.match(HTML, /id="lvDegraded"[^>]*aria-live/, "a status that appears mid-poll has to announce itself");
});

test("a degraded board animates nothing", () => {
  // A section that came back empty because its read failed looks exactly like a section that
  // emptied. Motion would assert a change we cannot know happened.
  assert.match(PAGE, /const quiet = reduced\(\) \|\| !!d\.degraded/);
  assert.match(PAGE, /prev = null;\s*\/\/ do not diff/,
    "after a degraded poll the snapshot must be dropped, not diffed against");
});

test("current_round reaches the screen", () => {
  assert.match(PAGE, /d\.current_round/);
  assert.match(HTML, /id="lvRound"/);
});

/* ── negative controls: mutate the REAL files and prove each verdict can fail ──
   Each control changes the shipped source, not a synthetic fixture, and asserts the mutation
   actually applied first — a control whose edit silently missed is testing nothing. */

test("NC — a misspelt animation name is caught", () => {
  const css = styleCss(HTML);
  assert.deepEqual(danglingAnimations(css), [], "the real page should be clean before mutating it");

  const broken = css.replace("animation: lv-pop var(--dur-pop)", "animation: lv-popp var(--dur-pop)");
  assert.notEqual(broken, css, "the mutation did not apply — this control was testing nothing");
  assert.deepEqual(danglingAnimations(broken), ["lv-popp"],
    "a typo'd animation name must be caught; the browser will not tell anyone");
});

test("NC — deleting a keyframe block is caught even with the reference left intact", () => {
  // The other direction of the same defect: the reference is spelled right, the definition is gone.
  const css = styleCss(HTML);
  const stripped = css.replace(/@keyframes lv-enter\s*\{[^}]*\}/, "");
  assert.notEqual(stripped, css, "the mutation did not apply");
  assert.ok(danglingAnimations(stripped).includes("lv-enter"),
    "an animation whose keyframes were deleted still parses and still does nothing");
});

test("NC — a hand-written easing curve is caught", () => {
  const css = styleCss(HTML);
  assert.deepEqual(hardcodedEasings(css), []);

  const drifted = css.replace("var(--ease-out)", "cubic-bezier(0.4, 0, 0.2, 1)");
  assert.notEqual(drifted, css, "the mutation did not apply");
  assert.ok(hardcodedEasings(drifted).length > 0, "a literal curve must be caught");
  assert.ok(untokenisedMotion(drifted).length > 0, "and it must also register as untokenised motion");
});

test("NC — a bare ease-in is caught, and ease-in-out is not mistaken for it", () => {
  // The exemption has to be real in both directions, or the detector is either useless or a nuisance.
  assert.deepEqual(hardcodedEasings("animation: x 200ms ease-in;"), ["ease-in"]);
  assert.deepEqual(hardcodedEasings("transition: transform 200ms var(--ease-in-out);"), [],
    "ease-in-out is a legitimate token for something already on screen moving from A to B");
});

test("NC — a reduced-motion block covering only transition is caught", () => {
  // This is the precise hole the page shipped with before v0.84.0.
  const only = "@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }";
  const cover = reducedMotionCovers(only);
  assert.ok(cover.transition);
  assert.equal(cover.animation, false, "transition-only cover must NOT be reported as covering animation");
});

test("NC — losing the unchanged-card short-circuit is caught", () => {
  // Proves the assertion above is pinned to the behaviour and not to an incidental string.
  const gutted = PAGE.replace("if (had === has) continue;", "");
  assert.notEqual(gutted, PAGE, "the mutation did not apply");
  assert.ok(!/if \(had === has\) continue;/.test(gutted),
    "with the short-circuit gone every card is marked changed on every 25-second poll");
});

test("NC — dropping the degraded read is caught", () => {
  const blind = PAGE.replace(/d\.degraded/g, "false");
  assert.notEqual(blind, PAGE, "the mutation did not apply");
  assert.ok(!/d\.degraded/.test(blind),
    "a page that never reads the flag renders a broken board as a complete one");
});
