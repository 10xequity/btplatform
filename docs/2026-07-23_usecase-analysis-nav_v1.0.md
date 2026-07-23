# Boomtown Platform — Navigation & Settings Use-Case Analysis
**Document:** 2026-07-23_usecase-analysis-nav_v1.0 · **Version:** v1.0 · **Date:** 2026-07-23
**References studied:** gymdesk.com, volleyballlife.com (per Website_references) · **Ships with:** v0.6.0

## What the references do that we adopted
**Gymdesk** — [INTERPRETATION from their public product tour] one persistent left rail for the whole product (members, schedule, billing, settings), the same rail on every screen, settings as a first-class destination (account, security, notifications) rather than buried links. Adopted as `site-nav.js`: one sidebar on every page, role-aware, collapsing to a horizontal scroll bar on phones.

**Volleyballlife** — leagues and tournaments are separate first-class sections with their own listings and standings; every page can get you home in one tap. Adopted as: dedicated `leagues.html` (no longer a footnote under tournaments) and an explicit "← Home" button in every header (the wordmark link alone tested as too subtle — your exact report on the schedule page).

## Use cases delivered (v0.6.0)
| ID | Use case | Path | Clicks |
|---|---|---|---|
| UC-N1 | Get home from any page | ← Home button or sidebar Home | 1 |
| UC-N2 | Member signs in | Home → Member tab (default) → email link | 2 + email tap |
| UC-N3 | Manager signs in | Home → Manager tab → passkey (Face ID) | 3, no typing |
| UC-N4 | Find a league & register | Sidebar → Leagues → Register | 3 |
| UC-N5 | Staff opens member management | Dashboard card or sidebar → Member Management | 1 |
| UC-N6 | Add a passkey / remove a device | Settings → Sign-in & security → Add / Remove | 2–3 |
| UC-N7 | Toggle theme / reminders | Settings → one tap each | 2 |
| UC-N8 | Foundation status & roles | Dashboard Foundation card → Settings#System | 1 |

## Deliberate deviations from the references
- No password/2FA screens (gymdesk has both): passkeys are password **and** second factor in one gesture; email link is the universal fallback. Settings says this in plain language.
- Username/email change is request-to-staff, not self-serve: email is the sign-in identity in a magic-link system; self-serve change without a second verified factor would let a stolen session steal the account. [FACT] The backend has no change-email endpoint as of v0.5.0 — flagged in handoff v0.8 as a candidate v0.7 worker feature (verify-new-address flow).
- League season standings/sub-finder are Phase 2 (`league_weeks` tables) — the Leagues page is their landing spot and says so.
