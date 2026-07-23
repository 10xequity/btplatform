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
