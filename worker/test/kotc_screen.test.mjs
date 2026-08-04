/* Boomtown Platform — KOTC player screen guard
   File: worker/test/kotc_screen.test.mjs · Version: v1.0 · Date: 2026-08-04 · Ships in: v0.85.0

   WHAT THIS GUARDS, AND WHY IT IS THE FIRST THING ASSERTED ABOUT THIS PAGE.

   `/api/kotc/:token` computes `mode` — enter / confirm / done — in exactly one place: `playerView`
   in `kotcplay.js`. The screen renders that field. The moment the page works the mode out for
   itself there are two deciders, they can disagree, and the disagreement is silent: a player shown
   "enter" when the server said "confirm" gets a blank net and overwrites the scoreline they were
   supposed to be checking. Nothing throws. Nothing logs. The leaderboard is just wrong.

   So this asserts the ABSENCE of a second decider, which is the hard kind of assertion — an absence
   never goes red on its own (C10/C13). It is done by reading the shipped source and refusing three
   specific shapes: assigning a mode, spelling a mode literal into a ternary branch or object value,
   and failing to read the server's field at all.

   WHAT IT CANNOT SEE: whether the three screens look right, or whether the copy reads well on a
   phone in sunlight. Timing and feel are judged by eye on a real net.

   Every check ships a negative control that mutates the REAL file text — not a synthetic string —
   and proves the check can fail (standards §6). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const JS = join(ROOT, "web", "assets", "kotc.js");
const HTML = join(ROOT, "web", "kotc.html");

const jsSrc = existsSync(JS) ? readFileSync(JS, "utf8") : "";
const htmlSrc = existsSync(HTML) ? readFileSync(HTML, "utf8") : "";

/** Comments are prose about the rule, not code that breaks it — strip them before judging. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MODES = "enter|confirm|done";

/**
 * The three refused shapes, as a verdict so the negative controls can drive the same function the
 * real assertions do rather than a copy of its regexes.
 * @returns {{reads:boolean, assigns:string[], literals:string[]}}
 */
function modeVerdict(src) {
  const c = code(src);
  return {
    // Reads the server's field at all.
    reads: /\b[A-Za-z_$][\w$]*\.mode\b/.test(c),
    // Declares or assigns something called `mode` — a second decider needs somewhere to put it.
    assigns: c.match(/\b(?:let|var|const)\s+mode\b|\bmode\s*=(?!=)/g) || [],
    /* A mode spelled as a TERNARY BRANCH (`? "done"`) or fabricated as a `mode` KEY
       (`mode: "enter"`). Deliberately not "any object value whose text is a mode": `action:
       "confirm"` is the API's action vocabulary, which overlaps the mode vocabulary on exactly that
       word, and forbidding it would forbid the confirm POST this screen exists to send. Every real
       derivation of this field is a ternary, so the `?` branch is the shape that matters.
       `case "done":` puts the colon AFTER the literal and is a read — correctly not matched. */
    literals: c.match(new RegExp(`\\?\\s*["'](?:${MODES})["']|\\bmode\\s*:\\s*["'](?:${MODES})["']`, "g")) || [],
  };
}

test("the guard is actually looking at shipped files", () => {
  // A scanner that silently finds nothing is the most comfortable kind of broken.
  assert.ok(jsSrc.length > 500, `web/assets/kotc.js not found or empty at ${JS}`);
  assert.ok(htmlSrc.length > 500, `web/kotc.html not found or empty at ${HTML}`);
});

test("the player screen READS the server's mode", () => {
  assert.equal(modeVerdict(jsSrc).reads, true,
    "kotc.js never reads `.mode` — it cannot be rendering the server's decision");
});

test("the player screen never DERIVES the mode", () => {
  const v = modeVerdict(jsSrc);
  assert.deepEqual(v.assigns, [], "kotc.js assigns a `mode` — the server is the only decider");
  assert.deepEqual(v.literals, [],
    "kotc.js spells a mode as a ternary branch or object value — that is a second decider");
});

test("NC: the real derivation, pasted into the real file, is caught", () => {
  // The exact expression from kotcplay.js playerView. If this page ever grows a copy of it, that is
  // the defect, and the negative control is the copy.
  const real = `    mode: mine.confirmed === "confirmed" && complete ? "done" : entered.length ? "confirm" : "enter",\n`;
  const mutated = jsSrc.replace("  async function load() {", real + "  async function load() {");
  assert.notEqual(mutated, jsSrc, "the mutation must actually change the file text");

  const v = modeVerdict(mutated);
  // Two ternary branches carry a mode literal in that expression (`? "done"`, `? "confirm"`); the
  // trailing `: "enter"` is the fall-through and needs no separate catch, since no derivation of
  // this field exists that is not a ternary.
  assert.ok(v.literals.length >= 2,
    `expected the derivation's mode literals to be caught, caught ${v.literals.length}`);
});

