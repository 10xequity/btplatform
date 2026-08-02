/**
 * brand.test.mjs · v1.0 · 2026-08-01 · Ships in: v0.46.0
 *
 * Guards the v0.46.0 app-brand rename: the product shell reads "Boomtown Volleyball"
 * (org 1's display name — owner 2026-08-01); "Boomtown Athletics" remains ONLY as the
 * legal entity (org1.legal_entity, D-ORG record) and in historical code comments.
 *
 * WHAT IS SCANNED (the widest set — library §2 failure class 3):
 *   every web/*.html + web/assets/*.js + web/sw.js + web/widget.js + web/member.js
 *   + web/manifest.webmanifest + the repo-root index.html and 404.html.
 * WHAT IS ASSERTED:
 *   - zero "Boomtown <span>Athletics</span>" wordmarks
 *   - zero "Boomtown Athletics</title>" titles
 *   - the PWA manifest name is "Boomtown Volleyball"
 *   - the sw.js push fallback title is "Boomtown Volleyball"
 * WHAT IS DELIBERATELY NOT ASSERTED (the keeps):
 *   - admin-marketing.html mailAddr placeholder (CAN-SPAM postal identity = legal entity)
 *   - admin-org-settings.html legal-entity placeholder ("Boomtown Athletics, LLC")
 *   - web/profile.js WAIVER_TEXT (legal placeholder; waiver system is CLOSED, standards §10)
 *   - worker/src comments describing F-10 history
 *   None of those match the two patterns above, so no allow-list is needed — the patterns
 *   themselves define the boundary between brand (swept) and legal entity (kept).
 *
 * THE SCANNER COUNTS ITS OWN MISSES (the v0.45 lesson): a corpus materially smaller than
 * the tree that existed at ship time fails loud instead of reporting clean. HTML comments
 * are stripped (the tokens.test.mjs lesson); for JS only block comments are stripped, so an
 * offence in a `//` line comment still counts — over-counting can only fail loud.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB_DIR = new URL("../../web/", import.meta.url);
const ASSETS_DIR = new URL("../../web/assets/", import.meta.url);
const ROOT_DIR = new URL("../../", import.meta.url);

const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
const stripJsBlockComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const WORDMARK_OFFENCE = /Boomtown\s*<span>\s*Athletics\s*<\/span>/g;
const TITLE_OFFENCE = /Boomtown Athletics<\/title>/g;

/** Map<name, strippedText>. Pure over the fs reads so NCs can feed synthetic corpora. */
function brandCorpus() {
  const corpus = new Map();
  for (const f of readdirSync(WEB_DIR).filter((f) => f.endsWith(".html"))) {
    corpus.set("web/" + f, stripHtmlComments(readFileSync(new URL(f, WEB_DIR), "utf8")));
  }
  for (const f of readdirSync(WEB_DIR).filter((f) => f.endsWith(".js") || f === "manifest.webmanifest")) {
    corpus.set("web/" + f, stripJsBlockComments(readFileSync(new URL(f, WEB_DIR), "utf8")));
  }
  for (const f of readdirSync(ASSETS_DIR).filter((f) => f.endsWith(".js"))) {
    corpus.set("web/assets/" + f, stripJsBlockComments(readFileSync(new URL(f, ASSETS_DIR), "utf8")));
  }
  for (const f of ["index.html", "404.html"]) {
    corpus.set(f, stripHtmlComments(readFileSync(new URL(f, ROOT_DIR), "utf8")));
  }
  return corpus;
}

/** name → offences. No assertions here — callers decide, so NCs can assert failure. */
function auditBrand(corpus) {
  const bad = [];
  for (const [name, text] of corpus) {
    for (const m of text.matchAll(WORDMARK_OFFENCE)) bad.push(`${name}: wordmark "${m[0]}"`);
    for (const m of text.matchAll(TITLE_OFFENCE)) bad.push(`${name}: title "${m[0]}"`);
  }
  return bad;
}

test("brand sweep: zero Athletics wordmarks/titles — and the scanner counts its own misses", () => {
  const corpus = brandCorpus();
  // 43 html pages + shared JS + manifest + root pages existed at ship time (2026-08-01).
  assert.ok(corpus.size >= 55, `scanned only ${corpus.size} files — the corpus read is broken, not clean`);
  const bad = auditBrand(corpus);
  assert.deepEqual(bad, [], `app brand must read Boomtown Volleyball:\n${bad.join("\n")}`);
});

test("brand: the PWA manifest names Boomtown Volleyball", () => {
  const man = JSON.parse(readFileSync(new URL("manifest.webmanifest", WEB_DIR), "utf8"));
  assert.equal(man.name, "Boomtown Volleyball");
  assert.equal(man.short_name, "Boomtown"); // unchanged on purpose — homescreen label budget
});

test("brand: the sw.js push fallback title is Boomtown Volleyball", () => {
  const sw = readFileSync(new URL("sw.js", WEB_DIR), "utf8");
  assert.match(sw, /data\.title \|\| "Boomtown Volleyball"/,
    "push notifications with no title must fall back to the app brand");
});

test("brand: the legal-entity keeps are still present (the sweep must NOT have eaten them)", () => {
  const marketing = readFileSync(new URL("admin-marketing.html", WEB_DIR), "utf8");
  assert.match(marketing, /Boomtown Athletics, \[STREET ADDRESS\]/,
    "the CAN-SPAM postal-identity placeholder is the LEGAL entity and must survive brand sweeps");
  const settings = readFileSync(new URL("admin-org-settings.html", WEB_DIR), "utf8");
  assert.match(settings, /Boomtown Athletics, LLC/,
    "the legal-entity example placeholder must survive brand sweeps");
});

test("NC-1: a synthetic offender IS caught by the audit", () => {
  const fake = new Map([["fake.html", `<div class="wordmark">Boomtown <span>Athletics</span></div>
    <title>X — Boomtown Athletics</title>`]]);
  assert.equal(auditBrand(fake).length, 2, "the audit missed a planted wordmark/title");
});

test("NC-2: an offence inside a stripped HTML comment is invisible", () => {
  const text = stripHtmlComments(`<!-- Boomtown <span>Athletics</span> -->`);
  assert.equal(auditBrand(new Map([["c.html", text]])).length, 0, "comment stripping failed");
});

test("NC-3: an empty corpus cannot pass the self-count", () => {
  assert.ok(!(new Map().size >= 55), "an empty corpus must fail the miss-count floor");
});
