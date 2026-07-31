# Boomtown Platform — Twilio A2P 10DLC Registration Checklist
**File:** docs/2026-07-31_a2p-registration-checklist_v1_0.md · **Version:** v1.0 · **Date:** 2026-07-31 · **Ships in:** v0.42.0

Nothing in sms.js sends a single text until this clears. Registration review commonly takes
**2–6 weeks**, so start it well before the season you want texting in. Everything happens in
the Twilio Console; no code changes needed. [FACT for the process shape as of the build date;
verify current fees/timelines in the Console — Twilio adjusts them.]

## 1. Account + brand (one-time, ~30 min of form-filling)
- [ ] Create a Twilio account (or use existing) and upgrade off trial.
- [ ] Register the **Brand** under A2P 10DLC: legal entity name exactly as the IRS knows it
      (the EIN match is the #1 rejection reason), EIN, address (14200 E Alameda Ave, Aurora,
      CO 80012 — D-ORG address of record), website (boomtownvb.com), vertical: recreation/sports.
- [ ] Low-volume standard brand is fine to start (fits well under 6,000 msgs/day).

## 2. Campaign (this is what reviewers actually read)
- [ ] Campaign type: **Mixed** or **Customer Care + Account Notification** — court
      assignments and game-day notices. Do NOT declare marketing on this campaign;
      marketing blasts are a separate campaign type later (scope C decision of record).
- [ ] Sample messages — submit ones the system will really send, e.g.
      "Boomtown Volleyball: Court 4 for your 6:15 match — doors on the north side.
      Reply STOP to opt out." (Reviewers reject samples without brand name + STOP language.)
- [ ] Opt-in description: members opt in at registration or verbally at the desk
      (staff toggle, audited). Opt-out: STOP handled automatically.

## 3. Number + Messaging Service
- [ ] Buy one local 720/303 number; attach it to a **Messaging Service**.
- [ ] Turn ON **Advanced Opt-Out** on the Messaging Service (Twilio auto-handles
      STOP/HELP at carrier level; the platform mirrors consent in the database too).
- [ ] Set the Messaging Service inbound webhook to
      `https://boomtown-api.vvisuth.workers.dev/api/sms/inbound` (POST).
- [ ] Link the campaign to the Messaging Service.

## 4. Hand the three secrets to the deploy session (do NOT paste them in chat)
Set via Cloudflare dashboard → Worker → Settings → Variables (encrypted), or wrangler:
- [ ] `TWILIO_ACCOUNT_SID`
- [ ] `TWILIO_AUTH_TOKEN`
- [ ] `TWILIO_MESSAGING_SERVICE_SID`
Until all three exist the entire SMS module answers "Texting isn't switched on yet" and
touches nothing — that is by design, and it is what lets v0.42.0 sit unshipped safely.

## 5. Deploy-day order (for the session that ships v0.42.0)
1. Apply migration `0029` via Cloudflare MCP — one statement per call (4 statements + ledger).
2. Upload the v0.42.0 ZIP; CI schema-gate will verify 0029 landed.
3. Set the three secrets (step 4).
4. Live test: desk-toggle consent on your own contact → send yourself a court assignment
   from the Text Messages page → reply STOP → confirm consent flips off in the log.
