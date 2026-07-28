# Boomtown Platform — CHANGELOG

## v0.1 — 2026-07-21 (Module 1: Foundation)
- Created D1 database `boomtown-prod` (WNAM) via Cloudflare MCP.
- Applied migration 0001: 23 tables, org_id + soft-delete everywhere, audit_log; seeded 3 orgs. Verified live.
- Worker API v0.1: magic-link auth (15-min single-use, hashed tokens), 30-day sessions (cookie + Bearer), first-user-becomes-admin bootstrap, roles, /api/orgs, audit logging, Brevo adapter with sandbox fallback.
- Frontend shell v0.1: spec §4 tokens (dark black/gold default, light white/navy), theme toggle, org switcher (2 clicks), login + dashboard, emil-design-eng motion rules, WCAG focus states, 44px targets, reduced-motion support.
- CI: GitHub Actions worker auto-deploy (needs CLOUDFLARE_API_TOKEN secret).
- Known gaps → v0.2: admin TOTP enforcement; real email (Brevo key); org-switch server-side role gating on future endpoints.

## v0.2 — 2026-07-21 (Module 3: Tournament Engine)
- Scheduler engine (worker/src/scheduler.js): format templates (7-on-3, 10-on-4, 11-on-5, 8/9-on-4, 4-on-2x2), feasibility pre-check with one-tap fixes, circle-method partial round-robin, court packing at optimal round counts, byes balanced ±1, ref rotation from byes, standings (wins → diff → head-to-head), A/BB brackets with best-of-3 21-21-15 semis/finals.
- Test suite (worker/test/scheduler.test.mjs): all formats assert no-rematch, no double-booking, bye spread ≤1, optimal rounds, tiebreaks, seeding. ALL PASSING.
- API (worker/src/tournaments.js): events CRUD, bulk team add, schedule generate (score-wipe protection), drag-edit PATCH with live warnings, 2-tap score endpoint, standings materialization, bracket break. Role-gated per org; audit-logged.
- UI (web/tournament.html/.css/.js): create-from-template ≤10 clicks, paste-in teams, feasibility banner with fix buttons, Court×Round grid with bye/work column, HTML5 drag-and-drop with amber warnings, bottom-sheet 2-tap scoring, standings table, bracket button, print pool sheet, CSV export.
- Feature addendum doc: commercial-parity backlog vs volleyballlife/gymdesk/mindbody.

## v0.3.0 — 2026-07-21 (Module 4: Registration + Square sandbox + captain self-scoring)
- Migration 0002 (applied live via MCP, additive only): events.price_cents, teams.score_token, registrations.checkout_url, registrations.last_reminded_at.
- API (worker/src/registrations.js): public event form endpoint (base §3.2 field set + admin custom fields), registration submit (contact find-or-create, annual e-signed waiver, team + teammates, idempotent double-submit guard, hidden cash option enforced server-side, free events auto-comped), Square Payment Links (quick_pay, sandbox base URL by default, graceful sandbox mode when keys absent), HMAC-verified Square webhook flips pending → paid idempotently, staff unpaid list + 1-click reminder (Brevo or copyable sandbox link) + cash mark-collected, Google Forms CSV import (≤500 rows, per-row skip report), captain score links + token-gated 2-tap scoring endpoint that reuses refreshStandings.
- worker/src/index.js v0.3.0: mounts registration routes + /api/webhooks/square (pre-auth, signature-verified); health reports v0.3.0. tournaments.js v0.3.0: exports refreshStandings (only change).
- UI: web/register.html+register.js (public form, Square redirect, a11y labels), web/admin-registrations.html+js (status chips, filters, remind ≤3 clicks, CSV import with header auto-mapping, captain score-link copier, registration-link copier), web/score.html+score.js (captain 2-tap scoring, 52px thumb targets).
- Debt cleared: tournament.js network-failure + stale-config guards (matching app.js v0.2.4); tournament.html cache-busted to ?v=0.3.0 and links to Registrations admin.
- Verified: node --check on all 7 JS files, full scheduler test suite passing, worker imports cleanly.
- NOT included (later): waiver text is a PLACEHOLDER (admin must supply official text), admin TOTP, Card-on-File, SMS notify, Brevo key.

## v0.3.1 — 2026-07-22 (Root redirect)
- Added root index.html: `https://10xequity.github.io/btplatform/` now redirects to `/web/` instead of showing GitHub's 404 page.
- No app-code changes. Module 4 (v0.3.0) verified fully deployed: all 14 files at correct paths in commit 3c00990; GitHub Pages build+deployment and Deploy Worker actions both green.

## v0.4.0 — 2026-07-22 · Module 5 (Schedule) + System Admin Panel

**Database (migration 0003 — ALREADY APPLIED to live D1 by Claude, no action needed):**
- `schedule_views` (public/internal built-ins + custom views), `event_templates`, `programs`
- `events` gains `series_id`, `program_id`, `recurrence_json` (recurring series support)

**Worker (auto-deploys on push):**
- `schedule.js` — public schedule feed `GET /api/schedule` with server-enforced view profiles (spec §3.7); views CRUD
- `admin.js` — user/role management (admin-only, last-admin safety guard), member (contact) management, permissions matrix
- `events_admin.js` — templates, duplicate, recurring series (weekly/biweekly/monthly, ≤52), "this-and-future" series edit/cancel, bulk create (CSV, ≤200 rows), bulk edit, per-event registrations CSV export, programs
- `index.js` → v0.4.0, mounts the three new modules

**Web app:**
- Admin panel with shared sidebar (`admin-nav.js` + `admin.css`): hover highlights, active section, mobile top-bar collapse
- `admin.html` dashboard · `admin-events.html` calendar with drag-and-drop create/reschedule, template palette, recurring, bulk import/edit, Views & Embed tab · `admin-event.html` per-event screen (details, publish/cancel, duplicate, save-as-template, series editing, sign-up link, registrations with remind/mark-paid, CSV download) · `admin-users.html` members + admins & roles + role capability matrix
- `schedule.html` public schedule (list + month) · `widget.js` embeddable widget for boomtownvb.com / coloradoboom.com
- `tournament.html` / `admin-registrations.html` retrofitted with the sidebar

**Known limits (deliberate, small):** event times are stored as entered (no timezone math) — fine while everything is in Colorado; recurring monthly = same day-of-month; bulk import caps at 200 rows per upload.

## v0.5.0 — 2026-07-22 · Module 6: Member Profiles + Family Accounts + Passkeys

**Database (migration 0004 v1.1 — ALREADY APPLIED live by Claude, never run it):**
- `member_profiles` (avatar key, Instagram, bio, DOB, visibility, reminder opt-in w/ consent timestamp)
- `guardianships` (parent↔child, active/ended, aged_out tracking) · `signatures` (shared on-behalf ledger — waivers now, Module 7 contracts later)
- `season_points` (seeding materialized from standings — standings stay the only score source)
- `webauthn_credentials` + `webauthn_challenges` (passkeys)

**Worker (auto-deploys on push; health → v0.5.0):**
- `profiles.js` (NEW): profile CRUD (self or own child only), R2 avatar upload (mime+size validated, keys-not-blobs), results résumé + totals from standings history, upcoming events, public visibility-gated profile, ICS export (America/Denver VTIMEZONE), reminder opt-in, family (add child → private-by-default minor profile; guardian waiver signing writes waivers + signatures with `signed by X for Y, age Z`; remove child; 18th-birthday handover: sets their email, ends guardianship, magic-links them in — history follows contact_id), seeding recompute + ranked list (staff; formula win=10, podium +50/+30/+20 in one tunable function)
- `webauthn.js` (NEW): Face ID / fingerprint sign-in — ES256 + RS256, attestation "none", single-use 5-min challenges, rpId = 10xequity.github.io, signature-counter clone protection. **Supersedes the TOTP plan.**
- `index.js` v0.5.0: mounts both modules; extracts shared `sendLoginLink` / `issueSession`; `/api/me` reports passkey count
- `wrangler.toml` v0.5.0: R2 binding `AVATARS` → bucket `boomtown-avatars` (**create bucket before deploying**)

**Web app:**
- `profile.html`/`profile.js` (NEW): member hub — avatar with crop (Cropper.js 1.6.2, CDN), edit profile, share link, upcoming events + Add-to-calendar + reminder toggle, results résumé, family panel (add child, scroll-gated guardian signing, per-child photo, hand-over-account at 18), passkey enrollment card. Design-system v1.0 tokens/motion; ux-copy v1.0 wording; 44/52px targets; reduced-motion safe.
- `member.html`/`member.js` (NEW): public shareable profile (first name + last initial, optional IG/bio/results)
- `index.html` v0.5.0 + `assets/passkey.js` (NEW): "Sign in with Face ID / fingerprint" button on the login card (progressive enhancement; email link untouched)

**Verified:** node --check on all 6 JS files; passkey byte-parsing tests 7/7; D1 pre/post-checked; repo scanned at v0.4.0 before build; Cropper.js CDN URLs verified live.

**NOT included (v0.5.1):** the reminder email cron (toggle + consent are live; the scheduled sender is not), seeding admin UI (API is live), dashboard Profile link. Waiver text remains PLACEHOLDER in register flow + profile.js.

