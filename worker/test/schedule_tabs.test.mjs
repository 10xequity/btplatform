/**
 * Boomtown Platform — the member events list: type tabs, sort, and honest controls
 * File: worker/test/schedule_tabs.test.mjs · Version: v1.0 · Date: 2026-08-13 · Ships in: v0.145.0
 *
 * §-0 B21 / K-14. Owner 2026-08-11 (Q2): *"B, main list of events needs to be sortable. Have tabs
 * at the top to sort, similar to the tournament page in Boomtownvb.com."*
 *
 * ── WHAT THE RECORD SAID, AND WHAT WAS ACTUALLY THERE ────────────────────────────────────────
 * §-1m recorded: *"Measured: `schedule.js:21-23` already has a working `.tab` mechanism on that
 * page — K-14 is extending an existing tab row, not building one."* Re-measured 2026-08-13, that
 * is wrong twice over and the second half is the dangerous one:
 *   · the listener is at :26-30, not :21-23 (:21 is `const TZ`);
 *   · **the `.tab` row is `List | Month` — a VIEW switcher, not a sort.** "Extending the existing
 *     tab row" would have put "in what order" and "in what layout" in one control, and the
 *     owner's tabs would have changed the page's view mode as a side effect.
 * So K-14 BUILDS a tab row. It is a sibling of the view row, not an extension of it.
 *
 * ── THE COLLISION THAT MADE THIS MORE THAN A STYLE CHOICE ────────────────────────────────────
 * `schedule.js` bound `document.querySelectorAll(".tab")` — GLOBAL, unscoped. Any second `.tab`
 * on this page joins the view switcher, and clicking it sets `mode = t.dataset.mode` → undefined
 * → `render()` falls to its `else` branch and the page silently switches to the calendar. A type
 * tab that quietly changes the view is exactly the kind of defect that looks like a styling bug
 * forever. Both rows now carry ids and both listeners are scoped to their own container.
 *
 * ── WHY THE TABS ARE BUILT FROM DATA (K-13's rule, imported) ─────────────────────────────────
 * The schema allows five event types. **Live D1, 2026-08-13, published events in the public
 * window: `tournament` 4 and `league` 1. `training`, `event` and `court_rental` have ZERO.** A
 * static five-tab row would have shipped three tabs that are permanently empty — the defect K-13
 * found on the pool board, reproduced on a public page. Tabs are built from the types actually
 * loaded, and the whole row hides below two distinct types because "All" beside one tab filters
 * nothing.
 *
 * The same rule is applied to the ORG filter, which was already half-doing it: `load()` only
 * POPULATES `#orgFilter` when more than one org appears, but left the control on screen saying
 * "All orgs" and doing nothing. One org is live today, so it is doing nothing today. Fixing the
 * control beside the one being built — under the rule being built — is not scope creep; leaving
 * it exempt from its neighbour's rule would be the odd choice.
 *
 * ── THE COMPARATOR IS THE SECOND CONSUMER OF K-13's JUDGEMENT, AND IS DELIBERATELY NOT SHARED ─
 * `sortPick` / bucket-counted availability / reverse-inverts-the-comparison all mirror
 * `admin-pool-board.js`. They are NOT hoisted into `config.js` (the cross-page home, by the
 * BT_SIGNUP_LINK precedent) because this repo's own threshold for hoisting is a THIRD consumer —
 * the rule in `route-extract.mjs`'s header that governed `scriptsOf`. The two pickers share no
 * data (teams vs events) and hoisting now would force a second rewrite of a guard harness
 * rewritten one session ago. Recorded as §-1c D-32 with the trigger, rather than duplicated
 * silently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (f) => readFileSync(new URL(f, WEB), "utf8");
const SJS = read("assets/schedule.js");
const SHTML = read("schedule.html");
const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");

/** Rebuild a shipped pure function from its own bytes, `sortPick` composed in where needed. */
function pickSource(src = SJS) {
  const body = functionBodyAfter(src, "function sortPick");
  assert.ok(body, "sortPick is gone or is no longer a plain function declaration");
  return "function sortPick(key) " + body + "\n";
}
function load(name, args, src = SJS) {
  const body = functionBodyAfter(src, "function " + name);
  assert.ok(body, `${name} is gone or is no longer a plain function declaration`);
  return { fn: new Function(...args, pickSource(src) + body.slice(1, -1)), body };
}

