/**
 * Boomtown Platform — §-1i S-4c: the passkey crypto, tested with real cryptography
 * File: worker/test/webauthn_crypto.test.mjs · Version: v1.0 · Date: 2026-08-09 · Test-only (no release)
 *
 * WHY. webauthn.js is the riskiest code in the repo and had ZERO tests: a hand-rolled CBOR
 * decoder, a DER→raw ECDSA converter, and byte-offset authData walking. It fails CLOSED, so
 * a defect here is a lockout, not a breach — but "fails closed" was an inference from reading,
 * never a measurement. These tests measure it.
 *
 * THE FIXTURES ARE REAL CRYPTOGRAPHY, NOT CANNED BLOBS. Each test generates a fresh P-256
 * (or RSA-2048) keypair with WebCrypto, builds the COSE key, authenticatorData and attestation
 * object byte-by-byte, signs exactly what a real authenticator signs
 * (authenticatorData || SHA-256(clientDataJSON)), and DER-encodes the signature the way
 * authenticators ship it. So a green here means the module's CBOR decoder, its offset walk and
 * its DER converter agree with an INDEPENDENT encoder — two implementations from one spec —
 * and every byte flows through the real routes via worker.fetch, never through internals.
 *
 * EVERY NC MUTATES THE REAL INPUT and asserts the mutation landed. The strongest ones isolate
 * layers: the tampered-clientData NC passes every pre-check and can only be refused by the
 * signature; the flipped-rpIdHash NC RE-SIGNS the tampered bytes so the signature is valid and
 * the refusal can only come from the hash comparison.
 *
 * WHAT IS DELIBERATELY PINNED AS-IS: login succeeds WITHOUT the UV (user-verified) flag.
 * That is the current contract — `parsed.userVerified` is computed and read by nothing —
 * and whether to require it is S-4a, an owner decision. When S-4a ships, the "UV not
 * required" test below is the one to REWRITE (not delete).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";     // APP_URL → rpId "boomtown.test", origin checked verbatim
const API = "https://api.boomtown.test";
const RP_ID = "boomtown.test";

function makeEnv() {
  const env = {
    DB: createD1(SCHEMA), APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN,
    API_ORIGIN: API, ALLOWED_ORIGINS: ORIGIN,
  };
  env.DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1)");
  return env;
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 300) }; }
  return { status: res.status, data };
}

/** Magic-link sandbox sign-in — the repo idiom (authorization_matrix.test.mjs). */
async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  assert.equal(asked.status, 200, `request-link: ${JSON.stringify(asked.data).slice(0, 200)}`);
  const token = String(asked.data.dev_link).split("token=")[1];
  assert.ok(token, "no token in dev_link");
  const verified = await call(env, "POST", "/api/auth/verify", { body: { token } });
  assert.equal(verified.status, 200, "verify failed");
  return verified.data.token;
}

/* ---------- independent encoders (fixture side) ---------- */

function cat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function b64u(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// CBOR encoder — independent of the module's decoder, so agreement means something.
function cborHead(major, n) {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 256) return Uint8Array.of((major << 5) | 24, n);
  if (n < 65536) return Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff);
  throw new Error("fixture: no need for lengths this large");
}
const cborInt = (n) => (n >= 0 ? cborHead(0, n) : cborHead(1, -1 - n));
const cborBytes = (u8) => cat(cborHead(2, u8.length), u8);
const cborText = (s) => { const b = new TextEncoder().encode(s); return cat(cborHead(3, b.length), b); };
const cborMap = (pairs) => cat(cborHead(5, pairs.length), ...pairs.flat());

async function p256Keys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); // 0x04 || x || y
  const cose = cborMap([
    [cborInt(1), cborInt(2)],    // kty: EC2
    [cborInt(3), cborInt(-7)],   // alg: ES256
    [cborInt(-2), cborBytes(raw.slice(1, 33))],  // x
    [cborInt(-3), cborBytes(raw.slice(33, 65))], // y
  ]);
  return { kp, cose };
}

