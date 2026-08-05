# Boomtown Platform — W-D seeding suggestions: specification of record

**File:** `docs/2026-08-05_spec_seeding-suggestions_v1_0.md` · **Version:** v1.0 · **Created:** 2026-08-05
**Status:** ACTIVE — implementation spec for roadmap §-1b **W-D**. Nothing here is built yet.
**Supersedes:** nothing. First spec for W-D.
**Method:** four parallel readers over the pool board, the history schema, the repo's existing
propose-then-approve precedent and the guard landscape; two competing designs; one adversarial
judge. Every fact below carries a file citation or a live-D1 measurement. **Where this document
and a source file disagree, the file wins** (standards §1).

---

## §0. Why this document exists

W-D is the one W-unit where the obvious implementation is wrong. Three of the four "facts" a
reasonable engineer would assume are false in this repo, and two of them would ship a feature that
confidently credits the wrong teams. They are recorded in §1 as corrections, because a spec that
only says what to build would let the next session re-make them.

**The owner's constraint, verbatim (2026-08-05):**

> "We then analyze the teams as best we can and then split the good players (previous winners) as
> much as possible (using historical data) and have friends avoid playing too much with each other
> in pool or people from the same area (N Co or Colorado Springs) together. **These are just
> suggestions not rules, as it may be impossible to complete based on entered teams.**"

