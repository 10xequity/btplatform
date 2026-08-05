# Boomtown Platform — Tester-round audit, every admin screen

**File:** `docs/2026-08-05_audit_tester-round_v1_0.md` · **Version:** v1.0 · **Created:** 2026-08-05
**Status:** ACTIVE — findings of record for the 2026-08-04/05 owner tester round.
**Supersedes:** nothing. First full-surface audit driven from a real signed-in browser session.
**Method:** every claim below was measured, not inferred from documents. `/api/health` = **v0.87.0**,
preflight CLEAR, suite 1258/1258, live D1 ledger 0042 (read via Cloudflare MCP). Each screen was
loaded in Chrome as a signed-in admin (owner account, sandbox magic link) and its rendered DOM read
back. Every endpoint was probed directly with a bearer token. The test-data failure was reproduced
in an isolated local SQLite built from `db/migrations/`.

---

## §0. The headline, and it is not what the report looked like

**The modules are not broken. Almost every symptom in the tester round traces to four defects, and
three of them are one line of state, one ordering mistake, and one uncalled route.**

Loaded in a clean browser on org 1, the screens the report called dead all work: the Pool Board
renders **30 draggable team tiles**, Tryouts renders **6 events and its player cards**, Divisions,
Brackets, Schedule Editor, Waitlists, League Manager, Facility Calendar and Sales & Reports all
populate. No console errors. No failed requests. Every endpoint those screens call returns **200
with real data**.

That is the important finding, because it means the platform is much closer to working than the
session suggested, and the fix list is short and specific rather than a rebuild.

| # | Root cause | Explains | Proven how |
|---|---|---|---|
| **R1** | **Org context poisoning.** The org switcher offers an org the owner has no role in, and the choice is sticky in `localStorage`. | Empty dropdowns, "No events yet", "Couldn't load your events", dead boards, "no test data", stuck loading — on *every* module at once | Reproduced both failure modes in-browser |
| **R2** | **Test data generate AND wipe are permanently broken after the first successful run**, by a foreign-key ordering mistake in the shared delete list | "Test failed to generate data", the 500, and no way to recover | Reproduced in isolated SQLite; exact failing statement identified |
| **R3** | **Service worker serves arbitrarily stale assets.** Cache name never bumped in 67 releases; fallback ignores the cache buster | Missing button labels, "Can't reach the server", breakage that a clean browser cannot reproduce | Code-confirmed; SW confirmed active on the live page |
| **R4** | **Court Board (KOTC) is unreachable from the UI** — the create-session and add-players routes have no caller | "No tables or tiles load on the court board", and its empty state tells you to do something impossible | `grep` of the whole `web/` tree |

R1 alone accounts for most of the report. It is a genuine platform defect — not operator error —
because nothing on screen tells you which org you are in or that you have no access to it.

---

## §1. R1 — Org context poisoning (the big one)

**What is wrong.** The admin header's org switcher lists **four** orgs:

| Org | Name | Owner's role | `/api/events` | `/api/admin/dashboard` | `/api/admin/members` |
|---|---|---|---|---|---|
| 1 | Boomtown Athletics | admin | 200, 6 events | 200 | 200 |
| 2 | Match Point Social | admin | **200, `{"events":[]}`** | 200 | 200 |
| 3 | Queens Club | admin | **200, `{"events":[]}`** | 200 | 200 |
| 4 | Colorado Boom | **none** | 200, `{"events":[]}` | **403** | **403** |

`/api/me` returns roles on orgs **1, 2 and 3 only**. Org 4 is offered in the switcher anyway.

The selected org is stored in `localStorage` as `bt_org` and sent as `X-Org-Id` on every request, so
**one click on the switcher changes every page in the admin surface and survives reloads and tab
closes.** There is no way to notice: the switcher is a small control in the header, and no screen
says "you are in Match Point Social" or "you have no access here".

**Two distinct failure modes, both reproduced in-browser:**

- **On org 2 or 3** (roles exist, but they are empty orgs): every request succeeds with an empty
  list. All test data is hardcoded to `org_id 1` in the seeder, so it can never appear here. Result:
  every event dropdown collapses to a single **"No events yet"** option, `eventId` stays `null`, and
  every module's `load()` returns early — so the board, the grid, the tiles and the buttons render
  nothing at all, with **no error message**, because nothing errored. Measured on org 2: Pool Board,
  Divisions, Brackets, Tryouts and Schedule Editor all showed `1opt(No events yet)` and an empty
  body. **This is the exact screen in the report.**
