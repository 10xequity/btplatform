/**
 * Boomtown Platform — §-1r RF-1 (print half): admin pages print without the rail
 * File: worker/test/admin_print.test.mjs · Version: v1.0 · Date: 2026-08-24 · Ships in: v0.189.0
 *
 * RF-1's measured finding: admin.css had ZERO @media print rules, while admin.css:12 makes
 * .admin-layout a `216px 1fr` grid — so every admin print (the pool sheet, scoring links, any
 * hand-out) rendered the sidebar and lost 216px of sheet width. The precedent lived per-page on
 * admin-league.html and admin-score-links.html; RF-1 puts it in the ONE place every admin page
 * inherits. This pins that the global print block drops the rail and collapses the grid.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../../web/assets/admin.css", import.meta.url), "utf8");

/** The body of the `@media print { … }` RULE, brace-matched — not a character-distance window.
    Anchored on the rule (`@media print` + `{`), so prose mentions of "@media print" in comments
    (the header note, this file's own explanation) are skipped. */
function printBlock(css) {
  const m = /@media print\s*\{/.exec(css);
  if (!m) return null;
  const open = m.index + m[0].length - 1; // the rule's opening brace
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") { depth--; if (depth === 0) return css.slice(open + 1, i); }
  }
  return null;
}

test("RF-1 — admin.css prints without the rail: @media print hides .sidebar and collapses the grid", () => {
  const body = printBlock(CSS);
  assert.ok(body, "admin.css has no @media print block — admin pages still print the 216px rail (RF-1)");
  assert.ok(body.includes(".sidebar"), "the print block does not target .sidebar — the rail still prints");
  assert.match(body, /display:\s*none/, "the print block hides nothing — .sidebar would still render");
  assert.match(body, /\.admin-layout\s*\{\s*display:\s*block/,
    "the print block does not collapse .admin-layout to a single column — the freed rail column stays 216px wide");
});

test("RF-1 NC — a print block that stops targeting .sidebar is caught", () => {
  const body = printBlock(CSS);
  const mutated = body.replace(".sidebar", ".sidebarZZ");
  assert.notEqual(mutated, body, "the mutation did not land — .sidebar is not in the print block");
  assert.ok(!mutated.includes(".sidebar") || /\.sidebarZZ/.test(mutated),
    "removing .sidebar from the print block was not caught — the check is spelling-blind");
});
