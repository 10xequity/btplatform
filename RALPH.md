# RALPH LOOP — Boomtown Platform (btplatform)

**File:** `RALPH.md` · **Version:** v2.0 · **Created:** 2026-08-04
**Status:** ACTIVE — the loop's instruction set. Re-read from disk every iteration.
**Supersedes:** the pasted v1 prompt. Changes: the halt mechanism now actually halts (§HALT), the
drift gate's oracle is the handoff rather than frozen numbers, and four verified corrections.

You are one iteration of an autonomous loop. Your context is EMPTY and will be
DISCARDED when you exit. Everything you learn must be written to disk or it is lost.

Repo: `D:\github\repos\btplatform`

Do ONE unit of work, verify it, record it, halt. Do not try to empty the queue in one
iteration. A short correct iteration beats a long ambitious one.

═══════════════════════════════════════════════════════════════════════════════
HALT — HOW TO ACTUALLY STOP.  Read this first; it is not optional plumbing.
═══════════════════════════════════════════════════════════════════════════════

The loop is driven by a Stop hook. It ends on exactly two things: the iteration cap, or
your **final text block** containing this, byte-exact:

        <promise>RALPH HALT</promise>

Nothing else stops it. A line reading `RALPH: STOP — DRIFT` is **plain text the hook
ignores** — emit only that and the loop re-feeds this prompt and keeps going.

So, on **every** halt — success, drift, blocked, scope, red suite, queue empty:

  1. Write the reason into `LOOP.md`'s `outcome:` field. That is where it survives.
  2. Print the human sentinel (`RALPH: STOP — DRIFT`) so the transcript reads clearly.
  3. Print `<promise>RALPH HALT</promise>` as the LAST LINE.

Emit the promise **only** when you are genuinely halting. If you shipped and the queue
has more, end with `RALPH: CONTINUE` and **no promise tag** — the hook re-feeds and the
next iteration begins.

**Do not emit the promise to escape a hard problem.** A false halt on a half-built route
ships an untested write path. Write the blocker to `LOOP.md` and keep working; the
iteration cap will stop you safely.

═══════════════════════════════════════════════════════════════════════════════
PHASE 0 — ORIENT (always)
═══════════════════════════════════════════════════════════════════════════════

1. Read `LOOP.md` at the repo root (create it if absent — shape in PHASE 4). Read the
   LAST THREE entries. That is what previous iterations knew.
2. Read the single `docs/*_handoff_v*.md`. There is only ever ONE. Two = STOP (drift).
3. Run and read:
       node worker/scripts/preflight.mjs
       node worker/scripts/sweep-buster.mjs
   Bare `sweep-buster.mjs` is a REPORT — it writes nothing without `--write`. Verified.
4. Do NOT read standards / roadmap / INDEX yet. Open them only if your PHASE 2 unit
   needs them, and name which you opened in the ledger.

**Two preflight WARNs are EXPECTED in this environment and are not failures:**
  - `git` — sync state vs origin not checked (offline / `--no-net`)
  - `schema` — live D1 not read, no `CLOUDFLARE_API_TOKEN` with D1:Read
Preflight still prints `CLEAR` with both. Do not spend an iteration "fixing" them. Any
OTHER non-PASS line is a real failure.

═══════════════════════════════════════════════════════════════════════════════
PHASE 1 — THE DRIFT GATE.  The kill switch. Run it before anything else.
═══════════════════════════════════════════════════════════════════════════════

**The handoff §1 table is the ONLY oracle.** Compare your MEASURED numbers against
what §1 currently records — never against a number written in this file. This file is
re-fed verbatim every iteration and its numbers freeze; the handoff's do not.

Iteration-1 SEED ONLY, for orientation, measured 2026-08-04. **After iteration 1, ignore
these and read §1:**

    version v0.86.0 · suite 1238/1238 · 73 test files · 50 modules
    ledger 0042 · 42 files in db/migrations/ · buster 390 across 62 files, one value

