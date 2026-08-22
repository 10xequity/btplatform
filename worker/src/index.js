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
// v0.77.0 — one failing module must not take the whole request down. Imports nothing, so no cycle.
import { dispatch } from "./resilience.js";
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
import { membershipRoutes, wireMemberships, membershipWebhook, ensureEventSquareItem } from "./memberships.js";
import { sandboxRoutes, wireSandbox } from "./sandbox.js";
import { facilityRoutes, wireFacility } from "./facility.js";
import { securityRoutes, wireSecurity } from "./security.js";
import { memberPortalRoutes, wireMemberPortal } from "./member_portal.js";
import { marketingRoutes, wireMarketing, campaignQueueSweep } from "./marketing.js";
import { messagesRoutes, wireMessages, overFlood } from "./messages.js";
import { posRoutes, wirePos } from "./pos.js";
import { waitlistRoutes, wireWaitlists, waitlistSweep } from "./waitlists.js";
import { pushRoutes, wirePush, pushPruneSweep } from "./push.js"; // v0.20.0 PWA web push
import { waiverRoutes, wireWaivers } from "./waivers.js"; // v0.22.0 waiver versioning
import { calendarRoutes, wireCalendar, icsFeed } from "./calendar.js"; // v0.23.0 iCal feeds
import { consentRoutes, wireConsent } from "./consent.js"; // v0.25.0 teammate self-sign + media consent
import { tiersRoutes, wireTiers } from "./tiers.js"; // v0.26.0 membership tiers, grants, bulk member actions
import { familyRoutes, wireFamily } from "./family.js"; // v0.27.0 guardians, minors, families
import { orgRoutes, wireOrgs, senderIdentity, MODULE_KEYS, MODULE_LABELS } from "./orgs.js"; // v0.31.0 org profile, identity, sender; v0.168.0 the grant vocabulary (SG-3a)
import { documentRoutes, wireDocuments } from "./documents.js"; // v0.28.0 document library + requirements
import { uploadRoutes, wireUploads } from "./uploads.js"; // v0.30.0 generic file uploads (R2 + D1 index)
import { subsRoutes, wireSubs } from "./subs.js"; // v0.38.0 league sub finder (owner req #7, migration 0026)
import { kioskRoutes, wireKiosk } from "./kiosk.js"; // v0.39.0 kiosk check-in (owner req #20, migration 0027)
import { faqRoutes, wireFaq } from "./faq.js"; // v0.40.0 Help & FAQ (owner req #21 phase 1, migration 0028)
import { smsRoutes, wireSms } from "./sms.js"; // v0.42.0 SMS phase 3 (owner req #17, migration 0029, Twilio)
import { lfgRoutes, wireLfg } from "./lfg.js"; // v0.45.0 LFG & community play (migration 0031)
import { announcementsRoutes, wireAnnouncements, publicOrgBrand } from "./announcements.js"; // v0.50.0 R3 member home (migration 0033)
import { memberFieldsRoutes, wireMemberFields } from "./member_fields.js"; // v0.57.0 M22 membership custom fields (migration 0034)
import { passesRoutes, wirePasses } from "./passes.js"; // v0.58.0 pass/credit ledger (migration 0035)
import { staffPayRoutes, wireStaffPay } from "./staff_pay.js"; // v0.58.0 staff rates + shift pay (migration 0035)
import { tryoutsRoutes, wireTryouts } from "./tryouts.js"; // v0.60.0 tryouts: cards, evaluations, team builder (migration 0036)
import { formatsRoutes, wireFormats } from "./formats.js"; // v0.62.0 M-TF pool generator (no migration - stateless)
import { bracketRoutes, wireBrackets } from "./brackets.js"; // v0.66.0 playable brackets (migration 0037)
import { kotcRoutes, wireKotc } from "./kotcplay.js"; // v0.80.0 KOTC play surface (migrations 0040/0042)
import { divisionRoutes, wireDivisions } from "./divisions.js"; // v0.69.0 divisions + bracket balancing (migration 0038)
import { liveRoutes, wireLive } from "./live.js"; // v0.73.0 public live board (read-only, no auth)
import { waiverReminderSweep, waiverExpirySweep, sendEmail, escapeHtml } from "./registrations.js";

