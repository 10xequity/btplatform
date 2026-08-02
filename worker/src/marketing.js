/**
 * Boomtown Platform — Marketing & Comms module (M14 Phase A)
 * File: worker/src/marketing.js · Version: v1.1 · Date: 2026-08-01 · Ships in: v0.44.0 (v1.0 shipped in v0.16.0)
 *
 * v1.1 — Marketing SMS, scope C (owner req #17; sequencing override of record 2026-08-01:
 * built DORMANT ahead of live SMS proof). Campaigns gain channel 'email'|'sms' (migration
 * 0030). SMS campaigns reuse the SAME segments; recipients are contacts with sms_opt_in=1
 * and a normalizable phone (NOT the email BASE_WHERE). Per-recipient records ride sms_log
 * with target='campaign:ID'. Transport, quiet hours, daily cap, and the dormant fails-closed
 * sentence are imported from sms.js — one source of truth. Consent is re-checked per row at
 * send time (a STOP between snapshot and send is honored, mirroring the unsubscribe re-check).
 * While unconfigured: drafts and previews work; /send answers 503 and writes nothing.
 *
 * Staff routes (admin/staff role), mounted by worker/src/index.js:
 *   GET  /api/admin/marketing/overview                → contact counts, address status
 *   GET  /api/admin/marketing/segments                → segment list w/ live counts
 *   POST /api/admin/marketing/segments                { name, filter } → create
 *   POST /api/admin/marketing/segments/:id/update     { name?, filter? }
 *   POST /api/admin/marketing/segments/:id/delete
 *   GET  /api/admin/marketing/segments/:id/preview    → { count, sample[≤10] }
 *   GET  /api/admin/marketing/campaigns               → list w/ send counts
 *   GET  /api/admin/marketing/campaigns/:id           → detail + queued/sent/failed/skipped
 *   POST /api/admin/marketing/campaigns               { name, subject, html_body, segment_id }
 *   POST /api/admin/marketing/campaigns/:id/update    (draft only)
 *   POST /api/admin/marketing/campaigns/:id/delete    (draft only)
 *   POST /api/admin/marketing/campaigns/:id/test      { email } → one merged send (sandbox: returns rendered HTML)
 *   POST /api/admin/marketing/campaigns/:id/send      → snapshot recipients, status 'sending', process first batch
 *   POST /api/admin/marketing/campaigns/:id/process   → process next batch (also run by the daily cron)
 *   POST /api/admin/marketing/settings                { mailing_address } → org compliance address
 *
 * Public routes:
 *   POST /api/signup        { org, email, name?, hp } → consented contact (signup widget)
 *   GET  /api/unsubscribe?c=<contact_id>&t=<token>    → one-click unsubscribe (HTML page)
 *
 * Rules baked in:
 *   - Suppression is absolute: unsubscribed contacts never enter a recipient snapshot,
 *     and every send is re-checked at send time (unsubscribe mid-campaign is honored).
 *   - CAN-SPAM gate: a campaign cannot be sent until orgs.mailing_address is set; the
 *     compliance footer (address + one-click unsubscribe) is appended to EVERY email.
 *   - Batches are capped at 30 emails per invocation (Workers free-tier subrequest
 *     ceiling is 50/request); the daily cron drains anything still 'sending'.
 *   - No Brevo key (sandbox): sends are recorded, campaign is flagged sandbox=1,
 *     nothing leaves the building — same pattern as magic-link sandbox mode.
 *   - Cross-org emailing is impossible by construction: segments resolve inside org_id.
 */

import { sendEmail, escapeHtml } from "./registrations.js";

import {
  smsConfigured, normalizePhone, quietHoursBlocked, twilioSend, SMS_MAX, ORG_SENDS_PER_DAY, SMS_OFF,
} from "./sms.js";

let H = null; // wired: { json, audit, isStaff, requireStaff }
export function wireMarketing(helpers) { H = helpers; }

const BATCH_SIZE = 30;
const API_ORIGIN_DEFAULT = "https://boomtown-api.vvisuth.workers.dev";

/* ---------------- pure helpers (unit-tested in worker/test/marketing.test.mjs) ---------------- */

/** filter: { tags:[], played:'any'|'league'|'tournament'|'none'|null, since:'YYYY-MM-DD'|null }
 *  Returns { where, binds } to append after: org_id=? AND deleted_at IS NULL AND unsubscribed=0 AND email present. */