/* Mirrors the live window deliberately: two types present of the five the schema allows, prices
   that vary, one event with no price and one with no date so the blank branches are exercised. */
const EVENTS = [
  { id: 1, name: "Spring Slam",   type: "tournament", starts_at: "2026-09-02 09:00", price_cents: 4000, org_id: 1 },
  { id: 2, name: "Autumn Open",   type: "tournament", starts_at: "2026-08-20 18:00", price_cents: 2500, org_id: 1 },
  { id: 3, name: "Monday League", type: "league",     starts_at: "2026-10-05 19:00", price_cents: null, org_id: 1 },
  { id: 4, name: "Beach Bash",    type: "tournament", starts_at: null,               price_cents: 6000, org_id: 1 },
];

/* ══════════════ 1. the fixture can exhibit what the tests below claim ══════════════ */

test("K-14 — the fixture varies on every key it tests and is in NO key's order", () => {
  assert.equal(EVENTS.length, 4, "the fixture emptied — every assertion below would pass over nothing");
  for (const [key, pick] of [["name", (e) => e.name], ["price", (e) => e.price_cents],
    ["date", (e) => e.starts_at], ["type", (e) => e.type]]) {
    assert.ok(new Set(EVENTS.map(pick)).size > 1, `${key} does not vary — its check would prove nothing`);
  }
  for (const [key, pick] of [["name", (e) => e.name], ["date", (e) => e.starts_at]]) {
    const vals = EVENTS.map(pick);
    assert.notDeepEqual(vals, [...vals].sort(),
      `the fixture is already in ${key} order — a sort test on it could not tell a comparator from a no-op`);
  }
  assert.ok(EVENTS.some((e) => e.price_cents == null), "no blank price — the blanks-last branch is untested");
  assert.ok(EVENTS.some((e) => e.starts_at == null), "no blank date — the blanks-last branch is untested");
});

/* ══════════════ 2. the collision: two tab rows, two scopes ══════════════ */

