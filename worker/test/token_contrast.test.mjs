/**
 * Boomtown Platform — token contrast-pairing guard
 * File: worker/test/token_contrast.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.82.0
 *
 * WHY. `tokens.test.mjs` ratchets token DRIFT — that a page has not invented its own hex. It says
 * nothing about whether the tokens are legible together, so a foreground/background pair could fall
 * below AA and every gate would stay green. The gold rule (standards §5, uiux-review §1) is the
 * known instance: gold as TEXT on a light surface is about 1.7:1, and the fix in v0.46.0 was
 * `--emphasis` for figures plus `--gold-ink` for ink on a gold fill. That fix has been carried in
 * prose and in comments ever since, with no arithmetic behind it in the suite.
 *
 * This computes the WCAG 2.x relative-luminance ratio for every pairing the design system actually
 * declares, in BOTH themes, and fails on anything under 4.5:1 (3:1 for the focus ring, F-35). The
 * gold rule stops being folklore and becomes a number: the guard asserts both that the permitted
 * pairings pass AND that the forbidden one really is the failure the rule claims — because a rule
 * everyone repeats and nobody measures is how `--emphasis` could have been quietly reverted to raw
 * gold at any point in the last thirty releases without a single test noticing.
 *
 * Values are PARSED from `web/assets/tokens.css`, never restated here. A guard holding its own copy
 * of the palette passes while the shipped palette is wrong, which is the C10 shape: the thing that
 * every other check stands on going unchecked itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../../web/assets/tokens.css", import.meta.url), "utf8");

/* ── colour maths: WCAG 2.x, https://www.w3.org/TR/WCAG21/#dfn-relative-luminance ── */

function rgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  assert.match(h, /^[0-9a-fA-F]{6}$/, `not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const channel = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => { const [r, g, b] = rgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ── read the palette out of the stylesheet ── */

/** Declarations inside one selector block, `--name: value` pairs, comments stripped. */
export function themeTokens(css, selector) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = src.indexOf(selector);
  assert.notEqual(at, -1, `tokens.css no longer has a \`${selector}\` block — the guard is reading nothing`);
  const open = src.indexOf("{", at);
  const block = src.slice(open + 1, src.indexOf("}", open));
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** Resolve `var(--x)` aliases (and `var(--x, fallback)`) down to a literal. */
function resolve(tokens, name, seen = new Set()) {
  const raw = tokens[name];
  assert.ok(raw, `tokens.css declares no ${name}`);
  const v = /^var\(\s*(--[\w-]+)/.exec(raw);
  if (!v) return raw;
  assert.ok(!seen.has(name), `alias cycle at ${name}`);
  seen.add(name);
  return resolve(tokens, v[1], seen);
}

const LIGHT = themeTokens(CSS, ":root");
const DARK = themeTokens(CSS, '[data-theme="dark"]');
/** Dark overrides light — that is how the cascade resolves a page with `data-theme="dark"`. */
const themes = { light: LIGHT, dark: { ...LIGHT, ...DARK } };

/* v1.1 (v0.160.0, §-1j T2-15 / §-0 B13): the four W1 templates join the corpus. Each
   `[data-template="…"]` block is colour-SELF-SUFFICIENT — it declares every colour token
   (theme_tokens.test.mjs enforces that), so spreading over LIGHT alone equals the real cascade
   (:root → mode block → template block) for every colour token; the spread from LIGHT only
   supplies non-colour tokens (shape/type/motion) the pairings never read. themeTokens() itself
   asserts each selector exists, so deleting a block reddens here as well as in the vocabulary
   guard. */
for (const key of ["daylight", "chalk", "midnight", "court-navy"]) {
  themes[key] = { ...LIGHT, ...themeTokens(CSS, `[data-template="${key}"]`) };
}

const AA = 4.5, AA_UI = 3.0;

/**
 * The pairings the system declares. Each is [label, foreground token, background token, floor].
 * Sourced from app.css/admin.css, not invented: `.btn` is --primary-contrast on --primary;
 * `.chip.cash-pending` and every `.ann-cta` is --gold-ink on --accent; body text is --text on --bg.
 */
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
  // F-35: the focus ring is a UI component boundary, so 3:1 is the WCAG floor, not 4.5.
  ["focus ring on page", "--focus-ring", "--bg", AA_UI],
  ["focus ring on surface", "--focus-ring", "--surface", AA_UI],
];

