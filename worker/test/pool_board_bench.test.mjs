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

/* v0.146.0 (K-1 tier 2 / §-0 B5) — REWRITTEN, NOT DELETED, AND THE CLAIM CHANGED ON PURPOSE.
   This asserted that a save must NOT renumber. Tier 2 makes the save the one thing that DOES:
   the owner's rule is "1 being top down for each division", read off his own tile arrangement,
   and an arrangement only exists once it is saved.

   THE PROPERTY THE OLD TEST WAS REALLY PROTECTING SURVIVES INTACT, and it is the stronger half:
   a number must never change UNDER the director. v0.125.0 expressed that as "not on a save",
   because at the time a save was the only thing that could move it. The honest form is "only on
   a save" — a plain read never renumbers, and neither does a division change made through some
   other route. That is what this now pins, and the division-change half is what forced tier 2 to
   be a stored column rather than a derivation (see migration 0045's note). */
test("T2-8/K-1 — a SAVE is the only thing that renumbers: a read never does", async () => {
  const env = boot();
  const token = await staff(env);
  const first = allTeams((await call(env, "GET", "/api/admin/events/1/board", { token })).data);
  const numbers = Object.fromEntries(first.map((t) => [t.id, t.board_no]));
  assert.ok(Object.keys(numbers).length >= 3, "the fixture emptied — this would pass over nothing");

  // Reading the board again, and again after an unrelated column changes, must not move a number.
  env.DB.exec("UPDATE teams SET note='scratch' WHERE id=1");
  const second = allTeams((await call(env, "GET", "/api/admin/events/1/board", { token })).data);
  for (const t of second) {
    assert.equal(t.board_no, numbers[t.id], `team ${t.id} was renumbered by a READ`);
  }
});