- **On org 4** (no role): staff endpoints 403. The modules that surface it print **"Couldn't load
  your events."** — the other exact string in the report. The dashboard, worse, renders its shell and
  silently shows nothing rather than saying access was denied.

**Why "Dashboard works but links go to dead features" is the same bug.** The dashboard the owner
photographed is org 1 ($475 outstanding, 49 members — matches live D1 exactly). The modules were
photographed after the org had changed. Nothing on screen connected the two.

**Fixes, in order of value:**

1. **Filter the switcher to orgs the user actually has a role in** (from `/api/me`). Offering org 4
   is the defect; a 403 the UI cannot explain is the symptom. *One-line-ish, server-truth-driven.*
2. **Make the active org visible and unmissable** on every admin screen — not only inside the
   switcher control. An operator must never be unable to answer "which org am I in?"
3. **Say it out loud when an org is empty.** "No events yet" is indistinguishable from "this module
   is broken". It should read as an org-scoped empty state that names the org and offers the switch
   back — and, in the sandbox, offers Generate test data.
4. **A 403 must say what it is.** "You don't have access to Colorado Boom — switch org" beats
   "Couldn't load your events", which blames the module.
5. **Consider making org selection session-scoped, not `localStorage`.** Sticky-forever cross-tab
   state is what turned one stray click into "almost every module does not work".

---

## §2. R2 — Test data: generate and wipe are both dead, and there is no way out

**Reproduced live:** `POST /api/admin/testdata/generate` → **HTTP 500**,
`{"error":"Something went wrong handling that request. It has been logged.","failed_modules":["sandbox"]}`
— byte-identical to the owner's screenshot.

**Root cause, proven.** `WIPE_SQL` in `worker/src/sandbox.js` (shared by *both* generate and wipe)
deletes parents before children:

```
WIPE_SQL[3]  DELETE FROM brackets WHERE event_id BETWEEN 90000 AND 90999   ← fails here
WIPE_SQL[8]  DELETE FROM matches  WHERE ... event_id BETWEEN 90000 AND 90999
```

`matches.bracket_id REFERENCES brackets(id)`. D1 enforces foreign keys, so deleting the bracket while
its matches still point at it raises **`FOREIGN KEY constraint failed`**. `D1.batch()` is one
transaction, so the whole 57-statement wipe-and-reseed rolls back and nothing changes.

**The rows that cause it are written by `generate` itself.** Its last step draws Winter Jam's bracket
through the real generator (`generateBracketFor`, event 90005), which creates the `brackets` row and
the `matches.bracket_id` values that block the next run. So:

- **First press on an empty range → succeeds.**
- **Every press after that → 500, forever.**

Verified against live D1: `brackets = 1` for the test range, and the test contacts still carry their
original `created_at` of `2026-08-05 03:56:04` — my generate call **did not commit**. The seed on
screen is the survivor of the last successful run, which is why the modal cheerfully reports
"6 events · 62 teams · 204 games · 24 registrations · 48 contacts" while the button fails.

**Repro (isolated, no live writes):** schema rebuilt from `db/migrations/`, `PRAGMA foreign_keys=ON`.
Press #1 on an empty range committed cleanly (48 contacts, 6 events, 62 teams, 197 matches — plus the
7 bracket games the generator adds = the 204 live). Then, after inserting the bracket rows generate
itself writes, press #2 failed at `WIPE[3]` with `FOREIGN KEY constraint failed`.

**Wipe is broken by the same list**, which is why there was no recovery path: the button whose entire
job is to clear a stuck seed is stuck on the same statement. The owner was correctly told to press
"Regenerate test data" and could not, through no fault of their own.

**This is a v2.1 regression of the exact bug v2.1 was written to fix.** That file's header says
"GENERATE COULD BE BLOCKED BY ITS OWN PREVIOUS OUTPUT. THAT WAS THE BUG." It removed the 409 refusal
and reintroduced the same class through FK ordering.

**Fix:**

1. **Reorder `WIPE_SQL` children-before-parents.** Correct order: `attendance` · `checkins` ·
   `division_moves` · `standings` · **`matches`** · `team_members` · `waitlists` · `registrations` ·
   **`brackets`** · `pools` · `teams` · `divisions` · `events` · `waivers` · `contacts`.
