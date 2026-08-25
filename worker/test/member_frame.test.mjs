/**
 * Boomtown Platform — §-1g C-2: the member Play frame (the no-reload module frame, member half)
 * File: worker/test/member_frame.test.mjs · Version: v1.0 · Date: 2026-08-25 · Ships in: v0.202.0
 *
 * The owner, 2026-08-08 (§-1g, verbatim): "when doing the horizontal buttons that becomes a frame
 * itself where it does not reload and acts as a tab with the vertical menu on the side, reducing
 * the options on the left menu and keep items together that are only applicable to certain
 * modules." The admin half of that sentence shipped in v0.139.0/v0.140.0 as the manager hub;
 * this file guards the member half: play.html frames the five Play-group surfaces as tabs.
 *
 * THE DESIGN DECISION THIS FILE PROTECTS is the hub's, reused rather than reinvented (N-4's own
 * rule: "Reuse an existing tab idiom if one exists; inventing a second one is the defect"):
 * a tab's content is the EXISTING page in a same-origin chromeless iframe, created on first
 * visit and KEPT — hidden, never destroyed. That is the "does not reload", literally. The embed
 * plumbing was already universal before this unit: config.js posts bt_widget_height for any page
 * given ?embed=1, app.css hides the chrome, site-nav.js skips itself. This unit is a PARENT and
 * a rail edit; it ships no new mechanism.
 *
 * THE RAIL HALF: the signed-in Play group collapses from five <a href> items to ONE (play.html).
 * That is "reducing the options on the left menu", his words. The five pages stay live and
 * standalone (deep links, cross-page links, the widget) — the guard asserts the frame's PANES
 * are the sanctioned exit before the rail routes go (the forbid-guards-need-an-exit lesson).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");
const code = (rel) => blankComments(read(rel));

const FRAME_HTML = read("play.html");
const FRAME_JS = code("assets/play.js");
const NAV_JS = code("assets/site-nav.js");

/* ── the pane list: the Play group's five surfaces, in the rail's order ── */

