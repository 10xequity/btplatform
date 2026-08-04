# Boomtown Platform — Document Index

**File:** docs/INDEX.md · **Version:** v2.3 · **Created:** 2026-08-02 · **Updated:** 2026-08-04
**Status:** ACTIVE · **Supersedes:** nothing — first index of the doc set.
**Purpose:** what each document is, whether it is live, and where the live documents disagree
with each other. Read with `CLAUDE.md`.

---

## 1. Live working set — read every session

| File | Ver | Date | What it is |
|---|---|---|---|
| `2026-08-04_handoff_v0_85_0.md` | **v1.7** | 2026-08-04 | **State of record.** §0 records **v0.85.0 shipped and verified live** (`/api/health` v0.85.0, five live-artifact checks, CI added no commit) — and that the `git push` refusal which had ended the session **cleared on retry with nothing changed**, so retry a blocked tool before writing the session up around it. `gh` is blocked, so CI logs are unreadable from a session. Then: measured build state (§1), what shipped (§2 — **the KOTC player link**, and the finding that the KOTC API was **complete for one screen of three**), §3 **C14: a verification that reuses the corpus of the thing it verifies is not an independent check**, owner answers (§4 — per-player scoring links now recorded as settled), owed items (§5 — the seed tap **verified still unpressed against live D1**), next build (§6 — **the other two KOTC screens as ONE job**, carrying three missing routes), next-session prompt (§7). Renamed from handoff v0.84.0. |
| `2026-07-30_standards_v2_0.md` | **v2.2** | 2026-08-03 | **Build and design law.** Trust order, versioning, DB rules, worker module pattern, design roster (§5), testing gates (§6), CI, member copy (§8), templating (§10). Reconstructed after a doc-set loss; §5/§6.5/§8/§10 anchors preserved so in-code citations stay valid. |
| `2026-08-02_roadmap_v1_0.md` | v1.0 | 2026-08-02 | **Roadmap of record.** 8 unbuilt modules, 5 small gaps, 4 engineering tracks, 5 owner-gated config items, 4 doc-debt items, suggested sequence. Supersedes the README roadmap block and the stale half of `build-status.js`. |
| `INDEX.md` | v2.3 | 2026-08-04 | This file. |

## 2. Live reference — open when the topic comes up

| File | Ver | Date | Open it when |
|---|---|---|---|
| `2026-08-01_decisions_org-roster_v1_1.md` | v1.1 | 2026-08-01 | Touching orgs, payments binding, or org deletes. Holds the keep-set (BTA/MPS/Queens/COBO), D-ORG-5..8, and the live-D1 scan that narrowed the delete set to orgs 6–9. |
| `2026-08-01_requirements_lfg-membership_v1_0.md` | v1.0 | 2026-08-01 | Touching LFG, membership custom fields, or the opportunities feed. **See contradiction C2 below — §4 is out of date.** |
| `2026-08-01_uiux-review_admin-shell_v1_0.md` | **v1.1** | 2026-08-02 | Touching any shell, rail, header, or contrast. Names the real AA offenders by file and line. Steps 1–3 of §6 shipped; **step 4 (SPA shell) is the last open item.** |
| `2026-08-03_workorder_member-experience_v1_1.md` | v1.1 | 2026-08-03 | Member-experience scope W1-W10, accepted onto the roadmap. Read §0 FIRST — it lists the seven assumptions that went stale since the Desktop original. Four owner decisions open. |
| `2026-08-03_scope_format-engine_v1_0.md` | **v1.1** | 2026-08-03 | Scoping M-TF, league flexibility or the drag-and-drop editor. Reframes the eight requested features as ONE constraint solver, splits hard from soft constraints, proposes 8 shippable slices, and records the real roster shape found in Drive. Four owner decisions listed at the end. |
| `2026-08-03_spec_kotc_v1_1.md` | **v1.1** | 2026-08-03 | Building King/Queen of the Court. **Engine BUILT (v0.76.0, migration 0040) and the SCORING SOLVER BUILT (v0.79.0) — four player totals usually determine all six scores of a net, and it never guesses. **REACHABLE since v0.80.0** (migration 0042: the entry list 0040 never had, per-player links, confirm-or-edit). The API is complete; the three SCREENS are what remain.** All **five** of v1.0's open questions are answered verbatim in §6, including "director sets `move_up` each session" (no formula is encoded anywhere — do not add one). §7 records two findings against v1.0, the larger being that the soft-constraint optimiser it asked for has nothing to optimise: a net plays *all* its pairings. Supersedes and replaces v1.0. |
| `2026-08-01_demo_admin-shell_v4_0.html` | v4.0 | 2026-08-01 | Working the SPA shell. Open it in a browser and toggle the theme — it is the target model, not a mockup to copy verbatim. |

