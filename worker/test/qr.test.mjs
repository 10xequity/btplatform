/* Boomtown Platform — QR encoder tests
   File: worker/test/qr.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.68.0

   A WRONG QR CODE LOOKS EXACTLY LIKE A RIGHT ONE. It renders, it is square, it has the three
   corner squares — and a phone will not read it. Nobody finds out until a captain is standing at
   the desk at a tournament. Eyeballing it proves nothing, so everything here is a machine check.

   Four independent angles, deliberately not sharing the encoder's assumptions:

   1. TABLE CONSISTENCY. The spec tables were transcribed by hand from thonky.com. For every
      version, blocks × (data + ec) must equal that version's total codeword count. One mistyped
      number is caught here rather than in a gym.
   2. REED-SOLOMON, BY DEFINITION. An RS codeword is one that the generator polynomial divides
      exactly — so evaluating it at a^0..a^(n-1) must give zero every time. That is the definition,
      computed here with a GF(256) implementation written separately from the encoder's.
   3. ROUND TRIP. A decoder, written here from the spec rather than by importing the encoder's
      placement code, reads the modules back and must recover the original string. This exercises
      masking, interleaving, the zigzag walk and the function-pattern map all at once.
   4. STRUCTURE. Finder patterns, timing, quiet zone, the always-dark module.

   WHAT THESE CANNOT PROVE: that a real phone camera reads it. Scan one before an event. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../../web/assets/qr.js", import.meta.url), "utf8");
new Function(SRC)();                       // the IIFE attaches to globalThis when window is absent
const QR = globalThis.BTQR;
const { M, ALIGN, dataCapacity, pickVersion, encodeData, interleave, ecFor, formatBits } = QR._internals;

/* ---------------- an independent GF(256), for checking the encoder's ---------------- */
const E = new Uint8Array(512), L = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { E[i] = x; L[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) E[i] = E[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : E[(L[a] + L[b]) % 255]);

/* ================================ 1. the tables ================================ */

test("every version's block layout adds up to its total codeword count", () => {
  // blocks × (data + ec) === total. A single mistyped number here yields a code that renders
  // perfectly and cannot be scanned.
  for (let v = 1; v <= 10; v++) {
    const [total, ec, g1, d1, g2, d2] = M[v];
    const sum = g1 * (d1 + ec) + g2 * (d2 + ec);
    assert.equal(sum, total, `version ${v}: blocks sum to ${sum}, table says ${total}`);
  }
});

test("data capacity is the sum of the block data sizes, and grows with version", () => {
  let prev = 0;
  for (let v = 1; v <= 10; v++) {
    const [, , g1, d1, g2, d2] = M[v];
    assert.equal(dataCapacity(v), g1 * d1 + g2 * d2);
    assert.ok(dataCapacity(v) > prev, `version ${v} must hold more than version ${v - 1}`);
    prev = dataCapacity(v);
  }
  assert.equal(dataCapacity(10), 216, "version 10 at level M holds 216 data codewords");
});

test("alignment centres are inside the symbol and start at 6", () => {
  for (let v = 2; v <= 10; v++) {
    const size = v * 4 + 17;
    assert.equal(ALIGN[v][0], 6, `version ${v} must start at 6`);
    assert.equal(ALIGN[v][ALIGN[v].length - 1], size - 7, `version ${v} must end at size-7`);
    for (const p of ALIGN[v]) assert.ok(p >= 6 && p < size - 6, `version ${v}: ${p} is out of range`);
  }
  assert.deepEqual(ALIGN[1], [], "version 1 has no alignment pattern");
});

/* ================================ 2. Reed-Solomon ================================ */

test("the error-correction codewords are, by definition, correct", () => {
  // An RS codeword is divisible by the generator polynomial, so it evaluates to zero at every
  // root a^0..a^(n-1). Checked with the GF implementation written at the top of this file, not the
  // encoder's — two implementations agreeing is evidence; one agreeing with itself is not.
  for (const ecLen of [10, 16, 18, 22, 24, 26]) {
    const data = Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 0xff);
    const code = [...data, ...ecFor(data, ecLen)];
    for (let i = 0; i < ecLen; i++) {
      let acc = 0;
      for (const coef of code) acc = gmul(acc, E[i]) ^ coef;   // Horner at x = a^i
      assert.equal(acc, 0, `ec=${ecLen}: codeword is not divisible by the generator (root a^${i})`);
    }
  }
});

