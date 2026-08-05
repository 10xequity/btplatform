#!/usr/bin/env node
/**
 * Boomtown Platform — cache-buster sweep
 * File: worker/scripts/sweep-buster.mjs · Version: v1.0 · Date: 2026-08-04 · Ships in: (no bump)
 *
 * Rewrites every `?v=` cache buster in the shipped web corpus to the version `index.js` reports, and
 * then checks its own work with a corpus it did not build.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS. Four hand-rolled sweeps produced two corpus misses:
 *
 *   C13 (v0.84.0)  `404.html` ships from the REPO ROOT. It sat at ?v=0.74.0 for ten releases while
 *                  every buster under web/ moved, and the guard reported clean the whole time — it
 *                  was scanning web/ and the file was one directory up.
 *   C14 (v0.85.0)  One release later the sweep missed the repo root AGAIN, because
 *                  `Get-ChildItem -Path . -Include *.html,*.js` with no -Recurse matches NOTHING in
 *                  PowerShell. And then THE SWEEP VERIFIED ITSELF CLEAN, because the follow-up count
 *                  was written from the same corpus expression. Two steps, one blind spot, and the
 *                  second step existed specifically to catch the first.
 *
 * It surfaced only because the previous handoff had written down the number 371 and the new count came
 * up two short, and it was confirmed with ripgrep — a tool sharing no code with the sweep.
 *
 * ── SO THE CHECK DOES NOT REUSE THE SWEEP'S CORPUS. THAT IS THE WHOLE POINT OF THE FILE. ──
 *
 *   THE SWEEP's corpus  : a FILESYSTEM walk — readdirSync over the repo root, web/ and web/assets/,
 *                         the same discovery shape `sync-rail.mjs` uses for rail pages.
 *   THE CHECK's corpus  : the GIT INDEX — `git ls-files`. A different source of truth entirely, not a
 *                         different way of phrasing the same walk.
 *
 * Neither is a superset of the other, and that asymmetry is the feature:
 *   · a tracked file in a directory the walk never visits  → the CHECK sees it, the sweep missed it.
 *     That is C13 and C14, caught mechanically instead of by somebody remembering a number.
 *   · a brand-new untracked page                           → the WALK sees it, git does not.
 *     That is a page about to ship with a stale buster.
 *
 * DISAGREEMENT BETWEEN THE TWO IS THE FINDING, and the script fails on it rather than picking a
 * winner. A single corpus can only tell you it agrees with itself.
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   node worker/scripts/sweep-buster.mjs            report only — never writes
 *   node worker/scripts/sweep-buster.mjs --write    sweep every buster to index.js's version
 *
 * Exit codes: 0 clean · 2 a problem worth stopping for.
 *
 * The buster is a CACHE KEY, not the referenced file's version (the v0.41.0 convention). Page and
 * script header versions do not move on a sweep.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");
const INDEX_JS = join(REPO, "worker", "src", "index.js");

/** Directories that ship browser-reachable assets. The repo root is FIRST, deliberately — it is the
 *  one that has been forgotten twice, and putting it last invites the same omission a third time. */
export const SWEEP_DIRS = ["", "web", join("web", "assets")];

const IS_ASSET = (f) => f.endsWith(".html") || f.endsWith(".js");

/* ─────────────────────────── pure helpers ─────────────────────────── */

/** The version `/api/health` reports — the only honest version source (standards §2). */
export function versionFromIndex(src) {
  const m = src.match(/version:\s*"v(\d+\.\d+\.\d+)"/);
  return m ? m[1] : null;
}

/** Every buster value in a file's text, in order. Comments are NOT stripped: over-counting can only
 *  make this fail loud, and a buster in a comment is still a buster somebody will copy. */
export const bustersIn = (text) => [...text.matchAll(/\?v=([0-9][0-9.]*)/g)].map((m) => m[1]);

/** What a sweep would do to one file. @returns {{next:string, changed:number}} */
export function applySweep(text, version) {
  let changed = 0;
  const next = text.replace(/\?v=[0-9][0-9.]*/g, (hit) => {
    const want = `?v=${version}`;
    if (hit !== want) changed++;
    return want;
  });
  return { next, changed };
}

/** @returns {{values:Map<string,number>, total:number, files:string[]}} */
export function audit(fileTexts) {
  const values = new Map();
  let total = 0;
  const files = [];
  for (const [name, text] of fileTexts) {
    const found = bustersIn(text);
    if (!found.length) continue;
    files.push(name);
    total += found.length;
    for (const v of found) values.set(v, (values.get(v) || 0) + 1);
  }
  return { values, total, files: files.sort() };
}

/* ─────────────────────── the two independent corpora ─────────────────────── */

/**
 * THE SWEEP'S CORPUS — a filesystem walk. Discovered, never hardcoded: a hardcoded list is how a new
 * page silently misses the sweep (failure class 3, and `sync-rail.mjs` says the same thing).
 * @returns {string[]} repo-relative paths, POSIX separators
 */
export function sweepCorpus(repo = REPO) {
  const out = [];
  for (const dir of SWEEP_DIRS) {
    const abs = dir ? join(repo, dir) : repo;
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (!IS_ASSET(f)) continue;
      out.push((dir ? `${dir.replace(/\\/g, "/")}/` : "") + f);
    }
  }
  return out.sort();
}

