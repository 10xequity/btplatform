/**
 * Boomtown Platform — double-click a team name on the Tournament Ops page to rename it in place
 * File: worker/test/tournament_inline_rename.test.mjs · Version: v1.0 · Date: 2026-08-26 · Ships in: v0.208.0
 *
 * Owner (2026-08-26): "Add the double click to edit to the tournament page too." The League board
 * got this in v0.206.0 (league_inline_rename.test.mjs); this is the faithful "too" for Tournament
 * Ops (`web/assets/tournament.js` / `web/tournament.html`).
 *
 * TWO facts shaped the port:
 *  (1) `patchTeam` (registrations.js) accepts { name } / { level } only. CAPTAIN IS NOT A TEAM
 *      FIELD — it is teams.captain_contact_id -> the CONTACT's name (formats.js). Editing it would
 *      rename a person across the org, not relabel a team. So, exactly like the League board, this
 *      edits the TEAM NAME only; the captain rides along READ-ONLY for identification (T2-3).
 *  (2) The tournament page had NO team list — names appeared read-only in the grid, standings and
 *      byes, and a pasted typo meant delete-and-re-add. The affordance needs a home, so a compact
 *      roster is rendered into #teamsPanel (where teams are pasted). A rename refreshAll()s, so the
 *      grid/standings/byes pick up the new name.
 *
 * The commit uses the EXISTING route PATCH /api/admin/teams/:id { name } — no new route, no schema
 * change. The a11y focus-restore that v0.207.0 folded into the League field (Gemini B2) is present
 * here from the start. Source-pinned like the League guard: the page harness's querySelectorAll is a
 * stub, so the per-node wiring is asserted at the source level, not driven through the DOM.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const SRC = blankComments(readFileSync(new URL("../../web/assets/tournament.js", import.meta.url), "utf8"));
const HTML = readFileSync(new URL("../../web/tournament.html", import.meta.url), "utf8");

test("the roster renders a double-click edit affordance per team", () => {
  assert.match(SRC, /data-team-name=/, "no per-team hook the rename wiring can find");
  assert.match(SRC, /dblclick/, "nothing listens for a double-click to start the rename");
  // Keyboard reachability, like the League cell (role=button, tabindex=0).
  assert.match(SRC, /role="button"/, "the team-name cell is not keyboard-reachable");
});

test("the roster is actually wired into the page (refreshAll renders it)", () => {
  // A defined-but-never-called renderer would leave the affordance invisible — pin both the
  // definition and a call site so the roster reaches the screen.
  assert.match(SRC, /function renderTeamList/, "renderTeamList is not defined");
  assert.match(SRC, /renderTeamList\(\)\s*;/, "renderTeamList is never called — the roster never renders");
});

test("#teamsPanel carries the roster container", () => {
  assert.match(HTML, /id="teamList"/, "tournament.html has no #teamList for the roster to render into");
});

test("committing the rename uses the existing team PATCH route, not a new one", () => {
  // Discrete tokens, never a character-distance window (marker_hygiene's rule).
  assert.match(SRC, /`\/api\/admin\/teams\/\$\{teamId\}`/, "the rename does not target /api/admin/teams/:id");
  assert.match(SRC, /method:\s*"PATCH"/, "the rename is not a PATCH");
  assert.match(SRC, /JSON\.stringify\(\{\s*name\s*\}\)|JSON\.stringify\(\{\s*name:/, "the PATCH body does not carry { name }");
});

test("the rename edits the team name ONLY — captain is never sent (it is a contact, not a team field)", () => {
  // Design pin: a future 'helpful' addition of captain to this PATCH would rename a person across
  // the org. The captain is rendered read-only for identification; it must not ride the rename body.
  assert.doesNotMatch(SRC, /JSON\.stringify\(\{[^}]*captain/, "the rename PATCH carries a captain field — that renames a contact, not the team");
  assert.match(SRC, /tm-cap/, "the captain is not rendered for identification (T2-3)");
});

test("the edit cancels on Escape and does not fire an empty or unchanged rename", () => {
  assert.match(SRC, /"Escape"/, "no Escape-to-cancel");
  assert.match(SRC, /!name\s*\|\|\s*name\s*===|name\s*===\s*current\s*\|\|\s*!name/,
    "the commit does not skip an empty or unchanged name — it would fire a pointless PATCH");
});

test("cancelling the rename returns focus to the team-name cell (a11y — the v0.207.0 League fix, present from the start)", () => {
  assert.match(SRC, /span\.focus\(\)/, "Escape/cancel does not restore focus to the team-name cell");
});

test("NC: dropping the PATCH from the rename path is caught", () => {
  const stripped = SRC.replace(/method:\s*"PATCH"/g, 'method: "GET"');
  assert.notEqual(stripped, SRC, "the mutation did not land — no PATCH in tournament.js at all");
  assert.doesNotMatch(stripped, /method:\s*"PATCH"/, "the route detector cannot fail");
});

test("NC: dropping the focus-restore is caught", () => {
  const stripped = SRC.replace(/span\.focus\(\)/g, "void 0");
  assert.notEqual(stripped, SRC, "no span.focus() in tournament.js — the a11y fix did not land");
  assert.doesNotMatch(stripped, /span\.focus\(\)/, "the focus-restore detector cannot fail");
});
