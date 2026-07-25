/* Boomtown Platform — Web Push (PWA)
 * File: worker/src/push.js · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.20.0
 *
 * Implements the Web Push protocol natively on Workers (no deps):
 *   - RFC 8291 payload encryption (aes128gcm: ECDH P-256 + HKDF-SHA256 + AES-128-GCM)
 *   - RFC 8292 VAPID (ES256 JWT) from Worker secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
 *
 * Routes:
 *   GET  /api/push/vapid-key          public — applicationServerKey for the client
 *   POST /api/push/subscribe          member session — upsert this browser's subscription
 *   POST /api/push/unsubscribe        member session — remove by endpoint
 *   GET  /api/push/status             member session — { subscribed_count }
 *   POST /api/admin/push/test         staff — sends a test push to the caller's own devices
 *
 * Exports for other modules:
 *   sendPushToEmail(env, email, {title, body, url, tag}) — all active subs for that email
 *   pushPruneSweep(env) — daily cron: drop subs that failed 4+ times or returned 404/410
 *
 * Pure helpers exported for tests: b64uToBytes, bytesToB64u, concatBytes,
 * aes128gcmHeader, padPayload, vapidClaims, encryptPayload.
 *
 * Secrets required (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
 *   VAPID_PUBLIC_KEY  (b64url, 65-byte raw P-256 public key)
 *   VAPID_PRIVATE_KEY (b64url, 32-byte P-256 private scalar d)
 *   VAPID_SUBJECT     optional — defaults to mailto:info@boomtownvb.com
 */

let deps = {};
export function wirePush(helpers) { deps = helpers; }

/* ============================ base64url + bytes ============================ */

export function b64uToBytes(s) {
  if (typeof s !== "string" || !s.length) return new Uint8Array(0);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64u(bytes) {
  let bin = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

/* ============================ RFC 8188/8291 pieces ============================ */

/** aes128gcm content-coding header: salt(16) | rs(4, big-endian) | idlen(1) | keyid(65). */
export function aes128gcmHeader(salt, asPublic, recordSize = 4096) {
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, recordSize, false);
  return concatBytes(salt, rs, new Uint8Array([asPublic.length]), asPublic);
}

/** Single-record padding: plaintext | 0x02 (last-record delimiter). */
export function padPayload(payload) {
  return concatBytes(payload, new Uint8Array([2]));
}

async function hkdf(salt, ikm, info, byteLength) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, key, byteLength * 8);
  return new Uint8Array(bits);
}

const te = (s) => new TextEncoder().encode(s);

/**
 * RFC 8291 encryption. Returns { body, asPublic, salt } — body is the full
 * aes128gcm message (header + ciphertext) to POST to the push endpoint.
 * Exported so tests can round-trip decrypt with a simulated user agent.
 */
export async function encryptPayload(uaPublicB64u, authB64u, payloadBytes, testKeys = null) {
  const uaPublic = b64uToBytes(uaPublicB64u);        // 65-byte raw P-256 point
  const authSecret = b64uToBytes(authB64u);          // 16-byte auth secret
  if (uaPublic.length !== 65) throw new Error("bad p256dh length " + uaPublic.length);
  if (authSecret.length !== 16) throw new Error("bad auth length " + authSecret.length);

  const asKeys = testKeys || await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));

  const uaKey = await crypto.subtle.importKey(
    "raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaKey }, asKeys.privateKey, 256));

  // IKM = HKDF(salt=auth_secret, ikm=ecdh, info="WebPush: info"||0x00||ua_public||as_public, 32)
  const ikm = await hkdf(authSecret, ecdhSecret,
    concatBytes(te("WebPush: info\0"), uaPublic, asPublic), 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, aesKey, padPayload(payloadBytes)));

  return { body: concatBytes(aes128gcmHeader(salt, asPublic), ciphertext), asPublic, salt };
}

/* ============================ VAPID (RFC 8292) ============================ */

/** JWT claims for a push service origin. Exported for tests. */
export function vapidClaims(audienceOrigin, subject, nowMs = Date.now()) {
  return {
    aud: audienceOrigin,
    exp: Math.floor(nowMs / 1000) + 12 * 3600, // 12h — max allowed is 24h
    sub: subject || "mailto:info@boomtownvb.com",
  };
}

async function vapidAuthHeader(env, endpointOrigin) {
  const pub = b64uToBytes(env.VAPID_PUBLIC_KEY);
  const d = env.VAPID_PRIVATE_KEY;
  if (pub.length !== 65 || !d) throw new Error("VAPID keys missing/malformed — set Worker secrets.");
  const jwk = {
    kty: "EC", crv: "P-256", d,
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = bytesToB64u(te(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64u(te(JSON.stringify(vapidClaims(endpointOrigin, env.VAPID_SUBJECT))));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, te(header + "." + claims))); // raw r||s = JWS format
  const jwt = header + "." + claims + "." + bytesToB64u(sig);
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

/* ============================ send ============================ */

/** POST one encrypted notification to one subscription. Returns HTTP status. */
async function sendWebPush(env, sub, payloadObj) {
  const payload = te(JSON.stringify(payloadObj));
  const { body } = await encryptPayload(sub.p256dh, sub.auth, payload);
  const auth = await vapidAuthHeader(env, new URL(sub.endpoint).origin);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "TTL": "86400",
      "Urgency": "normal",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Authorization": auth,
    },
    body,
  });
  return res.status;
}

