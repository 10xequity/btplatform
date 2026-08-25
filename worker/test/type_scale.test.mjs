/**
 * Boomtown Platform — the title scale (one hierarchy, every screen)
 * File: worker/test/type_scale.test.mjs · Version: v1.0 · Date: 2026-08-25 · Ships in: v0.198.0
 *
 * WHY (owner 2026-08-25): "Please also look at text consistency on screens. Follow title
 * hierarchy for sizes and fonts." Measured before the sweep: 34 CSS heading rules + 26
 * inline-styled headings, h1 spread 20/22/24/28 across pages, h2 spread 13–22 — and the card
 * h2 mode was 16px, BELOW the 17px body, an inverted hierarchy. The scale now lives in
 * tokens.css (--fs-h1/--fs-h2/--fs-h3) and every heading rule reads it.
 *
 * TWO VERDICTS, deliberately separate (the complete-and-illegible lesson: uniform values pass
 * every equality check, so the RELATIONSHIP is asserted, not just the spellings):
 *   1. THE SCALE ITSELF — h1 > h2 > h3, and h2 at or above the body size.
 *   2. THE READERS — every rule that sizes a heading, and every inline-styled heading, reads
 *      its level's token. Exemptions are NAMED here with their reasons; an exemption without
 *      a reason is drift.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB_DIR = new URL("../../web/", import.meta.url);
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const TOKENS = stripCss(readFileSync(new URL("assets/tokens.css", WEB_DIR), "utf8"));

/* Labels styled as miniatures ON PURPOSE — each with the reason it is not a title. */
const EXEMPT = new Set([
  "home.html :: .feed-group h3",                        // 12px uppercase eyebrow label, not a title
  "admin-announcements.html :: .prev .feed-group h3",   // the same eyebrow inside the preview mock
  "admin-announcements.html :: .prev-card h2",          // a miniature preview of the member card
  "admin-documents.html :: .dc-rail h2, .dc-pal h2",    // 13px rail group labels
  "kiosk.html :: .kk-card h1",                          // display size — read across a room
]);

const px = (name) => {
  const m = TOKENS.match(new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)px`));
  return m ? Number(m[1]) : null;
};

test("the scale exists and is a HIERARCHY: h1 > h2 > h3, h2 at or above the body", () => {
  const h1 = px("--fs-h1"), h2 = px("--fs-h2"), h3 = px("--fs-h3"), body = px("--font-size-body");
  assert.ok(h1 && h2 && h3, `tokens.css must declare --fs-h1/--fs-h2/--fs-h3 in px (got ${h1}/${h2}/${h3})`);
  assert.ok(h1 > h2 && h2 > h3, `the scale is not a hierarchy: ${h1} > ${h2} > ${h3} must hold`);
  assert.ok(h2 >= body, `a section title below body size (${h2} < ${body}) is the inversion the owner named`);
});

/* Every rule whose selector ENDS at a heading (a child like `h2 .more` sizes a child, not the
   heading) and declares font-size, across page <style> blocks + the asset sheets. */
function headingRules() {
  const found = [];
  const scan = (file, css) => {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const sel = m[1].trim().replace(/\s+/g, " ");
      // The h-token must be an ELEMENT at the end of a selector part — `(^|[\s>+~,])h2$`.
      // A bare `h2$` also matched CLASS names ending in the token (.dc-h1, .lv-h2), which the
      // first sweep proved by rewriting live.html's display-board typography (caught, reverted).
      if (!sel.split(",").some((part) => /(^|[\s>+~])h[123]\s*$/.test(part.trim()))) continue;
      const size = (m[2].match(/font-size:\s*([^;]+)/) || [])[1];
      if (size) found.push({ key: `${file} :: ${sel}`, size: size.trim(), level: sel.match(/h([123])\s*$/)[1] });
    }
  };
  for (const f of readdirSync(WEB_DIR).filter((x) => x.endsWith(".html"))) {
    const html = readFileSync(new URL(f, WEB_DIR), "utf8");
    const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
    let m;
    while ((m = re.exec(html))) scan(f, stripCss(m[1]));
  }
  for (const f of readdirSync(new URL("assets/", WEB_DIR)).filter((x) => x.endsWith(".css"))) {
    scan("assets/" + f, stripCss(readFileSync(new URL("assets/" + f, WEB_DIR), "utf8")));
  }
  return found;
}

test("every CSS heading rule reads its level's token (exemptions named above)", () => {
  const rules = headingRules();
  assert.ok(rules.length >= 20, `corpus collapsed — only ${rules.length} heading rules found`);
  const offenders = rules.filter((r) => !EXEMPT.has(r.key) && r.size !== `var(--fs-h${r.level})`);
  assert.deepEqual(offenders.map((o) => `${o.key} = ${o.size}`), [],
    "heading rules off the scale — one hierarchy, every screen");
});

test("every inline-styled heading reads its level's token", () => {
  const offenders = [];
  for (const f of readdirSync(WEB_DIR).filter((x) => x.endsWith(".html"))) {
    const html = readFileSync(new URL(f, WEB_DIR), "utf8");
    const re = /<h([123])[^>]*style="([^"]*font-size:\s*([^;"]+)[^"]*)"/g;
    let m;
    while ((m = re.exec(html))) {
      if (m[3].trim() !== `var(--fs-h${m[1]})`) offenders.push(`${f}: <h${m[1]}> font-size:${m[3].trim()}`);
    }
  }
  assert.deepEqual(offenders, [], "inline headings off the scale");
});

test("positive control: the scanner sees a px heading, skips a child selector AND a class suffix", () => {
  const css = ".card h2 { font-size: 16px; } .card h2 .more { font-size: 13px; } .lv-h2 { font-size: 13px; }";
  const found = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (sel.split(",").some((p) => /(^|[\s>+~])h[123]\s*$/.test(p.trim()))) found.push(sel);
  }
  assert.deepEqual(found, [".card h2"],
    "the scanner must catch the heading, skip its child, and NOT match a class name ending in the token");
});

test("NC: a real rule mutated back to a px literal is caught", () => {
  const appCss = stripCss(readFileSync(new URL("assets/app.css", WEB_DIR), "utf8"));
  const mutated = appCss.replace(".module h3 { margin: 0 0 6px; font-size: var(--fs-h3); }",
    ".module h3 { margin: 0 0 6px; font-size: 16px; }");
  if (mutated !== appCss) {
    assert.match(mutated, /\.module h3 \{[^}]*font-size: 16px/, "mutation did not land");
  } else {
    // Pre-sweep: the token spelling does not exist yet — the reader test above is the red.
    assert.doesNotMatch(appCss, /\.module h3 \{[^}]*var\(--fs-h3\)/);
  }
});
