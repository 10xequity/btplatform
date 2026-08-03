# Boomtown Platform — Work Order: Member Experience & Theme System

**File:** `docs/2026-08-03_workorder_member-experience_v1_1.md` · **Version:** v1.1 · **Date:** 2026-08-03
**Status:** WORK ORDER — accepted onto the roadmap 2026-08-03. W1–W10 are live scope.
**Supersedes:** `2026-08-02_workorder_member-experience_v1_0.md` (Claude Desktop original, never in the repo).
**Author:** owner-supplied, 2026-08-02. §2–§10 are the owner's content, preserved.

---

## §0. WHAT CHANGED IN v1.1 — read this before acting on anything below

The original was written for Claude Desktop on 2026-08-02, before eight releases shipped. Four of
its framing assumptions are now false. Recording them here rather than silently editing the
owner's document, because a work order that quietly disagrees with reality is failure class 2 —
and this file would otherwise send a future session down a road that no longer exists.

| Original said | Now true | Why |
|---|---|---|
| Delivery is ONE ZIP, GitHub MCP read-only, owner drags | **Direct commit.** `CLAUDE.md` §2 | Owner authorised 2026-08-02; ZIP and both ratchets retired |
| Read `/mnt/project/` | **Read `docs/` in the repo** | Doc set moved in with the Claude Code port |
| Target releases **v0.54.0 → v0.57.0** | **Those numbers are spent.** v0.54.0–v0.61.0 shipped other work | Renumber at build time; the *sequence* in §6 still holds |
| Expect HEAD v0.53.0, suite 631, ledger 0033 | **v0.61.0, suite 765, ledger 0036** | Eight releases since |
| W5: "does 200–300 users need a DB upgrade?" | **Answered, and it still stands** | No upgrade. Index discipline + images in R2. Nothing has changed the arithmetic |
| §0 S-1 checkpoint/handoff rules | **Superseded** by `preflight.mjs` + `CLAUDE.md` §7 | Event-based triggers now enforced by a script, not prose |
| §0 S-2 project-knowledge budget | **Partly obsolete** — the 48k demo HTML lives in `docs/` under git now, not in a context budget | The consolidation advice is still sound |

**Also already shipped since v1.0 was written**, so these items are smaller than they read:
- **W1's dead theme toggle** — fixed in v0.53.0 (`site-nav.js` v2.13 single-sourced theme). The
  four *templates* are still unbuilt; the toggle itself works.
- **W4's admin unread-count endpoint** — shipped v0.56.0. The badge is live. Bulk actions remain.
- **W7's profile menu / app-grid launcher** — still unbuilt, and the recommendation to fold it into
  the theme sweep is now *cheap*: `sync-rail.mjs` (v0.59.0) makes a header change one command, not
  41 hand edits. The argument for batching it was "don't sweep twice"; that argument is weaker now.
- **W9's ICS subscribe** — still open (roadmap §2.5).
- **W9's achievements/leaderboards (M17)** — still unbuilt, still behind M-TF. The "don't ship dead
  menu items" rule stands.

**Unchanged and still correct:** W2 (server-side gating is the fix; a hidden DOM link is not access
control), W3 (scoped event boards over a general forum), W4's rich-text position (plain text for
members, token-constrained for staff, reader controls size), W8, W9, W10.

---

## §1. Owner's four decisions — still open

Carried verbatim from v1.0 §5. None answered yet.

- **D-1 Forum.** Scoped event/team boards, or a full category forum? *Recommendation: boards.*
- **D-2 W6 reproduction.** Which "Members page" is broken — admin People → Members, or the
  member-facing menu? And which control did nothing?
- **D-3 Achievements (M17) priority.** Pull forward, or hold behind M-TF and ship "Coming soon" rows?
- **D-4 Rich text in the inbox.** *Recommendation: plain text for members.*

---

## §2. Work items — owner's content, preserved

### W1 — Theme toggle + 4 templates + custom colours
Four templates (Daylight, Midnight, Court Navy, Chalk) and the custom colour pickers exist only in
`2026-08-01_demo_admin-shell_v4_0.html`. Production has a light/dark binary.

Promote the demo's `TEMPLATES` object and 16-variable token map into `assets/tokens.css` plus a real
theme service; one source of truth. **Discoverability:** ◐ stays an instant light/dark toggle
(high-frequency, no animation, per emil); templates and custom colours live behind a named
"Appearance" row in the profile menu. Long-press stays an undocumented accelerator.
**Persistence:** chosen template in a cookie read pre-paint, before the first stylesheet, so there
is no flash. Org default and custom hex live in D1 under branding, **admin-writable only** —
members pick from templates, they do not author hex.

*Acceptance:* all four selectable from both shells, survives hard reload and member↔admin
navigation with no flash; `theme_tokens.test.mjs` asserts every template passes AA on the named
pairs, **with a negative control that mutates one template's `--text` and proves the guard reddens**.

### W2 — Member screens must not reach admin screens
A static-but-hidden Admin link revealed by JS is **cosmetic, not access control**.
**Fix is server-side:** every `admin-*.html` and admin route returns 403/redirect for a non-staff
session at the worker, before any HTML is served. New guard `admin_route_gate.test.mjs` enumerates
every admin page and route, asserts each is behind `requireStaff`, with a miss counter and a
negative control. Member surface audit across all 14 member pages.

**Member write allow-list:** report a problem · register/RSVP · LFG post/join/withdraw · message
reply · own profile edit · availability toggles · notification prefs. Everything else on a member
page is read-only, and the guard asserts the list. Ship the universal back-path on error/end states
and the sandbox-only "view as member" button.

