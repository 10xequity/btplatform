/**
 * Boomtown Platform — §-0 B27 / §-1p WF-5: the per-event manager hub (H-1 shell + H-2 all tabs)
 * File: worker/test/manager_hub.test.mjs · Version: v2.0 · Date: 2026-08-12 · Ships in: v0.140.0
 *
 * The owner, 2026-08-11 item 6/7: one manager page per event, with horizontal tabs across the top
 * that do NOT reload — Registrations (Waitlist a subsection) · Divisions & Create Pools · Scoring
 * Links · Schedule editor · Scoring Edit · Live Scoring Board · Bracket. He approved the design in
 * §-1p (WF-5 DESIGN) on 2026-08-12. H-1 ships the shell and the first two tabs.
 *
 * THE DESIGN DECISION THIS FILE EXISTS TO PROTECT: **a tab's content is the EXISTING page, in a
 * same-origin iframe, chromeless.** Not a copy, not a fork, not a re-mount. Seven of the nine
 * surfaces own page-local CSS (the pool board alone is 200+ lines) and one is a member-side page
 * with a different stylesheet set, so mounting them into one document would pour 500+ lines of
 * page-local cascade into one place — standards §11, in the form that actually bites. The iframe
 * makes §11 structural rather than a rule someone has to remember.
 *
 * THE AMENDMENT MADE AT BUILD TIME, AND WHY. The design said "put the shared half of the embed
 * contract in ONE helper and make both the widget and the hub call it." Measuring the loaders
 * killed that: `web/widget.js` is a drop-in <script> served to EXTERNAL sites (boomtownvb.com,
 * coloradoboom.com) and cannot import from this repo without adding a network request to a
 * customer's page. So the CONTRACT is shared and the implementations are two — the member/external
 * pair (schedule.js posts, widget.js listens) and the in-app pair (config.js posts, the hub
 * listens). **What keeps them from drifting is a test, not a file:** the message key is asserted
 * identical across all four, below. One judgement, pinned in the only place that can hold it.
 *
 * v2.0 (H-2): the remaining five tabs, and TAB VISIBILITY BY EVENT TYPE. Two things moved in this
 * release and both pins moved with them — the embed child from admin-nav.js to config.js and the
 * body.embed rule set from admin.css to app.css — because H-2's Live tab is live.html, a MEMBER
 * page that loads neither of the admin files. A second copy for the member shell would have been a
 * third implementation of one message and a second rule set for one concept (D-23/D-24's class).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");
const code = (rel) => blankComments(read(rel));

const HUB_HTML = read("admin-manager.html");
const HUB_JS = code("assets/admin-manager.js");
const NAV_JS = code("assets/admin-nav.js");
const ADMIN_CSS = read("assets/admin.css");
const CONFIG_JS = code("assets/config.js");
const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");

/** Every page the hub mounts as a tab pane, read from the shipped TABS list. */
const PANE_PAGES = [...HUB_JS.matchAll(/page: "([a-z-]+.html)"/g)].map((m) => m[1]);

/* ── the tab row is the owner's list, in the owner's order ── */

/** The ONE list, read from the shipped source.
 *  TOP-LEVEL entries only: a pane carries `key` and `label` too, so a flat scan returns the tabs
 *  and their panes interleaved (this guard's first draft did exactly that and reported
 *  registrations, list, waitlist, divisions… as the tab order). The indentation is the structure. */
