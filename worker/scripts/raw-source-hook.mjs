/**
 * Boomtown Platform — the fs shim `raw-source-sweep.mjs` runs each test file under
 * File: worker/scripts/raw-source-hook.mjs · Version: v1.0 · Date: 2026-08-17 · Ships in: NO-BUMP
 *
 * Loaded with `node --import`, so it patches `readFileSync` before any test file is evaluated.
 * Three modes, chosen by `BT_RS_MODE`:
 *
 *   record   append every TEXT read to `BT_RS_OUT`, with the line of the test file that asked
 *   comment  serve `BT_RS_TARGET` with every line prefixed by `//` — the bytes stay, the code stops
 *   empty    serve `BT_RS_TARGET` as an empty string
 *
 * THE PATCH GOES THROUGH `createRequire`, AND THAT IS NOT A STYLE CHOICE. Measured 2026-08-17:
 * `import fs from "node:fs"; fs.readFileSync = …` does NOT reach a test file's
 * `import { readFileSync } from "node:fs"` — a builtin's ES-module facade is built from the CJS
 * exports object the first time it is imported, so a later assignment is invisible to the named
 * binding. 80 of the 137 test files use the named form. Taking the exports object through
 * `createRequire` patches it BEFORE any facade exists, and then both forms see it.
 *
 * ONLY TEXT READS ARE RECORDED OR MUTATED. Node's ES-module loader reads every imported module
 * through this same public function, but with no encoding, so it comes back a Buffer. Recording
 * those would put one unmutable pair in the report for every import in every test file, and each
 * would look "blind" for the wrong reason — the mutation is a no-op on a Buffer, not a guard that
 * ignores comments. A guard reads source as a STRING, and that is the population being measured.
 *
 * `^(.*)$` with /gm stops before a `\r` (a LineTerminator to the regex engine) and `$` matches
 * there, so CRLF survives the rewrite. A mutant that also normalised line endings would be
 * changing two things at once.
 */
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const fs = req("node:fs");
const path = req("node:path");
const url = req("node:url");

const MODE = process.env.BT_RS_MODE || "record";
const OUT = process.env.BT_RS_OUT;
const TARGET = (process.env.BT_RS_TARGET || "").toLowerCase();
const TESTBASE = (process.env.BT_RS_TESTBASE || "").toLowerCase();
const orig = fs.readFileSync;

const abs = (p) => {
  try {
    if (p instanceof URL) return url.fileURLToPath(p);
    if (typeof p === "string") return p.startsWith("file:") ? url.fileURLToPath(p) : path.resolve(p);
  } catch { /* not a path this shim can name — leave it alone */ }
  return null;
};

/* The line INSIDE the test file that triggered the read. Frames are matched on basename, which is
   unique across worker/test/, so neither side needs path normalisation. 0 means the read came from
   somewhere else — a helper module, or the loader. */
const siteIn = () => {
  for (const f of String(new Error("site").stack || "").split("\n").slice(2)) {
    const m = f.match(/([A-Za-z0-9_.-]+\.mjs):(\d+):\d+/);
    if (m && m[1].toLowerCase() === TESTBASE) return Number(m[2]);
  }
  return 0;
};

const commentOut = (s) => s.replace(/^(.*)$/gm, "//$1");

fs.readFileSync = function (p, ...rest) {
  const out = orig.call(this, p, ...rest);
  if (typeof out !== "string") return out;
  const a = abs(p);
  if (!a) return out;
  if (MODE === "record") {
    try {
      fs.appendFileSync(OUT, JSON.stringify({ path: a, line: siteIn() }) + "\n");
    } catch { /* recording must never break the test being measured */ }
    return out;
  }
  if (a.toLowerCase() !== TARGET) return out;
  return MODE === "empty" ? "" : commentOut(out);
};
