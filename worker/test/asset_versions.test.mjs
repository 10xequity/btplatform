/**
 * asset_versions.test.mjs · v1.3 · 2026-08-04 · Ships in: (no bump)
 * (v1.2 2026-08-04, v0.84.0 · v1.1 2026-08-02, v0.49.1 · v1.0 2026-07-31, v0.41.0)
 *
 * v1.3: **C6 CLOSED.** For thirty-one releases this guard asserted the busters were ONE value and
 * never that they were the CURRENT one, so a release that bumped `index.js` and swept nothing stayed
 * green — which is exactly what v0.55.0 did. C13 and C14 both widened WHAT is scanned and left WHAT IS
 * ASSERTED untouched; this closes that half. The version is parsed by `versionFromIndex` from
 * `worker/scripts/sweep-buster.mjs` — one parser, because a second copy of that regex is the C1/C15
 * shape. The CORPUS stays this file's own and shares nothing with the script's walk (C14).
 *
 * v1.2: the corpus now includes the REPO ROOT. `404.html` ships from there, carries busters, and was
 * stale at ?v=0.74.0 for ten releases while this guard reported clean — it was scanning `web/` and
 * the file was one directory up. Same defect as migrations 0004–0007 at `db/` root (standards §11).
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
import { versionFromIndex } from "../scripts/sweep-buster.mjs";

const WEB_DIR = new URL("../../web/", import.meta.url);
const ASSETS_DIR = new URL("../../web/assets/", import.meta.url);
const ROOT_DIR = new URL("../../", import.meta.url);

/* ── pure helpers — the real corpus and every negative control go through these ── */

const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
const stripJsBlockComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** All `?v=` buster values in already-stripped text, in order. */
const collectBusters = (s) => [...s.matchAll(/\?v=([0-9][0-9.]*)/g)].map((m) => m[1]);

/** v1.1: local asset refs (src/href="assets/*.js|css") WITHOUT a buster, in already-stripped HTML.
 *  The v0.49.1 lesson: the sweep sed only rewrites `?v=` that already exists — 65 bare refs
 *  (tokens.css/app.css on ~30 pages, four admin-pos scripts, guardian-complete, help) were
 *  invisible to v1.0, which audits busters, not references (failure class 3: a guard narrower
 *  than its subject reports clean). This collector scans the REFERENCE set. */
const collectBareRefs = (s) =>
  [...s.matchAll(/(?:src|href)="(assets\/[^"?]+\.(?:js|css))"/g)].map((m) => m[1]);

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
  /* v1.2 (v0.84.0): THE REPO ROOT, which this guard could not see for ten releases.
     `404.html` lives at the root because GitHub Pages serves it for any missing path, and it
     references `/btplatform/web/assets/tokens.css?v=…`. It sat at `?v=0.74.0` while every file
     under `web/` moved to 0.83.0, and this guard reported clean the whole time — it was scanning
     `web/` and the stale file was one directory up. Nobody had narrowed the guard; the file was
     simply never inside it.

     That is the SAME defect standards §11 records for migrations 0004–0007, which sat at `db/`
     root while `schema_gate.test.mjs` scanned only `db/migrations/`. A file's location is part of
     whether a guard can see it, and "we scan the widest set" has to mean the widest set that
     SHIPS, not the widest directory somebody remembered to name. */
  for (const f of readdirSync(ROOT_DIR)) {
    if (f.endsWith(".html")) {
      corpus.set(`/${f}`, stripHtmlComments(readFileSync(new URL(f, ROOT_DIR), "utf8")));
    }
  }
  return corpus;
}

test("every ?v= buster across web/ shares one release-form value", () => {
  assertConvention(auditCorpus(realCorpus()));
});

/* ══════════════════════ C6, CLOSED (2026-08-04) ══════════════════════
   For thirty-one releases this guard asserted the busters were ONE value and never that they were the
   CURRENT one. So v0.55.0 changed `build-status.js` with no sweep and stayed green — a cached browser
   would have kept serving the old tester copy, and that release's fix would not have reached anyone.
   The register recorded it as C6 in v0.56.0 and it outlived C13 and C14, both of which widened WHAT is
   scanned and left WHAT IS ASSERTED exactly as it was.

   The version is parsed by `versionFromIndex` from sweep-buster.mjs — ONE parser, deliberately. A
   second local copy of that regex is the C1/C15 shape: a duplicate that agrees today and drifts later.
   The CORPUS, though, is this file's own (readdirSync over three URL roots) and shares nothing with
   the script's walk — that separation is C14 and it is the half that must stay independent. */
