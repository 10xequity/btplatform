/**
 * Boomtown Platform — double-click a team name on the League board to rename it in place
 * File: worker/test/league_inline_rename.test.mjs · Version: v1.1 · Date: 2026-08-27 · Ships in: v0.206.0 (v1.1 in v0.210.0)
 *
 * Owner (2026-08-26): "add the feature in the jsx code that double-clicking will edit the tile or
 * team or captain name." The QC generator's `EditableField` turns a static name into an input on
 * double-click, commits on Enter/blur, cancels on Escape. Ported to the League Manager board's
 * team-name cell (`admin-league.js renderLevels`), which until now was static text (you had to open
 * the roster modal to rename). The commit uses the EXISTING route `PATCH /api/admin/teams/:id
 * { name }` — no new route, no schema change. Captain remains assigned in the roster modal (the
 * board carries no captain column).
 *
 * v1.1 (§-1c D-60, v0.210.0): the dblclick/Escape/focus/latch MECHANICS moved to
 * BT_ADMIN.inlineEdit and are pinned once in admin_inline_edit.test.mjs (which also pins that
 * this file's page delegates and grows no second copy). This guard keeps what stays PAGE-LOCAL:
 * the per-team hook the wiring finds, and the commit's PATCH shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const SRC = blankComments(readFileSync(new URL("../../web/assets/admin-league.js", import.meta.url), "utf8"));

test("the team-name cell is marked for rename and the page delegates to the one helper", () => {
  // A per-team hook the wiring can find (keyboard reachability rides the markup's role/tabindex);
  // the double-click/Escape/focus mechanics themselves are the helper's, pinned in
  // admin_inline_edit.test.mjs.
  assert.match(SRC, /data-team-name=/, "renderLevels no longer marks the team-name cell for inline rename");
  assert.match(SRC, /BT_ADMIN\.inlineEdit\(/, "the rename does not delegate to BT_ADMIN.inlineEdit");
});

test("committing the rename uses the existing team PATCH route, not a new one", () => {
  // Discrete tokens, never a character-distance window (marker_hygiene's rule): the rename path
  // must name the teams endpoint, the PATCH method, and a { name } body.
  assert.match(SRC, /`\/api\/admin\/teams\/\$\{teamId\}`/, "the rename does not target /api/admin/teams/:id");
  assert.match(SRC, /method:\s*"PATCH"/, "the rename is not a PATCH");
  assert.match(SRC, /JSON\.stringify\(\{\s*name\s*\}\)|JSON\.stringify\(\{\s*name:/, "the PATCH body does not carry { name }");
});

/* v1.1: the Escape-cancel, empty/unchanged skip, and the v0.207.0 focus-restore (Gemini B2) are
   HELPER mechanics now — asserted against inlineEdit's own body in admin_inline_edit.test.mjs,
   where a whole-file match can't be satisfied by admin-nav.js's other Escape handlers. */

test("NC: dropping the PATCH from the rename path is caught", () => {
  // Remove every PATCH and confirm the method assertion can fail.
  const stripped = SRC.replace(/method:\s*"PATCH"/g, 'method: "GET"');
  assert.notEqual(stripped, SRC, "the mutation did not land — no PATCH in admin-league.js at all");
  assert.doesNotMatch(stripped, /method:\s*"PATCH"/, "the route detector cannot fail");
});

test("NC: dropping the delegation is caught", () => {
  const stripped = SRC.replace(/BT_ADMIN\.inlineEdit\(/g, "BT_ADMIN.renamedAway(");
  assert.notEqual(stripped, SRC, "no BT_ADMIN.inlineEdit call in admin-league.js — the mutation cannot land");
  assert.doesNotMatch(stripped, /BT_ADMIN\.inlineEdit\(/, "the delegation detector cannot fail");
});