const MAGIC_LINK_TTL_MIN = 15;
/* §-1i S-3b (v0.117.0): the flood band on sign-in links, per TARGET EMAIL — messages.js's
   guard shape (COUNT in window → overFlood → 429), not a new invention. The short window is
   DERIVED from MAGIC_LINK_TTL_MIN (you never need a 6th link while the 5th is still valid);
   the day band catches an attacker pacing one request per window. Guarded in sendLoginLink
   itself so rescue-link and family invites are bounded through the same door —
   auth_rate_limit.test.mjs fails a route-level version by construction. */
const LINKS_PER_WINDOW = 5;
const LINKS_PER_DAY = 20;
const SESSION_TTL_DAYS = 30;

/**
 * The member record behind the current sign-in, scoped to the active org. THE one identity rule
 * (D-18, v0.166.0) — every module that resolves "who is signed in" calls this, with exactly one
 * exemption: profiles.js owns the LINKER (it writes contacts.user_id and creates the row when
 * there is none), so it keeps its own query and matches by the same rule below.
 *
 * The rule: **a contact linked to this user by user_id IS that user's record, outright.** An
 * email match is the fallback for a member who has never been linked. This matters because an
 * admin can edit a member's address, and a member can change the address they sign in with —
 * before v0.166.0 this query joined on EMAIL ALONE and only sorted by user_id, so either edit
 * made the linked record invisible and orphaned the member from their own history.
 *
 * (The header this replaces claimed six modules had been consolidated into it. Measured at
 * v0.166.0: consent and registrations really had been; member_portal, messages, profiles and
 * calendar still carried their own copies — and those copies matched on user_id, so they were
 * MORE correct than this one on the axis D-18 names. The rule was unified upward, not
 * downward. Case is not part of the difference: contacts.email and users.email are both
 * COLLATE NOCASE in D1, so `email = ?` was never case-sensitive.)
 */
