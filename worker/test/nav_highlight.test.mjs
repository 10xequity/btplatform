/* Boomtown Platform — rail highlighting guard
   File: worker/test/nav_highlight.test.mjs · Version: v1.2 · Date: 2026-08-26 · Ships in: v0.204.0

   v1.2 (§-1d N-4 fold): the two hash-carrying management entries folded into ONE hash-less
   "Event Management" (admin-manage.html), and the eight collapsed tools' PARENT re-pointed at it.
   The full-href machinery below is unchanged and still correct; the hash-parent NC INVERTED (the
   hash-less parent now matches; a stale hashed parent would go dark). See that test.

   WHY THIS EXISTS. Owner report, 2026-08-03: "the buttons in tournaments are not correctly
   highlighted." The cause was that `admin-event.html` — the page where a tournament is actually
   built — is not a nav destination, so the exact-match marking found nothing and the entire rail
   sat dark. Nothing was broken enough to fail a test: the page loaded, the rail rendered, every
   link worked. It just never answered "where am I."

   `admin-consent.html` had the same hole and nobody had reported it yet, which is the point — the
   defect is invisible until someone happens to be looking at that one page.

   The subject is `rail.partial.html`, not the NAV array, because the static rail is what actually
   ships into pages and what `markActive()` queries at runtime. Guarding the array instead would be
   guarding the blueprint rather than the building.

   v1.1 (RF-4, v0.184.0): the eight event-scoped tools (Tournament Ops, League Manager, Schedule
   Editor, Brackets, Divisions, Pool Board, Court Board, Scoring Links) collapse OFF the rail behind
   the two management pickers, so each now depends on a PARENT entry to highlight anything at all.
   Those parents carry HASHES — `admin-manage.html#tournaments` / `#leagues` — and that exposed a
   hole in this guard: `markActive()` resolves a parent with a FULL-STRING href match
   (`items.find(a => a.getAttribute("href") === PARENT[here])`), but the old extractor and RAIL_HREFS
   both stripped the hash, so a parent that kept the page and dropped the hash
   (`admin-manage.html`, which is in no rail entry) would pass this check while going dark at
   runtime. The extractor now reads hash-carrying values and the parent match is verified against
   the WHOLE href (RAIL_HREFS_FULL), the way the runtime does it — with a positive control that the
   extractor actually sees a hash-carrying parent, and an NC that a hash-dropped parent reddens. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "../testkit/route-extract.mjs";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const NAVJS = blankComments(readFileSync(join(ROOT, "web/assets/admin-nav.js"), "utf8")); // D-45
const RAIL = readFileSync(join(ROOT, "web/assets/rail.partial.html"), "utf8");

/** Every href the static rail can highlight, page part only (hash discarded). This is the set the
    exact-match pass uses — `here` is a bare filename. */
const RAIL_HREFS = new Set(
  [...RAIL.matchAll(/href="([a-z0-9.-]+\.html)(?:#[a-z-]+)?"/g)].map((m) => m[1])
);

/** The SAME rail hrefs but WHOLE — hash included — the way `markActive()` compares a PARENT value:
    `items.find(a => a.getAttribute("href") === PARENT[here])` is a full-string match. A parent that
    keeps the page but drops the hash (`admin-manage.html` for a tool whose real section is
    `admin-manage.html#tournaments`) matches no rail item at runtime and the rail sits dark, yet a
    page-part check waves it through. The collapsed event tools (RF-4) made that reachable, so the
    parent match below is verified against this set, not RAIL_HREFS. */
const RAIL_HREFS_FULL = new Set(
  [...RAIL.matchAll(/href="([a-z0-9.-]+\.html(?:#[a-z-]+)?)"/g)].map((m) => m[1])
);

