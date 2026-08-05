# RALPH LOOP — Boomtown Platform (btplatform)

**File:** `RALPH.md` · **Version:** v3.0 · **Created:** 2026-08-04 · **Updated:** 2026-08-05
**Status:** ACTIVE — the loop's instruction set. Re-read from disk every iteration.
**Supersedes:** v2.0 (2026-08-04). Changes: the v2 queue (§6.1–§6.3) is DONE and replaced by the
tester-fix blocks (roadmap §-1) plus the owner's 2026-08-05 registration-first workflow program
(roadmap §-1b). Adds the owner's build-bias rule, the owner-report→root-cause map, and the /loop
driver note. The HALT/drift/release machinery is unchanged — it worked.

You are one iteration of an autonomous loop. Assume your context is EMPTY and will be
DISCARDED when you exit. Everything you learn must be written to disk or it is lost.

Repo: `D:\github\repos\btplatform`

Do ONE unit of work, verify it, record it, halt. Do not try to empty the queue in one
iteration. A short correct iteration beats a long ambitious one.

═══════════════════════════════════════════════════════════════════════════════
LOOP DRIVER — two ways this loop runs
═══════════════════════════════════════════════════════════════════════════════

- **Hook-driven (Stop hook):** ends on the iteration cap or a final text block containing,
  byte-exact: `<promise>RALPH HALT</promise>`. `RALPH: STOP — <reason>` alone is plain text
  the hook ignores. Emit the promise ONLY when genuinely halting; never to escape a hard problem.
- **/loop-driven (ScheduleWakeup, dynamic):** the iteration re-arms itself by scheduling a wakeup
  with the same /loop prompt; halting = ScheduleWakeup `stop: true`. The sentinels below are still
  written to the transcript and `LOOP.md` so both drivers leave the same record.

On **every** halt — success, drift, blocked, scope, red suite, queue empty:
  1. Write the reason into `LOOP.md`'s `outcome:` field. That is where it survives.
  2. Print the human sentinel (`RALPH: STOP — <reason>`, or `RALPH: CONTINUE` if the queue
     has more and state is clean).
  3. Hook-driven: promise tag as the last line. /loop-driven: stop or re-arm the wakeup.

═══════════════════════════════════════════════════════════════════════════════
PHASE 0 — ORIENT (always)
═══════════════════════════════════════════════════════════════════════════════

1. Read `LOOP.md` at the repo root. Read the LAST THREE entries. That is what previous
   iterations knew.
2. Read the single `docs/*_handoff_v*.md`. There is only ever ONE. Two = STOP (drift).
3. Run and read:
       node worker/scripts/preflight.mjs
       node worker/scripts/sweep-buster.mjs
   Bare `sweep-buster.mjs` is a REPORT — it writes nothing without `--write`.
4. Do NOT read standards / roadmap / INDEX in full. Open the section your PHASE 2 unit
   needs, and name which you opened in the ledger.

**Two preflight WARNs are EXPECTED when offline and are not failures:**
  - `git` — sync state vs origin not checked · `schema` — live D1 not read locally.
  If the Cloudflare MCP and git remote ARE reachable this session, verify both instead:
  `git fetch && git log main..origin/main` empty, and `schema_migrations` max == repo highest.

═══════════════════════════════════════════════════════════════════════════════
PHASE 1 — THE DRIFT GATE. The kill switch. Run it before anything else.
═══════════════════════════════════════════════════════════════════════════════

**The handoff §1 table is the ONLY oracle.** Compare MEASURED numbers against what §1
currently records — never against a number frozen in this file.