async function contactForSession(env, ctx) {
  if (!ctx || !ctx.userId) return null;
  return env.DB.prepare(
    `SELECT c.* FROM contacts c
       JOIN users u ON (c.user_id = u.id OR lower(c.email) = lower(u.email))
      WHERE u.id = ?1 AND u.deleted_at IS NULL
        AND c.org_id = ?2 AND c.deleted_at IS NULL
      ORDER BY CASE WHEN c.user_id = u.id THEN 0 ELSE 1 END, c.id ASC LIMIT 1`
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
/* THE MOUNTS (v0.168.0, SG-3a). A mount that passes `requireStaff: staffGateFor(<keys>)` binds its
   module's gate to those grant keys; a mount that passes plain `wiredHelpers` keeps the UNSCOPED
   gate and therefore refuses every host. UNBOUND IS THE SAFE DEFAULT AND THE DELIBERATE ONE: a
   module nobody bound refuses hosts, which is a complaint somebody can make, where a module bound
   to the wrong key admits a host silently. Keys come from BT_MODULES' own `pages` lists — the
   module that owns the admin screen the routes serve — and `staff_gate_wiring.test.mjs` pins every
   line below in BOTH directions, so a new mount with no decision is a red test rather than a
   default. Core stays unbound by design: admin (users and roles), orgs, security, sandbox. */
wire({ ...wiredHelpers, requireStaff: staffGateFor("tournaments"), ensureEventSquareItem }); // D-34 — patchEvent prices events now, so it is K-15's third writer; injected exactly as events_admin gets it (a direct import would cycle the same way)
wireRegistrations({ ...wiredHelpers, requireStaff: staffGateFor("registrations") });
wireAdmin(wiredHelpers); // CORE — users and roles. Unbound: a host must never manage accounts.
wireSchedule({ ...wiredHelpers, requireStaff: staffGateFor("tournaments", "leagues") }); // the schedule editor has TWO owners in BT_MODULES; either key passes
wireEventsAdmin({ ...wiredHelpers, requireStaff: staffGateFor("events"), sendEmail, escapeHtml, ensureEventSquareItem }); // B16 — sendEmail injected, waitlists precedent, no cycle; K-15 — the Square writer injected the same way (a direct import would cycle: events_admin ← tournaments ← registrations ← memberships)
wireProfiles(wiredHelpers); // unbound — its staff routes are season-points seeding, which owns no menu module
wireWebauthn(wiredHelpers);
wireLeagues({ ...wiredHelpers, requireStaff: staffGateFor("leagues") });
wireReports({ ...wiredHelpers, requireStaff: staffGateFor("reports") });
wireCheckin({ ...wiredHelpers, requireStaff: staffGateFor("registrations") });
wireMemberships({ ...wiredHelpers, requireStaff: staffGateFor("memberships") });
wireSandbox(wiredHelpers); // CORE — S-2a's rescue link lives here. Unbound: closed to hosts by construction.
wireFacility({ ...wiredHelpers, requireStaff: staffGateFor("facility") });
wireSecurity(wiredHelpers); // CORE — the audit surface.
wireMemberPortal(wiredHelpers);
wireMarketing({ ...wiredHelpers, requireStaff: staffGateFor("marketing") });
wireMessages({ ...wiredHelpers, requireStaff: staffGateFor("marketing") });
wirePos({ ...wiredHelpers, requireStaff: staffGateFor("pos") });
wireWaitlists({ ...wiredHelpers, requireStaff: staffGateFor("registrations"), sendEmail, escapeHtml }); // sendEmail injected — no circular import
wireSubs({ ...wiredHelpers, requireStaff: staffGateFor("leagues"), sendEmail, escapeHtml }); // v0.38.0 — same injection pattern
wireKiosk(wiredHelpers); // v0.39.0 — no requireStaff call sites, so there is no gate to bind
wireFaq({ ...wiredHelpers, requireStaff: staffGateFor("library") }); // v0.40.0
wireSms({ ...wiredHelpers, requireStaff: staffGateFor("marketing") }); // v0.42.0 — fails closed until TWILIO_* secrets exist
wireLfg(wiredHelpers); // v0.45.0 — unbound: community moderation owns no menu module
wireAnnouncements({ ...wiredHelpers, requireStaff: staffGateFor("announcements") }); // v0.50.0
wireMemberFields({ ...wiredHelpers, requireStaff: staffGateFor("memberships") }); // v0.57.0
wirePasses({ ...wiredHelpers, requireStaff: staffGateFor("memberships") }); // v0.58.0
wireStaffPay({ ...wiredHelpers, requireStaff: staffGateFor("staffpay") }); // v0.58.0
wireTryouts({ ...wiredHelpers, requireStaff: staffGateFor("tryouts") }); // v0.60.0
wireFormats({ ...wiredHelpers, requireStaff: staffGateFor("tournaments") }); // v0.62.0
wireBrackets({ ...wiredHelpers, requireStaff: staffGateFor("tournaments") }); // v0.66.0
wireKotc({ ...wiredHelpers, requireStaff: staffGateFor("kotc") });
wireDivisions({ ...wiredHelpers, requireStaff: staffGateFor("tournaments") }); // v0.69.0
wireLive({ json }); // v0.73.0 — read-only, so it needs nothing but json
wirePush(wiredHelpers); // v0.20.0 — unbound: /api/admin/push/test targets the caller's own devices
wireWaivers({ ...wiredHelpers, requireStaff: staffGateFor("waivers") }); // v0.22.0
wireCalendar(wiredHelpers); // v0.23.0 — unbound: it mints the ORG-WIDE public feed, an org-level setting
wireConsent(wiredHelpers); // v0.25.0 — unbound: media consent is compliance, not the waivers screen
/* tiers.js is the ONE bound module that also carries CORE routes — `/api/admin/org` (writes the
   org's timezone, which reaches every calendar emission) and `/api/admin/members/bulk` (exports the
   whole member CSV and writes tags across the directory). §-1q puts the members directory and org
   settings out of a host's reach, so those two routes take `requireCoreStaff` — the UNBOUND gate,
   passed only here — while tiers, grants and plans take the memberships binding. Measured
   2026-08-17: no other bound module carries a route outside its own module's concern. */
wireTiers({ ...wiredHelpers, requireStaff: staffGateFor("memberships"), requireCoreStaff: requireStaff }); // v0.26.0
wireFamily(wiredHelpers); // v0.27.0
wireDocuments({ ...wiredHelpers, requireStaff: staffGateFor("library") }); // v0.28.0
wireUploads({ ...wiredHelpers, requireStaff: staffGateFor("library") }); // v0.30.0
wireOrgs(wiredHelpers);    // v0.31.0 — CORE: the switch that turns modules back on.

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
  /* v0.107.0 (§-1f F-1) — the acting-role. NULL means "act with your real roles"; 'member' means
     this SESSION has voluntarily dropped to member. It is read once here so both predicates below
     see the same value, and so nothing downstream has to know it lives on the session row. */
  const actingRole = session ? (session.acting_role || null) : null;
  return { session, orgId, orgOk, userId, role, actingRole };
}

async function isStaff(env, ctx, orgId = ctx.orgId) {
  if (!ctx.session) return false;
  /* v0.107.0: the drop, honoured BEFORE the role lookup — the point is to refuse, and querying
     user_org_roles first would only spend a round trip to reach the same answer. Both this and
     admin.js's isAdmin must carry this check: honouring it in one alone leaves the other tier's
     routes open to a "member", which is the exact half-implementation
     authorization_matrix.test.mjs asserts against, per tier. */
  if (ctx.actingRole === "member") return false;
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

/* ══ staffGateFor — THE MODULE-BOUND STAFF GATE (v0.168.0, roadmap §-1q, build unit SG-3a) ══════
 *
 * WHAT IT IS FOR, in one sentence: a `host` is an admin of SOME screens and not others, and the
 * module axis is bound HERE, at the one mounting site, rather than at any of the ~180 gate calls.
 *
 * WHY AT THE MOUNT. Every routes-module receives `requireStaff` by injection (`wireXxx(helpers)`),
 * so binding the axis at the mount changes the gate's BEHAVIOUR without changing its SHAPE: the
 * arity is identical, every existing call site is untouched, and no caller can forget to pass the
 * axis — because no caller passes it. (That is the D-29/BT_SIGNUP lesson applied to gates: an
 * argument every one of 180 sites must remember is an argument one of them will not.)
 *
 * WHO PASSES, AND THE ORDER MATTERS:
 *   · admin  → passes. Unchanged, and provably so: the first thing this does is call the REAL
 *              `requireStaff`, so the admin/staff path is not a re-implementation of it.
 *   · staff  → passes, UNSCOPED. Deliberate. Nobody holds `staff` (live D1: zero staff rows have
 *              ever existed), and it stays the tier that sees everything.
 *   · host   → passes ONLY with a live grant row for THIS org AND one of THIS mount's keys.
 *              Otherwise 403 carrying its own sentence, which names the module and the org so the
 *              refusal is actionable rather than a generic denial.
 *   · anyone else → the original refusal, byte for byte. A member's 403 must not change wording
 *              because hosts now exist.
 *
 * REVOKING ONLY EVER NARROWS, and it is structural rather than careful. A host is not staff
 * (`isStaff` recognises only admin and staff — the line above), so removing every grant leaves a
 * host passing nothing; there is no path by which losing a grant widens anyone into a higher tier.
 * A grant is also required to be held by a HOST: a grant row on a member account grants nothing,
 * so the mechanism cannot be entered sideways.
 *
 * CORE MODULES HAVE NO KEY AND KEEP THE UNBOUND GATE — orgs, security, sandbox, users, admin. A
 * host reaches none of them however many grants they hold, so S-2a's rescue link (which in keyless
 * sandbox mode returns a working sign-in link for any account to the caller) is closed to hosts BY
 * CONSTRUCTION and stays open to the staff tier. `staff_gate_wiring.test.mjs` asserts that in both
 * directions, because a bound gate that is defined and never wired is the failure this ships
 * silently. */

/** The caller's role in ONE org, honouring the F-1 privilege drop.
 *
 *  A SECOND READ RATHER THAN A REFACTOR OF `isStaff`, ON PURPOSE. `authorization_matrix`'s NC-F1
 *  and NC-F2 assert that the acting-role check appears inside `isStaff`'s OWN body; making isStaff
 *  delegate to this would blind two negative controls in order to save one round trip. The read
 *  only happens after `requireStaff` has ALREADY refused, so admin and staff never pay for it and a
 *  host pays one extra query on a tier that has no holders yet. */
async function roleFor(env, ctx, orgId) {
  if (!ctx || !ctx.userId) return null;
  if (ctx.actingRole === "member") return "member";
  const row = await env.DB.prepare(
    "SELECT role FROM user_org_roles WHERE user_id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(ctx.userId, orgId).first();
  return row ? row.role : null;
}

/** Does this account hold a LIVE grant for ANY of these modules in THIS org?
 *  `deleted_at IS NULL` is the whole revocation model, and migration 0051's partial unique index on
 *  exactly these columns is this query's index. Keys reach here already validated against
 *  MODULE_KEYS (see staffGateFor), and are bound as values regardless. */
async function hasModuleGrant(env, userId, orgId, keys) {
  if (!userId || !keys.length) return false;
  const marks = keys.map((_, i) => `?${i + 3}`).join(",");
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM user_module_grants
      WHERE org_id = ?1 AND user_id = ?2 AND module_key IN (${marks}) AND deleted_at IS NULL
      LIMIT 1`
  ).bind(orgId, userId, ...keys).first();
  return !!row;
}

/** The menu's own words for these keys — "Tournaments or Leagues" for a two-owner screen. The
 *  refusal has to name the module the way the operator saw it when they granted it. */
function moduleNames(keys) {
  const names = keys.map((k) => MODULE_LABELS[k] || k);
  return names.length < 2 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** A gate bound to one or more module keys. A mount with TWO keys mirrors P-1's own rule for a
 *  screen with two owners — it hides only when EVERY owner is off, so holding EITHER key passes. */
function staffGateFor(...keys) {
  /* FAIL AT BOOT, NOT AT REQUEST TIME. A mistyped key would otherwise build a gate that refuses
     every host forever, naming a module that does not exist, and nothing would report it until
     somebody was locked out of a screen they had been granted. This runs at module scope, so a bad
     key is a dead worker the suite catches long before a deploy. */
  const unknown = keys.filter((k) => !MODULE_KEYS.includes(k));
  if (!keys.length || unknown.length) {
    throw new Error(`staffGateFor: not a module key: ${JSON.stringify(unknown.length ? unknown : keys)}`);
  }
  return async function requireStaffForModule(env, ctx, orgId = ctx.orgId) {
    const refusal = await requireStaff(env, ctx, orgId);
    if (!refusal) return null;                        // admin or staff — the unscoped tier, unchanged
    if (refusal.status !== 403) return refusal;       // 401 "Sign in first." — nothing to widen
    if (ctx.actingRole === "member") return refusal;  // the F-1 drop binds every tier, hosts included
    if ((await roleFor(env, ctx, orgId)) !== "host") return refusal;
    if (await hasModuleGrant(env, ctx.userId, orgId, keys)) return null;
    const org = await env.DB.prepare("SELECT name FROM orgs WHERE id = ?1").bind(orgId).first();
    const where = org && org.name ? org.name : "this organization";
    return json({ error: `Your account doesn't include ${moduleNames(keys)} for ${where}.` }, 403);
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      // The earliest exit — it returns before the router and is the easiest one to forget.
      return applySecurityHeaders(new Response(null, { status: 204, headers: cors }));
    }

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
      } else if (url.pathname === "/api/me" && request.method === "PATCH") {
        res = await updateOwnDisplayName(request, env);
      } else if (url.pathname === "/api/auth/act-as" && request.method === "POST") {
        /* v0.107.0 (§-1f F-1) — enter or leave "acting as a member".
           GATED ON A SESSION, NEVER ON A ROLE, and it sits here beside /api/me rather than in the
           admin chain for exactly that reason: an escape hatch gated by the privilege it clears is
           a lockout. An admin who dropped could not undrop, and would wait out the session.
           There is no privilege check because there is no escalation to prevent — the only thing
           this route can do is REMOVE your own privileges for your own session, or give you back
           what user_org_roles already says is yours. */
        res = await actAs(request, env);
      } else if (url.pathname === "/api/orgs" && request.method === "GET") {
        /* v0.106.0 — roadmap §-1e S-1b, CLOSED. This enumerated `id, name, slug, logo_url,
           brand_json` for EVERY active org to anyone who asked. It was left open on the reasoning
           that a sign-in surface needs org branding before anyone has a session — the owner's
           per-org branding answer is real, but that inference was wrong: `/api/public/org-brand`
           (below) has served exactly one org, by id or slug, cached, since v0.50.0, and §-1f F-3
           now uses it. Both real callers of THIS route are signed-in surfaces — `admin-nav.js:627`
           pairs it with `guard()`, and `app.js`'s dashboard runs only after `/api/me` succeeds —
           so a session check breaks nobody. A SESSION is the bar, not a role: the org switcher
           must still list orgs for a plain member. login_brand.test.mjs asserts both directions,
           and that org-brand stays public. */
        const session = await currentSession(request, env);
        res = session ? await listOrgs(env) : json({ error: "Sign in first." }, 401);
      } else if (url.pathname === "/api/health") {
        res = json({ ok: true, version: "v0.176.0" });
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
        const ctxFail = !ctx.orgOk && json({ error: "That organization isn't available." }, 404); // F-11 (v0.30.0) — fail closed before any route sees ctx
        if (ctxFail) {
          res = ctxFail;
        } else {
          /* ROUTE DISPATCH — ONE TABLE, EACH MODULE ISOLATED (v0.77.0).
             Owner 2026-08-03: "If modules fail, do not let it break or stop the system, simply allow
             it process as best as possible."

             Until v0.76.0 this was a 42-long `||` chain in one try/catch. A chain asks every module
             "is this path yours?" in order, so a module that THREW WHILE DECLINING a path it does not
             own took down every module listed after it — a fault in `uploadRoutes` (first in the list)
             meant no brackets, no live board, no check-in, and a bare `500 Server error` that named
             nothing. `dispatch` records the throw, treats it as a decline, and carries on: a module
             that cannot decide whether a path is its own does not get a veto over the other 41.

             THE ORDER IS LOAD-BEARING and is preserved exactly as the chain had it. Two modules can
             match overlapping paths; the earlier one wins, as before.

             WHAT IS NOT ISOLATED, deliberately: `buildCtx` and the F-11 org check above, which run
             before any route sees `ctx`, and `requireStaff`, which returns a 403 Response rather than
             throwing — so it is a value on the success path and cannot be swallowed by an error path.
             A failure may cost information. It may never cost permission. See `resilience.js`. */
          const table = [
    ["upload",        uploadRoutes],                        // v0.30.0 — generic org-scoped file uploads
    ["document",      documentRoutes],                      // v0.28.0 — documents, versions, requirements, compliance
    ["waiver",        waiverRoutes],                        // v0.22.0 — /api/waiver/* + /api/admin/waivers/*
    ["calendar",      calendarRoutes],                      // v0.23.0 — feed token mint/revoke
    ["consent",       consentRoutes],                       // v0.25.0 — /api/sign/* + waiver links + media consent
    ["org",           orgRoutes],                           // v0.31.0 — org profile, entity verification, reactivation
    ["tiers",         tiersRoutes],                         // v0.26.0 — tiers, grants, bulk members
    ["family",        familyRoutes],                        // v0.27.0 — age gate, families, age-out
    ["marketing",     marketingRoutes],
    ["messages",      messagesRoutes],
    ["pos",           posRoutes],
    ["push",          pushRoutes],
    ["waitlist",      waitlistRoutes],
    ["webauthn",      webauthnRoutes],
    ["security",      securityRoutes],
    ["memberPortal",  memberPortalRoutes],
    ["subs",          subsRoutes],                          // v0.38.0 — league sub finder
    ["kiosk",         kioskRoutes],                         // v0.39.0 — kiosk check-in (req #20)
    ["faq",           faqRoutes],                           // v0.40.0 — Help & FAQ (req #21 phase 1)
    ["sms",           smsRoutes],                           // v0.42.0 — SMS phase 3 (req #17)
    ["lfg",           lfgRoutes],                           // v0.45.0 — LFG & community play
    ["announcements", announcementsRoutes],                 // v0.50.0 — R3 member home feed + announcements
    ["memberFields",  memberFieldsRoutes],                  // v0.57.0 — M22 membership custom-field registry
    ["passes",        passesRoutes],                        // v0.58.0 — pass/credit ledger
    ["staffPay",      staffPayRoutes],                      // v0.58.0 — staff rates + shift pay
    ["tryouts",       tryoutsRoutes],                       // v0.60.0 — tryout cards, evaluations, team builder
    ["formats",       formatsRoutes],                       // v0.62.0 — pool schedule generator
    ["bracket",       bracketRoutes],                       // v0.66.0 — playable brackets (seed, byes, advance)
    ["division",      divisionRoutes],                      // v0.69.0 — divisions, court ranges, balance proposals
    ["kotc",         kotcRoutes],                          // v0.80.0 — KOTC: entry list, per-player links, confirm-or-edit
    ["live",          liveRoutes],                          // v0.73.0 — public scoreboard, no login
    ["league",        leagueRoutes],
    ["report",        reportRoutes],
    ["checkin",       checkinRoutes],
    ["membership",    membershipRoutes],
    ["sandbox",       sandboxRoutes],
    ["facility",      facilityRoutes],
    ["profile",       profileRoutes],
    ["schedule",      scheduleRoutes],
    ["eventsAdmin",   eventsAdminRoutes],
    ["admin",         adminRoutes],
    ["tournament",    tournamentRoutes],
    ["registration",  registrationRoutes],
          ];
          const { response, failures } = await dispatch(table, [request, env, url, ctx],
            (name, err) => console.error("route module failed: " + name, err));

          if (response) {
            res = response;
          } else if (failures.length) {
            // Nothing handled it AND something broke. That is not a 404 — a 404 would tell the caller
            // the route does not exist, when in fact the module that owns it is down. Name it.
            res = json({
              error: failures.length === 1
                ? "Something went wrong handling that request. It has been logged."
                : "Something went wrong handling that request. It has been logged.",
              failed_modules: failures.map((f) => f.module),
            }, 500);
          } else {
            res = json({ error: "Not found" }, 404);
          }
        }
      } else {
        res = json({ error: "Not found" }, 404);
      }
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return applySecurityHeaders(res);
    } catch (err) {
      console.error(err);
      const res = json({ error: "Server error" }, 500);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return applySecurityHeaders(res);
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
  // S-3b flood band. One human sentence, identical whether the address has an account or
  // not — a distinguishable 429 would be the user-enumeration oracle requestLink avoids.
  const addr = email.toLowerCase();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM magic_links WHERE email = ?1 AND created_at >= datetime('now', ?2)"
  ).bind(addr, `-${MAGIC_LINK_TTL_MIN} minutes`).first();
  const today = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM magic_links WHERE email = ?1 AND created_at >= datetime('now','-1 day')"
  ).bind(addr).first();
  if (overFlood(recent.n, LINKS_PER_WINDOW) || overFlood(today.n, LINKS_PER_DAY)) {
    return json({ error: "Several sign-in links were just requested for this address. Wait a few minutes and use the newest link you have — it still works." }, 429);
  }

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
    // `totp_enabled` was carried here and read by nothing (measured across web/ and worker/test/).
    // Dead data in a response is where the next reader's wrong belief comes from — and this column
    // produced exactly that on the admin Users screen. The real factor is counted below.
    "SELECT id, email, display_name, default_org_id FROM users WHERE id = ?1 AND deleted_at IS NULL"
  ).bind(session.user_id).first();
  const roles = (await env.DB.prepare(
    "SELECT org_id, role FROM user_org_roles WHERE user_id = ?1 AND deleted_at IS NULL"
  ).bind(session.user_id).all()).results;
  const passkeys = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?1 AND deleted_at IS NULL"
  ).bind(session.user_id).first();
  return json({ user, roles, passkeys: passkeys.n });
}

