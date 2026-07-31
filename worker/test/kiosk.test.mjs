/**
 * Boomtown Platform — Kiosk check-in tests
 * File: worker/test/kiosk.test.mjs · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.39.0
 *
 * Covers the pure door policy (scanDecision), code minting/normalization, and the four
 * source-level guards standards §6 demands: org-scope grep + NC, wiring grep on the
 * DISPATCH CHAIN (§6.5) + NC, no-literal-email (F-40), and D-MIN-8 (waiver can never be
 * an input to the door decision). Every guard ships with a negative control that proves
 * it can fail.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CODE_ALPHABET, CODE_LENGTH, MISS_LIMIT, MISS_WINDOW_MIN,
  mintCode, normalizeCode, scanDecision, displayName,
} from "../src/kiosk.js";

const here = dirname(fileURLToPath(import.meta.url));
const kioskSrc = readFileSync(join(here, "../src/kiosk.js"), "utf8");
const indexSrc = readFileSync(join(here, "../src/index.js"), "utf8");

/* ---------------- mintCode ---------------- */

test("mintCode: 8 chars, alphabet only — no 0/O/1/I/L ever", () => {
  for (let i = 0; i < 200; i++) {
    const c = mintCode();
    assert.equal(c.length, CODE_LENGTH);
    assert.match(c, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    for (const bad of "0O1IL") assert.ok(!c.includes(bad), `ambiguous char ${bad} in ${c}`);
  }
});

test("mintCode: does not repeat across 500 draws", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(mintCode());
  assert.equal(seen.size, 500);
});

test("mintCode: rejection sampling — bytes ≥ 248 are skipped, not biased into the alphabet", () => {
  // Feed bytes that would alias under naive modulo; only the accepted ones may appear.
  const bytes = new Uint8Array([248, 249, 250, 251, 252, 253, 254, 255, 0, 1, 2, 3, 4, 5, 6, 7]);
  const c = mintCode(bytes);
  assert.equal(c, CODE_ALPHABET.slice(0, 8), "the 8 rejected bytes must contribute nothing");
});

/* ---------------- normalizeCode ---------------- */

test("normalizeCode: strips scanner CR/LF suffix and whitespace, uppercases", () => {
  assert.equal(normalizeCode("ab2c3d4e\r\n"), "AB2C3D4E");
  assert.equal(normalizeCode("  ab2c 3d4e  "), "AB2C3D4E");
});

