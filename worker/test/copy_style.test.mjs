/**
 * Boomtown Platform — §-1r RF-20: no em dashes in member/admin-visible copy
 * File: worker/test/copy_style.test.mjs · Version: v1.0 · Date: 2026-08-25 · Ships in: v0.195.0
 *
 * Owner 2026-08-24: "Review all the formatting and text to be consistent, remove any AI patterns
 * such as em dashes." MEASURED before sweeping (iteration 135): 61 <title> separators, 6
 * aria-labels, and 346 prose sites across 92 web files carried U+2014 in copy a member or admin
 * can see; 43 more were LONE-DASH PLACEHOLDERS (an empty score/value cell rendered as "—"),
 * which are a typographic blank, not prose — they stay, as the one named exemption. CSS-comment
 * prose inside <style> blocks and inside JS css template literals is invisible and out of scope
 * (the first measuring pass counted it and was wrong by ~200 — the instrument was measured
 * before the corpus was).
 *
 * THE RULE: after stripping what a member cannot see (HTML comments, JS comments via the repo's
 * own blankComments, CSS comments left inside string/template text), a web page or asset script
 * contains NO em dash whose enclosing content is more than the dash itself. The corpus is
 * DERIVED (every web/*.html + web/assets/*.js + the repo-root pages), so a new page joins by
 * existing.
 *
 * BOUNDARY, stated: worker/src error sentences (234 sites) also reach member screens and are
 * the recorded NEXT sweep unit (roadmap RF-20) — this guard widens to that corpus when they are
 * swept, not before. Docs and code comments are not member-facing and stay out permanently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const ROOT = new URL("../../", import.meta.url);
const read = (u, p) => readFileSync(new URL(p, u), "utf8");
const DASH = "—";

/* what a member cannot see, removed at the right grain for each file kind */
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n\r]/g, " "));
export const visibleHtml = (html) =>
  html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n\r]/g, " "))
    .replace(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g, (m, body) => m.replace(body, stripCssComments(blankComments(body))))
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (m, body) => m.replace(body, stripCssComments(body)));
export const visibleJs = (src) => stripCssComments(blankComments(src));

/** The one exemption: a LONE dash — the only non-space content between its delimiters
 *  (quotes or tag brackets). `"—"`, `>—<`, `` `—` `` pass; any dash with words beside it is copy. */
export const isPlaceholder = (s, i) => {
  let a = i - 1;
  while (a >= 0 && (s[a] === " " || s[a] === "\t")) a--;
  let b = i + 1;
  while (b < s.length && (s[b] === " " || s[b] === "\t")) b++;
  return /["'`>]/.test(s[a] || "") && /["'`<]/.test(s[b] || "");
};

export const offendersIn = (s, name) => {
  const out = [];
  const lines = s.split(/\r?\n/);
  let pos = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let i = line.indexOf(DASH); i !== -1; i = line.indexOf(DASH, i + 1)) {
      if (!isPlaceholder(line, i)) out.push(`${name}:${li + 1}  ${line.trim().slice(0, 90)}`);
    }
    pos += line.length + 1;
  }
  return out;
};

test("RF-20: no em dash in any web page's visible copy (placeholder blanks exempt)", () => {
  const pages = readdirSync(WEB).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length >= 60, `page corpus shrank: ${pages.length}`);
  const offenders = [];
  for (const f of pages) offenders.push(...offendersIn(visibleHtml(read(WEB, f)), f));
  for (const f of ["index.html", "404.html"]) offenders.push(...offendersIn(visibleHtml(read(ROOT, f)), "root " + f));
  assert.deepEqual(offenders, [],
    `em dashes in visible page copy (owner 2026-08-24: "remove any AI patterns such as em dashes"):\n  ${offenders.slice(0, 40).join("\n  ")}${offenders.length > 40 ? `\n  …and ${offenders.length - 40} more` : ""}`);
});

test("RF-20: no em dash in any asset script's strings (placeholder blanks exempt)", () => {
  const scripts = readdirSync(new URL("assets/", WEB)).filter((f) => f.endsWith(".js"));
  assert.ok(scripts.length >= 60, `script corpus shrank: ${scripts.length}`);
  const offenders = [];
  for (const f of scripts) offenders.push(...offendersIn(visibleJs(read(WEB, "assets/" + f)), "assets/" + f));
  assert.deepEqual(offenders, [],
    `em dashes in script copy:\n  ${offenders.slice(0, 40).join("\n  ")}${offenders.length > 40 ? `\n  …and ${offenders.length - 40} more` : ""}`);
});

/* ── controls: the strippers and the exemption, each proven both ways ── */

test("NC-CS1: a prose em dash planted in real page markup IS caught", () => {
  const html = read(WEB, "home.html");
  const mutated = html.replace("</body>", "<p>Check back soon — more to come.</p></body>");
  assert.notEqual(mutated, html, "mutation did not land — NC is vacuous");
  const hits = offendersIn(visibleHtml(mutated), "home.html");
  assert.equal(hits.length, 1, `expected exactly the planted dash, saw ${hits.length}`);
});

test("NC-CS2: a lone-dash placeholder is NOT an offender (the exemption is real)", () => {
  const hits = offendersIn(visibleHtml('<td class="score">—</td>'), "fixture");
  assert.deepEqual(hits, [], "an empty-value blank must stay exempt — it is typography, not prose");
  const js = offendersIn(visibleJs('el.textContent = row.score ?? "—";'), "fixture");
  assert.deepEqual(js, [], "the JS spelling of the blank must stay exempt too");
});

test("NC-CS3: an em dash in a comment or CSS comment is INVISIBLE and must not trip the scan", () => {
  const html = '<style>/* layout — grid */</style><script>// note — here\nvar x=1;</script><!-- doc — dash -->';
  assert.deepEqual(offendersIn(visibleHtml(html), "fixture"), [],
    "comment prose is not member-facing — a scan that counts it makes every explanation an offender");
  /* positive control on the strippers: the SAME dash in live text IS kept */
  assert.equal(offendersIn(visibleHtml(html + "<p>live — text</p>"), "fixture").length, 1,
    "the strippers ate live copy — they are deleting more than comments");
});

test("NC-CS4: a dash with words beside it inside a string is NOT a placeholder", () => {
  const js = 'msg.textContent = "Saved — all done.";';
  assert.equal(offendersIn(visibleJs(js), "fixture").length, 1,
    "a sentence dash must be an offender — if this passes, the exemption swallowed the rule");
});
