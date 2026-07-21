# Boomtown Platform — Design Handoff Spec
**Version:** v0.1 · **Date:** 2026-07-21 · **Covers:** App Shell (index) + Tournament Ops screen, as built in v0.2.1
**Stack:** vanilla HTML/CSS/JS, no framework · tokens in `web/assets/tokens.css` · spec of record: design spec v0.1 §4

## Handoff Spec: App Shell & Tournament Ops

### Overview
Two screens ship in v0.2.1. **App Shell** (`web/index.html`): magic-link sign-in → dashboard with org switcher; the entry point for every role. **Tournament Ops** (`web/tournament.html`): admin/staff run a full tournament day — create from template, add teams, generate schedule, drag-edit, 2-tap scoring, standings, bracket, print. Ops is used courtside on a phone/iPad in bright sun: dark theme is default, gold accent for scannability, touch targets ≥44px throughout, and the operator can never be hard-blocked by validation (warnings only — the human on the ground always outranks the engine).

### Layout
- App shell content: single column, `max-width: 960px`, 20px side padding. Tournament Ops: `max-width: 1180px` (`.main.wide`).
- Header: sticky, `position: sticky; top: 0`, glass on capable devices with solid `--surface` fallback (never glass on scrolling content).
- Pool grid: horizontal-scroll container (`.grid-scroll`) — the table never reflows; courtside users pan, matching the paper-sheet mental model.
- Dashboard cards: `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`, 14px gap.

