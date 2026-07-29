/**
 * tokens.test.mjs · v1.0 · 2026-07-29 · Ships in: v0.33.2
 *
 * Guards web/assets/tokens.css v0.4.0 — F-35 (focus-ring scope + dark-mode colour) and
 * F-36 (body size single source).
 *
 * WHY THIS FILE STRIPS COMMENTS FIRST, BEFORE ANYTHING ELSE:
 * standards guard-discipline instance 3 is "a source-scanning test whose regex matched prose
 * and JS assignments". That trap is live in this repo right now — web/admin-facility.html line 6
 * contains the HTML comment "focus-visible everywhere", which any naive count of ":focus-visible"
 * would score as a rule. Every parser below runs on comment-stripped input, and NC-1/NC-6 prove
 * it: they feed declarations that exist ONLY inside comments and assert they are NOT seen.
 *
 * Contrast is COMPUTED here, never asserted from a table. The ratios in tokens.css's own v0.4.0
 * block are the output of this arithmetic, not its input — if someone edits a hex, this fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const TOKENS_URL = new URL("../../web/assets/tokens.css", import.meta.url);
const WEB_DIR = new URL("../../web/", import.meta.url);

/* ── pure helpers — the real file and every synthetic negative control go through these ── */

const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");

/** Body of the first rule whose selector matches exactly, by brace counting. Null if absent. */
function blockFor(css, selector) {
  const clean = stripCssComments(css);
  let i = 0;
  while (i < clean.length) {
    const open = clean.indexOf("{", i);
    if (open === -1) return null;
    const sel = clean.slice(i, open).replace(/^[\s};]+/, "").trim();
    let depth = 1, j = open + 1;
    while (j < clean.length && depth > 0) {
      if (clean[j] === "{") depth++;
      else if (clean[j] === "}") depth--;
      j++;
    }
    if (sel === selector) return clean.slice(open + 1, j - 1);
    // descend into @supports / @media so nested rules are still reachable
    if (sel.startsWith("@")) {
      const inner = blockFor(clean.slice(open + 1, j - 1), selector);
      if (inner !== null) return inner;
    }
    i = j;
  }
  return null;
}

/** Value of a custom property inside a block. Null if the block or the property is absent. */
function tokenIn(css, selector, prop) {
  const body = blockFor(css, selector);
  if (body === null) return null;
  const m = body.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
}

