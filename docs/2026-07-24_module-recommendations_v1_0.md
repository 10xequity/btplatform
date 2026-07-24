# Module Recommendations — Reference-System Gap Analysis (round 2)
**File:** 2026-07-24_module-recommendations_v1_0.md · **Version:** v1.0 · **Date:** 2026-07-24
**Supplements:** 2026-07-21_feature-addendum_v0.1.md (round 1 — waitlist, refunds, duplication, season points, ICS etc. already adopted into the roadmap)
**Reference systems:** volleyballlife · gymdesk · mindbody · CourtReserve/Playtomic (court booking) · TeamSnap/LeagueApps (team ops) · HubSpot/Brevo

New candidates only — items not already on the M12B–M16 roadmap. Effort: S ≤ half a module ZIP · M = one module · L = multi-module.

## Recommend — ADD to roadmap
| # | Module | Source pattern | Value | Effort | Suggested slot |
|---|---|---|---|---|---|
| R-01 | **Public court-rental booking + self-serve payment** — members book open atoms on the facility calendar; conflict engine + Square checkout links already exist | CourtReserve, Playtomic | Direct new revenue on idle court hours; the hard part (conflict engine, migration 0008 schema) is already built | M | **M12 Phase C** (after Phase B; reuses everything) |
| R-02 | **Court-utilization heatmap** — % booked by space × hour/day from `space_bookings` | gymdesk analytics, Playtomic | Pricing + scheduling decisions; data exists as of 0008; read-only report | S | with M15 reports or M16 |
| R-03 | **Discount / promo codes** — Square Discounts applied at checkout-link creation; usage caps + expiry | mindbody, LeagueApps | Early-bird + referral campaigns for M14 marketing without touching money logic ourselves | S | M14 |
| R-04 | **Installment / deposit payments** — deposit now, balance by cutoff, on the existing Square checkout flow | LeagueApps | Removes the biggest league-fee objection ($200+ team fees); statuses extend the existing vocabulary (`deposit-paid`) | M | M14 or M15 |
| R-05 | **Staff/volunteer shift assignment** — assign refs/coaches/door staff to events; feeds check-in roster; ICS per staffer | gymdesk staff mgmt | Formalizes the whiteboard; reuses ref/bye rotation data from the engine | M | M15 |
| R-06 | **Sponsor slots on public pages** — sponsor logo strip on standings/schedule embeds, per-org config | volleyballlife | $0-cost revenue channel; public pages already get event-day traffic | S | M14 |

## Consider — DEFER (revisit after go-live)
| # | Module | Source | Reason to defer |
|---|---|---|---|
| D-01 | Team chat threads (captain↔roster messaging) | TeamSnap | M14 message relay/inbox covers the org→member direction; peer chat = moderation surface + notification infra. |
| D-02 | Event photo galleries (IG handle harvest → tagged albums) | volleyballlife community | Engagement play, not ops; needs R2 storage policy + consent handling beyond the media-release waiver text. |
| D-03 | Dynamic pricing (peak/off-peak court rates) | Playtomic | Needs R-01 utilization data for at least a season first. |

## Reject — with reason
| # | Module | Source | Reason |
|---|---|---|---|
| X-01 | Background-check / coach-compliance integration | SportsEngine | Per-check vendor fees; adult-rec focus today; revisit only if youth programs launch. |
| X-02 | Native mobile apps | mindbody | PWA slot already on roadmap covers it at $0 (prior decision, unchanged). |
| X-03 | In-house gift-card balance ledger | mindbody | If wanted, Square Gift Cards API only — never custom money storage (prior rule). |

**Net roadmap impact if all R-items adopted:** M12C (R-01) inserts after Phase B; R-03/R-06 fold into M14; R-02/R-05 fold into M15; R-04 owner's choice M14 vs M15. No new third-party services required — all six ride Square + the existing schema.

---
*Changelog: v1.0 (2026-07-24) — round-2 gap analysis vs court-booking and team-ops reference systems.*
