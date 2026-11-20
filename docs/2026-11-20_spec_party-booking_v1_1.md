# Party booking and space calendar — build prompt

**Version:** v1.1 · **Date:** 2026-11-20 · **Status:** Building — unit 1 shipped 2026-11-20 (migration 0055); owner answered the v1.0 questions the same day (§7) · **Supersedes:** v1.0 (same day, never committed)
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
| Party room | $400 per 3 hours, setup and cleanup included, no food. The party room is half of the studio: the studio splits into two party rooms or opens into one large room. "Activity Rooms 1 and 2" are these same two halves |
| Volleyball court | $150 per court per hour |
| Basketball court | $200 for the 3 hours |
| Pickleball, 3 courts | $200 for the 3 hours |
| Inflatables | $150, set up in Zone 7 |
| Zone 7 (three courts, futsal or inflatables) | $400 per hour, a bundle discount from $450 |
| Shoot 360 (4 hoops) | $400 per hour, food not included. Shoot 360 Denver is a separate operator; add it as an operator org |
| Social Den, private TV lounge | $600 per hour. Otherwise it is open seating, free for groups that buy a food package |
| Corral area | $250 per 3-hour slot, plus the court rental. Two corrals: the vertical court in Zone 7 split into two areas |
| Whole studio (both party rooms as one) | Price **not set** |
| Karaoke, speaker and lights, fog machine | Added to the quote, probably about $100. Games TBD |
| Food, Oda Up | Kids $15 per head (2 slices of pizza, bites, fountain drink). Adults $25 per person |
| Outside food | $250 fee, only for parties contracted with the facility that skip the food package. The general public may not bring food. No outside alcohol. Off-menu food can be made with notice |
| Tax | Charged on food and drinks only. Kids food comes to about $16 to $17 with tax |
| Colorado Boom club members | One volleyball court for the 3-hour period included with the party room |

**Payment terms (owner):** payment up front, plus a security deposit for cleaning and damage (amount not set). For dates more than 3 months away, a 30% deposit holds the date and the rest is due 1 to 2 months before.

**Routing.** These go to Event-Den, the planning company, instead of being booked instantly:
- more than 75 guests (one constant, tunable; the owner's first instinct was 50)
- more than one day
- staging, sound or AV
- décor, rentals or a planner
- vendor booths, an expo or a convention

Event-Den's capacity is up to 600. Tournaments and sports events stay with Boomtown Athletics.

**Waivers.** Everyone who plays on a court or an inflatable signs the waiver. A guardian signs for minors.

**What the sheet shows about availability:**
- Weekdays from 4 PM to 11 PM are full. Club practices run 5:00–7:30 PM, and leagues and drop-in run 7:00–11:00 PM. Zone 7 has REAL Futsal every weekday from 4 PM. Zone 1 has Shoot 360 from 4 to 5 PM.
- Most weekends from October to April have tournaments from 7 AM to 4 PM. Saturday evenings often hold RevCo or JPS events.
- On Sundays from 4 to 7 PM, Zones 1, 2, 6 and 7 are usually free; QC RP runs in Zones 3–4 from 5 to 7 PM and Masters drop-in uses Zone 5.
- Weekdays before 4 PM are open.
- Summer weekends are mostly open.

## 4. Build units (one per release)

1. **Atoms.**
   - Add VB 14 and VB 15. Rebuild the presets as Zone 1–Zone 7 plus the existing whole-floor presets.
   - Add the rooms the owner confirms: the party room(s), Activity Rooms 1 and 2 (check whether these are Dance-Den 1 and 2), the corral areas and the Shoot 360 bays.
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
   - Party slot templates: weekday, start, end, atoms and allowed packages. Example: Sunday 4–7 PM, party room plus Zone 6.
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

Answered 2026-11-20 and folded into §3: the party room is the studio (two halves), basketball, pickleball and inflatable prices, the corral, the Colorado Boom special, payment terms, tax, and outside food.

Still open. Ask once, in one inline list with a recommendation each, before units 1 and 4:

1. How many guests one party room holds, and both together. The 75-guest routing limit should follow from this.
2. The price of the whole studio (both party rooms as one).
3. The security deposit amount, and the cancellation and refund rules.
4. Which slot templates to sell. Recommended: Sunday 4–7 PM; weekdays 10 AM–3 PM (school breaks and corporate team-building); open weekends by date.
5. Whether the studio in the party page is Dance-Den 1 and 2 in the existing atoms, or a different room.

## 8. Square connection (owner asked for this on 2026-11-20)

- Payments reuse the existing Square quick-pay path (`createSquareLink` in `registrations.js`) and the existing payment webhook. Read both before writing anything, and check which org and Square location party payments belong to: FieldhouseUSA parties are not a Boomtown Athletics tournament.
- Check what is configured before asking for anything: `wrangler.toml` vars, the production-gates runbook, and whether `SQUARE_ACCESS_TOKEN`, the webhook signature key and `SQUARE_ENV` are set as Worker secrets. Report what is missing in plain English.
- Secrets are entered by the owner, never pasted into chat or committed. Build and test against the Square sandbox first.
- Food and drink lines carry sales tax; space rental lines do not. Confirm the rate from the owner's Square catalog instead of assuming one.
