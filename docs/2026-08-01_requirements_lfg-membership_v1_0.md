# Boomtown Platform — Requirements of Record: Player Finder (LFG), Membership Fields, Opportunities Feed
File: 2026-08-01_requirements_lfg-membership_v1_0.md · Version: v1.0 · Date: 2026-08-01
Source: owner message 2026-08-01 (verbatim intent captured below) + competitor grounding (LeagueApps free-agent model, TeamSnap availability). Status: SPEC — awaiting owner answers in §4 before any build.

## 1. Player Finder ("LFG") — owner requirement, captured

Owner intent (2026-08-01): its own tab; two-way — (1) subs looking to sub, (2) teams looking
for subs and posting it. NO skill rating of players; instead a simple **reliability** signal
(shows up vs. bails). Uses search + criteria from the membership profile. Notifications on/off.
Member home screen gets a small **playing opportunities** window (toggleable, ON by default)
surfacing upcoming tournaments, leagues, and subbing opportunities that match their criteria.
Soft CTA: "Need a team →" leads to team builder → player can set themselves available and be
posted in a pool of available/interested players for a tournament. Modeled on World of
Warcraft's Looking-for-Group: teams post their listing + needs online. Covers tournaments,
leagues, AND casual play.

### 1.1 Structured spec (draft)
- **Two listing types:** `player_available` (a member posts availability: positions, level,
  gender division from profile; date window; play types: tournament/league/casual) and
  `team_need` (a captain posts: event or casual slot, positions needed, count, level).
- **Matching:** search across the opposite listing type using membership-profile criteria
  (positions, skill_level, gender_division already exist on `profiles`).
- **Industry anchor:** this is the "free agent" pool concept (LeagueApps' registered-individual-
  unassigned-to-team), extended to casual play and made two-sided like WoW LFG.
- **Reliability, not skill:** per-member counters — `committed`, `showed`, `bailed`
  (bail = withdrew after committing inside a window, or no-show confirmed by captain).
  Displayed as a simple mark (e.g., "12 of 13 showed"). Never a star rating; never editable
  prose reviews. Existing `checkins` table is the show-up source of truth where applicable.
- **Opportunities feed (member home):** compact card list — upcoming tournaments, leagues,
  sub requests matching profile criteria; per-category toggles; ON by default; ties into the
  existing push/notifications module for alerts.
- **Sub finder relationship:** migration 0026 already shipped a sub-finder foundation
  (`waitlists`/subs module) — the LFG tab supersedes/absorbs the subs UX; audit before building.

### 1.2 Explicitly out (owner said)
- Player skill ratings / reviews of players. Any "rate this player" UI.

## 2. Membership system — custom profile fields
Owner intent: add fields from the system to membership profiles and remove them (make them
seen/unseen on forms) as needed; "more robust membership system similar to other systems."

Draft: an org-scoped **field registry** (name, type, options, member-visible?, shown-on-forms?,
required?, sort) + per-contact values; admin toggles visibility without deleting data (hide ≠
delete, standards §3 additive discipline). Reuses the `form_fields` pattern already in the
codebase (per-event custom fields exist — this generalizes them to the membership profile).

## 3. Also queued from the same owner message
- **Full-UI review + layout modernization pass** — every page, one dedicated session, design
  skills roster, before/after screenshots via Chrome MCP.
- **End-to-end testing structure** that flows through the whole process (member signup →
  register → pay → check in → play → notify), scripted against a seeded sandbox org.
- **Requirement specs for existing modules** (tournaments, leagues, member management)
  benchmarked against LeagueApps / TeamSnap / SportsEngine feature sets, then owner interview.

## 4. Open questions — owner must answer before LFG build
1. Who can post a `team_need` — any member, or captains/staff only?
2. Casual play listings: tied to a facility time slot (court booking) or free-form date/time?
3. Reliability window: how long before game time does a withdrawal count as a "bail"? (Draft: 24h.)
4. Who confirms a no-show — captain, staff, or kiosk check-in absence automatically?
5. Contact between parties: in-app message thread only (messages.js exists), or expose phone/email?
6. Minors: is the LFG pool adults-only? (Guardian/kiosk rules suggest restricting to 18+ initially.)
7. Does "Need a team →" create a team shell immediately, or only after 2+ players join?
