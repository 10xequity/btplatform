/**
 * Boomtown Platform — Pre-commit / session preflight
 * File: worker/scripts/preflight.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.54.0
 *
 * WHY THIS EXISTS
 * ---------------
 * Two problems, one script.
 *
 * 1. DIRECT COMMIT REMOVED THE HUMAN CHECKPOINT (owner decision 2026-08-02, CLAUDE.md §9.1).
 *    Under Desktop-parity the owner extracted a ZIP by hand, and that drag was — accidentally —
 *    a review step. It caught two brand-sweep misses in v0.53.0. Committing straight to main
 *    deletes it. `push:` then runs the CI gate, but a red gate has already cost a deploy slot
 *    and a dirty history. This runs the same gate BEFORE the commit, on the machine that made
 *    the change, so the failure is caught where it is cheap.
 *
 * 2. THE SESSION PROTOCOL WAS FOUR MANUAL COMMANDS (CLAUDE.md §1) and, being manual, was
 *    skipped. On 2026-08-02 the local clone sat two releases behind origin for a full session
 *    while work was built on top of it. `--session` makes that state impossible to miss.
 *
 * WHAT IT CHECKS — the same set the CI gate checks, plus drift the gate cannot see because it
 * runs on a fresh clone:
 *
 *   git        · branch, uncommitted work, and behind/ahead vs origin/main   (local-only drift)
 *   syntax     · node --check on every worker/src/*.js                       (CI gate step 1)
 *   parity     · every file in worker/test/ matches test/*.mjs  (F-37)       (CI gate step 2)
 *   suite      · node --test test/*.mjs, counts MEASURED not projected       (CI gate step 3)
 *   schema     · highest migration in db/migrations/ vs live D1              (CI gate step 5)
 *   deployed   · /api/health vs the version string in worker/src/index.js    (CI deploy step 3)
 *   pages      · the cache buster live on GitHub Pages vs the same source    (NO CI equivalent)
 *
 * THE SHIP HAS TWO HALVES AND ONLY ONE OF THEM HAD A CHECK (added 2026-08-06, v1.1).
 * `deploy-worker.yml` deploys `worker/**` to Cloudflare and asserts `/api/health` afterwards.
 * The static app is deployed by a SEPARATE, GitHub-managed `pages-build-deployment` run that
 * this repo does not own, does not gate, and cannot see. On 2026-08-06 those pipelines came
 * apart: v0.99.0's worker deploy went green while its Pages build FAILED, so the API served
 * v0.99.0 to a browser still running the v0.98.0 bundle — and every check in the release
 * ritual reported clean, because `deployed` only ever asked the worker.
 *
 * The ritual did nominally say "check Pages", pointed at `https://10xequity.github.io/btplatform/`
 * — the repo-root redirect stub, last edited 2026-07-22, which carries NO buster and returns a
 * byte-identical 200 whether Pages last built today or never. That is failure class 3 exactly: a
 * guard narrower than its subject, reporting clean. This check reads `/web/` instead, the page
 * that actually carries `?v=`, and a response with no buster in it WARNS — an absence must never
 * read as agreement (C10).
 *
 * FAIL CLOSED, AND NEVER LAUNDER AN UNKNOWN INTO A PASS. A check that cannot run reports WARN
 * and is named in the summary; it never reports OK. The v0.33.1 lesson is that a projected
 * number reads exactly like a measured one once it is in a summary line, so every count here
 * comes from parsing real output. Live D1 needs CLOUDFLARE_API_TOKEN with D1:Read — absent it,
 * the schema check WARNS rather than passing, because "I could not look" is not "it is fine".
 *
 * CONTRACT
 * --------
 *   node worker/scripts/preflight.mjs [--session] [--no-net] [--json]
 *
 *   --session   also fetch origin and report sync state (the CLAUDE.md §1 ritual)
 *   --no-net    skip every network check (offline; those checks WARN)
 *   --json      machine-readable result on stdout, nothing else
 *
 *   exit 0  every check passed (warnings allowed — they are printed and counted)
 *   exit 1  at least one check FAILED
 *   exit 2  the script could not run at all (bad repo layout)
 */

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { scanMigrations, pad } from "./schema-gate.mjs";
// Reuse the sweeper's own idioms rather than re-deriving them here. C14: a check that parses the
// version a second way is not an independent check, it is a second thing that can disagree.
import { versionFromIndex, bustersIn } from "./sweep-buster.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");
const WORKER = join(REPO, "worker");
const HEALTH_URL = "https://boomtown-api.vvisuth.workers.dev/api/health";
// NOT the repo root. The root is a redirect stub with no buster in it — see the header block.
const PAGES_URL = "https://10xequity.github.io/btplatform/web/";

