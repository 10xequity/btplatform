/**
 * Boomtown Platform — API Worker
 * Version: v0.9.0 · Date: 2026-07-23 · Modules 1–10
 *
 * v0.9.1 (2026-07-24): RECOVERY — restores the never-uploaded v0.7.0 worker files
 * (leagues_admin.js, registrations.js v1.2 exports + retry-payment). No new routes here.
 * v0.9.0 (2026-07-23): Check-in & attendance (checkin.js — door roster with waiver
 *   flags, tap check-in/undo, walk-ins, rotating self-check-in token + public QR page,
 *   member attendance history). Migration 0006. Health reports v0.9.0.
 *
 * v0.8.0 (2026-07-23): Control Center dashboard endpoint (reports.js v1.1 —
 *   /api/admin/dashboard: month money, outstanding list, 7-day trend, schedule,
 *   member count, admin alerts). Health reports v0.8.0.
 *
 * v0.7.0 (2026-07-23): League management (leagues_admin.js — weekly scheduler with the
 *   2-level separation rule, rematch avoidance, bye rotation; reuses tournament score/
 *   standings/drag endpoints). Sales reports + member notification inbox (reports.js).
 *   Teammate connect/invite + payment retry + waiver-reminder sweep (registrations.js v0.4.0).
 *   NEW: scheduled() cron — daily waiver reminders + 24h event reminders for opted-in
 *   members (migration 0005 applied live; wrangler.toml gains [triggers]).
 *
 * v0.5.0 (2026-07-22): Member profiles + family accounts (profiles.js) — self-service profile,
 *   avatar upload (R2), guardian-signed waivers with signature ledger, results résumé from
 *   standings, upcoming events + ICS, email-reminder opt-in, season seeding materialization.
 *   Passkeys (webauthn.js): Face ID / fingerprint sign-in (replaces the planned TOTP).
 *   Migration 0004 + webauthn_challenges applied live. New binding: AVATARS (R2 bucket
 *   "boomtown-avatars"). Health reports v0.5.0.
 *
 * v0.4.0 (2026-07-22): schedule views + public feed (schedule.js), admin users/roles/members
 *   (admin.js), event templates/recurring/bulk/CSV export (events_admin.js). Migration 0003 applied live.
 *
 * Endpoints:
 *   POST /api/auth/request-link   { email }            → sends magic link (sandbox: returns dev_link)
 *   POST /api/auth/verify         { token }            → creates session, sets cookie, returns bearer token
 *   POST /api/auth/logout                              → revokes session
 *   GET  /api/me                                       → current user + org roles
 *   GET  /api/orgs                                     → org list (public branding fields only)
 *
 * Env bindings (wrangler.toml):
 *   DB               — D1 database "boomtown-prod"
 *   AVATARS          — R2 bucket "boomtown-avatars" (profile photos; keys only in D1)
 *   ALLOWED_ORIGINS  — comma-separated list of allowed frontend origins
 *   APP_URL          — frontend URL used inside magic-link emails
 *   BREVO_API_KEY    — (secret, optional) when absent, auth runs in SANDBOX mode:
 *                      no email is sent; the link is returned in the API response.
 *
 * Security notes:
 *   - Magic-link tokens: 32 random bytes; only SHA-256 hashes stored; 15-min expiry; single use.
 *   - Sessions: 30-day expiry; httpOnly Secure SameSite=None cookie + Bearer fallback
 *     (Safari blocks third-party cookies between github.io and workers.dev).
 *   - Bootstrap: the FIRST user ever to verify becomes admin of all orgs. Every later
 *     user starts with no role (public-level) until an admin assigns one.
 *   - Passkeys (v0.5.0): device-bound WebAuthn credentials — supersedes the TOTP plan.
 *
 * v0.2 (2026-07-21): tournament engine routes mounted (see tournaments.js).
 * v0.3.0 (2026-07-21): Module 4 — registration + Square + captain scoring (see registrations.js).
 *   New optional secrets: SQUARE_ACCESS_TOKEN, SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL,
 *   SQUARE_LOCATION_ID, SQUARE_ENV ('production' | anything else = sandbox).
 */