## 3. Archive — never read during a normal build

| File | Ver | Date | Open it only to answer |
|---|---|---|---|
| `archive/2026-07-26_library_v1_0.md` | v1.0 | 2026-07-26 | "What were the owner's exact words on X" (§1, all 24 requirements verbatim) · "Why was decision D-… made" (§4, full decision log) · "Has this defect happened before" (§2, closed-finding register + the four recurring failure classes) · "What are we benchmarking against" (§5). |
| `archive/2026-07-26_waiver-text-v2_candidate_v2_2_restored.md` | v2.2 | 2026-07-26 | Seed data only. **Not published, and the database does not contain it.** The waiver system is CLOSED to further work (owner 2026-07-26). Reconstructed from transcripts — word-for-word fidelity is not guaranteed, and §6/§7 carry real legal exposure. Do not treat as a specification. |
| `archive/2026-08-01_CHANGELOG-block_v0_45_0.md` | v1.0 | 2026-08-01 | **Superseded.** Handoff §7 directs deletion — this content now lives inside the reconstructed repo `CHANGELOG.md`. Retained only until the v0.45.0 LFG detail is confirmed against it, then delete. |

---

## 4. Contradiction register — live documents that disagree

These are instances of **failure class 2**: a decision recorded is not a decision in force until
every restatement changes. Fix them in the next release; until then, the ruling below governs.

**C1 — CHANGELOG / ZIP delivery. ~~OPEN~~ RESOLVED 2026-08-02, all restatements struck.**
The dispute was whether `CHANGELOG.md` belonged in the release ZIP. It was overtaken: the owner
authorized **direct commit**, retiring the ZIP itself, so every position in the argument is moot.
**Ruling: `CLAUDE.md` §2 governs — preflight CLEAR → commit → push, and CI owns `CHANGELOG.md`
through `changelog-entry.mjs`. Never hand-write it.**
*Fixed in the same release, not deferred:* standards §9 (→ v2.1) and uiux-review §6 (→ v1.1) both
struck and now point at `CLAUDE.md` §2; handoff §0 marked superseded with its reasoning preserved
as history. This register entry is retained as the audit trail — the four-document sweep is what
failure class 2 actually requires.

**C2 — Requirements §4 reads "awaiting owner answers." It is not.**
All seven questions were answered 2026-08-01 and built into LFG v0.45.0: any member posts · casual
is free-form · 12-hour bail window · the poster reports the no-show · in-app messaging only · 18+ ·
the team shell forms immediately. The document was never re-versioned. Handoff §5's "LFG deep
behavior gated on requirements §4" therefore reads as a live blocker when it is not.
**Ruling: treat §4 as answered.** *Fix: requirements v1.1 recording the answers; owner to confirm
the handoff §5 blocker can be struck.*

**C3 — Handoff §6 cites "requirements §15," which does not exist.**
That document ends at §4. The intended reference is almost certainly requirements **§3** — spec
work for existing modules benchmarked against LeagueApps / TeamSnap / SportsEngine, then an owner
interview. *Fix: correct the citation in the next handoff.*

**C4 — `build-status.js` was stale and wrong. ~~OPEN~~ RESOLVED v0.55.0 / v0.56.0.**
It told testers the check-in waiver gate is live; that gate was removed in v0.33.1 (D-MIN-8, owner:
"no gating"). This register recorded **one** instance — there were **two**, so the audit was itself
narrower than its subject, the very failure class it was auditing for. Also fixed: 16 of 45 pages
had no entry, four shipped features still read "soon", the `.ics` row denied a button that had
existed for three releases, and the note claiming one-click mute was unbuilt (M16 shipped it).
**Ruling: closed.** `build_status.test.mjs` now ratchets page coverage plus the two specific
copy-vs-code claims. Prose could not hold a registry current; a guard can.

