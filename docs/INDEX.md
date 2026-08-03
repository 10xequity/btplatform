# Boomtown Platform — Document Index

**File:** docs/INDEX.md · **Version:** v1.1 · **Created:** 2026-08-02 · **Updated:** 2026-08-02
**Status:** ACTIVE · **Supersedes:** nothing — first index of the doc set.
**Purpose:** what each document is, whether it is live, and where the live documents disagree
with each other. Read with `CLAUDE.md`.

---

## 1. Live working set — read every session

| File | Ver | Date | What it is |
|---|---|---|---|
| `2026-08-02_handoff_v0_56_0.md` | v1.0 | 2026-08-02 | **State of record.** Delivery (§0), measured build state (§1), what shipped v0.54–v0.56 (§2), **§3 the five green-but-broken checks found in one session**, owner answers (§4), owed items (§5), next build (§6), next-session prompt (§7). Supersedes and replaces handoff v0.53.0. |
| `2026-07-30_standards_v2_0.md` | **v2.1** | 2026-08-02 | **Build and design law.** Trust order, versioning, DB rules, worker module pattern, design roster (§5), testing gates (§6), CI, member copy (§8), templating (§10). Reconstructed after a doc-set loss; §5/§6.5/§8/§10 anchors preserved so in-code citations stay valid. |
| `2026-08-02_roadmap_v1_0.md` | v1.0 | 2026-08-02 | **Roadmap of record.** 8 unbuilt modules, 5 small gaps, 4 engineering tracks, 5 owner-gated config items, 4 doc-debt items, suggested sequence. Supersedes the README roadmap block and the stale half of `build-status.js`. |
| `INDEX.md` | v1.1 | 2026-08-02 | This file. |

## 2. Live reference — open when the topic comes up

| File | Ver | Date | Open it when |
|---|---|---|---|
| `2026-08-01_decisions_org-roster_v1_1.md` | v1.1 | 2026-08-01 | Touching orgs, payments binding, or org deletes. Holds the keep-set (BTA/MPS/Queens/COBO), D-ORG-5..8, and the live-D1 scan that narrowed the delete set to orgs 6–9. |
| `2026-08-01_requirements_lfg-membership_v1_0.md` | v1.0 | 2026-08-01 | Touching LFG, membership custom fields, or the opportunities feed. **See contradiction C2 below — §4 is out of date.** |
| `2026-08-01_uiux-review_admin-shell_v1_0.md` | **v1.1** | 2026-08-02 | Touching any shell, rail, header, or contrast. Names the real AA offenders by file and line. Steps 1–3 of §6 shipped; **step 4 (SPA shell) is the last open item.** |
| `2026-08-03_scope_format-engine_v1_0.md` | v1.0 | 2026-08-03 | Scoping M-TF, league flexibility or the drag-and-drop editor. Reframes the eight requested features as ONE constraint solver, splits hard from soft constraints, proposes 8 shippable slices, and records the real roster shape found in Drive. Four owner decisions listed at the end. |
| `2026-08-01_demo_admin-shell_v4_0.html` | v4.0 | 2026-08-01 | Working the SPA shell. Open it in a browser and toggle the theme — it is the target model, not a mockup to copy verbatim. |

## 3. Archive — never read during a normal build

| File | Ver | Date | Open it only to answer |
|---|---|---|---|
| `archive/2026-07-26_library_v1_0.md` | v1.0 | 2026-07-26 | "What were the owner's exact words on X" (§1, all 24 requirements verbatim) · "Why was decision D-… made" (§4, full decision log) · "Has this defect happened before" (§2, closed-finding register + the four recurring failure classes) · "What are we benchmarking against" (§5). |
| `archive/2026-07-26_waiver-text-v2_candidate_v2_2_restored.md` | v2.2 | 2026-07-26 | Seed data only. **Not published, and the database does not contain it.** The waiver system is CLOSED to further work (owner 2026-07-26). Reconstructed from transcripts — word-for-word fidelity is not guaranteed, and §6/§7 carry real legal exposure. Do not treat as a specification. |
| `archive/2026-08-01_CHANGELOG-block_v0_45_0.md` | v1.0 | 2026-08-01 | **Superseded.** Handoff §7 directs deletion — this content now lives inside the reconstructed repo `CHANGELOG.md`. Retained only until the v0.45.0 LFG detail is confirmed against it, then delete. |

---

## 4. Contradiction register — live documents that disagree

These are instances of **failure class 2**: a decision recorded is not a decision in force until
every restatement changes. Fix them in the next release; until then, the ruling below governs.

