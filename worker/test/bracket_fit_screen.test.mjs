/* Boomtown Platform — the "what fits in the time we have left" control (web region checks)
   File: worker/test/bracket_fit_screen.test.mjs · Version: v1.0 · Date: 2026-08-08 · Ships in: v0.108.0

   Owner, 2026-08-08: the end-of-league tournament "changes based on participants and timeframe
   available", and the goal is "to get everyone sufficient games (so we can double games in pool play
   if needbe)". The screen half of that answer is a line under the draw controls saying how long the
   bracket will take, before the director commits to it.

   THE ONE THING THIS FILE EXISTS TO PREVENT. The estimate must be the SERVER'S arithmetic. Computing
   rounds and waves in the browser would be a second implementation of the allocator, and a second
   implementation agrees with the real draw right up until it doesn't — at which point it still looks
   exactly like a working estimate. `worker/test/league_bracket.test.mjs` asserts preview and
   generation agree; this asserts the screen actually ASKS, rather than doing its own sums.

   §-1c D-17b — five instances of pinning a spelling instead of a behaviour, twice inside guards
   written to respect the rule. So: no character-distance windows, no arity, no indentation, no
   template positions. Every assertion below is "this file must DO x", expressed as the presence of an
   endpoint path, an element id, or a wiring relationship — none of which change when the code is
   reformatted or a comment is added above it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const JS = blankComments(readFileSync(new URL("../../web/assets/admin-brackets.js", import.meta.url), "utf8")); // D-45
const HTML = readFileSync(new URL("../../web/admin-brackets.html", import.meta.url), "utf8");

test("the estimate is asked of the server, not computed in the browser", () => {
  assert.ok(/\/brackets\/preview/.test(JS),
    "the screen must call the preview endpoint — that is what makes the estimate the same arithmetic as the draw");
});

test("the preview call is a read: the screen never asks it to replace anything", () => {
  // `replace: true` on the generate route sets the current bracket aside. If that ever leaked into
  // the preview body, asking "how long would this take" would delete the bracket on the table.
  const previewCall = JS.slice(JS.indexOf("brackets/preview"));
  const nextFn = previewCall.indexOf("async function generate");
  const region = nextFn > 0 ? previewCall.slice(0, nextFn) : previewCall;
  assert.ok(!/replace/.test(region), "the preview request must never carry replace");
});

test("a stale estimate cannot overwrite a fresher one", () => {
  // The requests are debounced, not serialised, so responses can land out of order. Without a
  // sequence check the slowest keystroke wins and the line shows an answer to a question the
  // director has already changed.
  assert.ok(/fitSeq/.test(JS), "the estimate must carry a sequence guard");
  assert.ok(/seq\s*!==\s*fitSeq/.test(JS), "a response must be discarded when a newer request exists");
});

test("every control that changes the draw also re-runs the estimate", () => {
  // Field size, points, courts, slot length, time available and the BB checkbox all change either
  // how many games are played or how long each takes. A control wired to the draw but not to the
  // estimate produces a number that is quietly about the previous settings.
  for (const id of ["bASize", "bPoints", "bCourts", "bSlot", "bHave", "bBo3"]) {
    assert.ok(new RegExp(`"${id}"`).test(JS), `${id} must be wired into the estimate`);
  }
  assert.ok(/bRest[\s\S]*?scheduleEstimate|scheduleEstimate[\s\S]*?bRest/.test(JS),
    "the BB bracket checkbox changes the game count and must re-estimate");
});

test("the estimate never blocks the draw — it informs, it does not gate", () => {
  // The director knows whether the gym is really being handed back. A bracket that overruns is
  // their call to make, so nothing here may disable the button.
  assert.ok(!/bGen[^\n]*disabled|disabled[^\n]*bGen/.test(JS),
    "the generate button must not be disabled by the estimate");
});

test("the screen has the two inputs and an announced status line", () => {
  assert.ok(/id="bSlot"/.test(HTML), "minutes per game");
  assert.ok(/id="bHave"/.test(HTML), "minutes available");
  const fit = HTML.slice(HTML.indexOf('id="bFit"'));
  assert.ok(HTML.includes('id="bFit"'), "the estimate needs somewhere to render");
  assert.ok(/aria-live="polite"/.test(fit.slice(0, 200)),
    "the estimate changes without a reload, so it must be announced");
});

test("both new inputs are labelled and reachable by keyboard", () => {
  // Native inputs inside a <label> — no placeholder-as-label, which disappears on focus and is not
  // read as a name by assistive tech.
  for (const id of ["bSlot", "bHave"]) {
    const at = HTML.indexOf(`id="${id}"`);
    const before = HTML.slice(Math.max(0, at - 400), at);
    assert.ok(/<label[^>]*>[^<]*\S/.test(before), `${id} must sit inside a label with real text`);
  }
});

test("NC: the guard fails when the screen stops asking the server", () => {
  // Mutate the real input. Without this, every assertion above could be passing against a file that
  // no longer resembles what ships, and an assertion that cannot fail is not a check.
  const broken = JS.replace(/\/brackets\/preview/g, "/brackets/OFFLINE-GUESS");
  assert.notEqual(broken, JS, "MUTATION DID NOT LAND — the endpoint string was not found");
  assert.ok(!/\/brackets\/preview/.test(broken),
    "with the endpoint gone the first test above must fail, which is what makes it a check");
});

/* ============ v0.109.0 · the unit is GAMES (owner, 2026-08-08) ============
   "however do not use time as the core unit of measure." The screen must lead with games per team;
   minutes stay on the line because the day has to end, but they are not the verdict. */

