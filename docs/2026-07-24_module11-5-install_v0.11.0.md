# Module 11.5 Install — UX & Navigation + Sandbox Tools (v0.11.0)
**File:** docs/2026-07-24_module11-5-install_v0.11.0.md · **Date:** 2026-07-24
**ZIP:** 2026-07-24_boomtown_v0_11_0.zip
**Database changes:** NONE. **Square changes:** NONE (standing rule — sandbox only).

## What you get
1. **Sidebar collapse handle on the side edge** — a small pill floating at the sidebar's right edge, mid-height. Click to shrink the rail to icons; click again to expand. (The old bottom "Collapse" button is gone.)
2. **Collapsible menu categories** — click any group label (Run events, Money, People, Member site) to fold it; the chevron shows state; each group remembers its state on your device.
3. **Reordered menu** — daily flow order: Dashboard → Events & Programs → Registrations → Check-in → Tournament Ops → League Manager, then Money → People → Member site.
4. **SANDBOX group** (bottom of the rail, dashed divider, amber label):
   - **View as member** — one click shows the site exactly as a member sees it (Manage menu hidden). A floating "Viewing as member — Exit" pill at the bottom of the screen returns you to the Control Center. Your admin login never changes — it's presentation only.
   - **Test data…** — opens a panel showing current test-data counts with two buttons: **Generate** (creates the standard TEST set: 3 events incl. a completed tournament with scores/standings, an open tournament with every payment state, a league; 4 teams; 8 players — everything marked TEST, IDs 90000+) and **Wipe** (removes exactly that set, confirms first, reports how many rows it deleted). Real data is structurally untouchable — only the 90000+ ID range is ever written or deleted.
5. **No dead ends** — a branded 404 page with ← Back / Home / My Dashboard, and a standard error box (Back + Dashboard + Reload) that every module uses from now on.

## Paste steps (github.com/10xequity/btplatform · commit each directly to main)
NEW files (Add file → Create new file):
1. `worker/src/sandbox.js`
2. `404.html`  ← note: repo ROOT, not inside web/
3. `docs/2026-07-24_module11-5-install_v0.11.0.md` (this file)

REPLACE (open file → pencil → select-all → paste):
4. `worker/src/index.js`  ⚠️ paste sandbox.js (step 1) BEFORE this one — index.js imports it
5. `web/assets/admin-nav.js`
6. `web/assets/site-nav.js`
7. `CHANGELOG.md`

## Verify (3 minutes)
1. **Actions** tab → newest "Deploy Worker" run green.
2. `/api/health` → `"version":"v0.11.0"`.
3. Hard-refresh (Ctrl+F5) the Control Center → sidebar shows the new order, the side-edge pill collapses it, clicking "Money" folds the group.
   (If the sidebar looks unchanged: GitHub Pages caches assets ~10 minutes — wait and hard-refresh again.)
4. Sandbox → **Test data…** → Generate → banner reports what was created → Events & Programs now shows the TEST events → Sandbox → Test data… → **Wipe** → TEST events gone.
5. Sandbox → **View as member** → you land on My Dashboard with no Manage menu and the Exit pill at the bottom → try opening admin.html directly — it bounces you back to home.html (correct) → click the pill → you're back on the Control Center.
6. Visit any bad URL like `/btplatform/nope` → branded not-found page with working Back button.

## Regression checklist (same as every version)
create event → register → sandbox pay message → schedule → score → standings → export → check-in → plans page loads → MRR card renders → **NEW: generate test data → wipe test data → view-as-member round trip**.
