/**
 * Boomtown Platform — button-vocabulary guard
 * File: worker/test/button_vocabulary.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.82.0
 *
 * WHY THIS EXISTS. The owner reported "many of the buttons text is not colored properly." It was
 * neither a token bug nor a contrast bug. Twenty-four buttons — thirteen in `admin-pos.html`, eleven
 * in `admin-pos.js` — shipped as `class="primary"`, `class="ghost"` and `class="secondary"` with no
 * `btn`. Those three words are not standalone classes anywhere in the CSS: app.css declares them as
 * `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.btn.sm`, `.btn.small`. A modifier without its base
 * inherits nothing, so each of those buttons rendered as a user-agent default control — grey face,
 * black text — in both themes. Present since the page's first commit (083cb32); never a regression.
 *
 * IT PASSED EVERY GATE WE HAD, AND THAT IS THE POINT.
 *   · `tokens.test.mjs` ratchets token drift — these buttons referenced no token, so there was
 *     nothing to drift. A page can fail by using NOTHING, and a drift guard cannot see that.
 *   · `shared_buttons.test.mjs` forbids page-level selectors that START with `.btn` — it polices
 *     REDEFINING the shared set. These pages never redefined it; they failed to USE it. The guard
 *     was aimed one inch to the left of the defect.
 *   · No contrast guard existed, and one would not have caught this either: there is no declared
 *     foreground/background pair to measure when the rule sets `min-height` and nothing else.
 * That is the C10 class from `docs/INDEX.md` — not a guard narrower than its subject, but the
 * ABSENCE of a guard over it. Absences never go red.
 *
 * THE RULE. A `<button>` or `<a>` carrying any of app.css's `.btn` modifiers must also carry `btn`.
 * The one honest exception is a modifier that the page styles itself through a descendant selector
 * that actually sets a colour — `admin-uploads.html` does exactly that with
 * `.up-row-actions .danger { color: var(--danger) }`, and its `class="danger"` button is correct.
 * "Sets a colour" is the whole distinction: `admin-pos.html` also mentioned `button.ghost` in its
 * style block, but only to set `min-height`, which is why mentioning the class is not enough.
 *
 * The modifier list is PARSED from app.css rather than hardcoded, so adding `.btn.warning` tomorrow
 * extends this guard automatically instead of quietly escaping it.
 *
 * Scans the widest set: every `web/*.html` and every `web/assets/*.js`. A script that ships button
 * markup is as capable of shipping an unstyled button as a page is — eleven of the twenty-four were
 * in a `.js` file, and a guard that read only HTML would have reported the page clean and been half
 * right, which is the failure mode `shared_buttons.test.mjs` already demonstrated once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = fileURLToPath(new URL("../../web/", import.meta.url));
const ASSETS = join(WEB, "assets");
const APP_CSS = readFileSync(join(ASSETS, "app.css"), "utf8");

const pages = readdirSync(WEB).filter((f) => f.endsWith(".html"));
const scripts = readdirSync(ASSETS).filter((f) => f.endsWith(".js"));

/* ── pure verdicts: the real corpus and the negative controls go through the same code ── */

/**
 * The modifier vocabulary, read out of app.css. Any selector of the shape `.btn.<name>` contributes
 * `<name>`. Derived, not listed, so the guard cannot go stale behind a new variant.
 */
export function btnModifiers(css) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set();
  for (const m of flat.matchAll(/\.btn\.([A-Za-z][\w-]*)/g)) found.add(m[1]);
  return found;
}

