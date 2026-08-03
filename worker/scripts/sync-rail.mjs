/**
 * Boomtown Platform — static rail sync
 * File: worker/scripts/sync-rail.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.59.0
 *
 * WHY THIS EXISTS
 * The admin rail ships as STATIC markup on every admin page (admin-nav v2.16), which is the right
 * call — it paints with the page instead of popping in after JavaScript runs. The cost was that
 * adding one menu item meant editing 27 files by hand, and that cost was blocking real work: three
 * shipped, tested APIs (M22 custom fields v0.57.0, passes and staff pay v0.58.0) had no admin
 * screen, because giving them one meant paying the 27-page tax first.
 *
 * It was assumed this needed the SPA shell to fix. It did not. Measured 2026-08-03: the rail is
 * BYTE-IDENTICAL across all 27 pages — one variant, zero drift — so the problem was never
 * editorial judgement, only mechanical repetition. A generator removes it in a morning; the SPA
 * shell is still worth doing, but for content-only navigation, not for this.
 *
 * THE SOURCE OF TRUTH is `web/assets/rail.partial.html`, extracted verbatim from admin.html at
 * v0.59.0 and verified byte-identical against all 27 pages at extraction time.
 *
 * IT IS NOT THE ONLY GUARD, DELIBERATELY. `rail_static.test.mjs` independently asserts (a) every
 * admin page carries exactly one rail, (b) all rails are byte-identical, and (c) every rail item
 * traces to the NAV array in admin-nav.js and vice versa. So a partial that drifts from NAV still
 * fails the suite. This script makes the sweep cheap; the existing guard makes it correct. Two
 * mechanisms, because a generator that is also its own only check can write the same mistake to
 * 27 files and call it consistency.
 *
 * CONTRACT
 *   node worker/scripts/sync-rail.mjs            → --check (default). Report drift, write nothing.
 *   node worker/scripts/sync-rail.mjs --write     → write the partial into every admin page.
 *
 *   exit 0  every page already matches the partial (check), or the write succeeded
 *   exit 1  drift found (check), or a page could not be updated (write)
 *   exit 2  the partial or the page set is missing — refuses rather than guessing
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");
const WEB = join(REPO, "web");
export const PARTIAL = join(WEB, "assets", "rail.partial.html");

/** Matches the whole static rail block including its leading indent and trailing newline. */
export const RAIL_RE = /[ \t]*<aside class="sidebar" data-static="rail"[\s\S]*?<\/aside>\r?\n/;

/**
 * Every page that carries a static rail. Discovered, never hardcoded — a hardcoded list is how a
 * new admin page silently misses the sweep and drifts (failure class 3).
 * @returns {string[]} filenames
 */
export function railPages(webDir = WEB) {
  return readdirSync(webDir)
    .filter((f) => f.endsWith(".html"))
    .filter((f) => RAIL_RE.test(readFileSync(join(webDir, f), "utf8")));
}

/**
 * Pure: what a sync would do to one file.
 * @returns {{matches:boolean, next:string|null}} next is null when there is nothing to change
 */
export function applyRail(html, partial) {
  const m = html.match(RAIL_RE);
  if (!m) return { matches: false, next: null };
  if (m[0] === partial) return { matches: true, next: null };
  return { matches: false, next: html.replace(RAIL_RE, () => partial) };
}

function main() {
  const write = process.argv.includes("--write");

  if (!existsSync(PARTIAL)) {
    console.error(`sync-rail: missing ${PARTIAL} — refusing to guess what the rail should be.`);
    process.exitCode = 2; return;
  }
  const partial = readFileSync(PARTIAL, "utf8");

  const pages = railPages();
  // A shrinking corpus is its own finding: if the discovery ever returns almost nothing, the
  // sweep would "succeed" having touched two files. Fail closed instead.
  if (pages.length < 20) {
    console.error(`sync-rail: only ${pages.length} pages carry a static rail — expected 20+. Refusing to sweep a corpus this small.`);
    process.exitCode = 2; return;
  }

  const drifted = [];
  for (const f of pages) {
    const path = join(WEB, f);
    const html = readFileSync(path, "utf8");
    const r = applyRail(html, partial);
    if (r.matches) continue;
    drifted.push(f);
    if (write && r.next) writeFileSync(path, r.next);
  }

  console.log(`  pages with a static rail : ${pages.length}`);
  console.log(`  already matching         : ${pages.length - drifted.length}`);
  console.log(`  ${write ? "updated" : "drifted"}                  : ${drifted.length}${drifted.length ? " — " + drifted.join(", ") : ""}`);

  if (write) {
    console.log(drifted.length
      ? `sync-rail: WROTE the rail into ${drifted.length} page(s). Run the suite — rail_static.test.mjs checks NAV parity, which this script does not.`
      : "sync-rail: nothing to do, every page already matched.");
    process.exitCode = 0;
    return;
  }

  if (drifted.length) {
    console.error("sync-rail: DRIFT — run with --write, then re-run the suite.");
    process.exitCode = 1;
  } else {
    console.log("sync-rail: CLEAN — every page matches the partial.");
    process.exitCode = 0;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