**C1 — CHANGELOG / ZIP delivery. ~~OPEN~~ RESOLVED 2026-08-02, all restatements struck.**
The dispute was whether `CHANGELOG.md` belonged in the release ZIP. It was overtaken: the owner
authorized **direct commit**, retiring the ZIP itself, so every position in the argument is moot.
**Ruling: `CLAUDE.md` §2 governs — preflight CLEAR → commit → push, and CI owns `CHANGELOG.md`
through `changelog-entry.mjs`. Never hand-write it.**
*Fixed in the same release, not deferred:* standards §9 (→ v2.1) and uiux-review §6 (→ v1.1) both
struck and now point at `CLAUDE.md` §2; handoff §0 marked superseded with its reasoning preserved
as history. This register entry is retained as the audit trail — the four-document sweep is what
failure class 2 actually requires.

**C2 — Requirements §4 reads "awaiting owner answers." It is not.**
All seven questions were answered 2026-08-01 and built into LFG v0.45.0: any member posts · casual
is free-form · 12-hour bail window · the poster reports the no-show · in-app messaging only · 18+ ·
the team shell forms immediately. The document was never re-versioned. Handoff §5's "LFG deep
behavior gated on requirements §4" therefore reads as a live blocker when it is not.
**Ruling: treat §4 as answered.** *Fix: requirements v1.1 recording the answers; owner to confirm
the handoff §5 blocker can be struck.*

**C3 — Handoff §6 cites "requirements §15," which does not exist.**
That document ends at §4. The intended reference is almost certainly requirements **§3** — spec
work for existing modules benchmarked against LeagueApps / TeamSnap / SportsEngine, then an owner
interview. *Fix: correct the citation in the next handoff.*

**C4 — `build-status.js` was stale and wrong. ~~OPEN~~ RESOLVED v0.55.0 / v0.56.0.**
It told testers the check-in waiver gate is live; that gate was removed in v0.33.1 (D-MIN-8, owner:
"no gating"). This register recorded **one** instance — there were **two**, so the audit was itself
narrower than its subject, the very failure class it was auditing for. Also fixed: 16 of 45 pages
had no entry, four shipped features still read "soon", the `.ics` row denied a button that had
existed for three releases, and the note claiming one-click mute was unbuilt (M16 shipped it).
**Ruling: closed.** `build_status.test.mjs` now ratchets page coverage plus the two specific
copy-vs-code claims. Prose could not hold a registry current; a guard can.

**C5 — README §Roadmap was stale. ~~OPEN~~ RESOLVED v0.55.0.** It is now a pointer to
`docs/2026-08-02_roadmap_v1_0.md`, deliberately — the inline queue had gone stale three times and
still listed the v0.51.0/v0.52.0 work as upcoming.

**C6 — the buster guard cannot tell a needed sweep from an unneeded one. OPEN.**
`asset_versions.test.mjs` asserts the cache-buster is **one** value, not the **current** one.
v0.55.0 therefore changed `build-status.js` with no sweep and stayed green — a cached browser would
have kept serving the wrong tester copy, so that release's fix would not have reached anyone. Swept
in v0.56.0. **Ruling: sweep the buster in any release touching `web/**`.** *Fix: a preflight check
that blocks when the diff touches `web/**` and no buster value moved with it (handoff §6).*

---

## 5. Consolidation log

| Date | Action |
|---|---|
| 2026-07-26 | Eleven-document set collapsed to four tiers (context / roadmap / standards / library). Superseded list recorded in `archive/library` §3. |
| 2026-07-30 | `standards` recreated as v2.0 after the doc-set loss; §5/§6.5/§8/§10 anchors preserved. |
| 2026-08-02 | `roadmap` v1.0 created, reconciling five separate backlog sources against the live v0.52.0 tree. |
| 2026-08-02 | Three releases under direct commit (v0.54.0–v0.56.0). Handoff v0.53.0 superseded and **deleted**; `2026-08-02_handoff_v0_56_0.md` is the state of record. C1/C4/C5 closed, C6 opened. |
| 2026-08-02 | **This port.** Doc set moved to `docs/`, archive tier separated, `CLAUDE.md` and `INDEX.md` added. No source document was edited — contradictions are recorded here rather than silently patched. |

---

*Changelog: v1.1 (2026-08-02) — handoff row repointed to v0.56.0 (v0.53.0 deleted); standards→v2.1 and
uiux-review→v1.1 rows corrected; C1, C4 and C5 closed with their rulings recorded as audit trail; C6
opened (the buster guard checks one value, not the current value). v1.0 (2026-08-02) — created for
the Claude Code port; registered all ten documents and opened C1–C5.*
