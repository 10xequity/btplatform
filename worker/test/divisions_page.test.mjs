/* Boomtown Platform — divisions page + QR image tests
   File: worker/test/divisions_page.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.71.0

   The divisions engine shipped in v0.69.0 with 26 tests and no screen, so none of it was reachable.
   These tests cover the two things a page can get wrong that an API cannot:

   1. IT SHOWS THE REASON. A suggestion that says "move Team 14 down" is useless; one that says
      "2 wins against an A median of 6" can be read out loud to a parent. The server writes those
      sentences and the page must actually display them rather than just the verdict.
   2. IT NEVER MOVES ANYTHING BY ITSELF. Owner 2026-08-03: "Propose, you approve." Declining has to be
      a real action that gets recorded, not the absence of clicking Accept.

   Plus the QR PNG, which exists because the owner said the code goes out by text and email — neither
   of which carries an inline SVG. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const JS = readFileSync(new URL("../../web/assets/admin-divisions.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../web/admin-divisions.html", import.meta.url), "utf8");
const QRJS = readFileSync(new URL("../../web/assets/qr.js", import.meta.url), "utf8");
const SLJS = readFileSync(new URL("../../web/assets/admin-score-links.js", import.meta.url), "utf8");

/* ================================ the page reaches the engine ================================ */

test("the page calls every division route the engine exposes", () => {
  // The engine shipped a release before its screen. A page that reads the plan but has no way to
  // accept it would leave the balancer exactly as unreachable as it was.
  for (const route of [
    "/divisions",
    "/divisions/plan",
    "/divisions/moves",
  ]) {
    assert.ok(JS.includes(route), `nothing on the page calls ${route}`);
  }
});

test("both Accept and Decline are wired, and Decline is a recorded decision", () => {
  assert.match(JS, /data-yes/, "no Accept control");
  assert.match(JS, /data-no/, "no Decline control");
  assert.match(JS, /decide\(\[props\[Number\(b\.dataset\.no\)\]\], "rejected"\)/,
    "Decline must POST a rejected decision, not just remove the row from the screen");
  assert.match(JS, /status,$/m, "the decision payload must carry the status");
});