/* B2 / K-11(ii), v0.130.0 — a member sets their OWN display name. This is the FIRST writer of
   users.display_name for an existing account: re-measuring K-11 found that addUser sets the name
   only when it INSERTS a new user and silently discards it otherwise (§-1c D-27), so the column
   had been unwritable for everyone since it was born. Session-gated beside /api/me, and the
   session IS the target — no id is ever read from the body, which is what makes "rename someone
   else" structurally impossible rather than merely refused. D-18 boundary, decided here and
   pinned by the guard: this never touches contacts.full_name — the display name is account
   presentation (greetings, what a passkey registers under); full_name is the identity spine two
   resolvers already disagree about, and members already edit it on the Profile page. */
async function updateOwnDisplayName(request, env) {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Sign in first." }, 401);
  const b = await request.json().catch(() => ({}));
  if (typeof b.display_name !== "string") return json({ error: "Send your display name as text." }, 400);
  if (b.display_name.length > 80) return json({ error: "Keep your display name under 80 characters." }, 400);
  const next = b.display_name.trim() || null; // whitespace clears to NULL, never an empty string —
                                              // "" is truthy enough to blank every (name || email) fallback
  const before = await env.DB.prepare(
    "SELECT display_name FROM users WHERE id = ?1 AND deleted_at IS NULL"
  ).bind(session.user_id).first();
  if (!before) return json({ error: "Sign in first." }, 401);
  await env.DB.prepare(
    "UPDATE users SET display_name = ?1, updated_at = datetime('now') WHERE id = ?2 AND deleted_at IS NULL"
  ).bind(next, session.user_id).run();
  await audit(env, null, session.user_id, "user.display_name.update", "user", session.user_id,
    { before: before.display_name, after: next });
  return json({ ok: true, display_name: next });
}

