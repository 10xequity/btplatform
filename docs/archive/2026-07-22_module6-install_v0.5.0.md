# Install v0.5.0 — Member Profiles + Family Accounts + Face ID sign-in
**Document:** 2026-07-22_module6-install_v0.5.0 · **Version:** v0.5.0 · **Date:** 2026-07-22
Time needed: about 10 minutes. No terminal. The database changes are ALREADY DONE (Claude applied them live) — you only do the three steps below.

---

## Step 1 — Create the photo storage bucket (Cloudflare, one time, ~4 clicks)
Profile photos are stored in Cloudflare R2. The deploy will FAIL if this bucket doesn't exist yet, so do this first.

1. Go to **dash.cloudflare.com** and sign in.
2. In the left menu, click **R2 Object Storage**. (If Cloudflare asks you to enable R2 with a card on file: the free plan includes 10 GB — avatars will use a tiny fraction of that, so expect $0.)
3. Click the blue **Create bucket** button.
4. Bucket name: type exactly **boomtown-avatars** (all lowercase, with the dash). Leave everything else as-is.
5. Click **Create bucket**. Done — you never need to open this bucket again.

## Step 2 — Upload the new files to GitHub (same as every release)
1. Unzip **btplatform-v0.5.0.zip** on your computer.
2. Go to **github.com/10xequity/btplatform**.
3. Click **Add file → Upload files**.
4. Drag in EVERYTHING inside the unzipped folder — the `worker`, `web`, `docs`, and `db` folders plus the two loose files (`wrangler.toml`, `CHANGELOG.md`). Dragging the folders keeps files in the right places automatically.
5. Commit message: **v0.5.0: member profiles, family accounts, passkeys**
6. Click **Commit changes**.

What's in the zip (all files carry a version header inside):
| File | What it is |
|---|---|
| `wrangler.toml` | adds the photo-storage connection (v0.5.0) |
| `worker/src/index.js` | API brain, now v0.5.0 |
| `worker/src/profiles.js` | NEW — profiles, family, signatures, résumé, calendar, seeding |
| `worker/src/webauthn.js` | NEW — Face ID / fingerprint sign-in |
| `web/index.html` | sign-in page now shows the Face ID button |
| `web/assets/passkey.js` | NEW — powers that button |
| `web/profile.html` + `web/profile.js` | NEW — the member profile page |
| `web/member.html` + `web/member.js` | NEW — public shareable profile view |
| `db/2026-07-22_0004_profiles-family_v1.1.sql` | record of the database change (already live — never run it) |
| `docs/…install_v0.5.0.md`, `docs/…handoff_v0.7.md`, `CHANGELOG.md` | this doc, the handoff, the changelog |

## Step 3 — Watch it deploy, then verify (3 checks)
1. On GitHub, click the **Actions** tab. Wait for **Deploy Worker** and **pages build and deployment** to both show green check marks (2–4 minutes).
2. Open **https://boomtown-api.vvisuth.workers.dev/api/health** — it should say `"version":"v0.5.0"`.
3. Open **https://10xequity.github.io/btplatform/web/profile.html** — you should see "Your profile" with the email sign-in box.

## Try it out (5 minutes, in this order)
1. On the profile page, sign in with your email (sandbox link appears on screen).
2. Tap **Add a photo** → pick any photo → drag/zoom the crop → **Use photo**.
3. Tap **Add a child** → enter a made-up name and a birthdate (e.g., 2012) → the child appears with a **Needs signature** chip.
4. Tap **Sign** next to the child → scroll the (placeholder) waiver → type your name → **Sign for [name]** → chip flips to **Signed ✓**.
5. Find the **Sign in faster** card → **Add this device** → approve with Face ID / fingerprint.
6. Tap **Sign out**, go to the main sign-in page — a **Sign in with Face ID / fingerprint** button now appears. Tap it. One tap, you're in.

## If something goes wrong
- **Deploy Worker shows a red X mentioning "r2" or "bucket":** Step 1 was skipped or the name isn't exactly `boomtown-avatars`. Fix the bucket, then in Actions click the failed run → **Re-run all jobs**.
- **Face ID button doesn't appear:** it only shows on browsers/devices that support passkeys, and only on the live site (not on previews). The email link always works as the fallback.
- Anything else: tell Claude what you see, or email yourself a note — nothing in this release can damage existing data.
