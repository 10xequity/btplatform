/**
 * Boomtown Platform — §-0 B27 / §-1p WF-5 H-1: the per-event manager hub, shell + first two tabs
 * File: worker/test/manager_hub.test.mjs · Version: v1.0 · Date: 2026-08-12 · Ships in: v0.139.0
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
 * pair (schedule.js posts, widget.js listens) and the admin pair (admin-nav.js posts, the hub
 * listens). **What keeps them from drifting is a test, not a file:** the message key is asserted
 * identical across all four, below. One judgement, pinned in the only place that can hold it.
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

test("all seven tabs are declared in the owner's order, and only the built ones render", () => {
  const t = tabs();
  assert.deepEqual(t.map((x) => x.key),
    ["registrations", "divisions", "scoring-links", "schedule", "scoring", "live", "bracket"],
    "the tab order is the owner's item 7, verbatim — declaring all seven now fixes the order before H-2 fills them in");
  // A tab with no pane yet must not render as a dead button: the list carries every tab, the
  // renderer filters on what is actually wired. Both halves asserted, or the filter is decoration.
  assert.match(HUB_JS, /\.filter\(\(?t\)? => t\.panes/,
    "the renderer must show only tabs that have panes — an unbuilt tab is absent, never a dead button");
  const built = [...HUB_JS.matchAll(/key:\s*"([^"]+)",\s*label:\s*"[^"]+",\s*panes:/g)].map((x) => x[1]);
  assert.deepEqual(built, ["registrations", "divisions"], "H-1 ships exactly two tabs: Registrations and Divisions & Pools");
});

test("the sub-tabs are the owner's subsections: Waitlist under Registrations, Pools under Divisions", () => {
  const panes = [...HUB_JS.matchAll(/page:\s*"([a-z-]+\.html)"/g)].map((x) => x[1]);
  assert.deepEqual(panes,
    ["admin-registrations.html", "admin-waitlists.html", "admin-divisions.html", "admin-pool-board.html"],
    "each pane is an EXISTING page — a tab whose content is a new implementation is the rewrite this design refuses");
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
  for (const f of ["assets/schedule.js", "widget.js", "assets/admin-nav.js", "assets/admin-manager.js"]) {
    assert.ok(code(f).includes(KEY), `${f} does not speak the shared embed contract (${KEY})`);
  }
  // Both listeners must filter by slug, or two frames on one page fight over each other's height.
  for (const f of ["widget.js", "assets/admin-manager.js"]) {
    assert.match(code(f), /slug/, `${f} listens without filtering by slug — frames will resize each other`);
  }
});

test("every admin page can go chromeless, from ONE rule set, because the rail is static markup", () => {
  assert.match(NAV_JS, /embed/, "admin-nav.js never notices ?embed=1, so no admin page can be a tab");
  assert.match(NAV_JS, /scrollHeight/, "the embedded child never reports its height — frames would stay at their default");
  assert.match(ADMIN_CSS, /body\.embed[^{]*\{[^}]*display:\s*none/,
    "admin.css has no body.embed rule — the rail and header would render inside every tab");
  // ONE rule set: the pages themselves must not carry their own embed CSS.
  for (const p of ["admin-registrations.html", "admin-waitlists.html", "admin-divisions.html", "admin-pool-board.html"]) {
    assert.equal(/body\.embed/.test(read(p)), false, `${p} carries its own embed rule — that belongs in admin.css, once`);
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

/* ── negative controls — each mutates real input and asserts the mutation landed ── */

test("NC-1: a hub that navigates on tab switch is caught", () => {
  const mutated = HUB_JS.replace(/location\.hash = /, "location.href = ");
  assert.notEqual(mutated, HUB_JS, "the mutation found no hash assignment to break");
  assert.ok(/location\.href\s*=/.test(mutated), "the navigation detector cannot fail");
});

test("NC-2: dropping the body.embed rule from admin.css is caught", () => {
  const stripped = ADMIN_CSS.replace(/body\.embed[^}]*\}/g, "");
  assert.notEqual(stripped, ADMIN_CSS, "the strip control found no body.embed rule to remove");
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
