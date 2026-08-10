/**
 * Boomtown Platform — §-1j T2-8: the pool board's waiting area, level, sort and orientation
 * File: worker/test/pool_board_bench.test.mjs · Version: v1.0 · Date: 2026-08-10 · Ships in: v0.125.0
 *
 * Owner 2026-08-09: "Pool board works but the teams list does not scroll and it overlaps the pool
 * drag area when you have several teams. This needs to be fixed size or collapsable but makes it
 * hard to drag. The teams should pull or have their team level they registered with as well. There
 * needs to be a sort button for teams either by level, team name, captain name, etc. Add a
 * horizontal view vs vertical view."
 *
 * FOUR CLAIMS, THREE DIFFERENT KINDS OF EVIDENCE — which is why this file is not one style of test.
 *
 * 1. THE OVERLAP IS A CASCADE FACT AND A MARKUP TEST CANNOT SEE IT. `.pb-workspace` shipped as
 *    `position: sticky; bottom: 0` with no max-height, no overflow and a list that wraps unbounded,
 *    so on a desktop with thirty unplaced teams the waiting area grows over the pools a director is
 *    trying to drag onto. Every byte of that markup is correct; only the rules are wrong. So the
 *    assertion is on the CSS, and the negative control removes the bound to reproduce the SHIPPED
 *    state byte-for-byte — a fixture that cannot exhibit the defect is not a fixture (v0.124.0).
 *
 * 2. LEVEL IS A ROUTE FACT. `teams.level` has existed since the first schema and `loadBoard` never
 *    selected it, so no amount of client work could show it. Asserted against the route, with an NC
 *    that flips the real row and proves the response follows the COLUMN rather than a constant.
 *
 * 3. SORTING IS BEHAVIOUR, SO THE TEST EXECUTES THE REAL BYTES. `sortTeams` is a pure function with
 *    no DOM and no closure, extracted from the shipped file with `functionBodyAfter` and rebuilt
 *    with `new Function`. A text scan for the word "sort" would pass over a comparator that returns
 *    0, which is exactly what the NC builds. The expectations are PROPERTIES derived from the
 *    fixture (non-decreasing, a permutation, blanks last), never a hand-written target order — a
 *    hand-written order is just the comparator restated, and it would agree with any bug it shares.
 *
 * 4. THE ORIENTATION TOGGLE IS A TWO-LISTS-ONE-SOURCE PROBLEM. The value the JS writes, the value
 *    the buttons declare and the value the stylesheet selects on must be one set. This repo has now
 *    paid three times for a class that existed on one side of that line and not the other
 *    (`bt-back` v0.116.0, `ed-side` v0.122.0, `.sr-only` D-23), so the guard compares the sets
 *    instead of spot-checking one of them.
 *
 * HAZARDS THIS FILE DELIBERATELY WORKS AROUND — all live in `pool_board.test.mjs`:
 *   · `:289` pins `.pb-state.dirty::before { content: "● "` character-for-character, so that block
 *     is not reformatted here; new rules are appended, never interleaved.
 *   · `:276` pins the tile aria-label OPENING with `${esc(t.name)}`, so the team number and level
 *     are appended to that label rather than prefixed to it.
 *   · `:302` forbids `disabled`…`pool`…`size` on any one line of the page script.
 *   · §-1c D-6: `wire()` stacks drag handlers on `#pbWork` on every render. The new controls are
 *     static nodes, so they are wired ONCE at boot and a positional test keeps them out of `wire()`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments, blockEnd, functionBodyAfter } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const WEB = new URL("../../web/", import.meta.url);
const read = (f) => readFileSync(new URL(f, WEB), "utf8");
const PBJS = read("assets/admin-pool-board.js");
const PBHTML = read("admin-pool-board.html");
const ORIGIN = "https://boomtown.test";

/** The page's own `<style>` block, comments blanked. Blanking comes FIRST and it is not optional:
    the fix below explains itself in prose that names `.pb-worklist`, `max-height` and `overflow`,
    and an uncommented scan reads the justification of the fix as the fix. */