/** The ONE list, read from the shipped source (manager_hub's tabs() idiom, one level only). */
function panes() {
  const m = FRAME_JS.match(/const PANES = \[([\s\S]*?)\n  \];/);
  assert.ok(m, "play.js no longer defines a PANES list — the tab order must have ONE home");
  // \s+ between fields, never a literal space count: the source column-aligns the list, and an
  // indentation-level pin is the exact D-17b trap (a marker that accuses the next correct change).
  const found = [...m[1].matchAll(/\{ key: "([^"]+)",\s+label: "([^"]+)",\s+page: "([^"]+)"/g)]
    .map((x) => ({ key: x[1], label: x[2], page: x[3] }));
  assert.ok(found.length >= 5, `only ${found.length} pane(s) parsed — the list's shape changed and this reader is now lying`);
  return found;
}

test("the tab row is the Play group's five surfaces, in the rail's order, with the rail's names", () => {
  assert.deepEqual(panes().map((p) => [p.label, p.page]), [
    ["Event Schedule", "schedule.html"],
    ["Leagues", "leagues.html"],
    ["Live scores", "live.html"],
    ["Community Play", "lfg.html"],
    ["Sub-Finder", "subs.html"],
  ], "the frame's tabs are the rail items they replaced — same five, same order, same names, so nothing a member knew how to find is renamed or lost");
});

test("every pane is an EXISTING page — a tab whose content is a new implementation is the rewrite this design refuses", () => {
  for (const p of panes()) assert.doesNotThrow(() => read(p.page), `${p.page} is framed as a tab but does not exist`);
});

/* ── no reloads: the whole point of C-2 ── */

test("switching tabs never navigates and never rebuilds a frame that already exists", () => {
  assert.equal(/location\.href\s*=/.test(FRAME_JS), false,
    "the frame navigates on a tab switch — the owner asked for tabs that do NOT reload");
  assert.match(FRAME_JS, /location\.hash/, "the open tab must live in the URL so a tab is linkable");
  assert.match(FRAME_JS, /frames\[/, "frames must be cached — a tab revisited should not reload its page");
  assert.match(FRAME_JS, /hidden = /, "a kept frame is hidden, not destroyed");
});

test("the frame speaks the ONE embed contract: ?embed=1 to the child, bt_widget_height back, filtered by slug", () => {
  // manager_hub.test.mjs pins the key across the two existing parent/child pairs; this parent is
  // the third speaker of the SAME key — one judgement, and the child half (config.js) is shared.
  assert.match(FRAME_JS, /embed=1/, "panes are not framed chromeless — every tab would show its own header and rail");
  assert.ok(FRAME_JS.includes("bt_widget_height"), "play.js does not speak the shared embed contract (bt_widget_height)");
  assert.match(FRAME_JS, /slug/, "play.js listens without filtering by slug — frames would resize each other");
});

/* ── the rail half: five items became one, and the exit exists ── */

test("the signed-in Play group is exactly ONE item, and it is the frame", () => {
  const m = NAV_JS.match(/NAV\.push\(\{ label: "Play", items: \[([\s\S]*?)\]\}\);/);
  assert.ok(m, "site-nav.js no longer pushes a signed-in Play group");
  const items = [...m[1].matchAll(/href: "([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(items, ["play.html"],
    'owner 2026-08-08: "reducing the options on the left menu and keep items together that are only applicable to certain modules" — the Play group is the frame, once');
});

test("the five module pages left the SIGNED-IN rail, and the frame's PANES are their sanctioned exit", () => {
  // A forbidding guard can delete the last way out — so the exit is asserted in the SAME test
  // that enforces the removal. The five stay reachable: standalone URLs still work (deep links,
  // cross-page links, the widget), and the rail's route to them is the frame.
  // Scoped to the signed-in branch: the signed-out rail keeps the direct items by design (the
  // frame is proven on the member rail first — v2.26's header says so).
  const m = NAV_JS.match(/if \(signedIn\) \{([\s\S]*?)\} else \{/);
  assert.ok(m, "site-nav.js no longer forks the rail on signedIn — this guard's region anchor moved");
  const signedIn = m[1];
  const framed = panes().map((p) => p.page);
  for (const page of ["schedule.html", "leagues.html", "live.html", "lfg.html", "subs.html"]) {
    assert.equal(new RegExp(`href: "${page}"`).test(signedIn), false,
      `${page} is still a signed-in rail item — the Play group did not collapse`);
    assert.ok(framed.includes(page), `${page} left the rail with NO route back — it must be one of the frame's panes`);
  }
});

test("a deep link to a framed page still lights the Play rail item", () => {
  // The rail's active state matches href === here, and the five pages' hrefs are gone from the
  // rail — so a member on schedule.html directly would see no location at all. site-nav.js keeps
  // a PLAY_PAGES map for exactly this: on those pages, play.html is the active item.
  assert.match(NAV_JS, /PLAY_PAGES/, "site-nav.js lost the PLAY_PAGES active-state map — deep links to framed pages show no rail location");
  for (const page of ["schedule.html", "leagues.html", "live.html", "lfg.html", "subs.html"]) {
    assert.ok(NAV_JS.match(new RegExp(`PLAY_PAGES = \\[[^\\]]*"${page}"`)), `${page} is missing from PLAY_PAGES`);
  }
});

/* ── the page is a real member page, not a lookalike ── */

test("play.html ships the member shell: site-nav + config, and registers in build-status", () => {
  assert.match(FRAME_HTML, /assets\/site-nav\.js/, "play.html does not load site-nav.js — no rail, no header wiring");
  assert.match(FRAME_HTML, /assets\/config\.js/, "play.html does not load config.js — no theme service, no embed child for its own panes");
  assert.match(code("assets/build-status.js"), /"play\.html"/, "play.html is not registered in build-status.js (the house rule for every new page)");
});

test("the frame page carries no hardcoded pane markup — the PANES list is the one home", () => {
  // The list lives in play.js; the page ships only the containers. A second copy of the pane
  // list in markup is how the two drift (the BT_CAL/one-judgement rule, applied to structure).
  assert.equal(/schedule\.html|leagues\.html|live\.html|lfg\.html|subs\.html/.test(FRAME_HTML), false,
    "play.html names a pane page in its markup (comments count — a comment naming one is how a second list starts); the PANES list in play.js is the only home");
});

/* ── negative controls — each mutates real input and asserts the mutation landed ── */

test("NC-1: a frame that navigates on tab switch is caught", () => {
  const mutated = FRAME_JS.replace(/location\.hash = /, "location.href = ");
  assert.notEqual(mutated, FRAME_JS, "the mutation found no hash assignment to break");
  assert.ok(/location\.href\s*=/.test(mutated), "the navigation detector cannot fail");
});

test("NC-2: re-adding a module page to the signed-in rail is caught", () => {
  // The detector is region-scoped (the signed-out rail keeps direct items by design), so the NC
  // must assert inside the SAME region — a whole-file match would pass on the signed-out branch
  // and prove nothing (the vacuous-control class).
  const mutated = NAV_JS.replace('href: "play.html"',
    'href: "play.html" }, { href: "schedule.html"');
  assert.notEqual(mutated, NAV_JS, "the mutation did not land — the rail no longer carries play.html");
  const region = mutated.match(/if \(signedIn\) \{([\s\S]*?)\} else \{/);
  assert.ok(region, "the mutated copy lost the signedIn fork — the region anchor is broken");
  assert.ok(/href: "schedule\.html"/.test(region[1]), "the collapse detector cannot fail");
});

test("NC-3: a pane pointing at a page that does not exist is caught", () => {
  assert.throws(() => read("does-not-exist.html"), "the existence check cannot fail");
});

test("NC-4: the comment stripper works and does not eat code", () => {
  assert.ok(FRAME_JS.includes("PANES"), "stripping removed real code from play.js");
  assert.equal(blankComments("// const PANES = []").includes("const PANES"), false, "a commented declaration must not count");
});