test("normalizeCode: junk, empties and too-short input are null, never a query", () => {
  for (const bad of [null, undefined, "", "   ", "ab", "a!@#", "\r\n"]) {
    assert.equal(normalizeCode(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

/* ---------------- scanDecision — the whole door policy ---------------- */

test("unknown code: not found beats everything", () => {
  assert.deepEqual(scanDecision({ found: false, onRoster: true, balanceCents: 0, alreadyIn: false }),
    { status: "unknown" });
});

test("not on roster: denied with not_registered, even with zero balance", () => {
  assert.deepEqual(scanDecision({ found: true, onRoster: false, balanceCents: 0, alreadyIn: false }),
    { status: "deny", reason: "not_registered" });
});

test("owed balance DENIES — this is the req #20 deny", () => {
  assert.deepEqual(scanDecision({ found: true, onRoster: true, balanceCents: 2500, alreadyIn: false }),
    { status: "deny", reason: "balance_due" });
});

test("owed balance denies even when already checked in — the state cannot launder the debt", () => {
  const d = scanDecision({ found: true, onRoster: true, balanceCents: 100, alreadyIn: true });
  assert.equal(d.status, "deny");
});

test("paid: allowed, first scan checks in", () => {
  assert.deepEqual(scanDecision({ found: true, onRoster: true, balanceCents: 0, alreadyIn: false }),
    { status: "ok", already: false });
});

test("paid: second scan is already, never a second row", () => {
  assert.deepEqual(scanDecision({ found: true, onRoster: true, balanceCents: 0, alreadyIn: true }),
    { status: "ok", already: true });
});

test("string balance from a DB row still denies", () => {
  assert.equal(scanDecision({ found: true, onRoster: true, balanceCents: "500", alreadyIn: false }).status, "deny");
});

test("negative control: a decision assertion CAN fail (guard is live, not vacuous)", () => {
  const d = scanDecision({ found: true, onRoster: true, balanceCents: 0, alreadyIn: false });
  assert.notEqual(d.status, "deny");
  assert.throws(() => assert.equal(d.status, "deny"));
});

/* ---------------- D-MIN-8: waiver is not, and cannot become, a door input ---------------- */

test("D-MIN-8: scanDecision has no waiver input — a waiver flag changes nothing", () => {
  const base = { found: true, onRoster: true, balanceCents: 0, alreadyIn: false };
  const withFlag = scanDecision({ ...base, waiver_ok: false, waiverOk: false });
  assert.deepEqual(withFlag, scanDecision(base));
});

test("D-MIN-8 source guard: kiosk.js never queries waiver state", () => {
  const sql = (kioskSrc.match(/`[^`]*`|"[^"\n]*"/g) || []).join("\n");
  assert.ok(!/\bwaivers\b/i.test(sql), "kiosk.js must not touch the waivers table — the door does not ask");
});

/* ---------------- displayName (§8 shape for non-self surfaces) ---------------- */

test("displayName renders First L. and never a full surname", () => {
  assert.equal(displayName("Jordan Smith"), "Jordan S.");
  assert.equal(displayName("Ana de la Cruz"), "Ana C.");
  assert.equal(displayName("Cher"), "Cher");
  assert.equal(displayName(""), "Member");
});

/* ---------------- constants are reviewable, not buried ---------------- */

test("flood ceiling is sane and exported", () => {
  assert.ok(Number.isInteger(MISS_LIMIT) && MISS_LIMIT >= 10 && MISS_LIMIT <= 200);
  assert.ok(Number.isInteger(MISS_WINDOW_MIN) && MISS_WINDOW_MIN >= 1 && MISS_WINDOW_MIN <= 60);
  assert.equal(CODE_ALPHABET.length, 31);
});

/* ---------------- org-scope grep guard (F-11) + negative control ---------------- */

const scopeTables = ["contacts", "member_profiles", "team_members", "attendance", "audit_log"];
function unscopedStatements(src) {
  const out = [];
  for (const stmt of src.match(/`[^`]+`|"(?:SELECT|INSERT|UPDATE|DELETE)[^"\n]*"/g) || []) {
    const hit = scopeTables.some(t => new RegExp(`\\b${t}\\b`, "i").test(stmt));
    const isSql = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(stmt);
    if (hit && isSql && !/org_id/.test(stmt)) out.push(stmt.slice(0, 60));
  }
  return out;
}

test("every SQL statement in kiosk.js touching scoped tables carries org_id", () => {
  // The events-by-token lookup is deliberately unscoped (the token IS the credential,
  // checkin.js precedent) and `events` is therefore not in the scoped set.
  assert.deepEqual(unscopedStatements(kioskSrc), []);
});

test("negative control: the org-scope guard CAN fail on an unscoped statement", () => {
  const bad = 'const q = "SELECT id FROM contacts WHERE kiosk_code=?1";';
  assert.equal(unscopedStatements(bad).length, 1);
});

/* ---------------- wiring guard on the DISPATCH CHAIN (§6.5) + negative control ---------------- */

test("index.js CALLS kioskRoutes in the dispatch chain and wires it — an import alone must not pass", () => {
  assert.ok(/\|\|\s*\(await kioskRoutes\(/.test(indexSrc), "kioskRoutes missing from the dispatch chain");
  assert.ok(/\bwireKiosk\(/.test(indexSrc), "wireKiosk() never called");
});

test("negative control: the wiring guard CAN fail on an import-only source", () => {
  const importOnly = 'import { kioskRoutes, wireKiosk } from "./kiosk.js";';
  assert.ok(!/\|\|\s*\(await kioskRoutes\(/.test(importOnly));
});

/* ---------------- copy guards ---------------- */

test("F-40: no literal email address anywhere in kiosk.js source", () => {
  assert.ok(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(kioskSrc));
});

test("deny copy is a human sentence that routes to the desk, not an error code", () => {
  assert.ok(/Please see the desk/.test(kioskSrc));
  assert.ok(!/ERR_|E\d{3}/.test(kioskSrc));
});
