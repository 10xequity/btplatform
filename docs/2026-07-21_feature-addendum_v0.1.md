# Boomtown Platform — Feature Addendum (commercial-parity gap analysis)
**Version:** v0.1 · **Date:** 2026-07-21 · **Companion to:** design spec v0.1 §3
**Purpose:** you asked me to take initiative on features you didn't list. This is everything a
commercial operator (volleyballlife, gymdesk, mindbody-class systems) ships that your 24-item
intake didn't explicitly name, sorted by when it should land. Items marked ✅ are already built.

## Already added on my initiative (in v0.2)
- ✅ **Score-wipe protection** — regenerating a schedule with scored games requires explicit confirmation (mid-day regeneration, spec UC-T2, without losing the morning's results by accident).
- ✅ **Bye/work (ref) column** on the grid — ref assignments auto-rotate through each round's bye teams, like your paper sheets.
- ✅ **One-tap feasibility fixes** — when a format doesn't fit the time budget, the fix suggestions are buttons, not advice.
- ✅ **CSV export + print stylesheet** — the grid prints as a clipboard pool sheet; standings/schedule export to CSV.
- ✅ **Live constraint warnings after drag-edits** — amber, never blocking (operator override wins).
- ✅ **Audit trail on every write** — who did what, when, in `audit_log`.
- ✅ **Regression test suite for the engine** — every observed Boomtown format is asserted (pairings, byes ±1, optimal round counts, tiebreaks, bracket seeding). Run automatically before any engine change.

## Should add — Phase 1.5 (before first live event)
| Feature | Source pattern | Why it matters |
|---|---|---|
| **Waitlist w/ auto-promote** | mindbody, volleyballlife bids | Full event → next team auto-offered the spot when one drops; holds payment link 24h |
| **Refund + cancellation policy** | every commercial system | Admin-issued Square refunds from our screen; per-event cutoff date; partial refunds |
| **Event duplication** ("run it back") | gymdesk | Clone last month's tournament in 1 click — biggest real time-saver for recurring events |
| **Team no-show flow** | your UC-T2, formalized | Mark team no-show → engine reschedules only unplayed games, preserves scores |
| **Admin TOTP** | table stakes | Second factor before real member data (spec §3.8) — committed for v0.3 |

## Should add — Phase 2 (with leagues/profiles)
| Feature | Source pattern | Why |
|---|---|---|
| **Season points / rankings series** | volleyballlife "Point Systems" | Cross-event player rankings per org — their signature retention feature |
| **ICS calendar feed** | gymdesk/mindbody | "Add to calendar" per event + subscribe-to-org feed |
| **Attendance & no-show reports** | gymdesk | Feeds marketing segments ("lapsed players") |
| **PWA install manifest + offline shell** | modern default | Home-screen app per spec §3.8; offline kiosk queue is spec'd for Phase 2 |
| **Restore (un-delete) screen** | ops safety | Everything soft-deletes already; give admin a trash can with restore |
| **Score correction log** | integrity | Edits after standings freeze show an amber "corrected" marker |

## Should add — Phase 3 (growth)
| Feature | Source pattern | Why |
|---|---|---|
| **Public event listing page per org** | volleyballlife | SEO-friendly `/[org]/tournaments` with results history |
| **Player results résumé** | volleyballlife | Auto-built from standings history (spec §3.4 hook exists) |
| **Automated email journeys** | HubSpot/Brevo | Welcome, post-event "register for next", waiver expiry (30/7-day already spec'd) |
| **Gift cards / credit balances** | mindbody, Square | Square Gift Cards API — no custom money storage |
| **Multi-day / multi-division events** | volleyballlife | Divisions as pools with independent brackets; schema already supports via `pools` |

## Explicitly rejected (with reason)
- **Per-game player stats (kills/digs)** — spec D7 default is standings-only; scoring UX cost is huge.
- **Native app stores** — PWA covers it at $0 (spec §3.8).
- **Building our own BI/email/payment rails** — buy-not-build analysis in spec §7 stands.

---
*Changelog: v0.1 (2026-07-21) — initial gap analysis vs. volleyballlife/gymdesk/mindbody patterns.*