test("T2-8/K-1 — a save DOES renumber, and the precondition proves the save really rewrote the board", async () => {
  const env = boot();
  const token = await staff(env);
  const saved = await call(env, "POST", "/api/admin/events/1/board", {
    token, body: { pools: [{ division_id: 10, name: "Pool A", team_ids: [3, 1] }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data).slice(0, 200));
  assert.notEqual(env.DB.one("SELECT board_order FROM teams WHERE id=3").board_order,
    env.DB.one("SELECT board_order FROM teams WHERE id=1").board_order,
    "precondition: the save must have rewritten board_order, or this proves nothing");
  // Team 3 was dropped in FIRST, so the director's arrangement makes it number 1 — not team 1,
  // which is what registration order would have said. The two orders disagree here on purpose.
  const byId = Object.fromEntries(allTeams(saved.data).map((t) => [t.id, t]));
  assert.equal(byId[3].team_no, 1, "the team the director placed first is not number 1");
  assert.equal(byId[1].team_no, 2, "the team placed second is not number 2");
  assert.equal(byId[3].board_no, 1, "board_no did not follow the frozen number");
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
    reasoned about from a test and should not be one function.

    v0.144.0 (K-13): `sortTeams` now calls `sortPick`, a sibling function declaration, so the rebuild
    composes BOTH sets of real bytes into one scope instead of one. That is deliberate and it is not
    a weakening of the rule above: `sortPick` is the single place a sort key becomes a value, and
    `availableSortKeys` reads it too — hoisting it was the alternative to giving the option list its
    own private copy of the same judgement. The third parameter is the reverse flag; every T2-8 test
    below calls `fn(list, key)` with it undefined, which is ascending, so they are unchanged. */
function sortSource(source = PBJS) {
  const pick = functionBodyAfter(source, "function sortPick");
  assert.ok(pick, "sortPick is gone or is no longer a plain function declaration");
  return "function sortPick(key) " + pick + "\n";
}
function loadSorter(source = PBJS) {
  const body = functionBodyAfter(source, "function sortTeams");
  assert.ok(body, "sortTeams is gone or is no longer a plain function declaration");
  // The parameter names MIRROR the shipped signature `sortTeams(list, key, reverse)` — the body is
  // real bytes, so a name that disagrees is a ReferenceError rather than a wrong answer.
  return {
    fn: new Function("list", "key", "reverse", sortSource(source) + body.slice(1, -1)),
    body,
  };
}
/** The option list, rebuilt the same way and over the SAME `sortPick`. */
function loadAvailable(source = PBJS) {
  const body = functionBodyAfter(source, "function availableSortKeys");
  assert.ok(body, "availableSortKeys is gone or is no longer a plain function declaration");
  return {
    fn: new Function("list", sortSource(source) + body.slice(1, -1)),
    body,
  };
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
  // v0.144.0: THIS NC's VICTIM MOVED UNDER K-13 AND IT SAID SO. It mutated `return av.localeCompare`
  // — the comparator's whole return — and K-13 split that into `const c = av.localeCompare(…)` plus
  // `return reverse ? -c : c`, so the replace() became a no-op. It reddened on its own notEqual line
  // instead of passing while mutating nothing, which is the third time in three sessions that one
  // assertion has been the only thing between a control and vacuity. Rewritten, not deleted: the
  // victim is now the line the comparison actually leaves through, so a neutralised comparator is
  // still what this proves.
  const { body } = loadSorter();
  const broken = body.replace("return reverse ? -c : c;", "return 0;");
  assert.notEqual(broken, body, "mutation did not land — the comparator's return was not found");
  const fn = new Function("list", "key", "reverse", sortSource() + broken.slice(1, -1));

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

/* ==================== 7. K-13 (§-0 B17) — multi-sort, reverse, "where each applies" ==========
 *
 * Owner 2026-08-10 (Q3 rider): "registration date · alphabetical · rank (and reverse) · group ·
 * division · gender, WHERE EACH APPLIES." Four of those six were resolved by measurement rather
 * than by choosing, and the resolutions are pinned here because each one is a claim:
 *
 *   · RANK = the K-1 team number (`board_no`). Q3's own row sets that default. It is ALSO the
 *     answer to "registration date": `board_no` is rank by `t.id` within the event, `id` is
 *     AUTOINCREMENT, so its order IS registration order — loadBoard's own comment says so. Two of
 *     the owner's six words are therefore ONE option, and offering both would be two controls that
 *     produce byte-identical output.
 *   · GROUP = the existing Level sort. `sortTeams`'s own comment has called it grouping since
 *     v0.125.0 ("all the BB/A teams together, which grouping gives"), and the owner's Q3 answer
 *     opened with "grouping is fine". No second key was invented for a word already implemented.
 *   · DIVISION sorts by the division's `rank`, never its name or id — `rank` is the director's own
 *     explicit ordering of divisions and `loadBoard` already orders by it. One judgement, imported.
 *   · GENDER is `teams.gender_division`, which existed in the schema and was not in the payload.
 *
 * WHY "WHERE EACH APPLIES" IS COMPUTED AND NOT A STATIC LIST — this is the measurement that
 * decided the design. Live D1, 2026-08-13, the five boards that have a waiting area:
 *
 *     event   waiting   division   gender   level   seed
 *     90001      4          1         1       1       4
 *     90003      8          1         1       1       1
 *     90004      8          1         1       1       8
 *     90005      8          1         1       1       8
 *     90006     30          3         1       1      10
 *
 * (buckets of distinct values, blank counted as its own bucket). Every team in production is
 * either ("Coed","BB/A") or (NULL,NULL) — so a Gender sort would reorder nothing on every board
 * that exists, and so would Level, which HAS SHIPPED AS AN ALWAYS-VISIBLE OPTION SINCE v0.125.0.
 * A control that acts on nothing is worse than one that is absent, so an option is offered only
 * when sorting by it could actually separate two teams. That rule repairs the shipped Level and
 * Seed options at the same time as it adds the new ones.
 *
 * THE AVAILABILITY TEST AND THE SORT SHARE `sortPick`. If they had separate copies of "what this
 * key means", the option a director is offered and the order they get from it could disagree —
 * which is the failure this whole section exists to prevent. */

/* Mirrors production deliberately: level and gender are SINGLE-VALUED exactly as live D1 has them,
   so the fixture can exhibit the hiding. Division and seed vary, so it can exhibit the showing.
   A fixture where everything varied could not test half of this. */
const K13 = [
  { id: 1, name: "Net Assets",  board_no: 1, level: "BB/A", captain: "Ava Stone", seed: 3,    division_rank: 2,    gender_division: "Coed" },
  { id: 2, name: "Block Party", board_no: 2, level: "BB/A", captain: "Ben Marsh", seed: 1,    division_rank: 1,    gender_division: "Coed" },
  { id: 3, name: "Dig Nation",  board_no: 3, level: "BB/A", captain: null,        seed: 2,    division_rank: 1,    gender_division: "Coed" },
  { id: 4, name: "Ace Ventura", board_no: 4, level: "BB/A", captain: "Cass Reed", seed: null, division_rank: null, gender_division: "Coed" },
];

test("K-13 — the fixture mirrors live D1: level and gender are single-valued, division and seed are not", () => {
  assert.equal(K13.length, 4, "the fixture emptied — every assertion below would pass over nothing");
  const buckets = (f) => new Set(K13.map(f)).size;
  assert.equal(buckets((t) => t.level), 1, "level must be single-valued here, as it is on every real board");
  assert.equal(buckets((t) => t.gender_division), 1, "gender must be single-valued here, as it is on every real board");
  assert.ok(buckets((t) => t.division_rank) > 1, "division must vary or the showing case is untested");
  assert.ok(buckets((t) => t.seed) > 1, "seed must vary or the showing case is untested");
});

test("K-13 — an option is offered only when sorting by it could separate two teams", () => {
  const { fn } = loadAvailable();
  const keys = fn(K13);
  assert.ok(Array.isArray(keys) && keys.length, "availableSortKeys returned nothing — it is measuring nothing");
  for (const always of ["board", "number", "name"]) {
    assert.ok(keys.includes(always), `${always} must always be offered — it can always change the order`);
  }
  for (const shown of ["division", "captain", "seed"]) {
    assert.ok(keys.includes(shown), `${shown} varies in this fixture and must be offered`);
  }
  for (const hidden of ["level", "gender"]) {
    assert.ok(!keys.includes(hidden),
      `${hidden} is single-valued here, so sorting by it reorders nobody — it must not be offered`);
  }
});

test("K-13 — the option appears as soon as the data varies (the rule is data, not a hard-coded list)", () => {
  const { fn } = loadAvailable();
  assert.ok(!fn(K13).includes("gender"), "gender is offered before the mutation — this test proves nothing");
  // Mutate the REAL fixture: one team plays in a different division of the same event.
  const mutated = K13.map((t, i) => (i === 0 ? { ...t, gender_division: "Women" } : t));
  assert.notDeepEqual(mutated, K13, "the mutation did not land — this control would pass while testing nothing");
  assert.ok(fn(mutated).includes("gender"),
    "gender now has two buckets and is still hidden — the rule is a hard-coded list, not a measurement");
});

test("K-13 — every offerable key is one sortPick understands, and every sortPick key is offerable", () => {
  // The two-lists-one-source discipline this file already applies to the orientation toggle. A key
  // in the option list that the comparator cannot pick is a control that silently does nothing; a
  // key the comparator handles that is never offered is dead code.
  const { fn: available } = loadAvailable();
  const { fn: sorter } = loadSorter();
  // Every field varies AND the list is in ascending order on NONE of them. An unknown key returns
  // the list untouched, so a fixture already sorted on a key would compare equal to the unknown-key
  // result and this control would pass over a comparator that does nothing — the trap T2-8's own
  // "the fixture is unsorted on EVERY key" test exists to close, reproduced here on purpose.
  const everything = [3, 1, 0, 2].map((i) => ({
    ...K13[i], board_no: 4 - i, level: "L" + i, gender_division: "G" + i,
    division_rank: i, seed: i, captain: "C" + i, name: "N" + i,
  }));
  for (const k of ["number", "name", "level", "division", "gender", "captain", "seed"]) {
    const pick = { number: (t) => t.board_no, name: (t) => t.name, level: (t) => t.level,
      division: (t) => t.division_rank, gender: (t) => t.gender_division,
      captain: (t) => t.captain, seed: (t) => t.seed }[k];
    const vals = everything.map(pick);
    assert.notDeepEqual(vals, [...vals].sort(),
      `the fixture is already in ${k} order — that key's check below would prove nothing`);
  }
  const offered = available(everything);
  assert.ok(offered.length >= 8, `only ${offered.length} keys offered when every field varies: ${offered.join(", ")}`);
  for (const k of offered) {
    if (k === "board") continue;
    const out = sorter(everything, k);
    assert.deepEqual([...out].map((t) => t.id).sort(), everything.map((t) => t.id).sort(),
      `sorting by the offered key "${k}" lost or duplicated a team`);
    assert.notDeepEqual(out.map((t) => t.id), sorter(everything, k + "__nope").map((t) => t.id),
      `"${k}" is offered but sortPick does not know it — it sorts exactly like an unknown key`);
  }
});

/* v0.146.0: renamed, not rewritten. The assertions are unchanged and still correct — they run on a
   synthetic fixture with `board_no` set directly, so they test the SORT, not where the number came
   from. Only the title claimed more than it checked: since K-1 tier 2, board_no is the frozen
   arrangement number on a saved board and registration order only as the fallback. */
test("K-13 — sorting by NUMBER orders by the number on the tile, whichever tier produced it", () => {
  const { fn } = loadSorter();
  const shuffled = [K13[2], K13[0], K13[3], K13[1]];
  assert.deepEqual(fn(shuffled, "number").map((t) => t.board_no), [1, 2, 3, 4],
    "sorting by team number did not produce registration order");
  // board_no is 1..N with no gaps in the payload, so this key has no blank branch to exercise —
  // stated rather than left as an untested assumption.
  assert.ok(K13.every((t) => t.board_no != null), "a team with no number would need the blank branch");
});

test("K-13 — division sorts by the division's RANK, the director's own ordering", () => {
  const { fn } = loadSorter();
  const out = fn(K13, "division");
  assert.deepEqual(out.map((t) => t.division_rank), [1, 1, 2, null],
    "division did not order by rank with the un-divisioned team last");
});

test("K-13 — reverse flips the teams that HAVE a value and leaves blanks at the bottom in both directions", () => {
  // The design decision, pinned because it is the one a naive `.reverse()` gets wrong. v0.125.0's
  // comment is explicit that a blank at the TOP of the list is the first thing read and the least
  // useful thing to read; that has to stay true when the director reverses the sort, so reverse
  // inverts the comparison rather than the array.
  const { fn } = loadSorter();
  const asc = fn(K13, "captain"), desc = fn(K13, "captain", true);
  const named = (l) => l.filter((t) => t.captain).map((t) => t.captain);
  assert.deepEqual(named(desc), [...named(asc)].reverse(), "reverse did not invert the named teams");
  assert.equal(asc[asc.length - 1].captain, null, "ascending must end with the blank");
  assert.equal(desc[desc.length - 1].captain, null,
    "descending put the blank first — a reversed array, not a reversed comparison");
});

test("K-13 — reverse is real on the board's own order too", () => {
  const { fn } = loadSorter();
  assert.deepEqual(fn(K13, "board").map((t) => t.id), K13.map((t) => t.id), "board order stopped being identity");
  assert.deepEqual(fn(K13, "board", true).map((t) => t.id), [...K13].reverse().map((t) => t.id),
    "reversing the board's own order did nothing");
  assert.deepEqual(K13.map((t) => t.id), [1, 2, 3, 4], "sortTeams mutated the caller's array");
});

test("K-13 NC — neutralising the bucket count makes everything offerable, so the test can tell", () => {
  const { body } = loadAvailable();
  const broken = body.replace("> 1", "> 0");
  assert.notEqual(broken, body, "mutation did not land — the bucket comparison was not found");
  const fn = new Function("list", sortSource() + broken.slice(1, -1));
  assert.ok(fn(K13).includes("gender"),
    "with the count neutralised gender is STILL hidden — the availability check is not what hides it");
});

test("K-13 — the select is built from availableSortKeys, not from a static option list in the markup", () => {
  const js = blankComments(PBJS);
  assert.match(js, /availableSortKeys\(/, "nothing ever calls availableSortKeys — the option list cannot be dynamic");
  const html = blankComments(PBHTML);
  const sel = html.slice(html.indexOf('id="pbSort"'));
  const block = sel.slice(0, sel.indexOf("</select>"));
  // Level and Gender must NOT be shipped as static markup, or they appear on boards where they do
  // nothing — the exact defect this unit repairs.
  for (const dead of ["Level", "Gender", "Division"]) {
    assert.ok(!block.includes(`>${dead}<`),
      `"${dead}" is a static <option>, so it shows on every board regardless of the data`);
  }
});

test("K-13 — a saved sort that this board cannot offer falls back to the board's own order", () => {
  // localStorage carries bt_pb_sort across events. A director who sorted by Gender on one board and
  // opens another where every team is Coed must not land on a selection the select cannot show.
  const js = blankComments(PBJS);
  const paint = functionBodyAfter(js, "function paintSortOptions");
  assert.ok(paint, "paintSortOptions is gone or is no longer a plain function declaration");
  assert.match(paint, /availableSortKeys\(/, "paintSortOptions does not ask which keys this board can offer");
  assert.match(paint, /includes\(\s*sortKey\s*\)/,
    "paintSortOptions never tests the remembered key against the offerable set");
  assert.match(paint, /sortKey\s*=\s*"board"/,
    "there is no fallback — an unofferable saved key would leave the select and the list disagreeing");
  // And boot must NOT push the saved value straight onto the control, which is what it used to do:
  // that is the line that would make the select show a key this board cannot honour.
  assert.ok(!/\$\("pbSort"\)\.value\s*=\s*savedSort/.test(js),
    "boot still writes the saved key onto the select directly, bypassing the offerable check");
});

/* ==================== 8. K-13 — the two fields the payload was missing ==================== */

test("K-13 — the payload carries the GENDER a team registered with, which the route never selected", async () => {
  // `teams.gender_division` has been in the schema since the first migration and `loadBoard` did
  // not select it — the same shape of gap T2-8 found for `level`. The fixture is given a real
  // value first: a test that only asserts the key EXISTS passes just as well when every row is
  // null, which is a fixture that cannot exhibit the defect.
  const env = boot();
  env.DB.exec("UPDATE teams SET gender_division='Coed' WHERE id IN (1,2)");
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const byId = Object.fromEntries(allTeams(r.data).map((t) => [t.id, t]));
  assert.equal(byId[1].gender_division, "Coed",
    "the board cannot sort by a gender it is never sent");
  assert.equal(byId[3].gender_division, null, "a team that registered with no gender must report null, not ''");
});

test("K-13 NC — changing the real gender row changes the response, so the payload reads the COLUMN", async () => {
  const env = boot();
  env.DB.exec("UPDATE teams SET gender_division='Coed' WHERE id=1");
  const token = await staff(env);
  const before = await call(env, "GET", "/api/admin/events/1/board", { token });
  assert.equal(allTeams(before.data).find((t) => t.id === 1).gender_division, "Coed", "NC has no victim");
  env.DB.exec("UPDATE teams SET gender_division='Women' WHERE id=1");
  assert.equal(env.DB.one("SELECT gender_division AS g FROM teams WHERE id=1").g, "Women", "mutation did not land");
  const after = await call(env, "GET", "/api/admin/events/1/board", { token });
  assert.equal(allTeams(after.data).find((t) => t.id === 1).gender_division, "Women",
    "the gender was changed on the row and the board still reports the old one — it is not reading the column");
});

test("K-13 — a team's division_rank is its DIVISION's rank, resolved through the join, not its id", async () => {
  // The fixture's division 10 has rank 1, and the ids differ from the ranks on purpose: a join that
  // returned `division_id` by mistake would pass a test where the two happened to match.
  const env = boot();
  env.DB.exec("INSERT INTO divisions (id, org_id, event_id, name, rank) VALUES (11,1,1,'BB',2)");
  env.DB.exec("UPDATE teams SET division_id=11 WHERE id=1");
  env.DB.exec("UPDATE teams SET division_id=10 WHERE id=2");
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const byId = Object.fromEntries(allTeams(r.data).map((t) => [t.id, t]));
  assert.equal(byId[1].division_rank, 2, "team 1 is in division 11 (rank 2) and did not report rank 2");
  assert.equal(byId[2].division_rank, 1, "team 2 is in division 10 (rank 1) and did not report rank 1");
  assert.notEqual(byId[1].division_rank, byId[1].division_id,
    "division_rank equals division_id — the join is returning the wrong column and the fixture proves it");
  assert.equal(byId[3].division_rank, null, "a team in no division must report null so it sorts last");
});

/* ==================== 9. K-1 TIER 2 (§-0 B5) — the number from the admin's own arrangement ======
 *
 * Owner 2026-08-10: *"Team number is assigned based on historical performance data if returning
 * team … then guess based on admins arrangement of tiles (1 being top down for each division).
 * Then finally registration order."* A three-tier FALLBACK. Tier 3 (registration order) shipped in
 * v0.125.0 as the derived `board_no`; this is tier 2. Tier 1 stays unbuilt and §-1k records why —
 * "returning team" has no definition in this schema.
 *
 * ── WHY IT IS A STORED COLUMN, WHICH WAS MEASURED RATHER THAN ASSUMED ────────────────────────
 * The cheaper design is to derive the number on every read from (division, pools.sort_order,
 * board_order) and add no column, and it very nearly works: both `pools.sort_order` and
 * `teams.board_order` are written ONLY by the board save, so a derivation would already be
 * "frozen at save" by construction. **It was refuted by checking who writes the third input.**
 * `teams.division_id` has two writers outside the board — `divisions.assign` (divisions.js:417)
 * and the promote/relegate moves (:491) — and `teams.pool_id` is cleared when a pool is deleted.
 * Any of those would silently renumber a board nobody re-saved, which is the exact failure K-1's
 * spec names: "the sheet in their hand disagrees with the screen". So migration 0045 adds
 * `teams.team_no` and the save writes it.
 *
 * ── THE FALLBACK IS THE POINT, AND THE DEPLOY CHANGED NOTHING ────────────────────────────────
 * `board_no` is now COALESCE(team_no, registration rank). Live D1 on 2026-08-13 after the ALTER:
 * 0 of 70 rows non-NULL, so every team on every screen kept the number it already had until a
 * director saves a board. The tests below pin both halves — the fallback when nothing is frozen,
 * and the frozen number once something is.
 *
 * ── NUMBERS ARE NOT UNIQUE PER EVENT, DELIBERATELY ───────────────────────────────────────────
 * "1 being top down for EACH division" means every division has a team 1. That is the owner's
 * design, not a collision, and the test below asserts the restart rather than uniqueness. */

/** Two divisions, four teams, and an arrangement that DISAGREES with registration order — a
    fixture where the two tiers produced the same list could not tell them apart. */
async function twoDivisionBoard() {
  const env = boot();
  env.DB.exec("INSERT INTO divisions (id, org_id, event_id, name, rank) VALUES (11,1,1,'BB',2)");
  env.DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (4,1,1,'Fourth In')");
  const token = await staff(env);
  return { env, token };
}

test("K-1 tier 2 — before any save, every number is tier 3 and no team carries a frozen one", async () => {
  // The deploy-changes-nothing property, and the reason the ALTER was safe to run before the code.
  const env = boot();
  const token = await staff(env);
  const teams = allTeams((await call(env, "GET", "/api/admin/events/1/board", { token })).data);
  assert.equal(teams.length, 3, "the fixture emptied — this would pass over nothing");
  for (const t of teams) {
    assert.equal(t.team_no, null, `team ${t.id} has a frozen number before anyone saved a board`);
  }
  const byId = [...teams].sort((a, b) => a.id - b.id);
  assert.deepEqual(byId.map((t) => t.board_no), byId.map((_, i) => i + 1),
    "with nothing frozen the number must still be registration order — the tier-3 fallback");
});

test("K-1 tier 2 — the save numbers 1..N TOP-DOWN within each division, and restarts at 1", async () => {
  const { env, token } = await twoDivisionBoard();
  // Division 10 gets two pools; division 11 gets one. Pool order is the array order the director
  // saved, which is what `pools.sort_order` records.
  const saved = await call(env, "POST", "/api/admin/events/1/board", {
    token,
    body: { pools: [
      { division_id: 10, name: "A", team_ids: [3] },      // sort_order 0 → div 10, number 1
      { division_id: 11, name: "A", team_ids: [4] },      // sort_order 1 → div 11, number 1
      { division_id: 10, name: "B", team_ids: [2, 1] },   // sort_order 2 → div 10, numbers 2 and 3
    ] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data).slice(0, 200));
  const byId = Object.fromEntries(allTeams(saved.data).map((t) => [t.id, t]));
  assert.equal(byId[3].team_no, 1, "division 10's first pool did not start at 1");
  assert.equal(byId[2].team_no, 2, "the second pool's first team did not continue the division's run");
  assert.equal(byId[1].team_no, 3, "board_order did not break the tie inside the second pool");
  assert.equal(byId[4].team_no, 1, "division 11 did not RESTART at 1 — the owner's rule is per division");
  // Stated as the property rather than the four values: each division is exactly 1..N.
  for (const div of [10, 11]) {
    const nums = Object.values(byId).filter((t) => t.division_id === div).map((t) => t.team_no).sort((a, b) => a - b);
    assert.deepEqual(nums, nums.map((_, i) => i + 1), `division ${div} is not 1..N with no gaps: ${nums.join(",")}`);
  }
});

test("K-1 tier 2 — a team left in the waiting area gets NO frozen number and keeps tier 3", async () => {
  const { env, token } = await twoDivisionBoard();
  const saved = await call(env, "POST", "/api/admin/events/1/board", {
    token, body: { pools: [{ division_id: 10, name: "A", team_ids: [3] }] },
  });
  assert.equal(saved.status, 200);
  const ws = saved.data.workspace || [];
  assert.ok(ws.length >= 2, `only ${ws.length} teams left waiting — the unplaced case is untested`);
  for (const t of ws) {
    assert.equal(t.team_no, null, `unplaced team ${t.id} was given an arrangement number it has no arrangement for`);
    assert.ok(t.board_no > 0, `unplaced team ${t.id} lost its number entirely — it must fall back, not vanish`);
  }
});

test("K-1 tier 2 — a division change made OUTSIDE the board does not renumber a saved board", async () => {
  // The measurement that made this a stored column. `divisions.assign` moves a team between
  // divisions without touching the board; a derived number would have silently rewritten the
  // sheet in the director's hand.
  const { env, token } = await twoDivisionBoard();
  await call(env, "POST", "/api/admin/events/1/board", {
    token, body: { pools: [{ division_id: 10, name: "A", team_ids: [3, 1] }] },
  });
  const before = env.DB.query("SELECT id, team_no FROM teams WHERE event_id=1 ORDER BY id");
  // WITHOUT THIS LINE THIS TEST IS VACUOUS AND IT WAS — before the column was written, `before`
  // and `after` were both all-NULL and compared equal while proving nothing. A comparison of two
  // empty things is not a control.
  assert.ok(before.some((r) => r.team_no != null),
    "nothing is frozen going in, so the comparison below would pass on two lists of nulls");
  env.DB.exec("UPDATE teams SET division_id=11 WHERE id=3");
  assert.equal(env.DB.one("SELECT division_id AS d FROM teams WHERE id=3").d, 11,
    "the mutation did not land — this test would prove nothing");
  const after = env.DB.query("SELECT id, team_no FROM teams WHERE event_id=1 ORDER BY id");
  assert.deepEqual(after, before,
    "moving a team between divisions changed a frozen number without anyone saving the board");
});

test("K-1 tier 2 — board_no is COALESCE(frozen, registration), so the two tiers cannot both show", async () => {
  const { env, token } = await twoDivisionBoard();
  const saved = await call(env, "POST", "/api/admin/events/1/board", {
    token, body: { pools: [{ division_id: 10, name: "A", team_ids: [3] }] },
  });
  for (const t of allTeams(saved.data)) {
    const registration = env.DB.one(
      "SELECT COUNT(*) AS n FROM teams x WHERE x.event_id=1 AND x.id<=" + t.id).n;
    assert.equal(t.board_no, t.team_no == null ? registration : t.team_no,
      `team ${t.id}'s displayed number is neither its frozen number nor its registration rank`);
  }
  // And the fixture must contain BOTH cases, or the COALESCE has only one branch exercised.
  const all = allTeams(saved.data);
  assert.ok(all.some((t) => t.team_no != null), "no team is frozen — the first branch is untested");
  assert.ok(all.some((t) => t.team_no == null), "every team is frozen — the fallback branch is untested");
});

test("K-1 tier 2 NC — stripping the numbering write leaves every team unfrozen, so the tests can tell", async () => {
  // The real source, mutated: without the UPDATE that writes team_no, a save must leave the
  // column NULL and the assertions above must be the thing that notices.
  // TWO statements write this column — the clear (`SET team_no=NULL`) and the sequencing write
  // (`SET team_no=?1`). The first attempt mutated whichever came first and then asserted the
  // column was unwritten, which the surviving statement falsified. The victim has to be the one
  // that ASSIGNS a number, named exactly.
  const src = readFileSync(new URL("../src/divisions.js", import.meta.url), "utf8");
  assert.match(src, /SET team_no=\?1/, "the numbering write is gone — this NC has no victim");
  assert.match(src, /SET team_no=NULL/, "the per-save clear is gone — a dragged-out team would keep a stale number");
  const mutated = src.replace("SET team_no=?1", "SET board_order=board_order");
  assert.notEqual(mutated, src, "the mutation did not land — this NC would prove nothing");
  assert.doesNotMatch(mutated, /SET team_no=\?1/,
    "the mutated source still assigns team_no — the detector is reading the wrong statement");
  // And the clear must survive the mutation, or the NC proved the wrong statement was removed.
  assert.match(mutated, /SET team_no=NULL/, "the mutation hit the clear instead of the assignment");
});

test("K-1 tier 2 — the board SAYS which numbering is showing, in both states", async () => {
  // K-1's spec: "That is a real design decision and it should be stated in the UI, e.g. the board
  // reads 'Numbers set when you saved' rather than silently renumbering." A number that quietly
  // means two different things on two days is the "empty and broken look identical" family.
  const js = blankComments(PBJS);
  assert.match(js, /pbNumNote/, "there is no element for the numbering note");
  const body = functionBodyAfter(js, "function paintNumberNote");
  assert.ok(body, "paintNumberNote is gone or is no longer a plain function declaration");
  assert.match(body, /team_no/, "the note does not consult whether anything is actually frozen");
  // EVERY quoted string, then filtered by length — not `"[^"]{12,}"`, which mispairs quotes: it
  // skips the short `"pbNumNote"` and then reads that string's CLOSING quote as an opening one,
  // swallowing the code between it and the first real message. A detector that returns the wrong
  // span is worse than one that returns nothing, because it still returns something.
  const strings = [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1]).filter((s) => s.length >= 12);
  assert.ok(strings.length >= 2,
    `the note has ${strings.length} wording(s) — it must say something different in each state, or it is decoration`);
  assert.ok(strings.some((s) => /saved/i.test(s)), "neither wording mentions saving");
  assert.ok(strings.some((s) => /registration/i.test(s)), "neither wording names the fallback a director would otherwise have to guess");
});