/**
 * THE CHECK'S CORPUS — the git index. Shares no code, no directory list and no traversal with the
 * sweep above; it asks a different authority what ships. This is the C14 rule made mechanical.
 * @returns {string[]|null} repo-relative paths, or null when git cannot answer (not a failure)
 */
export function checkCorpus(repo = REPO) {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "*.html", "*.js"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\0").filter(Boolean).sort();
  } catch {
    return null;   // no git, or not a work tree. Report it; do not pretend it agreed.
  }
}

/**
 * Files the CHECK can see carrying a buster that the SWEEP would never have opened.
 * A non-empty result is C13/C14 happening again, caught this time.
 */
export function blindSpots(repo, sweepList, checkList) {
  const swept = new Set(sweepList);
  return checkList.filter((f) => {
    if (swept.has(f)) return false;
    let text = "";
    try { text = readFileSync(join(repo, f), "utf8"); } catch { return false; }
    return bustersIn(text).length > 0;
  });
}

/* ─────────────────────────── main ─────────────────────────── */

const readAll = (repo, list) => list.map((f) => {
  try { return [f, readFileSync(join(repo, f), "utf8")]; } catch { return [f, ""]; }
});

function main() {
  const write = process.argv.includes("--write");

  if (!existsSync(INDEX_JS)) {
    console.error(`sweep-buster: cannot find ${relative(REPO, INDEX_JS)} — refusing to guess a version.`);
    process.exitCode = 2; return;
  }
  const version = versionFromIndex(readFileSync(INDEX_JS, "utf8"));
  if (!version) {
    console.error("sweep-buster: no `version: \"vX.Y.Z\"` in index.js — refusing to guess.");
    process.exitCode = 2; return;
  }

  const sweepList = sweepCorpus();
  // A shrinking corpus is its own finding: a sweep that "succeeds" having touched two files is the
  // C14 failure wearing a success message. Fail closed. (sync-rail.mjs precedent.)
  if (sweepList.length < 40) {
    console.error(`sweep-buster: the walk found only ${sweepList.length} .html/.js files — expected 40+. Refusing to sweep a corpus this small.`);
    process.exitCode = 2; return;
  }

  console.log(`sweep-buster: target v${version} (from index.js — the only honest version source)`);
  console.log(`  sweep corpus (filesystem walk) : ${sweepList.length} files across ${SWEEP_DIRS.map((d) => d.replace(/\\/g, "/") || "<repo root>").join(", ")}`);

  /* ── the independent check, BEFORE writing anything ── */
  const checkList = checkCorpus();
  if (checkList === null) {
    console.warn("  check corpus (git index)       : UNAVAILABLE — git could not answer. Not the same as agreeing.");
  } else {
    console.log(`  check corpus (git index)       : ${checkList.length} tracked .html/.js files`);
    const missed = blindSpots(REPO, sweepList, checkList);
    if (missed.length) {
      console.error("\nsweep-buster: BLIND SPOT — these tracked files carry a buster and are NOT in the sweep corpus:");
      for (const f of missed) console.error(`    ${f}`);
      console.error("  That is C13/C14 recurring. Add the directory to SWEEP_DIRS; do not sweep them by hand.");
      process.exitCode = 2; return;
    }
    console.log("  corpora agree                  : no tracked buster-carrying file is outside the sweep");
  }

  const texts = readAll(REPO, sweepList);
  const before = audit(texts);
  const shown = [...before.values.entries()].map(([v, n]) => `${v} (${n})`).join(", ") || "none";
  console.log(`\n  before : ${before.total} busters across ${before.files.length} files — ${shown}`);

  if (!write) {
    const wrong = [...before.values.keys()].filter((v) => v !== version);
    if (wrong.length) {
      console.log(`\n  ${before.total} buster(s) would move to ${version}; stale value(s): ${wrong.join(", ")}`);
      console.log("  Run with --write to sweep.");
      process.exitCode = 2; return;
    }
    console.log(`\nsweep-buster: CLEAN — every buster already reads ${version}.`);
    return;
  }

  let touched = 0, rewrites = 0;
  for (const [f, text] of texts) {
    const { next, changed } = applySweep(text, version);
    if (!changed) continue;
    writeFileSync(join(REPO, f), next);
    touched++; rewrites += changed;
  }

  const after = audit(readAll(REPO, sweepList));
  console.log(`  after  : ${after.total} busters across ${after.files.length} files — ${[...after.values.keys()].join(", ")}`);
  console.log(`\nsweep-buster: rewrote ${rewrites} buster(s) in ${touched} file(s).`);

  if (after.values.size !== 1 || !after.values.has(version)) {
    console.error("sweep-buster: POST-SWEEP CHECK FAILED — the corpus is not at one value equal to index.js.");
    process.exitCode = 2; return;
  }
  // WRITE THE COUNT DOWN. The previous release's number is the cheapest independent oracle there is,
  // and it is the only reason C14 was ever found.
  console.log(`sweep-buster: OK — ${after.total} busters, one value, v${version}. RECORD THIS COUNT in the handoff.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