async function listOrgs(env) {
  const orgs = (await env.DB.prepare(
    // F-11 (v0.30.0): the switcher offered all ten. Migration 0021 was invisible until this line.
    // v0.128.0 (P-1): modules_off rides along because the admin rail filters itself from THIS
    // payload — the one fetch admin-nav.js already makes. It is navigation config, never
    // permission (org_modules.test.mjs pins that a hidden module's routes answer unchanged), so
    // exposing it to any signed-in session reveals nothing a menu would not.
    "SELECT id, name, slug, logo_url, brand_json, modules_off_json FROM orgs WHERE active = 1 AND deleted_at IS NULL ORDER BY id"
  ).all()).results;
  for (const o of orgs) {
    try { o.modules_off = JSON.parse(o.modules_off_json || "[]"); } catch { o.modules_off = []; }
    delete o.modules_off_json;
    if (!Array.isArray(o.modules_off)) o.modules_off = [];
  }
  return json({ orgs });
}

/* ---------- helpers ---------- */

/* v0.107.0 (§-1f F-1): set or clear this session's acting-role.
   `{ role: "member" }` drops; `{ role: null }` (or anything else) restores. Only 'member' is
   accepted as a drop target — an unrecognised value CLEARS rather than being stored, so a typo can
   never park the session in a role that no predicate understands and that nothing can clear. */