function tabs() {
  const m = HUB_JS.match(/const TABS = \[([\s\S]*?)\n  \];/);
  assert.ok(m, "admin-manager.js no longer defines a TABS list — the tab order must have ONE home");
  const found = [...m[1].matchAll(/^ {4}\{ key: "([^"]+)", label: "([^"]+)"/gm)].map((x) => ({ key: x[1], label: x[2] }));
  assert.ok(found.length >= 7, `only ${found.length} top-level tab(s) parsed — the list's shape changed and this reader is now lying`);
  return found;
}

test("the tab row: the owner's seven in his order, with SG-5's Overview first and Announce after Registrations", () => {
  const t = tabs();
  assert.deepEqual(t.map((x) => x.key),
    ["overview", "registrations", "announce", "divisions", "scoring-links", "schedule", "scoring", "live", "bracket"],
    "the owner's seven (item 7, verbatim) keep their relative order; Overview and Announce are §-1o SG-5's additions — the event's own face first, the megaphone beside the guest list (create → target → announce → watch)");
  // A tab with no pane yet must not render as a dead button: the list carries every tab, the
  // renderer filters on what is actually wired. Both halves asserted, or the filter is decoration.
  assert.match(HUB_JS, /\.filter\(\(?t\)? => t\.panes/,
    "the renderer must show only tabs that have panes — an unbuilt tab is absent, never a dead button");
  // H-2 finished the row: every declared tab now has panes, so the filter above hides nothing
  // today. It stays asserted because the NEXT unbuilt tab must be absent rather than dead.
  const built = [...HUB_JS.matchAll(/key:\s*"([^"]+)",\s*label:\s*"[^"]+",\s*panes:/g)].map((x) => x[1]);
  assert.deepEqual(built, t.map((x) => x.key), "every declared tab must be wired now that H-2 has shipped");
});

test("the sub-tabs are the owner's subsections: Waitlist under Registrations, Pools under Divisions", () => {
  const panes = [...HUB_JS.matchAll(/page:\s*"([a-z-]+\.html)"/g)].map((x) => x[1]);
  assert.deepEqual(panes,
    ["admin-event.html", "admin-registrations.html", "admin-waitlists.html", "admin-marketing.html",
     "admin-divisions.html", "admin-pool-board.html", "admin-score-links.html",
     "admin-schedule-editor.html", "tournament.html", "admin-league.html",
     "live.html", "admin-brackets.html"],
    "each pane is an EXISTING page — a tab whose content is a new implementation is the rewrite this design refuses. SG-5's two additions (the event's own page, marketing) are existing pages framed, exactly per the rule");
});

/* ── the tab row is the shared component, not a new one ── */

test("the tab row reuses the shared .tabs/.tab component and adds no new vocabulary", () => {
  assert.match(HUB_HTML, /class="tabs"/, "the hub must use the shared tab row");
  assert.match(HUB_HTML, /role="tablist"/, "the shared component ships with tablist semantics (admin-events.html's idiom)");
  assert.match(ADMIN_CSS, /^\.tab \{/m, "admin.css lost the shared .tab rule the hub depends on");
  // And the hub must not redefine it locally — the shared_buttons.test.mjs rule, same shape.
  const styles = [...HUB_HTML.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  assert.equal(/^\s*\.tabs?\s*[.:{]/m.test(styles), false,
    "the hub redefines the shared tab classes in its own <style> — one definition, or the rows drift");
});

/* ── no reloads: the whole point of item 7 ── */

test("switching tabs never navigates and never rebuilds a frame that already exists", () => {
  assert.equal(/location\.href\s*=/.test(HUB_JS), false,
    "the shell navigates on a tab switch — the owner asked for tabs that do NOT reload");
  assert.match(HUB_JS, /location\.hash/, "the open tab must live in the URL so a tab is linkable");
  assert.match(HUB_JS, /frames\[/, "frames must be cached — a tab revisited should not reload its page");
  assert.match(HUB_JS, /hidden = /, "a kept frame is hidden, not destroyed");
});

test("the hub is per-event and says so honestly when it has no event", () => {
  assert.match(HUB_JS, /params\.get\("event"\)/, "the hub reads its event from the URL (?event=N)");
  assert.match(HUB_JS, /Choose an event|Pick an event|no event/i,
    "with no event the hub must say something a human can act on, not render empty tabs");
});

/* ── the embed contract: one message key, four files, no drift ── */

test("the embed message key is IDENTICAL across both parent/child pairs", () => {
  // The member/external pair predates this unit; the admin pair is new. They cannot share a file
  // (widget.js is served to customer sites) so they share a pinned constant instead.
  const KEY = "bt_widget_height";
  // v0.140.0: the admin CHILD moved from admin-nav.js to config.js. H-2 added a MEMBER-side tab
  // (live.html), which loads site-nav.js and not admin-nav.js — so a child living in the admin
  // shell could never have reached it, and a second copy in site-nav.js would have been a third
  // implementation of one message. config.js is the only script BOTH shells load. The pin follows.
  for (const f of ["assets/schedule.js", "widget.js", "assets/config.js", "assets/admin-manager.js"]) {
    assert.ok(code(f).includes(KEY), `${f} does not speak the shared embed contract (${KEY})`);
  }
  // Both listeners must filter by slug, or two frames on one page fight over each other's height.
  for (const f of ["widget.js", "assets/admin-manager.js"]) {
    assert.match(code(f), /slug/, `${f} listens without filtering by slug — frames will resize each other`);
  }
});

test("EVERY page can go chromeless, from ONE rule set in the stylesheet every page loads", () => {
  // v0.140.0 REWRITE, not a deletion. H-1 put this in admin.css because every tab was an admin
  // page. H-2's Live tab is live.html — a MEMBER page that loads app.css and site-nav.js and has
  // never linked admin.css. Two rule sets for one concept is the defect this repo has paid for
  // twice (D-23, D-24), so the rule moved to app.css, which every page in web/ links, and grew
  // the member rail's selector. The child JS moved to config.js for the same reason.
  const APP_CSS = read("assets/app.css");
  assert.match(CONFIG_JS, /embed/, "config.js never notices ?embed=1, so no page can be a tab");
  assert.match(CONFIG_JS, /scrollHeight/, "the embedded child never reports its height — frames would stay at their default");
  assert.match(APP_CSS, /body\.embed[^{]*\{[^}]*display:\s*none/,
    "app.css has no body.embed rule — every tab would render its own rail and header");
  assert.match(APP_CSS, /body\.embed \.site-nav/,
    "the member rail is not hidden in embed mode — the Live tab would show site-nav inside the frame");
  assert.match(APP_CSS, /body\.embed \.sidebar/,
    "the admin rail is not hidden in embed mode — every admin tab would show the rail twice");
  // ONE rule set: no page and no other stylesheet may carry its own.
  assert.equal(/body\.embed/.test(read("assets/admin.css")), false,
    "admin.css kept a body.embed rule after the move — one definition, or the two drift");
  for (const p of PANE_PAGES) {
    assert.equal(/body.embed/.test(read(p)), false, `${p} carries its own embed rule — that belongs in app.css, once`);
  }
});

/* ── the tab pages still work on their own: the design's reversibility claim ── */

test("the preselect is ADDITIVE — each tab page still works standalone from the rail", () => {
  for (const f of ["assets/admin-registrations.js", "assets/admin-divisions.js", "assets/admin-pool-board.js"]) {
    const src = code(f);
    // Pin the BEHAVIOUR — reads an "event" parameter into the fallback-guarded variable — never
    // the spelling of how URLSearchParams is constructed. The first draft required
    // `params.get("event")` and reddened against `new URLSearchParams(location.search).get(...)`,
    // which is the same trap iteration 65 paid for in print_parity.
    assert.match(src, /get\("event"\)/, `${f} does not read an event id from the URL — the hub cannot point it at an event`);
    assert.match(src, /fromUrl/, `${f} reads ?event= but not into fromUrl — the standalone fallback below has nothing to test`);
    // The standalone path is what makes this reversible: no ?event= must still load the picker.
    assert.match(src, /if \(!?fromUrl|fromUrl \?|fromUrl &&/,
      `${f} must fall back to its own event picker when no ?event= is given (the rail path)`);
  }
});

/* ── H-2: tab visibility by event type ── */

/** The event types the SCHEMA allows. DERIVED, never typed out — and deriving it is what caught
 *  the design's own error: the approved visibility table carried a "tryout" row, and there is no
 *  tryout event type. Tryouts are their own module (admin-tryouts.html), not a kind of event. A
 *  hardcoded list here would have shipped a row nobody could ever reach. */
function schemaTypes() {
  const m = SCHEMA.match(/type TEXT NOT NULL CHECK \(type IN \(([^)]+)\)\)/);
  assert.ok(m, "the events table's type constraint moved — this guard's floor came from it");
  return m[1].split(",").map((x) => x.trim().replace(/'/g, "")).sort();
}

function typeMap() {
  const m = HUB_JS.match(/const TAB_TYPES = \{([\s\S]*?)\n  \};/);
  assert.ok(m, "admin-manager.js no longer declares TAB_TYPES — visibility must have ONE home");
  return m[1];
}

const typeRow = (t) => {
  const r = typeMap().match(new RegExp("^\\s*" + t + ":\\s*\\[([^\\]]*)\\]", "m"));
  assert.ok(r, t + " has no row in TAB_TYPES");
  return [...r[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

test("the visibility map covers exactly the event types the SCHEMA allows — no invented type", () => {
  const mapped = [...typeMap().matchAll(/^\s*([a-z_]+):/gm)].map((x) => x[1]).sort();
  assert.deepEqual(mapped, schemaTypes(),
    "the visibility map and the schema's type list disagree — a type with no row renders nothing, and an invented type is a row nobody reaches");
});

test("a drop-in shows its face, its sign-ups and the megaphone; a competition event shows the lot", () => {
  // SG-1's drop-in types still need no pools, schedule, scoring or bracket. What changed with
  // SG-5: every type gets Overview (the event's own page) and Announce, because a drop-in
  // session IS the events program's common case (Cathy's Tuesdays) — the hub must be her whole
  // screen: the event's face, who is coming, and a way to tell everyone something.
  const dropIn = ["overview", "registrations", "announce"];
  assert.deepEqual(typeRow("training"), dropIn, "a drop-in session: the face, the sign-ups, the megaphone — nothing else");
  assert.deepEqual(typeRow("event"), dropIn, "a drop-in event: the same three");
  assert.deepEqual(typeRow("court_rental"), dropIn, "a facility booking has no pools or scoring either");
  const tabKeys = tabs().map((x) => x.key);
  assert.deepEqual(typeRow("tournament"), tabKeys, "a tournament shows every tab");
  assert.deepEqual(typeRow("league"), tabKeys,
    "a league shows every tab too — hiding Bracket until one exists would delete the only way to generate one (WF-2's rule), and admin-brackets' own empty state is that way in");
});

/* ── SG-5 (§-1o): the hub IS the events management page ── */

test("SG-5 — Overview frames the event's own page; Announce frames marketing; both ride the ONE ?event= contract", () => {
  const overview = HUB_JS.match(/key: "overview",([\s\S]*?)key: "registrations",/);
  assert.ok(overview, "the Overview tab lost its panes, or no longer sits before Registrations");
  assert.match(overview[1], /admin-event\.html/,
    "Overview must frame the event's own page — details, publish/cancel, the share link, SG-2's count line and the message card all live there");
  const announce = HUB_JS.match(/key: "announce",([\s\S]*?)key: "divisions",/);
  assert.ok(announce, "the Announce tab lost its panes, or no longer sits between Registrations and Divisions");
  assert.match(announce[1], /admin-marketing\.html/,
    "Announce must frame marketing — SG-4's segments and the composer already speak ?event= (the W-F hand-off)");
  // The hub's contract is ?event= for every pane (frameFor composes it once). admin-event.js
  // historically read ?id= alone — framed without the alias it says "No event selected."
  // (D-29's class: two spellings of one parameter). Pinned here, beside the tab that needs it.
  const aev = code("assets/admin-event.js");
  assert.match(aev, /qs\.get\("id"\) \|\| qs\.get\("event"\)/,
    "admin-event.js no longer accepts the hub's ?event= — the Overview tab renders 'No event selected.'");
  // NC — the pin can fail: strip the alias from a copy and the regex above must not match it.
  const mutated = aev.split('qs.get("event")').join('qs.get("eventZZ")');
  assert.ok(mutated !== aev, "the mutation did not land — admin-event.js never reads ?event= at all");
  assert.ok(!/qs\.get\("id"\) \|\| qs\.get\("event"\)/.test(mutated),
    "the mutated copy still matches — this pin cannot fail and proves nothing");
});

test("a tab hidden by type is ABSENT, never disabled — and the filter runs at BOTH levels", () => {
  assert.match(HUB_JS, /TAB_TYPES\[/, "the renderer never consults the visibility map");
  assert.equal(/disabled/.test(HUB_JS), false,
    "a tab that does not apply must not be rendered at all — a greyed-out tab is a question the operator cannot answer");
  // Panes are filtered too, or a league would be handed the tournament's pool grid.
  assert.match(HUB_JS, /p\.types/, "panes carry no type filter");
});

test("the league's scoring surface is the League Manager; the tournament's is pool play", () => {
  // Bounded by the NEXT tab's key rather than by a lazy `] }` — a pane's own `types: [...] }`
  // ends in exactly those characters, so the lazy version stopped inside the first pane and
  // reported the League Manager missing from a list that contained it. Ambiguous anchor, again.
  const scoring = HUB_JS.match(/key: "scoring",([\s\S]*?)key: "live",/);
  assert.ok(scoring, "the Scoring Edit tab lost its panes, or no longer sits before the Live tab");
  assert.match(scoring[1], /tournament\.html/, "pool play is the tournament's scoring pane");
  assert.match(scoring[1], /admin-league\.html/, "the League Manager is the league's scoring pane");
  // "a tournament OR league management page" — his words. Each pane names the type it serves.
  assert.match(scoring[1], /types: \["tournament"\]/, "pool play must be scoped to tournaments");
  assert.match(scoring[1], /types: \["league"\]/, "the League Manager must be scoped to leagues");
});

/* ── negative controls — each mutates real input and asserts the mutation landed ── */

test("NC-1: a hub that navigates on tab switch is caught", () => {
  const mutated = HUB_JS.replace(/location\.hash = /, "location.href = ");
  assert.notEqual(mutated, HUB_JS, "the mutation found no hash assignment to break");
  assert.ok(/location\.href\s*=/.test(mutated), "the navigation detector cannot fail");
});

test("NC-2: dropping the body.embed rule from the shared stylesheet is caught", () => {
  // Rewritten in v0.140.0 to follow the rule set from admin.css to app.css. Left pointed at
  // admin.css it would have gone green for the emptiest possible reason — there is nothing there
  // to strip any more — which is the vacuous-control failure this repo keeps auditing for.
  const APP_CSS = read("assets/app.css");
  const stripped = APP_CSS.replace(/body\.embed[^}]*\}/g, "");
  assert.notEqual(stripped, APP_CSS, "the strip control found no body.embed rule to remove");
  assert.equal(/body\.embed[^{]*\{[^}]*display:\s*none/.test(stripped), false, "the chromeless detector cannot fail");
});

test("NC-3: a tab pointing at a page that does not exist is caught", () => {
  const pages = [...HUB_JS.matchAll(/page:\s*"([a-z-]+\.html)"/g)].map((x) => x[1]);
  assert.ok(pages.length >= 4, "the pane scan found nothing to check");
  for (const p of pages) assert.doesNotThrow(() => read(p), `${p} is referenced as a tab but does not exist`);
  assert.throws(() => read("admin-does-not-exist.html"), "the existence check cannot fail");
});

test("NC-4: the comment stripper works and does not eat code", () => {
  assert.ok(code("assets/admin-manager.js").includes("TABS"), "stripping removed real code from admin-manager.js");
  assert.equal(blankComments("// const TABS = []").includes("const TABS"), false, "a commented declaration must not count");
});
