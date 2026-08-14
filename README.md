# Boomtown Athletics Platform
**Version:** v0.149.0 · **Date:** 2026-08-13 · **Supersedes:** README @ v0.86.0 (2026-08-04)

> **v0.140.0 rewrite (owner instruction, 2026-08-12: "update readme").** The previous README claimed
> to be current "through v0.86.0" while the build shipped **v0.140.0**, its module table actually
> stopped at **v0.49.1**, and both of its "Start here" links pointed at files that had been deleted.
> It carried a banner calling an earlier thirty-three-release gap *"failure class 2 in miniature — a
> claim about the repo that nobody re-measured."* The gap had grown to fifty-four.
>
> **So the fix is not another re-measure — it is removing what goes stale.** The release-by-release
> module table is gone: `CHANGELOG.md` is that list, it is authoritative, and a second copy has now
> drifted twice. Counts below were measured on 2026-08-12 and are marked as such;
> **`preflight.mjs` and `/api/health` are the source of truth for any number in this file.**
> `worker/test/doc_consistency.test.mjs` now fails the suite if this file's version falls behind the
> shipped worker, or if any pointer here names a file that does not exist.

Multi-org sports operations platform for **Boomtown Volleyball · Match Point Social · Queens Club**,
plus facility-operator organizations (Colorado Boom, Oda Up, External/Rental). Facility is in
Aurora, Colorado.

**Live app:** https://10xequity.github.io/btplatform/web/
**API health:** https://boomtown-api.vvisuth.workers.dev/api/health — reports the deployed worker version
**What works right now:** open `web/admin-buildstatus.html`

---

## Is it finished?

No, and the platform says so on the screen. Every unfinished screen carries a marker in the menu
and a one-line notice at the top of the page:

| Marker | Means | What to do |
|---|---|---|
| *(none)* | Finished | Test it normally. File bugs. |
| **BETA** | Works end to end, with a stated caveat — almost always Square SANDBOX | Safe to test. Read the notice first. |
| **WIP** ⚠ | Under construction — cannot complete its core job yet | Confirm dialog before it opens. Don't file bugs. |
| **SOON** | Not built. Listed on the Build Status page only | — |

The registry behind all of it is one file: **`web/assets/build-status.js`**. Change a status there
and the rails, the page banners and the Build Status page all follow.

Two things are sandboxed platform-wide and are **deliberate, not defects**:

- **Square is in SANDBOX.** No card is charged anywhere, on any screen.
- **Email is in sandbox.** No mail key is set, so nothing reaches a real inbox. Every send path says
  so honestly rather than reporting success — that behaviour is correct and is tested.

---

## Working on it

```bash
node worker/scripts/preflight.mjs            # must print CLEAR before you commit
node worker/scripts/sweep-buster.mjs --write # after any version bump
node worker/scripts/sync-rail.mjs --write    # only after adding an admin page
```

**preflight** is the session ritual and the pre-commit gate in one: origin sync, module syntax,
test-file parity, the *measured* suite count, schema vs live D1, and version parity against both
`/api/health` and GitHub Pages. **A `WARN` is never a `PASS`** — a check that could not run says so
and is named in the summary.

**sweep-buster** rewrites every `?v=` cache-buster to the version in `worker/src/index.js`. Any
release that bumps the version must sweep.

**sync-rail** exists because the admin sidebar ships as static markup in every admin page, so it
paints with the page instead of popping in afterwards. Edit `web/assets/rail.partial.html` and the
`NAV` array in `web/assets/admin-nav.js`, then sweep; guards prove partial, pages and NAV all agree.

**Delivery is direct commit** to `main` (`CLAUDE.md`). Preflight CLEAR → commit → push → CI gates
and deploys → confirm both pipelines. **The CHANGELOG entry is written by
`worker/scripts/changelog-entry.mjs` as part of the release, not filled in afterwards** — there is
no stub. Database migrations go through the Cloudflare MCP **before** the push that needs them, or
the schema gate fails the build closed.

**When you bump the version, bump this file's header too.** `doc_consistency.test.mjs` enforces it —
that guard exists because this README was fifty-four releases stale.

---

## Architecture

*Counts measured 2026-08-13 at v0.149.0. Re-measure with `preflight.mjs` rather than trusting them.*

