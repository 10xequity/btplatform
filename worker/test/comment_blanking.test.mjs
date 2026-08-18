/**
 * Boomtown Platform — the comment blanker must not delete code (§6 item 0c, the instrument half)
 * File: worker/test/comment_blanking.test.mjs · Version: v1.0 · Date: 2026-08-17 · Ships in: NO-BUMP
 *
 * WHY THIS FILE EXISTS. `blankComments` is the shared answer to comment blindness — 34 test files
 * import it, the gate scanners have used it since v0.102.0, and v0.168.0's `mountsAndWires` was
 * built on it after eleven mount anchors were found accepting a mount that had been commented out.
 * It was two `String.replace` calls, and on 2026-08-17 it measured as DELETING LIVE CODE from 98 of
 * the 118 shipped JS files. Block comments were blanked first, over the whole text, with no notion
 * of a string or a line comment, so any `/*` inside either opened a phantom block comment that ran
 * to the next close-comment token. `index.js:572` carries the worked example — the `/*` inside the
 * trailing comment `/api/waiver/*` swallowed 155 live lines, including 40 of the 43 dispatch-table
 * entries. Nothing in the suite noticed for the ten days the mount fix has been shipped.
 *
 * THE ORACLE, AND WHY IT IS THIS ONE. Blanking a comment cannot change whether a file parses, so
 * "the blanked text still parses" is the exact invariant, it needs no fixture, and it covers the
 * whole corpus rather than the cases somebody thought of. Both parse modes come from `preflight`
 * because both are already correct there: worker modules are ES modules, the browser corpus is
 * classic scripts, and preflight's header records why neither substitutes for the other.
 *
 * NC-9 IS THE ONE THAT MATTERS MOST: it runs the OLD implementation, inlined, and asserts the
 * oracle CATCHES it. An oracle that passes everything reports clean by seeing nothing, and this
 * defect survived because every consumer asserted the presence of a needle that happened to sit
 * outside an eaten span. The legacy body stays here as the pinned defect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { blankComments, dispatchTableIn } from "../testkit/route-extract.mjs";
import { syntaxErrorFor } from "../scripts/preflight.mjs";

const SRC_DIR = new URL("../src/", import.meta.url);
const WEB_DIRS = [new URL("../../web/assets/", import.meta.url), new URL("../../web/", import.meta.url)];
const INDEX = readFileSync(new URL("index.js", SRC_DIR), "utf8");

const modules = readdirSync(SRC_DIR).filter((f) => f.endsWith(".js"));
const webScripts = WEB_DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".js")).map((f) => new URL(f, d)));

/** The blanker as it shipped from v0.102.0 to 2026-08-17. Kept ONLY as NC-9's input. */
const legacyBlankComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
   .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

const classicError = (s) => { try { new vm.Script(s); return null; } catch (e) { return e.message; } };

/* ── the corpus is real before anything is concluded about it ─────────────────────────────── */

test("the corpus is real — both halves were read and are the size this repo has", () => {
  assert.ok(modules.length >= 45, `expected 45+ worker modules, read ${modules.length}`);
  assert.ok(webScripts.length >= 60, `expected 60+ browser scripts, read ${webScripts.length}`);
  assert.ok(INDEX.length > 10_000, `index.js read as ${INDEX.length} bytes — that is not the router`);
});

/* ── the oracle ───────────────────────────────────────────────────────────────────────────── */

test("blanking leaves every worker module parsing as an ES module", () => {
  const broken = [];
  for (const f of modules) {
    const raw = readFileSync(new URL(f, SRC_DIR), "utf8");
    if (syntaxErrorFor(raw)) continue;                    // a file already broken is not this test's finding
    const err = syntaxErrorFor(blankComments(raw));
    if (err) broken.push(`${f}: ${err}`);
  }
  assert.deepEqual(broken, [], `blankComments deleted code from ${broken.length} module(s):\n  ${broken.join("\n  ")}`);
});

test("blanking leaves every browser script compiling as a classic script", () => {
  const broken = [];
  for (const u of webScripts) {
    const raw = readFileSync(u, "utf8");
    if (classicError(raw)) continue;
    const err = classicError(blankComments(raw));
    if (err) broken.push(`${u.pathname.split("/").pop()}: ${err}`);
  }
  assert.deepEqual(broken, [], `blankComments deleted code from ${broken.length} browser script(s):\n  ${broken.join("\n  ")}`);
});

test("blanking preserves length and every newline position — offsets and line numbers stay true", () => {
  for (const f of modules) {
    const raw = readFileSync(new URL(f, SRC_DIR), "utf8");
    const out = blankComments(raw);
    assert.equal(out.length, raw.length, `${f}: length changed, so every reported offset after it is a lie`);
    assert.equal(out.split("\n").length, raw.split("\n").length, `${f}: line count changed`);
  }
});

/* ── it still does the job it exists for ──────────────────────────────────────────────────── */