export function buildSegmentWhere(filter) {
  const f = filter || {};
  const parts = [];
  const binds = [];
  const tags = Array.isArray(f.tags) ? f.tags.filter((t) => typeof t === "string" && t.trim()) : [];
  if (tags.length) {
    parts.push(`EXISTS (SELECT 1 FROM json_each(c.tags_json) je WHERE je.value IN (${tags.map(() => "?").join(",")}))`);
    binds.push(...tags.map((t) => t.trim()));
  }
  if (f.played === "league" || f.played === "tournament") {
    parts.push(
      "EXISTS (SELECT 1 FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.contact_id = c.id AND r.deleted_at IS NULL AND e.deleted_at IS NULL AND e.type = ?)"
    );
    binds.push(f.played);
  } else if (f.played === "any") {
    parts.push("EXISTS (SELECT 1 FROM registrations r WHERE r.contact_id = c.id AND r.deleted_at IS NULL)");
  } else if (f.played === "none") {
    parts.push("NOT EXISTS (SELECT 1 FROM registrations r WHERE r.contact_id = c.id AND r.deleted_at IS NULL)");
  }
  if (f.since && /^\d{4}-\d{2}-\d{2}$/.test(f.since)) {
    parts.push("c.created_at >= ?");
    binds.push(f.since);
  }
  return { where: parts.length ? " AND " + parts.join(" AND ") : "", binds };
}

/** {{first_name}} {{full_name}} {{email}} — HTML-escaped values. */
export function mergeVars(html, contact) {
  const full = (contact.full_name || "").trim();
  const first = full.split(/\s+/)[0] || "there";
  return String(html || "")
    .replaceAll("{{first_name}}", escapeHtml(first))
    .replaceAll("{{full_name}}", escapeHtml(full || "there"))
    .replaceAll("{{email}}", escapeHtml(contact.email || ""));
}

/** CAN-SPAM footer — appended to every campaign email, no exceptions. */
export function complianceFooter(orgName, mailingAddress, unsubUrl) {
  return (
    `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px">` +
    `<p style="font-size:12px;color:#777;line-height:1.5">You're receiving this because you signed up or ` +
    `played with ${escapeHtml(orgName)}.<br>${escapeHtml(mailingAddress || "")}<br>` +
    `<a href="${unsubUrl}" style="color:#777">Unsubscribe</a></p>`
  );
}

/** Case-insensitive dedupe by email; keeps first occurrence. */
export function dedupeRecipients(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = String(r.email || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Campaign channel discriminator. SQLite ALTER cannot add a CHECK, so this IS the check. */
export function normalizeChannel(v) {
  if (v === undefined || v === null || v === "") return "email";
  return v === "email" || v === "sms" ? v : null;
}

/** {{first_name}} {{full_name}} — PLAIN TEXT merge for SMS. No HTML escaping: an SMS is not
 *  HTML, and escaping would text people "O&#39;Brien". {{email}} is deliberately absent. */
export function mergeVarsText(body, contact) {
  const full = (contact.full_name || "").trim();
  const first = full.split(/\s+/)[0] || "there";
  return String(body || "")
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{full_name}}", full || "there");
}

/** Dedupe SMS recipients by normalized E.164; drops un-normalizable phones. */
export function dedupeSmsRecipients(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const to = normalizePhone(r.phone);
    if (!to || seen.has(to)) continue;
    seen.add(to);
    out.push({ id: r.id, to });
  }
  return out;
}

/* ---------------- routing ---------------- */

export async function marketingRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;

  /* ---- public ---- */
  if (p === "/api/signup" && m === "POST") return publicSignup(request, env);
  if (p === "/api/unsubscribe" && m === "GET") return unsubscribe(env, url);

  if (!p.startsWith("/api/admin/marketing/")) return null;
  const denied = await H.requireStaff(env, ctx);
  if (denied) return denied;

  if (p === "/api/admin/marketing/overview" && m === "GET") return overview(env, ctx);
  if (p === "/api/admin/marketing/settings" && m === "POST") return saveSettings(request, env, ctx);

  if (p === "/api/admin/marketing/segments" && m === "GET") return listSegments(env, ctx);
  if (p === "/api/admin/marketing/segments" && m === "POST") return createSegment(request, env, ctx);
  let mt = p.match(/^\/api\/admin\/marketing\/segments\/(\d+)\/(update|delete|preview)$/);
  if (mt) {
    const id = Number(mt[1]);
    if (mt[2] === "preview" && m === "GET") return previewSegment(env, ctx, id);
    if (mt[2] === "update" && m === "POST") return updateSegment(request, env, ctx, id);
    if (mt[2] === "delete" && m === "POST") return deleteSegment(env, ctx, id);
  }

  if (p === "/api/admin/marketing/campaigns" && m === "GET") return listCampaigns(env, ctx);
  if (p === "/api/admin/marketing/campaigns" && m === "POST") return createCampaign(request, env, ctx);
  mt = p.match(/^\/api\/admin\/marketing\/campaigns\/(\d+)$/);
  if (mt && m === "GET") return getCampaign(env, ctx, Number(mt[1]));
  mt = p.match(/^\/api\/admin\/marketing\/campaigns\/(\d+)\/(update|delete|test|send|process)$/);
  if (mt && m === "POST") {
    const id = Number(mt[1]);
    if (mt[2] === "update") return updateCampaign(request, env, ctx, id);
    if (mt[2] === "delete") return deleteCampaign(env, ctx, id);
    if (mt[2] === "test") return testCampaign(request, env, ctx, id);
    if (mt[2] === "send") return sendCampaign(env, ctx, id);
    if (mt[2] === "process") return processCampaign(env, ctx.orgId, id, ctx);
  }
  return null;
}