/** Every `class="…"` on a `<button>` or `<a>`, single or double quoted. */
function classLists(src) {
  const out = [];
  for (const m of src.matchAll(/<(button|a)\b[^>]*class\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    out.push({ tag: m[1].toLowerCase(), classes: (m[3] ?? m[4] ?? "").split(/\s+/).filter(Boolean) });
  }
  return out;
}

/**
 * The classes a selector demands of the element it matches — its last compound, stripped of
 * pseudo-classes and attribute selectors. `.up-row-actions .danger` → {danger};
 * `.btn-min.primary` → {btn-min, primary}; `.pos-tab[aria-selected="true"]` → {pos-tab}.
 */
function requiredClasses(sel) {
  const last = sel.trim().split(/[\s>+~]+/).filter(Boolean).pop() || "";
  const cleaned = last.replace(/\[[^\]]*\]/g, "").replace(/::?[\w-]+(\([^)]*\))?/g, "");
  return new Set([...cleaned.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
}

/**
 * Every rule in this stylesheet that actually sets a text colour, as the set of classes it needs.
 *
 * Two things this deliberately does NOT do. It ignores rules that set no `color`, because a rule
 * that only sets geometry does not make a button legible — that is precisely the hole the real bug
 * fell through, since `admin-pos.html` did name `button.ghost`, only to give it `min-height`. And it
 * ignores rules whose last compound carries no class at all (`button:active`, `body`), because
 * inheriting a page's body colour onto a user-agent button face is the bug, not the fix.
 */
export function colourRules(css) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
  const rules = [];
  for (const chunk of flat.split("}")) {
    const brace = chunk.indexOf("{");
    if (brace === -1) continue;
    // `[;\s]` before `color` is what keeps `border-color` and `background-color` out.
    if (!/(^|[;\s])color\s*:/.test(chunk.slice(brace + 1))) continue;
    for (const sel of chunk.slice(0, brace).split(",")) {
      const req = requiredClasses(sel);
      if (req.size) rules.push(req);
    }
  }
  return rules;
}

/** Does some colour rule's full class requirement sit inside this element's class list? */
const isColoured = (classes, rules) => rules.some((r) => [...r].every((c) => classes.includes(c)));

/** Same question, spelled for the controls below: given raw CSS rather than parsed rules. */
const isColouredForTest = (classes, css) => isColoured(classes, colourRules(css));

const styleBlocks = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");

/**
 * Offences in one file. `pageCss` is the style block of the page this markup renders into — for a
 * shared script that belongs to no single page it is empty, which is correct: a shared script cannot
 * lean on one page's rules.
 */
export function unstyledModifierUses(src, pageCss, modifiers) {
  const rules = colourRules(pageCss);
  const bad = [];
  for (const { tag, classes } of classLists(src)) {
    if (classes.includes("btn")) continue;                       // uses the shared set, nothing to prove
    if (!classes.some((c) => modifiers.has(c))) continue;        // borrows no shared modifier
    if (isColoured(classes, rules)) continue;                    // the page colours it itself
    bad.push(`<${tag} class="${classes.join(" ")}">`);
  }
  return bad;
}

/** `assets/admin-pos.js` renders into `admin-pos.html`; a shared script maps to nothing. */
function pageCssFor(scriptName) {
  const sibling = join(WEB, scriptName.replace(/\.js$/, ".html"));
  return existsSync(sibling) ? styleBlocks(readFileSync(sibling, "utf8")) : "";
}

/* ── the corpus ── */

test("app.css still defines a .btn modifier vocabulary for this guard to read", () => {
  const mods = btnModifiers(APP_CSS);
  // If this ever empties, every assertion below passes vacuously — the guard would report clean by
  // knowing nothing. Pin the ones the shared set is documented to carry (app.css header, v0.51.0).
  for (const expected of ["ghost", "primary", "danger", "sm", "small"]) {
    assert.ok(mods.has(expected), `app.css no longer declares .btn.${expected} — has the shared set moved?`);
  }
});

test("no shipped page uses a .btn modifier without the btn base", () => {
  const mods = btnModifiers(APP_CSS);
  const offences = [];
  for (const p of pages) {
    const html = readFileSync(join(WEB, p), "utf8");
    for (const b of unstyledModifierUses(html, styleBlocks(html), mods)) offences.push(`${p}  ${b}`);
  }
  assert.equal(offences.length, 0,
    `buttons carrying a shared modifier with no shared base — they render as user-agent defaults:\n  ${offences.join("\n  ")}`);
  assert.ok(pages.length >= 50, `only ${pages.length} pages scanned — the corpus shrank, so a clean result means less`);
});

