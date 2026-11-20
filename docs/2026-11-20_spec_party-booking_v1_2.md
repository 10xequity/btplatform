# Party booking and space calendar — build prompt

**Version:** v1.2 · **Date:** 2026-11-20 · **Status:** Building — unit 1 shipped 2026-11-20 (migration 0055). v1.2 folds in the owner's second round of answers the same day: party-court and Zone 7 pricing per 3 hours, half-court basketball, Studio 1 and capacities, the $300 deposit, the 30% cancellation rule, winter availability (§3, §7) · **Supersedes:** v1.1 (same day; renamed in place)
**Use** Paste everything below the line into a new Claude Code session opened in `D:\github\repos\btplatform`.

---

You are extending the Boomtown Platform (this repo) so FieldhouseUSA Aurora can sell parties online without double-booking the building. Before anything else, read `CLAUDE.md`, `RALPH.md` and the tail of `LOOP.md`, and follow this repo's release ritual (one unit per release, migrations applied live first, ratchets moved with evidence, preflight CLEAR before each push). Do not start a new app. Module 12 (`worker/src/facility.js`, migrations 0008 and 0009) already has most of the machinery. Extend it.

## 1. The problem

- The owner tracks every booking in Google Sheets ("2027 Operations", id `18xDCz4hxT6lwer9o6Rb-C3Stb42TcyCCN4PL1rNdsoE`, owner boomtownvball@gmail.com).
  - The "Events 2027" tab has one row per day, with free-text columns for Hardwood, Sports Court, Evening, Event/Sports and Turf.
  - The "2026 Fall Schedule" tab is a weekly grid of Zones 1–7 in half-hour rows from 4 PM to 11 PM.
- The sheet cannot answer "is Zone 6 free Sunday at 4 PM?" once several events share a day. The owner says it is "very hard to track on that sheet with multiple events."
- The new public page `aurorafieldhouseusa.com/events.html` (repo `afh`, branch `v3`, files `events.html` and `assets/party.js`) sells parties at fixed prices. Today it emails a request; staff check the sheet by hand, then send a payment link.
- Goal: the facility calendar becomes the single source of truth, and the party page books held slots instantly with payment.

## 2. What already exists (verify each before building on it)

- **Atoms and presets.** The `spaces`, `space_presets` and `preset_spaces` tables hold 19 atoms: VB 1–13, Dance-Den 1–2, Yoga-Den, Social Den, Event-Den and Oda.
- **Bookings.** `space_bookings` and `booking_spaces` record bookings, with hard-conflict detection on date, time overlap and shared atoms. A soft "share" warning applies only when both sides set `share_ok`.
- **CSV import.** `POST /api/admin/facility/import` imports header-mapped CSV, with per-row errors and hard-conflict rows skipped.
- **Rental requests.** `rental_requests` holds requests that staff approve or decline. Approving one creates a booking under org 10 (External / Rental). Public self-serve rental was deliberately left **hidden**. The owner is now asking for instant booking, but only for **held party slots**, not for open court rental.
- **Payments.** Square quick-pay links (`createSquareLink` in `registrations.js`) are the payment path. The platform creates no Square catalog items, per the owner's decision in iteration 156; keep it that way.
- **Waivers.** A waiver module already exists. Guests who play must sign it.

## 3. Facts to encode (from the owner and the operations sheet, 2026-11-20)

**Courts.** The building has 15 volleyball courts. Atoms VB 1–13 are **wrong**; add VB 14 and VB 15. The zone presets come straight from the sheet's grid:

| Zone | Courts | Notes |
|---|---|---|
| 1 | 1–2 | Hardwood |
| 2 | 3–4 | Hardwood |
| 3 | 5–6 | Hardwood |
| 4 | 7–8 | Hardwood |
| 5 | 9–10 | "A1" |
| 6 | 11–12 | "SC", sports court beside the bar |
| 7 | 13–15 | Three courts. Also the futsal arena and the inflatables area |

- Basketball: Zones 1–4 are one basketball court each (4 in all). The existing presets map basketball courts to VB pairs; correct them to the zones above.
- Pickleball: 12 courts, 3 in each of Zones 1–4.

