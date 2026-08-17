/* Boomtown Platform — preflight decision tests
   File: worker/test/preflight.test.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.54.0
   Pure decision functions only — no git, no network, no D1 (schema_gate.test.mjs precedent).
   Every verdict ships a negative control that PROVES it can say no (standards §6): a preflight
   that cannot block is worse than none, because direct-commit trusts it in place of the human
   checkpoint the ZIP drag used to provide. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTestTotals, sourceVersion, schemaVerdict, gitVerdict, syntaxErrorFor, pagesVerdict, REPO,
  classicSyntaxErrorFor, inlineScriptsIn, webSyntaxVerdict } from "../scripts/preflight.mjs";
import { versionFromIndex, bustersIn, sweepCorpus } from "../scripts/sweep-buster.mjs";

/* ---------- syntaxErrorFor ---------- */

test("syntaxErrorFor accepts a valid ES module", () => {
  assert.equal(syntaxErrorFor('export const a = 1;\nexport function f() { return a; }\n'), null);
});

test("NC-0: a broken ES MODULE is caught — the hole `node --check <file>` cannot see", () => {
  // Node 24.18.1: `node --check f.js` exits 0 for any .js carrying export/import even when it
  // is unparseable. All 37 worker modules are ESM, so the file-path form guards nothing here.
  // If this NC ever passes null, the syntax check has silently gone blind across the tree.
  const err = syntaxErrorFor('export const a = 1;\nfunction ((((broken {\n');
  assert.notEqual(err, null, "a syntax error in an ESM file must be caught, not skipped");
  assert.match(err, /Error/);
});

test("NC-0b: a broken script with no ESM syntax is also caught", () => {
  assert.notEqual(syntaxErrorFor('function ((((broken {\n'), null);
});

/* ---------- parseTestTotals ---------- */

const SUMMARY = [
  "ℹ tests 645", "ℹ suites 0", "ℹ pass 645", "ℹ fail 0", "ℹ cancelled 0", "ℹ skipped 0",
].join("\n");

test("parseTestTotals reads the real node:test summary", () => {
  assert.deepEqual(parseTestTotals(SUMMARY), { tests: 645, pass: 645, fail: 0 });
});

test("parseTestTotals reads a failing run without rounding it down to green", () => {
  const t = parseTestTotals(SUMMARY.replace("pass 645", "pass 642").replace("fail 0", "fail 3"));
  assert.equal(t.fail, 3);
  assert.equal(t.pass, 642);
});

test("NC-1: a truncated run returns null, never a zero-failure reading", () => {
  // The v0.33.1 lesson: an absent number and a measured zero must not look alike. A crashed
  // run that parsed as {fail: 0} would let a broken suite through the gate.
  assert.equal(parseTestTotals("ℹ tests 645\nℹ pass 645"), null, "missing 'fail' must not default to 0");
  assert.equal(parseTestTotals(""), null);
  assert.equal(parseTestTotals("Segmentation fault"), null);
});

test("NC-2: prose containing the words must not be mistaken for the summary", () => {
  assert.equal(parseTestTotals("all tests pass and none fail, honest"), null);
});

/* ---------- sourceVersion ---------- */

test("sourceVersion extracts the health literal", () => {
  assert.equal(sourceVersion('res = json({ ok: true, version: "v0.53.1" });'), "v0.53.1");
  assert.equal(sourceVersion('version:   "v1.20.300"'), "v1.20.300");
});

test("NC-3: a missing or malformed version reads as null, not as a guess", () => {
  assert.equal(sourceVersion("res = json({ ok: true });"), null);
  assert.equal(sourceVersion('version: "0.53.1"'), null, "no 'v' prefix is not the shipped form");
  assert.equal(sourceVersion('version: "v0.53"'), null, "two-part version is not the shipped form");
});

/* ---------- schemaVerdict ---------- */

test("schemaVerdict passes when D1 matches or leads the repo", () => {
  assert.equal(schemaVerdict(33, 33).status, "ok");
  // Applied migrations get pruned from the repo, so D1 ahead is normal (library §3).
  assert.equal(schemaVerdict(33, 40).status, "ok");
});

