# Prizes & Inventory — the owner's runbook

**File:** `docs/2026-10-12_runbook_prizes-inventory_v1_0.md` · **Version:** v1.0 · **Date:** 2026-10-12
**Status:** Active — owner reference. **Ships in:** v0.213.0 (migration 0054).
**Why this exists:** his ask (2026-10-12): *"an prize and inventory management system. Based on
tournaments winners will receive items, and i want a quick way to log which items they get and
easy way to log items we receive either through invoices or through scanning my email for the
items we receive invoices."* Every step below names what the shipped code actually does.

---

## §0. Where it lives

- **Rail → Money → Prizes & Inventory** (`admin-prizes.html`), three tabs: **Award · Inventory · Receive**.
- **Event hub → Prizes tab** (after Bracket) opens the same page with that event already picked.
- Staff with either the *Tournaments* or *Point of Sale* module reach it; members get a 403.

## §1. Tournament day — award the finishers (two taps per medal)

1. Open the event's hub, **Prizes** tab. The finishers are read off the bracket the moment the
   final is scored: the final's winner is **1st**, its loser **2nd**, both semi-final losers **3rd**.
   No bracket yet → the pool standings' top three, labelled as such. Nothing yet → the team list.
2. Press **Award** beside a finisher. The dialog is pre-filled with the team, place and bracket.
   Pick an **item** (the list shows how many are on hand) and/or type a **cash** amount. **Log award.**
3. An award for more than is on hand is refused with the number in the sentence
   (*"Only 2 of "Gold medal" on hand; this award asks for 3."*) and writes nothing. Log a receipt
   first, or award cash.
4. **Undo** on the right-hand list voids the award and the stock comes back by itself.
5. **Award someone else…** logs a non-placing prize (MVP, raffle) to any team or a typed name.

## §2. Receiving — log an invoice by hand

**Receive** tab → vendor, invoice #, date, total, the invoice file (PDF or photo; it is stored
through the Files module as kind *receipt*), and one line per item: **name · qty · cost each**.
A name the list does not know is **created as a new item** on save. **Opening count or adjustment**
is the same form with a different kind; it is the only kind that accepts a negative quantity
(shrinkage, a miscount).

## §3. Receiving — "scan my email for invoices"

The Worker cannot read a Gmail inbox and we are not adding an OAuth integration for this (the
email gate is on hold by your word). The scan is a **Claude Code session with the Gmail
connector**, which reads the invoice and posts the receipt to the API. Paste this prompt:

> Search my Gmail for prize or award invoices since <date> (trophies, medals, plaques, shirts,
> gift cards, gear). For each invoice email: read it, list vendor, invoice number, date, total,
> and every line item with quantity and unit cost, then POST it to
> `https://boomtown-api.vvisuth.workers.dev/api/admin/prizes/receipts` as
> `{ vendor, invoice_no, invoice_date, total_cents, source: "email", email_message_id: <the Gmail
> message id>, lines: [{ name, qty, unit_cost_cents }] }` with my staff bearer token and
> `X-Org-Id`. Show me each receipt before posting it. A 409 means that email is already logged —
> skip it and say so.

The `email_message_id` is what makes a re-scan safe: the database refuses a second receipt for
the same message (partial unique index), so running the prompt weekly cannot double-count.

## §4. What the numbers mean

**On hand** is never typed and never stored: it is *receipts minus awards* over live rows. Voiding
a receipt after its items were awarded takes on-hand negative rather than hiding the fact — that
is the honest answer, and the Inventory tab colours it red.

## §5. Not built (deliberately, until asked)

- No barcode/SKU scanning, no per-size variants (a "Shirt L" is its own item).
- No reorder points or low-stock alerts.
- No cash-prize payout tracking beyond the logged amount (who was paid, how — that is the
  finance sheet's job, or a future ask).
- No automatic Gmail polling — see §3.