test("NC: a plain `let mode =` assignment is caught", () => {
  const mutated = jsSrc.replace("  let editing = false;", "  let mode = v.games.length ? 1 : 2;");
  assert.notEqual(mutated, jsSrc, "the mutation must actually change the file text");
  assert.ok(modeVerdict(mutated).assigns.length >= 1, "a mode declaration must be caught");
});

test("NC: a file that reads no mode at all is caught", () => {
  const mutated = jsSrc.replace(/\.mode\b/g, ".modeless");
  assert.notEqual(mutated, jsSrc, "the mutation must actually change the file text");
  assert.equal(modeVerdict(mutated).reads, false);
});

/* ─── every submission shape the API accepts is reachable from the screen ───
   Assert CALL SITES, not definitions (standards §6.5). The API accepts four things: a confirmation,
   game scores, an edit-as-dispute, and a lone points total. A screen that can only send two of them
   leaves half a tested API unreachable — failure class 1, hiding behind a passing server suite. */
test("all four submission shapes the API accepts are reachable from the page", () => {
  const c = code(jsSrc);
  const missing = [
    ['action: "confirm"', /action:\s*"confirm"/],
    ["games array", /body\.games\s*=/],
    ['action: "dispute"', /action\s*=\s*"dispute"/],
    ["my_total", /body\.my_total\s*=/],
  ].filter(([, re]) => !re.test(c)).map(([name]) => name);
  assert.deepEqual(missing, [], "the screen cannot send every shape the API accepts");
});

test("NC: dropping a submission shape is caught", () => {
  const mutated = jsSrc.replace('body.my_total = Number(total.value)', "void 0");
  assert.notEqual(mutated, jsSrc, "the mutation must actually change the file text");
  assert.ok(!/body\.my_total\s*=/.test(code(mutated)), "the one-number path would be reported missing");
});

/* ─── motion honesty, the v0.84.0 lesson applied to a new page ───
   `animation: kotc-popp 180ms` is valid CSS that throws nothing, logs nothing and animates nothing. */

const animNames = (src) => {
  const out = new Set();
  for (const m of src.matchAll(/animation:\s*([A-Za-z_][\w-]*)/g)) out.add(m[1]);
  return [...out];
};
const keyframeNames = (src) => {
  const out = new Set();
  for (const m of src.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)) out.add(m[1]);
  return [...out];
};

test("every animation name on the page resolves to a real @keyframes", () => {
  const declared = keyframeNames(htmlSrc);
  const used = animNames(htmlSrc);
  assert.ok(used.length > 0, "the page declares no animation — this check would pass vacuously");
  assert.deepEqual(used.filter((n) => !declared.includes(n)), [],
    "an animation name with no @keyframes animates nothing, silently");
});

test("NC: a misspelled animation name is caught", () => {
  const used = animNames(htmlSrc);
  const mutated = htmlSrc.replace(`animation: ${used[0]}`, `animation: ${used[0]}-typo`);
  assert.notEqual(mutated, htmlSrc, "the mutation must actually change the file text");
  const orphans = animNames(mutated).filter((n) => !keyframeNames(mutated).includes(n));
  assert.ok(orphans.length >= 1, "the orphaned animation name must be caught");
});

test("the reduced-motion block covers `animation`, not just `transition`", () => {
  // Every effect on this page is a keyframe animation. A block that only names `transition` is a
  // reduced-motion guarantee that is already false — exactly what v0.84.0 found on the live board.
  const m = htmlSrc.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\s{4}\}/);
  assert.ok(m, "kotc.html has no prefers-reduced-motion block");
  assert.match(m[1], /animation\s*:/, "the reduced-motion block never mentions `animation`");
});

test("NC: a reduced-motion block that only handles transition is caught", () => {
  const mutated = htmlSrc.replace(/animation: kotc-fade[^;]*;/, "transition: none;");
  assert.notEqual(mutated, htmlSrc, "the mutation must actually change the file text");
  const m = mutated.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\s{4}\}/);
  assert.ok(m && !/animation\s*:/.test(m[1]), "the transition-only block would be reported");
});

/* ─── the page is reachable and registered ─── */

test("kotc.html loads its own script and the shared config", () => {
  // A page that fetches from the API gets its own file (standards §11), and without config.js there
  // is no apiBase, so the page renders its "settings still loading" state forever.
  assert.match(htmlSrc, /assets\/kotc\.js\?v=/, "the page does not load kotc.js");
  assert.match(htmlSrc, /assets\/config\.js\?v=/, "the page does not load config.js");
});

test("names on this screen are never spelled out by the page itself", () => {
  // The server abbreviates (personName with no `full`) because this screen is reachable with no
  // login by anyone holding a link — standards §8 applies as it does to the public board. The page
  // must not reconstruct a full name from anything.
  assert.ok(!/full_name/.test(code(jsSrc)), "kotc.js references full_name — names must arrive abbreviated");
});
