/* Boomtown Platform — rail highlighting guard
   File: worker/test/nav_highlight.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.67.0

   WHY THIS EXISTS. Owner report, 2026-08-03: "the buttons in tournaments are not correctly
   highlighted." The cause was that `admin-event.html` — the page where a tournament is actually
   built — is not a nav destination, so the exact-match marking found nothing and the entire rail
   sat dark. Nothing was broken enough to fail a test: the page loaded, the rail rendered, every
   link worked. It just never answered "where am I."

   `admin-consent.html` had the same hole and nobody had reported it yet, which is the point — the
   defect is invisible until someone happens to be looking at that one page.

   The subject is `rail.partial.html`, not the NAV array, because the static rail is what actually
   ships into pages and what `markActive()` queries at runtime. Guarding the array instead would be
   guarding the blueprint rather than the building. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const NAVJS = readFileSync(join(ROOT, "web/assets/admin-nav.js"), "utf8");
const RAIL = readFileSync(join(ROOT, "web/assets/rail.partial.html"), "utf8");

/** Every href the static rail can highlight, page part only. */
const RAIL_HREFS = new Set(
  [...RAIL.matchAll(/href="([a-z0-9.-]+\.html)(?:#[a-z-]+)?"/g)].map((m) => m[1])
);

/** The PARENT map as it is actually written in the shipped source. */
function parentMap() {
  const block = NAVJS.match(/const PARENT = \{([\s\S]*?)\};/);
  if (!block) return null;
  const out = {};
  for (const m of block[1].matchAll(/"([a-z0-9.-]+\.html)"\s*:\s*"([a-z0-9.-]+\.html)"/g)) {
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
    if (up && RAIL_HREFS.has(up)) continue;          // detail page: falls back to its section
    dark.push(page);
  }
  assert.deepEqual(dark, [],
    "these pages leave the whole rail dark — add a rail entry, or a PARENT entry pointing at their section");
});

test("no PARENT points at a page the rail does not contain", () => {
  // A parent aimed at a page that is not in the rail fails silently and looks exactly like no
  // parent at all — the failure mode this whole file exists to prevent.
  const broken = Object.entries(PARENT).filter(([, up]) => !RAIL_HREFS.has(up));
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
    return !(up && RAIL_HREFS.has(up));
  });
  assert.deepEqual(dark, ["admin-event.html"],
    "removing the parent must make the check fail — otherwise it proves nothing");
});