2. **Widen the list to every table that references the test range.** Currently uncovered and
   currently empty, but each is a live landmine the moment a tester touches that module:
   `tryout_evaluations`, `tryout_profiles`, `tryout_squads`, `tryout_squad_members`, `kotc_sessions`,
   `kotc_players`, `kotc_slots`, `kotc_games`, `waitlists`, `form_fields`, `space_bookings`,
   `staff_shifts`, `notifications`, `profiles`. **Measured now: all zero** — so this is cheap to fix
   today and expensive to fix after the next tester round.
3. **The guard this needs is a second press.** The existing test seeds an empty database, which is
   why a suite of 1258 stayed green through a totally dead button — and it is the same flaw my own
   first repro had. The negative control must be **generate, draw the bracket, generate again**, and
   it must fail before the fix. *(Standards §6: mutate the real input.)*
4. **Derive the delete order from the schema, not from a hand-written list.** A hand-ordered list is
   correct until someone adds a foreign key. `sqlite_master` already knows the graph.

---

## §3. R3 — The service worker can serve months-old assets

`web/sw.js` is network-first, which is right, but its fallback is not:

```js
const CACHE = "bt-shell-v1";                        // never bumped since v0.20.0 — 67 releases
const hit = await caches.match(req, { ignoreSearch: true });   // ignores ?v=0.87.0 entirely
```

`activate` deletes caches whose key `!== CACHE`, and `CACHE` never changes, so **the cache from
v0.20.0 has never been invalidated**. Because the fallback sets `ignoreSearch: true`, a cached
`admin-brackets.js?v=0.60.0` satisfies a request for `?v=0.87.0`. Any single failed fetch — a dropped
wifi frame, a cold worker, a tunnel — serves whatever version was cached, and a page can end up with
**new HTML and old JS/CSS at the same time**.

The service worker is confirmed **active** on the live site (`navigator.serviceWorker.controller`
is set).

**[INFERENCE] This is the best explanation for the unlabeled gold buttons.** In a clean browser I
measured that control and it is correct: `#0B0B0D` ink on `#D4AF37` gold, ~13:1, label present
("+ New event" on the dashboard, "Go to Dashboard" in the error state). It is not a CSS defect in
`v0.87.0`. A stale `tokens.css` or `app.css` paired with current HTML would produce exactly a gold
fill with an unreadable label — and it also explains why a fresh browser cannot reproduce any of it.
**To confirm on the owner's machine:** DevTools → Application → Service Workers → Unregister, then
Clear storage, then hard-reload. If the labels return, this is settled.

**Fix:** derive the cache name from the release version so `activate` evicts on every deploy; drop
`ignoreSearch` (or key the cache on the buster) so a stale asset can never satisfy a fresh request;
and never fall back across a version boundary. **Ship a one-time `unregister()`/cache-purge path**,
because every tester's browser is already holding a poisoned cache and no amount of correct future
code cleans it.

---

## §4. R4 — Court Board is unreachable (failure class 1: built, tested, uncalled)

The report said "no tables or tiles load on the court board and no test data". Both true, and it is
not a rendering bug. `/api/admin/kotc` returns `{"sessions":[]}` and the board honestly reports
**"No sessions yet"**.

The routes to create one exist in `worker/src/kotcplay.js`:

- `POST /api/admin/events/:id/kotc` — creates the session
- `POST /api/admin/kotc/:id/players` — adds the entry list

**Nothing in `web/` calls either.** A grep of every `.html` and `.js` under `web/` for those paths
returns nothing; `web/assets/admin-kotc.js` only ever *reads* (`/api/admin/kotc`, `…/:id`) and moves,
withdraws or advances an existing session. `web/assets/admin-event.js` has no KOTC code at all.

So the board's own empty state — *"Create one on the event, add the entry list, then come back here
to seat the nets"* — instructs the operator to use a control that does not exist. KOTC was recorded
as "complete as a format" through five releases (engine → solver → player link → board → standings)
and **cannot be started by a human being.**

The seeder makes no KOTC session either, so test data cannot rescue it.

**Fix:** a create-session control plus an entry-list picker on the event page (routes are done and
tested — this is UI only), and a KOTC session in the test-data seed so the board has something to
show. **Then assert the call sites**, per the standing rule that a route is not shipped until
`index.js`/the client actually calls it.

---

## §5. Per-screen results

