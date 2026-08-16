/**
 * Boomtown Platform — theme template guard (W1 / §-1j T2-15 / §-0 B13)
 * File: worker/test/theme_tokens.test.mjs · Version: v1.0 · Date: 2026-08-16 · Ships in: v0.160.0
 *
 * WHY. v0.160.0 promotes the four accepted colour templates (Daylight, Chalk, Midnight,
 * Court Navy — values from docs/2026-08-01_demo_admin-shell_v4_0.html, accepted as work-order
 * W1 on 2026-08-03) from a demo file into web/assets/tokens.css as `[data-template="…"]`
 * blocks, with a picker in both shells and a pre-paint read on every page. Three things can
 * rot independently, so each gets its own verdict here:
 *
 *   1. THE VALUES — every template must pass AA on the same declared pairings the base themes
 *      are held to (token_contrast.test.mjs's corpus; the demo values were never AA-audited
 *      before this file measured them — they pass, and now they cannot silently stop passing).
 *      Each block must be colour-SELF-SUFFICIENT (declare every colour token + color-scheme),
 *      because the pre-paint template read is independent of the mode read: a stale
 *      bt_theme/bt_template pair must still render coherently, and a swatch span carrying the
 *      attribute must not inherit half its colours from the page around it.
 *   2. THE VOCABULARY — config.js's BT_THEME template list and tokens.css's blocks are two
 *      spellings of one set (web has no build step to share them). Keys and modes must agree
 *      in BOTH directions, the ACTIVE_REG deliberate-copy pattern.
 *   3. THE PRE-PAINT CORPUS — every shipped page carries the byte-identical companion line
 *      that applies the stored template before first paint. One page missing it flashes the
 *      base theme at a template user on every visit — the class the line exists to kill.
 *
 * The WCAG maths and the block parser are DELIBERATE COPIES of token_contrast.test.mjs's
 * (importing a test file re-registers its tests inside this one's run). If one changes, the
 * other is the reference.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CSS = readFileSync(join(ROOT, "web/assets/tokens.css"), "utf8");
const CONFIG = readFileSync(join(ROOT, "web/assets/config.js"), "utf8");

/* ── WCAG 2.x maths (copy: token_contrast.test.mjs) ── */
const rgb = (hex) => {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  assert.match(h, /^[0-9a-fA-F]{6}$/, `not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const channel = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => { const [r, g, b] = rgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/* ── block parser (copy: token_contrast.test.mjs themeTokens, + color-scheme capture) ── */
function templateBlock(css, key) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const sel = `[data-template="${key}"]`;
  const at = src.indexOf(sel);
  if (at === -1) return null;
  const open = src.indexOf("{", at);
  const body = src.slice(open + 1, src.indexOf("}", open));
  const tokens = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  const scheme = /color-scheme\s*:\s*(light|dark)/.exec(body);
  return { tokens, mode: scheme ? scheme[1] : null };
}
function resolve(tokens, name, seen = new Set()) {
  const raw = tokens[name];
  assert.ok(raw, `template declares no ${name}`);
  const v = /^var\(\s*(--[\w-]+)/.exec(raw);
  if (!v) return raw;
  assert.ok(!seen.has(name), `alias cycle at ${name}`);
  seen.add(name);
  return resolve(tokens, v[1], seen);
}

/* ── the vocabulary, parsed from BOTH homes ── */
const OWNERS_FOUR = ["daylight", "chalk", "midnight", "court-navy"]; // W1's four, pinned

function configTemplates(js) {
  const out = [];
  for (const m of js.matchAll(/key:\s*"([a-z-]+)",\s*label:\s*"([^"]+)",\s*mode:\s*"(light|dark)"/g)) {
    out.push({ key: m[1], label: m[2], mode: m[3] });
  }
  return out;
}
const JS_TEMPLATES = configTemplates(CONFIG);

/* Every colour token a block must declare to be self-sufficient — the union of :root's colour
   set: 16 mapped from the demo + positive/warn/danger composed per mode + the three aliases
   the base themes re-declare per block (the --warning precedent). */
const REQUIRED_TOKENS = [
  "--bg", "--surface", "--surface-raised", "--surface-2", "--text", "--text-muted",
  "--primary", "--primary-contrast", "--accent", "--focus-ring", "--positive", "--warn",
  "--danger", "--border", "--emphasis", "--gold-ink", "--warning", "--text-dim", "--ok",
];

/* The declared pairings (copy: token_contrast.test.mjs PAIRINGS — same floors, same labels). */
const AA = 4.5, AA_UI = 3.0;
const PAIRINGS = [
  [".btn base — primary-contrast on primary", "--primary-contrast", "--primary", AA],
  ["ink on a gold fill (--gold-ink on --accent)", "--gold-ink", "--accent", AA],
  ["body text on page", "--text", "--bg", AA],
  ["body text on surface", "--text", "--surface", AA],
  ["body text on raised surface", "--text", "--surface-raised", AA],
  ["body text on inset surface", "--text", "--surface-2", AA],
  ["muted text on page", "--text-muted", "--bg", AA],
  ["muted text on surface", "--text-muted", "--surface", AA],
  ["emphasis figure on page", "--emphasis", "--bg", AA],
  ["emphasis figure on surface", "--emphasis", "--surface", AA],
  ["danger text on page", "--danger", "--bg", AA],
  ["danger text on surface", "--danger", "--surface", AA],
  ["positive text on page", "--positive", "--bg", AA],
  ["warn text on page", "--warn", "--bg", AA],
  ["focus ring on page", "--focus-ring", "--bg", AA_UI],
  ["focus ring on surface", "--focus-ring", "--surface", AA_UI],
];

function pairingFailures(tokens) {
  const failures = [];
  for (const [label, fg, bg, floor] of PAIRINGS) {
    const ratio = contrast(resolve(tokens, fg), resolve(tokens, bg));
    if (ratio < floor) failures.push(`${label}: ${ratio.toFixed(2)}:1 (needs ${floor}:1)`);
  }
  return failures;
}

/* ── the pre-paint companion line, byte-identical on every page ── */
const PREPAINT_LINE = `<script>try{var btTpl=localStorage.getItem("bt_template");if(btTpl)document.documentElement.dataset.template=btTpl;}catch(e){}</script>`;

function shippedPages() {
  return readdirSync(join(ROOT, "web")).filter((f) => f.endsWith(".html")).sort();
}
function prepaintMisses(pages, readPage) {
  return pages.filter((p) => !readPage(p).includes(PREPAINT_LINE));
}

/* ═══ 1. the vocabulary ═══ */

test("config.js declares exactly the owner's four templates, keys and labels", () => {
  assert.deepEqual(JS_TEMPLATES.map((t) => t.key).sort(), [...OWNERS_FOUR].sort(),
    "BT_THEME's template list is not W1's four");
  const labels = Object.fromEntries(JS_TEMPLATES.map((t) => [t.key, t.label]));
  assert.deepEqual(labels, { daylight: "Daylight", chalk: "Chalk", midnight: "Midnight", "court-navy": "Court Navy" });
});

test("tokens.css has a block for every config template and NO extra template block", () => {
  for (const key of OWNERS_FOUR) {
    assert.ok(templateBlock(CSS, key), `tokens.css has no [data-template="${key}"] block`);
  }
  const declared = [...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\[data-template="([a-z-]+)"\]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(declared)].sort(), [...OWNERS_FOUR].sort(),
    "tokens.css declares a template config.js does not offer (or vice versa)");
});

test("each block's color-scheme agrees with config.js's declared mode", () => {
  for (const { key, mode } of JS_TEMPLATES) {
    const block = templateBlock(CSS, key);
    assert.ok(block, `no block for ${key}`);
    assert.equal(block.mode, mode,
      `${key}: config says mode "${mode}", the CSS block's color-scheme says "${block.mode}" — native form controls will disagree with the palette`);
  }
});