test("a corrupted codeword does NOT evaluate to zero", () => {
  // Negative control for the check above. If a damaged codeword still passed, the syndrome test
  // would be proving nothing at all.
  const data = Array.from({ length: 20 }, (_, i) => i + 1);
  const code = [...data, ...ecFor(data, 10)];
  code[3] ^= 0x5a;
  let nonZero = 0;
  for (let i = 0; i < 10; i++) {
    let acc = 0;
    for (const coef of code) acc = gmul(acc, E[i]) ^ coef;
    if (acc !== 0) nonZero++;
  }
  assert.ok(nonZero > 0, "flipping a byte must break at least one syndrome");
});

/* ================================ 3. format information ================================ */

test("format info is a valid BCH(15,5) word with the spec mask applied", () => {
  // Recomputed here independently: undo the 0x5412 XOR, then confirm the 15-bit word is divisible
  // by the BCH generator 0x537 and that its top 5 bits are the level-M bits plus the mask id.
  for (let mask = 0; mask < 8; mask++) {
    const raw = formatBits(mask) ^ 0x5412;
    assert.equal(raw >> 10, (0b00 << 3) | mask, `mask ${mask}: wrong data bits (level M is 00)`);
    let rem = raw;
    for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
    assert.equal(rem, 0, `mask ${mask}: not divisible by the BCH generator`);
  }
});

test("no two masks produce the same format word", () => {
  const seen = new Set();
  for (let mask = 0; mask < 8; mask++) seen.add(formatBits(mask));
  assert.equal(seen.size, 8);
});

/* ================================ 4. structure ================================ */

function grid(text) { return QR.modules(text); }

test("the three finder patterns are where a scanner looks for them", () => {
  const { modules: m, size } = grid("https://boomtown.test/score.html?t=deadbeef00090101");
  const corners = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (const [r0, c0] of corners) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const want = (r === 0 || r === 6 || c === 0 || c === 6) ? 1
          : (r >= 2 && r <= 4 && c >= 2 && c <= 4) ? 1 : 0;
        assert.equal(m[r0 + r][c0 + c], want, `finder at ${r0},${c0} wrong at ${r},${c}`);
      }
    }
  }
  // The fourth corner must NOT have one — that is how a scanner works out the orientation.
  const q = [size - 7, size - 7];
  let allSet = true;
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if (!m[q[0] + r][q[1] + c]) allSet = false;
  assert.equal(allSet, false, "a fourth finder pattern would destroy orientation detection");
});

test("timing patterns alternate, and the dark module is dark", () => {
  const { modules: m, size } = grid("https://boomtown.test/score.html?t=deadbeef00090101");
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0 ? 1 : 0, `horizontal timing wrong at ${i}`);
    assert.equal(m[i][6], i % 2 === 0 ? 1 : 0, `vertical timing wrong at ${i}`);
  }
  assert.equal(m[size - 8][8], 1, "the always-dark module must be dark");
});

test("version selection takes the smallest symbol that fits, and refuses what will not", () => {
  assert.equal(pickVersion(10), 1);
  assert.equal(pickVersion(dataCapacity(1) - 2), 1, "1 byte mode + 1 count byte of overhead");
  assert.equal(pickVersion(dataCapacity(1) - 1), 2, "one byte more must step up a version");
  assert.equal(pickVersion(200), 10);
  assert.throws(() => pickVersion(400), /more than version 10/,
    "too much data must throw, not silently truncate");
});

/* ================================ 5. round trip ================================ */

/**
 * Rebuild the function-pattern map from the spec, WITHOUT calling the encoder's placement code.
 * If the encoder and this disagree about which modules are structural, the decode below fails —
 * which is the point of writing it twice.
 */
function functionMap(size, version) {
  const f = Array.from({ length: size }, () => new Array(size).fill(false));
  const box = (r0, c0, h, w) => {
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < size && c < size) f[r][c] = true;
    }
  };
  box(0, 0, 9, 9);                    // finder + separator + format
  box(0, size - 8, 9, 8);
  box(size - 8, 0, 8, 9);
  for (let i = 0; i < size; i++) { f[6][i] = true; f[i][6] = true; }   // timing
  for (const r0 of ALIGN[version]) {
    for (const c0 of ALIGN[version]) {
      if ((r0 === 6 && c0 === 6) || (r0 === 6 && c0 === size - 7) || (r0 === size - 7 && c0 === 6)) continue;
      box(r0 - 2, c0 - 2, 5, 5);
    }
  }
  if (version >= 7) { box(0, size - 11, 6, 3); box(size - 11, 0, 3, 6); }
  return f;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Read the payload back out of a finished symbol. */