/** The PARENT map as it is actually written in the shipped source. */
function parentMap() {
  const block = NAVJS.match(/const PARENT = \{([\s\S]*?)\};/);
  if (!block) return null;
  const out = {};
  // The VALUE may carry a hash (admin-manage.html#tournaments) — the key never does (a page is one
  // file). Reading the whole value is what lets the full-href match below mirror the runtime.
  for (const m of block[1].matchAll(/"([a-z0-9.-]+\.html)"\s*:\s*"([a-z0-9.-]+\.html(?:#[a-z-]+)?)"/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

/** Pages that ship the static rail — the widest set this defect can occur in. */
function railPages() {
  return readdirSync(join(ROOT, "web"))
    .filter((f) => f.endsWith(".html"))
    .filter((f) => readFileSync(join(ROOT, "web", f), "utf8").includes('data-static="rail"'));
}

const PAGES = railPages();
const PARENT = parentMap();

test("the guard is actually scanning something", () => {
  assert.ok(PAGES.length >= 30, `expected the rail-bearing page set, found ${PAGES.length}`);
  assert.ok(RAIL_HREFS.size >= 20, `expected the rail's links, found ${RAIL_HREFS.size}`);
  assert.ok(PARENT, "admin-nav.js no longer defines a PARENT map — detail pages will go dark again");
});

test("every page that ships the rail highlights something in it", () => {
  const dark = [];
  for (const page of PAGES) {
    if (RAIL_HREFS.has(page)) continue;              // exact match: the normal case
    const up = PARENT[page];
    if (up && RAIL_HREFS_FULL.has(up)) continue;     // detail page: falls back to its section (full-href, runtime semantics)
    dark.push(page);
  }
  assert.deepEqual(dark, [],
    "these pages leave the whole rail dark — add a rail entry, or a PARENT entry pointing at their section");
});

test("no PARENT points at a page the rail does not contain", () => {
  // A parent aimed at a page that is not in the rail fails silently and looks exactly like no
  // parent at all — the failure mode this whole file exists to prevent.
  const broken = Object.entries(PARENT).filter(([, up]) => !RAIL_HREFS_FULL.has(up));
  assert.deepEqual(broken, []);
});

test("no PARENT is defined for a page that is already in the rail", () => {
  // Harmless at runtime (the exact match wins) but it means someone misunderstood the mechanism,
  // and the next person will copy the misunderstanding.
  const pointless = Object.keys(PARENT).filter((p) => RAIL_HREFS.has(p));
  assert.deepEqual(pointless, []);
});

test("the fallback only runs when nothing matched", () => {
  // Assert the shape of the real code: the parent is applied AFTER the exact pass, guarded by a
  // hit flag. A fallback that ran unconditionally would light two items on every section page.
  assert.match(NAVJS, /if \(hit \|\| !PARENT\[here\]\) return;/,
    "the parent fallback must be skipped when an exact match already lit up");
  assert.match(NAVJS, /markActive\(\);/, "and the marker must actually be called");
});

test("NC: the scanner can fail — a page with no rail entry and no parent is caught", () => {
  // Mutate the real inputs: pretend admin-event.html lost its PARENT entry.
  const withoutParent = { ...PARENT };
  delete withoutParent["admin-event.html"];
  const dark = PAGES.filter((p) => {
    if (RAIL_HREFS.has(p)) return false;
    const up = withoutParent[p];
    return !(up && RAIL_HREFS_FULL.has(up));
  });
  assert.deepEqual(dark, ["admin-event.html"],
    "removing the parent must make the check fail — otherwise it proves nothing");
});

/* ── RF-4 (v0.184.0): the eight event-scoped tools are collapsed OFF the rail ──
   The owner's word (2026-08-23): the event tools — the Schedule Editor named explicitly — come off
   the menu and are reached through the two management pickers (Tournament/League Management → the
   event hub). Each collapsed page must (a) be gone from the rail as a destination and (b) carry a
   PARENT so its own page still highlights the section it belongs to. This pins the collapse: a
   future rail edit that re-adds one, or a PARENT that drops its hash, reddens here. */
const COLLAPSED = [
  "tournament.html", "admin-league.html", "admin-schedule-editor.html", "admin-brackets.html",
  "admin-divisions.html", "admin-pool-board.html", "admin-kotc.html", "admin-score-links.html",
];

test("RF-4: the collapsed event tools are off the rail but still highlight a section", () => {
  for (const page of COLLAPSED) {
    assert.ok(!RAIL_HREFS.has(page),
      `${page} was collapsed behind the management pickers — it must not be a rail destination`);
    const up = PARENT[page];
    assert.ok(up && RAIL_HREFS_FULL.has(up),
      `${page} is collapsed but has no working PARENT (${up || "none"}) — its page will highlight nothing`);
  }
});

test("full-href match, runtime semantics: the collapsed tools' PARENT matches the single entry, and the OLD hash would not", () => {
  // v1.2 (§-1d N-4 fold, v0.204.0): the two hash-carrying management entries folded into ONE
  // hash-less "admin-manage.html", and the eight tools' PARENT re-pointed at it. So the runtime
  // semantics INVERT from v1.1: the hash-LESS parent is now the one that matches, and the OLD
  // hashed value (admin-manage.html#tournaments) matches nothing — the split entry it named is gone.
  // The full-href machinery still earns its keep: markActive() compares whole strings, so this
  // proves the fold's parents resolve and a stale hashed parent would go dark.
  const toolParent = PARENT["tournament.html"];
  assert.equal(toolParent, "admin-manage.html",
    "the collapsed tools no longer parent to the single Event Management entry — the fold's remap did not land");
  assert.ok(RAIL_HREFS_FULL.has("admin-manage.html"),
    "the single hash-less Event Management entry is not a full rail href — the tools' highlight depends on it");
  assert.ok(!RAIL_HREFS_FULL.has("admin-manage.html#tournaments"),
    "the OLD split entry is still a rail href — the fold did not remove it, so this NC proves nothing");
  // And no PARENT keeps a stale hash after the fold — a leftover #tournaments parent would go dark.
  const stillHashed = Object.entries(PARENT).filter(([, up]) => up.includes("#"));
  assert.deepEqual(stillHashed, [],
    "a PARENT still carries a hash after the fold — it points at a split entry that no longer exists");
});