async function makeAuthData({ flags, counter, credId = null, cose = null }) {
  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(RP_ID)));
  const head = new Uint8Array(37);
  head.set(rpIdHash, 0);
  head[32] = flags;
  head[33] = (counter >>> 24) & 0xff; head[34] = (counter >>> 16) & 0xff;
  head[35] = (counter >>> 8) & 0xff; head[36] = counter & 0xff;
  if (!credId) return head;
  const aaguid = new Uint8Array(16);
  const credLen = Uint8Array.of(credId.length >> 8, credId.length & 0xff);
  return cat(head, aaguid, credLen, credId, cose);
}

const attestationObject = (authData) => cborMap([
  [cborText("fmt"), cborText("none")],
  [cborText("attStmt"), cborMap([])],
  [cborText("authData"), cborBytes(authData)],
]);

/** Raw r||s (what WebCrypto emits) → ASN.1 DER (what authenticators ship). */
function rawToDer(raw) {
  const derInt = (bIn) => {
    let i = 0;
    while (i < bIn.length - 1 && bIn[i] === 0) i++;
    let b = bIn.slice(i);
    if (b[0] & 0x80) b = cat(Uint8Array.of(0), b);
    return cat(Uint8Array.of(0x02, b.length), b);
  };
  const body = cat(derInt(raw.slice(0, 32)), derInt(raw.slice(32)));
  return cat(Uint8Array.of(0x30, body.length), body);
}

const clientDataJson = (type, challenge) =>
  new TextEncoder().encode(JSON.stringify({ type, challenge, origin: ORIGIN }));

/** Sign exactly what the module verifies: authData || SHA-256(clientDataJSON). */
async function signAssertion(privateKey, authData, cdjBytes) {
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", cdjBytes));
  const raw = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, cat(authData, clientHash)));
  return raw; // caller DER-encodes (or tampers first)
}

/** Enroll a credential row directly — login is public, so login tests need no session.
    `uvRequired` seeds S-4a's ratchet state: 0 is a legacy credential that has never demonstrated
    Face ID/PIN (the live credential's state at deploy), 1 is one that has. */
function enrollDirect(env, { userId = 7, credId, cose, counter = 0, uvRequired = 0 }) {
  env.DB.exec(`INSERT INTO users (id, email) VALUES (${userId}, 'pk${userId}@boomtown.test')`);
  env.DB.exec(
    `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_label, uv_required)
     VALUES (${userId}, '${b64u(credId)}', '${b64u(cose)}', ${counter}, 'test key', ${uvRequired})`
  );
}

async function freshLoginChallenge(env) {
  const opts = await call(env, "POST", "/api/passkey/login-options");
  assert.equal(opts.status, 200, "login-options failed");
  return opts.data.publicKey.challenge;
}

async function postLogin(env, credId, cdjBytes, authData, derSig) {
  return call(env, "POST", "/api/passkey/login", {
    body: { id: b64u(credId), response: {
      clientDataJSON: b64u(cdjBytes), authenticatorData: b64u(authData), signature: b64u(derSig),
    } },
  });
}

const sessionCount = (env) => env.DB.query("SELECT id FROM sessions").length;

/* ---------- registration: the CBOR decoder and the offset walk ---------- */

