# Module 11 Install — Memberships & Recurring Billing (v0.10.0)
**File:** docs/2026-07-24_module11-install_v0.10.0.md · **Date:** 2026-07-24
**ZIP:** 2026-07-24_boomtown_v0_10_0.zip

The database part is ALREADY DONE (migration 0007 was applied live on 2026-07-24). You only paste files.

## What you get
- **Admin → Memberships** (new page, under "Money" in the rail): create plans, see MRR, active members, payment issues, and the subscriber list.
- **Members → Membership** (new page, in the sidebar under "You"): plan cards, subscribe, cancel. A Membership card also appears on My Dashboard.
- **Control Center**: new "Monthly recurring revenue" card.
- Until Square keys are set, everything works in preview: plans save, members see "billing isn't switched on yet" instead of a checkout link. Nothing breaks.

## Paste steps (GitHub web editor, github.com/10xequity/btplatform)
For each file: open the path → pencil icon (or "Add file → Create new file" for NEW ones) → select-all → paste from the ZIP → **Commit changes** directly to main.

NEW files (Create new file):
1. `worker/src/memberships.js`
2. `web/membership.html`
3. `web/assets/membership.js`
4. `web/admin-plans.html`
5. `web/assets/admin-plans.js`
6. `db/2026-07-24_0007_memberships_v1.0.sql`  ← record only, never run
7. `docs/2026-07-24_module11-install_v0.10.0.md` (this file)

REPLACE (open existing file, paste over):
8. `worker/src/index.js`
9. `web/assets/site-nav.js`
10. `web/assets/admin-nav.js`
11. `web/assets/admin-dash.js`
12. `web/admin.html`
13. `web/home.html`
14. `web/home.js`
15. `CHANGELOG.md`

⚠️ Files 1 and 8 are the two that trigger a worker deploy. Paste **memberships.js (1) BEFORE index.js (8)** — index.js imports it, and pasting them in the other order makes the in-between Actions run fail (it self-heals on the second push, but green-the-whole-way is nicer).

## Verify (2 minutes)
1. Repo → **Actions** tab → newest "Deploy Worker" run is **green**.
2. Open `https://boomtown-api.<your-subdomain>.workers.dev/api/health` → shows `"version":"v0.10.0"`.
3. Admin → Memberships → create a test plan ("Test Monthly", $10, Monthly). Expect the yellow "Square keys aren't set" note (that's correct for now) and the plan listed.
4. Sign in as a member → sidebar → Membership → the plan card shows with a Subscribe button → clicking it says billing isn't switched on yet. ✓
5. Control Center shows the MRR card ($0.00 — correct).
6. Hide or keep the test plan (Admin → Memberships → Hide).

## When you're ready to turn billing ON (later — not today)
1. Square Developer Dashboard → your app → get the **production** Access Token + Location ID.
2. Repo secrets stay as-is; these are **worker secrets** — I'll run them via MCP or give exact `wrangler secret` values when we flip.
3. In Square Developer → Webhooks: add event types `subscription.created`, `subscription.updated`, `invoice.payment_made`, `invoice.scheduled_charge_failed` to the existing endpoint.
4. Edit + save each plan once in Admin → Memberships — that links it to Square (creates the catalog plan). The yellow note disappears and Subscribe goes live.

## Regression checklist (run after paste — same as every version bump)
create event → register → pay (sandbox message ok) → schedule → score → standings → export → check-in roster → **NEW: create plan → member sees plan → subscribe (sandbox message) → MRR card renders**.