/**
 * The body of a named function, by brace matching.
 *
 * §-1c D-17b, SIXTH INSTANCE — and this one was mine, in this file, one run ago. The first draft
 * sliced 600 characters after `const bits = [`, which (a) is a character-distance window, the exact
 * spelling-not-behaviour trap, and (b) matched a DIFFERENT `const bits = [` four hundred lines
 * earlier in `origin()`. Both assertions read -1 and the test failed against correct code.
 * An ambiguous anchor plus a distance window is two spellings pinned instead of one behaviour.
 */
function bodyOf(src, signature) {
  const at = src.indexOf(signature);
  if (at < 0) return null;
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

test("the estimate line leads with games per team, not minutes", () => {
  const body = bodyOf(JS, "async function estimate(");
  assert.ok(body, "the estimate function must exist to be checked");
  const games = body.indexOf("guaranteed_games");
  const minutes = body.indexOf("needs_minutes");
  assert.ok(games > -1, "games per team must appear on the line");
  assert.ok(minutes > -1, "the time boundary is still reported");
  assert.ok(games < minutes, "games must come BEFORE minutes — the owner reversed this unit");
});

test("the floor is the server's number — the screen never restates 8", () => {
  // A literal 8 here would be a second definition of MIN_GAMES_PER_TEAM, free to drift from
  // formats.js. The screen renders target_games as sent.
  assert.ok(/target_games/.test(JS), "the floor is read from the response");
});

test("a bracket not seeded by pool play is announced on the screen", () => {
  assert.ok(/seed_warning/.test(JS), "N-6: the screen must surface the seeding warning");
  assert.ok(/id="bSeedWarn"/.test(HTML), "and it needs somewhere to render");
  const warn = HTML.slice(HTML.indexOf('id="bSeedWarn"'));
  assert.ok(/aria-live="polite"/.test(warn.slice(0, 200)), "it appears without a reload");
});

test("NC: the games-first guard fails if the line reverts to minutes-first", () => {
  const broken = JS.replace(/guaranteed_games/g, "zzz_removed");
  assert.notEqual(broken, JS, "MUTATION DID NOT LAND — the field name was not found");
  assert.ok(!/guaranteed_games/.test(broken), "with games gone the ordering test above must fail");
});

/* ============ v0.110.0 · the standard template on screen (owner, 2026-08-08) ============
   "the max games players are playing are approximately 12-16. More than 16 become physically
   unplayable." A rule with two ends must SHOW both ends — a line that reports only the guaranteed
   number hides the team the ceiling is actually about, which is the team that keeps winning. */

test("the line shows BOTH ends of the band — the floor and the ceiling", () => {
  const body = bodyOf(JS, "async function estimate(");
  assert.ok(body, "the estimate function must exist");
  assert.ok(/max_games\b/.test(body), "the winner's game count must be shown, not just the guaranteed one");
  assert.ok(/max_games_ceiling/.test(body), "and the ceiling it is measured against");
  assert.ok(/target_games/.test(body), "the floor stays too — the rule has two ends");
});

test("minutes are the template's, not a typed guess", () => {
  const body = bodyOf(JS, "async function estimate(");
  assert.ok(/estimated_minutes/.test(body),
    "the clock comes from the same template that counts the games (20 a match, 23.75 best-of-3)");
});

test("NC: the band guard fails if the ceiling is dropped from the line", () => {
  const broken = JS.replace(/max_games_ceiling/g, "zzz_gone");
  assert.notEqual(broken, JS, "MUTATION DID NOT LAND — the field name was not found");
  assert.ok(!/max_games_ceiling/.test(broken), "with the ceiling gone the test above must fail");
});
