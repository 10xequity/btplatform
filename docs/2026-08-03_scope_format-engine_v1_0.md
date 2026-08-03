# Boomtown Platform — Scope: Tournament format engine, league flexibility, drag-and-drop

**File:** `docs/2026-08-03_scope_format-engine_v1_0.md` · **Version:** v1.1 · **Date:** 2026-08-03
**Status:** SCOPE — not a decision. Nothing here is built.
**v1.1:** owner answered three of the four decisions on 2026-08-03, and their real 10-team pool
sheet was located in Drive and **analysed computationally** (§8). That analysis replaces guesswork
about what "fair" means with a measured target the generator must reproduce.
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

1. ~~**§3.1**~~ **ANSWERED 2026-08-03** — more waiting, less switching. See §8.6.
2. **§3.5** — what number is "too many games"? Games, points, or minutes?
3. **§3.7** — must M pairs meet all M pairs? Do partners rotate within gender only? Does a rotated
   pair keep its record?
4. **§6 — STILL OPEN.** The linked Colorado Boom sheet is not reachable by the Drive connector, and
   no roster is visible in `tt@coloradoboom.com`. Share it with the connected account or export a CSV.

---

---

## 8. THE FAIRNESS TARGET, DERIVED FROM THE OWNER'S OWN SHEET (v1.1, 2026-08-03)

The owner said: *"my 10 on 4 pool sheet is an example of modified pool play to ensure equality
overall. i need that for other variations but have not been able to design it as fairly."*

That sheet was located in Drive (**"Pool Sheet Library"**, `boomtownvball@gmail.com`), transcribed,
and **analysed computationally**. This section replaces every guess about what "fair" means with a
measured target the generator must reproduce. It is the most important section in this document.

### 8.1 The schedule, as built by hand

10 teams · 4 courts · 10 rounds · 2 teams idle per round.

| | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 |
|---|---|---|---|---|---|---|---|---|---|---|
| **Court 1** | 1v2 | 8v10 | 5v8 | 4v10 | 2v4 | 2v3 | 5v7 | 1v3 | 6v9 | 3v8 |
| **Court 2** | 3v4 | 4v7 | 7v9 | 3v9 | 3v5 | 4v5 | 6v8 | 2v5 | 3v10 | 2v9 |
| **Court 3** | 5v6 | 5v9 | 2v10 | 1v8 | 6v10 | 6v7 | 4v9 | 4v6 | 1v7 | 1v4 |
| **Court 4** | 7v8 | 3v6 | 1v6 | 2v7 | 1v9 | 8v9 | 1v10 | 7v10 | 2v8 | 5v10 |
| **Bye** | 9,10 | 1,2 | 3,4 | 5,6 | 7,8 | 10,1 | 2,3 | 8,9 | 4,5 | 6,7 |

### 8.2 What the analysis found

