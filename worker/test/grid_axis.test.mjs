/**
 * Boomtown Platform — grid axis (owner request, 2026-08-16)
 * File: worker/test/grid_axis.test.mjs · Version: v1.0 · Date: 2026-08-16 · Ships in: v0.164.0
 *
 * The owner's sentence: "the tiles currently have the nets go horizontal, please flip this —
 * nets go down the side and the time across the top (or provide options to switch between
 * both) for every view that has the nets and arrangement." Measured: exactly TWO views render
 * a nets × time MATRIX — Tournament Ops' pool grid (tournament.js renderGrid) and the Schedule
 * Editor (admin-schedule-editor.js render). Everything else (league weeks, live board, day
 * sheet) renders lists, not arrangements. In this product's tournament surfaces the physical
 * net is spelled "Court" — the flip changes the AXES, never the vocabulary.
 *
 * The rule: courts down the side and rounds across the top is the DEFAULT; one shared
 * preference (localStorage "bt_grid_axis") flips both views back to the old shape; the cells
 * keep their data-round/data-court identity in both orientations, so drag-drop and the apply
 * payloads never notice the orientation. Rendering is asserted at RUNTIME through the page
 * harness — the html the real render() produced, not a regex over its template.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";
import { runTournament, runScheduleEditor } from "../testkit/page-harness.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");
const TJS = read("assets/tournament.js");
const EDJS = read("assets/admin-schedule-editor.js");

/* ---------- fixtures ---------- */

const tournamentRoutes = () => (path) => {
  if (path === "/api/me") return { data: {} };
  if (path === "/api/formats") return { data: { formats: {} } };
  if (path === "/api/events") return { data: { events: [{ id: 1, name: "Test Cup" }] } };
  if (path === "/api/events/1") return { data: { event: { id: 1, name: "Test Cup", court_count: 2 } } };
  if (path === "/api/events/1/schedule") return { data: { warnings: [], matches: [
    { id: 11, stage: "pool", round: 1, court: 1, team_a_id: 1, team_b_id: 2, points_to: 21, cap: 25 },
    { id: 12, stage: "pool", round: 1, court: 2, team_a_id: 3, team_b_id: 4, points_to: 21, cap: 25 },
    { id: 21, stage: "pool", round: 2, court: 1, team_a_id: 1, team_b_id: 3, points_to: 21, cap: 25 },
    { id: 22, stage: "pool", round: 2, court: 2, team_a_id: 2, team_b_id: 4, points_to: 21, cap: 25 },
  ] } };
  if (path === "/api/events/1/teams") return { data: { teams: [
    { id: 1, name: "Alpha" }, { id: 2, name: "Bravo" }, { id: 3, name: "Charlie" }, { id: 4, name: "Delta" },
  ] } };
  if (path === "/api/events/1/standings") return { data: { standings: [] } };
  return { data: {} };
};

const editorApi = (path) => {
  if (path === "/api/events") return { ok: true, data: { events: [{ id: 1, name: "Test Cup" }] } };
  if (path === "/api/admin/events/1/schedule") return { ok: true, data: {
    rounds: 2, courts: 2, report: null, summary: [], byes: [[], []],
    matches: [
      { id: 11, round: 1, court: 1, team_a: "Alpha", team_b: "Bravo", played: false },
      { id: 12, round: 1, court: 2, team_a: "Charlie", team_b: "Delta", played: false },
      { id: 21, round: 2, court: 1, team_a: "Alpha", team_b: "Charlie", played: false },
      { id: 22, round: 2, court: 2, team_a: "Bravo", team_b: "Delta", played: false },
    ],
  } };
  return { ok: true, data: {} };
};

/* ---------- Tournament Ops ---------- */

test("the pool grid DEFAULTS to courts down the side, rounds across the top — and every cell keeps its identity", async () => {
  const page = await runTournament(TJS, tournamentRoutes());
  const html = page.el("poolGrid").innerHTML;
  assert.ok(html.length > 0, "the grid rendered nothing — the harness never reached renderGrid");
  assert.match(html, /^<tr><th>Court<\/th><th>Round 1<\/th><th>Round 2<\/th>/,
    "the default orientation is not courts-down: the header row must lead with Court and list the rounds");
  assert.doesNotMatch(html, /<th>Court 1<\/th>/, "courts are still columns — the flip did not land");
  assert.match(html, /<td class="round-label">Bye \/ Work<\/td>/,
    "the per-round byes lost their home — transposed, Bye / Work is the bottom ROW");
  // Identity: the same four (round, court) cells exist regardless of where they are drawn.
  for (const [r, c] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
    const cell = new RegExp(`data-round="${r}" data-court="${c}"`, "g");
    assert.equal((html.match(cell) || []).length, 1, `cell (round ${r}, court ${c}) must exist exactly once`);
  }
  // The round-2/court-1 match is Alpha v Charlie in BOTH orientations — content follows identity.
  const cellRe = /<td data-round="2" data-court="1"[^>]*>([\s\S]*?)<\/td>/;
  assert.match((html.match(cellRe) || [])[1] || "", /Alpha[\s\S]*Charlie/,
    "the (2,1) cell does not hold its own match — the transpose scrambled the arrangement");
});

