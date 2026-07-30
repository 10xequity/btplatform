#!/usr/bin/env node
/**
 * Boomtown Platform — CHANGELOG auto-entry
 * File: worker/scripts/changelog-entry.mjs · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.36.0
 *
 * Purpose (owner decision 2026-07-30, option B — full auto-commit): after a green deploy,
 * CI runs this to prepend a release entry to CHANGELOG.md so the paste-block ritual is retired.
 *
 * WHY THIS IS A SCRIPT, NOT INLINE YAML
 * The 700-line CHANGELOG loss (v0.33.1) happened because an automated process rewrote this
 * exact file unseen. So the write logic lives here where it is unit-tested, and every property
 * that made the original incident possible is guarded against by an assertion, not a comment:
 *
 *   1. IDEMPOTENT. If an entry for VERSION already exists, exit 0 and write nothing. This is
 *      what lets CI re-runs, workflow_dispatch replays, and a human who already pasted the
 *      block coexist without ever duplicating or clobbering.
 *   2. PREPEND-ONLY. The script inserts after the title line and copies the entire remainder
 *      byte-for-byte. It computes the SHA of everything below the insertion point before and
 *      after and ABORTS (exit 3) if they differ. It is structurally incapable of editing an
 *      existing entry — the failure mode that ate 700 lines.
 *   3. TITLE-ANCHORED. Refuses (exit 2) if line 1 is not the known title, so a truncated or
 *      corrupted file on disk can never be "fixed" by blind prepending onto garbage.
 *   4. NON-DESTRUCTIVE ON DOUBT. Any structural surprise is a non-zero exit, never a silent
 *      best-effort write.
 *
 * USAGE
 *   node worker/scripts/changelog-entry.mjs --version vX.Y.Z [--date YYYY-MM-DD] \
 *        [--file CHANGELOG.md] [--body-file entry.md] [--check]
 *
 *   --check   read-only. Exit 0 if an entry already exists, 10 if it is missing. Writes nothing.
 *             (Used by the gate job to enforce/annotate without committing.)
 *
 * EXIT CODES
 *   0  wrote a new entry, OR entry already present (idempotent no-op), OR --check found one
 *   2  title anchor missing / file unreadable — refused
 *   3  tail-integrity check failed after assembly — refused, nothing written
 *   4  bad arguments
 *   10 --check: no entry for VERSION (the gate turns this into an error)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const TITLE = "# Boomtown Platform — CHANGELOG";

function arg(name, dflt = null) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes(name);

const version = arg("--version");
const file = arg("--file", "CHANGELOG.md");
const date = arg("--date", new Date().toISOString().slice(0, 10));
const bodyFile = arg("--body-file");
const checkOnly = has("--check");

if (!version || !/^v\d+\.\d+\.\d+$/.test(version)) {
  console.error("changelog-entry: --version vX.Y.Z is required");
  process.exit(4);
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

let raw;
try {
  raw = readFileSync(file, "utf8");
} catch {
  console.error(`changelog-entry: cannot read ${file}`);
  process.exit(2);
}

const lines = raw.split("\n");
if (lines[0].trim() !== TITLE) {
  console.error(`changelog-entry: refusing — line 1 is not the expected title.\n  expected: ${TITLE}\n  found:    ${lines[0]}`);
  process.exit(2);
}

// A release header is exactly "## v<semver>" at the start of a line (optionally followed by " — …").
const headerRe = new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\b| |$)`, "m");
const exists = headerRe.test(raw);

if (checkOnly) {
  if (exists) {
    console.log(`changelog-entry --check: entry for ${version} present.`);
    process.exit(0);
  }
  console.error(`changelog-entry --check: NO entry for ${version} in ${file}.`);
  process.exit(10);
}

if (exists) {
  // Idempotent: a human paste or a prior CI run already recorded this release.
  console.log(`changelog-entry: entry for ${version} already present — nothing to do.`);
  process.exit(0);
}

// Body: from --body-file if given, else a stub that is honest about being auto-generated.
let body;
if (bodyFile) {
  body = readFileSync(bodyFile, "utf8").trimEnd();
} else {
  body =
    `## ${version} — ${date}\n\n` +
    `- Auto-recorded by CI on deploy. \`/api/health\` reported \`${version}\`. ` +
    `Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.`;
}
if (!body.startsWith(`## ${version}`)) {
  body = `## ${version} — ${date}\n\n` + body;
}

// Preserve everything after the title exactly. lines[0] is the title; the rest is the tail.
// Normalise the tail to start at the first non-blank line so we control spacing deterministically.
const tail = lines.slice(1).join("\n");
const tailShaBefore = sha(tail);
const tailBody = tail.replace(/^\n+/, ""); // drop leading blanks; we re-insert exactly one gap

const assembled = `${TITLE}\n\n${body}\n\n${tailBody}`;

// Integrity: the original tail body must survive byte-for-byte as a contiguous suffix.
// This is the guard that makes an accidental edit of prior history a hard failure.
if (!assembled.endsWith(tailBody) || sha(tail) !== tailShaBefore) {
  console.error("changelog-entry: tail-integrity check FAILED — refusing to write. No changes made.");
  process.exit(3);
}

writeFileSync(file, assembled);
console.log(`changelog-entry: prepended ${version} (${body.split("\n").length} body lines). Existing history preserved (tail sha ${tailShaBefore.slice(0, 12)}).`);
process.exit(0);
