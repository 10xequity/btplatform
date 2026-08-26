/**
 * Boomtown Platform — double-click a team name on the League board to rename it in place
 * File: worker/test/league_inline_rename.test.mjs · Version: v1.0 · Date: 2026-08-26 · Ships in: v0.206.0
 *
 * Owner (2026-08-26): "add the feature in the jsx code that double-clicking will edit the tile or
 * team or captain name." The QC generator's `EditableField` turns a static name into an input on
 * double-click, commits on Enter/blur, cancels on Escape. Ported to the League Manager board's
 * team-name cell (`admin-league.js renderLevels`), which until now was static text (you had to open
 * the roster modal to rename). The commit uses the EXISTING route `PATCH /api/admin/teams/:id
 * { name }` — no new route, no schema change. Captain remains assigned in the roster modal (the
 * board carries no captain column).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const SRC = blankComments(readFileSync(new URL("../../web/assets/admin-league.js", import.meta.url), "utf8"));

test("the team-name cell is a double-click edit affordance", () => {
  // A per-team hook the wiring can find, plus keyboard reachability (the QC field was tabbable too).
  assert.match(SRC, /data-team-name=/, "renderLevels no longer marks the team-name cell for inline rename");
  assert.match(SRC, /dblclick/, "nothing listens for a double-click to start the rename");
});

test("committing the rename uses the existing team PATCH route, not a new one", () => {
  // Discrete tokens, never a character-distance window (marker_hygiene's rule): the rename path
  // must name the teams endpoint, the PATCH method, and a { name } body.
  assert.match(SRC, /`\/api\/admin\/teams\/\$\{teamId\}`/, "the rename does not target /api/admin/teams/:id");
  assert.match(SRC, /method:\s*"PATCH"/, "the rename is not a PATCH");
  assert.match(SRC, /JSON\.stringify\(\{\s*name\s*\}\)|JSON\.stringify\(\{\s*name:/, "the PATCH body does not carry { name }");
});

test("the edit cancels on Escape and does not fire an empty or unchanged rename", () => {
  assert.match(SRC, /"Escape"/, "no Escape-to-cancel — the QC field cancelled on Escape");
  // Guard against a no-op PATCH: an empty or unchanged name must not hit the server.
  assert.match(SRC, /!name\s*\|\|\s*name\s*===|name\s*===\s*current\s*\|\|\s*!name/,
    "the commit does not skip an empty or unchanged name — it would fire a pointless PATCH");
});

test("NC: dropping the PATCH from the rename path is caught", () => {
  // Remove every PATCH and confirm the method assertion can fail.
  const stripped = SRC.replace(/method:\s*"PATCH"/g, 'method: "GET"');
  assert.notEqual(stripped, SRC, "the mutation did not land — no PATCH in admin-league.js at all");
  assert.doesNotMatch(stripped, /method:\s*"PATCH"/, "the route detector cannot fail");
});
