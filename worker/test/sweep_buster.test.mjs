/* Boomtown Platform — the cache-buster sweep script
   File: worker/test/sweep_buster.test.mjs · Version: v1.0 · Date: 2026-08-04 · Ships in: (no bump)

   `sweep-buster.mjs` replaces four hand-rolled sweeps that produced two corpus misses (C13, C14).
   Guarding a guard is worth doing carefully, because the failure it exists to prevent is the failure
   it is most likely to repeat.

   THE ONE ASSERTION THAT MATTERS: the script's CHECK must be able to see a file its SWEEP cannot.

   C14 was not "the sweep was wrong". It was "the sweep verified itself clean using the corpus that was
   already wrong". Two steps agreed because they shared an assumption, and the agreement was reported as
   confirmation. So the test that earns this script its keep is not "does it sweep" — it is **does the
   check catch a file the sweep never opened**, and the negative control for it reconstructs the exact
   historical defect: a sweep corpus with the repo root missing, and `404.html` sitting in it at a stale
   value. That is the real file, at its real path, carrying its real busters.

   A note on what these tests deliberately do NOT do: they never run the script with `--write`. A test
   that sweeps the working tree to prove sweeping works has changed the thing every other test reads. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO, SWEEP_DIRS, versionFromIndex, bustersIn, applySweep, audit,
  sweepCorpus, checkCorpus, blindSpots,
} from "../scripts/sweep-buster.mjs";

const read = (p) => readFileSync(join(REPO, p), "utf8");
const REAL_VERSION = versionFromIndex(read("worker/src/index.js"));

/* ───────────────────────── the version source ───────────────────────── */

test("the target version comes from index.js, the only honest version source", () => {
  assert.match(REAL_VERSION, /^\d+\.\d+\.\d+$/, "index.js does not carry a parseable version");
  // Not from a doc, a filename, or the previous buster value — all three have been stale before.
  assert.equal(versionFromIndex('res = json({ ok: true, version: "v1.2.3" });'), "1.2.3");
  assert.equal(versionFromIndex("no version here"), null, "a missing version must be null, never a guess");
});

/* ───────────────────────── pure sweep behaviour ───────────────────────── */

test("applySweep rewrites every stale buster and counts only what it changed", () => {
  const src = 'a.css?v=0.1.0 b.js?v=0.2.0 c.css?v=9.9.9';
  const { next, changed } = applySweep(src, "9.9.9");
  assert.equal(next, "a.css?v=9.9.9 b.js?v=9.9.9 c.css?v=9.9.9");
  assert.equal(changed, 2, "the already-correct buster must not be counted as a change");
});

test("a sweep is idempotent — running it twice changes nothing the second time", () => {
  const once = applySweep('x?v=0.1.0 y?v=0.2.0', "1.0.0");
  const twice = applySweep(once.next, "1.0.0");
  assert.equal(twice.changed, 0);
  assert.equal(twice.next, once.next);
});

test("the sweep moves the CACHE KEY and never a header version (the v0.41.0 convention)", () => {
  /* A buster is not the referenced file's version. A sweep that rewrote header versions would move
     every file's stamp on every release and make a real version change invisible in the diff. */
  const src = ' * File: web/assets/app.css · Version: v1.4 · ships\n<link href="assets/app.css?v=0.85.0">';
  const { next } = applySweep(src, "0.86.0");
  assert.match(next, /Version: v1\.4/, "the header version was rewritten — it must not be");
  assert.match(next, /app\.css\?v=0\.86\.0/, "the buster was not swept");
});

/* ───────────────── the two corpora, and why they must differ ───────────────── */

test("the repo root is in the sweep corpus, and it is FIRST", () => {
  /* It has been forgotten twice (C13, then C14 one release later). Position is not cosmetic — a list
     that ends with the easily-omitted entry invites the same omission a third time. */
  assert.equal(SWEEP_DIRS[0], "", "the repo root must lead SWEEP_DIRS");
  assert.ok(sweepCorpus().includes("404.html"),
    "404.html ships from the repo root and is the exact file C13 and C14 were both about");
});

test("the check corpus is a DIFFERENT source of truth, not a rephrasing of the walk", () => {
  const swept = sweepCorpus();
  const tracked = checkCorpus();
  assert.ok(tracked, "git could not answer — this test needs a work tree");

  // If these two ever produce the same set, the check has stopped being independent and C14 is back.
  assert.notDeepEqual(swept, tracked,
    "the sweep walk and the git index returned identical sets — the check is no longer independent");
  // Concretely: git sees .js files the walk never visits (worker/src, worker/test, scripts).
  assert.ok(tracked.some((f) => f.startsWith("worker/")),
    "the git corpus should reach outside the three swept directories, or it cannot catch a blind spot");
  assert.ok(!swept.some((f) => f.startsWith("worker/")),
    "the walk should NOT reach worker/ — that is what makes the two sets asymmetric");
});

