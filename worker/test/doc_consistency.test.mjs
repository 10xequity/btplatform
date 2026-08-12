/**
 * Boomtown Platform — the documents must agree with the repo and with each other (§-1c D-20)
 * File: worker/test/doc_consistency.test.mjs · Version: v1.0 · Date: 2026-08-12 · Ships in: v0.140.0
 *
 * Owner instruction, 2026-08-12: *"Please perform document hygiene."* Tidying by hand is what this
 * repo has already done three times; each time it drifted back. D-20 (the doc-consistency check)
 * has sat unqueued in the register since. This is it, and the reason it is a TEST rather than a
 * tidy-up is written into the roadmap's own v1.29 note: **a written correction is not a control.**
 *
 * WHAT WENT WRONG, MEASURED 2026-08-12 — every item below was live when this file was written:
 *  · `docs/INDEX.md` said the handoff was **v1.69**; the handoff's own header said **v1.73**. Four
 *    sessions of drift in the row whose entire job is to stop it. Fourth recurrence of the class.
 *  · INDEX was stale about ITSELF — its row said v2.8, its header v2.9.
 *  · `README.md` pointed at `docs/2026-08-05_handoff_v0_88_0.md` and
 *    `docs/2026-07-21_setup-guide_v0.1.md`. **Neither file exists** — the second was deleted on
 *    2026-08-08 with the owner's OK. The README even hedged ("if this pointer names a file that is
 *    not there, trust INDEX"), which documents the defect instead of preventing it.
 *  · README's header said v0.86.0 while the build shipped v0.140.0 — **fifty-four releases** — in a
 *    file whose own banner calls a previous thirty-three-release gap "failure class 2 in miniature."
 *
 * SCOPE, AND WHY IT STOPS WHERE IT DOES. This checks the CURRENT documents against the CURRENT
 * repo. It deliberately does NOT scan `CHANGELOG.md`, `LOOP.md` or `docs/archive/`: those are dated
 * records of what was true at the time, and a pointer that has since died inside one of them is
 * history, not rot. INDEX.md says the same thing in prose about the five docs deleted in iteration
 * 32 — "rewriting them would be falsifying history rather than tidying it." A guard that forced
 * those green would be asking the loop to lie about its own past.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");
const has = (rel) => existsSync(new URL(rel, ROOT));

const INDEX = read("docs/INDEX.md");
const README = read("README.md");

/** The live documents — the set this guard governs. Archive and ledgers are excluded by design. */
const LIVE_DOCS = readdirSync(new URL("docs/", ROOT)).filter((f) => f.endsWith(".md") && f !== "INDEX.md");

/* ── pure verdicts ── */

/** Every row of INDEX's document tables, as { file, version }.
 *  The version cell is bold on some rows and plain on others — this guard's first draft required
 *  bold and parsed 9 of 21, then reported twelve indexed documents as missing from the index.
 *  A reader that silently sees half a table is worse than no reader, so the count is asserted. */
