/**
 * Boomtown Platform — which guards are satisfied by code that has been COMMENTED OUT
 * File: worker/scripts/raw-source-sweep.mjs · Version: v1.0 · Date: 2026-08-18 · Ships in: NO-BUMP
 *
 * THE QUESTION (roadmap §-1c, handoff §6 item 0c). v0.168.0's follow-up found 11 of 11 mount
 * anchors satisfied by a mount that had been commented out, because they matched raw source. This
 * asks the same question of the WHOLE suite, and it asks it the way the corrected control in that
 * session asked it — by mutating the real input and watching whether the guard notices.
 *
 * TWO MUTANTS, AND THE SECOND IS WHAT MAKES THE FIRST MEAN ANYTHING.
 *   · comment  every line of one source file prefixed with `//` — the bytes stay, the code stops
 *   · empty    the same file served as ""
 * Commenting a whole file out does two things at once: it hides live code behind comments AND it
 * empties whatever corpus a guard iterates. Those are different defects. Differencing against the
 * empty mutant isolates the comment axis:
 *
 *   passes on comment, FAILS on empty  →  READS RAW SOURCE. This is the defect class.
 *   passes on both                     →  indifferent to the file, or vacuous when its corpus
 *                                         empties. A separate question, reported separately.
 *   fails on comment                   →  comment-sensitive. Nothing to do.
 *
 * IT MEASURES ITSELF BEFORE IT MEASURES ANYTHING ELSE. The report opens with how many test files
 * ran, how many could not be classified, how many text reads were seen and which were left out of
 * scope. A sweep that silently skips what it cannot parse reports clean by seeing nothing.
 * `--self-test` proves the classifier on four fixtures whose answers are known.
 *
 * KNOWN BLIND SPOTS, stated rather than discovered later:
 *   · reads inside a CHILD PROCESS are invisible — the shim is not inherited. Two test files
 *     (changelog_entry, seed_local) drive scripts that way.
 *   · only `.js`/`.mjs` reads are mutated. "A call site exists" is a JS claim and `blankComments`
 *     is a JS-comment blanker; HTML, CSS, SQL and MD reads are counted and named, never mutated.
 *   · a guard asserting the ABSENCE of something looks blind here and is NOT this defect — raw
 *     source is the stricter direction for absence. The report says so; triage by hand.
 *   · one classification per (test file × source file), not per assertion. A file that reads a
 *     source twice is reported once, at the first read site.
 *
 * CONTRACT
 * --------
 *   node worker/scripts/raw-source-sweep.mjs [--only=<substring>] [--dir=<dir>] [--self-test]
 *
 * It writes nothing and mutates nothing on disk. A full run is ~2,000 child processes and takes
 * roughly a quarter of an hour; `--only` narrows it while working on one file.
 */
import { readdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, extname, basename, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..", "..");
const HOOK = join(HERE, "raw-source-hook.mjs");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const TMP = join(tmpdir(), "bt-raw-source-sweep");

const runTest = (dir, file, env) => {
  const r = spawnSync(process.execPath, ["--import", `file:///${HOOK.replace(/\\/g, "/")}`, join(dir, file)],
    { cwd: join(REPO, "worker"), env: { ...process.env, ...env }, encoding: "utf8", timeout: 240_000 });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
};

/* ── phase 1: run each test file once, recording what it reads as text ─────────────────────── */

function record(dir, files) {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
  const rows = [];
  for (const f of files) {
    const out = join(TMP, `${f}.reads`);
    writeFileSync(out, "");
    const { code, out: log } = runTest(dir, f, {
      BT_RS_MODE: "record", BT_RS_OUT: out, BT_RS_TESTBASE: basename(f),
    });
    const reads = readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    unlinkSync(out);
    rows.push({ file: f, code, reads, tail: log.split("\n").slice(-4).join(" | ") });
  }
  return rows;
}

/* ── phase 2: classify every in-scope pair ────────────────────────────────────────────────── */

function classify(dir, rows) {
  const seen = new Map();
  const byExt = new Map();
  let outside = 0;
  for (const r of rows) {
    for (const rd of r.reads) {
      const p = rd.path.replace(/\\/g, "/");
      if (!p.toLowerCase().startsWith(REPO.replace(/\\/g, "/").toLowerCase())) { outside++; continue; }
      const src = relative(REPO, rd.path).replace(/\\/g, "/");
      if (src.startsWith("node_modules/")) { outside++; continue; }
      byExt.set(extname(src).toLowerCase() || "(none)", (byExt.get(extname(src).toLowerCase() || "(none)") || 0) + 1);
      const key = `${r.file}|${src}`;
      if (!seen.has(key)) seen.set(key, { file: r.file, src, line: rd.line });
    }
  }
  const green = new Set(rows.filter((r) => r.code === 0).map((r) => r.file));
  const pairs = [...seen.values()].filter((p) => [".js", ".mjs"].includes(extname(p.src).toLowerCase()) && green.has(p.file));

  const sensitive = [], raw = [], indifferent = [];
  let n = 0;
  for (const p of pairs) {
    const target = join(REPO, p.src);
    if (runTest(dir, p.file, { BT_RS_MODE: "comment", BT_RS_TARGET: target }).code !== 0) sensitive.push(p);
    else if (runTest(dir, p.file, { BT_RS_MODE: "empty", BT_RS_TARGET: target }).code !== 0) raw.push(p);
    else indifferent.push(p);
    if (++n % 100 === 0) process.stderr.write(`  ${n}/${pairs.length} pairs\n`);
  }
  return { pairs, sensitive, raw, indifferent, byExt, outside, distinct: seen.size };
}

function report(dir, files) {
  const rows = record(dir, files);
  const bad = rows.filter((r) => r.code !== 0);
  const c = classify(dir, rows);

  console.log("=== INSTRUMENT ===");
  console.log(`test files scanned                   : ${files.length}`);
  console.log(`ran standalone, exit 0               : ${rows.length - bad.length}`);
  console.log(`could NOT be classified              : ${bad.length}`);
  for (const b of bad) console.log(`    ! ${b.file} exit ${b.code} :: ${b.tail.slice(0, 160)}`);
  console.log(`distinct (test file × source) reads  : ${c.distinct}   [+${c.outside} outside the repo, ignored]`);
  console.log(`reads by extension                   : ${[...c.byExt].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e}=${n}`).join(" ")}`);
  console.log(`IN SCOPE (.js/.mjs pairs, mutated)   : ${c.pairs.length}`);

  console.log("\n=== FINDING ===");
  console.log(`comment-SENSITIVE (nothing to do)    : ${c.sensitive.length}`);
  console.log(`indifferent / corpus-vacuous         : ${c.indifferent.length}`);
  console.log(`READS RAW SOURCE                     : ${c.raw.length}`);
  console.log("\n-- RAW-SOURCE PAIRS --");
  for (const p of c.raw.sort((a, b) => a.file.localeCompare(b.file) || a.src.localeCompare(b.src))) {
    console.log(`  ${p.file}  ←  ${p.src}${p.line ? `  (first read at line ${p.line})` : ""}`);
  }
  return c;
}

/* ── the classifier's own positive control ────────────────────────────────────────────────── */

function selfTest() {
  const dir = join(TMP, "controls");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const idx = join(REPO, "worker/src/index.js").replace(/\\/g, "/");
  const kit = join(REPO, "worker/testkit/route-extract.mjs").replace(/\\/g, "/");
  const head = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\n';
  const files = {
    "ctl_raw.test.mjs": `${head}const SRC = readFileSync("${idx}", "utf8");\ntest("raw", () => { assert.ok(/\\bwireTryouts\\(/.test(SRC)); });\n`,
    "ctl_blanked.test.mjs": `${head}import { blankComments } from "file:///${kit}";\nconst SRC = blankComments(readFileSync("${idx}", "utf8"));\ntest("blanked", () => { assert.ok(/\\bwireTryouts\\(/.test(SRC)); });\n`,
    "ctl_indifferent.test.mjs": `${head}const SRC = readFileSync("${idx}", "utf8");\ntest("indifferent", () => { assert.equal(typeof SRC, "string"); });\n`,
    "ctl_red.test.mjs": `${head}const SRC = readFileSync("${idx}", "utf8");\ntest("red", () => { assert.ok(/\\bwireNoSuchThingEver\\(/.test(SRC)); });\n`,
  };
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);

  const c = report(dir, Object.keys(files).sort());
  const has = (list, name) => list.some((p) => p.file === name && p.src === "worker/src/index.js");
  const checks = [
    ["a raw-source presence assertion reads RAW", has(c.raw, "ctl_raw.test.mjs")],
    ["a blankComments presence assertion is SENSITIVE", has(c.sensitive, "ctl_blanked.test.mjs")],
    ["a test that asserts nothing about the file is INDIFFERENT", has(c.indifferent, "ctl_indifferent.test.mjs")],
    ["a test that cannot pass is EXCLUDED, not classified",
      !has(c.raw, "ctl_red.test.mjs") && !has(c.sensitive, "ctl_red.test.mjs") && !has(c.indifferent, "ctl_red.test.mjs")],
  ];
  console.log("\n=== SELF-TEST ===");
  for (const [what, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`);
  rmSync(dir, { recursive: true, force: true });
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed ? `\nSELF-TEST FAILED (${failed}) — the classifier's verdicts cannot be believed.`
    : "\nSELF-TEST CLEAR — the classifier separates all four cases.");
  process.exitCode = failed ? 1 : 0;
}

const dir = arg("dir") ? resolve(arg("dir")) : join(REPO, "worker/test");
if (process.argv.includes("--self-test")) selfTest();
else {
  const only = arg("only");
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).filter((f) => !only || f.includes(only)).sort();
  if (!files.length) { console.log(`no test files under ${dir}${only ? ` matching "${only}"` : ""}`); process.exitCode = 1; }
  else report(dir, files);
}
