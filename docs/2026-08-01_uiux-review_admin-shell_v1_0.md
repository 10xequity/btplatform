# Boomtown Platform — UI/UX Review: Admin Shell
**File:** 2026-08-01_uiux-review_admin-shell_v1_0.md · **Version:** v1.1 · **Date:** 2026-08-02
**Supersedes:** v1.0 (2026-08-01) — §6 delivery clause struck (ZIP retired). Filename keeps the
v1.0 stamp pending the owner's call on renaming; the header is the authority.
**Scope:** owner notes 2026-08-01 — unreadable button/text, wasted left space, rail reloading, inconsistent
collapse. **Reviewed against the live repo** (`btplatform-main/web`: `admin.css`, `app.css`, `tokens.css`,
`admin-nav.js`, sample pages). Design roster: `/emil-design-eng` + `frontend-design` + standards §5.
**Status:** REVIEW + PROPOSAL. Demo: `2026-08-01_demo_admin-shell_v1_0.html`. No page shipped yet.

## 1. Readability — the AA failure (root cause found, named)
`.btn` itself is fine: light = white on navy (14.2:1), dark = near-black on gold (~9:1). The unreadable
elements use **raw `--accent` gold** as text or as a badge background with light text. Gold is
`#E6B800` (light) / `#D4AF37` (dark); on white that is ~1.7:1 — an AA failure. Your team already made
`--focus-ring` and `--warn` deliberately non-gold for this reason; accent text/badges were missed.

**Named offenders (real code):**
- Gold bg + white text badges: `site-nav.js:54`, `member-inbox.html:24` (notification counts).
- Gold text on light surface: `admin.html` KPI numbers + `.due-row .amt`, `tournament.css` `.score`,
  `admin.css` `.chip.cash-pending`, `app.css` `.wordmark span`, `.notice a`.
- Hardcoded gold (theme-blind, token violation): `signup-widget.js:27`.

| Before | After | Why |
| --- | --- | --- |
| `color: var(--accent)` for KPI/score/amount text | `color: var(--emphasis)` (= navy light / gold dark) | Gold text on white is ~1.7:1; emphasis token is AA in both themes |
| `background: var(--accent); color: var(--bg)` badge | `background: var(--accent); color: var(--gold-ink)` (dark ink) | White-on-gold fails; dark-on-gold is ~9:1 both themes |
| `.chip.cash-pending { color: var(--accent) }` | gold **background**, dark ink | A status chip must be legible; gold as fill + dark ink passes |
| `signup-widget.js` hardcoded `#D4AF37` | token `--accent` + `--gold-ink` | Theme-blind and unguarded; drifts from tokens.css |

**Rule to encode:** gold is a **background (with dark ink) or a decorative rule/dot** — never gold text
on a light surface, never light text on gold. Add a `tokens.test.mjs` case that fails on `color:
var(--accent)` used as body/emphasis text.

## 2. Wasted left space + rail not pinned tight
[FACT] `.admin-layout { grid-template-columns: 232px 1fr }`; rail is `position: sticky` flush at x=0;
`.admin-main { max-width: 1280px }` **with no centering**. So the rail is technically flush, but it is
wide (232px) with loose internal spacing, and on wide screens the uncentered main drifts.

| Before | After | Why |
| --- | --- | --- |
| Rail 232px, `padding: 12px 8px`, loose group gaps | Rail **216px**, tighter group rhythm, flush `left:0` | Reclaims ~16px + vertical density → more main width without losing the label rail |
| `.admin-main { max-width:1280px }`, not centered | `max-width:1360px; margin:0 auto` inside main | Content stops drifting left on ultrawide; balanced gutters |
| Collapse edge handle at fixed `left:219px` (rail is 232px) | Handle bound to the rail component, not a magic px | The 219-vs-232 mismatch is why the handle looks off the margin |

**[INTERPRETATION]** The exact pixel that reads as "dead space on the left" is best confirmed on a
screenshot — the two candidates are the loose rail and the uncentered wide main, both fixed above. If you
restart the Chrome extension I can capture the current view and confirm which one you're seeing.

