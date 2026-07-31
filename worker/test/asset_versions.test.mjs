/**
 * asset_versions.test.mjs · v1.0 · 2026-07-31 · Ships in: v0.41.0
 *
 * Guards the SINGLE shared cache-buster convention adopted in v0.41.0.
 *
 * WHY: before v0.41.0 the web pages carried 31 different `?v=` values (0.3.0 … 2.13).
 * Three pages still pinned `?v=0.3.0` on tokens.css — a URL a browser may hold cached
 * from BEFORE the F-35 focus-ring / F-36 body-size fixes shipped in tokens.css v0.4.0.
 * That is recurring failure class 2 (a convention recorded nowhere is in force nowhere)
 * and class 3 (any per-file check would have reported clean). This guard scans the
 * WIDEST set: every web/*.html and every web/assets/*.js.
 *
 * THE CONVENTION (record of decision, v0.41.0):
 *   - Every `?v=` buster in web/ carries ONE shared value in release form (\d+.\d+.\d+).
 *   - A buster is a CACHE KEY, not the referenced file's version. Page/JS header
 *     versions do not move on a buster-only sweep; the shared value is the sweep marker.
 *   - Bump procedure when any web asset changes in a release:
 *       sed -i 's,?v=[0-9][0-9.]*,?v=X.Y.Z,g' web/*.html web/assets/*.js
 *     (comma-delimited on purpose — a slash-delimited pattern would embed the
 *     comment-terminator sequence and break this very header)
 *     then this test's EXPECTED_FORM still passes and the all-identical check
 *     self-verifies the sweep reached every file.
 *
 * COMMENT HANDLING: HTML comments are stripped before collection (the tokens.test.mjs
 * lesson — prose must never satisfy or pollute a scanner). For JS only BLOCK comments
 * are stripped; a buster in a `//` line comment WOULD be counted. That direction is
 * deliberate: over-counting can only make the guard fail loud, never report clean.
 * NC-2 proves stripped comments are invisible; NC-3 proves an empty corpus cannot pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB_DIR = new URL("../../web/", import.meta.url);
const ASSETS_DIR = new URL("../../web/assets/", import.meta.url);

/* ── pure helpers — the real corpus and every negative control go through these ── */

const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
const stripJsBlockComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** All `?v=` buster values in already-stripped text, in order. */
const collectBusters = (s) => [...s.matchAll(/\?v=([0-9][0-9.]*)/g)].map((m) => m[1]);

/**
 * Audit a corpus: Map<filename, strippedText> → { withBusters, total, values }.
 * No assertions here — callers decide pass/fail so NCs can assert failure.
 */
function auditCorpus(corpus) {
  let total = 0;
  const values = new Set();
  const withBusters = [];
  for (const [name, text] of corpus) {
    const found = collectBusters(text);
    if (found.length > 0) withBusters.push(name);
    total += found.length;
    for (const v of found) values.add(v);
  }
  return { withBusters, total, values };
}

/** Throws unless the corpus satisfies the v0.41.0 convention. */
function assertConvention(audit) {
  assert.ok(audit.withBusters.length >= 40,
    `guard floor: expected >=40 files carrying busters, saw ${audit.withBusters.length} — ` +
    `an empty or mis-pathed scan must fail, not pass (failure class 4)`);
  assert.ok(audit.total >= 120,
    `guard floor: expected >=120 buster occurrences, saw ${audit.total}`);
  assert.equal(audit.values.size, 1,
    `all busters must share ONE value; saw ${audit.values.size}: ${[...audit.values].join(", ")}`);
  const only = [...audit.values][0];
  assert.match(only, /^\d+\.\d+\.\d+$/,
    `shared buster must be release-form X.Y.Z, saw "${only}"`);
}

/* ── real corpus ── */

function realCorpus() {
  const corpus = new Map();
  for (const f of readdirSync(WEB_DIR)) {
    if (f.endsWith(".html")) {
      corpus.set(f, stripHtmlComments(readFileSync(new URL(f, WEB_DIR), "utf8")));
    }
  }
  for (const f of readdirSync(ASSETS_DIR)) {
    if (f.endsWith(".js")) {
      corpus.set(`assets/${f}`, stripJsBlockComments(readFileSync(new URL(f, ASSETS_DIR), "utf8")));
    }
  }
  return corpus;
}

test("every ?v= buster across web/ shares one release-form value", () => {
  assertConvention(auditCorpus(realCorpus()));
});

test("the widest-set guard actually covers the critical surfaces", () => {
  const audit = auditCorpus(realCorpus());
  for (const must of ["index.html", "admin.html", "assets/site-nav.js", "assets/admin-nav.js"]) {
    assert.ok(audit.withBusters.includes(must),
      `${must} must be in the scanned-with-busters set — if it vanished, the guard narrowed (failure class 3)`);
  }
});

/* ── negative controls — mutate REAL input and prove the guard can fail ── */

test("NC-1: one drifted buster in the real corpus fails the all-identical check", () => {
  const corpus = realCorpus();
  const [name, text] = [...corpus.entries()].find(([, t]) => collectBusters(t).length > 0);
  corpus.set(name, text.replace(/\?v=[0-9][0-9.]*/, "?v=9.9.9")); // first occurrence only
  assert.throws(() => assertConvention(auditCorpus(corpus)),
    /ONE value/, "a single drifted buster must fail loud");
});

test("NC-2: a buster that exists only inside an HTML comment is invisible", () => {
  const commented = stripHtmlComments(`<!-- <link href="assets/app.css?v=0.0.1"> -->`);
  assert.deepEqual(collectBusters(commented), [],
    "comment-only busters must not be collected (tokens.test.mjs lesson)");
});

test("NC-3: an empty corpus cannot pass — a guard that scans nothing is no guard", () => {
  assert.throws(() => assertConvention(auditCorpus(new Map())), /guard floor/);
});

test("NC-4: a non-release-form shared value fails even when unanimous", () => {
  const corpus = new Map();
  for (let i = 0; i < 45; i++) {
    corpus.set(`f${i}.html`, `<link href="a.css?v=2.8">`.repeat(3));
  }
  assert.throws(() => assertConvention(auditCorpus(corpus)), /release-form/);
});