Measured on org 1, signed in as admin, in Chrome. "Works" means the screen populated with real data
and threw nothing.

| Screen | Result | Notes |
|---|---|---|
| `admin.html` Dashboard | **Works** | Tiles match live D1 ($475, 49 members, 5 events). Quick-links resolve. On org 4 it silently renders nothing instead of reporting the 403 — see R1. |
| `admin-events.html` | **Works** | — |
| `admin-registrations.html` | **Works** | — |
| `admin-waitlists.html` | **Works** | 5 events, table renders. Report said "waitlist fail" — org state (R1). Brevo unset, so offer emails stay sandboxed (known, owner-paused). |
| `admin-checkin.html` | **Works** | Empty state renders. |
| `admin-tryouts.html` | **Works** | 6 events, player cards, notes and 1–5 rating render. Report's "Couldn't load your events" was R1. |
| `admin-facility.html` | **Works** | Calendar renders; rental requests correctly hidden behind `RENTALS_ENABLED:false`. |
| `admin-kotc.html` Court Board | **BLOCKED** | **R4** — no session can be created anywhere. |
| `admin-league.html` | **Works** | League loads; "No teams yet — teams land here from registrations" is honest. |
| `admin-schedule-editor.html` | **Works** | 6 events. Report was R1. |
| `admin-brackets.html` | **Works** | 6 events, generate/advance wired. See §6.1 for the "frozen" modal. |
| `admin-divisions.html` | **Works** | 6 events, layout table renders, overlap warnings fire correctly (they are the feature, not errors). See §6.2. |
| `admin-pool-board.html` | **Works** | **30 draggable tiles** on the 12-Court Classic. Report was R1. |
| `admin-score-links.html` | **Works, poor first paint** | Correctly says "Pick an event and choose Get links" — it mints links on demand, by design. Reads as an empty page. See §6.3. |
| `admin-users.html` Members | **Works** | 6 rows, three tabs, `+ Add admin / staff` present and bound. "Does not load members" was R1 (403/empty org). |
| `admin-reports.html` | **Works, wrong number** | See §6.4 — **$0 revenue against 20 paid registrations**. |
| `tournament.html` Tournament Ops | **Works, blank first paint** | 7 events load, but the select defaults to the **"— choose event —"** placeholder, so the page is blank until you pick. See §6.5. |

---

## §6. Secondary defects found while testing

1. **Brackets "Who plays here?" reads as frozen.** It is not frozen — `bPickClose` is bound and
   `Escape` closes it. But the filter hides non-matching `<li>`s with **no empty state**, so typing
   `adfaf` (as in the report) empties the dialog completely and it looks hung. Add "No teams match
   'adfaf'" and a backdrop click-to-close. *Small, high-confusion-per-line.*
2. **Divisions' warnings look like breakage.** "Two divisions are given court 2" and "AA has its last
   court before its first" are the validator working, but they render in the same warning voice as a
   real error, and "This event has no court count set" appears alongside a "4 courts assigned" badge.
   The screen needs to distinguish *you have more to do* from *this is broken*, and `Save layout`
   should state why it is disabled.
3. **Scoring Links has no first-paint content.** Every other module auto-selects the first event;
   this one waits for a button. Either auto-load, or make the instruction the visual centre of an
   intentional empty state rather than a line of small text under empty controls.
4. **Sales & Reports shows `$0 ALL-TIME REVENUE` next to `20 PAID REGISTRATIONS`.** The test
   registrations carry `status='paid'` but no `price_cents`, so revenue sums to zero. Either the
   seeder should price them or the report should not present a contradiction. A tester reads this as
   a money bug.
5. **`tournament.html` defaults to a placeholder option** while every other module defaults to the
   first real event. Inconsistent, and it is why Tournament Ops looked like it loaded no events.
6. **Migration filenames do not sort in migration order.** `0003_admin_schedule.sql` and
   `0025_guardian_invite.sql` have no date prefix, so a lexical sort puts them *before*
   `2026-07-21_0001-foundation_v0.1.sql`. Any tool that replays `db/migrations/` in filename order
   applies 3 and 25 first and fails. It has not bitten because migrations are applied by hand via
   Cloudflare MCP — but it will bite the first automated rebuild, disaster recovery, or local
   harness. **[FACT]** — hit on the first run of my own repro. Rename the two odd files.