## v0.6.0 — 2026-07-23 (Navigation, Member/Manager Login, Leagues area, Settings)
**Frontend-only (no worker changes, no migrations).** UX references: gymdesk (persistent rail, first-class settings), volleyballlife (leagues as their own section, one-tap home). Analysis: docs/2026-07-23_usecase-analysis-nav_v1.0.md.
- `assets/site-nav.js` (NEW v1.0): role-aware site-wide sidebar on every member/public page, mirrors the Tournament Ops rail; horizontal scroll bar on phones; auto-skips `?embed=1`; self-contained styles (tokens only).
- `assets/app.js` v0.6.0: sign-in card gains **Member | Manager** tabs (manager copy points to passkeys; choice remembered); dashboard rebuilt — every card clickable: Schedule, Tournaments, **Leagues**, My Profile, **Member Management** (staff), Registrations (staff), **Settings**, **Foundation → Settings#System** (staff). Central-card layout retained by request.
- `leagues.html` + `assets/leagues.js` (NEW v1.0): dedicated league area — In progress / Upcoming / Recent league events from `/api/schedule`, org filter, Register CTAs. Season standings + sub-finder land here in Phase 2.
- `settings.html` + `assets/settings.js` (NEW v1.0): Account (name/photo → profile editor; email = sign-in identity, change via staff), Sign-in & security (passkey list/add/remove — passkeys are password **and** 2FA in one gesture; email-link fallback), Appearance (theme), Reminders (24h email toggle), System (staff: members/roles, events, Foundation status).
- `assets/app.css` v0.6.0: **font-consistency fix** — global `input, select, textarea, button { font: inherit }` (source of the mismatched fonts in filters/date fields); login-tab + settings styles.
- `schedule.html` v0.6.0 / `profile.html` v1.1 / `member.html` v1.1 / `index.html` v0.6.0: explicit "← Home" button in every header + sidebar include; schedule content is now a proper `<main>`.
- `assets/admin-nav.js` v0.6.0: admin rail gains Home, Leagues Page, Settings.
- `db/2026-07-23_seed-testdata_v1.0.sql` (NEW): TEST-marked sample data (IDs 90000+, @example.com) — completed tournament w/ 4 teams, 6 scored games + standings, upcoming tournament w/ all 4 payment states, published league. CLEANUP block included. NOT applied yet.
- Deferred to v0.7 (worker): reminder-email cron, seeding admin UI, verified change-email flow, dashboard driven by live module status.

## v0.7.0 — 2026-07-23 (Module 8: Leagues, Sales, Notifications, Nav v2)
- Migration 0005 (db/2026-07-23_0005_leagues-notifications_v1.0.sql — additive only): events.staff_contact_id, teams.level_num, team_members.invited_at/reminded_at, notifications.contact_id/title/body/link/read_at, 2 indexes. **NOT yet applied to live D1 (Cloudflare MCP auth unavailable this session — apply per install doc §1).**
- League Manager (worker/src/leagues_admin.js + web/admin-league.html/.js): teams w/ 1–5 levels, weekly schedule generator — HARD rule: teams 2+ levels apart never play (outranks rematch avoidance); SOFT: rematches avoided until unavoidable; bye rotation; stranded-team feasibility check; score-wipe protection (409 + confirm). Week×Court grid with drag-and-drop moves, 2-tap scoring, live standings. Reuses tournament matches/standings/score endpoints.
- Sales & Reports (worker/src/reports.js + web/admin-reports.html/.js): per-program sortable summary, per-event table, revenue-by-month + revenue-by-event SVG bar charts, stat cards. Card revenue = Square COMPLETED payments; cash counted at event price.
- Member notifications: person-addressed inbox (GET /api/notifications, mark read / read-all), bell with unread badge top-right on every member page (site-nav v2.0).
- Registrations v0.4.0: teammate connect (existing members linked by email → in-app notification + dashboard history) / invite (non-members get a Brevo waiver invite); "Rerun payment" button + POST /api/registrations/:id/retry-payment (fresh Square idempotency key for card denials); register.js shows connected/invited summary.
- Cron (index.js scheduled() + wrangler.toml [triggers], daily 15:00 UTC ≈ 9am Denver): waiver-reminder sweep (unsigned roster members, max 1 email/48h) + 24h event reminders for opted-in members.
- Event staff assignment: "Assigned staff" select on the event screen (staff/admin users matched to their Members record); patchEvent accepts staff_contact_id.
- Nav v2.0 (site-nav.js) + admin nav v0.7.0: fixed left rail, identical spacing on every page, Boom logo (web/assets/logo.jpg), simple SVG stroke icons, collapse-to-icons toggle (persisted, shared member/admin), "← Back" via browser history on every page, regrouped menus (Run events / Money / People / Member site; Explore / My Boomtown / Manage), legacy "← Home" links hidden.
- Design fixes (tokens.css v0.2): global themed form controls — fixes white-on-white staff-add fields (root cause: v0.6.0 `color:inherit` on a white browser background) and white dropdown menus; brand-colored visited links (no purple); base text 17px.
- Member dashboard (web/home.html/.js): avatar/initials hero + waiver status, upcoming events, results with totals + ordinal finishes, notifications list, Phase-3 forum placeholder.

## v0.8.0 — 2026-07-23 (Module 9: Control Center + streamline pass)
- Dashboard API (worker/src/reports.js v1.1): GET /api/admin/dashboard — one call: month money (card COMPLETED + cash-paid), outstanding total + actionable unpaid list (12), 7-day registration trend, today/upcoming events w/ staff + reg counts, member count, admin alerts feed.
- Control Center (web/admin.html v0.8.0 + web/assets/admin-dash.js v1.0 NEW): manager home rebuilt on the industry-standard gym-dashboard pattern (Gymdesk pattern study — original code/copy/tokens): greeting + date, quick-action row, KPI row (Received this month / Outstanding / Members / Live events), Today & Next Up schedule with LIVE flag + staff + Open buttons, Money Outstanding list with inline Remind + Rerun payment, 7-day activity bar chart, Needs Attention feed. Old web/assets/admin.js no longer loaded by admin.html (file retained).
- Streamline pass (web/assets/admin.css v0.5.0): calmer density — 18px card padding, capped 1280px content width, single heading scale, lighter tables.
- Worker index.js v0.8.0 (health), wrangler.toml v0.8.0. No new migration — v0.8.0 runs on migration 0005 (still pending apply, see handoff).

