# QC Schedule Generator vs. the platform League Manager — comparison & integration assessment

**File:** 2026-08-26_reference_qc-league-format_v1_0.md · **Version:** v1.1 · **Date:** 2026-08-26
**Status:** Active reference · **Supersedes:** v1.0 (same day)
**v1.1 (2026-08-26): the format is now INTEGRATED (v0.206.0).** The wins-ranked pods-of-4 pairing
ships as a second `pairingMode` ("wins-pods") on the League Manager — recommendation 1 below, built.
Added the ease-of-use comparison the owner asked for (§ "Ease of use"). Recommendations 3–4 (the
league-linked playoff; not porting the QC plumbing) still stand as described.
**Why this exists:** the owner runs a standalone React app (`qc-schedule-generator_v5.jsx`, "QC Schedule
Generator", Queens Club preseason) as an alternative league format and asked (2026-08-26) how it
compares to the platform's League Manager, whether it is more valuable, and whether it can be integrated.
Measured against the shipped code: `worker/src/leagues_admin.js` (pairing), `worker/src/scheduler.js`
(round-robin engine), `worker/src/divisions.js` (division planner), and the QC file itself.

---

## The one-line answer

The QC format is **not "better" — it is a different, valid competitive structure**, and it carries **two
ideas the League Manager does not have today** that are worth adopting: (1) a **wins-ranked
pods-of-4** weekly format, and (2) a **pools→divisions playoff** built into the season. Everything
*else* the QC app does — score entry, print, email, saving data — the platform already does **better**,
natively. So the value is in the **format**, not the app: adopt the two algorithms, keep our plumbing.

---

## Side-by-side

| Aspect | Platform League Manager (ours) | QC Schedule Generator (the app) |
|---|---|---|
| **Ranking basis** | Operator-assigned skill **level** (`level_num` 1–9); standings track W / L / **point differential** / rank | **Wins only** — a pure ladder re-sorted by wins each week; ties optionally shuffled (seeded RNG) |
| **Weekly pairing** | Greedy pairing with a **hard level-gap cap of 2** (never pair teams >2 levels apart); fewest prior meetings preferred; byes rotate by games played | Cut the wins-ranked ladder into **rank-adjacent pods of 4** (or 6); **full round-robin inside each pod** → every team plays **3 distinct opponents that night, no repeats** |
| **Fresh-opponent guarantee** | None — greedy pairing can produce a rematch or a bye | **Yes** within a pod (full RR); no byes when the count divides by 4 |
| **Rotations per night** | 1–3 rotations × 1–2 games, re-pairs everyone, prefers fresh opponents (RF-2 Unit B) | Fixed: the 3-round pod round-robin |
| **Scoring** | **Point differential**, 2-tap (winner + margin); forfeit is a flag | **Wins only** (games-won count entered per team) |
| **Playoff / finals** | **Not in the league module.** The pieces exist on the *tournament* side (see below) but aren't wired into a league season | **Built in:** Wk 6 snake-seeded pools of 6 → divisions of 8 by pool finish; Wk 7 division RR; Wk 8 R6–7 + best-of-3 final. Option B seeds divisions from season standings instead |
| **Score entry** | **Native** — captain link (`score.html?t=token`), live board, member score-entry, admin desk | **External** — a printed **QR to a Google Form**; scores live in Google, not the app |
| **Persistence** | **Live D1**, multi-org, multi-device, standings auto-refresh | **Device-local** (`localStorage` / Claude artifact storage) — one browser, one person |
| **Facility** | Auto-claims the night's courts on the facility calendar; releases on delete | None |
| **Print / email** | Native print CSS; **keyless-honest** email to captains | Print matrix (Excel-style, one page/night) + `mailto:` to captains |
| **Members / registration** | Teams, rosters, waivers, passes, payments all tied in | Team list typed/pasted in; no registration, roster, or payment tie-in |

## What the platform ALREADY has that maps to the QC finals

The QC "pools → divisions → division RR → best-of-3 final" playoff is **conceptually already built on
the tournament side** and would be reused, not rewritten:
- `scheduler.js` — a circle-method **partial round-robin** engine (pools, byes balanced ±1, ref rotation).
- `divisions.js` — a real **division planner** encoding the owner's own rules (top division holds at 8,
  misplacement measured against the division **median**, mini-brackets when necessary).