import { tournamentRoutes, wire } from "./tournaments.js";
import { registrationRoutes, wireRegistrations, squareWebhook } from "./registrations.js";
import { adminRoutes, wireAdmin } from "./admin.js";
import { scheduleRoutes, wireSchedule } from "./schedule.js";
import { eventsAdminRoutes, wireEventsAdmin } from "./events_admin.js";
import { profileRoutes, wireProfiles } from "./profiles.js";
import { webauthnRoutes, wireWebauthn } from "./webauthn.js";
import { leagueRoutes, wireLeagues } from "./leagues_admin.js";
import { reportRoutes, wireReports } from "./reports.js";
import { checkinRoutes, wireCheckin } from "./checkin.js";
import { waiverReminderSweep, sendEmail, escapeHtml } from "./registrations.js";

const MAGIC_LINK_TTL_MIN = 15;
const SESSION_TTL_DAYS = 30;

const wiredHelpers = {
  json,
  audit: (env, ctx, action, entity, entityId, detail) =>
    audit(env, ctx.orgId, ctx.userId, action, entity, entityId, detail),
  isStaff,
  requireStaff,
  sendLoginLink,
  issueSession,
};
wire(wiredHelpers);
wireRegistrations(wiredHelpers);
wireAdmin(wiredHelpers);
wireSchedule(wiredHelpers);
wireEventsAdmin(wiredHelpers);
wireProfiles(wiredHelpers);
wireWebauthn(wiredHelpers);
wireLeagues(wiredHelpers);
wireReports(wiredHelpers);
wireCheckin(wiredHelpers);

/** ctx carries the caller's session + selected org for role checks. */
async function buildCtx(request, env) {
  const session = await currentSession(request, env);
  const orgId = Number(request.headers.get("X-Org-Id")) || 1;
  return { session, orgId, userId: session ? session.user_id : null };
}

async function isStaff(env, ctx, orgId = ctx.orgId) {
  if (!ctx.session) return false;
  const row = await env.DB.prepare(
    "SELECT role FROM user_org_roles WHERE user_id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(ctx.userId, orgId).first();
  return row && (row.role === "admin" || row.role === "staff");
}

async function requireStaff(env, ctx, orgId = ctx.orgId) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  if (!(await isStaff(env, ctx, orgId))) return json({ error: "Admin or staff role required for this org." }, 403);
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      let res;
      if (url.pathname === "/api/auth/request-link" && request.method === "POST") {
        res = await requestLink(request, env);
      } else if (url.pathname === "/api/auth/verify" && request.method === "POST") {
        res = await verifyLink(request, env);
      } else if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        res = await logout(request, env);
      } else if (url.pathname === "/api/me" && request.method === "GET") {
        res = await me(request, env);
      } else if (url.pathname === "/api/orgs" && request.method === "GET") {
        res = await listOrgs(env);
      } else if (url.pathname === "/api/health") {
        res = json({ ok: true, version: "v0.9.1" });
      } else if (url.pathname === "/api/webhooks/square" && request.method === "POST") {
        res = await squareWebhook(request, env); // server-to-server; signature-verified inside
      } else if (url.pathname.startsWith("/api/")) {
        const ctx = await buildCtx(request, env);
        res = (await webauthnRoutes(request, env, url, ctx))
           || (await leagueRoutes(request, env, url, ctx))
           || (await reportRoutes(request, env, url, ctx))
           || (await checkinRoutes(request, env, url, ctx))
           || (await profileRoutes(request, env, url, ctx))
           || (await scheduleRoutes(request, env, url, ctx))
           || (await eventsAdminRoutes(request, env, url, ctx))
           || (await adminRoutes(request, env, url, ctx))
           || (await tournamentRoutes(request, env, url, ctx))
           || (await registrationRoutes(request, env, url, ctx))
           || json({ error: "Not found" }, 404);
      } else {
        res = json({ error: "Not found" }, 404);
      }
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      console.error(err);
      const res = json({ error: "Server error" }, 500);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
  },

  /** Cron (wrangler.toml [triggers]) — daily: waiver chasing + 24h event reminders. */
  async scheduled(controller, env, ectx) {
    ectx.waitUntil(runDailyJobs(env));
  },
};