test("register round-trip: a real attestation enrolls, and the stored bytes prove the offsets", async () => {
  const env = makeEnv();
  const token = await signIn(env, "owner@boomtown.test");

  const opts = await call(env, "GET", "/api/passkey/register-options", { token });
  assert.equal(opts.status, 200, "register-options failed");
  const challenge = opts.data.publicKey.challenge;

  const { cose } = await p256Keys();
  const credId = crypto.getRandomValues(new Uint8Array(16));
  // v0.152.0 (S-4a): flags carry UV now — new enrolments must demonstrate Face ID/PIN, so the
  // round-trip fixture enrols the way a real authenticator now has to. The offset assertions
  // below are this test's PURPOSE and are unchanged.
  const authData = await makeAuthData({ flags: 0x45, counter: 0, credId, cose }); // UP + UV + AT
  const reg = await call(env, "POST", "/api/passkey/register", { token, body: {
    label: "Test iPhone",
    response: { clientDataJSON: b64u(clientDataJson("webauthn.create", challenge)),
                attestationObject: b64u(attestationObject(authData)) },
  } });
  assert.equal(reg.status, 200, `register refused a valid attestation: ${JSON.stringify(reg.data)}`);

  const rows = env.DB.query("SELECT credential_id, public_key, counter, uv_required FROM webauthn_credentials");
  assert.equal(rows.length, 1, "exactly one credential should exist");
  assert.equal(rows[0].credential_id, b64u(credId),
    "the credential id the offset walk extracted is not the one the fixture embedded");
  // The strongest offset assertion in the file: the stored key must be the COSE bytes EXACTLY.
  // An off-by-N in the AAGUID skip, the length read, or the decoder's bytesRead lands here.
  assert.equal(rows[0].public_key, b64u(cose),
    "the stored COSE key differs from the embedded one — the authData offset walk mis-sliced");
  assert.equal(rows[0].counter, 0, "the sign-count was not read from bytes 33-36");
  assert.equal(rows[0].uv_required, 1,
    "a credential enrolled WITH verification must be born requiring it — S-4a's new-credential half");
});

test("register fails CLOSED: truncated CBOR and a missing user-present flag both refuse, enrolling nothing", async () => {
  const env = makeEnv();
  const token = await signIn(env, "owner@boomtown.test");
  const { cose } = await p256Keys();
  const credId = crypto.getRandomValues(new Uint8Array(16));
  const authData = await makeAuthData({ flags: 0x41, counter: 0, credId, cose });
  const whole = attestationObject(authData);

  // NC 1 — cut the real attestation in half; assert the mutation landed before using it.
  const truncated = whole.slice(0, Math.floor(whole.length / 2));
  assert.ok(truncated.length < whole.length, "mutation did not land — nothing was truncated");
  const opts1 = await call(env, "GET", "/api/passkey/register-options", { token });
  const r1 = await call(env, "POST", "/api/passkey/register", { token, body: {
    response: { clientDataJSON: b64u(clientDataJson("webauthn.create", opts1.data.publicKey.challenge)),
                attestationObject: b64u(truncated) },
  } });
  assert.ok(r1.status >= 400, `truncated CBOR was accepted with ${r1.status} — the parser fails OPEN`);

  // NC 2 — same real bytes with the user-present bit cleared (AT still set).
  const noUp = await makeAuthData({ flags: 0x40, counter: 0, credId, cose });
  assert.notEqual(noUp[32], authData[32], "mutation did not land — the flags byte is unchanged");
  const opts2 = await call(env, "GET", "/api/passkey/register-options", { token });
  const r2 = await call(env, "POST", "/api/passkey/register", { token, body: {
    response: { clientDataJSON: b64u(clientDataJson("webauthn.create", opts2.data.publicKey.challenge)),
                attestationObject: b64u(attestationObject(noUp)) },
  } });
  assert.equal(r2.status, 400, "an attestation without user presence must refuse");

  assert.equal(env.DB.query("SELECT id FROM webauthn_credentials").length, 0,
    "a refused registration still enrolled a credential — fail-closed is a lie");
});

/* ---------- login: DER conversion, COSE import, and the signature binding ---------- */

test("login round-trip (ES256): a real DER-shipped assertion verifies and updates the counter", async () => {
  const env = makeEnv();
  const { kp, cose } = await p256Keys();
  const credId = crypto.getRandomValues(new Uint8Array(16));
  enrollDirect(env, { credId, cose });

  const challenge = await freshLoginChallenge(env);
  const cdj = clientDataJson("webauthn.get", challenge);
  const authData = await makeAuthData({ flags: 0x01, counter: 1 });
  const raw = await signAssertion(kp.privateKey, authData, cdj);
  const res = await postLogin(env, credId, cdj, authData, rawToDer(raw));

  assert.equal(res.status, 200, `a valid assertion was refused: ${JSON.stringify(res.data)}`);
  assert.ok(res.data.token, "no session token issued");
  assert.equal(sessionCount(env), 1, "no session row for a successful passkey login");
  const row = env.DB.query("SELECT counter FROM webauthn_credentials")[0];
  assert.equal(row.counter, 1, "the signature counter was not stored after login");
});

