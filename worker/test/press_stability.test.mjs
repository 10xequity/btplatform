/**
 * Boomtown Platform — press stability guard (no layout shift on press)
 * File: worker/test/press_stability.test.mjs · Version: v1.0 · Date: 2026-08-25 · Ships in: v0.198.0
 *
 * WHY (owner 2026-08-25): "when pressing the buttons jitter and move as well. but continue to
 * work." Measured live on the schedule tabs: pressing List flipped its font-weight 400 → 600,
 * its width changed (50 → 51px), and every sibling tab SHIFTED (Month moved 1218 → 1220). Bold
 * glyphs are wider than regular ones, so any rule that changes font-weight on an interactive
 * state reflows the row on every press — that is the jitter, and it was live at five sites
 * (.tab.active, .nav-item.active, .seg[aria-pressed], .lfg-tab[aria-pressed], .sub-chip.on).
 *
 * THE RULE: weight lives on the COMPONENT'S BASE rule; an active/pressed/checked state may
 * change color, background, border, shadow — anything that does not move text — but never
 * font-weight. (.login-tab was already the correct precedent: base 600, active changes color
 * and border only.) transform: scale() press feedback is exempt by nature — it is compositing,
 * not layout, and it reverts on release.
 *
 * CORPUS: every shipped page's inline <style> blocks + web/assets/*.css, comments stripped
 * (a commented-out flip must not fail the guard, and a commented-out correct rule must not
 * satisfy anything). The extractor is positive-controlled on a fixture before it judges.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB_DIR = new URL("../../web/", import.meta.url);
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/* Every CSS chunk that ships: page <style> blocks + the asset sheets. */
function cssChunks() {
  const chunks = [];
  for (const f of readdirSync(WEB_DIR).filter((x) => x.endsWith(".html"))) {
    const html = readFileSync(new URL(f, WEB_DIR), "utf8");
    const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
    let m;
    while ((m = re.exec(html))) chunks.push({ file: f, css: stripCss(m[1]) });
  }
  for (const f of readdirSync(new URL("assets/", WEB_DIR)).filter((x) => x.endsWith(".css"))) {
    chunks.push({ file: "assets/" + f, css: stripCss(readFileSync(new URL("assets/" + f, WEB_DIR), "utf8")) });
  }
  return chunks;
}

/* An interactive-state selector: pressing/choosing toggles it at runtime. Word-bounded so
   `.on` cannot match `.online`, and aria matches only the true-valued state. */
const STATEY = /(\.active(?![\w-])|\[aria-pressed="true"\]|\[aria-selected="true"\]|:checked|\.on(?![\w-]))/;

function weightFlips(chunks) {
  const flips = [];
  for (const { file, css } of chunks) {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const sel = m[1].trim().replace(/\s+/g, " ");
      if (STATEY.test(sel) && /font-weight/.test(m[2])) flips.push(`${file} :: ${sel}`);
    }
  }
  return flips;
}

test("positive control: the extractor catches a state rule that flips weight", () => {
  const fixture = [{ file: "fx.html", css: '.tab { color: red; } .tab.active { font-weight: 700; }' }];
  assert.deepEqual(weightFlips(fixture), ["fx.html :: .tab.active"]);
});

test("positive control: word boundaries hold — .online is not a state, comments do not count", () => {
  assert.deepEqual(weightFlips([{ file: "fx", css: ".online { font-weight: 700; }" }]), []);
  assert.deepEqual(weightFlips([{ file: "fx", css: stripCss("/* .tab.active { font-weight: 700; } */ .x { color: red; }") }]), []);
});

test("no interactive state changes font-weight anywhere in the shipped corpus", () => {
  const chunks = cssChunks();
  // Floor measured 2026-08-25: 61 chunks (57 page <style> blocks + 4 asset sheets).
  assert.ok(chunks.length >= 55, `corpus collapsed — only ${chunks.length} CSS chunks found`);
  const flips = weightFlips(chunks);
  assert.deepEqual(flips, [],
    `these rules re-weigh text on press, so the row reflows under the pointer:\n  ${flips.join("\n  ")}`);
});

test("the five repaired sites still carry their weight on the BASE rule", () => {
  // The flip ban alone would pass if the weight were simply deleted — these pin that the
  // active look survived the move (the forbid-guards-need-an-exit lesson, typography edition).
  const admin = stripCss(readFileSync(new URL("assets/admin.css", WEB_DIR), "utf8"));
  assert.match(admin, /\.tab\s*\{[^}]*font-weight: 600/, ".tab base lost its weight");
  assert.match(admin, /\.nav-item\s*\{[^}]*font-weight: 600/, ".nav-item base lost its weight");
  const facility = stripCss(readFileSync(new URL("admin-facility.html", WEB_DIR), "utf8"));
  assert.match(facility, /\.seg button\s*\{[^}]*font-weight: 700/, ".seg button base lost its weight");
  const lfg = stripCss(readFileSync(new URL("lfg.html", WEB_DIR), "utf8"));
  assert.match(lfg, /\.lfg-tab\s*\{[^}]*font-weight: 700/, ".lfg-tab base lost its weight");
  const subs = stripCss(readFileSync(new URL("subs.html", WEB_DIR), "utf8"));
  assert.match(subs, /\.sub-chip\s*\{[^}]*font-weight: 600/, ".sub-chip base lost its weight");
});

test("NC: a reintroduced flip on the real admin.css is caught", () => {
  const admin = stripCss(readFileSync(new URL("assets/admin.css", WEB_DIR), "utf8"));
  const mutated = admin.replace(/\.tab\.active\s*\{/, ".tab.active { font-weight: 600; ");
  assert.notEqual(mutated, admin, "mutation did not land — NC is vacuous");
  const flips = weightFlips([{ file: "assets/admin.css", css: mutated }]);
  assert.ok(flips.some((f) => f.includes(".tab.active")), "a real reintroduced flip must be caught");
});