**C5 — README §Roadmap was stale. ~~OPEN~~ RESOLVED v0.55.0.** It is now a pointer to
`docs/2026-08-02_roadmap_v1_0.md`, deliberately — the inline queue had gone stale three times and
still listed the v0.51.0/v0.52.0 work as upcoming.

**C6 — the buster guard cannot tell a needed sweep from an unneeded one. OPEN.**
`asset_versions.test.mjs` asserts the cache-buster is **one** value, not the **current** one.
v0.55.0 therefore changed `build-status.js` with no sweep and stayed green — a cached browser would
have kept serving the wrong tester copy, so that release's fix would not have reached anyone. Swept
in v0.56.0. **Ruling: sweep the buster in any release touching `web/**`.** *Fix: a preflight check
that blocks when the diff touches `web/**` and no buster value moved with it (handoff §6).*

*Second finding, 2026-08-03 (v0.66.0):* the release sweep had **never** covered `.js` — only
`.html`. `admin-nav.js`, `site-nav.js` and `signup-widget.js` each carry a `?v=` string and all
three had been stale for an unknown number of releases. `asset_versions.test.mjs` did catch the
mismatch once a `.html` page moved ahead of them, which is the only reason it surfaced. Swept.
**C6 remains OPEN** — the original defect is unfixed: the guard still asserts the buster is *one*
value, not the *current* one, so a release that touches `web/**` and sweeps nothing is still green.

**C7 — new admin pages inherit and multiply stray closing tags. ~~OPEN~~ RESOLVED v0.66.0.**
Pages are generated by slicing the shell off an existing page, so a stray `</main>` in the source is
copied *and incremented*. Browsers discard an unmatched closing tag in silence, so nothing ever
looked wrong: by v0.65.0 five pages carried 5, 4, 4, 3 and 2 of them. **Ruling: closed.**
`page_structure.test.mjs` scans every shipped HTML file for unbalanced or doubled landmarks and
caught the very next generator run. Generate new pages only from a page that passes it.

**C8 — the QR code never worked, and said so only where nobody would read it. ~~OPEN~~ RESOLVED v0.68.0.**
`admin-checkin.html` loaded `qrcodejs` from a CDN and fell back to the on-screen text "QR library
blocked — use the link." That sentence was the only record the feature was dead, and it appears at
exactly the moment someone needs a QR and has no time to read it. **Ruling: closed.** `assets/qr.js`
encodes locally; no page makes an external request for it.
*Left deliberately:* `cropperjs` on `profile.html` is still a CDN dependency. It fails soft, and a
photo cropper is not worth hand-rolling.

**C9 — a CHANGELOG entry claimed a fix that was never applied. OPEN as a standing rule, the instance is closed.**
v0.74.0's CHANGELOG states: *"Corrected the live board's own header comment, which claimed 'no player
names anywhere' and had stopped being true the moment this shipped."* It was not corrected.
`git show 89d2490 -- worker/src/live.js` shows a **new** comment added above `publicTeam` explaining
abbreviation, and the stale header line — *"No player names. Team names only."* — untouched. A comment
was written *near* the problem and mistaken for the fix, and `live.js` documented a rule it did not
follow for a whole release.

This is failure class 2 landing on the project's own history rather than on a spec, which is what makes
it worth its own entry. Every earlier instance (C1–C4) was prose disagreeing with prose. This is the
document the project treats as the record of what happened being wrong about what happened.

**Ruling: a document saying a thing was fixed is not evidence the thing was fixed. Only the file is.**
When a handoff, CHANGELOG or spec claims something is done, `grep` it before building on it. *The
instance was fixed in v0.75.0 — the header now states the rule it actually follows and marks where it
had drifted. The rule stays open because it is a habit, not a line of code, and no guard can hold it.*

*Corollary recorded the same release:* **an unreachable module needs a ratchet, not a paragraph.** The
KOTC engine shipped in v0.76.0 with no route and no screen; rather than note that in a handoff nobody
re-reads, `kotc.test.mjs` asserts `index.js` does not mention `kotcRoutes`/`wireKotc` and goes red the
moment somebody wires them. The schema gate caught migration 0040 this session for the same reason —
it is a failing test, not a sentence.

