# LOOP.md — Ralph loop ledger (btplatform)

Append-only. One entry per iteration, newest at the bottom. `RALPH.md` is the instruction set;
this file is the memory. An iteration reads the last three entries and nothing more.

---

## 2026-08-04T22:30-06:00 — iteration 1
outcome   : NO-BUMP (docs-only, pushed)
unit      : §6.1 — README Modules table brought current through v0.86.0 and roadmap §0 fully recounted, both walked from the git log.
commit    : 959aebc (this ledger's own sha recorded in the follow-up commit)
measured  : suite 1238/1238 · files 73 · modules 50 · busters 390/62 files (one value, 0.86.0) · ledger 0042 (42 files)
docs read : README.md · docs/2026-08-02_roadmap_v1_0.md · docs/INDEX.md (roadmap + README status rows only)
learned   : **The handoff was wrong about the size of its own mechanical item.** §6.1 said the README Modules table "stops at v0.64.0 … twenty releases"; the table's newest row was actually **v0.53.1**, making the real gap **thirty-three** releases (v0.54.0–v0.86.0). Grepping the claim is not enough — the claim was *about a document*, so it had to be read. Second finding: roadmap §0's v0.57.0 bucket table did not sum to its own stated total (buckets 19, total 17) because §5's carried non-code items were folded in; the recount excludes them and now adds. The recounted total is **also 17** — coincidence, and the banner in §0 says so explicitly so the next reader does not assume a copy-forward. Third: release commit subjects use **three** conventions — `feat(v0.54.0): …` for v0.54–v0.64, `v0.65.0 — …` for v0.65–v0.85, `feat: v0.86.0 — …` for v0.86. A single grep pattern silently misses eleven releases.
next      : §6.2 — withdraw a player for the night. One route + a board control, no migration. **Scope the `withdrawn_at` grep to `worker/src/kotcplay.js`** — repo-wide it returns a real write at `worker/src/lfg.js:396` against the *`lfg_members`* table, which is a different feature.

**Iteration-1 note on D3 (dirty tree).** The tree was dirty at start: `RALPH.md` untracked and
`.gitignore` modified. Judged human pre-loop setup, not a dead iteration — RALPH.md is dated today,
declares itself v2.0 superseding the pasted v1 prompt, the `.gitignore` edit cites `RALPH.md`'s own
D3 rule, and no `LOOP.md` existed, so no prior iteration had ever run. Both were committed with this
iteration's work. **A dirty tree from here on has no such excuse and should halt.**

## 2026-08-04T22:40-06:00 — iteration 2
outcome   : SHIPPED v0.87.0
commit    : 0b7e46c
unit      : §6.2 — withdraw a player for the night. `POST /api/admin/kotc/:id/withdraw` (both directions) + the Off / Back in controls and a "Finished for the night" section on the board.
measured  : suite 1258/1258 · files 74 · modules 50 · busters 390/62 files (one value, 0.87.0) · ledger 0042 (42 files)
docs read : docs/2026-08-04_reference_kotc-live-run_v1_0.md (mandatory for KOTC work) · skills /emil-design-eng + frontend-design
learned   : **Completing a half-built feature exposes the reads that were written for a state nobody could reach.** Two pre-existing defects fell out of it, neither in the code I set out to write. (1) The player link answered a withdrawn player *"You're not on a net for this round. Find whoever is running the night"* — the 409 from migration 0042 sat BELOW the seat check and INSIDE the POST branch, so it was unreachable in exactly the state it was written for. Freeing the seat is what surfaced it. (2) A net left at three made the next round a **500 that half-wrote a round**: `gamesForRound` calls `rotation()`, which throws for any size but 4/5, and the round row plus every slot is inserted BEFORE that call. The drag could already reach this. Fixed as a refusal with a human sentence — **not** redistribution, which is §6.3. Second lesson: the handoff said "six read sites", it is **seven** — small, but it was wrong in the direction of under-counting the surface. Third: when a route re-seats people, the "finished game is never rewritten" rule must be ONE function — I extracted `repairUnplayed` and the existing 19 board tests (invariant + its negative control) proved the refactor before I built on it, which is the cheapest possible way to do that.
deploy    : CONFIRMED — preflight `deployed` PASS, `/api/health` v0.87.0, Pages serving the new control at buster 0.87.0. **The health check flapped for ~2 minutes** (7 of 8 samples new, then 12 of 12) while the worker rolled across edge locations. One fetch is not a deploy confirmation; sample until it converges.
design    : **Open finding, carried deliberately, NOT suppressed.** The impeccable hook flags `flat-type-hierarchy` on `web/admin-kotc.html`: seven declared font steps (`.78 / .8 / .82 / .85 / .9 / .92 / 1.02rem`) spanning only **1.31×**. Two parts. (a) **Mine and wrong:** I gave `.kb-off`/`.kb-back` `.78rem` when `.8rem` already existed for de-emphasised small text — a seventh step 0.02rem below an existing one. Collapse it to `.8rem`. (b) **Pre-existing:** the page's whole scale is flat. Defensible for a dense board where hierarchy is weight/colour/containment, but seven near-identical steps is not, and v0.85.0 already treated this as real on `kotc.html` ("the RENDERED set, not the declared one"). Deferred rather than fixed because any `web/**` edit needs a version bump + buster sweep, and cutting a second release in one iteration for a 0.32px change is disproportionate — the budget fires on one verified release. **Do (a) at the start of the next iteration**, which cuts a release anyway; (b) is its own design unit. Added to handoff §6.
next      : §6.3 — redistribute when a net empties. Rank and redistribute over the nets that EXIST rather than `net_no ± 1`; retire a dropped net's number rather than renumbering. **The new refusal in the round route is the thing to replace** (`worker/src/kotcplay.js`, search "EVERY NET MUST BE A SIZE THE ENGINE CAN PAIR") — its negative control already proves the success path, so that test is the harness for the redistribution work. Movement is rank → divisions → discretion; `nextRound` is a PROPOSAL. **Do not encode a formula.**
