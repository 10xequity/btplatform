/* Boomtown Platform — QR encoder (self-contained)
   File: web/assets/qr.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.68.0

   WHY THIS EXISTS RATHER THAN A LIBRARY. `admin-checkin.html` loaded qrcodejs from a CDN and, when
   that failed, printed "QR library blocked — use the link." A QR code is used at the door of a gym,
   which is the worst possible place to depend on a third-party host being reachable — and it is
   also a script from someone else's server running on a page where staff are signed in. Roughly two
   hundred lines of arithmetic removes both problems and works offline.

   SCOPE, DELIBERATELY SMALL. Byte mode, error correction level M, versions 1–10 (up to 216 data
   bytes). Everything this platform encodes is a URL of well under a hundred characters. Level M
   recovers from about 15% damage, which is the right trade for a code printed on paper and handled
   in a gym. Anything longer than version 10 throws rather than silently producing something wrong.

   THE TABLES BELOW ARE SPEC DATA, NOT DERIVED. They were read from the QR tutorial tables at
   thonky.com on 2026-08-03 and cross-checked for internal consistency: for every version,
   blocks × (data + ec) must equal the version's total codeword count. `qr.test.mjs` re-runs that
   check, because a single wrong number here produces a code that renders perfectly and will not
   scan — the worst kind of failure, discovered by a captain at a tournament. */