async function actAs(request, env) {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Sign in first." }, 401);
  const b = await request.json().catch(() => ({}));
  const role = b && b.role === "member" ? "member" : null;
  await env.DB.prepare("UPDATE sessions SET acting_role = ?1 WHERE id = ?2").bind(role, session.id).run();
  return json({ ok: true, acting_role: role });
}

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
    // v0.107.0 (migration 0043): acting_role rides along here because this is the ONE place a
    // session is resolved. Selecting it anywhere else would mean a second query per request and a
    // second thing to forget.
    "SELECT id, user_id, acting_role FROM sessions WHERE token_hash = ?1 AND revoked_at IS NULL AND expires_at > datetime('now')"
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
    /* EVERY METHOD THE ROUTER ACCEPTS MUST BE ADVERTISED HERE (v0.115.0). This read
       "GET,POST,OPTIONS" while the worker routed 45 handlers on PATCH, PUT and DELETE across more
       than twenty modules. A cross-origin DELETE is preflighted; the browser read this header, did
       not find DELETE, and refused the request LOCALLY — so `api()`'s catch fired and told the
       owner "Can't reach the server. Check your connection", which was false in every particular.
       Every Delete button and most Edit actions in the product were dead in a real browser.

       No test could see it by exercising routes: the suite calls the worker directly and never
       performs a preflight. `cors_methods.test.mjs` therefore EXTRACTS the routed methods from the
       modules and asserts this string covers them, so the two can never drift apart again. */
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Org-Id",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

