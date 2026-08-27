/**
 * Boomtown Platform — ONE inline-edit helper owns the double-click-rename mechanics
 * File: worker/test/admin_inline_edit.test.mjs · Version: v1.0 · Date: 2026-08-27 · Ships in: v0.210.0
 *
 * §-1c D-60: the League board (v0.206.0) and Tournament Ops (v0.208.0) shipped near-identical
 * `inlineRename` copies, and they had ALREADY drifted by one fix — the v0.207.0 focus-restore
 * (Gemini B2) reached the League copy's Escape path only, while the Tournament copy restored
 * focus on empty/unchanged commits and on errors too. The fiddly DOM/focus/latch mechanics now
 * live ONCE in `admin-nav.js` as `BT_ADMIN.inlineEdit(span, { onStart, commit })`; each page
 * passes only its own commit (the PATCH + reload + error line stay page-local, pinned by the two
 * page guards: league_inline_rename.test.mjs / tournament_inline_rename.test.mjs). The unified
 * mechanics keep the STRONGER behaviour: focus returns to the cell on Escape, on an empty or
 * unchanged commit, and on a failed commit alike.
 *
 * Mechanics assertions run against the HELPER'S OWN BODY (functionBodyAfter), never the whole
 * file — admin-nav.js has other legitimate "Escape" handlers (the modal's escClose, the profile
 * menu), so a whole-file match could stay green after the helper lost its own (the
 * shared-definition-vacuity class).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

const NAV = blankComments(readFileSync(new URL("../../web/assets/admin-nav.js", import.meta.url), "utf8"));
const LEAGUE = blankComments(readFileSync(new URL("../../web/assets/admin-league.js", import.meta.url), "utf8"));
const TOURN = blankComments(readFileSync(new URL("../../web/assets/tournament.js", import.meta.url), "utf8"));
const BODY = functionBodyAfter(NAV, "function inlineEdit");

test("the helper exists in admin-nav.js and rides the BT_ADMIN export", () => {
  assert.ok(BODY, "admin-nav.js has no `function inlineEdit` — the shared helper is missing");
  assert.match(NAV, /window\.BT_ADMIN = \{[^}]*\binlineEdit\b/, "inlineEdit is not exported on BT_ADMIN");
});

test("the helper's own body carries the full mechanics (scoped to the body, not the file)", () => {
  assert.ok(BODY, "no helper body to inspect");
  assert.match(BODY, /dblclick/, "no double-click start");
  assert.match(BODY, /"Enter"/, "no Enter start/commit");
  assert.match(BODY, /"Escape"/, "no Escape cancel");
  assert.match(BODY, /span\.focus\(\)/,
    "cancel or a failed commit does not restore focus to the cell (the v0.207.0 a11y fix)");
  assert.match(BODY, /!name\s*\|\|\s*name\s*===/,
    "an empty or unchanged value is not skipped — it would fire a pointless server call");
  assert.match(BODY, /if\s*\(done\)\s*return;?\s*done = true/,
    "no done latch — blur firing after Enter would double-commit");
});

test("both former copies now delegate to the ONE helper", () => {
  assert.match(LEAGUE, /BT_ADMIN\.inlineEdit\(/, "admin-league.js does not call BT_ADMIN.inlineEdit");
  assert.match(TOURN, /BT_ADMIN\.inlineEdit\(/, "tournament.js does not call BT_ADMIN.inlineEdit");
});

test("neither page re-implements the mechanics — the consolidation's whole point", () => {
  // dblclick and createElement("input") appear ONLY in the old copies (measured 2026-08-27);
  // "Escape" is NOT usable as an absence token here — tournament.js legitimately closes its
  // day-sheet and print view on it.
  for (const [name, src] of [["admin-league.js", LEAGUE], ["tournament.js", TOURN]]) {
    assert.doesNotMatch(src, /dblclick/, `${name} grew its own dblclick listener — the second copy is back`);
    assert.doesNotMatch(src, /createElement\("input"\)/, `${name} builds its own edit input — the second copy is back`);
  }
});

test("NC: the absence detectors can fire (positive control — an absence that cannot fail proves nothing)", () => {
  const poisoned = LEAGUE + '\nx.addEventListener("dblclick", start);';
  assert.match(poisoned, /dblclick/, "the injected dblclick was not seen — the absence detector cannot fire");
  const poisoned2 = TOURN + '\nconst input = document.createElement("input");';
  assert.match(poisoned2, /createElement\("input"\)/, "the injected input-build was not seen");
});

test("NC: dropping the helper's Escape handling is caught", () => {
  assert.ok(BODY, "no helper body — the mutation has nothing to land on");
  const stripped = BODY.replace(/"Escape"/g, '"NoSuchKey"');
  assert.notEqual(stripped, BODY, "no Escape in the helper body — the mutation cannot land");
  assert.doesNotMatch(stripped, /"Escape"/, "the Escape detector cannot fail");
});

test("NC: dropping the export is caught", () => {
  assert.ok(BODY, "no helper — the export mutation is vacuous until it exists");
  const stripped = NAV.replace(/\binlineEdit\b/g, "renamedAway");
  assert.notEqual(stripped, NAV, "no inlineEdit token in admin-nav.js — the mutation cannot land");
  assert.doesNotMatch(stripped, /window\.BT_ADMIN = \{[^}]*\binlineEdit\b/, "the export detector cannot fail");
});