async function runDailyJobs(env) {
  try {
    const waivers = await waiverReminderSweep(env);
    console.log("waiver sweep", JSON.stringify(waivers));
  } catch (e) { console.error("waiver sweep failed", e); }
  try {
    const events = await eventReminderSweep(env);
    console.log("event reminders", JSON.stringify(events));
  } catch (e) { console.error("event reminder sweep failed", e); }
}

/** 24h event reminders — only members who opted in (Settings toggle, consent stored v0.5.0). */
async function eventReminderSweep(env) {
  const rows = (await env.DB.prepare(
    `SELECT DISTINCT r.id AS reg_id, c.id AS contact_id, c.email, c.full_name,
            e.org_id, e.name AS event_name, e.starts_at, e.location
     FROM registrations r
     JOIN contacts c ON c.id = r.contact_id AND c.deleted_at IS NULL
     JOIN member_profiles mp ON mp.contact_id = c.id AND mp.reminder_opt_in = 1 AND mp.deleted_at IS NULL
     JOIN events e ON e.id = r.event_id AND e.deleted_at IS NULL AND e.status IN ('published','in_progress')
     WHERE r.deleted_at IS NULL AND r.status IN ('paid','comped','cash-pending','pending','email-sent')
       AND e.starts_at BETWEEN datetime('now') AND datetime('now', '+1 day')
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.contact_id = c.id AND n.kind = 'event_reminder'
                         AND json_extract(n.payload_json, '$.reg_id') = r.id)
     LIMIT 200`
  ).all()).results;
  let sent = 0;
  for (const r of rows) {
    const when = (r.starts_at || "").replace("T", " ").slice(0, 16);
    const ok = await sendEmail(env, r.email, `Tomorrow: ${r.event_name}`,
      `<p>Hi ${escapeHtml(r.full_name || "there")} — reminder that <strong>${escapeHtml(r.event_name)}</strong> starts ${when}${r.location ? " at " + escapeHtml(r.location) : ""}.</p><p>See you on the court!</p>`);
    await env.DB.prepare(
      "INSERT INTO notifications (org_id, kind, target, contact_id, title, body, payload_json, sent_at) VALUES (?1,'event_reminder','member',?2,?3,?4,?5,datetime('now'))"
    ).bind(r.org_id, r.contact_id, `Tomorrow: ${r.event_name}`,
      `Starts ${when}${r.location ? " at " + r.location : ""}.`,
      JSON.stringify({ reg_id: r.reg_id })).run();
    if (ok) sent++;
  }
  return { due: rows.length, emailed: sent };
}

/* ---------- auth ---------- */

async function requestLink(request, env) {
  const { email } = await safeJson(request);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }
  return sendLoginLink(env, email);
}

/** Shared: create + (sandbox: return / email mode: send) a magic sign-in link. */
async function sendLoginLink(env, email) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + MAGIC_LINK_TTL_MIN * 60_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO magic_links (email, token_hash, expires_at) VALUES (?1, ?2, ?3)"
  ).bind(email.toLowerCase(), tokenHash, expires).run();

  const link = `${env.APP_URL}/?token=${token}`;

  if (env.BREVO_API_KEY) {
    const sent = await sendBrevoEmail(env, email, link);
    if (!sent) return json({ error: "Email could not be sent. Try again." }, 502);
    return json({ ok: true, mode: "email", message: "Check your email for a sign-in link. It expires in 15 minutes." });
  }
  // SANDBOX mode — no email provider configured; return link for on-screen testing.
  return json({ ok: true, mode: "sandbox", dev_link: link, message: "Sandbox mode: no email sent." });
}

