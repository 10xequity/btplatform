# Boomtown Platform — Document Index

**File:** docs/INDEX.md · **Version:** v2.5 · **Created:** 2026-08-02 · **Updated:** 2026-08-04
**Status:** ACTIVE · **Supersedes:** nothing — first index of the doc set.
**Purpose:** what each document is, whether it is live, and where the live documents disagree
with each other. Read with `CLAUDE.md`.

**v2.4 was the consolidation `CLAUDE.md` §7 had been asking for.** The four-document working set measured
**93,066 bytes ≈ 23,300 tokens** on 2026-08-04, against `CLAUDE.md` §0's claimed "~7,400 tokens
combined — the intended per-session doc budget". That is **3.1× over**, and §7's trigger
(">~10,000 tokens → stop and consolidate") had been firing unattended for several sessions. This file
was the largest document in the repo at 37KB, and most of that was the **closed** half of the
contradiction register. The closed entries moved verbatim to
`docs/archive/contradictions-closed_v1_0.md`; §4 below keeps the genuinely open contradictions in
full, plus a one-line-per-rule standing-rules block so the habits stay in the working set. Twenty-one
obsolete documents left `docs/` root the same day (§3).

**Open contradictions are now C2, C3 and C6 — three.** C15 closed later the same day (standards v2.3
struck §9's stub paragraph), and rather than leave a resolved entry sitting in a register that had just
been trimmed for exactly that reason, it moved to the archive with the others. That is the intended
lifecycle: an entry lives here while it is open and leaves when it is not, with its rule staying in the
standing-rules table if the rule is a habit rather than a fix.

---

## 1. Live working set — read every session

| File | Ver | Date | What it is |
|---|---|---|---|
| `2026-08-04_handoff_v0_86_0.md` | **v1.8** | 2026-08-04 | **State of record.** §0: **v0.86.0 shipped and verified live** (`/api/health` v0.86.0, five artifact checks, CI added no commit, push succeeded first try) plus the health/pages URLs, because guessing them cost two minutes. §1 measured build state. §2 what shipped — **KOTC complete as a format**, the move route's **invariant with no visible symptom** and the negative control that makes its clean report mean something, and two traps: `rotation()` throwing into a `dispatch` *decline* (a silent 404), and **a guard tripped by its own comments — four instances in two sessions**. §3: the previous handoff was **wrong about the API this session was built on**, and **documenting a cleanup can undo the cleanup** (the split bought back 9% until a second pass). §4 owner answers, incl. the **separate-page** leaderboard decision. §5 owed — three screens need human eyes, and `CLAUDE.md` now exists in two places. §6 next build: **sweep script + C6 as one job**. §7 next-session prompt. **Deliberately about half v1.7's length** — it had become the largest document in the repo. Supersedes and **deletes** v1.7. |
| `2026-07-30_standards_v2_0.md` | **v2.3** | 2026-08-04 | **Build and design law.** Trust order, versioning, DB rules, worker module pattern, design roster (§5), testing gates (§6), CI, member copy (§8), page/asset structure (§11), templating (§10). Reconstructed after a doc-set loss; §5/§6.5/§8/§10 anchors preserved so in-code citations stay valid. **§9's stub paragraph struck in v2.3, closing C15.** |
| `2026-08-02_roadmap_v1_0.md` | **v1.1** | 2026-08-04 | **Roadmap of record.** 8 unbuilt modules, 5 small gaps, 4 engineering tracks, 5 owner-gated config items, 4 doc-debt items, suggested sequence. Supersedes the README roadmap block and the stale half of `build-status.js`. **§0's headline count is marked STALE — use handoff §6 for the build order, not §0.** |
| `INDEX.md` | **v2.5** | 2026-08-04 | This file. Doc status, and the **open** contradiction register (§4). Closed entries are in `archive/contradictions-closed_v1_0.md`. |

## 2. Live reference — open when the topic comes up

| File | Ver | Date | Open it when |
|---|---|---|---|
| `2026-08-01_decisions_org-roster_v1_1.md` | v1.1 | 2026-08-01 | Touching orgs, payments binding, or org deletes. Holds the keep-set (BTA/MPS/Queens/COBO), D-ORG-5..8, and the live-D1 scan that narrowed the delete set to orgs 6–9. |
| `2026-08-01_requirements_lfg-membership_v1_0.md` | v1.0 | 2026-08-01 | Touching LFG, membership custom fields, or the opportunities feed. **See contradiction C2 below — §4 is out of date.** |
| `2026-08-01_uiux-review_admin-shell_v1_0.md` | **v1.1** | 2026-08-02 | Touching any shell, rail, header, or contrast. Names the real AA offenders by file and line. Steps 1–3 of §6 shipped; **step 4 (SPA shell) is the last open item.** |
| `2026-08-03_workorder_member-experience_v1_1.md` | v1.1 | 2026-08-03 | Member-experience scope W1-W10, accepted onto the roadmap. Read §0 FIRST — it lists the seven assumptions that went stale since the Desktop original. Four owner decisions open. |
| `2026-08-03_scope_format-engine_v1_0.md` | **v1.1** | 2026-08-03 | Scoping M-TF, league flexibility or the drag-and-drop editor. Reframes the eight requested features as ONE constraint solver, splits hard from soft constraints, proposes 8 shippable slices, and records the real roster shape found in Drive. Four owner decisions listed at the end. |
| `2026-08-03_spec_kotc_v1_1.md` | **v1.1** | 2026-08-04 | **KOTC IS COMPLETE AS A FORMAT — this is now history, not a work list.** Engine (v0.76.0, migration 0040) · scoring solver (v0.79.0) · reachable (v0.80.0, migration 0042) · player link (v0.85.0) · **director's board and public standings (v0.86.0)**. All five of v1.0's open questions are answered verbatim in §6, including "director sets `move_up` each session" — no formula is encoded anywhere, **do not add one**. §9's remaining-work items 3 and 4 were **struck 2026-08-04**: item 3 told you to ask the owner a question migration 0042 had already answered (per-player links, confirm-or-edit) and had done so for three releases; item 4 assumed the leaderboard would go on the live board, and the owner chose a separate page. |
| `2026-08-03_spec_roster-sheet_v1_0.md` | v1.0 | 2026-08-03 | Importing the team roster spreadsheet. Blocked on a working link from the owner. |
| `2026-07-31_looker-template_v1_1.md` | v1.1 | 2026-07-31 | Building or changing the revenue CSV export. v1_0 **deleted 2026-08-04** with the owner's OK — the duplicate `CLAUDE.md` file hygiene forbids. |
| `2026-07-31_a2p-registration-checklist_v1_0.md` | v1.0 | 2026-07-31 | Only if A2P 10DLC unfreezes. **Twilio/A2P is frozen by the owner**; the SMS code exists and stays dormant. |
| `2026-07-23_usecase-analysis-nav_v1.0.md` | v1.0 | 2026-07-23 | A navigation/IA question against the original use-case analysis. |
| `2026-07-24_module-recommendations_v1_0.md` | v1.0 | 2026-07-24 | Tracing an R/D/X roadmap item back to its origin — cited by roadmap §0. |
| `2026-07-24_ux-polish-roadmap_v1_0.md` | v1.0 | 2026-07-24 | Tracing a UX-polish roadmap item back to its origin — cited by roadmap §0. |
| `2026-07-21_feature-addendum_v0.1.md` · `2026-07-21_setup-guide_v0.1.md` | v0.1 | 2026-07-21 | Rarely. Earliest-session material, kept because nothing supersedes them by name. Candidates for the next archive pass. |
| `2026-08-01_demo_admin-shell_v4_0.html` | v4.0 | 2026-08-01 | Working the SPA shell. Open it in a browser and toggle the theme — it is the target model, not a mockup to copy verbatim. |

## 3. Archive — never read during a normal build

`docs/archive/` holds **25 files** as of 2026-08-04. It exists to stop the failure it documents: eleven
documents accumulated by July 2026 and four sessions were spent specifying a module that was already
70% built. Do not read it by default; open one file for a named question and close it.

| File(s) | Count | Open it only to answer |
|---|---|---|
| `archive/2026-07-26_library_v1_0.md` | 1 | "What were the owner's exact words on X" (§1, all 24 requirements verbatim) · "Why was decision D-… made" (§4) · "Has this defect happened before" (§2, plus the four recurring failure classes) · "What are we benchmarking against" (§5). |
| `archive/contradictions-closed_v1_0.md` | 1 | **NEW 2026-08-04.** "Has this contradiction happened before, and what did we conclude?" The twelve **closed** register entries, moved verbatim out of §4: C1, C4, C5, C7, C8, C9, C10, C11, C12, C13, C14, C16. Their one-line rules stay live in §4. |
| `archive/2026-07-26_waiver-text-v2_candidate_v2_2_restored.md` | 1 | Seed data only. **Not published; the database does not contain it.** Waiver system CLOSED (owner 2026-07-26). Transcript reconstruction — §6/§7 carry real legal exposure. Not a specification. |
| `archive/2026-08-01_CHANGELOG-block_v0_45_0.md` | 1 | Superseded by the repo `CHANGELOG.md`. Delete once the v0.45.0 LFG detail is confirmed against it. |
| Superseded handoffs, `2026-07-21_design-handoff_v0.1` → `2026-07-24_handoff_v1_6` | 9 | "What did we believe at v0.2–v1.6". **Moved 2026-08-04, owner OK.** `CHANGELOG.md:2883` still cites the design-handoff at its old `docs/` path — append-only history, deliberately not rewritten. |
| One-time module-install guides, `module4` → `module13-12-5` | 12 | Almost never. Install steps for modules shipped v0.3.0–v0.14.0; all are live and suite-covered, and the guides describe a drag-and-drop delivery process that no longer exists. **Moved 2026-08-04, owner OK.** |

---

## 4. Contradiction register — live documents that disagree

These are instances of **failure class 2**: a decision recorded is not a decision in force until
every restatement changes. Fix them in the next release; until then, the ruling below governs.

**Closed entries live in `docs/archive/contradictions-closed_v1_0.md`** (C1, C4, C5, C7, C8, C9, C10,
C11, C12, C13, C14, C15, C16), moved there verbatim on 2026-08-04. Their rulings are summarised as
standing rules at the end of this section — that block, not the archive file, is what you read every
session.

**Open: C2, C3, C6.** All three are cheap. C6 is the only one with code behind it.

### Open

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

*Third finding, 2026-08-04 (v0.85.0):* C13 and C14 both widened *what* the corpus contains — the
repo root is now in it, and 377 busters read one value. Neither touched *what is asserted*, so C6 is
untouched by both. **It is now cheap to close:** with `worker/scripts/sweep-buster.mjs` in place
(handoff §6.3), assert the buster equals `index.js`'s version rather than merely equalling itself.

**C15 — CLOSED 2026-08-04 (standards → v2.3).** §9's stub paragraph is struck; full entry in
`archive/contradictions-closed_v1_0.md`. Its rule is in the table below.

### Standing rules from the closed entries — these are habits, and no guard can hold them

The instance behind each of these is fixed. The rule is not, because it describes how to look rather
than what to change. Full narrative for any of them is in
`docs/archive/contradictions-closed_v1_0.md`.

| From | The rule |
|---|---|
| **C9** | **A document saying a thing was fixed is not evidence the thing was fixed. Only the file is.** When a handoff, CHANGELOG or spec claims something is done, `grep` it before building on it. *Corollary: an unreachable module needs a ratchet, not a paragraph.* |
| **C10 / C11** | **A page can fail by using NOTHING**, and a drift guard is structurally blind to that. **An absence never goes red.** Ask whether a guard exists over the thing every other guard stands on. |
| **C11** | **A guard that reports clean may simply be pointed one inch to the left of the defect.** Two guards covered 24 broken buttons and both passed honestly. |
| **C12** | **When a document describes DATA, verify it against the data**, not against the document's own reasoning. Four live-D1 queries overturned a diagnosis two sessions had built on. Repo > live D1 > docs. |
| **C13** | **A file's location is part of whether a guard can see it.** "The widest set" means the widest set that *ships*, not the widest directory somebody remembered to name. When widening a guard, ask what ships that the corpus still excludes. |
| **C14** | **A verification that reuses the corpus of the thing it verifies is not an independent check.** It restates one assumption twice and reports the agreement as confirmation. A guard and its own check must not derive their file list the same way — and **a written-down count from the previous release is a cheap independent oracle. Write the count down; check it with a different tool.** |
| **C16** | **A test whose correctness depends on when it runs is a defect even while it passes** — and the way to find those is to **move the clock, not to grep for dates**: `node worker/scripts/timecheck.mjs`. Deliberately not a preflight gate. **Do not build a static date-linting guard** — it would encode a heuristic where a measurement exists. |
| **C7** | Generate a new page only from one that passes `page_structure.test.mjs`. Shell-slicing copies *and increments* stray closing tags, and browsers discard them in silence. |
| **C1 / C15** | Fixing failure class 2 means sweeping **every** restatement — **and a *replacement* sentence is itself a restatement.** The C1 fix swapped one stale sentence for another in the same section and the register did not reopen for two releases, which is how C15 existed at all. Rewriting a stale paragraph without checking the new text against the current process turns one stale sentence into two. |
| **v0.85.0 / v0.86.0** | **A guard's own comments will trip it.** Three times in two sessions a comment explaining a rule set off the check for that rule. **Check the set that ships BEHAVIOUR** — strip comments first, and give the stripping its own negative control so it cannot become a quiet way of switching the check off. |

Also standing, from the wider record: **check the raw bytes before reporting a byte-level defect** ·
**a test can encode the bug** (`sandbox_seed.test.mjs` asserted a 409 dead-end as correct) · **do not
audit everything every session** — `grep` the single claim you are about to depend on.

---

## 5. Consolidation log

| Date | Action |
|---|---|
| 2026-08-04 | **v0.86.0 SHIPPED AND VERIFIED LIVE — KOTC IS COMPLETE AS A FORMAT.** `/api/health` **v0.86.0**, all four new artifacts serving at buster 0.86.0, `404.html` at the repo root correct, and `git log main..origin/main` **empty** after the deploy, so CI added no commit — one push, the fourth consecutive confirmation. The push succeeded on the **first** attempt this time. Shipped: the **director's board** (`admin-kotc.html` + `admin-kotc.js`) and the **public standings** (`kotc-live.html` + `kotc-live.js`), with the **three routes** neither could exist without — `GET /api/admin/kotc`, `POST /api/admin/kotc/:id/move`, `GET /api/live/kotc/:id`. **Recorded against the previous handoff, which said this API was "complete and tested": it was complete for one screen of three**, and one `grep` settled it. The move route's invariant — a re-seat must never re-pair a game that already has a score, because `kotc_games` stores the four players on the row and the derived leaderboard would silently restate the evening — ships with a negative control that **mutates the real input** (same move, same row, scores cleared) and proves the move *does* re-pair it, so the clean report is not the boring kind. "Never refuses" is tested by **exhausting the board**, not sampling it. Two traps recorded: `rotation()` throws for any net size but 4 or 5 and `dispatch` treats a throw as a *decline*, so an unguarded call would have made a drag a **silent 404**; and **a guard's own comments tripped it twice** — the third and fourth instances in two sessions of a comment about a rule setting off the check for that rule. **Owner decision (asked, not assumed):** the public leaderboard is a **separate page**, not a third shape on the live board, because `live.js` carries the v0.84.0 diff-animation engine no human has reviewed. `live.js` untouched. Member header floor **15 → 16**, both pages generated from pages already inside the ratchets. Suite **1180 → 1223**; test files 70 → 72. No migration; ledger **0042**. Buster **0.85.0 → 0.86.0**, verified at **390 occurrences, one value, 62 files** with ripgrep against a count written down first (C14). Also closed the same day: **C15** (standards → **v2.3**, §9's stub paragraph struck) and the KOTC spec's §9 items 3–4, one of which had been telling sessions to ask the owner a question migration 0042 answered three releases earlier. |
| 2026-08-04 | **THE CONSOLIDATION `CLAUDE.md` §7 HAD BEEN ASKING FOR, DONE.** The four-document working set measured **93,066 bytes ≈ 23,300 tokens** — 3.1× `CLAUDE.md` §0's claimed ~7,400, with §7's ">~10,000 → consolidate" trigger having fired unattended for several sessions. Two actions. **(1) INDEX split:** twelve **closed** contradiction entries moved verbatim to `docs/archive/contradictions-closed_v1_0.md` (C1, C4, C5, C7, C8, C9, C10, C11, C12, C13, C14, C16); C2, C3, C6 and C15 stay live in full; a new **standing-rules table** keeps the one-line habit rule from every closed entry in the working set, which is the part that was actually being re-read. *Deviation recorded:* the session prompt's move-list named ten entries and omitted **C9 and C12** — both carry the same "instance closed, rule is a habit" status as C14 and C16, both are among the longest entries, and leaving them would have defeated the split, so they moved on the same basis with their rules kept live. **(2) Doc hygiene, all three with the owner's explicit OK:** `2026-07-30_looker-template_v1_0.md` **deleted** (v1_1 sat beside it — the duplicate `CLAUDE.md` file hygiene forbids in as many words); **9 superseded handoffs** (2026-07-21…07-24) and **12 one-time module-install guides** `git mv`'d to `docs/archive/`. `docs/` root **40 → 18** `.md` files; `docs/archive/` **3 → 25**. Dangling references swept with grep, not assumed: `worker/src/reports.js` cited the deleted looker v1_0 in its v1.4 header entry and now cites v1_1 while preserving what was true when it shipped; `looker-template_v1_1`'s supersedes line records the deletion. `CHANGELOG.md`'s one citation of a moved handoff is **deliberately left** — it is append-only history, and rewriting it to match the present is the C9 error inverted. |
| 2026-08-04 | Twenty-eight releases under direct commit (v0.57.0–v0.85.0), **v0.85.0 shipped and verified live** — `/api/health` v0.85.0, `404.html` at the repo root serving 0.85.0, and `origin/main` still at the pushed SHA, so CI added no commit. The `git push` refusal that had ended the session **cleared on retry with nothing changed**; `gh` stayed blocked, so CI logs are unreadable from inside a session and a deploy is confirmed by preflight plus a live fetch. Handoff v0.84.0 **renamed** into `2026-08-04_handoff_v0_85_0.md`, the state of record. **v0.85.0 shipped the KOTC player link** (`kotc.html` + `kotc.js`, screen (b) of three) with `kotc_screen.test.mjs` asserting the page never re-derives the server's `enter`/`confirm`/`done` mode — the guard caught its own first draft, which forbade the very confirm POST the screen exists to send. **Recorded against the previous handoff: the KOTC API was "complete and tested" for ONE screen of three**; the admin board and public leaderboard need three routes that do not exist, and were deliberately not added because a route with no screen is failure class 1. **C14 opened** (the buster sweep missed the repo root one release after C13 named that exact file, and its own verification shared the blind corpus) and **C15 opened** (standards §9 still describes the retired CHANGELOG-stub workflow — the C1 fix swapped one stale sentence for another). Two existing ratchets earned their keep: the byte-identical member header floor moved **14 → 15** after catching a hand-written reduced header, and the build-status registry required the new page. No migration; ledger **0042** and 42 rows **read back from live D1**. Suite 1166 → **1180**. |
**Earlier entries, one line each.** Compressed 2026-08-04 in the same pass as the split — each one's full
narrative is in the handoff it describes and in git, so a second prose copy here was costing the working
set every session to say what the handoff already said.

