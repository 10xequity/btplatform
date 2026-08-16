/**
 * Boomtown Platform — the member-landing motion pass (§-1h M-4 / §-0 B15)
 * File: worker/test/home_motion.test.mjs · Version: v1.0 · Date: 2026-08-16 · Ships in: v0.162.0
 *
 * WHY. M-4's charter is its own first line: "a daily screen earns restraint, not theatre."
 * Four motions ship — the arrival stagger, the first-fill fade, the badge pop, the dismiss
 * collapse — and each is DOUBLY gated: by frequency (once per session / first fill only / on
 * change only / user-initiated only) and by preference (motion is DECLARED inside
 * `@media (prefers-reduced-motion: no-preference)` or behind a matchMedia check — the positive
 * fence, chosen over relying on tokens.css's global reduced-motion kill because that kill
 * leaves 0.01ms transforms that land as jump-cuts; motion never declared is motion that cannot
 * jump). This file pins BOTH gates per motion, because a stagger that fires on every refresh
 * or a fence that quietly disappears are the two ways this feature rots into annoyance.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WEB = new URL("../../web/", import.meta.url);
const HOME_HTML = readFileSync(new URL("home.html", WEB), "utf8");
const HOME_JS = readFileSync(new URL("home.js", WEB), "utf8");
const SITE_NAV = readFileSync(new URL("assets/site-nav.js", WEB), "utf8");

/** The body of the FIRST `@media (prefers-reduced-motion: no-preference)` block, by brace
 *  depth (it holds nested rule braces). Null when absent. */
function motionFence(css) {
  const at = css.indexOf("@media (prefers-reduced-motion: no-preference)");
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  let depth = 1, j = open + 1;
  while (j < css.length && depth > 0) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}") depth--;
    j++;
  }
  return css.slice(open + 1, j - 1);
}

/* ═══ 1. the arrival stagger — once per session, fenced ═══ */

test("the stagger exists, with M-4's own values, INSIDE the positive motion fence", () => {
  const fence = motionFence(HOME_HTML);
  assert.ok(fence, "home.html has no prefers-reduced-motion: no-preference block — the motion is unfenced or gone");
  assert.match(fence, /\.hm-arrive > \* \{ animation: hmRise 220ms var\(--ease-out\) backwards; \}/,
    "the stagger rule (220ms, --ease-out, backwards-fill) must live inside the fence");
  assert.match(fence, /nth-child\(2\) \{ animation-delay: 40ms; \}/, "the 40ms stagger step is gone");
  // The keyframes carry the plan's exact displacement — 8px, opacity 0.
  assert.match(HOME_HTML, /@keyframes hmRise \{ from \{ opacity: 0; transform: translateY\(8px\); \} \}/,
    "hmRise lost M-4's values (opacity 0→1, translateY(8px)→0)");
  // And no motion rule may sit OUTSIDE the fence: stripping the fence must strand nothing.
  const outside = HOME_HTML.replace(fence, "");
  assert.equal(/\.hm-arrive[^}]*animation/.test(outside), false,
    "a stagger rule exists outside the fence — reduced-motion users would get a 0.01ms jump-cut");
});