export function indexRows(md) {
  return [...md.matchAll(/^\| `([^`]+)` \| \*{0,2}([^|*]+?)\*{0,2} \|/gm)]
    .map((m) => ({ file: m[1], version: m[2].trim() }));
}

/** A document's own declared version, in either header dialect this repo uses. */
export function headerVersion(md) {
  const bold = md.match(/\*\*Version:\*\* (v[0-9][0-9.]*)/);
  if (bold) return bold[1];
  const plain = md.match(/^File:[^\n]*·\s*Version:\s*(v[0-9][0-9.]*)/m);
  return plain ? plain[1] : null;
}

/** Repo-relative file pointers inside a document: docs/…, web/…, worker/…, db/…. */
export function pointers(md) {
  const out = new Set();
  for (const m of md.matchAll(/`((?:docs|web|worker|db)\/[A-Za-z0-9._/-]+\.(?:md|html|js|mjs|css|sql))`/g)) out.add(m[1]);
  return [...out];
}

/* ── the rules ── */

test("the guard is scanning a real corpus", () => {
  // A doc-consistency check that scanned nothing would report perfect hygiene forever, which is
  // the exact failure this file exists to prevent.
  assert.ok(LIVE_DOCS.length >= 12, `only ${LIVE_DOCS.length} live docs found — the corpus moved`);
  assert.ok(indexRows(INDEX).length >= 15, `INDEX parsed to ${indexRows(INDEX).length} rows — the table shape changed`);
});

test("every INDEX row points at a file that exists", () => {
  const missing = indexRows(INDEX).filter((r) => !has("docs/" + r.file)).map((r) => r.file);
  assert.deepEqual(missing, [], "INDEX lists documents that are not on disk:\n" + missing.join("\n"));
});

test("every live document has an INDEX row", () => {
  const listed = new Set(indexRows(INDEX).map((r) => r.file));
  const orphans = LIVE_DOCS.filter((f) => !listed.has(f));
  assert.deepEqual(orphans, [], "these documents exist but INDEX does not mention them:\n" + orphans.join("\n"));
});

test("INDEX's version column matches each document's own header — the drift that recurred four times", () => {
  const wrong = [];
  for (const row of indexRows(INDEX)) {
    if (!has("docs/" + row.file)) continue;                 // covered by its own test above
    if (!row.file.endsWith(".md")) continue;                // the demo .html carries no header block
    // The archive table's second column is a READ PRIORITY (1, 2, 3), not a version — a different
    // table answering a different question. Comparing it to a header version compares a rank to a
    // release and reports drift that does not exist.
    if (row.file.startsWith("archive/")) continue;
    const own = row.file === "INDEX.md" ? headerVersion(INDEX) : headerVersion(read("docs/" + row.file));
    if (!own) { wrong.push(`${row.file}: no version in its own header block`); continue; }
    if (own !== row.version) wrong.push(`${row.file}: INDEX says ${row.version}, the file says ${own}`);
  }
  assert.deepEqual(wrong, [], "the index and the documents disagree:\n" + wrong.join("\n"));
});

test("every repo file the NAVIGATION documents point at actually exists", () => {
  /* SCOPED TO README AND INDEX, DELIBERATELY — a letter to whoever widens this next.
     The first draft scanned every live document and reddened on three citations that are correct:
     the roadmap cites `2026-07-24_module-recommendations_v1_0.md` and `…_ux-polish-roadmap_v1_0.md`
     as PROVENANCE for decisions made before those files were deleted (iteration 32, with the
     owner's OK — INDEX records that their historical citations were left intact on purpose), and
     the KOTC spec cites its own superseded v1_0 predecessor. Those are dated references to what
     was true then; forcing them green would mean rewriting history to satisfy a test.
     README and INDEX are different: they are the NAVIGATION surfaces. A dead pointer there sends a
     reader to a file that is not there, which is exactly what both of README's "Start here" links
     did when this guard was written. Navigation must resolve; citation may point into the past. */
  const dead = [];
  for (const [name, md] of [["README.md", README], ["docs/INDEX.md", INDEX]]) {
    for (const p of pointers(md)) if (!has(p)) dead.push(`${name} → ${p}`);
  }
  assert.deepEqual(dead, [], "these navigation pointers name files that do not exist:\n" + dead.join("\n"));
});

test("README states the version the repo actually ships", () => {
  // The one number in README that is allowed to be a number at all: everything else defers to
  // preflight and /api/health, because a README cannot re-measure itself.
  const shipped = read("worker/src/index.js").match(/version: "(v[0-9.]+)"/);
  assert.ok(shipped, "index.js no longer declares a version in the shape this guard reads");
  const stated = headerVersion(README);
  assert.equal(stated, shipped[1],
    `README says ${stated}, the worker ships ${shipped[1]} — this file was 54 releases stale when the guard was written`);
});

/* ── negative controls — each mutates the real input and asserts the mutation landed ── */

test("NC-1: a dead pointer in a real document is caught", () => {
  const mutated = README.replace(/`docs\/INDEX\.md`/, "`docs/does-not-exist.md`");
  assert.notEqual(mutated, README, "the mutation found no INDEX pointer in README to break");
  assert.ok(pointers(mutated).includes("docs/does-not-exist.md"), "the pointer scanner missed the planted path");
  assert.equal(has("docs/does-not-exist.md"), false, "the existence check cannot fail");
});

test("NC-2: a version disagreement between INDEX and a header is caught", () => {
  const rows = indexRows(INDEX);
  assert.ok(rows.length, "no rows parsed");
  const real = headerVersion(read("docs/" + rows.find((r) => r.file.endsWith(".md")).file));
  assert.ok(real, "the header reader found no version to compare");
  assert.notEqual(real, real + "9", "the comparison is not vacuous");
});

test("NC-3: the pointer scanner reads paths, not prose", () => {
  assert.deepEqual(pointers("see `docs/INDEX.md` and `web/assets/app.css`"), ["docs/INDEX.md", "web/assets/app.css"]);
  assert.deepEqual(pointers("the docs/ folder holds them"), [], "an unquoted directory mention is not a pointer");
  assert.deepEqual(pointers("`docs/archive/`"), [], "a directory is not a file pointer");
});
