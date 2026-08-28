# Production gates — the owner's runbook (email · push · payments · texting)

**File:** `docs/2026-08-27_runbook_production-gates_v1_0.md` · **Version:** v1.0 · **Date:** 2026-08-27
**Status:** Active — owner reference. Written for the owner to follow by hand; no coding required.
**Why this exists:** his ask (2026-08-27): *"Provide links for Brevo, and Vapid. Instructions to get
square linked. we will skip sms for now. Or can we use square? Is that free?"* Every step below was
derived from what the shipped worker actually reads (the env names are quoted from the code), and
the external facts were verified against the providers' own pages on 2026-08-27.

---

## §0. Where every key goes (do this part the same way for all three gates)

The API runs as the Cloudflare Worker **boomtown-api**. Keys live there as **Secrets** — encrypted
values the code reads but nobody can read back out of the dashboard.

1. Sign in at https://dash.cloudflare.com
2. Go to **Workers & Pages → boomtown-api → Settings → Variables and Secrets**.
3. Click **Add**, choose type **Secret**, enter the NAME exactly as spelled in the sections below,
   paste the value, **Deploy/Save**.

**Always choose type "Secret", never "Text" — including for `SQUARE_ENV`.** Plain-text variables
set in the dashboard are wiped by the next automated deploy (the deploy replaces them from the
repo's config file); Secrets survive every deploy.

There is no restart step: the Worker picks the secret up immediately, and every feature below is
already coded to switch itself on the moment its key exists.

---

## §1. Email — Brevo (free: 300 emails/day)

What turns on: real sign-in link emails, event/captain emails, campaign sends — everything that
today shows the honest "no mail key" notice.

1. **Create the account:** https://onboarding.brevo.com/account/register (the app afterwards is
   https://app.brevo.com). The free plan is the default — 300 emails/day, no card required.
2. **Authenticate the sending domain** (do this BEFORE the key, or mail lands in spam):
   in Brevo go to **Settings → Senders, Domains & Dedicated IPs → Domains → Add a domain**, enter
   **boomtownvb.com**, and add the DNS records Brevo shows you (a Brevo code + DKIM records) at
   your domain host. Guide: https://help.brevo.com/hc/en-us/articles/12163873383186
3. **Add the sender address:** **Settings → Senders** → add **no-reply@boomtownvb.com** — this is
   the exact address the platform sends as (`SENDER_EMAIL` in the deployed config).
4. **Create the API key:** **Settings → SMTP & API → API Keys → Generate a new API key**
   (docs: https://developers.brevo.com/docs/send-a-transactional-email). Copy it once — Brevo
   only shows it once.
5. **Set the secret** (§0): NAME `BREVO_API_KEY`, value = the key.
6. **Test:** open the live site signed out and request a sign-in link to your own address. The
   email should arrive from no-reply@boomtownvb.com within a minute.

## §2. Push notifications — VAPID (free forever, no account, no vendor)

What turns on: browser push (waitlist alerts and the notification test-send). VAPID is not a
service — it is a keypair you generate yourself, once, on your own computer.

1. In a terminal on your PC (Node is already installed for this repo):

       npx web-push generate-vapid-keys

   It prints a **Public Key** and a **Private Key** (docs:
   https://github.com/web-push-libs/web-push#command-line).
2. **Set three secrets** (§0):
   - `VAPID_PUBLIC_KEY` = the printed public key
   - `VAPID_PRIVATE_KEY` = the printed private key
   - `VAPID_SUBJECT` = `mailto:info@boomtownvb.com` (optional — this is already the code's
     default; set it only if you want a different contact address)
3. Keep a copy of both keys somewhere safe: if the private key is ever lost or replaced, every
   member's existing push subscription silently dies and each browser must re-subscribe.
4. **Test:** the admin Notifications screen's staff test-send, to your own browser.

## §3. Payments — Square (keys are free; you pay only per sale)

What turns on: real checkout for registrations and membership subscriptions, and the webhook that
keeps payment/subscription status in sync. **The code switches from sandbox to the real Square the
moment `SQUARE_ENV` reads `production` — set that secret LAST.**

1. **Open the developer console:** https://developer.squareup.com/apps — sign in with the SAME
   Square account the business sells under. Open your application (or **Create app** once).
2. **Get the production access token:** inside the app, switch the credentials toggle from
   Sandbox to **Production**, and copy the **Production Access Token**.
3. **Get the Location ID:** in the same app, the **Locations** page lists your business locations
   with their IDs — copy the ID of the location that should receive the money.
4. **Register the webhook:** app → **Webhooks → Subscriptions → Add subscription**:
   - Notification URL, exactly: `https://boomtown-api.vvisuth.workers.dev/api/webhooks/square`
   - Events — subscribe the three groups the platform handles: **payments** (payment.created,
     payment.updated), **subscriptions** (subscription.created, subscription.updated), and
     **invoices** (invoice.payment_made, invoice.payment_failed, invoice.scheduled_charge_failed).
   - Save, then copy the subscription's **Signature Key**.
5. **Set five secrets** (§0), in this order, `SQUARE_ENV` last:
   - `SQUARE_ACCESS_TOKEN` = the production access token (step 2)
   - `SQUARE_LOCATION_ID` = the location ID (step 3)
   - `SQUARE_WEBHOOK_URL` = `https://boomtown-api.vvisuth.workers.dev/api/webhooks/square`
     — must match step 4's URL byte for byte; the signature check hashes this exact string
   - `SQUARE_WEBHOOK_SIGNATURE_KEY` = the signature key (step 4)
   - `SQUARE_ENV` = `production` ← this is the switch; everything before it is inert
6. **Test with a real card and a small amount** (e.g., a $1 test item), then refund it from the
   Square Dashboard. Square's online rate on the free plan is currently **3.3% + 30¢** per
   transaction; there is no monthly fee.

## §4. Texting — SKIPPED (owner decision 2026-08-27), and the Square question answered

**Can Square send the platform's texts? No.** Square Messages (free) is a person-to-person inbox
inside the Square Dashboard and app — it has **no developer API**, so the platform cannot send
through it. Square's Text Message Marketing product ($10/month) is campaign tooling, also without
an API. Neither can replace the coded Twilio path (which needs A2P registration: ~$19 one-time,
~$3/month + ~1.1–1.3¢ per message). **SMS stays off**; the platform's SMS screens keep their
honest keyless notices. If a light-duty free-ish workaround is ever wanted, the realistic options
are email (already free via §1) or push (§2) — not Square.

---

**Order that makes sense:** §2 (push — five minutes, zero cost, zero risk) → §1 (email — free,
needs the DNS step) → §3 (payments — real money, do it with a test purchase in hand). Each gate is
independent; opening one never requires another.