test("NC — one flipped byte in the signature refuses and issues nothing", async () => {
  const env = makeEnv();
  const { kp, cose } = await p256Keys();
  const credId = crypto.getRandomValues(new Uint8Array(16));
  enrollDirect(env, { credId, cose });

  const challenge = await freshLoginChallenge(env);
  const cdj = clientDataJson("webauthn.get", challenge);
  const authData = await makeAuthData({ flags: 0x01, counter: 1 });
  const raw = await signAssertion(kp.privateKey, authData, cdj);
  const before = raw[10];
  raw[10] ^= 0x01; // flip INSIDE r, before DER encoding, so the DER structure stays valid
  assert.notEqual(raw[10], before, "mutation did not land — the signature is unmutated");

  const res = await postLogin(env, credId, cdj, authData, rawToDer(raw));
  assert.equal(res.status, 401, "a corrupted signature must refuse — crypto.subtle.verify was not the gate");
  assert.equal(sessionCount(env), 0, "a refused login still issued a session");
  assert.equal(env.DB.query("SELECT counter FROM webauthn_credentials")[0].counter, 0,
    "a refused login still advanced the stored counter");
});

test("NC — clientDataJSON tampered AFTER signing refuses: only the signature can catch this one", async () => {
  const env = makeEnv();
  const { kp, cose } = await p256Keys();
  const credId = crypto.getRandomValues(new Uint8Array(16));
  enrollDirect(env, { credId, cose });

  const challenge = await freshLoginChallenge(env);
  const cdj = clientDataJson("webauthn.get", challenge);
  const authData = await makeAuthData({ flags: 0x01, counter: 1 });
  const raw = await signAssertion(kp.privateKey, authData, cdj);

  // Same type, same challenge, same origin — every pre-check passes. Only the hash differs.
  const tampered = new TextEncoder().encode(
    JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, extra: "x" }));
  assert.notEqual(b64u(tampered), b64u(cdj), "mutation did not land — the JSON is byte-identical");

  const res = await postLogin(env, credId, tampered, authData, rawToDer(raw));
  assert.equal(res.status, 401,
    "tampered clientDataJSON passed — the client half of the signed bytes is not actually bound");
  assert.equal(sessionCount(env), 0, "a refused login still issued a session");
});

test("NC — flipped rpIdHash refuses even under a VALID signature: the hash comparison is the gate", async () => {
  const env = makeEnv();
  const { kp, cose } = await p256Keys();
  const credId = crypto.getRandomValues(new Uint8Array(16));
  enrollDirect(env, { credId, cose });

  const challenge = await freshLoginChallenge(env);
  const cdj = clientDataJson("webauthn.get", challenge);
  const authData = await makeAuthData({ flags: 0x01, counter: 1 });
  const good0 = authData[0];
  authData[0] ^= 0xff; // a different RP's hash...
  assert.notEqual(authData[0], good0, "mutation did not land — the rpIdHash is unmutated");
  const raw = await signAssertion(kp.privateKey, authData, cdj); // ...RE-SIGNED, so the sig is VALID

  const res = await postLogin(env, credId, cdj, authData, rawToDer(raw));
  assert.equal(res.status, 400,
    "a valid signature over a WRONG rpIdHash was accepted — the hash bytes are not compared");
  assert.equal(sessionCount(env), 0, "a refused login still issued a session");
});

test("counter clone detection: an equal count refuses, a higher count signs in", async () => {
  const env = makeEnv();
  const { kp, cose } = await p256Keys();
  const credId = crypto.getRandomValues(new Uint8Array(16));
  enrollDirect(env, { credId, cose });

  const loginAt = async (counter) => {
    const challenge = await freshLoginChallenge(env);
    const cdj = clientDataJson("webauthn.get", challenge);
    const authData = await makeAuthData({ flags: 0x01, counter });
    const raw = await signAssertion(kp.privateKey, authData, cdj);
    return postLogin(env, credId, cdj, authData, rawToDer(raw));
  };

  assert.equal((await loginAt(5)).status, 200, "the first login at counter 5 should pass");
  const clone = await loginAt(5); // fresh challenge, VALID signature — only the counter is stale
  assert.equal(clone.status, 401,
    "a replayed counter signed in — clone detection is not enforced");
  assert.equal(sessionCount(env), 1, "the refused clone still issued a session");
  assert.equal((await loginAt(6)).status, 200, "a genuinely advanced counter must still sign in");
});

