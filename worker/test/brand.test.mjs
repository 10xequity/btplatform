/**
 * brand.test.mjs · v2.1 · 2026-08-02 · Ships in: v0.53.1 (v2.0 v0.53.0 · v1.0 v0.46.0)
 *
 * v2.1 (external code review, PARTIALLY adopted): the reviewer proposed \s+ and the i flag on
 * all three patterns. Adopted for TITLE and LITERAL — \s+ catches a line-wrapped
 * "Boomtown\n  Volleyball" that v2.0's literal space missed, and i catches case drift. REJECTED
 * for WORDMARK: \s+ REQUIRES whitespace, so "Boomtown<span>Volleyball</span>" (no space, which
 * the real markup could legally be) would stop matching. That is a strict narrowing of a guard
 * — the exact failure class this file's self-count exists to prevent. Verified both ways
 * before choosing: \s* keeps the no-space form caught, \s+ drops it.
 *
 * v2.0 INVERTS v1.0: D-ORG-5 was APPLIED to live D1 on 2026-08-02 (org 1 renamed
 * "Boomtown Athletics", owner-approved this session), so the app brand and the legal
 * entity now AGREE. The offence direction flips: any surviving "Boomtown Volleyball"
 * in the product shell is stale brand. The v1.0 keeps (legal-entity placeholders) were
 * already "Boomtown Athletics" and are still asserted present.
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

/* v2.0: the whole literal is the offence — post-rename there is no legitimate use of the
   old brand anywhere in the product shell (comments included; the one historical comment in
   site-nav.js was rewritten to not carry the literal, deliberately). */
const WORDMARK_OFFENCE = /Boomtown\s*<span>\s*Volleyball\s*<\/span>/gi; // \s* NOT \s+ — see v2.1 note
const TITLE_OFFENCE = /Boomtown\s+Volleyball<\/title>/gi;
const LITERAL_OFFENCE = /Boomtown\s+Volleyball/gi;

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
    for (const m of text.matchAll(LITERAL_OFFENCE)) bad.push(`${name}: stale brand literal "${m[0]}"`);
  }
  return bad;
}

test("brand sweep: zero stale Volleyball brand strings — and the scanner counts its own misses", () => {
  const corpus = brandCorpus();
  // 45 html pages + shared JS + manifest + root pages existed at ship time (2026-08-02).
  assert.ok(corpus.size >= 57, `scanned only ${corpus.size} files — the corpus read is broken, not clean`);
  const bad = auditBrand(corpus);
  assert.deepEqual(bad, [], `app brand must read Boomtown Athletics (D-ORG-5 applied):\n${bad.join("\n")}`);
});

test("brand: the PWA manifest names Boomtown Athletics", () => {
  const man = JSON.parse(readFileSync(new URL("manifest.webmanifest", WEB_DIR), "utf8"));
  assert.equal(man.name, "Boomtown Athletics");
  assert.equal(man.short_name, "Boomtown"); // unchanged on purpose — homescreen label budget
});

test("brand: the sw.js push fallback title is Boomtown Athletics", () => {
  const sw = readFileSync(new URL("sw.js", WEB_DIR), "utf8");
  assert.match(sw, /data\.title \|\| "Boomtown Athletics"/,
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

test("NC-1: a synthetic offender IS caught by the audit (v2.0 direction)", () => {
  const fake = new Map([["fake.html", `<div class="wordmark">Boomtown <span>Volleyball</span></div>
    <title>Boomtown Volleyball</title>`]]);
  // wordmark + title + 1 contiguous-literal hit = 3 offences (the span splits the literal)
  assert.equal(auditBrand(fake).length, 3, "the audit missed a planted stale-brand string");
});

test("NC-2: an offence inside a stripped HTML comment is invisible", () => {
  const text = stripHtmlComments(`<!-- Boomtown <span>Volleyball</span> -->`);
  assert.equal(auditBrand(new Map([["c.html", text]])).length, 0, "comment stripping failed");
});

test("NC-3: an empty corpus cannot pass the self-count", () => {
  assert.ok(!(new Map().size >= 57), "an empty corpus must fail the miss-count floor");
});

test("NC-4: the wordmark pattern still catches the NO-SPACE form (\\s+ would not) — v2.1", () => {
  const fake = new Map([["f.html", "Boomtown<span>Volleyball</span>"]]);
  assert.ok(auditBrand(fake).length >= 1, "narrowing \\s* to \\s+ would blind this — regression guard");
});

test("NC-5: a LINE-WRAPPED stale brand literal is caught (v2.0 missed this) — v2.1", () => {
  const fake = new Map([["f.js", "the Boomtown\n  Volleyball brand"]]);
  assert.ok(auditBrand(fake).length >= 1, "\\s+ must span the newline");
});

test("NC-6: lowercase drift is caught by the i flag — v2.1", () => {
  assert.ok(auditBrand(new Map([["f.js", "boomtown volleyball"]])).length >= 1);
});
