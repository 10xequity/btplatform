/**
 * Boomtown Platform — shared-button-set guard
 * File: worker/test/shared_buttons.test.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.51.0
 *
 * WHY: uiux-review §4 named per-page redefinitions of the shared button classes as the root
 * cause of buttons drifting page to page (admin-calendar/admin-tiers redefined .btn/.ghost/
 * .danger/.sm; guardian-complete redefined .btn.primary; facility/lfg/profile carried stray
 * .btn/.btn:active copies). v0.51.0 deleted them all and made app.css the ONE shared set
 * (.btn + .ghost/.primary/.danger/.sm/.small). This guard keeps them deleted.
 *
 * RULE: inside any page-level <style> block, a selector may not START with `.btn` — that is a
 * redefinition of the shared class. Descendant-scoped rules (`.faq-actions .btn`,
 * `.g-wrap .btn.primary`) are page layout and stay legal. Scans the WIDEST set (every
 * web/*.html, whether or not it loads the shared nav), counts its own corpus, and the NC
 * mutates a real page by injecting exactly the rule this guard exists to block.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB_DIR = new URL("../../web/", import.meta.url);

/* ── pure verdicts — the real corpus and the NCs go through the same code ── */

/** All <style>…</style> bodies in a page. */
const styleBlocks = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

/** Selectors that START with .btn (redefinitions). Comments stripped; declarations ignored. */
export function btnRedefinitions(css) {
  const flat = css
    .replace(/\/\*[\s\S]*?\*\//g, "")      // comments are not rules
    .replace(/@media[^{]*\{/g, "");        // unwrap media preludes so inner selectors surface
  const out = [];
  // selector = text between a rule boundary and '{'. Split on '}' so each chunk leads with selectors.
  for (const chunk of flat.split("}")) {
    const brace = chunk.indexOf("{");
    if (brace === -1) continue;
    const selectors = chunk.slice(0, brace).split(",").map((s) => s.trim()).filter(Boolean);
    for (const sel of selectors) {
      // `.btn` then end/combinator/pseudo/attr — NOT a hyphenated other class (.btn-min is its own class)
      if (/^\.btn($|[.:[\s])/.test(sel)) out.push(sel);
    }
  }
  return out;
}

function auditPage(html) {
  const hits = [];
  for (const css of styleBlocks(html)) hits.push(...btnRedefinitions(css));
  return hits;
}

function corpus() {
  const out = new Map();
  for (const f of readdirSync(WEB_DIR)) {
    if (!f.endsWith(".html")) continue;
    out.set(f, readFileSync(new URL(f, WEB_DIR), "utf8"));
  }
  return out;
}

/* ── the guard ── */

test("no page-level <style> redefines the shared .btn classes (widest set, self-counted)", () => {
  const pages = corpus();
  assert.ok(pages.size >= 27, `corpus shrank: ${pages.size} pages scanned (v0.51.0 set is 27+ member+admin pages)`);
  const offenders = [];
  for (const [name, html] of pages) {
    const hits = auditPage(html);
    if (hits.length) offenders.push(`${name}: ${hits.join(" · ")}`);
  }
  assert.deepEqual(offenders, [], "shared button classes are redefined per-page:\n" + offenders.join("\n"));
});

test("the shared set itself defines every variant the pages use", () => {
  const app = readFileSync(new URL("assets/app.css", WEB_DIR), "utf8");
  for (const sel of [".btn {", ".btn.ghost", ".btn.primary", ".btn.danger", ".btn.sm, .btn.small"]) {
    assert.ok(app.includes(sel), `app.css lost the shared ${sel} rule`);
  }
});

/* ── negative controls — prove the guard can fail ── */

test("NC-1: injecting a bare .btn redefinition into a real page is caught", () => {
  const [name, html] = [...corpus()].find(([, h]) => h.includes("<style>"));
  assert.ok(name, "no page with a <style> block found");
  const mutated = html.replace("<style>", "<style>\n    .btn { background: red; }");
  const hits = auditPage(mutated);
  assert.ok(hits.includes(".btn"), `NC failed on ${name}: the injected redefinition was not detected`);
});

test("NC-2: a variant redefinition (.btn.danger) is caught, a scoped rule is not", () => {
  assert.deepEqual(btnRedefinitions(".btn.danger { color: red; }"), [".btn.danger"]);
  assert.deepEqual(btnRedefinitions(".g-wrap .btn.primary { width: 100%; }"), []);
  assert.deepEqual(btnRedefinitions("@media (max-width: 760px) { .btn:active { transform: none; } }"), [".btn:active"]);
});

test("NC-3: an empty corpus cannot pass (self-count)", () => {
  assert.ok(corpus().size >= 27, "corpus self-count would not have failed loud");
});
