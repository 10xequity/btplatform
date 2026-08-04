# Install — v0.6.0 (Navigation, Member/Manager Login, Leagues, Settings)
**Document:** 2026-07-23_module7-install_v0.6.0 · **Version:** v0.6.0 · **Date:** 2026-07-23
**No worker changes. No migrations. Frontend + one optional test-data SQL. Zero deploy risk to the API.**

## Step 1 — Upload files to GitHub (copy-paste, ~5 min)
On github.com → 10xequity/btplatform → open each path → pencil icon (or **Add file → Create new file** for NEW) → paste from the ZIP → **Commit changes** (green button). Commit message suggestion: `v0.6.0 navigation + settings + leagues`.

UPDATED (8): `web/index.html` · `web/schedule.html` · `web/profile.html` · `web/member.html` · `web/assets/app.js` · `web/assets/app.css` · `web/assets/admin-nav.js` · `CHANGELOG.md`
NEW (7): `web/settings.html` · `web/leagues.html` · `web/assets/site-nav.js` · `web/assets/settings.js` · `web/assets/leagues.js` · `db/2026-07-23_seed-testdata_v1.0.sql` · `docs/2026-07-23_usecase-analysis-nav_v1.0.md` (+ this doc + handoff v0.8)

GitHub Pages republishes automatically in ~1–2 minutes.

## Step 2 — Test data (optional but recommended)
The seed file is **not** a migration — it only INSERTs clearly-marked TEST rows (IDs 90000+, names prefixed "TEST", @example.com emails). Two ways to apply:
1. Ask Claude next session: "apply the v1.0 test seed via Cloudflare MCP" (established pattern), or
2. Cloudflare dashboard → Workers & Pages → D1 → `boomtown-prod` → Console → paste the file's INSERT statements → Run.
Remove later with the CLEANUP block at the bottom of the same file.

## Step 3 — Try it (5-minute checklist)
1. Hard-refresh the site (Ctrl+F5). Sign-in card now shows **Member | Manager** tabs.
2. Sign in → dashboard: every card is clickable, including **Foundation → Settings#System**, **Leagues**, **Member Management** (staff), **Settings**. Sidebar appears on the left (top bar on a phone).
3. Open **Schedule** → "← Home" button present; fonts in the org filter now match the rest of the page.
4. Open **Leagues** → after seeding you'll see "TEST Thursday Coed 4s League".
5. Open **Settings** → add a passkey (on the live site, not a preview), flip the reminder toggle, switch theme.
6. Tournament Ops → select "TEST Spring Slam" → grid, scores, and standings are pre-populated.
7. Embed check: `schedule.html?embed=1` still renders bare (no sidebar/header) for the website widget.

## Rollback
Frontend-only: revert the commit on GitHub (repo → Commits → ⋯ → Revert). Test data: run the CLEANUP block.