**HALT — `RALPH: STOP — DRIFT`** if ANY of these:

  D1. A measured number differs from **the handoff §1 table's** current number AND the
      last `LOOP.md` entry does not explain it. Something outside the loop changed the
      repo. **DO NOT reconcile it. DO NOT edit the handoff to match.** Report both and
      halt. (The recorded number is the loop's only independent oracle — this is C14.)
  D2. Preflight does not print `CLEAR` (the two WARNs above notwithstanding).
  D3. Dirty tree or unpushed commits at iteration START. A previous iteration died
      mid-flight; a human must look.
  D4. More than one `docs/*_handoff_v*.md`.
  D5. `git log main..origin/main` non-empty — someone else pushed.

**Suite red is special.** If red and you did not cause it:
       node worker/scripts/timecheck.mjs
  If it explains it (a hardcoded date), fixing THAT ONE FIXTURE is your whole unit
  for this iteration. If not: `RALPH: STOP — RED SUITE, CAUSE UNKNOWN`.
  **Do not build a static date-linting guard.** Decided; re-deciding it is a defect.

═══════════════════════════════════════════════════════════════════════════════
PHASE 2 — PICK EXACTLY ONE UNIT, from handoff §6, top-down
═══════════════════════════════════════════════════════════════════════════════

The queue is ordered mechanical-first ON PURPOSE. Items 1–3 need no migration and no
owner input. Take the first one `LOOP.md` does not already record as done.

  §6.1  README Modules table + roadmap recount, FROM THE GIT LOG, not the documents.
  §6.2  Withdraw a player for the night. `kotc_players.withdrawn_at` exists
        (migration 0042), is honoured in seven read sites in `worker/src/kotcplay.js`,
        and is never written. One route + a board control. No migration needed.
  §6.3  Redistribute when a net empties. `nextRound` (`kotc.js:301`) moves by
        `net_no ± 1` and refuses on non-contiguous nets. Rank and redistribute over the
        nets that EXIST; retire a dropped net's number rather than renumbering. Keep the
        existing refuse-rather-than-lose-a-player guard.

**GREP TRAP on §6.2 — read this before you verify the claim.** Grepping `withdrawn_at`
repo-wide returns `worker/src/lfg.js:396`:
`UPDATE lfg_members SET … withdrawn_at=datetime('now')`. That is the **`lfg_members`**
table, a different feature. `kotc_players.withdrawn_at` has **no** write anywhere.
Scope the grep to `worker/src/kotcplay.js` before concluding anything.

Skip an item and say why in the ledger if `LOOP.md` says it is done — and FIX §6 in the
same iteration so the next one does not re-read a stale queue.

**HALT — `RALPH: STOP — QUEUE EMPTY`** when §6.1–§6.3 are done. **That is success**, and
it is the expected end of this run — three units, not ten. Repopulating §6 with the
owner-gated items is a human step between runs.

**Do not start §6.4 (bracket disputes) autonomously** — it carries a design question
about what two disagreeing teams each see. Halt and let a human take it.

**HALT — `RALPH: STOP — NEEDS OWNER`** for anything requiring:
  - a **D1 migration** — this includes §6.6 (per-session points cap) and §6.7 (net
    labels). BOTH ARE ALREADY DECIDED by the owner, but a migration is applied to
    live D1 by a human via Cloudflare MCP before the push, and the CI schema-gate
    fails closed on an unapplied migration. **Do not write a migration file either** —
    an unapplied migration in the tree breaks CI.
  - a decision handoff §4 does not already settle
  - deleting files, force-push, making anything public, spending money
  - a `.github/workflows/**` change

**HALT — `RALPH: STOP — SCOPE`** if the unit turns out to need a new worker module, or
touches more than ~8 files beyond your estimate. Write what you learned to `LOOP.md`
first so the next iteration starts smarter.

**BEFORE building on ANY claim in the handoff, grep it.** The handoff has been wrong
about the thing a session was built on ("the API is complete and tested" — it was
complete for one screen of three). One check, not a sweep. If the claim is about DATA,
query live D1 instead of grepping.

═══════════════════════════════════════════════════════════════════════════════
PHASE 3 — BUILD IT
═══════════════════════════════════════════════════════════════════════════════

KOTC/QOTC WORK: read `docs/2026-08-04_reference_kotc-live-run_v1_0.md` FIRST. It is
the owner's real tournament data and outranks every spec sentence about how the format
runs. Load-bearing facts from it:
  - Movement is **rank → divisions → discretion within a division**, NOT per-net
    promotion. `nextRound` is a PROPOSAL; the drag board is the mechanism.
    **No formula is encoded. Do not add one.**
  - Nets are named and NON-CONTIGUOUS. A dropped net's number is retired.
  - Scores are recorded as DIFFERENTIALS by the director.
  - QOTC is the same engine with a different session name. **No gendered field, no
    second code path.**

HOUSE RULES:
- Routes and screens ship TOGETHER. A route with no screen is failure class 1.
- Every guard ships a NEGATIVE CONTROL THAT MUTATES THE REAL INPUT. A guard that
  cannot fail is not a guard.
- Assert CALL SITES (dispatch-table entries), never definitions.
- Check the set that ships BEHAVIOUR — strip comments before content checks, and give
  the stripping its own negative control. A guard's own comments have tripped one four
  times now.
- Generate a new page only from one that passes `page_structure.test.mjs`. A new
  member page moves the header floor (header_shell + header_actions) — bump it and
  record the reason AT the assertion. Register every new page in `build-status.js`.
- A new admin page needs an entry in `rail.partial.html` AND in `admin-nav.js`'s NAV
  list, then `node worker/scripts/sync-rail.mjs --write`. sync-rail does NOT check NAV
  parity and says so on the way out. That cost one red suite already.
- Load the design roster before any UI: `/emil-design-eng`, then `frontend-design`.
  `ux-copy` is NOT installed — standards §8 is the rule set.
- Errors are human sentences, not codes. Names render "First L." on any no-login
  surface. No org email in member-facing copy.

RELEASE, only if the unit changed `worker/**` or `web/**`:
    1. bump `version:` in worker/src/index.js — byte-verify a ONE-LINE diff
    2. node worker/scripts/sweep-buster.mjs --write     ← only if web/** changed
    3. node worker/scripts/sync-rail.mjs --write        ← only if a page was added
    4. node worker/scripts/preflight.mjs                ← must print CLEAR
    5. node worker/scripts/changelog-entry.mjs --version vX.Y.Z --date YYYY-MM-DD --body-file entry.md
       node worker/scripts/changelog-entry.mjs --check --version vX.Y.Z   (--version REQUIRED)
       Then DELETE `entry.md`. It is gitignored, but a stray copy invites confusion.
    6. commit (git commit -F <file>; PowerShell has no heredoc), then push
    7. confirm the deploy — preflight `deployed` PASS, then fetch the live artifact:
         health https://boomtown-api.vvisuth.workers.dev/api/health
         pages  https://10xequity.github.io/btplatform/
       `gh run list` / `run view` / `run watch` are now permitted — ONE attempt is fine.
       If `gh` is refused, do not fight it: the health fetch above is the real check.
       `git log main..origin/main` must be EMPTY after. A release is ONE push.

  Docs-only or tooling-only: NO bump, NO sweep. Still commit and push.
  If `git push` is refused by the permission classifier, RETRY ONCE — intermittent.
  Twice = `RALPH: STOP — TOOL BLOCKED`.

NEVER: numbered SQL outside `db/migrations/` · a route accepting `org_id` from the
client · a screening/clearance field · re-asking anything settled in handoff §4 ·
rewriting CHANGELOG history to match the present · a static date-linting guard.

═══════════════════════════════════════════════════════════════════════════════
PHASE 4 — RECORD, THEN HALT.  Even if you stopped early. Especially then.
═══════════════════════════════════════════════════════════════════════════════

1. If you shipped: update the handoff **IN PLACE** — §1 measured numbers, §2 what
   shipped, §6 with the finished item struck. Keep it SHORT.
   **Never create a second handoff file.** `CLAUDE.md` §7's "write a new dated handoff
   and delete the old" is a human end-of-session ritual; inside the loop it would trip
   D4 on the very next iteration. One file, edited.
2. APPEND to `LOOP.md`:

       ## <ISO timestamp> — iteration <n>
       outcome   : SHIPPED vX.Y.Z | NO-BUMP | STOPPED-<reason>
       unit      : <the one thing, in a sentence>
       commit    : <sha or "none">
       measured  : suite <n>/<n> · files <n> · modules <n> · busters <n>/<n files> · ledger <nnnn>
       docs read : <which, beyond the handoff>
       learned   : <one line the next iteration would want. "nothing" is valid.>
       next      : <the §6 item the next iteration should pick>

3. Commit and push `LOOP.md` with the work (or alone, if you stopped early).
4. End your reply with the sentinel, and — **only if halting** — the promise tag:

       RALPH: CONTINUE                  — shipped, queue has more, state clean.
                                          NO promise tag. The loop continues.

       RALPH: STOP — <reason>           — any halt condition above, then on the
       <promise>RALPH HALT</promise>      LAST LINE, the promise tag.

═══════════════════════════════════════════════════════════════════════════════
PER-ITERATION CONTEXT BUDGET
═══════════════════════════════════════════════════════════════════════════════

Fresh context, but not infinite. If ANY fires, FINISH the current unit, do PHASE 4,
halt — do not start a second unit:
  - a release cut and verified · the suite run twice · ~12+ files read · context-low warning

Halting early with clean state is the loop working. Cramming in a second unit is how
an iteration dies mid-flight and trips D3 for the next one.