test("the reason and the numbers behind it are both displayed", () => {
  // This is the product. Without it the director is being asked to trust an unexplained verdict.
  assert.match(JS, /esc\(p\.reason\)/, "the reason sentence must be rendered");
  assert.match(JS, /p\.division_median_wins/, "the median it was judged against must be shown");
  assert.match(JS, /p\.games_played/, "games played is half of the top-division rule and must be visible");
  assert.match(HTML, /\.dv-prop-why \{ font-size: 13px/, "the reason must not be styled as small print");
});

test("accepting or declining recomputes the plan rather than patching the screen", () => {
  // Every acceptance changes the medians, which changes what else is misplaced. Editing the list in
  // place would leave stale suggestions on screen that no longer follow from the data.
  assert.match(JS, /await check\(\);\s+\/\/ the numbers moved/,
    "after a decision the plan must be re-read from the server");
});

/* ================================ court ranges ================================ */

test("overlapping court ranges are caught on the page, while typing", () => {
  // The server refuses them too — that is the guard. This is the courtesy, because finding out on
  // Save that courts 5-8 are double-booked is finding out one step too late.
  assert.match(JS, /function overlaps\(\)/);
  assert.match(JS, /Two divisions are given/);
  assert.match(JS, /dvSave"\)\.disabled = !dirty \|\| problems\.length > 0/,
    "Save must be blocked while a real problem is on screen");
});

test("a backwards range and a missing name are caught too", () => {
  assert.match(JS, /last court before its first/);
  assert.match(JS, /Every division needs a name/);
});

test("the court suggestion leaves no court unassigned", () => {
  // An unclaimed court is a court nobody schedules. 13 courts must not become three divisions of
  // four with the thirteenth orphaned.
  assert.match(JS, /if \(used < courtCount\) rows\[k - 1\]\.court_to = courtCount;/);
});

test("saving a layout warns before it clears team placements", () => {
  // The route uses replace:true, which nulls every team's division. Doing that silently would throw
  // away a Pool Board arrangement somebody spent twenty minutes on.
  assert.match(JS, /replace: true/);
  assert.match(JS, /team assignment\(s\) will be cleared/i,
    "the destructive half of Save must be stated before it happens");
});

test("unsaved work is guarded on this page too", () => {
  assert.match(JS, /beforeunload/);
  assert.match(JS, /unsaved division changes/i);
  assert.match(HTML, /id="dvState"[^>]*aria-live/);
  assert.match(HTML, /\.dv-state\.dirty::before \{ content: "● "/, "unsaved must not be colour-only");
});

/* ================================ accessibility ================================ */

test("every input on the divisions table has a label", () => {
  // A row of five bare number boxes is unusable with a screen reader, and this table is nothing but
  // number boxes.
  for (const label of ["Division name", "Rank, 1 is the top division", "First court", "Last court"]) {
    assert.ok(JS.includes(label), `no accessible name for "${label}"`);
  }
  assert.match(JS, /aria-label="Remove \$\{esc\(d\.name/, "Remove buttons must name what they remove");
});

test("problems are announced, not just coloured", () => {
  assert.match(HTML, /id="dvWarn"[^>]*role="alert"/);
});

test("inputs are 16px, so iOS does not zoom the page on focus", () => {
  assert.match(HTML, /\.dv-in \{ font: inherit; font-size: 16px/);
});

/* ================================ the QR image ================================ */

test("the QR can be saved as a PNG, because that is what a text or email can carry", () => {
  // Owner 2026-08-03: "The QR codes will be used to send via text or email, or link, not for pictures
  // unless its a fixed picture." An inline SVG is stripped by most mail clients and SMS has no markup.
  assert.match(QRJS, /function png\(text, opts = \{\}\)/);
  assert.match(QRJS, /toDataURL\("image\/png"\)/);
  assert.match(SLJS, /window\.BTQR\.download/, "the page must expose it");
  assert.match(SLJS, /Save image/);
});

test("the PNG scales by whole pixels per module", () => {
  // A non-integer scale makes some modules a pixel wider than others, and a scanner reading a photo
  // of that has to guess where the grid is.
  assert.match(QRJS, /Math\.max\(1, Math\.round\(opts\.scale \|\| 8\)\)/);
});

test("the PNG paints its light modules instead of leaving them transparent", () => {
  // A transparent QR dropped into a dark email template is dark-on-dark and does not scan at all.
  assert.match(QRJS, /g\.fillStyle = opts\.light \|\| "#ffffff";\s*\n\s*g\.fillRect\(0, 0, total, total\)/);
});

test("the PNG returns null rather than throwing where there is no canvas", () => {
  // qr.js is also loaded by tests and could be loaded by a worker. Neither has a document.
  assert.match(QRJS, /if \(typeof document === "undefined" \|\| !document\.createElement\) return null;/);
  assert.match(SLJS, /Couldn't make the image here — use Copy link instead/,
    "and the page must fall back to the link rather than failing silently");
});

test("the downloaded file is named after the team", () => {
  // Twenty files called download.png in one folder is twenty files nobody can tell apart.
  assert.match(QRJS, /a\.download = String\(filename \|\| "qr"\)\.replace/);
  assert.match(SLJS, /`scoring-\$\{b\.dataset\.team\}`/);
});

test("the QR module data is unchanged by adding the PNG path", () => {
  // png() and svg() must read the same modules; a second encoder would eventually disagree with the
  // first and only one of them would be the one anybody scanned.
  assert.match(QRJS, /function png\([\s\S]{0,400}?const \{ modules: m, size \} = modules\(text\);/);
  assert.match(QRJS, /function svg\([\s\S]{0,200}?const \{ modules: m, size \} = modules\(text\);/);
});
