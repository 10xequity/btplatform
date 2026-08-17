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
import { runTournament, runScheduleEditor, makeStorage } from "../testkit/page-harness.mjs";

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
  // Anchored on the helper the axis actually reads through (B22 moved this off bare storage;
  // the NC's old anchor named `localStorage.getItem` and went stale the moment it did).
  const forced = TJS.replace(/safeGet\("bt_grid_axis"\)/, '"rounds-down"');
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

/* ═══ B22: blocked storage, and the other tab ═══
   A private-mode or blocked-cookie profile THROWS on localStorage access — it does not return
   null — so a bare read takes the whole page down at the line that made it. These pin that
   every storage touch in both files is guarded, that the page survives both directions of
   throw, and that the switch still WORKS in-session when the write is refused (a control that
   silently does nothing is the failure this project keeps paying for; the in-memory mirror is
   what keeps it honest — it stops remembering across reloads, it does not stop working). */

/** Every line touching EITHER store — sessionStorage throws in exactly the same profiles, and
 *  tournament.js reads it on the IIFE's first statement, earlier than any localStorage call.
 *  Comments blanked so prose about storage cannot satisfy the rule (D-33's class). */
const storageLines = (src) => blankComments(src).split("\n")
  .map((l) => l.trim()).filter((l) => /(local|session)Storage\./.test(l));

/* The GUARDED CORPUS: every file that has been swept, listed by name so adding one is a
   deliberate act. The two grid files (B22, v0.165.0) plus the three shared modules the owner
   approved in D-41 (v0.166.0) — admin-nav.js, app.js and site-nav.js load on nearly every page,
   so they were what actually died first in a blocked-storage profile. Files NOT on this list are
   still unguarded on purpose; D-41 carries the count and the remaining decision. */
const GUARDED = ["assets/tournament.js", "assets/admin-schedule-editor.js",
  "assets/admin-nav.js", "assets/app.js", "assets/site-nav.js"];