/* ============================ pure helpers (unit-tested) ============================ */

/**
 * Parse the totals node:test prints at the end of a run. Returns null when the summary is
 * absent — a truncated or crashed run must NOT read as "0 failures".
 *
 * @param {string} out combined stdout+stderr of `node --test`
 * @returns {{tests:number, pass:number, fail:number}|null}
 */
export function parseTestTotals(out) {
  const grab = (k) => {
    const m = new RegExp(`^\\D*\\b${k}\\s+(\\d+)\\s*$`, "m").exec(out);
    return m ? Number(m[1]) : null;
  };
  const tests = grab("tests"), pass = grab("pass"), fail = grab("fail");
  if (tests === null || pass === null || fail === null) return null;
  return { tests, pass, fail };
}

/**
 * Pull the version string out of worker/src/index.js. That file deliberately carries no
 * version in its header — /api/health is the only honest source (F-34) — so this reads the
 * literal the health route serves.
 *
 * @param {string} src
 * @returns {string|null}
 */
export function sourceVersion(src) {
  const m = /version:\s*"(v\d+\.\d+\.\d+)"/.exec(src);
  return m ? m[1] : null;
}

/**
 * Decide the schema verdict. Mirrors schema-gate's direction but tolerates "unknown", because
 * a developer machine often has no D1 token and that must not read as a pass.
 *
 * @param {number} repoHighest
 * @param {number|null} applied null when D1 could not be read
 * @returns {{status:'ok'|'fail'|'warn', detail:string}}
 */
export function schemaVerdict(repoHighest, applied) {
  if (applied === null) {
    return { status: "warn", detail: `repo is at ${pad(repoHighest)}; live D1 not read (no CLOUDFLARE_API_TOKEN with D1:Read). CI will enforce this.` };
  }
  if (repoHighest > applied) {
    return { status: "fail", detail: `repo carries ${pad(repoHighest)} but D1 has applied only ${pad(applied)}. Apply it via Cloudflare MCP before pushing — CI fails closed here.` };
  }
  if (applied > repoHighest) {
    return { status: "ok", detail: `D1 at ${pad(applied)}, repo at ${pad(repoHighest)} — fine, applied migrations get pruned.` };
  }
  return { status: "ok", detail: `repo and D1 agree at ${pad(applied)}.` };
}

/**
 * Decide the git verdict from porcelain facts.
 *
 * @param {{branch:string, dirty:number, behind:number, ahead:number, fetched:boolean}} g
 * @returns {{status:'ok'|'fail'|'warn', detail:string}}
 */
export function gitVerdict(g) {
  if (g.behind > 0) {
    return { status: "fail", detail: `${g.behind} commit(s) behind origin/${g.branch}. Pull before committing — building on a stale tree is the 2026-08-02 defect.` };
  }
  if (!g.fetched) {
    return { status: "warn", detail: `on ${g.branch}, ${g.dirty} uncommitted file(s), ${g.ahead} unpushed. Sync state vs origin NOT checked (offline or --no-net).` };
  }
  return { status: "ok", detail: `on ${g.branch}, in sync with origin, ${g.dirty} uncommitted file(s), ${g.ahead} unpushed.` };
}

/* ============================ runners ============================ */

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

