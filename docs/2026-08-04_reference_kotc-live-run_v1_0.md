# Boomtown Platform — King/Queen of the Court: a real run, and what it says about the build

**File:** `docs/2026-08-04_reference_kotc-live-run_v1_0.md` · **Version:** v1.0 · **Date:** 2026-08-04
**Status:** ACTIVE reference. **Supersedes:** nothing.
**Open it when:** building or changing anything KOTC/QOTC — movement, scoring, nets, the board.
**Source:** the owner's own scoresheet from the **men's Kings Club tournament just completed**, supplied
2026-08-04 with: *"some men did not continue on into the 3rd round due to absence, so we just moved
people around based on best scores and director discretion. As such, use this as reference of how we
run it."*

This is **DATA, not intent** — the trust order puts it above every spec sentence about how KOTC works
(standards §1; C12: when a document describes data, verify against the data). Where this file and the
spec disagree, **this file is what actually happened.**

---

## 1. Shape of the night

**24 players · 3 rounds · 6 nets of 4 · games to 21, cap 23.**

| Round | Name on the sheet | Nets |
|---|---|---|
| 1 | **Seeding Round** | Net 1 – Net 6, unlabelled |
| 2 | **Divisional Round** | Net 1 (AA) · Net 2 (AA) · Net 3 (A) · Net 4 (A) · Net 5 (BB) · Net 6 (BB) |
| 3 | *(unnamed)* | Net 1 (AA) Champ · Net 3 (A) Champ · Net 4 (A) Contender · Net 5 (BB) Champ · Net 6 (BB) Contender |

Round 3 has **20 players in 5 nets**, and the net numbers are **1, 3, 4, 5, 6 — there is no Net 2.**

## 2. Scores are recorded as DIFFERENTIALS, not as scorelines

The sheet's instruction to players is verbatim: **"Please write only differentials."**

Each player's row holds one signed number per game. A net's four numbers sum to zero, because the
differential is per *pair*:

> Net 1, Game 1 — Sean **+2**, Zach **+2**, David **−2**, Patrick **−2**
> ⇒ (Sean, Zach) beat (David, Patrick) by 2.

`Wins` counts positive games. `Diff` is the **sum of the differentials**, which is arithmetically
identical to the engine's `point_diff = points − conceded`. **The tiebreak on the sheet is wins, then
diff** — matching the recorded owner answer exactly.

**The pairing rotation matches the engine's, in a different order.** Seats 0–3:

| | sheet | `rotation(4)` in `kotc.js` |
|---|---|---|
| Game 1 | (0,1) v (2,3) | (0,1) v (2,3) |
| Game 2 | (1,2) v (0,3) | (0,2) v (1,3) |
| Game 3 | (0,2) v (1,3) | (0,3) v (1,2) |

Same three pairings, same property (each player partners each other exactly once). **Only the order
differs, and nothing depends on the order.** No change needed.

## 3. Movement is a RE-SEED INTO DIVISIONS, not a per-net promotion

This is the most important thing in the file, and it confirms the standing owner answer — *"`move_up`
is a director setting each session, no formula is encoded, do not add one"* — far more strongly than
the spec does.

Ranking all 24 after the seeding round by **(wins, then diff)** and cutting into fours reproduces the
Divisional Round almost exactly:

| Rank | Player | W / Diff | Landed |
|---|---|---|---|
| 1 | Jose lopez | 3 / +14 | **Net 1 (AA)** |
| 2 | Soren Kindem | 3 / +11 | **Net 1 (AA)** |
| 3 | Andy Lloyd | 2 / +20 | **Net 1 (AA)** |
| 4 | David Smith | 2 / +9 | **Net 1 (AA)** |
| 5 | Ryan Mortensen | 2 / +9 | Net 2 (AA) |
| 6 | John Killoran | 2 / +6 | Net 2 (AA) |
| 7 | Matt xi | 2 / +6 | Net 2 (AA) |
| 8= | **Sean Cavanagh** | 2 / +3 | **Net 2 (AA)** ← director's pick |
| 8= | **Natalie Kisley** | 2 / +3 | **Net 3 (A)** ← the other side of the same tie |

**Net 1 (AA) is exactly the top four. Net 2 (AA) is exactly the next four**, with one discretionary
tiebreak: Sean and Natalie were tied on wins *and* diff, and the director sent Sean up. The same thing
happens again at 2/+1 (Jesus and Zach tied; Zach went to Net 3, Jesus to Net 4).

**Below the A division, strict rank stops applying.** Nets 5 and 6 are both BB, and the split between
them is not by rank at all — Net 5 took three of the four 0-win players, Net 6 took one 0-win player
and the three 1-win players. Within one division, which net you are on does not mean anything, so the
director does not spend effort on it.

**The model, stated plainly:**

> rank everyone → cut into DIVISIONS (AA / A / BB) → within a division, distribute across that
> division's nets at the director's discretion.

That is **not** "the top `move_up` players on each net go up one net", which is what `nextRound`
implements. `nextRound` is therefore a **proposal**, not the process — the same status the owner
already gave bracket seeding (*"a starting point"*). **The v0.86.0 drag board is the real mechanism.**

## 4. Attrition and late arrival are normal, not edge cases

Between round 2 and round 3, **five of twenty-four players left**: David Smith, Soren Kindem, Matt xi,
Zach Ilg, Jesus. Two of them (David, Soren) were in the **top four**.

