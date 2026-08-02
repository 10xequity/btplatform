# CHANGELOG paste block — v0.45.0
**File:** 2026-08-01_CHANGELOG-block_v0_45_0.md · **Version:** v1.0 · **Date:** 2026-08-01
Paste at the top of `CHANGELOG.md`, replacing the CI v0.45.0 stub when it appears. This file
never goes in the repo.

---

## v0.45.0 — 2026-08-01 (LFG & Community Play — rebuilt against v0.44.0)

**Lineage note:** the first v0.45.0 build (same day) was cut against v0.43.0 and its ZIP was
never uploaded; the retired v0.44.0 ZIP was. This release is the same LFG scope rebuilt as the
linear successor to actual HEAD v0.44.0. Migration 0031 was already applied to live D1 by the
first build — its file ships here, reconstructed byte-faithful from the live schema, idempotent.

- **Worker:** `lfg.js` v1.0 NEW — two-way community board (owner spec 2026-08-01):
  `team_need` (any member posts; the team shell forms immediately), `player_avail`, and
  free-form `casual` games (no facility link — park, another gym, anywhere).
  Member routes: list/post listings · join (returns the "on N team(s)" heads-up) ·
  withdraw (inside `BAIL_WINDOW_HOURS = 12` of game time counts as a bail — one edit to 24) ·
  close · report-no-show (poster only, only after game time, only for committed players).
  Escalation: first reported no-show → yellow ⚠ caution for 14 days → second → 30-day LFG ban
  + red ⚠ wherever the person appears in groups → auto-unban by time, strikes consumed.
  Reliability is showed/bailed **counts, never a rating**. 18+ fail-closed on the shared
  `family.js isMinor` (unknown birthdate = blocked). In-app messaging only (messages.js relay).
  Flood guard `OPEN_LISTINGS_MAX = 5`. Staff: strikes/bans view + early unban.
  In-app notification to the member on strike and on ban.
- **Worker:** `index.js` — wire + dispatch + version v0.45.0 (4 hunks, byte-verified).
- **DB:** migration `0031` file lands (APPLIED 2026-08-01; ledger row exists; file is a no-op
  re-run). `schema_gate.test.mjs` v1.6 — ratchet 30 → 31 in the same package.
- **Web:** `lfg.html` + `assets/lfg.js` v1.0 NEW — board with kind tabs, inline post form,
  reliability strip, roster caution marks, bail-window confirm, relay compose.
  `home.html` v1.5.0 / `home.js` v1.4.0 — Community-play opportunities card, per-category
  toggles ON by default (`localStorage bt_lfg_prefs`). `site-nav.js` v2.8 — Explore link.
  Buster sweep: 43 pages → `?v=0.45.0`.
- **Tests:** 520 → **537/537** (17 new). The LFG org-scope guard is anchored per
  `env.DB.prepare(` call with a miss counter — the first draft read whole-file strings and an
  apostrophe in a comment blinded it to 22 of 33 queries (failure class 3, caught by its own
  count assertion). Negative controls prove the scan fails both ways; prove-it-fails ran on
  the org-scope guard and the §6.5 mount guard, red on mutation, green on byte-identical
  restore.
