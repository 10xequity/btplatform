# Boomtown Athletics Platform
**Version:** v0.24.0 · **Date:** 2026-07-26 · **Supersedes:** README @ v0.12.0 (2026-07-24)

Multi-org sports operations platform for **Boomtown Volleyball · Match Point Social · Queens Club**, plus 7 facility-operator orgs (Colorado Boom, Oda Up, RMR, Real Futsal, Special Olympics CO, Zara Gymnastics, External/Rental). Facility is in **Aurora, Colorado**.

**Live site:** https://10xequity.github.io/btplatform/web/
**API health:** https://boomtown-api.vvisuth.workers.dev/api/health — reports the deployed worker version
**Build status (read this before testing):** `web/admin-buildstatus.html`

---

## Is it finished?

No, and the platform now says so out loud. Every screen that is not finished carries a small
marker in the menu and a one-line notice at the top of the page:

| Marker | Means | What to do |
|---|---|---|
| *(none)* | Finished | Test it normally. File bugs. |
| **BETA** | Works end to end, with a stated caveat — almost always Square SANDBOX | Safe to test. Read the notice first. |
| **WIP** ⚠ | Under construction — cannot complete its core job yet | Confirm dialog before it opens. Don't file bugs. |
| **SOON** | Not built. Listed on the Build Status page only | — |

The registry behind all of it is a single file: **`web/assets/build-status.js`**. Change a
status there and the rails, the page banners and the Build Status page all follow. Nothing
else needs editing.

Two things are sandboxed platform-wide and are **deliberate, not defects**:
- **Square is in SANDBOX.** No card is charged anywhere, on any screen.
- **Email is in sandbox.** Nothing reaches a real inbox until the Brevo key and SPF/DKIM/DMARC are in place.

---

## Architecture

| Path | What | Deploy |
|---|---|---|
| `web/` | Static frontend, GitHub Pages. No build step; every page carries a `?v=` cache-bust. | Push to `main` |
| `worker/src/` | Cloudflare Worker API. `index.js` mounts every module route. | Auto-deploys via Actions **Deploy Worker** on any `worker/**` push |
| `worker/test/` | `node --test` suites. **137 passing at v0.24.0.** | — |
| `db/migrations/` | Schema of record. **0001–0016 all applied live** to D1 `boomtown-prod` (63 tables). | Applied by Claude via Cloudflare MCP, **additive-only**. The SQL files here are records — never re-run them. |
| `docs/` | Install guides, handoffs, roadmaps. Naming: `YYYY-MM-DD_name_vX_Y.md`. | — |

Worker route pattern: `xxxRoutes(request, env, url, ctx)` + `wireXxx(h)`; helpers destructure
`{ json, audit, isStaff, requireStaff }`; `ctx = { session, orgId, userId }`.
Chain order: **waivers → calendar → marketing → messages → pos → push → waitlists → …**
Every table carries `org_id`, timestamps and a soft-delete `deleted_at`.

---

## Modules

| Ships in | Module |
|---|---|
| v0.2 | Auth (magic link + passkeys), multi-org foundation + switcher, tournament engine + live ops + standings |
| v0.3.0 | Registration, Square checkout (SANDBOX), cash flag, custom fields, captain self-scoring |
| v0.4.0 | Schedule views + public feed, admin users/roles, event templates, recurring series, CSV bulk create |
| v0.5.0 | Member profiles, family accounts, guardian waivers, results résumé |
| v0.7.0 | Leagues + weekly scheduler, sales reports, notifications, cron reminders |
| v0.8.0 | Control Center dashboard |
| v0.9.0 | Check-in & attendance — door roster, QR self-check-in, PIN fallback |
| v0.10.0 | Memberships & recurring billing (Square subscriptions, SANDBOX) |
| v0.11.0 | UX & navigation hardening, sandbox demo tools, member-view isolation |
| v0.12.0 | Court & facility management — space atoms, presets, conflict engine, CSV import |
| v0.13.0 | Facility phase B — court auto-claim |
| v0.14.0 | Security & recovery |
| v0.16.0 | Marketing (M14A) — CRM contacts, segments, campaigns via Brevo, signup widget |
| v0.17.0 | Messaging & relay (M14B), player library, check-in kiosk, message report queue |
| v0.18.0 | POS-lite, discounts & promos, sponsors, staff shifts (M15); heatmap / POS-sales / shift-coverage reports |
| v0.19.0 | Waitlists — capacity queue, auto-offer on drop, expiring claim link, admin override |
| v0.20.0 | PWA + Web Push (VAPID secrets still unset — push is WIP) |
| v0.21.0 | M16 optimization + QA sweep |
| v0.22.0 | Waiver versioning — publish versions, every signature pins the text it was shown |
| v0.23.0 | Waiver enforcement at the door + iCal calendar feeds + Aurora location correction |
| **v0.24.0** | **Build-status indicators, Build Status page, README refresh** |

Full detail per release lives in `CHANGELOG.md`.

---

## Roadmap

Current: **`2026-07-26_roadmap_v7_0.md`** (project knowledge). Headline order:

1. **v0.25.0** Teammate self-sign links + calendar subscribe UI
2. **R1 refinement sprint** — check-in balance chip, promo redemption at checkout, one-click mute, register-page nav
3. **v0.26.0** Media-consent record
4. **R2 refinement sprint** — reporting depth, saved views, bulk actions
5. **M-TF** Tournament format engine ⚠ *on hold*
6. **M17** Achievements + public standings · **M18** Player Exchange · **M19** Revenue pack · **M20** Lessons/clinics/camps · **M21** Auto-scheduler

**Go-live blockers:** waiver v2 text published · Brevo key + SPF/DKIM/DMARC · Square SANDBOX → production (owner's call) · 3 VAPID worker secrets.

---

## Standing rules

1. **Square SANDBOX ONLY** until the owner says go. Same for email.
2. Every file carries a date and version; one CHANGELOG entry per release.
3. Owner deploys by copy-paste from delivered ZIPs, with explicit NEW/REPLACE and paste order. **GitHub MCP is read-only.**
4. DB changes via Cloudflare MCP, **additive-only**. Test rows use IDs 90000–90999 and are always wiped. Owner's sandbox demo contacts 90001–90008 are exempt — never touch them.
5. Migrations are applied **before** the paste list is built, never offered as an optional step (D-MIG-2).
6. Validation gate before every delivery: `node --check` → tests → esbuild → version-in-bundle → live D1 spot check when SQL changed.
7. Where a required fact is unknown, ship a **visibly marked blank** (`[STREET ADDRESS]`), never a plausible invention (D-DOC-3).
8. Design system of record: `2026-07-25_design-and-build-standards_v1_1.md` (project knowledge).

---

## Start here

- New to the repo: `docs/2026-07-21_setup-guide_v0.1.md`
- Latest session handoff: `2026-07-26_handoff_v2_7.md` (project knowledge)
- What works right now: open `web/admin-buildstatus.html`

---
*Changelog: v0.24.0 (2026-07-26) — full rewrite from the stale v0.12.0 README: module table brought current through v0.24.0, build-status marker legend added, architecture table rewritten with the real route pattern and test count, roadmap replaced with a v7 pointer, standing rules updated for D-MIG-2 and D-DOC-3. · 2026-07-24 — v0.2 → v0.12.0.*
