/**
 * Boomtown Platform — §-1p WF-3 (§-0 B25): the pool board's divisions pivot horizontal ↔ vertical
 * File: worker/test/pool_board_pivot.test.mjs · Version: v1.0 · Date: 2026-08-12 · Ships in: v0.135.0
 *
 * The owner's 2026-08-11 item 4: "On pools, divisions should be able to also pivot to horizontal
 * vs vertical options." Measured HALF-BUILT: the page already ships the exact mechanism for the
 * WAITING AREA (PB_VIEWS + a pb-seg control + one data attribute the stylesheet keys off). This
 * unit extends the SAME idiom to the divisions axis — in the owner's own words:
 *   horizontal = today's layout: divisions stacked as full-width bands, pools flowing across
 *   vertical   = divisions side by side as columns, pools stacked within each
 *
 * THE RULES, EACH PINNED (all inherited from T2-8's own discipline):
 *  · ONE list (PB_DIV_VIEWS), and the buttons, the stylesheet and the list are the SAME SET —
 *    a value styled on one side of that line and not the other is the defect this repo has paid
 *    for repeatedly, which is why BOTH values get an explicit rule.
 *  · The pivot is CSS-ONLY: render() must not branch on the view, so a pivot that drops a
 *    division is not a bug we test for — it is structurally impossible.
 *  · A view change is a PREFERENCE: localStorage, validated against the list on restore, never
 *    marks the board dirty, never sent to the server.
 *  · Controls are wired at BOOT, never inside wire() — wire() runs per render and stacks
 *    handlers on nodes it does not recreate (D-6).
 *  · D-24: `.pb-div-h` and `.pb-courts` stay defined here under those exact names —
 *    admin-kotc.html borrows both and this page is their only definer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

const HTML = readFileSync(new URL("../../web/admin-pool-board.html", import.meta.url), "utf8");
const JS = blankComments(readFileSync(new URL("../../web/assets/admin-pool-board.js", import.meta.url), "utf8"));
const STYLES = (HTML.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];

/* Anchored on `function name(` WITH the paren — "function render" alone matches
   renderSuggestions first (it is declared earlier in the file), and this guard's own first
   draft interrogated the wrong function because of it. Assert uniqueness before anchoring. */
function pure(name) {
  const anchor = `function ${name}(`;
  assert.equal(JS.split(anchor).length - 1, 1, `"${anchor}" is not unique in the source — re-anchor`);
  const body = functionBodyAfter(JS, anchor);
  assert.ok(body, `${name} is gone or no longer a plain function declaration`);
  return body;
}

