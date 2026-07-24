# Module 9 Install — v0.8.0 (Control Center + Streamlined UI)
**File:** docs/2026-07-23_module9-install_v0.8.0.md · **Version:** v0.8.0 · **Date:** 2026-07-23
**Time needed:** ~8 minutes · **Depends on:** v0.7.0 must be pasted FIRST (module 8 install doc), including migration 0005.

---

## What you're installing
Your manager home page is rebuilt as a **Control Center** — the pattern the best gym-management
products use for their first screen. One glance answers the daily questions:
- **How's money?** Received this month (card vs cash) and what's still outstanding.
- **Who owes me?** Unpaid registrations with **Remind** and **Rerun payment** buttons right there —
  no clicking into the Registrations page for routine follow-up.
- **What's happening?** Today's and upcoming events with a LIVE flag, assigned staff, reg counts, and an Open button.
- **Is the business moving?** Registrations per day for the last 7 days.
- **Anything need me?** Cash-pending flags and system alerts in one feed.

Plus a light streamline pass across all admin pages: calmer spacing, capped content width, quieter tables.

## Step 1 — Prerequisite check
1. v0.7.0 files are pasted and `…/api/health` says `"version":"v0.7.0"`.
2. Migration 0005 is applied (module 8 install doc, Step 1). The dashboard will half-load without it
   (staff names and alerts columns come from that migration).

## Step 2 — Copy-paste the files
Same routine: open the path on GitHub → pencil icon (or **Add file → Create new file** for NEW) →
paste from the ZIP → **Commit changes**.

**Worker (auto-deploys on commit):**
| # | Path | New? |
|---|------|------|
| 1 | `worker/src/index.js` | edit |
| 2 | `worker/src/reports.js` | edit |
| 3 | `wrangler.toml` | edit |

**Web:**
| # | Path | New? |
|---|------|------|
| 4 | `web/admin.html` | edit (full rewrite) |
| 5 | `web/assets/admin-dash.js` | **NEW** |
| 6 | `web/assets/admin.css` | edit |

**Docs (recommended):** `CHANGELOG.md`, this file, `docs/2026-07-23_handoff_v1_0.md`.

## Step 3 — Verify (3 minutes)
1. `…/api/health` → `"version":"v0.8.0"` (1–2 min after the worker commits).
2. Hard-refresh (**Ctrl+F5**) → open **Manager Home**. You should see: greeting with today's date,
   quick-action buttons, four KPI cards, Today & Next Up, Money Outstanding, the 7-day chart,
   and Needs Attention.
3. If you have an unpaid test registration, click **Remind** on it right from the dashboard —
   the status line under the list confirms, and in sandbox mode it shows a copyable link.

## Notes
- No database changes in v0.8.0 — it reads through migration 0005.
- The old `web/assets/admin.js` stays in the repo but is no longer used by admin.html. Safe to ignore.