**C10 — the harness schema was half the database, and no test could see it. ~~OPEN~~ RESOLVED v0.81.0.**
`worker/testkit/journey-schema.sql` says in its own header that it is "the real production schema, read
verbatim from live". It carried **46 of live D1's 97 tables**. Twenty-nine endpoints across sixteen admin
pages returned 500 in a harness reporting itself healthy — and a page whose first fetch 500s stops rendering,
which is the owner's "the screens all terminate".

It survived 1127 passing tests because every test needing a missing table **hand-rolled its own copy** and
passed, while every test not needing one never asked. Nothing compared the file against what it claims to
mirror. **This was not a failing test; it was the absence of one, and absences never go red.** That is a
distinct failure class from the four in the library: not a guard narrower than its subject, but *no guard at
all* over the thing every other guard stands on.

**Ruling: closed.** `schema_gate.test.mjs` now asserts every table in `db/migrations` exists in the harness
schema, with a negative control; the ten hand-rolled tables across three test files are deleted.
~~*Separately still open:* the generator leaves a partial seed on live — handoff §2b.~~ **That line was
wrong — see C12.** There is no partial seed and never was.

**C11 — two guards covered the same buttons, both passed honestly, and both were pointed elsewhere. ~~OPEN~~ RESOLVED v0.82.0.**
Twenty-four buttons — thirteen in `admin-pos.html`, eleven in `admin-pos.js` — shipped carrying a shared
modifier with no base: `class="primary"`, `class="secondary"`, `class="ghost"`. Those are not standalone
classes; `app.css` declares them as `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.btn.sm`, `.btn.small`. Each
button therefore inherited nothing and rendered as a **user-agent default control — grey face, black text — in
both themes.** Present since the page's first commit (`083cb32`): never a regression, so no diff review could
have caught it. This is the owner's *"many of the buttons text is not colored properly."*

Two guards stood over it and neither was wrong about its own question:
`tokens.test.mjs` ratchets token **drift**, and these buttons referenced no token, so nothing drifted —
**a page can fail by using NOTHING, and a drift guard is structurally blind to that.**
`shared_buttons.test.mjs` forbids page-level selectors that **start with** `.btn`, policing *redefinition*;
these pages never redefined the shared set, they failed to **use** it. The guard was aimed one inch to the
left of the defect. A contrast guard would not have helped either: there is no foreground/background pair to
measure when the only declaration is `min-height`.

This is **C10's shape, not failure class 3** — not a guard narrower than its subject, but the *absence* of a
guard over it. **Ruling: closed.** `button_vocabulary.test.mjs` requires `btn` alongside any modifier, parses
the modifier list out of `app.css` so it cannot go stale, and scans every `web/*.html` **and**
`web/assets/*.js` — eleven offenders were in a script, and an HTML-only guard would have called the page clean
and been half right. `token_contrast.test.mjs` separately measures every declared token pairing in both
themes, turning the gold rule from prose into arithmetic (gold-as-text on light: **1.87:1**; `--emphasis`:
**14.22:1**). Both ship negative controls that mutate the real input; the vocabulary guard's control proves a
geometry-only page rule does not earn an exemption, which is the precise hole the bug fell through.

**C12 — a handoff recorded a diagnosis the database contradicted. OPEN as a standing rule; the instance is closed.**
Handoff v0.81.0 §2b stated that live D1 held a **partial** test-data seed — "3 of 6 events and 8 of 48
contacts" — left by a generator that died part way, with a stated `[INFERENCE]` about Workers CPU time or a D1
per-invocation statement cap. Four queries against live D1 overturned all of it. The rows are a **complete
v1-era seed written 2026-07-24 16:18:40**, ten days before `sandbox.js` v2.0 shipped: all eight contacts share
one timestamp (a multi-row `INSERT` is atomic in SQLite, so "8 of 48" is arithmetically impossible as a
partial write), `city` is "Colorado Springs" which is absent from the current `CITIES` array, every
`score_token` is NULL where the current code always writes one, and two of three event names differ from the
strings the current file inserts. The limit theory fails on the documented numbers too: D1 allows **1000
queries per Worker invocation** on Workers Paid and the route issues **44**.

Where **C9** was a CHANGELOG wrong about a *fix*, this is a handoff wrong about the *state of the world*, and
two sessions had built on it — one of them spending its effort on "make the seed resumable" when there was no
interrupted seed to resume. The actual defect was never partial state: `generate` **refuses** with 409 when it
finds its own previous output, so an older seed is a dead end.

