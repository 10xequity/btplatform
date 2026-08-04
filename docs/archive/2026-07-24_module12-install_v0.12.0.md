# Boomtown Platform — Module 12 Install (Facility Calendar)
**File:** docs/2026-07-24_module12-install_v0.12.0.md · **Version:** v0.12.0 · **Date:** 2026-07-24
**Time needed:** ~10 minutes of pasting. **No database steps** — migration 0008 is already applied live.

## What you're installing
The **Facility Calendar**: a court-by-time grid of all 13 courts + 6 rooms. Book any operator
(Boomtown, Colorado Boom, Oda Up, rentals…) onto court sets like "Full Hardwood (VB 1–8)" or
"Basketball Ct 3 (VB 5–6)", and the system refuses double-bookings automatically — unless both
sides marked "Court Share OK", in which case it warns instead. Includes facility closures,
weekly repeating bookings, and a CSV importer for your old scheduler sheet.

## Files in this ZIP (7) — NEW vs REPLACE

| # | Repo path | Action |
|---|---|---|
| 1 | `worker/src/facility.js` | **NEW** |
| 2 | `worker/src/index.js` | **REPLACE** |
| 3 | `worker/test/facility.test.mjs` | **NEW** |
| 4 | `web/admin-facility.html` | **NEW** |
| 5 | `web/assets/admin-facility.js` | **NEW** |
| 6 | `web/assets/admin-nav.js` | **REPLACE** |
| 7 | `CHANGELOG.md` | **REPLACE** |
| 8 | `db/migrations/2026-07-24_0008_facility_v1_0.sql` | **NEW — record only. Never run it.** |
| 9 | `docs/2026-07-24_module12-install_v0.12.0.md` | **NEW** (this file) |

⚠️ **Paste order matters for two files: `facility.js` BEFORE `index.js`.**
(Same rule as the last two releases — index.js imports facility.js, and a push where the
import target doesn't exist yet makes the deploy fail.)

## Steps (GitHub web editor, same as always)
1. Go to **github.com/10xequity/btplatform**.
2. **NEW files:** navigate to the folder → **Add file → Create new file** → type the exact
   filename → paste the contents → **Commit changes**. Start with `worker/src/facility.js`.
3. **REPLACE files:** open the file → pencil icon (Edit) → select all → paste the new
   contents → **Commit changes**. Do `worker/src/index.js` only AFTER facility.js is committed.
4. Order that always works: 1 → 3 → 2 → 4 → 5 → 6 → 7 → 8 → 9.

## Verify (3 minutes)
1. **Actions:** repo → Actions tab → newest "Deploy Worker" run is **green** (it triggers on the
   index.js commit). If it's red, the near-certain cause is paste order — recommit facility.js,
   then recommit index.js.
2. **API:** open `https://boomtown-api.vvisuth.workers.dev/api/health` — it must say **v0.12.0**.
3. **Page:** open the admin site → sidebar → Run events → **Facility Calendar**
   (hard-refresh Ctrl+F5 if the menu item hasn't appeared yet — GitHub Pages caches assets
   for up to ~10 minutes).
4. **Round trip:** New booking → title "Test rental", operator External / Rental, today
   6:00–8:00 PM, preset "Basketball Ct 3 (VB 5–6)" → Book it → the block appears on VB 5 and VB 6.
   Now book "Test clash" on VB 6, 7:00–9:00 PM → it must be **blocked** with a conflict panel.
   Turn **Court Share OK** on for BOTH bookings (edit the first, retry the second) → it becomes a
   warning with a "Book anyway (shared)" button. Delete both test bookings when done.
5. **Closure:** Add closure → whole facility, any future date → try booking anything that day →
   blocked (closures ignore Court Share by design).
6. **Import:** Import CSV → paste the two-line example already shown in the box → Preview →
   1 row would import → Import → the booking appears. Delete it.

## Notes
- The preset list (especially which VB courts each **basketball overlay** maps to) was inferred
  from your Calendar file — [INTERPRETATION]. If Ct 1–4 map differently, say so and it's a
  one-line DB fix, no code paste.
- 7 operator organizations were added (Colorado Boom, Oda Up, RMR, Real Futsal, Special
  Olympics CO, Zara Gymnastics, External/Rental). They appear in the org switcher; they exist
  so facility bookings carry the right brand color. "Match Point Social" (org 2) was treated as
  your MPC operator — [INTERPRETATION], correct me if MPC is something else.
- The importer accepts your old sheet's CSV export; unknown columns are simply ignored. If a
  column you care about isn't being picked up, send one sample row and the mapping gets extended.
- Phase B (tournaments/leagues auto-claiming courts on the calendar) ships as its own small
  release so this paste stays low-risk.

---
*Changelog: v0.12.0 (2026-07-24) — initial install doc for Module 12 Phase A.*
