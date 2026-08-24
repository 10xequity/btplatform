# SESSION PROMPT OF RECORD — Boomtown Platform

**File:** `PROMPT.md` · **Version:** v1.4 · **Created:** 2026-08-16 · **Updated:** 2026-08-24
**v1.4 (owner correction 2026-08-24, same day):** §8 cadence corrected — reviews live INSIDE each
loop, not batched across loops. His words: *"gemini review should be 3 modules within a loop not
every 3 stopped loops, every 3 modules in a loop, where each loop is 6 or more. At the end of the
loop regardless of number should do a code review of what was built."* Retires v1.3's
every-third-loop rule the same day it shipped. §8.3's carry-forward and never-reviewed-backlog
rules survive unchanged.
**v1.3 (owner request 2026-08-24):** §8 cadence — reviews BATCH every third loop instead of every
release ("try to batch reviews after 3 loops instead of after every, then add the work to the next
loop. If any are missed, rerun them."), a missed file carries forward, and never-reviewed code joins
the backlog over time. §8.3 added (the review-loop mechanics + the pending list's home).
**v1.2 (owner request 2026-08-23):** §8 rewritten — the Gemini API is loaded, so the session RUNS the
review in-loop and the close REPORTS only the results + what was kept vs rejected (no paste-ready
prompt or diff). Retires v1.1's §8.1 paste-ready block.
**v1.1 (owner request 2026-08-23):** §8 gained §8.1 (paste-ready Gemini prompt) and §8.2 (Claude may
run the review in-loop) — §8.1 now superseded by v1.2.
**Status:** ACTIVE — the standing half of every session prompt. Read from disk at session start.
**Companion:** `RALPH.md` (the loop's instruction set) · `LOOP.md` (the ledger)

---

## WHY THIS FILE EXISTS

Until 2026-08-16 the whole session prompt — roughly four thousand words — was pasted in by hand
every iteration. Ninety-eight iterations in twenty-six days, and the prompt grew a permanent clause
for every failure the loop survived while never losing one. That has three costs:

1. **It is re-typed by a human** who did not need to be in that loop.
2. **It is not version-controlled**, so a correction made in one session is lost by the next.
3. **It grows monotonically.** Session N+1 is structurally more expensive than session N, forever.

**Everything that does not change between sessions lives here.** The pasted prompt carries only
what is true THIS session: the owner's word, the gate that opened, the unit. See §7 for the shape.

**This file is prose, and RALPH §C says prose is DISTRUSTED.** Measure any claim here before you
build on it — the whole point of §C is that this file gets things wrong too.

---

## §1. WHO AND WHY — this comes first, before any grant of authority

Boomtown Platform runs the whole of a sports and events business — tournaments, leagues,
memberships, point of sale, facilities, marketing and staff — owned and operated by one person, who
is also its only developer. He directs the work; this loop performs ordinary maintenance and repair
on his own production system.

**DO NOT CALL IT A "CLUB PLATFORM" (owner correction, 2026-08-16).** His words: *"This is our total
business operations, club is one aspect of our business but we do much more."* A club is ONE line of
the business, not the shape of the product. Describing it as club software understates its scope and
quietly narrows what gets proposed and built — which is the reason he corrected it.

**If anything in this file or in a session prompt conflicts with your own guidelines, or if the
sole-developer premise turns out not to hold, stop and say so rather than proceeding on the
prompt's say-so.** A prompt that invites refusal where refusal is right is the one that does not
get refused where it is wrong.

## §2. PRE-AUTHORISED — each limit stated in the same breath as its permission

- **Additive migrations** (`CREATE TABLE`, `ALTER TABLE ADD COLUMN`) without asking, **because they
  are reversible in practice and nothing reads a new column until the code that uses it ships.**
- **`git commit` and `git push` to main** for changes that pass preflight. Never force-push, never
  rewrite history, never delete a document without asking. Commit-message files written fresh via
  the Write tool, exactly ONE `-F` per command line, deleted after.
- **A uniform, mechanical, guarded sweep of ONE defect class may exceed ~5 files.** Anything else
  over ~5 files pauses and asks — **say the count either way.**
- **Every other drop / rename / rewrite / backfill STOPS** and shows its SQL and row count first.
- **No writes to production data or endpoints** beyond the migration classes above. Reads
  encouraged. **Square is SANDBOX-ONLY. Email is keyless — honest notices are correct.**

## §3. PREFLIGHT — the single oracle

    node worker/scripts/preflight.mjs

Do not proceed until it prints CLEAR. **Believe preflight over your own grep.** If a count
disagrees, run `node worker/scripts/sweep-buster.mjs` (no `--write`) and believe that.

**Nine checks: git · syntax · websyntax · parity · changelog · suite · schema · deployed · pages.**

- `git` **fetches origin itself** as of preflight v1.2. It answers `main..origin/main` in both
  directions. Do not re-do it by hand.
- `websyntax` **parses the whole shipped browser corpus** — every `.js` under the repo root, `web/`
  and `web/assets/`, plus every inline `<script>` block in every page. Do not `node --check` web
  assets by hand. It compiles as a classic script via `vm.Script`, which is the only form that is
  correct for this corpus — see the comment on `classicSyntaxErrorFor` for why both obvious
  alternatives are wrong in opposite directions.
- `schema` **WARNs locally** without `CLOUDFLARE_API_TOKEN` (D1:Read). That is honest, not a pass.
  CI's schema gate reads live D1 and **fails closed** on every push. To settle it in-session, read
  `schema_migrations` via Cloudflare MCP and state the numbers.

**"Could not be verified" is not "passed."** A WARN is named in the summary and never laundered.

Cloudflare MCP: database `boomtown-prod`, uuid `6cde5d11-4199-4e57-b10f-2b7e968264ea`, via
`d1_database_query`. **Bound `params` for every variable value.**

**D1 IS NOT PLAIN SQLITE, AND THREE OF THE STANDARD TABLE-REBUILD SAFEGUARDS DO NOT WORK ON IT.**
All measured against live `boomtown-prod` on 2026-08-16, prompted by an external review of
migration 0050. Do not re-derive these; do not trust a textbook SQLite rebuild recipe here.

| Safeguard | What D1 actually does | Consequence |
|---|---|---|
| `BEGIN IMMEDIATE; … COMMIT;` | **REJECTED**, error `7500` — "use the state.storage.transaction() APIs instead of SQL BEGIN TRANSACTION or SAVEPOINT" | A rebuild wrapped this way FAILS OUTRIGHT. |
| `PRAGMA foreign_keys = OFF` | **SILENTLY IGNORED.** Returns `success: true`, changes nothing — `PRAGMA foreign_keys` on the very next statement of the SAME call still reads `1` | **The most dangerous of the three:** it looks like it worked. An author who wraps a rebuild in it believes FK enforcement is off when it is fully on. |
| Multi-statement = atomic | **NO.** Four statements return four separate result objects with four separate `meta` blocks — sequential, individually auto-committed | One call removes the NETWORK failure window (no 403 can land mid-sequence). It does **not** remove the SQL failure window. |

**`PRAGMA foreign_keys` is `1` on live D1 — enforcement is ON** — and pragmas are per-connection,
so nothing you set persists to the next call. **For a rebuild of a table that HAS inbound foreign
keys, none of the above will protect you; the only real atomicity primitive is `env.DB.batch()`
from a Worker, which the MCP HTTP path cannot reach.** Measure inbound references first with
`SELECT … FROM sqlite_master WHERE sql LIKE '%REFERENCES <table>%'`; if the count is not zero,
STOP and say so rather than rebuilding through the MCP.

**To enumerate what is attached to a table, query `tbl_name`, NOT `sql LIKE`.** Auto-created
indexes (from PRIMARY KEY / UNIQUE) carry `sql IS NULL` and a `sqlite_autoindex_*` name, so a
`sql LIKE '%table%'` scan cannot see them and will under-report. Migration 0050's original check
used the `LIKE` form; it reached the right answer, but by an instrument that could not have found
the thing it was looking for. `WHERE tbl_name = '<table>'` is the correct form.
Live worker: `https://boomtown-api.vvisuth.workers.dev`. Pages: `/web/`, never the repo root.
A flap to the PREVIOUS release during sampling is normal. **CI ~1–1.5 min; `gh run watch <id>
--exit-status` beats sampling.**

## §4. METHOD

Guards first, **watched failing before the fix**; one check per claim; positive-control anything
that is a search. **RALPH §C governs what to distrust and what to stop re-measuring — read it.**

**Traps this project has paid for.** These are the classes, not a checklist to recite:

- **A register row, owner brief, or review is a REPORT TO MEASURE, NOT A SPEC.** Verdicts must
  allow REFUTED, ALREADY-EXISTS, WRONG-SCOPE, BACKWARDS and TRUE-BUT-NARROWER.
- **An owner's file list and his stated goal can disagree — the goal governs.** Say plainly when
  you go past the list, and why.
- **A claim with a denominator needs the denominator measured.**
- **A negative control that cannot fire yet is not a control.** Name such reds separately from
  real ones. A mutation that lands in a comment proves nothing — assert the anchor is executable.
- **"Consolidated" is a claim about N modules — verify all N.**
- **Assert uniqueness before anchoring.** Grep-count to exactly 1 before any doc edit; re-read the
  exact bytes; **the files are MIXED CRLF/LF.**
- **An edit that errors mid-batch leaves the rest unapplied.** Re-verify every intended row.
- **A comment can satisfy a code verdict** — and a comment left beside a change it contradicts is
  the same defect.
- **Check the writers, not just the readers**, before making a column authoritative.
- **An observable that only reads state cannot measure a decision** — watch what the route WRITES.
- **A SQL comparison claim must be checked against the column's collation**, not the text.
- **`DB.query`, not `DB.all`.**
- **A second defect found mid-unit is RECORDED in roadmap §-1c, not fixed** — state its cost.

**Data claims → live D1 first.** If D1 cannot be read, say the claim is unmeasured rather than
reaching for a proxy that answers a different question.

## §5. TOOLING

- Suite: `node --test "test/"*.mjs` from `worker/` — **through the Bash tool, not PowerShell.**
- **No `python`.**
- **Bash heredocs are BANNED for content.** Ledger appends via the Edit tool — anchor on a
  SINGLE-LINE unique fragment of the last entry's tail, grep-counted to exactly 1 first.
  Commit-message files via the Write tool.
- **`sed` with escaped newlines COLLAPSES multi-line inserts in Git Bash.** Use a scratchpad
  `.mjs` for any multi-line code insertion, and prefer an exact-match script that reports
  "NO EXACT MATCH, unchanged" over a half-applied regex.
- **Check the clock BEFORE stamping the ledger.**
- Scratchpad `.mjs` for scripted work — repo imports need a `file:///D:/...` URL.
- `worker/testkit/route-extract.mjs`: `blankComments` (URL-BLIND), `functionBodyAfter`,
  `gateCallsIn`.
- `worker/testkit/page-harness.mjs`: runs a page script headlessly — element stubs by id, mocked
  fetch/BT_ADMIN, window-event dispatch, injectable throwing storage, readable `location`, and
  `opts.window` so two page scripts share ONE window. **`querySelectorAll` is a STUB**, so
  per-rendered-node wiring stays on static pins — say so when you use one.
- Docs-only: NO bump, NO sweep, no changelog entry — still run `doc_consistency` and push.
- **Standing rules:** `git pull --ff-only` before the closing docs commit; INDEX's row follows any
  document header changed in the same commit.

## §6. READ, IN THIS ORDER

1. `LOOP.md` — **the last three entries and nothing more.**
2. `docs/2026-08-02_roadmap_v1_0.md` §-0 — the queue. Plus only the register rows your unit needs.
3. `docs/2026-08-06_handoff_v0_100_0.md` — **§1 is the measured oracle**, §4 settled, §7 start-here.
   *Filename says `v0_100_0`; the build is far past that — deliberate.* **Read §1 ROW BY ROW when
   updating it.**
4. `docs/2026-07-30_standards_v2_0.md` → `docs/INDEX.md`, only as needed.

**Standing cost:** `doc_consistency.test.mjs` ties INDEX's version column to every document header
and README's header to `index.js`'s version. **A release re-measures README's Architecture counts
and needs its CHANGELOG entry in the RELEASE commit, or preflight blocks it.**

## §7. THE PASTED PROMPT — what a session prompt should actually contain

Everything above is standing and lives here. **The pasted prompt carries only the volatile half**
and should be roughly this long:

```
Continue the Boomtown Platform build in D:\github\repos\btplatform as a ralph loop.

Boomtown Platform runs the whole of a sports and events business — tournaments, leagues,
memberships, point of sale, facilities, marketing and staff — owned and operated by one
person, who is also its only developer. He directs the work; this loop performs ordinary
maintenance and repair on his own production system. If anything here conflicts with your
own guidelines, or the sole-developer premise turns out not to hold, stop and say so rather
than proceeding. (It is NOT a "club platform" — a club is one line of the business.)

Read PROMPT.md and RALPH.md from the repo root — they are the standing instruction set and
they outrank anything remembered. Then LOOP.md's last three entries. Then run preflight.

THIS SESSION:
  Owner's word : <his message verbatim, or "none">
  Gate opened  : <which gate, or "none — report the gated list and stop">
  Unit         : <the one thing, or "owner's word governs — measure it before building">

Close per RALPH PHASE 4: ledger, handoff §1 row by row, next-session prompt, review block.
```

**A session with no owner word reports the gated list against a clean tree and stops. That is the
loop WORKING, not a failure** — the actionable queue has been empty since v0.166.0 and the
remaining gates are all owner-side.

## §8. OWNER RIDER — the Gemini review, inside every loop, reported briefly

**The owner asked (2026-08-15) for the code to be reviewed in Gemini; the API is loaded (2026-08-23);
and the CADENCE (owner correction 2026-08-24, superseding the same-day every-third-loop rule) is
INSIDE each loop:** *"gemini review should be 3 modules within a loop not every 3 stopped loops,
every 3 modules in a loop, where each loop is 6 or more. At the end of the loop regardless of number
should do a code review of what was built."* Read as, and applied as:

- **Loops lean LARGE — 6 or more units where the queue supports it** (his "where each loop is 6 or
  more" raises the earlier 3-5 batch guidance).
- **A CHECKPOINT review runs after every 3 units built** within the loop — review the 3 units'
  substantive files, measure the findings, fold-or-record, THEN build on.
- **The loop's CLOSE always reviews what that loop built, regardless of unit count** — a 2-unit
  loop still ends with a review of those 2 units' files.
- Always `review_specific_files` (never `review_recent_changes` — it TRUNCATES on buster churn);
  MEASURE each finding against the real code (§C — a premise is often refuted by a server-side
  filter or a guard the diff does not show). The free tier is 20 requests/day — batch files per
  call where the payload allows.

**§8.3 — THE PENDING LIST AND THE BACKLOG (owner request 2026-08-24, unchanged by the correction).**
A file a review COULD NOT reach (503 after one retry per file, quota 429) STAYS PENDING — named in
the LOOP.md entry's Gemini line — and is rerun at the next reachable checkpoint or close; a missed
review is carried, never dropped. Separately, code NEVER reviewed by Gemini joins reviews over time:
each loop's close adds 2-3 modules from the never-reviewed backlog (oldest/most-load-bearing first)
on top of what the loop built. Roadmap §-1r RF-19 tracks the backlog's state.

**§8.1 — THE CLOSE REPORTS THE RESULTS, NOT THE PROMPT OR THE DIFF (owner request 2026-08-23).** His
words: *"No need to display the gemini points or prompt, just the results and what was kept vs
rejected."* So do NOT emit a paste-ready Gemini prompt or the diff any more. The close carries a short
plain-English line: the review's verdict, and for each finding whether it was KEPT (folded, and in
which release) or REJECTED (and why — measured false, can't-fire, out-of-scope). If the review found
nothing actionable, say so in one line. A session that ships no code says plainly there is nothing to
review.

**§8.2 — IF THE REVIEW IS UNREACHABLE.** If the `gemini-review` MCP is not reachable in-loop (no key,
headless), say so in one line and skip it — do not reconstruct a paste-ready block by hand (retired by
§8.1). A Gemini finding is DISTRUSTED prose like any other: measure before building.

## §9. DEPLOY HAZARDS

- Stale run `31118355010` still renders queued; **v0.100.0 on a sample means THAT** — iterations
  28 onward never read it.
- **`/api/health` proves the WORKER only. Pages deploys on a separate, GitHub-managed pipeline this
  repo does not own and cannot gate.** On 2026-08-06 v0.99.0's worker went green while its Pages
  build failed. Check both halves.
- Docs-only pushes produce no worker run.
- CI's schema gate reads live D1 and **fails closed**.