async function recordResult(env, subId, status) {
  if (status === 404 || status === 410) {
    // Subscription is gone — soft-delete immediately.
    await env.DB.prepare(
      "UPDATE push_subscriptions SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?1"
    ).bind(subId).run();
  } else if (status >= 400) {
    await env.DB.prepare(
      "UPDATE push_subscriptions SET failed_count=failed_count+1, updated_at=datetime('now') WHERE id=?1"
    ).bind(subId).run();
  } else {
    await env.DB.prepare(
      "UPDATE push_subscriptions SET failed_count=0, updated_at=datetime('now') WHERE id=?1"
    ).bind(subId).run();
  }
}

/**
 * Push to every active subscription registered under an email address.
 * Never throws — logs and returns { sent, failed }. Safe to call inline.
 */
export async function sendPushToEmail(env, email, payloadObj) {
  const out = { sent: 0, failed: 0 };
  if (!email || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return out; // push not configured — no-op
  let rows;
  try {
    rows = (await env.DB.prepare(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE email=?1 AND deleted_at IS NULL AND failed_count < 4"
    ).bind(String(email).trim().toLowerCase()).all()).results || [];
  } catch (e) { console.error("push lookup failed", e); return out; }
  for (const sub of rows) {
    try {
      const status = await sendWebPush(env, sub, payloadObj);
      await recordResult(env, sub.id, status);
      if (status < 400) out.sent++; else out.failed++;
    } catch (e) {
      console.error("push send failed", sub.endpoint, e.message);
      try { await recordResult(env, sub.id, 500); } catch {}
      out.failed++;
    }
  }
  return out;
}

/** Daily cron: hard-delete rows soft-deleted 30+ days ago; soft-delete chronic failures. */
export async function pushPruneSweep(env) {
  const a = await env.DB.prepare(
    "UPDATE push_subscriptions SET deleted_at=datetime('now') WHERE deleted_at IS NULL AND failed_count >= 4"
  ).run();
  const b = await env.DB.prepare(
    "DELETE FROM push_subscriptions WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now','-30 days')"
  ).run();
  return { disabled: a.meta?.changes || 0, purged: b.meta?.changes || 0 };
}

/* ============================ routes ============================ */

function normalizeSubscription(body) {
  const s = body && body.subscription;
  if (!s || typeof s.endpoint !== "string" || !s.endpoint.startsWith("https://"))
    return { ok: false, error: "A push subscription with an https endpoint is required." };
  const keys = s.keys || {};
  if (!keys.p256dh || !keys.auth) return { ok: false, error: "Subscription keys (p256dh, auth) are required." };
  return { ok: true, value: { endpoint: s.endpoint, p256dh: keys.p256dh, auth: keys.auth } };
}

export async function pushRoutes(request, env, url, ctx) {
  const { json, requireStaff } = deps;
  const path = url.pathname;

  if (path === "/api/push/vapid-key" && request.method === "GET") {
    if (!env.VAPID_PUBLIC_KEY) return json({ error: "Push isn't configured yet." }, 503);
    return json({ key: env.VAPID_PUBLIC_KEY });
  }

  if (path === "/api/push/subscribe" && request.method === "POST") {
    if (!ctx.session) return json({ error: "Sign in first." }, 401);
    let body; try { body = await request.json(); } catch { return json({ error: "Bad JSON." }, 400); }
    const v = normalizeSubscription(body);
    if (!v.ok) return json({ error: v.error }, 400);
    const u = await env.DB.prepare("SELECT email FROM users WHERE id=?1").bind(ctx.userId).first();
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (org_id, user_id, email, endpoint, p256dh, auth, user_agent)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(endpoint) DO UPDATE SET user_id=?2, email=?3, p256dh=?5, auth=?6,
         user_agent=?7, failed_count=0, deleted_at=NULL, updated_at=datetime('now')`
    ).bind(ctx.orgId, ctx.userId, (u && u.email) || null, v.value.endpoint, v.value.p256dh, v.value.auth,
           (request.headers.get("User-Agent") || "").slice(0, 200)).run();
    return json({ ok: true });
  }

  if (path === "/api/push/unsubscribe" && request.method === "POST") {
    if (!ctx.session) return json({ error: "Sign in first." }, 401);
    let body; try { body = await request.json(); } catch { return json({ error: "Bad JSON." }, 400); }
    if (!body.endpoint) return json({ error: "endpoint is required." }, 400);
    await env.DB.prepare(
      "UPDATE push_subscriptions SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE endpoint=?1 AND user_id=?2"
    ).bind(body.endpoint, ctx.userId).run();
    return json({ ok: true });
  }

  if (path === "/api/push/status" && request.method === "GET") {
    if (!ctx.session) return json({ error: "Sign in first." }, 401);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?1 AND deleted_at IS NULL"
    ).bind(ctx.userId).first();
    return json({ subscribed_count: (row && row.n) || 0, configured: Boolean(env.VAPID_PUBLIC_KEY) });
  }

  if (path === "/api/admin/push/test" && request.method === "POST") {
    const gate = await requireStaff(env, ctx);
    if (gate) return gate;
    const u = await env.DB.prepare("SELECT email FROM users WHERE id=?1").bind(ctx.userId).first();
    const result = await sendPushToEmail(env, u && u.email, {
      title: "Boomtown test notification",
      body: "Push is working on this device. 🎉",
      url: "/btplatform/web/home.html",
      tag: "bt-test",
    });
    return json({ ok: true, ...result });
  }

  return null;
}

/* CHANGELOG
 * v1.0 (2026-07-25): Initial Web Push module — RFC 8291 aes128gcm encryption + RFC 8292
 *   VAPID on WebCrypto (zero deps); subscribe/unsubscribe/status routes; staff test-send;
 *   sendPushToEmail helper (used by waitlist offers); daily prune sweep. Ships in v0.20.0.
 */