test("the stagger is gated on the session flag and the class is removed after it plays", () => {
  assert.match(HOME_JS, /sessionStorage\.getItem\("bt_home_arrived"\)/,
    "home.js no longer checks the arrival flag — the stagger would replay on every visit");
  assert.match(HOME_JS, /sessionStorage\.setItem\("bt_home_arrived"/,
    "home.js never sets the arrival flag — the gate reads a value nothing writes");
  assert.match(HOME_JS, /classList\.add\("hm-arrive"\)/, "nothing adds the arrival class");
  assert.match(HOME_JS, /classList\.remove\("hm-arrive"\)/,
    "the arrival class is never removed — a panel revealed later (Agreements, Court time) would play a late entrance");
});

/* ═══ 2. the first-fill fade ═══ */

test("the fill fade runs on a container's FIRST fill only, and its rule sits inside the fence", () => {
  const fence = motionFence(HOME_HTML);
  assert.match(fence, /\.hm-fill \{ animation: hmFade 120ms ease-out; \}/,
    "the first-fill fade (120ms opacity) must live inside the fence");
  assert.match(HOME_HTML, /@keyframes hmFade \{ from \{ opacity: 0; \} \}/, "hmFade lost its opacity-only shape");
  // The helper marks the element and re-renders stay instant — the restraint half.
  assert.match(HOME_JS, /dataset\.btFilled/,
    "fill() no longer tracks first-fill — every mute/invite re-render would fade, motion on a frequent path");
  // Every async loader routes through the ONE helper (count the call sites; six loaders fill).
  const calls = (HOME_JS.match(/fill\(\$\("/g) || []).length;
  assert.ok(calls >= 6, `expected the six card loaders to route through fill(), found ${calls} call(s)`);
});

/* ═══ 3. the badge pop — on CHANGE only ═══ */

test("the mail badge pops only when the count CHANGED within the session, reduced-motion respected", () => {
  assert.match(SITE_NAV, /bt_mail_seen/,
    "site-nav.js no longer keeps the last-seen count — a pop without a baseline fires on every load");
  assert.match(SITE_NAV, /prefers-reduced-motion: reduce/,
    "the badge pop lost its reduced-motion check");
  assert.match(SITE_NAV, /scale\(1\.15\)/, "the pop lost M-4's 1→1.15→1 shape");
  // The pop is WAAPI on the badge element — off the class/keyframes path a page could restyle.
  assert.match(SITE_NAV, /badge\.animate\(/, "the pop no longer animates the badge element itself");
});

/* ═══ 4. the dismiss collapse — user-initiated, JS-checked ═══ */

test("dismiss/mute collapses the item before the reload, and skips motion under reduced preference", () => {
  assert.match(HOME_JS, /function collapse\(/, "home.js lost the collapse helper");
  assert.match(HOME_JS, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/,
    "collapse() must check the preference in JS — a fenced transition never fires its transitionend, so the check is what keeps the promise honest");
  assert.match(HOME_JS, /await collapse\(/, "the mute path no longer collapses before reloading the feed");
  assert.match(HOME_JS, /height 200ms var\(--ease-out\), opacity 200ms var\(--ease-out\)/,
    "the collapse lost M-4's 200ms height+opacity shape — the one deliberate non-compositor exception");
});

/* ═══ the NOT-animated list holds ═══ */

test("nothing loops and the theme toggle stays instant — M-4's exclusions", () => {
  assert.equal(/animation-iteration-count:\s*infinite|infinite\s+(alternate|linear|ease)/.test(HOME_HTML), false,
    "looping motion on a dashboard competes with reading — M-4 forbids it");
  assert.equal(/themeToggle[^;]*transition/.test(HOME_HTML), false, "the theme toggle must stay instant");
});

/* ═══ negative controls ═══ */

test("NC-1: stripping the motion fence is caught, and the mutation lands", () => {
  const fence = motionFence(HOME_HTML);
  const broken = HOME_HTML.replace("@media (prefers-reduced-motion: no-preference)", "@media (min-width: 1px)");
  assert.notEqual(broken, HOME_HTML, "the mutation did not land");
  assert.equal(motionFence(broken), null, "the fence detector still sees a fence that is not there");
  // And the stranded-rule check fires on the mutated copy: the stagger now sits outside any fence.
  assert.ok(/\.hm-arrive[^}]*animation/.test(broken.replace(motionFence(broken) || "", "")),
    "with the fence gone the stagger must be detectable outside it — the outside check cannot fail");
});

test("NC-2: removing the session gate is caught, and the mutation lands", () => {
  const broken = HOME_JS.split('sessionStorage.getItem("bt_home_arrived")').join("null");
  assert.notEqual(broken, HOME_JS, "the mutation did not land");
  assert.equal(/sessionStorage\.getItem\("bt_home_arrived"\)/.test(broken), false, "the gate needle survived");
});

test("NC-3: the fence extractor is positive-controlled on a synthetic block", () => {
  const synthetic = `x { color: red; } @media (prefers-reduced-motion: no-preference) { .a { animation: r 1s; } @keyframes r { from { opacity: 0; } } } y { color: blue; }`;
  const body = motionFence(synthetic);
  assert.ok(body && body.includes(".a { animation: r 1s; }"), "the extractor missed a rule it must find");
  assert.ok(body.includes("@keyframes r"), "the extractor's brace counting broke on a nested block");
  assert.equal(body.includes("color: blue"), false, "the extractor ran past the closing brace");
  assert.equal(motionFence("no fences here"), null, "the extractor hallucinates fences");
});