/* v0.118.0 — §-1i S-3c. Five security headers on EVERY response this worker returns.

   THE PLACEMENT IS THE CONTROL: these are applied at the fetch egress — the same choke point
   that merges CORS — not inside json(), because json() never sees the avatar bytes, the three
   CSV exports, the ICS feeds, the SMS TwiML, or marketing's unsubscribe page (the only HTML
   this worker serves, and therefore the surface that needs CSP most). A json()-level version
   would report the API armoured while exactly those paths went out bare.

   SET-IF-ABSENT: a module that sets its own header keeps it. uploads.js serves user-uploaded
   bytes under a deliberately different CSP (sandboxed, img/style allowances for viewing);
   marketing's page needs style-src for its inline styles. Overwriting either here would break
   a control that is already right. security_headers.test.mjs asserts both directions.

   The CSP is an API posture (default-src 'none') — nothing this worker returns should load
   subresources or run script when a browser renders it directly. GitHub Pages serves the app's
   HTML; its headers are not settable from here, and a page-side <meta> CSP is a separate,
   deliberate decision — not bolted on with this change. */
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function applySecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!res.headers.has(k)) res.headers.set(k, v);
  }
  return res;
}

/**
 * `no-store` is the right default and stays the default: almost every response here is scoped to one
 * signed-in person, and a cached copy of somebody else's data is the worst sort of bug.
 *
 * v0.73.0 adds `extra` so the public live board can opt into a short cache. Additive — every existing
 * caller passes two arguments and behaves exactly as before — and opt-in per response, rather than a
 * second json() that would eventually drift from this one.
 */
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
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