- This is exactly the **"tournament inside a league"** shape the owner already settled in §-1d **N-4a**
  (2026-08-08): a league-linked tournament that draws the league's teams. The QC app is live evidence
  that this linkage is wanted.

## Ease of use — the QC app vs. ours (owner ask, 2026-08-26)

| Task | QC app | Platform (with wins-pods, v0.206.0) |
|---|---|---|
| **Set up teams** | Type/paste a list into the browser (device-local) | Teams arrive from registrations, or are added/renamed in place (double-click a name, v0.206.0) |
| **Generate a night** | One click → pods | One click → pick "Wins pods" in the Format select, Generate |
| **Enter scores** | Print a QR, players open a Google Form, you copy results back | Captain link / live board / desk — no round-trip; standings update themselves |
| **See standings** | Re-open the app on the same device | Live, multi-device, on the board and the member site |
| **Book courts** | Separate/manual | Auto-claimed on the facility calendar |
| **Share the schedule** | mailto / print | Keyless email to captains + print, from the same page |

**Read:** the QC app is *marginally* simpler for the one narrow task of "make a pod schedule on my
laptop," because it does nothing else and holds no accounts. The platform asks you to pick a league
first and think in registrations — but every step *after* generating (scoring, standings, courts,
sharing) is materially less work because it is integrated, not re-keyed through Google. For a
one-off preseason on a single laptop the QC app is fine; for anything that touches money, members,
or more than one device, the platform is easier once the season is running.

## Assessment — is it valuable? better?

- **Not better as an application.** Its scoring (Google Form + QR), saving (one device), and lack of
  facility/registration/membership ties are all things the platform already does better natively. If
  the owner ran the QC season *on the platform today* using the level-capped pairing, he'd gain live
  scoring, the live board, court booking, and captain links for free — and lose the Google-Sheets round-trip.
- **Valuable as a format.** Two genuinely missing capabilities:
  1. **Wins-ranked pods-of-4 pairing** — a cleaner "play the teams near your rank, full round-robin, no
     byes" ladder than our level-capped greedy pairing. Different competitive feel; some leagues want it.
  2. **A league-season playoff** (pools → divisions → final) — the N-4a "tournament inside a league".

## Integration recommendation (for the owner to schedule, not built here)

1. ✅ **DONE v0.206.0 — the pairing MODE shipped.** `leagues_admin.js` now takes a `pairingMode`:
   `level-capped` (default) or `wins-pods` (rank by wins, rank-adjacent pods of 4 / a 6 for the
   remainder, partial RR giving every team 3 fresh opponents/night, no level cap). Exported
   `podSizes`/`pairWinsPods`, unit-tested; generateWeek branches as an early return so the
   level-capped path is byte-identical; a "Format" select ships on the League toolbar. No schema
   change (it reads the standings/wins that already exist), exactly as estimated.
2. **Wins-only standings option.** Our standings rank by point differential; the QC ladder ranks by wins.
   A per-league `rankBy: 'wins' | 'diff'` toggle covers it — small, no schema change.
3. **The playoff is the N-4a "tournament inside a league" build**, using `scheduler.js` + `divisions.js`.
   Larger; it is its own program and belongs on the roadmap as the Shape-A tournament work, which the
   owner already scoped.
4. **Do NOT port** the QC app's Google Form, QR, localStorage, or mailto — the platform's native score
   entry, live board, D1 persistence, and keyless email already supersede every one of them.

**Net:** keep the QC generator as-is for this preseason if it works for him; when he wants it on the
platform, the lift is a pairing mode + a wins-ranking toggle (small) plus the already-scoped
league-linked tournament for the playoff (larger). Recorded as roadmap **Q6 rider / RF-format**.