test("RS256 branch: an RSA credential verifies, and its flipped signature refuses", async () => {
  const env = makeEnv();
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const cose = cborMap([
    [cborInt(1), cborInt(3)],      // kty: RSA
    [cborInt(3), cborInt(-257)],   // alg: RS256 (2-byte negative — exercises the encoder too)
    [cborInt(-1), cborBytes(b64uDecode(jwk.n))],
    [cborInt(-2), cborBytes(b64uDecode(jwk.e))],
  ]);
  const credId = crypto.getRandomValues(new Uint8Array(16));
  enrollDirect(env, { credId, cose });

  const challenge = await freshLoginChallenge(env);
  const cdj = clientDataJson("webauthn.get", challenge);
  const authData = await makeAuthData({ flags: 0x01, counter: 1 });
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", cdj));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, kp.privateKey, cat(authData, clientHash)));

  const ok = await postLogin(env, credId, cdj, authData, sig); // RS256 ships raw PKCS1 — no DER step
  assert.equal(ok.status, 200, `a valid RS256 assertion was refused: ${JSON.stringify(ok.data)}`);

  const challenge2 = await freshLoginChallenge(env);
  const cdj2 = clientDataJson("webauthn.get", challenge2);
  const authData2 = await makeAuthData({ flags: 0x01, counter: 2 });
  const clientHash2 = new Uint8Array(await crypto.subtle.digest("SHA-256", cdj2));
  const sig2 = new Uint8Array(await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, kp.privateKey, cat(authData2, clientHash2)));
  const before = sig2[40];
  sig2[40] ^= 0x01;
  assert.notEqual(sig2[40], before, "mutation did not land — the RSA signature is unmutated");
  const bad = await postLogin(env, credId, cdj2, authData2, sig2);
  assert.equal(bad.status, 401, "a corrupted RS256 signature must refuse");
});

/* ============================ S-4a (§-0 B12): the UV ratchet ============================
   The owner called the open call the old pin was waiting on. The design is a RATCHET, because
   the plain fix ("required" everywhere) would lock out authenticators that cannot verify a user
   — the exact trade-off §-1i flagged: a credential that has NEVER demonstrated Face ID/PIN keeps
   working exactly as before (no lockout, the live credential's state at deploy); the moment one
   demonstrates it — at enrolment or any login — every later assertion must carry it, because a
   verifying authenticator that suddenly stops verifying is the shape of a cloned key, not a
   settings change. The old "CURRENT CONTRACT" pin is REWRITTEN here to its surviving purpose. */

test("S-4a NO LOCKOUT (the old pin's surviving half): a credential that never demonstrated UV still signs in without it — and does NOT silently ratchet", async () => {
  const env = makeEnv();
  const { kp, cose } = await p256Keys();
  const credId = crypto.getRandomValues(new Uint8Array(16));
  enrollDirect(env, { credId, cose }); // uvRequired 0 — the live credential's state at deploy

  const challenge = await freshLoginChallenge(env);
  const cdj = clientDataJson("webauthn.get", challenge);
  const authData = await makeAuthData({ flags: 0x01, counter: 1 });
  assert.equal(authData[32] & 0x04, 0, "fixture error — UV bit unexpectedly set");
  const raw = await signAssertion(kp.privateKey, authData, cdj);
  const res = await postLogin(env, credId, cdj, authData, rawToDer(raw));
  assert.equal(res.status, 200,
    "a UV-less login on a never-verified credential must still succeed — S-4a is a ratchet, not a lockout");
  const row = env.DB.query("SELECT uv_required FROM webauthn_credentials")[0];
  assert.equal(row.uv_required, 0, "a presence-only login must not flip the ratchet");
});

