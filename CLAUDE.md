# CLAUDE.md — Boomtown Platform (btplatform)

**File:** CLAUDE.md · **Version:** v1.2 · **Created:** 2026-08-02 · **Updated:** 2026-08-02
**Status:** ACTIVE — always-loaded context for Claude Code in this repo.
**Supersedes:** nothing. First Claude Code instruction file for this project; ported from the
Claude Desktop project-knowledge doc set (9 markdown files + 1 HTML demo, dated 2026-07-26 →
2026-08-02).
**Companion:** account-level `~/.claude/CLAUDE.md` (voice/stance). This file is project rules only.

---

## 0. Read order — do this before anything else

| Step | File | When |
|---|---|---|
| 1 | `docs/2026-08-03_handoff_v0_70_0.md` | **Every session.** State of record. §0 delivery, §1 measured build state, §3 the pattern behind eleven defects, §4 owner answers including the pool-play floor and balancing rules, §6 next build. |
| 2 | `docs/2026-07-30_standards_v2_0.md` | **Every session.** Build/design law. |
| 3 | `docs/2026-08-02_roadmap_v1_0.md` | **Every session.** What is unbuilt and in what order. |
| 4 | `docs/INDEX.md` | **Every session.** Read-order, doc status, and the open contradiction register. |
| 5 | `docs/2026-08-01_decisions_org-roster_v1_1.md` | When touching orgs, payments binding, or deletes. |
| 6 | `docs/2026-08-01_requirements_lfg-membership_v1_0.md` | When touching LFG, membership fields, or the opportunities feed. |
| 7 | `docs/2026-08-01_uiux-review_admin-shell_v1_0.md` | When touching any shell, rail, header, or contrast. |
| 8 | `docs/2026-08-01_demo_admin-shell_v4_0.html` | Open in a browser when working the SPA shell. It is the target model. |
| — | `docs/archive/*` | **On demand only. Never as part of a normal build.** See §7. |

Steps 1–4 are ~7,400 tokens combined. That is the intended per-session doc budget.

---

## 1. Trust order and session protocol

**Repo > live D1 > docs.** Documents describe intent; the tree and the database are reality.

Before building anything, verify — do not assume. **One command does all of it:**

```bash
node worker/scripts/preflight.mjs --session
```

That reports, in one pass: sync state vs `origin/main`, module syntax, F-37 test-file parity, the
**measured** suite count, repo-highest migration vs live D1, and source version vs `/api/health`.
It exits non-zero on any hard failure. The four manual commands it replaces are still correct if
you need one in isolation, but the script is the ritual — the manual version was skipped, and on
2026-08-02 the local clone sat two releases behind origin for a whole session while work was built
on top of it.

`WARN` is not `PASS`. A check that could not run (no D1 token, offline) is named in the summary and
never counted as clean. Live D1 is read via Cloudflare MCP (db `6cde5d11-4199-4e57-b10f-2b7e968264ea`);
a migration mismatch stops the session.

Never report a "projected" suite count. Measure it. (The v0.33.1 lesson.)