## 3. Rail "reloads every time"
[FACT — root cause] The app is multi-page, and `admin-nav.js` **builds the entire sidebar in JavaScript
and injects it after first paint** — the static HTML ships only `<div class="admin-layout"><main>`. So on
every navigation the rail is absent on first paint, then pops in. That is the "reload / not clean" you see.

| Option | What changes | Speed | Risk | Effort |
| --- | --- | --- | --- | --- |
| **A. Inline the rail (recommended)** | Rail markup + critical CSS in each page's static HTML; JS only sets active state | Paints instantly, identical every page | Low — in-stack, no framework | Small–medium |
| B. + View Transitions API | Cross-fade between pages on top of A | Feels seamless | Low (progressive enhancement) | Small |
| C. SPA shell | Rail persists, only content swaps (as in the demo) | Best — zero rebuild | Medium — routing/auth rework | Large (a modernization session) |

**Recommendation: A now, B as enhancement.** C is the demo's model and the right end-state, but it belongs
to the already-queued full-UI modernization pass, not a quick fix. The demo shows C so you can feel the
target.

## 4. Collapse inconsistent across pages
[FACT — root causes] (a) Several pages **redefine shared button classes locally** —
`admin-calendar.html`, `admin-tiers.html` redefine `.btn.ghost/.danger/.sm`; `guardian-complete.html`
redefines `.btn.primary` — so styling drifts page to page. (b) Some pages don't call `guard()` themselves
(`tournament.html`, `admin-registrations.html`), relying on the nav auto-run, which changes the shell
treatment. (c) The collapse state (`html[data-nav="min"]`) is applied by JS after paint, so a page can
open expanded then snap to collapsed.

| Before | After | Why |
| --- | --- | --- |
| Per-page `.btn.*` redefinitions | One shared button set; delete local copies | Same button everywhere; kills drift |
| Collapse state set after paint | State read from a cookie **before** first paint | Every page opens in the same state, no snap |
| Collapse handle + group-collapse differ by page | One rail component owns both | Consistency is structural, not per-page discipline |

## 5. What the demo proves
`2026-08-01_demo_admin-shell_v1_0.html` (open it, toggle ☾ Theme): rail flush at the left edge and
**persistent** — switching pages swaps only content, the rail never rebuilds; **one** collapse control that
behaves identically; all figures/badges/chips/CTAs AA-readable in both light and dark; main reclaims width
and stays centered on ultrawide. Motion follows emil: nav taps are instant (`:active` scale only, no enter
animation on a high-frequency control), content fade is 180ms ease-out, collapse is 160ms; reduced-motion
is honored.

## 6. Recommended sequencing (small → large)
1. **Contrast pass (L1–L2):** add `--emphasis` + `--gold-ink`, swap the named offenders (§1), add the
   tokens guard. Cheapest, highest daily impact, ships on its own.
2. **Rail tighten + inline (§2, §3A):** flush 216px rail in static HTML, center main, fix the edge handle.
3. **Shared button classes + pre-paint collapse state (§4).**
4. **(Optional, dedicated session)** SPA shell (§3C) — the demo's model — folded into the queued full-UI
   modernization pass with before/after Chrome captures.

Each ships to standards: dated/versioned files, tokens-only, guard + negative control,
`/api/health` byte-verified. **Delivery: preflight CLEAR → commit → push (`CLAUDE.md` §2).**

---
*Changelog: v1.1 (2026-08-02) — §6 closing paragraph struck the retired delivery clause ("one ZIP, CHANGELOG paste-only, GitHub MCP is read-only — delivery is ZIP + your paste") and now points at CLAUDE.md §2. Review content unchanged. v1.0 (2026-08-01) — admin-shell review against the live repo. Named the AA offenders (raw --accent as text/badge), the rail-in-JS reload cause, the per-page button redefinitions, and the post-paint collapse. Proposal + trade-offs + demo. Sequenced contrast-first.*