function checkGit(session) {
  let fetched = false;
  if (session) {
    try { run("git", ["fetch", "origin", "--quiet"]); fetched = true; } catch { /* offline — stays false */ }
  }
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const dirty = run("git", ["status", "--porcelain"]).trim().split("\n").filter(Boolean).length;
  let behind = 0, ahead = 0;
  try {
    const counts = run("git", ["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`]).trim().split(/\s+/);
    behind = Number(counts[0]) || 0;
    ahead = Number(counts[1]) || 0;
  } catch { /* no upstream — leave zeroes, the warn path covers it */ }
  return gitVerdict({ branch, dirty, behind, ahead, fetched });
}

/**
 * Syntax-check ONE module's source. Returns the error message, or null when it parses.
 *
 * DO NOT "simplify" this back to `node --check <file>`. On Node 24.18.1 that command exits 0
 * for any .js file containing `export` or `import` EVEN WHEN THE FILE HAS A SYNTAX ERROR —
 * verified 2026-08-02 against a deliberately broken module. All 37 worker modules are ESM, so
 * the file-path form is incapable of failing on this codebase: it is failure class 3, a guard
 * narrower than its subject, reporting clean over the whole source tree. Feeding the source in
 * on stdin with an explicit --input-type=module is the form that actually parses and rejects.
 *
 * @param {string} src module source text
 * @returns {string|null}
 */
export function syntaxErrorFor(src) {
  try {
    execFileSync(process.execPath, ["--check", "--input-type=module"], {
      input: src, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    return null;
  } catch (e) {
    const line = String(e.stderr || e.message).split("\n").find((l) => /Error/.test(l));
    return line ? line.trim() : "failed to parse";
  }
}

function checkSyntax() {
  const files = readdirSync(join(WORKER, "src")).filter((f) => f.endsWith(".js"));
  const broken = [];
  for (const f of files) {
    const err = syntaxErrorFor(readFileSync(join(WORKER, "src", f), "utf8"));
    if (err) broken.push(`${f}: ${err}`);
  }
  return broken.length
    ? { status: "fail", detail: `${broken.length} module(s) will not parse:\n      ${broken.join("\n      ")}` }
    : { status: "ok", detail: `${files.length} modules parse (stdin form — see syntaxErrorFor).` };
}

/** F-37: a test file the glob cannot match contributes zero and the suite still reports green. */
function checkTestParity() {
  const all = readdirSync(join(WORKER, "test"));
  const matched = all.filter((f) => f.endsWith(".mjs"));
  const escapees = all.filter((f) => !f.endsWith(".mjs"));
  return escapees.length
    ? { status: "fail", detail: `${escapees.length} file(s) in worker/test/ escape 'test/*.mjs' and will silently not run (F-37): ${escapees.join(", ")}` }
    : { status: "ok", detail: `${matched.length} test files, all matched by the glob.` };
}

function checkSuite() {
  // Enumerate explicitly rather than passing `test/*.mjs`: CI runs under bash, which expands
  // the glob, but cmd.exe does not — the pattern arrived at node as a literal and the run
  // produced no summary. The set is identical because checkTestParity() has already proven
  // every file in test/ ends in .mjs. No shell, so no quoting and no DEP0190.
  const files = readdirSync(join(WORKER, "test")).filter((f) => f.endsWith(".mjs")).map((f) => join("test", f));
  let out = "";
  try { out = run(process.execPath, ["--test", ...files], { cwd: WORKER }); }
  catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  const t = parseTestTotals(out);
  if (!t) return { status: "fail", detail: "could not read the test summary — the run crashed or was truncated. Refusing to call that green." };
  return t.fail === 0
    ? { status: "ok", detail: `${t.pass}/${t.tests} passing, 0 failing (measured).` }
    : { status: "fail", detail: `${t.fail} failing of ${t.tests} (measured). Fix before committing.` };
}

async function readAppliedMigration(noNet) {
  if (noNet) return null;
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) return null;
  try {
    // npx.cmd on Windows; shell:true would work but concatenates unescaped args (DEP0190).
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const out = execFileSync(npx, ["--yes", "wrangler@4", "d1", "execute", "boomtown-prod", "--remote", "--json",
      "--command", "SELECT MAX(CAST(version AS INTEGER)) AS applied FROM schema_migrations;"],
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const j = JSON.parse(out);
    const rows = (Array.isArray(j) ? j : [j]).flatMap((r) => r.results || []);
    const v = rows.length ? rows[0].applied : null;
    return v === null || v === undefined ? null : Number(v);
  } catch { return null; }
}

/**
 * Decide the Pages verdict from a version and a page body. Pure, so the interesting cases are
 * unit-testable without a network: the whole point of this check is the cases where the ANSWER IS
 * ABSENT, and those are exactly the ones a live fetch is least likely to show you on any given day.
 *
 * NEVER returns ok for a body it could not read a buster out of. The defect this check exists to
 * catch was a URL that always answered 200 and never carried a version; "I found nothing" must
 * therefore be a WARN, never agreement (C10 — an absence never goes red unless you make it).
 *
 * @param {string|null} want  buster version from worker/src/index.js, e.g. "0.100.0"
 * @param {string} html       the body GitHub Pages served
 * @returns {{status:"ok"|"warn"|"fail", detail:string}}
 */
export function pagesVerdict(want, html) {
  if (!want) return { status: "fail", detail: "no version string in worker/src/index.js — cannot tell what Pages should be serving." };
  const live = [...new Set(bustersIn(html || ""))];
  if (!live.length) {
    return { status: "warn", detail: `source is ${want}; the Pages response carries NO ?v= buster, so it cannot say which build is live. If PAGES_URL was re-pointed at a page without one, this check is blind — that was the original defect.` };
  }
  if (live.length > 1) {
    return { status: "warn", detail: `source is ${want}; Pages serves ${live.length} different buster values (${live.join(", ")}) — a partial or interrupted build.` };
  }
  return live[0] === want
    ? { status: "ok", detail: `source and GitHub Pages both ${want}.` }
    : { status: "warn", detail: `source is ${want}, Pages serves ${live[0]}. Expected mid-release; AFTER a green push it means the pages-build-deployment run failed — check \`gh run list --workflow=pages-build-deployment\`. The worker and the static app deploy on SEPARATE pipelines.` };
}

async function checkPages(noNet) {
  const want = versionFromIndex(readFileSync(join(WORKER, "src", "index.js"), "utf8"));
  if (!want) return pagesVerdict(want, "");
  if (noNet) return { status: "warn", detail: `source says ${want}; GitHub Pages NOT checked (--no-net).` };
  try {
    const res = await fetch(`${PAGES_URL}?preflight=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } });
    return pagesVerdict(want, await res.text());
  } catch (e) {
    return { status: "warn", detail: `source says ${want}; GitHub Pages unreachable (${e.message}).` };
  }
}

async function checkDeployed(noNet) {
  const src = readFileSync(join(WORKER, "src", "index.js"), "utf8");
  const want = sourceVersion(src);
  if (!want) return { status: "fail", detail: "no version string in worker/src/index.js — the deploy job cannot resolve a version." };
  if (noNet) return { status: "warn", detail: `source says ${want}; /api/health NOT checked (--no-net).` };
  try {
    const res = await fetch(`${HEALTH_URL}?preflight=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } });
    const body = await res.json();
    return body.version === want
      ? { status: "ok", detail: `source and /api/health both ${want}.` }
      : { status: "warn", detail: `source is ${want}, live is ${body.version}. Expected mid-release; a mismatch AFTER a green deploy means the deploy did not land.` };
  } catch (e) {
    return { status: "warn", detail: `source says ${want}; /api/health unreachable (${e.message}).` };
  }
}

/* ============================ CLI ============================ */

const ICON = { ok: "PASS", warn: "WARN", fail: "FAIL" };

async function main() {
  const argv = process.argv.slice(2);
  const session = argv.includes("--session");
  const noNet = argv.includes("--no-net");
  const asJson = argv.includes("--json");

  if (!existsSync(join(WORKER, "src")) || !existsSync(join(REPO, "db", "migrations"))) {
    console.error("PREFLIGHT: cannot run — expected worker/src and db/migrations relative to this script.");
    process.exit(2);
  }

  const checks = {};
  checks.git = checkGit(session);
  checks.syntax = checkSyntax();
  checks.parity = checkTestParity();
  checks.suite = checkSuite();

  const { highest, unparseable } = scanMigrations(join(REPO, "db", "migrations"));
  checks.schema = unparseable.length
    ? { status: "fail", detail: `unparseable migration filename(s): ${unparseable.join(", ")}` }
    : schemaVerdict(highest, await readAppliedMigration(noNet));

  checks.deployed = await checkDeployed(noNet);
  checks.pages = await checkPages(noNet);

  const failed = Object.entries(checks).filter(([, c]) => c.status === "fail");
  const warned = Object.entries(checks).filter(([, c]) => c.status === "warn");
  const verdict = failed.length ? "BLOCKED" : "CLEAR";

  // process.exitCode, never process.exit(): the /api/health socket is still closing when we
  // get here, and tearing the loop down under it trips a libuv assertion on Windows
  // (UV_HANDLE_CLOSING) which exits 127 — a false failure on an otherwise clear preflight.
  if (asJson) {
    console.log(JSON.stringify({ verdict, checks }, null, 2));
    process.exitCode = failed.length ? 1 : 0;
    return;
  }

  console.log("");
  for (const [name, c] of Object.entries(checks)) {
    console.log(`  ${ICON[c.status]}  ${name.padEnd(9)} ${c.detail}`);
  }
  console.log("");
  if (failed.length) {
    console.log(`PREFLIGHT: BLOCKED — ${failed.length} check(s) failed: ${failed.map(([n]) => n).join(", ")}`);
    console.log("  Do not commit. Fix the above, then re-run.");
  } else {
    console.log(`PREFLIGHT: CLEAR — safe to commit and push.`);
    if (warned.length) console.log(`  ${warned.length} check(s) could not be verified: ${warned.map(([n]) => n).join(", ")}. Not the same as passing.`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