And one player, **Weston Phan, appears for the first time in round 3** — he is in no earlier round.

> 24 − 5 + 1 = 20 ✓

The owner's words for what happened next: *"we just moved people around based on best scores and
director discretion."*

**Both halves of this are already built, and this is the evidence they were worth building:**
· a late arrival can be dragged onto a net from the bench (v0.86.0)
· the person they replace lands on the bench, where they can be dragged back

**What is NOT built:** there is no way to take somebody **off for the night**. `kotc_players.withdrawn_at`
is read by the player link (409, *"You've been marked as finished for the night"*) and **never written**.
Five players needed exactly that in one tournament. This moves from a nice-to-have to the highest-value
KOTC gap.

## 5. Nets are NAMED, and their numbers are not contiguous

Round 3 runs on nets **1, 3, 4, 5, 6**. Net 2 is simply gone — the field shrank and the director dropped
a net without renumbering the rest.

Nets also carry **labels**: a division (`AA` / `A` / `BB`) and, in the final round, a bracket-ish role
(`Champ` / `Contender`). The board today shows *"Net 3"*; the director's sheet says *"Net 3 (A) Champ"*.

**Measured, not assumed** — `nextRound` was run against nets `[1, 3, 4]`:

```
ok: false — "Movement changed the nets from 4,4,4 to 3,3,4 — refusing to write a round that loses a player."
```

**It fails closed with a human sentence, which is correct** — nobody is silently lost. But it means
**auto-advance would have refused on this tournament's actual round 3.** Movement arithmetic uses
`net_no ± 1` (`kotc.js` ~L327), so a player promoted from net 3 is routed to a net 2 that does not
exist. The v0.86.0 board can produce this state today by emptying a net.

## 6. THE CONTRADICTION: "Cap 23" vs "no cap"

The sheet header reads **"Games to 21/Cap 23"**. Three places in the repo say the opposite:

| Where | What it says |
|---|---|
| handoff §4 (settled owner answer) | *"first to 21, **no cap**"* |
| `spec_kotc` §6 Q3 | *"First to 21, no cap, per session, director can change it"* |
| migration `0040` | *"**NO `cap` COLUMN** — 'no cap' was the choice, and a nullable cap column would invite a default that quietly reinstated one"* |

**This is not a documentation fix. A cap changes the solver's mathematics.** `solveNet`'s closed form
rests on a shape rule stated in its own header:

> *"A game played first-to-21 with no cap can only end two ways: 21 to something 19 or less, or n to
> n−2 for n above 21. So a game is not two free numbers — it is ONE unknown, its total, plus which side
> won."*

**With a cap of 23 there is a third ending: 23–22, a one-point margin.** The shape rule forbids
one-point margins, so a capped game either gets rejected or mis-solved. The solver is the feature that
lets a player type one number and have the net derived; it is not a detail.

**Cost if the cap is real:** migration `0043` adding a nullable `points_cap` to `kotc_sessions`, plus a
third case in `solveNet`'s shape rule and its 4000-round randomised verification re-run. **Owner
decision required — recorded in handoff §5, not guessed at here.**

## 7. What this changes, in order of value

| # | Finding | Status |
|---|---|---|
| 1 | **Withdraw a player for the night.** 5 of 24 needed it in one night. `withdrawn_at` is read, never written. | **Not built.** Small route + a board control. |
| 2 | **Cap 23 vs no cap.** Changes `solveNet`'s core inference, needs a migration. | **Owner decision.** |
| 3 | **Net labels** (`AA` / `A` / `BB`, `Champ` / `Contender`). The director's own sheet names them; the board shows a bare number. | Needs a migration. **Owner decision.** |
| 4 | **Auto-advance refuses on non-contiguous nets.** Fails closed correctly, but their real round 3 would hit it. | Real. Fix is to rank-and-redistribute over the nets that EXIST rather than `net_no ± 1`. |
| 5 | **Differential entry.** Players write differentials; the screen asks for scorelines or a personal total. A third input shape. | Possible addition, not a defect. |
| 6 | Pairing rotation order differs from the engine's. | **No change needed** — same pairings, order is not load-bearing. |
| 7 | Wins-then-diff tiebreak, and diff as a sum of differentials. | **Already correct.** |
| 8 | Late arrival / bench / swap. | **Already built (v0.86.0)** — and now evidenced. |

## 8. QOTC (women's)

The owner supplied this as reference for the women's **Queens** run. **Nothing in the format is
sex-specific** — the sheet is titled "Kings Club Tournament Rotation" and everything above is about
counts, ranking and discretion. Treat QOTC as the same engine with a different session name; do **not**
add a gendered field or a second code path. `kotc_sessions.name` already carries whatever the night is
called.

---

*Changelog: v1.0 (2026-08-04) — created from the owner's completed men's Kings Club scoresheet. Records
the three-round structure, differential-only recording, and the rank→division→discretion movement model
with the arithmetic checked against the sheet (Net 1 (AA) is exactly the top four; Net 2 (AA) exactly
the next four, with one tie broken by the director). Flags the "Cap 23" contradiction against three
places in the repo that say "no cap", including a deliberate schema omission, and records that the
solver's closed form depends on the no-cap shape rule. Records that `nextRound` refuses on
non-contiguous nets — measured, not assumed — which their real round 3 would have hit.*