test("K-14 — the page ships TWO tab rows and they are told apart by id, not by document order", () => {
  const html = blankComments(SHTML);
  for (const id of ["schedViewTabs", "schedTypeTabs"]) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is missing — the two tab rows cannot be scoped apart`);
  }
});

test("K-14 — NEITHER tab listener may select `.tab` globally, or one row drives the other", () => {
  // The live hazard this unit found. An unscoped querySelectorAll(".tab") binds the type tabs to
  // the view switcher: clicking "Tournaments" sets mode = undefined and render() falls through to
  // the calendar. The page would look like it had a styling bug for as long as nobody clicked.
  const js = blankComments(SJS);
  assert.ok(!/document\.querySelectorAll\(\s*["']\.tab["']\s*\)/.test(js),
    "an unscoped document.querySelectorAll('.tab') survives — the two rows will drive each other");
  assert.match(js, /schedViewTabs/, "the view listener is not scoped to its own container");
  assert.match(js, /schedTypeTabs/, "the type listener is not scoped to its own container");
});

test("K-14 NC — the unscoped form IS caught, so the check above is not spelling-blind", () => {
  const bad = 'document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {});';
  assert.ok(/document\.querySelectorAll\(\s*["']\.tab["']\s*\)/.test(bad), "the detector cannot see the shipped-bug form");
  const good = 'document.querySelectorAll("#schedViewTabs .tab").forEach(t => {});';
  assert.ok(!/document\.querySelectorAll\(\s*["']\.tab["']\s*\)/.test(good), "a scoped selector is wrongly flagged");
});

/* ══════════════ 3. the tabs are built from the data ══════════════ */

test("K-14 — the type tabs are NOT static markup, or they show on boards that have none of them", () => {
  const html = blankComments(SHTML);
  const row = html.slice(html.indexOf('id="schedTypeTabs"'));
  const block = row.slice(0, row.indexOf("</div>"));
  for (const dead of ["Tournaments", "Leagues", "Training", "Court rentals"]) {
    assert.ok(!block.includes(dead),
      `"${dead}" ships as static markup — three of the five schema types have no published events at all`);
  }
  assert.match(blankComments(SJS), /availableTypes\(/, "nothing builds the tab row from the loaded events");
});

test("K-14 — All + the types PRESENT, and the row hides below two types", () => {
  const { fn } = load("availableTypes", ["list"]);
  assert.deepEqual(fn(EVENTS), ["", "tournament", "league"],
    "the tab row must be All plus each type present, in first-seen order");
  const oneType = EVENTS.filter((e) => e.type === "tournament");
  assert.ok(oneType.length > 1, "the single-type fixture is empty — this case would prove nothing");
  assert.deepEqual(fn(oneType), [],
    "one type means All sits beside a tab that selects everything — the row must disappear, not sit there");
  assert.deepEqual(fn([]), [], "an empty list cannot produce a tab row");
});

test("K-14 — every type the SCHEMA allows has a human label, derived from the schema not a memory", () => {
  // H-2's lesson: an approved design named an event type that does not exist. The list is read
  // out of the CHECK constraint so a new type added to the schema fails this until it is named.
  const m = /type TEXT NOT NULL CHECK \(type IN \(([^)]+)\)\)/.exec(SCHEMA);
  assert.ok(m, "the events type CHECK could not be parsed — this test is measuring nothing");
  const types = m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.equal(types.length, 5, `expected 5 event types in the schema, saw ${types.length}: ${types.join(", ")}`);
  const { fn } = load("typeLabel", ["type"]);
  for (const t of types) {
    const label = fn(t);
    assert.ok(label && label !== t,
      `"${t}" has no human label — a tab reading "court_rental" is a schema token on a public page`);
  }
  assert.equal(fn(""), "All", "the empty type is the All tab");
});

/* ══════════════ 4. the sort ══════════════ */

test("K-14 — date is the unconditional default; name and price are offered only when they vary", () => {
  const { fn } = load("availableSortKeys", ["list"]);
  assert.deepEqual(fn(EVENTS), ["date", "name", "price"], "all three vary in this fixture");
  const samePrice = EVENTS.map((e) => ({ ...e, price_cents: 1000 }));
  assert.ok(!fn(samePrice).includes("price"),
    "every event costs the same and Price is still offered — it would reorder nobody");
  assert.ok(fn(samePrice).includes("date"), "date is the server's own order and must always be offered");
  const oneEvent = [EVENTS[0]];
  assert.deepEqual(fn(oneEvent), ["date"], "a single event varies on nothing");
});

test("K-14 — sorting by date, name and price each orders the list and loses nobody", () => {
  const { fn } = load("sortEvents", ["list", "key", "reverse"]);
  for (const key of ["date", "name", "price"]) {
    const out = fn(EVENTS, key);
    assert.deepEqual([...out].map((e) => e.id).sort(), EVENTS.map((e) => e.id).sort(),
      `sorting by ${key} dropped or duplicated an event`);
    assert.notEqual(out, EVENTS, `sorting by ${key} mutated the caller's array`);
  }
  assert.deepEqual(fn(EVENTS, "name").map((e) => e.name),
    ["Autumn Open", "Beach Bash", "Monday League", "Spring Slam"], "name did not sort alphabetically");
  assert.deepEqual(fn(EVENTS, "date").map((e) => e.id), [2, 1, 3, 4],
    "date did not sort soonest-first with the dateless event last");
});