**HALT — `RALPH: STOP — DRIFT`** if ANY of these:
  D1. A measured number differs from the handoff §1 table AND the last `LOOP.md` entry does
      not explain it. DO NOT reconcile; report both and halt. (C14 — the recorded number is
      the loop's only independent oracle.)
  D2. Preflight does not print `CLEAR` (the two offline WARNs notwithstanding).
  D3. Dirty tree or unpushed commits at iteration START.
  D4. More than one `docs/*_handoff_v*.md`.
  D5. `git log main..origin/main` non-empty — someone else pushed.

**Suite red is special.** If red and you did not cause it: `node worker/scripts/timecheck.mjs`.
If a hardcoded date explains it, fixing THAT ONE FIXTURE is the whole unit. If not:
`RALPH: STOP — RED SUITE, CAUSE UNKNOWN`. Do not build a static date-linting guard — decided.

═══════════════════════════════════════════════════════════════════════════════
PHASE 2 — PICK EXACTLY ONE UNIT, top-down from this queue
═══════════════════════════════════════════════════════════════════════════════

The queue is roadmap §-1 (Blocks B→C→A3→D→E) then §-1b (the registration-first workflow
program, W-A…W-G). Take the first item `LOOP.md` does not record as done. Skip-and-say-why
if the ledger says it is done, and fix the stale queue line in the same iteration.

**THE OWNER-REPORT MAP — read before "fixing" a reported symptom.** The owner's 2026-08-05
report ("most screens fail / couldn't load your events / members broken / regenerate dies
after the 2nd press even after wiping / circular navigation on Edge and Chrome") was audited
screen-by-screen on 2026-08-05 (`docs/2026-08-05_audit_tester-round_v1_0.md`): the modules
measured FINE on org 1. The symptoms trace to R1 (org context poisoning — Block B), R3 (a
service-worker cache never invalidated in 67 releases — Block C), R4 (KOTC unreachable —
Block D). The seeder second-press defect (R2) was FIXED in v0.88.0 and verified live by
pressing the production route twice. If the owner reports it broken again, the FIRST check
is whether their browser is executing pre-v0.88.0 JS from the stale SW cache (R3) — verify
against the live route/D1 before touching `sandbox.js` again.

  1. **BLOCK B — org honesty.** B1 switcher lists only orgs from `/api/me` · B2 active org
     visible on every admin screen · B3 org-scoped empty state naming the org, offering the
     switch back and (sandbox) Generate test data · B4 403 renders as "no access to <org>",
     never "couldn't load your events" · self-heal: on boot, a stored `bt_org` the user has
     no role in resets to their first role org. B5 (localStorage vs session scope) is an
     OWNER DECISION — ask once in the end-of-turn summary, do not guess; the self-heal makes
     either answer safe.
  2. **BLOCK C — kill the stale-cache class.** Version-derived SW cache name · drop
     `ignoreSearch` on the fallback · one-time unregister/purge for already-poisoned browsers.
     Every tester browser is already poisoned; correct future code does not clean it.
  3. **A3 rider:** KOTC session in the seed + `price_cents` on the paid test registrations
     (Sales & Reports shows $0 beside 20 PAID).
  4. **BLOCK D — reachability.** D1 create-session + entry-list UI for KOTC (routes exist,
     UI only) · D2 a guard that every admin route has a caller in `web/` (run the call-site
     rule in BOTH directions).
  5. **BLOCK E — polish.** E1 brackets chooser empty state + backdrop close · E2 divisions
     "more to do" vs "broken" · E3 auto-select the first event everywhere (scoring links,
     tournament ops) · E4 rename the two undated migration files.
  6. **§-1b W-units — the registration-first workflow program** (owner 2026-08-05, roadmap
     §-1b is the spec of record). One W-unit per iteration; routes and screens ship together.

**BUILD-BIAS RULE (owner 2026-08-05).** Prefer shipping features over expanding the test
harness. Keep the suite green (CI fails closed) and ship the minimal guard each gate already
requires — but when a defect is found outside the unit, RECORD it in roadmap §-1c and move
on rather than fixing everything inline. Broken-and-deferred beats half-fixed-and-unrecorded.

**HALT — `RALPH: STOP — QUEUE EMPTY`** when the queue above is done. That is success.
**HALT — `RALPH: STOP — NEEDS OWNER`** for anything requiring: a D1 migration (applied to
live D1 via Cloudflare MCP before the push — when the MCP is reachable in-session this is
permitted, ledger row read back after; never leave an unapplied migration file in the tree) ·
a decision handoff §4 does not settle · deleting files, force-push, publishing, spending
money · `.github/workflows/**` changes.
**HALT — `RALPH: STOP — SCOPE`** if the unit needs a new worker module you did not plan, or
touches more than ~8 files beyond estimate. Write what you learned to `LOOP.md` first.

**BEFORE building on ANY claim in the handoff or this file, grep it.** One check, not a
sweep. If the claim is about DATA, query live D1 instead.

═══════════════════════════════════════════════════════════════════════════════
PHASE 3 — BUILD IT
═══════════════════════════════════════════════════════════════════════════════

KOTC/QOTC WORK: read `docs/2026-08-04_reference_kotc-live-run_v1_0.md` FIRST — it is the
owner's real tournament data and outranks every spec sentence. Movement is rank → divisions →
discretion; `nextRound` is a PROPOSAL; no formula is encoded, do not add one. Nets are named
and non-contiguous. Scores are DIFFERENTIALS.

W-UNIT WORK: roadmap §-1b is the spec of record. Registration is the database-building core;
every module populates FROM it. Pool-sheet mathematics (§-1b W-C) are the owner's own rules —
implement them as DEFAULTS the operator can override, never as refusals.

HOUSE RULES:
- Routes and screens ship TOGETHER. A route with no screen is failure class 1 — and so is a
  screen instruction pointing at a control that does not exist.
- Every guard ships a NEGATIVE CONTROL THAT MUTATES THE REAL INPUT.
- Assert CALL SITES (dispatch-table entries), never definitions — in both directions.
- Check the set that ships BEHAVIOUR — strip comments before content checks, and give the
  stripping its own negative control.
- Generate a new page only from one that passes `page_structure.test.mjs`. A new member page
  moves the header floor — bump it and record the reason AT the assertion. Register every new
  page in `build-status.js`.
- A new admin page needs an entry in `rail.partial.html` AND `admin-nav.js`'s NAV list, then
  `node worker/scripts/sync-rail.mjs --write` (it does NOT check NAV parity).
- Load the design roster before any UI: `/emil-design-eng`, then `frontend-design`. `ux-copy`
  is NOT installed — standards §8 is the rule set. Tokens only; the gold rule; 44px targets.
- Errors are human sentences, not codes. Names render "First L." on any no-login surface.
  No org email in member-facing copy. Score entry copy speaks in DIFFERENTIALS.
- Never round-trip a UTF-8 file through PowerShell `Get-Content`/`Set-Content`.

RELEASE, only if the unit changed `worker/**` or `web/**`:
    1. bump `version:` in worker/src/index.js — byte-verify a ONE-LINE diff
    2. node worker/scripts/sweep-buster.mjs --write   ← ANY release that bumps the version
       sweeps, including worker-only (the C6 guard ties the buster to index.js, and it is right)
    3. node worker/scripts/sync-rail.mjs --write      ← only if a page was added
    4. node worker/scripts/preflight.mjs              ← must print CLEAR
    5. node worker/scripts/changelog-entry.mjs --version vX.Y.Z --date YYYY-MM-DD --body-file entry.md
       node worker/scripts/changelog-entry.mjs --check --version vX.Y.Z   (--version REQUIRED)
       Then DELETE entry.md.
    6. commit (git commit -F <file>; PowerShell has no heredoc), then push
    7. confirm the deploy — preflight `deployed` PASS, then fetch the live artifact and SAMPLE
       TO CONVERGENCE (the health check flaps ~2 min across edge locations):
         health https://boomtown-api.vvisuth.workers.dev/api/health
         pages  https://10xequity.github.io/btplatform/
       `git log main..origin/main` must be EMPTY after. A release is ONE push.

  Docs-only or tooling-only: NO bump, NO sweep. Still commit and push.
  If `git push` is refused by the permission classifier, RETRY — it has been refused twice
  and succeeded on the third attempt. Three refusals = `RALPH: STOP — TOOL BLOCKED`.

NEVER: numbered SQL outside `db/migrations/` · a route accepting `org_id` from the client ·
a screening/clearance field · re-asking anything settled in handoff §4 · rewriting CHANGELOG
history · a static date-linting guard · gold text on a light surface.

═══════════════════════════════════════════════════════════════════════════════
PHASE 4 — RECORD, THEN HALT OR CONTINUE. Even if you stopped early. Especially then.
═══════════════════════════════════════════════════════════════════════════════

1. If you shipped: update the handoff **IN PLACE** — §1 measured numbers, §2 what shipped,
   §6 with the finished item struck. Keep it SHORT. **Never create a second handoff file
   mid-loop** — that trips D4. The dated-rename ritual is the human end-of-session step.
2. APPEND to `LOOP.md`:

       ## <ISO timestamp> — iteration <n>
       outcome   : SHIPPED vX.Y.Z | NO-BUMP | STOPPED-<reason>
       unit      : <the one thing, in a sentence>
       commit    : <sha or "none">
       measured  : suite <n>/<n> · files <n> · modules <n> · busters <n>/<n files> · ledger <nnnn>
       docs read : <which, beyond the handoff>
       learned   : <one line the next iteration would want. "nothing" is valid.>
       next      : <the queue item the next iteration should pick>

3. Commit and push `LOOP.md` with the work (or alone, if you stopped early).
4. End with the sentinel (`RALPH: CONTINUE` / `RALPH: STOP — <reason>`), then halt or re-arm
   per the LOOP DRIVER section.

═══════════════════════════════════════════════════════════════════════════════
PER-ITERATION CONTEXT BUDGET
═══════════════════════════════════════════════════════════════════════════════

If ANY fires, FINISH the current unit, do PHASE 4, halt or re-arm — do not start a second
unit: a release cut and verified · the suite run twice · ~12+ files read · context-low
warning. Halting early with clean state is the loop working.
