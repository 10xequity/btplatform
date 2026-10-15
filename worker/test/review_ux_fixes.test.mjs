/**
 * Boomtown Platform — the 2026-10-15 external UI review (ChatGPT/Codex), web findings
 * File: worker/test/review_ux_fixes.test.mjs · Version: v1.0 · Date: 2026-10-15 · Ships in: v0.215.0
 *
 * Source pins for the five web fixes the review named and this release ships. Each pin is
 * scoped to the function that owns the behaviour (functionBodyAfter), never the whole file, so
 * a matching string elsewhere cannot satisfy it; each has a negative control where the defect
 * had a recognisable shape. Watched red before the fix.
 *
 *   F2/27  Tournament Ops interpolated registrant-controlled team names into HTML and an
 *          attribute without escaping (stored XSS reaching an admin page). Now every data
 *          interpolation in the event picker, byes row, match cell, score sheet and standings
 *          passes through dsEsc.
 *   F7     a failed score save closed the sheet as though it had saved. Now send() checks the
 *          response, keeps the sheet open and names the failure.
 *   F8     a failed walk-in closed the modal and threw the typed name away. Now the modal
 *          closes only on success and the error shows inside it.
 *   F13    captains could only pick margins 1, 2, 3, 5 or 8+. Now a numeric "other margin"
 *          box sits beside the chips, as the admin sheet already had.
 *   F21    three components overrode the accessible --focus-ring with gold (about 1.9:1 on
 *          white). Now they use the token.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { functionBodyAfter } from "../testkit/route-extract.mjs";

const read = (p) => readFileSync(new URL(`../../web/assets/${p}`, import.meta.url), "utf8");
const tournament = read("tournament.js");
const checkin = read("admin-checkin.js");
const score = read("score.js");
const siteNav = read("site-nav.js");
const appCss = read("app.css");

/* ---------- F2/27: every data interpolation in Tournament Ops is escaped ---------- */

test("F2: matchCell escapes both team labels, both names and the ref", () => {
  const body = functionBodyAfter(tournament, "function matchCell(m)");
  assert.ok(body, "matchCell must exist");
  assert.doesNotMatch(body, /\$\{teamName\[/, "a raw teamName[] interpolation survives in matchCell");
  assert.doesNotMatch(body, /\$\{teamLabel\(/, "a raw teamLabel() interpolation survives in matchCell");
  assert.ok((body.match(/dsEsc\(/g) || []).length >= 5, "five escaped sites expected (2 labels, 2 names, 1 ref)");
});

test("F2: the standings table, byes row and event picker escape their names", () => {
  const standings = functionBodyAfter(tournament, "async function renderStandings()");
  assert.ok(standings, "renderStandings must exist");
  assert.doesNotMatch(standings, /\$\{s\.name\}/, "standings interpolates s.name raw");
  assert.match(standings, /dsEsc\(s\.name\)/);
  assert.match(tournament, /map\(\(t\) => dsEsc\(t\.name\)\)\.join\(", "\)/, "byesIn must escape each name");
  assert.doesNotMatch(tournament, /<option value="\$\{e\.id\}">\$\{e\.name\}/, "event picker interpolates e.name raw");
});

test("F2: the score sheet's winner buttons escape the team labels", () => {
  const body = functionBodyAfter(tournament, "function openScoreSheet(matchId)");
  assert.ok(body);
  assert.doesNotMatch(body, /data-w="[ab]">\$\{teamLabel\(/, "a winner button interpolates teamLabel raw");
  assert.ok((body.match(/data-w="[ab]">\$\{dsEsc\(teamLabel\(/g) || []).length === 2);
});

test("F2 negative control: the detector sees a planted raw interpolation", () => {
  const planted = tournament.replace(/dsEsc\(s\.name\)/, "s.name");
  const standings = functionBodyAfter(planted, "async function renderStandings()");
  assert.match(standings, /\$\{s\.name\}/);
});

/* ---------- F7: a failed score save stays open and says so ---------- */

test("F7: send() closes the sheet only after a successful response", () => {
  const body = functionBodyAfter(tournament, "function openScoreSheet(matchId)");
  const send = body.slice(body.indexOf("const send = async"));
  assert.match(send, /const r = await api\(`\/api\/matches\/\$\{matchId\}\/score`/, "send must keep the response");
  assert.match(send, /if \(!r\.ok\)/, "send must branch on failure");
  const failBranch = send.slice(send.indexOf("if (!r.ok)"), send.indexOf("closeSheet()"));
  assert.match(failBranch, /not saved/i, "the failure must be named in the sheet");
  assert.doesNotMatch(failBranch, /closeSheet\(\)/);
});

/* ---------- F8: a failed walk-in keeps the typed details ---------- */

test("F8: the walk-in modal closes only on success and shows the error inside", () => {
  const body = functionBodyAfter(checkin, "function walkinModal()");
  assert.ok(body);
  const after = body.slice(body.indexOf("const r = await api("));
  const closeAt = after.indexOf("closeModal()");
  const okAt = after.indexOf("if (!r.ok)");
  assert.ok(okAt >= 0 && closeAt > okAt, "closeModal must come after the !r.ok branch");
  assert.match(after.slice(okAt, closeAt), /wErr|querySelector\("#w/, "the error must land inside the modal");
});

/* ---------- F13: captains can enter any margin ---------- */

test("F13: the captain score card offers a numeric margin box beside the chips", () => {
  const body = functionBodyAfter(score, "function wire(m)");
  assert.ok(body);
  assert.match(body, /type="number"/, "a numeric margin input is required");
  assert.match(body, /aria-label="[^"]*margin[^"]*"/i);
  assert.match(body, /\[1, 2, 3, 5, 8\]/, "the common chips stay (2-tap path preserved)");
});

/* ---------- F21: focus rings use the accessible token ---------- */

test("F21: no component overrides the focus ring with raw gold", () => {
  const hits = [];
  for (const [name, src] of [["site-nav.js", siteNav], ["app.css", appCss]]) {
    const re = /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/g;
    let m; while ((m = re.exec(src))) hits.push(`${name}@${m.index}`);
  }
  assert.deepEqual(hits, [], `gold focus rings survive: ${hits.join(", ")}`);
  assert.ok((appCss.match(/outline:\s*2px solid var\(--focus-ring\)/g) || []).length >= 2, "the token is the ring");
});