test("no shipped script emits a .btn modifier without the btn base", () => {
  const mods = btnModifiers(APP_CSS);
  const offences = [];
  for (const s of scripts) {
    const src = blankComments(readFileSync(join(ASSETS, s), "utf8")); // D-45: button markup in a comment is not a button
    for (const b of unstyledModifierUses(src, pageCssFor(s), mods)) offences.push(`assets/${s}  ${b}`);
  }
  assert.equal(offences.length, 0,
    `scripts emitting a shared modifier with no shared base:\n  ${offences.join("\n  ")}`);
  assert.ok(scripts.length >= 50, `only ${scripts.length} scripts scanned — the corpus shrank`);
});

/* ── negative controls: mutate the REAL input and prove each verdict can fail ── */

test("NC — stripping `btn` from a real button in a real page is caught", () => {
  const mods = btnModifiers(APP_CSS);
  const html = readFileSync(join(WEB, "admin-pos.html"), "utf8");
  assert.equal(unstyledModifierUses(html, styleBlocks(html), mods).length, 0, "admin-pos.html should be clean now");

  const broken = html.replace('class="btn ghost" id="sellClear"', 'class="ghost" id="sellClear"');
  assert.notEqual(broken, html, "the mutation did not apply — this control was testing nothing");
  const caught = unstyledModifierUses(broken, styleBlocks(broken), mods);
  assert.equal(caught.length, 1, "the guard must see exactly the button that lost its base");
  assert.match(caught[0], /class="ghost"/);
});

test("NC — a geometry-only page rule does NOT earn the exemption", () => {
  // This is the specific hole the real bug fell through: `admin-pos.html` DID name `button.ghost` in
  // its own style block, but only to set min-height. If mentioning the class were enough, this guard
  // would have shipped green over the very defect it was written for.
  const mods = new Set(["ghost"]);
  const geometryOnly = "<style>button.ghost { min-height: 44px; }</style>";
  const markup = '<button class="ghost" id="x">Clear</button>';
  assert.equal(unstyledModifierUses(markup, styleBlocks(geometryOnly), mods).length, 1,
    "min-height alone must not exempt a modifier — it does not make the text legible");

  const coloured = "<style>.row .ghost { color: var(--text); }</style>";
  assert.equal(unstyledModifierUses(markup, styleBlocks(coloured), mods).length, 0,
    "a descendant rule that sets a colour is the legitimate exception and must be honoured");
});

test("NC — the descendant exemption is real, not a blanket pass", () => {
  // admin-uploads ships `class="danger"` with no base and is CORRECT: `.up-row-actions .danger`
  // colours it. Proven positively, so the exemption is not just asserted in a comment.
  const mods = btnModifiers(APP_CSS);
  const uploadsCss = styleBlocks(readFileSync(join(WEB, "admin-uploads.html"), "utf8"));
  assert.ok(isColouredForTest(["danger"], uploadsCss),
    "admin-uploads.html must still colour .danger through a descendant rule");
  const src = readFileSync(join(ASSETS, "admin-uploads.js"), "utf8");
  assert.ok(/class="danger"/.test(src), "the fixture for this control moved — admin-uploads.js no longer has it");
  assert.equal(unstyledModifierUses(src, uploadsCss, mods).length, 0);

  // And strip the colour: the same button must now be flagged.
  const stripped = uploadsCss.replace(
    ".up-row-actions .danger { color: var(--danger); border-color: var(--danger); }", "");
  assert.notEqual(stripped, uploadsCss, "the mutation did not apply");
  assert.equal(unstyledModifierUses(src, stripped, mods).length, 1,
    "with its colour rule gone the button is an unstyled default and must be caught");
});