test("a line comment and a block comment are both blanked", () => {
  const src = 'const a = 1; // wireGhost(wiredHelpers)\n/* wirePhantom(wiredHelpers)\n   still comment */\nconst b = 2;\n';
  const out = blankComments(src);
  assert.ok(!out.includes("wireGhost"), "a line comment must be blanked");
  assert.ok(!out.includes("wirePhantom"), "a block comment must be blanked");
  assert.ok(!out.includes("still comment"), "a block comment's later lines must be blanked too");
  assert.match(out, /const a = 1;/, "and the code before it must survive");
  assert.match(out, /const b = 2;/, "and the code after it must survive");
});

test("a comment inside a template hole is blanked, and the template's own text is not", () => {
  const src = 'const s = `path //not-a-comment ${x /* gone */ + 1} tail /* also text */`;\n';
  const out = blankComments(src);
  assert.ok(out.includes("//not-a-comment"), "template text is data, not comment");
  assert.ok(out.includes("also text"), "and so is text after a hole");
  assert.ok(!out.includes("gone"), "a real comment inside the hole must still be blanked");
});

/* ── negative controls: each is a shape that USED to eat code ─────────────────────────────── */

test("NC-1 the pinned defect — a /* inside a line comment must not open a comment (real index.js)", () => {
  const anchor = INDEX.split("\n").find((l) => /^\s*\["waiver",/.test(l));
  assert.ok(anchor && anchor.includes("/api/waiver/*"),
    "precondition: index.js still carries the trailing comment that caused this — if it moved, keep the fixture below");
  const out = blankComments(INDEX);
  assert.ok(out.includes('["waiver",'), "the dispatch entry itself must survive");
  const raw = dispatchTableIn(INDEX);
  assert.ok(raw.length >= 40, `the blanked dispatch table holds ${raw.length} entries — the phantom comment is back`);
});

test("NC-2 a // inside a string is not a comment — the URL case", () => {
  const src = 'const u = "https://api.example.com/v3/thing"; wireThing(wiredHelpers);\n';
  const out = blankComments(src);
  assert.ok(out.includes("api.example.com"), "the URL must survive");
  assert.ok(out.includes("wireThing(wiredHelpers)"), "and so must the code after it on the same line");
});

test("NC-3 a close-comment token inside a string does not close a comment", () => {
  const src = 'const s = "*/"; wireThing(wiredHelpers);\n/* real */ const t = 1;\n';
  const out = blankComments(src);
  assert.ok(out.includes("wireThing(wiredHelpers)"), "code after a string holding */ must survive");
  assert.ok(!out.includes("real"), "and a genuine block comment must still be blanked");
});

test("NC-4 a /* inside a regex literal does not open a comment", () => {
  const src = 'const re = /[/*]/g; wireThing(wiredHelpers);\nconst also = /a\\/\\*b/; const x = 2;\n';
  const out = blankComments(src);
  assert.ok(out.includes("wireThing(wiredHelpers)"), "code after a regex holding /* must survive");
  assert.ok(out.includes("const x = 2"), "and after an escaped one too");
});

test("NC-5 division is not mistaken for a regex in a way that loses code", () => {
  const src = 'const r = (a + b) / 2; wireThing(wiredHelpers);\nconst q = arr[0] / n; const z = 3;\n';
  const out = blankComments(src);
  assert.ok(out.includes("wireThing(wiredHelpers)"), "code after a division must survive");
  assert.ok(out.includes("const z = 3"), "including after an indexed division");
});

test("NC-6 an unterminated block comment blanks to the end and nothing beyond it survives to lie", () => {
  const src = 'const a = 1;\n/* opened and never closed\nconst b = 2;\n';
  const out = blankComments(src);
  assert.match(out, /const a = 1;/);
  assert.ok(!out.includes("const b"), "text after an unclosed comment is inside it");
  assert.equal(out.length, src.length, "and length is still preserved");
});

test("NC-7 blanking is idempotent — running it twice changes nothing", () => {
  const once = blankComments(INDEX);
  assert.equal(blankComments(once), once, "a blanked file must be a fixed point");
});

test("NC-8 the oracle can fail — a genuinely broken file is reported, not laundered", () => {
  assert.ok(syntaxErrorFor("const a = ("), "the ES-module parse must reject broken source");
  assert.ok(classicError("const a = ("), "the classic parse must reject broken source");
});

test("NC-9 the oracle CATCHES the old implementation — the defect is pinned, not just fixed", () => {
  /* Without this the two oracle tests above are unfalsifiable: they would pass identically against a
     blanker that did nothing at all. The legacy body is the input that must fail. */
  const legacy = legacyBlankComments(INDEX);
  assert.ok(syntaxErrorFor(legacy),
    "the legacy blanker's output must FAIL to parse — if it parses, the oracle cannot see this defect");
  assert.ok(!legacy.includes('["consent",'),
    "the legacy blanker must be seen eating a dispatch entry it had no business touching");
  const legacyTable = [...legacy.slice(legacy.indexOf("const table = ["))
    .matchAll(/\["[a-zA-Z]+",\s+([a-zA-Z]+)\],/g)].map((m) => m[1]);
  assert.ok(legacyTable.length < 10 && dispatchTableIn(INDEX).length >= 40,
    `legacy saw ${legacyTable.length} table entries, the repaired blanker sees ${dispatchTableIn(INDEX).length}`);
});