/* ---------------- overview + settings ---------------- */

async function overview(env, ctx) {
  const org = await env.DB.prepare("SELECT name, mailing_address FROM orgs WHERE id=?1").bind(ctx.orgId).first();
  const c = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN unsubscribed=0 AND email IS NOT NULL AND email<>'' THEN 1 ELSE 0 END) AS reachable,
            SUM(CASE WHEN unsubscribed=1 THEN 1 ELSE 0 END) AS unsubscribed
     FROM contacts WHERE org_id=?1 AND deleted_at IS NULL`
  ).bind(ctx.orgId).first();
  return H.json({
    org_name: org?.name, mailing_address: org?.mailing_address || null,
    address_set: !!(org && org.mailing_address),
    contacts: c.total || 0, reachable: c.reachable || 0, unsubscribed: c.unsubscribed || 0,
    email_mode: env.BREVO_API_KEY ? "brevo" : "sandbox",
    sms_mode: smsConfigured(env) ? "twilio" : "off",
  });
}

async function saveSettings(request, env, ctx) {
  const { mailing_address } = await request.json().catch(() => ({}));
  if (!mailing_address || String(mailing_address).trim().length < 10) {
    return H.json({ error: "Enter the full physical mailing address (required by email law)." }, 400);
  }
  await env.DB.prepare("UPDATE orgs SET mailing_address=?1, updated_at=datetime('now') WHERE id=?2")
    .bind(String(mailing_address).trim(), ctx.orgId).run();
  await H.audit(env, ctx, "marketing.settings", "orgs", ctx.orgId, { mailing_address: true });
  return H.json({ ok: true });
}

/* ---------------- segments ---------------- */

const BASE_WHERE =
  "c.org_id=?1 AND c.deleted_at IS NULL AND c.unsubscribed=0 AND c.email IS NOT NULL AND c.email<>''";

/* SMS campaigns: consent is sms_opt_in (TCPA), NOT the email unsubscribed flag. */
const SMS_BASE_WHERE =
  "c.org_id=?1 AND c.deleted_at IS NULL AND c.sms_opt_in=1 AND c.phone IS NOT NULL AND TRIM(c.phone)<>''";

async function segmentCount(env, orgId, filter) {
  const { where, binds } = buildSegmentWhere(filter);
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM contacts c WHERE ${BASE_WHERE}${where}`)
    .bind(orgId, ...binds).first();
  return row.n || 0;
}

async function listSegments(env, ctx) {
  const rows = (await env.DB.prepare(
    "SELECT id, name, filter_json, created_at FROM segments WHERE org_id=?1 AND deleted_at IS NULL ORDER BY id DESC"
  ).bind(ctx.orgId).all()).results;
  const out = [];
  for (const s of rows) {
    let filter = {};
    try { filter = JSON.parse(s.filter_json || "{}"); } catch {}
    out.push({ ...s, filter, count: await segmentCount(env, ctx.orgId, filter) });
  }
  return H.json({ segments: out });
}

function cleanFilter(raw) {
  const f = raw && typeof raw === "object" ? raw : {};
  const out = {};
  if (Array.isArray(f.tags) && f.tags.length) out.tags = f.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10);
  if (["any", "league", "tournament", "none"].includes(f.played)) out.played = f.played;
  if (typeof f.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.since)) out.since = f.since;
  return out;
}

async function createSegment(request, env, ctx) {
  const { name, filter } = await request.json().catch(() => ({}));
  if (!name || !String(name).trim()) return H.json({ error: "Give the segment a name." }, 400);
  const clean = cleanFilter(filter);
  const ins = await env.DB.prepare(
    "INSERT INTO segments (org_id, name, filter_json) VALUES (?1, ?2, ?3)"
  ).bind(ctx.orgId, String(name).trim(), JSON.stringify(clean)).run();
  await H.audit(env, ctx, "marketing.segment_create", "segments", ins.meta.last_row_id, { name });
  return H.json({ ok: true, id: ins.meta.last_row_id, count: await segmentCount(env, ctx.orgId, clean) });
}

async function updateSegment(request, env, ctx, id) {
  const seg = await env.DB.prepare("SELECT id FROM segments WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL")
    .bind(id, ctx.orgId).first();
  if (!seg) return H.json({ error: "Segment not found." }, 404);
  const { name, filter } = await request.json().catch(() => ({}));
  const clean = filter !== undefined ? JSON.stringify(cleanFilter(filter)) : null;
  await env.DB.prepare(
    "UPDATE segments SET name=COALESCE(?1,name), filter_json=COALESCE(?2,filter_json), updated_at=datetime('now') WHERE id=?3"
  ).bind(name ? String(name).trim() : null, clean, id).run();
  await H.audit(env, ctx, "marketing.segment_update", "segments", id, {});
  return H.json({ ok: true });
}