test("K-14 — reverse inverts the COMPARISON, so a blank stays at the bottom both ways", () => {
  // Imported judgement, not a re-decision: v0.125.0 put blanks last because a blank at the top of
  // a list is the first thing read and the least useful thing to read, and K-13 kept that through
  // reverse by negating the comparison rather than reversing the array. An event with no date is
  // exactly that case here.
  const { fn } = load("sortEvents", ["list", "key", "reverse"]);
  const asc = fn(EVENTS, "date"), desc = fn(EVENTS, "date", true);
  const dated = (l) => l.filter((e) => e.starts_at).map((e) => e.id);
  assert.deepEqual(dated(desc), [...dated(asc)].reverse(), "reverse did not invert the dated events");
  assert.equal(asc[asc.length - 1].starts_at, null, "ascending must end with the dateless event");
  assert.equal(desc[desc.length - 1].starts_at, null,
    "descending put the dateless event first — that is a reversed array, not a reversed comparison");
});

test("K-14 — the direction control says what it means for the key in hand", () => {
  // K-13 shipped "Ascending/Descending" because half its keys were numbers and an alphabet would
  // have been a lie on them. Here the three keys are a date, a name and a price, and each has its
  // own natural words — "A–Z" on a price sort is the same lie in the other direction.
  const { fn } = load("dirLabel", ["key", "reverse"]);
  const seen = new Set();
  for (const key of ["date", "name", "price"]) {
    const a = fn(key, false), b = fn(key, true);
    assert.ok(a && b, `${key} has no direction wording`);
    assert.notEqual(a, b, `${key} reads the same in both directions — the control cannot say which is on`);
    seen.add(a);
  }
  assert.equal(seen.size, 3, `the three keys share direction wording: ${[...seen].join(" / ")}`);
  assert.ok(!/A.Z/i.test(fn("price", false)), "the price direction is worded as an alphabet");
  assert.ok(!/A.Z/i.test(fn("date", false)), "the date direction is worded as an alphabet");
});

/* ══════════════ 5. the filter reaches both views, and the org control is honest ══════════════ */

test("K-14 — the type filter narrows the data BOTH views draw from, not just the list", () => {
  // The calendar is the same events in a grid. A filter that only applied to the list would leave
  // a director filtering to Leagues and still seeing tournaments in Month view.
  const render = functionBodyAfter(blankComments(SJS), "function render");
  assert.ok(render, "render() is gone or is no longer a plain function declaration");
  const listAt = render.indexOf('mode === "list"');
  const filterAt = render.indexOf("typeFilter");
  assert.ok(filterAt >= 0, "render() never consults the type filter");
  assert.ok(filterAt < listAt,
    "the type filter is applied inside the list branch — Month view would ignore it");
});

test("K-14 — the org filter hides when there is nothing to choose between", () => {
  const js = blankComments(SJS);
  const body = functionBodyAfter(js, "async function load");
  assert.ok(body, "load() is gone or is no longer a plain async function declaration");
  assert.match(body, /seen\.size > 1/, "the >1 org test is gone — it is what decides whether the control means anything");
  assert.match(body, /orgSel\.hidden|orgWrap\.hidden/,
    "the org filter is never hidden — with one org it renders 'All orgs' and does nothing, which is live today");
});

/* ══════════════ 6. negative controls — each mutates the REAL source ══════════════ */

