# LOOP.md — Ralph loop ledger (btplatform)

Append-only. One entry per iteration, newest at the bottom. `RALPH.md` is the instruction set;
this file is the memory. An iteration reads the last three entries and nothing more.

---

## 2026-08-04T22:30-06:00 — iteration 1
outcome   : NO-BUMP (docs-only, pushed)
unit      : §6.1 — README Modules table brought current through v0.86.0 and roadmap §0 fully recounted, both walked from the git log.
commit    : see next entry / git log — this iteration's doc commit
measured  : suite 1238/1238 · files 73 · modules 50 · busters 390/62 files (one value, 0.86.0) · ledger 0042 (42 files)
docs read : README.md · docs/2026-08-02_roadmap_v1_0.md · docs/INDEX.md (roadmap + README status rows only)
learned   : **The handoff was wrong about the size of its own mechanical item.** §6.1 said the README Modules table "stops at v0.64.0 … twenty releases"; the table's newest row was actually **v0.53.1**, making the real gap **thirty-three** releases (v0.54.0–v0.86.0). Grepping the claim is not enough — the claim was *about a document*, so it had to be read. Second finding: roadmap §0's v0.57.0 bucket table did not sum to its own stated total (buckets 19, total 17) because §5's carried non-code items were folded in; the recount excludes them and now adds. The recounted total is **also 17** — coincidence, and the banner in §0 says so explicitly so the next reader does not assume a copy-forward. Third: release commit subjects use **three** conventions — `feat(v0.54.0): …` for v0.54–v0.64, `v0.65.0 — …` for v0.65–v0.85, `feat: v0.86.0 — …` for v0.86. A single grep pattern silently misses eleven releases.
next      : §6.2 — withdraw a player for the night. One route + a board control, no migration. **Scope the `withdrawn_at` grep to `worker/src/kotcplay.js`** — repo-wide it returns a real write at `worker/src/lfg.js:396` against the *`lfg_members`* table, which is a different feature.

**Iteration-1 note on D3 (dirty tree).** The tree was dirty at start: `RALPH.md` untracked and
`.gitignore` modified. Judged human pre-loop setup, not a dead iteration — RALPH.md is dated today,
declares itself v2.0 superseding the pasted v1 prompt, the `.gitignore` edit cites `RALPH.md`'s own
D3 rule, and no `LOOP.md` existed, so no prior iteration had ever run. Both were committed with this
iteration's work. **A dirty tree from here on has no such excuse and should halt.**
