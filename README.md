# Boomtown Athletics Platform
**Version:** v0.64.0 · **Date:** 2026-08-03 · **Supersedes:** README @ v0.59.0 (2026-08-03)

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

## Working on it

Two commands cover the whole loop.

```bash
node worker/scripts/preflight.mjs --session   # must print CLEAR before you commit
node worker/scripts/sync-rail.mjs --write     # after changing the admin menu
```

**preflight** is the session ritual and the pre-commit gate in one: origin sync, module syntax,
test-file parity, the *measured* suite count, schema vs live D1, and deployed-version parity. A
`WARN` is never a `PASS` — a check that could not run says so, and is named in the summary.

**sync-rail** exists because the admin sidebar ships as static markup on all 28 admin pages, so it
paints with the page instead of popping in afterwards. That used to mean 28 hand edits to add one
menu item, which was blocking real work. Now: edit `web/assets/rail.partial.html` and the `NAV`
array in `web/assets/admin-nav.js`, run the sweep, and two guards prove partial, pages and NAV all
agree — any two of the three agreeing is not enough.

Delivery is **direct commit** (`CLAUDE.md` §2): push to `main`, CI gates and deploys, then fill the
CHANGELOG entry CI stubs out. Database migrations go through Cloudflare MCP **before** the push, or
the schema gate fails the build closed.

---

## Architecture

