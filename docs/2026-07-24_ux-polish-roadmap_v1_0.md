# UX/UI Polish Roadmap
**File:** 2026-07-24_ux-polish-roadmap_v1_0.md · **Version:** v1.0 · **Date:** 2026-07-24
**Sources:** design-system v1.0 (tokens/motion/a11y floor) · emil-design-eng review framework · page inventory at v0.12.0 · handoff v1.5 open items

Scope: polish only — no new features. Each item maps to a release slot. P0 = before first live tournament (gates go-live QA in M16), P1 = with M16, P2 = post-go-live.

## P0 — go-live gates
| ID | Item | Pages | Why / acceptance |
|---|---|---|---|
| UX-01 | **Global cache-bust sweep** — one `?v=` constant in config.js applied to every css/js include | all | Deferred since v0.11; stale-asset bugs after owner pastes are the #1 support risk. Accept: bump one value → every page reloads fresh. |
| UX-02 | **Operator-color contrast audit** — the 10 `facility_color` values (migration 0008) rendered as chips/blocks on both themes | admin-facility | [INTERPRETATION] several mid-tone colors likely fail AA for overlaid text on dark. Accept: text on every chip ≥ 4.5:1, or auto black/white text chosen per color luminance. |
| UX-03 | **Empty states with one CTA** — no events / no bookings / no registrations / no members | admin.html, admin-events, admin-facility, admin-registrations, member pages | First-run screens currently risk blank tables. Accept: every list renders a sentence + single primary action when empty. |
| UX-04 | **380px mobile audit of courtside pages** — score.html, admin-event (live ops), checkin | courtside set | Scores are entered on phones at the net. Accept: no horizontal scroll, 44px targets, score flow ≤ 2 taps intact. |
| UX-05 | **Error-state parity on member pages** — BT_ADMIN.fail pattern (message + Back + Dashboard) exists on admin; member/public pages need the equivalent | profile, register, membership, leagues | Standing rule 2 currently enforced only on the admin rail. |
| UX-06 | **Logo, favicon, social meta** — blocked on owner uploading `web/assets/logo.jpg` | all | Wordmark-only chrome today; also fixes bookmark/share appearance. |

## P1 — with M16 optimization
| ID | Item | Notes |
|---|---|---|
| UX-07 | **Skeleton loading states** on dashboard, facility day grid, registrations table | Skeletons over spinners (perceived performance). Shape-match the loaded layout; no shimmer loop > 1.2s. |
| UX-08 | **Optimistic score entry** — write score locally, POST in background, rollback toast on failure | Frequency rule: the highest-repetition action in the product; today each tap awaits the network. |
| UX-09 | **Toast unification (Sonner principles)** — same enter/exit direction, pause timer on hidden tab, stack gap fill | One toast implementation in admin-nav shared by all pages. |
| UX-10 | **Keyboard/focus audit** — design-system checklist per page: focus-visible ring, Esc closes modals, focus trap, skip-link on member pages | Mostly built; needs a verified pass + fixes list. |
| UX-11 | **prefers-reduced-motion pass** — keep opacity fades, strip transforms | Grep-audit: any `transition` naming `transform` gets a reduce override. |
| UX-12 | **Responsive table→card collapse** on registrations/members lists < 640px | Tables are currently the least mobile-friendly admin surfaces. |

## P2 — post-go-live
| ID | Item | Notes |
|---|---|---|
| UX-13 | Print stylesheets for facility day grid + door roster (pool sheet already prints) | Clipboard-crowd parity. |
| UX-14 | PWA manifest + icons + install prompt | Depends on UX-06 assets; pairs with the roadmap PWA/push slot. |
| UX-15 | Instant tooltips after first open on admin rail icons | Perceived-speed detail; zero risk. |
| UX-16 | List stagger on first dashboard load only (40ms/item, decorative) | Rare-view surface → allowed by the frequency rule. |

**Standing review rule:** every new page ships against the design-system motion table (nothing > 240ms, transform+opacity only, no `transition: all`, hover gated behind `(hover:hover)`), 44px targets, tokens-only colors. Violations are release blockers, not polish items.

---
*Changelog: v1.0 (2026-07-24) — initial roadmap from v0.12.0 page inventory.*
