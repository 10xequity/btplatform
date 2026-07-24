# Module 10 Install — v0.9.0 (Check-in & Attendance)
**File:** docs/2026-07-23_module10-install_v0.9.0.md · **Version:** v0.9.0 · **Date:** 2026-07-23
**Time needed:** ~12 minutes · **Depends on:** v0.7.0 AND v0.8.0 pasted first, migrations 0005 applied.

---

## What you're installing
The day-of-event door workflow:
- **Door Check-in page** — pick the event (today's is auto-selected), see everyone grouped by
  team, and tap a name to check them in. Tap again to undo. People with **no signed waiver
  show a red flag** so you catch it before they step on the court.
- **Search** — type a few letters, jump straight to the name. **Walk-in** button for anyone
  not on a roster.
- **Self check-in QR** — one button makes a QR code you can print or prop on a tablet.
  Players scan, type their email, and they're in. **Rotate** kills the old code instantly
  if it leaks.
- **Attendance history** — every check-in is recorded per member (this powers retention
  reports and the membership module coming next).

## Step 1 — Database update (0006)
Same drill as migration 0005 (module 8 doc §1). **Run 0005 first if you haven't.**
Paste the contents of `db/2026-07-23_0006_attendance_v1.0.sql` into the D1 console for
**boomtown-prod** → Execute. Additions only — nothing is modified or deleted.

## Step 2 — Copy-paste the files
| # | Path | New? |
|---|------|------|
| 1 | `worker/src/index.js` | edit |
| 2 | `worker/src/checkin.js` | **NEW** |
| 3 | `web/admin-checkin.html` | **NEW** |
| 4 | `web/assets/admin-checkin.js` | **NEW** |
| 5 | `web/checkin.html` | **NEW** |
| 6 | `web/assets/admin-nav.js` | edit |

**Docs (recommended):** `CHANGELOG.md`, this file, `db/2026-07-23_0006_attendance_v1.0.sql`,
`docs/2026-07-23_handoff_v1_1.md`.

## Step 3 — Verify (5 minutes)
1. `…/api/health` → `"version":"v0.9.0"`.
2. Hard-refresh → the manager sidebar now shows **Check-in** under Run events.
3. Open Check-in → pick an event with teams → the roster appears grouped by team.
4. Tap a name → it turns green with a ✓ and the counter ticks up. Tap again → undone.
5. Click **Self check-in QR** → a QR + link appear. Open the link on your phone, enter a
   registered email → "You're in!" and the roster updates on the desk screen after a refresh.
6. Anyone without a waiver shows **NO WAIVER** in red.

## Notes
- The QR square comes from a small open-source library loaded from cdnjs; if a venue's
  wifi blocks it, the copyable link still works.
- Self check-ins from emails not on a roster are recorded as unverified and told to see
  the desk — nothing is silently lost.
- Rotating the QR is instant and free — do it every event if you like.
