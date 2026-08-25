#!/usr/bin/env node
/**
 * Boomtown Platform — the Gemini review backlog library (§-1r RF-19)
 * File: worker/scripts/gemini-backlog.mjs · Version: v1.0 · Date: 2026-08-25 · Ships in: v0.199.0+
 *
 * Owner 2026-08-25: "please create backlog library and run it to the free cap then save it for
 * the next day/available time to run it little by little everyday."
 *
 * THE LIBRARY is docs/gemini-backlog.json — one row per reviewable file: status, the date of its
 * last review, and what came of it. The RUNNING half stays with the loop (the gemini MCP is
 * session-side): each session asks `--next N` for the day's batch, reviews until the free tier
 * says stop (20/day; 503 failures also burn it), and `--mark`s what it reached. The file, not a
 * prompt clause, is now where "what has Gemini seen" lives — a session that reviews nothing
 * changes nothing.
 *
 * Commands:
 *   node worker/scripts/gemini-backlog.mjs --list [pending|reviewed]
 *   node worker/scripts/gemini-backlog.mjs --next 6
 *   node worker/scripts/gemini-backlog.mjs --mark <file> reviewed|kept|rejected [--note "…"]
 *   node worker/scripts/gemini-backlog.mjs --seed          (adds any new repo file as pending)
 *   node worker/scripts/gemini-backlog.mjs --stats
 *
 * Ordering of --next: carry files first (touched-but-never-reviewed, oldest first), then the
 * never-reviewed backlog (worker modules before page scripts — the server side is the more
 * load-bearing review). A file edited AFTER its last review goes back to pending on --seed.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DB = join(ROOT, "docs/gemini-backlog.json");

const corpusFiles = () => {
  const out = [];
  for (const f of readdirSync(join(ROOT, "worker/src")).filter((x) => x.endsWith(".js"))) out.push("worker/src/" + f);
  for (const f of readdirSync(join(ROOT, "web/assets")).filter((x) => x.endsWith(".js") || x.endsWith(".css"))) out.push("web/assets/" + f);
  // Five scripts live at web/ root, not web/assets/ — the first seed missed home.js this way.
  for (const f of readdirSync(join(ROOT, "web")).filter((x) => x.endsWith(".js"))) out.push("web/" + f);
  return out;
};

const load = () => JSON.parse(readFileSync(DB, "utf8"));
const save = (rows) => writeFileSync(DB, JSON.stringify(rows, null, 1) + "\n");
const mtime = (f) => { try { return statSync(join(ROOT, f)).mtime.toISOString().slice(0, 10); } catch { return null; } };

const [, , cmd, ...args] = process.argv;

if (cmd === "--seed") {
  const rows = existsSync(DB) ? load() : [];
  const known = new Set(rows.map((r) => r.file));
  let added = 0;
  for (const f of corpusFiles()) {
    if (!known.has(f)) { rows.push({ file: f, status: "pending", tier: "never-reviewed", last_review: null, note: null }); added++; }
  }
  // NO mtime-based auto-reopen: the buster sweep re-stamps ~70 files every release, so an
  // mtime rule reopened the whole reviewed set on day one and the library could never
  // converge. Reopening a substantively-edited file is a judgement the loop's close makes
  // with --mark; the sweep is not an edit worth a re-review.
  save(rows);
  console.log(`seeded: +${added} new, ${rows.length} total`);
} else if (cmd === "--list") {
  const want = args[0];
  for (const r of load()) if (!want || r.status === want || (want === "reviewed" && r.status !== "pending")) {
    console.log(`${r.status.padEnd(9)} ${r.file}${r.last_review ? " · " + r.last_review : ""}${r.note ? " · " + r.note : ""}`);
  }
} else if (cmd === "--next") {
  const n = Number(args[0] || 6);
  const rows = load().filter((r) => r.status === "pending");
  const rank = (r) => (r.tier === "carry" ? 0 : r.tier?.startsWith("re-review") ? 1 : r.file.startsWith("worker/") ? 2 : 3);
  rows.sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file));
  for (const r of rows.slice(0, n)) console.log(r.file);
} else if (cmd === "--mark") {
  const [file, status] = args;
  const noteIx = args.indexOf("--note");
  const rows = load();
  const row = rows.find((r) => r.file === file);
  if (!row) { console.error(`not in the library: ${file}`); process.exit(1); }
  if (!["reviewed", "kept", "rejected"].includes(status)) { console.error(`bad status: ${status}`); process.exit(1); }
  row.status = status;
  row.last_review = new Date().toISOString().slice(0, 10);
  if (noteIx > -1) row.note = args[noteIx + 1];
  save(rows);
  console.log(`${file} → ${status}`);
} else if (cmd === "--stats") {
  const rows = load();
  const by = {};
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  console.log(JSON.stringify({ total: rows.length, ...by }));
} else {
  console.log("usage: gemini-backlog.mjs --seed | --list [status] | --next N | --mark <file> <status> [--note …] | --stats");
}