| Property | Measured | Verdict |
|---|---|---|
| Games per team | **8, every team** | Perfectly equal |
| Byes per team | **2, every team** | Perfectly equal |
| Opponent pairs met | **40 of 45 possible** | |
| **Repeated opponents** | **ZERO** | Nobody plays anybody twice |
| Bye gap (rounds between a team's two byes) | **min 3, max 7** | Nobody sits twice in a row |
| Teams per round | 10 distinct, sum 55 | The sheet's own **Check row** |

**This is a very good schedule.** Perfectly equal games, perfectly equal byes, and zero rematches
across 40 pairings. The generator's job is not to improve on it — it is to **reproduce these
properties for any N and C**.

### 8.3 The invariant the owner built, and why it is the key to generalising

The **Check = 55** row is the whole trick, and it is worth naming because it generalises where the
rest of the sheet does not.

Every round, the team numbers on court plus the team numbers on bye sum to `1+2+…+N`. That is a
compact way of asserting **every team appears exactly once per round, playing or waiting** — no
team double-booked, none forgotten. It is a checksum a director can verify by eye in two seconds.

**The generator should emit this same check row**, for exactly the reason the owner uses it: a
schedule you cannot eyeball is a schedule you do not trust, and a director who does not trust the
generator keeps using the spreadsheet.

### 8.4 The structure underneath

The bye sequence is the schedule's skeleton:

```
R1: 9,10   R2: 1,2   R3: 3,4   R4: 5,6   R5: 7,8      ← every team rests once, rounds 1-5
R6: 10,1   R7: 2,3   R8: 8,9   R9: 4,5   R10: 6,7     ← every team rests again, rounds 6-10
```

Two complete passes over all 10 teams, five rounds each, the second offset from the first. That is
what produces exactly 2 byes each with a comfortable gap — and it generalises directly:

> With **N teams** and **C courts**, `W = N − 2C` teams wait each round. Over `R` rounds there are
> `R × W` bye slots. When `R × W` is a multiple of `N`, **every team can take exactly `R×W/N` byes**,
> and you get them by walking a rotating pointer around the team list in blocks of `W`.

For 10 teams, 4 courts: W = 2, R = 10 → 20 bye slots ÷ 10 teams = **exactly 2 each**. The owner's
sheet is the clean case, which is why it came out perfect.

**When it does not divide evenly, the generator must say so rather than fudge it** — "13 teams on 4
courts over 10 rounds: 50 bye slots, so 11 teams get 4 byes and 2 get 3" is information a director
can act on. Silently giving one team an extra game is how a tournament ends in an argument.

### 8.5 A real discrepancy worth knowing about

The owner's stated target is **8–10 games and 210–250 points** in 3–4 hours of pool play.
The 10-on-4 sheet delivers **8 games at 21 points = ~168 points**. That is **below the stated
points range**, at the bottom of the stated game range.

To hit both targets simultaneously:

| Games | To | Points | Verdict |
|---|---|---|---|
| 8 | 21 | 168 | current sheet — under target |
| 8 | 25 | 200 | still under |
| **10** | **21** | **210** | in range, bottom |
| **10** | **25** | **250** | in range, top |

**So the target is 10 games, not 8** — which for 10 teams on 4 courts means running **12–13 rounds**
rather than 10, or adding a court. At ~22 minutes a round, 13 rounds is ~4.8 hours, which then
exceeds the 3–4 hour window. **The three targets — 8–10 games, 210–250 points, 3–4 hours — cannot
all hold at once for 10 teams on 4 courts.** Something gives: more courts, shorter games, or a
narrower target.

This is exactly the kind of thing the **constraint report** (slice 2) exists to surface *before* the
day, rather than at hour four with everybody still playing.

### 8.6 Owner answers, 2026-08-03 — three of four decisions closed

**§3.1 — more rounds or more waiting? ANSWERED: more waiting.**
> *"idealy, all teams should have equal played games, so the aim is less switching and more teams
> waiting but spreading the wait out to effectively ensure they are not waiting too long."*

This is now a **hard ordering of objectives**, not a preference:
1. **Equal games per team** — hard. Refuse a schedule that gives one team more games than another
   when equality is arithmetically possible.
2. **Spread the waiting** — maximise the minimum gap between a team's byes; never two in a row.
3. **Minimise switching** — prefer a larger waiting set over more rounds.

Note that 2 and 3 pull against each other, and the owner named both. The resolution: **minimise the
number of rounds subject to equal games, then maximise the minimum bye gap within that round count.**
That ordering reproduces the 10-on-4 sheet exactly.

**§3.5 — what is "too many"? ANSWERED: 8–10 games, 210–250 points, 3–4 hours.**
Now a scored objective with real numbers, plus the §8.5 warning when they conflict.

**§3.7 — rotating pairs. ANSWERED, and descoped.**
> *"that format is only for valentines speed dating when it is not co-ed rotating pairs, that is a
> specialized format that i have not been able to solve."*

Two distinct things, and separating them removes the hardest item from the critical path:
- **Valentine's speed-dating format** — a one-off social event, once a year. Its constraint
  ("every F pair meets every M pair") is real but the event is not load-bearing.
- **Co-ed rotating pairs** — acknowledged as unsolved *by the owner*. Not a spec waiting to be
  implemented; an open design problem.

**Recommendation: descope both from M-TF.** They are one narrow annual event and one unsolved
problem, and neither blocks running normal tournaments. Revisit rotating pairs as its own exercise
once the general solver exists — the constraint machinery built for slices 1–2 is most of what a
solution would need anyway.

**§6 — the roster.** The linked Colorado Boom sheet is **not reachable** by the Drive connector
(`Requested entity was not found`), and no roster is visible in `tt@coloradoboom.com`. Sharing it
with the connected account, or exporting a CSV, unblocks the import mapper. Still open.

### 8.7 What this changes in the build plan

Slices 1 and 2 from §4 stand, with sharper acceptance criteria:

**Slice 1 — the generator** must reproduce the owner's 10-on-4 sheet's *properties* (not
necessarily the identical pairings): equal games, equal byes, zero repeats where arithmetically
possible, no back-to-back byes, and the Check-row invariant. **The existing six templates plus this
sheet become the regression suite** — a generator that cannot match a schedule a human built by hand
is not ready.

**Slice 2 — the constraint report** must state, before the event: games per team, points per team,
estimated duration, bye distribution with the exact arithmetic, repeat pairings if any, and **a
warning when the games / points / hours targets cannot all be met** (§8.5).

**Descoped from M-TF:** rotating pairs and Valentine's speed dating (§8.6). **Still in:** arbitrary
N-on-C, pools by division, waiting-team refs, multi-day, drag-and-drop editor, threes-combining.

---

*Changelog: v1.1 (2026-08-03) — owner answered three of four decisions; located and COMPUTATIONALLY ANALYSED their real 10-team pool sheet (§8): 8 games each, 2 byes each, ZERO repeat opponents, no back-to-back byes. Derived the generalising rule from their Check=55 invariant, found that their 8-10 games / 210-250 pts / 3-4 hrs targets cannot all hold at once for 10 teams on 4 courts, and descoped rotating pairs + Valentine speed dating from M-TF on the owner’s statement that one is a once-a-year social and the other is unsolved. v1.0 (2026-08-03) — first scope of M-TF, league flexibility and the drag-and-drop
editor. Reframes eight requested features as one constraint solver, separates hard from soft
constraints, proposes eight shippable slices, and records the real roster shape found in Drive.*