test("K-14 NC — neutralising the comparator stops the reordering, so the sort tests can tell", () => {
  const { body } = load("sortEvents", ["list", "key", "reverse"]);
  const broken = body.replace("return reverse ? -c : c;", "return 0;");
  assert.notEqual(broken, body, "mutation did not land — the comparator's return was not found");
  const fn = new Function("list", "key", "reverse", pickSource() + broken.slice(1, -1));
  // Every blank FILLED rather than the blank rows dropped: the `!av`/`!bv` branches return 1/-1
  // before the mutated line and would reorder the list on their own, so a fixture that still
  // contained a blank would let this NC pass against a comparator that does nothing. Filtering
  // instead of filling left only two rows, which is how that was noticed.
  const noBlanks = EVENTS.map((e) => ({ ...e, starts_at: e.starts_at || "2026-11-01 10:00", price_cents: e.price_cents == null ? 9999 : e.price_cents }));
  assert.equal(noBlanks.length, EVENTS.length, "filling the blanks lost a row");
  assert.ok(noBlanks.every((e) => e.starts_at && e.price_cents != null), "a blank survived — the branches above would reorder");
  assert.notDeepEqual(load("sortEvents", ["list", "key", "reverse"]).fn(noBlanks, "name").map((e) => e.id),
    noBlanks.map((e) => e.id), "the fixture is already in name order — the intact comparator does not reorder it either");
  assert.deepEqual(fn(noBlanks, "name").map((e) => e.id), noBlanks.map((e) => e.id),
    "a comparator returning 0 still reordered — the ordering assertions are not reading this function");
});

test("K-14 NC — neutralising the bucket count offers every sort key, so availability is real", () => {
  const { body } = load("availableSortKeys", ["list"]);
  const broken = body.replace("> 1", "> 0");
  assert.notEqual(broken, body, "mutation did not land — the bucket comparison was not found");
  const fn = new Function("list", pickSource() + broken.slice(1, -1));
  const samePrice = EVENTS.map((e) => ({ ...e, price_cents: 1000 }));
  assert.ok(!load("availableSortKeys", ["list"]).fn(samePrice).includes("price"), "the real function already offers it");
  assert.ok(fn(samePrice).includes("price"),
    "with the count neutralised Price is STILL hidden — something other than the bucket test is hiding it");
});

test("K-14 NC — a type present in the data but absent from the tab row IS caught", () => {
  const { fn } = load("availableTypes", ["list"]);
  const withTraining = EVENTS.concat([{ id: 9, name: "Skills", type: "training", starts_at: "2026-09-09 18:00", price_cents: 0, org_id: 1 }]);
  assert.notDeepEqual(withTraining, EVENTS, "the mutation did not land — this NC would prove nothing");
  assert.ok(!fn(EVENTS).includes("training"), "training is offered before it exists in the data");
  assert.ok(fn(withTraining).includes("training"),
    "a type that IS in the loaded events is missing from the tab row — the row is not built from the data");
});

/* ══════════════ SG-6 (§-1o): the Month view becomes a PLACE ══════════════
   Measured 2026-08-14 (iteration 83): the "visual calendar page of upcoming events" §-1o said
   did not exist HAS existed on this page since before the 2026-08-10 brief — a full month grid
   with navigation, fed by the public view profile whose live type_filter is NULL, so every
   published type (drop-ins included) already lands on it. What was genuinely missing: a URL.
   `mode` was a client-side toggle, so no announcement, no admin screen and no bookmark could
   open the calendar directly. SG-6 ships the landing: `?mode=month` opens the Month view, the
   tab toggle keeps the URL honest (replaceState — the back button must not walk a tab tour),
   and ANY other value is the List default — load-bearing, because render()'s branch is
   `if (mode === "list") … else <calendar>`, so an unvalidated `?mode=banana` would silently
   render the calendar and a typo would look like a layout bug. */

test("SG-6 — modeFromUrl whitelists: exactly 'month' opens the calendar, anything else is the list", () => {
  const { fn } = load("modeFromUrl", ["v"]);
  assert.equal(fn("month"), "month");
  for (const junk of ["list", "", null, undefined, "MONTH", "banana", "month ", "0"]) {
    assert.equal(fn(junk), "list",
      `modeFromUrl(${JSON.stringify(junk)}) is not 'list' — render()'s else-branch would show the calendar for a typo`);
  }
});