**Ruling: when a document describes DATA, verify it against the data, not against the document's own
reasoning.** Repo > live D1 > docs is already the trust order (standards §1); the failure was reading the third
tier and never consulting the second. Four queries were enough. *The instance is closed — handoff v0.82.0 §2b
records the correction and the specified fix. The rule stays open because it is a habit, and no guard can hold
it.*

**C13 — a guard cannot see a file that is not in its corpus, and this is the third instance in three sessions. ~~OPEN~~ RESOLVED v0.84.0 (the rule stays open as a habit).**
`404.html` ships from the **repo root** — GitHub Pages serves it for any missing path — and references
`/btplatform/web/assets/tokens.css?v=…`. It sat at **`?v=0.74.0`** from v0.74.0 through v0.83.0 while all
369 busters under `web/` read 0.83.0. A browser holding a cached `tokens.css` from ten releases back would
have styled the 404 page with it.

`asset_versions.test.mjs` reported clean the entire time, and its own header says it "scans the **WIDEST**
set". It does — `web/*.html` and `web/assets/*.js`. **The stale file was one directory up.** The guard was
never wrong about anything it looked at; nobody had narrowed it; the file was simply never inside it.

That makes three of the same shape in three sessions, worth naming as one pattern rather than three
coincidences:

| Instance | The guard | What it could not see |
|---|---|---|
| **C10** (v0.81.0) | none existed | `journey-schema.sql` — 46 of live's 97 tables, the thing every other guard stood on |
| **standards §11** (v0.82.0) | `schema_gate.test.mjs` | migrations 0004–0007, loose at `db/` root |
| **C13** (v0.84.0) | `asset_versions.test.mjs` | `404.html`, at the repo root |

These are **not** failure class 3 ("a guard narrower than its subject"). A narrow guard makes a claim about a
subject it has partly seen. These made no claim at all about the missing file, and **an absence never goes
red** — C10's distinct class, now with three data points.

**Ruling: a file's location is part of whether a guard can see it.** "The widest set" must mean the widest
set that *ships*, not the widest directory somebody remembered to name. When widening a guard, ask what ships
that the corpus still excludes. *The instance is closed — the buster corpus now includes the repo root, with
a negative control that replays the exact ten-release regression against the real file. The rule stays open
because it is a habit, and no guard can hold it.*

*Related and still open:* **C6** — the buster guard asserts the busters are **one** value, not the
**current** one, so a release touching `web/**` that sweeps nothing is still green. C13 widened *what* is
scanned; C6 is about *what is asserted*, and is untouched.

**C14 — the sweep missed the repo root again, and its own verification shared the blind corpus. OPEN as a standing rule; the instance is closed (v0.85.0).**
One release after C13 named `404.html` at the repo root as the thing a `web/`-scoped guard cannot see, the
v0.85.0 buster sweep missed the repo root and left `404.html` at `?v=0.84.0` while all 369 busters under
`web/` moved to 0.85.0. The mechanism was mundane: `Get-ChildItem -Path . -Include *.html,*.js` with no
`-Recurse` matches **nothing** in PowerShell, because `-Include` is inert without `-Recurse` or a wildcard
path. The root files were never in the corpus.

What makes this its own entry rather than a second C13 data point is what happened next: **the sweep
verified itself clean.** The follow-up count was written from the same corpus expression, so it reported a
single consistent value across the files it could see, and the two steps agreed because they shared the
assumption. The check that existed to catch the mistake was built out of the mistake.

It surfaced only because the count came up **2 short of the 371 the previous handoff recorded**, and was
confirmed with **ripgrep across the whole repo** — a tool sharing no code with the sweep. Final state: 377
busters at one value.

**Ruling: a verification that reuses the corpus of the thing it verifies is not an independent check.** It
restates one assumption twice and reports the agreement as confirmation. C13 said a file's location is part
of whether a guard can see it; C14 adds that **a guard and its own check must not derive their file list the
same way** — and that a written-down count from the previous release is a cheap independent oracle. *The
instance is closed. The rule stays open because it is a habit, and no guard can hold it.* **Fix queued:**
`worker/scripts/sweep-buster.mjs`, corpus discovered the way `sync-rail.mjs` discovers rail pages, with a
check that shares no corpus code (handoff §6.2).