test("NC-4: code ahead of schema BLOCKS — the 2026-07-27 break", () => {
  const v = schemaVerdict(34, 33);
  assert.equal(v.status, "fail", "a repo migration D1 has not applied must block, not warn");
  assert.match(v.detail, /0034/);
});

test("NC-5: an unreadable D1 warns and never launders into a pass", () => {
  const v = schemaVerdict(33, null);
  assert.equal(v.status, "warn", "'I could not look' must not report as 'it is fine'");
  assert.notEqual(v.status, "ok");
});

/* ---------- gitVerdict ---------- */

const CLEAN = { branch: "main", dirty: 0, behind: 0, ahead: 0, fetched: true };

test("gitVerdict passes on a fetched, in-sync branch", () => {
  assert.equal(gitVerdict(CLEAN).status, "ok");
  assert.equal(gitVerdict({ ...CLEAN, dirty: 5, ahead: 2 }).status, "ok", "uncommitted work is normal mid-session");
});

test("NC-6: being behind origin BLOCKS — building on a stale tree is the defect it exists for", () => {
  const v = gitVerdict({ ...CLEAN, behind: 5 });
  assert.equal(v.status, "fail");
  assert.match(v.detail, /5 commit/);
});

test("NC-7: an unfetched branch warns — unknown sync state is not a clean one", () => {
  assert.equal(gitVerdict({ ...CLEAN, fetched: false }).status, "warn");
});

/* ---------- pagesVerdict (v1.1, 2026-08-06) ----------
   The static app and the worker deploy on SEPARATE pipelines and only the worker had a check.
   On 2026-08-06 v0.99.0's worker went live while its pages-build-deployment FAILED, and the
   release ritual reported clean throughout — it "checked Pages" by fetching the repo-root
   redirect stub, a page that carries no buster and answers 200 forever.

   These read two REAL files off disk (the decision function stays pure; only its input is
   sourced from the tree) because the whole defect was about WHICH page you point at, and a
   hand-written fixture would have been written to contain the thing the real page lacked. */

const REAL_WEB_INDEX = readFileSync(join(REPO, "web", "index.html"), "utf8");
const REAL_ROOT_INDEX = readFileSync(join(REPO, "index.html"), "utf8");
const REAL_WANT = versionFromIndex(readFileSync(join(REPO, "worker", "src", "index.js"), "utf8"));

test("pagesVerdict passes when the live page carries the source's own buster", () => {
  const v = pagesVerdict(REAL_WANT, REAL_WEB_INDEX);
  assert.equal(v.status, "ok", `web/index.html should agree with index.js at ${REAL_WANT}: ${v.detail}`);
});

test("NC-8: the REAL page, mutated to an older buster, is caught — this is the v0.99.0 miss", () => {
  // Mutate the real input, not a fixture: rewrite web/index.html's busters to the version Pages
  // was actually serving on 2026-08-06 while the worker reported v0.99.0.
  const stale = REAL_WEB_INDEX.replace(/\?v=[0-9][0-9.]*/g, "?v=0.98.0");
  assert.notEqual(stale, REAL_WEB_INDEX, "the mutation must actually change the input, or this NC proves nothing");
  const v = pagesVerdict(REAL_WANT, stale);
  assert.equal(v.status, "warn");
  assert.match(v.detail, /Pages serves 0\.98\.0/);
  assert.match(v.detail, /pages-build-deployment/, "the detail must name the pipeline to go look at");
});

test("NC-9: the repo-root redirect stub — the page the old ritual fetched — can never report ok", () => {
  // THE ORIGINAL DEFECT, as an assertion. This is the literal file served at
  // https://10xequity.github.io/btplatform/ : it carries no buster, so no version can be read
  // out of it, so agreeing with it is impossible. If someone re-points PAGES_URL at the root,
  // this is the behaviour that has to hold — WARN, never a clean pass (C10, failure class 3).
  assert.equal(bustersIn(REAL_ROOT_INDEX).length, 0, "root index.html is expected to carry no buster; if it gained one, re-read this test");
  const v = pagesVerdict(REAL_WANT, REAL_ROOT_INDEX);
  assert.equal(v.status, "warn", "a page with no version in it must not read as agreement");
  assert.notEqual(v.status, "ok");
  assert.match(v.detail, /NO \?v= buster/);
});