test("PB_DIV_VIEWS, the buttons and the stylesheet are the SAME SET — in the owner's own words", () => {
  const m = JS.match(/PB_DIV_VIEWS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "PB_DIV_VIEWS is missing — the division views need their ONE list, like PB_VIEWS");
  const listed = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(listed, ["horizontal", "vertical"],
    "the vocabulary is the owner's: horizontal (stacked bands) and vertical (columns)");
  const buttons = [...new Set([...HTML.matchAll(/data-pbdivview="([^"]+)"/g)].map((x) => x[1]))].sort();
  assert.deepEqual(buttons, listed, "the buttons offer a view the list does not know, or vice versa");
  const styled = [...new Set([...STYLES.matchAll(/\.pb-board\[data-divview="([^"]+)"\]/g)].map((x) => x[1]))].sort();
  assert.deepEqual(styled, listed,
    "the stylesheet styles a view the list does not know, or a listed view has NO rule — both values need one, so this set check stays real");
});

test("the vertical view really pivots: divisions become columns, pools stack within each", () => {
  const grid = STYLES.match(/\.pb-board\[data-divview="vertical"\]\s*\{[^}]*\}/);
  assert.ok(grid, "the vertical view has no container rule");
  assert.match(grid[0], /display:\s*grid/, "vertical must lay the divisions out as grid columns");
  const pools = STYLES.match(/\.pb-board\[data-divview="vertical"\]\s+\.pb-pools\s*\{[^}]*\}/);
  assert.ok(pools, "vertical view never restyles .pb-pools — the pools would still flow horizontally inside a column");
  assert.match(pools[0], /flex-direction:\s*column/, "in a division column, the pools must stack");

  // NEGATIVE CONTROL — the detectors must be able to fail: strip the vertical rules from a copy.
  const stripped = STYLES.replace(/\.pb-board\[data-divview="vertical"\][^{]*\{[^}]*\}/g, "");
  assert.notEqual(stripped, STYLES, "the strip found nothing to remove");
  assert.equal(/\.pb-board\[data-divview="vertical"\]\s*\{/.test(stripped), false,
    "the container detector still matches after the rules were removed");
});

test("the pivot is CSS-only: render() does not branch on the view, so no orientation can drop a division", () => {
  const body = pure("render");
  assert.ok(!body.includes("divView"),
    "render() branches on the division view — a pivot that forks the markup can drop a division; the pivot must stay CSS-only");
  assert.match(body, /pb-div\b/, "render() no longer emits division sections — rewrite this guard around what replaced them");
});

test("paintView writes the board attribute and the buttons' pressed state, like the view it mirrors", () => {
  const body = pure("paintView");
  assert.match(body, /divview\b|divView\b/i, "paintView never paints the division view");
  assert.match(body, /data-pbdivview|pbdivview/i, "paintView never updates the new buttons' aria-pressed");
  assert.match(body, /dataset\.divview\s*=|setAttribute\("data-divview"/,
    "the board's data-divview attribute is never written — the stylesheet has nothing to key off");
});

test("the preference persists, is VALIDATED on restore, and is wired at boot — never inside wire() (D-6)", () => {
  assert.match(JS, /localStorage\.setItem\("bt_pb_divview"/, "the choice is never saved");
  assert.match(JS, /PB_DIV_VIEWS\.includes\(/,
    "the restore path trusts whatever is in storage — a poisoned value must not become the layout");
  const wireBody = pure("wire");
  assert.ok(!wireBody.includes("pbdivview"),
    "the toggle is wired inside wire() — wire() runs per render and stacks handlers (D-6); wire it at boot like the pbview buttons");
  assert.ok(JS.includes("data-pbdivview"), "no click wiring exists for the new buttons at all");
});

test("the new buttons live inside a pb-seg group, inheriting the existing press feedback and reduced-motion gates", () => {
  const seg = HTML.match(/<span class="pb-seg"[^>]*aria-label="[^"]*division[^"]*"[\s\S]*?<\/span>/i);
  assert.ok(seg, "the division toggle is not a pb-seg group — it must match the waiting-area control's look and behaviour exactly");
  assert.match(seg[0], /data-pbdivview="horizontal"/);
  assert.match(seg[0], /data-pbdivview="vertical"/);
  assert.match(seg[0], /aria-pressed/, "the buttons must carry pressed state for keyboard and screen-reader users");
});

test("D-24 CLOSED (v0.137.0): .pb-div-h and .pb-courts keep their names, in admin.css now", () => {
  // REWRITTEN, not deleted. This pin was written in v0.135.0 to stop the pivot renaming two
  // classes admin-kotc.html borrows while this page was their ONLY definer. v0.137.0 fixed the
  // borrowing itself — the base rules moved to admin.css — so the pin follows the judgement to
  // its new home rather than pinning bytes that legitimately left. What it must still catch is
  // unchanged: those two names disappearing, which is what leaves the Court Board unstyled.
  const ADMIN_CSS = readFileSync(new URL("../../web/assets/admin.css", import.meta.url), "utf8");
  assert.match(ADMIN_CSS, /\.pb-div-h\s*\{/, ".pb-div-h lost its definition — admin-kotc.html renders unstyled headings (D-24)");
  assert.match(ADMIN_CSS, /\.pb-courts\s*\{/, ".pb-courts lost its definition — admin-kotc.html renders unstyled counts (D-24)");
  const renamed = ADMIN_CSS.replace(/\.pb-div-h\s*\{/g, ".pb-div-h-RENAMED {").replace(/\.pb-courts\s*\{/g, ".pb-courts-RENAMED {");
  assert.notEqual(renamed, ADMIN_CSS, "the rename control found nothing to rename");
  assert.equal(/\.pb-div-h\s*\{/.test(renamed), false, "the .pb-div-h detector cannot fail");
  // And this page keeps its OWN stake: the waiting area's centre-aligned override is page layout,
  // not the class, so it stayed behind. If it followed the base rules it would restyle the Court
  // Board's headings too — the exact cross-page bleed D-24 was.
  assert.match(STYLES, /\.pb-workspace\s+\.pb-div-h\s*\{/,
    "the waiting area's scoped override left this page — it belongs here, and only here");
  assert.equal(/^\s*\.pb-div-h\s*\{/m.test(STYLES), false,
    "the base rule came back to this page's <style> — one definition, or the two boards drift");
});