test("S-4a THE RATCHET: one verified login flips the bit, and a UV-less assertion is refused ever after — with its own sentence, not a generic error", async () => {
  const env = makeEnv();
  const { kp, cose } = await p256Keys();
  const credId = crypto.getRandomValues(new Uint8Array(16));
  enrollDirect(env, { credId, cose });

  // Login WITH verification (flags 0x05 = UP + UV) — this is the owner's Windows Hello shape.
  const ch1 = await freshLoginChallenge(env);
  const cdj1 = clientDataJson("webauthn.get", ch1);
  const withUv = await makeAuthData({ flags: 0x05, counter: 1 });
  assert.equal(withUv[32] & 0x04, 0x04, "fixture error — UV bit not set");
  const ok = await postLogin(env, credId, cdj1, withUv, rawToDer(await signAssertion(kp.privateKey, withUv, cdj1)));
  assert.equal(ok.status, 200, `a verified login must succeed: ${JSON.stringify(ok.data)}`);
  assert.equal(env.DB.query("SELECT uv_required FROM webauthn_credentials")[0].uv_required, 1,
    "the verified login must flip the ratchet");

  // The downgrade: same key, valid signature, UV bit cleared — the cloned-key shape.
  const ch2 = await freshLoginChallenge(env);
  const cdj2 = clientDataJson("webauthn.get", ch2);
  const noUv = await makeAuthData({ flags: 0x01, counter: 2 });
  assert.equal(noUv[32] & 0x04, 0, "mutation did not land — UV bit still set");
  const bad = await postLogin(env, credId, cdj2, noUv, rawToDer(await signAssertion(kp.privateKey, noUv, cdj2)));
  assert.equal(bad.status, 401, "a ratcheted credential asserting without UV must refuse");
  // Absence and refusal share a status code — demand the refusal's own sentence.
  assert.match(String(bad.data && bad.data.error), /face|fingerprint|PIN/i,
    "the refusal must say what was missing in the member's own terms");

  // And the same credential WITH UV keeps working — the refusal is the downgrade, not the key.
  const ch3 = await freshLoginChallenge(env);
  const cdj3 = clientDataJson("webauthn.get", ch3);
  const again = await makeAuthData({ flags: 0x05, counter: 3 });
  const good = await postLogin(env, credId, cdj3, again, rawToDer(await signAssertion(kp.privateKey, again, cdj3)));
  assert.equal(good.status, 200, "a verified assertion on a ratcheted credential must still succeed");
});

test("S-4a AT THE FRONT DOOR: register-options demands verification, and an attestation WITHOUT it is refused with its own sentence", async () => {
  const env = makeEnv();
  const token = await signIn(env, "owner@boomtown.test");

  const opts = await call(env, "GET", "/api/passkey/register-options", { token });
  assert.equal(opts.data.publicKey.authenticatorSelection.userVerification, "required",
    "new enrolments must ask the authenticator for Face ID/PIN outright — enrolment-time strictness locks nobody out");

  const { cose } = await p256Keys();
  const credId = crypto.getRandomValues(new Uint8Array(16));
  const noUv = await makeAuthData({ flags: 0x41, counter: 0, credId, cose }); // UP + AT, no UV
  assert.equal(noUv[32] & 0x04, 0, "mutation did not land — UV bit set on the no-UV fixture");
  const reg = await call(env, "POST", "/api/passkey/register", { token, body: {
    response: { clientDataJSON: b64u(clientDataJson("webauthn.create", opts.data.publicKey.challenge)),
                attestationObject: b64u(attestationObject(noUv)) },
  } });
  assert.equal(reg.status, 400, "an enrolment that skipped verification must refuse");
  assert.match(String(reg.data && reg.data.error), /face|fingerprint|PIN/i,
    "and say why in the member's own terms — a generic error teaches nothing");
  assert.equal(env.DB.query("SELECT id FROM webauthn_credentials").length, 0, "nothing may be stored");
});
