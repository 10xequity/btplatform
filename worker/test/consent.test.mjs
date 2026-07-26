/**
 * Boomtown Platform — consent module tests
 * File: worker/test/consent.test.mjs · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.25.0
 *
 * Covers the pure surface of consent.js: token hashing, email normalisation, signature
 * validation, expiry maths, and the sign-page state machine. DB paths are exercised by
 * hand against the live sandbox rows, not mocked here — the same convention the other
 * suites follow.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sha256Hex, mintRaw, normEmail, validateSignature, expiryFromNow, signState,
} from "../src/consent.js";

/* ---------- sha256Hex ---------- */

test("sha256Hex matches the known digest for 'abc'", async () => {
  assert.equal(await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256Hex is stable across calls", async () => {
  const a = await sha256Hex("boomtown"), b = await sha256Hex("boomtown");
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

/* ---------- mintRaw ---------- */

test("mintRaw returns 64 lowercase hex characters", () => {
  const t = mintRaw();
  assert.match(t, /^[0-9a-f]{64}$/);
});

test("mintRaw does not repeat across 500 draws", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(mintRaw());
  assert.equal(seen.size, 500);
});

/* ---------- normEmail ---------- */

test("normEmail lowercases and trims", () => {
  assert.equal(normEmail("  Player@Example.COM "), "player@example.com");
});

test("normEmail rejects junk that captains actually type", () => {
  for (const bad of ["", "   ", "none", "n/a", "player@", "@example.com", "player@example",
                     "player example.com", null, undefined, "two words@x.com y"]) {
    assert.equal(normEmail(bad), null, `should reject: ${JSON.stringify(bad)}`);
  }
});

test("normEmail accepts ordinary addresses including plus-tags", () => {
  assert.equal(normEmail("a.b+vb@sub.example.co.uk"), "a.b+vb@sub.example.co.uk");
});

/* ---------- validateSignature ---------- */

test("validateSignature accepts a real name and collapses whitespace", () => {
  const r = validateSignature("  Jordan   Reyes ", "Jordan Reyes");
  assert.equal(r.ok, true);
  assert.equal(r.value, "Jordan Reyes");
  assert.equal(r.matched, true);
});

test("validateSignature rejects placeholders and empties", () => {
  for (const bad of ["", "  ", "x", "ab", "n/a", "N/A", "none", "test", "asdf", "....", "----", "1234"]) {
    assert.equal(validateSignature(bad, "Jordan Reyes").ok, false, `should reject: ${JSON.stringify(bad)}`);
  }
});

test("validateSignature accepts a nickname that does not match the roster", () => {
  // Deliberate: rejecting 'Bobby' because the roster says 'Robert' produces unsigned
  // waivers, which is strictly worse than a signature with a name mismatch flag on it.
  const r = validateSignature("Bobby Chen", "Robert Chen");
  assert.equal(r.ok, true);
  assert.equal(r.matched, false);
});

test("validateSignature rejects an over-long name", () => {
  assert.equal(validateSignature("a".repeat(121), null).ok, false);
});

/* ---------- expiryFromNow ---------- */

test("expiryFromNow lands 365 days out in SQLite datetime shape", () => {
  const now = new Date("2026-07-26T12:00:00Z");
  const s = expiryFromNow(365, now);
  assert.match(s, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(s.slice(0, 10), "2027-07-26");
});

test("expiryFromNow handles the 30-day link TTL", () => {
  assert.equal(expiryFromNow(30, new Date("2026-07-26T12:00:00Z")).slice(0, 10), "2026-08-25");
});

/* ---------- signState ---------- */

const NOW = new Date("2026-07-26T12:00:00Z");
const liveTok = { revoked_at: null, deleted_at: null, expires_at: "2026-08-25 12:00:00" };

test("signState: no token row is not_found", () => {
  assert.equal(signState({ tokenRow: null, now: NOW }), "not_found");
});

test("signState: a revoked token is not_found, never a distinct error", () => {
  // D-TOK-1 — a state that distinguishes 'revoked' from 'never existed' confirms to a
  // guesser that they found a real token.
  assert.equal(signState({ tokenRow: { ...liveTok, revoked_at: "2026-07-26 11:00:00" }, now: NOW }), "not_found");
  assert.equal(signState({ tokenRow: { ...liveTok, deleted_at: "2026-07-26 11:00:00" }, now: NOW }), "not_found");
});

test("signState: an expired token reads expired", () => {
  assert.equal(signState({ tokenRow: { ...liveTok, expires_at: "2026-07-25 12:00:00" }, now: NOW }), "expired");
});

test("signState: a token with no expiry is still usable", () => {
  assert.equal(signState({ tokenRow: { ...liveTok, expires_at: null }, now: NOW }), "ready");
});

test("signState: a current waiver short-circuits to already_signed", () => {
  assert.equal(signState({ tokenRow: liveTok, waiverRow: { expires_at: "2027-01-01 00:00:00" }, now: NOW }),
    "already_signed");
});

test("signState: an EXPIRED waiver does not count as signed", () => {
  assert.equal(signState({ tokenRow: liveTok, waiverRow: { expires_at: "2026-01-01 00:00:00" }, now: NOW }),
    "ready");
});

test("signState: token expiry is checked before waiver state", () => {
  const r = signState({ tokenRow: { ...liveTok, expires_at: "2026-07-01 12:00:00" },
                        waiverRow: { expires_at: "2027-01-01 00:00:00" }, now: NOW });
  assert.equal(r, "expired");
});

test("signState: parses ISO timestamps as well as SQLite datetime form", () => {
  // Both shapes appear in this database — seed data uses datetime(), the admin UI posts ISO.
  assert.equal(signState({ tokenRow: { ...liveTok, expires_at: "2026-08-25T12:00:00Z" }, now: NOW }), "ready");
  assert.equal(signState({ tokenRow: { ...liveTok, expires_at: "2026-07-01T12:00:00Z" }, now: NOW }), "expired");
});

/* ---------- parseTs — regression guard for the double-Z bug ---------- */

test("parseTs handles both DB timestamp shapes", async () => {
  const { parseTs } = await import("../src/consent.js");
  const want = Date.parse("2026-07-01T12:00:00Z");
  assert.equal(parseTs("2026-07-01 12:00:00"), want);
  assert.equal(parseTs("2026-07-01T12:00:00Z"), want);
  assert.equal(parseTs("2026-07-01T12:00:00+00:00"), want);
  assert.ok(Number.isNaN(parseTs("")));
  assert.ok(Number.isNaN(parseTs(null)));
  assert.ok(Number.isNaN(parseTs("not a date")));
});

test("signState fails CLOSED on an unparseable token expiry", async () => {
  // A credential with a corrupt expiry must not be treated as never-expiring.
  assert.equal(signState({ tokenRow: { revoked_at: null, deleted_at: null, expires_at: "garbage" }, now: NOW }),
    "expired");
});