**`node --check <file>` is not a syntax check on this codebase.** It exits 0 for any `.js` file
containing `export` or `import` even when the file is unparseable — reproduced 2026-08-02 on both
Node 22.23.2 (CI's pin) and 24.18.1. All 37 worker modules are ESM, so the file-path form cannot
fail here. Always pipe source in with an explicit `--input-type=module`: `preflight.syntaxErrorFor()`
locally, and the CI gate's own step since v0.55.0 — which now self-tests against a deliberately
broken module before trusting itself.

---

## 2. Delivery — DIRECT COMMIT (owner decision 2026-08-02)

**The ZIP is retired. Claude Code commits and pushes to `main` directly.**

The doc set was written for Claude Desktop, where the assistant could not write to the repo, so
delivery was one ZIP per release with two manifest ratchets and the owner dragging files in. That
constraint never applied in Claude Code, and on 2026-08-02 the owner closed the question: commit
directly. This replaces the ZIP ritual, both ratchets, and Desktop-parity mode. v0.53.1 — whose
only content was moving `CHANGELOG.md` into the ZIP — is moot for the same reason.

**The release loop:**

1. `node worker/scripts/preflight.mjs --session` — must print **CLEAR**. It runs the CI gate
   locally (syntax, F-37 test-file parity, the measured suite, schema, deployed-version parity)
   plus the origin-sync check CI cannot do. **BLOCKED** is a hard stop, not a warning.
2. Commit to `main`. Conventional-commit subject; body states what shipped and why.
3. Push. `deploy-worker.yml` re-runs the whole gate on a clean checkout, deploys, byte-verifies
   `/api/health`, then auto-commits a CHANGELOG entry (job 3, `[skip ci]`).
4. Watch the run (`gh run watch`). A red run *is* the release; do not stack work on top of it.
5. **Fill the CHANGELOG stub, same session.** Job 3 writes a placeholder — *"Auto-recorded by CI on
   deploy … fill this entry from the session handoff"*. It guarantees the release is never **missing**
   from history; it does not write the entry. `git pull`, replace the stub with the real entry, and
   commit. **An unfilled stub is the v0.36–v0.51 decay, exactly.** Never *prepend* by hand —
   `changelog-entry.mjs` owns insertion and tail integrity; you are only replacing the body it wrote.
   Verify with `node worker/scripts/changelog-entry.mjs --version vX.Y.Z --check` (exit 0).

**Still true, and not negotiable:**

- Migrations are applied via **Cloudflare MCP before** the push that needs them. Nothing else
  writes to the database. The CI schema gate fails closed on an unapplied migration.
- **Ask before** anything hard to reverse: history rewrite, force-push, workflow edits (§8),
  deletes, or a change touching more than ~5 files outside one coherent release.
- Preflight is not a substitute for reading the diff. Direct commit removed the human checkpoint
  that caught two brand-sweep misses in v0.53.0. Preflight replaces the mechanical half of that
  check, not the judgement.

**Write a local file instead of committing** only when something genuinely cannot be committed —
secrets, owner-supplied binaries, a deliberately unshipped draft. Say so explicitly when it happens.

---

## 3. Non-negotiables

**Versioning.** Date + version in every file header and every filename — docs and SQL. Bump on
every meaningful revision; never silently overwrite; state what a new version supersedes.
`worker/src/index.js` deliberately carries no version in its header — `/api/health` is the only
honest version source, and the bump must byte-verify as a one-line diff (F-34).

**Database.** Additive-only against live D1. Numbered `00NN`. Applied via Cloudflare MCP *before*
the deploy that needs them — the CI schema-gate fails closed on an unapplied migration. Every
migration ends with its own `schema_migrations` ledger INSERT: a release is not shipped until that
row exists. `org_id` + `deleted_at` on every table. **No screening or clearance fields, ever**
(owner 2026-07-26; SafeSport lives in an external system). Run `sqlite_master` before creating any
new table.

**Worker modules.** One module = one file exporting `xRoutes(request, env, url, ctx)` + `wireX(helpers)`.
Helpers injected from `index.js` — never import from a module that imports you. Every read and write
scoped to `ctx.orgId`; no route accepts an `org_id` from the client (F-11 fails closed before any
route sees ctx).

**Tests and guards.** Every release ships tests for what it ships. Every guard needs a **negative
control that proves it can fail** — mutate the real input, assert failure. Prove-it-fails-live before
shipping any enforcement change. Guards count their own misses and scan the **widest** set.

**The four recurring failure classes** — check by grep, never by trusting a document:
1. Built, tested, and uncalled. Assert `index.js` actually mounts the module *from source*.
2. A decision recorded is not a decision in force. Grep every restatement.
3. A guard narrower than its subject reports clean. Scan the widest set.
4. A gate you skip is a gate you do not have. Run the full suite and count it.

---

## 4. Design and UX — mandated roster

Any UI work loads these, in this order (standards §5, owner requirement #13 verbatim):

1. **`/emil-design-eng`** — the base. Animation decision framework, `:active` feedback, ease-out,
   no enter-animation on high-frequency controls.
2. **`frontend-design`** — structure and aesthetic.
3. **`ux-copy` conventions** — human copy, no jargon, sentence case (v0.5.0 precedent).

**Tokens only.** Colors, fonts, spacing come from `assets/tokens.css` variables. `tokens.test.mjs`
ratchets page-level drift.

**Palette.** Dark = black + gold. Light = white + navy/yellow.

**The gold rule (uiux-review §1, encode it):** gold is a *background with dark ink*, or a decorative
rule/dot. Never gold text on a light surface (~1.7:1, an AA failure). Never light text on gold. Use
`--emphasis` for figures and `--gold-ink` on gold fills.

**Accessibility.** Bare `:focus-visible` ring via `--focus-ring` at ≥3:1 (F-35). 44px targets, 52px
where thumb-critical. `prefers-reduced-motion` honored. Keyboard-navigable, ARIA-labelled.

**Click minimization is a standing requirement** (owner #19). Count the taps in review and say the
number.

**Copy rules (standards §8).** No literal org email address in member-facing copy (F-40) — identity
resolves through the org profile. Never expose another member's email. Names render "First L."
unless the member chose public visibility. Errors are human sentences, not codes.

---

## 5. Use-case analysis — where the source of truth lives

The 24 verbatim owner requirements from the 2026-07-21 specification session are in
`docs/archive/2026-07-26_library_v1_0.md` §1, with the build/buy calls made at the time.
`docs/archive/` §5 holds the reference-system table (gymdesk, volleyballlife, LeagueApps,
TeamSnap, SportsEngine, mindbody, courtreserve, volosports) and this binding caveat:

> Most 2026 "best volleyball software" comparisons are published by vendors about themselves.
> Feature *vocabulary* from those pages is usable. Competitive *rankings* in them are not evidence.

When a use-case question comes up, open the library, answer the specific question, and close it.
Do not fold it into the working set.

---

## 6. MCP usage

| MCP | Mode | Use for |
|---|---|---|
| **Cloudflare** | read + apply | Live D1 reads; applying numbered migrations. The only writer to the database. |
| **GitHub** | read | Reading CI results and remote state. Superseded for delivery: since 2026-08-02 the working tree is a real clone and `git` + `gh` are the write path (§2). Do not pull tarballs — `git pull` is the sync. |
| **Chrome** | interactive | Before/after UI captures. The extension uses `sessionStorage`, so the MCP tab needs its **own** login: the owner requests a sign-in link and pastes it into the MCP tab, then captures are driven. Ask for the go-ahead; do not assume a session. |

---

## 7. Doc hygiene and context budget

**Working set = handoff + standards + roadmap + INDEX.** Everything else is opened for a named
question and closed.

`docs/archive/` exists to stop the failure it documents: eleven documents accumulated by July 2026
and four sessions were spent specifying a module that was already 70% built. Do not read the
archive by default.

**Consolidation trigger.** When the working set exceeds ~10,000 tokens, or when the same fact is
restated in three or more live documents, stop and consolidate: write a new dated + versioned file,
state explicitly what it supersedes, and delete the superseded file rather than leaving two live
copies. Log the consolidation in `docs/INDEX.md`.

**Handoff-before-compaction rule.** Claude Code does not expose a reliable percentage-of-context
figure to the model, so a literal "notify at 90%" cannot be self-measured honestly [INFERENCE].
Use these observable proxies instead — at **any** of them, stop and write the handoff *before*
continuing or running `/compact`:

- A release has been pushed and its CI run has gone green.
- The full test suite has been run twice in one session.
- More than ~12 files have been read into context in one session.
- The context-low warning appears, or auto-compact is about to fire.

The handoff is written to `docs/YYYY-MM-DD_handoff_vX_Y_Z.md`, bumped, with the previous handoff
named as superseded and deleted. It always ends with the next-session prompt (§8 pattern in the
current handoff), rewritten to repo-relative paths — not `/mnt/project/`.

---

## 8. Standing owner answers — never re-ask

Recorded in handoff §3 and elsewhere. Re-asking a settled question is itself a defect.

- `/api/health` matched v0.52.0 at last check: **confirmed**.
- v0.52.0 header smoke (i)–(v): **pass**, plus a new requirement for header consistency across both
  views, which shipped in v0.53.0.
- CHANGELOG: the owner will **not** hand-edit. Ship a complete file every release.
- Waiver system: **closed** to further work (2026-07-26). Documents are org-owned data entered
  through the UI.
- SafeSport / background checks: external system. **M25 dropped.** No clearance field anywhere.
- Twilio / A2P 10DLC: **frozen by owner.** The SMS code exists and stays dormant.
- CI method (`deploy-worker.yml` v0.5.0): current method stands. No workflow changes without an
  explicit OK.

**Still owed by the owner:** Chrome MCP capture go-ahead · a minor/unknown-DOB session for the 18+
gate live test · Oda Up and External/Rental confirms (C-1/C-2, decisions §F).

---

## 9. Open decisions for the owner

1. ~~**Direct commits.**~~ **CLOSED 2026-08-02 — direct commit authorized.** See §2. The ZIP, both
   manifest ratchets, and Desktop-parity mode are retired. `preflight.mjs` replaces the mechanical
   half of the checkpoint the owner's drag used to provide.
2. ~~**Standards §9 / handoff §0 contradiction.**~~ **CLOSED 2026-08-02 — moot and struck.** Both
   clauses described ZIP delivery, which no longer exists. `standards §9` and the
   `uiux-review §6` closing paragraph were rewritten to point at §2 in the same release.
3. ~~**The CI syntax gate cannot fail.**~~ **CLOSED 2026-08-02 — fixed in v0.55.0 with owner OK.**
   `deploy-worker.yml` step 1 ran `node --check "$f"`, which exits 0 for any ESM `.js` file even
   when unparseable (reproduced on Node 22.23.2 and 24.18.1). All 37 modules are ESM, so the step
   had passed unconditionally since v0.2.x. Now pipes each file to `node --check --input-type=module`
   and **self-tests against a deliberately broken module first** — if the check ever stops being
   able to fail, the build stops rather than reporting clean. This remains the only workflow edit
   made under §8; the standing rule is unchanged.

---

*Changelog: v1.2 (2026-08-02) — §9.3 closed: the blind CI syntax gate is fixed in v0.55.0 with an owner OK and now self-tests; §1 note updated (bug reproduced on Node 22 and 24). v1.1 (2026-08-02) — records the owner's direct-commit decision: §2 rewritten from
Desktop-parity to the direct-commit release loop, §1 session protocol replaced by `preflight.mjs`,
§6 GitHub row corrected to reflect git/gh as the write path. Closes open decisions 1 and 2; opens
3, the blind CI syntax gate. v1.0 (2026-08-02) — created for the Claude Code port.*