**C15 — standards §9 still describes the retired CHANGELOG stub workflow. OPEN.**
Standards §9 was rewritten in v2.1 to retire the ZIP convention, and the replacement text says: *"commit to
`main`, push, then **fill the CHANGELOG stub CI wrote**, same session. CI guarantees the entry exists; it
does not write it."* That is the v0.36–v0.51 process. It has been superseded three times over: since
v0.83.0 the entry goes **into the release commit before the push**, CI's `record-changelog` step finds it
present, its commit step is **skipped**, and **CI adds no commit at all** — there is no stub to fill.

So the fix for C1 replaced one stale sentence with a different stale sentence, in the same section, and the
register did not reopen. Failure class 2 landing on the document that records failure class 2.
**Ruling: handoff §0 governs.** *Fix: standards v2.3 striking §9's second paragraph. Cheap, and leaving it
is exactly the defect the doc set names.*

**C16 — the test suite is time-dependent, and when it fires it blocks every commit. OPEN.**
`passes.test.mjs`'s pay-report test went red **mid-session on 2026-08-04 with no code change**, and
because `preflight.mjs` gates commits on the suite, nothing could be committed until it was fixed. From
the next day it would have failed permanently.

`staff_pay.js` defaults a rate's `effective_from` to `datetime('now')` and resolves a shift against
**its own start** (`pickRate(rates, roleLabel, shift.starts_at)`). The test created a rate effective
*now*, then shifts hardcoded to `2026-08-04T17:00:00Z` — after `now` for a few hours that morning and
before it ever after. Once the clock crossed 17:00Z the rate stopped covering them, `pay_amount_cents`
came out empty, and the assertion read 0 instead of 5000. Fixed by deriving both the shift times and the
report window from `Date.now()`.

**The instance is closed; the class is wide open. 165 hardcoded `2026-dd-dd` dates live across 25 test
files.** Most are inert fixtures. The dangerous shape is specific — **a hardcoded fixture date compared
against a `datetime('now')` default** — and it is indistinguishable from the harmless ones without
reading each site.

This is a **new failure class**, not a variant of the register's existing ones. C13/C14 are guards blind
to their corpus; C11 is a guard pointed elsewhere; C12 is a document wrong about data. This is a test
that is **correct today and wrong tomorrow**, where the trigger is the calendar, the diff is empty, and
no review could have caught it because nothing changed. The standing rule "prefer relative dates in
tests" already existed — what was missing is that **nothing enforces it**, so 165 candidate violations
accumulated under a rule everybody agreed with.

**Ruling: a test whose correctness depends on when it runs is a defect even while it passes.** Audit the
25 files for the fixture-versus-`now` shape and convert those to `Date.now()` arithmetic; then guard the
shape, not absolute dates in general — migration filenames and CHANGELOG dates are legitimately
absolute. The guard's negative control reinstates the `passes.test.mjs` fixture and proves it reddens.
*Queued as handoff §6.2, ahead of feature work, because it taxes everything else.*

---

## 5. Consolidation log

