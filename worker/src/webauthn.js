/**
 * Boomtown Platform — Passkeys (WebAuthn) module
 * File: worker/src/webauthn.js · Version: v1.0 · Date: 2026-07-22 · Ships in: v0.5.0
 *
 * Face ID / fingerprint sign-in. Replaces the planned TOTP requirement with a
 * stronger, easier second factor (device-bound credential).
 *
 * Endpoints (mounted from index.js):
 *   GET  /api/passkey/register-options   (signed in)  → creation options + one-time challenge
 *   POST /api/passkey/register           (signed in)  → verify + store credential
 *   POST /api/passkey/login-options      (public)     → assertion options (usernameless)
 *   POST /api/passkey/login              (public)     → verify assertion → session
 *   GET  /api/passkey/list               (signed in)  → user's registered devices
 *   POST /api/passkey/remove             (signed in)  → soft-delete a credential
 *
 * Crypto notes:
 *   - Attestation "none" (we trust the platform authenticator; no CA chain check).
 *   - ES256 (P-256) and RS256 supported — covers iPhone/iPad, Android, Windows Hello, Mac.
 *   - Challenges: 32 random bytes, single-use, 5-minute expiry (webauthn_challenges table).
 *   - rpId = hostname of APP_URL (github.io is on the Public Suffix List, so
 *     10xequity.github.io is a valid standalone rpId).
 *   - Signature counters enforced when the authenticator provides them.
 */

let H = null; // wired helpers: { json, audit, issueSession }
export function wireWebauthn(helpers) { H = helpers; }

const CHALLENGE_TTL_MIN = 5;

export async function webauthnRoutes(request, env, url, ctx) {
  const p = url.pathname;
  if (!p.startsWith("/api/passkey/")) return null;

  if (p === "/api/passkey/register-options" && request.method === "GET") return registerOptions(env, ctx);
  if (p === "/api/passkey/register" && request.method === "POST") return register(request, env, ctx);
  if (p === "/api/passkey/login-options" && request.method === "POST") return loginOptions(env);
  if (p === "/api/passkey/login" && request.method === "POST") return login(request, env);
  if (p === "/api/passkey/list" && request.method === "GET") return list(env, ctx);
  if (p === "/api/passkey/remove" && request.method === "POST") return remove(request, env, ctx);
  return null;
}

/* ---------- endpoints ---------- */

async function registerOptions(env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const user = await env.DB.prepare(
    "SELECT id, email, display_name FROM users WHERE id=?1 AND deleted_at IS NULL"
  ).bind(ctx.userId).first();
  if (!user) return H.json({ error: "Sign in first." }, 401);

  const challenge = await newChallenge(env, "reg", user.id);
  const existing = (await env.DB.prepare(
    "SELECT credential_id FROM webauthn_credentials WHERE user_id=?1 AND deleted_at IS NULL"
  ).bind(user.id).all()).results;

  return H.json({
    publicKey: {
      rp: { id: rpId(env), name: "Boomtown Athletics" },
      user: {
        id: b64urlFromString(String(user.id)),
        name: user.email,
        displayName: user.display_name || user.email,
      },
      challenge,
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      timeout: 60000,
      attestation: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      excludeCredentials: existing.map((c) => ({ type: "public-key", id: c.credential_id })),
    },
  });
}

async function register(request, env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const body = await safeJson(request);
  const resp = body && body.response;
  if (!resp || !resp.clientDataJSON || !resp.attestationObject) {
    return H.json({ error: "That didn't go through. Try again." }, 400);
  }

  const clientData = JSON.parse(bytesToString(b64urlDecode(resp.clientDataJSON)));
  if (clientData.type !== "webauthn.create") return H.json({ error: "Wrong request type." }, 400);
  if (clientData.origin !== appOrigin(env)) return H.json({ error: "Origin mismatch." }, 400);
  const ok = await consumeChallenge(env, clientData.challenge, "reg", ctx.userId);
  if (!ok) return H.json({ error: "This request expired. Try again." }, 400);

  const att = cborDecodeFirst(b64urlDecode(resp.attestationObject)).value;
  const authData = att.authData;
  if (!(authData instanceof Uint8Array)) return H.json({ error: "Malformed credential." }, 400);

  const parsed = parseAuthData(authData);
  if (!(await rpIdHashOk(parsed.rpIdHash, env))) return H.json({ error: "Origin mismatch." }, 400);
  if (!parsed.userPresent) return H.json({ error: "That didn't go through. Try again." }, 400);
  if (!parsed.credentialId || !parsed.cosePublicKey) return H.json({ error: "Malformed credential." }, 400);

  // Validate the COSE key is an alg we can verify later.
  try { await coseToCryptoKey(parsed.cosePublicKey); }
  catch { return H.json({ error: "This device type isn't supported. Use the email link instead." }, 400); }

  const credIdB64 = b64urlEncode(parsed.credentialId);
  const label = (body.label || "").slice(0, 60) || guessDeviceLabel(request);
  await env.DB.prepare(
    "INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_label) VALUES (?1, ?2, ?3, ?4, ?5)"
  ).bind(ctx.userId, credIdB64, b64urlEncode(parsed.cosePublicKey), parsed.counter, label).run();
  await H.audit(env, ctx, "passkey.register", "webauthn_credentials", credIdB64.slice(0, 12), { label });

  return H.json({ ok: true, label });
}