test("NC-10: two different busters on one page report a partial build, not a pass", () => {
  const mixed = REAL_WEB_INDEX.replace(/\?v=[0-9][0-9.]*/, "?v=0.98.0"); // first occurrence only
  const seen = [...new Set(bustersIn(mixed))];
  assert.ok(seen.length > 1, "the mutation must leave two distinct values, or this NC proves nothing");
  const v = pagesVerdict(REAL_WANT, mixed);
  assert.equal(v.status, "warn");
  assert.match(v.detail, /different buster values/);
});

test("NC-11: no version in index.js FAILS — the check cannot silently have nothing to compare", () => {
  assert.equal(pagesVerdict(null, REAL_WEB_INDEX).status, "fail");
});

/* ---------- websyntax (v1.2) — the shipped browser corpus was parsed by nothing ----------
 *
 * Every NC below mutates a REAL shipped file. The first draft of NC-13 did not: it replaced the
 * first "function" in config.js, which lives in a COMMENT on line 27, so the mutation produced
 * valid JavaScript and the guard correctly accepted it. The CONTROL was broken, not the guard —
 * the trap this repo has paid for more than once. Each anchor is asserted unique for that reason.
 */

test("the real shipped corpus compiles — and is big enough to mean something", () => {
  const files = sweepCorpus(REPO).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 40, `expected 40+ shipped scripts, walked ${files.length} — then the corpus is wrong, not the code`);
  for (const f of files) {
    assert.equal(classicSyntaxErrorFor(readFileSync(join(REPO, f), "utf8")), null, `${f} does not compile`);
  }
});

test("NC-12: a real page with one inline block broken is caught", () => {
  const anchor = 'var btTpl=localStorage.getItem("bt_template");';
  const page = readFileSync(join(REPO, "web", "tournament.html"), "utf8");
  assert.equal(page.split(anchor).length - 1, 1, "anchor must occur exactly once or this NC proves nothing");
  assert.ok(inlineScriptsIn(page).every((b) => !classicSyntaxErrorFor(b.code)), "the real page must compile first");
  assert.ok(inlineScriptsIn(page.replace(anchor, "var btTpl= = ")).some((b) => classicSyntaxErrorFor(b.code)));
});

test("NC-13: a real .js asset broken in EXECUTABLE code is caught", () => {
  const src = readFileSync(join(REPO, "web", "assets", "config.js"), "utf8");
  const anchor = "window.BT_SIGNUP = function (event) {";
  assert.equal(src.split(anchor).length - 1, 1, "anchor must be unique — see the comment above");
  assert.equal(classicSyntaxErrorFor(src), null, "the real file must compile, or the mutation proves nothing");
  assert.notEqual(classicSyntaxErrorFor(src.replace(anchor, "window.BT_SIGNUP = function function (event) {")), null);
});

test("NC-14: classic-script semantics — a top-level return is REJECTED", () => {
  // Why vm.Script and not `--input-type=commonjs`: commonjs wraps the source in a function, so this
  // exact line PASSES there while a browser throws on it. Measured 2026-08-16.
  assert.notEqual(classicSyntaxErrorFor("return 42;"), null);
  assert.equal(classicSyntaxErrorFor("with(Math){var y=PI;}"), null, "`with` is legal classic script; module mode would wrongly reject it");
});

test("NC-15: a shrunken corpus FAILS rather than reporting clean (C13/C14)", () => {
  assert.equal(webSyntaxVerdict([], { js: 2, html: 2, blocks: 0 }).status, "fail");
  assert.equal(webSyntaxVerdict([], { js: 67, html: 64, blocks: 142 }).status, "ok");
  assert.equal(webSyntaxVerdict(["x.js: boom"], { js: 67, html: 64, blocks: 142 }).status, "fail");
});

test("NC-16: src= tags and non-JS typed blocks are skipped, not parsed as JavaScript", () => {
  assert.equal(inlineScriptsIn('<script src="x.js?v=1"></script>').length, 0);
  assert.equal(inlineScriptsIn('<script type="application/json">{"a":1,}</script>').length, 0);
  assert.equal(inlineScriptsIn("<script>var a=1;</script>").length, 1, "a plain block must still be seen, or the filter has eaten everything");
});