*Acceptance:* a signed-in non-staff session gets 403 on every admin URL typed directly into the
address bar, **proven live, not asserted**.

### W3 — Forum: recommend NOT building
No forum module exists; it is not on the roadmap. A general forum needs daily moderation and reads
as abandoned below a few hundred daily actives — an empty forum is worse than none. LFG, messages
and announcements already cover most of the intent.
**Instead:** an event/team board — a comment thread scoped to one tournament, league or team,
auto-created with the event and auto-archived when it ends. Bounded lifespan, per-event moderation,
reuses the existing report/mute path. **No forum entry point ships until the module exists** — a
menu item that leads nowhere is the commonest cause of "the member screens are broken".

### W4 — Inbox: bulk actions, filters, and no member rich text
Selection + bulk (mark read/unread, archive, star, mute, delete), batch endpoint capped at 200 IDs,
flood-guarded. Filters: unread · starred · from staff · event-related · archived, plus text search.
Pagination, not infinite scroll — bulk selection and infinite scroll fight each other. Keyboard:
`j/k` move, `x` select, `e` archive, `shift+u` unread.

**Rich text — the pushback.** Arbitrary member-authored HTML is an XSS vector, breaks dark mode (a
member picks black text; a Midnight reader sees nothing) and wrecks deliverability if mirrored to
email. **Members compose plain text, auto-linkified.** Staff announcements get a constrained subset
— bold, italic, links, lists, and one highlight resolving to `--accent` with `--gold-ink`, a token
not an author-picked hex — sanitised **server-side** against an allow-list. **Reader-side controls
are the real answer:** the member controls text size, the theme controls colour. The reader owns
legibility, not the sender.

### W5 — Do 200–300 users need a database upgrade? **No.**
D1 Paid: 10 GB per database (hard ceiling), 2 MB max row, 25bn rows read / 50m written included
monthly. At 300 members using everything: under 1 GB storage, ~1M writes/month, and reads that vary
**a thousandfold with indexing alone** — ~90M/month indexed versus ~90bn unindexed on identical
traffic. **The risk is query shape, not user count.**
Actions: keep images in R2, never D1 (the 2 MB row cap makes one photo a hard failure); composite
index on `org_id` + foreign key everywhere; add a `rows_read` assertion to the E2E harness so a scan
regression is machine-detectable. Turn on D1 Row Metrics and note the baseline.

### W6 — Members page menus not working
Ambiguous between admin People → Members and the member menu. Needs reproduction (D-2). Likely
culprits from the uiux-review: per-page redefinition of shared `.btn` classes, and pages that never
call `guard()`.

### W7 — Profile icon and hamburger position
Roadmap item, not a bug. The demo header has an avatar profile menu and an app-grid launcher; the
shipped header has neither. Fold into W1 — "Appearance" needs the profile menu to exist anyway.

### W8 — Member home layout
Top to bottom: **announcement ticker** (⚠️ a scrolling marquee fails WCAG 2.2.2 — ship a rotating
static card, 6-second dwell, pause on hover/focus, manual prev/next, no motion under
`prefers-reduced-motion`) · **availability toggles** (Open to subbing / Actively looking, 52px
targets, writing to LFG `player_avail`) · **status bubbles** (unread messages, achievements) ·
**upcoming events** · **community play four boxes** · **my events** · **membership QR** (modal, large
image, brightness maxed where the browser allows — the single most time-pressured thing a member
does, standing at the desk with a line behind them).

*Acceptance:* order exact at 380px and desktop; ticker passes reduced-motion; QR in ≤2 taps from any
member page.

### W9 — Member menu, on conventions people know
Bottom tab bar on mobile, five items max: **Home · Play · Schedule · Inbox · Me**. Persistent top
rails are an operator pattern — right for admin, wrong for members.
**Do not ship dead menu items.** Achievements and leaderboards are M17 and unbuilt; they stay out,
or render as a disabled row with a "Coming soon" chip. Never a tap that goes nowhere.

### W10 — Support funnel: make contacting you the last resort
Deflection ladder: contextual "?" per page → searchable FAQ with top five pinned → guided self-serve
for the things members actually email about (reset sign-in, re-sign waiver, update payment, cancel
a registration, fix a name) → **"Still need help?"** appearing only after search returns nothing,
opening a structured form (category · event · description · optional screenshot) into the existing
report queue → **no raw email address anywhere member-facing** (standards §8, F-40).
**Instrument it:** help views, FAQ searches, form submissions. Deflection rate = 1 − (submissions ÷
help views). Without the number, "not too easy to contact us" is a feeling, not a setting.

---

## §3. Release sequence — order holds, numbers renumber at build time

| Slot | Contents | Why here |
|---|---|---|
| **A** | W2 gating + member-surface audit + back-path + sandbox "view as member" | Security first, and the audit tells you what W8/W9 are actually fixing |
| **B** | W1 theme system + 4 templates + W7 profile menu & launcher | One header sweep — now one `sync-rail.mjs` command |
| **C** | W8 member home + W9 menu reorder + W6 admin members-page menus | Layout work on a gated, themed shell |
| **D** | W4 inbox bulk/filters + W10 support funnel | Self-contained; the funnel needs the inbox report path |
| *deferred* | W3 forum (pending D-1) · W5 (answered, metrics note only) | |

---

*Changelog: v1.1 (2026-08-03) — accepted onto the roadmap and reconciled with reality after eight
releases. §0 records the seven framing assumptions that went stale (ZIP delivery, /mnt/project/,
spent release numbers, superseded state figures, and the items already shipped) rather than editing
the owner's text to hide the drift. Owner content preserved in §2. v1.0 (2026-08-02) — Claude
Desktop original.*
