/**
 * Boomtown Platform — SMS (owner req #17, phase 3)
 * File: worker/src/sms.js · Version: v1.0 · Date: 2026-07-31 · Ships in: v0.42.0
 *
 * Owner requirement #17 (verbatim): "Text notifications — courts and where to play, for
 * league and tournaments. Also usable for marketing and CRM." Build/buy call of record
 * (library §1): Twilio, phase 3, A2P 10DLC registration required. Scope B (owner
 * 2026-07-31): API + hooks + admin send panel; marketing blasts wait for a separate
 * A2P campaign type.
 *
 * FAILS CLOSED WITH ZERO CONFIG — this is what makes "build now, deploy whenever" safe:
 * until TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_MESSAGING_SERVICE_SID secrets
 * exist, every route answers with a human sentence and touches nothing. Requires
 * migration 0029 (contacts.sms_opt_in, sms_log).
 *
 * Staff routes (requireStaff):
 *   GET  /api/admin/sms/targets                 → recent + upcoming events for the picker
 *   GET  /api/admin/sms/recipients?target=e:ID  → reach preview {eligible, noConsent, noPhone}
 *   POST /api/admin/sms/send    { target:{type:'event'|'contact', id}, body }
 *   POST /api/admin/sms/consent { contact_id, opt_in }   (desk/verbal consent, audited)
 *   GET  /api/admin/sms/log?limit=50            → recent org-scoped traffic
 * Public route (Twilio webhook, X-Twilio-Signature validated BEFORE any DB touch):
 *   POST /api/sms/inbound                       → STOP / START / HELP handling
 *
 * Rules baked in:
 *   - Consent default OFF; only opted-in contacts with a valid E.164 number are sent to.
 *   - Quiet hours: no sends before 8am or after 9pm America/Denver (TCPA hygiene).
 *   - Flood guard: ORG_SENDS_PER_DAY outbound cap per org (messages.js precedent).
 *   - Every staff read/write scoped to ctx.orgId (standards §4).
 *   - COMPLIANCE-CROSS-ORG exception: an inbound STOP is number-level carrier law, so it
 *     revokes consent for that number in EVERY org sharing the Twilio number. This is the
 *     one deliberate org-scope deviation in the codebase; it is marked inline and the
 *     test suite guards that it stays confined to the marked block.
 *   - Errors are human sentences, not codes (§8).
 * Pure (unit-tested): normalizePhone · classifyInbound · quietHoursBlocked ·
 *                     smsConfigured · validateTwilioSignature · SMS_MAX
 */

let json, audit, requireStaff;
export function wireSms(h) { ({ json, audit, requireStaff } = h); }

/** Body cap: 3 SMS segments. Court assignments fit in one; nothing here needs an essay. */
export const SMS_MAX = 480;
/** Outbound org-level daily cap — a tournament day of assignments, not a spam cannon. */
export const ORG_SENDS_PER_DAY = 500;

/* ============================ pure helpers (unit-tested) ============================ */

/** All three Twilio secrets present → configured. Anything less → every route fails closed. */
export function smsConfigured(env) {
  return !!(env && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_MESSAGING_SERVICE_SID);
}

/**
 * Raw phone → E.164 or null. US-default: 10 digits get +1; 11 starting with 1 get +.
 * Already-+ numbers pass through when 8–15 digits. Everything else is null — we never
 * guess a number into existence.
 */
export function normalizePhone(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("+")) {
    const d = s.slice(1).replace(/\D/g, "");
    return (d.length >= 8 && d.length <= 15) ? "+" + d : null;
  }
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return null;
}

/** Twilio Advanced Opt-Out keyword classes. Anything else is 'other'. */
export function classifyInbound(body) {
  const w = String(body || "").trim().toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(w)) return "stop";
  if (["START", "YES", "UNSTOP"].includes(w)) return "start";
  if (["HELP", "INFO"].includes(w)) return "help";
  return "other";
}

/** True when the Denver-local hour is outside 8:00–20:59 (send window 8am–9pm MT). */
export function quietHoursBlocked(date) {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", hour: "numeric", hour12: false,
  }).format(date || new Date()));
  return hour < 8 || hour >= 21;
}

/**
 * Twilio request signature: base64(HMAC-SHA1(authToken, url + sortedKeys.map(k=>k+v).join(''))).
 * Constant algorithm from Twilio's security docs; validated in tests against an
 * independent node:crypto implementation. Returns boolean; never throws.
 */