## v0.9.0 — 2026-07-23 (Module 10: Check-in & Attendance)
- Migration 0006 (db/2026-07-23_0006_attendance_v1.0.sql — additive): attendance table (event/contact/team_member links, name_snapshot, method staff|self, soft-delete = undo) + events.checkin_token. Apply AFTER 0005.
- Worker (checkin.js NEW v1.0, index.js v0.9.0): GET /api/events/:id/roster (every roster member w/ waiver flag + check-in state + walk-ins + progress) · POST /api/events/:id/checkin (tap toggle) · checkin-walkin · checkin-token (mint/rotate) · public GET/POST /api/checkin/:token (email → roster match = linked check-in; no match = unverified w/ see-the-desk note; duplicate-safe) · GET /api/profile/attendance (member history).
- Door page (web/admin-checkin.html + assets/admin-checkin.js NEW v1.0): event picker (auto-selects today's event when unambiguous), big-tap roster grouped by team, NO WAIVER flags, tap = in / tap again = undo, live x/y progress, name search, walk-in modal, self-check-in QR panel (qrcodejs CDN) with copy link + rotate (kills old code).
- Self check-in (web/checkin.html NEW v1.0): single-file public kiosk page — QR target, email entry, big ✅/🙋 confirmation, offline-friendly error copy.
- Nav (admin-nav.js v0.8.0): Check-in item + door icon in Run events group.

## v0.9.1 — 2026-07-24 (Recovery: the v0.7.0 ZIP was never uploaded)
- **Why:** repo history shows v0.6.0 → v0.8.0 → v0.9.0; the v0.7.0 paste was skipped. index.js v0.9.0 imports `leagues_admin.js` and three `registrations.js` exports that therefore didn't exist — **every worker deploy since the v0.8.0 push failed** (Actions runs #5/#6), leaving the live API at v0.5.0 while the v0.8/v0.9 frontends shipped. This release rebuilds the lost files against the SAME live schema (migration 0005, applied 2026-07-23) and the v0.7.0 CHANGELOG spec.
- Worker (fixes the deploy): `leagues_admin.js` v1.1 NEW — League Manager: HARD rule teams >2 levels apart never play (stranded teams sit + get flagged), SOFT rematch avoidance, bye rotation by games played, week generate/remove (scored-week protection), standings via existing engine, staff-of-the-night assignment. `registrations.js` v1.2 — exports sendEmail/escapeHtml/waiverReminderSweep (cron: chases roster members on events in the next 14 days with no valid waiver, max 1 email/48h), POST /api/registrations/:id/retry-payment (fresh Square idempotency key — Control Center "Rerun"), teammate connect (/api/profile/connect-teams links roster rows by email) + invite (/api/team-members/:id/invite, captain or staff) + GET /api/profile/teams. `index.js` v0.9.1 (health string only).
- Web: `admin-league.html`+`assets/admin-league.js` v1.1 NEW (levels board 1–5, generate week, 2-tap scoring, standings, staff select — shared admin rail, menu now identical on every admin page; the League Manager nav link no longer 404s). `admin-reports.html`+`assets/admin-reports.js` v1.1 NEW (totals, month bars, program/event tables, CSV — Sales & Reports link no longer 404s). `home.html`+`home.js` v1.1 NEW (member dashboard: notifications inbox w/ mark-read, upcoming events + calendar links, teams w/ connect status + captain invites; auto-links rosters on load). `site-nav.js` v2.0 (My Dashboard + Notifications item w/ live unread badge). `tokens.css` v0.2.1 (recovered contrast fixes: themed form controls/dropdowns, brand visited links, 17px base).
- DB: no new migration. `db/2026-07-24_0005_leagues-notifications_v1.0.sql` added as a RECORD of the already-applied migration 0005 — do not run.
- Still lost with v0.7.0, not rebuilt (nothing references them): web/assets/logo.jpg (binary — re-upload manually if wanted), register.js connected/invited summary, event-screen staff select (staff is assigned from League Manager instead).

## v0.10.0 — 2026-07-24 (Module 11: Memberships & recurring billing)
- **DB:** migration 0007 applied live via Cloudflare MCP (additive only): `plans` + `subscriptions` tables + 3 indexes. Record file: db/2026-07-24_0007_memberships_v1.0.sql — do not run.
- **Worker:** `memberships.js` v1.0 NEW — admin plans CRUD (creating/saving a plan also creates the Square Catalog SUBSCRIPTION_PLAN + SUBSCRIPTION_PLAN_VARIATION; price changes mint a NEW variation so existing subscribers keep their price), member subscribe via Square payment link (`checkout_options.subscription_plan_id` = variation id — Square stores the card on file and renews on cadence, verified against Square docs 2026-07-24), cancel-at-period-end (owner decision D-M11-1 default), GET /api/admin/mrr. Webhook: `/api/webhooks/square` now enters via `membershipWebhook` — verifies the HMAC, handles `subscription.*` (upsert w/ customer-email matching to the member's pending checkout row) and `invoice.*` (payment_made → active, scheduled_charge_failed → past_due; Square auto-retries the card itself), and forwards `payment.*` to the untouched registrations handler. `index.js` v0.10.0 (import + route + health string). Sandbox-safe: without SQUARE_ACCESS_TOKEN, plans save locally and subscribe returns a friendly "billing not configured" message.
- **Web:** `membership.html` + `assets/membership.js` v1.0 NEW (member page: status banner incl. payment-issue + canceled-until states, plan cards w/ perks bullets, subscribe → Square checkout, cancel w/ confirm). `admin-plans.html` + `assets/admin-plans.js` v1.0 NEW (MRR/active/payment-issue cards, plan create/edit/hide, subscriber table — shared admin rail). `home.html`+`home.js` v1.2 (Membership card on My Dashboard). `site-nav.js` v2.1 (Membership item under "You"). `admin-nav.js` (Memberships under Money). `admin-dash.js` v1.2 (Control Center MRR KPI from /api/admin/mrr; skips silently on older workers). `admin.html` v0.8.1 (cache-bust only).
- **Deferred to Square-keys day (Phase-3 carryover list):** production SQUARE_ACCESS_TOKEN/SQUARE_LOCATION_ID/webhook key, subscribing to `subscription.*` + `invoice.*` event types in the Square Developer webhook settings, card_brand/last4 backfill (arrives on webhooks once live), member self-service card update link.

## v0.11.0 — 2026-07-24 (Module 11.5: UX & Navigation hardening + Sandbox tools)
- **Worker:** `sandbox.js` v1.0 NEW — staff-gated GET /api/admin/testdata (counts + seeded flag), POST /generate (inserts the standard TEST set: 8 contacts, 3 events, 4 teams, 6 scored games, 6 registrations — all IDs 90000–90999, names prefixed TEST, emails @example.com; refuses if already seeded), POST /wipe (deletes ONLY the 90000+ range plus attendance/checkins/pools/brackets referencing test events; reports rows removed). `index.js` v0.11.0 (wire + health string). No schema changes.
- **Admin rail (`admin-nav.js` v0.11.0):** collapse handle moved to the rail's SIDE edge (fixed-position pill at mid-height; was a bottom button — owner item 6) · every category collapses individually (chevron on the label, keyboard-accessible, state remembered per group in localStorage) · menu reordered for daily flow: Dashboard → Events & Programs → Registrations → Check-in → Tournament Ops → League Manager, then Money / People / Member site · new SANDBOX group: "View as member" + "Test data…" modal (generate/wipe with live counts, confirm before wipe) · `BT_ADMIN.fail(el,msg)` — standard error box with ← Back + Go to Dashboard + Reload, adopted by all future modules so no page dead-ends (owner item 6 standing rule).
- **Member nav (`site-nav.js` v2.2):** View-as-member demo mode — Sandbox button sets a session flag; member pages hide the Manage group and show a fixed "Viewing as member — Exit" pill (returns to Control Center); admin pages auto-bounce to home.html while the flag is on. Presentation only — the server role never changes, so no privilege boundary moves (owner item 4 safety note).
- **`404.html` NEW (repo root):** GitHub Pages now serves a branded not-found page with ← Back / Home / My Dashboard — navigation always returns (owner item 6).
- **Cache note:** existing pages reference site-nav/admin-nav with old ?v= strings; GitHub Pages serves the new file at those URLs within ~10 minutes (no mass repaste needed). New pages going forward use ?v=0.11.0.

## v0.12.0 — 2026-07-24 (Module 12 Phase A: Court & Facility Management)
- **DB:** migration 0008 applied live via Cloudflare MCP (additive only): `spaces` (13 courts VB 1–13 + 6 rooms), `space_presets` + `preset_spaces` (All Courts / Full Hardwood / Sports Court / 4 basketball overlays / Whole Facility), `space_bookings` (operator, date, minutes, Court Share flag, closure flag, staffing/catering/door-charge/POC/attendees/series/notes), `booking_spaces` (atom claims), 2 indexes. Also seeded 7 operator orgs (ids 4–10: Colorado Boom, Oda Up, RMR, Real Futsal, Special Olympics CO, Zara Gymnastics, External/Rental) and set `facility_color` in brand_json on all 10 orgs (decision D-M12-1). Record file: db/migrations/2026-07-24_0008_facility_v1_0.sql — do not run.
- **Worker:** `facility.js` v1.0 NEW — staff-gated GET /api/admin/facility/spaces (atoms + presets + operator colors) · GET /bookings?from&to · POST /check (conflict preview) · POST /bookings (single or weekly series with a 52-week cap; conflict-checks EVERY date before writing anything — never half-writes a series; `force:true` accepts share WARNINGS only, hard conflicts always block with a per-date problem list) · PATCH /bookings/:id (scope one | series = this + future, re-checked) · DELETE (soft, one/series) · POST /import (header-mapped CSV: required Date/Start/End/Title/Operator; recognizes Spaces/Booked As, Court Share, Staff, Bar, Catering, Door Charge, POC fields, Attendees, Notes, Closure; unknown columns ignored; per-row errors with line numbers; hard-conflict rows skipped and reported; dry_run preview). Conflict rule: date + time overlap + atom intersection = HARD; both sides Court Share → warning; closures always hard. `index.js` v0.12.0 (import + wire + route + health string).
- **Web:** `admin-facility.html` + `assets/admin-facility.js` v1.0 NEW — Facility Calendar on the shared admin rail: Day grid (spaces × 6:00–23:00, operator-colored blocks with hatched closures and "shared" tags, today line, empty-state CTA) + Week list (Mon–Sun cards); prev/today/next + date jump; booking modal (preset auto-checks atoms, Court Share + closure toggles, weekly repeat-until, collapsible staffing/catering/POC section, inline conflict panel with "Book anyway (shared)" for warnings only, series-aware save/delete); CSV import modal with mandatory dry-run preview before Import enables. No animation on grid navigation (daily-frequency rule); modal enters 200ms ease-out from scale(.97); 44px targets; focus-visible throughout. `admin-nav.js` v2.2 (Facility Calendar item in Run events).
- **Tests:** NEW worker/test/facility.test.mjs (8 passing: hard/share/closure/ignore conflict cases, 12h/24h time parse, ISO/US dates, preset/range/list space text, quoted-CSV parse) + live D1 conflict-SQL check (overlap detected on shared atom, clean on disjoint atom, test rows wiped). Full gate re-run: node --check all files · esbuild bundle (mirrors Actions) reports v0.12.0 · scheduler suite passing.
- **Phase B (next, v0.12.x):** tournament pools + league week slots auto-claim atoms; shipped separately so this paste never touches tournaments.js/leagues_admin.js.

## v0.13.0 — 2026-07-24 · M12 Phase B: Court auto-claim + rental requests
- Tournament schedule generation and league week generation now auto-claim courts on the facility calendar (`source='auto'` bookings, drag/edit/delete like any booking). Default courts VB 1..N; busy defaults move to the next open courts; response reports what was claimed/moved and any shortfall. Regenerating releases and re-claims; deleting a league week releases that week's claim. Claims never block schedule generation.
- Rental REQUEST feature (public self-serve rental stays hidden): signed-in members can `POST /api/rental-request`; staff see a pending-requests panel on the Facility calendar with preset picker + Approve/Decline; approval conflict-checks and books under org 10 (External / Rental).
- Migration 0009 (applied live 2026-07-24): `space_bookings.source` column + `rental_requests` table.
- Files: facility.js v1.1.0, tournaments.js v0.4.0, leagues_admin.js v1.2.0, index.js v0.13.0, admin-facility.html/.js v1.1.0, worker/test/facility_claim.test.mjs (10 tests). Validation gate: node --check ✓ · esbuild bundle reports v0.13.0 ✓ · 19/19 tests ✓ · live D1 spot check ✓.

## v0.14.0 — 2026-07-24 · M12.5 Member Portal & Agreements + M13 Security & Recovery
- **M12.5 (member_portal.js NEW, home.html/js v1.3.0):** My Dashboard gains a status strip (waiver chips for you + each child: signed-through date or "sign now" link), an **Agreements** card listing every waiver/document signed on the account (merged from the waivers table and the signatures ledger, guardian signings labeled, newest first, show-all expand), and a **Request court time** card — HIDDEN behind `BT_CONFIG.RENTALS_ENABLED=false` (config.js v0.3.0) per owner decision; when enabled it posts to the existing /api/rental-request.
- **M13 (security.js NEW, admin-security.html/js NEW, admin-nav.js v2.3):** Security & Recovery page under People — audit-log viewer (kind presets: sign-ins/deletes/money/facility/roles, search, id-cursor "Load older"), **Trash & restore** (soft-deleted events/teams/registrations/contacts/facility bookings/rental requests, one-click whitelist-only Restore — auth/security tables deliberately NOT restorable), **Lockout rescue** (admin issues a one-time sign-in link for a locked-out member; sandbox shows the link with Copy, Brevo mode emails it; always audited).
- No schema changes. index.js v0.14.0 wires both modules; health reports v0.14.0.
- Tests: worker/test/security_portal.test.mjs (6: whitelist safety incl. never-restorable auth tables, agreements dedup/sort/empty). Validation gate: node --check ✓ · esbuild bundle reports v0.14.0 ✓ · 25/25 tests ✓ · live D1 spot check (trash list, restore round trip, agreements SQL, log join) ✓.

## v0.18.0 — 2026-07-25 (M15: POS-lite, Promo Codes, Sponsors, Staff Shifts)
- NEW worker/src/pos.js v1.0: products CRUD, register sales (server-side pricing, per-line
  proportional discounts, basis-point tax, stock decrement with amber low-stock flag, void
  with restock), promo codes on the day-one `discounts` table (D-M15-1, +3 columns in
  migration 0012), sponsors (admin CRUD + public GET /api/sponsors), staff shifts CRUD.
  Square payments record as SANDBOX — no live charge (standing rule 1).
- worker/src/reports.js v1.2: R-02 attendance heatmap, POS sales report, R-05 shift coverage.
- worker/src/index.js v0.18.0: pos mounted after messages; health reports v0.18.0.
- NEW web/admin-pos.html + assets/admin-pos.js v1.0 (Sell / Products / Promo Codes /
  Sponsors / Shifts / Insights). web/assets/admin-nav.js v2.7: Point of Sale in Money group.
- db/migrations/2026-07-25_0012_pos_v1_0.sql applied live (additive only).
- Deferred to v0.18.1: balance-due chip on the check-in roster (Gymdesk pattern).

## v0.19.0 — 2026-07-25 · Waitlists
- **Capacity is now enforced at registration** (registrations.js v1.3): events with a
  capacity return 409 `{event_full, waitlist_available}` when full; `/api/events/:id/form`
  now reports `capacity` / `spots_taken` / `is_full`.
- **NEW worker/src/waitlists.js v1.0** — public join (dedup, live position), status check,
  staff queue view, "Offer next" + per-row offer (override) + remove; offers email an
  expiring claim link (48h default, 1–168h clamp) that admits the team through the
  capacity gate via `?wtoken=`; claims are recorded against the registration.
- **NEW staff cancel** `POST /api/registrations/:id/cancel` — frees the spot
  ('cancelled' was already in the day-one status CHECK) and auto-offers the next team.
  Refunds stay manual in Square (SANDBOX, rule 1).
- **Daily cron** adds `waitlistSweep` — expires stale offers, auto-offers the next team.
- **Web:** register.js v0.4.0 (full events show a Join-the-waitlist card; claim banner +
  token pass-through; graceful "filled while you typed" handling) · NEW
  admin-waitlists.html/js v1.0 (queue management) · admin-nav.js v2.8 (Waitlists item).
- **DB:** migration 0013 (waitlists table + 3 indexes) — applied live 2026-07-25.
- Tests 58 → 68 (waitlists.test.mjs). Emails ride the sandbox switch (rule 12).

## v0.20.0 — 2026-07-25 — PWA + Web Push
- **PWA:** `manifest.webmanifest` + `sw.js` (network-first shell cache; API never cached). Site installable to the home screen on Android and iPhone. Static tags on index/home/settings; every other page gets them injected by site-nav v2.5 / admin-nav v2.9.
- **Web Push (zero deps):** `worker/src/push.js` v1.0 — RFC 8291 aes128gcm encryption + RFC 8292 VAPID on WebCrypto. Routes: vapid-key (public), subscribe/unsubscribe/status (member), admin test-send (staff). Requires Worker secrets `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (+ optional `VAPID_SUBJECT`); without them everything no-ops safely.
- **Waitlists v1.1:** offer push sent alongside the offer email (deep-links to the ?wtoken= claim).
- **Settings v1.1:** push on/off toggle with iOS Add-to-Home-Screen hint (settings.js v1.1 + push.js client v1.0).
- **Cron:** daily `pushPruneSweep` — dead endpoints (404/410) soft-deleted immediately, chronic failures disabled, 30-day purge.
- **DB:** migration 0014 `push_subscriptions` (additive; applied live via Cloudflare MCP).
- Tests 29/29 locally (pos 12 · waitlists 10 · push 7 incl. full RFC 8291 encrypt→decrypt round trip).

## v0.21.0 — 2026-07-25 — M16 Optimization + QA
*(backfilled 2026-07-26 — this entry was missed at release)*
- **`Cache-Control: no-store` on every API response** (index.js v0.21.0). The browser's HTTP
  heuristic cache had served a stale `/api/health` after v0.20.0 went live; API JSON is now
  never cached. The service-worker static-shell cache is unaffected (D-PWA-3 holds).
- **Check-in shows money owed:** checkin.js v1.1 (`balanceCents()` / `OWED_STATUSES`; roster
  rows carry `reg_id`, `reg_status`, `balance_cents`) + admin-checkin.js v1.1 — owes-chip on
  the **team header** with tap-to-resolve via mark-paid (D-M16-2: per-team money, and player
  cards are `<button>`s, so nesting a button would be invalid HTML).
- **One-click mute:** messages.js v1.1 adds `POST /api/admin/messages/mute` + `/unmute`;
  flags carry `sender_muted` / `sender_contact_id`. Muting does **not** resolve the report
  (D-M16-3) — the review trail stays open. No migration: `member_mutes` already existed.
- **Core Web Vitals gate closed:** no images missing intrinsic size, no third-party JS on
  member pages, first-party shell 21–26 KB. Only fix needed was deferring blocking
  `qrcodejs` on the check-in kiosk.
- Nav/title polish: register.html + score.html gain site-nav; `·` → `—` in four page titles.
- Tests 87/87 (7 new balance · 6 new mute). No migration, no secrets, no new pages.

## v0.22.0 — 2026-07-26 — Waiver versioning
- **The waiver text is now a database record, not a hardcoded JS constant.** It previously
  lived only in `web/assets/register.js`, which made it impossible to tie a signature to the
  language actually shown. **NEW `worker/src/waivers.js` v1.0** owns it:
  public `GET /api/waiver/current` and `/api/waiver/versions/:id`, member `GET /api/waiver/mine`
  (returns `needs_resign`), staff `GET|POST /api/admin/waivers/versions`.
- **Every signature pins its version.** registrations.js v1.4 and profiles.js v1.3 write
  `waivers.version_id` (and `signatures.version_id` for guardian signings) resolved through
  `pinFor()` **before** any row is written. Publishing new text can never alter what an
  existing signature means.
- **Stale forms are refused, not accepted.** A form rendered against a superseded version
  submits to a `409 { waiver_stale:true }`; register.js v0.5.0 swaps in the new text, clears
  the tick and typed signature, and keeps everything else the person entered.
- **Material vs minor.** A version published with `material:0` (typo/formatting) does not
  prompt anyone to re-sign; the default is material, because an unspecified change is
  assumed substantive.
- **Concurrent publish is guarded at the database.** Partial unique index
  `ux_waiver_versions_active` permits one active version per org, so a simultaneous second
  publish fails its transaction and returns 409 instead of silently producing two live
  waivers. Published bodies are immutable — there is no edit or delete route by design, and
  `waiver_versions` is deliberately **excluded** from `RESTORE_WHITELIST` (same M13 rule as
  `waivers` / `signatures`; security_portal.test.mjs v1.1 now enforces it).
- **Web:** NEW admin-waivers.html + admin-waivers.js v1.0 (publish with a two-step confirm
  that names how many members will be asked to re-sign; read any past version's text) ·
  register.js v0.5.0 · admin-nav.js v2.10 (Waivers under People) · member_portal.js v1.1
  threads `version_id` into the agreements list.
- **DB:** migration 0015 — `waiver_versions` + `version_id` on `waivers` and `signatures`,
  with every pre-existing signature backfilled to a per-org `v1-legacy` row carrying the
  verbatim placeholder text those members actually saw. Never NULL.
- Tests 102/102 (17 new: publish normalization, re-sign rules, SHA-256, legacy labelling).

## v0.23.0 — 2026-07-26 (Waiver enforcement at the door + iCal calendar feeds + Aurora correction)
- **Migration 0016** (dry-run on a local sqlite replica per D-MIG-1, then applied live via Cloudflare MCP BEFORE the paste): `access_tokens` — one shared capability-token table serving the iCal feeds now and teammate waiver-sign links in v0.24.0. SHA-256 of the token is stored, never the raw value; the raw string is shown once at mint. Partial unique index `ux_access_tokens_public_cal` allows at most one live public feed per org, `ux_access_tokens_sha` makes hashes globally unique. `access_tokens` is deliberately excluded from `RESTORE_WHITELIST` (D-TOK-1) — undeleting a revoked bearer token is not a feature.
- **Waiver hard gate at check-in (D-WV-7).** Owner decision 2026-07-26: no participation without a current, unexpired waiver. Enforcement lives in `checkin.js`, not at registration, because teammates never register — the captain enters their name and email, so there is no teammate-side submit to block. Staff check-in and walk-in now return 409 `{ waiver_required: true }`; staff may proceed with a typed override reason of ≥8 characters, which is audited as `attendance.checkin.waiver_override` with the reason attached. The public self-check-in link has **no** override — a player cannot wave themselves through. Undoing a check-in is never gated.
- **T-30 waiver expiry notice (D-WV-8).** New `waiverExpirySweep()` in `registrations.js`, wired into the daily cron. Calendar-driven and distinct from the existing event-driven `waiverReminderSweep`. One notice per waiver row ever — dedupe is on `waiver_id` inside a `waiver_expiring` notifications row, not on a time window, because a 30-day window with a 48h dedupe would email the same member fifteen times. Anyone who has already re-signed is skipped.
- **iCal feeds (RFC 5545).** New `worker/src/calendar.js`. `GET /api/calendar/:token.ics` serves a member's own schedule or the org's public event feed. Member mint/rotate/revoke at `/api/profile/calendar`, staff public feed at `/api/admin/calendar`. Routed in `index.js` **before** the `/api/` chain and outside `json()` — since v0.21.0 `json()` stamps `Cache-Control: no-store` on every API response, and a no-store `.ics` makes every subscribed client refetch on every tick. The feed sets `max-age=900`, answers 304 on a matching `If-None-Match`, and throttles its `last_used_at` write to once an hour.
- **Cancelled events are emitted `STATUS:CANCELLED` with `SEQUENCE:1`, not dropped.** Removing a VEVENT does not remove it from a subscriber's calendar — it just stops updating, and the ghost sits there forever.
- **Aurora correction pack (D-LOC-1).** `sandbox.js` v1.1 test-contact cities, `admin-marketing.html` CAN-SPAM placeholder (now a marked `[STREET ADDRESS]` blank rather than a fabricated one — the invented-address habit is what produced the Colorado Springs error), `marketing.test.mjs` fixture, and a new `db/2026-07-26_seed-testdata_v1_1.sql` replacing the 2026-07-23 v1.0 seed.
- Gates: `node --check` 13/13 · tests **137/137** (26 new calendar, 9 new gate) · esbuild bundle 363 KB containing `v0.23.0`, `waiver_required`, `BEGIN:VCALENDAR`, `waiver_expiring`, `access_tokens` · migration 0016 dry-run asserted idempotent re-run, public-feed uniqueness, rotate-after-revoke, global `token_sha` uniqueness, and the `kind` CHECK.
- Deferred to v0.24.0: teammate self-sign invite links (option B — reuses `access_tokens.kind='waiver_sign'`) and the member-facing subscribe UI.

## v0.24.0 — 2026-07-26 (Build status indicators)

Frontend-only release. No migration, no worker logic change — the worker version bumps only
so `/api/health` and the deployed site report the same string, which is how every paste is
verified.

**Why:** testers are about to be pointed at a site where some screens are finished, some work
but cannot complete their core job yet (email sending is code-blocked, Square is SANDBOX), and
some modules do not exist. Without a marker, every half-built screen produces a bug report that
is really a roadmap item.

**NEW `web/assets/build-status.js` v1.0** — the single registry of module maturity. Four states:
`live` (finished, no badge) · `beta` (works with a stated caveat, safe to test) · `wip` (under
construction, cannot finish its core job) · `soon` (not built, Build Status page only). The file
also renders every consumer of that registry: rail chips, per-page banners, and the full table.
Change a status in this one file and everything follows.

- Rail chips are **not animated** — they are on screen on every page load, which is the
  emil-design-eng frequency rule (standards §2). Only the page banner fades, 180ms, and only
  under `prefers-reduced-motion: no-preference`.
- Status is never colour-only: every chip carries a text label plus an `aria-label` naming the
  state in words (WCAG 1.4.1, standards §3).
- `wip` items are dimmed, carry a cone glyph, and ask for confirmation before opening.
- Banners are dismissible per page per session (`sessionStorage`), never permanently.
- Collapsed admin rail (`data-nav="min"`) collapses each chip to a 6px dot so the rail width
  is unchanged.
- Tokens only, no hardcoded hex.

**NEW `web/admin-buildstatus.html` v1.0** — one honest page listing every screen and every
cross-cutting feature with its state and a tester-facing note, plus counts by state. Reads the
registry directly; no API call, nothing to keep in sync by hand. Linked from the admin rail's
Sandbox group.

**`web/assets/admin-nav.js` v2.10 → v2.11** — loads `build-status.js`; adds **Build status** to
the Sandbox group. The menu data structure is untouched.

**`web/assets/site-nav.js` v2.5 → v2.6** — loads `build-status.js` on the member and public rails.

**`worker/src/index.js` v0.23.0 → v0.24.0** — version string only.

**`README.md`** — full rewrite; it had been stale at v0.12.0 for eleven releases. Module table
current through v0.24.0, marker legend, corrected architecture table (63 tables, 137 tests,
real route pattern), roadmap v7 pointer.

**States at release:** 2 WIP (Marketing & Email — sending code-blocked until the address and
Brevo key are in place; Web Push — three VAPID secrets never set), 9 BETA (mostly Square
SANDBOX), the rest finished.

**Gates:** `node --check` 24/24 · tests **137/137** · esbuild 363 KB containing `v0.24.0` ·
no SQL, so no migration dry-run required.

## v0.25.0 — 2026-07-26 (Consent: teammate self-sign + media-release record)

Two roadmap items in one release. Both answer "who agreed to what, and can we prove it."

### A. Teammate waiver self-sign (roadmap R-03)
Until now only the captain ever signed. Teammates were a name and an email on `team_members`
— no contact row, no signature, no way to reach them again — so the door gate added in
v0.23.0 had nothing to check them against, and the CRM held one row per team instead of four.

- **NEW `worker/src/consent.js` v1.0**, mounted after `calendar.js`.
  - `GET|POST /api/sign/:token` — public. The token IS the credential; no session.
  - `POST /api/team-members/:id/waiver-link` — captain or staff mints and emails a link.
  - `GET /api/team-members/:id/waiver-state` — has this person got a current waiver?
- Signing finds-or-creates the contact, writes a `waivers` row **pinned to the active
  `waiver_versions.id`**, links the roster row, and links every other unlinked roster row in
  the org carrying the same email.
- **NEW `web/sign.html` v1.0** — public sign page. Token lives in the URL **fragment**, not a
  query string: fragments are not sent in the `Referer` header and do not reach access logs,
  so a forwarded link leaks less.
- Idempotent: a second submit on a live waiver returns ok without writing a duplicate.
- Version-race guard: if the waiver text is republished while the page is open, the POST is
  refused with `waiver_stale` rather than pinning a signature to text nobody read.
- Token is revoked the instant the waiver is signed, and minting again rotates rather than
  accumulating, so a forwarded old link dies the moment a new one is issued.
- Nickname signatures are accepted with a `name_matched_roster: false` flag on the audit row.
  Rejecting "Bobby" because the roster says "Robert" produces unsigned waivers, which is
  strictly worse than a flagged one.

**A real bug was caught by the new tests before release.** `signState` normalised timestamps
with `replace(" ","T") + "Z"`, which turns an already-ISO value into `...12:00:00ZZ`.
`Date.parse` returns `NaN`, every comparison against `NaN` is false, and **an expired token
read as valid.** Replaced with `parseTs()`, which only appends `Z` when there is no timezone
suffix, and which now **fails closed** — an unparseable expiry is treated as expired rather
than as no-expiry. Two regression tests guard it.

### B. Media-release consent record (D-WV-10 / handoff v2.6 §6B)
Waiver §6 grants an irrevocable likeness release whose only decline path is a written
request. The policy had nowhere to live, so an opt-out could be honoured once by whoever
read the email and forgotten the next time someone picked photos.

- **Migration 0017** (`media_consents`) — **applied live before this paste list was built**
  (D-MIG-2). Dry-run first against a local replica; all six assertions fired.
- History is preserved: withdrawing soft-deletes the opt-out row and writes a `restored` row
  rather than editing in place. The partial unique index counts only live rows, so a future
  opt-out still fits.
- `reference` is **required** — a record with no pointer to the writing cannot be defended.
- **NEW `web/admin-consent.html` v1.0** under People. Staff-only. There is deliberately **no
  member-facing opt-out**; adding one would contradict D-WV-10, not implement it.
- `optedOutContactIds()` exported for photo pickers to filter against.

### Also
- `web/assets/build-status.js` v1.0 → **v1.1** — registers the two new pages; teammate
  self-sign and media consent flip from SOON to LIVE.
- `web/assets/admin-nav.js` v2.11 → **v2.12** — Media consent added under People.
- `worker/src/index.js` → **v0.25.0**.

### Not in this release
The calendar **subscribe UI** (roadmap R-08) was scoped into v0.25.0 and cut. The `.ics`
feeds still have no button anywhere to fetch a feed URL. Moved to v0.26.0 — flagged rather
than quietly dropped.

**Gates:** `node --check` 25/25 worker + 3 web + 2 inline blocks ✅ · tests **160/160**
(up from 137; 23 new) ✅ · esbuild containing `v0.25.0` ✅ · migration 0017 dry-run 6/6 ✅ ·
applied live and verified in `sqlite_master` ✅

## v0.26.0 — 2026-07-26 (Tiers, view gating, isolation hardening)
**Migration 0018** (`membership_tiers`, `membership_grants`, `plans.tier_id`, `schedule_views.owner_org_id`/`visibility`/`min_tier_id`/`require_membership`, `orgs.timezone`). Dry-run 14/14 against a local replica.

### Multi-tenant isolation (Critical/High)
- `admin.js listUsers` scoped to the caller's admin orgs. It previously returned every user, email, TOTP state and role assignment on the platform to any single-org admin.
- `facility.js` bookings: `createBooking` no longer accepts `org_id` from the request body (`Number(b.org_id) || 1`); `updateBooking`/`deleteBooking`/series operations scope by `ctx.orgId`; org is now immutable on update.
- `security.js` deleted-list and restore scoped by `org_id` — staff could previously list and restore another tenant's soft-deleted contacts, registrations, teams and events.
- `checkin.js myAttendance` scoped by `org_id`.

### Capability tokens (`consent.js`)
- `postSign` never called `signState`, so **revoked, soft-deleted and expired waiver tokens all still produced legally operative signatures.** Tokens now resolve only when live, and expiry is enforced on the write path.
- Single-use consumption is now an atomic conditional `UPDATE` executed before the first write, replacing a read-check-then-write sequence that let concurrent submits both write a waiver.
- The waiver version guard no longer skips when `version_id` is omitted or null.
- `getSignPage` returns 404 for expired tokens instead of 200-with-state; a distinguishable response confirmed the token hash existed.

### Calendar time zones
- `calendar.js` was emitting `starts_at` with a trailing `Z`. Events are stored as naive facility wall-clock (the admin UI posts `date + " " + time`, and the worker stores it unmodified), so **every subscribed event landed 6–7 hours early.** Now emitted as floating wall-clock bound to a `VTIMEZONE` (`toIcsLocal`, `addWallHours`, `icsVtimezone`). `DTSTAMP` remains UTC, which is correct.
- `profiles.js eventIcs` was already correct; the hardcoded zone is replaced so both paths read `orgs.timezone`.
- Selectable zone (Denver, Phoenix, Los Angeles, Chicago, New York) via `GET/PUT /api/admin/org`, whitelisted server-side. Default `America/Denver`.

### Fail-closed corrections
- `waitlists.js offerExpired` returned `false` on an unparseable expiry, so a corrupt `offer_expires_at` meant a claim link that never expired. Now fails closed.
- `facility.js` slot parsing: `Number("abc")` is `NaN`, and every `NaN` comparison in `validateSlot` was false, so non-numeric times passed validation and bound `NaN` into D1. Reuses the module's existing `num()` guard.
- `reports.js sales`/`dashboard`: soft-deleted registrations were still summed into revenue.
- `member_portal.js myAgreements`: soft-deleted contacts surfaced as agreement subjects.
- Unguarded `JSON.parse` on `config_json` in `leagues_admin.js` and `tournaments.js` could 500 an entire endpoint from one malformed row.

### New — membership levels (`tiers.js`)
- Tiers are entitlements (rank, discount bps, guest passes, open-gym, booking window); plans stay billing products. A tier can be granted by subscription, manually, comped, staff, or sponsor.
- `effectiveGrant` resolves the live tier by rank then recency, and **fails closed on corrupt dates.**
- Tier delete is refused while live holders exist — inactivate instead of silently stripping entitlements.
- Admin UI: `web/admin-tiers.html`.

### New — schedule view ownership and visibility
- `schedule_views.org_id` is a *content filter* (migration 0003: "NULL = all orgs"), not ownership. Scoping mutations by it would have made both seeded built-ins uneditable by every user. Ownership is the new `owner_org_id`; NULL means platform-global and admin-only.
- `visibility` is `public | internal | staff`, enforced server-side in the feed, with optional membership-tier gating on top. Unknown values fail closed. Backfill preserves current access exactly.

### New — bulk member actions (R-11)
- `POST /api/admin/members/bulk`: add/remove tag, grant tier, unsubscribe/resubscribe, export CSV. Capped at 500 ids, org-scoped (foreign ids dropped and reported), audited as one row with the id list. Tag and grant writes use `env.DB.batch` rather than sequential awaits.
- Selection column + fixed bulk bar in the members list.

### Frontend
- Stored XSS: `app.js` interpolated `org.name` and the signed-in email straight into `innerHTML`. Added `esc()`.
- A `401` from any admin call now clears the dead token and redirects to `index.html?expired=1` instead of failing silently.
- `R-08` shipped: `web/admin-calendar.html` — the subscribe UI the `.ics` feeds have lacked since v0.23.0. The feed token is shown once and unrecoverable, so the reveal is styled as an action state, not a success state.
- Shared `contactForSession` in `index.js`; `ctx.role` resolved once per request.

**Gates:** `node --check` 25 worker modules + 5 web assets + 2 inline blocks · `node --test` **207/207** (was 160) · esbuild 408 KB containing `v0.26.0`, `membership_tiers`, `toIcsLocal`, `canReadView`, `validateBulk` · migration 0018 dry-run 14/14.

## v0.27.0 — 2026-07-26 (Guardians & minors · waiver tokens · org profile)
**Migration 0019** (`families`, `contacts.family_id`, `guardianships.aged_out_at`/`separation_choice`/`separated_at`, `member_profiles.dominant_hand`, ten `orgs` profile columns). Applied live and verified.

### Minors — the safety fix
- **`consent.js postSign` let a minor sign their own waiver.** A captain entered any teammate email and the holder self-signed. A minor cannot form a binding waiver, so the result was a void document the front desk read as valid — worse than no waiver. Date of birth is now **mandatory** on the sign flow, and a minor is refused with instructions to involve a guardian.
- `sign.html` collects date of birth **before** the signature field, with a client-side check as courtesy; the server enforces regardless.
- NEW `family.js`: `ageOn`, `isMinor`, `validateBirthdate`, `guardianGate`, `signerFor`, `ageOutState`, `separationRequirements`, `displayName`, `normalizeDominantHand`.
- **Age is derived, never stored.** No `is_minor` column: a stored boolean is correct until a birthday and silently wrong after, which would keep an adult guardian-signed or let a minor age into self-signing.
- **`isMinor` fails closed** — an unknown or unparseable birthdate returns `true`. A guardian with no birthdate on file is rejected rather than assumed adult, and a minor cannot be another minor's guardian.
- Guardian-first ordering: a minor's birthdate halts the flow before their record is written. The reverse order lets a child self-register and self-sign before any adult appears.
- 18th-birthday transition: `prompt` → `kept` (guardian keeps signing, may separate later) or `separated` (self-signs). A separated guardianship row is **kept, not deleted**, so the family connection stays visible and signature history reconstructable. Separation requires re-signing in the member's own name and blocks participation until done.
- Routes: `POST /api/family/age-check` (pre-flight, writes nothing), `GET /api/family`, `POST /api/family/age-out`.

### Minor display — child safety
- `displayName` abbreviates surnames per D9 and marks minors **`(M)` on internal/staff views only**. Publishing `Ava R. (M)` on an open schedule page would hand anyone a machine-readable list of which children are on which court at which time. Unknown visibility values do not leak the marker.

### Waiver tokens
- One canonical body serves every org via `{{ENTITY}}`, `{{ORG_NAME}}`, `{{ORG_EMAIL}}`, `{{MEDIA_OPTOUT_EMAIL}}`, `{{ORG_WEBSITE}}`, `{{ORG_PHONE}}`, `{{ORG_ADDRESS}}`.
- **`ENTITY` is deliberately separate from `ORG_NAME`** — the legal person the release runs to vs the brand a family recognises. If the brands are DBAs of one LLC, only `ORG_NAME` varies.
- Resolution happens **at publish, not at render**, and the resolved text is what `body_sha` pins. Rendering late would mean a signed document changes retroactively when an org's email is edited.
- Publish **refuses** on an unknown token or a blank org value. A §6 promising a written decline path to a literal `{{MEDIA_OPTOUT_EMAIL}}` has no decline path.

### Org profile
- `orgs` gains website, admin_email, phone, address_line1/2, city, state, postal_code, `is_owned`, `active`.
- Facility address written to all ten orgs: 14200 E Alameda Ave · FieldhouseUSA · Aurora, CO 80012.
- Four owned orgs send under their own identity; six facility renters send as `"<Name> via Boomtown"` from a controlled domain. Sending as a renter's own domain would fail SPF/DKIM and constitute impersonation.

### Player bio
- `dominant_hand` (left/right/ambidextrous), whitelisted in the worker since SQLite cannot add a CHECK via ALTER. Free text here would reach the public player card.

**Gates:** `node --check` 26 worker modules + inline blocks ✅ · `node --test` **245/245** (was 207) ✅ · esbuild 418 KB containing `v0.27.0`, `resolveWaiverTokens`, `validateBirthdate`, `displayName` ✅ · migration 0019 applied and verified live ✅

---

## v0.28.0 — 2026-07-26 · Documents

Legal text stops being code. Each org owns its own documents; tokens fill from the org profile.

### NEW `worker/src/documents.js` — org-owned document library
- `documents` + `document_requirements` (migration 0023). An org may hold several signable
  documents; each has versions, and one version at a time is *required* of a given audience.
- **Two-phase tokens (D-DOC-5).** Org tokens resolve at **publish** and are hashed into `body_sha`;
  signer tokens resolve at **render** and are never hashed. Resolving org tokens at render would
  rewrite a signed document the day somebody edits a phone number; resolving signer tokens at
  publish is impossible, because the signer is unknown.
- **No fallback on party identity or mailing address (D-DOC-6).** `ENTITY`, `ENTITY_SHORT`,
  `ORG_NAME`, `ORG_EMAIL`, `ORG_ADDRESS` refuse rather than guess. Cosmetic tokens may fall back.
  `RULES_REFERENCE` falls back to "posted at the facility" because a dead URL is weaker than no URL.
- **Publish refuses** on unknown tokens, on empty no-fallback tokens, and on bracket-style
  placeholders (`[LIKE_THIS]`, `TBD`, `____`) that a `{{...}}`-only validator cannot see.
- **Warns** when the text contains an org's literal name instead of a token — needs
  `confirm_literal_names` to proceed, because "Boomtown Fieldhouse" may legitimately appear in
  facility rules.
- **Retroactive assignment** with a server-side dry run. Above 50 affected members the caller must
  echo the count back, because `retroactive=1` locks the entire roster out of registration and
  check-in until they re-sign.
- **Compliance is computed, never stored (D-DOC-7).** One query drives the registration gate, the
  check-in chip and the assignment preview, so the three cannot disagree.
- Signatures are pinned permanently to the version and `body_sha` the signer saw, never re-pointed
  (D-DOC-8). One active requirement per (org, document, audience), enforced by a partial unique
  index rather than worker logic (D-DOC-9).

### FIXED — F-10, P0, in shipped code
`WAIVER_TOKENS.ENTITY` read `o.legal_entity || "Boomtown Athletics, LLC"`, **and
`publishVersion`'s org query never selected `legal_entity` at all.** So `o.legal_entity` was always
`undefined` and the hardcoded fallback fired for *every* org regardless of what migration 0020 put
in the database. Not "orgs missing an entity get a default" — no org could ever resolve its own
entity. D-ORG-1 has forbidden this for three releases while the code did the opposite. Both halves
fixed: fallback removed, columns selected.

`MEDIA_OPTOUT_EMAIL` removed — the opt-out is retired (D-CON-5) and declining the release is
declining the waiver (D-CON-6). The token permitted publishing a decline path the platform answers
with 410 Gone. `ENTITY_SHORT` and `RULES_REFERENCE` added. `currentVersion()` scoped to the
liability-waiver document, since `org_id` alone now returns whichever document published last.

### Migrations applied live and verified
- **0021** — `schema_migrations` ledger created and backfilled. Twenty migrations had been applied
  with no record in the database of which ran. Orgs 4–10 deactivated (`active=0`), none deleted;
  every row in the platform belongs to org 1, so the reduction was cost-free and reversible.
- **0022** — `legal_entity_short`, `legal_entity_verified`. Match Point Social and Queens Club
  seeded with owner-supplied placeholder names at `verified=0`, so a guessed corporate identity is
  visible rather than laundered into a signed document.
- **0023** — document library. `signatures` was already document-agnostic, so this extends it
  rather than adding a fourth signature table. `waivers` deprecated, not dropped.

### Known open
- **F-4** nothing in `worker/src/` reads `orgs.active` — confirmed by grep across all 27 modules.
  The seven deactivated orgs are still selectable. Next release, 0.25d.
- **`nonCompliant` and `currentDocVersion` are tree-shaken from the bundle** — exported, uncalled.
  They are the v0.29.0 registration gate and check-in chip. Shipped dead until wired.
- **R-23** `waivers.js` and `documents.js` hold two token maps deliberately, to avoid a module
  cycle. A change to either must be made in both until `tokens.js` is extracted.
- **F-5** capacity oversubscription race · **F-6** `guardianGate`/`signerFor`/`applyTierDiscount`
  built and uncalled · **F-7** N+1 in `events_admin.js` · **F-9** two entity names unverified.
- No tests for `documents.js` yet. Admin UI and multi-document `sign.html` not built.

**Gates:** `node --check` on all three changed modules ✅ · esbuild bundle **441,832 bytes**
containing `v0.28.0`, `documentRoutes`, `resolveDocTokens`, `complianceFor`, `tokenRefusal`,
`literalOrgNames` ✅ · migrations 0021/0022/0023 applied and verified against live D1 ✅ ·
`node --test` **not run** — no new tests written.

---

## v0.30.0 — 2026-07-26 — Org scope enforced · capacity race closed · generic file uploads

Absorbs the v0.29.0 patch set, which was written but never pasted (`HEAD` sat at `ea6d385`).
Delivered as a ZIP for upload rather than paste blocks.

### Closed
- **F-11 — org scope was not enforced at the API layer.** `buildCtx` accepted any `X-Org-Id` with
  no existence, `active` or `deleted_at` check, so the seven orgs deactivated by migration 0021
  were fully operable by sending a header — and a malformed header fell back silently to org 1,
  the live business. `buildCtx` now validates and sets `ctx.orgOk`; the router short-circuits to
  **404** (not 403 — a deactivated org should be indistinguishable from one that never existed).
  `listOrgs` filters to `active = 1`, so migration 0021 becomes visible in the switcher for the
  first time: **3 orgs, not 10.**
- **F-12 — unscoped bootstrap admin grant.** `SELECT ?1, id, 'admin' FROM orgs` now carries
  `WHERE active = 1 AND deleted_at IS NULL`. A v0.1 artifact that survived 29 releases and seeded
  exactly the role rows F-11 needed.
- **F-11b — the literal-name guard scanned the narrowest set.** `documents.js` filtered its
  party-name scan to active orgs, so a document naming a deactivated org published clean. Widened
  to every non-deleted org. This is the one predicate in the release that goes wider, deliberately:
  **a guard must scan the widest set** (standards §10 check 3).
- **F-5 — capacity oversubscription race.** `waitlistGate` read the count ~55 lines and four D1
  round trips before the INSERT, so two concurrent submits both passed. Capacity is now re-checked
  *inside* a single atomic `INSERT…SELECT…WHERE`; the loser gets **409 `event_full`**. Same
  reasoning as token consumption in `consent.js postSign`. A valid waitlist claim bypasses by
  design. Residue named, not hidden: a losing race leaves an orphan team row — **R-24, 0.25d**.
- **F-6 (partial) — `applyTierDiscount` called for the first time.** Built and tested in v0.26.0,
  zero call sites for four releases. Wiring it at registration *alone* would have quoted a
  discounted price and charged list price, because `retryPayment` recomputes from
  `events.price_cents`. The quoted figure is therefore stored in `registrations.price_cents`
  (0024) and checkout reads `COALESCE(r.price_cents, e.price_cents)`, so pre-0024 rows are
  unaffected. `guardianGate` and `signerFor` remain uncalled — they need date-of-birth in the
  registration payload, which is a design change, not a patch.
- **F-16 (new) — the test suite was red at HEAD and nobody knew.** Four assertions in
  `family.test.mjs` failed against shipped code. One asserted `{{MEDIA_OPTOUT_EMAIL}}`, retired
  under D-CON-5. **One encoded the F-10 defect itself** — it expected `{{ENTITY}}` to render
  "Boomtown Athletics, LLC" for a Match Point Social fixture with no `legal_entity`, which only
  passed while the `||` fallback existed. F-10 was fixed in the code four releases ago and nobody
  grepped the tests. Root cause is the same class as F-15: the previous release recorded
  `node --test` **not run — no new tests written**. A gate you skip is a gate you do not have.

### Added
- **`worker/src/uploads.js` v1.0 — generic org-scoped file store.** R2 holds the bytes, D1 holds
  the index; the same split `member_profiles.avatar_r2_key` has used since v0.5.0, generalised
  rather than copied a fourth time. `POST/GET /api/uploads`, `GET/PATCH/DELETE /api/uploads/:id`,
  `POST /api/uploads/:id/restore`. Server-side MIME allow-list, 10 MB cap, 2,000-file org quota
  quoted rather than silently truncated, generated R2 keys (the filename never reaches the key),
  soft delete with restore, audit row on every write.
  **SVG and HTML are excluded from the allow-list** — an SVG served from our own origin is stored
  XSS. Non-image/PDF types are served `Content-Disposition: attachment` with a sandbox CSP and
  `nosniff`. Binding resolves `env.UPLOADS || env.AVATARS`, so no new bucket is required and the
  deploy cannot fail on a missing binding.
  Deliberately absent: no compliance, screening, clearance, expiry or approval columns. Those live
  in an external system by owner decision (2026-07-26); a second store for one fact means two
  records that drift.
- **`web/admin-uploads.html` + `web/assets/admin-uploads.js` v1.0.** Drop zone as the single focal
  point, per-file progress, skeleton rows, empty state that names the next action. Dragover changes
  background only — a continuously-firing event gets no transform (§2). Progress is constant
  motion, therefore `linear`. XHR rather than `fetch` because `fetch` has no upload progress.
- **`admin-nav.js` v3.0** — Files added to the People group, beside Settings.
- **Migration 0024** — `uploads` table; `registrations.price_cents`. Additive only. Reversal in
  the file header. Ledger INSERT written against the live `schema_migrations` shape (`version` is
  NOT NULL; there is no UNIQUE on `filename`, so `OR IGNORE` would not dedupe — a `NOT EXISTS`
  guard does).
- **`worker/test/documents.test.mjs` — 26 tests.** `documents.js` shipped in v0.28.0 with none.
  Weighted toward refusals that must happen before a body is hashed and pinned: F-1 bracket
  placeholders, every no-fallback token, per-org party substitution, and **the literal-name guard
  against a DEACTIVATED org** — the F-11 regression test.
- **`worker/test/uploads.test.mjs` — 27 tests.** Path traversal, null bytes, dotfiles, SVG/HTML
  refusal, MIME parameter smuggling, header injection via filename, size boundaries, and the
  fail-closed direction of every normaliser.

### Gates
`node --check` on all four changed modules ✅ · esbuild bundle **458,529 bytes** containing
`v0.30.0`, `uploadRoutes`, `validateUploadRequest`, `applyTierDiscount`, `orgOk`, `safeFilename` ✅
· `node --test` **167/167 pass** (was 163/167 at `ea6d385` — see F-16) ✅ · live D1 read before
every proposed write ✅.

**Call-site census** (standards §6.5, defining file excluded):
`applyTierDiscount` **now has call sites** and leaves the standing list.
`guardianGate` · `signerFor` · `complianceFor` · `nonCompliant` remain at **zero** — expected and
scoped out of this release, not overlooked.

### Known open
- **F-6 remainder** — `guardianGate`, `signerFor` still uncalled.
- **F-6b / F-14** — `complianceFor` blocked on the fail-closed sequencing decision.
- **R-24 (new)** — orphan team row on a lost capacity race, 0.25d.
- **R-23** — `waivers.js` and `documents.js` still hold two token maps to avoid a module cycle.
- **F-7** N+1 in `events_admin.js` · **F-9** two entity names unverified · **F-13** hardcoded
  email sender name.

## v0.31.0 — 2026-07-26 — Documents UI, organisation identity, F-13

**Documents version editor.** `web/admin-documents.html` + `admin-documents.js`. Create a
document, write a version with tokens, publish, assign. Token palette in the right rail, grouped
Org / Signer, insert at cursor in one click with no animation of any kind — standards §2 puts a
100+/day action in the never-animate row. Live preview and the token chips are rendered from the
server's own `resolveDocTokens` and its widest-set literal-name scan, debounced 300 ms, so the
editor cannot tell the author a document is clean and then have publish refuse it. Publishing with
a literal organisation name in the body requires a typed reason of at least 10 characters
(standards §7.3), written to `audit_log`. The assign dialog states the affected count under each
radio from two server-side dry runs; typed confirmation appears only above 50 records.

**New endpoints on `documents.js`.** `GET /api/admin/documents/tokens` and
`POST /api/admin/documents/preview`. Added specifically so the client holds no token map: R-23
already records two deliberate copies in the worker, and a third in JavaScript would be the copy
that lies. Both are numeric-safe against `matchId`, which requires `^\d+$`.

**Organisation settings.** `worker/src/orgs.js`, `web/admin-org-settings.html` +
`admin-org-settings.js`. The screen that fills in the five no-fallback tokens, so a publish
refusal is now actionable. No migration — every column already existed. Writes go through an
explicit allow-list; `legal_entity_verified` is not in it and is set only through
`POST /api/admin/org/verify-entity`, which demands a typed source. Editing `legal_entity` or
`legal_entity_short` clears the verification, and the warning appears while typing rather than
after saving. Admins can reactivate an organisation that v0.30.0 removed from the switcher —
audited, reason required, `active` flag only, nothing dropped.

**F-13 closed, and found to be wider than recorded.** The roadmap listed four hardcoded sender
names. The census found seven more literals in text members actually read: the magic-link subject
in `index.js`, two subject lines in `registrations.js`, the message-relay subject and body in
`messages.js`, the relay's fallback sender label, and a waiver-expiry sentence. `sendEmail()` and
`sendBrevoEmail()` now take an optional `orgId` and resolve through one function,
`orgs.senderIdentity()`, which returns **null** rather than inventing a name — the opposite of the
F-10 shape. A null sender is a refusal, not a guess. Recorded as F-13b.

**Tests.** `worker/test/orgs.test.mjs`, 24 tests. Full suite 323 pass / 0 fail. One test asserts
that `PUBLISH_CRITICAL` equals `documents.NO_FALLBACK` exactly, because a drift between them would
have the settings screen report ready while publish refuses.

**Deferred out of this release.** Requirement 9's cash-payment admin surface. The notification
half already exists — `registrations.js` writes a `cash_pending` notifications row — so what
remains is a queue screen, and it is independent of everything above. Moved to v0.31.1 to keep the
release at two complete items rather than three partial ones.

---

## v0.32.0 — 2026-07-26 — Minors: age-aware registration, guardian invitation, certification

**Migration 0025 — required. The release is not shipped until `SELECT COUNT(*) FROM schema_migrations` reads 25.**

`registrations.js` is age-aware for the first time. Before this release the file held **zero**
matches for `date_of_birth`, `guardian` or `minor` across 49 KB, so a participant of any age
could be registered with no adult attached.

- **D-MIN-9** — a minor's account is created but not activated. New `contacts.activation_state`
  (`active` | `pending_guardian`).
- **D-MIN-11** *(new, owner 2026-07-26)* — a blank guardian date of birth is not a form error.
  The registrant is given an invitation link for the parent, the parent completes their own
  account and certifies the information, and the block lifts.
- **Owner option B** — registration **itself** is blocked, not merely account activation. A minor
  without a certified guardian cannot be registered for anything.
- **D-MIN-8 in force** — the `guardian_required` copy no longer says the guardian signs a waiver.
  There is no waiver gate anywhere. A test asserts the word cannot come back.
- **D-MIN-10** unchanged — the 18th-birthday keep-or-separate prompt stays.

**The invitation link is rendered on screen, not only emailed.** Brevo is paused; an emailed-only
invite would be a block with no key. Email is the enhancement, the on-screen link is the channel.
The token travels in the URL **fragment**, never a query string, so it stays out of access logs
and `Referer` headers — the same reasoning `sign.html` used in v0.25.0.

**F-6 closed.** `guardianGate` had zero call sites since v0.27.0. It now has six, and it is the
only age rule in the codebase: the public registration path, `profiles.js:addChild` and the invite
claim all call the same function. `addChild` previously never checked the parent's own age while
`guardianGate` did — two implementations of one rule, and the live one was the weaker.

**NEW `worker/src/crypto.js`** — a leaf module holding `sha256Hex` and `randomToken`.
`family.js` needed a hash and `consent.js` already imports `family.js`, so importing back would
have created the exact cycle R-23 documents. **F-20 *(new)*: `sha256Hex` is defined four times —
`consent.js`, `calendar.js`, `uploads.js`, `waivers.js`. `crypto.js` is the destination; collapsing
the other four is a separate pass.**

**`access_tokens` was rebuilt** to widen its `kind` CHECK for `guardian_invite`. SQLite cannot
ALTER a CHECK. The table held **0 rows** — verified live before the migration was written — so the
rebuild moved no data. All three indexes are recreated in 0025, plus a partial unique index that
makes two live invites for one minor impossible.

**Tests: 340 pass / 0 fail** across 20 files, up from 323. Bundle 483,736 bytes.

**Deferred on purpose, named so they are not lost:** `complianceFor` / `nonCompliant` as a
non-blocking indicator (F-6b / F-14) and F-18's duplicate `GET /api/family` → v0.33.0. Four items
in one release is how uncalled code ships here.

**Known boundary, stated so it is not mistaken for coverage:** the gate covers the **registrant**.
Team members are name+email rows with no date of birth and are not gated. Extending it to a roster
is a decision, not an oversight.

## v0.32.1 — 2026-07-27 — Deploy gate (re-delivery; the first upload did not land)

**Why this shipped twice.** The v0.32.1 ZIP was uploaded at `40ed3b6` and every file in it landed
wrong: `deploy-worker.yml` v0.3.0's content was written to the repo root as
`0025_guardian_invite.sql`, the rollback SQL overwrote this CHANGELOG and destroyed 700 lines,
and `schema-gate.mjs` plus its tests never arrived at all. `db/migrations/0025` kept its stale
`NOT YET APPLIED` status. No deploy fired, because none of the touched paths matched the old
v0.2.2 workflow's filter — that was luck, not a control.

- **`.github/workflows/deploy-worker.yml` v0.3.0** (was v0.2.2, 2026-07-21). v0.2.2 ran ONE of
  twenty test files (`worker/test/scheduler.test.mjs`) and deployed unconditionally. It was green
  for 31 consecutive runs while covering 5% of the suite, and run #31 deployed v0.32.0 against a
  24-migration schema. Library §2 failure class 3: a guard narrower than the thing it guards is
  worse than no guard, because it reports clean. Now: `node --check` on all 31 modules → full
  suite via `node --test test/*.mjs` → fail-closed pre-deploy schema gate → deploy → cache-busted
  post-deploy version parity against `/api/health`, six attempts.
- **`worker/scripts/schema-gate.mjs` v1.0** — NEW. Refuses to deploy when `db/migrations/` carries
  a migration D1 has not applied. Fails closed on an unreadable D1, a missing `--applied`, an
  empty directory, or any filename it cannot parse.
- **`worker/test/schema_gate.test.mjs` v1.0** — NEW. 16 tests. Suite 340 → **356, 0 fail**.
- **`db/migrations/0025_guardian_invite.sql`** — STATUS flipped to `APPLIED 2026-07-27 16:41:27
  UTC`. A stale NOT-YET-APPLIED on an applied migration is a double-application hazard; 0021
  carried a wrong one for five releases.
- **`db/migrations/2026-07-27_rollback-0025_v1_0.sql`** — restored to its correct path. Captured
  live from `sqlite_master` before the DROP, so it is the real prior definition.
- **This CHANGELOG** — restored from `f5193cc` (700 lines) with these entries appended at the END
  per standing rule 6.

**A bug caught by its own test suite before it ever ran in CI.** The gate's first filename parser
used `/^(\d{4})[-_]/` for the bare `0025_name.sql` convention. That regex matches the *year* of
`2026-07-27_rollback-0025_v1_0.sql` and returns 2026. Since the rollback SQL legitimately lives in
`db/migrations/`, the gate would have computed a repo maximum of 2026, compared it against 25, and
blocked every deploy permanently — failing closed, safely, and for entirely the wrong reason.
Rollbacks are now a recognised-and-skipped category; genuinely unrecognised filenames still block.

**Prerequisite, or the next run fails at the D1 read.** `CLOUDFLARE_API_TOKEN` must carry
**Account → D1 → Read** alongside Workers Scripts:Edit, and **`CLOUDFLARE_ACCOUNT_ID`** must be
set as a repository secret. The gate fails closed by design. Widen the token; do not remove the
gate.

## v0.33.0 — 2026-07-27 — Design tokens: four phantom tokens defined (F-23)

- **`web/assets/tokens.css` v0.3.0** (was v0.2.1). **Four tokens were referenced 126 times across
  23 files and defined zero times:** `--text-dim` (61 uses), `--surface-2` (32), `--warn` (19),
  `--warning` (14). **36 of those declarations were being silently dropped** — a `var()` with no
  fallback naming an undefined property is invalid at computed-value time, so the whole
  declaration is discarded. The 23 no-fallback `--text-dim` uses rendered secondary text at full
  `--text` emphasis: a flat-hierarchy defect on 23 sites, not a colour nit. Where a hardcoded
  fallback existed it was a dark-theme value, so those sites stopped theming and stayed dark in
  light mode. `var(--warn, #E8B54A)` *reported* as tokenised and *behaved* as hardcoded — failure
  class 3 again, in CSS.
- **No new hue.** `--surface-2` and `--warn` were already shipping as inline fallbacks;
  `--warning` and `--text-dim` are pure aliases of tokens that already existed.
- **Contrast computed, not assumed.** Light `--warn` is `#8F6200`, not the previously shipped
  `#9A6A00`: that value measures 4.41:1 on `--surface` and 4.08:1 on `--surface-2` and **failed
  WCAG AA on the two surfaces warn chips actually sit on.** `#8F6200` is the smallest change that
  clears 4.5:1 on all three light surfaces (5.36 / 5.00 / 4.62). Dark `#E8B54A` is unchanged at
  10.43:1. The four hardcoded `#A8A49A` `--text-dim` uses measured 3.25:1 on light `--bg`.
- **No migration and no markup edits.** Defining the tokens fixes all 126 call sites, including
  the 36 that were being dropped. The now-redundant inline fallbacks are harmless; removing them
  is optional cleanup, deliberately deferred so this diff stays one file.
- **Not changed:** the focus-ring conflict (F-24). `docs/2026-07-21_design-handoff_v0.1.md`
  specifies 2px `--accent` at 2px offset on any focusable; tokens.css v0.2.1 sets form controls to
  `--primary` at 1px. Invisible in dark, divergent in light. Needs an owner decision rather than a
  guess.