test("C6: the one shared buster value IS the version index.js reports", () => {
  const version = versionFromIndex(readFileSync(new URL("../src/index.js", import.meta.url), "utf8"));
  assert.match(version, /^\d+\.\d+\.\d+$/, "index.js does not carry a parseable version");

  const audit = auditCorpus(realCorpus());
  assert.equal(audit.values.size, 1, "precondition: the corpus must be at one value before comparing it");
  const only = [...audit.values][0];
  assert.equal(only, version,
    `busters read ${only} but /api/health reports ${version} — a release touching web/** did not sweep, ` +
    `and a cached browser will keep serving the previous assets`);
});

test("NC: a release that bumped index.js and forgot to sweep is now caught", () => {
  /* The exact v0.55.0 defect, reconstructed against the real corpus: the version moves, the busters do
     not. Under the old "one value" assertion this state was GREEN, which is the whole of C6. */
  const version = versionFromIndex(readFileSync(new URL("../src/index.js", import.meta.url), "utf8"));
  const bumped = version.replace(/^(\d+)\.(\d+)\./, (_, a, b) => `${a}.${Number(b) + 1}.`);
  assert.notEqual(bumped, version, "the NC failed to construct a different version");

  const audit = auditCorpus(realCorpus());
  const only = [...audit.values][0];
  // The old assertion still passes on this state — that is the point.
  assert.equal(audit.values.size, 1, "the corpus is still internally consistent, as it was in v0.55.0");
  assert.notEqual(only, bumped,
    "NC FAILED: an unswept release would compare equal, so the C6 assertion above proves nothing");
});

test("the widest-set guard actually covers the critical surfaces", () => {
  const audit = auditCorpus(realCorpus());
  for (const must of ["index.html", "admin.html", "assets/site-nav.js", "assets/admin-nav.js"]) {
    assert.ok(audit.withBusters.includes(must),
      `${must} must be in the scanned-with-busters set — if it vanished, the guard narrowed (failure class 3)`);
  }
});

test("v1.2: the repo-root pages are inside the guard, not one directory outside it", () => {
  // Pinned as its own assertion rather than folded into the list above, because the failure it
  // prevents is not "a file changed" but "a shipped file was never in the corpus at all". An
  // absence reports clean, so it has to be asserted positively.
  const audit = auditCorpus(realCorpus());
  assert.ok(audit.withBusters.includes("/404.html"),
    "404.html ships from the repo root and carries busters — it was stale from v0.74.0 to v0.83.0 " +
    "precisely because this corpus stopped at web/");
});

test("NC — a stale buster at the repo root is now caught", () => {
  // The exact regression that hid for ten releases, replayed against the real file. Before v1.2 this
  // corpus returned one value and passed; the mutation had to be invisible for the bug to exist.
  const corpus = realCorpus();
  const before = auditCorpus(corpus);
  assert.equal(before.values.size, 1, "the real tree should be swept before mutating it");

  const root404 = corpus.get("/404.html");
  assert.ok(root404, "the fixture for this control moved — 404.html is no longer at the repo root");
  corpus.set("/404.html", root404.replace(/\?v=[0-9][0-9.]*/g, "?v=0.74.0"));
  assert.notEqual(corpus.get("/404.html"), root404, "the mutation did not apply");

  const after = auditCorpus(corpus);
  assert.equal(after.values.size, 2, "a root page left behind by the sweep must now fail the guard");
  assert.throws(() => assertConvention(after), /must share ONE value/);
});

test("v1.1: no HTML page references a local js/css asset without a buster", () => {
  const offenders = [];
  let htmlScanned = 0;
  for (const f of readdirSync(WEB_DIR)) {
    if (!f.endsWith(".html")) continue;
    htmlScanned++;
    const bare = collectBareRefs(stripHtmlComments(readFileSync(new URL(f, WEB_DIR), "utf8")));
    for (const ref of bare) offenders.push(`${f} → ${ref}`);
  }
  assert.ok(htmlScanned >= 40,
    `guard floor: expected >=40 HTML pages scanned, saw ${htmlScanned} (failure class 4)`);
  assert.deepEqual(offenders, [],
    `bare (unbustered) asset refs found — the sweep cannot see these:\n  ${offenders.join("\n  ")}`);
});

/* ── negative controls — mutate REAL input and prove the guard can fail ── */

test("NC-5: a real page with its buster stripped from one ref is caught by v1.1", () => {
  // mutate the exact subject line: take a real page, strip ?v= off its first asset ref
  const f = readdirSync(WEB_DIR).find((n) => n.endsWith(".html") &&
    /(?:src|href)="assets\/[^"?]+\.(?:js|css)\?v=/.test(readFileSync(new URL(n, WEB_DIR), "utf8")));
  const mutated = stripHtmlComments(readFileSync(new URL(f, WEB_DIR), "utf8"))
    .replace(/((?:src|href)="assets\/[^"?]+\.(?:js|css))\?v=[0-9][0-9.]*"/, '$1"');
  assert.ok(collectBareRefs(mutated).length >= 1,
    `stripping a buster from ${f} must surface as a bare ref — if not, the collector is blind`);
});

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