/* ═══ 2. the values ═══ */

for (const key of OWNERS_FOUR) {
  test(`${key} — colour-self-sufficient: declares every colour token`, () => {
    const block = templateBlock(CSS, key);
    assert.ok(block, `no block for ${key}`);
    const missing = REQUIRED_TOKENS.filter((t) => !(t in block.tokens));
    assert.deepEqual(missing, [],
      `${key} inherits these from whatever mode the page happens to be in: ${missing.join(", ")}`);
  });
  test(`${key} — every declared pairing meets its WCAG floor`, () => {
    const failures = pairingFailures(templateBlock(CSS, key).tokens);
    assert.deepEqual(failures, [], `contrast failures in ${key}:\n  ${failures.join("\n  ")}`);
  });
}

test("the gold rule extends: accent AS TEXT still fails on both light templates", () => {
  for (const key of ["daylight", "chalk"]) {
    const t = templateBlock(CSS, key).tokens;
    const ratio = contrast(resolve(t, "--accent"), resolve(t, "--bg"));
    assert.ok(ratio < AA, `${key}: gold text on its page measures ${ratio.toFixed(2)}:1 — if this passes AA the rule needs rewriting, not obeying`);
  }
});

/* ═══ 3. the pre-paint corpus ═══ */

test("every shipped page carries the byte-identical pre-paint template line", () => {
  const pages = shippedPages();
  assert.ok(pages.length >= 40, `expected the full page set, found ${pages.length}`); // scanner floor, page_structure's idiom
  const misses = prepaintMisses(pages, (p) => readFileSync(join(ROOT, "web", p), "utf8"));
  assert.deepEqual(misses, [],
    "these pages would flash the base theme at a template user on every visit");
});

