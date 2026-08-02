/**
 * Boomtown Platform — static-rail guard
 * File: worker/test/rail_static.test.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.47.0
 *
 * v0.47.0 inlined the admin rail into every admin page's static HTML (uiux-review §3A) so the
 * rail paints with the page instead of popping in after admin-nav.js runs. That creates the exact
 * hazard standards §6 failure-class 3 names: N copies of the same markup that can drift apart,
 * where any single-page check reports clean. This guard scans the WIDEST set and holds three
 * invariants:
 *
 *   1. IDENTITY — every admin page that loads admin-nav.js carries exactly ONE
 *      `<aside class="sidebar" data-static="rail">…</aside>` block, and all blocks are
 *      byte-identical across pages (whitespace differences are drift too).
 *   2. PARITY — the static rail's link set equals the NAV array inside admin-nav.js
 *      (both directions: every NAV href appears in the rail, every rail href traces back to
 *      NAV, the sandbox trio, or the buildstatus item). One source of truth, two renderings.
 *   3. SELF-COUNT — the corpus is ≥ 26 pages (the v0.47.0 set: 18 admin-layout pages + the 8
 *      former admin-shell pages). A shrinking corpus fails loud (the brand.test.mjs precedent).
 *
 * Negative controls prove each check can fail: a mutated page breaks identity; an extra NAV
 * item breaks parity; an empty corpus cannot pass (NC-3, the asset_versions precedent).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB_DIR = new URL("../../web/", import.meta.url);
const NAV_SRC = readFileSync(new URL("assets/admin-nav.js", WEB_DIR), "utf8");

/* ── pure helpers — real corpus and every NC go through these ── */

const RAIL_RE = /<aside class="sidebar" data-static="rail"[\s\S]*?<\/aside>/g;

/** Collect { file → railBlock } for every page that loads admin-nav.js. */
function collectRails(dirUrl) {
  const out = new Map();
  for (const f of readdirSync(dirUrl)) {
    if (!f.endsWith(".html")) continue;
    const s = readFileSync(new URL(f, dirUrl), "utf8");
    if (!s.includes("admin-nav.js")) continue;
    const blocks = s.match(RAIL_RE) || [];
    out.set(f, blocks);
  }
  return out;
}

/** Hrefs from an html/js fragment's nav items. */
const railHrefs = (block) => [...block.matchAll(/class="nav-item" href="([^"]+)"/g)].map((m) => m[1]);

/** Hrefs from the NAV array literal in admin-nav.js source. */
function navHrefs(src) {
  const m = src.match(/const NAV = \[[\s\S]*?\n  \];/);
  if (!m) return null;
  return [...m[0].matchAll(/href: "([^"]+)"/g)].map((x) => x[1]);
}

/** Verdict object so NCs can assert failure without try/catch gymnastics. */
function audit(rails, navList) {
  const files = [...rails.keys()];
  const missing = files.filter((f) => (rails.get(f) || []).length !== 1);
  const blocks = files.filter((f) => (rails.get(f) || []).length === 1).map((f) => rails.get(f)[0]);
  const identical = blocks.length > 0 && blocks.every((b) => b === blocks[0]);
  const staticHrefs = blocks.length ? new Set(railHrefs(blocks[0])) : new Set();
  const EXTRA_OK = new Set(["#", "admin-buildstatus.html"]); // sandbox trio + buildstatus live outside NAV
  const navMissing = (navList || []).filter((h) => !staticHrefs.has(h));
  const staticStray = [...staticHrefs].filter((h) => !(navList || []).includes(h) && !EXTRA_OK.has(h));
  return { count: files.length, missing, identical, navMissing, staticStray };
}

/* ── the real corpus ── */

test("every admin page ships exactly one static rail, byte-identical across pages", () => {
  const v = audit(collectRails(WEB_DIR), navHrefs(NAV_SRC));
  assert.deepEqual(v.missing, [], `pages without exactly one static rail: ${v.missing.join(", ")}`);
  assert.ok(v.identical, "static rail blocks have drifted apart between pages");
});

test("static rail ⇄ admin-nav.js NAV parity, both directions", () => {
  const nav = navHrefs(NAV_SRC);
  assert.ok(nav && nav.length >= 25, `NAV extraction failed or shrank (saw ${nav && nav.length})`);
  const v = audit(collectRails(WEB_DIR), nav);
  assert.deepEqual(v.navMissing, [], `NAV items absent from the static rail: ${v.navMissing.join(", ")}`);
  assert.deepEqual(v.staticStray, [], `static rail items with no NAV source: ${v.staticStray.join(", ")}`);
});

test("self-count: the corpus is the v0.47.0 set (≥26 admin pages)", () => {
  const v = audit(collectRails(WEB_DIR), navHrefs(NAV_SRC));
  assert.ok(v.count >= 26, `expected ≥26 admin pages in the corpus, saw ${v.count} — a shrinking corpus is its own finding`);
});

test("admin-nav.js carries the static-detect branch (fallback stays fallback)", () => {
  assert.ok(NAV_SRC.includes('.sidebar[data-static="rail"]'),
    "admin-nav.js lost the static-rail detection — every page would double-build the rail");
});

/* ── negative controls ── */

test("NC-1: a single mutated page breaks the identity check", () => {
  const rails = collectRails(WEB_DIR);
  const first = [...rails.keys()][0];
  const mutated = new Map(rails);
  mutated.set(first, [rails.get(first)[0].replace('class="nav-item"', 'class="nav-item drifted"')]);
  const v = audit(mutated, navHrefs(NAV_SRC));
  assert.equal(v.identical, false, "identity check failed to notice a mutated page");
});

test("NC-2: an extra NAV item breaks parity", () => {
  const v = audit(collectRails(WEB_DIR), [...navHrefs(NAV_SRC), "admin-phantom.html"]);
  assert.ok(v.navMissing.includes("admin-phantom.html"), "parity check failed to notice a phantom NAV item");
});

test("NC-3: an empty corpus cannot pass", () => {
  const v = audit(new Map(), navHrefs(NAV_SRC));
  assert.equal(v.identical, false, "an empty corpus must never satisfy the identity check");
  assert.ok(v.count < 26, "an empty corpus must fail the self-count");
});