(function (root) {
  "use strict";

  /* ---------------- GF(256), primitive polynomial 0x11D ---------------- */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  /**
   * Generator polynomial for `n` error-correction codewords: (x - a^0)(x - a^1)...(x - a^(n-1)).
   * Subtraction is XOR here, so the signs vanish.
   *
   * Index 0 holds the HIGHEST-degree coefficient, which decides which of the two terms below shifts.
   * Multiplying by x keeps a coefficient's distance from the top, so it stays at j; multiplying by
   * the constant a^i drops it one degree, to j+1. Writing those the other way round builds the
   * polynomial reversed — it still looks like a generator, and every codeword it produces is wrong.
   * Check by hand at n=2: the result must be [1, 3, 2], not [2, 3, 1].
   */
  function genPoly(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= g[j];                     // × x
        next[j + 1] ^= mul(g[j], EXP[i]);    // × a^i
      }
      g = next;
    }
    return g;
  }

  /** Reed-Solomon remainder — the EC codewords appended to a block. */
  function ecFor(data, ecLen) {
    const g = genPoly(ecLen);
    const buf = [...data, ...new Array(ecLen).fill(0)];
    for (let i = 0; i < data.length; i++) {
      const coef = buf[i];
      if (!coef) continue;
      for (let j = 0; j < g.length; j++) buf[i + j] ^= mul(g[j], coef);
    }
    return buf.slice(data.length);
  }

  /* ---------------- spec tables (level M, versions 1–10) ----------------
     [ totalCodewords, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data ] */
  const M = {
    1:  [26,  10, 1, 16, 0, 0],
    2:  [44,  16, 1, 28, 0, 0],
    3:  [70,  26, 1, 44, 0, 0],
    4:  [100, 18, 2, 32, 0, 0],
    5:  [134, 24, 2, 43, 0, 0],
    6:  [172, 16, 4, 27, 0, 0],
    7:  [196, 18, 4, 31, 0, 0],
    8:  [242, 22, 2, 38, 2, 39],
    9:  [292, 22, 3, 36, 2, 37],
    10: [346, 26, 4, 43, 1, 44],
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  const dataCapacity = (v) => M[v][2] * M[v][3] + M[v][4] * M[v][5];

  /* ---------------- data encoding ---------------- */

  function pickVersion(byteLen) {
    for (let v = 1; v <= 10; v++) {
      // 4 bits mode + count field + payload, rounded up to whole codewords.
      const countBits = v < 10 ? 8 : 16;
      if (4 + countBits + byteLen * 8 <= dataCapacity(v) * 8) return v;
    }
    throw new Error("QR: " + byteLen + " bytes is more than version 10 at level M can hold (216).");
  }

  function encodeData(bytes, version) {
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);                                   // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) push(b, 8);

    const cap = dataCapacity(version) * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);   // terminator
    while (bits.length % 8) bits.push(0);

    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
      words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    }
    // Alternating pad bytes, per spec.
    const PAD = [0xec, 0x11];
    for (let i = 0; words.length < dataCapacity(version); i++) words.push(PAD[i % 2]);
    return words;
  }

  /**
   * Split into blocks, error-correct each, then interleave.
   * Interleaving is what makes level M survive a coffee ring: damage lands across many blocks a
   * little instead of destroying one block completely.
   */
  function interleave(words, version) {
    const [, ecLen, g1, d1, g2, d2] = M[version];
    const blocks = [];
    let at = 0;
    for (let i = 0; i < g1; i++) { blocks.push(words.slice(at, at + d1)); at += d1; }
    for (let i = 0; i < g2; i++) { blocks.push(words.slice(at, at + d2)); at += d2; }
    const ecBlocks = blocks.map((b) => ecFor(b, ecLen));

    const out = [];
    const maxData = Math.max(d1, d2 || 0);
    for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i]);
    return out;
  }

  /* ---------------- matrix ---------------- */

  function blankMatrix(size) {
    return {
      size,
      m: Array.from({ length: size }, () => new Array(size).fill(0)),
      fixed: Array.from({ length: size }, () => new Array(size).fill(false)),
    };
  }

  function place(g, r, c, v) { g.m[r][c] = v; g.fixed[r][c] = true; }

  function finder(g, r0, c0) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const r1 = r0 + r, c1 = c0 + c;
        if (r1 < 0 || c1 < 0 || r1 >= g.size || c1 >= g.size) continue;
        const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                   (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        place(g, r1, c1, on ? 1 : 0);   // the -1/7 ring is the separator, always light
      }
    }
  }

  function alignment(g, version) {
    const pos = ALIGN[version];
    for (const r0 of pos) {
      for (const c0 of pos) {
        // The three finder corners already own their areas.
        if ((r0 === 6 && c0 === 6) || (r0 === 6 && c0 === g.size - 7) || (r0 === g.size - 7 && c0 === 6)) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const on = Math.max(Math.abs(r), Math.abs(c)) !== 1;
            place(g, r0 + r, c0 + c, on ? 1 : 0);
          }
        }
      }
    }
  }

  function timing(g) {
    for (let i = 8; i < g.size - 8; i++) {
      const v = i % 2 === 0 ? 1 : 0;
      place(g, 6, i, v);
      place(g, i, 6, v);
    }
  }

  /** Format info: 5 data bits (EC level + mask), BCH(15,5) with 0x537, XOR 0x5412. */
  function formatBits(maskId) {
    const ecBits = 0b00;                        // level M
    let v = (ecBits << 3) | maskId;
    let rem = v << 10;
    for (let i = 4; i >= 0; i--) if ((rem >> (i + 10)) & 1) rem ^= 0x537 << i;
    return ((v << 10) | rem) ^ 0x5412;
  }

  function placeFormat(g, maskId) {
    const bits = formatBits(maskId);
    const bit = (i) => (bits >> i) & 1;
    for (let i = 0; i <= 5; i++) place(g, 8, i, bit(i));
    place(g, 8, 7, bit(6));
    place(g, 8, 8, bit(7));
    place(g, 7, 8, bit(8));
    for (let i = 9; i <= 14; i++) place(g, 14 - i, 8, bit(i));

    // Copy 2 splits 7 + 8, NOT 8 + 7. The always-dark module sits at (size-8, 8), immediately above
    // the bottom-left run — so that run stops at 7 bits and the top-right run carries the other 8,
    // starting at column size-8. Splitting it the other way writes bit 7 onto the dark module, which
    // then overwrites it, and leaves (8, size-8) unreserved so a data bit lands there. The symbol
    // still renders; everything after that one cell decodes as noise.
    for (let i = 0; i <= 6; i++) place(g, g.size - 1 - i, 8, bit(i));
    for (let i = 7; i <= 14; i++) place(g, 8, g.size - 15 + i, bit(i));
    place(g, g.size - 8, 8, 1);                 // the always-dark module
  }

  /** Version info block, versions 7+ only. BCH(18,6) with 0x1f25. */
  function placeVersion(g, version) {
    if (version < 7) return;
    let rem = version << 12;
    for (let i = 5; i >= 0; i--) if ((rem >> (i + 12)) & 1) rem ^= 0x1f25 << i;
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = (bits >> i) & 1;
      const r = Math.floor(i / 3), c = i % 3;
      place(g, r, g.size - 11 + c, b);
      place(g, g.size - 11 + c, r, b);
    }
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

  /** Zigzag data placement, right to left in two-column strips, skipping the timing column. */
  function placeData(g, words, maskId) {
    const bits = [];
    for (const w of words) for (let i = 7; i >= 0; i--) bits.push((w >> i) & 1);
    let i = 0, up = true;
    for (let right = g.size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;               // column 6 is timing
      for (let step = 0; step < g.size; step++) {
        const r = up ? g.size - 1 - step : step;
        for (const c of [right, right - 1]) {
          if (g.fixed[r][c]) continue;
          let b = i < bits.length ? bits[i++] : 0;
          if (MASKS[maskId](r, c)) b ^= 1;
          g.m[r][c] = b;
        }
      }
      up = !up;
    }
  }

  /** The four spec penalties. Lower is better; the mask with the lowest total wins. */
  function penalty(g) {
    const n = g.size, m = g.m;
    let p = 0;

    const runScore = (line) => {
      let s = 0, run = 1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) run++;
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) s += 3 + (run - 5);
      return s;
    };
    for (let r = 0; r < n; r++) p += runScore(m[r]);
    for (let c = 0; c < n; c++) p += runScore(m.map((row) => row[c]));

    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
      }
    }

    // The finder-lookalike pattern, in both orientations.
    const PAT1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const PAT2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const hit = (line, at, pat) => pat.every((v, k) => line[at + k] === v);
    const scanLine = (line) => {
      let s = 0;
      for (let i = 0; i + 11 <= line.length; i++) {
        if (hit(line, i, PAT1) || hit(line, i, PAT2)) s += 40;
      }
      return s;
    };
    for (let r = 0; r < n; r++) p += scanLine(m[r]);
    for (let c = 0; c < n; c++) p += scanLine(m.map((row) => row[c]));

    let dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += m[r][c];
    const pct = (dark * 100) / (n * n);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  /* ---------------- public ---------------- */

  /** Encode `text` and return the module grid as an array of arrays of 0/1. */
  function modules(text) {
    const bytes = [...new TextEncoder().encode(String(text))];
    const version = pickVersion(bytes.length);
    const words = interleave(encodeData(bytes, version), version);
    const size = version * 4 + 17;

    let best = null;
    for (let maskId = 0; maskId < 8; maskId++) {
      const g = blankMatrix(size);
      finder(g, 0, 0);
      finder(g, 0, size - 7);
      finder(g, size - 7, 0);
      alignment(g, version);
      timing(g);
      placeVersion(g, version);
      placeFormat(g, maskId);
      placeData(g, words, maskId);
      const p = penalty(g);
      if (!best || p < best.p) best = { p, g, maskId };
    }
    return { modules: best.g.m, size, version, mask: best.maskId };
  }

  /**
   * Self-contained SVG. No external anything, scales to any size, prints cleanly.
   * The quiet zone is 4 modules because scanners need it — a QR flush to its container's edge is a
   * QR that reads slowly or not at all.
   */
  function svg(text, opts = {}) {
    const { modules: m, size } = modules(text);
    const quiet = opts.quiet == null ? 4 : opts.quiet;
    const total = size + quiet * 2;
    const px = opts.size || 180;
    const dark = opts.dark || "#000";
    const light = opts.light || "#fff";
    let d = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (m[r][c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    const label = opts.label ? String(opts.label).replace(/[<&>"]/g, "") : "QR code";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ` +
      `viewBox="0 0 ${total} ${total}" role="img" aria-label="${label}" shape-rendering="crispEdges">` +
      `<rect width="${total}" height="${total}" fill="${light}"/>` +
      `<path d="${d}" fill="${dark}"/></svg>`;
  }

  /**
   * A PNG data URL, for sending.
   *
   * Owner 2026-08-03: "The QR codes will be used to send via text or email, or link, not for pictures
   * unless its a fixed picture." An inline SVG is the right thing on a page and the wrong thing in a
   * message — most mail clients strip inline SVG, and no SMS carries markup at all. So sending needs
   * a raster file, and this is it.
   *
   * `scale` is whole pixels per module, never a fractional size. Scaling a QR by a non-integer factor
   * makes some modules a pixel wider than others, and a scanner reading a photo of that has to guess
   * where the grid is. Integer scaling keeps every module identical.
   *
   * Browser only — it needs a canvas. Returns null where there isn't one, so a caller can fall back
   * to the link rather than crash.
   */
  function png(text, opts = {}) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const { modules: m, size } = modules(text);
    const quiet = opts.quiet == null ? 4 : opts.quiet;
    const scale = Math.max(1, Math.round(opts.scale || 8));
    const total = (size + quiet * 2) * scale;

    const cv = document.createElement("canvas");
    cv.width = total; cv.height = total;
    const g = cv.getContext("2d");
    if (!g) return null;
    // The light module is painted, not left transparent. A transparent QR dropped into a dark email
    // template becomes dark-on-dark and stops scanning entirely.
    g.fillStyle = opts.light || "#ffffff";
    g.fillRect(0, 0, total, total);
    g.fillStyle = opts.dark || "#000000";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (m[r][c]) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
    return cv.toDataURL("image/png");
  }

  /** Save the PNG to disk under `filename`. Returns false when there is no canvas to draw on. */
  function download(text, filename, opts = {}) {
    const url = png(text, opts);
    if (!url) return false;
    const a = document.createElement("a");
    a.href = url;
    // A QR file called "download.png" is indistinguishable from every other one in a folder of
    // twenty team codes, so the caller's name is used and only sanitised.
    a.download = String(filename || "qr").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }

  root.BTQR = { modules, svg, png, download, _internals: { ecFor, genPoly, formatBits, M, ALIGN, dataCapacity, pickVersion, encodeData, interleave } };
})(typeof window !== "undefined" ? window : globalThis);
