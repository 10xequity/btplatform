/* Boomtown Platform — D-17b: the marker sweep (roadmap §-1c)
   File: worker/test/marker_hygiene.test.mjs · Version: v1.0 · Date: 2026-08-08 · Ships in: v0.111.0

   WHY THIS FILE EXISTS. §-1c D-17b has now been recorded SIX times across five sessions, twice
   inside guards written to respect the rule, and twice by me. Every instance is the same mistake in
   a different costume: an assertion that pins HOW THE CODE IS CURRENTLY SPELLED instead of WHAT IT
   MUST DO. The five costumes so far were a call shape, an arity, an indentation level, a template
   position, and a CHARACTER-DISTANCE WINDOW that a comment pushed past.

   The sixth was the worst, because it did not merely break — it silently measured the wrong code.
   `JS.indexOf("const bits = [")` matched an identical string four hundred lines earlier in a
   different function, and both assertions read -1 against source that satisfied the invariant
   completely.

   A DEFECT RECORDED SIX TIMES IS NOT A DEFECT, IT IS A MISSING CHECK. Prose in a register cannot
   stop the seventh instance; this can. It scans every test file for the two mechanically detectable
   costumes and fails with file:line, so the next one is caught at the moment it is written rather
   than three sessions later when it fails against correct code.

   WHAT IT DETECTS, AND WHAT IT DELIBERATELY DOES NOT.

   · A SOURCE-SPAN WINDOW: a regex quantifier applied to `[\s\S]`, `[^]` or `.` — "these two things
     must sit within N characters of each other". That is a distance, and distance is a spelling.
     `blankComments` preserves comment LENGTH, so adding one line of explanation above a check can
     push the target past the window and redden a correct file. That is exactly how instance five
     happened.

   · A SLICE WINDOW of 50 characters or more taken from source text — the same idea spelled with
     `.slice(at, at + N)`.

   · NOT character-class quantifiers. `[0-9a-fA-F]{3,6}` is a hex colour, not a distance. NOT small
     slices: `h.slice(i, i + 2)` parses a hex pair and `bits.slice(i, i + 8)` packs a byte. Those are
     data arithmetic and have nothing to do with source layout. **A checker that flagged them would
     be noise, and a noisy checker gets an allowlist, and an allowlist is where a real instance
     hides.**

   THE FIX IS ALWAYS THE SAME AND IT IS ALREADY IN THE REPO: brace-match the region.
   `worker/testkit/route-extract.mjs` exports `blockEnd`, `functionRanges` and `enclosing`, and they
   have been there since v0.103.0.

   THIS FILE EXCLUDES ITSELF, AND THAT IS A REAL HOLE, SO IT IS PLUGGED. A scanner whose subject is
   "text that looks like X" cannot scan itself without matching its own detector. The exclusion is
   therefore paired with an NC that plants both violations in synthetic source and proves the
   detector fires — because "it found nothing" and "it cannot find anything" are the same output. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { blankComments, lineOf } from "../testkit/route-extract.mjs";

const DIR = new URL("./", import.meta.url);
const SELF = "marker_hygiene.test.mjs";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".test.mjs") && f !== SELF);

/** A quantifier applied to an ANY-CHARACTER class is a distance between two spellings. */
const SPAN_WINDOW = /(?:\[\\s\\S\]|\[\^\]|\.)\{\d+,\d+\}/g;

/** `.slice(a, a + N)` with a big N is the same window written another way. */
const SLICE_WINDOW = /\.slice\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*\+\s*(\d+)\s*\)/g;
const SLICE_MIN = 50;

function findingsIn(name, raw) {
  // Comments are BLANKED, not removed: offsets stay true, so reported line numbers are not lies.
  // It also means prose ABOUT a past window (this repo documents its own defects) is not counted.
  const src = blankComments(raw);
  const out = [];
  for (const m of src.matchAll(SPAN_WINDOW)) {
    out.push(`${name}:${lineOf(src, m.index)} — source-span window ${m[0]}`);
  }
  for (const m of src.matchAll(SLICE_WINDOW)) {
    if (Number(m[1]) >= SLICE_MIN) out.push(`${name}:${lineOf(src, m.index)} — slice window +${m[1]}`);
  }
  return out;
}

const scanAll = () =>
  FILES.flatMap((f) => findingsIn(f, readFileSync(new URL(f, DIR), "utf8")));

test("the sweep has something to sweep — the corpus is real", () => {
  // If this file ever scanned zero files it would report clean forever. That is the failure mode
  // this whole loop is built against, so the corpus is asserted before anything is concluded from it.
  assert.ok(FILES.length > 80, `expected the whole test corpus, got ${FILES.length} files`);
  assert.ok(!FILES.includes(SELF), "the scanner must not scan itself — see the header");
});

test("D-17b: no assertion pins a character distance instead of a behaviour", () => {
  const found = scanAll();
  assert.deepEqual(found, [],
    "Each of these pins how far apart two things happen to sit, which is a spelling, not a behaviour.\n" +
    "Re-anchor on a brace-matched region: worker/testkit/route-extract.mjs exports blockEnd,\n" +
    "functionRanges and enclosing.\n\n" + found.join("\n"));
});

test("NC: the detector fires on planted violations, in both costumes", () => {
  // The exclusion above is a hole. This is the plug: synthetic source carrying one of each.
  const planted = [
    'assert.ok(/function foo\\([\\s\\S]{0,400}?bar/.test(SRC));',
    'const body = src.slice(at, at + 900);',
  ].join("\n");
  const hits = findingsIn("planted.test.mjs", planted);
  assert.equal(hits.length, 2, `the detector must catch both costumes, caught ${hits.length}: ${hits.join(" | ")}`);
  assert.match(hits[0], /source-span window/);
  assert.match(hits[1], /slice window \+900/);
});

test("NC: the detector does NOT fire on data arithmetic or character classes", () => {
  // An over-eager checker gets an allowlist, and an allowlist is where a real instance hides.
  const innocent = [
    'assert.doesNotMatch(body, /#[0-9a-fA-F]{3,6}/, "bare rule hardcodes a hex");',
    'return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));',
    'for (let i = 0; i + 8 <= bits.length; i += 8) words.push(bits.slice(i, i + 8));',
    'else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);',
  ].join("\n");
  assert.deepEqual(findingsIn("innocent.test.mjs", innocent), [],
    "hex pairs, byte packing and brace matching are not distance windows");
});

test("NC: blanking comments is what stops prose about a past window counting as one", () => {
  // This repo documents its own defects verbatim, so a scanner that read comments would accuse the
  // history of being the crime. Assert the blanking, and assert it preserves LENGTH.
  const withComment = "// a past bug used /foo[\\s\\S]{0,400}?bar/ and failed\nconst x = 1;";
  assert.deepEqual(findingsIn("prose.test.mjs", withComment), [],
    "a window described in a comment is history, not an assertion");
  assert.equal(blankComments(withComment).length, withComment.length,
    "blankComments must preserve length or every reported line number is a lie");
});