async function loginOptions(env) {
  const challenge = await newChallenge(env, "auth", null);
  return H.json({
    publicKey: {
      rpId: rpId(env),
      challenge,
      timeout: 60000,
      userVerification: "preferred",
      allowCredentials: [], // usernameless: discoverable credential picks the account
    },
  });
}

async function login(request, env) {
  const body = await safeJson(request);
  const resp = body && body.response;
  if (!body || !body.id || !resp || !resp.clientDataJSON || !resp.authenticatorData || !resp.signature) {
    return H.json({ error: "That didn't go through. Try again." }, 400);
  }

  const clientData = JSON.parse(bytesToString(b64urlDecode(resp.clientDataJSON)));
  if (clientData.type !== "webauthn.get") return H.json({ error: "Wrong request type." }, 400);
  if (clientData.origin !== appOrigin(env)) return H.json({ error: "Origin mismatch." }, 400);
  const ok = await consumeChallenge(env, clientData.challenge, "auth", null);
  if (!ok) return H.json({ error: "This request expired. Try again." }, 400);

  const cred = await env.DB.prepare(
    "SELECT id, user_id, public_key, counter FROM webauthn_credentials WHERE credential_id=?1 AND deleted_at IS NULL"
  ).bind(body.id).first();
  if (!cred) return H.json({ error: "We don't recognize this device. Use the email link instead." }, 401);

  const authData = b64urlDecode(resp.authenticatorData);
  const parsed = parseAuthData(authData, /*attested*/ false);
  if (!(await rpIdHashOk(parsed.rpIdHash, env))) return H.json({ error: "Origin mismatch." }, 400);
  if (!parsed.userPresent) return H.json({ error: "That didn't go through. Try again." }, 400);

  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", b64urlDecode(resp.clientDataJSON)));
  const signedBytes = concatBytes(authData, clientHash);
  const cose = b64urlDecode(cred.public_key);
  const { key, alg } = await coseToCryptoKey(cose);
  let sig = b64urlDecode(resp.signature);
  if (alg === "ES256") sig = derToRaw(sig);
  const valid = await crypto.subtle.verify(
    alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" },
    key, sig, signedBytes
  );
  if (!valid) return H.json({ error: "That didn't go through. Try again, or use the email link below." }, 401);

  if (parsed.counter > 0 && cred.counter > 0 && parsed.counter <= cred.counter) {
    return H.json({ error: "Security check failed. Use the email link and contact admin@boomtownvb.com." }, 401);
  }
  await env.DB.prepare(
    "UPDATE webauthn_credentials SET counter=?1, last_used_at=datetime('now') WHERE id=?2"
  ).bind(parsed.counter, cred.id).run();

  return H.issueSession(env, cred.user_id, "passkey");
}

async function list(env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const rows = (await env.DB.prepare(
    "SELECT credential_id, device_label, created_at, last_used_at FROM webauthn_credentials WHERE user_id=?1 AND deleted_at IS NULL ORDER BY created_at"
  ).bind(ctx.userId).all()).results;
  return H.json({ passkeys: rows });
}

async function remove(request, env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const { credential_id } = await safeJson(request);
  await env.DB.prepare(
    "UPDATE webauthn_credentials SET deleted_at=datetime('now') WHERE user_id=?1 AND credential_id=?2"
  ).bind(ctx.userId, credential_id || "").run();
  await H.audit(env, ctx, "passkey.remove", "webauthn_credentials", (credential_id || "").slice(0, 12), {});
  return H.json({ ok: true });
}

/* ---------- challenges ---------- */

async function newChallenge(env, kind, userId) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const challenge = b64urlEncode(bytes);
  const expires = new Date(Date.now() + CHALLENGE_TTL_MIN * 60_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at) VALUES (?1, ?2, ?3, ?4)"
  ).bind(challenge, userId, kind, expires).run();
  return challenge;
}

async function consumeChallenge(env, challenge, kind, userId) {
  const row = await env.DB.prepare(
    "SELECT id, user_id, kind, expires_at, used_at FROM webauthn_challenges WHERE challenge=?1"
  ).bind(challenge || "").first();
  if (!row || row.used_at || row.kind !== kind) return false;
  if (row.expires_at < new Date().toISOString()) return false;
  if (row.user_id != null && userId != null && row.user_id !== userId) return false;
  await env.DB.prepare("UPDATE webauthn_challenges SET used_at=datetime('now') WHERE id=?1").bind(row.id).run();
  return true;
}

/* ---------- WebAuthn parsing ---------- */