test("the real tree has no blind spot: every tracked buster-carrying file is inside the sweep", () => {
  const missed = blindSpots(REPO, sweepCorpus(), checkCorpus() || []);
  assert.deepEqual(missed, [],
    `tracked files carry a buster but are outside the sweep corpus: ${missed.join(", ")}`);
});

test("NC: THE C13/C14 DEFECT, RECONSTRUCTED — a sweep corpus missing the repo root is caught", () => {
  /* This is the control the whole script exists for, and it mutates the REAL input: the real corpus,
     with the real repo-root entry dropped, against the real git index and the real 404.html on disk.

     Historically this exact state reported CLEAN twice, because the verification was written from the
     same corpus expression that had already lost the root. */
  const crippled = sweepCorpus().filter((f) => f.includes("/"));   // web/** only — the pre-C13 corpus
  assert.ok(!crippled.includes("404.html"), "the NC did not actually cripple the corpus");

  const missed = blindSpots(REPO, crippled, checkCorpus() || []);
  assert.ok(missed.includes("404.html"),
    "NC FAILED: a sweep blind to the repo root was not caught, which is C13 and C14 happening a third time");
});

test("NC: a buster-free file outside the sweep is NOT reported — the check must not cry wolf", () => {
  /* worker/src/*.js is tracked, outside the sweep, and carries no busters. If those showed up as blind
     spots the script would fail every run and be switched off, which is how a useful signal dies. */
  const missed = blindSpots(REPO, sweepCorpus(), checkCorpus() || []);
  assert.ok(!missed.some((f) => f.startsWith("worker/src/")),
    "files with no buster must not be reported as blind spots");
});

/* ───────────────────────── the real corpus, audited ───────────────────────── */

test("the shipped corpus is at ONE value and that value IS index.js's version", () => {
  /* This is C6, asserted from the script's own functions. asset_versions.test.mjs now asserts the same
     thing from its own independent corpus — two guards, two derivations, one claim. */
  const texts = sweepCorpus().map((f) => [f, read(f)]);
  const a = audit(texts);
  assert.ok(a.total >= 300, `the corpus shrank to ${a.total} busters — a guard scanning nothing passes vacuously`);
  assert.equal(a.values.size, 1, `expected one buster value, saw: ${[...a.values.keys()].join(", ")}`);
  assert.ok(a.values.has(REAL_VERSION),
    `busters read ${[...a.values.keys()][0]} but index.js reports ${REAL_VERSION} — the sweep did not run this release`);
});

test("NC: a single stale value in the real 404.html fails the audit", () => {
  const texts = sweepCorpus().map((f) => [f, read(f)]);
  const i = texts.findIndex(([f]) => f === "404.html");
  assert.ok(i >= 0, "the fixture moved — 404.html is no longer at the repo root");
  assert.ok(bustersIn(texts[i][1]).length > 0, "404.html carries no busters, so this control proves nothing");

  texts[i] = ["404.html", texts[i][1].replace(/\?v=[0-9][0-9.]*/g, "?v=0.74.0")];   // the real regression
  const a = audit(texts);
  assert.equal(a.values.size, 2, "NC FAILED: the exact ten-release regression went undetected");
});

test("the script refuses a corpus that has collapsed, rather than reporting success", () => {
  // A sweep that "succeeds" having touched two files is the C14 failure wearing a success message.
  const src = readFileSync(join(REPO, "worker/scripts/sweep-buster.mjs"), "utf8");
  assert.match(src, /sweepList\.length < 40/, "no shrinking-corpus floor — sync-rail.mjs has one for the same reason");
  assert.match(src, /Refusing to sweep a corpus this small/);
});

test("report mode never writes, and says the count out loud", () => {
  const src = readFileSync(join(REPO, "worker/scripts/sweep-buster.mjs"), "utf8");
  const main = src.slice(src.indexOf("function main()"));
  const beforeWriteBranch = main.slice(0, main.indexOf("if (!write)"));
  assert.ok(!/writeFileSync\(/.test(beforeWriteBranch),
    "the script writes before it has decided whether this is a --write run");
  assert.match(src, /RECORD THIS COUNT in the handoff/,
    "the script must tell you to write the count down — that recorded number is what caught C14");
});
