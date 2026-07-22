# Module 4 install — Registration + Payments + Captain Scoring
**Version:** v0.3.0 · **Date:** 2026-07-21 · **Time needed:** ~10 minutes of clicking

Everything below is copy-paste / drag-drop. No terminal, no code.

---

## Step 0 — Do the sign-in test first (2 minutes, from handoff v0.3)
1. Open `https://10xequity.github.io/btplatform/web/`
2. Hold **Ctrl** and press **F5** (hard refresh).
3. Type your email, click **Send sign-in link**. A blue "sandbox" link appears on screen — click it.
4. You should land on the dashboard as admin of all 3 orgs. Tell Claude either way — Claude verifies the database side.

## Step 1 — Upload the new files (drag-drop, ~3 minutes)
1. Download the ZIP Claude attached and **extract it** (right-click → Extract All) so you have a normal folder.
2. Go to `https://github.com/10xequity/btplatform` → click **Add file** → **Upload files**.
3. From the extracted folder, drag these **4 folders and 1 file** into the upload box **all at once** (this keeps the folder structure):
   - `web` · `worker` · `db` · `docs` · `CHANGELOG.md`
4. Commit message: `v0.3.0 Module 4 — registration + Square + captain scoring` → click **Commit changes**.
5. There are **no dot-files** in this bundle, so plain drag-drop is enough this time.
6. The green **Actions** check will run automatically (tests + worker deploy). Wait for the green ✓ (~1 minute).

## Step 2 — Quick smoke test (no Square needed)
1. Hard-refresh (Ctrl+F5) the Pages site, sign in, open **Tournament ops** → new **Registrations** button is in the toolbar.
2. In Registrations: pick (or first create) an event, click **Copy registration link**, open it in a new tab.
3. Fill the form and submit. Because Square isn't connected yet, you'll see: *"Online payment isn't connected yet"* — that is correct sandbox behavior, the registration still saved.
4. Back on the admin page: the registration appears under **Unpaid**. Click **Remind** → you get a copyable payment note (email is in sandbox until Brevo is connected).
5. Click **Captain score links** → each team gets a link you can text to captains. Open one on your phone: score a game in 2 taps.

## Step 3 — Connect Square SANDBOX (do when ready — nothing charges real money)
1. Go to `https://developer.squareup.com` → sign in with your Square account → open (or create) an application.
2. Make sure the toggle at the top says **Sandbox**. Copy these two things:
   - **Sandbox Access Token** (Credentials page)
   - **Default Test Account's Location ID** (Locations page)
3. Still in the Developer Console → **Webhooks** → **Add subscription**:
   - URL: `https://boomtown-api.vvisuth.workers.dev/api/webhooks/square`
   - Events: check **payment.created** and **payment.updated** → Save.
   - Copy the **Signature Key** it shows you.
4. Now add the secrets to Cloudflare (same place as before): `https://dash.cloudflare.com` → **Workers & Pages** → **boomtown-api** → **Settings** → **Variables and Secrets** → **Add** → type = **Secret**:
   | Name | Value |
   |---|---|
   | `SQUARE_ACCESS_TOKEN` | the sandbox access token |
   | `SQUARE_WEBHOOK_SIGNATURE_KEY` | the webhook signature key |
   | `SQUARE_WEBHOOK_URL` | `https://boomtown-api.vvisuth.workers.dev/api/webhooks/square` (must match exactly) |
   | `SQUARE_LOCATION_ID` | the sandbox location ID |
   Click **Deploy** if it asks. **Never paste these keys into chat.**
5. Set an entry fee on an event (ask Claude — one command), register again → you'll be sent to a real **sandbox.square.link** checkout page. Pay with Square's test card `4111 1111 1111 1111`, any future date, any CVV. Within ~a minute the registration flips to **paid** by itself.

## Step 4 — Going live later (not now)
Real payments only need: production access token + production location ID + a production webhook subscription, and one extra secret `SQUARE_ENV` = `production`. Claude will walk you through it when you're ready — per the working rules, nothing charges real money without your explicit OK.

## Step 5 — One thing Claude needs from you
The waiver on the registration form is a **placeholder**. Paste your official Boomtown Athletics LLC waiver text into chat (or upload the doc) and Claude will drop it in as v0.3.1.

---
*Changelog: v0.3.0 (2026-07-21) — first install doc for Module 4.*