| Date | Action |
|---|---|
| 2026-08-04 | Twenty-eight releases under direct commit (v0.57.0–v0.85.0), **v0.85.0 shipped and verified live** — `/api/health` v0.85.0, `404.html` at the repo root serving 0.85.0, and `origin/main` still at the pushed SHA, so CI added no commit. The `git push` refusal that had ended the session **cleared on retry with nothing changed**; `gh` stayed blocked, so CI logs are unreadable from inside a session and a deploy is confirmed by preflight plus a live fetch. Handoff v0.84.0 **renamed** into `2026-08-04_handoff_v0_85_0.md`, the state of record. **v0.85.0 shipped the KOTC player link** (`kotc.html` + `kotc.js`, screen (b) of three) with `kotc_screen.test.mjs` asserting the page never re-derives the server's `enter`/`confirm`/`done` mode — the guard caught its own first draft, which forbade the very confirm POST the screen exists to send. **Recorded against the previous handoff: the KOTC API was "complete and tested" for ONE screen of three**; the admin board and public leaderboard need three routes that do not exist, and were deliberately not added because a route with no screen is failure class 1. **C14 opened** (the buster sweep missed the repo root one release after C13 named that exact file, and its own verification shared the blind corpus) and **C15 opened** (standards §9 still describes the retired CHANGELOG-stub workflow — the C1 fix swapped one stale sentence for another). Two existing ratchets earned their keep: the byte-identical member header floor moved **14 → 15** after catching a hand-written reduced header, and the build-status registry required the new page. No migration; ledger **0042** and 42 rows **read back from live D1**. Suite 1166 → **1180**. |
| 2026-08-04 | Twenty-seven releases under direct commit (v0.57.0–v0.84.0). Handoff v0.83.0 **renamed** into `2026-08-04_handoff_v0_84_0.md`, the state of record. **C13 opened and closed** (`404.html` at the repo root, stale for ten releases, invisible to a guard that scans `web/`). No migration; ledger stays **0042**. **All eight of the owner's numbered items are now delivered** — live-view animations (item 2) shipped after three sessions of deferral, built as a payload diff so a 25-second refresh does not animate every card on every poll. Three payload fields that had been built, tested and uncalled since v0.73.0/v0.77.0 (`degraded`, `degraded_note`, `current_round`) now reach the screen. README Architecture figures brought current; **its Modules table still stops at v0.64.0 and is queued as its own job.** **Doc debt still not acted on:** nine superseded handoffs from 2026-07-21…07-24 remain loose in `docs/` — they predate the archive tier and need an owner OK to move or delete. |
| 2026-07-26 | Eleven-document set collapsed to four tiers (context / roadmap / standards / library). Superseded list recorded in `archive/library` §3. |
| 2026-07-30 | `standards` recreated as v2.0 after the doc-set loss; §5/§6.5/§8/§10 anchors preserved. |
| 2026-08-02 | `roadmap` v1.0 created, reconciling five separate backlog sources against the live v0.52.0 tree. |
| 2026-08-02 | Three releases under direct commit (v0.54.0–v0.56.0). Handoff v0.53.0 superseded and **deleted**; `2026-08-02_handoff_v0_56_0.md` is the state of record. C1/C4/C5 closed, C6 opened. |
| 2026-08-02 | **This port.** Doc set moved to `docs/`, archive tier separated, `CLAUDE.md` and `INDEX.md` added. No source document was edited — contradictions are recorded here rather than silently patched. |
| 2026-08-03 | Eighteen releases under direct commit (v0.57.0–v0.74.0). Handoff v0.56.0 superseded and **deleted**; `2026-08-03_handoff_v0_66_0.md` is the state of record. **C6 stays OPEN** and gains a second finding: the sweep had never covered `.js` at all. **C7 opened** (shell-slice tag duplication, fixed and guarded). New documents: `spec_roster-sheet_v1_0`, `scope_format-engine_v1_1`, `workorder_member-experience_v1_1`. |

| 2026-08-03 | Twenty-six releases under direct commit (v0.57.0–v0.82.0). Handoff v0.81.0 superseded and **deleted**;  `2026-08-04_handoff_v0_83_0.md` is the state of record. **C11 opened and closed** (24 buttons carried a shared modifier with no base; two guards covered them and both were pointed elsewhere) and **C12 opened** (a handoff recorded a data diagnosis the database contradicted — the "partial seed" never existed). No migration; ledger stays 0042. **Doc debt noted, not acted on:** nine superseded handoffs from 2026-07-21…07-24 are still loose in `docs/` — they predate the archive tier and want moving to `docs/archive/`, which needs an owner OK to delete or move. |
| 2026-08-03 | Twenty-four releases under direct commit (v0.57.0–v0.80.0). Migration **0042** applied live (KOTC entry list, per-player links, confirmation), ledger row read back. **Failure class 1 closed on KOTC** — the v0.76.0 ratchet reddened the moment the module was mounted and was replaced by the real dispatch-table assertion, which is the mechanism working rather than a note in a handoff. |
| 2026-08-03 | Twenty-three releases under direct commit (v0.57.0–v0.79.0). Handoff v0.76.0 superseded and **deleted**; `2026-08-03_handoff_v0_81_0.md` is the state of record. Migration **0041** applied live (held bracket slots, bracket court ranges, optional game times), ledger row read back. Owner's eight numbered items: seven delivered, live-view animations deferred with the reason recorded. `/emil-design-eng` installed after five sessions of silently substituting for it. **C9's ruling encoded as cadence in `CLAUDE.md` §1.1** at the owner's instruction — periodic review and documentation audit, not a per-session sweep. |
| 2026-08-03 | Twenty releases under direct commit (v0.57.0–v0.76.0). Handoff v0.74.0 superseded and **deleted**; `2026-08-03_handoff_v0_76_0.md` is the state of record. KOTC spec v1.0 superseded and **deleted** by v1.1 (all five open questions answered). **C9 opened** — a CHANGELOG entry claimed a fix that was never applied. C6 stays open. Migration **0040** applied live (KOTC), ledger row read back. |