| Path | What | Deploy |
|---|---|---|
| `web/` | Static frontend on GitHub Pages. No build step; every page carries a `?v=` cache-bust (**415 across 68 files**). `404.html` and `index.html` ship from the repo **root**, not from here. | Push to `main` |
| `worker/src/` | Cloudflare Worker API. **51 modules**; `index.js` mounts every one through a dispatch table. | Auto-deploys via Actions **Deploy Worker** on any `worker/**` push |
| `worker/test/` | `node --test` suites. **1870 passing across 127 files** (measured, never projected), including a harness that drives the real router against a SQLite copy of the production schema. | — |
| `db/migrations/` | Schema of record. **Ledger at 0046, 46 files**, all applied live to D1 `boomtown-prod`. Numbered SQL lives here and **nowhere else**. | Applied via Cloudflare MCP, **additive-only**. The files here are records — never re-run them. |
| `docs/` | Specs, handoffs, the roadmap. Naming: `YYYY-MM-DD_name_vX_Y.md`. Start at `docs/INDEX.md`. | — |

Worker route pattern: `xxxRoutes(request, env, url, ctx)` + `wireXxx(h)`; helpers destructure
`{ json, audit, isStaff, requireStaff }`; `ctx = { session, orgId, userId }`.
Every table carries `org_id`, timestamps and a soft-delete `deleted_at`.

---

## What the platform does

A per-module list is not kept here — **`CHANGELOG.md` is the release record** and
`web/admin-buildstatus.html` is what actually works today. In outline:

- **Events & programs** — tournaments, leagues, drop-in sessions, court rentals; calendar and list
  views; recurring series; templates; duplicate.
- **The event manager hub** — one page per event with tabs that do not reload: registrations and
  waitlist, divisions and pools, scoring links, schedule editor, scoring, the live board, brackets.
  Each tab is the existing page, reused rather than rebuilt.
- **Registration and money** — public sign-up and drop-in sheets, waitlists with expiring offers,
  Square checkout (sandbox), cash and comped, passes and credits, membership plans and levels,
  sales and revenue reporting.
- **Running the day** — pool generation and the pool board, the schedule editor, single-elimination
  brackets, King/Queen of the Court, captain scoring links with QR codes, check-in with waiver
  status, the public live scoreboard.
- **People** — member profiles and family accounts, guardian waivers, rosters, tryouts and squads,
  staff pay, roles and permissions, media consent, documents.
- **Communication** — announcements, targeted email campaigns by segment, SMS scaffolding,
  member↔staff messaging with a report queue, in-app notifications.

---

## Roadmap

**`docs/2026-08-02_roadmap_v1_0.md` is the roadmap of record — start at its `§-0. THE QUEUE`.**
Everything below §-0 in that file is the archive of how each item was measured. This section is
deliberately a pointer: the queue that used to live here went stale twice, and once listed two
items as upcoming that had already shipped.

**Go-live blockers are owner-held configuration, not build work:** Brevo key + SPF/DKIM/DMARC ·
Square sandbox → production · VAPID push secrets · the domain transfer · Twilio/A2P (frozen).

---

## Standing rules

1. **Square SANDBOX ONLY** until the owner says go. Same for email.
2. Every document carries a date and version; one `CHANGELOG.md` entry per release.
3. **Direct commit to `main`.** Preflight must print CLEAR first. Never force-push, never rewrite
   history, never delete a document without asking.
4. Database changes via Cloudflare MCP, **additive-only**, numbered `00NN` in `db/migrations/`,
   applied **before** the push that needs them, each ending with its own `schema_migrations` INSERT
   which is then read back. The CI schema gate fails closed on an unapplied migration.
5. **The 90000–90999 id range is disposable test data** and may be wiped or regenerated at any time
   (owner 2026-08-03). Do not re-ask this.
6. Where a required fact is unknown, ship a **visibly marked blank** (`[STREET ADDRESS]`), never a
   plausible invention.
7. Design and build law: **`docs/2026-07-30_standards_v2_0.md`** (its header reads v2.3). UI work
   additionally loads the mandated design skill roster — standards §5.
8. **Page and asset split** (standards §11): a page gets its own `web/assets/<page>.js` when it
   fetches from the API or holds state; a pure-markup page keeps its script inline. A shared script
   may never depend on one page's styles.

---

## Start here

- **New to the repo:** `CLAUDE.md` — read order, trust order, session protocol. Then `docs/INDEX.md`.
- **State of record:** `docs/2026-08-06_handoff_v0_100_0.md` — §1 is the measured build state.
  *(The filename says `v0_100_0` and the build is far past it; that is deliberate — the file is
  updated in place so there is only ever one handoff.)*
- **The queue:** `docs/2026-08-02_roadmap_v1_0.md` §-0.
- **The loop's own instructions and ledger:** `RALPH.md` and `LOOP.md`.
- **What works right now:** `web/admin-buildstatus.html`.