| Date | Action |
|---|---|
| 2026-08-04 | v0.84.0. **C13 opened and closed** (`404.html` at the repo root, stale ten releases, invisible to a `web/`-scoped guard). All eight owner items delivered — live-view animations shipped as a payload diff; `degraded`/`degraded_note`/`current_round` reached the screen after being built-and-uncalled since v0.73.0/v0.77.0. README Modules table still stops at v0.64.0. |
| 2026-08-03 | v0.82.0. **C11 opened and closed** (24 buttons, shared modifier with no base, two guards both pointed elsewhere); **C12 opened** (a handoff's data diagnosis the database contradicted — the "partial seed" never existed). |
| 2026-08-03 | v0.80.0. Migration **0042** applied live (KOTC entry list, per-player links, confirmation). **Failure class 1 closed on KOTC** — the v0.76.0 ratchet reddened on mount and was replaced by the real dispatch-table assertion. |
| 2026-08-03 | v0.79.0. Migration **0041** applied live (held bracket slots, court ranges, optional game times). Seven of eight owner items delivered. `/emil-design-eng` installed after five sessions of silently substituting for it. **C9's ruling encoded as cadence in `CLAUDE.md` §1.1.** |
| 2026-08-03 | v0.76.0. KOTC spec v1.0 → v1.1 (five open questions answered, v1.0 deleted). **C9 opened** — a CHANGELOG entry claimed a fix never applied. Migration **0040** applied live (KOTC engine). |
| 2026-08-03 | v0.74.0. **C6 gains its second finding** — the sweep had never covered `.js` at all. **C7 opened** (shell-slice tag duplication, fixed and guarded). New: `spec_roster-sheet`, `scope_format-engine`, `workorder_member-experience`. |
| 2026-08-02 | v0.56.0. **C1/C4/C5 closed, C6 opened.** `roadmap` v1.0 created, reconciling five backlog sources against the live v0.52.0 tree. |
| 2026-08-02 | **The Claude Code port.** Doc set moved to `docs/`, archive tier separated, `CLAUDE.md` and `INDEX.md` added. No source document edited — contradictions recorded here rather than silently patched. |
| 2026-07-30 | `standards` recreated as v2.0 after the doc-set loss; §5/§6.5/§8/§10 anchors preserved so in-code citations stay valid. |
| 2026-07-26 | Eleven-document set collapsed to four tiers (context / roadmap / standards / library). Superseded list in `archive/library` §3. |

---

*Changelog: v2.5 (2026-08-04) — **v0.86.0 recorded as shipped and verified live**, and **C15 closed and
moved to the archive** (standards → v2.3 struck §9's stub paragraph), leaving C2, C3 and C6 open. The
standing-rules table gains the C1/C15 corollary — *a replacement sentence is itself a restatement*, which
is the whole reason C15 existed — and the comment-tripping rule from v0.85.0/v0.86.0: **check the set that
ships BEHAVIOUR**, and give the comment-stripping its own negative control. The §2 KOTC spec row rewritten:
the format is complete, and that document's §9 items 3–4 were struck because one of them had been sending
sessions to ask the owner a question migration 0042 answered three releases earlier. v2.4 (2026-08-04) — **the split.** Twelve closed contradiction entries moved verbatim to
`archive/contradictions-closed_v1_0.md`; C2, C3, C6, C15 kept live in full; a standing-rules table added
so the habit rules from the closed entries stay in the working set, which is the only part of them that
was being re-read. C6 gains a third finding noting that C13 and C14 widened the corpus and left its
assertion untouched, so it is now cheap to close. §2 grew from 7 rows to 14 — the previous index simply
did not register nine live documents that were sitting in `docs/` root, which is its own small failure
class 2. §3 rewritten to cover all 25 archive files including the 21 moved this session with the owner's
OK, and `looker-template_v1_0` recorded as deleted. §5 log records the consolidation, the two dangling
references fixed in `reports.js` and `looker-template_v1_1`, and the one in `CHANGELOG.md` deliberately
left alone. v2.3 (2026-08-04) — v0.85.0 recorded as **shipped and verified live** after the refused
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
consolidation log extended through v0.85.0. v2.1 (2026-08-04) — handoff repointed to v0.84.0 (v0.83.0
renamed into it); **C13 opened and closed** (a guard cannot see a file outside its corpus — `404.html` at the
repo root was stale for ten releases while the buster guard reported clean, the third instance of that shape in
three sessions); two stale rows in §1 corrected — standards has read **v2.2** since 2026-08-03 and this index
said v2.1, which is failure class 2 landing on the register that exists to catch it. v2.0 (2026-08-03) — handoff repointed to v0.82.0 (v0.81.0 deleted); **C11 opened and closed** (a shared button modifier with no base, and the two guards that were each aimed one inch off it); **C12 opened** (a handoff recorded a diagnosis the live database contradicted, and two sessions built on it). v1.9 (2026-08-03) — handoff repointed to v0.81.0 (v0.80.0 deleted); **C10 opened and closed** (the harness schema was half the database). v1.8 (2026-08-03) — handoff row repointed to v0.80.0 (v0.79.0 deleted); KOTC row marked reachable; consolidation log extended. v1.7 (2026-08-03) — handoff row repointed to v0.79.0 (v0.76.0 deleted); consolidation log extended through v0.79.0; C9's ruling noted as now encoded in `CLAUDE.md` §1.1 rather than living only here. v1.6 (2026-08-03) — handoff row repointed to v0.76.0 (v0.74.0 deleted); KOTC spec row repointed to v1.1 (v1.0 deleted, its five open questions now answered); **C9 opened** with the ratchet-not-a-paragraph corollary; consolidation log extended through v0.76.0. v1.5 (2026-08-03) — handoff row repointed to v0.74.0 (v0.70.0 deleted); KOTC spec registered. v1.4 (2026-08-03) — handoff row repointed to v0.70.0 (v0.68.0 deleted); consolidation log extended through v0.70.0. v1.3 (2026-08-03) — handoff row repointed to v0.68.0 (v0.66.0 deleted); C8 opened and
closed in the same release (the CDN QR that never rendered). v1.2 (2026-08-03) — handoff row repointed to v0.66.0 (v0.56.0 deleted); C6 closed with
the finding that the buster sweep had never covered `.js`; consolidation log extended through
v0.66.0. v1.1 (2026-08-02) — handoff row repointed to v0.56.0 (v0.53.0 deleted); standards→v2.1 and
uiux-review→v1.1 rows corrected; C1, C4 and C5 closed with their rulings recorded as audit trail; C6
opened (the buster guard checks one value, not the current value). v1.0 (2026-08-02) — created for
the Claude Code port; registered all ten documents and opened C1–C5.*
