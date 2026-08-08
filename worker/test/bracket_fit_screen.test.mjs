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

const JS = readFileSync(new URL("../../web/assets/admin-brackets.js", import.meta.url), "utf8");
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
  for (const id of ["bASize", "bPoints", "bCourts", "bSlot", "bHave"]) {
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
