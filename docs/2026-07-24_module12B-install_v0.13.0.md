# Install v0.13.0 — M12 Phase B: Court Auto-Claim + Rental Requests
**File:** 2026-07-24_module12B-install_v0.13.0.md · **Version:** v0.13.0 · **Date:** 2026-07-24

## What this release does
1. **Auto-claim:** generating a tournament schedule or a league week now automatically reserves the courts on the Facility calendar. Defaults to VB 1..N; if a default court is busy it claims the next open court instead and tells you; drag/edit/delete the claim on the Facility calendar like any booking. Regenerating a schedule releases the old claim and makes a new one. Deleting a league week releases that week's claim.
2. **Rental requests:** signed-in members can submit a court-time request (the member form ships with the v0.14.0 member portal — the API is live now). Pending requests appear at the top of the Facility calendar with an Approve (pick a preset) / Decline panel. **Public self-serve court rental stays hidden**, per your decision.
3. Migration 0009 — **already applied live by me. Never run the SQL file.**

## Files in this ZIP — exact actions
Paste in GitHub web editor (repo `10xequity/btplatform`, branch `main`). **PASTE ORDER MATTERS for the worker files: do #1–#3 before #4.**

| # | File | Action |
|---|---|---|
| 1 | `worker/src/facility.js` | **REPLACE** (v1.1.0) |
| 2 | `worker/src/tournaments.js` | **REPLACE** (v0.4.0) |
| 3 | `worker/src/leagues_admin.js` | **REPLACE** (v1.2.0) |
| 4 | `worker/src/index.js` | **REPLACE** (v0.13.0) — paste LAST of the worker files |
| 5 | `worker/test/facility_claim.test.mjs` | **NEW** |
| 6 | `web/admin-facility.html` | **REPLACE** (v1.1.0) |
| 7 | `web/assets/admin-facility.js` | **REPLACE** (v1.1.0) |
| 8 | `db/migrations/2026-07-24_0009_facility-phase-b_v1_0.sql` | **NEW** (record only — never run) |
| 9 | `docs/2026-07-24_module12B-install_v0.13.0.md` | **NEW** (this file) |
| 10 | `docs/2026-07-24_ux-polish-roadmap_v1_0.md` | **NEW** |
| 11 | `docs/2026-07-24_module-recommendations_v1_0.md` | **NEW** |
| 12 | `docs/2026-07-24_handoff_v1_6.md` | **NEW** (add to project knowledge too — replaces v1.5) |
| 13 | `README.md` | **REPLACE** (repo root) |
| 14 | `CHANGELOG.md` | **REPLACE** (repo root) |

Each worker paste triggers the "Deploy Worker" Action — that's fine; only the final state matters. After #4, wait for the green check on the Actions tab.

## Verify (run in order, tell me results)
1. Open `https://boomtown-api.<your-worker-domain>/api/health` → shows `"version":"v0.13.0"`.
2. Admin → any **draft tournament** (or make one via the sandbox toolbar) → Generate schedule → the response banner mentions claimed courts → open **Facility Calendar** on the event's date → a gold Boomtown block titled with the event name covers VB 1..N.
3. Regenerate the same schedule → still exactly ONE claim block (old one released).
4. Book a manual booking on VB 1 at the same time first, then regenerate → the claim skips VB 1 and takes the next open court, with a "claimed open courts instead" note.
5. Drag/edit the claim block in the booking modal → saves like a normal booking.
6. League board → Generate week → claim appears on that week's date (start time + 3h). Delete the week → claim disappears.
7. Rental request: while signed in, from the browser console run:
   `fetch(BT.apiBase+'/api/rental-request',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Test Renter',email:'test@example.com',date:'2026-08-15',start:'18:00',end:'20:00',spaces_text:'2 courts',notes:'birthday'})})`
   → Facility Calendar now shows a **Rental requests (1 pending)** panel → pick a preset → Approve → a grey External/Rental block appears on Aug 15. (Then delete that test booking.)
8. Nothing else changed: score a game, open Registrations, open Dashboard — all normal.

## If something breaks
Actions tab red → almost always paste order; re-commit `facility.js`, then `index.js`. UI looks stale → hard-refresh (the new page uses `?v=0.13.0`).

---
*Changelog: v0.13.0 (2026-07-24) — initial.*