async function deleteSegment(env, ctx, id) {
  await env.DB.prepare(
    "UPDATE segments SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(id, ctx.orgId).run();
  await H.audit(env, ctx, "marketing.segment_delete", "segments", id, {});
  return H.json({ ok: true });
}

async function previewSegment(env, ctx, id) {
  const seg = await env.DB.prepare(
    "SELECT filter_json FROM segments WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(id, ctx.orgId).first();
  if (!seg) return H.json({ error: "Segment not found." }, 404);
  let filter = {};
  try { filter = JSON.parse(seg.filter_json || "{}"); } catch {}
  const { where, binds } = buildSegmentWhere(filter);
  const count = await segmentCount(env, ctx.orgId, filter);
  const sample = (await env.DB.prepare(
    `SELECT c.id, c.full_name, c.email FROM contacts c WHERE ${BASE_WHERE}${where} ORDER BY c.id DESC LIMIT 10`
  ).bind(ctx.orgId, ...binds).all()).results;
  return H.json({ count, sample });
}

/* ---------------- campaigns ---------------- */

async function listCampaigns(env, ctx) {
  const rows = (await env.DB.prepare(
    `SELECT cp.id, cp.name, cp.subject, cp.status, cp.sandbox, cp.recipient_count, cp.sent_at, cp.created_at,
            cp.channel,
            s.name AS segment_name,
            CASE cp.channel WHEN 'sms'
              THEN (SELECT COUNT(*) FROM sms_log sl WHERE sl.org_id=cp.org_id AND sl.target='campaign:'||cp.id AND sl.direction='out' AND sl.status='sent')
              ELSE (SELECT COUNT(*) FROM campaign_sends cs WHERE cs.campaign_id=cp.id AND cs.status='sent') END AS sent_count,
            CASE cp.channel WHEN 'sms'
              THEN (SELECT COUNT(*) FROM sms_log sl WHERE sl.org_id=cp.org_id AND sl.target='campaign:'||cp.id AND sl.direction='out' AND sl.status='queued')
              ELSE (SELECT COUNT(*) FROM campaign_sends cs WHERE cs.campaign_id=cp.id AND cs.status='queued') END AS queued_count
     FROM campaigns cp LEFT JOIN segments s ON s.id=cp.segment_id
     WHERE cp.org_id=?1 AND cp.deleted_at IS NULL ORDER BY cp.id DESC LIMIT 50`
  ).bind(ctx.orgId).all()).results;
  return H.json({ campaigns: rows });
}

async function getCampaign(env, ctx, id) {
  const cp = await env.DB.prepare(
    "SELECT * FROM campaigns WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(id, ctx.orgId).first();
  if (!cp) return H.json({ error: "Campaign not found." }, 404);
  const counts = cp.channel === "sms"
    ? (await env.DB.prepare(
        "SELECT status, COUNT(*) AS n FROM sms_log WHERE org_id=?1 AND target=?2 AND direction='out' GROUP BY status"
      ).bind(ctx.orgId, `campaign:${id}`).all()).results
    : (await env.DB.prepare(
        "SELECT status, COUNT(*) AS n FROM campaign_sends WHERE campaign_id=?1 GROUP BY status"
      ).bind(id).all()).results;
  return H.json({ campaign: cp, counts });
}

async function createCampaign(request, env, ctx) {
  const { name, subject, html_body, segment_id, channel, sms_body } = await request.json().catch(() => ({}));
  if (!name || !String(name).trim()) return H.json({ error: "Give the campaign a name." }, 400);
  const ch = normalizeChannel(channel);
  if (!ch) return H.json({ error: "Channel must be email or sms." }, 400);
  const ins = await env.DB.prepare(
    "INSERT INTO campaigns (org_id, segment_id, name, subject, html_body, channel, sms_body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
  ).bind(ctx.orgId, segment_id || null, String(name).trim(), String(subject || ""), String(html_body || ""),
         ch, sms_body != null ? String(sms_body) : null).run();
  await H.audit(env, ctx, "marketing.campaign_create", "campaigns", ins.meta.last_row_id, { name, channel: ch });
  return H.json({ ok: true, id: ins.meta.last_row_id });
}

async function draftOnly(env, ctx, id) {
  const cp = await env.DB.prepare(
    "SELECT id, status FROM campaigns WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(id, ctx.orgId).first();
  if (!cp) return { err: H.json({ error: "Campaign not found." }, 404) };
  if (cp.status !== "draft") return { err: H.json({ error: "Only drafts can be changed. Sent campaigns are a permanent record." }, 400) };
  return { cp };
}

async function updateCampaign(request, env, ctx, id) {
  const { err } = await draftOnly(env, ctx, id);
  if (err) return err;
  const { name, subject, html_body, segment_id, channel, sms_body } = await request.json().catch(() => ({}));
  const ch = channel === undefined ? null : normalizeChannel(channel);
  if (channel !== undefined && !ch) return H.json({ error: "Channel must be email or sms." }, 400);
  await env.DB.prepare(
    `UPDATE campaigns SET name=COALESCE(?1,name), subject=COALESCE(?2,subject),
       html_body=COALESCE(?3,html_body), segment_id=COALESCE(?4,segment_id),
       channel=COALESCE(?5,channel), sms_body=COALESCE(?6,sms_body), updated_at=datetime('now') WHERE id=?7`
  ).bind(name ?? null, subject ?? null, html_body ?? null, segment_id ?? null, ch, sms_body ?? null, id).run();
  await H.audit(env, ctx, "marketing.campaign_update", "campaigns", id, {});
  return H.json({ ok: true });
}

async function deleteCampaign(env, ctx, id) {
  const { err } = await draftOnly(env, ctx, id);
  if (err) return err;
  await env.DB.prepare("UPDATE campaigns SET deleted_at=datetime('now') WHERE id=?1").bind(id).run();
  await H.audit(env, ctx, "marketing.campaign_delete", "campaigns", id, {});
  return H.json({ ok: true });
}

async function renderEmail(env, orgId, campaign, contact) {
  const org = await env.DB.prepare("SELECT name, mailing_address FROM orgs WHERE id=?1").bind(orgId).first();
  const token = await ensureUnsubToken(env, contact);
  const origin = env.API_ORIGIN || API_ORIGIN_DEFAULT;
  const unsubUrl = `${origin}/api/unsubscribe?c=${contact.id}&t=${token}`;
  return mergeVars(campaign.html_body, contact) + complianceFooter(org.name, org.mailing_address, unsubUrl);
}

async function ensureUnsubToken(env, contact) {
  if (contact.unsub_token) return contact.unsub_token;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("UPDATE contacts SET unsub_token=?1, updated_at=datetime('now') WHERE id=?2")
    .bind(token, contact.id).run();
  return token;
}

async function testCampaign(request, env, ctx, id) {
  const cp = await env.DB.prepare(
    "SELECT * FROM campaigns WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(id, ctx.orgId).first();
  if (!cp) return H.json({ error: "Campaign not found." }, 404);
  if (cp.channel === "sms") {
    if (!smsConfigured(env)) return H.json({ error: SMS_OFF }, 503);
    return H.json({ error: "Text campaigns don't have a test send yet — the reach preview shows exactly who gets it." }, 400);
  }
  const { email } = await request.json().catch(() => ({}));
  if (!email) return H.json({ error: "Enter an email for the test send." }, 400);
  const fake = { id: 0, full_name: "Test Player", email, unsub_token: "test" };
  const org = await env.DB.prepare("SELECT name, mailing_address FROM orgs WHERE id=?1").bind(ctx.orgId).first();
  const origin = env.API_ORIGIN || API_ORIGIN_DEFAULT;
  const html = mergeVars(cp.html_body, fake) +
    complianceFooter(org.name, org.mailing_address || "(mailing address not set yet)", `${origin}/api/unsubscribe?c=0&t=test`);
  if (!env.BREVO_API_KEY) {
    return H.json({ ok: true, mode: "sandbox", preview_html: html, message: "Sandbox: no email sent — preview below." });
  }
  const sent = await sendEmail(env, email, `[TEST] ${cp.subject || cp.name}`, html);
  return H.json({ ok: sent, mode: "email", message: sent ? `Test sent to ${email}.` : "Send failed — check the Brevo key." });
}

async function sendCampaign(env, ctx, id) {
  const cp = await env.DB.prepare(
    "SELECT * FROM campaigns WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(id, ctx.orgId).first();
  if (!cp) return H.json({ error: "Campaign not found." }, 404);
  if (cp.status !== "draft") return H.json({ error: "This campaign was already sent or is sending." }, 400);
  if (!cp.segment_id) return H.json({ error: "Pick a segment before sending." }, 400);
  if (cp.channel === "sms") return sendSmsCampaign(env, ctx, cp);
  if (!cp.subject.trim()) return H.json({ error: "Add a subject line before sending." }, 400);

  const org = await env.DB.prepare("SELECT mailing_address FROM orgs WHERE id=?1").bind(ctx.orgId).first();
  if (!org.mailing_address) {
    return H.json({ error: "Set the physical mailing address first (Marketing → Settings) — it's required by email law." }, 400);
  }

  const seg = await env.DB.prepare(
    "SELECT filter_json FROM segments WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(cp.segment_id, ctx.orgId).first();
  if (!seg) return H.json({ error: "That segment no longer exists." }, 400);
  let filter = {};
  try { filter = JSON.parse(seg.filter_json || "{}"); } catch {}
  const { where, binds } = buildSegmentWhere(filter);
  const rows = (await env.DB.prepare(
    `SELECT c.id, c.email FROM contacts c WHERE ${BASE_WHERE}${where} ORDER BY c.id`
  ).bind(ctx.orgId, ...binds).all()).results;
  const recipients = dedupeRecipients(rows);
  if (!recipients.length) return H.json({ error: "This segment has no reachable contacts." }, 400);

  for (const r of recipients) {
    await env.DB.prepare(
      "INSERT INTO campaign_sends (org_id, campaign_id, contact_id, email) VALUES (?1, ?2, ?3, ?4)"
    ).bind(ctx.orgId, id, r.id, r.email).run();
  }
  await env.DB.prepare(
    "UPDATE campaigns SET status='sending', recipient_count=?1, sandbox=?2, updated_at=datetime('now') WHERE id=?3"
  ).bind(recipients.length, env.BREVO_API_KEY ? 0 : 1, id).run();
  await H.audit(env, ctx, "marketing.campaign_send", "campaigns", id, { recipients: recipients.length });

  const first = await processCampaignBatch(env, ctx.orgId, id);
  return H.json({ ok: true, queued: recipients.length, ...first,
    message: env.BREVO_API_KEY
      ? `Sending to ${recipients.length} contacts in batches of ${BATCH_SIZE}. The daily job finishes any remainder, or click "Send next batch".`
      : `Sandbox: recorded ${recipients.length} sends — no real emails without the Brevo key.` });
}

async function processCampaign(env, orgId, id, ctx) {
  const ch = await env.DB.prepare(
    "SELECT channel FROM campaigns WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(id, orgId).first();
  const out = ch && ch.channel === "sms"
    ? await processSmsCampaignBatch(env, orgId, id)
    : await processCampaignBatch(env, orgId, id);
  if (ctx) await H.audit(env, ctx, "marketing.campaign_process", "campaigns", id, out);
  return H.json({ ok: true, ...out });
}

/* ---------------- SMS campaigns (scope C — v1.1) ---------------- */

/** How many more texts this org may send today (shared cap with ad-hoc admin SMS). */
async function smsDailyAllowance(env, orgId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sms_log
     WHERE org_id=?1 AND direction='out' AND created_at >= datetime('now','-1 day')`
  ).bind(orgId).first();
  return Math.max(0, ORG_SENDS_PER_DAY - (row.n || 0));
}

async function sendSmsCampaign(env, ctx, cp) {
  /* Dormant gate FIRST — while Twilio is unconfigured this route answers with the same
     sentence as every other SMS route and touches nothing. Order matters: no DB write
     may precede this check (guarded in marketing.test.mjs). */
  if (!smsConfigured(env)) return H.json({ error: SMS_OFF }, 503);
  const body = String(cp.sms_body || "").trim();
  if (!body) return H.json({ error: "Write the text message first." }, 400);
  if (body.length > SMS_MAX) {
    return H.json({ error: `Keep it under ${SMS_MAX} characters — that's three text segments.` }, 400);
  }
  if (quietHoursBlocked(new Date())) {
    return H.json({ error: "It's outside texting hours (8am–9pm Mountain). Try again in the morning." }, 400);
  }

  const seg = await env.DB.prepare(
    "SELECT filter_json FROM segments WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(cp.segment_id, ctx.orgId).first();
  if (!seg) return H.json({ error: "That segment no longer exists." }, 400);
  let filter = {};
  try { filter = JSON.parse(seg.filter_json || "{}"); } catch {}
  const { where, binds } = buildSegmentWhere(filter);
  const rows = (await env.DB.prepare(
    `SELECT c.id, c.phone FROM contacts c WHERE ${SMS_BASE_WHERE}${where} ORDER BY c.id`
  ).bind(ctx.orgId, ...binds).all()).results;
  const recipients = dedupeSmsRecipients(rows);
  if (!recipients.length) {
    return H.json({ error: "Nobody in that segment has opted in to texts with a textable number yet." }, 400);
  }
  const allowance = await smsDailyAllowance(env, ctx.orgId);
  if (recipients.length > allowance) {
    return H.json({ error: `That's ${recipients.length} texts but only ${allowance} remain in today's limit — it was not sent.` }, 429);
  }

  for (const r of recipients) {
    await env.DB.prepare(
      `INSERT INTO sms_log (org_id, contact_id, direction, to_number, status, target)
       VALUES (?1, ?2, 'out', ?3, 'queued', ?4)`
    ).bind(ctx.orgId, r.id, r.to, `campaign:${cp.id}`).run();
  }
  await env.DB.prepare(
    "UPDATE campaigns SET status='sending', recipient_count=?1, sandbox=0, updated_at=datetime('now') WHERE id=?2"
  ).bind(recipients.length, cp.id).run();
  await H.audit(env, ctx, "marketing.sms_campaign_send", "campaigns", cp.id, { recipients: recipients.length });

  const first = await processSmsCampaignBatch(env, ctx.orgId, cp.id);
  return H.json({ ok: true, queued: recipients.length, ...first,
    message: `Texting ${recipients.length} people in batches of ${BATCH_SIZE}. The daily job finishes any remainder, or click "Send next batch".` });
}

/** SMS batch worker — cron-safe. Quiet hours and the daily cap pause the queue instead of
 *  failing it: rows stay 'queued' and the next tick drains them. Consent is re-checked per
 *  row so a STOP that arrived after snapshot is honored ('skipped', never sent). */
export async function processSmsCampaignBatch(env, orgId, campaignId) {
  const cp = await env.DB.prepare(
    "SELECT * FROM campaigns WHERE id=?1 AND org_id=?2 AND status='sending' AND deleted_at IS NULL"
  ).bind(campaignId, orgId).first();
  if (!cp) return { processed: 0, remaining: 0 };
  if (!smsConfigured(env)) return { processed: 0, remaining: -1, paused: "unconfigured" };
  if (quietHoursBlocked(new Date())) return { processed: 0, remaining: -1, paused: "quiet-hours" };
  const allowance = await smsDailyAllowance(env, orgId);
  if (allowance <= 0) return { processed: 0, remaining: -1, paused: "daily-limit" };

  const queue = (await env.DB.prepare(
    `SELECT sl.id AS log_id, sl.to_number, c.id AS contact_id, c.full_name, c.sms_opt_in, c.deleted_at AS contact_deleted
     FROM sms_log sl JOIN contacts c ON c.id = sl.contact_id AND c.org_id = sl.org_id
     WHERE sl.org_id=?1 AND sl.target=?2 AND sl.direction='out' AND sl.status='queued'
     ORDER BY sl.id LIMIT ?3`
  ).bind(orgId, `campaign:${campaignId}`, Math.min(BATCH_SIZE, allowance)).all()).results;

  let sent = 0, skipped = 0, failed = 0;
  for (const row of queue) {
    // Honor a STOP or a delete that happened AFTER queueing — consent re-check per row.
    if (!row.sms_opt_in || row.contact_deleted) {
      await env.DB.prepare(
        "UPDATE sms_log SET status='skipped', error='consent revoked or contact removed after queueing' WHERE id=?1"
      ).bind(row.log_id).run();
      skipped++; continue;
    }
    const text = mergeVarsText(cp.sms_body, row);
    const res = await twilioSend(env, row.to_number, text);
    await env.DB.prepare(
      "UPDATE sms_log SET status=?1, body=?2, twilio_sid=?3, error=?4 WHERE id=?5"
    ).bind(res.ok ? "sent" : "failed", text, res.ok ? res.sid : null, res.ok ? null : res.error, row.log_id).run();
    res.ok ? sent++ : failed++;
  }

  const left = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sms_log WHERE org_id=?1 AND target=?2 AND direction='out' AND status='queued'"
  ).bind(orgId, `campaign:${campaignId}`).first();
  if (!left.n) {
    await env.DB.prepare(
      "UPDATE campaigns SET status='sent', sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?1"
    ).bind(campaignId).run();
  }
  return { processed: queue.length, sent, skipped, failed, remaining: left.n || 0 };
}

/** Core batch worker — also called by the daily cron (no ctx). ≤ BATCH_SIZE emails/invocation. */
export async function processCampaignBatch(env, orgId, campaignId) {
  const cp = await env.DB.prepare(
    "SELECT * FROM campaigns WHERE id=?1 AND org_id=?2 AND status='sending' AND deleted_at IS NULL"
  ).bind(campaignId, orgId).first();
  if (!cp) return { processed: 0, remaining: 0 };

  const queue = (await env.DB.prepare(
    "SELECT cs.id AS send_id, c.* FROM campaign_sends cs JOIN contacts c ON c.id=cs.contact_id " +
    "WHERE cs.campaign_id=?1 AND cs.status='queued' ORDER BY cs.id LIMIT ?2"
  ).bind(campaignId, BATCH_SIZE).all()).results;

  let sent = 0, skipped = 0, failed = 0;
  for (const row of queue) {
    // Honor unsubscribe/delete that happened AFTER queueing.
    if (row.unsubscribed || row.deleted_at) {
      await env.DB.prepare("UPDATE campaign_sends SET status='skipped', updated_at=datetime('now') WHERE id=?1")
        .bind(row.send_id).run();
      skipped++; continue;
    }
    if (!env.BREVO_API_KEY) {
      await env.DB.prepare("UPDATE campaign_sends SET status='sent', sent_at=datetime('now') WHERE id=?1")
        .bind(row.send_id).run();
      sent++; continue;
    }
    const html = await renderEmail(env, orgId, cp, row);
    const ok = await sendEmail(env, row.email, cp.subject, html);
    await env.DB.prepare(
      "UPDATE campaign_sends SET status=?1, sent_at=CASE WHEN ?1='sent' THEN datetime('now') ELSE NULL END, updated_at=datetime('now') WHERE id=?2"
    ).bind(ok ? "sent" : "failed", row.send_id).run();
    ok ? sent++ : failed++;
  }

  const left = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM campaign_sends WHERE campaign_id=?1 AND status='queued'"
  ).bind(campaignId).first();
  if (!left.n) {
    await env.DB.prepare(
      "UPDATE campaigns SET status='sent', sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?1"
    ).bind(campaignId).run();
  }
  return { processed: queue.length, sent, skipped, failed, remaining: left.n || 0 };
}

/** Cron entry: drain up to 3 in-flight campaigns per day tick (index.js runDailyJobs). */
export async function campaignQueueSweep(env) {
  const rows = (await env.DB.prepare(
    "SELECT id, org_id, channel FROM campaigns WHERE status='sending' AND deleted_at IS NULL LIMIT 3"
  ).all()).results;
  const out = [];
  for (const r of rows) {
    out.push({ id: r.id, ...(r.channel === "sms"
      ? await processSmsCampaignBatch(env, r.org_id, r.id)
      : await processCampaignBatch(env, r.org_id, r.id)) });
  }
  return out;
}

/* ---------------- public: signup widget + unsubscribe ---------------- */

async function publicSignup(request, env) {
  const { org, email, name, hp } = await request.json().catch(() => ({}));
  if (hp) return H.json({ ok: true }); // honeypot filled = bot; pretend success, store nothing
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return H.json({ error: "Enter a valid email address." }, 400);
  }
  const orgRow = await env.DB.prepare(
    "SELECT id FROM orgs WHERE (slug=?1 OR id=CAST(?1 AS INTEGER)) AND deleted_at IS NULL"
  ).bind(String(org || "boomtown")).first();
  if (!orgRow) return H.json({ error: "Unknown organization." }, 400);

  // Cheap flood guard: cap widget signups platform-wide at 30 per 10 minutes.
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM contacts WHERE consent_source='signup-widget' AND created_at >= datetime('now','-10 minutes')"
  ).first();
  if (recent.n >= 30) return H.json({ error: "Too many signups right now — try again in a few minutes." }, 429);

  const existing = await env.DB.prepare(
    "SELECT id, tags_json FROM contacts WHERE org_id=?1 AND email=?2 AND deleted_at IS NULL"
  ).bind(orgRow.id, String(email).toLowerCase()).first();

  if (existing) {
    let tags = [];
    try { tags = JSON.parse(existing.tags_json || "[]"); } catch {}
    if (!tags.includes("newsletter")) tags.push("newsletter");
    // They submitted the form themselves — that's fresh express consent, so re-subscribe.
    await env.DB.prepare(
      "UPDATE contacts SET tags_json=?1, unsubscribed=0, consent_source='signup-widget', consented_at=datetime('now'), updated_at=datetime('now') WHERE id=?2"
    ).bind(JSON.stringify(tags), existing.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO contacts (org_id, email, full_name, tags_json, consent_source, consented_at) VALUES (?1, ?2, ?3, '[\"newsletter\"]', 'signup-widget', datetime('now'))"
    ).bind(orgRow.id, String(email).toLowerCase(), name ? String(name).slice(0, 120) : null).run();
  }
  return H.json({ ok: true, message: "You're on the list!" });
}

async function unsubscribe(env, url) {
  const id = Number(url.searchParams.get("c"));
  const token = url.searchParams.get("t") || "";
  const page = (msg) => new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Boomtown Athletics</title><body style="font-family:system-ui;background:#0B0B0D;color:#F2F0EA;` +
    `display:grid;place-items:center;min-height:100dvh;margin:0"><div style="text-align:center;padding:24px">` +
    `<h1 style="font-size:20px">${escapeHtml(msg)}</h1><p style="color:#A8A49A">Boomtown Athletics</p></div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
  if (!id || !token) return page("That unsubscribe link is incomplete.");
  const contact = await env.DB.prepare(
    "SELECT id FROM contacts WHERE id=?1 AND unsub_token=?2 AND deleted_at IS NULL"
  ).bind(id, token).first();
  if (!contact) return page("That unsubscribe link is invalid or was already used.");
  await env.DB.prepare(
    "UPDATE contacts SET unsubscribed=1, updated_at=datetime('now') WHERE id=?1"
  ).bind(id).run();
  return page("You're unsubscribed. You won't get marketing email from us again.");
}

/* Changelog: v1.1 (2026-08-01, v0.44.0) — Marketing SMS scope C: campaigns.channel 'email'|'sms',
   sms_body ≤ SMS_MAX, recipients from segments via SMS_BASE_WHERE (sms_opt_in, not unsubscribed),
   snapshot + batches ride sms_log target='campaign:ID', per-row consent re-check, quiet-hours and
   daily-cap PAUSE the queue, dormant 503 via SMS_OFF, cron sweep channel-routes. Built dormant by
   owner override of record 2026-08-01. */
/* Changelog: v1.0 (2026-07-24) — M14 Phase A: segments (tags/played/since filters, live counts,
   preview), campaigns (draft→send→batch processing ≤30/invocation, cron drain, sandbox mode,
   test send), CAN-SPAM gate (mailing address required, footer + one-click unsubscribe on every
   email), public signup endpoint with honeypot + flood guard, unsubscribe page. */