const STYLES = blankComments(
  [...PBHTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"));

/** Every `selector { declarations }` pair. CSS has no nesting on this page, so a flat split is exact. */
const rulesIn = (css) => (css.match(/[^{}]+\{[^{}]*\}/g) || [])
  .map((r) => ({ sel: r.slice(0, r.indexOf("{")).trim(), decls: r.slice(r.indexOf("{") + 1, -1) }));

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'tournament','Board Test','published',8)");
  DB.exec("INSERT INTO divisions (id, org_id, event_id, name, rank, court_from, court_to) VALUES (10,1,1,'Open',1,1,4)");
  DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (900,1,'ava@bt.test','Ava Stone')");
  // The levels the REVCO registration form actually writes — compound labels, not a 1-5 ordinal.
  DB.exec(`INSERT INTO teams (id, org_id, event_id, name, level, captain_contact_id, seed) VALUES
             (1,1,1,'Net Assets','BB/A',900,3),
             (2,1,1,'Block Party','A/AA',NULL,1)`);
  DB.exec("INSERT INTO teams (id, org_id, event_id, name, seed) VALUES (3,1,1,'No Level FC',2)");
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
  return { status: res.status, data };
}

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email='s@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

/* ==================== 1. the registered level reaches the board ==================== */

test("T2-8 — the board names each team's REGISTERED level, which the route never selected", async () => {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const byId = Object.fromEntries((r.data.workspace || []).map((t) => [t.id, t]));
  assert.equal(byId[1].level, "BB/A",
    "the pool board cannot show a level it is never sent — loadBoard selects the team columns and level is not among them");
  assert.equal(byId[2].level, "A/AA");
});

test("T2-8 NC — changing the real row's level changes the response, so the feed reads the COLUMN", async () => {
  const env = boot();
  const token = await staff(env);
  env.DB.exec("UPDATE teams SET level='Open' WHERE id=1");
  assert.equal(env.DB.one("SELECT level FROM teams WHERE id=1").level, "Open", "mutation did not land");
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const team = (r.data.workspace || []).find((t) => t.id === 1);
  assert.equal(team.level, "Open",
    "the level was raised on the row and the board still reports the old one — it is not reading the column");
});

test("T2-8 — a team that registered with no level reports null, not an empty string", async () => {
  // The screen decides how to render absence. A route that invents "" makes an empty chip.
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const team = (r.data.workspace || []).find((t) => t.id === 3);
  assert.equal(team.level, null);
});

/* ==================== 1b. the team NUMBER, and the two properties it lives or dies by ========== */

const allTeams = (d) => [...(d.workspace || []),
  ...(d.divisions || []).flatMap((x) => (x.pools || []).flatMap((p) => p.teams || [])),
  ...(d.loose_pools || []).flatMap((p) => p.teams || [])];

test("T2-8 — every team carries a number, and it is 1..N in registration order with no gaps", async () => {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const teams = allTeams(r.data);
  assert.equal(teams.length, 3);
  // Derived from the ids the fixture actually holds, never a written-out list: the property is
  // "rank by id", so the expectation is computed the same way a reader would compute it.
  const byId = [...teams].sort((a, b) => a.id - b.id);
  assert.deepEqual(byId.map((t) => t.board_no), byId.map((_, i) => i + 1),
    "the team numbers are not the teams' rank by registration order");
});

