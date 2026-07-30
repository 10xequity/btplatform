/**
 * worker/test/changelog_entry.test.mjs · v1.0 · 2026-07-30 · ships in v0.36.0
 * Guards worker/scripts/changelog-entry.mjs — the CI auto-commit writer. This file is the
 * thing standing between "automate the changelog" and "automate the 700-line loss again",
 * so the destructive-refusal paths are tested as hard as the happy path.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../scripts/changelog-entry.mjs", import.meta.url).pathname;
const TITLE = "# Boomtown Platform — CHANGELOG";
const FIXTURE = `${TITLE}\n\n## v0.36.0 — 2026-07-30\n\n- Existing entry.\n\n## v0.35.0 — 2026-07-29\n\n- Older entry.\n`;

function run(dir, args) {
  try {
    const out = execFileSync("node", [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}
function fresh() {
  const d = mkdtempSync(join(tmpdir(), "cl-"));
  writeFileSync(join(d, "CHANGELOG.md"), FIXTURE);
  return d;
}

test("--check: exit 0 when the version exists", () => {
  const d = fresh();
  assert.equal(run(d, ["--version", "v0.36.0", "--check"]).code, 0);
  rmSync(d, { recursive: true });
});

test("--check: exit 10 when the version is missing (gate turns this into an error)", () => {
  const d = fresh();
  assert.equal(run(d, ["--version", "v0.99.0", "--check"]).code, 10);
  rmSync(d, { recursive: true });
});

test("idempotent: writing an existing version leaves the file byte-identical", () => {
  const d = fresh();
  const before = readFileSync(join(d, "CHANGELOG.md"), "utf8");
  assert.equal(run(d, ["--version", "v0.36.0"]).code, 0);
  assert.equal(readFileSync(join(d, "CHANGELOG.md"), "utf8"), before);
  rmSync(d, { recursive: true });
});

test("prepend: new version lands at the top, blank line between entries, tail preserved", () => {
  const d = fresh();
  writeFileSync(join(d, "b.md"), "- New thing.\n");
  assert.equal(run(d, ["--version", "v0.37.0", "--date", "2026-07-31", "--body-file", "b.md"]).code, 0);
  const after = readFileSync(join(d, "CHANGELOG.md"), "utf8");
  assert.match(after, /^# Boomtown Platform — CHANGELOG\n\n## v0\.37\.0 — 2026-07-31\n\n- New thing\.\n\n## v0\.36\.0/);
  // Every pre-existing byte below the title survives as a suffix.
  const origTail = FIXTURE.split("\n").slice(1).join("\n").replace(/^\n+/, "");
  assert.ok(after.endsWith(origTail), "original history is not preserved as a contiguous suffix");
  rmSync(d, { recursive: true });
});

test("refuses (exit 2, no write) when line 1 is not the title — cannot 'fix' a corrupt file", () => {
  const d = fresh();
  writeFileSync(join(d, "CHANGELOG.md"), "GARBAGE\n\n## v0.36.0 — x\n");
  const before = readFileSync(join(d, "CHANGELOG.md"), "utf8");
  assert.equal(run(d, ["--version", "v0.40.0"]).code, 2);
  assert.equal(readFileSync(join(d, "CHANGELOG.md"), "utf8"), before);
  rmSync(d, { recursive: true });
});

test("rejects a malformed --version (exit 4)", () => {
  const d = fresh();
  assert.equal(run(d, ["--version", "0.40"]).code, 4);
  rmSync(d, { recursive: true });
});

test("three consecutive runs of one version produce exactly one header (replay-safe)", () => {
  const d = fresh();
  writeFileSync(join(d, "b.md"), "- once.\n");
  for (let i = 0; i < 3; i++) run(d, ["--version", "v0.37.0", "--body-file", "b.md"]);
  const after = readFileSync(join(d, "CHANGELOG.md"), "utf8");
  assert.equal((after.match(/^## v0\.37\.0/gm) || []).length, 1);
  rmSync(d, { recursive: true });
});