/* ── the corpus ── */

for (const [themeName, tokens] of Object.entries(themes)) {
  test(`${themeName} theme — every declared pairing meets its WCAG floor`, () => {
    const failures = [];
    for (const [label, fg, bg, floor] of PAIRINGS) {
      const ratio = contrast(resolve(tokens, fg), resolve(tokens, bg));
      if (ratio < floor) failures.push(`${label}: ${ratio.toFixed(2)}:1 (needs ${floor}:1)`);
    }
    assert.deepEqual(failures, [], `contrast failures in the ${themeName} theme:\n  ${failures.join("\n  ")}`);
  });
}

test("the gold rule is arithmetic, not folklore — gold AS TEXT on light really does fail", () => {
  // standards §5 / uiux-review §1 claim ~1.7:1 for gold text on a light surface. If that were ever
  // untrue, `--emphasis` and `--gold-ink` would be ceremony rather than a fix, and the next person to
  // read the rule would be entitled to ignore it. Measure it.
  const ratio = contrast(resolve(themes.light, "--accent"), resolve(themes.light, "--bg"));
  assert.ok(ratio < AA, `gold text on light now measures ${ratio.toFixed(2)}:1 — if this passes AA the rule needs rewriting, not obeying`);
  assert.ok(ratio < 2.5, `expected roughly 1.7:1, measured ${ratio.toFixed(2)}:1 — has --accent moved?`);

  // And the sanctioned alternative must be the thing that rescues it.
  const fixed = contrast(resolve(themes.light, "--emphasis"), resolve(themes.light, "--bg"));
  assert.ok(fixed >= AA, `--emphasis is the documented replacement for gold text and measures ${fixed.toFixed(2)}:1`);
});

test("light text on a gold fill is also a failure — the rule's second half", () => {
  // "never light text on gold" is the other clause, and it is the one a page hits by putting a gold
  // background on a `.btn` and leaving `color` alone: the base `.btn` colour in light is #FFF.
  const ratio = contrast(resolve(themes.light, "--primary-contrast"), resolve(themes.light, "--accent"));
  assert.ok(ratio < AA, `white on gold measures ${ratio.toFixed(2)}:1; if it ever passes, revisit the rule`);
});

/* ── negative controls: mutate the REAL stylesheet and prove each verdict can fail ── */

test("NC — reverting --emphasis to raw gold in light reddens the pairing check", () => {
  const broken = CSS.replace("--emphasis: #1B2A4A;", "--emphasis: #E6B800;");
  assert.notEqual(broken, CSS, "the mutation did not apply — this control was testing nothing");
  const tokens = themeTokens(broken, ":root");
  const ratio = contrast(resolve(tokens, "--emphasis"), resolve(tokens, "--bg"));
  assert.ok(ratio < AA, `a gold --emphasis must fail AA on white, measured ${ratio.toFixed(2)}:1`);
});

test("NC — the parser reads real values, so a darkened surface changes the answer", () => {
  // Proves the guard is reading tokens.css rather than a constant: move --surface and the ratio moves.
  const before = contrast(resolve(themes.light, "--text-muted"), resolve(themes.light, "--surface"));
  const broken = themeTokens(CSS.replace("--surface: #F7F7F5;", "--surface: #6A6A6A;"), ":root");
  const after = contrast(resolve(broken, "--text-muted"), resolve(broken, "--surface"));
  assert.notEqual(before.toFixed(2), after.toFixed(2), "the parsed palette is not reaching the maths");
  assert.ok(after < AA, `muted text on a mid-grey surface must fail, measured ${after.toFixed(2)}:1`);
});

test("NC — alias tokens resolve, rather than being skipped as unreadable", () => {
  // --warning and --text-dim are aliases; --ok aliases --positive. If resolve() silently returned the
  // literal string "var(--positive)" the hex parse would throw, not pass — assert it resolves.
  assert.match(resolve(themes.light, "--warning"), /^#[0-9A-Fa-f]{6}$/);
  assert.match(resolve(themes.dark, "--ok"), /^#[0-9A-Fa-f]{6}$/);
  assert.equal(resolve(themes.light, "--warning"), resolve(themes.light, "--warn"));
});