function parseAuthData(bytes, attested = true) {
  const rpIdHash = bytes.slice(0, 32);
  const flags = bytes[32];
  const counter = (bytes[33] << 24 | bytes[34] << 16 | bytes[35] << 8 | bytes[36]) >>> 0;
  const out = { rpIdHash, userPresent: !!(flags & 0x01), userVerified: !!(flags & 0x04), counter };
  if (attested && (flags & 0x40)) {
    // attested credential data: aaguid(16) credIdLen(2) credId(n) cosePublicKey(CBOR)
    let o = 37 + 16;
    const len = (bytes[o] << 8) | bytes[o + 1];
    o += 2;
    out.credentialId = bytes.slice(o, o + len);
    o += len;
    const cose = cborDecodeFirst(bytes.slice(o));
    out.cosePublicKey = bytes.slice(o, o + cose.bytesRead);
  }
  return out;
}

async function rpIdHashOk(hash, env) {
  const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId(env))));
  if (hash.length !== expected.length) return false;
  let same = true;
  for (let i = 0; i < expected.length; i++) if (hash[i] !== expected[i]) same = false;
  return same;
}

/* ---------- COSE key → WebCrypto ---------- */

async function coseToCryptoKey(coseBytes) {
  const cose = cborDecodeFirst(coseBytes).value; // Map with integer keys
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7) {
    // EC2 P-256 → raw uncompressed point
    const x = cose.get(-2), y = cose.get(-3);
    const raw = new Uint8Array(65);
    raw[0] = 0x04; raw.set(x, 1); raw.set(y, 33);
    const key = await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return { key, alg: "ES256" };
  }
  if (kty === 3 && alg === -257) {
    // RSA → JWK
    const n = cose.get(-1), e = cose.get(-2);
    const jwk = { kty: "RSA", n: b64urlEncode(n), e: b64urlEncode(e), alg: "RS256", ext: true };
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return { key, alg: "RS256" };
  }
  throw new Error("Unsupported COSE key");
}

/** ECDSA: ASN.1 DER signature → raw r||s (64 bytes) for WebCrypto. */
function derToRaw(der) {
  let o = 2; // 0x30 len
  if (der[1] & 0x80) o += der[1] & 0x7f; // long-form length
  o += 1; // 0x02
  let rLen = der[o]; o += 1;
  let r = der.slice(o, o + rLen); o += rLen;
  o += 1; // 0x02
  let sLen = der[o]; o += 1;
  let s = der.slice(o, o + sLen);
  const pad = (b) => {
    while (b.length > 32 && b[0] === 0) b = b.slice(1);
    const out = new Uint8Array(32);
    out.set(b, 32 - b.length);
    return out;
  };
  return concatBytes(pad(r), pad(s));
}

/* ---------- minimal CBOR decoder (subset used by WebAuthn) ---------- */

function cborDecodeFirst(bytes) {
  const [value, bytesRead] = cborItem(bytes, 0);
  return { value, bytesRead };
}

function cborItem(b, o) {
  const initial = b[o];
  const major = initial >> 5;
  const info = initial & 0x1f;
  let len, headerLen = 1;
  if (info < 24) len = info;
  else if (info === 24) { len = b[o + 1]; headerLen = 2; }
  else if (info === 25) { len = (b[o + 1] << 8) | b[o + 2]; headerLen = 3; }
  else if (info === 26) { len = ((b[o + 1] << 24) | (b[o + 2] << 16) | (b[o + 3] << 8) | b[o + 4]) >>> 0; headerLen = 5; }
  else throw new Error("CBOR: unsupported length");

  switch (major) {
    case 0: return [len, headerLen];                       // unsigned int
    case 1: return [-1 - len, headerLen];                  // negative int
    case 2: return [b.slice(o + headerLen, o + headerLen + len), headerLen + len]; // byte string
    case 3: return [bytesToString(b.slice(o + headerLen, o + headerLen + len)), headerLen + len]; // text
    case 4: { // array
      let arr = [], pos = o + headerLen;
      for (let i = 0; i < len; i++) { const [v, n] = cborItem(b, pos); arr.push(v); pos += n; }
      return [arr, pos - o];
    }
    case 5: { // map
      let map = new Map(), pos = o + headerLen;
      for (let i = 0; i < len; i++) {
        const [k, kn] = cborItem(b, pos); pos += kn;
        const [v, vn] = cborItem(b, pos); pos += vn;
        map.set(k, v);
      }
      // Also expose string keys as plain object access for attestation maps.
      const obj = {};
      for (const [k, v] of map) if (typeof k === "string") obj[k] = v;
      return [Object.assign(Object.create(null), obj, { get: (k) => map.get(k), authData: obj.authData }), pos - o];
    }
    default: throw new Error("CBOR: unsupported type " + major);
  }
}

/* ---------- small utils ---------- */

function guessDeviceLabel(request) {
  const ua = request.headers.get("User-Agent") || "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android device";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

function rpId(env) { return new URL(env.APP_URL).hostname; }
function appOrigin(env) { return new URL(env.APP_URL).origin; }

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlFromString(str) { return b64urlEncode(new TextEncoder().encode(str)); }
function bytesToString(bytes) { return new TextDecoder().decode(bytes); }
function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}
async function safeJson(request) { try { return await request.json(); } catch { return {}; } }