Repo law this inherits: a proposal must never become a formula the software enforces (KOTC
reference, `nextRound` is a PROPOSAL) · the director decides (divisions balancer, "Propose, you
approve") · **modules degrade rather than collapse — a failure may cost information, never
permission** (handoff §4).

---

## §1. The four corrections — read these before writing a line

**C-1. `standings.rank` is NOT a champion, and it is NOT per division.**
`refreshStandings` (`worker/src/tournaments.js:309-322`) reads `matches WHERE stage='pool'` only,
loads **every** team in the event with no division filter, and writes one `rank` per team ranked
across all divisions together. The `standings` table has **no `division_id` column**.

*How this nearly shipped wrong:* a live-D1 query against org 1 returns **3** `rank=1` rows for the
12-Court Classic, which reads exactly like "one winner per division". It is not. Those rows are
`worker/src/sandbox.js` writing three hand-authored per-division standings blocks. **The fixture's
shape is not the platform's behaviour** — this is the C12 lesson (verify data against the data)
arriving with the opposite polarity: the data looked *more* structured than the code can produce.

**Therefore: never read `standings.rank`.** "Won before" is derived two ways instead —
a scored **bracket final** (§2 Q2) or **first place within a division on pool play recomputed by
this feature from `wins`/`point_diff`/`points_for`** (§2 Q3).

**C-2. `status` alone does not identify a past event.**
Live D1 holds three `in_progress` events dated **in the future** (2026-08-06/08/10). Any history
query filtering on status alone counts the current and future events as history.
`starts_at < datetime('now')` is load-bearing and non-negotiable.

**C-3. A team name is not a join key.**
`teams` is a fresh row per event with a fresh id and **no uniqueness on `name`**. `sandbox.js`
carries "TEST Net Gains" as two different ids with two different captains. History joins on people.

**C-4. The pool board has no fairness panel to extend.**
Its only evaluative output is a client-side per-pool **count** with an advisory `under 6` / `over 11`
label (`web/assets/admin-pool-board.js:112-114`). `#pbHint` is a general-purpose status line with
**seven** `textContent` writes, so rendering into it destroys child nodes. There is no existing
"second voice" to join — W-D introduces the first one.

---

## §2. What the data actually supports (measured on live D1, org 1, 2026-08-05)

| Signal | Derivable? | Evidence |
|---|---|---|
| Previous winners | **Yes, but not from `rank`** | 58 standings rows across 5 events; 62 of 70 teams carry `captain_contact_id`; live has exactly **one** bracket final and it is **unscored**, so pool-play-first is the only input that fires today |
| Same area | **Yes** | **48 of 49** contacts carry `city` (Aurora, Fountain, Pueblo, Colorado Springs). `contacts.state` is ignored — unvalidated free text |
| Frequent teammates | **Yes, by identity** | **124 of 124** `team_members` rows carry `contact_id`, not just free-text email |

**Person identity** resolves through one shared key so a person who is `contact_id` on one roster
and `member_email` on another is still one person:

```
PKEY      = COALESCE('c' || tm.contact_id, 'c' || cx.id, 'e' || lower(trim(tm.member_email)))
PKEY_JOIN = LEFT JOIN contacts cx ON cx.org_id = tm.org_id AND cx.email = tm.member_email
                                 AND cx.deleted_at IS NULL
```
`contacts.email` is `COLLATE NOCASE` and `idx_contacts_org_email` covers `(org_id, email)`, so do
**not** wrap either side in `lower()`/`trim()` inside the join or the index is defeated; a
whitespace-padded address falls through to the `'e'` key by design.

**Past-event predicate:**
```
PAST_EVENT = e.org_id = ?1 AND e.deleted_at IS NULL
         AND e.status IN ('in_progress','completed')
         AND e.starts_at IS NOT NULL
         AND e.starts_at < datetime('now')          -- C-2, load-bearing
         AND e.starts_at >= date('now','-18 months')
```

**Four read-only queries** (full SQL in the run journal; shapes here):
1. **People and their prior teams** — one statement, `UNION` (never `UNION ALL`, so a captain who
   also holds a roster row dedupes), bounded to this event's people, `LIMIT 5001`. At exactly 5001
   rows the set was truncated: **drop both history signals whole** rather than reason over a
   partial set.
2. **Bracket champions** — `matches WHERE bracket_round=1` (round 1 *is* the final,
   `brackets.js:426-433`) with both scores non-null **and `score_a <> score_b`** — without the
   inequality a tie silently credits `team_b` through the `ELSE` branch. Expect **zero rows on
   live today**; that is correct, not a bug.
3. **First in a division on pool play** — driven from `events` so the standings PK autoindex is
   used; an **INNER** join to `standings` so a team with no row is *absent* rather than counted
   0-0. Group by `(past_event, division_id ?? 'nodiv')`; skip groups under 3 rows; sort
   `wins DESC, point_diff DESC, points_for DESC`; on a three-way tie for first, credit **nobody**.
4. **Area** — current event only, captain city only, `lower(trim(city))` and nothing else. **No
   region taxonomy**: no "N Co", no alias map, no abbreviation expansion. "Fort Collins" and
   "Ft Collins" stay two groups and the signal understates — that is the honest failure, and a
   region map needs an owner answer first.

---

## §3. The build

**One new module, one new payload key, one new panel, one guard file. No new route.**

`worker/src/board_suggest.js` — single export `boardSuggestions(env, orgId, eventId, shaped,
divisions, pools)`. Writes nothing: no INSERT, UPDATE, DELETE, no audit row, no dismissed-suggestion
table. Exports **no** name ending in `Routes`, so `resilience.test.mjs`'s dispatch sweep
(`resilience.test.mjs:147`) does not demand a table entry. Takes `env` as a parameter rather than
injected helpers — the same shape as the pure `names.js` import `divisions.js` already uses.

**Three signals, each in its own `try/catch` returning `[]`:**

- **`spread_winners`** — per division with ≥2 pools, count teams holding ≥1 "won before" person;
  emit only when `max pool − min pool >= 2`.
- **`split_repeat`** — unordered pkey pairs (`p1 < p2` kills mirrors), `DISTINCT` on
  `(p1, p2, past_team)` because `team_members` has no unique constraint and a person can appear
  twice on one roster; count **distinct past rosters** per pair so a six-person overlap counts
  once, not fifteen times; emit for current-team pairs in the **same** pool with ≥2 shared rosters.
- **`spread_area`** — per division with ≥2 pools, require city coverage ≥60% of the division's
  teams **and** the largest city group ≥3; emit only when one pool holds ≥⅔ of that group and
  another pool in the same division holds none of it.

**The suppressor, on every signal:** if the implied move would take the source pool under 6 or the
target over 11, **emit nothing**. The 6–11 preference suppresses a *suggestion*; it never
restricts a save.

Each item is `{ id, kind, text, team_ids }` — `id` deterministic (`w:p7`, `f:12-19`,
`a:p7:fountain`) so a dismissal survives a reload; `text` a complete English sentence composed on
the **server** with its numbers and denominator inlined (the `admin-divisions.js` law — the client
composes no sentence); `team_ids` drives the client highlight. Sorted by imbalance, capped at 6.
**Sentences name teams and counts, never a person.**

**Wiring** — `worker/src/divisions.js`, one import plus exactly one key added to `loadBoard`'s
return after `workspace`:
```js
suggestions: await boardSuggestions(env, ctx.orgId, eventId, shaped, divisions, pools).catch(() => [])
```
The board POST already spreads `...board` (`divisions.js:629-635`), so the panel refreshes on every
save with **no second request and no new route**. Do not widen the teams SELECT. Do not touch the
board `note` sentence — `pool_board.test.mjs` regex-matches it in two places and asserts
`note === null` on a cleared team note.

**The panel** — `web/admin-pool-board.html`, a `<section id="pbSug" hidden>` inserted in the static
gap between `#pbBoard` (line 191) and `<section class="pb-workspace">` (line 193). That location is
the only safe one, for three independently verified reasons: `render()` rewrites the innerHTML of
only `#pbBoard` and `#pbWork`; `fail("pbBoard")` and `orgEmptyState("pbBoard")` replace `#pbBoard`
wholesale; and it sits outside all three enumerated drop-target groups (`js:179-183`).

**The client** — `renderSuggestions()` renders `s.text` verbatim through `esc()`, called from
`ingest()` and **never** from `render()` or `wire()`: `wire()` runs at the end of every `render()`
and already stacks handlers on `#pbWork` (`js:182`), so panel wiring there would reproduce that bug
exactly. One delegated listener on the static `#pbSugList` handles dismiss and highlight.

---

## §4. Guard traps — each of these reddens on a plausible first draft

| Trap | Where |
|---|---|
| `tile()` pins the literal source text `aria-label="${esc(t.name)}` — **no** badge, city label or history chip on a tile | `pool_board.test.mjs:276` |
| A whole-file negative regex forbids `disabled`…`pool`…`size` in that order and the phrase "cannot save" — **comments included**. Use `count`, not `size`, in any new identifier | `pool_board.test.mjs:302` |
| `workspace.length===12`, `divisions.length===2`, `deepEqual(divisions.map(d=>d.pools),[[],[]])` — the four original arrays must not change in contents, order, length or nesting | `pool_board.test.mjs:65-67` |
| Adding a new **top-level payload key** reddens nothing — there is no whole-object `deepEqual` | `pool_board.test.mjs` |
| Gold may not be text; a `:focus-visible` outline must use `var(--focus-ring)` | `tokens.test.mjs:219-264` |
| A page-level selector starting with `.btn`, or a `.btn` modifier without the base | `shared_buttons.test.mjs`, `button_vocabulary.test.mjs` |
| `planPool`/`planBestPool` are asserted **byte-equal deterministic** across two calls — W-D is a read-only layer over pool **membership**, never inside round generation | `formats.test.mjs:209` |
| `names.test.mjs`'s one-name rule scans only `live.js`/`brackets.js`/`divisions.js`, so a hand-rolled name rule in a new module passes green — the guard must assert "no person named" itself | `names.test.mjs` |

**`route_reachability` baseline strikes: none.** W-D adds no route. If one is ever added, build its
caller with a **template literal, never string concatenation** — `"…/events/" + id + "/board/suggest"`
masks to `/api/admin/events/*` and would "heal" two unrelated baseline entries at once.

---

## §5. The guard file

`worker/test/board_suggestions.test.mjs`, booted like `divisions.test.mjs`. The fixture is
deliberately forced to produce **all three kinds** — `divisions.test.mjs:296-310` records a fixture
that produced only one kind and therefore missed an engine applying another — plus a **future-dated
`in_progress`** event that must contribute nothing.

Assertions, as invariants rather than pinned strings (heeding `divisions_page.test.mjs` v1.1, whose
first draft demanded `role="alert"` and reddened on the correct fix):

- **A1 read-never-write** — snapshot `teams` and `standings` before and after the GET, `deepEqual`;
  then assert the kinds set contains all three, so the no-write assertion is not vacuous over a
  payload that proposed nothing.
- **A2 first event ever is silent** — `suggestions: []`, the four original keys unchanged, and
  `!/not enough|insufficient|no history|unable/i` over the whole response. **Absence produces
  silence, never a sentence about absence.**
- **A3 future events are not history** (C-2). **A4 champion trap** — a team with `rank=1` that
  *loses* a scored final must not be credited; an unscored final credits nobody (live's real state).
  **A5 division placing, not event rank** (C-1), including the tie case. **A6 identity resolved,
  not split.** **A7 the 6–11 suppressor**, with the save path still 200. **A8 no person named** —
  collect every fixture `full_name` and assert no suggestion text contains it.
- **A9 page contract as ordering** — `#pbBoard` < `#pbSug` < `.pb-workspace`; the `wire()` slice
  must not mention `pbSug`; `.pb-sug-text` at 13px (the reason is not small print).

Negative controls, house style (mutate the **real** shipped file, assert the mutation landed, assert
the verdict flips): **NC-1** rename a column in the real module → returns `[]` rather than throwing,
proving the per-signal `try/catch` is exercisable. **NC-2** stub `env.DB.prepare` to throw, counting
calls so it cannot pass vacuously → board still 200 with the other four keys intact. **NC-3** insert
a single `UPDATE teams SET pool_id=pool_id` into the real module and assert **A1 fails**, proving the
propose-never-apply assertion can actually catch a writer.

---

## §6. Deliberately deferred

- **Migration 0043 (index-only).** Two partial indexes on `team_members (org_id, team_id)` and
  `(org_id, contact_id)` `WHERE deleted_at IS NULL`. `sqlite_master` was read live first: only
  `idx_team_members_email` exists today. **Performance only — W-D is correct without it**, and it
  is deferred so the first release carries no migration. If added: apply via Cloudflare MCP
  **before** the push and read the ledger row back. No new table, no new column, no clearance field.
- **Region taxonomy** ("N Co") — needs an owner mapping. Cities group on the literal string.

## §7. Two questions for the owner — record, do not decide in code

1. **`team_members.is_sub`** — the design **excludes subs** from every roster in all three signals,
   so a sub is neither a previous winner nor a friend. Live D1 has **zero** sub rows, so the choice
   is untested against real data.
2. **The definition of "won before"** — currently *a bracket final won* **or** *first in a division
   on pool play*. Live D1 has exactly one bracket final and it is unscored, so **pool-play first is
   the only input that fires today**. Is that the intended meaning of "previous winner"?

**Honest limits to state on screen or not at all:** the friends signal under-reports whenever
`team_members.contact_id` is NULL and no `member_email` exists (`registrations.js:742`'s bulk import
writes `member_name` only, and such rows are unjoinable to a person by any key); the area signal
will be silent most of the time by design.

---

*Changelog: v1.0 (2026-08-05) — first spec. Records four corrections that would each have shipped a
wrong feature, chief among them that `standings.rank` is an event-wide pool finish and the
per-division shape visible on live D1 is a seeder artifact.*
