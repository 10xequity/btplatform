# Boomtown Platform — Decisions: Org Roster & Payments Binding
**File:** 2026-08-01_decisions_org-roster_v1_1.md · **Version:** v1.1 · **Date:** 2026-08-01
**Supersedes:** v1.0 (adds §F, the live-D1 scan result). **Source:** owner Q10 answers + live D1 read
(db 6cde5d11…, read-only) 2026-08-01. **Status:** DECIDED; delete set §F awaits owner confirm on 2 orgs.

## A. Final org roster (the keep-set)
| Org (current name → target) | id | Role | Payments |
|---|---|---|---|
| **Boomtown Volleyball → Boomtown Athletics (BTA)** | 1 | **Primary** | Square (connect post-launch) |
| **Match Point Social (MPS)** | 2 | Standalone | **Stripe** (connect post-launch) |
| **Queens Club** | 3 | Part of BT | Inherits BTA (seeded binding §C) |
| **Colorado Boom (COBO)** | 4 | **Standalone** — flip `active 0→1` | Own account (connect post-launch) |

**D-ORG-5** (roster), **D-ORG-7** (Queens→BTA seeded `payments_parent_org_id`, no literal — see §C v1.0),
unchanged. Org 1 gets a **name update** to "Boomtown Athletics" (additive UPDATE, not a new row).

## B–E — unchanged from v1.0
Delete-gating rule (D-ORG-6), Queens binding (C), post-launch connect buttons (D), downstream doc
edits (E) as written in v1.0.

## F. Live D1 scan result (2026-08-01, read-only) — NEW
Ran the §B guard. `orgs` holds 10 rows; the 6 non-keep orgs are **all `active=0` and carry ZERO rows**
across every org-scoped table checked (contacts, events, registrations, payments, teams, form_responses,
user_org_roles, rental_requests, waivers, membership_grants, standings, documents, uploads, campaigns,
notifications, event_templates, membership_tiers, sponsors, schedule_views, programs). They are empty
placeholder shells. Then grepped the code for hardcoded references — this is where 2 of the 6 stopped
being clean deletes:

| id | name | data rows | code ref found | Call |
|---|---|---|---|---|
| 6 | Rocky Mountain Rumble | 0 | none | **DELETE** — safe |
| 7 | Real Futsal | 0 | test fixture only | **DELETE** — safe (owner's "real") |
| 8 | Special Olympics CO | 0 | none | **DELETE** — safe |
| 9 | Zara Gymnastics | 0 | test fixture only | **DELETE** — safe (owner's "zara") |
| 5 | Oda Up | 0 | **live UI label** `admin-facility.js:184` "Bar staff (Oda Up)" | **HOLD** — looks like the bar/concessions vendor, not junk. Confirm. |
| 10 | External / Rental | 0 | facility "operator" concept | **KEEP (deactivate)** — reads as a system bucket for outside rentals, not a company. |

**D-ORG-8:** Delete migration targets **orgs 6, 7, 8, 9** only (zero data, no meaningful code dependency),
each with a reseed `INSERT` in the migration comment. **Orgs 5 and 10 are excluded pending owner confirm**
(§F table). Separately, the hardcoded "Oda Up" / "External / Rental" strings in the facility module are a
standards §10 token violation to clean up regardless of the org decision.

**Open confirms for the owner:**
- **C-1** Oda Up (5): is this your bar/concessions vendor (keep) or junk (delete)?
- **C-2** External / Rental (10): keep as a deactivated system org (recommended) or delete?

---
*Changelog: v1.1 (2026-08-01) — appended §F live-D1 scan: all 6 non-keep orgs are empty, but code-grep flagged Oda Up (live facility label) and External/Rental (system bucket); delete narrowed to orgs 6–9 (D-ORG-8), 5 & 10 held for owner confirm. v1.0 decisions A–E unchanged.*
