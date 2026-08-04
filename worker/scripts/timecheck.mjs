/**
 * Boomtown Platform — C16 time-bomb check
 * File: worker/scripts/timecheck.mjs · Version: v1.0 · Date: 2026-08-04 · Ships in: v0.86.0
 *
 * Runs the whole suite with JS time and SQL time shifted forward by the same offset, several times at
 * different offsets, and reports which test files fail. A file that fails has an absolute date coupled
 * to the clock — a C16 time bomb whose detonation date is already fixed. See timetravel.mjs for why
 * both halves of the clock must move together.
 *
 *   node worker/scripts/timecheck.mjs                 # default offsets: 1, 8, 40, 200, 400 days
 *   node worker/scripts/timecheck.mjs --days 365       # one specific offset
 *   node worker/scripts/timecheck.mjs --days 1,30,365  # several
 *
 * EXIT 0 means the suite is clock-independent at every offset tried. It is NOT a proof: a coupling
 * that only breaks on a leap day or a month boundary needs the offset that lands there, which is why
 * the default is a spread rather than one number. Absence of a finding is not absence of a bomb.
 *
 * This is a REPORTING tool, deliberately not a gate. Turning it into a preflight check would block
 * commits on a defect that is often in a file nobody touched, which is how a useful signal becomes a
 * thing people disable. Run it when the suite reddens for no reason, and after adding fixtures.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const TESTS = join(REPO, "worker", "test");
/* `--import` goes through the ESM loader, which on Windows rejects a bare absolute path:
   "Only URLs with a scheme in: file, data, and node are supported ... Received protocol 'd:'".
   A file:// URL is portable and works on both. */
const PRELOAD = pathToFileURL(join(HERE, "timetravel.mjs")).href;

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

const offsets = (arg("--days") || "1,8,40,200,400")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n !== 0);

const files = readdirSync(TESTS).filter((f) => f.endsWith(".test.mjs")).sort();
if (files.length < 40) {
  console.error(`timecheck: only ${files.length} test files found — refusing to report on a corpus this small.`);
  process.exit(2);
}

console.log(`timecheck: ${files.length} test files · offsets ${offsets.join(", ")} days\n`);

/** @returns {{failed:string[], ran:number}} */
function runAt(days) {
  const failed = [];
  let ran = 0;
  for (const f of files) {
    const r = spawnSync(
      process.execPath,
      ["--import", PRELOAD, "--test", join(TESTS, f)],
      { env: { ...process.env, BT_TIME_TRAVEL_DAYS: String(days) }, encoding: "utf8", cwd: REPO },
    );
    ran++;
    if (r.status !== 0) failed.push(f);
  }
  return { failed, ran };
}

const armed = new Map();   // file -> offsets at which it failed
for (const days of offsets) {
  const { failed, ran } = runAt(days);
  const label = `+${days}d`.padEnd(7);
  console.log(`  ${label} ${ran - failed.length}/${ran} files pass${failed.length ? "  FAIL: " + failed.join(", ") : ""}`);
  for (const f of failed) {
    if (!armed.has(f)) armed.set(f, []);
    armed.get(f).push(days);
  }
}

console.log("");
if (!armed.size) {
  console.log(`timecheck: CLEAN at every offset tried (${offsets.join(", ")} days).`);
  console.log("  Not a proof — a coupling that only breaks on a specific calendar date needs an offset that lands there.");
  process.exit(0);
}

console.log(`timecheck: ${armed.size} file(s) are CLOCK-DEPENDENT:\n`);
for (const [f, days] of [...armed.entries()].sort()) {
  console.log(`  ${f}`);
  console.log(`      fails at: ${days.map((d) => "+" + d + "d").join(", ")}`);
}
console.log("\n  Each of these holds an absolute date compared against something derived from `now`.");
console.log("  Fix: derive the fixture from Date.now() so it keeps its relationship to the clock.");
console.log("  A file failing at EVERY offset is already broken in the future; one failing at some");
console.log("  offsets has a window, and the window is what makes these arrive as a surprise.");
process.exit(1);