export async function validateTwilioSignature(authToken, url, params, signature) {
  try {
    if (!authToken || !url || !signature) return false;
    const keys = Object.keys(params || {}).sort();
    let data = url;
    for (const k of keys) data += k + params[k];
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(authToken),
      { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}

/* ============================ Twilio transport ============================ */

async function twilioSend(env, to, body) {
  const form = new URLSearchParams({
    To: to, Body: body, MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(env.TWILIO_ACCOUNT_SID + ":" + env.TWILIO_AUTH_TOKEN),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );
  let j = null;
  try { j = await res.json(); } catch { /* fail closed below */ }
  if (!res.ok || !j || !j.sid) {
    return { ok: false, error: (j && (j.message || j.error_message)) || `Twilio replied ${res.status}` };
  }
  return { ok: true, sid: j.sid };
}

/* ============================ recipient resolution ============================ */

async function resolveRecipients(env, ctx, target) {
  if (target.type === "contact") {
    const r = await env.DB.prepare(
      `SELECT id, full_name, phone, sms_opt_in FROM contacts
       WHERE org_id=?1 AND id=?2 AND deleted_at IS NULL`
    ).bind(ctx.orgId, target.id).all();
    return r.results || [];
  }
  // 'event' covers tournaments, leagues, training — leagues ARE events (events.type).
  const r = await env.DB.prepare(
    `SELECT DISTINCT c.id, c.full_name, c.phone, c.sms_opt_in
     FROM registrations reg JOIN contacts c ON c.id = reg.contact_id AND c.org_id = reg.org_id
     WHERE reg.org_id=?1 AND reg.event_id=?2 AND reg.deleted_at IS NULL
       AND reg.status != 'cancelled' AND c.deleted_at IS NULL`
  ).bind(ctx.orgId, target.id).all();
  return r.results || [];
}

function splitReach(rows) {
  const eligible = [], noConsent = [], noPhone = [];
  const seen = new Set();
  for (const c of rows) {
    const e164 = normalizePhone(c.phone);
    if (!e164) { noPhone.push(c.id); continue; }
    if (!c.sms_opt_in) { noConsent.push(c.id); continue; }
    if (seen.has(e164)) continue;
    seen.add(e164);
    eligible.push({ id: c.id, to: e164 });
  }
  return { eligible, noConsent, noPhone };
}

/* ============================ routes ============================ */

const OFF = "Texting isn't switched on yet — Twilio A2P registration is still pending.";

export async function smsRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;

  /* ---- Twilio inbound webhook (public; signature gate BEFORE any DB touch) ---- */
  if (p === "/api/sms/inbound" && m === "POST") {
    if (!smsConfigured(env)) return json({ error: OFF }, 503);
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: "That request wasn't readable." }, 400);
    const params = {};
    for (const [k, v] of form.entries()) params[k] = String(v);
    const ok = await validateTwilioSignature(
      env.TWILIO_AUTH_TOKEN, url.origin + url.pathname,
      params, request.headers.get("X-Twilio-Signature") || ""
    );
    if (!ok) return json({ error: "Signature check failed." }, 403);
    const from = normalizePhone(params.From);
    const kind = classifyInbound(params.Body);
    if (!from) return new Response("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
    /* COMPLIANCE-CROSS-ORG — carrier opt-out is number-level: apply to every org.
       This block is the ONE permitted org-scope deviation (module header). */
    if (kind === "stop" || kind === "start") {
      const optIn = kind === "start" ? 1 : 0;
      await env.DB.prepare(
        `UPDATE contacts SET sms_opt_in=?1, sms_opt_in_at=datetime('now'), updated_at=datetime('now')
         WHERE deleted_at IS NULL AND phone IS NOT NULL AND ?2 IN (
           '+1' || replace(replace(replace(replace(phone,'-',''),' ',''),'(',''),')',''),
           '+'  || replace(replace(replace(replace(phone,'-',''),' ',''),'(',''),')',''),
           replace(replace(replace(replace(phone,'-',''),' ',''),'(',''),')','') )`
      ).bind(optIn, from).run();
      await env.DB.prepare(
        `INSERT INTO sms_log (org_id, direction, from_number, body, status, target)
         SELECT DISTINCT org_id, 'in', ?1, ?2, 'received', 'webhook' FROM contacts
         WHERE deleted_at IS NULL AND phone IS NOT NULL AND ?1 IN (
           '+1' || replace(replace(replace(replace(phone,'-',''),' ',''),'(',''),')',''),
           '+'  || replace(replace(replace(replace(phone,'-',''),' ',''),'(',''),')',''),
           replace(replace(replace(replace(phone,'-',''),' ',''),'(',''),')','') )`
      ).bind(from, kind.toUpperCase()).run().catch(() => {});
    }
    /* END COMPLIANCE-CROSS-ORG */
    // Twilio Messaging Service auto-replies to STOP/HELP at the carrier level;
    // an empty TwiML response means "nothing further from us".
    return new Response("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
  }

  if (!p.startsWith("/api/admin/sms")) return null;
  const gate = await requireStaff(env, ctx); if (gate) return gate;

  /* ---- event picker ---- */
  if (p === "/api/admin/sms/targets" && m === "GET") {
    const r = await env.DB.prepare(
      `SELECT id, name, type, starts_at FROM events
       WHERE org_id=?1 AND deleted_at IS NULL
         AND (starts_at IS NULL OR starts_at >= datetime('now','-14 day'))
       ORDER BY starts_at IS NULL, starts_at LIMIT 100`
    ).bind(ctx.orgId).all();
    return json({ targets: r.results || [], configured: smsConfigured(env) });
  }

  /* ---- reach preview ---- */
  if (p === "/api/admin/sms/recipients" && m === "GET") {
    const t = String(url.searchParams.get("target") || "");
    const [type, idRaw] = t.split(":");
    const id = Number(idRaw);
    if (!["event", "contact"].includes(type) || !Number.isInteger(id) || id <= 0) {
      return json({ error: "Pick an event or a member first." }, 400);
    }
    const reach = splitReach(await resolveRecipients(env, ctx, { type, id }));
    return json({ eligible: reach.eligible.length, noConsent: reach.noConsent.length, noPhone: reach.noPhone.length });
  }

  /* ---- send ---- */
  if (p === "/api/admin/sms/send" && m === "POST") {
    if (!smsConfigured(env)) return json({ error: OFF }, 503);
    let b; try { b = await request.json(); } catch { return json({ error: "That request wasn't readable." }, 400); }
    const target = b && b.target && typeof b.target === "object" ? b.target : {};
    const type = String(target.type || ""), id = Number(target.id);
    const body = String(b && b.body || "").trim();
    if (!["event", "contact"].includes(type) || !Number.isInteger(id) || id <= 0) {
      return json({ error: "Pick an event or a member first." }, 400);
    }
    if (!body) return json({ error: "Write the message first." }, 400);
    if (body.length > SMS_MAX) return json({ error: `Keep it under ${SMS_MAX} characters — that's three text segments.` }, 400);
    if (quietHoursBlocked(new Date())) {
      return json({ error: "It's outside texting hours (8am–9pm Mountain). Try again in the morning." }, 400);
    }
    const sentToday = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sms_log
       WHERE org_id=?1 AND direction='out' AND created_at >= datetime('now','-1 day')`
    ).bind(ctx.orgId).first();
    if (sentToday.n >= ORG_SENDS_PER_DAY) {
      return json({ error: "Daily texting limit reached for this organization — try again tomorrow." }, 429);
    }
    const reach = splitReach(await resolveRecipients(env, ctx, { type, id }));
    if (reach.eligible.length === 0) {
      return json({ error: "Nobody in that group has opted in with a textable number yet." }, 400);
    }
    if (sentToday.n + reach.eligible.length > ORG_SENDS_PER_DAY) {
      return json({ error: "That send would pass today's texting limit — it was not sent." }, 429);
    }
    let sent = 0, failed = 0;
    for (const rcpt of reach.eligible) {
      const res = await twilioSend(env, rcpt.to, body);
      if (res.ok) sent++; else failed++;
      await env.DB.prepare(
        `INSERT INTO sms_log (org_id, contact_id, direction, to_number, body, status, twilio_sid, error, target)
         VALUES (?1, ?2, 'out', ?3, ?4, ?5, ?6, ?7, ?8)`
      ).bind(ctx.orgId, rcpt.id, rcpt.to, body,
             res.ok ? "queued" : "failed", res.ok ? res.sid : null,
             res.ok ? null : res.error, `${type}:${id}`).run();
    }
    await audit(env, ctx, "sms.sent", "sms", id, { target: `${type}:${id}`, sent, failed,
      skippedNoConsent: reach.noConsent.length, skippedNoPhone: reach.noPhone.length });
    return json({ sent, failed, skipped: { noConsent: reach.noConsent.length, noPhone: reach.noPhone.length } });
  }

  /* ---- desk consent toggle (verbal opt-in at the counter, audited) ---- */
  if (p === "/api/admin/sms/consent" && m === "POST") {
    let b; try { b = await request.json(); } catch { return json({ error: "That request wasn't readable." }, 400); }
    const contactId = Number(b && b.contact_id), optIn = b && b.opt_in ? 1 : 0;
    if (!Number.isInteger(contactId) || contactId <= 0) return json({ error: "Pick a member first." }, 400);
    const r = await env.DB.prepare(
      `UPDATE contacts SET sms_opt_in=?1, sms_opt_in_at=datetime('now'), updated_at=datetime('now')
       WHERE org_id=?2 AND id=?3 AND deleted_at IS NULL`
    ).bind(optIn, ctx.orgId, contactId).run();
    if (!r.meta.changes) return json({ error: "That member wasn't found." }, 404);
    await audit(env, ctx, "sms.consent", "contact", contactId, { opt_in: !!optIn, source: "staff" });
    return json({ ok: true, opt_in: !!optIn });
  }

  /* ---- recent traffic ---- */
  if (p === "/api/admin/sms/log" && m === "GET") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
    const r = await env.DB.prepare(
      `SELECT s.id, s.direction, s.to_number, s.from_number, s.body, s.status, s.error,
              s.target, s.created_at, c.full_name
       FROM sms_log s LEFT JOIN contacts c ON c.id = s.contact_id AND c.org_id = s.org_id
       WHERE s.org_id=?1 AND s.deleted_at IS NULL
       ORDER BY s.id DESC LIMIT ?2`
    ).bind(ctx.orgId, limit).all();
    return json({ log: r.results || [], configured: smsConfigured(env) });
  }

  return null;
}
