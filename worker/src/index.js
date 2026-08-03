/**
 * Boomtown Platform — API Worker
 * Date: 2026-07-26 · Modules 1–18
 *
 * NO VERSION IN THIS HEADER, DELIBERATELY. It read v0.26.0 while the worker served v0.27.0 and
 * that drift triggered a "the deploy is broken" investigation across two sessions. /api/health is
 * the only honest source of the version. Do not reintroduce it here.
 *
 * v0.39.0 (2026-07-30, Kiosk check-in): NEW kiosk.js mounted before checkin (owner req #20 —
 *   scan/type an 8-char member code at an iPad desk kiosk; profile + balance shown; owed
 *   balance DENIES, waiver never gates per D-MIN-8; member code self-service on the profile
 *   page as a Code 128 barcode). Migration 0027. Token reuse: the event's checkin_token.
 *
 * v0.38.0 (2026-07-30, Sub finder): NEW subs.js mounted before leagues (owner req #7 —
 *   sub signups with skill/gender/game-type preferences, open-request board, claim + cancel,
 *   matched in-app + email notify with 200-cap fan-out, 5-open flood guard). Migration 0026.
 *   sendEmail/escapeHtml injected via wireSubs (waitlists precedent, no cycle).
 *
 * v0.32.0 (2026-07-26, Minors): registrations.js becomes age-aware — it held zero matches for
 *   date_of_birth, guardian or minor across 49 KB, so a participant of any age could be
 *   registered with no adult attached. D-MIN-9 (account created, not activated), D-MIN-11 (a
 *   blank guardian DOB mints an invitation rather than throwing a form error) and owner option B
 *   (registration itself is blocked, not merely activation). NEW crypto.js leaf so family.js can
 *   hash without importing consent.js, which imports family.js. Migration 0025:
 *   contacts.activation_state, guardianship certification columns, access_tokens rebuilt (0 rows)
 *   to admit kind='guardian_invite'. Closes F-6 and eight of the ten symbols on the F-17 census.
 *
 * v0.28.0 (2026-07-26, Documents): NEW documents.js — org-owned document library. Each org uploads
 *   its own text; tokens resolve from the org profile at publish (D-DOC-5) with no fallback on
 *   party identity (D-DOC-6). Fixes F-10: WAIVER_TOKENS.ENTITY fell back to a hardcoded company
 *   name, so an org without a legal_entity published a release naming the wrong party.
 *   Migrations 0021 (schema ledger + org scope), 0022 (legal entity short/verified), 0023
 *   (documents, document_requirements, signatures.document_id).
 *
 * v0.26.0 (2026-07-26, Tiers + hardening): NEW tiers.js — membership levels (Gymdesk-shaped),
 *   grants, and bulk member actions. Migration 0018 adds membership_tiers, membership_grants,
 *   schedule_views ownership + visibility, and orgs.timezone. Multi-tenant isolation fixes in
 *   admin/facility/security/checkin; capability tokens in consent.js now fail closed and are
 *   consumed atomically; calendar feeds emit floating wall-clock bound to a VTIMEZONE instead
 *   of falsely stamping local times as UTC. Shared contactForSession replaces six copies.
 *
 * v0.25.0 (2026-07-26, Consent): NEW consent.js mounted after calendar. Teammate waiver
 *   self-sign — a capability token (access_tokens.kind='waiver_sign', migration 0016)
 *   emailed to a roster row lets a teammate sign for themselves, which creates the contact
 *   the door gate has had nothing to check against since v0.23.0. Also the media-release
 *   consent record (migration 0017) — waiver §6's written opt-out finally has somewhere
 *   to live. /api/sign/:token is public: the token is the credential, there is no session.
 *
 * v0.24.0 (2026-07-26, Build status): frontend-only — assets/build-status.js is the single
 *   registry of module maturity. Version bumped so /api/health and the site agree.
 *
 * v0.23.0 (2026-07-26, Waiver enforcement + calendar feeds):
 *   NEW calendar.js. GET /api/calendar/:token.ics is handled BEFORE the /api/ chain and
 *   OUTSIDE json(), because v0.21.0's json() stamps Cache-Control: no-store on every API
 *   response and a no-store .ics makes every subscribed client refetch on every tick.
 *   Daily cron gains waiverExpirySweep (T-30 notice). Check-in enforces the waiver gate.
 * v0.22.0 (2026-07-26, Waiver versioning): NEW waivers.js mounted first in the API chain
 *   (public /api/waiver/*, staff /api/admin/waivers/*). The waiver text is now a DB record
 *   (migration 0015) and every signature pins the version it was shown. registrations.js
 *   v1.4 and profiles.js v1.3 write waivers.version_id; publishing never rewrites history.
 *
 * v0.21.0 (2026-07-25, M16): json() now sends Cache-Control: no-store on every API
 *   response (browser HTTP heuristic cache served a stale /api/health after the v0.20.0
 *   deploy — API data must never be cached; the SW static-shell cache is unaffected,
 *   D-PWA-3 holds). Version bump only otherwise; routes unchanged.
 * v0.20.0 (2026-07-25): PWA + Web Push — push.js mounted before waitlists (subscribe/
 *   unsubscribe/status, public VAPID key, staff test-send; RFC 8291 aes128gcm + RFC 8292
 *   VAPID implemented on WebCrypto, zero deps). waitlists.js v1.1 sends a push alongside
 *   the offer email. Daily cron adds pushPruneSweep. Requires Worker secrets
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (+ optional VAPID_SUBJECT) and migration 0014.
 * v0.19.0 (2026-07-25): Waitlists — waitlists.js mounted after pos (join/offer/claim,
 *   admin queue, expiring claim tokens; sendEmail injected via wire to avoid a circular
 *   import). registrations.js v1.3 enforces events.capacity + adds staff cancel with
 *   auto-offer. Daily cron adds waitlistSweep (expire stale offers → offer next).
 * v0.18.0 (2026-07-25): M15 — pos.js mounted after messages (POS-lite sales/products,
 *   promo codes on the day-one discounts table per D-M15-1, sponsors incl. public
 *   GET /api/sponsors, staff shifts). reports.js v1.2 adds heatmap/pos-sales/shift-coverage.
 * v0.17.0 (2026-07-24): M14 Phase B — Messages, Relay & Player Library (messages.js):
 *   privacy-gated library search (public/members/private tiers, spec §3.4; staff see all),
 *   member-to-member message RELAY (in-app notification + email via sendEmail; addresses
 *   never exposed — the email links back to member-inbox.html), member inbox
 *   (threads/read/reply/unread badge), block / hide / report from day one (content_flags +
 *   admin review queue at /api/admin/messages/flags). Flood guards: 10 new threads +
 *   60 messages per member per day; member_mutes hard-block. Migration 0011 applied live
 *   (member_profiles +positions/+skill_level/+gender_division/+height_reach; message +
 *   flag indexes — message tables themselves pre-existed). profiles.js v1.1 accepts the
 *   four new player-card fields. Health reports v0.17.0.
 *
 * v0.16.0 (2026-07-24): M14 Phase A — Marketing & comms (marketing.js): CRM segments
 *   (tags/played/since filters with live counts + preview), campaigns (draft → send →
 *   batched delivery ≤30/invocation with cron drain; sandbox mode without a Brevo key;
 *   merged test sends), CAN-SPAM enforcement (send blocked until orgs.mailing_address set;
 *   compliance footer + one-click unsubscribe on every email), public POST /api/signup for
 *   the embeddable website widget (signup-widget.js) and GET /api/unsubscribe. Migration
 *   0010 applied live (segments, campaigns, campaign_sends; contacts consent columns;
 *   orgs.mailing_address). Health reports v0.16.0. Phase B (relay inbox + library search)
 *   is next.
 *
 * v0.15.0 (2026-07-24): Member-view isolation + brand (frontend release; no worker route or
 *   schema changes — version bumped for release parity). admin-nav.js v2.4: guard() now
 *   role-checks and auto-runs, so signed-in members can never render the admin UI shell
 *   (server-side requireStaff was always enforced; this closes the UI). site-nav.js v2.3 +
 *   logo assets: brand logo in every header (UX-06 closed). Health reports v0.15.0.
 *
 * v0.14.0 (2026-07-24): M12.5 Member Portal & Agreements (member_portal.js — GET /api/me/agreements:
 *   waiver-status chips for self + children and the full signed-documents list from the waivers +
 *   signatures ledger; member dashboard home.html/js v1.3.0 adds Status, Agreements and flag-gated
 *   Request-court-time cards) + M13 Security & Recovery (security.js — audit-log viewer with kind
 *   presets, soft-delete trash can with whitelist-only Restore, admin lockout rescue-link;
 *   admin-security.html/js NEW, admin-nav.js v2.3 adds the Security & Recovery item).
 *   No schema changes. Health reports v0.14.0.
 *
 * v0.13.0 (2026-07-24): M12 Phase B — tournament schedules + league weeks auto-claim courts on
 *   the facility calendar (facility.js v1.1.0, tournaments.js v0.4.0, leagues_admin.js v1.2.0);
 *   rental REQUEST feature (member POST /api/rental-request, staff approve/decline under
 *   /api/admin/facility/requests). Public self-serve rental stays HIDDEN. Migration 0009
 *   (space_bookings.source, rental_requests) applied live. Health reports v0.13.0.
 *
 * v0.12.0 (2026-07-24): Court & Facility Management Phase A (facility.js — space atoms,
 *   presets, conflict engine w/ Court Share + closures, bookings CRUD w/ weekly series,
 *   CSV importer). Migration 0008 applied live. Health reports v0.12.0.
 *
 * v0.11.0 (2026-07-24): UX & Navigation hardening + Sandbox tools (sandbox.js —
 *   staff-gated test-data generate/wipe/status for the admin rail demo toolbar).
 *   Health reports v0.11.0. No schema changes.
 *
 * v0.10.0 (2026-07-24): Memberships & recurring billing (memberships.js — plans CRUD w/
 *   Square Catalog plan+variation, subscribe via payment link checkout_options.subscription_plan_id,
 *   cancel-at-period-end, MRR endpoint). Migration 0007 applied live. /api/webhooks/square now
 *   enters via membershipWebhook, which handles subscription and invoice events and forwards payment events
 *   to the unchanged registrations handler. Health reports v0.10.0.
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
import { registrationRoutes, wireRegistrations } from "./registrations.js";
import { adminRoutes, wireAdmin } from "./admin.js";
import { scheduleRoutes, wireSchedule } from "./schedule.js";
import { eventsAdminRoutes, wireEventsAdmin } from "./events_admin.js";
import { profileRoutes, wireProfiles } from "./profiles.js";
import { webauthnRoutes, wireWebauthn } from "./webauthn.js";
import { leagueRoutes, wireLeagues } from "./leagues_admin.js";
import { reportRoutes, wireReports } from "./reports.js";
import { checkinRoutes, wireCheckin } from "./checkin.js";
import { membershipRoutes, wireMemberships, membershipWebhook } from "./memberships.js";
import { sandboxRoutes, wireSandbox } from "./sandbox.js";
import { facilityRoutes, wireFacility } from "./facility.js";
import { securityRoutes, wireSecurity } from "./security.js";
import { memberPortalRoutes, wireMemberPortal } from "./member_portal.js";
import { marketingRoutes, wireMarketing, campaignQueueSweep } from "./marketing.js";
import { messagesRoutes, wireMessages } from "./messages.js";
import { posRoutes, wirePos } from "./pos.js";
import { waitlistRoutes, wireWaitlists, waitlistSweep } from "./waitlists.js";
import { pushRoutes, wirePush, pushPruneSweep } from "./push.js"; // v0.20.0 PWA web push
import { waiverRoutes, wireWaivers } from "./waivers.js"; // v0.22.0 waiver versioning
import { calendarRoutes, wireCalendar, icsFeed } from "./calendar.js"; // v0.23.0 iCal feeds
import { consentRoutes, wireConsent } from "./consent.js"; // v0.25.0 teammate self-sign + media consent
import { tiersRoutes, wireTiers } from "./tiers.js"; // v0.26.0 membership tiers, grants, bulk member actions
import { familyRoutes, wireFamily } from "./family.js"; // v0.27.0 guardians, minors, families
import { orgRoutes, wireOrgs, senderIdentity } from "./orgs.js"; // v0.31.0 org profile, identity, sender
import { documentRoutes, wireDocuments } from "./documents.js"; // v0.28.0 document library + requirements
import { uploadRoutes, wireUploads } from "./uploads.js"; // v0.30.0 generic file uploads (R2 + D1 index)
import { subsRoutes, wireSubs } from "./subs.js"; // v0.38.0 league sub finder (owner req #7, migration 0026)
import { kioskRoutes, wireKiosk } from "./kiosk.js"; // v0.39.0 kiosk check-in (owner req #20, migration 0027)
import { faqRoutes, wireFaq } from "./faq.js"; // v0.40.0 Help & FAQ (owner req #21 phase 1, migration 0028)
import { smsRoutes, wireSms } from "./sms.js"; // v0.42.0 SMS phase 3 (owner req #17, migration 0029, Twilio)
import { lfgRoutes, wireLfg } from "./lfg.js"; // v0.45.0 LFG & community play (migration 0031)
import { announcementsRoutes, wireAnnouncements, publicOrgBrand } from "./announcements.js"; // v0.50.0 R3 member home (migration 0033)
import { memberFieldsRoutes, wireMemberFields } from "./member_fields.js"; // v0.57.0 M22 membership custom fields (migration 0034)
import { waiverReminderSweep, waiverExpirySweep, sendEmail, escapeHtml } from "./registrations.js";

const MAGIC_LINK_TTL_MIN = 15;
const SESSION_TTL_DAYS = 30;

/**
 * The member record behind the current sign-in, scoped to the active org. Six modules had a
 * private copy of this query (consent, member_portal, messages, profiles, registrations,
 * calendar) with subtly different ORDER BY clauses. This is the shared one.
 */
