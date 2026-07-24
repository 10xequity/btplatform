# Boomtown Athletics Platform
**Version:** v0.12.0 · **Date:** 2026-07-24

Multi-org sports operations platform for **Boomtown Volleyball · Match Point Social · Queens Club** plus 7 facility-operator orgs (Colorado Boom, Oda Up, RMR, Real Futsal, Special Olympics CO, Zara Gymnastics, External/Rental).

**Live:** https://10xequity.github.io/btplatform/web/ · API: Cloudflare Worker `boomtown-api` (`/api/health` reports the deployed version)

## Architecture
- `web/` — static frontend (GitHub Pages). No build step; every page carries a `?v=` cache-bust.
- `worker/` — Cloudflare Worker API (`worker/src/index.js` mounts all module routes). Auto-deploys via Actions **Deploy Worker** on any `worker/**` push.
- `db/migrations/` — schema of record. **0001–0008 applied live** to D1 `boomtown-prod` (52 tables). Migrations are applied by Claude via Cloudflare MCP (additive-only); the SQL files in this repo are records — never re-run them.
- `docs/` — install guides, handoffs, roadmap docs (naming: `YYYY-MM-DD_name_vX_Y.md`).

## Modules (built → v0.12.0)
| # | Module | Since |
|---|---|---|
| 1–2 | Auth (magic link + passkeys), multi-org foundation, tournament engine + live ops | v0.2 |
| 3–4 | Registration + Square (SANDBOX) + captain scoring | v0.3.0 |
| 5 | Schedule views/public feed, admin users/roles, event templates/recurring/CSV | v0.4.0 |
| 6 | Member profiles, family accounts, guardian waivers, results résumé, ICS | v0.5.0 |
| 7 | Leagues (weekly scheduler), sales reports, notifications, cron reminders | v0.7.0 |
| 8 | Control Center dashboard | v0.8.0 |
| 9 | Check-in & attendance (door roster, QR self-check-in) | v0.9.0 |
| 10 | Memberships & recurring billing (Square subscriptions) | v0.10.0 |
| 11/11.5 | UX & navigation hardening + sandbox demo tools | v0.11.0 |
| 12A | Court & Facility Management (space atoms, presets, conflict engine, CSV import) | v0.12.0 |

## Roadmap (owner-approved order)
M12 Phase B (court auto-claim) → M13 Security & Recovery → M14 Marketing & comms → M15 POS-lite → Waitlists → PWA/push → M16 Optimization + QA hardening.
See `docs/2026-07-24_ux-polish-roadmap_v1_0.md` and `docs/2026-07-24_module-recommendations_v1_0.md`.

## Standing rules
1. **Square SANDBOX ONLY** until owner says go. 2. Every file carries date + version; CHANGELOG entry per release. 3. Owner deploys worker/web changes by copy-paste from delivered ZIPs with explicit NEW/REPLACE + paste-order instructions. 4. DB changes via MCP, additive-only; test data IDs 90000–90999. 5. Validation gate before every delivery (`node --check` → esbuild → tests → version-in-bundle). 6. Design system of record: `2026-07-22_design-system_v1_0.md` (project knowledge).

**Start here:** `docs/2026-07-21_setup-guide_v0.1.md` · Latest handoff: `docs/2026-07-24_handoff_v1_5.md`

---
*Changelog: 2026-07-24 — updated v0.2 → v0.12.0; module table, roadmap links, standing rules added.*