function decode(res) {
  const { modules: m, size, version, mask } = res;
  const fixed = functionMap(size, version);
  const bits = [];
  let up = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = up ? size - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (fixed[r][c]) continue;
        bits.push(MASKS[mask](r, c) ? m[r][c] ^ 1 : m[r][c]);
      }
    }
    up = !up;
  }
  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Undo the interleave: data codewords first, block by block.
  const [, ecLen, g1, d1, g2, d2] = M[version];
  const sizes = [...new Array(g1).fill(d1), ...new Array(g2).fill(d2)];
  const blocks = sizes.map(() => []);
  let at = 0;
  for (let i = 0; i < Math.max(d1, d2 || 0); i++) {
    for (let b = 0; b < sizes.length; b++) if (i < sizes[b]) blocks[b].push(words[at++]);
  }
  const data = blocks.flat();

  // Byte mode: 4 bits mode, then the count field, then the payload.
  const dbits = [];
  for (const w of data) for (let i = 7; i >= 0; i--) dbits.push((w >> i) & 1);
  const take = (n, off) => dbits.slice(off, off + n).reduce((a, b) => (a << 1) | b, 0);
  const mode = take(4, 0);
  const countLen = version < 10 ? 8 : 16;
  const len = take(countLen, 4);
  const out = [];
  for (let i = 0; i < len; i++) out.push(take(8, 4 + countLen + i * 8));
  return { mode, len, text: new TextDecoder().decode(Uint8Array.from(out)), ecLen };
}

test("a real scoring link survives the round trip", () => {
  const url = "https://boomtownathletics.com/score.html?t=deadbeef00090101";
  const res = grid(url);
  const got = decode(res);
  assert.equal(got.mode, 0b0100, "byte mode");
  assert.equal(got.text, url);
});

test("round trip holds across lengths, versions and every mask the picker lands on", () => {
  const seenVersions = new Set(), seenMasks = new Set();
  for (const n of [1, 5, 16, 17, 40, 80, 120, 180, 216 - 3]) {
    const text = "https://bt.test/s?t=" + "a".repeat(Math.max(0, n - 20));
    const res = grid(text);
    assert.equal(decode(res).text, text, `failed at length ${text.length} (version ${res.version})`);
    seenVersions.add(res.version); seenMasks.add(res.mask);
  }
  assert.ok(seenVersions.size >= 5, `only exercised versions ${[...seenVersions].join(",")}`);
});

test("round trip holds for non-ASCII, because team names are not all ASCII", () => {
  const text = "Boomtown — Peña / Nguyễn ✓";
  assert.equal(decode(grid(text)).text, text);
});

test("NC: the decoder can fail — flipping one data module breaks the round trip", () => {
  // Without this, a decoder that ignored the modules entirely would pass every test above.
  const url = "https://boomtownathletics.com/score.html?t=deadbeef00090101";
  const res = grid(url);
  const fixed = functionMap(res.size, res.version);

  // WHICH module is corrupted decides whether this proves anything.
  //   - The tail of the zigzag is error-correction parity, which this decoder ignores entirely.
  //   - The first four bits are the mode indicator and the next eight the length, neither of which
  //     changes the recovered characters.
  // Both were tried first and both "passed" while proving nothing. Bit 16 is inside the first
  // payload byte, so flipping it must change the text or the decoder is not reading the modules.
  const cells = [];
  let up = true;
  for (let right = res.size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < res.size; step++) {
      const r = up ? res.size - 1 - step : step;
      for (const c of [right, right - 1]) if (!fixed[r][c]) cells.push([r, c]);
    }
    up = !up;
  }
  assert.ok(cells.length > 16, "there must be a payload module to corrupt");
  const [r, c] = cells[16];
  res.modules[r][c] ^= 1;
  assert.notEqual(decode(res).text, url, "corrupting a payload module must change what is read back");
});

/* ================================ 6. the SVG ================================ */

test("the SVG is self-contained and carries a quiet zone", () => {
  const s = QR.svg("https://bt.test/s?t=deadbeef00090101", { size: 160, label: "Scoring link" });
  assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(!/<script|href=|url\(|<image/i.test(s), "nothing external may appear in the output");
  assert.match(s, /role="img" aria-label="Scoring link"/, "a QR with no accessible name is a blank box to a screen reader");
  const vb = s.match(/viewBox="0 0 (\d+) \1"/);
  assert.ok(vb, "viewBox must be square");
  const { size } = QR.modules("https://bt.test/s?t=deadbeef00090101");
  assert.equal(Number(vb[1]), size + 8, "4 modules of quiet zone on each side, or scanners struggle");
});

test("the label is not an HTML injection point", () => {
  const s = QR.svg("x", { label: '"><script>alert(1)</script>' });
  assert.ok(!/<script/.test(s), "label must not be able to inject markup");
});