### Design Tokens Used
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--bg` | #FFFFFF | #0B0B0D | page background |
| `--surface` | #F7F7F5 | #141417 | cards, header, table headers |
| `--surface-raised` | #FFFFFF | #1B1B1F | score sheet, notices |
| `--text` / `--text-muted` | #101418 / #5A6270 | #F2F0EA / #A8A49A | body / secondary |
| `--primary` (+contrast) | #1B2A4A / #FFF | #D4AF37 / #0B0B0D | filled buttons, role pill |
| `--accent` | #E6B800 | #D4AF37 | court-line signature, focus rings, scores |
| `--positive` / `--danger` | #1F7A4D / #B3261E | #4CC38A / #F2555A | scored outline / errors |
| `--radius-card` / `--radius-control` | 10px / 8px | same | cards / inputs+buttons |
| `--font` | Inter → system stack | same | everything; body ≥16px |
| `--ease-out` | cubic-bezier(0.23, 1, 0.32, 1) | same | all enter/press motion |
| `--dur-press` / `--dur-pop` / `--dur-modal` | 120 / 180 / 240 ms | same | never exceed 300ms |

**Signature element:** the gold "court baseline" — `box-shadow: 0 2px 0 0 var(--accent)` under the sticky header. Reuse this line (never a new decoration) when a future screen needs brand emphasis.

### Components
| Component | Variant | Props/Hooks | Notes |
|-----------|---------|-------|-------|
| `.btn` | filled (default), `.ghost`, `[disabled]` | — | min-height 44px; `:active` scale(0.97) @120ms |
| `.org-switcher` | header select | options from `/api/orgs` | native `<select>` on purpose — 2-click budget, free a11y |
| `.card.module` | static, or `<a>` wrapper when role ≥ staff | — | whole card is the tap target when linked |
| `.match-cell` | default, `.scored`, `.dragging`, on `.drop-target` cell | `data-id` | draggable=true; click = score entry |
| Score sheet `.score-sheet` | bottom sheet | winner buttons → diff chips | role="dialog"; Esc closes; taps ≥48px chips |
| `.warn-banner` / `.notice` | amber warn / gold info | — | warn never blocks actions (operator override) |
| `.standings` table | — | rank/W/L/±/PF | `font-variant-numeric: tabular-nums` mandatory |

### States and Interactions
| Element | State | Behavior |
|---------|-------|----------|
| Any `.btn` | :active | transform scale(0.97), 120ms `--ease-out` |
| `.btn` | :hover (fine pointers only) | brightness(1.06) — gated by `@media (hover:hover) and (pointer:fine)` |
| Any focusable | :focus-visible | 2px `--accent` outline, 2px offset |
| Theme toggle / org switch | activate | **instant, zero animation** — high-frequency actions per emil rules |
| Match cell | tap | score sheet slides up 240ms; tap winner (tap 1) → tap margin chip (tap 2) → sheet closes instantly, cell gains `.scored` green outline + gold tabular score |
| Match cell | dragstart / over / drop | source opacity 0.4; target cell 2px dashed `--accent` outline; on drop → PATCH → amber warnings render, grid re-renders |
| Send sign-in link | loading | button `[disabled]` until response; success/error in `.notice` below (inline, never toast) |
| Generate schedule | infeasible | amber banner with **fix buttons** (each applies one change and regenerates) + "Generate anyway" |
| Generate schedule | scored games exist | 409 banner with explicit "Regenerate anyway (wipes scores)" — destructive path requires the second click |

### Responsive Behavior
| Breakpoint | Changes |
|------------|---------|
| Desktop >1024px | full grid visible; drag-and-drop primary edit method |
| Tablet 768–1024 | pool grid pans horizontally; toolbar wraps |
| Mobile <768px | login card `min(420px, 92vw)`; score sheet is the primary interaction; grid pans; `100dvh` used for centering (iOS toolbar-safe); sheet padding includes `env(safe-area-inset-bottom)` |

### Edge Cases
- **Empty events list:** select shows "— choose event —"; if exactly one event exists it auto-opens.
- **No matches yet:** grid panel hidden entirely (no empty table skeleton).
- **Long team names:** cells grow (min-width 130px); no truncation — courtside legibility beats symmetry. Revisit if a real sheet breaks.
- **Odd math (teams × games odd):** feasibility warns "one team plays G−1" before generating.
- **Round with no byes:** ref shows blank + `ref: null` — admin assigns manually (flagged, not guessed).
- **Session expired mid-day:** any 401 on Ops boot redirects to index for re-link; scores already saved are server-side.
- **Slow connection:** every write is a single small POST; grid re-render only after server confirm (no optimistic score display — a wrong score on the public sheet is worse than a 1s wait).

### Animation / Motion
| Element | Trigger | Animation | Duration | Easing |
|---------|---------|-----------|----------|--------|
| Score sheet | open | translateY(100%→0) | 240ms | `--ease-out` |
| Score sheet | close | none (instant) | 0 | — |
| Dashboard/login cards | first paint only | opacity 0→1, translateY 8px→0, 50ms stagger | 240ms | `--ease-out` |
| Button press | :active | scale 0.97 | 120ms | `--ease-out` |
| Theme toggle, org switch, grid re-render, keyboard actions | — | **never animated** | — | — |
| All motion | `prefers-reduced-motion` | durations forced to 0.01ms | — | — |

### Accessibility Notes
- Focus order: header (wordmark → org switcher → theme → sign out) → main content top-to-bottom; grid cells are `role="button" tabindex="0"`.
- ARIA: org switcher `aria-label="Switch organization"`; theme toggle labeled; score sheet `role="dialog" aria-modal="true" aria-label="Enter score"`; match cells announce teams + score or "tap to score"; `#app` is `aria-live="polite"`.
- Keyboard: Enter submits login; Esc closes score sheet. **Gap (v0.3):** match cells need Enter/Space activation handlers and an arrow-key move alternative to drag-and-drop.
- Contrast: all token pairs meet WCAG AA at body size; gold-on-black score text is decorative-adjacent but paired with the aria-label announcement.
- Touch: every interactive element ≥44px; diff chips 48px.

### For the next screen (Registration — build to these rules)
Reuse tokens only, no new colors; native form controls; inline `.notice` errors under the field (never toasts); the court-baseline signature on public-facing pages; click budget stated in the PR (unpaid reminders ≤3 clicks per spec §4); payment status uses `--positive`/`--danger` + text label, never color alone.

---
*Changelog: v0.1 (2026-07-21) — initial handoff covering shell + tournament ops as built.*