async function contactForSession(env, ctx) {
  if (!ctx || !ctx.userId) return null;
  return env.DB.prepare(
    `SELECT c.* FROM contacts c
       JOIN users u ON lower(u.email) = lower(c.email)
      WHERE u.id = ?1 AND u.deleted_at IS NULL
        AND c.org_id = ?2 AND c.deleted_at IS NULL
      ORDER BY c.user_id DESC, c.id ASC LIMIT 1`
  ).bind(ctx.userId, ctx.orgId).first();
}

const wiredHelpers = {
  json,
  contactForSession,
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
wireMemberships(wiredHelpers);
wireSandbox(wiredHelpers);
wireFacility(wiredHelpers);
wireSecurity(wiredHelpers);
wireMemberPortal(wiredHelpers);
wireMarketing(wiredHelpers);
wireMessages(wiredHelpers);
wirePos(wiredHelpers);
wireWaitlists({ ...wiredHelpers, sendEmail, escapeHtml }); // sendEmail injected — no circular import
wireSubs({ ...wiredHelpers, sendEmail, escapeHtml }); // v0.38.0 — same injection pattern
wireKiosk(wiredHelpers); // v0.39.0
wireFaq(wiredHelpers); // v0.40.0
wireSms(wiredHelpers); // v0.42.0 — fails closed until TWILIO_* secrets exist
wireLfg(wiredHelpers); // v0.45.0
wireAnnouncements(wiredHelpers); // v0.50.0
wireMemberFields(wiredHelpers); // v0.57.0
wirePush(wiredHelpers); // v0.20.0
wireWaivers(wiredHelpers); // v0.22.0
wireCalendar(wiredHelpers); // v0.23.0
wireConsent(wiredHelpers); // v0.25.0
wireTiers(wiredHelpers); // v0.26.0
wireFamily(wiredHelpers); // v0.27.0
wireDocuments(wiredHelpers); // v0.28.0
wireUploads(wiredHelpers); // v0.30.0
wireOrgs(wiredHelpers);    // v0.31.0

/** ctx carries the caller's session + selected org for role checks. */
async function buildCtx(request, env) {
  const session = await currentSession(request, env);
  // F-11 (v0.30.0): validate the org before trusting a client header. Previously ANY X-Org-Id was
  // accepted, so the seven orgs deactivated by migration 0021 stayed fully operable via a header,
  // and a malformed header fell back to org 1 — silently operating on the live business. orgId keeps
  // the REQUESTED value rather than being coerced, so audit rows and errors stay honest.
  const orgId = Number(request.headers.get("X-Org-Id")) || 1;
  const orgRow = await env.DB.prepare(
    "SELECT id FROM orgs WHERE id = ?1 AND active = 1 AND deleted_at IS NULL"
  ).bind(orgId).first();
  const orgOk = !!orgRow;
  const userId = session ? session.user_id : null;
  let role = null;
  if (userId) {
    const r = await env.DB.prepare(
      "SELECT role FROM user_org_roles WHERE user_id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(userId, orgId).first();
    role = r ? r.role : null;
  }
  return { session, orgId, orgOk, userId, role };
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
        res = json({ ok: true, version: "v0.57.0" });
      } else if (url.pathname === "/api/webhooks/square" && request.method === "POST") {
        res = await membershipWebhook(request, env); // verifies signature; forwards payment.* to squareWebhook
      } else if (url.pathname === "/api/public/org-brand" && request.method === "GET") {
        // v0.50.0 — public member-page branding. Intentionally OUTSIDE buildCtx (no session;
        // three brand fields only — standards §8) with its own Cache-Control (~5 min).
        res = await publicOrgBrand(env, url);
      } else if (url.pathname.startsWith("/api/calendar/") && url.pathname.endsWith(".ics") && request.method === "GET") {
        // v0.23.0 — public iCal feed. Intentionally OUTSIDE buildCtx (the token is the
        // credential) and OUTSIDE json() (needs text/calendar + a real max-age).
        res = await icsFeed(env, url, request);
      } else if (url.pathname.startsWith("/api/")) {
        const ctx = await buildCtx(request, env);
        res = (!ctx.orgOk && json({ error: "That organization isn't available." }, 404)) // F-11 (v0.30.0) — fail closed before any route sees ctx
           || (await uploadRoutes(request, env, url, ctx)) // v0.30.0 — generic org-scoped file uploads
           || (await documentRoutes(request, env, url, ctx)) // v0.28.0 — documents, versions, requirements, compliance
           || (await waiverRoutes(request, env, url, ctx)) // v0.22.0 — /api/waiver/* + /api/admin/waivers/*
           || (await calendarRoutes(request, env, url, ctx)) // v0.23.0 — feed token mint/revoke
           || (await consentRoutes(request, env, url, ctx)) // v0.25.0 — /api/sign/* + waiver links + media consent
           || (await orgRoutes(request, env, url, ctx)) // v0.31.0 — org profile, entity verification, reactivation
           || (await tiersRoutes(request, env, url, ctx)) // v0.26.0 — tiers, grants, bulk members
           || (await familyRoutes(request, env, url, ctx)) // v0.27.0 — age gate, families, age-out
           || (await marketingRoutes(request, env, url, ctx))
           || (await messagesRoutes(request, env, url, ctx))
           || (await posRoutes(request, env, url, ctx))
           || (await pushRoutes(request, env, url, ctx))
           || (await waitlistRoutes(request, env, url, ctx))
           || (await webauthnRoutes(request, env, url, ctx))
           || (await securityRoutes(request, env, url, ctx))
           || (await memberPortalRoutes(request, env, url, ctx))
           || (await subsRoutes(request, env, url, ctx)) // v0.38.0 — league sub finder
           || (await kioskRoutes(request, env, url, ctx)) // v0.39.0 — kiosk check-in (req #20)
           || (await faqRoutes(request, env, url, ctx)) // v0.40.0 — Help & FAQ (req #21 phase 1)
           || (await smsRoutes(request, env, url, ctx)) // v0.42.0 — SMS phase 3 (req #17)
           || (await lfgRoutes(request, env, url, ctx)) // v0.45.0 — LFG & community play
           || (await announcementsRoutes(request, env, url, ctx)) // v0.50.0 — R3 member home feed + announcements
           || (await memberFieldsRoutes(request, env, url, ctx)) // v0.57.0 — M22 membership custom-field registry
           || (await leagueRoutes(request, env, url, ctx))
           || (await reportRoutes(request, env, url, ctx))
           || (await checkinRoutes(request, env, url, ctx))
           || (await membershipRoutes(request, env, url, ctx))
           || (await sandboxRoutes(request, env, url, ctx))
           || (await facilityRoutes(request, env, url, ctx))
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
    const wx = await waiverExpirySweep(env); // v0.23.0: T-30 notice before a waiver lapses
    if (wx.due) console.log("waiver expiry sweep", JSON.stringify(wx));
  } catch (e) { console.error("waiver expiry sweep failed", e); }
  try {
    const events = await eventReminderSweep(env);
    console.log("event reminders", JSON.stringify(events));
  } catch (e) { console.error("event reminder sweep failed", e); }
  try {
    const drained = await campaignQueueSweep(env); // v0.16.0: finish any in-flight campaigns
    if (drained.length) console.log("campaign queue", JSON.stringify(drained));
  } catch (e) { console.error("campaign queue sweep failed", e); }
  try {
    const wl = await waitlistSweep(env); // v0.19.0: expire stale offers, auto-offer next
    if (wl.expired || wl.autoOffered) console.log("waitlist sweep", JSON.stringify(wl));
  } catch (e) { console.error("waitlist sweep failed", e); }
  try {
    const pr = await pushPruneSweep(env); // v0.20.0: drop dead/failing push subscriptions
    if (pr.disabled || pr.purged) console.log("push prune", JSON.stringify(pr));
  } catch (e) { console.error("push prune failed", e); }
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
        // F-12 (v0.30.0): was unscoped — the first user became admin of all ten orgs including the
        // seven deactivated ones, seeding exactly the role rows F-11 needed. Fires on any DB reset.
        "INSERT INTO user_org_roles (user_id, org_id, role) SELECT ?1, id, 'admin' FROM orgs WHERE active = 1 AND deleted_at IS NULL"
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
    // F-11 (v0.30.0): the switcher offered all ten. Migration 0021 was invisible until this line.
    "SELECT id, name, slug, logo_url, brand_json FROM orgs WHERE active = 1 AND deleted_at IS NULL ORDER BY id"
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

async function sendBrevoEmail(env, to, link, orgId = null) {
  // F-13 (v0.31.0): sender identity resolves from the org profile. Standards §8 — no org name,
  // entity, address or email may be a literal string in anything a member reads. A sign-in link
  // may be cross-org, so orgId is optional and senderIdentity falls back to deployment config.
  const who = await senderIdentity(env, orgId);
  if (!who) return false; // no resolvable sender is a refusal, never a guess
  // Brevo transactional email API v3 — verify sender domain/DKIM before first real send.
  const body = {
    sender: who,
    to: [{ email: to }],
    subject: `Your ${who.name} sign-in link`,
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
    headers: { "content-type": "application/json", "cache-control": "no-store" },
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