/** WCAG 2.1 relative luminance. Threshold 0.03928 per the WCAG definition of relative luminance. */
function luminance(hex) {
  const h = hex.trim().replace("#", "");
  assert.match(h, /^[0-9a-fA-F]{6}$/, `not a 6-digit hex: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** True only if a rule exists whose selector is exactly ":focus-visible" — not element-scoped. */
function hasBareFocusVisible(css) {
  return blockFor(css, ":focus-visible") !== null;
}

/** Page-level :focus-visible declarations that do NOT route through var(--focus-ring). */
function countDriftingFocusRules(htmlSources) {
  let n = 0;
  for (const src of htmlSources) {
    const clean = stripCssComments(stripHtmlComments(src));
    for (const m of clean.matchAll(/:focus-visible\b[^{}]*\{([^{}]*)\}/g)) {
      const body = m[1];
      if (/outline\s*:/.test(body) && !/var\(\s*--focus-ring/.test(body)) n++;
    }
  }
  return n;
}

const CSS = readFileSync(TOKENS_URL, "utf8");
const HTML = readdirSync(WEB_DIR)
  .filter((f) => f.endsWith(".html"))
  .map((f) => readFileSync(new URL(f, WEB_DIR), "utf8"));

/* ── F-35 ── */

test("F-35: --focus-ring is defined in both themes", () => {
  assert.ok(tokenIn(CSS, ":root", "--focus-ring"), "missing in :root");
  assert.ok(tokenIn(CSS, '[data-theme="dark"]', "--focus-ring"), "missing in dark override");
});

test("F-35: the dark ring is not gold — it must differ from dark --primary AND --accent", () => {
  const ring = tokenIn(CSS, '[data-theme="dark"]', "--focus-ring").toUpperCase();
  for (const p of ["--primary", "--accent"]) {
    const v = tokenIn(CSS, '[data-theme="dark"]', p).toUpperCase();
    assert.notEqual(ring, v, `dark --focus-ring equals ${p} (${v}) — invisible on gold chrome`);
  }
});

test("F-35: ring clears WCAG 1.4.11 (>=3:1) on --bg and --surface in both themes", () => {
  for (const [scope, label] of [[":root", "light"], ['[data-theme="dark"]', "dark"]]) {
    const ring = tokenIn(CSS, scope, "--focus-ring");
    for (const surf of ["--bg", "--surface"]) {
      const ratio = contrast(ring, tokenIn(CSS, scope, surf));
      assert.ok(ratio >= 3.0, `${label} ring on ${surf} = ${ratio.toFixed(2)}:1, below 3:1`);
    }
  }
});

test("F-35: a BARE :focus-visible rule exists, not an element-scoped one", () => {
  assert.ok(hasBareFocusVisible(CSS),
    "no bare :focus-visible — buttons and links fall through to the UA default ring");
});

test("F-35: the bare rule routes through the token and does not hardcode a hex", () => {
  const body = blockFor(CSS, ":focus-visible");
  assert.match(body, /outline\s*:[^;]*var\(\s*--focus-ring\s*\)/, "ring is not tokenised");
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,6}/, "bare rule hardcodes a hex");
});

test("F-35 ratchet: page-level drift must not exceed the 20 enumerated at abdc64f", () => {
  const n = countDriftingFocusRules(HTML);
  assert.ok(n <= 20,
    `${n} page-level :focus-visible rules bypass --focus-ring, baseline is 20. ` +
    `A new one was added — route it through var(--focus-ring).`);
});

/* ── F-36 ── */

test("F-36: --font-size-body and the body rule cannot diverge", () => {
  const token = tokenIn(CSS, ":root", "--font-size-body");
  assert.equal(token, "17px", `token is ${token}`);
  const body = blockFor(CSS, "body");
  assert.match(body, /font-size\s*:\s*var\(\s*--font-size-body\s*\)/,
    "body restates a literal instead of reading the token — the two can drift again");
});

/* ── NEGATIVE CONTROLS — every guard above must be able to fail ── */

test("NC-1: a --focus-ring that exists only inside a comment is NOT counted", () => {
  const fake = `:root {\n  /* --focus-ring: #D4AF37; */\n  --bg: #FFFFFF;\n}`;
  assert.equal(tokenIn(fake, ":root", "--focus-ring"), null,
    "comment stripping failed — this is guard-discipline instance 3 recurring");
});

test("NC-2: gold-on-dark is caught by the contrast check", () => {
  assert.ok(contrast("#D4AF37", "#0B0B0D") >= 3.0, "sanity: gold on near-black is high contrast");
  assert.ok(contrast("#D4AF37", "#D4AF37") < 3.0, "a ring on its own colour must fail");
  assert.ok(contrast("#141417", "#0B0B0D") < 3.0, "near-identical darks must fail");
});

test("NC-3: an element-scoped-only focus rule fails the bare-selector check", () => {
  const fake = `input:focus-visible, select:focus-visible { outline: 2px solid var(--focus-ring); }`;
  assert.equal(hasBareFocusVisible(fake), false, "element-scoped rule wrongly accepted as bare");
});

test("NC-4: a divergent body size is detected", () => {
  const fake = `:root { --font-size-body: 16px; }\nbody { font-size: 17px; }`;
  assert.equal(tokenIn(fake, ":root", "--font-size-body"), "16px");
  assert.doesNotMatch(blockFor(fake, "body"), /var\(\s*--font-size-body\s*\)/,
    "a literal body size must not read as tokenised");
});

test("NC-5: the drift ratchet counts real rules and rejects going over baseline", () => {
  const conforming = `<style>.a:focus-visible { outline: 2px solid var(--focus-ring); }</style>`;
  const drifting = `<style>.b:focus-visible { outline: 2px solid var(--primary); }</style>`;
  assert.equal(countDriftingFocusRules([conforming]), 0, "conforming rule wrongly counted");
  assert.equal(countDriftingFocusRules([drifting]), 1, "drifting rule not counted");
  assert.equal(countDriftingFocusRules(Array(21).fill(drifting)), 21);
  assert.ok(21 > 20, "21 exceeds the baseline, so the ratchet above would fail — as intended");
});

test("NC-6: prose mentioning focus-visible in an HTML comment is not counted as a rule", () => {
  const prose = `<!-- 44px targets · focus-visible everywhere. outline: 2px solid var(--primary); -->
                 <style>.c:focus-visible { outline: 2px solid var(--focus-ring); }</style>`;
  assert.equal(countDriftingFocusRules([prose]), 0,
    "an HTML comment was scored as a rule — the exact trap admin-facility.html line 6 sets");
});