async function verifyLink(request, env) {
  const { token } = await safeJson(request);
  if (!token) return json({ error: "Missing token." }, 400);
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  const row = await env.DB.prepare(
    "SELECT id, email, expires_at, used_at FROM magic_links WHERE token_hash = ?1"
  ).bind(tokenHash).first();

  if (!row) return json({ error: "This link is invalid." }, 401);
  if (row.used_at) return json({ error: "This link was already used. Request a new one." }, 401);
  if (row.expires_at < now) return json({ error: "This link expired. Request a new one." }, 401);

  await env.DB.prepare("UPDATE magic_links SET used_at = ?1 WHERE id = ?2").bind(now, row.id).run();

  // Find or create user
  let user = await env.DB.prepare(
    "SELECT id, email FROM users WHERE email = ?1 AND deleted_at IS NULL"
  ).bind(row.email).first();

  let bootstrapped = false;
  if (!user) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
    const ins = await env.DB.prepare("INSERT INTO users (email) VALUES (?1)").bind(row.email).run();
    user = { id: ins.meta.last_row_id, email: row.email };
    if (count.n === 0) {
      // Bootstrap: first-ever user becomes admin of all orgs.
      await env.DB.prepare(
        "INSERT INTO user_org_roles (user_id, org_id, role) SELECT ?1, id, 'admin' FROM orgs"
      ).bind(user.id).run();
      bootstrapped = true;
    }
    await audit(env, null, user.id, "user.create", "users", user.id, { bootstrapped });
  }

  const res = await issueSession(env, user.id, "magic-link");
  // issueSession returns a Response; add the bootstrap flag by rebuilding the body.
  const data = await res.json();
  const out = json({ ...data, bootstrapped });
  out.headers.append("Set-Cookie", res.headers.get("Set-Cookie"));
  return out;
}

/** Shared: create a session for a verified user (magic link OR passkey). */
async function issueSession(env, userId, method) {
  const sessionToken = randomToken();
  const sessionHash = await sha256(sessionToken);
  const sessionExpiry = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?1, ?2, ?3)"
  ).bind(userId, sessionHash, sessionExpiry).run();
  await audit(env, null, userId, "auth.login", "sessions", null, { method: method || "magic-link" });

  const res = json({ ok: true, token: sessionToken });
  res.headers.append(
    "Set-Cookie",
    `bt_session=${sessionToken}; Max-Age=${SESSION_TTL_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=None`
  );
  return res;
}

async function logout(request, env) {
  const session = await currentSession(request, env);
  if (session) {
    await env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?1")
      .bind(session.id).run();
    await audit(env, null, session.user_id, "auth.logout", "sessions", session.id, {});
  }
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", "bt_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None");
  return res;
}

async function me(request, env) {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Not signed in." }, 401);
  const user = await env.DB.prepare(
    "SELECT id, email, display_name, totp_enabled FROM users WHERE id = ?1 AND deleted_at IS NULL"
  ).bind(session.user_id).first();
  const roles = (await env.DB.prepare(
    "SELECT org_id, role FROM user_org_roles WHERE user_id = ?1 AND deleted_at IS NULL"
  ).bind(session.user_id).all()).results;
  const passkeys = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?1 AND deleted_at IS NULL"
  ).bind(session.user_id).first();
  return json({ user, roles, passkeys: passkeys.n });
}

async function listOrgs(env) {
  const orgs = (await env.DB.prepare(
    "SELECT id, name, slug, logo_url, brand_json FROM orgs WHERE deleted_at IS NULL ORDER BY id"
  ).all()).results;
  return json({ orgs });
}

/* ---------- helpers ---------- */

async function currentSession(request, env) {
  let token = null;
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) token = auth.slice(7);
  if (!token) {
    const cookie = request.headers.get("Cookie") || "";
    const m = cookie.match(/(?:^|;\s*)bt_session=([^;]+)/);
    if (m) token = m[1];
  }
  if (!token) return null;
  const hash = await sha256(token);
  return env.DB.prepare(
    "SELECT id, user_id FROM sessions WHERE token_hash = ?1 AND revoked_at IS NULL AND expires_at > datetime('now')"
  ).bind(hash).first();
}

async function audit(env, orgId, actorUserId, action, entity, entityId, detail) {
  await env.DB.prepare(
    "INSERT INTO audit_log (org_id, actor_user_id, action, entity, entity_id, detail_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
  ).bind(orgId, actorUserId, action, entity, entityId == null ? null : String(entityId), JSON.stringify(detail || {})).run();
}

async function sendBrevoEmail(env, to, link) {
  // Brevo transactional email API v3 — verify sender domain/DKIM before first real send.
  const body = {
    sender: { name: "Boomtown Athletics", email: env.SENDER_EMAIL || "no-reply@boomtownvb.com" },
    to: [{ email: to }],
    subject: "Your Boomtown sign-in link",
    htmlContent: `<p>Click to sign in (expires in ${MAGIC_LINK_TTL_MIN} minutes):</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, ignore this email.</p>`,
  };
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.ok;
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Org-Id",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