**Prices (owner's list):**

| Item | Price |
|---|---|
| Party room | $400 per 3 hours, setup and cleanup included, no food. The party room is **Studio 1**, which can be split in two. Parties currently get the whole studio, but **public copy never says so** |
| Volleyball court added to a party | **$150 for the whole 3 hours**, not per hour. Party pricing only; this is not the court rental rate |
| Basketball | **$200 full court or $100 half court**, for the 3 hours |
| Pickleball, 3 courts | $200 for the 3 hours |
| Inflatables | $150, set up in Zone 7 |
| Zone 7 (three courts, futsal or inflatables) | **$400 for the whole 3 hours**, not per hour (owner confirmed 2026-11-20). Three courts at $150, discounted |
| Shoot 360 (4 hoops) | $400 per hour, food not included. Shoot 360 Denver is a separate operator (org 11 since migration 0055) |
| Social Den, private TV lounge | $600 per hour. Otherwise it is open seating, free for groups that buy a food package |
| Corral area | $250 per 3-hour slot, 20–30 people, plus the court rental. Two corrals: the vertical court in Zone 7 split into two areas |
| DJ system or karaoke system | Includes lights and fog machine. Added to the quote, about $100. Games TBD |
| Food, Oda Up | Kids $15 per head (2 slices of pizza, bites, fountain drink). Adults $25 per person |
| Outside food | $250 fee, only for parties contracted with the facility that skip the food package. The general public may not bring food. No outside alcohol. Off-menu food can be made with notice |
| Tax | Charged on food and drinks only. Kids food comes to about $16 to $17 with tax |
| Colorado Boom club members | One volleyball court included with the party room (a $150 credit) |

**Target.** A typical party is $400–600 for room plus activity area, before food.

**The pricing reference** is `afh/assets/party.js` on branch `v3` at commit `caaeb12`, which already matches this table.

**No "activity rooms" product.** The customer says what kind of party it is and staff match the room or activity. Do not build or sell "Activity Rooms 1 and 2".

**Capacity.**

| Space | Holds |
|---|---|
| Studio 1 (the party room) | 200 people; 70 for a yoga class |
| One volleyball court | 12–20 |
| Social Den | 200 |
| Zone 7 | 300–400 |
| Corral | 20–30 |
| Whole building | Up to 1,200 with planning. Event-Den quotes up to 600, or 1,000 for the whole building |

**Payment terms (owner):** payment up front, plus a **$300 security deposit** for parties ("probably"; more for events). For dates more than 3 months away, a **30% deposit** holds the date and the rest is due 1 to 2 months before. **Cancelling within 60 days of the party forfeits that 30%** (owner correction 2026-11-20; an earlier relay said 25%, which was wrong). Use one constant for the 30% in code: it is both the hold deposit and the cancellation forfeit.

**Routing.** These go to Event-Den, the planning company, instead of being booked instantly:
- more than 75 guests (one constant, tunable; confirmed 2026-11-20 even though Studio 1 holds 200)
- more than one day
- staging, sound or AV
- décor, rentals or a planner
- vendor booths, an expo or a convention

Event-Den quotes up to 600, or 1,000 for the whole building. Tournaments and sports events stay with Boomtown Athletics.

**Waivers.** Everyone who plays on a court or an inflatable signs the waiver. A guardian signs for minors.

**What the sheet shows about availability:**
- Weekdays from 4 PM to 11 PM are full. Club practices run 5:00–7:30 PM, and leagues and drop-in run 7:00–11:00 PM. Zone 7 has REAL Futsal every weekday from 4 PM. Zone 1 has Shoot 360 from 4 to 5 PM.
- Most weekends from October to April have tournaments from 7 AM to 4 PM. Saturday evenings often hold RevCo or JPS events.
- On Sundays from 4 to 7 PM, Zones 1, 2, 6 and 7 are usually free; QC RP runs in Zones 3–4 from 5 to 7 PM and Masters drop-in uses Zone 5.
- Weekdays before 4 PM are open.
- Summer weekends are mostly open.

**Where party slots can go (owner, second round):** in winter mostly Friday, Saturday and Sunday **nights**, maybe Monday or Tuesday from 7:30 PM. Summer has more, depending on events. This replaces the earlier Sunday 4–7 PM and weekday-daytime recommendation.

## 4. Build units (one per release)

1. **Atoms.**
   - Add VB 14 and VB 15. Rebuild the presets as Zone 1–Zone 7 plus the existing whole-floor presets.
   - **Shipped (migration 0055):** VB 14–15, Zone 1–7 presets, Party Room 1–2 (the two halves of Studio 1), Corral 1–2, Shoot 360 Denver. Not added: Shoot 360 bays (unsettled whether the hoops are their own area or Zone 1). There is no Activity Rooms product.
   - Add Shoot 360 Denver as an operator org.
   - Migrate existing bookings that reference the old basketball presets.
2. **Sheet import.**
   - Write a one-time converter from "Events 2027" (daily) and "2026 Fall Schedule" (weekly, which becomes weekly series) into the existing import CSV.
   - Handle the sheet's messiness:
     - times like "8 PM - 1 PM" (a typo) or "7:00 PM" with no end
     - "(BUSY)" or "(Not Busy)" tags
     - "OPEN" rows
     - holidays, which become closures
     - multi-zone notes like "JPS: 2 zones (2,4)"
     - rows with no time, which are flagged for the owner, never guessed
   - Produce a **dry-run report** for the owner before writing anything. After the import, the sheet is read-only history.
3. **Party catalog and pricing.**
   - Store the packages and prices from §3 as data, not code constants.
   - Expose `POST /api/party/quote`, which returns the line items and total. It must reproduce `afh/assets/party.js` `estimate()` exactly. Copy its assert cases into a test.
   - Put the routing rule server-side, so a request that should go to Event-Den is refused with the Event-Den link.
4. **Held slots.**
   - Party slot templates: weekday, start, end, atoms and allowed packages. Example: Saturday night, party room plus Zone 6.
   - Availability is the templates minus any hard conflict. Staff can open or close single dates.
   - Never offer a slot whose atoms conflict with a tournament, a league series or a closure.
5. **Public booking.**
   - `GET /api/party/availability?from&to&pkg`.
   - `POST /api/party/hold` creates a tentative booking (new `status` or `source='party'` plus `hold_expires_at`, 30-minute TTL) that reserves the atoms, then returns a Square quick-pay link.
   - The Square webhook confirms the booking. Unpaid holds expire.
   - CORS allows `https://aurorafieldhouseusa.com` only.
   - Add bot protection and rate limits. Validate every field server-side.
6. **After booking.**
   - Send a confirmation email with the waiver link for guests. Email is gated on `BREVO_API_KEY`; follow the production-gates runbook.
   - Give Oda Up (org 5) a daily kitchen list of headcounts and packages.
   - Show party bookings in the facility calendar in their own colour, with cancel and refund.
7. **Switch the page.** Change `afh/assets/party.js` from mailto to the API: show live slots, hold, pay. Keep mailto as the fallback when the API is down.

## 5. Acceptance

- A party cannot be paid for on a slot that conflicts with any booking, closure or series. Test each kind.
- Two people trying to hold the same slot at once: exactly one wins.
- The quote endpoint and `party.js` agree on every assert case.
- Over-75, multi-day or production requests are refused with the Event-Den link.
- The import dry run lists every row it could not parse, and writes nothing.

## 6. Security

- Public endpoints are unauthenticated: validate, rate-limit and bot-check them.
- Never trust a client total.
- Do not log card data.
- Square and Brevo secrets stay in Worker secrets, never in the repo.

## 7. Owner decisions

**Answered 2026-11-20 and folded into §3 — do not re-ask:** the party room's identity (Studio 1, splits in two) and capacity; basketball, pickleball and inflatable prices; party-court pricing per 3 hours; Zone 7 at $400 for the 3 hours; the corral; the Colorado Boom credit; payment terms; the $300 security deposit; the 60-day cancellation rule (forfeits the 30% deposit); tax; outside food; the 75-guest routing limit; and where slots can go (winter weekend nights).

**Still open from the owner:**

1. The exact start and end times of the slot templates (Friday, Saturday, Sunday nights; Monday or Tuesday from 7:30 PM). Needed before unit 4.

The whole-studio price is moot while parties get the whole studio; revisit only if the halves are ever sold separately.

**Found during the build, 2026-11-20 (unit 1 session):**

2. Which Square account and location party payments land in. No org has a Square location and the live webhook is not configured (§8).
3. Whether Shoot 360's four hoops are their own area or sit on Zone 1 (the sheet shows Shoot 360 in Zone 1 from 4 to 5 PM).
4. Whether the 77 coarse calendar rows from the August import may be retired before the zone-exact sheet import (a delete).
5. Party Room 1–2 were added as new rooms for the halves of Studio 1. Whether Studio 1 is the same physical room as one of the older Dance-Den / Yoga-Den entries is unmapped; harmless while those hold no bookings, but settle it before unit 4 sells the room.

## 8. Square connection (owner asked for this on 2026-11-20)

- Payments reuse the existing Square quick-pay path (`createSquareLink` in `registrations.js`) and the existing payment webhook. Read both before writing anything, and check which org and Square location party payments belong to: FieldhouseUSA parties are not a Boomtown Athletics tournament.
- Check what is configured before asking for anything: `wrangler.toml` vars, the production-gates runbook, and whether `SQUARE_ACCESS_TOKEN`, the webhook signature key and `SQUARE_ENV` are set as Worker secrets. Report what is missing in plain English.
- Secrets are entered by the owner, never pasted into chat or committed. Build and test against the Square sandbox first.
- Food and drink lines carry sales tax; space rental lines do not. Confirm the rate from the owner's Square catalog instead of assuming one.