---

*Changelog: v2.3 (2026-08-04) — v0.85.0 recorded as **shipped and verified live** after the refused
push succeeded on retry; the §1 handoff row and the consolidation log both rewritten off the
blocked-release framing they were written under. Also a process note worth keeping: this file was
briefly corrupted by a PowerShell `Get-Content -Raw | Set-Content` round-trip, which in PS 5.1 reads
UTF-8 as ANSI and rewrites it double-encoded — 123 mangled sequences, +1024 bytes and a new BOM. Caught
by checking raw bytes, restored with `git checkout`, and re-applied with tools that respect encoding.
**Never round-trip a UTF-8 document through `Get-Content`/`Set-Content` in this repo.** v2.2
(2026-08-04) — handoff repointed to v0.85.0 (v0.84.0 renamed into it, so there is again
only one live handoff); **C14 opened** (the buster sweep missed the repo root one release after C13 named
that exact file, and the sweep's own verification reused the blind corpus and reported clean — a check
built out of the mistake it existed to catch); **C15 opened** (standards §9 still describes the retired
CHANGELOG-stub workflow, so the C1 fix swapped one stale sentence for another in the same section);
consolidation log extended through v0.85.0, recording that the release is **committed but unpushed**.
v2.1 (2026-08-04) — handoff repointed to v0.84.0 (v0.83.0 renamed into it, so there is again only
one live handoff); **C13 opened and closed** (a guard cannot see a file outside its corpus — `404.html` at the
repo root was stale for ten releases while the buster guard reported clean, the third instance of that shape in
three sessions); two stale rows in §1 corrected — standards has read **v2.2** since 2026-08-03 and this index
said v2.1, which is failure class 2 landing on the register that exists to catch it. v2.0 (2026-08-03) — handoff repointed to v0.82.0 (v0.81.0 deleted); **C11 opened and closed** (a shared button modifier with no base, and the two guards that were each aimed one inch off it); **C12 opened** (a handoff recorded a diagnosis the live database contradicted, and two sessions built on it). v1.9 (2026-08-03) — handoff repointed to v0.81.0 (v0.80.0 deleted); **C10 opened and closed** (the harness schema was half the database). v1.8 (2026-08-03) — handoff row repointed to v0.80.0 (v0.79.0 deleted); KOTC row marked reachable; consolidation log extended. v1.7 (2026-08-03) — handoff row repointed to v0.79.0 (v0.76.0 deleted); consolidation log extended through v0.79.0; C9's ruling noted as now encoded in `CLAUDE.md` §1.1 rather than living only here. v1.6 (2026-08-03) — handoff row repointed to v0.76.0 (v0.74.0 deleted); KOTC spec row repointed to v1.1 (v1.0 deleted, its five open questions now answered); **C9 opened** with the ratchet-not-a-paragraph corollary; consolidation log extended through v0.76.0. v1.5 (2026-08-03) — handoff row repointed to v0.74.0 (v0.70.0 deleted); KOTC spec registered. v1.4 (2026-08-03) — handoff row repointed to v0.70.0 (v0.68.0 deleted); consolidation log extended through v0.70.0. v1.3 (2026-08-03) — handoff row repointed to v0.68.0 (v0.66.0 deleted); C8 opened and
closed in the same release (the CDN QR that never rendered). v1.2 (2026-08-03) — handoff row repointed to v0.66.0 (v0.56.0 deleted); C6 closed with
the finding that the buster sweep had never covered `.js`; consolidation log extended through
v0.66.0. v1.1 (2026-08-02) — handoff row repointed to v0.56.0 (v0.53.0 deleted); standards→v2.1 and
uiux-review→v1.1 rows corrected; C1, C4 and C5 closed with their rulings recorded as audit trail; C6
opened (the buster guard checks one value, not the current value). v1.0 (2026-08-02) — created for
the Claude Code port; registered all ten documents and opened C1–C5.*
