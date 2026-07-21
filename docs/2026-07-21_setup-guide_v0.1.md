# Boomtown Platform — One-Time Setup Guide
**Version:** v0.1 · **Date:** 2026-07-21 · **Audience:** owner (no coding, no terminal)

## What's already done (by Claude, via Cloudflare MCP)
- ✅ D1 database `boomtown-prod` created (ID `6cde5d11-4199-4e57-b10f-2b7e968264ea`, region WNAM)
- ✅ Migration 0001 applied: 23 tables, indexes, 3 orgs seeded (Boomtown Volleyball, Match Point Social, Queens Club)
- ✅ Schema smoke-tested (table list + org rows verified)

## What you do once (~15 minutes, all in a browser)

> [INTERPRETATION] These GitHub/Cloudflare screens change occasionally; if a button label
> differs slightly, look for the equivalent wording. Ask Claude if anything doesn't match.

### 1. Create the GitHub repo and paste the files
1. Go to github.com → **New repository** → name it `boomtown-platform` → Public → Create.
2. Use **Add file → Create new file** (or **Upload files**) to add every file from the bundle Claude gave you, keeping the exact folder paths (e.g. type `worker/src/index.js` as the filename to create folders).
3. Commit to `main`.

### 2. Turn on GitHub Pages (frontend hosting)
1. Repo → **Settings → Pages**.
2. Source: **Deploy from a branch** → Branch `main`, folder `/ (root)` → Save.
3. Your app URL will be `https://YOURNAME.github.io/boomtown-platform/web/` — tell Claude this URL so the config files get updated (APP_URL + ALLOWED_ORIGINS in `wrangler.toml`, apiBase in `web/index.html`).

### 3. Cloudflare API token (lets GitHub deploy the worker for you)
1. Cloudflare dashboard → My Profile → **API Tokens** → Create Token → template **Edit Cloudflare Workers**.
2. Copy the token (you'll see it once).
3. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret** → Name: `CLOUDFLARE_API_TOKEN` → paste → Save.
   - ⚠️ Paste it yourself — never send the token in chat.
4. From now on, any push touching `worker/` auto-deploys. Check **Actions** tab for a green check.

### 4. After first deploy
1. Cloudflare dashboard → Workers → `boomtown-api` → copy its URL (ends in `.workers.dev`).
2. Tell Claude the URL; Claude updates `web/index.html` (`apiBase`) and you paste the one-line change.
3. Open your app URL → enter your email → **sandbox mode** shows your sign-in link on screen (no email is sent yet). Click it.
4. **You are the first user, so you become admin of all three orgs automatically.** Every later user starts with no role until you grant one.

### 5. Later (optional, before real events)
- **Brevo key** (`BREVO_API_KEY` secret) switches auth from sandbox to real email — Claude will walk through Brevo signup + domain records when you're ready; nothing sends without your OK.
- **Admin TOTP** (authenticator-app second factor) ships in v0.2 — required before real member data goes in.

---
*Changelog: v0.1 (2026-07-21) — initial guide.*