test("SG-6 — the page's mode is INITIALISED from the URL, through the whitelist", () => {
  const code = blankComments(SJS);
  assert.match(code, /mode = modeFromUrl\(params\.get\("mode"\)\)/,
    "mode is no longer initialised from ?mode= via modeFromUrl — the calendar stopped being reachable by URL, or the whitelist was bypassed");
});

test("SG-6 — syncModeUrl writes month INTO the URL and takes it back OUT, via replaceState", () => {
  const { body } = load("syncModeUrl", ["mode", "location", "history"]);
  const fn = new Function("mode", "location", "history", body.slice(1, -1));
  const spy = () => ({ url: null, replaceState(_s, _t, u) { this.url = String(u); } });
  const h1 = spy();
  fn("month", "https://x.test/web/schedule.html?view=public", h1);
  assert.ok(h1.url, "syncModeUrl never called history.replaceState");
  assert.equal(new URL(h1.url).searchParams.get("mode"), "month", "month mode did not reach the URL");
  assert.equal(new URL(h1.url).searchParams.get("view"), "public", "the view slug was dropped while writing mode — other params must survive");
  const h2 = spy();
  fn("list", "https://x.test/web/schedule.html?mode=month&view=public", h2);
  assert.ok(h2.url, "syncModeUrl never called history.replaceState on the way back");
  assert.equal(new URL(h2.url).searchParams.get("mode"), null,
    "switching back to List left mode=month in the URL — a copied link would lie about what it shows");
  assert.ok(!body.includes("pushState"),
    "syncModeUrl uses pushState — every tab click becomes a history entry and Back walks a tab tour");
});

test("SG-6 — the view-tab click handler both sets the mode AND syncs the URL (containment, not adjacency)", () => {
  const code = blankComments(SJS);
  const anchor = 'document.querySelectorAll("#schedViewTabs .tab").forEach(t => t.addEventListener("click"';
  assert.equal(code.split(anchor).length - 1, 1, "the view-tab wiring anchor is not unique — this containment check would read the wrong span");
  const at = code.indexOf(anchor);
  // Span the forEach ARGUMENT LIST (which contains the whole click handler), not the first
  // paren after the anchor — that one belongs to querySelectorAll and closes before the
  // handler even starts. This walker's first draft did exactly that and the check reddened on
  // the real source before certifying anything.
  const fEach = code.indexOf(".forEach(", at);
  assert.ok(fEach > at && fEach < at + anchor.length, "the anchor no longer contains .forEach( — re-derive this span");
  let depth = 0, end = -1;
  for (let k = fEach + ".forEach".length; k < code.length; k++) {
    if (code[k] === "(") depth++;
    else if (code[k] === ")") { depth--; if (depth === 0) { end = k; break; } }
  }
  assert.ok(end > at, "could not span the view-tab wiring statement");
  const span = code.slice(at, end);
  assert.ok(span.includes("mode = t.dataset.mode"), "the handler no longer sets the mode — the span is reading the wrong statement");
  assert.ok(span.includes("syncModeUrl()"),
    "the view-tab handler does not sync the URL — the address bar lies the moment someone clicks Month");
});

test("SG-6 — first paint lights the tab the URL chose, not the one the markup hardcodes", () => {
  const code = blankComments(SJS);
  assert.match(code, /x\.classList\.toggle\("active", x\.dataset\.mode === mode\)/,
    "no init sync of the view tabs — a ?mode=month deep link renders the calendar under a lit List tab");
  assert.match(SHTML, /class="tab active" data-mode="list"/,
    "positive control: the markup no longer hardcodes List active — if that changed, re-judge whether the init sync is still needed");
});

