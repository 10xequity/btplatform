# Boomtown Platform — Scope: Tournament format engine, league flexibility, drag-and-drop

**File:** `docs/2026-08-03_scope_format-engine_v1_0.md` · **Version:** v1.0 · **Date:** 2026-08-03
**Status:** SCOPE — not a decision. Written because the owner asked ("If this needs more details,
please scope it"). Nothing here is built. **Supersedes:** nothing; this is the first M-TF scope.
**Source:** owner message 2026-08-03, quoted verbatim in §1.

---

## 0. What exists today, measured

`worker/src/scheduler.js` holds **six hardcoded templates**:

| Template | Teams | Courts | Games/team | To | Cap |
|---|---|---|---|---|---|
| 7-on-3 | 7 | 3 | 6 | 25 | 30 |
| 8-on-4 | 8 | 4 | 7 | 25 | 27 |
| 9-on-4 | 9 | 4 | 8 | 25 | 27 |
| 10-on-4 | 10 | 4 | 8 | 21 | 23 |
| 11-on-5 | 11 | 5 | 10 | 21 | 23 |
| 4-on-2x2 | 4 | 2 | 6 | 21 | 23 |

It already does more than a lookup table: a **feasibility pre-check** (courts × time vs games
needed), an average-minutes-per-game model that varies with the points target, and a
**rematch detector** that warns when a pairing repeats. Pools, matches, scoring, standings and
brackets are all live and tested.

**The gap is exactly one thing: team and court counts are fixed.** Twelve teams on four courts has
no template, so it cannot be run. Everything else the owner asked for is new capability on top.

---

## 1. What the owner asked for, verbatim

> "The tournament needs to be structured with the capability to run any format i end up having with
> registrations, i would like to choose number of teams and number of courts, then set for pools
> based on divisions then have rotations that hold a unique opponent, then equal number of byes for
> all teams as main tenants while balancing the number of games/pts before bracket and overall, not
> too many games. The ability to split over multiple days. We also need to have strange variations
> for example my rotating pairs where males - male partner and female female partners rotate with
> in a set number of games with each opposite gender team and play and then rotate (also females
> rotating) with the priority being the female teams need to play all the male teams at least once,
> and secondary play other females rather than be held fixed. We also need formats for 3 player
> teams joining up another 3 and then rotating the teams. We need the ability to run pool play with
> 1 or 2 waiting and then having a team ref, but functionally the idea is to create as little down
> time as possible."

> "The league system needs to have flexiblity for round robins and change team match ups, and drag
> and drop function also."

---

## 2. The central reframe

Read as a list, this is eight features. It is not. **It is one solver with a constraint set**, and
almost every line above is a constraint on the same object:

> Given N teams, C courts, T minutes and a set of rules, produce a sequence of rounds where each
> round assigns teams to courts, and score it against how well it satisfies the rules.

Building this as eight special cases produces eight things that each break differently. Building
one solver means "rotating pairs" and "3+3 combining" become *constraint profiles*, not code paths.

**The constraints, separated by kind — this distinction is the whole design:**

| Kind | Meaning | Examples from the ask |
|---|---|---|
| **HARD** | Violating it makes the schedule wrong. Refuse to emit. | A team cannot play twice at once. A team cannot ref its own match. Female teams must meet every male team at least once. |
| **SOFT** | Violating it makes the schedule *worse*. Score and minimise. | Unique opponents. Equal byes. Balanced games and points. Minimal idle time. Fair rest gaps. |
| **SHAPE** | Defines the objects before scheduling starts. | N teams, C courts, pools by division, 3+3 pairings, multi-day split. |

A solver that treats "equal byes" as hard will refuse valid schedules over an unavoidable
one-bye difference. A solver that treats "no team plays twice at once" as soft will produce
nonsense. **Most scheduling tools fail by putting a constraint in the wrong column.**

---

## 3. Requirements, decomposed

### 3.1 Arbitrary N teams on C courts — *the actual blocker*
Replace the template table with a generator. For pool play the underlying maths is the **circle
method** for round-robins (fixed team, rotate the rest), extended to handle:
- odd N → exactly one bye per round, rotating so byes distribute evenly
- N > 2C → more teams than courts can host at once, so each round has a *waiting set*
- N < 2C → idle courts; either reduce courts or run two divisions concurrently

**Owner decision needed:** when teams outnumber court capacity, prefer (a) more rounds with everyone
playing fewer games, or (b) fewer rounds with a larger waiting set each round? This changes the
whole shape and cannot be inferred.

### 3.2 Pools by division
Group by `teams.level` / `level_num` (both already exist), then schedule each pool independently and
interleave the pools onto the shared court pool. Two pools of 6 on 4 courts is a court-allocation
problem, not a second scheduler.

### 3.3 Unique opponents (SOFT)
Already partly present — `scheduler.js` detects rematches and warns. Promote from warning to a
scored objective: minimise repeat pairings, and when a repeat is unavoidable, spread repeats evenly
rather than making one team play the same opponent three times.

### 3.4 Equal byes (SOFT, near-hard)
With N teams and R rounds, total byes are fixed by arithmetic. Fairness is about *distribution*:
every team within one bye of every other, and no team taking two byes back to back. State the
arithmetic to the director rather than silently choosing — "11 teams, 10 rounds: 4 teams get 2 byes,
7 get 1" is information they can act on.

### 3.5 Balanced games and points, "not too many" (SOFT)
Two separate levers the owner named together:
- **games per team** — equal, and bounded above
- **points played** — a team of 3 games to 25 has played more volleyball than 4 games to 15

**Owner decision needed:** what is "too many"? A number (e.g. max 8 games or ~150 points before
bracket) makes this solvable. Without one it stays a judgement call the software cannot make.

### 3.6 Multi-day split (SHAPE)
Cut the round sequence at a day boundary with rules: pool play completes within a day where
possible; carry standings across; nobody plays the last slot Saturday and the first Sunday. Needs
`events.starts_at` / `ends_at` per day, which already exist.

### 3.7 Rotating pairs — mixed-gender (the hardest one)
Restated as constraints, the owner's rule is precise:
- Teams are pairs: M/M and F/F.
- **HARD:** every F pair meets every M pair at least once.
- **SOFT, lower priority:** F pairs also meet other F pairs, rather than sitting fixed.
- Partners rotate after a set number of games.

This is a **bipartite covering problem** (cover all F×M pairings) with a secondary objective
(intra-F matches) and a *partner-rotation* layer on top — the roster itself changes between blocks,
so team identity is not stable across the event. That last part is what makes it genuinely hard:
standings must attach to **people**, not to a pair that dissolves at game 4.

**Owner decisions needed:** do M pairs also need to meet all other M pairs? Do partners rotate
within gender only? Does a rotated pair keep its record, or does each block stand alone?

### 3.8 Threes combining into sixes (SHAPE)
Two 3-player teams combine into a 6, play as one, then recombine differently. Same identity problem
as 3.7: results belong to the **trio**, and the combined six is temporary. Model as a *unit*
(the trio) and a *lineup* (two units playing together this block).

### 3.9 Waiting teams as referees (SHAPE + HARD)
With 1–2 teams idle per round, assign a waiting team to ref.
- **HARD:** a team never refs a match it plays in. `matches.ref_team_id` already exists.
- **SOFT:** spread reffing evenly; nobody refs twice before everyone has reffed once.

### 3.10 Minimise downtime — *the real objective*
The owner named this as the point of the whole exercise. It is the thing to optimise **for**, with
the others as constraints: minimise total idle player-minutes across the event. Concretely — avoid
a team playing round 1 then waiting three rounds; keep courts busy; make byes adjacent to reffing
duty so a waiting team is doing something.

---

## 4. Proposed build, in shippable slices

Each slice is independently useful. None requires the next.

| # | Slice | Delivers | Notes |
|---|---|---|---|
| **1** | **Arbitrary N-on-C round-robin generator** | Kills the actual blocker — any team/court count | Pure function, heavily testable. The six templates become test cases that must still produce today's schedules. |
| **2** | **Constraint scoring + report** | Director sees *why* a schedule is good: repeat pairings, bye spread, games/points per team, idle minutes | Makes the solver's judgement visible instead of magic |
| **3** | **Pools by division + court allocation** | Multi-division events on shared courts | |
| **4** | **Waiting-team referee assignment** | Ref duty, fairly spread, never self-ref | Small; `ref_team_id` already exists |
| **5** | **Multi-day split** | Two-day events | |
| **6** | **Drag-and-drop schedule editor** | Move a match to another court or round; the constraint report re-scores live and flags what the move broke | The honest version of "drag and drop": it does not stop you, it tells you what you did |
| **7** | **Rotating pairs (mixed)** | §3.7 | Needs the identity model below |
| **8** | **Trios combining** | §3.8 | Same identity model as 7 |

**Slices 7 and 8 share a prerequisite:** a *participant unit* concept — results attach to a person
or a trio, not to a team row that dissolves mid-event. That is a schema change and should be
designed once, for both.

**Recommended first build: slices 1 + 2.** Slice 1 removes the thing that actually blocks events
today. Slice 2 is what makes the rest trustworthy — without a visible score, a director cannot tell
a good schedule from a plausible one, and will not trust the generator enough to use it.

---

## 5. League flexibility

Smaller than it looks. The league scheduler (`leagues_admin.js`, 283 lines) already generates weekly
grids and enforces a level-gap rule. What is missing:
- **Swap two matchups** — exchange opponents between weeks, with the same constraint re-score
- **Move a match** to another week, court or time
- **Manual override** that survives regeneration — the current generator would overwrite a hand
  edit, which is why directors keep the real schedule in a spreadsheet

That last one is the actual requirement. **A generator that discards manual edits will not be used.**
Mark edited matches as pinned; regeneration works around them.

Slice 6's drag-and-drop editor should serve leagues and tournaments both — same grid, same
constraint report, different source of matches.

---

## 6. Roster import — findings from the real file

The owner pointed at `tt@coloradoboom.com`. **No roster exists in that account** that is visible
here: only *Weekly time sheet COBO Payroll* and *Colorado Boom Schedule*. The closest real roster is
**"Summer All Teams"** (`zhu@boomtownvball.com`, 2 KB), and it is instructive:

- **Two stacked blocks in one sheet, no header row** — a teams block, then a players block,
  separated by blank rows.
- **Teams block:** team name · captain · session · division · payment status · note
- **Players block:** email · name · gender · sessions (comma-separated, multi-value) · division ·
  payment status
- **Division values are messy and real:** `A`, `BB`, `AA (Monday COED 4's)`, `AA (Tuesday, ONLY AA)`
- **Payment vocabulary is mixed:** `Paid`, `Free`, `paid`, `checkout-started`, `Refunded`,
  `email-sent` — three of which already match Boomtown's registration statuses
- **Gender is recorded** — directly relevant to §3.7

**This confirms the column-mapping step is mandatory, not a nicety.** No fixed parser survives a
sheet with no headers, two blocks and free-text divisions. The import needs: paste or upload →
detect blocks → let the director map columns → preview with per-row problems flagged → confirm.

**Owner decision needed:** is the Colorado Boom roster elsewhere (another account, or not in Drive)?
Building the mapper against the wrong file shape wastes the exercise.

---

## 7. Decisions blocking the build

Nothing here is a blocker to *starting* slice 1. These block the later slices.

1. **§3.1** — more rounds with fewer games each, or fewer rounds with more teams waiting?
2. **§3.5** — what number is "too many games"? Games, points, or minutes?
3. **§3.7** — must M pairs meet all M pairs? Do partners rotate within gender only? Does a rotated
   pair keep its record?
4. **§6** — where is the Colorado Boom roster?

---

*Changelog: v1.0 (2026-08-03) — first scope of M-TF, league flexibility and the drag-and-drop
editor. Reframes eight requested features as one constraint solver, separates hard from soft
constraints, proposes eight shippable slices, and records the real roster shape found in Drive.*
