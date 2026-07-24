# Install — v0.9.1 (Recovery: restores the lost v0.7.0 files, un-breaks the worker deploy)
**Document:** 2026-07-24_module8-recovery-install_v0.9.1 · **Version:** v0.9.1 · **Date:** 2026-07-24

**Why this release exists:** [FACT] The v0.7.0 ZIP was never pasted (repo history: v0.6.0 → v0.8.0 → v0.9.0). The code you pasted for v0.8/v0.9 depends on v0.7.0 worker files, so **the last two worker deploys failed** and the live API is still v0.5.0. This one paste fixes the deploy and delivers everything v0.7.0 was supposed to: League Manager, Sales & Reports, notifications + bell, member dashboard, teammate invites, retry-payment, the waiver cron, and the dark-mode form fixes. **No database steps — migration 0005 is already applied.**

## Step 1 — Upload files to GitHub (copy-paste, ~10 min)
On github.com → **10xequity/btplatform** → open each path → pencil icon to edit (or **Add file → Create new file** for NEW) → paste from the ZIP → **Commit changes**. Commit message suggestion: `v0.9.1 recovery — restore lost v0.7.0 files`.

UPDATED (5):
1. `worker/src/registrations.js`
2. `worker/src/index.js`
3. `web/assets/site-nav.js`
4. `web/assets/tokens.css`
5. `CHANGELOG.md`

NEW (10):
6. `worker/src/leagues_admin.js`  ← this one un-breaks the deploy
7. `web/admin-league.html`
8. `web/assets/admin-league.js`
9. `web/admin-reports.html`
10. `web/assets/admin-reports.js`
11. `web/home.html`
12. `web/home.js`
13. `db/2026-07-24_0005_leagues-notifications_v1.0.sql`  (record only — never run it)
14. `docs/2026-07-24_module8-recovery-install_v0.9.1.md` (this doc)
15. `docs/2026-07-24_handoff_v1_3.md`

Order doesn't matter EXCEPT: paste **all three worker files (items 1, 2, 6)** — if you stop halfway through those, the deploy stays red until you finish.

## Step 2 — Confirm the deploy is green (2 min)
1. Repo → **Actions** tab → the newest **"Deploy Worker"** run should turn **green** in ~1–2 minutes. (The last two runs there are red — that's the bug this fixes.)
2. Open `https://boomtown-api.vvisuth.workers.dev/api/health` in your browser → it should say `"version":"v0.9.1"`. If it still says v0.5.0, hard-refresh; if the Actions run is red, copy the red step's log into the next Claude chat.

## Step 3 — Try it (5-minute checklist, uses the TEST seed data)
1. Hard-refresh the site (Ctrl+F5). Sign in as manager.
2. **Control Center (Dashboard):** the KPI row, Money Outstanding, and 7-day chart now load real data (they needed the v0.9.1 API). Try **Rerun** on an unpaid TEST registration — sandbox mode returns a message instead of an email. ✔
3. **League Manager** (sidebar → Run events): "TEST Thursday Coed 4s League" auto-selects. Set team levels → **Save levels** → **Generate next week** → score a game with the 2-tap flow → standings update. Try **Remove week** on an unscored week.
4. **Sales & Reports** (sidebar → Money): totals, month bars, tables render; **Download CSV** works.
5. **Check-in** now works end to end (its API was dead until this deploy): pick the TEST event, tap someone in.
6. **Member side:** open **My Dashboard** (left rail, signed in) — notifications, upcoming events, your teams. The **Notifications** rail item shows an unread badge once the cron or a cash-pending flag writes one.
7. **Dark-mode fix:** open any form (e.g. Settings) — inputs and dropdown menus are now dark-themed, not white-on-white.

If pages look stale, GitHub Pages caches for ~10 minutes — Ctrl+F5 after that.

## Rollback
Frontend + worker are one commit set: repo → Commits → ⋯ → **Revert** on the v0.9.1 commits. Reverting `leagues_admin.js` re-breaks the worker deploy (expected — it returns to today's state). No DB changes to roll back.

## Known deferred items (documented, not blocking)
- `web/assets/logo.jpg` was lost with v0.7.0 (binary — re-add anytime via "Upload files"). The text wordmark shows meanwhile.
- Waiver text is still the v1 PLACEHOLDER — blocks real go-live (unchanged).
- Emails stay in sandbox until the Brevo key is set (unchanged).