/* ═══ negative controls ═══ */

test("NC-1 (W1's own): mutating one template's --text to its --bg reddens the pairing check", () => {
  const block = templateBlock(CSS, "chalk");
  const mutated = { ...block.tokens, "--text": block.tokens["--bg"] };
  assert.notEqual(mutated["--text"], block.tokens["--text"], "the mutation did not land — this control tests nothing");
  const failures = pairingFailures(mutated);
  assert.ok(failures.length >= 4, `text==bg must fail several pairings, got ${failures.length}`);
});

test("NC-2: a page shipping without the pre-paint line is caught, and the mutation lands", () => {
  const pages = shippedPages();
  const victim = pages[0];
  const real = readFileSync(join(ROOT, "web", victim), "utf8");
  assert.ok(real.includes(PREPAINT_LINE), `${victim} lacks the line for real — NC-2 needs a compliant victim`);
  const broken = real.replace(PREPAINT_LINE, "");
  assert.notEqual(broken, real, "the mutation did not land");
  const misses = prepaintMisses(pages, (p) => (p === victim ? broken : readFileSync(join(ROOT, "web", p), "utf8")));
  assert.deepEqual(misses, [victim]);
});

test("NC-3: the block parser is positive-controlled on a synthetic block", () => {
  const synthetic = `/* noise [data-template="synthetic"] in a comment */\n[data-template="synthetic"] { color-scheme: dark; --bg: #000000; --ok: var(--positive); --positive: #00FF00; }`;
  const block = templateBlock(synthetic, "synthetic");
  assert.ok(block, "parser found nothing in a block it must parse");
  assert.equal(block.mode, "dark");
  assert.equal(block.tokens["--bg"], "#000000");
  assert.equal(resolve(block.tokens, "--ok"), "#00FF00", "alias resolution through the parser is broken");
  assert.equal(templateBlock(synthetic, "absent"), null, "the parser hallucinates blocks that are not there");
});

test("NC-4: the config parser is reading config.js, not a constant", () => {
  // The mutated key stays inside the parser's own [a-z-] charset — the first draft used
  // "chalkXX" and failed against a correct parser, the wrong-grained-mutation class.
  const mutated = CONFIG.replace('key: "chalk"', 'key: "chalk-xx"');
  if (mutated !== CONFIG) {
    const keys = configTemplates(mutated).map((t) => t.key);
    assert.ok(keys.includes("chalk-xx") && !keys.includes("chalk"), "the mutation did not reach the parse");
  } else {
    // Before the build lands there is no chalk entry to mutate — prove the parser at least
    // reads a synthetic literal, so this control cannot pass by parsing nothing.
    const keys = configTemplates('key: "synthetic", label: "S", mode: "dark"').map((t) => t.key);
    assert.deepEqual(keys, ["synthetic"]);
  }
});