test("B22/D-41: every storage touch in the guarded corpus is inside a try — including the org header read", () => {
  for (const name of GUARDED) {
    const lines = storageLines(read(name));
    assert.ok(lines.length > 0, `${name}: the scan found no storage lines at all — it is not reading the file`);
    for (const line of lines) {
      assert.ok(/try \{/.test(line),
        `${name}: a bare storage touch survives — a blocked-storage browser dies here: ${line}`);
    }
  }
  // The choke point this rule exists for: tournament.js reads bt_org inside api(), which runs
  // during boot() — bare, it kills the page before the grid ever renders, and no axis fix helps.
  assert.match(blankComments(TJS), /const orgId = safeGet\("bt_org"\)/,
    "api()'s org read went back to bare storage — the axis toggle is not the choke point, this is");
});

test("B22 NC: the guarded-storage scan fires on a planted bare read, and passes a guarded one", () => {
  const planted = storageLines('const orgId = localStorage.getItem("bt_org");\n');
  assert.equal(planted.length, 1, "the scan missed a line it must find");
  assert.equal(/try \{/.test(planted[0]), false, "the scan cannot fire on a bare read — it asserts nothing");
  const guarded = storageLines('try { localStorage.setItem(k, v); } catch (e) {}\n');
  assert.equal(guarded.length, 1);
  assert.ok(/try \{/.test(guarded[0]), "the scan rejects the guarded form it is supposed to accept");
});

test("B22: a blocked WRITE never throws, and the switch still flips for the session", async () => {
  const page = await runTournament(TJS, tournamentRoutes(),
    { localStorage: makeStorage({}, { throwOnSet: true }) });
  assert.match(page.el("poolGrid").innerHTML, /^<tr><th>Court<\/th>/, "the page did not survive boot with a blocked write");
  await page.el("axisBtn").onclick();   // must not throw — an uncaught error here fails the test
  assert.match(page.el("poolGrid").innerHTML, /^<tr><th>Round<\/th><th>Court 1<\/th>/,
    "the switch is a dead control when storage is blocked — press it, nothing happens");
});

test("B22: a blocked READ never throws — the grid renders, and a blocked TOKEN exits cleanly", async () => {
  const page = await runTournament(TJS, tournamentRoutes(),
    { localStorage: makeStorage({}, { throwOnGet: true }) });
  assert.match(page.el("poolGrid").innerHTML, /^<tr><th>Court<\/th>/,
    "a throwing read killed the page — boot never reached renderGrid");

  // And with the SESSION store blocked too — this file's first statement is the bearer read,
  // earlier than any axis code — the page must fail the way a signed-out visit already fails:
  // a clean redirect to sign-in, NOT an exception. (Asserting a rendered grid here would be
  // asserting something that cannot happen: with no token, boot() returns before it loads one.)
  const noToken = await runTournament(TJS, tournamentRoutes(), {
    localStorage: makeStorage({}, { throwOnGet: true }),
    sessionStorage: makeStorage({ bt_token: "tok" }, { throwOnGet: true }),
  });
  assert.equal(noToken.location.href, "index.html",
    "an unreadable token did not take the normal signed-out route — boot threw instead of redirecting");
  assert.equal(noToken.el("poolGrid").innerHTML, "", "a signed-out page must not render a grid");
});

test("B22: the editor survives blocked storage in both directions", async () => {
  const blockedWrite = await runScheduleEditor(EDJS, editorApi,
    { localStorage: makeStorage({}, { throwOnSet: true }) });
  assert.ok(blockedWrite.el("sGrid").innerHTML.length > 0, "the editor did not survive boot with a blocked write");
  await blockedWrite.el("sAxis").click();
  assert.match(blockedWrite.el("sGrid").innerHTML, /<th scope="col">Round<\/th><th scope="col">Court 1<\/th>/,
    "the editor's switch is a dead control when storage is blocked");
  const blockedRead = await runScheduleEditor(EDJS, editorApi,
    { localStorage: makeStorage({}, { throwOnGet: true }) });
  assert.ok(blockedRead.el("sGrid").innerHTML.length > 0, "a throwing read killed the editor at boot");
});

test("B22: a storage event from ANOTHER TAB repaints both views — and only for its own key", async () => {
  // The writing tab never receives its own storage event (that is the spec), so this is the
  // only path by which a flip in one tab reaches the other.
  const page = await runTournament(TJS, tournamentRoutes());
  assert.equal(page.windowListeners("storage"), 1, "tournament.js registers no storage listener");
  assert.match(page.el("poolGrid").innerHTML, /^<tr><th>Court<\/th>/);
  page.localStorage.setItem("bt_grid_axis", "rounds-down");           // the other tab's write
  page.fireWindow("storage", { key: "bt_grid_axis", newValue: "rounds-down" });
  assert.match(page.el("poolGrid").innerHTML, /^<tr><th>Round<\/th><th>Court 1<\/th>/,
    "the other tab's flip never reached this one");
  // Teeth: a storage event for a DIFFERENT key must not repaint, or the listener is just
  // repainting on every storage write and the assertion above proves nothing.
  page.localStorage.setItem("bt_grid_axis", "courts-down");
  page.fireWindow("storage", { key: "bt_theme", newValue: "light" });
  assert.match(page.el("poolGrid").innerHTML, /^<tr><th>Round<\/th>/,
    "an unrelated storage key repainted the grid — the listener does not filter by key");
});

/* ═══ D-42: ONE fallback map per PAGE, not one per module ═══
   v0.166.0 gave each guarded file its own closure-private Map. That is coherent within a file and
   incoherent across a page: with storage blocked, module A's write is invisible to module B, so
   the two disagree about state they are both supposed to read from one place. MEASURED before
   building — the contention is real but narrow: `bt_org` and `bt_token` are touched by four of the
   five guarded modules, and the pages that actually co-load two of them are **tournament.html
   (admin-nav writes bt_org, tournament.js reads it)** and the app.js+site-nav page. On
   admin-schedule-editor.html the two guarded modules share NO key, so nothing diverged there.
   `bt_theme` is the case that forced config.js into this change: its only two writers are
   app.js (guarded, own map) and config.js's BT_THEME (guarded, NO map at all). */

const UNIFIED = ["assets/tournament.js", "assets/admin-schedule-editor.js",
  "assets/admin-nav.js", "assets/app.js", "assets/site-nav.js", "assets/config.js"];

test("D-42: every guarded module takes its fallback map from the ONE page-level home", () => {
  for (const name of UNIFIED) {
    const src = blankComments(read(name));
    assert.match(src, /window\.BT_MEM_FALLBACK \|\| \(window\.BT_MEM_FALLBACK = new Map\(\)\)/,
      `${name} still builds its own local-storage fallback map — two modules on one page will disagree`);
    assert.doesNotMatch(src, /const (?:mem|btMem) = new Map\(\)/,
      `${name} kept a closure-private map beside the shared one — the split is still there`);
  }
});

test("D-42: the session fallback is shared too, wherever a module touches sessionStorage", () => {
  // Only the modules that actually read/write sessionStorage declare it — a file that does not
  // touch the session store must NOT claim the map, or the assertion above stops meaning anything.
  const touchesSession = UNIFIED.filter((n) => /sessionStorage\./.test(blankComments(read(n))));
  assert.ok(touchesSession.length >= 2, `expected at least two session-touching modules, saw ${touchesSession.length}`);
  for (const name of touchesSession) {
    assert.match(blankComments(read(name)), /window\.BT_SESSION_FALLBACK \|\| \(window\.BT_SESSION_FALLBACK = new Map\(\)\)/,
      `${name} touches sessionStorage but keeps a private session fallback`);
  }
});

test("D-42 RUNTIME: with storage blocked, one module's write is readable by ANOTHER module on the same page", async () => {
  // The proof the static pins cannot give: two page scripts, ONE window, storage fully dead.
  // tournament.js and admin-schedule-editor.js are the pair that share a key (bt_grid_axis) AND
  // both run in this harness. They do not co-load in production today — the mechanism is what is
  // under test; the pair that DOES co-load is admin-nav + tournament.js on bt_org.
  const page = {};                                   // the shared window
  const dead = () => makeStorage({}, { throwOnGet: true, throwOnSet: true });

  const t = await runTournament(TJS, tournamentRoutes(), { window: page, localStorage: dead() });
  assert.match(t.el("poolGrid").innerHTML, /^<tr><th>Court<\/th>/, "the tournament page did not survive dead storage");
  await t.el("axisBtn").onclick();                    // writes bt_grid_axis into the shared map
  assert.match(t.el("poolGrid").innerHTML, /^<tr><th>Round<\/th>/, "the switch did not flip in-session");

  // A SECOND module boots on that same page, with its own dead storage handle.
  const ed = await runScheduleEditor(EDJS, editorApi, { window: page, localStorage: dead() });
  assert.match(ed.el("sGrid").innerHTML, /<th scope="col">Round<\/th><th scope="col">Court 1<\/th>/,
    "the second module read its own private fallback — the two modules disagree about the same key");

  // And the map really is ONE object, not two that happen to agree.
  assert.equal(typeof page.BT_MEM_FALLBACK, "object", "no page-level fallback map was created");
  assert.equal(page.BT_MEM_FALLBACK.get("bt_grid_axis"), "rounds-down",
    "the shared map does not hold the value the first module wrote");
});

test("D-42 NC: the runtime proof fails against per-module maps — and the mutation lands", async () => {
  // Positive control for the test above: give each module its own map again (exactly v0.166.0's
  // shape) and the second module must NOT see the first's write.
  const split = (src) => src.replace(
    /window\.BT_MEM_FALLBACK \|\| \(window\.BT_MEM_FALLBACK = new Map\(\)\)/, "new Map()");
  const splitT = split(TJS), splitE = split(EDJS);
  assert.notEqual(splitT, TJS, "the mutation did not land in tournament.js");
  assert.notEqual(splitE, EDJS, "the mutation did not land in admin-schedule-editor.js");

  const page = {};
  const dead = () => makeStorage({}, { throwOnGet: true, throwOnSet: true });
  const t = await runTournament(splitT, tournamentRoutes(), { window: page, localStorage: dead() });
  await t.el("axisBtn").onclick();
  const ed = await runScheduleEditor(splitE, editorApi, { window: page, localStorage: dead() });
  assert.match(ed.el("sGrid").innerHTML, /<th scope="col">Court<\/th>/,
    "the split-map source still shared state — the runtime proof above asserts nothing");
});

test("B22: the editor repaints on another tab's flip — and only for its own key", async () => {
  const page = await runScheduleEditor(EDJS, editorApi);
  assert.equal(page.windowListeners("storage"), 1, "admin-schedule-editor.js registers no storage listener");
  assert.match(page.el("sGrid").innerHTML, /<th scope="col">Court<\/th>/);
  page.localStorage.setItem("bt_grid_axis", "rounds-down");
  page.fireWindow("storage", { key: "bt_grid_axis", newValue: "rounds-down" });
  assert.match(page.el("sGrid").innerHTML, /<th scope="col">Round<\/th><th scope="col">Court 1<\/th>/,
    "the other tab's flip never reached the editor");
  page.localStorage.setItem("bt_grid_axis", "courts-down");
  page.fireWindow("storage", { key: "bt_nav", newValue: "min" });
  assert.match(page.el("sGrid").innerHTML, /<th scope="col">Round<\/th>/,
    "an unrelated storage key repainted the editor grid");
});