7. **`fail()`'s middle action is a gold `<a class="btn">` among two ghost buttons.** Correct
   contrast, but "Go to Dashboard" is styled as the *primary* action in a three-button error state
   where "Reload" is what the operator almost always wants. Minor hierarchy inversion.

---

## §7. Recommendation — loop the fixes in this order

Sequenced so each block is independently shippable and testable, then combined, per the owner's
"loop fixes by section, then combine sections into sub categories" request.

**Block A — Make the sandbox usable again (do this first; nothing else can be tested without it).**
Nothing here needs a migration or a design pass.

- A1. Reorder and widen `WIPE_SQL`; derive the order from the schema graph (§2).
- A2. Second-press negative control that fails before the fix (§2.3).
- A3. Add a KOTC session to the seed, and price the paid test registrations (§4, §6.4).

**Block B — Make the org context honest (the single highest-value UI change on this list).**

- B1. Switcher lists only orgs from `/api/me`.
- B2. Active org visible on every admin screen.
- B3. Org-scoped empty state that names the org and offers the switch back + Generate test data.
- B4. 403 renders as "no access to <org>", never as "couldn't load your events".
- B5. Decide `localStorage` vs session scope for `bt_org`.

**Block C — Kill the stale-cache class.**

- C1. Version-derived cache name; drop `ignoreSearch` on the fallback.
- C2. One-time unregister/purge so already-poisoned browsers recover.
- C3. Confirm R3 on the owner's machine first (§3) — one DevTools check, and it decides whether C is
  urgent or merely correct.

**Block D — Close the reachability gap.**

- D1. Create-session + entry-list UI for KOTC on the event page (routes exist).
- D2. A guard that asserts every admin route has a caller in `web/` — this is failure class 1 and it
  has now produced a whole format that cannot be started. Assert **call sites**, not definitions.

**Block E — The polish the tester round actually surfaced.**

- E1. Brackets chooser empty state + backdrop close.
- E2. Divisions: separate "more to do" from "broken"; explain the disabled Save.
- E3. Scoring Links + Tournament Ops first paint; auto-select the first event everywhere.
- E4. Rename the two mis-sorting migration files.

**Ordering rationale:** A unblocks all testing. B removes the cause of most of the report. C prevents
a whole class of "it works on my machine". D closes a feature that is 100% built and 0% reachable.
E is real but cosmetic by comparison.

---

## §8. What this round says about the process

**A green suite of 1258 tests and a CLEAR preflight coexisted with a dead sandbox button, an
unreachable format, and a one-click path into total apparent failure.** None of those are visible to
any gate currently in the repo, and each one has a specific reason:

- **The test-data guard seeds an empty database.** The defect only exists on the *second* press.
  A fixture test that never runs twice cannot see an idempotency bug — and it is exactly the mistake
  my own first repro made, which is the most useful thing in this document: *the state that breaks a
  reseed is the state the previous reseed left behind.*
- **"Complete as a format" was asserted from the module, not the call site.** KOTC's engine, solver,
  player link, board and standings are all real. The standing rule already says assert call sites,
  never definitions; it was applied to `index.js` mounting worker modules and not to the client
  calling the routes. **The rule needs to run in both directions.**
- **Nothing tests a second org.** Every guard and every manual check runs on org 1 with data. The
  entire failure surface in this report lives one dropdown away, and no test has ever been there.
  **A multi-tenant app needs a test that runs as a user in an empty org and a user with no role.**
- **The handoff's own warning was right again.** v1.10 §7 says *"do not believe this document about
  anything you are about to build on"*, and *"if the claim is about data, query live D1."* The claim
  "KOTC is complete as a format" was true of five components and false of the feature. One grep
  settled it, exactly as one grep settled the previous session's equivalent.

**One number to correct:** handoff §5 says test-data contacts returned "8, not 48" and needed a
regenerate. Live D1 now reads **48 contacts, 6 events, 62 teams, 204 matches, 24 registrations** —
the seed is complete and healthy. The owner's press *did* work at 03:56 UTC on 2026-08-05. What is
broken is every press after it.

---

*Changelog: v1.0 (2026-08-05) — first full-surface tester-round audit. Four root causes proven (org
context poisoning · FK ordering in the shared test-data delete list · never-invalidated service
worker cache · uncalled KOTC session routes), 17 screens measured in a live signed-in browser, seven
secondary defects recorded, and a five-block fix sequence handed to the roadmap.*