test("SG-6 NC — renaming the sync call is CAUGHT, so the containment check can fail", () => {
  const mutated = blankComments(SJS).split("syncModeUrl()").join("syncModeUrlZZ()");
  assert.notEqual(mutated, blankComments(SJS), "the mutation did not land — the source never calls syncModeUrl");
  const anchor = 'document.querySelectorAll("#schedViewTabs .tab").forEach(t => t.addEventListener("click"';
  const at = mutated.indexOf(anchor);
  const fEach = mutated.indexOf(".forEach(", at);
  let depth = 0, end = -1;
  for (let k = fEach + ".forEach".length; k < mutated.length; k++) {
    if (mutated[k] === "(") depth++;
    else if (mutated[k] === ")") { depth--; if (depth === 0) { end = k; break; } }
  }
  assert.ok(mutated.slice(at, end).includes("mode = t.dataset.mode"),
    "positive control: the mutated span lost the handler itself — this NC is reading the wrong bytes");
  assert.ok(!mutated.slice(at, end).includes("syncModeUrl()"),
    "the mutated span still matches — the containment check above cannot fail and proves nothing");
});

/* ══════════════ RF-11 (v0.189.0): the member page is "Event Schedule", not bare "Schedule" ══════════════
   Owner item 11: rename Schedule → Event Schedule. The label is four surfaces — the page title and
   heading (schedule.html), the runtime heading text (schedule.js overwrites the <h1>), the member
   nav item (site-nav.js), and the home card (app.js). D-19's live hook: no two nav items share a
   name; the admin rail's "Schedule Page" is a distinct label, so this does not collide. */

const NAVJS = read("assets/site-nav.js");
const APPJS = read("assets/app.js");

test("RF-11 — the member schedule reads 'Event Schedule' across its four surfaces", () => {
  assert.match(SHTML, /<title>Event Schedule ·/, "the page <title> was not renamed"); // RF-20: · separator
  assert.match(SHTML, /id="schedTitle"[^>]*>Event Schedule</, "the static heading was not renamed");
  assert.match(blankComments(SJS), /"Event Schedule"/, "the runtime heading text was not renamed (schedule.js overwrites the h1)");
  assert.match(blankComments(NAVJS), /text: "Event Schedule"/, "the member nav item was not renamed");
  assert.match(blankComments(APPJS), /"schedule\.html", "Event Schedule"/, "the home 'Event Schedule' card was not renamed");
});

test("RF-11 NC — a bare 'Schedule' nav label must not survive the rename", () => {
  assert.ok(!/text: "Schedule"/.test(blankComments(NAVJS)),
    "a bare 'Schedule' member nav item survived — the rename is incomplete");
});

/* ══════════════ D-49 (v0.189.0): the home Tournaments card lands FILTERED ══════════════
   index.html's "Tournaments" card links schedule.html?type=tournament, but schedule.js only ever set
   typeFilter from a tab click — the param was dead, so the card landed on the unfiltered list and a
   member could not tell the click worked. The fix seeds typeFilter from ?type= at init; buildControls
   reconciles it against the loaded types (unknown/empty → All), the same shape as ?mode=. */

test("D-49 — the type filter is INITIALISED from ?type=, so the Tournaments card lands filtered", () => {
  assert.match(blankComments(SJS), /typeFilter = params\.get\("type"\)/,
    "typeFilter is not seeded from ?type= — the Tournaments card lands on the unfiltered list (D-49)");
  assert.match(blankComments(APPJS), /schedule\.html\?type=tournament/,
    "the home Tournaments card no longer sends ?type=tournament — the reader would have no producer");
});

test("D-49 NC — a schedule.js that ignores ?type= is caught", () => {
  const code = blankComments(SJS);
  const mutated = code.replace('params.get("type")', '""');
  assert.notEqual(mutated, code, "the mutation did not land — update the anchor for D-49");
  assert.ok(!/typeFilter = params\.get\("type"\)/.test(mutated),
    "the reader survived the mutation — the D-49 check proves nothing");
});
