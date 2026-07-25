/* Boomtown Platform — Web Push unit tests
   File: worker/test/push.test.mjs · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.20.0
   Pure-function + crypto round-trip tests (no DB, no network). The round-trip test
   simulates a real browser (user agent): it generates UA keys, lets push.js encrypt,
   then decrypts per RFC 8291 and asserts the payload survives intact. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  b64uToBytes, bytesToB64u, concatBytes, aes128gcmHeader, padPayload,
  vapidClaims, encryptPayload,
} from "../src/push.js";

/* ---------- base64url ---------- */
test("b64u round-trips arbitrary bytes incl. lengths needing padding", () => {
  for (const len of [0, 1, 2, 3, 16, 31, 65]) {
    const src = new Uint8Array(len).map((_, i) => (i * 37 + 5) % 256);
    assert.deepEqual(b64uToBytes(bytesToB64u(src)), src);
  }
});
test("b64u output has no +, /, or = characters", () => {
  const s = bytesToB64u(new Uint8Array([251, 255, 254, 62, 63]));
  assert.doesNotMatch(s, /[+/=]/);
});

/* ---------- aes128gcm header ---------- */
test("header layout: salt(16) + rs(4 BE) + idlen(1) + key(65) = 86 bytes", () => {
  const salt = new Uint8Array(16).fill(7);
  const pub = new Uint8Array(65).fill(9);
  const h = aes128gcmHeader(salt, pub);
  assert.equal(h.length, 86);
  assert.deepEqual(h.slice(0, 16), salt);
  assert.deepEqual([...h.slice(16, 20)], [0, 0, 16, 0]); // 4096 big-endian
  assert.equal(h[20], 65);
  assert.deepEqual(h.slice(21), pub);
});

/* ---------- padding ---------- */
test("padPayload appends the 0x02 last-record delimiter", () => {
  const p = padPayload(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...p], [1, 2, 3, 2]);
});

/* ---------- VAPID claims ---------- */
test("vapid claims carry aud/exp/sub; exp ≈ now+12h; default subject", () => {
  const now = Date.parse("2026-07-25T12:00:00Z");
  const c = vapidClaims("https://fcm.googleapis.com", null, now);
  assert.equal(c.aud, "https://fcm.googleapis.com");
  assert.equal(c.exp, Math.floor(now / 1000) + 43200);
  assert.match(c.sub, /^mailto:/);
  assert.equal(vapidClaims("https://x", "mailto:a@b.c", now).sub, "mailto:a@b.c");
});

/* ---------- RFC 8291 round trip (simulated user agent) ---------- */
test("encryptPayload output decrypts back to the original payload", async () => {
  // 1. Simulate the browser: UA ECDH keys + 16-byte auth secret.
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));

  // 2. Server-side encrypt (function under test).
  const payload = new TextEncoder().encode(JSON.stringify({ title: "Hi", body: "spot open", url: "/x" }));
  const { body } = await encryptPayload(bytesToB64u(uaPub), bytesToB64u(auth), payload);

  // 3. UA-side decrypt per RFC 8291.
  const salt = body.slice(0, 16);
  const idlen = body[20];
  assert.equal(idlen, 65);
  const asPub = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);

  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const te = (s) => new TextEncoder().encode(s);
  const hkdf = async (s, ikm, info, n) => {
    const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, k, n * 8));
  };
  const ikm = await hkdf(auth, ecdh, concatBytes(te("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));

  assert.equal(plain[plain.length - 1], 2); // delimiter intact
  assert.deepEqual(plain.slice(0, -1), payload);
  const parsed = JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
  assert.equal(parsed.title, "Hi");
});

/* ---------- input hardening ---------- */
test("encryptPayload rejects malformed subscription keys", async () => {
  await assert.rejects(() => encryptPayload(bytesToB64u(new Uint8Array(10)), bytesToB64u(new Uint8Array(16)), new Uint8Array(1)), /p256dh/);
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  await assert.rejects(() => encryptPayload(bytesToB64u(uaPub), bytesToB64u(new Uint8Array(5)), new Uint8Array(1)), /auth/);
});

/* CHANGELOG
 * v1.0 (2026-07-25): 7 tests — b64u round-trip + alphabet, aes128gcm header layout,
 *   padding delimiter, VAPID claims, full RFC 8291 encrypt→decrypt round trip,
 *   malformed-key rejection. Ships in v0.20.0.
 */