test("the pool grid's switch flips to the old shape, remembers it, and flips back", async () => {
  const page = await runTournament(TJS, tournamentRoutes());
  const axis = page.el("axisBtn");
  assert.equal(typeof axis.onclick, "function", "no switch is wired — the owner asked for the option");
  await axis.onclick();
  const legacy = page.el("poolGrid").innerHTML;
  assert.match(legacy, /^<tr><th>Round<\/th><th>Court 1<\/th><th>Court 2<\/th><th>Bye \/ Work<\/th>/,
    "the switch must restore the exact old shape — rounds down, courts across, byes as a column");
  await axis.onclick();
  assert.match(page.el("poolGrid").innerHTML, /^<tr><th>Court<\/th>/,
    "switching twice must land back on courts-down");
});

test("NC: the default-orientation check has teeth — a source forced to the old default reddens it", async () => {
  // Positive control for the harness itself: neuter the axis helper so the page always renders
  // the legacy shape, and the default assertion above must fail against it.
  const forced = TJS.replace(/localStorage\.getItem\("bt_grid_axis"\)/, '"rounds-down"');
  assert.notEqual(forced, TJS, "the mutation did not land — the axis helper was not found");
  const page = await runTournament(forced, tournamentRoutes());
  assert.doesNotMatch(page.el("poolGrid").innerHTML, /^<tr><th>Court<\/th>/,
    "the forced-legacy source still rendered courts-down — the default check asserts nothing");
});

/* ---------- Schedule Editor ---------- */

test("the editor grid follows the SAME preference: courts down by default, the switch flips it", async () => {
  const page = await runScheduleEditor(EDJS, editorApi);
  const html = page.el("sGrid").innerHTML;
  assert.ok(html.length > 0, "the editor rendered nothing — the harness never reached render()");
  assert.match(html, /<th scope="col">Court<\/th><th scope="col">Round 1<\/th>/,
    "the editor's default is not courts-down");
  for (const [r, c] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
    assert.match(html, new RegExp(`data-round="${r}" data-court="${c}"`),
      `editor cell (round ${r}, court ${c}) lost its identity`);
  }
  await page.el("sAxis").click();
  assert.match(page.el("sGrid").innerHTML, /<th scope="col">Round<\/th><th scope="col">Court 1<\/th>/,
    "the editor's switch must restore the old shape");
  assert.equal(page.localStorage.getItem("bt_grid_axis"), "rounds-down",
    "the choice must persist — and under the ONE shared key");
});

test("both views read the ONE preference key, so the choice made on either page holds on both", () => {
  for (const [name, src] of [["tournament.js", TJS], ["admin-schedule-editor.js", EDJS]]) {
    assert.ok(blankComments(src).includes('"bt_grid_axis"'),
      `${name} does not read the shared axis key — the two grids can now disagree`);
  }
});

test("the editor's arrow keys follow the VISUAL axes in both orientations", () => {
  // The harness cannot reach per-cell keyboard wiring (querySelectorAll is a stub), so this is
  // a shape pin on the one line that maps arrows to (round, court) deltas: it must branch on
  // the orientation, and both mappings must exist as code. schedule_editor.test.mjs separately
  // pins that every arrow key remains an object key ("ArrowUp:").
  const js = blankComments(EDJS);
  assert.match(js, /const deltas = courtsDown\(\)/,
    "the arrow-delta map does not branch on orientation — arrows will move against the visual grid in one of the two shapes");
  assert.match(js, /ArrowUp: \[0, -1\]/, "courts-down: Up must walk to the previous court (the row above)");
  assert.match(js, /ArrowUp: \[-1, 0\]/, "rounds-down: Up must walk to the previous round (the row above)");
});

test("the switches exist in the markup of both pages", () => {
  assert.match(read("tournament.html"), /id="axisBtn"/, "Tournament Ops lost its axis switch");
  assert.match(read("admin-schedule-editor.html"), /id="sAxis"/, "the Schedule Editor lost its axis switch");
});