| Path | What | Deploy |
|---|---|---|
| `web/` | Static frontend, GitHub Pages. No build step; every page carries a `?v=` cache-bust. | Push to `main` |
| `worker/src/` | Cloudflare Worker API. `index.js` mounts every module route. | Auto-deploys via Actions **Deploy Worker** on any `worker/**` push |
| `worker/test/` | `node --test` suites. **792 passing at v0.64.0**, including an end-to-end harness that drives the real router against a real SQLite copy of the production schema. | — |
| `db/migrations/` | Schema of record. **Ledger at 0035**, all applied live to D1 `boomtown-prod` (85 tables). | Applied by Claude via Cloudflare MCP, **additive-only**. The SQL files here are records — never re-run them. |
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
| v0.24.0 | Build-status indicators, Build Status page, README refresh |
| v0.25–0.28 | Teammate self-sign, media consent, documents & templating, FAQ |
| v0.29–0.32 | SMS foundation (frozen), marketing SMS scope C, org reconciliation |
| v0.33–0.44 | Delivery-gate hardening, kiosk scan, tokens/AA contrast pass, org logos |
| v0.45.0 | LFG & Community Play — two-way board, reliability counts (never ratings), 18+ gate |
| v0.46.0 | Org-brand groundwork, contrast/emphasis tokens |
| v0.47.0 | Static rail inlined on all 26 admin pages (kills the build-after-paint pop) |
| v0.48.0 | Header mail icon (both shells, single-source injectors) |
| v0.49.0 | Header Admin switch for staff-who-play |
| v0.49.1 | **Hotfix:** config.js restored on 5 dead admin pages; headers on lfg/help; every js/css ref now bustered; page-shell + bare-ref guards |
| **v0.53.1** | **Patch — external code review of v0.53.0.** site-nav.js v2.14: mail badge rebuilt with DOM APIs and made idempotent (v2.13 appended unconditionally); **Sign out revealed synchronously from the local token** — a slow or 5xx `/api/me` had left a signed-in member unable to sign out. Guard fixes: header_shell v2.1 closed a **blind** `#btHdrAdmin` check (a hijacked href passed) and added the runs-after-header invariant; brand v2.1 catches line-wrapped and case-drifted stale brand. Suite 631 → 644. No migration. |
| **v0.53.0** | **Unified static MEMBER header + brand rename applied** (owner 2026-08-02): the 13 site-nav pages ship one byte-identical static header (brand img + Athletics wordmark · hidden Admin link with staff reveal · ✉ · ◐ · hidden Sign out) — the v2.10/v2.11 injectors are deleted; site-nav.js v2.13 single-sources theme + logout (per-page copies in register/score/settings deleted; profile.html's dead toggle now works); member pre-paint theme snippet; **D-ORG-5 applied to live D1** (org 1 → Boomtown Athletics) and the brand swept repo-wide (brand.test.mjs v2.0 inverted). No migration. |
| **v0.52.0** | **Unified static admin header** (uiux-review §6 step 4): brand logo + mail icon absorbed into static markup (injectors deleted), **org switcher on all 27 admin pages** (16 gained it; single-source population in admin-nav.js v2.19, 12 per-page copies deleted), **theme toggle everywhere with pre-paint theme** (snippet grows bt_theme + system preference), chrome-glass to the demo-v4 treatment. header_shell.test.mjs v1.0 holds the 27 header copies byte-identical. No migration. |
| **v0.51.0** | Admin **Announcements authoring page** (staff CRUD over /api/admin/announcements — cta vs news, schedule window, live preview in the member's exact markup; rail item on all 27 pages) · **one shared button set** in app.css, per-page redefinitions deleted on 6 pages (uiux-review §4) · **pre-paint collapse state** via bt_nav cookie snippet on every admin page — no post-paint snap. No migration. |
| **v0.50.0** | **R3 member home** — announcement box (admin CTA pinned + non-mutable, per-item/per-category mutes, aggregated feed), results/messages/my-events cards, sub-play CTA row, sub availability (passive/active + level → LFG), public org-brand endpoint, org-branded member rail. Migration 0033. |

Full detail per release lives in `CHANGELOG.md`.

---

## Roadmap

**[`docs/2026-08-02_roadmap_v1_0.md`](docs/2026-08-02_roadmap_v1_0.md) is the roadmap of record.**
It reconciles five separate backlog sources against the live tree, and it is the only list kept
current. This section is a pointer by design: the queue that used to live here went stale, and
its items 1 and 2 had already shipped as v0.51.0 and v0.52.0 while still being listed as upcoming.

Headline order after v0.64.0: **drag-and-drop schedule editor** → **roster import** → **M12C**
public rental booking → **R-04** payment plans → **M18′** roster RSVP → the **member-experience work
order** (W1–W10, `docs/2026-08-03_workorder_member-experience_v1_1.md`). The pool format engine
(M-TF slices 1–2) shipped in v0.62.0–v0.63.0: any team and court count, working/referee teams, and
a generated schedule that commits straight into an event.

**Go-live blockers** — owner-gated config, not build work: Brevo key + SPF/DKIM/DMARC
(owner-paused) · Square SANDBOX → production (owner's call) · VAPID push secrets, never set ·
`orgs.rules_url` after the domain transfer · Twilio / A2P **frozen by owner**.

---

## Standing rules

1. **Square SANDBOX ONLY** until the owner says go. Same for email.
2. Every file carries a date and version; one CHANGELOG entry per release.
3. **Delivery is DIRECT COMMIT** (owner 2026-08-02, `CLAUDE.md` §2). Preflight must print CLEAR → commit to `main` → push → `gh run watch` → **fill the CHANGELOG stub CI writes, in the same session.** The ZIP convention and both manifest ratchets are **retired**; GitHub is no longer read-only. `CLAUDE.md` §2 is the authority and this line is deliberately a pointer rather than a second copy — the duplicate copy is what kept this rule wrong for thirty releases.
4. DB changes via Cloudflare MCP, **additive-only**, numbered `00NN` in `db/migrations/`. Test rows use IDs 90000–90999 and are always wiped. *(The former clause exempting "owner's sandbox demo contacts 90001–90008 — never touch them" is **struck**. It dates from the hand-run seed-SQL era, when those eight rows could only be removed by a CLEANUP block. Since `sandbox.js` v2.0 shipped in v0.67.0 the generator **recreates 90001–90008 identically** — same ids, names and emails, as the first eight of its forty-eight contacts — so the range is regenerable and the exemption protects nothing. `wipe` has deleted them since v0.67.0 and `sandbox_seed.test.mjs` asserts it, so the rule had already stopped being in force; this records that rather than leaving code and README disagreeing.)*
5. Migrations are applied via Cloudflare MCP **before** the push that needs them, never as an optional step (D-MIG-2). Every migration ends with its own `schema_migrations` ledger INSERT, and the row is read back after. The CI schema-gate fails closed on an unapplied migration.
6. Validation gate before every release: `node worker/scripts/preflight.mjs` must print **CLEAR**. It runs `node --check` on every module, the full suite (measured, never projected), the test-file parity gate, and version parity against `/api/health`.
7. Where a required fact is unknown, ship a **visibly marked blank** (`[STREET ADDRESS]`), never a plausible invention (D-DOC-3).
8. Design and build system of record: **`docs/2026-07-30_standards_v2_0.md`** (in this repo; its header reads v2.2). The former pointer to `2026-07-25_design-and-build-standards_v1_1.md` "(project knowledge)" named a file that no longer exists in a location that no longer applies. UI work additionally loads the mandated skill roster — standards §5.
9. **Page and asset split** (standards §11): a page gets its own `web/assets/<page>.js` when it fetches from the API or holds state; a pure-markup page keeps its script inline.

---

## Start here

- New to the repo: **`CLAUDE.md`** — read order, trust order, session protocol. Then `docs/INDEX.md`.
- Latest session handoff: **`docs/2026-08-03_handoff_v0_82_0.md`** — the state of record. Superseded handoffs are deleted, so there is only ever one; if this pointer names a file that is not there, trust `docs/INDEX.md` §1 over this line.
- What works right now: open `web/admin-buildstatus.html`
- Setup: `docs/2026-07-21_setup-guide_v0.1.md`

---
*Changelog: v0.53.1 (2026-08-02) — external-review patch: idempotent DOM badge, network-independent Sign out, two guard defects closed; suite 644. · v0.53.0 (2026-08-02) — unified static member header, brand rename applied (D-ORG-5) + repo-wide sweep, single-source member theme/logout; suite 631. · v0.52.0 (2026-08-02) — unified static admin header + org switcher everywhere + pre-paint theme + demo-v4 glass; suite 616. · v0.51.0 (2026-08-02) — admin announcements authoring page, shared button set, pre-paint collapse; suite 604. · v0.50.0 (2026-08-02) — brought current: suite 588, migrations through 0033 (82 tables), module table v0.25–v0.50, roadmap replaced with the uiux-review §6 queue + live blocker list, handoff pointer updated. · v0.24.0 (2026-07-26) — full rewrite from the stale v0.12.0 README: module table brought current through v0.24.0, build-status marker legend added, architecture table rewritten with the real route pattern and test count, roadmap replaced with a v7 pointer, standing rules updated for D-MIG-2 and D-DOC-3. · 2026-07-24 — v0.2 → v0.12.0.*