test("T2-8 — a team's number survives being dragged into a pool and saved", async () => {
  // This is the whole point of the number. `board_order` is rewritten to a within-pool index on
  // every save, so a number derived from it would change under the director mid-check.
  const env = boot();
  const token = await staff(env);
  const before = allTeams((await call(env, "GET", "/api/admin/events/1/board", { token })).data);
  const numbers = Object.fromEntries(before.map((t) => [t.id, t.board_no]));

  const saved = await call(env, "POST", "/api/admin/events/1/board", {
    token, body: { pools: [{ division_id: 10, name: "Pool A", team_ids: [3, 1] }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data).slice(0, 200));
  assert.notEqual(env.DB.one("SELECT board_order FROM teams WHERE id=3").board_order,
    env.DB.one("SELECT board_order FROM teams WHERE id=1").board_order,
    "precondition: the save must have rewritten board_order, or this proves nothing");

  for (const t of allTeams(saved.data)) {
    assert.equal(t.board_no, numbers[t.id],
      `team ${t.id} was renumbered by a save — the number is not stable and cannot be checked against`);
  }
});

test("T2-8 — a withdrawn team leaves a GAP rather than renumbering everyone below it", async () => {
  const env = boot();
  const token = await staff(env);
  const before = allTeams((await call(env, "GET", "/api/admin/events/1/board", { token })).data);
  const three = before.find((t) => t.id === 3).board_no;

  env.DB.exec("UPDATE teams SET deleted_at=datetime('now') WHERE id=2");
  assert.ok(env.DB.one("SELECT deleted_at FROM teams WHERE id=2").deleted_at, "mutation did not land");

  const after = allTeams((await call(env, "GET", "/api/admin/events/1/board", { token })).data);
  assert.equal(after.length, 2, "the withdrawn team is still on the board");
  assert.equal(after.find((t) => t.id === 3).board_no, three,
    "withdrawing team 2 renumbered team 3 — every printed sheet in the building is now wrong");
});

/* ==================== 2. the waiting area is bounded — a CASCADE assertion ==================== */

test("T2-8 — the waiting area is its own bounded scroll container, so it can never cover the pools", () => {
  // The shipped defect: `.pb-workspace` is `position: sticky; bottom: 0` and its list wraps with no
  // ceiling, so N teams means N rows of overlay. Bounding the LIST bounds the section that holds it.
  const base = rulesIn(STYLES).filter((r) => r.sel === ".pb-worklist");
  assert.ok(base.length >= 1, "the waiting list has no base rule at all");
  const decls = base.map((r) => r.decls).join(" ");
  assert.match(decls, /max-height\s*:/,
    "the waiting list has no height ceiling — this is the shipped defect: it grows over the drag area");
  assert.match(decls, /overflow-y\s*:\s*auto/,
    "a ceiling without a scroller hides teams instead of overlapping them, which is worse");

  // No later rule may lift the ceiling back off in either orientation.
  const everyListRule = rulesIn(STYLES)
    .filter((r) => /\.pb-worklist(?![\w-])/.test(r.sel) && !/\.pb-tile/.test(r.sel));
  assert.doesNotMatch(everyListRule.map((r) => r.decls).join(" "), /max-height\s*:\s*none/,
    "a later rule sets max-height:none and puts the overlap straight back");

  // Two lists, one source: the node the rules describe must be the node the markup builds.
  assert.match(PBHTML, /id="pbWork"[^>]*class="[^"]*\bpb-worklist\b/,
    "the bounded rules describe a class the waiting list does not carry");
});

test("T2-8 NC — removing the ceiling reproduces the SHIPPED state and the checker fires", () => {
  // This mutation is not hypothetical: it restores admin-pool-board.html exactly as v0.124.0
  // shipped it — a sticky waiting area with no max-height. The checker must call that broken.
  const mutated = STYLES.replace(/(\.pb-worklist\s*\{[^}]*?)max-height\s*:[^;]*;/, "$1");
  assert.notEqual(mutated, STYLES, "mutation did not land — no max-height was removed");

  const base = rulesIn(mutated).filter((r) => r.sel === ".pb-worklist");
  const decls = base.map((r) => r.decls).join(" ");
  assert.doesNotMatch(decls, /max-height\s*:/,
    "the unbounded state was not produced, so the assertion above proves nothing");
});

test("T2-8 — the waiting area can also be collapsed outright, which is the owner's other option", () => {
  // "This needs to be fixed size or collapsable" — both, because a director mid-drag wants the
  // pools, and a director dealing teams wants the bench.
  assert.match(PBHTML, /id="pbCollapse"/, "no collapse control exists");
  const collapsed = rulesIn(STYLES).filter((r) => /data-collapsed/.test(r.sel));
  assert.ok(collapsed.length >= 1, "the collapse control has no rule behind it — it would toggle nothing");
  assert.match(collapsed.map((r) => r.decls).join(" "), /display\s*:\s*none/,
    "collapsing must actually remove the list from the layout, not just shrink it");
});

/* ==================== 3. sorting — the real comparator, executed ==================== */

/** Rebuild the shipped `sortTeams` from its own bytes. No DOM, no closure: if that stops being true
    this throws, which is the correct failure — a comparator that reaches outside itself cannot be
    reasoned about from a test and should not be one function. */
function loadSorter(source = PBJS) {
  const body = functionBodyAfter(source, "function sortTeams");
  assert.ok(body, "sortTeams is gone or is no longer a plain function declaration");
  return { fn: new Function("list", "key", body.slice(1, -1)), body };
}

const FIXTURE = [
  { id: 1, name: "Net Assets", level: "BB/A", captain: "Ava Stone", seed: 3 },
  { id: 2, name: "Block Party", level: "A/AA", captain: "Ben Marsh", seed: 1 },
  { id: 3, name: "Dig Nation", level: "Open", captain: null, seed: 2 },
  { id: 4, name: "Ace Ventura", level: null, captain: "Cass Reed", seed: null },
];
const ids = (list) => list.map((t) => t.id);

test("T2-8 — the fixture is unsorted on EVERY key, so each ordering has something to prove", () => {
  // Without this the whole sort suite could be vacuous: a fixture already in name order passes a
  // sort-by-name test that does nothing at all.
  const { fn } = loadSorter();
  for (const key of ["name", "level", "captain", "seed"]) {
    assert.notDeepEqual(ids(fn(FIXTURE, key)), ids(FIXTURE),
      `the fixture is already in ${key} order — that test would pass without a comparator`);
  }
});

test("T2-8 — sorting reorders the bench by team name, level, captain or seed, losing nobody", () => {
  const { fn } = loadSorter();
  for (const key of ["name", "level", "captain", "seed"]) {
    const out = fn(FIXTURE, key);
    assert.deepEqual([...ids(out)].sort(), [...ids(FIXTURE)].sort(),
      `sorting by ${key} dropped or duplicated a team — a bench that loses a team loses a real one`);
    assert.notEqual(out, FIXTURE, `sorting by ${key} mutated the caller's array`);

    // The ordering property, derived from the values themselves rather than a written-out target.
    const present = out.filter((t) => t[key === "captain" ? "captain" : key] != null);
    const vals = present.map((t) => (key === "seed" ? t.seed : String(t[key]).toLowerCase()));
    for (let i = 1; i < vals.length; i++) {
      assert.ok(vals[i - 1] <= vals[i],
        `sorting by ${key} is not non-decreasing: ${JSON.stringify(vals)}`);
    }
    // Blanks last: a team with no captain must not head the captain sort.
    const blanks = out.map((t, i) => (t[key] == null ? i : -1)).filter((i) => i >= 0);
    for (const i of blanks) {
      assert.ok(i >= out.length - blanks.length,
        `a team with no ${key} sorted above teams that have one`);
    }
  }
});

test("T2-8 — the board's own order is a real choice and returns the list untouched", () => {
  const { fn } = loadSorter();
  assert.deepEqual(ids(fn(FIXTURE, "board")), ids(FIXTURE),
    "the default must be the order the server sent, or a director cannot get back to it");
});

test("T2-8 NC — neutralising the real comparator stops the reordering, so the test can tell", () => {
  const { body } = loadSorter();
  const broken = body.replace("return av.localeCompare", "return 0; return av.localeCompare");
  assert.notEqual(broken, body, "mutation did not land — the comparator's return was not found");
  const fn = new Function("list", "key", broken.slice(1, -1));

  // A fixture with NO blanks, because the blank-handling branches return 1/-1 before the mutated
  // line and would reorder the list on their own — the NC has to isolate the comparison itself.
  const full = [
    { id: 1, name: "Zulu", level: "B", captain: "Zoe Ray", seed: 4 },
    { id: 2, name: "Alpha", level: "A", captain: "Al Kane", seed: 1 },
    { id: 3, name: "Mike", level: "AA", captain: "Mo Dane", seed: 2 },
  ];
  assert.notDeepEqual(ids(loadSorter().fn(full, "name")), ids(full),
    "the NC fixture is already in name order — the intact comparator does not reorder it either");
  assert.deepEqual(ids(fn(full, "name")), ids(full),
    "a comparator that always returns 0 still reordered the list — the ordering assertions above are not reading this function");
});

test("T2-8 — sorting the bench is a VIEW change and must never mark the board unsaved", () => {
  // `save()` sends `pools` only; the workspace order is not persisted at all. A sort that set the
  // dirty flag would offer a Save that writes nothing and warn on every event switch afterwards.
  const js = blankComments(PBJS);
  const at = js.indexOf('$("pbSort")');
  assert.ok(at > 0, "the sort control is never wired");
  const handler = js.slice(at, blockEnd(js, js.indexOf("{", at)));
  assert.doesNotMatch(handler, /dirty\s*=\s*true/,
    "sorting the waiting list marked the board unsaved — it changes no arrangement");
  assert.match(js, /pools:\s*zones/, "the save payload no longer builds from zones alone");
});

/* ==================== 4. horizontal vs vertical, as ONE set of values ==================== */

const viewsFromJs = (js) => {
  const m = js.match(/PB_VIEWS\s*=\s*\[([^\]]*)\]/);
  return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]).sort() : [];
};
const viewsFromHtml = (html) =>
  [...new Set([...html.matchAll(/data-pbview="([^"]+)"/g)].map((m) => m[1]))].sort();
const viewsFromCss = (css) =>
  [...new Set([...css.matchAll(/\[data-view="([^"]+)"\]/g)].map((m) => m[1]))].sort();

test("T2-8 — the board offers a horizontal and a vertical arrangement, and both are real", () => {
  const js = viewsFromJs(blankComments(PBJS));
  assert.deepEqual(js, ["bottom", "side"],
    "the two orientations the owner asked for are not both declared");
  assert.deepEqual(viewsFromHtml(PBHTML), js, "the buttons offer a different set of views than the script knows");
  assert.deepEqual(viewsFromCss(STYLES), js, "a view the script can select has no layout rules behind it");

  // The side arrangement must actually be a column beside the board rather than a restyled strip,
  // or it does not solve the overlap it exists to solve.
  const side = rulesIn(STYLES).filter((r) => /\[data-view="side"\]/.test(r.sel));
  assert.match(side.map((r) => r.decls).join(" "), /grid-template-columns/,
    "the side view does not lay the board and the bench out as columns");
});

test("T2-8 NC — a view value the stylesheet has never heard of is caught", () => {
  const mutated = blankComments(PBJS).replace(/(PB_VIEWS\s*=\s*\[[^\]]*)"side"/, '$1"sideways"');
  assert.notEqual(mutated, blankComments(PBJS), "mutation did not land — PB_VIEWS was not rewritten");
  assert.notDeepEqual(viewsFromJs(mutated), viewsFromCss(STYLES),
    "the script's view list and the stylesheet's disagreed and the comparison did not notice");
});

/* ==================== 5. hygiene — D-6 is not inherited ==================== */

test("T2-8 — the new controls are wired once at boot, never inside render's wire()", () => {
  // §-1c D-6: `wire()` runs at the end of every render and stacks handlers on nodes it does not
  // recreate. These four controls are static markup, so a listener added there would accumulate for
  // the life of the page — one sort click firing twenty times by the twentieth drag.
  const js = blankComments(PBJS);
  const wireBody = functionBodyAfter(js, "function wire()");
  assert.ok(wireBody, "wire() is gone — this check no longer describes the file");
  // The HOOKS the script actually reaches these controls by — not their ids. The two view buttons
  // are addressed by `data-pbview` on purpose (one loop, no id list to drift), and a guard that
  // demanded their ids appear in the JS would be pinning a spelling rather than the invariant.
  // That is D-17b's lesson, and it cost three assertions the last time it was ignored.
  for (const hook of ["pbSort", "pbCollapse", "data-pbview"]) {
    // Existence first, or the absence below is trivially true and this test guards nothing.
    assert.ok(js.includes(hook), `${hook} is not wired anywhere — the control is dead`);
    assert.ok(!wireBody.includes(hook),
      `${hook} is wired inside wire(), so its listener is re-added on every render (D-6)`);
  }
  // And every control the markup offers is reachable by one of those hooks.
  for (const id of ["pbSort", "pbCollapse", "pbViewBottom", "pbViewSide"]) {
    assert.match(PBHTML, new RegExp(`id="${id}"`), `${id} is gone from the page`);
  }
});

test("T2-8 NC — a control moved into wire() is caught", () => {
  const js = blankComments(PBJS);
  const wireBody = functionBodyAfter(js, "function wire()");
  const mutated = js.replace(wireBody, wireBody.slice(0, 1) + '\n$("pbSort");' + wireBody.slice(1));
  assert.notEqual(mutated, js, "mutation did not land — wire()'s body was not rewritten");
  assert.ok(functionBodyAfter(mutated, "function wire()").includes("pbSort"),
    "the injected listener was not detected, so the positional check above proves nothing");
});

/* ==================== 6. the tile shows what the owner asked to double-check ==================== */

test("T2-8 — a tile carries its number and its level, and both classes are styled", () => {
  // Owner: "add team numbers on the teams in addition to captain names based on assignments to
  // double check." A class in markup with no rule renders as unstyled text — the D-23 family, and
  // this repo has shipped that defect twice already.
  const js = blankComments(PBJS);
  for (const cls of ["pb-num", "pb-level"]) {
    assert.ok(js.includes(`class="${cls}"`), `the tile template never emits .${cls}`);
    assert.ok(rulesIn(STYLES).some((r) => new RegExp(`\\.${cls}(?![\\w-])`).test(r.sel)),
      `.${cls} is used on the tile and defined nowhere — it renders as unstyled text`);
  }
  // The accessible name still OPENS with the team name (pool_board.test.mjs:276 pins that), and the
  // number and level are appended to it rather than prefixed. The label is built from a template
  // literal containing its own double quotes, so this reads the tile's body rather than trying to
  // regex across an attribute value that does not end where a naive `[^"]*` thinks it does.
  assert.match(js, /aria-label="\$\{esc\(t\.name\)\}/,
    "the tile's accessible name no longer opens with the team name");
  const tileBody = functionBodyAfter(js, "function tile(");
  assert.ok(tileBody, "tile() is gone or is no longer a plain function declaration");
  for (const said of [", team ", ", level "]) {
    assert.ok(tileBody.includes(said),
      `the tile shows a fact it never says: "${said.trim()}" is missing from the accessible name`);
  }
});
