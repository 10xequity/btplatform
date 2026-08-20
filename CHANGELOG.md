# Boomtown Platform — CHANGELOG

## v0.171.0 — 2026-08-20

**§-1r RF-12, security half (owner 2026-08-18): no admin affordance on any member surface.** His words: *"there are options for the admin panel on that page or lead to the admin page. This is not allowable for security reason… There should be no admin access from this screen."* Every admin-leading affordance was enumerated FIRST, then removed — a removal pass that misses one has achieved nothing. Said honestly: none of them granted access (all 104 admin routes are gated server-side, enforced every run); they were affordances, not holes, and his least-surface instruction removes them anyway.

Removed: (1) the static `#btHdrAdmin → admin.html` header anchor from all 17 canonical member pages, with site-nav.js's staff/admin reveal of it; (2) the staff-gated **Control Center** card from index.html's signed-in grid (app.js) — this ends D-22's owner-settled "exactly one way back" rule at his newer word; (3) the **Member/Manager sign-in tablist** from the login card — it only ever flipped hint copy (`bt_login_role` had no other reader), and one flow remains for everyone: the email link, or the passkey button passkey.js injects; (4) the **System (staff)** section from the member Settings page — two admin links plus an `/api/admin/push/test` caller. The push-test control moved to **Organization Settings** (admin-org-settings.html), where its route keeps a caller — deleting the only caller would have orphaned the route against route_reachability's shrink-only ratchet.

Kept, deliberately: the **"Viewing as member — Exit" pill** — the only exit from the view-as-member preview (admin pages bounce back to home.html while `bt_demo_member` is set); a member can never see it, and removing it would trap staff in the preview. It is pinned by its own presence test, and site-nav.js code may name admin.html exactly once.

Guards: `header_actions.test.mjs` v4.0 inverts the v3.0 reveal verdicts (absence, not presence) and adds a widest-set scan with everything DERIVED — an admin surface is any page loading admin-nav.js (which is what catches tournament.html), a member surface is every other shipped page plus the repo-root pages, and the scripts checked are exactly the local scripts member pages load. Comments are stripped at both grains with positive controls on the stripper, and the script-src extractor was probed before shipping (its first draft could not see past the cache-buster — the ≥20 floor caught it). `header_shell.test.mjs` v3.0 forbids the anchor outright (NC-M7/NC-M8 retired with their purpose stated: an outright ban has no attributes to misread). All new and inverted guards were watched failing against the pre-fix corpus — 13 reds, each accounted for. Suite 2097 → 2104.

## v0.170.0 — 2026-08-18

**The court board keeps the withdrawn list through a drag (§-1r RF-6), and the sign-in page's theme toggle finally does something (§-1r RF-9).** Two owner-reported "not working" screens, and neither was a dead button.

**RF-6 — the court board.** `POST /api/admin/kotc/:id/move` returned the board without the roster, and `admin-kotc.js` renders the withdrawn list from `data.roster` while being forbidden — by its own guard — to patch its own board. So one drag replaced the board with a payload that had no roster, `#kbDoneWrap` went hidden, and the "Back in" buttons vanished until the page was reloaded. Both 200 paths of `/move` now carry `...(await roster(...))`, the shape `/withdraw` already proved. **The defect sat between two guards that were each correct** — one asserting the page never patches, the other that the list comes from the roster — with nothing checking the seam. The new contract guard derives the route set from the CLIENT (every `api()` call whose response is assigned to `data`) and checks each one's handler region in the worker, so a new render-from-response route fails instead of shipping the same hole; `/round` is correctly out of scope because it re-reads through GET.

**RF-9 — the theme toggle on `index.html`.** All 38 admin pages and all 17 member pages delegate to `BT_THEME.toggleMode()`. `app.js` had its own `setTheme`, which wrote `data-theme` and never touched `data-template` — and since `tokens.css`'s template block follows the base block at equal specificity, the template kept supplying every colour. The ◐ was a visible no-op on that one page, and it desynchronised `bt_template_<mode>` from all 55 others. It now delegates.

**AND THE GUARD THAT WAS SUPPOSED TO CATCH THAT WAS DECORATIVE.** The widest-set check "no member page script keeps a theme/logout copy" required `getElementById("themeToggle").addEventListener` on one expression, and **none of the three files it exempted is written that way** — `app.js`, `site-nav.js` and `admin-nav.js` all bind through a const, which is the house idiom. The check matched none of its own known holders, so its exemption list was exempting files it could never have caught. Rebuilt twice over: the binding pattern now follows a const, and theme is judged as a PROPERTY rather than by name — a file may bind the ◐ as long as it delegates and keeps no private writer. Measured across all 62 asset scripts: three names came OFF the exemption list rather than one going on, and logout keeps an owner list because it has no one-writer service to delegate to.

Suite 2091 → 2097. No migration.

## v0.169.0 — 2026-08-17

**Your own default organization (§6 item 1, owner raised 2026-08-06) — and the preference is enforced twice, because a foreign key is not a permission check.** Migration 0052 adds one nullable `users.default_org_id`; it was applied to live D1 before the push and the ledger row read back (MAX(version)=52, COUNT=52, `pragma_table_info('users')` shows the column, and **0 of 1 accounts hold a default — the deploy changes where nobody lands**). `GET /api/me` now carries it and `PUT /api/me/default-org` sets or clears it. **It is server-side rather than a storage key for a reason:** `bt_org` already persists the last-used org per BROWSER, so a local-only "default" is consulted only on a fresh browser, which is exactly where it is also absent. A default that cannot survive a new device is not a default. **THE COLUMN'S `REFERENCES orgs(id)` PROVES ONLY THAT THE ORG EXISTS.** What proves the org is *yours* is a role join, and it runs on both sides independently: the WRITE refuses an org you hold no live role in, and the READ — `admin-nav.js` — consults the default only if it survives the role filter the switcher already computes, so a default whose role was later revoked silently degrades to the first-org behaviour that has always applied rather than granting anything. The route collapses three different refusals (no such org, inactive org, no role) into ONE 403 with one sentence, so the reply never tells a caller which org ids exist. **What the switcher deliberately does NOT do is override a valid stored `bt_org`** — the whole block it lives in only runs when the stored org is missing or not one of yours. "Default" means where you land when nothing else has said otherwise; the org you last switched to still wins on a browser that remembers one. The route lives in `orgs.js` rather than beside `/api/me` because `index.js` matches the exact string `"/api/me"`, so sub-paths fall through to the dispatch chain (precedent: `PUT /api/me/sub-availability`) — and because `orgs.js` is one of the four CORE modules SG-3a left UNBOUND, so no module grant can ever widen or narrow which orgs an account may call its own. On the page it is **its own control with its own write**: folding it into "Save changes" would put a `users` write behind a button whose label promises an organization write, so somebody editing the org would silently change their own account. It reuses `btn-min` and `og-said` and adds no styled control, because `tokens.test.mjs`'s F-35 ratchet is a ceiling at exactly 20 page-level `:focus-visible` rules with zero headroom. Guard: `default_org.test.mjs`, 10 tests driving the real router — **9 of them watched failing before a line of implementation existed** — covering the null start, set, clear, the 403 on a no-role org with the previous default left intact, a nonexistent org made indistinguishable from a no-role one, junk refused with 400 rather than coerced, anonymous refused with 401, one account's default not leaking into another's, and both source-side halves of the switcher rule.

**TWO RECORDED CITATIONS WERE WRONG, AND MEASURING THEM FIRST IS WHY THE HAZARD DID NOT LAND.** §6 placed `GET /api/me` at `index.js:646-659`; it dispatches at 507 and the function is at **827**, roughly 180 lines adrift after v0.168.0. §6 also placed the two literals `org_honesty.test.mjs` pins — the ones that redden the suite *on a correct fix* — at `admin-nav.js:624-625`; they are at **785 and 788**, and there is a **third** pin at `org_honesty.test.mjs:199` that §6 never recorded, a negative control that mutates one of the same strings. The quoted bytes were right in every case, which is exactly why the line numbers went unchallenged for eleven days. §6 further described `/api/me` as returning `totp_enabled`; it does not, and has not since that column was removed as dead data. Nothing was built on any of the four claims before it was re-measured, and the safe shape §6 prescribed — leave the `orgs.some(...)` detector and the `location.reload(); return;` heal untouched, change only the `orgs[0].id` fallback inside the block — held once the block was actually located. The fixture `journey-schema.sql` moved to v1.2, its `users` DDL re-read verbatim from live `sqlite_master` after the ALTER, trailing-paren shape and all, for the same provenance reason `sessions.acting_role` is carried that way. Suite **2064/2064**, 0 failing (2054 + 10), 137 test files, busters **416/68** at 0.169.0, ledger **0052**.

## v0.168.0 — 2026-08-17

**A host reaches only the modules they were granted — and the axis is bound at the ONE mounting site, not at the 180 gate call sites (SG-3a, roadmap §-1q).** Migration 0050 admitted the `host` role and 0051 created the grant table, but nothing read it: a host passed no existing gate at all, so a host account could reach nothing. `staffGateFor(...keys)` closes that. Every routes-module already receives `requireStaff` by injection, so binding the module axis at the mount changes the gate's BEHAVIOUR without changing its SHAPE — identical arity, every existing call site untouched, and no caller can forget to pass the axis because no caller passes it. That is the D-29 lesson applied to gates: an argument all 180 sites must remember is an argument one of them will not. The order inside the gate is the safety property: it calls the REAL `requireStaff` first, so the admin and staff paths are not a re-implementation of it; a 401 passes through unwidened; the F-1 per-session acting-role drop still binds every tier, hosts included; and only then, for a caller whose role is actually `host`, does a live grant for THIS org and one of THIS mount's keys turn the 403 into a pass. The refusal names the module and the organization, so it is actionable rather than a generic denial. A mistyped key throws at MODULE SCOPE rather than request time — a bad key would otherwise build a gate that refuses every host forever, naming a module that does not exist, and nothing would report it until somebody was locked out of a screen they had been granted. **UNBOUND IS THE SAFE DEFAULT AND THE DELIBERATE ONE:** a mount that passes plain `wiredHelpers` keeps the unscoped gate and refuses every host, which is a complaint somebody can make, where a module bound to the wrong key admits a host silently. Core stays unbound by design — `admin` (users and roles), `orgs` (the switch that turns modules back on), `security` (the audit surface) and `sandbox` (S-2a's rescue link). Keys come from `BT_MODULES`' own `pages` lists, and `staff_gate_wiring.test.mjs` pins every mount in BOTH directions — forward, reverse, and a core check — so a NEW mount with no decision is a red test rather than a default. **`tiers.js` is the one bound module that also carries CORE routes:** `/api/admin/org` writes the organization's timezone, which reaches every calendar emission it makes, and `/api/admin/members/bulk` exports the whole member directory. Those two take `requireCoreStaff` — the unbound gate, passed to this module alone — while tiers, grants and plans take the `memberships` binding. Measured 2026-08-17: no other bound module carries a route outside its own module's concern.

**THE GUARDS WERE THE HARD HALF, AND THE FINDING IS ABOUT GUARD DRIFT, NOT ABOUT THE GATE.** Introducing `requireCoreStaff` as a fourth gating style reddened the S-1a "every `/api/admin/*` route is gated" ratchet AND the §-1e authorization matrix simultaneously, both reporting `tiers.js:244 /api/admin/org` as answering without a session check — a route that was gated the entire time. The cause: `gateCallsIn` and `gateKindCallsIn` in `worker/testkit/route-extract.mjs` each carried their own copy of the gate-name pattern, beneath a comment on the second promising the two "can never drift in what counts as a call site." That was a promise made by PROSE about two separate regex literals, which is not a mechanism, and teaching a fourth style to one and not the other is precisely the drift it did not prevent. Both readers now derive from one declared alternation, and `gateCallsIn` is literally `gateKindCallsIn`'s offsets rather than a second expression asserted to agree with it, so the two cannot disagree even in principle. `requireCoreStaff` collapses to kind `staff` because it IS `requireStaff` before binding — same tier, same admissions, different binding — so the matrix sees no route change and the "no admin-only route downgraded to staff" ratchet holds. All ten negative controls across both files still fire. **A guard blind to a legitimate style accuses the code instead of itself, which costs more than an honest gap.** Separately, ten mount guards each hand-rolled a literal anchor of the form `wireTryouts(wiredHelpers)`, and the bound call shape broke every one; `event_square_item`'s used `[^)]*`, which could not cross the `)` that `staffGateFor("events")` introduced. Widened across 10 files and 11 sites by a sweep that refused to edit any site whose anchor did not match EXACTLY once, then positive-controlled: with the mount line DELETED, all 11 stop matching, so none was loosened into a no-op. **The first positive control was wrong and the correction is the more useful record:** it COMMENTED each mount out and asked whether the test file went red — the wrong mutation twice over, because these anchors read raw source (so the commented line still contains the matched bytes) and "the file went red" can be some other assertion in it failing. It reported one guard vacuous that was not, and passed three it had not actually tested. The corrected control also measured a pre-existing blindness this release neither caused nor cured: **all 11 anchors would accept a commented-out mount**, because they read raw source where the gate scanners read comment-blanked source. Recorded for its own unit rather than widened into this one. Suite **2046/2046, 0 failing**, 135 test files, busters **416 across 68 files** at 0.168.0, ledger **0051** (applied earlier, schema-only, no bump — nothing read the grant table until now).

## v0.167.0 — 2026-08-16

**One blocked-storage fallback per PAGE, not one per module (D-42) — and the score sheet stops stacking listeners (D-40).** v0.166.0 gave each guarded file its own closure-private `Map`, which is coherent inside a file and incoherent across a page: with storage blocked, one module's write was invisible to every other module on the same page, so two of them could disagree about state they are both supposed to read from one place. All guarded modules now take their fallback from a single page-level home — `window.BT_MEM_FALLBACK` for local storage and `window.BT_SESSION_FALLBACK` for session storage, each claimed with the load-order-independent `x || (x = new Map())` form so whichever script runs first creates it and the rest join it. Storage remains the source of truth whenever it works; the map is consulted only when a read throws or comes back empty. **Measured before building, and the contention is real but narrower than "modules disagree" suggests:** only **3 of 61 pages co-load two guarded modules**, and only two of those three share a key — **tournament.html**, where `admin-nav.js` *writes* `bt_org` and `tournament.js` *reads* it (so with storage blocked an org switch silently failed to reach that page's own API calls), and the page pairing `app.js` with `site-nav.js` on `bt_org`/`bt_token`. On `admin-schedule-editor.html` the two guarded modules share no key at all, so nothing ever diverged there. **`config.js` was added to the change beyond the five files named in the request**, because `bt_theme` — the request's own example — has exactly two writers, `app.js` (guarded, own map) and `config.js`'s `BT_THEME` (guarded, *no* map at all), so leaving it out would have kept that one key split in precisely the profile the change exists for. Guards: a static pin that every guarded module takes the shared map and keeps no private one; a session-map pin scoped to the modules that actually touch session storage (so it cannot pass vacuously); and a **runtime proof** — two page scripts booted against one `window` with storage fully dead, where the first module's write is read back by the second, with a negative control that restores per-module maps and confirms the proof then fails. **Rider (D-40, pre-authorised for any release touching `tournament.js`):** the score sheet added a document `keydown` listener on every open and removed it only if Escape was actually pressed, so closing by Cancel or by scoring left one attached and the next open added another. The handler is now named and detached on every close path. No visible misbehaviour was ever attributable to it; it is fixed because this release was already in the file.

## v0.166.0 — 2026-08-16

**One identity rule — a member's own record now follows the LINK, not the address (D-18 / §-0 B20). Plus the approved storage sweep (D-41).** Two of the register's own premises measured false at the tree and the unit is bigger and simpler than it recorded. First: `messages.js` was described as *the* holdout, singular. There were **four** surviving private copies of the resolution query — `member_portal.js`, `messages.js`, `profiles.js`, `waivers.js` — plus a fifth private function in `calendar.js` carrying the shared helper's exact **name** with a different body. `index.js`'s own header claimed six modules had been consolidated into it; `consent` and `registrations` really were, the other four never were, and the comment had documented a finished job for nine releases. Second: those copies were called case-sensitive; they are not. Live D1 and the fixture both declare `contacts.email` and `users.email` **`COLLATE NOCASE`**, so `email = ?` has always matched case-insensitively — no test here asserts case divergence, because it would be testing a column collation rather than the code. **What was actually broken:** the shared resolver joined on **email alone** and merely *sorted* by `user_id`, so a contact whose link was set but whose address had been edited — by an admin, or by the member changing their sign-in email — was **invisible to it**, orphaning that member from their own history. The private copies matched `(user_id = ? OR email = ?)` and were therefore *more* correct on exactly the axis D-18 names, so the rule was unified **upward**: a contact linked to you by `user_id` **is** your record, outright, and an email match is the fallback for a member never linked. The four readers now call that one rule; `profiles.js` keeps its own query as the single declared exemption because it is the **linker** (it writes `contacts.user_id` and creates the row when none exists, which a read-only helper cannot do) and it was aligned to the same matching order, so linker and readers can never disagree about which row is yours. `calendar.js`'s copy was the weakest of the five — email-only with `LIMIT 1` and **no `ORDER BY` at all**, returning whichever duplicate the engine happened to hand back — and is gone. Live D1 at build time: 49 contacts, 1 linked, 1 user, **0 divergent-email rows and 0 email-matching unlinked rows**, so the change is behaviour-preserving today, which is precisely when to make it. Guards: `contact_identity.test.mjs` (7 tests) drives the real router — a linked-but-renamed contact resolves through both a messages route and a calendar route, and where a linked row and a stale email-matching duplicate both exist the linked row wins outright, observed from the contact the route actually *acts on* rather than inferred. **Rider (owner-approved): D-41's storage sweep** guarded `admin-nav.js`, `app.js` and `site-nav.js` — the three modules that load on nearly every page and so were what actually died first in a blocked-storage profile. Measured with one instrument, unguarded storage lines fell **99 → 59**, exactly the 40 promised; the guarded corpus is now a named list of five files that a test enforces. Two existing guards named spellings this sweep relocated and were **rewritten to their purpose** (the org-switcher persistence verdict now asserts that the choice is written under `bt_org` from the switcher's value, whichever writer does it; the per-page theme-copy forbid now catches both spellings) — the fourth recorded instance of a control anchored on a spelling rather than on what the design guarantees.

## v0.165.0 — 2026-08-16

**Blocked storage stops being fatal, the two grids follow each other across tabs, and Escape leaves print view (§-0 B22).** A private-mode or blocked-cookie browser **throws** on `localStorage`/`sessionStorage` access rather than returning null, so a bare read takes the whole page down at the line that made it. Tournament Ops and the Schedule Editor now reach storage through one guarded pair each (`safeGet`/`safeSet`, the shape `config.js`'s `BT_THEME` already uses — its copy is closure-private, so it could not be reused), and the guard covers **every** storage touch in both files, not only the axis preference: measured, the choke points were **tournament.js's bearer-token read on the IIFE's first statement and its `bt_org` read inside `api()`** — both run during boot, so wrapping the axis calls alone would have left the page dying before a single row rendered. A small in-memory mirror backs the pair, which is the difference between "the switch stops remembering across reloads" and "the switch is a dead control": where storage is refused the flip still works for the session. Both pages now listen for the `storage` event and repaint when `bt_grid_axis` changes, so flipping the layout in one tab reaches the other (a tab never receives its own storage event — this is the only path); the listener is filtered by key, so unrelated writes never repaint. And the day sheet's print view exits on **Escape** as well as the on-screen button, gated on the mode being on so it never competes with the score sheet's own Escape. Guards: `grid_axis.test.mjs` 7 → 14, `day_sheet.test.mjs` 11 → 13; **8 of 9 new guards watched failing pre-build** (the one green named: the storage-scan NC, green by its own plant). The harness grew window-event dispatch, injectable throwing storage, and a readable `location` so a blocked-token boot can be asserted as a clean redirect. Two self-inflicted reds were caught by the run and fixed: an NC anchored on `localStorage.getItem` went stale the moment the fix moved that call behind `safeGet`, and a fixture asserted a rendered grid in a signed-out boot — a state that cannot render one. **Honest residual, measured and recorded as D-41:** both grid files are now fully guarded, but the platform is not. Counted with one instrument — a line touches storage, and is guarded if that line also carries `try {` — the loaded JS modules hold **125 storage lines across 28 files, 26 guarded, 99 unguarded**, concentrated in three files that load on nearly every page (`admin-nav.js` 17, `app.js` 14, `site-nav.js` 9 — 40 of the 99). The per-page `<head>` pre-paint snippets are already 118-of-134 guarded and were never the exposure. So on an admin page a blocked profile still dies in `admin-nav.js` before it can benefit from this release: **this is two files made safe, not page-wide immunity**, and the wider sweep is offered as a decision rather than assumed.

## v0.164.0 — 2026-08-16

**The grids flip to courts down the side (owner request, 2026-08-16), and the day sheet is hardened (§-0 B21).** The two views that draw the courts × rounds arrangement — Tournament Ops' pool grid and the Schedule Editor — now default to **courts down the side, rounds across the top**, with a one-press switch back to the old shape, remembered per device under one shared preference (`bt_grid_axis`) so the choice made on either page holds on both. Cells keep their round/court identity in both shapes: drag, drop, two-tap scoring and the apply payload never notice the orientation; the editor's arrow keys follow the **visual** axes in either shape; the transposed pool grid moves Bye / Work from a column to the bottom row. Measured before building: no other view renders that matrix — league weeks, the live board and the day sheet are lists. And the day sheet takes the **verified** two-thirds of a forwarded external review (B21): the print/email buttons **disable while composing** (a double tap can no longer stack sends or dialogs), print-day gains **one named exit** shared by the `afterprint` listener and a new screen-only **Close print view** hatch, and `aria-hidden` leaves `#daySheet` so the printed document is not blank to assistive tech. The review's "users permanently trapped on screen" claim **measured FALSE** — every print-day swap rule is print-scoped, so a stale class changes nothing on screen; the real residual (the NEXT print job printing the wrong document) is exactly what the hatch rescues. The escape guard moved from the static statement-grain regex to a **runtime test**: the new `testkit/page-harness.mjs` boots the real `tournament.js` headlessly, injects `<script>` payloads through every printed field via the page's own fetches, and asserts the composed html carries all eleven markers escaped and not one live tag — with a neutered-escaper negative control proving the harness catches the failure the old regex could not (a `+`-concatenated interpolation never spells `${`). `grid_axis.test.mjs` is new (7 tests); `day_sheet.test.mjs` is rewritten to v1.1 (11 tests); 12 of 18 watched failing pre-build, the runtime escape pair green by construction with teeth proven by their own mutation controls.

## v0.163.0 — 2026-08-16

**The day sheet ships — the desk's whole day in one print job (§-1n P-E / §-0 B19).** Tournament Ops gains **Print day sheet** and **Email day sheet**: schedule, pools and bracket composed into one document, each section on its own page (the pool sheet already page-breaks its standings — literal single-sheet was never the meaning). Built as a **print MODE of the page** (H-3's precedent — no new page, no rail entry) from **three reads that all already exist and are already called**: the ops page's own schedule rows (`sheetRows()` — the printed games, the CSV and the emailed sheet can never disagree), the pool board's `GET …/board` (pools with courts, division, and the frozen team number), and admin-brackets' `GET …/brackets` (pairings by round, champion when decided, TBD where a slot waits). No new route — the D-4 reachability baseline is untouched. The mode is a `body.print-day` class set around `print()` and removed on `afterprint`, so the pool sheet's own print is byte-untouched; failed or empty reads render honest sentences ("No pool board saved yet.", "No bracket yet — it appears here once pool play breaks."). Every interpolation reaching `innerHTML` routes through a local escaper — the page's older grid predates that discipline; the new code doesn't inherit it, and `day_sheet.test.mjs` (8 tests, 7 watched failing) enforces the rule at the html-statement grain with a positive-controlled extractor. `print_parity` stays green by construction (its rule is set-derived; the page already offers the trio). One named collateral rewritten to purpose: `bracket_rewire`'s one-call-site pin moved to the POST grain — its uniqueness was always about the GENERATE, and the day sheet's GET is a read.

## v0.162.0 — 2026-08-16

**The member landing learns restraint-first motion (§-1h M-4 / §-0 B15).** Four motions, each doubly gated by frequency and preference: a card **arrival stagger** (opacity + 8px rise, 220ms `--ease-out`, 40ms steps) that plays once per session and removes its own class so later-revealed panels never late-enter; a **first-fill fade** (120ms opacity) on each card's initial async fill — every re-render (mutes, invites, show-all) stays instant; the header ✉ **badge pops** (1→1.15→1, 160ms, WAAPI) only when the unread count *changed* within the session; and dismiss/mute **closes the list around the removed item** (height+opacity, 200ms — the one deliberate non-compositor exception, user-initiated) before the feed repaints, with the reduced-motion preference checked in JS because a fenced transition never fires its `transitionend`. All CSS motion is declared inside the positive `prefers-reduced-motion: no-preference` fence rather than relying on tokens.css's global kill, whose 0.01ms transforms land as jump-cuts. Explicitly not animated, per the plan: navigation, the theme toggle, anything keyboard-initiated, and nothing loops. Guard: `home_motion.test.mjs` (9 tests — both gates per motion, the stranded-rule check, 3 NCs; its extractor caught this release's own header comment carrying the fence literal, D-33's class, fixed at the source). Two recorded findings: **D-39** — the "My events" card's `#myEvList` has shown a permanent "Loading…" since v2.0.0 moved my-events into the feed box (nothing fills it; a layout decision, not a rider); and the M-4 plan's "skeletons already mirror layout" premise measured FALSE (the placeholders are text lines) — the fade ships without building a skeleton system, restraint per the plan's own charter.

## v0.161.0 — 2026-08-16

**Check-in joins the flow, and the registrations list opens rosters (§-0 B14 / §-1j T2-9a).** The owner's tester complaint was that check-in stood "not linked from the flow": the hub's Registrations tab now carries a **Check-in** sub-pane (the Waitlist precedent) framing `admin-checkin.html?event=` with the event already chosen — scoped to tournaments and leagues because the door roster walks `team_members JOIN teams`, so a drop-in's sheet sign-ups (team_id NULL) are invisible to it; that gap is recorded as **D-38**, not papered over. `admin-checkin.js` learned the hub's `?event=` spelling through the additive-preselect contract (standalone from the rail, nothing changes; a deep link to a non-open event is refused in a sentence, never a silent picker reset). And the registrations LIST's team names are now the roster button — one tap opens `BT_ROSTER` (W-A's modal), whose server payload has carried `team_id` for exactly this purpose since W-A ("so the registrations table can link to the roster", registrations.js's own header) while the client rendered dead text. Guards: manager_hub's pane list and additive-preselect corpus rewritten to purpose (both watched failing first), a new pane-scoping test, and a two-direction mount-correspondence guard in team_roster.test.mjs (script tag ⟺ button emitter) with a landing-asserted NC. Deliberately not taken, recorded: BT_ROSTER on the pool board (tiles are drag targets — click-opens-modal fights drag, and D-6 looms), tournament ops (names are lookup text mid-scoring), brackets (slots are drag/type controls); formats.js division grouping is T2-7's gap and its own unit.

## v0.160.0 — 2026-08-16

**Four colour templates — Daylight, Chalk, Midnight, Court Navy (§-1j T2-15 / §-0 B13 / work-order W1).** The demo's accepted palettes are promoted verbatim into `tokens.css` as `[data-template]` blocks — each colour-self-sufficient (every colour token + `color-scheme`), all 64 declared pairings computed AA before landing and pinned by the new `theme_tokens.test.mjs` (17 tests) plus `token_contrast.test.mjs`, whose theme corpus grew from 2 to 6. `data-theme` keeps its day-one binary meaning (mode); the template rides a second attribute, applied before first paint by a byte-identical one-line script now on all 61 pages (guarded: a page shipping without it reddens the suite). `BT_THEME` (config.js) is the one theme-state writer: both shells' ◐ toggles delegate to it, and the flip now returns you to the template you last used on that side. Picker: an Appearance card row on Settings (member) and a JS-injected Appearance button beside the admin toggle (modal) — one `mountPicker` implementation, swatches painting themselves from the real tokens so they cannot drift. A user who never picks a template keeps byte-for-byte today's behaviour. Not shipped, recorded: the demo's `--band-bg`/`--band-ink` (zero consumers), custom hex pickers (W1's later, D1-backed half), and the long-press accelerator (undocumented by W1's own words; the toggle is the double-bind-fragile control and gains nothing visible). Collaterals rewritten to purpose, named: `tokens.test.mjs`'s block parser now matches selector LISTS (the light block gained a `[data-theme="light"]` co-selector so swatches can carry the light palette inside a dark page), and `header_shell.test.mjs`'s toggle verdicts follow the persistence write to its one home.

## v0.159.0 — 2026-08-15

**D-36 (§-1c): the organization's Square location gets its writer.** Since K-15 every catalog item and payment link has carried `orgs.square_location_id || platform default` — but nothing could set the org half, so the owner's per-organization-locations decision was unusable and everything landed on the platform location. The organization settings screen now has a **Payments (Square)** card: paste the short location ID from Square's dashboard and this organization's items and payments land on its own location; **leave it empty and the platform default applies** — the fallback stays the sanctioned exit. Values that aren't even ID-shaped are refused with a sentence saying where the real ID lives; a wrong-but-shaped ID can only be caught by Square itself, and the help text says so out loud. Proven end to end through the real routes: write the location, price an event, and the created catalog item rides the org's own location; empty the field and the next item rides the platform's. One adjacent defect of the same recorded class was caught by that end-to-end guard mid-build: the settings screen's own reader was a named-column SELECT that didn't include the field, so a saved value would have vanished from the form on reload. All six live organizations have no location set, so this deploy changes nothing until one is typed.

## v0.158.0 — 2026-08-15

**D-30 (§-1c): the last three hard-coded contact addresses leave the worker's member-facing errors — each with its own judgement.** A paused member is now pointed at **their organization's** own contact address (the one every operator already sets on their settings screen), so a Match Point or Colorado Boom member is no longer told to email Boomtown; an organization with no address on file gets a whole sentence naming the organization, never a dangling "Email .". The photo-upload error names **no** address at all — an unbound storage binding is a platform fault the organization's admin cannot fix, so sending a member to them helps nobody. And the passkey security check's refusal names **no** address either — it fires on an unauthenticated path, and the email sign-in link it already points to is the real way back in. The guard that keeps addresses out of member-facing copy now scans **all 51 worker modules** as well as the member pages, with exactly one named exemption (the web-push protocol contact field, which push services read and members never see) — the widened scan is what found that fourth literal, judged, and pinned it.

## v0.157.0 — 2026-08-15

**D-34 + D-35 (§-1c): the event page stops lying about price and capacity.** Since PM-1 the event screen sent `price_cents` and `capacity` on every save, the route silently dropped both, and the notice said "Saved." — the operator's edit reappeared as the old value and read as a slow save. Both fields persist now, from the page's own route. Junk is refused in a sentence, never coerced (junk silently making an event free or unlimited is worse than a refusal); an emptied price means free and an emptied capacity means unlimited — the screen's own conventions. The price↔outside-link rule now judges the **merged result** everywhere it can be tripped: the one-write conversion (zero the price and point outward together) finally works, a price onto an event that still links out refuses with the rule's own sentence, and **series edits check every affected session and refuse wholesale** — the third write path that had skipped the rule (D-35) is closed. A capacity edit reaches the sign-up gate the moment it stores: lowering it stops the next sign-up, raising it admits one, proven through the real registration route. And pricing an event — from the event page or across a series — now creates its Square catalog item exactly like every other pricing path (idempotent, silent without a key), closing the recorded missed moment. The stale help text telling operators to "clear the price from the events list first" is gone; prices edit right on the page.

## v0.156.0 — 2026-08-14

**SG-5 (§-1o): the events management page — the hub becomes the owner's "facebook event invite" screen, and the event screen can message everyone signed up.** Measured first: the one-screen-per-event page already existed (the manager hub, owner-approved, seven iframe tabs) and so did both messaging substrates — marketing's event-scoped segments with their `?event=` hand-off, and B16's recipient selection, whose own header promised this reuse in writing. What shipped is the composition plus the promised second caller. The hub grows **Overview** (the event's own page — details, share link, the minimum-to-run count, publish/cancel) and **Announce** (marketing, already speaking `?event=`) for every event type: a drop-in session goes from one tab to three, so for Cathy's Tuesdays the hub is now the whole screen — the event's face, who is coming, and the megaphone. The event page gains **"Message everyone signed up"**: `POST /api/events/:id/notify` reuses the ONE recipient selection (extracted from the cancel notifier, spelled once), writes an in-app note per active member with the operator's own words, emails only when a mail key exists, and reports honestly — including "nothing was emailed" when keyless and "nobody is signed up yet" on an empty guest list. Refusals are sentences and write nothing (empty message, over 2,000 characters, non-staff). admin-event.html also learned the hub's `?event=` spelling so the Overview frame can't land on "No event selected." The build-status page's stale hub description ("two of the seven tabs are wired") is corrected — all tabs shipped in v0.140.0.

## v0.155.0 — 2026-08-14

**SG-6 (§-1o): the calendar becomes a place — `schedule.html?mode=month` opens the Month view directly.** The measurement came first: the "visual calendar page of upcoming events" §-1o said did not exist has existed on the public schedule page all along — a full month grid with navigation, fed by the public view profile whose live `type_filter` is NULL, so every published event type (drop-in sessions included) already lands on it. What was genuinely missing was a URL: the view toggle was client-side only, so no announcement, admin screen or bookmark could open the calendar. Now `?mode=month` does, the List/Month toggle keeps the address bar honest (replaceState — the Back button never walks a tab tour, and the copied link always says what the screen shows), a `?mode=month` deep link lights the Month tab rather than the hardcoded List, and any other value falls back to List — a whitelist, because the renderer would otherwise treat a typo as the calendar. No new page, no route changes, no migration; the roadmap's SG-6 line is corrected to match what was measured.

## v0.154.0 — 2026-08-14

**SG-2 (§-1o): the threshold — an event knows how many sign-ups it needs to run.** Migration 0049 adds `events.min_signups` (NULL = no minimum; every existing row untouched). The admin event screen grows a "Minimum to run" field and a live count line beside Registrations — *"9 of 12 needed to run — 3 short"* — quiet when no minimum is set. The decision Cathy makes by email thread ("What is your count for Sunday?") becomes one screen and one button: the count line plus the existing Cancel button, which already tells everyone who signed up (B16). Nothing cancels automatically — the count warns, the operator decides. The count is `activeRegistrationCount` — the capacity gate's own number, so "9 of 12" and "full at 12" can never contradict; `min_signups` is the floor of the band whose ceiling, `capacity`, already shipped. The threshold field saves through the event page's own route (joining the allow-list the day its field ships, so it never wears D-34's silent drop) and through create/duplicate/bulk/series via one shared normaliser: junk and zero mean "no minimum", stored as NULL.

## v0.153.0 — 2026-08-14

**SG-4 (§-1o): targeted distribution — segments gain an age band, and the send screen tells the truth about who the filter can't see.** The owner's ask was his neighbour Cathy's use case: announce to her age group, 40+. Segments now carry `age_min`/`age_max` — both ends, because a constraint arrives as one end of a band, and a contradictory band drops both ends rather than guessing which one was meant. The band is validated at both gates (once when a segment is saved, again whenever a stored filter is read — stored JSON can predate the cleaning), and it reaches SQL only as bound year-offsets against member-profile birthdates, one EXISTS per band. The honesty half is the owner's own requirement in as many words: the counter is now one reach judgement returning both the match count and `no_birthdate` — how many contacts pass the filter's other axes but carry no birthdate, so the age filter cannot see them. That number is axis-scoped, not org-wide, and it is zero when no age filter is active, because an honesty line on every segment would train the operator to ignore it. The sentence lands in all three places a director meets a segment: the list, the preview, and the composer's send screen. Live D1 at build time: 49 contacts, 1 profile, 0 birthdates — today the honesty line IS the feature, because a 40+ send reading "0 people" without it looks broken rather than empty. One of this unit's own guards caught its own comment naming the renamed counter — the rename-is-a-search pin held against its author first.

## v0.152.0 — 2026-08-14

**S-4a (§-0 B12): passkeys now require Face ID, fingerprint, or PIN — as a ratchet, which is what makes it lockout-free.** Migration 0048 adds `webauthn_credentials.uv_required` (DEFAULT 0, so the deploy changes no login). New enrolments must verify the user outright: the creation options demand it and the server enforces the flag — an option is a hint; the flags check is the enforcement — so every new credential is born requiring verification. Existing credentials ratchet instead: the first login that carries the verification flag flips the bit, and from then on an assertion without it is refused with its own sentence, because a verifying authenticator that suddenly stops verifying is the shape of a cloned key, not a settings change. The one live credential is Windows Hello, which always verifies — it ratchets itself on the owner's first sign-in after this deploy and can never be locked out at any moment. Login options deliberately stay "preferred": in a usernameless flow a client-side "required" is the only thing that could lock a legacy credential out, and it adds no security the per-credential server check doesn't. The §-1i pinned test ("login succeeds WITHOUT the UV flag — S-4a is the owner's open call") is rewritten to its surviving purpose — no lockout, and no silent ratchet on a presence-only login — and the register round-trip fixture now enrols the way real authenticators must. Settings' own promise that a passkey is "both your password and your second factor" is now enforced server-side for every credential that has ever demonstrated it can honour it.

## v0.151.0 — 2026-08-14

**T2-1a (§-0 B11): the schedule editor holds changes until Save — the owner's settled sentence, whole.** Moves and swaps are now local: drag or keyboard-move a match and nothing reaches the server; an undo/redo history runs both ways (buttons plus Ctrl+Z / Ctrl+Shift+Z, disabled by depth), exactly the pool board's "nothing saves until you say so" with a memory. Fairness never went client-side: a new no-write `preview` endpoint scores every held arrangement with the generator's own `poolReport` — the same loader, positions patched in memory — so the panel stays live while nothing is written. Save posts the changed positions to a new `apply` endpoint, the one writer, which validates the RESULT rather than the request: one match from another event poisons the whole save, two matches on one court is refused wholesale against the final arrangement, writes park on distinct negative courts mid-save (the old route's own idiom), and one audit row records the lot. The v0.65.0 save-every-move route is removed — the held editor would have left it caller-less, and two writers of one arrangement is how they come to disagree; its tests were rewritten to their purposes (a swap never loses a match; a reposition lands where sent), including a second consumer the enumeration missed in `sandbox_seed.test.mjs`, now an exchange because a full grid has no empty slot and the save honestly refuses collisions. Dirty state is visible and guarded — "Save N changes", ● Unsaved changes, confirm on event-switch and reload, beforeunload — because hold-until-Save makes silent loss possible where save-every-move could not lose anything. Three of this unit's own guards were caught by their own controls before the code was: a foreign-match check passing off route-absence, and two needles reading comments or the wrong byte-form as code.

## v0.150.0 — 2026-08-13

**T2-4 (§-0 B9): the Plan-the-day options are curated to what a director would actually pick.** The measured finding: the owner's v0.110.0 words already gave both bounds — aim 8 pool games (9–10 rounds), 12–16 total with the bracket, "more than 16 become physically unplayable" — and the 16-game ceiling had been encoded in the bracket planner since v0.110.0 while the options route knew neither bound, so 16 teams on 4 courts offered twelve equal-count buttons from a 1-game day to a 12-game day as if they were all choices. `MAX_GAMES_PER_TEAM` moved to formats.js beside the floor it belongs with (one home per bound, the v0.109.0 precedent mirrored; brackets.js now imports it). `curatePoolOptions` is the one judgement: it annotates rather than removes — `chooseRounds`' unfiltered contract and the league-night `{minGames}` override are pinned untouched — recommending exactly the 8–10-pool-game counts, with every refusal a plain sentence and the ceiling's reason outranking the band's. The route serves the judgement (`recommended`, `why`, `band`, `recommended_count`); the screen shows recommended counts as the buttons, the rest behind a "Show more" disclosure with reasons, and when nothing lands in the band it says why and offers every count directly — defaults, never refusals. The same unit closes the half-built points: the server accepted `points_to` for six releases while the screen never sent it; a Points-to field now rides both the preview and the committed matches. Guarded by a property test over the real field sizes (6–32 teams, 2–12 courts) with a class-coverage floor, so the sweep cannot pass by never visiting a class.

## v0.149.0 — 2026-08-13

**K-10(a) (§-0 B8): the app now survives its own address changing.** The measured surprise: `env.SITE_ORIGIN` was set nowhere, so three worker modules — consent links, inbox emails, waitlist offers — were building member-facing URLs from hardcoded `github.io` "fallbacks" that were in fact the live production path, while tests set the variable and exercised the other branch; the waitlist one only composed a working link because its fallback's shape disagreed with the other two and it appended `/web` itself. All three now read `env.APP_URL`, the one address wrangler.toml actually configures, with no fallback — a fallback that silently mints links to a stale domain outlives every rename. The admin marketing page's copyable widget snippet is now built from `location` at runtime instead of a baked URL, so the line an admin hands to an external site is correct wherever the app is served. A new guard (`origin_portability.test.mjs`, +10) forbids the app host, the path prefix, and the API host everywhere in shipped code except a positive-controlled allow-list that doubles as the MOVE-DAY RUNBOOK, now written into the roadmap's K-10 block — wrangler.toml's two lines, the two root stubs, and the Pages domain setting, plus the two consequences that are not edits: the live passkey is bound to the old hostname and needs re-enrolling after a move, and already-pasted external embeds keep the old origin. The guard ships its own string-and-regex-aware comment stripper because the harness's `blankComments` erases `https://` string literals (recorded as D-37) — and the guard's own planted-needle control caught the stripper's first draft mis-reading a quote-carrying regex before the scan could go blind.

## v0.148.0 — 2026-08-13

**K-15 (§-0 B22): a priced event now creates its own Square catalog item.** Migration 0047 adds `events.square_item_id` + `square_variation_id`. `ensureEventSquareItem` (memberships.js, beside the SUBSCRIPTION_PLAN writer it extends) fires from the two ends a pricing write cannot bypass — `insertEvent`, which every creation path flows through, and the bulk edit's price path, the one route that can price an existing event. The item is named `<event> — <date>` (a series' sessions stay distinguishable), carries the price on one nested variation, and is scoped to `orgs.square_location_id` with the `env.SQUARE_LOCATION_ID` fallback payment links have always used, under the one platform token — the credential decision the queue asked to be made at build time. An event that registers elsewhere never gets an item (PM-1's exclusion, re-checked at the writer); an unpriced or already-itemed event skips; no token skips silently (an event without an item loses no function, unlike a plan); Square failures warn and never block the local save. The admin screens surface the note wherever one is returned. Square remains sandbox-only until `SQUARE_ENV` says otherwise, and the new guard file pins the sandbox host — the suite's first outbound-fetch capture (no test had ever exercised a Square call). Recorded, not fixed: D-35 (series edit skips the price↔URL exclusion — a third write path PM-1's enumeration missed) and D-36 (`orgs.square_location_id` has no writer; every org is NULL, so all items land on the platform location today).


## v0.147.0 — 2026-08-13

### PM-1 / B6 — an event can point at someone else's registration

Owner (§-1m Q4): *"If it is outside registration, to an outside registration."* An event can now
carry an outside registration link (migration 0046: `events.external_url` + `external_label`) and
send people to Volleyball Life / Volo instead of registering them here.

§-1m states three rules for this and calls each one a trap this repo already knows. All three are
built and each is pinned:

**Rule 1 — the outbound link must be visibly outbound.** `BT_SIGNUP` returns `rel="noopener
noreferrer"`, `target="_blank"`, an ↗ affordance and never a bare URL as the label (an unlabelled
external link falls back to *"Register on their site"*). *"Or we have made a third party look
like us."*

**Rule 2 — no surface that will never receive data.** `eventForm` and `eventSheet` return the
outbound destination instead of a form, a price, a waiver or a live count, and both public pages
render a card that says where to go. **The refusal lives at the destination on purpose:** forking
the button is the visible half, but anyone can type `register.html?event=N`, so the one surface a
stray link cannot route around is the payload.

**Rule 3 — a price and an external URL cannot coexist.** Enforced on the **resulting state**, not
the request: a write carrying only `external_url`, aimed at an already-priced event, has one field
and still produces the contradiction. **Live D1: 6 of 7 events are priced**, so that is the common
path. The rule is one exported function with two importers, because the two halves sit on two
write paths — `external_url` goes through `tournaments.js`, `price_cents` through bulk edit.

**The signature changed, and that is the point.** `BT_SIGNUP_LINK(type, id)` has been the single
place deciding where a sign-up button points since D-29. An external URL is a second axis, and
adding it as a third parameter would have let a caller omit it and silently get the internal link
— D-29 for a third time in the same function. It is now **`BT_SIGNUP(event)`**: the whole event
in, the whole decision out, so "forgot the external URL" is not expressible.

**That rename found a live bypass.** `leagues.js` was building its own `Register` href instead of
calling the helper — producing the identical string today and silently ignoring an external URL
tomorrow. Exactly what *"add a caller, never a copy"* exists to stop. It is now a caller, and
`dangling_refs.test.mjs`'s caller set names it.

**The deploy changed nothing.** Live D1 after both ALTERs: 0 of 7 events carry either column, so
every button on every screen points exactly where it did at v0.146.0.

**Guard: `worker/test/external_registration.test.mjs`, 17 tests, 14 red pre-build.** Two existing
guards were REWRITTEN, not deleted, because they pinned the old name while their claims stayed
true: `signup_sheet.test.mjs`'s type-fork test and three tests in `dangling_refs.test.mjs`.

### §-1c D-34 — recorded, not fixed: PATCH /api/events/:id silently drops price and capacity

Found while looking for where rule 3 belongs. `patchEvent`'s allow-list is
`["name","starts_at","location","court_count","status","cash_option_enabled","config_json"]` —
and `admin-event.js` has been sending `price_cents` and `capacity` on every save, getting
"Saved.", and having both discarded. `price_cents` is writable only through bulk edit.

**It is recorded rather than fixed because widening that allow-list is a change to a route this
unit is not about** — but it has a consequence worth stating plainly: with 6 of 7 live events
priced, converting an event to an external link means **clearing its price from the events list
first**, because the event page cannot clear it. The admin form says so rather than letting an
operator hit the refusal and guess.

Suite **1848/1848** (1831 + 17) · **125** test files (124 + 1) · 51 modules · busters **415/67** at
0.147.0 · **ledger 0046**, both ALTERs applied to live D1 and the row read back before the repo
ratchet moved.

## v0.146.0 — 2026-08-13

### K-1 tier 2 / B5 — the team number comes from the director's own arrangement

Owner 2026-08-10: *"Team number is assigned based on historical performance data if returning team
… then guess based on admins arrangement of tiles (1 being top down for each division). Then
finally registration order."* A three-tier fallback. Tier 3 shipped in v0.125.0; **this is tier 2**,
the item H-4 and K-13 both deliberately deferred to. Tier 1 stays unbuilt and §-1k records why —
"returning team" has no definition in this schema.

**Saving a board now numbers it.** Every team that sits in a pool inside a division gets
`team_no`, 1..N **top-down within each division**, ordered by the division's own rank, then the
pool order the director saved, then the tile order inside the pool. Each division restarts at 1,
because that is what the owner asked for — two teams in one event legitimately share a number.

**Migration 0045 adds `teams.team_no`, and the column is the interesting decision.** The cheaper
design is to derive the number on every read from (division, `pools.sort_order`,
`board_order`) and add nothing — and it very nearly works, because both of those change only when
the board is saved, so a derivation would already be frozen at Save by construction. **That was
checked against the writers and refuted:** `teams.division_id` has two writers outside the board —
`divisions.assign` and the promote/relegate moves — and `teams.pool_id` is cleared when a pool is
deleted. Any of those would have renumbered a saved board with nobody touching it, which is
precisely the failure K-1's spec names: *"the sheet in their hand disagrees with the screen."*
Freezing at Save has to be a write.

**The deploy changed no number on any screen.** Live D1 after the ALTER: 0 of 70 rows non-NULL, so
every team kept the number it already displayed until a director saves. `board_no` is now
`COALESCE(team_no, registration rank)`, so all three existing consumers — the tile badge, the
tile's accessible name, and K-13's *Team number* sort — keep working untouched.

**Dragging a team out clears its number in the same save that gives one to the team dragged in.**
A stale number on an unplaced team is worse than none: it looks like a real position.

**The board now says which numbering it is showing**, which K-1 asks for in as many words. A saved
board reads *"Team numbers came from your saved arrangement — 1 down each division"*; an unsaved
one reads *"Team numbers are in registration order. Save the board and they renumber…"*. The same
badge meaning two different things on two days is the "empty and broken look identical" family, and
a line that appears only in one state leaves the reader deciding whether it is missing or unloaded.

**Guard: `pool_board_bench.test.mjs` grows 8 tests.** Verified end to end against a fixture shaped
like live event 90002 — three divisions, pools interleaved across them, teams placed out of
registration order so the two tiers are distinguishable.

**One v0.125.0 test was REWRITTEN because tier 2 contradicts it.** It asserted that a save must NOT
renumber. The property it was actually protecting — a number must never change *under* the director
— survives and is now stated in its stronger form: **only** a save renumbers, a read never does,
and a division change made elsewhere does not either. That last one is the measurement that forced
the column, so it is now pinned as a test rather than only as a comment.

**And that test was vacuous when first written.** Before the column existed it compared two
all-NULL snapshots and passed while proving nothing. It now asserts something is frozen going in,
so the comparison cannot be between two empty things.

**A claim this change made false has been corrected rather than left.** K-13's comment in
`admin-pool-board.js` documented `board_no` as *"rank by t.id … so its order IS registration
order"*, and the K-13 test title said the same. Both now say what is true: sorting by NUMBER orders
by the number printed on the tile, whichever tier produced it.

Suite **1831/1831** (1823 + 8) · **124** test files, unchanged — tier 2 extended the guard that
already owned this number · 51 modules · busters **415/67** at 0.146.0 · **ledger 0045**, migration
applied to live D1 and the row read back before the repo ratchet moved.

## v0.145.0 — 2026-08-13

### K-14 / B21 — sort and filter tabs on the member events list

Owner 2026-08-11 (Q2): *"B, main list of events needs to be sortable. Have tabs at the top to
sort, similar to the tournament page in Boomtownvb.com."*

**The record said this was an extension. It was not, and the difference was a live bug.** §-1m
recorded *"`schedule.js:21-23` already has a working `.tab` mechanism on that page — K-14 is
extending an existing tab row, not building one."* Re-measured: the listener is at :26-30, and
**the `.tab` row is `List | Month` — a VIEW switcher.** Hanging the owner's categories off it
would have put "in what order" and "in what layout" in one control.

Worse, `schedule.js` bound `document.querySelectorAll(".tab")` **globally**. Any second `.tab` on
the page joined the view switcher, so clicking a type tab would have set `mode = undefined` and
dropped the page into the calendar branch — a filter that silently changes the view, which reads
as a styling bug forever. Both rows now carry ids and both listeners are scoped to their own
container. A guard fails if an unscoped `.tab` selector ever comes back.

**Every control is built from the loaded events.** The schema allows five event types; live D1 on
2026-08-13 had published events of exactly two — `tournament` (4 in the public window) and
`league` (1). `training`, `event` and `court_rental` have **none**. A static row would have
shipped three permanently empty tabs, which is K-13's pool-board defect reproduced on a public
page. So: **All + each type present**, and the row does not draw at all below two types, because
"All" beside a single tab filters nothing. Against the live shape the row reads
**All | Tournaments | Leagues**.

The same rule reaches the sort (**Date** always, since it is the server's own order and the way
back to it; **Name** and **Price** only when they vary) and the direction toggle (hidden below two
events). **Reverse inverts the comparison, not the array** — an event with no date or no price
stays at the bottom in both directions, which is v0.125.0's deliberate blanks-last decision
carried through rather than re-made. The toggle names its direction per key: *Soonest first /
Latest first*, *A–Z / Z–A*, *Low to high / High to low* — K-13 refused to put an alphabet on a
number, and this refuses the same thing in the other direction.

**The org filter was already half-doing this and is now honest.** `load()` has always computed
`seen.size > 1` before populating it, then left the control on screen saying "All orgs" — and one
org is live, so it has been filtering nothing. It now hides when there is nothing to choose
between. Fixing the control beside the one being built, under the rule being built, is not scope
creep; leaving it exempt from its neighbour's rule would have been the odd choice.

The type filter is applied **before** the view branch, so Month view honours it too — a filter
that only narrowed the list would leave someone on Leagues still seeing tournaments in the
calendar. The empty state names the tab you are on rather than claiming nothing is scheduled.

**Guard: `worker/test/schedule_tabs.test.mjs`, 16 tests, 14 red pre-build.** The type labels are
checked against the type list parsed out of the schema's own CHECK constraint, so a sixth event
type fails this until somebody names it in human words — H-2's lesson, where an approved design
named a type that did not exist.

### hidden_overlay.test.mjs — two findings, one of each kind

It reddened on this change with two offenders, and they were not the same sort of thing.

**`.sched-controls` was a real defect in the new code** — `display: flex` beats the user agent's
`[hidden] { display: none }`, so a hidden control row would have painted anyway. That is exactly
v0.119.0's unclosable-overlay bug, caught on arrival by the guard written for it. Both new rows
now ship `[hidden]` overrides, including `#schedTypeTabs`, **which that guard structurally could
not have caught**: it takes `display: flex` from `.tabs` in `admin.css` rather than this page's
inline CSS, and it ships without the attribute in markup.

**`.btn` was a defect in the guard.** It matched the text `.btn` inside a CSS *comment* — the
checker's `[^{}]*` window spans from a class name mentioned in prose to the next real rule's
`display`. The only other cure would have been rewording a comment to appease a broken check, so
the guard now strips CSS block comments before scanning, with an NC proving it both ways. `//` is
deliberately left alone: a style block can hold `url(https://…)`, and blanking to end of line
there would delete real declarations and make this guard a source of false CLEANS.

Suite **1823/1823** (1806 + 17) · **124** test files (123 + 1) · 51 modules · busters **415/67** at
0.145.0 · ledger **0044**, no migration.

## v0.144.0 — 2026-08-13

### K-13 / B17 — multi-sort on the pool board, and an option only where it applies

Owner 2026-08-10 (Q3 rider): *"registration date · alphabetical · rank (and reverse) · group ·
division · gender, **where each applies**."* Four of those six were settled by measuring rather
than by choosing.

**Rank is the K-1 team number**, per Q3's own standing default — and it is the same option as
**registration date**, because `board_no` is rank by `t.id` within the event and ids are
AUTOINCREMENT, so its order *is* registration order. Two of the owner's words, one control;
offering both would have been two menu items with byte-identical output. **Group is the Level
sort that already shipped** in v0.125.0 — `sortTeams`'s own comment has called it grouping since
the day it landed, and the owner's answer opened with "grouping is fine", so no second key was
invented for a word already implemented. **Division sorts by the division's `rank`**, never its
name or id: `rank` is the director's own ordering of divisions and `loadBoard` already orders by
it. **Gender** is `teams.gender_division`, which had been in the schema since the first migration
and was never selected — the same gap T2-8 found for `level`.

**"Where each applies" is computed from the board, and the measurement is why.** Live D1 on
2026-08-13, the five boards that have a waiting area, counting distinct values (blank is its own
bucket):

| event | waiting | division | gender | level | seed |
|---|---|---|---|---|---|
| 90001 | 4 | 1 | 1 | 1 | 4 |
| 90003 | 8 | 1 | 1 | 1 | 1 |
| 90004 | 8 | 1 | 1 | 1 | 8 |
| 90005 | 8 | 1 | 1 | 1 | 8 |
| 90006 | 30 | **3** | 1 | 1 | 10 |

Every team in production is either ("Coed","BB/A") or (NULL,NULL). A Gender sort would reorder
nobody on any board that exists — **and neither would Level, which has been an always-visible
option since v0.125.0.** So an option is now offered only when sorting by it could actually
separate two teams, which repairs the shipped Level and Seed options at the same time as it adds
the new ones. Running the shipped code against those real shapes: 90003 offers Board order, Team
number and Team name only; 90001 adds Captain and Seed; 90006 adds Division. Division appears on
exactly the one board that has divisions, which is the point.

**Reverse inverts the comparison, not the array.** v0.125.0 put teams with no captain, level or
seed at the BOTTOM on the grounds that a blank at the top of a list is the first thing read and
the least useful thing to read. A `.reverse()` would have thrown every blank to the top the
moment a director pressed the button, so descending flips the teams that have a value and leaves
the blanks where they were. The toggle names its direction ("Ascending" / "Descending") rather
than showing an arrow, and says words rather than "A→Z" because half these sorts are numbers.

**One judgement, two readers.** The option list and the sort share `sortPick` — the single place a
key becomes a value. Had they kept separate copies, the option a director is offered and the
order they get from choosing it could have drifted apart, which is the whole failure this design
is arranged to prevent. The reverse toggle reuses `.pb-collapse` and needed no component of its
own; only its pressed state was missing, and it joined the rule that already defines pressed.

**Guard: `pool_board_bench.test.mjs` grows 14 tests (13 red pre-build).** The fixture mirrors
production deliberately — level and gender single-valued, division and seed varied — because a
fixture where everything varied could not test the hiding half at all.

**`board_suggestions.test.mjs` had pinned adjacency, not a rule.** It required
`renderSuggestions()` to sit on the line directly after `tempSeq = -1;`, so inserting a call
between them reddened it while the claim it protects — "drawn from ingest()" — stayed true. It now
asserts containment, which is what was always meant. Same file, ten lines below, already carries a
note about making exactly this mistake with a CSS border.

**T2-8's own comparator NC reddened on its `notEqual` line** because the bytes it mutated
(`return av.localeCompare`) were split by the reverse work. Third session running that this class
has appeared; third time that one assertion was the only thing between a control and vacuity.
Rewritten, not deleted.

### D-31 — preflight now refuses a release whose CHANGELOG entry is missing

Iteration 71 put this file's entry in the closing docs commit instead of the release commit, so CI
wrote a `[skip ci]` stub — the first since v0.115.0, twenty-seven releases earlier — the docs push
was rejected, and the stub had to be hand-merged. That was recorded as a lesson, and a written
correction is not a control. `preflight.mjs` already treats `index.js` as the only honest version
source, so it now also requires a matching `## v<version>` heading here and **fails before the
release commit is made**. Seen failing on this very release before this entry was written.

Suite **1806/1806** (1792 + 14) · **123** test files, unchanged — K-13 extended the pool board's
existing guard rather than opening a second home for one page · 51 modules · busters **415/67** at
0.144.0 · ledger **0044**, no migration.

## v0.143.0 — 2026-08-12

### B29 / D-28 — member pages read the ORGANIZATION's own contact email

Five member-facing sites hard-coded `admin@boomtownvb.com`: the "Request change" button on
settings and a *Have questions or need help?* footer on member, profile, library and inbox. The
consequence was not cosmetic — **members of Colorado Boom and Match Point Social were being told to
email Boomtown.** Standards §8 / F-40 has forbidden a literal org address in member-facing copy
since before those pages were written.

**The owner's half was already built.** Every organization sets its own Contact email on its own
Organization Settings screen, server-validated through `orgs.js`'s EDITABLE allow-list and
published as the `{{ORG_EMAIL}}` token. Live D1 held three distinct addresses. So this unit was
never "let orgs set an email" — it was making the member pages **read the one they already set**.

**What shipped:**

- `publicOrgBrand` returns `admin_email` alongside the brand fields. The note on that SELECT said
  "exactly three fields"; **the count was never the invariant.** What made three columns safe is
  that all three are *publication* fields — things an operator fills in expressly to be published.
  `admin_email` is the same kind of thing. The rule is rewritten to say that, and the exact column
  list is pinned from both sides, so a fifth column reddens a test.
- `site-nav.js` **v2.18** fills any `[data-org-contact]` anchor from that payload, with an optional
  `data-org-contact-subject`. It reuses the org-brand fetch every member page already makes — one
  request, one cache, no second mechanism.
- **`window.btOrgContact`** exists because `settings.js` renders its row *after* the rail paints,
  from its own `/api/me`. The rail's single pass cannot see markup that does not exist yet, so a
  private fill would have left exactly one of the five sites broken forever.

**Fail closed, decided as a markup question rather than a runtime one.** Every anchor ships
`href="help.html"` — a live page — and is only ever *rewritten* to a `mailto:` once a non-empty
address resolves. Offline, no `bt_org`, a 5xx and a NULL column therefore all leave a working
route instead of a dead link, and *empty and broken look identical* cannot happen here by
construction. Verified against a stub DOM on all six paths. The link text is destination-agnostic
("Contact us", "Request change") so nothing but the href changes and there is no copy flash.

**The owner's constraint holds by construction.** `admin@boomtownvb.com` is the RIGHT address for
org 1 and must never resolve to his login email: the value comes from `orgs.admin_email` and
`publicOrgBrand` takes no session and no ctx, so there is no user row in scope to read one from.
Live check after deploy — org 1 `admin@boomtownvb.com`, org 2 `admin@matchptsocial.com`, org 4
`admin@coloradoboom.com`.

**A bug in this change was caught before it shipped.** The remembered brand was a `let`. `init()`
runs at the top of the file, and a *signed-out* visitor with a `bt_org` and a warm cache never
awaits — it runs straight through to the render and reaches the filler while the module body below
it has not executed. That is a temporal-dead-zone `ReferenceError` on a path no signed-in test
would ever exercise. It now hangs off the hoisted function declaration.

**Guard — `worker/test/org_contact.test.mjs`, 16 tests, 8 red before the fix.** It scans the 17
canonical member pages **and the scripts they load**, because one offending site lives in a JS
template literal and a page-HTML-only scan would have reported four of five and called itself
clean. `site-nav.js` is deliberately **in** the corpus rather than excluded: the "exclude the
definer" trap does not apply (it holds a selector string, never an `<a>`), and inventing an
exclusion would have bought a control that tests nothing. The honest control is an anchor **count**,
and NC-3 plants a real offence inside `site-nav.js` to prove the script half is genuinely read.
The placeholder exemption is scoped to the attribute, not the address, and NC-2 proves it.

**Two superseded tests in `announcements.test.mjs` were REWRITTEN, not deleted.** Its NC-2 mutation
was literally *"add `admin_email`"* — which this change made the real source, so the `replace()`
became a no-op and the NC went red on its own `notEqual` line. That assertion is the only thing
standing between a negative control and vacuity, and it earned its keep. Its victim is now
`email_sender_address`: an operational column, chosen by what the rule forbids.

**Also:** `scriptsOf` moved to `worker/testkit/route-extract.mjs` under that file's own
third-consumer rule. It existed as two byte-identical private copies and B29 was the third; both
consumers now import it and keep all 19 of their tests, which is what verifies the move.

**Recorded, not fixed (D-30):** three further literal addresses live in server-side member-facing
error strings — `profiles.js`, `messages.js`, `webauthn.js`. Same rule, but each needs a judgement
this uniform sweep did not make (an unbound R2 namespace is a *platform* fault the org admin cannot
fix; the WebAuthn path may have no org in scope at all), so they are a separate unit rather than a
sixth site.

Suite **1792/1792** (1776 + 16, exactly the new file) · **123** test files · 51 modules · busters
**415/67** at 0.143.0, unchanged · ledger **0044**, no migration. Push first try, fifty-third
running; 14 consecutive health samples with no flap; five live byte-checks, two of them negative.

## v0.142.0 — 2026-08-12

### WF-5 H-4 — the live board's tile, read from across a gym. **The hub program is complete.**

K-7 measured this page and found the hard half already built: it polls every 25 seconds and diffs
against the previous payload with a stable row identity, so *"it should live update as scores are
entered"* was DONE. **Re-measured this session and it held** — `prev` is at module scope, `keyOf`
is `round:court`, and the diff drives every animation. None of it was touched.

**What was unbuilt was the tile.** The score rendered at `clamp(14px, 1.7vw, 17px)` — the same size
as the team name beside it — and an unstarted game rendered an **empty string** where its number
goes. On a TV across a gym that is a wall of uniform grey text with holes in it.

- **The score is now the headline**, `clamp(22px, 3.4vw, 40px)` against the name's
  `clamp(14px, 1.7vw, 18px)`; the guard asserts the score's floor exceeds the name's ceiling, so
  the hierarchy cannot be quietly undone.
- **An unplayed game shows an en dash**, one named constant for both sides, so the tile keeps its
  shape and "not started" is legible instead of looking broken.
- **The side that is ahead is emphasised** by weight and full-strength text while the trailing side
  dims — never by colour alone (standards §3), and never gold as text (uiux-review §1). A tie
  crowns nobody, and neither does a game with no result.
- **Seed chips**, where a seed exists. The payload gains `seed_a`/`seed_b` from `teams.seed`, the
  column the bracket unit began writing in v0.131.0. **Read live before building: 62 of 70 teams
  carry a seed and one event of six carries none**, so the chip is conditional and the fixture was
  given both cases — a fixture that cannot exhibit the defect is not a fixture.
- Tiles widen from 260px so the larger type has room; `auto-fill` still gives one column on a phone
  and a wall of them on a TV, and the same grid serves the hub's embedded frame.

**The team NUMBER was deliberately left off, and that is a measured decision, not an omission.**
K-1's tier-3 number (`board_no`) is *derived* — a correlated subquery inside `divisions.js:697`,
not a stored column — so putting it on this tile would copy that judgement into a second module.
K-1 tier 2 (§-0 B5) will change what the number means. The seed is a real written column; the
number is not. Recorded rather than guessed at.

**Every motion assertion written in v0.084.0 still passes against the redesigned tile** — that is
what extending `live_motion.test.mjs` rather than starting a second file bought. Seven new tests
across the two existing homes; the payload test's fixture now carries seeded and unseeded teams so
both halves of "only where a seed exists" are exercised. One negative control had to be rewritten:
it assumed a one-line CSS rule and silently found nothing to mutate — a control that cannot fail.

## v0.141.0 — 2026-08-12

### WF-5 H-3 — the all-events financial overview, and a premise that was already true

The owner's item 6: *"Registrations should have all the events and registrations listed for easy
access and financial review."* **The unit was queued as "add a JSON sibling of the revenue SELECT —
one query, two renderers." Re-measuring found that already built and never pinned.**

- **The SELECT lives in `sales()`**, behind `GET /api/admin/reports/sales`, which already returns
  `per_event` with event id, name, type, date, program, card cents, cash cents, registrations and
  total. **`revenueCsv` already calls that function** and renders its JSON as the CSV — its own
  comment says *"Same source of truth as sales()."* So H-3 added **no route and no query.**
- **It pins the property instead**, because an unpinned true thing is one refactor from being a
  false one: `revenueCsv` must call `sales()` and must not grow its own `FROM events`, with a
  negative control that re-inlines a SELECT and proves both halves of the detector fire. The
  column set is read from the shipped SELECT's own aliases rather than listed from a design.

**What actually shipped is the screen.** The top-level Registrations page's no-event state used to
say "Pick an event above." It is now the overview: **Event · Date · Type · Program · Registered ·
Paid (card) · Paid (cash) · Total**, each row ending in **Manage →** which opens that event's
manager hub, and a totals row across all of it.

- **A MODE, not a new page.** The rail's Registrations entry should land on it (item 6), and a new
  page would need a rail slot beside the one that already means "registrations". The mode is chosen
  by the `?event=` parameter the hub already passes — so the hub's Registrations tab, which always
  passes one, is untouched, and clearing the picker returns to the overview.
- **Third renderer, one source.** The screen reads the same route the CSV does. Money is
  `BT_ADMIN.money`, not a second formatter.
- **The status filters now hide while the overview is showing** — with no event chosen they act on
  nothing, and a control that does nothing is worse than one that is not there.

**An existing guard caught a live defect in this change before it shipped:**
`hidden_overlay.test.mjs` failed on `.filters`, which carries an author `display: flex` rule — so
`hidden` would have painted the filters anyway. That is the v0.119.0 lesson (author CSS defeats
`[hidden]`) and the fix is the `.br-pick[hidden]` precedent the guard's own negative control names.
Four new tests; three of them **green pre-build by design**, because they pin a property that was
already true — stated here rather than left to look like coverage that was never exercised.

## v0.140.0 — 2026-08-12

### WF-5 H-2 — the manager hub's remaining five tabs, and tab visibility by event type

The tab row from the owner's item 7 is complete: **Registrations · Divisions & Pools · Scoring
Links · Schedule editor · Scoring Edit · Live Scoring Board · Bracket**, each one the existing
page in a chromeless same-origin iframe.

- **"A tournament OR league management page" — his item 6 — is now literal.** The scoring surface
  is not the same page for the two, so the **pane** carries the type rather than the tab: Pool play
  (`tournament.html`) on a tournament, League weeks (`admin-league.html`) on a league. One tab, the
  right screen behind it.
- **Tab visibility by type, over the types the SCHEMA actually has.** A tournament and a league
  show every tab; **a drop-in session or event (SG-1's sheet types) and a court rental show
  Registrations only** — a sheet has no pools, no schedule, no scoring, no bracket. A tab that does
  not apply is **absent, never greyed out**: a disabled tab is a question the operator cannot
  answer. **The one deliberate exception is Bracket on a league** — WF-2 proved a filter that hides
  everything can delete the only way back in, and `admin-brackets`' own empty state plus its
  Generate panel IS that way in.
- **The approved design named an event type that does not exist.** Its visibility table carried a
  `tryout` row; `events.type` is CHECK-constrained to `tournament, league, training, event,
  court_rental` and tryouts are their own module. The guard **derives the type list from the schema
  and asserts the map matches it exactly**, which is what caught it — a hardcoded list would have
  shipped a rule nobody could reach.

**Two things moved, because H-2's Live tab is a MEMBER page.** `live.html` loads `app.css` and
`site-nav.js` and has never loaded the admin shell, so H-1's arrangement could not reach it:

- **The embed child moved from `admin-nav.js` to `config.js`** — the only script both shells load,
  which is why `BT_SIGNUP_LINK` already lives there. A copy in `site-nav.js` would have been a
  third implementation of one message.
- **The `body.embed` rule set moved from `admin.css` to `app.css`**, which every page in `web/`
  links, and grew the member rail's selector. Two rule sets for one concept is exactly what D-23
  and D-24 cost this repo.

Both pins moved with the code rather than being deleted, and NC-2 was rewritten to strip the rule
from `app.css` — left pointed at `admin.css` it would have passed for the emptiest possible reason.

**The `?event=` preselect reached its last three pages** (`admin-score-links`, `tournament`,
`admin-league` — a league's id IS its event id, which the schedule-editor link has relied on since
W-B). Additive as before: with no `?event=` every page behaves exactly as it does from the rail.

**Guard:** `manager_hub.test.mjs` v2.0, four new tests. Three of my own drafts were wrong before the
code was — a doubled escape, a control still aimed at the file the rule had left, and **a lazy
`] }` anchor that stopped inside the first pane and reported the League Manager missing from a list
containing it.** Ambiguous anchor, the fourth instance; bounded by the next tab's key instead.

## v0.139.0 — 2026-08-12

### WF-5 H-1 — the per-event manager hub: the shell and the first two tabs

Owner-approved 2026-08-12. `admin-manager.html?event=N` is one manager page per event, with the
tab row across the top the owner asked for in item 7 — and **each tab's content is the EXISTING
admin page, in a same-origin chromeless iframe.** Not a copy, not a fork, not a re-mount: a fix to
the Pool Board is a fix in the Pool Board.

- **Why an iframe and not a shared document.** Seven of the nine surfaces carry page-local
  `<style>` (the pool board alone is 200+ lines) and one tab is a member-side page with a
  different stylesheet set. One document would pour every tab's cascade into one place —
  standards §11 in the form that actually bites. The frame makes §11 structural instead of a rule
  someone has to remember, and an id collision between two tabs stops being expressible
  (`#eventSelect` exists on two of the nine today).
- **All seven tabs are declared now, in the owner's order** (`TABS`, one list); the renderer shows
  only the ones with panes, so an unbuilt tab is **absent, never a dead button**. H-1 wires
  **Registrations** (with **Waitlist** as its sub-tab, exactly as item 7 words it) and
  **Divisions & Pools** (with **Create Pools** as its second pane).
- **No reloads.** The open tab lives in the hash so a tab is linkable; frames are created on first
  visit and **kept hidden, never destroyed**, so returning to a tab is instant.
- **The embed contract is not new.** `schedule.js?embed=1` has posted `{bt_widget_height, slug}` to
  its parent since v0.4.0 and `web/widget.js` has been the parent that listens and filters by slug.
  `admin-nav.js` is now the second child and the hub the second parent. **They are two
  implementations rather than one shared file because `widget.js` is a drop-in `<script>` served to
  external customer sites and cannot import from this repo** — so what stops them drifting is a
  test asserting the message key is identical across all four, which is the only place that
  judgement can live. *(A build-time amendment to the approved design, recorded in §-1p.)*
- **Chromeless is ONE rule set** in `admin.css` (`body.embed` hides rail, header and edge handle),
  because the rail is static markup in every admin page — not forty per-page edits, and a page
  added tomorrow inherits it.
- **The `?event=` preselect is ADDITIVE.** `admin-registrations`, `admin-divisions` and
  `admin-pool-board` accept an event from the URL and otherwise behave exactly as they did from
  the rail. That is what makes this reversible: every tab page still works on its own, and the
  guard pins the fallback rather than assuming it.
- **Way in:** Events & Programs gains "Open manager →" beside the existing "Manage →" in both the
  list and the day modal. The summary page keeps its job.

**Guard:** `manager_hub.test.mjs` — the owner's tab order verbatim, panes that must be existing
pages, no navigation on a tab switch, frames cached, the shared `.tabs` component with no local
redefinition, the message key identical across all four embed files, one chromeless rule set with
none of the tab pages carrying their own, and the standalone fallback. Two guard drafts were wrong
before the code was: a flat scan of `TABS` returned tabs and panes interleaved, and the preselect
detector pinned `params.get("event")` while the code builds its `URLSearchParams` inline — **the
same pin-the-spelling trap as v0.138.0's, one release later.**

## v0.138.0 — 2026-08-12

### WF-6 — anywhere there is a print, there is now also email and CSV

The owner, 2026-08-11: *"Ensure anywhere there is a print, we also have email and download to CSV."*
Three print surfaces exist and the recording held on re-measure: the tournament pool sheet (CSV
already), the league weeks, the scoring-link cards. *A `window.print()` grep finds only two of the
three — `tournament.js` calls bare `print()` — so the corpus below matches the call, not the
spelling.*

- **Two CSVs added.** League weeks export one row per game, unplayed games included with empty
  score cells (a schedule that hid its unplayed games would be a results sheet). Scoring links
  export team + link. Neither export mints anything: **Get links is a POST that mints credentials,
  and an export that quietly writes is a rule this page already keeps** (E3, v0.91.0).
- **The email half is a REUSE, not a second sender, and that is the decision this release makes.**
  `marketing.js` already ships event-scoped segments (W-F, v0.99.0), campaigns, and a
  `sendCampaign` that is already honest about production having no mail key — and
  `admin-marketing.js` already accepts `?event=` and opens the segment form with that event
  chosen. `BT_ADMIN.emailDocument()` hands the printed document to that path, so the keyless
  honesty lives in ONE place and cannot drift. A second sender would have needed its own copy of
  it. **Recipient default, said out loud: the event's own registrants**, which is what `?event=`
  already selects; the operator confirms the segment, and pressing the button sends nothing.
- **The document travels through `sessionStorage`, not the URL** — a league schedule runs to
  thousands of characters. Read once and cleared; cancelling the segment form still keeps the
  draft, so the operator's work is never thrown away.
- `BT_ADMIN` gains **`csvRow`** — quoting a cell is a judgement, and it was about to be written a
  third and fourth time. `tournament.js`'s hand-rolled CSV escaper is retired to it.

**Guard:** `print_parity.test.mjs` states the owner's sentence as a rule about a SET — any page
whose own scripts call `print()` must also offer a CSV download and the shared email hand-off — so
a fourth print surface fails on the day it is added. Four of eight watched failing pre-fix. **The
shared helper module is excluded from each page's corpus, and NC-5 proves that exclusion is the
check**: `admin-nav.js` defines `emailDocument` and every admin page loads it, so a scan that
included it would clear ten-plus pages that offer nothing.

## v0.137.0 — 2026-08-12

### Three recorded defects, one shape: a reference that resolves nowhere

- **D-23 — screen-reader-only text was rendering as visible text on fourteen pages.** `.sr-only`
  was defined in four page-local `<style>` blocks and used on eighteen; the fourteen that never
  defined it showed their hidden captions, legends and labels as ordinary words. One rule now
  lives in `app.css` (every page links it) and the four copies are deleted, the same shape as the
  v0.51.0 shared-button promotion. *Re-measured before fixing: the register named help.html, which
  carries its own inline `left:-9999px` and was never visibly broken, and missed twelve pages that
  were.*
- **D-24 — the Court Board's headings were unstyled.** `.pb-div-h` / `.pb-courts` were defined
  only inside `admin-pool-board.html` while `admin-kotc.html` used both, so three headings rendered
  at default `h2` size and two counts as plain text. Both base rules moved to `admin.css`; the pool
  board keeps its own `.pb-workspace .pb-div-h` override, which is page layout and not the class.
- **D-29 — every "View" button on the member home landed on "Missing event".** `home.js` linked
  `register.html?event_id=` while `register.js` reads `?event=`. The rule that decides where a
  sign-up link points was written out twice (`schedule.js`, `admin-event.js`) and the third site
  that needed it wrote its own — so it is now `BT_SIGNUP_LINK` in `config.js`, page and parameter
  together, with three callers. The member home also gains the SG-1 fork it never had: a drop-in
  session opens its sheet, a team event the registration form.

**Guard:** `dangling_refs.test.mjs` — a page must resolve every promoted class from something it
actually loads (its own `<style>` plus the stylesheets it links; uses come from its markup plus the
scripts it loads, which is standards §11 by construction), each promoted class must be defined in
the shared stylesheet named for it *before* any page copy is deleted, no page may redefine one,
every `register.html?`/`sheet.html?` link must carry the parameter the target page actually reads
(derived from `register.js`/`sheet.js`, never assumed), the drop-in fork must exist in exactly one
file, and every page whose script builds a sign-up link must load `config.js` first. Eight of nine
watched failing before the fix. `pool_board_pivot.test.mjs`'s D-24 pin and `signup_sheet.test.mjs`'s
fork pin were rewritten to follow their judgements to their new homes, never deleted.

## v0.136.0 — 2026-08-12

**WF-4 — the registrations screen sees waivers, and can chase them (owner brief 2026-08-11 item 8; roadmap §-1p, §-0 B26).** Measured half-built: the checking and the auto-send already existed — the daily sweep selects unsigned roster members through the door gate's own identity/liveness pair and reports email keyless-honestly. This release surfaces them:

- **A Waivers column on the staff registrations list**: each team shows `signed/total` — green when complete, amber when short (the page's existing chip idiom), with a tooltip counting unsigned members who have no email address ("catch them at check-in"). Team-less sheet sign-ups (SG-1) aggregate over their own registrant. **The counts read the door gate's canonical predicate pair — one judgement, so the door roster, the nightly sweep, and these chips can never disagree about who is unsigned** (a case-variant email and an expired waiver are both pinned by tests).
- **A "Send waiver reminders" button** on the same screen — the sweep's selection and sender, extracted into ONE shared pair of functions, gain their second caller (B16's one-helper-first shape). Staff-gated; the sweep's 2-day dedupe binds it too (a double press does not double-nag, and says so); members with no address are counted rather than silently skipped; and with no mail key set the response says plainly that nothing was emailed while the in-app reminders stand.
- **The F-27 guard was rewritten, not deleted**: it now anchors on the shared selector (where the canonical pair lives) and additionally pins that the sweep still routes through it — a re-inlined copy is the drift it exists to prevent. One guard draft reddened against correct code by scanning the whole file for bare email compares (the file has lawful ones); it was re-scoped to the waiver-reading functions, the same scoping decision the original F-27 guard documented.

8 new tests in `registrations_waivers.test.mjs` (6 seen failing pre-fix; the fixture pin and the sweep-semantics pin deliberately green); suite 1713 → 1721. No migration.

## v0.135.0 — 2026-08-12

**WF-3 — the pool board's divisions pivot horizontal ↔ vertical (owner brief 2026-08-11 item 4; roadmap §-1p, §-0 B25).** A new segmented control sits above the board, in the owner's own words: **Horizontal** keeps today's layout — each division a full-width band with its pools flowing across; **Vertical** stands the divisions side by side as columns and stacks each division's pools, so a three-division day fits on one screen with no scrolling between divisions.

- **Same discipline as the waiting-area toggle it mirrors (T2-8):** one list (`PB_DIV_VIEWS`), and the buttons, the stylesheet and the list are asserted to be the SAME SET — both values carry an explicit rule so the check stays real. The choice persists in the browser (`bt_pb_divview`), is validated on restore so a poisoned value never becomes the layout, never marks the board unsaved, and is wired at boot (never inside `wire()` — D-6).
- **The pivot is CSS-only**: `render()` emits identical markup for both orientations, so a pivot that drops a division is structurally impossible — pinned by a guard that asserts `render()` never reads the view. Drag-and-drop and the keyboard path are untouched (both attach by element, not geometry). The new buttons live inside the existing `pb-seg` styling and inherit its press feedback and reduced-motion gates. D-24's borrowed classes (`.pb-div-h`, `.pb-courts`) are pinned unrenamed.
- **A guard defect caught mid-unit, worth recording:** the first draft anchored on `"function render"`, which matches `renderSuggestions` first — the test interrogated the wrong function and reddened against correct code. The extraction helper now asserts its anchor is UNIQUE in the source before using it (`function name(` with the paren). Assert uniqueness before anchoring — this repo's oldest lesson, now enforced inside the harness itself.

7 new tests in `pool_board_pivot.test.mjs` (6 seen failing pre-fix; the D-24 pin is deliberately green and carries its own rename control); suite 1706 → 1713. No migration.

## v0.134.0 — 2026-08-11

**WF-2 — the bracket board shows only ACTIVE brackets (owner brief 2026-08-11 item 3; roadmap §-1p, §-0 B24).** Production carried **eleven live matchless bracket rows rendering as empty trees** (event 90006 held ten — five failed A/BB generation pairs; 90003 one). The mechanism was read from the code, not guessed: `generateBracketFor` INSERTs bracket rows BEFORE writing matches with no transaction, and its replace-cleanup fires only when live MATCHES exist — so a failed attempt strands its rows and every later attempt skips the cleanup.

- **`loadBrackets` now returns only trees that have live matches.** This can never hide a real bracket: `planFor` validates every tree before anything is written and `buildTree` refuses fewer than two teams, so a legitimate generation always writes matches for every row it inserts. When nothing survives the filter, the page's empty state and Generate button remain the way in — pinned.
- **Generation self-heals its own debris**: live-but-matchless bracket rows for the event are soft-deleted (never hard-deleted) on the write path, before new rows are inserted. A refused generation (409, bracket exists, no `replace`) stays write-free — lingering strands stay off the board via the filter until a real write heals them. **The 11 production strands heal themselves the next time the owner generates on those events — no manual database surgery was done or needed.**

**Also this session, recorded (roadmap v1.33, §-1p WF-6 / §-0 B28):** the owner's print rider measured — three print surfaces exist (tournament pool sheet, league weeks, score cards); the pool sheet already ships CSV; the league page ships "Copy as text" and score-links ships per-team PNG save (send-it-yourself affordances); direct email exists on none and **absorbs B10 (T2-2/K-6)** with its keyless-honesty constraint.

5 new tests in `bracket_active.test.mjs` (3 seen failing pre-fix; the two greens are deliberate pins over pre-existing contracts, each with its own control); suite 1701 → 1706. No migration.

## v0.133.0 — 2026-08-11

**WF-1 — the Events & Programs page (owner brief 2026-08-11 item 1; roadmap §-1p, §-0 B23).** Two defects on one page, both measured before building:

- **The calendar has even rows now.** A day cell shows at most `CAL_DAY_CAP` (3) event tiles; a busier day gets an honest **"+N more"** button that opens the whole day in a modal — every event with its status, time and Manage link, at full target size. `admin.css` pins the grid to `grid-template-rows: auto repeat(6, 1fr)`, so the six week rows share the height equally and a busy week can no longer tower over an empty one. Visible tiles stay draggable (reschedule-by-drag survives the cap).
- **The Views & Embed tab is alive again.** `renderViews()`/`viewModal()` have read a global `orgs` since v0.4.0, and **no script on the page ever defined it** — admin-nav's copy is closure-scoped — so every `loadAll()` ended in a silent `ReferenceError` after the calendar and list had painted, and the Views table rendered empty. As old as the v0.52.0 consolidation, invisible because the page looked alive. The page now declares `orgs` and fetches `/api/orgs` alongside its other three loads.

**Also this session, recorded in the roadmap (v1.31, §-1p): the owner's full 8-item brief, measured item by item** — WF-1 (this release) · WF-2 bracket board strands (11 live matchless bracket rows verified on production, mechanism identified: non-atomic generation + cleanup keyed on matches) · WF-3 pool-board division pivot (extends T2-8's existing `data-view` mechanism) · WF-4 registrations × waivers (the sweep, predicate, dedupe and keyless honesty already exist; the gap is the list surface + on-demand send) · WF-5 the per-event manager hub (items 2+5+6+7 — a program with a design moment first, queued B27).

7 new tests in `events_calendar.test.mjs` (all 7 seen failing pre-fix after the negative control was strengthened); suite 1694 → 1701. No migration.

## v0.132.0 — 2026-08-11

**SG-1 — the drop-in sheet (roadmap §-1o; the SignUpGenius replacement's core).** An event of type training/event now has a PUBLIC sign-up sheet at `sheet.html?event=N`: capacity, live count, who's coming, one-tap sign-up for a signed-in member, name+email for a guest.

- **Two public routes in registrations.js** (it owns registration and contact writes): `GET /api/events/:id/sheet` and `POST /api/events/:id/signup`. A sheet sign-up IS a registration (`team_id`/`waiver_id` NULL — nullable since migration 0001), so the count, the staff Registrations screen, cancel-and-notify and the waitlist all see it with no new plumbing.
- **Standards §8 on a no-login surface:** names render "First L." via `personName` (full name only when the member chose public visibility); a nameless row is "Guest", never an email local part; the payload carries no email, phone or contact id — pinned by a recursive walker that is positive-controlled against the staff list payload.
- **One judgement of "taken":** the count, the attendee list and the atomic capacity INSERT all read `ACTIVE_REG_STATUSES`, now exported from waitlists.js — no third hand-rolled copy.
- **Free vs priced (§-1m Q5 rider):** free completes as `comped`; priced runs the existing Square link path (tier discount written to the row) — never a silent free registration. Cash stays a register.html capability.
- **Guest hygiene (D-13 + widget idiom):** junk email is refused with nothing stored; dedupe by lowercased email; a sheet sign-up never clobbers a stored contact name (fill-if-empty only); honeypot pretends success; a per-event flood band answers 429.
- **A session owns the identity:** the one-tap takes the email from the account — signing somebody else up is not expressible; `need_name` asks for a name only when the account and contact carry none.
- **The advertised links fork by type:** the schedule page CTAs and the admin event screen's copyable public link point drop-in types at the sheet; team types keep register.html.
- **Deliberately not here:** no DOB/age gate (same exposure class as the public waitlist join; the 18+ gate is LFG/subs-only), no waiver signature (the check-in door gate owns waivers), no cancel-under-threshold (that is SG-2 — the sheet shows the count honestly).

19 new tests in `signup_sheet.test.mjs` (18 seen failing pre-fix); suite 1675 → 1694. Member-page ratchets consciously bumped 16 → 17 for sheet.html (generated from register.html's bytes). No migration.

## v0.131.0 — 2026-08-11

**B3 — the bracket reads like a tournament sheet: seed numbers on the tiles, real connecting
lines, and a live dot.** K-2 + K-3 + K-4 as one release, one screen — plus the owner's five
marketplace questionnaire answers recorded and two new asks measured (roadmap v1.29).

**K-2 required a server change, and the v0.125.0 lesson is why.** The seed order existed only IN
MEMORY while `generateBracketFor` built the tree — `teams.seed` is read as the entry-seed fallback
but no real path wrote it, so a tile rendering it would have shown numbers in every fixture and
nothing on any real event. **Generation now STAMPS each bracketed team's seed** (1..n per group, A
and BB restarting; regeneration restamps; the slot editor never touches it — a dragged team keeps
its seed because "the #6 upset the #1" is how brackets talk, and a walk-on subbed into a slot
honestly has NO chip). The payload carries `seed_a`/`seed_b`, and the tile chip renders the owner's
two forms: **`#1 A`** when a pool tag derives from the real pool name, **`#3`** when it does not —
never an invented letter. The guard's pair property is DERIVED, not declared: for a full field,
round-one seeds sum to n+1, asserted from the same inputs the tree used.

**K-3 — connecting lines.** `.br-line` turned out to be the score row INSIDE a tile (a selector's
name is not its behaviour); the tree had no connectors at all. Now: one absolutely-positioned,
pointer-transparent SVG per tree, drawn by MEASURING the real tiles (`getBoundingClientRect`) —
never computed from assumed heights, because one long team name changes a tile's height and
hardcoded geometry draws lines through tiles. Later rounds centre against the column feeding them,
elbows join match → next-round slot by the same ceil(slot/2) rule `buildTree` uses. Redrawn on
render and on resize — the resize listener wired ONCE at boot, never in `wire()` (D-6).

**K-4 — the live dot, defined from what the data can truthfully say.** Score entry is one POST of
the final result, so "in progress" is not a stored state; the honest green dot is **READY** — both
slots filled, unscored: this game can be on a court right now. The done marker migrates from the
3px coloured side-tab — **D-10's recorded cliché, on this exact line of this exact page** — to the
same dot idiom (muted dot). The pulse is opacity-only, 2.4s, and lives entirely inside a
`prefers-reduced-motion: no-preference` block; with reduced motion set the dot simply stays solid.

**Guard — `bracket_tiles.test.mjs`, 13 tests, 11 seen failing pre-fix.** Three test drafts were
wrong and the code was right: the "round one" index read the wrong end of the rounds array (the
Final's TBD slots), the seedChip executor forgot the function composes with `poolTag`, and a slot
"swap" set a side to its own opponent — which the server rightly refused as "a team can't play
itself." One fixture correction: `include_rest` defaults TRUE (the owner's "a tenth-place team
still plays" rule), so keeping a genuine walk-on needs the explicit false.

**Questionnaire recorded (§-1m):** partner = configured organizations + free-text pending APPROVAL
(the project's first approval workflow — design with SG-3's per-account toggles, one mechanism) ·
partner events on the separate marketplace page only · staff-edited now, self-service maybe later ·
backlinks point at the outside registration · **sheets first, page later**. Two riders measured
before recording: **K-14** events-list sort tabs (the `.tab` mechanism already exists on
`schedule.js:21`) and **K-15** Square catalog items for priced events (**the catalog-write
machinery already exists** — `memberships.js:86-100` creates Catalog objects via `sq()`; the gap is
event ITEMs, correct naming, and the per-organization credential question, which is owner config).

No migration. Suite 1662 → **1675**; 112 → **113** files.

## v0.130.0 — 2026-08-11

**B2 / K-11(ii) — a member sets their own display name. And re-measuring the premise found the
record wrong one level deeper: the column was unwritable for EVERYONE, not just for members.**

K-11 recorded two halves: (i) "an admin can fix his name today, no release required" and (ii) "a
member cannot set their own." **Half (i) was FALSE.** A positive-controlled grep for `UPDATE users`
matches nothing in the worker — the sole hit is a planted sabotage string inside a test —
and `admin.js addUser` sets `display_name` only when it INSERTS a brand-new user, silently
discarding it for an existing one while returning ok (**recorded as D-27**, the
success-it-did-not-achieve family: an admin types a correction, reads ok, nothing changed). So
`users.display_name` has had NO writer for existing accounts since the column was born, and the
owner's `vvisuth` was fixable by no path at all. **This release ships the first one.**

**`PATCH /api/me`** — session-gated beside `GET /api/me`, and the session IS the target: the
handler never reads an id from the body, which makes "rename someone else" **structurally
impossible rather than merely refused** (pinned: a body carrying another user's id changes only the
caller's row, and the other row is asserted unmoved). Whitespace clears to **NULL, never an empty
string** — `""` is truthy enough to blank every `(display_name || email)` greeting fallback. Junk
is refused wholesale (wrong type, over 80 chars, missing key) writing nothing. Audited with before
and after.

**The D-18 decision, taken and pinned:** editing the display name **never touches
`contacts.full_name`**. The display name is account presentation — greetings, what a passkey
registers under; `full_name` is the identity spine two resolvers already disagree about (D-18),
and members already edit it on the Profile page (`profiles.js update()` — found in the same
re-measurement: self-service NAME editing partially existed, for the contact identity).

**UI:** the Settings Account card gains a Display-name row (input + Save, seeded from `/api/me`,
honest save copy: "Saved — greetings will call you X" / "cleared, so greetings use the front of
your email"). Wired inside `render()` like every row on that page — render rebuilds `#app`
wholesale, so listeners cannot stack (the D-6 shape does not apply here, and the comment says why).

**Guard — `display_name.test.mjs`, 9 tests, 7 seen failing pre-fix.** The two green-before-fix are
deliberate: the D-18 pin (meaningful only post-fix, kept because it exercises the real route), and
**the D-27 PIN — a test asserting `addUser` still silently discards the name for existing users,
green today by design, with instructions in its own text that the D-27 fix must REWRITE it** (the
catalogued pin-the-absent-control pattern).

**Also recorded, not chased (D-20):** `settings.js:69` carries a literal org email
(`admin@boomtownvb.com`) in member-facing copy — an F-40/standards-§8 violation as old as the page
(**D-28**).

No migration. Suite 1653 → **1662**; 111 → **112** files.

## v0.129.0 — 2026-08-10

**B16 — cancelling an event now TELLS the people registered for it.** P-C's genuinely missing half
(the Cancel button, series-cancel and the bulk editor all flipped `status='cancelled'` and notified
nobody — the people who paid found out at the door), and the exact workflow the owner's
correspondent lives: cancel a session when not enough people sign up.

**THE EGRESS WAS ENUMERATED AND THE PROMPT'S "TWO SITES" WAS WRONG — THERE ARE THREE** writers of
`status='cancelled'`: `patchEvent` (the UI's Cancel button, `tournaments.js`), `cancelSeries`, and
`bulkEdit` with a status field (`events_admin.js`). All three now call ONE helper.

**`notifyEventCancelled` is deliberately the substrate for the owner's 2026-08-10 requirement** that
an event screen can *"contact and email the participants with information or news"* — the recipient
selection (active registrants of an event, one message per member) is the reusable part; the
cancellation copy is just this first caller's message.

**The rules, each pinned by `event_cancel_notify.test.mjs` (9 tests, 7 seen failing pre-fix):**
- **Active registrants only**, statuses read from the schema's CHECK constraint, never guessed — a
  registration the member already cancelled hears nothing, and the NC flips that real row to prove
  the filter reads the data.
- **Transition only** — re-saving an already-cancelled event notifies nobody twice, including an
  already-cancelled event inside a bulk batch, and a series instance cancelled before the sweep.
- **One notification per member per event** — two teams, one message (DISTINCT at the query).
- **Honest about email.** In-app notification rows always (the inbox needs no mail key); email only
  where `BREVO_API_KEY` exists AND the contact has an address. With no key — which is production's
  state today — the response and the director's alert say plainly: *"N member(s) have an email
  address, but no mail key is set — nothing was emailed. Everyone still sees this in their member
  inbox."* `with_email` pins the would-email logic keyless; the actual Brevo send stays untested
  like every other `sendEmail` caller, by the suite's keyless design.
- **Audited from ONE place** (`event.cancel_notified` with events/notified/with_email/emailed), and
  a refused member call notifies nobody.

`sendEmail`/`escapeHtml` reach `events_admin.js` by injection (`wireEventsAdmin({ ...wiredHelpers,
sendEmail, escapeHtml })` — the waitlists precedent, no cycle); `tournaments.js` imports the helper
from `events_admin.js`, which imports nothing. The `index.js` diff is exactly two lines: that wire
line and the version bump.

**Owner answers recorded this session (roadmap §-1o):** Cathy's role sees **full contact details**
(emails and phone numbers), and her event screen must be able to **message/email the participants**
— which is this helper's second caller, queued with SG-5.

No migration. Suite 1644 → **1653**; 110 → **111** files.

## v0.128.0 — 2026-08-10

**P-1 — each organization's admin menu now shows only the modules it uses.** Roadmap §-1l, §-0 B1,
and the answer to the owner's "replicating the system 3 times" complaint delivered as a VIEW filter
rather than the authorization rewrite the literal proposal would have been.

**Migration 0044** (`orgs.modules_off_json`) — applied to live D1 and read back before this ships:
MAX(id)=44, COUNT=44, MAX(version)='0044', column present, **every row NULL — so the deploy itself
changes no screen.** Storing the OFF list is the design: NULL hides nothing, and a module added to
the registry later appears everywhere without anyone re-saving.

**ONE REGISTRY.** `window.BT_MODULES` lives in `admin-nav.js` — the file every admin page already
loads — with 14 module keys mapping to rail pages. The org-settings screen renders its checkboxes
from that same object and carries NO list of its own; the server stores an opaque sanitized slug
array and keeps no registry at all. One list, two consumers, zero copies. **The registry is also the
intended substrate for the owner's 2026-08-10 events brief** (per-ACCOUNT module toggles for a
non-staff operator like Cathy): keys, not pages, are the stored vocabulary, so the same keys can
later hang off a user grant as well as an org row.

**The three properties, pinned by `org_modules.test.mjs` (13 tests, 12 seen failing pre-fix):**
1. **A view filter, never a permission.** Hiding "marketing" and then calling a marketing route
   answers byte-identically for staff and member alike — asserted before/after on the real route.
2. **Never a lockout.** The registry structurally cannot name admin.html, admin-org-settings.html,
   settings.html, admin-security.html, admin-users.html or admin-events.html, and the org-settings
   rail link is pinned PRESENT — the way back is asserted by presence, not implied by omission.
3. **Default ON.** NULL column, empty list, and unknown keys all hide nothing — the filter fails
   open to a fuller menu, never an emptier one.

**The decision logic runs as shipped bytes:** `pagesToHide` is extracted with `functionBodyAfter`
and executed — the multi-owner rule (the schedule editor belongs to leagues AND tournaments and
hides only when both are off) is exactly what a text scan would vacuously bless. The rail filter
REMOVES nodes rather than setting `[hidden]`, because author CSS on `.nav-item` defeats the hidden
attribute — the v0.119.0 lesson, applied at design time.

Sanitation refuses wholesale (non-array, >32 entries, non-slug strings → 400, nothing written) —
a config write that silently drops half its input is a control reporting success it did not
achieve. Every change is audited (`org.modules.update`, before/after).

The schema ratchet reddened on the new migration and was moved to 0044 only after the live
read-back — the fourth time it has earned its keep, recorded in its own comment.

Suite 1631 → **1644**; 109 → **110** files. Migration ledger **0043 → 0044**.

## v0.127.0 — 2026-08-10

**Duplicating an event now carries its divisions — the genuinely missing half of a feature that
already existed. And the proposals section is corrected, because my verification greps were broken.**

**THE CORRECTION COMES FIRST, BECAUSE THE OWNER APPROVED PROPOSALS ON BAD MEASUREMENTS.** §-1n
(v1.24) claimed five features "verified unbuilt" on greps of the worker. The greps used `\|` inside
`grep -E`, which matches a **literal backslash-pipe** — so every multi-alternative pattern searched
for a string that cannot occur, returned nothing, and "no matches" was read as "not built."
**Measured properly (§-1c D-26): FOUR of the five proposals describe features that already exist.**

- **P-A duplicate an event — BUILT AND WIRED.** `POST /api/events/:id/duplicate`
  (`events_admin.js:130`) and a Duplicate button on the event screen (`admin-event.js:107`), plus a
  whole `event_templates` system beside it.
- **P-B waitlist auto-promote — BUILT.** `offerNext` with a TTL and a sweep; the registration flow's
  own copy says "we'll offer you the next open spot."
- **P-D seasons/series — BUILT.** `createRecurring` (weekly/biweekly/monthly), series edit-forward
  and cancel-forward, wired into the event screen ("Part of a recurring series").
- **P-C cancel-and-notify — HALF BUILT.** The Cancel button exists and flips status; **nobody is
  told.** No notification or email path touches either cancel site. That half is real and is queued.
- **P-E the day sheet — genuinely unbuilt.** The only proposal of the five that stands as written.

**WHAT SHIPPED: the real gap inside P-A.** The copy took the events ROW only (`cleanEventBag`
iterates `EVENT_FIELDS`), so a league duplicated for next season arrived with **no divisions** — and
for the owner's stated use case, the divisions ARE the configuration: Open/A/BB, their order, their
court ranges. `duplicateEvent` now copies the source's **live** divisions onto the new draft
(name, rank, court range, target bracket size, notes — new rows, never shared ones), reports the
count in its response, and records it in the audit row. **The boundary stays absolute the other
way:** teams, registrations, matches and standings are a season, never configuration, and the guard
pins all four at zero on the copy — a duplicate that brought registrations along would re-register
a whole field in one press.

**Guard — `worker/test/event_duplicate.test.mjs`, 7 tests, the FIRST route-level coverage the
feature has ever had; the three division assertions were watched failing against the shipped code.**
One assertion was wrong and was corrected rather than the code: the first draft invented an
`audit_log.payload_json` column instead of reading the schema (`detail_json`) — a name guessed is a
name wrong.

**Known residual, recorded not chased:** `EVENT_FIELDS` omits `ends_at`, so a copy keeps its start
and loses its end. Minor for the next-season case (dates are retyped anyway); noted for the next
touch of `events_admin.js`.

**Route-reachability blind spot noted:** the D-4 guard scans `/api/admin/*` shapes only;
`/api/events/:id/duplicate` and its siblings live outside that prefix, so built-but-uncalled at
THAT shape is invisible to the ratchet. Recorded in D-26's row.

No migration. Suite 1624 → **1631**; 108 → **109** files.

## v0.126.0 — 2026-08-10

**Stale sub requests and community games drop off the boards, the feed and the home card.**

Owner 2026-08-10: *"For the sub finder and game finder — please ensure that after the event expires
the event drops out of the announcements and list."*

**MEASURED FIRST, AND IT WAS WORSE THAN REPORTED.** Five member-facing queries selected
`status='open'` with **no time predicate at all** — and `subs.js` orders by
`COALESCE(needed_at, created_at) ASC`, oldest first, so an expired request was not merely still
present, it was **the first thing a member saw**. The owner's word "announcements" was literal:
`announcements.js` runs its own copies of both queries, so a fix applied only to `subs.js` and
`lfg.js` would have left the home feed stale and the complaint half-answered.

**ONE RULE, ONE DEFINITION.** `notPastSql(col)` is exported from `subs.js` — the leaf module
`lfg.js` and `announcements.js` already import for the shared volleyball vocabulary, so no new
module and no cycle. Five copies of a predicate is five chances for the sixth surface to be written
without it, and a test asserts all five call sites reach for the helper rather than restating the
SQL. It interpolates a column name, so it **fails closed** on anything that is not a bare
identifier — and the test that proves it caught a real hole: `String(null)` is `"null"`, which
passes an identifier check and emits `date(null)` — always NULL, therefore always "not past",
therefore **the filter silently disables itself**. `typeof` is now checked first.

**DAY GRANULARITY IS A DECISION, NOT LAZINESS.** `needed_at` is frequently date-only
(`normalizeRequest` makes the time optional), and `datetime('2026-08-10') < datetime('now')` is true
from one second past midnight — which would hide a request on the morning of the day it is needed.
`date(x) < date('now')` keeps it all day and drops it the next.

**THE FORMATS WERE VERIFIED AGAINST THE REAL ENGINE, NOT ASSUMED.** The two writers disagree: the
browser sends `new Date(v).toISOString()` (`web/assets/lfg.js:206`) while the seeder writes
`datetime('now','+6 days')`. Live D1 was asked directly — `date()` resolves the ISO-with-Z,
space-form, `T`-short and date-only shapes alike, and returns **NULL** for junk. NULL comparisons
are never true, so anything unparseable **stays visible**: the filter fails open, which is the only
safe direction for a hide.

**THE EXITS WERE ENUMERATED BEFORE ANYTHING WAS REMOVED, AND BOTH BOARDS HAD ONE.**
`web/assets/lfg.js:112` is the **only** trigger for "Report a no-show", and it renders from
`/api/lfg/listings` on a card that is `mine && past` — filtering own rows there would have made
`report-no-show` unreachable, growing the D-4 uncalled baseline and killing the no-show
accountability feature in silence. The same shape sits on the sub board: both caps count
`status='open'` with no date filter and refuse with *"Cancel one before posting another"*, so hiding
a member's own stale rows would make the product's own instruction impossible to follow. **The rule
is therefore one sentence: a stale row leaves the boards, but never leaves its own author's view.**
Every removal ships beside the presence test that proves its exit survived, and a further test pins
that the caps still count those rows — the fact that makes the exits necessary.

The two anonymous/non-actionable surfaces (`/api/lfg/opportunities`, the `/api/home/feed`
categories) filter unconditionally: no actions, so no exit to preserve.

**Found while writing the guard, and it settles the house style:** the feed's `events` category has
**always** filtered `starts_at >= datetime('now')` (`announcements.js:145`). Dropping past items was
already the convention on that very screen; subs and community were the two categories that never
got it.

**Guard — `worker/test/stale_listings.test.mjs`, 14 tests, 6 of 12 seen failing before the fix.**
Two of the corrections went into the CODE rather than the test: the `null` hole above, and the
call-site count, which read 2 for `subs.js` because the file also DEFINES the helper — the same
declaration-versus-call-site distinction `gateCallsIn` exists for. A pre-fix test asserts the
fixture's "past" rows are genuinely past by the engine's own reckoning, so the file cannot go
vacuous. No migration. Suite 1610 → **1624**; 107 → **108** files.

## v0.125.0 — 2026-08-10

**§-1j T2-8 — the pool board's waiting area, and the four things the owner asked it to do.**

Owner: *"Pool board works but the teams list does not scroll and it overlaps the pool drag area when
you have several teams. This needs to be fixed size or collapsable but makes it hard to drag. The
teams should pull or have their team level they registered with as well. There needs to be a sort
button for teams either by level, team name, captain name, etc. Add a horizontal view vs vertical
view."* Plus, this session: *"add team numbers on the teams in addition to captain names based on
assignments to double check."*

**The overlap was a CASCADE defect and no markup test could ever have seen it.** `.pb-workspace`
shipped as `position: sticky; bottom: 0` with a list that wrapped unbounded, so thirty unplaced
teams became thirty rows of overlay across the pools a director was trying to drag onto. Every byte
of the markup was correct. The ceiling now goes on the LIST (`max-height` + `overflow-y: auto`),
because bounding the list bounds the section that holds it — the sticky strip stays a strip at any
team count. Phones were never affected (the sticky is dropped under 700px), so this was always a
desktop and tablet fix. A **Hide** control gives the owner's other stated option outright.

**Horizontal vs vertical.** The pools and the waiting area now sit inside one `#pbSplit`, because
the orientation is a relationship between them rather than a property of either. `bottom` is the
strip; `side` makes the bench a grid TRACK beside the pools, where it cannot overlap them at all —
a column has no z-order argument with its neighbour. Under 900px the side view falls back to the
strip: the preference is remembered, not obeyed into a layout nobody can drag on. The two names
live in exactly one place (`PB_VIEWS`), and the guard asserts the script, the buttons and the
stylesheet are the same set — the defect class this repo has now paid for three times.

**The registered level reaches the board.** `teams.level` has existed since the first schema and
`loadBoard` never selected it, so no amount of client work could have shown it.

**The team number is the interesting one, because every obvious source for it was wrong.** `seed` is
NULL for every registered team — only the sandbox seeder writes one, so a `#seed` badge would be
blank on every real board. `board_order` is rewritten to the team's index WITHIN ITS POOL on every
save, so a number derived from it changes the moment the board is saved, which is the one thing a
checking number must never do. `id` is stable but global (90001). So `board_no` is the team's rank
by `id` within the event — registration order, the order the director's own export is already in.
Soft-deleted teams are counted but not returned, so a withdrawal leaves a **gap** rather than
renumbering everyone below it, exactly as scratching a name off a paper list does. All three
properties are asserted, the stability one against a save that provably rewrote `board_order`.

**Sorting** groups the bench by team name, level, captain or seed, and is a VIEW change: it never
marks the board unsaved, because the workspace order is not part of what Save writes. Sorting by
level GROUPS by the registered label and does not rank it — the labels are free text out of the
registration form (`BB/A`, `A/AA`, `Open`) and no stored ordering for them exists; inventing one
here would be a skill ranking nobody agreed to.

**Guard — `worker/test/pool_board_bench.test.mjs`, 19 tests, seen failing 14-of-16 before the fix.**
Three kinds of evidence for three kinds of claim: route tests for level and the number, a CSS
assertion for the overlap (with an NC that restores v0.124.0's unbounded state byte-for-byte), and
an executable test for sorting that rebuilds the shipped `sortTeams` from its own bytes with
`functionBodyAfter` + `new Function` — a text scan for the word "sort" would pass over a comparator
that returns 0, which is exactly what its NC builds. Expectations are properties derived from the
fixture (non-decreasing, a permutation, blanks last), never a hand-written target order, and one
test asserts the fixture is unsorted on every key so none of the others can be vacuous.

**Two guard assertions were wrong and were corrected rather than the code.** One demanded the view
buttons' ids appear in the page script; they are addressed by `data-pbview` on purpose (one loop, no
id list to drift), so the guard was pinning a spelling — D-17b's lesson. The other tried to regex
across an `aria-label` built from a template literal containing its own double quotes.

The new controls are wired ONCE at boot and a positional test keeps them out of `wire()`, which
stacks handlers on every render (§-1c D-6). No migration. Suite 1591 → **1610**; 106 → **107** files.

## v0.124.0 — 2026-08-10

Tester round 2, item 5's remaining half — round one no longer repeats pool play. The owner's rule: "aim to have the system have opponents be from separate pools but still in bracket. Example in 2 pools of 4 teams, #1 A plays #4 B." The bracket builder pairs seed numbers (1 v N, 2 v N-1), so who meets whom is decided entirely by the order of the seed list — and that list came straight off the event-wide pool finish, which puts a pool's best and worst at opposite ends, exactly where standard seeding pairs them. Teams that had just played each other in pool play met again in the first bracket game. The seed list is now arranged so paired positions come from different pools wherever the arithmetic allows, applied AFTER the top-X-into-A split so the split still goes by finish, and skipped entirely for a hand-picked seed order. Three invariants ride with it, each pinned: the teams that earned byes keep them (byes go to the top finishers, untouched), each pool's own finishing order is preserved so nobody is seeded above a poolmate who beat them, and the arrangement is a total mapping — every team in, exactly once out, because a reordering that silently dropped a team would satisfy "no rematch" trivially. Events with one pool or no pool assignment are returned untouched, so every bracket already drawn stays as it was. The guard measures against a DERIVED floor rather than a hoped-for zero: byes are taken by the best finishers, so equal pool sizes do not mean equal representation in round one, and some rematches are pigeonhole arithmetic rather than defects.

## v0.123.0 — 2026-08-10

Tester round 2, item 11 — "the menu buttons lead into admin pages not membership views" — and the blind spot in the check that should have caught it, fixed together. The member card grid on the signed-in front door offered staff four admin destinations: Tournament Ops, Member Management, Registrations and a Foundation card. It is now member-only, with one sanctioned exit: a single staff-gated Control Center card. That is not a new decision — v2.15 already settled that the member shell offers exactly ONE way to the Control Center, and the rule simply never reached app.js, which predates that cleanup by three months. The exits were enumerated before anything was removed: index.html has no header Admin link (app.js owns a reduced header, header_shell's documented exception), so the cards were the only route from the member front door to admin, and deleting them outright would have stranded an admin there. D-22 closed: the member-destination rule now scans app.js's card grid as well as site-nav.js's rail, with negative controls that put an admin href and tournament.html back into the real source, and a companion assertion that the single Control Center exit still exists and stays staff-gated — a guard that only forbids can delete the last way out.

## v0.122.0 — 2026-08-10

Tester round 2, items 3, 4b and 1d — three measured scheduler fixes in one release. T2-3: captains now ride along with team names so a director can tell two similar teams apart. The gating differs and so does the treatment — the staff-gated schedule feed names the captain in full, while /api/events/:id/teams and /api/events/:id/schedule carry no staff gate, so they honour each captain's own visibility setting: full name only if that member chose public, "First L." otherwise. Tournament Ops shows the captain on the score-sheet winner buttons and in every match cell's screen-reader label, where a director is actually identifying a team under time pressure; the dense grid keeps bare names. T2-4b: the score sheet's point differential stopped at 15 while the server has never had a cap, so a 21-0 game could not be recorded at all — chips now cover the common margins and a numeric box bounded by points_to carries the rest, the same shape the league dialog already ships. T2-1d: "when more than 3 or 4 nets are used the names are unreadable" was NOT the grid shrinking (it already scrolled) — .ed-side was one class doing two unrelated jobs, styling both the team-name spans inside a 62px match tile and the fairness aside, so every team name inherited the panel's 12px padding, border and sticky position, and under 900px the panel's order:-1 applied to both spans of a three-column grid and pushed the "v" separator to the end. The aside now owns .ed-side-panel, a class the stylesheet already defined and nothing used. Guard: scheduler_ux.test.mjs, seven tests, all seen firing first, including a privacy negative control that flips a captain's visibility on the real row and asserts the ungated feed follows the member's setting rather than a hardcoded rule.

## v0.121.0 — 2026-08-10

Tester round 2, item 5 — "after scores are assessed, breaking does nothing" — was a rewire, not a build. The Break-to-bracket button on Tournament Ops posted the LEGACY /api/events/:id/bracket, whose handler wrote only first-round games and skipped byes, while the complete modern engine (generate, preview, advance, slot, forfeit, division court ranges) already shipped at /api/admin/events/:id/brackets. The button now posts the modern route with the modern body key (a_size — the engine ignores unknown keys, so the old aSize silently defaulted the size), renders the engine's own summary, and links to the bracket board with event context. admin-brackets.html now honours the ?event= deep link (the admin-waitlists idiom), so the link lands on the event just broken, not the first in the list. The legacy route and its createBracket handler are REMOVED, not orphaned — an uncalled route would grow the reachability baseline, and a dead door that still opens is how two paths drift back apart; bracket_rewire.test.mjs asserts the old door answers the router's 404 where a 401 used to live, pins the client/server route pair as a relationship from one source, and its NC restores the legacy path into the real client source and watches the checker fire.

## v0.120.0 — 2026-08-09

Tester round 2, items 13 and 14 — the sub finder asked signed-in members to sign in, and the community boards were empty, not broken. T2-13: leagues.js was the only member surface whose fetch wrapper never attached the bearer token (its own comment claimed it shared app.js's convention — it did not), so every signed-in visit 401'd and the page showed its sign-in card. Fixed, and the wrapper's false comment rewritten. The card now also distinguishes a missing session from a signed-in account with no member profile in the org — a Sign in button for the second case was a dead-end loop. Guard: token_convention.test.mjs — the rule derived from the corpus (credentials + X-Org-Id means Authorization too), the public boards out of scope by the rule rather than an allowlist, NC strips the real attachment. Seen firing on exactly ["leagues.js"] before the fix. T2-14: the sandbox fixture now stocks the five community tables it always left at zero — member_profiles (with adult birthdates for the library's 18+ gate, plus one deliberate minor the gate must hide), sub_signups, sub_requests, lfg_listings, lfg_members — with WIPE_SQL extended in the same change (member_profiles before lfg_listings for the sub_lfg_listing_id FK; listings scoped through their test-range creators). All wipe ratchets and the generate-twice FK test pass; anonymous library search now returns players through the real route.

## v0.119.0 — 2026-08-09

Tester round 2, item 6 — the unclosable "Who plays here?" overlay on the brackets sheet, and its whole defect class. The dialog was hidden with the `hidden` attribute while its class carried `display: grid; position: fixed; inset: 0` — author CSS beats the browser's `[hidden] { display: none }`, so the overlay painted from page load and every close path (button, backdrop, Escape — all correctly wired since E1) "succeeded" in JS while the screen stayed covered. The new guard (hidden_overlay.test.mjs) scans every web page for hidden-reliant elements whose class carries an author display rule without the `[hidden]` override, and it found ELEVEN instances across NINE pages: br-pick (brackets), reveal (calendar), dc-gate (documents), faq-form, mf-form (member-fields, passes, staff-pay), feed-prefs/cta-tile/sub-strip (member home), lfg-form (Community Play). All eleven fixed with the one-line override idiom admin-waivers.html already modeled. Second half of the brackets defect: the chooser's list buttons also carried the overlay's class, each becoming its own full-screen fixed layer — class removed, uniqueness pinned. The three chooser exits are pinned by call-site assertions.

## v0.118.0 — 2026-08-09

S-3c closed — five security headers on every response the worker returns. Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, Referrer-Policy and Strict-Transport-Security are applied at the fetch egress — the same choke point that merges CORS — not inside json(), because json() never sees the avatar bytes, the CSV exports, the ICS feeds, the SMS TwiML or marketing's unsubscribe page (the only HTML the worker serves). Set-if-absent: uploads.js keeps its sandboxed CSP, calendar.js keeps its own headers, and the unsubscribe page now owns a CSP that keeps its inline styles alive (style-src 'unsafe-inline'). The dimension not touched is pinned in the same commit: an origin outside ALLOWED_ORIGINS still receives zero allow-origin headers. Guard: security_headers.test.mjs — 5 tests, every one seen failing against the unfixed worker first, including an egress-placement test that fails a json()-level implementation by construction. Page-side (GitHub Pages) headers remain unsettable from the worker; a meta-tag CSP for the HTML app is a separate decision, deliberately not bolted on.

## v0.117.0 — 2026-08-09

**S-3b — the one unauthenticated write, bounded. And the rescue that reported success it did not achieve.**

- **Sign-in link requests are now rate-limited per address**: 5 per 15-minute window (the link's own lifetime — you never need a 6th while the 5th still works) and 20 per day. `POST /api/auth/request-link` was the only route an anonymous caller could make write: every call inserted a `magic_links` row, and the day `BREVO_API_KEY` is set every call would also email an arbitrary third-party address. The guard copies `messages.js`'s existing flood shape (count-in-window → `overFlood` → 429 with a human sentence) rather than inventing a new one, and lives **inside `sendLoginLink`** so the staff rescue-link and family-invite doors are bounded through the same check.
- **The refusal writes nothing, the window clears, and the 429 is byte-identical for existing and non-existing accounts** — the rate limit does not become the user-enumeration oracle the login flow was built to avoid. All five properties are pinned in the new `auth_rate_limit.test.mjs`.
- **Fixed en route: `rescue-link` masked failures as success.** It re-wrapped whatever `sendLoginLink` returned as `ok: true` with "a sign-in link was emailed to the member" — including the new flood 429 and the pre-existing Brevo 502, cases where **no link was created at all**. The admin walked away believing the member was rescued. Non-OK results now surface with their real status, and no audit row claims a rescue that never happened.
- Suite 1547/1547 (1542 + 5, exactly the new file's tests). 99 test files. No migration, no schema change.

## v0.116.0 — 2026-08-09

**The impatient-human release (owner request 2026-08-09): the back button un-broken, and the double-click absorbed.**

- **Admin "Back" button fixed** — it rendered enormous, wrapping and clipping its own label, on every admin page. The injected button carried a class (`bt-back`) that no stylesheet defined, so its icon fell back to the browser's default SVG size (~300×150px). It now rides the house `.btn ghost sm` style with a 16px icon.
- **Double-click on a FREE event no longer registers twice.** Free registrations complete instantly as `comped`, and the duplicate guard only looked for in-progress statuses — so an impatient second click wrote a second full registration (two teams, two waivers). A completed registration now blocks a re-submit with the same team name; the same captain registering a genuinely second team (different name) still passes.
- **New guard file `human_chaos.test.mjs` (9 tests)** — the human who clicks everything twice: double registration (one row, and both legitimate-second-team controls), a sign-in link clicked twice (second refused), a styled-class guard relating every class `admin-nav.js` injects to a real CSS rule (the exact defect class of the broken back button), back-navigation integrity (same-origin guard + dashboard fallback at both `history.back()` sites), and in-flight button disabling on the three member write flows. Every guard ships a negative control that mutates the real input.
- **The "Can't reach the server" error stops blaming your wifi** (admin surface). A fetch failure can be our fault as easily as your connection; the message now says so. The 14 sibling copies are queued (roadmap §-1h M-2 item 7).
- **`touch-action: manipulation` on controls** — a double-tap on a button is now two clicks, not a zoom gesture.
- **Roadmap §-1h M-4** — the member-landing motion pass, planned with values (once-per-session card stagger, skeleton crossfade, badge pop, dismiss collapse; nothing ambient, reduced-motion honoured). Docs only; nothing animated yet.


## v0.115.0 — 2026-08-09

- Auto-recorded by CI on deploy. `/api/health` reported `v0.115.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.114.0 — 2026-08-09

- Auto-recorded by CI on deploy. `/api/health` reported `v0.114.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.113.0 — 2026-08-09

- Auto-recorded by CI on deploy. `/api/health` reported `v0.113.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.112.0 — 2026-08-09

- Auto-recorded by CI on deploy. `/api/health` reported `v0.112.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.111.0 — 2026-08-09

- Auto-recorded by CI on deploy. `/api/health` reported `v0.111.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.110.0 — 2026-08-09

- Auto-recorded by CI on deploy. `/api/health` reported `v0.110.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.109.0 — 2026-08-09

- Auto-recorded by CI on deploy. `/api/health` reported `v0.109.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.108.0 — 2026-08-08

- Auto-recorded by CI on deploy. `/api/health` reported `v0.108.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.107.0 — 2026-08-08

- Auto-recorded by CI on deploy. `/api/health` reported `v0.107.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.106.0 — 2026-08-08

- Auto-recorded by CI on deploy. `/api/health` reported `v0.106.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.105.0 — 2026-08-08

- Auto-recorded by CI on deploy. `/api/health` reported `v0.105.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.104.0 — 2026-08-08

- Auto-recorded by CI on deploy. `/api/health` reported `v0.104.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.103.0 — 2026-08-08

- Auto-recorded by CI on deploy. `/api/health` reported `v0.103.0`. Fill this entry from the session handoff — this stub only guarantees the release is not missing from history.

## v0.102.0 — 2026-08-07

**The security review you asked for starts here — one hole closed, and a permanent check so it cannot come back.**

**What was open.** One admin address — the one that returns the list of roles and what each role is allowed to do — answered anybody, signed in or not. It was the first line of the admin routing, sitting above the check that guards everything else.

**What it did not expose.** No member data, no names, no emails, nothing about your organization. It returned two fixed lists that never change: the three role names, and the permissions grid you see on the Users screen. Nobody's information was reachable through it. What it did give away is the *shape* of how permissions work here — useful to somebody probing the site, and not something that should be handed out for free. It is now closed to anyone who is not signed in as staff or admin.

**The part that matters more than the fix.** Yesterday's security pass was done by a scan that reported "all clear" across roughly 25 modules. It was wrong — it had walked past this exact line. This release replaces that one-off scan with a permanent check that runs on every build: every admin address must be behind a sign-in check, and if one ever is not, the build fails and names it.

**It was written before the fix and watched to fail.** That is the point. A test that has never failed is not evidence of anything — it may simply be looking at nothing. This one was run against the broken code first, and it named exactly one problem out of 102 admin addresses: the real one, and no false alarms. Then the fix went in and it went green.

**It also caught a bug in itself on that same run**, which is worth saying plainly because it is the reason to trust the rest. It initially flagged a *second* address as unprotected. Reading the actual code showed that one was fine — the check had a blind spot around a slightly different way that part of the site is written. The check was wrong, not the site. Fixed, and the blind spot is written down.

`admin_route_gating.test.mjs` (+12, 1387 → 1399), with four negative controls, each one breaking the real code on purpose to prove the check notices. No database change and no new address.

**Recorded for the next round, not built:** a second finding from the same review — the list of organizations is readable without signing in. That is very likely deliberate, because the sign-in screen needs your logo and branding before anyone has signed in. It is written down with the question attached rather than changed on a guess.

## v0.101.0 — 2026-08-06

**The member page and the admin page no longer bounce you back and forth.**

You reported it as *"members page v admin page seems to switch back and forth and expose the admin page."* There were **two** separate causes, and the second one is what actually trapped you.

**The member sidebar was advertising the admin shell.** The member menu quietly grew a "Manage" group — Tournament Ops, Events & Programs, Registrations, Member Management — shown to anyone with a staff role. Meanwhile the admin header links back to the member site. Each side offered the other, so the two shells sat one click apart in both directions. The Manage group is gone. The single "Admin" button in the header is the one way back, which is what it was always for.

**The Back button could not escape — and this is the real fault.** When the site sends you off a page you should not be on, it was *adding* a step to your browser history instead of *replacing* it. So being bounced off an admin page left both pages in your history: press Back, the browser re-enters the admin page, paints the entire admin menu on screen before it can check who you are, then bounces you forward again. Back never got you out, and the admin shell flashed up every single time you tried. That is the "switch back and forth and expose" you described, exactly. Every one of those automatic bounces now replaces the entry instead of adding one, so the page you were bounced off is no longer somewhere Back can return to. Your own clicks — "View as member", the back arrows inside screens — still work normally; those belong in your history.

**Also fixed, found in the same file:** if you were a plain member in the organization on screen but staff in a *different* one, the header showed you the Admin button for an organization you hold no role in. It never granted access — the server checks your role against the specific organization on every request — but it should not have been offered.

`header_actions.test.mjs` (+8 checks, 1379 → 1387), each with a negative control that edits the real file to prove the check would catch the problem coming back. No database change and no new route.

**Recorded, not built, from the same evening report:** roadmap §-1d now carries the navigation and program-scoping program in your own words — programs appearing only in their own module, one "Tournaments Manager" rail item with tabs inside the screen, the menu brevity pass, and "no bracket without pool" — plus three questions that need your answer before anything is built. Roadmap §-1e opens the security and penetration-test track you asked for, and it starts with a real finding rather than an empty heading.

## v0.100.0 — 2026-08-06

**§-1b W-G — the sample data now has the shapes real registrations have.**

**Google Drive turned out to be reachable, so this was built from the real sheets rather than deferred.** Every previous session recorded W-G as needing an interactive session; one search proved otherwise. The 2026 Spring REVCO export — 21 team rows — was read alongside the Valentines sheet already on file.

Sample data is a product: it is what you look at when you try a feature before real registrations exist, so when it is unrealistic you cannot tell a broken feature from unrealistic sample data — and you reasonably assume the feature. Four things real sign-ups do that the old sample data never did:

- **Somebody with no email address.** Your "Emails of Teammates" box is free text and rarely holds one address per player — it holds three for a team of four, or one address covering everybody, or the word "N/A". Every sample person used to have an address, which meant the Marketing screen's "reachable contacts" number could never differ from the total. Now it does.
- **A team that got the payment link and never finished.** The commonest unpaid state on your sheets (three of 21 in Spring). The Registrations screen's "Unpaid" filter covers three states and the sample data only ever produced two of them.
- **Both skill levels.** Your form offers "BB/A" and "A/AA"; the sample data only ever made BB/A, so nothing that compares two levels had anything to compare. "Block Party at A/AA" is lifted straight from the Spring sheet.
- **A team name with a comma in it** — "Jarvis, Jork It A Lil" is real, and it is the shape that breaks naive spreadsheet imports.

Also corrected: a comment claiming the sample set held 24 people when it has held 48 for some time.

`sandbox_real_shapes.test.mjs` (+10, 1364 → 1374). Each check proves the shape **changes an answer** rather than that a row exists — counting rows is what passed on the sample data that was broken once before. Four negative controls, each editing the real generated data to prove the checks catch its removal. No database migration and no new route.

## v0.99.0 — 2026-08-06

**§-1b W-F — registration → members → comms. Segments can target one event.**

Registration already built the members database and the members screen already rendered it — verified before designing, and for the first time in seven W-units the engine was not only built but already called. The gap was the join between them: a segment could filter on tags, on *play history*, or on join date, and play history knows only the event **type**. "Email the people who registered for the Valentines tournament" could not be asked for. Live D1 also says none of the org's 49 contacts carry a tag, so that filter reaches nobody today.

- **Segments gain an event filter.** Pick one event in the segment form and the segment is the people who registered for it. The event is named in the segment's description, so a list of segments still reads in plain language.
- **"Email these registrants"** on the registrations screen carries the chosen event straight to a new segment, already named for that event. One tap there, one confirm here — no retyping the event, no hunting for it on a second screen.
- **A dropped event filter would widen the segment, not empty it.** With no clause the query falls back to everyone reachable, so a silently discarded filter means emailing the whole org instead of one event's registrants. A dropdown posts the text `"7"`, never the number 7, so the value is coerced before it is validated and the test proves that against the real code rather than describing it.
- **The clause cannot reach across organisations.** It reuses the organisation the query is already bound to, which costs nothing and means a saved segment pointing at another org's event matches no one.

`marketing_segments_event.test.mjs` (+14, 1350 → 1364), four negative controls that each mutate the real shipped source. No database migration and no new route.

## v0.98.0 — 2026-08-06

**§-1b W-E.2b — staff card correction. Tryouts is finished.** `PUT /api/admin/tryouts/:eventId/card/:contactId`
had been built, tested and org-scoped since **v0.60.0 with no caller anywhere** — the last route in
the cluster behind the owner's "try out page does not work — no form to use". Verified before
designing, for the sixth consecutive W-unit, and again the engine was whole and only the screen was
missing. **D-4 baseline 16 → 15, and the tryouts cluster is now empty.**

**A correction form on the evaluate card** in `admin-tryouts.html`, folded away behind a quiet
"Fix details" button on each player. Correcting a card is **two taps and typing** — open, edit, save
(owner req #19). It covers exactly `CARD_COLS`: positions, age groups, height, previous club, jersey
size, and the note the player wrote at registration.

- **A list crosses the wire as an ARRAY, never a comma-separated string.** `parseList` JSON.parses a
  string before it falls back to splitting, so the single value `"16"` parses as the *number* 16,
  fails `Array.isArray`, and comes back empty — a form that posted its text box raw would silently
  delete the age group the user just typed, for roughly one input in ten, and look correct in
  review. `"14U, 16U"` happens to work, which is exactly why that bug would survive. The client
  splits the box itself and posts an array; the guard proves the trap against the real validator.
- **The client does no unit arithmetic.** Height is stored in centimetres and rendered imperial by
  the server (`cmToImperial`). A feet-and-inches box here would have to round-trip, and 5'11" is a
  range of centimetres rather than one, so every save of an unrelated field would quietly rewrite a
  stored height that was never wrong. The field asks for centimetres, says so in its own label, and
  shows what is on file today in the server's words.
- **Both `#tList` listeners are delegated and attached once, at boot.** That node has its innerHTML
  replaced on every render but is never itself recreated, so a listener attached during a render
  would accumulate for the life of the page — §-1c D-6, the pool board's live defect, deliberately
  not inherited a second time. The assertion is positional, so a rename cannot satisfy it.
- **A re-render cannot discard a half-typed correction.** Typing in the "Find a player" box rebuilds
  every card; the form's live values are kept and redrawn, and focus is put back on the control the
  user pressed rather than falling to `<body>`.
- **The error appears in the form, not over the page.** `fail()` would replace the whole list with a
  dead end and take the half-typed correction with it. An unrecognised position is dropped by the
  server rather than refused, and the form offers exactly the six it accepts.

**No new visual vocabulary.** `tokens.css` already themes every input with the 44px target and the
bare `:focus-visible` ring (F-35), and `app.css` already gives `.btn` its press feedback, so what
was left to write was layout. This is the v0.95.1 / v0.96.1 lesson applied *before* the release
rather than after: two of that session's four releases were design fixes spent inventing a step the
shared scale already declared.

`tryouts_card.test.mjs` **(+12, 1338 → 1350)**, with three negative controls that each mutate the
real shipped client: posting the raw comma string, moving a `#tList` listener into `render()`, and
the comment-stripper controlled in both directions.

**W-E.3 is not in this release and never will be.** The owner settled it on 2026-08-06: offers are
handled in a separate system. There is no offer route, there will not be one, and nothing here
sends, tracks or records an offer. Same shape as SafeSport/M25 — the correct build is no field and
no route. The tryouts workflow ends at the squad board: evaluate → roll up → place on a team.

## v0.97.0 — 2026-08-06

**§-1b W-E.2 — the tryout squad board.** Five admin routes that had been built, tested and org-scoped
with no caller anywhere now have a screen: `GET/POST /api/admin/tryouts/:id/squads`,
`PATCH/DELETE /api/admin/squads/:id`, `POST /api/admin/squads/:id/assign`, and
`POST /api/admin/squads/:id/remove`. This was the largest remaining cluster behind the owner's
"try out page does not work — no form to use". The engine was never the gap.

**New page `admin-squads.html`** (rail: Tryout Squads, beside Tryouts), with `admin-squads.js`:

- **Placement is two taps and there is no dragging.** Pick a player from the unplaced list, then
  pick the team. Moving a player who is already placed is the same two taps, because the assign
  route moves them. Drag was the pool board's answer and is the wrong one here — a director does
  this holding a phone at the side of a court, and drag has no keyboard path that is not a worse
  second one.
- **Every listener is delegated and attached once, at boot.** `#sqUnplaced` and `#sqGrid` have their
  innerHTML replaced on each render but are never themselves recreated, so a listener added inside
  a render would accumulate for the life of the page. That is §-1c D-6, the pool board's live
  defect; this page is written not to inherit it and a positional guard enforces it.
- **The server owns "short" and "full".** `squadNeeds()` defines full as headcount met AND no
  position short — a team of 10 with no setter is not full. The client renders that verdict and
  does no arithmetic of its own.
- Each team says what it still needs by position; the event-wide line totals teams full, players
  placed, and what is still short. Editing a team saves name, size and per-position needs together;
  removing a team returns its players to the unplaced list and the confirm says so.
- Both pages carry the chosen tryout across in the URL, so moving between evaluations and squads
  never costs a re-pick (req #19).

**Route reachability baseline 20 → 16.** Four struck at once because they are one surface — a board
you cannot create a team on is not a board. `tryouts/:id/card/:contactId` stays on the baseline:
staff card correction is W-E.2b and has no screen yet.

`tryouts_squads.test.mjs` (+14): the five routes end to end through the real router, including that
assigning a placed player moves rather than duplicates them, and that a deleted team strands nobody.
Three negative controls, each mutating the real shipped client — one computes fullness client-side,
one attaches a listener inside a render, and one proves the comment stripper works in both
directions.

## v0.96.1 — 2026-08-05

**The roll-up's heading was an h2 wearing the h3 size — one step off the shared scale, and it collided with a player's name.**

A design review after v0.96.0 shipped flagged flat type on `admin-tryouts.html`. Most of that is pre-existing and lives in shared `admin.css` (`.tbl` at 14.5px, `.tbl th` at 12.5px), and changing it would restyle every table in the admin product — out of scope for a tryouts unit, and a per-page override of shared vocabulary is the defect that guard family exists to prevent. **One part of it was mine and was real:** `.roll h2` shipped at **16px**, which is this product's h3 step (`.module h3`, `.settings-section h3`) and is byte-identical to `.eval-top b` — a player's name on an evaluation card. A heading introducing an entire view ranked no higher than one row's label.

Corrected to **18px**, the h2 step already declared in `admin.css` (`.modal h2`), which sits properly between the 22px page `h1` and the 14.5px table body. The step was taken from the shared scale rather than invented for this page.

**The guard asserts the ORDER, not the number** — `.roll h2` must outrank `.eval-top b`, and must land on a step the shared scale already declares. Pinning "18px" would be the same mistake this repo has now made twice in two days: a guard that encodes one spelling of a fix reddens on the next legitimate change. Verified to discriminate before shipping — regressing the value to 16px flips the ordering assertion false.

Suite **1324/1324** (+1), test files **81**, modules **51**, buster **393 across 63 files** at 0.96.1. No migration; ledger **0042**. D-4 baseline **20**. One CSS declaration and one assertion; no behaviour changed.

## v0.96.0 — 2026-08-05

**W-E part one — the director's half of tryouts finally has a screen, and the "Director summary" button stops pointing at the wrong page.**

Verified before building, which is now the fourth consecutive W-unit where that changed the work: **the engine was already there.** `GET /api/admin/tryouts/:eventId/summary` has been built, tested and org-scoped since v0.60.0 — it rolls every coach's verdict up per player — and it had **no caller anywhere**. The page's "Director summary" control was an `<a href>` pointing at `admin-buildstatus.html#tryout-N`: a page about which modules exist, not about this tryout. That is failure class 1 with a button on top of it, and it is exactly what the owner's *"try out page does not work … no test data here or form to use"* was pointing at.

**Built** (`admin-tryouts.js` v1.1 + page): the roll-up is now a **view on the same page**, not a second page — same tryout, same event picker, one tap either way (owner req #19). It lists every evaluated player with the number of offers, the number of noes, how many coaches have looked at them, the **rating range**, and where it stands ("2/3 offer"). Every column sorts from its header; a second click reverses; the count columns open **descending**, because a director opening "Offers" wants the most-wanted players first. Sort state is written to `aria-sort` and shown as an arrow character rather than colour, so it survives greyscale.

**The rating is a range and nothing averages it.** `rollUp` sends `rating_low` and `rating_high` with the comment *"Range, not mean. Two coaches at 2 and 5 is the interesting case, and a mean of 3.5 erases it."* The screen honours that literally — it does no arithmetic on the two ends at all. A 2 and a 5 render as **2–5**. This is the property most likely to be "tidied up" by a future change, so **NC-1 mutates the real shipped client to compute a mean and proves the guard catches it**.

The two views are exclusive, and the card filters go with the cards: leaving "I said offer" applied over a table that is not about one coach would silently filter the director's view by one person's opinion. Coach privacy is untouched — the evaluating cards still show one coach their own work only, enforced in SQL, and the guard asserts **both halves against the same fixture** so "the roll-up aggregates everybody" is not a claim about an empty set.

`worker/test/tryouts_rollup.test.mjs` (**+11**) drives two coaches who genuinely disagree, then asserts the call site in both directions, the range, the aggregation, that an unevaluated player is **absent rather than a row of zeroes**, the sort contract, and the exclusivity of the two views. Three negative controls mutate real shipped files: averaging the range, restoring the build-status link, and the comment stripper proved in both directions.

**One D-4 baseline strike: 21 → 20.** The reachability ratchet demanded it the moment the caller landed, as designed. The other five tryouts routes — the squad board (`squads` GET/POST, `squads/:id` PATCH/DELETE, `assign`, `remove`) and the staff card correction (`card/:contactId`) — are **deliberately still uncalled**: that is a second screen, drag-and-drop shaped, and half-building two screens is worse than finishing one. It is W-E part two.

Suite **1323/1323** (was 1312), test files **81**, modules **51**, buster **393 across 63 files** at 0.96.0. No migration; ledger **0042**. No new route — every route this release calls was already built.

## v0.95.1 — 2026-08-05

**The suggestions panel stops shouting over the board it advises — and the guard that pinned the wrong thing is fixed with it.**

A design review caught the v0.95.0 panel's **3px gold left edge**. It was a real defect, and the cliché ("a thick coloured border down one side of a card") is the lesser half of why. The larger half is hierarchy: the pool board's signature is the tiles a director drags, and that edge spent the loudest device on the page on its **least important element** — an advisory panel. Standards §5's own rule is to spend boldness in one place and keep everything around it quiet, and this did the opposite.

**Fixed** (`web/admin-pool-board.html`): the panel now borrows `.pb-pool`'s container **exactly** — same `1px solid var(--border)`, same radius token — so it reads as part of the board rather than a second product bolted on, which was the stated intent all along. The marker is now the dot idiom **this page already uses** for unsaved state (`.pb-state.dirty::before`), in `--emphasis`, the token built for exactly this: navy on light, gold on dark, AA in both. Gold remains never ink — gold text on a light surface is ~1.7:1.

**The guard was the other half of the defect.** `board_suggestions.test.mjs` A9 asserted the literal string `border-left: 3px solid var(--accent)` — a pinned *implementation*, not the rule — so it went red on the correct fix. That is precisely the failure class this repo recorded one release earlier (`divisions_page.test.mjs` v1.1 demanded `role="alert"` and reddened on the right change), and the resolution is the same: **ask which of the two is wrong before touching either.** Here it was the guard. It now asserts the invariant instead — no `.pb-sug` rule paints text with `var(--accent)` or a literal gold hex, the panel's container matches `.pb-pool`'s, and no `.pb-sug` rule carries a thick single-side accent border. It also counts the rules it found, so a selector rename cannot make it pass by matching nothing.

**Proved it can fail, in both directions, before shipping:** re-inserting the 3px edge into the real page text flips the slab check to true; changing the dot's `--emphasis` to `--accent` flips the gold-ink check to true. The unmutated file passes all three with 8 rules matched against a floor of 5.

Suite **1312/1312**, test files **80**, modules **51**, buster **393 across 63 files** at 0.95.1. No migration; ledger **0042**. No route change; D-4 baseline **21**. Behaviour is untouched — this release changes two CSS declarations, one class attribute and one assertion.

## v0.95.0 — 2026-08-05

**W-D — seeding suggestions on the pool board: proposals from past results, never rules, and never a word about a person.**

The owner: *"split the good players (previous winners) as much as possible (using historical data) and have friends avoid playing too much with each other in pool or people from the same area … together. **These are just suggestions not rules, as it may be impossible to complete based on entered teams.**"*

Built from `docs/2026-08-05_spec_seeding-suggestions_v1_0.md` rather than re-derived, because the obvious implementation is wrong here. The spec's headline correction, verified again this release by reading the writer: **`standings.rank` is an event-wide POOL-PLAY finish, not a champion and not a division placing.** `refreshStandings` reads `matches WHERE stage='pool'`, loads every team with no division filter, and `standings` has no `division_id` column. Live D1 *looks* per-division only because the seeder hand-writes three standings blocks. This feature therefore **never reads `rank`** — it recomputes placement inside each division from `wins`/`point_diff`/`points_for`.

**The owner settled two open questions and the second one changed the design.** Asked what "won before" means, they widened it: *"We should rank every team … from pool they should count all teams 1-X for each division. Then simply list their placement for divisions. We can award a score/number as there is minor overlap between bottom of A and top of BB, similar to ELO score … rank includes Open/AA - A - BB - B - Recreational."* So a team's history is now a **placement plus a tier-weighted score**: division tiers sit 100 apart (Open/AA 400 · A 300 · BB 200 · B 100 · Recreational 0, plus the mixed labels the real registration form uses) and placing scores 0–100 inside a tier — which makes the bottom of A and the top of BB come out **equal by construction**, exactly the overlap the owner described. A persisted ELO rating stays unbuilt: the owner called that "potentially", and it needs a ratings table this release deliberately does not add. On subs: *"Subs for tournaments, non issue"* — so `is_sub` rows are excluded from every signal.

**New:** `worker/src/board_suggest.js` (read-only) and a fifth key on the board payload. **No new route, no migration.** The board POST already spreads `...board`, so the panel refreshes on every save with no second request. Four signals, each independently guarded so one failure costs information rather than the board:

- **spread_winners** — teams whose players have won a division before, bunched into one pool.
- **spread_strength** — one pool's teams finished higher at past events than another's, stated in **divisions' worth** rather than in the internal score, which is a unit nobody has been taught.
- **split_repeat** — two teams in one pool whose players keep sharing rosters, counted once per shared roster rather than once per pair of people.
- **spread_area** — teams from one city bunched into one pool. Captain city, grouped on the literal stored string: **no region taxonomy**, so "Fort Collins" and "Ft Collins" stay two groups and the signal understates. "N Co" needs a mapping from the owner first.

**The 6–11 pool preference suppresses a suggestion and never a save.** If the move a suggestion implies would take its source pool under six or its target over eleven, the suggestion is simply not made. **An unsatisfiable suggestion is dropped in silence** — there is no "not enough history" line anywhere, because that line would appear on every first event forever. And **no sentence names a person**: the signals resolve identity through people, the screen talks about teams, pools and counts.

**The panel** sits between the board and the waiting area — outside `#pbBoard`, which `render()` rewrites and `fail()` replaces wholesale. It is drawn from `ingest()` and never from `render()` or `wire()`, and its one delegated listener is attached once to a static node, because `wire()` already stacks handlers on `#pbWork` on every render. Each row carries **Show me** (rings the teams, then clears itself) and **Dismiss**. Visually it is the board's own furniture one register quieter, with a gold left edge as a rule — never gold ink.

`worker/test/board_suggestions.test.mjs` (**+22**) drives the real board route over a fixture built so all four kinds fire, because a no-write assertion over a payload that proposed nothing proves nothing. It sets `rank` to *disagree* with pool play wherever the two can be told apart; a team holding `rank=1` that placed last and lost its final must not be credited, while a team that placed third and won a scored final must be. Ties credit nobody, a drawn final credits nobody, and a future-dated `in_progress` event is not history. Four negative controls mutate the real shipped module: a renamed column degrades to silence **while the signal that never touched that column still answers**, a database that throws still returns a board, and a single no-op `UPDATE teams SET pool_id=pool_id` is caught — proving the read-only assertion can actually fail.

Suite **1312/1312** (was 1290), test files **80**, modules **51**, buster **393 across 63 files** at 0.95.0. No migration; ledger **0042**, read back from live D1. Reachability baseline unchanged at **21** — W-D adds no route. Next W-unit: W-E — tryouts intake → sortable table → offers, whose six uncalled routes are the largest remaining cluster.

## v0.94.0 — 2026-08-05

**W-C — "Plan the day": the pool-sheet planner finally has a screen, and the owner's split table was in the engine all along.**

Verified before building: `poolSizes()` has implemented the owner's pool-split defaults since v0.70.0 — measured against their own examples: 15 teams → 8+7, 16 → 8+8, 17 → 9+8, 19 → 10+9, pools always inside 6–11 with the fewest pools, a small field gets an honest note rather than a refusal, and the 8-game floor (never under 8; a 5-team pool doubles its round robin) is already law in `chooseRounds`. The three planner routes — equal-game options, plan preview with plain-sentence summary, and the commit that writes real matches — existed since the format engine shipped and had **no caller anywhere**.

**Built** (`tournament.js` v0.4.0 + page): the **Plan the day** panel on Tournament Ops. Teams and courts prefill from the event; "Show the options" lists every round count that gives everyone an equal number of games ("8 games each · 12 rounds · sits 4"); picking one previews the plan in the director's own language — the summary sentences plus **"Pools: 16 teams into 2 pools of 8 + 8"** — and if a listed option hits the asked-for games exactly it previews itself, one tap saved. "Use this plan" writes the schedule through `generate-schedule`: over an existing schedule the server answers 409 and says what it would do; replacing takes an explicit second press. AA/Open-run-smaller and A/BB-mix-then-split-at-bracket ride as the panel's guidance copy (defaults, not rules), pointing at the Divisions screen which owns that flow.

`/api/admin/formats/plan` now returns `pool_split` alongside the summary, so every plan carries the split defaults. **Three more strikes from the uncalled-route baseline (24 → 21)** — `formats/options`, `formats/plan`, `events/*/generate-schedule` — each demanded by the reachability ratchet the moment its caller landed.

Suite **1290/1290**, test files **79**, buster **393 across 63 files** at 0.94.0. No migration; ledger 0042. Next W-unit: W-D — seeding suggestions from history (proposals on the pool board, never rules).

## v0.93.0 — 2026-08-05

**W-B — the league week is hand-editable and exportable (roadmap §-1b), and the differential rule was already true.**

Verified before building (the W-A lesson — the platform's gaps are surfaces, not engines): generate-week exists with rematch/bye warnings, League Manager scoring is already 2-tap "Who won? → by how many points?", and the captains' score links already speak pure differentials ("We won / They won → by N"). None of that was rebuilt.

**What was actually missing, now built** (`admin-league.js` v1.4 + page):

- **Edit a matchup by entry.** Every unscored game gets an Edit button → "Who plays this game?" with two team pickers → `POST /api/admin/events/:id/schedule/teams`. That route has been fully built in formats.js since the format engine shipped and had no caller anywhere — **the first strike from the 25-route uncalled baseline** (`route_reachability.test.mjs` demanded the strike, as designed). Scored games are deliberately not editable — changing who played a finished game rewrites history.
- **Drag-and-drop, discoverable.** Rearranging courts and weeks lives in the Schedule Editor, where it always did with full keyboard parity; the League Manager toolbar now links there with the league preselected (Schedule Editor gains `?event=` deep-link support, ignoring ids outside the caller's org).
- **Export.** "Print schedule" with a print stylesheet — the week cards become the hand-out on the gym door, chrome and controls stripped — and a per-week **"Copy as text"** producing paste-ready lines (`Court 1: Net Gains vs Sets on the Beach`) for a group text or email, which is the export that actually gets used between print-outs.

Suite **1290/1290** (no new tests — the reachability ratchet's strike IS the assertion that the entry path has a caller), test files **79**, buster **393 across 63 files** at 0.93.0. No migration; ledger 0042. Next W-unit: W-C — registrations → divisions → pool sheets from the owner's sizing rules.

## v0.92.0 — 2026-08-05

**W-A — the registration-first workflow program begins (roadmap §-1b): the roster a registration creates is finally visible and editable, and the link runs both directions.**

The owner's 2026-08-05 spec: "when teams register they need to fill out a form, then that form populates after payment the roster page (which should be editable)." The claim behind League Manager's "teams land here from registrations" was verified true server-side — `submitRegistration` has written `teams` + `team_members` since day one — but nothing could read a single team back and no screen could edit one. The flow existed in the database and nowhere on screen.

**New roster routes** (`worker/src/registrations.js` v1.9 — the module that owns the team writes): `GET/PATCH /api/admin/teams/:id`, `POST /api/admin/teams/:id/members`, `PATCH/DELETE /api/admin/team-members/:id` — staff-gated, org-scoped, soft-delete, every write audited, every response the full fresh roster (server truth only, the KOTC board's design). `listRegistrations` now returns `team_id` so the registrations table can link to the roster.

**One shared roster modal** (`web/assets/team-roster.js` v1.0), opened from both directions: the event page's registrations table (the team name is now a button) and League Manager's levels board (each team gains Roster). The modal names the registration the team came from — status chip included — and the event, because the owner's complaint was precisely that the two were never visibly linked. Names and emails edit inline; members add and remove; the captain is marked.

**Seed**: the Thursday league gets four teams with rosters, two linked to the league registrations that created them, so the registration → roster → league walk works on test data. Wipe already covers every row; the two-press guard proves it.

**`team_roster.test.mjs` (+2)** drives the REAL public registration route first — the roster under edit is the one a registration actually created, not a hand-built fixture — then walks rename / fix-a-name / add / remove, asserts the soft delete, the cross-org 404, and the blank-name refusal. The reachability ratchet confirms the five new routes all have callers at birth.

Suite 1288 → **1290**, test files 78 → **79**, buster **393 across 63 files** at 0.92.0 (+2: the two pages that load the roster modal). No migration; ledger 0042. Next W-unit: W-B — league weekly schedule → hand-edit → export → score entry by link, worded in differentials.

## v0.91.0 — 2026-08-05

**Block E of the tester-round fixes (roadmap §-1) — the polish the round surfaced, all five items, plus the dashboard's vague 403.**

**E1** (`admin-brackets.js` v2.1): the "Who plays here?" chooser can no longer read as frozen — a filter that hides every team now says "No teams match '…'. Clear the search to see everyone," and clicking the backdrop closes the dialog (Escape and Close always did).

**E2** (`admin-divisions.js` v1.1 + page): "more to do" is no longer dressed as "broken." The validator's findings render as a checklist — a lead-in line, a fix inside each sentence ("give one of them a different court") — on a `role="status"` live region instead of `role="alert"`; the court badge explains a missing court count instead of contradicting Suggest; the state line says plainly why Save is off; and the duplicated status strings collapsed into one renderer so the two voices can never drift again. `divisions_page.test.mjs` v1.1 asserts the live-region INVARIANT rather than `role="alert"` specifically (the header_shell v2.1 class: the guard was wrong, not the code), with a negative control for the unannounced case.

**E3** (`tournament.js`, `admin-score-links.js` v1.1): Tournament Ops opens on the first real event like every other module instead of sitting on the "— choose event —" placeholder looking empty. Scoring Links keeps its deliberate no-write-on-paint — Get links is a POST that mints credentials — but the empty state is now an intentional block whose primary button IS the one step.

**E4**: `0003_admin_schedule.sql` → `2026-07-22_0003_admin_schedule.sql` and `0025_guardian_invite.sql` → `2026-07-26_0025_guardian_invite.sql` (their real apply dates from git). A lexical sort of `db/migrations/` now replays in apply order; any automated rebuild used to apply 3 and 25 first and fail. File contents are byte-identical — they are the record of what ran on live D1 — and the schema gate's parser keeps the bare convention parseable for old branches and the applied ledger rows.

**§-1c D-2** (`admin-dash.js` v1.5): a dashboard 403 renders through `loadFail` — "You don't have access to <org>" with one-tap switches — instead of a generic sentence in the KPI strip.

Suite 1287 → **1288** (the new negative control), test files **78**, buster **391 across 63 files** at 0.91.0. No migration; ledger 0042. With this, every item the 2026-08-04/05 tester round produced — four root causes and seven secondary defects — is fixed or recorded in §-1c; next is the owner's registration-first workflow program (§-1b), starting at W-A.

## v0.90.0 — 2026-08-05

**Block D of the tester-round fixes (roadmap §-1) — King of the Court is finally startable by a human, and reachability is guarded in the client direction.**

**D1 — the KOTC card on the event page** (`web/assets/admin-event.js` v0.5.0). `POST /api/admin/events/:id/kotc` and `POST /api/admin/kotc/:id/players` existed and were tested since v0.80.0, and no file in `web/` called either — a fully-built format could not be started from the UI (audit R4). The event screen now carries a King of the Court card: this event's sessions (players, round, points), "+ New session" (name / games to / move up / rounds planned), and an entry-list picker that searches `/api/admin/members` with selections that survive re-searching. Creating a session opens the picker immediately — the entry list is always the next step, so the operator is never made to find a second button (owner req #19). The court board's empty state (`admin-kotc.js` v1.2) now links to a control that exists instead of describing one that does not.

**D2 — `route_reachability.test.mjs` (+5).** The assert-call-sites rule now runs in the client direction: every `/api/admin/*` route shape derived from the worker's two routing idioms must have a caller in `web/` (template holes masked to wildcards, comments stripped on both sides — with a negative control proving a comment never counts as a route or a caller). **The scan found 25 admin routes built, tested and uncalled** — R4 at scale — recorded as a shrink-only baseline: a NEW uncalled route fails at birth, and a baseline route that gains a caller demands its own strike, so the list can only drain. The inventory is roadmap §-1c D-4; the clusters that matter are the six tryouts squads/offers routes (the owner's "tryout page does not work" — W-E's work list) and the four format-engine planning routes (W-C's substrate). The guard's own first draft ate half its caller corpus by masking `${…}` to `*` before stripping comments — `/*` read as a comment opener — which is why the order is asserted in code.

Suite 1282 → **1287**, test files 77 → **78**, buster **391 across 63 files** at 0.90.0. No migration; ledger 0042.

## v0.89.0 — 2026-08-05

**Blocks B + C + A3 of the tester-round fixes (roadmap §-1) — org honesty, the service-worker purge, and the seeded money.** Most of the 2026-08-04/05 tester report traced to two pieces of state, not to the modules; this release removes both.

**Block B — org honesty** (`web/assets/admin-nav.js` v2.22 + the six event-driven modules). The org switcher now offers only orgs where `/api/me` reports an admin/staff role — it used to offer an org the owner had no role in, and one click there put every module into a 403. A stored `bt_org` outside the role list **self-heals** to the first role org and reloads once, so a poisoned browser recovers on its own. The header wordmark now names the **active org** on every admin screen. New shared states: `BT_ADMIN.orgEmptyState()` renders "No events in <org> yet" with one-tap switch buttons (+ Generate test data on org 1) instead of a blank board, and `BT_ADMIN.loadFail()` renders a 403 as "You don't have access to <org>" — the string "Couldn't load your events." is retired repo-wide. B5 (`bt_org` storage scope) remains an owner decision. New guard `worker/test/org_honesty.test.mjs` (+9): drives the real router as a staff user of an **empty org** (200, empty, no cross-org leak) and as a user with **no role** (403 with a human sentence) — the two states the tester round lived in and no test had ever run — plus single-source scans with negative controls. Found on the way: the harness's first user is bootstrapped admin of ALL orgs (F-12), so the test burns the bootstrap on a throwaway account first.

**Block C — the stale-cache class** (`web/sw.js` v2.0). The service-worker cache name was pinned to `bt-shell-v1` for 67 releases and never invalidated, and the offline fallback matched with `ignoreSearch: true`, so one failed fetch could leave new HTML running months-old JS/CSS — the best explanation for tester breakage a clean browser could not reproduce, including "regenerate test data still fails" reported after the v0.88.0 fix shipped. The cache name now derives from the swept release buster (this file carries the literal `sweep-buster.mjs` rewrites), the fallback matches the exact URL, and the first activation evicts every old cache including the poisoned one — the one-time purge, no flag needed. New guard `worker/test/sw_cache.test.mjs` (+7) reconstructs the 67-release defect as its negative control, with comment-stripping (fifth strike of that class) NC'd in both directions.

**A3 — the seed carries the money and the Court Board.** Every square-paid test registration gets a COMPLETED `payments` mirror at the event price — Sales & Reports now shows **$895 all-time** instead of `$0` beside 20 paid registrations. `payments` joined `WIPE_SQL` **before** `registrations`, so the second press stays alive (the v0.88.0 FK class; the two-press guard exercises it). A draft KOTC session — "TEST Kings Court — Thursday league night", 12 players — sits on the league event at exactly the state Block D's create-session UI will hand over; round 1 is left for the real engine to draw.

Docs: roadmap → v1.4 (**§-1b registration-first workflow program** from the owner's 2026-08-05 spec; §-1c deferred-defect register), `RALPH.md` → v3.0 (the loop queue re-pointed at §-1/§-1b), handoff → v1.12. Suite 1266 → **1282**, test files 75 → **77**, buster **391 across 63 files** (sw.js joins the corpus), ledger 0042 unchanged — no migration.

## v0.88.0 — 2026-08-05

### Fixed
- **Test data: "Regenerate test data" and "Wipe test data" both worked exactly once, then failed forever.**
  `WIPE_SQL` in `worker/src/sandbox.js` deleted `brackets` before the `matches` that carry
  `bracket_id`. **D1 enforces foreign keys**, and `D1.batch()` is one transaction, so the delete
  raised `FOREIGN KEY constraint failed`, the whole 57-statement wipe-and-reseed rolled back, and
  `POST /api/admin/testdata/generate` answered **500**. The rows that triggered it were written by
  `generate` **itself** — its last step draws Winter Jam's bracket through the real generator — so
  press #1 on an empty range succeeded and every press after it failed. `wipe` shares the same list,
  so the button whose job is to clear a stuck seed was stuck on the same statement and there was no
  recovery path from the UI. Reproduced against live (`failed_modules:["sandbox"]`) and in an
  isolated SQLite built from `db/migrations/`.
- **Two more instances of the same defect, fixed rather than left to surface one at a time:** `pools`
  also preceded the `matches` that carry `pool_id`, and `divisions` preceded the `teams`, `pools` and
  `brackets` that carry `division_id`. A third — `teams.pool_id`, so `teams` must precede `pools` —
  was caught by the new mechanical guard *while the fix was being written*, which is the argument for
  the guard.
- **The delete list now covers every table that references the test range**, not only the fifteen it
  knew about: `tryout_evaluations`, `tryout_profiles`, `tryout_squads`, `tryout_squad_members`, the
  five `kotc_*` tables, `waitlists`, `form_fields`, `space_bookings`, `staff_shifts`, `notifications`
  and `profiles`. All measured **empty** on live 2026-08-05 — so a tester evaluating one player or
  seating one net would have re-broken the reseed, and fixing it now cost nothing.

### Added
- **`worker/test/wipe_order.test.mjs` (+8, suite 1258 → 1266, 75 files).** Two guards that
  deliberately do not share a mechanism: a **mechanical** one that reads the foreign-key graph out of
  `sqlite_master` and proves the order is topologically valid — a hand-checked list is correct only
  until the next migration adds a key — and a **behavioural** one that presses the real route
  **twice** through the real router with foreign keys enforced, plus a `wipe`-then-`generate`
  recovery test. Both ship negative controls that mutate the real input.
- **`createD1(schema, { foreignKeys: true })`** in `worker/testkit/d1-memory.mjs`. Opt-in, off by
  default so narrow fixtures keep working.

### Changed
- **`worker/testkit/d1-memory.mjs` no longer claims foreign keys are "D1's default".** They are not.
  That single false premise is why a completely dead button passed a suite of 1258: the harness was
  strictly more permissive than production on exactly the axis under test. Measured 2026-08-05 — the
  same 57 statements pass with the pragma OFF and fail with it ON, against the same schema.

### Notes
- **Two reasons the suite stayed green, both now closed.** `sandbox_seed.test.mjs` calls generate
  **once**, against an empty database, and the defect only exists on the **second** press — the state
  that breaks a reseed is the state the previous reseed left behind. And the harness did not enforce
  foreign keys. Neither gate could have seen this.
- No migration. No `web/**` change, so **no cache-buster sweep and no `sync-rail`** — `index.js` is a
  byte-verified one-line bump (F-34).
- Full audit of the 2026-08-04/05 tester round, including three root causes still open (org context
  poisoning, the never-invalidated service-worker cache, and KOTC being unreachable from the UI), is
  in `docs/2026-08-05_audit_tester-round_v1_0.md`; roadmap §-1 now carries the A–E fix order.

## v0.87.0 — 2026-08-04

**Finished for the night.** A director can now take a player off for the evening, and put them back.
`kotc_players.withdrawn_at` shipped in migration 0042 and was **read in seven places** from that day —
the player link 409s on it, round 1 deals around it, the bench hides them, the session list leaves them
out of its count — and **nothing ever wrote it.** Failure class 1 from the far end: not a route with no
caller, but a state with no cause. Every read was correct and unreachable. Five of twenty-four players
left before round 3 of the owner's real tournament, two of them from the top four.

`POST /api/admin/kotc/:id/withdraw` writes the flag **and frees their seat**, and the seat is the part
that matters: `nextRound` builds the next round from the previous round's nets, so a slot left behind
would carry somebody who has gone home into round 3. Their evening survives — the leaderboard is derived
from the games with no stored counter anywhere, so every point they won still counts. Reversible in the
same route: `withdrawn: false` brings them back to the **bench**, not to a net, because where somebody
plays is the director's drag and not this route's guess.

**Two defects found by building it, both pre-existing:**

- **The player's own link told a withdrawn player the wrong thing.** The 409 sentence sat below the
  "are you on a net" check and inside the POST branch, so somebody who had been marked finished was told
  *"You're not on a net for this round. Find whoever is running the night"* — sending a person who had
  gone home to go and find the director. The check now runs first, and a GET gets a 200 that says they
  are done and their scores still count.
- **A net left at three made the next round a 500 that half-wrote a round.** `gamesForRound` calls
  `rotation()`, which throws for any size that is not four or five, and the round row plus all of its
  slots are inserted *before* that call — so the throw left a round with seating and no games behind it.
  The drag could already produce that state by benching a player. It now refuses with a human sentence
  before writing anything. **This is the refusal, not the redistribution** — ranking and redistributing
  over the nets that exist is still to come.

`repairUnplayed` was extracted and is shared by `/move` and `/withdraw`: two routes that re-seat people
must not own two copies of "a finished game is never rewritten", an invariant with no visible symptom.
Both directions ship with the screen — an Off control on every seat and bench tile, one tap, no confirm
dialog because it is reversible and stays visible, and a "Finished for the night" section that exists
precisely because the server keeps those players off the bench.

Suite 1238 → **1258** (14 in a new `kotc_withdraw.test.mjs`, 6 added to `kotc_board_screen.test.mjs`),
74 test files. Two negative controls that mutate the real input: the history-rewrite guard is re-run with
the scores cleared on the very same game and must re-pair it, and the short-net refusal is re-run with
the net back to four and must succeed. No migration.

## v0.86.0 — 2026-08-04

### The other two KOTC screens, and the three routes they needed

King/Queen of the Court is now complete as a format: the player link shipped in v0.85.0, and this
release adds **screen (a), the director's board** (`admin-kotc.html`) and **screen (c), the public
standings** (`kotc-live.html`) — together with the three routes neither of them could exist without.

**The previous handoff said this module's API was "complete and tested". It was complete for one screen
of three.** `kotcplay.js` had five routes and then `return null`. One `grep` settled in a second what a
sentence written in good faith had got wrong by two thirds. Routes and screens ship together here
because a route with no screen is failure class 1, and the KOTC engine already paid for that once in
v0.76.0.

**`GET /api/admin/kotc`** — the session list. The staff read took an id and nothing could discover one,
so the board was unreachable: a working route no caller could name. Newest first, with the event name
and a player count, because the session a director wants is almost always the one they just made.

**`POST /api/admin/kotc/:id/move`** — the drag. Schedule-editor precedent: **it never refuses a move.**
A director always knows something the seeding does not — she came with her sister, he is leaving at
eight — and a tool that blocks them is a tool they route around, after which the real board is a
whiteboard again. Dropping on an occupied seat **swaps** the two, so the board can never lose a person.
A player on the entry list but not seated can be dragged on, and whoever they replace lands on the
bench where they can be dragged back; a bench nobody can see is a one-way door.

**And it must not rewrite history.** `kotc_games` stores the four players *on* the game row, which is
what lets the leaderboard be derived from games alone with no stored counter to disagree with. The cost
of that design is that a re-seat *could* retroactively change who played a game that is already scored —
and because the leaderboard is derived, it would silently restate the evening. Nothing on the screen
would look wrong. So a game with both scores in is **finished and never touched**; only unplayed rows
are re-paired to the new line-up.

That invariant carries a **negative control that mutates the real input**: same session, same move,
same game row, with the scores cleared — and it proves the same move *does* re-pair it. Without that,
"the finished game is unchanged" could pass for the boring reason that the route never re-pairs
anything, and a guard that cannot fail is not a guard. "Never refuses" is tested by exhausting the
board rather than sampling it — one player dragged to every seat that exists, in turn — because
*never* is a claim about the cases nobody thought of.

One more trap worth recording: `rotation()` **throws** for any net size that is not four or five, and
the v0.77.0 dispatch table treats a throw as a *decline*. An unguarded call would have turned a drag
into a silent 404 — the route looking absent rather than broken. A short net now **warns and is left
alone** (brackets.js precedent) and the response says so in a sentence.

**`GET /api/live/kotc/:id`** — the public individual leaderboard. Asked whether this belonged on the
existing live board as a third shape (spec §8.4) or on its own page, the owner chose **a separate
page**: `web/assets/live.js` carries the v0.84.0 diff-animation engine whose own guard states it cannot
see whether the motion looks good, and nobody has eyeballed it yet, so a new section in there is a
change to code that is one human review short of trusted. `live.js` is untouched.

Names on it are **abbreviated server-side**, and that is not a detail. The staff payload carries a
scoring link per player and that token *is* the credential; a public shape built by the page rendering
less of a staff payload would publish every player's link to anyone who opened devtools. So the trim
happens in `kotcplay.js`, and the test asserts it **against the raw response bytes** — a token that
never appears in the bytes cannot be recovered from them.

**One payload builder, not two.** The staff GET's inline payload became `boardPayload`, shared with
every move response, so a move response *is* the next board. The page never patches its own copy —
same discipline as `kotc.html` not re-deriving `mode`, and the screen guard refuses the shape rather
than trusting it, with a negative control that adds a local seat assignment back and proves it fires.

**Keyboard parity is one mover, not two.** HTML5 drag-and-drop cannot be driven from a keyboard, so the
board ships Enter-to-pick-up, arrows, Enter-to-drop. The failure mode is not missing keyboard support,
which is visible; it is two implementations that drift, after which the keyboard quietly does something
slightly different from the mouse. The guard asserts exactly one function issues the move, with a
negative control that gives the keyboard its own copy.

**Motion, decided rather than sprinkled.** A drag is a high-frequency action and the whole board
re-renders after each one, so tiles do **not** animate in — animating every tile on every move would
make the fastest part of the job feel the slowest. What animates is the one tile that just moved, which
is state indication rather than decoration. The public board **diffs before it redraws**: a poll that
changes nothing touches no DOM, and only rows whose place actually changed are marked — the v0.84.0
lesson applied in the small. Nothing animates on first paint, nothing starts from `scale(0)`, no
`ease-in` anywhere, and both `prefers-reduced-motion` blocks cover `animation` and not only
`transition`.

**Clicks, counted (owner #19):** seeing tonight's board is **zero taps** — the newest session loads
itself and the picker is for the other nights. Moving a player is one drag. Starting the next round is
one tap.

**Two ratchets fired by design and were bumped with the reason recorded at the assertion:** the
byte-identical member header floor **15 → 16** for `kotc-live.html`, and the same count in
`header_actions`. Both pages were **generated from a page already inside those ratchets** —
`admin-pool-board.html` and `kotc.html` — rather than hand-written, which is what C7 asks for and the
reason `kotc.html` was caught last release. `build-status.js` gained both entries, and `kotc.html`'s
entry no longer tells testers "Not built yet: the director's board that seats the nets" — that copy
outliving the thing arriving is exactly C9's shape.

**A guard's own comments tripped it twice.** The check for "nothing animates from `scale(0)`" matched
the comment saying nothing animates from `scale(0)`, and the check for "no roster on a public surface"
matched the comment saying there is no roster. v0.85.0 hit the identical thing on `kotc.html`, which
makes it a shape rather than an accident: **check the set that ships behaviour.** A comment ships bytes,
not behaviour, and a guard that cannot tell the difference punishes the explanation and rewards
silence. The fix is a comment-stripping corpus that carries its own negative control, so it cannot be a
quiet way of switching the check off.

Suite **1180 → 1223** (+43, measured before and after). Test files 70 → 72. No migration; ledger stays
**0042**. Cache buster swept **0.85.0 → 0.86.0**, verified at **390 occurrences, one value, 62 files**
with ripgrep — a corpus derivation sharing no code with the sweep, against a count written down before
it ran (C14).

### Doc consolidation — the trigger that had been firing unattended

The four-document working set measured **93,066 bytes ≈ 23,300 tokens** against `CLAUDE.md` §0's
claimed "~7,400 — the intended per-session doc budget". That is **3.1× over**, and §7's own
consolidation trigger (">~10,000 → stop and consolidate") had been firing and being ignored for several
sessions. Reading the working set cost roughly a quarter of a session before any work started, which is
the mechanical reason the last two sessions each shipped one screen rather than two.

`docs/INDEX.md` was the largest document in the repo at 37KB, most of it the **closed** half of the
contradiction register. Twelve closed entries moved verbatim to
`docs/archive/contradictions-closed_v1_0.md`; C2, C3, C6 and C15 stay live in full; and a new
**standing-rules table** keeps the one-line habit rule from every closed entry in the working set, which
is the only part of them that was actually being re-read. INDEX **37,416 → 26,343 bytes**.

With the owner's OK, `docs/` root also went **40 → 18** `.md` files: `looker-template_v1_0` deleted
(v1_1 sat beside it — the duplicate `CLAUDE.md` file hygiene forbids in as many words), nine superseded
handoffs and twelve one-time module-install guides moved to `docs/archive/`. Dangling references were
swept with grep rather than assumed: `worker/src/reports.js` cited the deleted looker doc in its v1.4
header entry and now cites v1_1 while preserving what was true when it shipped. `CHANGELOG.md`'s one
citation of a moved handoff is **deliberately left alone** — it is append-only history, and rewriting it
to match the present is the C9 error inverted.

## v0.85.0 — 2026-08-04

### The KOTC player link — the first of the three screens

`kotc.html` + `web/assets/kotc.js`. A player opens their own link on a phone, standing on grass, with
no sign-in: the token is the credential, the same contract `/api/score/:token` has used for captains
since v0.3.0.

**The server decides what the screen is.** `/api/kotc/:token` returns `mode` — `enter`, `confirm` or
`done` — computed in exactly one place, `playerView` in `kotcplay.js`. The page renders that field and
never works it out again. Every POST response also spreads a fresh view, so the screen *after* an
action is the server's next screen rather than the page's guess at it; there is no client-side state
machine to drift. A page that re-derived this would show a blank net to somebody the server had asked
to *check* a scoreline, and they would overwrite it. Nothing would throw and nothing would log — the
leaderboard would simply be wrong.

So `kotc_screen.test.mjs` asserts the **absence of a second decider**, which is the hard kind of
assertion, because an absence never goes red on its own (C10/C13). It refuses three shapes in the
shipped source: assigning a `mode`, spelling a mode into a ternary branch or a `mode:` key, and
failing to read the server's field at all. The negative control pastes `playerView`'s **real
expression** into the **real file** and proves the guard catches it.

That guard caught its own first draft. The refusal was originally "a mode literal as any object
value", which reddens on `action: "confirm"` — the API's *action* vocabulary overlaps the *mode*
vocabulary on exactly that word, and forbidding it would have forbidden the confirm POST the screen
exists to send. Narrowed to the ternary branch, which is the shape every real derivation takes.

**Click budget (owner #19, counted):** confirming what somebody else typed is **one tap**. Entering a
whole net is type-then-save. A player who only remembers their own points total types **one number** —
the v0.79.0 solver derives the rest of the net from it, and a game it cannot pin comes back named as
still needing a score rather than guessed. An empty field is omitted from the POST, never sent as
null, so a partial submission cannot wipe somebody else's work.

Also asserted: all four submission shapes the API accepts are reachable from the page (call sites, not
definitions — standards §6.5), every `animation` name resolves to a real `@keyframes`, and the
`prefers-reduced-motion` block covers `animation` and not only `transition` — the v0.84.0 lesson,
applied to a new page on its first release rather than ten later.

### What the header ratchet caught

`kotc.html` shipped hand-written with a reduced header — brand and theme toggle only — and
`header_shell.test.mjs` / `header_actions.test.mjs` reddened immediately: the canonical member header
is byte-identical across every member page, and the count is a deliberate ratchet so that whoever adds
a page has to confirm it ships the real header rather than a lookalike. The header was taken from
`score.html`, the closest precedent — also a no-login token page, where the Admin and mail links ship
hidden and site-nav reveals them only against a local token. Floor moved **14 → 15**, with the reason
recorded at the assertion.

### C13, in the session whose headline rule is C13

The buster sweep for this release **missed the repo root**, and then verified itself clean against the
same blind corpus. `Get-ChildItem -Path . -Include *.html,*.js` without `-Recurse` matches **nothing**
in PowerShell, so `404.html` — which ships from the repo root and was the whole subject of C13 one
release ago — sat at `?v=0.84.0` while everything under `web/` moved to 0.85.0. Reported as a single
clean value, because the check and the thing it was checking shared a corpus.

Caught by re-verifying with ripgrep over the entire repo — a method sharing no code with the sweep.
Final state is **377** busters at one value 0.85.0 (371 + 6 new), which reconciles exactly with the
figure recorded last release. **A verification that reuses the corpus of the thing it verifies is not
an independent check.**

### The API was complete for one screen, not three

Recorded because the handoff said "the API is complete and tested — do not rebuild it", and that is
true only of the screen shipped here. `kotcplay.js` has five routes and then `return null`. The other
two screens need three routes that do not exist: a write that moves a player between nets (there is no
drag without it), a route that lists sessions (the admin GET takes a session id nobody can discover),
and a public read (the only leaderboard is inside a `requireStaff` route). They were **not** added here
— a route with no screen is failure class 1, and shipping three would have left three half-screens
instead of one whole one.

### Housekeeping

`kotc.html` registered in the `build-status.js` tester registry, without which `build_status.test.mjs`
fails coverage by design. No migration: the live ledger was read back at **0042** / 42 rows, matching
the repo's 42 files. Suite **1166 → 1180**, all 14 new tests from `kotc_screen.test.mjs`, measured
before and after.

## v0.84.0 — 2026-08-04

Live-view animations — the last of the owner's eight numbered items, deferred three sessions.

Owner item 2: *"add cool animations to the live view so when things are updated there is an animation
that is engaging for viewers."*

### The board re-renders every 25 seconds, which is why the obvious build would have been wrong

`render()` replaces `innerHTML` wholesale on every poll, so every node is a new node every 25
seconds. An enter-animation written the obvious way — a keyframe on `.lv-court` — would therefore
replay on **every card on every poll, forever**, on a display somebody leaves running all afternoon.
That is precisely the rule standards §5 states as "no enter-animation on high-frequency controls",
and it would have shipped looking like a feature.

So the page now **diffs each payload against the previous one and animates only the difference**. The
nodes are new; the knowledge of what changed lives in a `prev` snapshot, not in the DOM. A poll where
nothing changed animates nothing at all. That inversion is the whole release: *on this board,
movement is information.*

### What animates, and what each one had to earn

| Trigger | Effect | Values | Why it earns motion |
|---|---|---|---|
| A final score lands | Pop on the score cell + a decaying flash on the card | `--dur-pop` 180ms, `--ease-out` | The headline. A handful of times per round |
| A card is new to the board | Scale-in from 0.97 | `--dur-pop`, `--ease-out` | Never from `scale(0)` — nothing appears out of nothing |
| The round advances | The on-now cards stagger in, 40ms apart, capped at 8 | `--dur-pop`, `--ease-out` | Once per round. Says "a NEW set of games", not the same ones re-rendered |
| A team changes rank | The row travels from its old position to its new one (FLIP) | `--dur-modal` 240ms, `--ease-in-out` | Already on screen moving A→B, so ease-in-out, not ease-out |
| A champion appears | One pop | `--dur-modal`, `--ease-out` | The rarest moment in the event |
| First paint | One stagger | as above | A wall display loads once a day |

Every value comes from `tokens.css`. Nothing new was invented. The flash is a composited overlay
fading its `opacity`, not an animated background colour, because `transform` and `opacity` are the
only two properties that skip layout and paint. Gold appears there as a **background at low alpha**
and never as text — the gold rule, which measures 1.87:1 the wrong way round.

**Exits deliberately do not animate.** A card leaving is destroyed by the `innerHTML` replacement,
and keeping it alive to animate out means a keyed reconciler — a much larger rewrite of a page whose
first duty is to never blank. An instant exit is the limit case of "exits faster than entrances", and
on a scoreboard "that game is over" is carried by the card that replaces it.

**Two durations are over 300ms on purpose.** The 900ms card flash and the colour settle are *decays*,
not responses to a tap. The ≤300ms rule governs how fast an interface answers the user; nothing here
is a user action. The movement inside each effect is 180ms or 240ms — only the fade-back is slow,
because a highlight that vanishes in 180ms on a board read from thirty feet away has not been seen.

### Two fields the server had been sending with nothing reading them

`degraded` and `degraded_note` have been in the payload since **v0.77.0**, and `current_round` since
**v0.73.0**. No page read any of them. `live_board.test.mjs` covered the API side thoroughly —
including a negative control proving the flag is not stuck on — and nothing asserted the page did
anything with it. Failure class 1: built, tested, and uncalled.

The consequence was not cosmetic. A board that lost its bracket read rendered an **empty** bracket,
which asserts *there is no bracket* — a wrong answer presented as a fact, on the one surface where
nobody is watching the logs. It now shows the server's own sentence in a `.notice error`, and
`current_round` renders as "Round 3" beside "On now".

**A degraded board animates nothing.** A section that came back empty because its read failed looks
exactly like a section that emptied, so "what changed" is unknowable and motion would dress a guess
as a fact. The snapshot is dropped after a degraded poll rather than diffed against.

### The guard, and what it does not claim

`live_motion.test.mjs` (20 tests, 7 negative controls) does **not** check that the motion values
drifted — that is the C11 mistake, and a page can fail by using nothing at all. It asserts four
things that can each be false while the page still parses and screenshots fine:

1. **The motion exists.** Every animation name resolves to a defined `@keyframes`. `animation: lv-popp`
   is valid CSS that throws nothing, logs nothing and animates nothing — the button bug in CSS form.
   Also flagged in reverse: keyframes defined and never referenced.
2. **It is built on tokens.** No literal `cubic-bezier`, no bare `ease-in` (with `ease-in-out`
   correctly exempt, proven both directions), every declaration carrying a `var(--ease-*)`.
3. **It is diff-driven.** The single line `if (had === has) continue;` is pinned, because that
   comparison is what keeps a 25-second refresh from becoming a flicker every 25 seconds.
4. **The degraded state is shown, not animated over.**

It states in its own header what it cannot see: whether the motion looks *good*. Timing and feel are
judged by eye, in slow motion, on the real board.

Also fixed: this page's `prefers-reduced-motion` block covered `transition` only. Every effect added
here is a keyframe animation, so that block would have let all of them straight through. It now
covers both, and the script skips the FLIP's layout reads entirely rather than measuring rows for an
animation nobody will see.

### A stale cache buster the guard could not see, for ten releases

The sweep found `404.html` at the **repo root** sitting at `?v=0.74.0` while all 369 busters under
`web/` read 0.83.0. `asset_versions.test.mjs` — the guard whose own header says it "scans the WIDEST
set" — was scanning `web/*.html` and `web/assets/*.js`. The stale file was one directory up, and the
guard had reported clean the entire time. Nobody narrowed it; the file was simply never inside it.

That is the same defect standards §11 records for migrations 0004–0007, which sat at `db/` root while
`schema_gate.test.mjs` scanned only `db/migrations/`. **A file's location is part of whether a guard
can see it**, and "the widest set" has to mean the widest set that *ships*, not the widest directory
someone remembered to name. The corpus now includes the repo root, with a control that replays the
exact ten-release regression against the real file and proves it now fails.

### Measured

Suite **1166 passing, 0 failing** (1144 → 1166: +20 motion guard, +2 buster guard), **69** test
files, **50** modules parse, ledger **0042** with no migration this release, cache buster a single
value at **0.84.0** across 371 occurrences including the repo root for the first time. The
`index.js` bump byte-verified as a one-line diff.


## v0.83.0 — 2026-08-04

The test-data generator, fixed — and fixed for a different reason than the one it was assigned.

### `generate` could be blocked by its own previous output

Owner: *"the test data module does not work."* Handoff v0.81.0 diagnosed a generator that died part
way through a run on live, leaving a partial seed nobody could clear, and asked for it to be made
**resumable**. It was not that, and there was nothing to resume. Five facts read from live D1:

1. **All eight contacts carried `created_at = 2026-07-24 16:18:40`** — identical to the second, and
   ten days before `sandbox.js` v2.0 shipped in v0.67.0.
2. **`city` was "Colorado Springs"**, which is not in the current `CITIES` array.
3. **`score_token` was NULL on all four teams**, where every team INSERT writes a `deadbeef…` token.
4. **Two of three event names** did not match the strings the file inserts.
5. **`contactRows()` is ONE `INSERT` with 48 tuples.** A multi-row INSERT is atomic in SQLite, so
   "8 of 48" is arithmetically impossible as a partial write. Eight rows sharing one timestamp is
   what a *complete* insert of eight rows looks like.

The seed file's own header closed it: `db/2026-07-26_seed-testdata_v1_1.sql` records moving the test
cities *"Colorado Springs → Aurora"*. Live still said Colorado Springs, so live came from the **v1.0**
seed SQL — the file v1.1 instructed be deleted — hand-run around 2026-07-24. **Never from
`sandbox.js` at all.**

The limit theory failed on the documented numbers too: D1 allows **1000 queries per Worker
invocation** on Workers Paid (50 on Free), 100 KB per statement, 30 s per query. The route issues
**44**. Four percent of the cap.

**The real defect was the refusal.** `generate` returned 409 on finding any row in 90000–90999 and
the rail greyed out its own Generate button, so a seed from an older version of the file was a dead
end whose only exit was a Wipe you had to know to look for. *A fixture generator that can be blocked
by its own previous output is not a tool, it is a puzzle.*

### What changed

`generate` now **clears the range and reseeds**. Both it and `wipe` run the one delete list in
`WIPE_SQL` — two implementations of "remove the test data" would drift, and this file already carries
a comment warning about exactly that for bracket drawing.

Both paths go through a **single `D1.batch()`**, which is a SQL transaction: a failing statement rolls
the whole sequence back. A half-written seed is now **impossible** rather than unlikely. `wipe` gets
the same treatment — it was fourteen sequential autocommits, so a mid-way failure there really did
leave a partial delete, sitting inside the button whose job is to prevent one.

Deliberately **not** `ON CONFLICT DO NOTHING`, which the previous handoff proposed. It would convert a
real failure — the delete list forgetting a table — into a silently incomplete fixture that reports
success, and a fixture that lies about being complete is the exact thing this file exists to avoid.

`admin-nav.js` v2.21 stops greying out Generate; it reads **"Regenerate test data"** when a seed
exists. Recovery is **one tap** instead of Wipe → confirm → Generate (owner requirement #19).

### Tests: 1142 → 1144, and one deletion worth naming

**`sandbox_seed.test.mjs` asserted the 409 as correct behaviour.** The test encoded the dead end. It
is replaced by the property that actually mattered — *you never get two copies* — plus two new ones:

- **`generate` recovers a seed left by an older version of the file**: seed the range v1-shaped (old
  event names, no score tokens, Summer Open with zero teams), generate, assert convergence on the
  current fixture. This is the owner's live situation, now a regression test.
- **A seed that fails part way leaves the range exactly as it was**: forces a real mid-batch failure
  by making one `INSERT INTO standings` throw, then asserts the previous fixture is byte-identical.
  The control checks the mutation actually fired, because a control that never fires proves nothing.

### Owner decision recorded

The 90000–90999 range is **disposable** — owner 2026-08-04, verbatim: *"we can delete them, no need
to preserve… the sandbox is temporary anyway."* That strikes README standing rule #4's exemption for
contacts 90001–90008, a rule `wipe` had already been violating since v0.67.0 with a test asserting
it. The generator recreates those eight identically, so nothing is lost.

### Housekeeping

Buster swept **0.82.0 → 0.83.0** across `.html` and `.js` (369 occurrences). `index.js` byte-verifies
as a one-line diff. `sync-rail.mjs`: all 36 pages already matching. No migration; ledger stays
**0042**. This entry was written **into the release commit** rather than filled from a CI stub — the
writer is prepend-only and idempotent, so the stub step should find it present and no-op, collapsing
a release to one push and removing the unfilled-stub failure mode that `CLAUDE.md` blames for the
v0.36–v0.51 decay.

## v0.82.0 — 2026-08-04

Two of the owner's complaints from 2026-08-03 close here. One closes as a **fix**; the other closes as a
**diagnosis that overturns the previous session's**, and it is the more useful of the two.

### The buttons that were never coloured

Owner: *"many of the buttons text is not colored properly."* Not a token bug. Not a contrast bug. Not the
gold rule, which the previous handoff named as the likeliest culprit — every `color: var(--gold-ink)` in the
tree is correctly paired with `background: var(--accent)`, and every declared token pairing measures AA or
better in both themes.

**Twenty-four buttons shipped carrying a shared modifier and no base.** Thirteen in `admin-pos.html` as
`class="primary"`, `class="secondary"` and `class="ghost"`; eleven in `admin-pos.js` as `class="ghost"`.
Those words are not standalone classes anywhere in the CSS — `app.css` declares them as `.btn.primary`,
`.btn.ghost`, `.btn.danger`, `.btn.sm`, `.btn.small`. A modifier without its base inherits nothing, so each
of those buttons rendered as a **user-agent default control — grey face, black text — in both themes.**

`admin-pos.html` did name them in its own style block, which is how the omission stayed invisible:
`button.primary, button.secondary, button.ghost { min-height: 44px }`. Geometry, and nothing else. The page
looked like it had a button system. It had a height.

Present in the page's **first commit** (`083cb32`) — never a regression, so no release introduced it and no
diff review would have caught it.

**How it passed every gate, which is the part worth keeping.**

- `tokens.test.mjs` ratchets token *drift* — whether a page invented its own hex. These buttons referenced
  no token at all, so there was nothing to drift. **A page can fail by using NOTHING, and a drift guard is
  structurally blind to that.**
- `shared_buttons.test.mjs` forbids page-level selectors that *start with* `.btn`. It polices **redefining**
  the shared set. These pages never redefined it — they failed to **use** it. The guard was aimed one inch to
  the left of the defect and reported clean, correctly, about a different question.
- No contrast guard existed. One still would not have caught this: there is no declared foreground/background
  pair to measure when the only declaration is `min-height`.

That is **INDEX C10's shape, not the library's failure class 3** — not a guard narrower than its subject, but
the *absence* of a guard over it. Absences never go red.

### Two guards, both with negative controls that mutate the real input

**`button_vocabulary.test.mjs`** — a `<button>` or `<a>` carrying any `.btn` modifier must also carry `btn`.
The modifier list is **parsed out of `app.css`**, not hardcoded, so declaring `.btn.warning` tomorrow extends
the guard instead of escaping it. It scans the widest set: every `web/*.html` **and** every
`web/assets/*.js`, because eleven of the twenty-four offenders were inside a script — an HTML-only guard
would have called the page clean and been half right, the same narrowing `shared_buttons.test.mjs` was itself
written to correct.

The one honest exception is a page that colours the modifier through its own rule; `admin-uploads.html` does
exactly that with `.up-row-actions .danger { color: var(--danger) }`, and its `class="danger"` button is
correct. The exemption **requires the rule to set `color`** — its negative control proves a geometry-only
rule does not earn the pass, which is precisely the hole the real bug fell through. A second control strips
the colour declaration from the real `admin-uploads` stylesheet and asserts the button is then caught.

Written to catch 24 offenders, it found **5 more while being written** — `class="btn-min primary"` in
`admin-documents.js` and `admin-org-settings.js`. Those proved legitimate (`.btn-min` sets its own colour),
which is what forced the exemption to be modelled properly as a subset test rather than asserted.

**`token_contrast.test.mjs`** — computes the WCAG 2.x ratio for every pairing the design system actually
declares, in both themes, with values **parsed from `tokens.css`** rather than restated. A guard holding its
own copy of the palette passes while the shipped palette is wrong; that is the C10 shape again.

It also makes the gold rule arithmetic instead of folklore. It asserts that gold **as text** on a light
surface really is the AA failure standards §5 claims (measured **1.87:1**), that `--emphasis` is what rescues
it (**14.22:1**), and that light-on-gold fails too. A rule everyone repeats and nobody measures is how
`--emphasis` could have been reverted to raw gold at any point in the last thirty releases unnoticed.

### The test-data generator: the previous diagnosis was wrong

Handoff v0.81.0 §2b recorded live D1 as holding a **partial** seed — "3 of 6 events and 8 of 48 contacts" —
left by a generator that died part way, with a stated `[INFERENCE]` that Workers CPU limits or a D1
per-invocation statement cap killed it mid-run. **No code change ships here, because that is not what
happened.** Five independent facts read from live D1:

1. **All eight contacts carry `created_at = 2026-07-24 16:18:40`** — identical to the second. `sandbox.js`
   v2.0 shipped 2026-08-03 in v0.67.0. The rows are ten days older than the code accused of writing them.
2. **`city` is "Colorado Springs"** on contact 90001. The current `CITIES` array is `Aurora, Denver, Pueblo,
   Monument, Fountain, Castle Rock`. The current code *cannot* produce that row.
3. **`score_token` is NULL on all four teams.** Every team INSERT in the current file writes a non-null
   `deadbeef…` token.
4. **Two of three event names differ** from the strings the current file inserts.
5. **`contactRows()` is ONE `INSERT` with 48 value tuples.** A multi-row INSERT in SQLite is atomic, so "8 of
   48" is not a partial write of it — it is arithmetically impossible. Eight rows sharing one timestamp is
   what a *complete* insert of eight rows looks like.

Live holds a **complete, coherent v1-era seed** written 2026-07-24 — precisely the shape `sandbox.js` v2.0's
own header attributes to v1 ("its one upcoming tournament had four registrations and ZERO teams": event 90002
live has 0 teams). **Nothing half-ran. There was never a partial state.**

The limit theory also fails on the documented numbers, checked rather than assumed: D1's cap is **1000
queries per Worker invocation** on Workers Paid (50 on Free), max statement length 100 KB, max query duration
30 s. The route issues **44** statements, none remotely near 100 KB — 4% of the cap.

**What is actually broken is the refusal.** `generate` returns 409 whenever it finds any row in the
90000–90999 range, and the rail modal greys out Generate when seeded. So a seed from an older version of the
file is a dead end, and the way past it is a Wipe whose purpose is not obvious from a disabled button. *A
fixture generator that can be blocked by its own previous output is not a tool, it is a puzzle.* Also
verified: all fourteen tables the wipe touches exist on live, and no table outside the wipe set holds a
single test-range row, so the wipe has no blocker either — it would complete cleanly today.

The fix is specified and unblocked on everything except a write permission for `worker/src/sandbox.js`:
`generate` clears the range and reseeds, both paths through one delete list, the whole sequence in a single
`D1.batch()` — which is a SQL transaction, so a failing statement rolls back everything and a half-written
seed becomes impossible rather than merely unlikely. Deliberately **not** `ON CONFLICT DO NOTHING`: that
would turn a real failure into a silently incomplete fixture reporting success, and a fixture that lies about
being complete is the exact thing the file exists to avoid. See handoff §2b.

### Housekeeping

Suite **1129 → 1142**, measured before and after, 0 failing. Test files **66 → 68**. Cache buster swept
**0.75.0 → 0.82.0** across both `.html` and `.js` (369 occurrences) because this release touches `web/**`.
`worker/src/index.js` byte-verifies as a one-line diff. `sync-rail.mjs` reported all 36 pages already
matching. No migration; the D1 ledger stays at **0042**, read back live and confirmed equal to the repo.

## v0.81.0 — 2026-08-04

Owner 2026-08-03: *"the screens now all terminate, the test data module does not work... many functions are
still not working."* Diagnosed by **driving the app**, not by reading it.

### The harness carried half the database

`journey-schema.sql` — whose own header says it is *"the real production schema, read verbatim from live"* —
carried **46 of live D1's 97 tables.** Fifty-one were missing.

**29 endpoints across 16 admin pages returned 500:** announcements, marketing (campaigns and segments), POS
(products, sales, shifts, sponsors), plans, subscriptions, MRR, passes, member fields, staff pay and rates,
messages, unread counts, uploads, FAQs, facility spaces, schedule views, event templates, tryouts and passkey
registration. **A page whose first fetch 500s stops rendering** — which is exactly what "the screens all
terminate" describes.

**How it survived 1127 passing tests, which is the part worth keeping.** Every test that needed one of the
missing tables *created its own copy by hand* and passed. Every test that did not need one never asked.
Nothing anywhere compared the file against the database it claims to mirror — so the gap was not a failing
test, it was **the absence of a test**, and absences never go red. Three test files were carrying ten
hand-rolled tables between them; those are deleted and they now run against the real schema, which is the
point. With the schema complete, **all 29 endpoints return 2xx** and nothing else had to change: the API was
never broken.

### What was checked and found clean

Recorded so it is not re-audited: every HTML file for unbalanced or mis-ordered landmarks and for content
after `</body>` (**0 problems across 57 pages**); every internal page link and `location.href` target
(**0 dead**); every one of the **55 page scripts** for parseability (**all parse**). So "pages terminate in
the wrong place" is not a markup or routing fault. It was the 500s.

### New guard

`schema_gate.test.mjs` now asserts every table created by `db/migrations` exists in `journey-schema.sql`,
with a negative control that removes a real table and proves the check notices. It reads the **migrations**
rather than live D1 so it runs offline and in CI without a token.

Its first draft reported a table called `statements` that has never existed — it was reading the comment
*"Full CREATE TABLE statements are documented below"* as code. Comments are stripped now, because **a guard
that reports unfixable defects is a guard people stop trusting.**

### Gates

Suite **1127 → 1129**, measured before and after. 66 test files, 50 modules. No migration — the tables already
existed on live; only the harness was behind. No `web/**` change.

## v0.80.0 — 2026-08-03

**King / Queen of the Court is reachable.** Migration **0042**.

Owner 2026-08-03, answering the last open question on the format:

> *"lets do both - but ideally 1 person fill it out for everyone would be nice. then back up each person
> can get a link and if submitted first, the link resolves to confirm - yes or no - then edit."*

### That answer is a better shape than what v0.79.0 built

v0.79.0 built a **symmetric** model: everyone reports, `reconcile` merges, disagreements come back as two
versions and no answer. Defensible, and not what the owner described. His flow always has **one current
answer on the table** — whoever gets there first enters it, anyone else is shown it and asked yes or no,
and "no" leads to an edit that becomes the new current answer.

So the second person through the door is **checking** the first, not competing with them, and the software
never holds two scorelines it cannot choose between. Disagreement becomes a person saying so, on the
record, rather than a collision the code has to arbitrate. `reconcile` is not wasted — it is now what the
admin board uses to show a director where the checking has and has not happened.

The three modes are computed server-side and named — **enter / confirm / done** — because two screens
deciding that independently is two chances to show the wrong one.

### An edit resets everyone else to pending

A confirmation is about **specific numbers**, so it is stale the moment they change. Carrying them forward
would show three ticks against a scoreline only its editor has ever seen — false assurance, and the exact
shape of the "recorded but not in force" defect this project keeps finding. It has its own test, and that
test is the one that matters most in the file.

### Migration 0042 closes a gap nothing was reporting: the entry list was missing

Migration 0040 gave the format sessions, rounds, seatings and games — but **no record of who entered**. The
roster was implied by whoever happened to be seated in round 1, which means a session could not be set up
before it started, a player who arrived and was not seated did not exist, and a player who went home after
round 2 was indistinguishable from one who never came. *Individuals* entering rather than teams is the
whole premise of this format, so that was the one table it could least afford to be missing.

- **The score token lives on the PLAYER for the whole session**, not on `kotc_slots`. Slots are already one
  row per player per round — the obvious place, and it would have minted a **new link every round**: four
  rounds, four links, three of them dead, and the one they kept is the wrong one.
- **Every player gets a link at entry, not on request.** A link minted later only helps people somebody
  remembered to prepare, which is the opposite of a backup.
- A player who goes home is **withdrawn, not deleted** — their games were played and their points are real,
  and `deleted_at` would remove them from a leaderboard they earned a place in.

### Failure class 1, closed — and the ratchet worked exactly as designed

v0.76.0 shipped this engine unreachable and held the gap open with a test asserting `index.js` did **not**
mention `kotcRoutes`/`wireKotc`, whose failure message said: *delete this and put the dispatch-chain
assertion in its place.* Wiring it turned that test red, and this release replaces it with the real mount
assertion plus a check that `kotc.js` is still pure — no `env.DB`, no `request`. **The gap could not be
forgotten, because forgetting it was impossible while the suite was green.** Compare with the alternative,
which was a paragraph in a handoff.

### Three bugs, all caught by tests

1. **`ON CONFLICT(...)` could not match its own unique index**, because that index is **partial**
   (`WHERE deleted_at IS NULL`) as every uniqueness rule here is — so a withdrawn row never blocks a
   re-entry. SQLite needs the predicate restated in the conflict target. Incidentally a clean demonstration
   of the v0.77.0 isolation working: the module threw and the response named
   `failed_modules: ["kotc"]` rather than a bare 500.
2. **`playerView` returned a field called `note`, and every response spread the view *after* setting its
   own note** — so the view silently overwrote it, and every action reported the screen's prompt instead of
   what had just happened. Two tests caught it at once. Now `prompt` (what the screen asks) and `note`
   (what just happened) are separate fields, which makes the collision **impossible** rather than merely
   unlikely.
3. **A submission carrying only totals and no game scores was rejected by an input guard** — which is
   precisely the case the v0.79.0 solver exists for. Somebody who only remembers their own points is still
   useful, and the guard was throwing that away.

### Privacy, and one property worth stating

Names on the link screen are **abbreviated** (standards §8): it is reachable by anyone holding a link, so
it is a login-free surface exactly like the public board. The admin board shows full names, because a
director chasing somebody needs the real one. Both directions are asserted in a single test.

And a net-2 player cannot write net 1 — **nothing in the request names a net**, it is derived from the
token, so that is a property of the design rather than a check that could be forgotten. Asserted anyway.

### Gates

Suite **1107 → 1127**, measured before and after. 66 test files, 50 modules. Ledger **0042**, read back
live. No `web/**` change, so the buster stays `0.75.0`.

**Still unbuilt:** the admin board screen, the player-facing `kotc.html`, and the public individual
leaderboard. The API is complete and tested; what remains is screens — and those wait on the design roster
(`/emil-design-eng`, installed in v0.77.0 and available from the next session start).

## v0.79.0 — 2026-08-03

Owner 2026-08-03: *"each individual is a captain, 1 person can input scores for everyone or each person
can put in scores. If most of the data is entered, build the math logic to calculate the final missing
person(s) based on constraints or given data for the algebra."*

### Why there is anything to solve

In every other format a team has one captain and one score link. Here **the pairing lasts one game**, so
there is no team to own the result and nobody whose job it is to write it down. Whoever is nearest the
pole types what they know — sometimes all three games, sometimes only their own points, sometimes only a
total. What arrives is partial evidence about the same six numbers, from up to four people who each saw
the round from a different side.

### The constraint that makes it solvable is the shape of a volleyball score, not the arithmetic

A game played first-to-21 with no cap (the owner's choice) can only end two ways: **21 to something 19 or
less**, or **n to n−2 for n above 21**. So a game is not two free numbers between 0 and 40 — it is **one
unknown (its total) plus which side won.** That is what turns "four people gave me fragments" into a
system with an answer.

### And for a net of four there is a closed form

```
d1 = (A + B − C − D) / 2        d_i = game i's margin, side A minus side B
d2 = (A + C − B − D) / 2        A,B,C,D = the four players' point totals
d3 = (A + D − B − C) / 2
T1 + T2 + T3 = (A + B + C + D) / 2
```

**Every margin falls out of the four player totals alone.** Verified empirically over 4000 randomised
shape-valid rounds *before* a line of it went into the module, then asserted in the tests across every
combination of a representative sample. The shape rule then finishes the job: a margin **wider than two**
can only have come from a game that ended exactly on 21, so that game's total is pinned.

So **four player totals usually determine all six scores.** That is the answer to "calculate the final
missing person" — the missing person's numbers were never independent.

### What it will not do is guess

Where the evidence genuinely admits two answers, the game comes back **unresolved, with its candidates**.
A plausible invented scoreline looks like a result, ranks people, and nobody ever finds out it was
fiction. The 200-round round-trip test asserts both halves: solved rounds must match the original
exactly, and *declined* rounds must have the real score among the candidates offered.

Also **`reconcile`**, because "1 person can input scores for everyone or each person can put in scores"
means the same game arrives twice and the two versions can differ — on a net of four all four players saw
every game. Last-write-wins would silently pick a side in an argument the software never reported. A
disputed game is left **unset** on purpose: an unset game is visibly unfinished, whereas a wrong one that
has quietly picked a side looks finished.

### Two bugs and two wrong assumptions, all found by tests rather than by reading

1. **The solution cap poisoned the agreement check, and it would have invented scores.** A game is
   reported solved when every surviving solution agrees on it — but the search is depth-first, so the
   first 65 solutions all share the same choice for the games decided *early* and differ only in the
   last. Those early games therefore looked unanimous when the search simply never got round to
   contradicting them. Truncation now poisons the check: only a game narrowed to one candidate by the
   **input** counts as resolved. Found by the negative control that runs the solver on an empty net —
   nothing else caught it, and it is the most dangerous defect this feature could have shipped with.
2. **The closed form was computed and then ignored.** The margins were derived and the full space searched
   anyway, at ~70 ms a round. That is the same defect as a guard that is computed and never asserted on.
   Filtering candidates by the known margin usually leaves exactly one: **14.6 s → 150 ms** for the file.
3. **I asserted one player's total could finish a round. It cannot.** A total is the sum of *their* side's
   scores, so it pins their side of the missing game and says nothing about the opponent — and the shape
   rule still allows 21 to have beaten anything from 0 to 19. The limit is now a test in its own right,
   because the intuition is appealing and wrong.
4. **I asserted that two games finishing by exactly two makes a round ambiguous. Also wrong.** A
   margin-two game has a *minimum* total of 40 (21–19), so two of them totalling 80 can only have been
   40 and 40 — the round is fully determined. Ambiguity is about whether the round total can be **split**
   more than one way, not about counting narrow margins. Recorded in the test with the reasoning, since
   the first version of that test encoded the wrong rule and the solver was right.

### Gates

Suite **1086 → 1107**, measured before and after. 65 test files, 49 modules. Pure functions only, so no
migration and no `web/**` change — the buster stays `0.75.0`.

**Still unbuilt for this feature:** the per-player score links and the routes that accept a report. The
solver was the part that needed the thinking; the plumbing is next, and the `kotc.test.mjs` ratchet still
holds the whole module's unreachability open until it is wired.

## v0.78.0 — 2026-08-03

Two owner requests from 2026-08-03 that turned out to need the same migration. **Migration 0041.**

### A hand-placed team is now HELD

Owner: *"Add admin edit scores if incorrect and allow movement in brackets to fix any errors."*

v0.75.0 proved the manual bracket override reverted within minutes — advancement is derived from scores
and runs on every score entered anywhere in the event — and deliberately stopped at making the warning
honest, because whether a human's edit outranks a score is a product decision rather than something to
infer. The owner has now answered it: **an edit that reverts itself does not fix anything.**

So `matches.slot_locked_a/_b` hold the side. Advance skips a held side and **reports** that it did —
"nothing moved" and "something wanted to move and a human is holding it" are different facts, and the
second is a decision the director made and may want to undo. `release: true` hands it back, and so does
clearing the slot: a director emptying a slot is undoing a mistake, not asking to freeze it empty.

**ONE FLAG PER SIDE, NOT PER GAME, and that is the whole design.** A director substitutes for the team
that went home and leaves the other alone. A per-game flag would freeze the untouched side too, so the
next quarter-final's winner would have nowhere to go and the bracket would **silently stop advancing** —
a bug indistinguishable from the software ignoring scores. Asserted directly: the held side survives, the
other side still receives its winner, and neither is locked as a side effect.

**The four v0.75.0 tests that asserted the opposite behaviour were rewritten, not patched around**, with
a comment in the file saying so. They were correct then; the requirement changed. A test that quietly
flips its expectation is indistinguishable from one that was wrong all along — and those four were the
evidence for the v0.75.0 fix. The old behaviour is still reachable, and still tested, via `release`.

### Exact scores, from the same route

The 2-tap contract (winner + margin) is right for a captain on a phone at the net and **cannot express a
correction**: a game entered 21–15 that was really 23–21 is unreachable through "winner and margin",
which assumes the winner scored exactly `points_to`. So `POST /api/matches/:id/score` now also accepts
`{score_a, score_b}` — from the *same* route, because a second one would be a second definition of what a
score is, and the day the two disagree is the day the standings and the bracket disagree about who won a
game. A correction is audited as one (from → to) and self-heals the tree below it, which is the whole
reason advancement is recomputed rather than accumulated.

A **tie is refused**: every other module here reads an equal score as UNPLAYED, so storing one would
leave a game looking un-entered while the score sheet says it was played.

### Courts that are actually fixed

Owner: *"bracket generation should honor the fixed court number. However, as brackets collapse courts do
become avialable. so there's a need for the scheduling time component if we overlap. We need ability to
assign different courts to players based on availability of courts during bracket."*

Three requirements that argue with each other, and v0.75.0 had satisfied only the middle one — it fixed
the double bookings by treating every court as a single undifferentiated pile:

| | |
|---|---|
| **Fixed** | a division owns courts 5–8 and may not wander onto 1–4 |
| **Collapsing** | a bracket halves every round; the courts it stops needing are real and empty |
| **Overlapping** | so two brackets can share a court — at different times |

New **`worker/src/courts.js`** (pure, no database, no clock). Court resolution is **bracket range →
division range → the whole event**, so the general case needs no configuration at all and the owner's
exception — hand a finished division's courts to one still going — needs no edit to the *division*, whose
range is a standing fact about the day rather than a scheduling detail.

Allocation gives each bracket only the courts it is *allowed*. Brackets with disjoint ranges therefore
run **simultaneously** (a scheduler that queued them would leave half the facility empty all morning);
brackets sharing courts queue; and a bracket down to its final leaves its other courts to whoever else
may use them — which falls out of the allocation rather than being special-cased.

Two hard constraints, both asserted on the widest set (five brackets, five sizes, one facility):

1. **No court holds two games at one time.**
2. **Within a bracket, a round finishes before the next begins.** This one matters *more*: a double
   booking is at least obvious on the day, whereas a semi-final scheduled before the quarter-final that
   feeds it is a bracket that cannot physically be played.

`matches.starts_at` is an **optional** wall-clock time, written only when a slot length is asked for.
`NOT NULL` would have fabricated a time on every historical row, and a made-up time on a results sheet is
worse than no time. And a new route moves a game to another court or time, which **warns and writes
rather than refusing** — the same reason as every other override in this module: a director standing on
court 3 knows the net on court 7 is broken, and refusing the move sends them to a paper grid, after which
the software is no longer the record.

### Migration 0041

`sqlite_master` read live **before the design was fixed** (F-41): no lock of any kind, no clock time on a
game, and a bracket's courts reachable only through its division. Applied via Cloudflare MCP before the
push; ledger row 0041 and all five columns read back after. The schema-gate ratchet fired again and the
number moved only after that read — twice in one day now.

### Gates

Suite **1058 → 1086**, measured before and after. 64 test files, 49 modules. No `web/**` file changed, so
the cache buster stays `0.75.0` deliberately.

## v0.77.0 — 2026-08-03

Owner 2026-08-03: *"If modules fail, do not let it break or stop the system, simply allow it process as
best as possible."*

### What was wrong was worse than it sounded

Route dispatch was one 42-long `||` chain inside a single try/catch. A chain asks every module *"is this
path yours?"* in order and short-circuits on the first answer — so a module that **threw while declining a
path it does not own** took down not just itself but **every module listed after it**. `uploadRoutes` was
first: a fault there meant no brackets, no live board, no check-in, and a bare `500 Server error` that
named nothing. Nothing in the code said any of this was possible.

New **`worker/src/resilience.js`** (imports nothing, so no cycle):

- **`dispatch`** runs each module isolated. A throw is recorded and treated as a *decline*, because a
  module that cannot decide whether a path is its own must not get a veto over the other 41. If a later
  module handles the request, the throw cost a log line. If nothing handles it, the response **names the
  broken modules** — which the old bare 500 could not express, and which a 404 would have turned into an
  outright lie: "no such route", when the route exists and its owner is down.
- **`readParts` / `degradedNote`** for payloads assembled from many independent reads.

### The line this draws

"Never fail" and "fail closed" are both rules in this codebase, so the boundary is the design:
**a failure may cost you information, never permission.**

`buildCtx` and the F-11 org check run before any route sees `ctx` and are deliberately outside all of
this. `requireStaff` **returns** a 403 Response rather than throwing, so authorization is a value on the
success path and an error path cannot convert it into access. Both are asserted structurally, and the
`requireStaff` one scans every module in `worker/src` rather than a sample.

### The live board is the visible payoff

It reads six independent things to answer one request, and one failing query used to lose all six. It now
returns what it has, plus `degraded`, `unavailable` and a human `degraded_note`. A wall display in a gym
is the least forgiving place for a 500 — nobody is watching the logs and the page simply goes blank
mid-tournament. Standings plus "the bracket is unavailable for a moment" beats an empty screen.

A missing **event** is still a 404: degrading must not invent a tournament that isn't there. And a
missing part is deliberately distinguishable from an empty one — handed `[]`, a page cannot tell "there is
no bracket" from "the bracket could not be loaded", and would render the second as the first, which is a
wrong answer presented as a fact.

### Dispatch is now one table, which is a second improvement

Nine test files each grepped `index.js` for their own module's chain entry. That is nine *narrow* guards,
and a module with no test file had none at all — **failure class 3 exactly**. Those nine now assert the
table entry, and a new widest-set guard checks the mapping **both ways** for every module at once: every
`*Routes` export in `worker/src` is in the table, every table entry is a real export, and every mounted
module is imported. Order is asserted too — it decides which module wins an overlapping path — and was
preserved byte-identically, verified programmatically: 42 modules in, 42 out, same sequence.

### Also in this release

**`CLAUDE.md` §1.1 — verification cadence, owner decision.** Both halves of what the owner said: *"do not
believe release history as AI can make mistakes"* **and** *"do not audit every time, but catch it during
testing or do periodic code reviews and audit the documentation."* As a table: `preflight` every session;
`grep` the **one** claim you are about to build on; guards catch the rest for free; a full fresh-eyes pass
plus a documentation audit *periodically*, not per session. The trap it replaces is treating "I read it in
the handoff" as verification. The trap it must not create is re-deriving settled facts.

**`/emil-design-eng` installed.** Mandated by standards §5 since the port and never actually present —
every session so far silently substituted for it. Now at `~/.claude/skills/` from
`github.com/emilkowalski/skill`: Emil Kowalski's own repo, MIT, **markdown only, no scripts or hooks**,
verified before installing. Four companions came with it and are the right tools for the animation work
still queued: `review-animations` (carries its own STANDARDS.md), `improve-animations`,
`animation-vocabulary`, `find-animation-opportunities`. A skill installed mid-session is not in that
session's skill list, so it becomes usable from the next start — `CLAUDE.md` §4 now says so rather than
leaving a future session to rediscover it.

### Gates

Suite **1036 → 1058**, measured before and after. 63 test files, 48 modules. No `web/**` change, so the
buster stays `0.75.0`.

## v0.76.0 — 2026-08-03

**King / Queen of the Court — the engine.** Individuals enter, not teams. Migration **0040**.

### The five open questions were asked, not guessed

`docs/2026-08-03_spec_kotc_v1_0.md` §6 listed five things it said "should be asked rather than guessed
at". All five were answered by the owner before a line of this was written.

- **How many players move up per net.** The owner's own words held two rules that only agree at some
  net counts — *"We take the top 8 scores amongst nets, usually its 1 per net for equity. But with
  fewer nets, we may take more than 1."* Four candidate formulas were put up, including two that
  reproduce "top 8" exactly (2 per net at four nets, 1 per net at eight). He declined all four:
  **"Director sets it each session."** So **no formula is encoded anywhere.** `move_up` is a column,
  defaulting to 1 — his own "usually 1 per net for equity" — and a test asserts the engine never
  derives it from the net count. A guessed formula here would have been quoted back later as a
  decision the owner never made.
- **A field that is not a multiple of four.** *"we would fill each person to join an existing net and
  do a 5 team rotation rotating pairs. However, this should not happen where people drop, we would go
  in with even numbers."* So 14 players is **4 / 5 / 5** — not the 4 / 4 / 4 / 2 the spec proposed. A
  net of two is not a net.
- **Ranking tiebreak.** Total points, then **wins**, then point difference, then contact id so the
  order is never random — a board that reshuffles while nobody is touching it is its own bug.
- **Game length.** First to 21, no cap, set per session. There is deliberately **no `cap` column**: a
  nullable one invites a default that quietly reinstates the thing the owner ruled out.
- **The eight-game floor.** *"No — this format sets its own length."* No minimum-rounds column and no
  check. That absence is a recorded decision, not an omission, and a test asserts the pool-play floor
  has not crept in.

### A net of five is a complete rotation, not a degraded four

This came out of the owner's own answer and is better than what the spec asked for. Five players play
**five games in which all ten pairs partner exactly once and every player sits out exactly one game** —
C(5,2) = 10, and 5 games × 2 pairs = 10, so a perfect rotation exists at five and the construction
either hits it exactly or is wrong. No scaling, no scoring adjustment, nothing to explain to a player.

**And it is easy to get wrong in a way that looks right.** Pair the four non-sitting players as
(k+1, k+2) against (k+3, k+4) — the arrangement most people write first — and you still get five
games, everybody still plays four, everybody still sits out once. It just forms five distinct pairs
twice each instead of ten once each, and quietly stops being fair. The negative control builds exactly
that wrong rotation and proves only the pair count distinguishes them, because eyeballing it proves
nothing.

*(Distinct from the "rotating pairs" FORMAT the owner descoped on 2026-08-03 — that was a whole
tournament shape. This is one net's internal rotation.)*

### Two findings against the spec, recorded in the module rather than worked around

1. **§4 item 5 asks for something that cannot exist.** It wants `partnerHistory` *"so `nextRound` can
   prefer a fresh pairing when it has a free choice."* **It never has a free choice.** A net plays
   *all* its pairings — three at four players, ten at five — so there is no pairing decision at either
   size, only the order of the games, which does not change who partners whom. Partner repeats are
   therefore decided entirely by who shares a net, and that is decided by the scores.

   `partnerHistory` is consequently **reporting**, plus a tie-break of last resort when two level
   players compete for one place. That is still exactly what the owner asked for — *"yes they can
   repeat - idealy not if possible, but it can happen, not a fixed position"* — but the honest
   mechanism is far smaller than the spec assumed. An optimiser with nothing to optimise would have
   been theatre, and the next person to read this file would have gone looking for it. The finding is
   written into the module header and asserted by a test, so it cannot be deleted by accident.
2. **§3's proposed `games_per_round` column is dropped.** It is 3 or 5 depending on a net's size, so it
   is per-net and derived — never a session-wide setting.

### Migration 0040

`kotc_sessions`, `kotc_rounds`, `kotc_slots`, `kotc_games`. `sqlite_master` was read live **before the
design was fixed** (F-41): zero `kotc*` tables, and the live ledger at 0039 agreeing with the repo.
Applied via Cloudflare MCP before the push; ledger row 0040 and all four tables read back after.

- **Nothing that already exists can hold this.** `teams` is the unit of play everywhere else — a team
  registers, is scheduled, appears in standings, wins. Here an individual registers and a partnership
  lasts one game. Throwaway two-person `teams` rows would put roughly three rows per player per round
  into the table every other report reads, and `standings` would fill with pairs that existed for
  eleven minutes. There is no column that fixes that.
- **The four players are stored ON each game**, not resolved through the seating. A director moves
  people between nets on the day — that is the premise of the format — and a game resolved through
  `kotc_slots` would silently change who played it every time somebody was dragged. A played result is
  a fact about four named people at a moment.
- **Per-player standings are DERIVED, always.** No stored counter anywhere. The F-26 lesson the passes
  module already paid for: a counter and the rows it came from will disagree eventually, and the
  counter is the one people will have been reading off a screen.
- Unique indexes in **both** directions on `kotc_slots` — one player cannot be in two seats, one seat
  cannot hold two players — because the board writes a whole round at a time and either mistake
  produces a game nobody can play.

### This ships unreachable, deliberately, and a guard says so

**No route. No screen.** The spec ordered the pure functions first, each testable without the ones
after it, and that order was followed.

But *"built, tested, and uncalled"* is this project's **failure class 1** — the rail that went dark on
the page where a tournament is created, the fixture that could not reach the feature it existed to
test, the divisions engine that shipped with no screen. Unreachable code does not announce itself, and
a note in a handoff is not a mechanism.

So the gap is a **ratchet**. A test asserts `index.js` does *not* mention `kotcRoutes`/`wireKotc`, and
goes red the moment somebody wires them — with a message telling them to delete it and put the
dispatch-chain assertion in its place (standards §6.5: assert the call site, never the import line).
The same mechanism caught migration 0040 in the schema gate this session, which is why it is trusted
here.

### Gates

Suite **1007 → 1036**, measured before and after. 62 test files, 47 modules. The schema-gate ratchet
fired on 0040 exactly as designed — the migration landed, the next full run went red, and the number
moved only after `SELECT version FROM schema_migrations WHERE version='0040'` returned a row from live
D1. Net sizes are asserted to survive **ten** rounds of movement at two different `move_up` values,
because a leak of one player per round is invisible in a single step and a dropped player just stops
appearing on the board.

No `web/**` file changed, so the cache buster was **not** swept and stays a single value at `0.75.0`.
Deliberate: the buster exists to invalidate changed assets, and sweeping 58 files that did not change
is churn. (C6 in `docs/INDEX.md` remains open — the guard still checks the buster is *one* value, not
the *current* one.)

## v0.75.0 — 2026-08-03

No new feature. A fresh-eyes review of the ten releases v0.65.0–v0.74.0, on the standing suspicion
that a session which finds five defects in its own same-day code has not found the sixth. It had not.

**Six real defects, four of them in code no test touched.** Every one was proved against the real
router before it was fixed — eight probes, not eight opinions — because the failure mode this project
keeps hitting is a conclusion that reads as sound and is wrong.

### The one that mattered most

**The manual bracket override was silently undone in exactly the case the owner asked for it.**
The route warned "this will be replaced" only when the game feeding the slot had *not* been played.
But the owner's stated reason for the feature is a team that **won** and then went home — *"teams
might forfeit so we can replace them in the bracket."* In that case the response said `Placed.` and
nothing else, and the next advance pass put the original winner straight back. Advance runs on every
score entered anywhere in the event, so the edit survived minutes. Proved: place a bench team in a
semi-final, confirm it saved, score an *unrelated* quarter-final, and it is gone.

Two tests already covered this route's warning — one for "nothing feeds this slot", one for "the
feeder is unplayed" — and both passed the whole time. **A warning wired to the rarer branch is
indistinguishable from no warning at all.** Now reported in both cases, with the imminent one named
separately (`advance_reverts_immediately`) and the forfeit route offered as the thing to do instead.

Deliberately still a warning and not a lock: advancement is derived from scores by design, and making
a hand-placed slot *survive* means recording that it was hand-placed. That is a schema change and an
owner decision, not something to infer. Carried to the handoff.

### Courts booked twice

**Bracket generation put two games on one court at one time, two different ways.** Neither is visible
in the database, neither route complains, and the court grid draws both happily — it is discovered by
two teams walking to the same net.

- An A and a BB drawn together each numbered their own courts from 1. Sixteen teams split 8/8 on four
  courts collided on **seven** court-and-time slots.
- One bracket did it to itself whenever a round had more games than courts: a 16-team round of 16 is
  eight games, and `slot mod 4` gave every court two of them, all in the same schedule round.

Courts and times are now allocated across every bracket at once, by stage rather than per bracket,
starting a new schedule round each time the courts run out. Bracket rounds still continue the
schedule's own numbering, so pool play and the bracket remain one continuous day on one grid —
asserted, because fixing the collision must not detach the bracket from the schedule.

### The rest

- **A hand-typed seed list naming the same team twice was accepted.** `[1,1,2,3]` returned `200` and
  drew team 1 into *both* semi-finals — playing itself one round later. The length check meant to
  catch bad input passes duplicates. The slot route already refuses a team on both sides of a game;
  generation was the way around it. Now refused, naming the team.
- **Two divisions at the same rank returned `500 Server error` and left a half-written layout.** The
  unique index always refused it. The route validated court overlaps carefully, never looked at the
  column beside them, and inserted one row at a time with no transaction — so Open/A/BB at ranks
  1/1/3 wrote "Open" and then died. Now checked up front, both within the payload and against the
  layout already there, in a sentence that names the divisions and says how to get past it.
- **A team could be filed under a division belonging to another event**, through `/assign` or an
  accepted move. Both writes were org- and event-scoped on the *team*; the division never had to be.
  The team then appeared in no division on its own event's screens, which to a director is
  indistinguishable from the team having been deleted.
- **Saving the pool board could lose the whole arrangement.** An empty pool is hard-deleted by design,
  but the loop clearing `teams.pool_id` walks the live roster — so a withdrawn team kept pointing at
  the row about to be deleted. `teams.pool_id REFERENCES pools(id)` (migration 0039), so on live D1
  that is a foreign-key violation failing the entire save, not one dangling pointer.

### Two documentation defects, and the sharper version of one of them

- **`live.js` documented a privacy rule it no longer followed.** Its header read *"No player names.
  Team names only."* while the module published captain names — correctly, abbreviated, per the
  owner's decision.

  **And v0.74.0's own CHANGELOG entry claims this was already corrected:** *"Corrected the live
  board's own header comment, which claimed 'no player names anywhere' and had stopped being true the
  moment this shipped."* It was not. `git show` on that commit shows a **new** comment added above
  `publicTeam` explaining abbreviation, and the stale header line untouched. A comment was written
  near the problem and mistaken for a fix.

  This is failure class 2 in its most literal form — *a decision recorded is not a decision in
  force* — and it lands on the CHANGELOG itself. **A CHANGELOG line saying a thing was fixed is not
  evidence the thing was fixed.** The only evidence is the file.
- **The `qr.js` alignment-pattern table had a hole no guard could see.** The structural test checked
  the first coordinate (6), the last (`size-7`) and the range — leaving the **middle** coordinate of
  versions 7–10 (22 / 24 / 26 / 28) asserted by nothing at all. The round-trip test cannot catch it
  either: it *imports* `ALIGN` from the encoder, so a wrong number is wrong identically on both sides
  and the decode still succeeds. A mistyped centre there produces a QR that renders perfectly, is
  square, has its three corner squares, and will not scan — the exact failure that file's own header
  warns about, found by a captain at a tournament. Now **derived** from the ISO 18004 spacing rule and
  compared against the table, with a negative control that rejects the neighbouring version's value
  and a check that every centre is even (an odd one would fight the timing pattern). All ten rows
  verified; none were wrong.
- `qr.js` claimed "up to 216 data bytes", conflating the data *codeword* count with the payload it can
  carry. The byte-mode limit at version 10 level M is **213**, once the 4-bit mode indicator and
  16-bit length field are paid for.
- Recorded as *deliberate*, rather than left ambiguous: the team joins in the live and bracket match
  queries carry no `deleted_at` filter while the standings query does. A game that was played
  happened, and blanking one side of a finished result would make the board lie about the afternoon.
  The cost — a withdrawn team still appearing in an unplayed fixture until a director clears or
  forfeits it — is now written down instead of being rediscovered.

### Verified correct, so it is not re-reviewed

Recorded because "we looked and it was fine" is worth as much as a defect list, and cheaper than
looking again: the QR spec tables (all ten versions against `blocks × (data + ec) = total` *and*
against the ISO level-M figures), the GF(256) initialisation, the generator polynomial (hand-checked
at n=2 → `[1,3,2]`), both BCH codes (mask 0 → `101010000010010`, mask 1 → `101000100100101`,
version 7 → `000111110010010100`, each matching the spec table), all eight mask patterns, the zigzag
walk and its column-6 skip, all four penalty rules, and the 7+8 format split. `buildTree`'s claim that
a seeded pair can never be empty is genuinely provable (the low seed of every standard pair is
≤ size/2 < n). `bestSplit` is right at every size checked, including 22 teams → 8/8/6 as the owner
asked for. And the three negative controls v0.74.0 flagged as proving nothing were genuinely repaired,
not merely annotated — confirmed in source.

### Gates

Suite **989 → 1007**, measured before and after, never projected. 61 test files, unchanged. Every new
guard ships a negative control, and each control was checked against *what its assertion actually
reads* — the lesson v0.74.0 paid for, applied rather than restated. The court-clash detector is fed a
real double booking and must report it; the seed-duplicate refusal is paired with a valid hand-typed
list that must still be accepted; the division-rank check is paired with a `replace` that legitimately
reuses ranks 1–3 and must still succeed.

## v0.74.0 — 2026-08-03

Owner 2026-08-03: *"Please add captains names for all the tiles - including live scores."* Done — with
a distinction the owner's own standing rule already required (standards §8, recorded in CLAUDE.md §4):
*"Names render 'First L.' unless the member chose public visibility."*

- **`worker/src/names.js` — one definition of how a person's name is written.** Two would be one too
  many: the day they disagree is the day a minor's full name is on a wall display while every admin
  screen insists the rule is being followed. A test asserts no second, hand-rolled abbreviation has
  appeared beside it.
- **Staff surfaces get the full name** — pool board tiles, bracket tiles, the bracket bench, the slot
  chooser. A director chasing a team that has not turned up for its court needs the real name.
- **The public live board abbreviates** to "Ava S." unless that member set their profile to public, in
  which case they get their full name because they asked for it. A junior-league captain is frequently
  a minor, and a page with no login is published to anyone who loads it and indexed by anything that
  crawls it.
- **Abbreviating is the default with no argument passed.** If the default were the full name, every
  new public surface would leak until somebody remembered a flag — defaults decide what happens when
  nobody is thinking about it. Proven by flipping the default and watching three tests fail.
- **The initial comes from the second word, not the last.** "Mary Jo Van Dyke" becomes "Mary J.", not
  "Mary D." — which is a different person to everyone who knows her, and exactly the kind of wrong
  nobody reports; they just quietly stop trusting the board. Single-word names are left alone, running
  it twice is harmless, and a team with no captain reports nothing rather than "undefined U."
- Corrected the live board's own header comment, which claimed "no player names anywhere" and had
  stopped being true the moment this shipped.

**Two pre-existing defects surfaced, neither caused by this change:**

1. **A staff-pay test carried a hardcoded date**, `'2026-08-03T17:00:00Z'`. It passed because that was
   tomorrow when it was written and the rate card is effective from "now". The moment real time
   crossed `2026-08-03T17:00Z`, the shift began starting *before* the card that pays it, the rate
   lookup found nothing, and a green test went red on a calendar boundary with **no code change at
   all**. Now anchored to `datetime('now','+1 day')`, so it means the same thing on every day. Worth
   recording that the first assumption was that this release had broken it; a stash-and-rerun bisect
   showed it had not.
2. **Cache-buster sweep and rail sync are order-dependent.** Sweeping `?v=` inside
   `rail.partial.html` and inside the pages as separate passes leaves them byte-different, and
   `rail_static` caught it. Sync the rail *after* the sweep.

- Tests **989** (+15). Preflight CLEAR. No migration.

## v0.73.0 — 2026-08-03

Owner 2026-08-03: *"there needs to be 2 views, an admin view where they are created, then a display
view for members and public for those who are wanting to see. similar to volleyballlife."* This is the
second view.

- **`live.html` + `/api/live/*` — read only, no login.** A parent standing beside court 3 on venue wifi
  will not sign in, and a TV plugged in by the door cannot.
- **One request returns the whole board.** A display screen polls, and a screen that polls five
  endpoints shows five different moments of the same tournament — the standings from four seconds ago
  beside a bracket from now.
- **"On now" is first**, above standings and brackets, because the question people open this for is
  which court and who is up next. And "now" is the earliest round with an unplayed game, **not** the
  time of day: tournaments run late, and a board that read the clock would be wrong all afternoon.
- **What is deliberately absent is the part worth reviewing.** No player names, no emails, no phone
  numbers, no scoring tokens, and not the private team note — a director's aide-memoire (*"two players
  have a flight at 4"*) with no business on a wall. Team names only. This endpoint needs no login, so
  anything it returns is published to anyone who loads the page; a leak here would be silent, with no
  error and no warning, just a field nobody meant to send.
  - Asserted against the **raw JSON**, not against the queries that produced it, so a join added later
    that pulls a name in fails whatever shape it arrives in. Proven by returning the private note and
    watching the test fail.
  - Draft events answer **404, not 403** — a 403 confirms the thing exists, and an unannounced
    tournament is precisely what is not worth confirming.
- **It says when it last refreshed, and says so louder when a fetch fails**, keeping the last good
  board on screen rather than replacing live scores with an error. A scoreboard that has silently
  stopped updating is worse than one that is visibly stale, because nobody double-checks it. Polling
  stops while the tab is hidden.
- Small events never set up divisions, so there is a **flat table as well as the grouped one** —
  otherwise those events show an empty screen and look broken. Teams in a division but not yet in a
  pool are listed too, or somebody hunts for their team and concludes the board is wrong.
- `json()` gained an optional third argument so this one route can opt into a 20-second cache.
  Additive: every existing caller passes two arguments and still gets `no-store`, which a test asserts
  directly — a cached copy of anything behind a login is the worst sort of bug.

Two existing guards caught things on the way in: NAV/rail parity refused the new page until it had a
rail entry, and the member-header ratchet refused it until 13 was bumped to 14. The byte-identical
header check passed first try, because the page was generated from an existing member page rather
than hand-written.

- Tests **974** (+21). Preflight CLEAR. No migration.

## v0.72.0 — 2026-08-03

Owner 2026-08-03: *"brackets should auto populate but can be overrided with drag and drop or type
entry. Please list the pool they were from in their tile. The reason this is needed is teams might
forfeit so we can replace them in the bracket."* And: *"The assignment of bracket will be dependent on
the admin running it, and reviewing the scores of the game. many people quit at this point too, so we
want to have flexibility to modify."* So the seeding is now explicitly a starting point.

- **Any slot takes any team in the event** — a different pool, a different division, a losing record.
  That openness *is* the feature: a slot editor that only accepted teams the algorithm had already
  approved of would be useless on the one day it is needed. Proven by restricting it to teams already
  in the bracket and watching three tests fail.
- **Two ways in**, because either alone leaves somebody stuck: drag a team off the bench, or click a
  slot and pick from a filterable list. Drag cannot be driven from a keyboard; a list is slow when the
  bracket is on a big screen. Escape closes the chooser — a modal with no keyboard exit is a trap.
- **Every tile names the pool the team came out of, and where they finished.** When three teams have
  gone home, *"Pool B · 2nd · 5-2"* is the difference between a defensible substitution and a guess.
  A name on its own answers nothing.
- **The bench lists every team, not just the unplaced ones**, and marks who is already in the draw.
  Filtering it down would hide exactly the move the owner described — pulling somebody across from
  another pool.
- **A forfeit is a result, not an empty slot.** Recorded as the full game to nil, and the bracket
  advances on its own. Emptying the slot instead would leave the opponent waiting for a game nobody
  is ever going to play. Confirmed before it writes, since it both scores a game and moves the tree.

**The warning that matters.** Advancement is recomputed from scores, so a team placed by hand into a
slot whose feeding game has not been played **will** be replaced by that game’s winner. That is
correct behaviour, and it is also precisely what looks like the software discarding an edit — so the
server reports it and the page repeats it. Three tests: the warning appears where it should, it does
*not* appear on a first-round slot, and it is actually **true** — the third plays the feeder and
watches the hand-placed team get overwritten.

- Tests **953** (+18). Preflight CLEAR. No migration.

## v0.71.0 — 2026-08-03

Two gaps named in v0.70.0's own release notes, both closeable without an answer from the owner. The
league-night board is deliberately **not** here — "single players that are forming nets" is a
different object model from teams in pools, and that question is open rather than guessed at.

- **`admin-divisions.html` — the screen everything else was gated behind.** The divisions engine
  shipped in v0.69.0 with 26 tests and no page, so none of it could be reached: court ranges, team
  counts and the balancer were API-only. The Pool Board could only tell a director that no divisions
  existed, with no way to create one.
  - **Overlapping court ranges are flagged while typing**, not at Save. Two divisions handed court 5
    is caught by nobody until two teams walk onto it, and finding out when you press Save is one step
    too late. The server still refuses it — that is the guard; this is the courtesy.
  - **"Suggest from courts"** builds four-court divisions from the event's court count and gives any
    remainder to the bottom division. An unclaimed court is a court nobody schedules.
  - **The suggestions show the reasoning, not just the verdict.** Each card carries the sentence the
    balancer wrote plus the numbers behind it — wins, games played, and the division median it was
    judged against. "Move Team 14 down" asks a director to trust an unexplained decision; *"2 wins
    against an A median of 6, and BB is a closer match"* can be read out loud to a parent. Games
    played is half of the top-division rule, so it is on the card too.
  - **Accept and Decline are both real actions.** Declining POSTs a rejected decision rather than
    hiding the row — because *"was this looked at?"* is asked after the fact, and the answer has to
    exist. Proven by mutating Decline into a local row-removal and confirming the test fails.
  - **Every decision re-reads the plan** instead of patching the list on screen. Each acceptance moves
    the medians, so leaving the earlier suggestions up would display conclusions that no longer follow
    from the data.
  - **Save warns before it clears team placements.** The route replaces the layout, which nulls every
    team's division; silently discarding a Pool Board arrangement somebody spent twenty minutes on
    would be its own small betrayal.
  - Every input in the table is labelled — a row of five bare number boxes is unusable with a screen
    reader, and this table is nothing but number boxes. Inputs are 16px so iOS does not zoom on focus.
    Problems are announced through `role="alert"`, and the unsaved indicator is stated in words as
    well as colour.
- **The QR can be saved as a PNG.** Owner 2026-08-03: the code will be used *"to send via text or
  email, or link, not for pictures unless its a fixed picture."* An inline SVG is the right thing on a
  page and the wrong thing in a message — most mail clients strip it and SMS carries no markup at all.
  "Save image" on each scoring-link card writes a file named after the team, because twenty files
  called `download.png` in one folder is twenty files nobody can tell apart.
  - **Whole pixels per module.** A fractional scale makes some modules a pixel wider than others, and
    a scanner reading a photograph of that has to guess where the grid is.
  - **The light modules are painted, not left transparent.** A transparent QR dropped into a dark
    email template is dark-on-dark and does not scan at all.
  - `png()` and `svg()` read the same encoder. A second one would eventually disagree, and only one of
    them would be the version anybody actually scanned.
  - Returns null where there is no canvas, and the page falls back to Copy link rather than failing
    silently.
- Tests **935** (+18). Preflight CLEAR. No migration.

**NOT VERIFIED:** the PNG's pixels. Node has no canvas, so `png()` cannot execute in the suite. The
module grid it draws *is* round-trip verified by `qr.test.mjs`, and the invariants that matter
(integer scale, painted background, one shared encoder) are asserted against the source — but nobody
has pointed a camera at the output file. Still worth one real scan before an event.

## v0.70.0 — 2026-08-03

- **Pool play never offers four games again.** Owner 2026-08-03: *"if we do 6 on 2, with 4 games, we
  would double the number of games to equal 8. So there will never be a situation we offer only 4
  games for pool play."* Six teams on two courts reaches an equal count at 2, 4, 6, 8 … and the old
  code returned **4** whenever 4 happened to be nearest the target. Four games is half a day for
  somebody who paid for a full one. Below the floor the answer is more rounds — twelve instead of six
  — and the rematches that come with it are the intended trade, not a defect.
  - Overridable, because a league night legitimately plays three games and goes home. This is a
    pool-play rule, not a law of the building.
  - One existing test had to change and says so in its own comment: it asserted that 7 games was
    unreachable, and 7 is now below the floor, so asking for it correctly returns 8. Retargeted at 9,
    which is above the floor and genuinely unreachable on 10 teams / 4 courts.
- **Pool sizing.** Owner: *"Most groupings will break down into ranges of 6-11 ... we would aim to do
  larger pools. This is mostly for grass. Indoor tournaments are a lot more limited due to number of
  courts."* So: the fewest pools that keeps every pool inside 6–11. 24 → 8/8/8, 13 → 7/6, 12 → 6/6
  (twelve is over the maximum for a single pool). Checked for every field from 6 to 60. A field below
  six reports that rather than failing — indoors that is normal.
- **Migration 0039** (applied to live D1 and ledgered before the deploy): `pools.division_id`,
  `sort_order`, `court_from`, `court_to`; `teams.pool_id`, `note`, `board_order`. Pool membership was
  previously *implied* by `matches.pool_id` — readable only once a schedule existed and unwritable
  before one did, which is backwards for a board whose entire job is arranging teams **before** any
  schedule.
- **`admin-pool-board.html` — the drag-and-drop board.** Owner: *"drag and drop for me to sort which
  teams go where ... a note that is displayed on the tile ... if i drag to a square or block with +
  it will add a pool. and if it is empty, itll auto delete ... a workspace area to arrange teams."*
  - **The workspace is `pool_id IS NULL`,** not a magic pool row. Nothing to create, nothing that can
    be scheduled by accident, and it is the state every team starts in.
  - **A team in two pools is refused before anything is written.** A partly applied board is worse
    than a rejected one, and a double-booked team is discovered on the morning of the event by the
    people standing on two courts. Asserted from both directions: the request 400s, *and* no rows
    changed.
  - **The note lives on the team, not the placement,** so dragging a tile never loses it. Proved by
    moving a team between divisions and reading the note back.
  - **One request carries the whole arrangement.** Per-drag saves would leave a half-applied board
    every time a connection dropped mid-drag.
  - Nothing saves until you say so. The unsaved state is stated in words as well as colour — a
    director who cannot separate the colours still sees it — and switching event or closing the tab
    with unsaved work warns first. Twenty minutes of dragging silently discarded is the failure that
    guard exists for.
  - **Empty pools:** never created in the first place, and an existing one that loses its last team is
    hard-deleted when it never held a game (no history worth keeping, and soft-deleted rows would
    accumulate as invisible clutter) or soft-deleted when matches still reference it.
  - Keyboard parity throughout: Enter picks up, arrows choose a destination, Enter drops, Escape
    cancels. The 6–11 size hint is advisory and never blocks saving — a board that refused a pool of
    four would be wrong indoors.
- Tests **917** (+26), with negative controls: remove the duplicate-placement check and the
  two-pools test fails. Preflight CLEAR.

**NOT BUILT YET:** the same board for league night and for single players forming nets. The owner
asked for it; the pool board is the general case, and the league variant is a separate screen.

## v0.69.0 — 2026-08-03

Owner asked for 12-court tournaments split into three 4-court divisions, and a bracket that reads
win records and rebalances teams that are misplaced. The schema could express none of it: `teams`
carried a free-text `level` and nothing tied a court to anything.

- **Migration 0038** (applied to live D1 and ledgered before the deploy): `divisions`,
  `teams.division_id`, `brackets.division_id`, and `division_moves`.
  - **Courts are a range, not a count.** Twelve courts split three ways is courts 1-4, 5-8 and 9-12,
    and which is which matters to everyone in the building. A count would let two divisions be
    handed the same physical court with nothing noticing until two teams walked onto it.
  - **`rank` is the ordering, 1 = top.** Every balancing rule is expressed in terms of it. Sorting
    by name would put "A" above "AA" on the one day it matters.
  - **`division_moves` keeps rejected proposals on purpose.** Moving a team down is a conversation
    with a parent, and the question that follows is always *why*. A row answers it with the numbers
    as they stood — 2 wins against a division median of 6. Keeping only the accepted moves would
    discard the record of a decision that was considered and deliberately not taken, which is
    exactly the one somebody asks about later.

- **The engine proposes; the director decides.** Asked directly whether rebalancing should be
  automatic, the owner chose *"propose, you approve."* The plan endpoint is a read — it never writes
  a team's division. Asserted twice, and worth recording why twice was not enough at first: the
  negative control revealed one of those assertions was weak, because its fixture only produced
  `drop` proposals and so could not have caught a plan that applied a `move_down`. Strengthened
  until the mutation actually fails it.

- **The rules, each with a test naming the sentence it enforces:**
  - **The top division holds at 8 — but only trims to get there.** The owner said both *"if they are
    9th or 10th, we will drop them to get to 8"* and that 22 teams should become 8/8/6. Those look
    contradictory until you notice the scale each is about: one or two over is a trim, fourteen over
    is a second and third bracket. Dropping fourteen teams to protect a number would send most of a
    division home.
  - **A trim only applies to teams that have played 8+ games** — *"they will have received
    sufficient game play."* Dropping a team that has played four sends them home early, which is the
    opposite of the intent. A 9th-place team short of a full day is moved down instead.
  - **Misplacement is measured against the median, never the mean.** One hopeless team drags a mean
    down far enough to stop flagging the next one, which is precisely backwards.
  - **Below the top division:** move down if there is somewhere to go; if it is the bottom division,
    two adrift teams get a bracket against each other rather than being sent home.
  - **A division is never gutted to fix it.** If removing the outliers leaves too few to bracket,
    the division is not misbalanced — it is just small.
  - **A trailing group of six stays whole when competitive and splits 4 + 2 when its own bottom two
    are adrift** — judged *within* the group, because a team adrift of a whole division can be an
    even match for the ones immediately around it.
  - **Splits prefer fewer, larger brackets** from 8 / 6 / 4 / 3 / 2. Nine teams is 6 + 3, not 8 + 1
    — greedy-largest-first leaves one team standing alone, and one team is not a bracket.

- **Test data: a 12-court, 30-team, three-division event** with all 135 pool games played. Ten teams
  per division rather than eight, because an 8-team round-robin *cannot* produce the owner's own
  example — with two teams losing everything, the median falls far enough that a 1-win team sits
  only 2.5 below it and stops being flagged. At ten the median holds at 4.5, both outliers are
  caught, and all three rules are visible on one screen: Open trims to 8, A moves two down to BB,
  and BB offers its two a bracket against each other.

- Tests **891** (+30). Preflight CLEAR.

**NOT BUILT YET:** the admin screen for this. The engine and the API are done and tested; the
divisions UI is the next release.

## v0.68.0 — 2026-08-03

Owner asked for score submission by QR code as well as by link. Building it turned up that the QR
this platform already had **never worked**: `admin-checkin.html` loaded `qrcodejs` from a CDN and,
when that failed, printed *"QR library blocked — use the link."* A QR code is used at the door of a
gym, which is the worst possible place to depend on a third-party host being reachable — and it was
also someone else's script executing on a page where staff are signed in.

- **`assets/qr.js` — a self-contained encoder.** Byte mode, error correction level M, versions 1–10
  (up to 216 bytes; every URL here is well under a hundred characters). Nothing external, so it
  works on whatever wifi a venue happens to have. Anything too long throws rather than quietly
  producing something wrong.
- **The spec tables were read from source** (the QR tutorial tables at thonky.com, 2026-08-03), not
  written from memory. One wrong number produces a code that renders perfectly and will not scan —
  the worst kind of failure, found by a captain at a tournament rather than by anyone at a desk.
- **Two real bugs, both of which produced valid-*looking* codes**, caught only because the tests
  attack from angles that do not share the encoder's assumptions:
  1. The generator polynomial was built **reversed** — the `× x` and `× a^i` terms were swapped, so
     every error-correction codeword was wrong. Caught by checking, with a GF(256) implementation
     written separately at the top of the test file, that a codeword is divisible by its own
     generator. That is the definition of a Reed-Solomon codeword, so it cannot be argued with.
  2. Format information copy 2 was split **8 + 7 instead of 7 + 8**. Bit 7 landed on the
     always-dark module and was overwritten, and `(8, size-8)` was left unreserved so a data bit
     took it. The symbol rendered correctly and everything past that single cell decoded as noise.
     Caught by a round-trip decoder written from the spec rather than by importing the encoder's
     own placement code.
- **Two of the negative controls also "passed" while proving nothing**, and are recorded because
  the failure mode is instructive: one corrupted a parity module the decoder deliberately ignores,
  the other corrupted the mode indicator, which does not change the recovered characters. A
  negative control aimed at the wrong region is indistinguishable from a working one. It now
  targets a payload bit.
- **`admin-score-links.html`** — one card per team: name, link, QR, copy button. Printable, because
  the way this is actually used is printing a sheet, cutting it up, and handing a captain a slip of
  paper at the desk. The same link is what SMS will send when that is unfrozen; nothing needs to
  change for it. The QR keeps a white background with dark ink in **both** themes — a gold or
  dark-surface QR is a QR that does not scan, and the theme is not allowed to break it.
- Tests **861** (+16). Preflight CLEAR. No migration.
- Still external: `cropperjs` on `profile.html` for photo cropping. Left alone — a cropper is not
  something to hand-roll, and it fails soft.

**NOT VERIFIED:** that a phone camera reads these. The maths is checked from four independent
angles — table consistency, Reed-Solomon by definition, a spec-derived round trip, and structural
placement — but none of that is a camera. Scan one before relying on it at an event.

## v0.67.0 — 2026-08-03

Two owner reports, one shape of problem underneath both: the feature existed, and the path to
reaching it did not.

- **The rail went dark on the tournament page.** Owner: *"the buttons in tournaments are not
  correctly highlighted."* `admin-event.html` — the page where a tournament is actually built — is
  deliberately not a nav destination, so exact-match marking found nothing and no item lit up at
  all. Nothing was broken enough to fail: the page loaded, the rail rendered, every link worked. It
  simply never answered "where am I." Detail pages now fall back to their section.
  `admin-consent.html` had the identical hole and nobody had hit it yet.
  - `nav_highlight.test.mjs` scans every page that ships the rail and asserts it resolves to exactly
    one item — and that no parent points at a page the rail does not contain, which fails silently
    and looks indistinguishable from having no parent at all.
- **The test data could not reach the feature it was supposed to test.** Owner asked for tournaments
  to try the drag editor on. The old seed's upcoming tournament had four registrations and **zero
  teams** — so there was nothing to build a pool from, and the editor looked dead when it was fine.
  The fixture is a product: when it is wrong, you cannot tell a broken feature from a broken
  fixture, and you reasonably blame the feature.
  - Three tournaments now sit at three points of a real event day. **Summer Open** — 12 teams, 5
    courts, no schedule: generate pools, then drag them. **Fall Classic** — 8 teams, pool play
    scored, standings ranked: generate a bracket and watch it seed off the finish. **Winter Jam** —
    bracket already drawn with the quarter-finals unscored: enter one and watch the winner advance.
  - Winter Jam's bracket is drawn by calling the **real generator**, never hand-written SQL. A
    fixture assembled by a second implementation can pass while the real one is broken — the only
    kind of test data that actively lies to you. Standings are computed from the fixture's own
    scores for the same reason.
  - Every seeded team ships a scoring token, in hex, because the route accepts hex and a fixture
    token that 404s makes a working feature look broken.
- **Brackets advance themselves** (owner: *"brackets should auto advance"*). One helper,
  `advanceBracketFor`, called from the advance route and from **both** score-write paths — staff at
  the desk and a captain on their phone. Copying the loop into each caller would leave three copies
  to keep in step, and the one that drifted would be found on a Saturday. A director typing in a
  quarter-final has their hands full; a second button is a step that gets skipped, and a skipped
  step means the next court call is wrong.
- **Captain self-scoring only ever showed pool play.** `AND m.stage='pool'` meant bracket games were
  invisible to the teams playing them, so the self-scoring link quietly stopped working at exactly
  the point in the day when the desk is busiest. It now lists every one of a team's games with its
  stage named — "Quarter-final" is a different thing to walk onto a court for than "Pool" — and
  scoring a bracket game from a phone advances the bracket, same as the desk.
- **The scoring page retires itself** once a team has nothing left to enter (owner: *"get rid of
  that page after scores are submitted"*). Their results stay visible; the controls do not. Leaving
  the taps up invites someone to come back and re-score a finished game.
- **My own bug, caught by the new fixture test:** the team name "TEST Spike Lee's" broke every seed
  statement on first run. Fixed with a quoting helper rather than by renaming the team —
  interpolating raw text into SQL is a habit worth not having even where it happens to be safe.
- Tests **845** (+18, measured before and after), with negative controls that mutate real code:
  remove the auto-advance call and the advance test fails; remove a page's parent entry and the rail
  guard fails. Preflight CLEAR. No migration.

## v0.66.0 — 2026-08-03

- **Brackets you can actually play** (`admin-brackets.html`, `worker/src/brackets.js`). The repo
  already had a bracket: it seeded a first round, wrote those games, and stopped. Semis and finals
  were never generated, no winner ever moved anywhere, and the bracket row was not even linked to
  its own games. A director could see round one and then ran the rest of the day on paper. That is
  failure class 1 — built, and not usable — and this replaces it rather than sitting beside it.
  - **Byes to the top seeds. No play-in games, ever.** Owner, 2026-08-03: *"we try to avoid
    pigtails as often as possible with too many people waiting."* When the field is not a power of
    two you either sit the top seeds out for a round or you play extra games while everyone else
    watches. Standard seeding pairs positions (i, size+1−i), so the missing high numbers fall
    opposite the best teams on their own. Twelve teams is four first-round games and four byes.
  - **Winners move forward by recomputing the tree from the scores** — not by pushing a winner
    forward once when a score is typed. That makes it idempotent, and it makes a correction
    self-healing: fix a quarter-final that went in backwards and the semi it feeds is fixed too.
    The accumulating version passes the happy path and strands the wrong team in the semi forever.
  - A tie is not a winner. `24–24` is an unfinished game, and guessing would seed the next round
    with the wrong team.
  - Every empty slot names the game it is waiting on — *"Winner of Quarter-final 2"*. An empty box
    answers nothing at the moment a director is trying to say who is on court 3 next.
  - Seeded by pool finish when standings exist, entry seed when they do not, or a hand-picked list.
    A/BB split so the team that finished tenth still has a day.
- **Migration 0037**, applied to live D1 and ledgered before the deploy: `matches.bracket_id`,
  `bracket_round`, `bracket_slot`.
  - **One match table.** A bracket game is a game — played on a court, in a round, by two teams,
    with someone typing a score into the same phone. Keeping it in `matches` means score entry,
    court assignment and the new drag-and-drop editor work on brackets for free; a second table
    would have meant a second version of each, and four chances for them to disagree.
  - `bracket_round` counts **backwards** from the final (1 = final, 2 = semi, 3 = quarter). Forward
    numbering changes what "round 1" means the moment a bracket grows from eight teams to sixteen.
  - `matches.stage` stays the coarse legacy label, clamped at `quarter`, because widening its CHECK
    needs a full non-additive table rebuild against a live database holding real scores. Said out
    loud here and in the migration so nobody later reads `stage` and believes it.
  - Feeds-into is **derived** — `(r−1, ceil(s/2))`, side A when the slot is odd — never stored. A
    stored copy of a fact arithmetic already gives is a copy that can drift.
- **A guard for a defect that was compounding in silence.** New admin pages are built by slicing
  the shell off an existing page. If the source carries a stray `</main>`, the new page inherits it
  *and adds one* — and browsers discard an unmatched closing tag without a word, so the page looks
  perfect. By v0.65.0 five pages were affected and climbing: 5, 4, 4, 3, 2. Swept them all, and
  `page_structure.test.mjs` now scans every shipped HTML file for unbalanced or doubled landmarks.
  It caught my own bracket-page generator on its first run.
- Also swept: the `?v=` cache buster **inside** `admin-nav.js`, `site-nav.js` and
  `signup-widget.js`. The release sweep had only ever touched `.html` — a guard narrower than its
  subject, reporting clean.
- Tests **827** (+24, measured before and after), including negative controls that mutate the real
  code: break the seeding and the bye assertions fail; remove the idempotency short-circuit and the
  advancement assertions fail. Preflight CLEAR.

## v0.65.0 — 2026-08-03

- **Drag-and-drop schedule editor** (`admin-schedule-editor.html`). A generated pool is a starting
  point, not an answer. A director always knows something the solver does not — a broken net on
  court 3, a team that asked to finish by four, two teams who should not meet in round one. Until
  they could move one match without regenerating the whole pool, the real schedule went back into a
  spreadsheet, which is the thing the generator was built to end.
  - **It never refuses a move.** Every drop is allowed and the panel reports what it cost — "1 more
    repeat match-up", "2 teams now sit out twice in a row", or "No change to fairness." A tool that
    blocks the director is a tool the director routes around.
  - **Dropping on an occupied slot swaps.** Overwriting would lose a match, and a lost match is
    discovered on the day by the team that turns up with nowhere to play. D1 offers no transaction
    on this path, so the mover is parked at `court=-1` between the two writes; without that, a
    concurrent read briefly sees two matches on one court. Proven by mutating the swap into a naive
    overwrite and confirming the test fails — then restoring it.
  - **Keyboard parity, not a keyboard afterthought.** HTML5 drag-and-drop cannot be driven from a
    keyboard and is awkward on touch, so: focus a match, Enter to pick up, arrows to move, Enter to
    drop, Escape to cancel. Both paths call the same mover. The fairness delta lands in an
    `aria-live` region, so the result of a move is heard, not just seen.
  - **Moving a match that already has a score asks first.** It is nearly always a mis-drag — but it
    is confirmed, never forbidden.
- **One definition of "fair" (F-26).** `loadSchedule()` rebuilds the planner's shape from the live
  `matches` rows and scores it with the *same* `poolReport` the generator uses. Computing the
  numbers client-side would feel faster and would eventually disagree with the generator — and the
  moment those two disagree, the director believes neither. `schedule_editor.test.mjs` asserts the
  client does not carry its own copy of the rules.
- New routes, all staff-gated and org-scoped: `GET /api/admin/events/:id/schedule`,
  `POST …/schedule/move`, `POST …/schedule/teams`. Changing *who* plays is deliberately a separate
  endpoint from changing *when* — conflating them makes both confusing.
- **Roster sheet spec** (`docs/2026-08-03_spec_roster-sheet_v1_0.md`): one flat table, one row per
  player, a blank name meaning an unfilled slot. Written because the owner's live sheet is the
  format the import must accept, not one this project invents.
- Tests **803** (+11, measured before and after). Preflight CLEAR. Rail swept across 32 pages, cache
  buster to `0.65.0`, `/api/health` bumped as a verified one-line diff (F-34). **No migration.**

## v0.64.0 — 2026-08-03

- **The facility calendar only did days and weeks.** Confirmed in source. Day and week answer "what
  is on today"; they never answer "how busy is October", which is the question a director asks when
  quoting a rental or planning a season. Added a **month grid**.
  - It loads the whole **visible grid**, not just the month. A month starting on a Wednesday shows
    the preceding Sunday–Tuesday, and leaving those cells blank when there are bookings in them is
    worse than not showing them at all.
  - Paging steps a **month** via `setMonth`, not 30 days. Stepping 30 days from the 31st lands in the
    wrong month about half the year — the classic calendar bug.
  - Cells show three bookings then **"+N more"**. A cell listing twelve is unreadable, and
    glanceability is the entire reason the view exists.
  - Keyboard reachable (grid/gridcell roles, labelled day numbers), token-only styling, and on a
    phone the seven-column grid scrolls horizontally rather than crushing to nothing.
- **`facility_calendar.test.mjs` guards the wiring** — button, handler, renderer *and* paging must
  exist together, because it is entirely possible to leave one behind in a refactor and ship a button
  that does nothing. The file states plainly that it proves the wiring, not the pixels.
- **Speed test, measured:** `/api/health` 0.26–0.29 s · member home 0.44 s / 14 KB · `tokens.css`
  0.35 s / 14 KB · 49 pages averaging 17 KB. **No action needed.** Worth recording: the static rail
  is ~14.6 KB of every admin page, duplicated across 31 pages — the price of the rail painting with
  the page instead of popping in after JavaScript. Still the right trade, now written down.
- **Historical decisions archived** into the library's Appendix A, per the owner's request to keep
  settled reasoning out of the working set: why ZIP delivery existed and why it went; the five
  green-but-broken checks and the pattern behind them; the three guards that were narrower than
  their subject; how the scheduling fairness target was derived from the owner's own sheet; and the
  answered infrastructure questions — no database upgrade, no Supabase, no TruVolley pull — so none
  of them get re-litigated.
- README to v0.64.0 with a corrected queue; roadmap M-TF row struck — pool play is done, and
  brackets, Swiss, ladder, multi-day and the drag-and-drop editor are what remain.
- Suite **785 → 792**. Cache-buster swept to `0.64.0`. No migration.

## v0.63.0 — 2026-08-03

- **The generator is no longer a calculator.** `POST /api/admin/events/:id/generate-schedule` writes
  a plan into `matches` for a real event, mapping the planner's 1..N onto the event's actual team ids
  in seed order. It **refuses to overwrite silently** — an event with existing matches returns 409
  with the count and what to do about it, and even with `replace: true` the old rows are soft-deleted
  rather than destroyed, so a director who regenerates after scores are in can still see what they
  replaced. Byes come back as **names**; the planner's numbering never reaches a screen.
- **Waiting becomes working.** Owner: *"no 4 byes does not work … there is a world where 12 on 4 does
  work with each team working."* Referees are drawn **only from the waiting set**, so a team can never
  officiate a match it is playing in, and the duty is spread evenly — everyone waits the same amount,
  so everyone works the same amount. Both properties asserted.
- **`refCoverage()` reports the arithmetic that decides whether a shape works.** 12-on-4 has four
  waiting teams for four courts, so **every bye can be a working bye**; 12-on-5 leaves three courts
  unrefereed. A director promising officials needs that before the day, not during it.
- **12-on-5 measured, and it is the shape to prefer:** 10 games each, 2 byes each, zero repeats, 210
  points, two refereeing turns each. Strictly better than the current 10-on-4 on every axis, and it
  hits the points target exactly.
- **6-on-2** is clean to 6 rounds (4 games each, no repeats) and *must* repeat beyond 7 — only 15
  pairings exist among six teams. The report says so rather than quietly producing rematches.
- **Known limitation, stated rather than hidden:** 5-on-2 over 5 rounds is a perfect 10-match
  round-robin on paper, but the greedy settles for one with two repeats. Correct and fair on games
  and byes; not optimal on pairings at that size.
- Suite **780 → 785**. No migration.

## v0.62.0 — 2026-08-03

- **Pool schedule generator — the six hardcoded templates are no longer the limit.** Any team and
  court count. This is the one thing that actually blocked events: twelve teams on four courts had
  no template, so it could not be run.
- **The owner's question, answered with code: 12 teams on 4 courts works.** 12 rounds → **8 games
  each, 4 byes each**, one repeat match-up, nobody sitting twice in a row, about 4.4 hours. That is
  the *same eight games* as the current 10-on-4 — 20% more teams for 20% more time. The honest cost:
  four byes instead of two, so a team waits a third of the rounds rather than a fifth.
- **The fairness target was measured, not invented.** The owner's hand-built 10-on-4 sheet was found
  in Drive, transcribed and analysed: 8 games each, 2 byes each, **zero repeat opponents**, 40 of 45
  pairings, no back-to-back byes. That is close to optimal, so it became the acceptance standard —
  `formats.test.mjs` asserts the generator *matches* it, because a generator that cannot reproduce a
  schedule a director built by hand is not ready. **It now does, exactly.**
- **Three fixes found by measuring rather than assuming.** The first greedy paired sequentially and,
  with everyone on equal games, fell through to the id tiebreak — producing 1v2, 3v4, 5v6 round after
  round. Greedy *matching* over all candidate pairs helped; it was not enough, because summing ranks
  still made neighbours cheapest. Switching the tiebreak to **circular distance** (the circle
  method's core idea) took 12-on-5 from `11v12` **eight times** to zero. A final **2-opt repair
  pass** swaps partners *within* a round — safe by construction, since games, byes and who is on
  court are untouched, so the hard equal-games rule cannot be broken by the repair.
- **The check row ships, because the owner uses it.** Their sheet carries "Check = 55": every round,
  teams on court plus teams on bye sum to 1+2+…+N, proving nobody is double-booked or forgotten. The
  generator emits it and the report validates it — a schedule you cannot eyeball is one you will not
  trust, and a director who does not trust the generator keeps using the spreadsheet.
- **The report is the other half.** Equal games, equal byes, repeats, bye spacing, estimated hours
  and points per team, plus warnings when the games / points / hours targets cannot all be met. The
  owner's own remedy is supported: raising points-to 25 lifts 8 games from 168 to 200 points without
  changing the schedule shape. Refusals carry the arithmetic — *"7 games each is not possible with 10
  teams on 4 courts; only 4, 8, 12, 16 are. Closest is 8."*
- **Deterministic** (no `Math.random`, so regenerating gives the same answer) and **stateless** — it
  plans, it does not write matches, so a director can try twelve shapes without creating twelve
  tournaments. `GET /api/admin/formats/options` and `POST /api/admin/formats/plan`, staff-only.
- Suite **765 → 780**. No migration.

## v0.61.0 — 2026-08-03

- **No shipped API is unreachable any more.** v0.57.0 and v0.58.0 delivered three tested modules
  with no UI, so the owner could not use features they had already paid for. Passes got its screen
  in v0.59.0; these are the other two, and the list is now empty.
- **Membership fields** — the UI for the M22 registry. Add questions to member profiles, choose who
  sees each one, reorder, hide, delete. The screen is built around the one thing it must not get
  wrong: **hiding is not deleting**. The row reads "Hidden — answers kept", the button reads "Turn
  back on", and Hide has *no* confirm because it is reversible — while Delete has one that points
  you back at Hide. A director who believes Hide destroys data will never use it; one who believes
  Delete is reversible loses a season of answers. Re-adding a hidden field surfaces the server's
  409 verbatim rather than reworded here, so the message cannot drift from the rule behind it.
- **Staff pay** — rate cards per person and optionally per role, plus a date-range report of what is
  owed. Two refusals, both deliberate and both stated on the page: **approved and pending are
  separate columns and are never summed** ("owed" and "might be owed" are different questions, and
  one combined figure is how somebody gets overpaid); and **rates are never edited in place** — a
  new rate is a new row with its own start date, so last month's approved shifts keep the number
  they were approved at. Money is typed in **dollars** and converted client-side, because nobody
  thinks in cents and `2500` in a rate box is the likeliest way to pay a coach a hundred times over.
- **The rail generator wired both screens** — two `NAV` edits, two partial edits, one command, 31
  pages. Third release running. Before v0.59.0 this release would have opened with 31 hand edits.
- Both pages follow the v0.59.0 mobile work: 16px inputs (no iOS zoom), 44px targets, tabular
  figures, tables collapsing to cards under 640px, every control labelled.
- Suite **765/765**. Cache-buster swept to `0.61.0`.

## v0.60.0 — 2026-08-03

- **Tryout evaluations** — the owner's spec, built as written: *"name · position · age · prev club
  (asked during registration), then a blank area for coaches to write, then a quick check to offer
  / not offer."* One card per registered player, filterable by position and by what you have not
  judged yet, with a running "judged 12 of 40".
  - **Notes save on blur, not on a Save button.** A coach evaluating forty players in a gym will
    not press save forty times, and losing a note because they walked away is the failure that
    makes people abandon the tool.
  - **A coach sees only their own notes — enforced in SQL, not in the client.** Showing coach B
    what coach A wrote before B has written anything turns three independent judgements into one
    anchored one, which is the entire value gone. A client-side filter would be one careless edit
    from leaking. Tested: coach B sees `null` where coach A recorded 5 / offer.
  - **The director roll-up reports the split and the range, never an average.** "2/3 offer, rated
    2–5" is actionable; a mean of 3.67 hides that one coach thought this player was a 2 — which is
    the single most useful thing on the page.
- **Team builder — backend complete.** `tryout_squads` + `tryout_squad_members`. Each squad carries
  a target size, colour, age group and a needs map (position → wanted). The board returns every
  squad with its members, its shortfall and whether it is full, plus a club-wide aggregate a
  director can pivot: squads, full, placed, and the summed shortfall by position.
  - **Full means headcount *and* positions.** A squad of ten with no setter is not full, and
    reporting it as full is how a director finds out in week one. Asserted in both directions.
  - **Dropping a player into a squad moves them.** The board is a placement, not a wishlist — a
    setter sitting in two squads is two coaches each believing they have them. Deleting a squad
    releases its players, or the one-squad-per-player index would silently refuse to re-place them.
- **Migration 0036** applied to live D1 via Cloudflare MCP before the push (ledger 36). The F-41
  check ran first and found nothing matching tryout / evaluation / placement. Four new tables, and
  they are deliberately *not* `member_profiles` (a tryout is a point in time, not a standing
  profile) nor `member_fields` (the evaluator page must sort and filter on position, age group and
  rating, which needs real columns rather than a key/value bag).
- Proven to fail: leaking another coach's notes, allowing a player into two squads, calling a squad
  full on headcount alone, and dropping the staff gate each redden the suite.
- **The v0.59.0 rail generator did its job.** Adding "Tryouts" to the menu was one `NAV` edit, one
  partial edit and one command — 29 pages updated. Under the old regime this release would have
  begun with 29 hand edits.
- Suite **743 → 765**, all passing. Cache-buster swept to `0.60.0`.

## v0.59.0 — 2026-08-03

- **The 27-page rail tax is gone — and it never needed the SPA shell.** Measured before building:
  the static rail was **byte-identical across all 27 admin pages**, one variant, zero drift. So the
  cost blocking every new admin screen was mechanical, not editorial, and a generator removes it.
  `worker/scripts/sync-rail.mjs` + `web/assets/rail.partial.html`: `--check` reports drift,
  `--write` sweeps. Proven before first use — clean on the untouched tree, catches a one-character
  drift, repairs it back to byte-equality.
  - It is deliberately **not its own only check**. `rail_static.test.mjs` already asserts the rails
    match each other and agree with the `NAV` array; `sync_rail.test.mjs` adds the third leg
    (partial == pages). Any two of the three agreeing is not enough — a generator that
    self-certifies can write the same mistake to 28 files and call it consistency.
  - First real use, in the same release: adding "Passes & Credits" to the menu was one `NAV` edit,
    one partial edit, one sweep, 28 pages updated.
- **Passes & credits admin screen** — the first of three shipped-but-unreachable APIs. v0.58.0
  delivered the ledger with no UI, so the owner could not use the feature they had asked for. Issue
  a pass, see what is left, spend one, void one. Guest passes prompt for the guest's name, because
  the server refuses without it and it is better to ask than to hand someone an error they cannot
  act on. The page **never computes a balance** — it renders the one the server derived, so the
  number on screen cannot disagree with the history beneath it (F-26). The page shell was
  *generated* from an existing page rather than transcribed, so header, pre-paint snippet, rail and
  script order are correct by construction.
- **Match-level history, deliberately without a rating** (owner 2026-08-03). `profiles.js` now
  returns game-by-game detail under the existing `show_history` toggle: opponent, score, result.
  Event-level résumé already existed; this is the detail underneath it. **No rating, rank or
  derived skill number** — volleyball results belong to a *team*, so a per-player figure silently
  credits someone for their partner's night, and once a number exists people treat it as fact
  whatever caveat sits next to it. Showing the matches and letting the reader judge is both more
  honest and more useful.
- **The three UI fixes recommended in the v0.58.0 review:**
  - `theme-color` was pinned to `#0B0B0D` on every page and never followed the theme, so light mode
    put a near-black status bar above a white page — and in an installed PWA that bar *is* the app's
    title bar. Now read from the `--bg` token and re-synced on toggle, in both shells.
  - **Money columns had no `tabular-nums` anywhere.** Scores and standings did; currency did not, so
    every column of figures in reports, POS and registrations visibly jittered. Scoped to
    figure-bearing cells, never to prose.
  - `score`, `kiosk` and `checkin` carried **zero media queries** and the smallest breakpoint in the
    codebase was 480px — nothing was designed for the 360–390px width people actually hold. Added a
    430px courtside block (52px thumb targets, tables to cards, larger score) plus `safe-area-inset`
    handling for notch devices.
- Cache-buster swept to `0.59.0` (307 refs). README refreshed: version, a **Working on it** section
  covering the two commands that now run the whole loop, and the stale "644 passing" / "ledger 0033"
  figures corrected.
- Suite **737 → 743**, all passing.

## v0.58.0 — 2026-08-03

- **Pass / credit ledger** (`passes.js`, owner: "assign like class pass or mindbody").
  `membership_tiers.guest_passes_per_month` has shipped for several releases — staff could set it,
  the tier screen displayed it, and **nothing in the codebase could ever spend one**. The platform
  promised guest passes it had no way to honour. This makes that column mean something.
  - A pass is *N sessions, valid between two dates, for one contact*. That one shape is
    simultaneously a class pass, a lesson pack and a guest allowance — three products from one
    primitive instead of three subsystems.
  - **The balance is derived, never stored.** There is no `used_sessions` column: remaining =
    total − COUNT(live redemptions), through one interpolated `PASS_USED_SQL`. A stored counter is
    a second source of truth for one fact and this repo carries the scar (F-26); it drifts on
    reversal, soft-delete or retry, and a `COUNT()` cannot. A test asserts the literal count
    appears exactly once in the file.
  - **Reversal is a state change, not a delete** — the desk mis-scans, and the correction must sit
    next to the mistake. Reversing twice is refused; it would credit a session never spent.
  - Guest passes require a guest name, because a guest pass spent on nobody is an unaccounted entry.
- **Staff / coach pay** (`staff_pay.js`) — the foundation the future payroll build needs.
  Rate cards (hourly / flat / per-session, optionally per role, date-bounded) are what someone is
  paid *going forward*; the shift records what they were *actually* paid, **frozen at approval**.
  Raise a coach's rate in September and August's approved shifts must not restate — the same
  discipline as pinning a waiver version to a signature, applied to money. Proven by test.
  - `computePay` returns a **reason**, never a silent zero: a `0` in a pay column is
    indistinguishable from "worked for free", and somebody will believe it.
  - The pay report keeps **approved and pending separate** and never pre-sums them. "Owed" and
    "might be owed" are different questions, and merging them is how someone gets overpaid.
  - **No payroll export, no tax, no clock-in** — stated plainly in the module header, because a
    half-built payroll feature that looks finished is how people get paid wrong.
- **Family connected-accounts view** (`family.js` v1.3). `/api/family` answers "who is in my
  household"; the new `/api/family/overview` answers "what do I have to deal with" — every
  connected account with what is unpaid, what is coming up, what passes remain, and a household
  total. A parent with three children currently opens three profiles to find out they owe money on
  one. Scoped by **guardianship**, not by shared `family_id`: an adult who merely shares a family
  row is not someone whose balance you may read. Tested that another family's child cannot appear.
- **Migration 0035** applied to live D1 via Cloudflare MCP before the push (ledger 35): `passes`,
  `pass_redemptions`, `staff_rates`, eight pay columns on `staff_shifts`, and four configurable
  pricing columns on `plans` (`pricing_type` / `sessions_included` / `pass_valid_days` /
  `signup_fee_cents`) carrying the Gymdesk vocabulary without disturbing the Square subscription
  path that `billing_interval` already drives.
- **Three guard fixes found while writing the tests**, all of them my own guards being narrower
  than their subject — the exact failure class they exist to catch: the derived-balance scan read
  comments and "found" `used_sessions` in the sentence explaining there is none; the org-scope scan
  rejected correlated subqueries (`r.org_id = p.org_id`) that are scoped by inheritance; and it read
  only backtick templates, so it saw 4 statements in `staff_pay.js` where there are 9.
- Suite **709 → 737**, all passing.

## v0.57.0 — 2026-08-03

- **End-to-end operating-loop harness** (roadmap §3.2 — "before more feature surface, not after").
  The other 683 tests are unit- and guard-shaped; not one drove the business through the real
  router in order. Every expensive defect this platform has shipped lived in a **seam**: a module
  never mounted (the v0.49.1 outage), a predicate written twice and drifted (F-26), a claim link
  expiring six hours late (v0.54.0), a function defined and never called (v0.56.0). Unit tests
  cannot see seams.
  - `worker/testkit/d1-memory.mjs` implements the D1 binding over `node:sqlite` (built in, no flag,
    verified on Node 22.23.2 *and* 24.18.1). The surface was measured by grep rather than guessed.
  - `worker/testkit/journey-schema.sql` is production DDL read **verbatim** from live
    `sqlite_master`. Replaying `db/migrations/` cannot rebuild the schema — 0004–0007 and 0011 were
    pruned after being applied, so the folder holds 20 files against a ledger of 34.
  - `e2e_journey.test.mjs` walks sign up → register → pay → check in → play → notify through the
    real `index.js`. Nothing under test is mocked; only the DB binding is swapped, and for a real
    SQL engine. Brevo, Square and Twilio are absent so they fail closed — the sandbox behaviour
    testers actually see.
- **What the harness found on its first run**, none of it visible to any existing test: the loop
  touches **37 tables, not the 14** a code reading suggested (registering for one tournament
  reaches waivers, documents, document requirements, guardianships, media consent, membership
  grants and the waitlist); signing in silently creates a `member` role row; registration refuses
  with 503 until the org publishes a waiver; and check-in admits a **roster slot**, not a person.
  Proven to fail: unmounting registrations, restoring the v0.36.0 org fallback, and dropping the
  staff role check each redden it.
- **M22 — membership custom-field registry** (requirements §2). `member_profiles` holds what the
  *product* defines; this is what an *org* invents. **Migration 0034 was applied to live D1 via
  Cloudflare MCP before this push** (ledger now 34; the F-41 `sqlite_master` check ran first and
  confirmed no such table existed, and that `form_fields` is per-**event** — so this generalises
  that proven pattern rather than inventing a second vocabulary).
  - **Hide ≠ delete** is the rule that shapes the module: `active = 0` removes a field from every
    form and profile while every answer stays on disk, so switching it back on restores the data.
    Re-creating a hidden field returns 409 and points at the existing one instead of losing it.
  - **Two visibility switches, not one**: `member_visible` (may the member see and edit it) and
    `show_on_forms` (public signup). "Coach notes" is neither — and the member routes filter
    `member_visible` **in SQL**, not in the response mapper, so a staff-only field is never loaded,
    let alone serialised. A test asserts exactly that.
  - Proven to fail: leaking staff-only fields, dropping the `active` filter, accepting an off-list
    dropdown value, and removing the staff gate each redden the suite.
- **Deliberately not shipped, stated rather than quietly dropped.** The M22 **admin screen**: every
  admin page carries the rail as static markup (v2.16), so adding one nav item edits ~30 pages —
  its own change, and precisely the cost the SPA shell exists to remove. **SPA shell**: a UI
  proposal was requested in the same breath, and building it before proposing would be backwards.
  **M12C public rental booking**: two owner gates — Square sandbox→production is the owner's call,
  and org 10 (External/Rental) has an open confirm (decisions §F, C-1/C-2); a public page that
  cannot take money is half a feature.
- Suite **683 → 709**, all passing.

## v0.56.0 — 2026-08-02

- **The admin ✉ badge, unparked since v0.48.0.** `admin-nav.js` v2.17 shipped the header envelope
  with the note "No badge yet: there is no admin unread-count endpoint (queued follow-up)". This is
  that endpoint: `GET /api/admin/messages/flags/count` — staff-only, org-scoped, binding
  `ctx.orgId`, and taking no status from the caller.
- **One predicate, two call sites.** `MESSAGE_FLAG_SCOPE` is interpolated by both the report queue
  and the new count (F-26). A badge reading 3 over a queue showing 2 is worse than no badge — the
  operator stops trusting the number, then stops looking. A test asserts the literal `WHERE` clause
  appears exactly once in the file, so a second hand-written copy cannot drift in later.
- **Caught mid-build: `mailBadgeFill` was defined and never called.** Every existing guard stayed
  green, because a defined-but-unreferenced function is indistinguishable from a working one at the
  source level unless you assert the *call site*. Failure class 1, and it nearly shipped.
  `header_actions.test.mjs` now gates the call site per §6.5/F-15, with a negative control that
  deletes the invocation and proves the gate reddens.
- **Cache-buster swept to 0.56.0 across 300 references in 49 files — this also fixes a real v0.55.0
  miss.** v0.55.0 changed `build-status.js` *without* sweeping, so any browser holding the old file
  cached would have kept serving the wrong tester copy: the fix would not have reached the people it
  was written for. `asset_versions.test.mjs` stayed green throughout, because it asserts the buster
  is ONE value, not the CURRENT value.
- **One-click mute was never unbuilt.** The roadmap listed it as a gap; `admin-messages.js` v1.1
  shipped it with M16 — every open row carries "Mute sender 7d" / "Unmute", one tap, audited. Three
  documents claimed otherwise (roadmap §2.3, the `admin-messages.html` header comment, and the
  build-status note) and all three are corrected. That is the third consecutive release where the
  documents were wrong about shipped code in the same direction, so `build_status.test.mjs` now
  ratchets this claim too: if the button exists, no copy may say it does not.
- Suite **670 → 683**, all passing.

## v0.55.0 — 2026-08-02

- **`build-status.js` v1.1 — the tester-facing registry was stale, and two entries were wrong.**
  This file exists to be believed by someone who cannot read the code, so a wrong row does not
  merely mislead: it manufactures bug reports about correct behaviour and discredits every other
  row. Two entries told testers the door **refuses** a member with no current waiver. That gate was
  removed in v0.33.1 on the owner's instruction (D-MIN-8, "no gating") and `checkin.js` v1.3
  replaced it with a non-blocking advisory. The roadmap audit had recorded **one** instance; there
  were **two** — the audit was narrower than its subject, the exact failure class it was auditing for.
- **16 of 45 pages had no registry entry**, so they rendered to testers as finished with no caveat
  — including `admin-sms`, which cannot send anything at all (Twilio frozen). All now registered.
- **Four features marked "soon" had already shipped**, each re-checked against source rather than
  against the roadmap: teammate self-sign links and the media-release opt-out record (v0.25,
  `consent.js`), Player Exchange substantially (v0.45, `lfg.js` — roster RSVP is what remains),
  and SMS (built, then frozen — now `wip`, not `soon`). The `.ics` row claimed no feed button
  existed anywhere, while `admin-calendar` has had one for three releases.
- **`build_status.test.mjs` v1.0 (+10 tests) so it cannot rot again.** A coverage ratchet fails the
  suite when a new `web/*.html` has no registry entry, scanning the widest set with a floor so an
  empty scan cannot pass. A copy-vs-code ratchet forbids any tester-facing text claiming a waiver
  gate while `checkin.js` has none. NC-6 exists because the first draft failed for the *opposite*
  of its purpose: `checkin.js`'s header documents the removal by naming the deleted symbols, so a
  raw scan found "the gate" inside the sentence announcing its deletion.
- **The CI syntax gate could not fail — fixed** (workflow edit, owner OK). `node --check <file>`
  exits 0 for any `.js` containing `export`/`import` even when unparseable, reproduced on Node
  22.23.2 (CI's pin) and 24.18.1. All 37 modules are ESM, so step 1 of the gate had been passing
  unconditionally since v0.2.x while printing "N modules OK" — failure class 3, inside the gate
  itself. It now pipes each file to `node --check --input-type=module` and **self-tests against a
  deliberately broken module first**: if the check ever stops being able to fail, the build stops
  rather than reporting clean. This release's CI log reads
  `syntax: 37 modules parse (stdin form; self-test proved the check can fail)`.
- **README §Roadmap is now a pointer** to `docs/2026-08-02_roadmap_v1_0.md`. Its old inline queue
  still listed the v0.51.0 and v0.52.0 work as upcoming.
- Suite **660 → 670**, all passing.

## v0.54.0 — 2026-08-02

- **First release delivered by direct commit** (owner decision 2026-08-02). The ZIP, both manifest
  ratchets, and the extract-and-drag step are retired. Delivery is now: preflight CLEAR → commit to
  `main` → push → CI gates, deploys, byte-verifies `/api/health`. v0.53.1, whose only content was
  moving `CHANGELOG.md` into the ZIP, is moot for the same reason.
- **`waitlists.js` v1.1 — real product defect in offer expiry.** `offerExpired` parsed the zone-less
  SQLite datetime form (`2026-07-25 12:00:00`) that `nextOfferExpiry` itself writes, so a UTC instant
  was read as LOCAL time. Cloudflare runs UTC, which made the offset zero and hid it in production;
  on a UTC-6 runtime a 48-hour claim link stayed live for 54. Now normalises before parsing — the
  same idiom already in `consent.parseTs`, `tiers.effectiveGrant`, `calendar.toIcsUtc`,
  `announcements` and `waivers`. Fail-closed behaviour on a corrupt `expires_at` is unchanged.
  Ships the write→read round-trip test that never existed, which is why the defect survived.
- **Five negative controls that could not fail on Windows (+1 new guard).** `core.autocrlf` checks
  source out CRLF, so NCs mutating on a literal `\n` silently no-opped: the mutation never landed,
  the guard had nothing to detect, and the NC reported clean while proving nothing — failure class 3
  inside the guards themselves. Fixed in `sms` NC-2, `page_shell` NC-6/NC-8/NC-9, `header_shell`
  NC-M1; each now matches `\r?\n` or cuts by index and asserts the mutation landed.
- **`worker/scripts/preflight.mjs` v1.0 — the local gate.** Runs the CI gate before the commit plus
  the origin-sync check CI cannot do (syntax · F-37 parity · measured suite · schema · deployed
  parity). Replaces the mechanical half of the checkpoint the owner's ZIP drag used to provide.
  `WARN` never launders into `PASS`. 15 tests, every verdict with a negative control.
- **[FLAGGED, NOT FIXED] The CI syntax gate cannot fail.** `node --check <file>` exits 0 on Node
  24.18.1 for any `.js` containing `export`/`import` even when unparseable; all 37 worker modules are
  ESM, so `deploy-worker.yml` step 1 prints "37 modules OK" and proves nothing. Preflight uses the
  working stdin form locally. The workflow is deliberately unchanged — `CLAUDE.md` §8 forbids
  workflow edits without an explicit owner OK. Tracked as `CLAUDE.md` §9.3.
- **Doc set completed and ZIP delivery struck everywhere.** Installs the 7 files lost to a 50,000-char
  paste truncation. Retires the ZIP rule in all four places that restated it — `CLAUDE.md` §2,
  standards §9 (→ v2.1), uiux-review §6 (→ v1.1), handoff §0 (→ v1.2, marked superseded with its
  reasoning preserved as history) — and closes INDEX contradiction C1. Handoff §8 next-session
  prompt rewritten off `/mnt/project/` onto the repo-relative direct-commit loop.
- Suite **645 → 660**, all passing.

## v0.53.1 — 2026-08-02

- **Patch release from an external code review of v0.53.0.** Five findings were raised; three
  adopted, one adopted in part, one rejected with a measurement. Every verdict was settled by
  running the code, not by reading it.
- **`site-nav.js` v2.14 — two source fixes.**
  (a) `headerMailFill` builds the unread badge with `createElement` + `textContent` instead of a
  template literal through `insertAdjacentHTML`, and is now **idempotent** (it reuses or removes
  an existing `.badge`). v2.13 appended unconditionally: the deleted v2.10 injector had carried
  an idempotency guard, and deleting the injector deleted the guard with it. The XSS framing in
  the review was **not** reachable — `/api/messages/unread-count` returns `SELECT COUNT(*)`, an
  integer that cannot carry markup — but the DOM form removes the latent hazard if that endpoint
  ever changes shape, so the fix ships on robustness grounds rather than security grounds.
  (b) **`#logoutBtn` is revealed synchronously from the local token**, not from inside the
  `/api/me` branch. In v2.13 a slow or 5xx `/api/me` left a signed-in member with a hidden Sign
  out button and no way to end the session. Revealing on a stale token is the correct failure
  direction: the click clears it and lands on login.
- **`header_shell.test.mjs` v2.1 — a BLIND guard closed.** The v2.0 `#btHdrAdmin` check was an
  alternation whose second branch omitted the href, so a header with
  `href="https://evil.example/"` **passed**. Proven by mutation before the fix. Replaced with
  per-attribute assertions on the extracted tag, which is additionally immune to attribute ORDER
  — the reviewer's proposed replacement regex still failed when `hidden` preceded `href`.
  NC-M7 now pins the hijack red and NC-M8 pins order-independence green.
- **New invariant guard: the nav module must run after the header parses.** Nothing asserted it,
  yet the entire single-source binding model depends on it — if `site-nav.js` ran first,
  `getElementById("btHdrMail")` returns null, `canonHdr` goes false, and the theme toggle
  silently stops binding on all 13 pages while every string scan stays green. Member pages
  satisfy this with `defer`, admin pages with end-of-body placement, so the guard accepts
  **either**. The first draft demanded `defer` specifically and went red on 27 correct admin
  pages: the guard was wrong, not the code. Kept as a worked example, with NC-M10 pinning the
  no-false-positive case.
- **`brand.test.mjs` v2.1 — review adopted in part, and measured before choosing.** `\s+` and
  the `i` flag adopted for the TITLE and LITERAL patterns (they catch a line-wrapped
  `Boomtown\n  Volleyball` and lowercase drift, both of which v2.0 missed). **Rejected for the
  WORDMARK pattern:** `\s+` requires whitespace, so `Boomtown<span>Volleyball</span>` would stop
  matching — a strict narrowing of a guard, the exact failure class this file's self-count
  exists to prevent. Both directions were run before the call. NC-4 now pins the no-space form.
- **`header_actions.test.mjs` v3.1 — guards for the two source fixes.** They exist because the
  first prove-it-fails run on this release came back **green**: the source had been fixed with no
  assertion behind it. Added, and both now go red against the shipped v0.53.0 tree.
- **Also in this release: the v0.53.0 `CHANGELOG.md` that never landed.** The v0.53.0 drag placed
  68 of 69 files (verified byte-identical against the intended tree); `CHANGELOG.md` was missed,
  so CI wrote a stub for v0.53.0 and the reconstructed v0.36–v0.52 history stayed absent. This
  release carries the full file.
- Suite **631 → 644**, 0 fail. Buster single value 0.53.1 across 300 refs. `index.js` bump
  byte-verified as a one-line diff. No migration — ledger stays 0033.

## v0.53.0 — 2026-08-02 (Unified static MEMBER header + brand rename applied)

- **D-ORG-5 APPLIED to live D1** (owner-approved this session): `orgs` id 1 renamed
  "Boomtown Volleyball" → **"Boomtown Athletics"** (guarded UPDATE, 1 row; ledger unchanged at
  0033, no migration). The brand then swept repo-wide: 27 admin wordmarks, 13 member wordmarks +
  page titles, root index/404, PWA manifest (v1.2: `name` + description), sw.js push fallback,
  member.js document.title, widget, site-nav rail chip, and the worker's user-visible strings
  (calendar calName/PRODID, marketing fallback page, profiles PRODID, webauthn RP *display*
  name — RP ID is the domain, untouched, passkeys unaffected).
- **ONE canonical static MEMBER header, byte-identical on the 13 site-nav pages** (the admin
  v0.52.0 inversion, completed): brand-logo img + Athletics wordmark · **static-but-hidden
  Admin link** (owner call: frame-one markup for everyone, one JS reveal for staff) · ✉ →
  member-inbox · ◐ theme toggle · hidden Sign out · `no-print`. The pre-existing headers were
  13 hand-rolled variants (5 had theme toggles, 9 had none; assorted ← Home/Inbox/Library
  links). index.html keeps a reduced login header (brand img + Athletics + theme; app.js
  stays that page's behavior owner — marker-gated, no double-bind).
- **site-nav.js v2.13:** the v2.10 mail and v2.11 Admin-switch INJECTORS are DELETED; the file
  becomes the single-source behavior owner — synchronous theme-toggle listener (works before
  /api/me resolves) + logout, signed-in reveal of Sign out, staff reveal of the Admin link,
  and a badge/aria FILL on the static ✉ (data fill only, the brandLogo-swap precedent).
  Per-page theme/logout copies in register.js, score.js, settings.js DELETED (a surviving
  copy double-binds → dead button, the v0.52.0 failure class). Bonus fix: profile.html's
  theme toggle was a DEAD BUTTON (markup with no binder anywhere) — it works now.
- **Member pre-paint theme snippet** on 13 + index.html — saved bt_theme, else system
  preference, before the first stylesheet, byte-identical (theme half of the admin snippet;
  member pages carry no rail-collapse state).
- **404.html repaired:** its stylesheets were bustered `?v=0.11.0` — 42 releases of stale
  cached CSS on the error page. Now on the release value.
- **Guards (616 → 631/631):** `header_shell.test.mjs` v2.0 (member 13-page byte-identity +
  completeness incl. NO org switcher + reduced-login variant + single-source verdicts +
  no-copy scan with app.js as the one documented exception + 6 NCs) · `header_actions.test.mjs`
  v3.0 (BOTH shells now forbid element injection; fill + reveal verdicts; static-✉/Admin
  placement over the widest page set with floor counts) · `page_shell.test.mjs` v1.3 (member
  snippet, before-CSS, byte-identical) · `brand.test.mjs` v2.0 (INVERTED post-rename: any
  "Boomtown Volleyball" literal in the product shell is the offence; legal-entity keeps still
  asserted). Proven-fails-live on pristine v0.52.0: **15 red**. The brand guard's own widest
  scan caught two real sweep misses during the build (the span-split wordmark on 28 pages;
  root 404/index) — failure class 3, working as designed.
- **Release mechanics:** 68-file ZIP (30 HTML admin+root · 14 member HTML · 8 assets JS ·
  manifest · sw/member/widget JS · 5 worker src · 4 tests · README) · index.js bump
  byte-verified one-line diff (F-34) · buster sweep single value **0.53.0, 300 refs**
  (284 + 13 member header imgs + 1 login img + 2 repaired 404 refs — delta accounted) ·
  both manifest ratchets PASS · CHANGELOG absent from ZIP ✓ · no migration.

## v0.52.0 — 2026-08-02 (Unified static admin header + org switcher everywhere — uiux-review §6 step 4)

> **Provenance note (2026-08-02, v1.0 of this reconstruction):** entries v0.36.0–v0.52.0 below were
> restored on 2026-08-02 from the session handoffs, README v0.52.0 module table, in-source version
> headers, and the v0.45.0 paste block — the CI deploy stubs they replace carried no content because
> the paste-block ritual was retired but the blocks were never pasted. Entries marked
> **[RECONSTRUCTED — summary only]** have no surviving session handoff; their one-line scope comes
> from the README table and migration-file dates and cannot be expanded further. Everything from
> v0.33.2 downward is the original record, byte-identical. Standing rule from this date: every
> release ships a complete ready-to-upload `CHANGELOG.md` alongside the ZIP (never inside it).

- **ONE canonical static admin header, byte-identical on all 27 admin-nav pages:** brand-logo img +
  wordmark · **org switcher on ALL 27** (16 pages gained it — the "8 former admin-shell pages" figure
  was stale; the widest scan found 16, failure class 3) · mail icon · theme toggle · Member site
  link · `no-print`. The v2.4/v2.15 logo and v2.17 mail INJECTORS are deleted — the header paints
  complete on frame one, zero post-paint mutation (the logo's per-org cache swap-on-change is the
  sole, deliberate exception).
- **Pre-paint snippet v2 ("Pre-paint state"):** collapse + **theme** — saved `bt_theme`, else system
  preference, applied before the first stylesheet. 16 admin pages previously never applied a saved
  theme at all; all 27 now paint the right theme on frame one.
- **admin-nav.js v2.19 single-source behaviors:** switcher population/persistence with
  `body[data-org-switch-href]` override (admin-event.html → admin-events.html; a reload there 404s
  under the new org) + the theme-toggle listener. **12 per-page switcher copies and 6 theme blocks
  DELETED** (a returned copy double-binds the toggle → toggles twice → dead button). Behavior note:
  checkin/league/plans/registrations/reports/tournament org switches now full-reload instead of
  targeted re-fetch — uniformity over the micro-nicety.
- **Glass to the demo-v4 treatment** (tokens.css v0.6.0): 62% surface + blur 14 + saturate 1.25,
  solid fallback kept. app.css v0.8.0: `.wordmark`/`.brand-logo`/`.hdr-mail` promoted from the
  injected `<style>` to real CSS (frame-one styling).
- **Guards (+12 tests, 616/616):** `header_shell.test.mjs` v1.0 NEW (identity + completeness +
  derived-set no-copy scan + behavior checks + 7 NCs) · `header_actions.test.mjs` v2.0 (admin side
  INVERTED: no injector may survive; static mail only on admin-nav pages; member shell stays
  injected) · `page_shell.test.mjs` v1.2 (snippet regex + pre-paint theme assertions).
  Proven-fails-live on pristine v0.51.0 (12 red). The guard's own discipline caught two draft bugs
  (first-match-only scan; over-wide sweep flagging member scripts).
- **Release mechanics:** 67-file ZIP (27 admin pages + 20 member pages buster-only + 13 JS + 2 CSS +
  index.js + 3 tests + README) · index.js bump byte-verified one-line diff (F-34) · buster sweep
  single value 0.52.0 (284 refs, delta accounted: −1 deleted FALLBACK literal, +27 header imgs) ·
  both manifest ratchets PASS · no migration (ledger stays 0033, orgs = 6).

## v0.51.0 — 2026-08-02 (Announcements authoring + shared buttons + pre-paint collapse)

- Admin **Announcements authoring page** — staff CRUD over `/api/admin/announcements` (cta vs news,
  schedule window, live preview in the member's exact markup); rail item on all 27 pages.
- **One shared button set** in app.css; per-page `.btn` redefinitions deleted on 6 pages
  (uiux-review §4 — the per-page copies were the collapse/styling drift root cause).
- **Pre-paint collapse state** via `bt_nav` cookie snippet on every admin page — no post-paint snap.
- Suite 588 → 604. No migration.

## v0.50.0 — 2026-08-02 (R3 member home · announcements · sub availability · org brand)

- **R3 member home:** announcement box (admin CTA pinned + non-mutable, per-item/per-category mutes,
  aggregated feed), results/messages/my-events cards, sub-play CTA row.
- **Sub availability** (passive/active + level → LFG) · **public org-brand endpoint** ·
  org-branded member rail.
- **Migration 0033** (announcements) — ledger 0032 → 0033, gate ratchet in the same package.
- Suite → 588.

## v0.49.1 — 2026-08-02 **[RECONSTRUCTED — summary only]** (Hotfix)

- config.js restored on 5 dead admin pages; headers on lfg/help; every js/css ref now bustered;
  page-shell + bare-ref guards added. (No CI stub was recorded for this hotfix; entry restored from
  the README v0.52.0 module table.)

## v0.49.0 — 2026-08-02 (Header Admin switch)

- Header **Admin switch** for staff-who-play — site-nav.js v2.11 injects a Control Center button on
  member pages for `admin`/`staff` roles, next to the mail icon.

## v0.48.0 — 2026-08-02 (Header mail icon)

- **Header mail icon on both shells** — site-nav.js v2.10 / admin injector v2.17, single-source
  injectors (superseded on the admin side by the v0.52.0 static header).

## v0.47.0 — 2026-08-02 **[RECONSTRUCTED — summary only]**

- **Static rail inlined on all 26 admin pages** — kills the build-after-paint pop (uiux-review §3A).
  Attribution corroborated by in-source "ships in v0.47.0" headers.

## v0.46.0 — 2026-08-02 **[RECONSTRUCTED — summary only]**

- **Org-brand groundwork + contrast/emphasis tokens** — `--emphasis`/`--gold-ink` introduced; raw
  `--accent` gold-as-text offenders swapped (uiux-review §1, AA pass). Corroborated by in-source
  "ships in v0.46.0" / "since v0.46.0" headers.

## v0.45.0 — 2026-08-01 (LFG & Community Play — rebuilt against v0.44.0)

**Lineage note:** the first v0.45.0 build (same day) was cut against v0.43.0 and its ZIP was never
uploaded; the retired v0.44.0 ZIP was. This release is the same LFG scope rebuilt as the linear
successor to actual HEAD v0.44.0. Migration 0031 was already applied to live D1 by the first build —
its file ships here, reconstructed byte-faithful from the live schema, idempotent.

- **Worker:** `lfg.js` v1.0 NEW — two-way community board (owner spec 2026-08-01): `team_need` (any
  member posts; the team shell forms immediately), `player_avail`, and free-form `casual` games (no
  facility link — park, another gym, anywhere). Member routes: list/post listings · join (returns
  the "on N team(s)" heads-up) · withdraw (inside `BAIL_WINDOW_HOURS = 12` of game time counts as a
  bail — one edit to 24) · close · report-no-show (poster only, only after game time, only for
  committed players). Escalation: first reported no-show → yellow ⚠ caution for 14 days → second →
  30-day LFG ban + red ⚠ wherever the person appears in groups → auto-unban by time, strikes
  consumed. Reliability is showed/bailed **counts, never a rating**. 18+ fail-closed on the shared
  `family.js isMinor` (unknown birthdate = blocked). In-app messaging only (messages.js relay).
  Flood guard `OPEN_LISTINGS_MAX = 5`. Staff: strikes/bans view + early unban. In-app notification
  to the member on strike and on ban.
- **Worker:** `index.js` — wire + dispatch + version v0.45.0 (4 hunks, byte-verified).
- **DB:** migration `0031` file lands (APPLIED 2026-08-01; ledger row exists; file is a no-op
  re-run). `schema_gate.test.mjs` v1.6 — ratchet 30 → 31 in the same package.
- **Web:** `lfg.html` + `assets/lfg.js` v1.0 NEW — board with kind tabs, inline post form,
  reliability strip, roster caution marks, bail-window confirm, relay compose. `home.html` v1.5.0 /
  `home.js` v1.4.0 — Community-play opportunities card, per-category toggles ON by default
  (`localStorage bt_lfg_prefs`). `site-nav.js` v2.8 — Explore link. Buster sweep: 43 pages →
  `?v=0.45.0`.
- **Tests:** 520 → **537/537** (17 new). The LFG org-scope guard is anchored per
  `env.DB.prepare(` call with a miss counter — the first draft read whole-file strings and an
  apostrophe in a comment blinded it to 22 of 33 queries (failure class 3, caught by its own count
  assertion). Negative controls prove the scan fails both ways; prove-it-fails ran on the org-scope
  guard and the §6.5 mount guard, red on mutation, green on byte-identical restore.

## v0.44.0 — 2026-08-01 **[RECONSTRUCTED — summary only]**

- Part of the delivery-gate hardening / org-logos arc (README: v0.33–v0.44). Migration
  `0032_org-reconciliation` (2026-08-01) dates to this release window. Session handoff superseded
  before the entry was filled; detail not further recoverable.

## v0.43.0 — 2026-07-31 **[RECONSTRUCTED — summary only]**

- Delivery-gate hardening arc; a "v0.43 owner check" remains a carried blocker in the handoff.
  Detail not further recoverable.

## v0.42.0 — 2026-07-31 **[RECONSTRUCTED — summary only]**

- Delivery-gate hardening / SMS-era arc (migrations `0029_sms` 2026-07-31, `0030_sms_campaigns`
  2026-08-01 fall in the v0.38–v0.44 window; SMS later FROZEN by owner). Detail not further
  recoverable.

## v0.41.0 — 2026-07-31 **[RECONSTRUCTED — summary only]**

- Same arc as v0.42.0. Detail not further recoverable.

## v0.40.0 — 2026-07-31 **[RECONSTRUCTED — summary only]**

- Same arc as v0.42.0. Detail not further recoverable.

## v0.39.0 — 2026-07-31 **[RECONSTRUCTED — summary only]**

- **Kiosk scan** ships in this release window (the "v0.39 kiosk scan" owner check is a carried
  handoff blocker). Migration `0027_kiosk` (2026-07-30) precedes it. Detail not further recoverable.

## v0.38.0 — 2026-07-31 **[RECONSTRUCTED — summary only]**

- Delivery-gate hardening arc. Detail not further recoverable.

## v0.37.0 — 2026-07-30 **[RECONSTRUCTED — summary only]**

- Arc window for migrations `0026_subs`, `0027_kiosk`, `0028_faq` (all 2026-07-30) — subs, kiosk,
  FAQ modules land in v0.36–v0.37. Detail not further recoverable.

## v0.36.0 — 2026-07-30 (CHANGELOG auto-entry + tokens guard era)

- **`worker/scripts/changelog-entry.mjs` v1.0 + `changelog_entry.test.mjs` v1.0 ship** [FACT —
  in-source headers]: CI auto-prepends a deploy stub (idempotent, prepend-only, title-anchored,
  tail-SHA-verified) so a release can never be missing from history. The paste-block ritual was
  retired here — which is why v0.36–v0.51 sat as stubs until this 2026-08-02 reconstruction.
- Remainder of the release: delivery-gate hardening arc. Detail not further recoverable.
- **Lineage note:** no deploy record exists for v0.34.0 or v0.35.0 (no CI stub, no README row, no
  in-source attribution). Consistent with the version-number skip precedent at v0.15 — these
  numbers are treated as skipped, not lost.

## v0.33.2 — 2026-07-29
- **F-35 — focus ring covered 3 element types out of every focusable.** `web/assets/tokens.css` v0.4.0 introduces a `--focus-ring` token (light `#1B2A4A` = `--primary`; dark `#F2F0EA` = `--text`, deliberately not gold — `--primary` and `--accent` both resolve to `#D4AF37` in dark) and replaces the `input, select, textarea:focus-visible` rule with a bare `:focus-visible` at 2px/2px. Measured at abdc64f: 38 of 39 HTML files contain a focusable, 26 had no ring rule at all and fell through to the UA default. Ring contrast computed, not assumed: 14.22:1 / 13.26:1 light, 17.26:1 / 16.13:1 / 15.07:1 dark — all clear WCAG 2.1 SC 1.4.11 (≥3:1) by 4×. The token values are written as literals, not `var(--primary)`/`var(--text)`, so a future edit to either cannot silently reintroduce a gold ring. This also corrects the recorded F-24 framing: the v0.2.1 ring was already 2px; the `1px` was `outline-offset`, not width.
- **F-35 not fully closed here, deliberately.** 20 page-level `:focus-visible` rules across 13 files still name `--primary`/`--accent` and win on specificity, so they stay gold in dark mode until the v0.33.3 sweep. This release stays at two files so its diff verifies by blob SHA at a glance — this pipeline has lost files on three separate multi-file uploads (40ed3b6, be87230, 73f6b37).
- **F-36 — `--font-size-body: 16px` and `body { font-size: 17px }` coexisted in the same file.** Token is now 17px (the deliberate v0.2.1 value) and `body` reads `var(--font-size-body)` instead of restating a literal, so the two can no longer diverge.
- **NEW guard: `worker/test/tokens.test.mjs` v1.0 (13 tests, 13 pass).** Parses `tokens.css`, computes ring contrast, asserts the dark ring is not gold, asserts a bare `:focus-visible` exists and is tokenised, and ratchets page-level drift at ≤20. Comments are stripped before every parse (guard-discipline instance 3: `admin-facility.html:6` contains the prose "focus-visible everywhere"), and six negative controls prove each check can fail — verified by mutating the real file.
- **F-34 — the vacuous parity check, closed.** `worker/src/index.js` line 324 version string bumped `v0.32.0` → `v0.33.2` (verified single-line edit; file otherwise byte-identical to abdc64f). The post-deploy `/api/health` parity check compared `v0.32.0` to `v0.32.0` and passed without measuring anything, which is why the #33/#34 mis-deploy went unnoticed. `/api/health` now becomes a real deploy verifier: it should return `v0.33.2` after this ships.
- **Housekeeping:** the v0.33.1 entry that had been pasted above the file title is now a proper `## v0.33.1` section under the title. No release content changed.

## v0.33.1 — 2026-07-29
- Waiver hard gate REMOVED (D-MIN-8 overrides D-WV-7). Owner decision 2026-07-29: "no gating." checkin.js v1.3 deletes waiverGateDecision(), OVERRIDE_MIN_CHARS, the staff override reason, and all three 409 { waiver_required: true } responses (staff check-in, walk-in, public self check-in). D-WV-7 stood in code for three releases while roadmap v12 §3 recorded D-MIN-8 as "in force"; the record and the code now agree. Replaced with recording, not refusal: a new pure waiverAdvisory() returns a non-blocking {compliant, level:'ok'|'warn', label, detail, blocks:false} payload carried on every roster row and every check-in response, waiver_ok is written to every attendance audit row, and roster() returns a waivers_missing count for the desk. Historic attendance.checkin.waiver_override audit rows are left untouched — we stopped writing them, we did not rewrite the past.
- F-26 — two waiver predicates in one file that disagreed. checkin.js computed "has a live waiver" twice: roster() matched c.email = tm.member_email (case-SENSITIVE — SQLite = on TEXT is case-sensitive without COLLATE NOCASE) while hasValidWaiver() matched lower(c.email) = lower(?). A contact stored Jane@X.com against a roster row jane@x.com therefore showed waiver_ok: 0 on the door roster and simultaneously passed the gate. It landed exactly on captain-entered teammate emails, which are never normalised on entry because teammates never register. Both sites now build their match from one exported WAIVER_IDENTITY_MATCH() helper, and three further raw email compares (walkin contact lookup, selfCheckin roster match, myAttendance) were normalised for the same reason.
- F-28 — the D-WV-7 override UI never existed. A repo-wide search finds no reference to waiver_required anywhere in web/. For three releases, staff tapping check-in on an un-waivered player received a 409 with no client handler — an unexplained failure, not the override prompt the decision described. Removing the gate removes a broken door path as well as a contradicted one.
- CI: deploy-worker.yml v0.3.0 finally lands. v0.2.2 ran 1 of 21 test files and deployed unconditionally; it stayed green for 31 runs while covering 5% of the suite and on 2026-07-27 shipped v0.32.0 against a schema missing migration 0025. v0.3.0 adds a gate job that must pass before deploy runs: node --check on every worker module, the full suite via node --test test/*.mjs, a live-D1 read, and schema-gate.mjs blocking any deploy where the repo carries an unapplied migration. Post-deploy it asserts /api/health matches the version string in worker/src/index.js, with a cache buster. Requires CLOUDFLARE_API_TOKEN to carry D1:Read plus a CLOUDFLARE_ACCOUNT_ID secret; without both the gate fails closed, which is intended. Two prior ZIP uploads failed to place this file because .github/ is hidden from the browser file picker — it now ships at the ZIP root for a direct upload into .github/workflows/.
- Gates: node --check OK on checkin.js · checkin.test.mjs 19/19 verified locally (file goes 15 → 19; the 9 removed gate tests are replaced by 7 advisory-contract tests, 5 F-26 guards including one that reads the source and one negative control proving that guard can fail, and 1 asserting the retired exports are absent rather than dormant). Projected suite 356 → 360 — arithmetic, not measured; the v0.3.0 gate now verifies this in CI on every push, which is the point.
- Not shipped, deliberately: worker/src/index.js version string still reads v0.32.0. Bumping it means editing a 35 KB file that has not been read this session, and shipping unread large files is what destroyed CHANGELOG.md on 2026-07-27. The parity check passes either way; the bump belongs with the next release that reads that file. CHANGELOG.md itself is likewise not in the ZIP.
- Open: F-27 — waivers.js waiverReminderSweep is a third implementation of the same waiver predicate. checkin.js v1.2's header claimed it "mirrors" it; that claim was never checked and is still unchecked. Verify before it becomes F-26 again.


## v0.1 — 2026-07-21 (Module 1: Foundation)
- Created D1 database `boomtown-prod` (WNAM) via Cloudflare MCP.
- Applied migration 0001: 23 tables, org_id + soft-delete everywhere, audit_log; seeded 3 orgs. Verified live.
- Worker API v0.1: magic-link auth (15-min single-use, hashed tokens), 30-day sessions (cookie + Bearer), first-user-becomes-admin bootstrap, roles, /api/orgs, audit logging, Brevo adapter with sandbox fallback.
- Frontend shell v0.1: spec §4 tokens (dark black/gold default, light white/navy), theme toggle, org switcher (2 clicks), login + dashboard, emil-design-eng motion rules, WCAG focus states, 44px targets, reduced-motion support.
- CI: GitHub Actions worker auto-deploy (needs CLOUDFLARE_API_TOKEN secret).
- Known gaps → v0.2: admin TOTP enforcement; real email (Brevo key); org-switch server-side role gating on future endpoints.

## v0.2 — 2026-07-21 (Module 3: Tournament Engine)
- Scheduler engine (worker/src/scheduler.js): format templates (7-on-3, 10-on-4, 11-on-5, 8/9-on-4, 4-on-2x2), feasibility pre-check with one-tap fixes, circle-method partial round-robin, court packing at optimal round counts, byes balanced ±1, ref rotation from byes, standings (wins → diff → head-to-head), A/BB brackets with best-of-3 21-21-15 semis/finals.
- Test suite (worker/test/scheduler.test.mjs): all formats assert no-rematch, no double-booking, bye spread ≤1, optimal rounds, tiebreaks, seeding. ALL PASSING.
- API (worker/src/tournaments.js): events CRUD, bulk team add, schedule generate (score-wipe protection), drag-edit PATCH with live warnings, 2-tap score endpoint, standings materialization, bracket break. Role-gated per org; audit-logged.
- UI (web/tournament.html/.css/.js): create-from-template ≤10 clicks, paste-in teams, feasibility banner with fix buttons, Court×Round grid with bye/work column, HTML5 drag-and-drop with amber warnings, bottom-sheet 2-tap scoring, standings table, bracket button, print pool sheet, CSV export.
- Feature addendum doc: commercial-parity backlog vs volleyballlife/gymdesk/mindbody.

## v0.3.0 — 2026-07-21 (Module 4: Registration + Square sandbox + captain self-scoring)
- Migration 0002 (applied live via MCP, additive only): events.price_cents, teams.score_token, registrations.checkout_url, registrations.last_reminded_at.
- API (worker/src/registrations.js): public event form endpoint (base §3.2 field set + admin custom fields), registration submit (contact find-or-create, annual e-signed waiver, team + teammates, idempotent double-submit guard, hidden cash option enforced server-side, free events auto-comped), Square Payment Links (quick_pay, sandbox base URL by default, graceful sandbox mode when keys absent), HMAC-verified Square webhook flips pending → paid idempotently, staff unpaid list + 1-click reminder (Brevo or copyable sandbox link) + cash mark-collected, Google Forms CSV import (≤500 rows, per-row skip report), captain score links + token-gated 2-tap scoring endpoint that reuses refreshStandings.
- worker/src/index.js v0.3.0: mounts registration routes + /api/webhooks/square (pre-auth, signature-verified); health reports v0.3.0. tournaments.js v0.3.0: exports refreshStandings (only change).
- UI: web/register.html+register.js (public form, Square redirect, a11y labels), web/admin-registrations.html+js (status chips, filters, remind ≤3 clicks, CSV import with header auto-mapping, captain score-link copier, registration-link copier), web/score.html+score.js (captain 2-tap scoring, 52px thumb targets).
- Debt cleared: tournament.js network-failure + stale-config guards (matching app.js v0.2.4); tournament.html cache-busted to ?v=0.3.0 and links to Registrations admin.
- Verified: node --check on all 7 JS files, full scheduler test suite passing, worker imports cleanly.
- NOT included (later): waiver text is a PLACEHOLDER (admin must supply official text), admin TOTP, Card-on-File, SMS notify, Brevo key.

## v0.3.1 — 2026-07-22 (Root redirect)
- Added root index.html: `https://10xequity.github.io/btplatform/` now redirects to `/web/` instead of showing GitHub's 404 page.
- No app-code changes. Module 4 (v0.3.0) verified fully deployed: all 14 files at correct paths in commit 3c00990; GitHub Pages build+deployment and Deploy Worker actions both green.

## v0.4.0 — 2026-07-22 · Module 5 (Schedule) + System Admin Panel

**Database (migration 0003 — ALREADY APPLIED to live D1 by Claude, no action needed):**
- `schedule_views` (public/internal built-ins + custom views), `event_templates`, `programs`
- `events` gains `series_id`, `program_id`, `recurrence_json` (recurring series support)

**Worker (auto-deploys on push):**
- `schedule.js` — public schedule feed `GET /api/schedule` with server-enforced view profiles (spec §3.7); views CRUD
- `admin.js` — user/role management (admin-only, last-admin safety guard), member (contact) management, permissions matrix
- `events_admin.js` — templates, duplicate, recurring series (weekly/biweekly/monthly, ≤52), "this-and-future" series edit/cancel, bulk create (CSV, ≤200 rows), bulk edit, per-event registrations CSV export, programs
- `index.js` → v0.4.0, mounts the three new modules

**Web app:**
- Admin panel with shared sidebar (`admin-nav.js` + `admin.css`): hover highlights, active section, mobile top-bar collapse
- `admin.html` dashboard · `admin-events.html` calendar with drag-and-drop create/reschedule, template palette, recurring, bulk import/edit, Views & Embed tab · `admin-event.html` per-event screen (details, publish/cancel, duplicate, save-as-template, series editing, sign-up link, registrations with remind/mark-paid, CSV download) · `admin-users.html` members + admins & roles + role capability matrix
- `schedule.html` public schedule (list + month) · `widget.js` embeddable widget for boomtownvb.com / coloradoboom.com
- `tournament.html` / `admin-registrations.html` retrofitted with the sidebar

**Known limits (deliberate, small):** event times are stored as entered (no timezone math) — fine while everything is in Colorado; recurring monthly = same day-of-month; bulk import caps at 200 rows per upload.

## v0.5.0 — 2026-07-22 · Module 6: Member Profiles + Family Accounts + Passkeys

**Database (migration 0004 v1.1 — ALREADY APPLIED live by Claude, never run it):**
- `member_profiles` (avatar key, Instagram, bio, DOB, visibility, reminder opt-in w/ consent timestamp)
- `guardianships` (parent↔child, active/ended, aged_out tracking) · `signatures` (shared on-behalf ledger — waivers now, Module 7 contracts later)
- `season_points` (seeding materialized from standings — standings stay the only score source)
- `webauthn_credentials` + `webauthn_challenges` (passkeys)

**Worker (auto-deploys on push; health → v0.5.0):**
- `profiles.js` (NEW): profile CRUD (self or own child only), R2 avatar upload (mime+size validated, keys-not-blobs), results résumé + totals from standings history, upcoming events, public visibility-gated profile, ICS export (America/Denver VTIMEZONE), reminder opt-in, family (add child → private-by-default minor profile; guardian waiver signing writes waivers + signatures with `signed by X for Y, age Z`; remove child; 18th-birthday handover: sets their email, ends guardianship, magic-links them in — history follows contact_id), seeding recompute + ranked list (staff; formula win=10, podium +50/+30/+20 in one tunable function)
- `webauthn.js` (NEW): Face ID / fingerprint sign-in — ES256 + RS256, attestation "none", single-use 5-min challenges, rpId = 10xequity.github.io, signature-counter clone protection. **Supersedes the TOTP plan.**
- `index.js` v0.5.0: mounts both modules; extracts shared `sendLoginLink` / `issueSession`; `/api/me` reports passkey count
- `wrangler.toml` v0.5.0: R2 binding `AVATARS` → bucket `boomtown-avatars` (**create bucket before deploying**)

**Web app:**
- `profile.html`/`profile.js` (NEW): member hub — avatar with crop (Cropper.js 1.6.2, CDN), edit profile, share link, upcoming events + Add-to-calendar + reminder toggle, results résumé, family panel (add child, scroll-gated guardian signing, per-child photo, hand-over-account at 18), passkey enrollment card. Design-system v1.0 tokens/motion; ux-copy v1.0 wording; 44/52px targets; reduced-motion safe.
- `member.html`/`member.js` (NEW): public shareable profile (first name + last initial, optional IG/bio/results)
- `index.html` v0.5.0 + `assets/passkey.js` (NEW): "Sign in with Face ID / fingerprint" button on the login card (progressive enhancement; email link untouched)

**Verified:** node --check on all 6 JS files; passkey byte-parsing tests 7/7; D1 pre/post-checked; repo scanned at v0.4.0 before build; Cropper.js CDN URLs verified live.

**NOT included (v0.5.1):** the reminder email cron (toggle + consent are live; the scheduled sender is not), seeding admin UI (API is live), dashboard Profile link. Waiver text remains PLACEHOLDER in register flow + profile.js.

## v0.6.0 — 2026-07-23 (Navigation, Member/Manager Login, Leagues area, Settings)
**Frontend-only (no worker changes, no migrations).** UX references: gymdesk (persistent rail, first-class settings), volleyballlife (leagues as their own section, one-tap home). Analysis: docs/2026-07-23_usecase-analysis-nav_v1.0.md.
- `assets/site-nav.js` (NEW v1.0): role-aware site-wide sidebar on every member/public page, mirrors the Tournament Ops rail; horizontal scroll bar on phones; auto-skips `?embed=1`; self-contained styles (tokens only).
- `assets/app.js` v0.6.0: sign-in card gains **Member | Manager** tabs (manager copy points to passkeys; choice remembered); dashboard rebuilt — every card clickable: Schedule, Tournaments, **Leagues**, My Profile, **Member Management** (staff), Registrations (staff), **Settings**, **Foundation → Settings#System** (staff). Central-card layout retained by request.
- `leagues.html` + `assets/leagues.js` (NEW v1.0): dedicated league area — In progress / Upcoming / Recent league events from `/api/schedule`, org filter, Register CTAs. Season standings + sub-finder land here in Phase 2.
- `settings.html` + `assets/settings.js` (NEW v1.0): Account (name/photo → profile editor; email = sign-in identity, change via staff), Sign-in & security (passkey list/add/remove — passkeys are password **and** 2FA in one gesture; email-link fallback), Appearance (theme), Reminders (24h email toggle), System (staff: members/roles, events, Foundation status).
- `assets/app.css` v0.6.0: **font-consistency fix** — global `input, select, textarea, button { font: inherit }` (source of the mismatched fonts in filters/date fields); login-tab + settings styles.
- `schedule.html` v0.6.0 / `profile.html` v1.1 / `member.html` v1.1 / `index.html` v0.6.0: explicit "← Home" button in every header + sidebar include; schedule content is now a proper `<main>`.
- `assets/admin-nav.js` v0.6.0: admin rail gains Home, Leagues Page, Settings.
- `db/2026-07-23_seed-testdata_v1.0.sql` (NEW): TEST-marked sample data (IDs 90000+, @example.com) — completed tournament w/ 4 teams, 6 scored games + standings, upcoming tournament w/ all 4 payment states, published league. CLEANUP block included. NOT applied yet.
- Deferred to v0.7 (worker): reminder-email cron, seeding admin UI, verified change-email flow, dashboard driven by live module status.

## v0.7.0 — 2026-07-23 (Module 8: Leagues, Sales, Notifications, Nav v2)
- Migration 0005 (db/2026-07-23_0005_leagues-notifications_v1.0.sql — additive only): events.staff_contact_id, teams.level_num, team_members.invited_at/reminded_at, notifications.contact_id/title/body/link/read_at, 2 indexes. **NOT yet applied to live D1 (Cloudflare MCP auth unavailable this session — apply per install doc §1).**
- League Manager (worker/src/leagues_admin.js + web/admin-league.html/.js): teams w/ 1–5 levels, weekly schedule generator — HARD rule: teams 2+ levels apart never play (outranks rematch avoidance); SOFT: rematches avoided until unavoidable; bye rotation; stranded-team feasibility check; score-wipe protection (409 + confirm). Week×Court grid with drag-and-drop moves, 2-tap scoring, live standings. Reuses tournament matches/standings/score endpoints.
- Sales & Reports (worker/src/reports.js + web/admin-reports.html/.js): per-program sortable summary, per-event table, revenue-by-month + revenue-by-event SVG bar charts, stat cards. Card revenue = Square COMPLETED payments; cash counted at event price.
- Member notifications: person-addressed inbox (GET /api/notifications, mark read / read-all), bell with unread badge top-right on every member page (site-nav v2.0).
- Registrations v0.4.0: teammate connect (existing members linked by email → in-app notification + dashboard history) / invite (non-members get a Brevo waiver invite); "Rerun payment" button + POST /api/registrations/:id/retry-payment (fresh Square idempotency key for card denials); register.js shows connected/invited summary.
- Cron (index.js scheduled() + wrangler.toml [triggers], daily 15:00 UTC ≈ 9am Denver): waiver-reminder sweep (unsigned roster members, max 1 email/48h) + 24h event reminders for opted-in members.
- Event staff assignment: "Assigned staff" select on the event screen (staff/admin users matched to their Members record); patchEvent accepts staff_contact_id.
- Nav v2.0 (site-nav.js) + admin nav v0.7.0: fixed left rail, identical spacing on every page, Boom logo (web/assets/logo.jpg), simple SVG stroke icons, collapse-to-icons toggle (persisted, shared member/admin), "← Back" via browser history on every page, regrouped menus (Run events / Money / People / Member site; Explore / My Boomtown / Manage), legacy "← Home" links hidden.
- Design fixes (tokens.css v0.2): global themed form controls — fixes white-on-white staff-add fields (root cause: v0.6.0 `color:inherit` on a white browser background) and white dropdown menus; brand-colored visited links (no purple); base text 17px.
- Member dashboard (web/home.html/.js): avatar/initials hero + waiver status, upcoming events, results with totals + ordinal finishes, notifications list, Phase-3 forum placeholder.

## v0.8.0 — 2026-07-23 (Module 9: Control Center + streamline pass)
- Dashboard API (worker/src/reports.js v1.1): GET /api/admin/dashboard — one call: month money (card COMPLETED + cash-paid), outstanding total + actionable unpaid list (12), 7-day registration trend, today/upcoming events w/ staff + reg counts, member count, admin alerts feed.
- Control Center (web/admin.html v0.8.0 + web/assets/admin-dash.js v1.0 NEW): manager home rebuilt on the industry-standard gym-dashboard pattern (Gymdesk pattern study — original code/copy/tokens): greeting + date, quick-action row, KPI row (Received this month / Outstanding / Members / Live events), Today & Next Up schedule with LIVE flag + staff + Open buttons, Money Outstanding list with inline Remind + Rerun payment, 7-day activity bar chart, Needs Attention feed. Old web/assets/admin.js no longer loaded by admin.html (file retained).
- Streamline pass (web/assets/admin.css v0.5.0): calmer density — 18px card padding, capped 1280px content width, single heading scale, lighter tables.
- Worker index.js v0.8.0 (health), wrangler.toml v0.8.0. No new migration — v0.8.0 runs on migration 0005 (still pending apply, see handoff).

## v0.9.0 — 2026-07-23 (Module 10: Check-in & Attendance)
- Migration 0006 (db/2026-07-23_0006_attendance_v1.0.sql — additive): attendance table (event/contact/team_member links, name_snapshot, method staff|self, soft-delete = undo) + events.checkin_token. Apply AFTER 0005.
- Worker (checkin.js NEW v1.0, index.js v0.9.0): GET /api/events/:id/roster (every roster member w/ waiver flag + check-in state + walk-ins + progress) · POST /api/events/:id/checkin (tap toggle) · checkin-walkin · checkin-token (mint/rotate) · public GET/POST /api/checkin/:token (email → roster match = linked check-in; no match = unverified w/ see-the-desk note; duplicate-safe) · GET /api/profile/attendance (member history).
- Door page (web/admin-checkin.html + assets/admin-checkin.js NEW v1.0): event picker (auto-selects today's event when unambiguous), big-tap roster grouped by team, NO WAIVER flags, tap = in / tap again = undo, live x/y progress, name search, walk-in modal, self-check-in QR panel (qrcodejs CDN) with copy link + rotate (kills old code).
- Self check-in (web/checkin.html NEW v1.0): single-file public kiosk page — QR target, email entry, big ✅/🙋 confirmation, offline-friendly error copy.
- Nav (admin-nav.js v0.8.0): Check-in item + door icon in Run events group.

## v0.9.1 — 2026-07-24 (Recovery: the v0.7.0 ZIP was never uploaded)
- **Why:** repo history shows v0.6.0 → v0.8.0 → v0.9.0; the v0.7.0 paste was skipped. index.js v0.9.0 imports `leagues_admin.js` and three `registrations.js` exports that therefore didn't exist — **every worker deploy since the v0.8.0 push failed** (Actions runs #5/#6), leaving the live API at v0.5.0 while the v0.8/v0.9 frontends shipped. This release rebuilds the lost files against the SAME live schema (migration 0005, applied 2026-07-23) and the v0.7.0 CHANGELOG spec.
- Worker (fixes the deploy): `leagues_admin.js` v1.1 NEW — League Manager: HARD rule teams >2 levels apart never play (stranded teams sit + get flagged), SOFT rematch avoidance, bye rotation by games played, week generate/remove (scored-week protection), standings via existing engine, staff-of-the-night assignment. `registrations.js` v1.2 — exports sendEmail/escapeHtml/waiverReminderSweep (cron: chases roster members on events in the next 14 days with no valid waiver, max 1 email/48h), POST /api/registrations/:id/retry-payment (fresh Square idempotency key — Control Center "Rerun"), teammate connect (/api/profile/connect-teams links roster rows by email) + invite (/api/team-members/:id/invite, captain or staff) + GET /api/profile/teams. `index.js` v0.9.1 (health string only).
- Web: `admin-league.html`+`assets/admin-league.js` v1.1 NEW (levels board 1–5, generate week, 2-tap scoring, standings, staff select — shared admin rail, menu now identical on every admin page; the League Manager nav link no longer 404s). `admin-reports.html`+`assets/admin-reports.js` v1.1 NEW (totals, month bars, program/event tables, CSV — Sales & Reports link no longer 404s). `home.html`+`home.js` v1.1 NEW (member dashboard: notifications inbox w/ mark-read, upcoming events + calendar links, teams w/ connect status + captain invites; auto-links rosters on load). `site-nav.js` v2.0 (My Dashboard + Notifications item w/ live unread badge). `tokens.css` v0.2.1 (recovered contrast fixes: themed form controls/dropdowns, brand visited links, 17px base).
- DB: no new migration. `db/2026-07-24_0005_leagues-notifications_v1.0.sql` added as a RECORD of the already-applied migration 0005 — do not run.
- Still lost with v0.7.0, not rebuilt (nothing references them): web/assets/logo.jpg (binary — re-upload manually if wanted), register.js connected/invited summary, event-screen staff select (staff is assigned from League Manager instead).

## v0.10.0 — 2026-07-24 (Module 11: Memberships & recurring billing)
- **DB:** migration 0007 applied live via Cloudflare MCP (additive only): `plans` + `subscriptions` tables + 3 indexes. Record file: db/2026-07-24_0007_memberships_v1.0.sql — do not run.
- **Worker:** `memberships.js` v1.0 NEW — admin plans CRUD (creating/saving a plan also creates the Square Catalog SUBSCRIPTION_PLAN + SUBSCRIPTION_PLAN_VARIATION; price changes mint a NEW variation so existing subscribers keep their price), member subscribe via Square payment link (`checkout_options.subscription_plan_id` = variation id — Square stores the card on file and renews on cadence, verified against Square docs 2026-07-24), cancel-at-period-end (owner decision D-M11-1 default), GET /api/admin/mrr. Webhook: `/api/webhooks/square` now enters via `membershipWebhook` — verifies the HMAC, handles `subscription.*` (upsert w/ customer-email matching to the member's pending checkout row) and `invoice.*` (payment_made → active, scheduled_charge_failed → past_due; Square auto-retries the card itself), and forwards `payment.*` to the untouched registrations handler. `index.js` v0.10.0 (import + route + health string). Sandbox-safe: without SQUARE_ACCESS_TOKEN, plans save locally and subscribe returns a friendly "billing not configured" message.
- **Web:** `membership.html` + `assets/membership.js` v1.0 NEW (member page: status banner incl. payment-issue + canceled-until states, plan cards w/ perks bullets, subscribe → Square checkout, cancel w/ confirm). `admin-plans.html` + `assets/admin-plans.js` v1.0 NEW (MRR/active/payment-issue cards, plan create/edit/hide, subscriber table — shared admin rail). `home.html`+`home.js` v1.2 (Membership card on My Dashboard). `site-nav.js` v2.1 (Membership item under "You"). `admin-nav.js` (Memberships under Money). `admin-dash.js` v1.2 (Control Center MRR KPI from /api/admin/mrr; skips silently on older workers). `admin.html` v0.8.1 (cache-bust only).
- **Deferred to Square-keys day (Phase-3 carryover list):** production SQUARE_ACCESS_TOKEN/SQUARE_LOCATION_ID/webhook key, subscribing to `subscription.*` + `invoice.*` event types in the Square Developer webhook settings, card_brand/last4 backfill (arrives on webhooks once live), member self-service card update link.

## v0.11.0 — 2026-07-24 (Module 11.5: UX & Navigation hardening + Sandbox tools)
- **Worker:** `sandbox.js` v1.0 NEW — staff-gated GET /api/admin/testdata (counts + seeded flag), POST /generate (inserts the standard TEST set: 8 contacts, 3 events, 4 teams, 6 scored games, 6 registrations — all IDs 90000–90999, names prefixed TEST, emails @example.com; refuses if already seeded), POST /wipe (deletes ONLY the 90000+ range plus attendance/checkins/pools/brackets referencing test events; reports rows removed). `index.js` v0.11.0 (wire + health string). No schema changes.
- **Admin rail (`admin-nav.js` v0.11.0):** collapse handle moved to the rail's SIDE edge (fixed-position pill at mid-height; was a bottom button — owner item 6) · every category collapses individually (chevron on the label, keyboard-accessible, state remembered per group in localStorage) · menu reordered for daily flow: Dashboard → Events & Programs → Registrations → Check-in → Tournament Ops → League Manager, then Money / People / Member site · new SANDBOX group: "View as member" + "Test data…" modal (generate/wipe with live counts, confirm before wipe) · `BT_ADMIN.fail(el,msg)` — standard error box with ← Back + Go to Dashboard + Reload, adopted by all future modules so no page dead-ends (owner item 6 standing rule).
- **Member nav (`site-nav.js` v2.2):** View-as-member demo mode — Sandbox button sets a session flag; member pages hide the Manage group and show a fixed "Viewing as member — Exit" pill (returns to Control Center); admin pages auto-bounce to home.html while the flag is on. Presentation only — the server role never changes, so no privilege boundary moves (owner item 4 safety note).
- **`404.html` NEW (repo root):** GitHub Pages now serves a branded not-found page with ← Back / Home / My Dashboard — navigation always returns (owner item 6).
- **Cache note:** existing pages reference site-nav/admin-nav with old ?v= strings; GitHub Pages serves the new file at those URLs within ~10 minutes (no mass repaste needed). New pages going forward use ?v=0.11.0.

## v0.12.0 — 2026-07-24 (Module 12 Phase A: Court & Facility Management)
- **DB:** migration 0008 applied live via Cloudflare MCP (additive only): `spaces` (13 courts VB 1–13 + 6 rooms), `space_presets` + `preset_spaces` (All Courts / Full Hardwood / Sports Court / 4 basketball overlays / Whole Facility), `space_bookings` (operator, date, minutes, Court Share flag, closure flag, staffing/catering/door-charge/POC/attendees/series/notes), `booking_spaces` (atom claims), 2 indexes. Also seeded 7 operator orgs (ids 4–10: Colorado Boom, Oda Up, RMR, Real Futsal, Special Olympics CO, Zara Gymnastics, External/Rental) and set `facility_color` in brand_json on all 10 orgs (decision D-M12-1). Record file: db/migrations/2026-07-24_0008_facility_v1_0.sql — do not run.
- **Worker:** `facility.js` v1.0 NEW — staff-gated GET /api/admin/facility/spaces (atoms + presets + operator colors) · GET /bookings?from&to · POST /check (conflict preview) · POST /bookings (single or weekly series with a 52-week cap; conflict-checks EVERY date before writing anything — never half-writes a series; `force:true` accepts share WARNINGS only, hard conflicts always block with a per-date problem list) · PATCH /bookings/:id (scope one | series = this + future, re-checked) · DELETE (soft, one/series) · POST /import (header-mapped CSV: required Date/Start/End/Title/Operator; recognizes Spaces/Booked As, Court Share, Staff, Bar, Catering, Door Charge, POC fields, Attendees, Notes, Closure; unknown columns ignored; per-row errors with line numbers; hard-conflict rows skipped and reported; dry_run preview). Conflict rule: date + time overlap + atom intersection = HARD; both sides Court Share → warning; closures always hard. `index.js` v0.12.0 (import + wire + route + health string).
- **Web:** `admin-facility.html` + `assets/admin-facility.js` v1.0 NEW — Facility Calendar on the shared admin rail: Day grid (spaces × 6:00–23:00, operator-colored blocks with hatched closures and "shared" tags, today line, empty-state CTA) + Week list (Mon–Sun cards); prev/today/next + date jump; booking modal (preset auto-checks atoms, Court Share + closure toggles, weekly repeat-until, collapsible staffing/catering/POC section, inline conflict panel with "Book anyway (shared)" for warnings only, series-aware save/delete); CSV import modal with mandatory dry-run preview before Import enables. No animation on grid navigation (daily-frequency rule); modal enters 200ms ease-out from scale(.97); 44px targets; focus-visible throughout. `admin-nav.js` v2.2 (Facility Calendar item in Run events).
- **Tests:** NEW worker/test/facility.test.mjs (8 passing: hard/share/closure/ignore conflict cases, 12h/24h time parse, ISO/US dates, preset/range/list space text, quoted-CSV parse) + live D1 conflict-SQL check (overlap detected on shared atom, clean on disjoint atom, test rows wiped). Full gate re-run: node --check all files · esbuild bundle (mirrors Actions) reports v0.12.0 · scheduler suite passing.
- **Phase B (next, v0.12.x):** tournament pools + league week slots auto-claim atoms; shipped separately so this paste never touches tournaments.js/leagues_admin.js.

## v0.13.0 — 2026-07-24 · M12 Phase B: Court auto-claim + rental requests
- Tournament schedule generation and league week generation now auto-claim courts on the facility calendar (`source='auto'` bookings, drag/edit/delete like any booking). Default courts VB 1..N; busy defaults move to the next open courts; response reports what was claimed/moved and any shortfall. Regenerating releases and re-claims; deleting a league week releases that week's claim. Claims never block schedule generation.
- Rental REQUEST feature (public self-serve rental stays hidden): signed-in members can `POST /api/rental-request`; staff see a pending-requests panel on the Facility calendar with preset picker + Approve/Decline; approval conflict-checks and books under org 10 (External / Rental).
- Migration 0009 (applied live 2026-07-24): `space_bookings.source` column + `rental_requests` table.
- Files: facility.js v1.1.0, tournaments.js v0.4.0, leagues_admin.js v1.2.0, index.js v0.13.0, admin-facility.html/.js v1.1.0, worker/test/facility_claim.test.mjs (10 tests). Validation gate: node --check ✓ · esbuild bundle reports v0.13.0 ✓ · 19/19 tests ✓ · live D1 spot check ✓.

## v0.14.0 — 2026-07-24 · M12.5 Member Portal & Agreements + M13 Security & Recovery
- **M12.5 (member_portal.js NEW, home.html/js v1.3.0):** My Dashboard gains a status strip (waiver chips for you + each child: signed-through date or "sign now" link), an **Agreements** card listing every waiver/document signed on the account (merged from the waivers table and the signatures ledger, guardian signings labeled, newest first, show-all expand), and a **Request court time** card — HIDDEN behind `BT_CONFIG.RENTALS_ENABLED=false` (config.js v0.3.0) per owner decision; when enabled it posts to the existing /api/rental-request.
- **M13 (security.js NEW, admin-security.html/js NEW, admin-nav.js v2.3):** Security & Recovery page under People — audit-log viewer (kind presets: sign-ins/deletes/money/facility/roles, search, id-cursor "Load older"), **Trash & restore** (soft-deleted events/teams/registrations/contacts/facility bookings/rental requests, one-click whitelist-only Restore — auth/security tables deliberately NOT restorable), **Lockout rescue** (admin issues a one-time sign-in link for a locked-out member; sandbox shows the link with Copy, Brevo mode emails it; always audited).
- No schema changes. index.js v0.14.0 wires both modules; health reports v0.14.0.
- Tests: worker/test/security_portal.test.mjs (6: whitelist safety incl. never-restorable auth tables, agreements dedup/sort/empty). Validation gate: node --check ✓ · esbuild bundle reports v0.14.0 ✓ · 25/25 tests ✓ · live D1 spot check (trash list, restore round trip, agreements SQL, log join) ✓.

## v0.18.0 — 2026-07-25 (M15: POS-lite, Promo Codes, Sponsors, Staff Shifts)
- NEW worker/src/pos.js v1.0: products CRUD, register sales (server-side pricing, per-line
  proportional discounts, basis-point tax, stock decrement with amber low-stock flag, void
  with restock), promo codes on the day-one `discounts` table (D-M15-1, +3 columns in
  migration 0012), sponsors (admin CRUD + public GET /api/sponsors), staff shifts CRUD.
  Square payments record as SANDBOX — no live charge (standing rule 1).
- worker/src/reports.js v1.2: R-02 attendance heatmap, POS sales report, R-05 shift coverage.
- worker/src/index.js v0.18.0: pos mounted after messages; health reports v0.18.0.
- NEW web/admin-pos.html + assets/admin-pos.js v1.0 (Sell / Products / Promo Codes /
  Sponsors / Shifts / Insights). web/assets/admin-nav.js v2.7: Point of Sale in Money group.
- db/migrations/2026-07-25_0012_pos_v1_0.sql applied live (additive only).
- Deferred to v0.18.1: balance-due chip on the check-in roster (Gymdesk pattern).

## v0.19.0 — 2026-07-25 · Waitlists
- **Capacity is now enforced at registration** (registrations.js v1.3): events with a
  capacity return 409 `{event_full, waitlist_available}` when full; `/api/events/:id/form`
  now reports `capacity` / `spots_taken` / `is_full`.
- **NEW worker/src/waitlists.js v1.0** — public join (dedup, live position), status check,
  staff queue view, "Offer next" + per-row offer (override) + remove; offers email an
  expiring claim link (48h default, 1–168h clamp) that admits the team through the
  capacity gate via `?wtoken=`; claims are recorded against the registration.
- **NEW staff cancel** `POST /api/registrations/:id/cancel` — frees the spot
  ('cancelled' was already in the day-one status CHECK) and auto-offers the next team.
  Refunds stay manual in Square (SANDBOX, rule 1).
- **Daily cron** adds `waitlistSweep` — expires stale offers, auto-offers the next team.
- **Web:** register.js v0.4.0 (full events show a Join-the-waitlist card; claim banner +
  token pass-through; graceful "filled while you typed" handling) · NEW
  admin-waitlists.html/js v1.0 (queue management) · admin-nav.js v2.8 (Waitlists item).
- **DB:** migration 0013 (waitlists table + 3 indexes) — applied live 2026-07-25.
- Tests 58 → 68 (waitlists.test.mjs). Emails ride the sandbox switch (rule 12).

## v0.20.0 — 2026-07-25 — PWA + Web Push
- **PWA:** `manifest.webmanifest` + `sw.js` (network-first shell cache; API never cached). Site installable to the home screen on Android and iPhone. Static tags on index/home/settings; every other page gets them injected by site-nav v2.5 / admin-nav v2.9.
- **Web Push (zero deps):** `worker/src/push.js` v1.0 — RFC 8291 aes128gcm encryption + RFC 8292 VAPID on WebCrypto. Routes: vapid-key (public), subscribe/unsubscribe/status (member), admin test-send (staff). Requires Worker secrets `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (+ optional `VAPID_SUBJECT`); without them everything no-ops safely.
- **Waitlists v1.1:** offer push sent alongside the offer email (deep-links to the ?wtoken= claim).
- **Settings v1.1:** push on/off toggle with iOS Add-to-Home-Screen hint (settings.js v1.1 + push.js client v1.0).
- **Cron:** daily `pushPruneSweep` — dead endpoints (404/410) soft-deleted immediately, chronic failures disabled, 30-day purge.
- **DB:** migration 0014 `push_subscriptions` (additive; applied live via Cloudflare MCP).
- Tests 29/29 locally (pos 12 · waitlists 10 · push 7 incl. full RFC 8291 encrypt→decrypt round trip).

## v0.21.0 — 2026-07-25 — M16 Optimization + QA
*(backfilled 2026-07-26 — this entry was missed at release)*
- **`Cache-Control: no-store` on every API response** (index.js v0.21.0). The browser's HTTP
  heuristic cache had served a stale `/api/health` after v0.20.0 went live; API JSON is now
  never cached. The service-worker static-shell cache is unaffected (D-PWA-3 holds).
- **Check-in shows money owed:** checkin.js v1.1 (`balanceCents()` / `OWED_STATUSES`; roster
  rows carry `reg_id`, `reg_status`, `balance_cents`) + admin-checkin.js v1.1 — owes-chip on
  the **team header** with tap-to-resolve via mark-paid (D-M16-2: per-team money, and player
  cards are `<button>`s, so nesting a button would be invalid HTML).
- **One-click mute:** messages.js v1.1 adds `POST /api/admin/messages/mute` + `/unmute`;
  flags carry `sender_muted` / `sender_contact_id`. Muting does **not** resolve the report
  (D-M16-3) — the review trail stays open. No migration: `member_mutes` already existed.
- **Core Web Vitals gate closed:** no images missing intrinsic size, no third-party JS on
  member pages, first-party shell 21–26 KB. Only fix needed was deferring blocking
  `qrcodejs` on the check-in kiosk.
- Nav/title polish: register.html + score.html gain site-nav; `·` → `—` in four page titles.
- Tests 87/87 (7 new balance · 6 new mute). No migration, no secrets, no new pages.

## v0.22.0 — 2026-07-26 — Waiver versioning
- **The waiver text is now a database record, not a hardcoded JS constant.** It previously
  lived only in `web/assets/register.js`, which made it impossible to tie a signature to the
  language actually shown. **NEW `worker/src/waivers.js` v1.0** owns it:
  public `GET /api/waiver/current` and `/api/waiver/versions/:id`, member `GET /api/waiver/mine`
  (returns `needs_resign`), staff `GET|POST /api/admin/waivers/versions`.
- **Every signature pins its version.** registrations.js v1.4 and profiles.js v1.3 write
  `waivers.version_id` (and `signatures.version_id` for guardian signings) resolved through
  `pinFor()` **before** any row is written. Publishing new text can never alter what an
  existing signature means.
- **Stale forms are refused, not accepted.** A form rendered against a superseded version
  submits to a `409 { waiver_stale:true }`; register.js v0.5.0 swaps in the new text, clears
  the tick and typed signature, and keeps everything else the person entered.
- **Material vs minor.** A version published with `material:0` (typo/formatting) does not
  prompt anyone to re-sign; the default is material, because an unspecified change is
  assumed substantive.
- **Concurrent publish is guarded at the database.** Partial unique index
  `ux_waiver_versions_active` permits one active version per org, so a simultaneous second
  publish fails its transaction and returns 409 instead of silently producing two live
  waivers. Published bodies are immutable — there is no edit or delete route by design, and
  `waiver_versions` is deliberately **excluded** from `RESTORE_WHITELIST` (same M13 rule as
  `waivers` / `signatures`; security_portal.test.mjs v1.1 now enforces it).
- **Web:** NEW admin-waivers.html + admin-waivers.js v1.0 (publish with a two-step confirm
  that names how many members will be asked to re-sign; read any past version's text) ·
  register.js v0.5.0 · admin-nav.js v2.10 (Waivers under People) · member_portal.js v1.1
  threads `version_id` into the agreements list.
- **DB:** migration 0015 — `waiver_versions` + `version_id` on `waivers` and `signatures`,
  with every pre-existing signature backfilled to a per-org `v1-legacy` row carrying the
  verbatim placeholder text those members actually saw. Never NULL.
- Tests 102/102 (17 new: publish normalization, re-sign rules, SHA-256, legacy labelling).

## v0.23.0 — 2026-07-26 (Waiver enforcement at the door + iCal calendar feeds + Aurora correction)
- **Migration 0016** (dry-run on a local sqlite replica per D-MIG-1, then applied live via Cloudflare MCP BEFORE the paste): `access_tokens` — one shared capability-token table serving the iCal feeds now and teammate waiver-sign links in v0.24.0. SHA-256 of the token is stored, never the raw value; the raw string is shown once at mint. Partial unique index `ux_access_tokens_public_cal` allows at most one live public feed per org, `ux_access_tokens_sha` makes hashes globally unique. `access_tokens` is deliberately excluded from `RESTORE_WHITELIST` (D-TOK-1) — undeleting a revoked bearer token is not a feature.
- **Waiver hard gate at check-in (D-WV-7).** Owner decision 2026-07-26: no participation without a current, unexpired waiver. Enforcement lives in `checkin.js`, not at registration, because teammates never register — the captain enters their name and email, so there is no teammate-side submit to block. Staff check-in and walk-in now return 409 `{ waiver_required: true }`; staff may proceed with a typed override reason of ≥8 characters, which is audited as `attendance.checkin.waiver_override` with the reason attached. The public self-check-in link has **no** override — a player cannot wave themselves through. Undoing a check-in is never gated.
- **T-30 waiver expiry notice (D-WV-8).** New `waiverExpirySweep()` in `registrations.js`, wired into the daily cron. Calendar-driven and distinct from the existing event-driven `waiverReminderSweep`. One notice per waiver row ever — dedupe is on `waiver_id` inside a `waiver_expiring` notifications row, not on a time window, because a 30-day window with a 48h dedupe would email the same member fifteen times. Anyone who has already re-signed is skipped.
- **iCal feeds (RFC 5545).** New `worker/src/calendar.js`. `GET /api/calendar/:token.ics` serves a member's own schedule or the org's public event feed. Member mint/rotate/revoke at `/api/profile/calendar`, staff public feed at `/api/admin/calendar`. Routed in `index.js` **before** the `/api/` chain and outside `json()` — since v0.21.0 `json()` stamps `Cache-Control: no-store` on every API response, and a no-store `.ics` makes every subscribed client refetch on every tick. The feed sets `max-age=900`, answers 304 on a matching `If-None-Match`, and throttles its `last_used_at` write to once an hour.
- **Cancelled events are emitted `STATUS:CANCELLED` with `SEQUENCE:1`, not dropped.** Removing a VEVENT does not remove it from a subscriber's calendar — it just stops updating, and the ghost sits there forever.
- **Aurora correction pack (D-LOC-1).** `sandbox.js` v1.1 test-contact cities, `admin-marketing.html` CAN-SPAM placeholder (now a marked `[STREET ADDRESS]` blank rather than a fabricated one — the invented-address habit is what produced the Colorado Springs error), `marketing.test.mjs` fixture, and a new `db/2026-07-26_seed-testdata_v1_1.sql` replacing the 2026-07-23 v1.0 seed.
- Gates: `node --check` 13/13 · tests **137/137** (26 new calendar, 9 new gate) · esbuild bundle 363 KB containing `v0.23.0`, `waiver_required`, `BEGIN:VCALENDAR`, `waiver_expiring`, `access_tokens` · migration 0016 dry-run asserted idempotent re-run, public-feed uniqueness, rotate-after-revoke, global `token_sha` uniqueness, and the `kind` CHECK.
- Deferred to v0.24.0: teammate self-sign invite links (option B — reuses `access_tokens.kind='waiver_sign'`) and the member-facing subscribe UI.

## v0.24.0 — 2026-07-26 (Build status indicators)

Frontend-only release. No migration, no worker logic change — the worker version bumps only
so `/api/health` and the deployed site report the same string, which is how every paste is
verified.

**Why:** testers are about to be pointed at a site where some screens are finished, some work
but cannot complete their core job yet (email sending is code-blocked, Square is SANDBOX), and
some modules do not exist. Without a marker, every half-built screen produces a bug report that
is really a roadmap item.

**NEW `web/assets/build-status.js` v1.0** — the single registry of module maturity. Four states:
`live` (finished, no badge) · `beta` (works with a stated caveat, safe to test) · `wip` (under
construction, cannot finish its core job) · `soon` (not built, Build Status page only). The file
also renders every consumer of that registry: rail chips, per-page banners, and the full table.
Change a status in this one file and everything follows.

- Rail chips are **not animated** — they are on screen on every page load, which is the
  emil-design-eng frequency rule (standards §2). Only the page banner fades, 180ms, and only
  under `prefers-reduced-motion: no-preference`.
- Status is never colour-only: every chip carries a text label plus an `aria-label` naming the
  state in words (WCAG 1.4.1, standards §3).
- `wip` items are dimmed, carry a cone glyph, and ask for confirmation before opening.
- Banners are dismissible per page per session (`sessionStorage`), never permanently.
- Collapsed admin rail (`data-nav="min"`) collapses each chip to a 6px dot so the rail width
  is unchanged.
- Tokens only, no hardcoded hex.

**NEW `web/admin-buildstatus.html` v1.0** — one honest page listing every screen and every
cross-cutting feature with its state and a tester-facing note, plus counts by state. Reads the
registry directly; no API call, nothing to keep in sync by hand. Linked from the admin rail's
Sandbox group.

**`web/assets/admin-nav.js` v2.10 → v2.11** — loads `build-status.js`; adds **Build status** to
the Sandbox group. The menu data structure is untouched.

**`web/assets/site-nav.js` v2.5 → v2.6** — loads `build-status.js` on the member and public rails.

**`worker/src/index.js` v0.23.0 → v0.24.0** — version string only.

**`README.md`** — full rewrite; it had been stale at v0.12.0 for eleven releases. Module table
current through v0.24.0, marker legend, corrected architecture table (63 tables, 137 tests,
real route pattern), roadmap v7 pointer.

**States at release:** 2 WIP (Marketing & Email — sending code-blocked until the address and
Brevo key are in place; Web Push — three VAPID secrets never set), 9 BETA (mostly Square
SANDBOX), the rest finished.

**Gates:** `node --check` 24/24 · tests **137/137** · esbuild 363 KB containing `v0.24.0` ·
no SQL, so no migration dry-run required.

## v0.25.0 — 2026-07-26 (Consent: teammate self-sign + media-release record)

Two roadmap items in one release. Both answer "who agreed to what, and can we prove it."

### A. Teammate waiver self-sign (roadmap R-03)
Until now only the captain ever signed. Teammates were a name and an email on `team_members`
— no contact row, no signature, no way to reach them again — so the door gate added in
v0.23.0 had nothing to check them against, and the CRM held one row per team instead of four.

- **NEW `worker/src/consent.js` v1.0**, mounted after `calendar.js`.
  - `GET|POST /api/sign/:token` — public. The token IS the credential; no session.
  - `POST /api/team-members/:id/waiver-link` — captain or staff mints and emails a link.
  - `GET /api/team-members/:id/waiver-state` — has this person got a current waiver?
- Signing finds-or-creates the contact, writes a `waivers` row **pinned to the active
  `waiver_versions.id`**, links the roster row, and links every other unlinked roster row in
  the org carrying the same email.
- **NEW `web/sign.html` v1.0** — public sign page. Token lives in the URL **fragment**, not a
  query string: fragments are not sent in the `Referer` header and do not reach access logs,
  so a forwarded link leaks less.
- Idempotent: a second submit on a live waiver returns ok without writing a duplicate.
- Version-race guard: if the waiver text is republished while the page is open, the POST is
  refused with `waiver_stale` rather than pinning a signature to text nobody read.
- Token is revoked the instant the waiver is signed, and minting again rotates rather than
  accumulating, so a forwarded old link dies the moment a new one is issued.
- Nickname signatures are accepted with a `name_matched_roster: false` flag on the audit row.
  Rejecting "Bobby" because the roster says "Robert" produces unsigned waivers, which is
  strictly worse than a flagged one.

**A real bug was caught by the new tests before release.** `signState` normalised timestamps
with `replace(" ","T") + "Z"`, which turns an already-ISO value into `...12:00:00ZZ`.
`Date.parse` returns `NaN`, every comparison against `NaN` is false, and **an expired token
read as valid.** Replaced with `parseTs()`, which only appends `Z` when there is no timezone
suffix, and which now **fails closed** — an unparseable expiry is treated as expired rather
than as no-expiry. Two regression tests guard it.

### B. Media-release consent record (D-WV-10 / handoff v2.6 §6B)
Waiver §6 grants an irrevocable likeness release whose only decline path is a written
request. The policy had nowhere to live, so an opt-out could be honoured once by whoever
read the email and forgotten the next time someone picked photos.

- **Migration 0017** (`media_consents`) — **applied live before this paste list was built**
  (D-MIG-2). Dry-run first against a local replica; all six assertions fired.
- History is preserved: withdrawing soft-deletes the opt-out row and writes a `restored` row
  rather than editing in place. The partial unique index counts only live rows, so a future
  opt-out still fits.
- `reference` is **required** — a record with no pointer to the writing cannot be defended.
- **NEW `web/admin-consent.html` v1.0** under People. Staff-only. There is deliberately **no
  member-facing opt-out**; adding one would contradict D-WV-10, not implement it.
- `optedOutContactIds()` exported for photo pickers to filter against.

### Also
- `web/assets/build-status.js` v1.0 → **v1.1** — registers the two new pages; teammate
  self-sign and media consent flip from SOON to LIVE.
- `web/assets/admin-nav.js` v2.11 → **v2.12** — Media consent added under People.
- `worker/src/index.js` → **v0.25.0**.

### Not in this release
The calendar **subscribe UI** (roadmap R-08) was scoped into v0.25.0 and cut. The `.ics`
feeds still have no button anywhere to fetch a feed URL. Moved to v0.26.0 — flagged rather
than quietly dropped.

**Gates:** `node --check` 25/25 worker + 3 web + 2 inline blocks ✅ · tests **160/160**
(up from 137; 23 new) ✅ · esbuild containing `v0.25.0` ✅ · migration 0017 dry-run 6/6 ✅ ·
applied live and verified in `sqlite_master` ✅

## v0.26.0 — 2026-07-26 (Tiers, view gating, isolation hardening)
**Migration 0018** (`membership_tiers`, `membership_grants`, `plans.tier_id`, `schedule_views.owner_org_id`/`visibility`/`min_tier_id`/`require_membership`, `orgs.timezone`). Dry-run 14/14 against a local replica.

### Multi-tenant isolation (Critical/High)
- `admin.js listUsers` scoped to the caller's admin orgs. It previously returned every user, email, TOTP state and role assignment on the platform to any single-org admin.
- `facility.js` bookings: `createBooking` no longer accepts `org_id` from the request body (`Number(b.org_id) || 1`); `updateBooking`/`deleteBooking`/series operations scope by `ctx.orgId`; org is now immutable on update.
- `security.js` deleted-list and restore scoped by `org_id` — staff could previously list and restore another tenant's soft-deleted contacts, registrations, teams and events.
- `checkin.js myAttendance` scoped by `org_id`.

### Capability tokens (`consent.js`)
- `postSign` never called `signState`, so **revoked, soft-deleted and expired waiver tokens all still produced legally operative signatures.** Tokens now resolve only when live, and expiry is enforced on the write path.
- Single-use consumption is now an atomic conditional `UPDATE` executed before the first write, replacing a read-check-then-write sequence that let concurrent submits both write a waiver.
- The waiver version guard no longer skips when `version_id` is omitted or null.
- `getSignPage` returns 404 for expired tokens instead of 200-with-state; a distinguishable response confirmed the token hash existed.

### Calendar time zones
- `calendar.js` was emitting `starts_at` with a trailing `Z`. Events are stored as naive facility wall-clock (the admin UI posts `date + " " + time`, and the worker stores it unmodified), so **every subscribed event landed 6–7 hours early.** Now emitted as floating wall-clock bound to a `VTIMEZONE` (`toIcsLocal`, `addWallHours`, `icsVtimezone`). `DTSTAMP` remains UTC, which is correct.
- `profiles.js eventIcs` was already correct; the hardcoded zone is replaced so both paths read `orgs.timezone`.
- Selectable zone (Denver, Phoenix, Los Angeles, Chicago, New York) via `GET/PUT /api/admin/org`, whitelisted server-side. Default `America/Denver`.

### Fail-closed corrections
- `waitlists.js offerExpired` returned `false` on an unparseable expiry, so a corrupt `offer_expires_at` meant a claim link that never expired. Now fails closed.
- `facility.js` slot parsing: `Number("abc")` is `NaN`, and every `NaN` comparison in `validateSlot` was false, so non-numeric times passed validation and bound `NaN` into D1. Reuses the module's existing `num()` guard.
- `reports.js sales`/`dashboard`: soft-deleted registrations were still summed into revenue.
- `member_portal.js myAgreements`: soft-deleted contacts surfaced as agreement subjects.
- Unguarded `JSON.parse` on `config_json` in `leagues_admin.js` and `tournaments.js` could 500 an entire endpoint from one malformed row.

### New — membership levels (`tiers.js`)
- Tiers are entitlements (rank, discount bps, guest passes, open-gym, booking window); plans stay billing products. A tier can be granted by subscription, manually, comped, staff, or sponsor.
- `effectiveGrant` resolves the live tier by rank then recency, and **fails closed on corrupt dates.**
- Tier delete is refused while live holders exist — inactivate instead of silently stripping entitlements.
- Admin UI: `web/admin-tiers.html`.

### New — schedule view ownership and visibility
- `schedule_views.org_id` is a *content filter* (migration 0003: "NULL = all orgs"), not ownership. Scoping mutations by it would have made both seeded built-ins uneditable by every user. Ownership is the new `owner_org_id`; NULL means platform-global and admin-only.
- `visibility` is `public | internal | staff`, enforced server-side in the feed, with optional membership-tier gating on top. Unknown values fail closed. Backfill preserves current access exactly.

### New — bulk member actions (R-11)
- `POST /api/admin/members/bulk`: add/remove tag, grant tier, unsubscribe/resubscribe, export CSV. Capped at 500 ids, org-scoped (foreign ids dropped and reported), audited as one row with the id list. Tag and grant writes use `env.DB.batch` rather than sequential awaits.
- Selection column + fixed bulk bar in the members list.

### Frontend
- Stored XSS: `app.js` interpolated `org.name` and the signed-in email straight into `innerHTML`. Added `esc()`.
- A `401` from any admin call now clears the dead token and redirects to `index.html?expired=1` instead of failing silently.
- `R-08` shipped: `web/admin-calendar.html` — the subscribe UI the `.ics` feeds have lacked since v0.23.0. The feed token is shown once and unrecoverable, so the reveal is styled as an action state, not a success state.
- Shared `contactForSession` in `index.js`; `ctx.role` resolved once per request.

**Gates:** `node --check` 25 worker modules + 5 web assets + 2 inline blocks · `node --test` **207/207** (was 160) · esbuild 408 KB containing `v0.26.0`, `membership_tiers`, `toIcsLocal`, `canReadView`, `validateBulk` · migration 0018 dry-run 14/14.

## v0.27.0 — 2026-07-26 (Guardians & minors · waiver tokens · org profile)
**Migration 0019** (`families`, `contacts.family_id`, `guardianships.aged_out_at`/`separation_choice`/`separated_at`, `member_profiles.dominant_hand`, ten `orgs` profile columns). Applied live and verified.

### Minors — the safety fix
- **`consent.js postSign` let a minor sign their own waiver.** A captain entered any teammate email and the holder self-signed. A minor cannot form a binding waiver, so the result was a void document the front desk read as valid — worse than no waiver. Date of birth is now **mandatory** on the sign flow, and a minor is refused with instructions to involve a guardian.
- `sign.html` collects date of birth **before** the signature field, with a client-side check as courtesy; the server enforces regardless.
- NEW `family.js`: `ageOn`, `isMinor`, `validateBirthdate`, `guardianGate`, `signerFor`, `ageOutState`, `separationRequirements`, `displayName`, `normalizeDominantHand`.
- **Age is derived, never stored.** No `is_minor` column: a stored boolean is correct until a birthday and silently wrong after, which would keep an adult guardian-signed or let a minor age into self-signing.
- **`isMinor` fails closed** — an unknown or unparseable birthdate returns `true`. A guardian with no birthdate on file is rejected rather than assumed adult, and a minor cannot be another minor's guardian.
- Guardian-first ordering: a minor's birthdate halts the flow before their record is written. The reverse order lets a child self-register and self-sign before any adult appears.
- 18th-birthday transition: `prompt` → `kept` (guardian keeps signing, may separate later) or `separated` (self-signs). A separated guardianship row is **kept, not deleted**, so the family connection stays visible and signature history reconstructable. Separation requires re-signing in the member's own name and blocks participation until done.
- Routes: `POST /api/family/age-check` (pre-flight, writes nothing), `GET /api/family`, `POST /api/family/age-out`.

### Minor display — child safety
- `displayName` abbreviates surnames per D9 and marks minors **`(M)` on internal/staff views only**. Publishing `Ava R. (M)` on an open schedule page would hand anyone a machine-readable list of which children are on which court at which time. Unknown visibility values do not leak the marker.

### Waiver tokens
- One canonical body serves every org via `{{ENTITY}}`, `{{ORG_NAME}}`, `{{ORG_EMAIL}}`, `{{MEDIA_OPTOUT_EMAIL}}`, `{{ORG_WEBSITE}}`, `{{ORG_PHONE}}`, `{{ORG_ADDRESS}}`.
- **`ENTITY` is deliberately separate from `ORG_NAME`** — the legal person the release runs to vs the brand a family recognises. If the brands are DBAs of one LLC, only `ORG_NAME` varies.
- Resolution happens **at publish, not at render**, and the resolved text is what `body_sha` pins. Rendering late would mean a signed document changes retroactively when an org's email is edited.
- Publish **refuses** on an unknown token or a blank org value. A §6 promising a written decline path to a literal `{{MEDIA_OPTOUT_EMAIL}}` has no decline path.

### Org profile
- `orgs` gains website, admin_email, phone, address_line1/2, city, state, postal_code, `is_owned`, `active`.
- Facility address written to all ten orgs: 14200 E Alameda Ave · FieldhouseUSA · Aurora, CO 80012.
- Four owned orgs send under their own identity; six facility renters send as `"<Name> via Boomtown"` from a controlled domain. Sending as a renter's own domain would fail SPF/DKIM and constitute impersonation.

### Player bio
- `dominant_hand` (left/right/ambidextrous), whitelisted in the worker since SQLite cannot add a CHECK via ALTER. Free text here would reach the public player card.

**Gates:** `node --check` 26 worker modules + inline blocks ✅ · `node --test` **245/245** (was 207) ✅ · esbuild 418 KB containing `v0.27.0`, `resolveWaiverTokens`, `validateBirthdate`, `displayName` ✅ · migration 0019 applied and verified live ✅

---

## v0.28.0 — 2026-07-26 · Documents

Legal text stops being code. Each org owns its own documents; tokens fill from the org profile.

### NEW `worker/src/documents.js` — org-owned document library
- `documents` + `document_requirements` (migration 0023). An org may hold several signable
  documents; each has versions, and one version at a time is *required* of a given audience.
- **Two-phase tokens (D-DOC-5).** Org tokens resolve at **publish** and are hashed into `body_sha`;
  signer tokens resolve at **render** and are never hashed. Resolving org tokens at render would
  rewrite a signed document the day somebody edits a phone number; resolving signer tokens at
  publish is impossible, because the signer is unknown.
- **No fallback on party identity or mailing address (D-DOC-6).** `ENTITY`, `ENTITY_SHORT`,
  `ORG_NAME`, `ORG_EMAIL`, `ORG_ADDRESS` refuse rather than guess. Cosmetic tokens may fall back.
  `RULES_REFERENCE` falls back to "posted at the facility" because a dead URL is weaker than no URL.
- **Publish refuses** on unknown tokens, on empty no-fallback tokens, and on bracket-style
  placeholders (`[LIKE_THIS]`, `TBD`, `____`) that a `{{...}}`-only validator cannot see.
- **Warns** when the text contains an org's literal name instead of a token — needs
  `confirm_literal_names` to proceed, because "Boomtown Fieldhouse" may legitimately appear in
  facility rules.
- **Retroactive assignment** with a server-side dry run. Above 50 affected members the caller must
  echo the count back, because `retroactive=1` locks the entire roster out of registration and
  check-in until they re-sign.
- **Compliance is computed, never stored (D-DOC-7).** One query drives the registration gate, the
  check-in chip and the assignment preview, so the three cannot disagree.
- Signatures are pinned permanently to the version and `body_sha` the signer saw, never re-pointed
  (D-DOC-8). One active requirement per (org, document, audience), enforced by a partial unique
  index rather than worker logic (D-DOC-9).

### FIXED — F-10, P0, in shipped code
`WAIVER_TOKENS.ENTITY` read `o.legal_entity || "Boomtown Athletics, LLC"`, **and
`publishVersion`'s org query never selected `legal_entity` at all.** So `o.legal_entity` was always
`undefined` and the hardcoded fallback fired for *every* org regardless of what migration 0020 put
in the database. Not "orgs missing an entity get a default" — no org could ever resolve its own
entity. D-ORG-1 has forbidden this for three releases while the code did the opposite. Both halves
fixed: fallback removed, columns selected.

`MEDIA_OPTOUT_EMAIL` removed — the opt-out is retired (D-CON-5) and declining the release is
declining the waiver (D-CON-6). The token permitted publishing a decline path the platform answers
with 410 Gone. `ENTITY_SHORT` and `RULES_REFERENCE` added. `currentVersion()` scoped to the
liability-waiver document, since `org_id` alone now returns whichever document published last.

### Migrations applied live and verified
- **0021** — `schema_migrations` ledger created and backfilled. Twenty migrations had been applied
  with no record in the database of which ran. Orgs 4–10 deactivated (`active=0`), none deleted;
  every row in the platform belongs to org 1, so the reduction was cost-free and reversible.
- **0022** — `legal_entity_short`, `legal_entity_verified`. Match Point Social and Queens Club
  seeded with owner-supplied placeholder names at `verified=0`, so a guessed corporate identity is
  visible rather than laundered into a signed document.
- **0023** — document library. `signatures` was already document-agnostic, so this extends it
  rather than adding a fourth signature table. `waivers` deprecated, not dropped.

### Known open
- **F-4** nothing in `worker/src/` reads `orgs.active` — confirmed by grep across all 27 modules.
  The seven deactivated orgs are still selectable. Next release, 0.25d.
- **`nonCompliant` and `currentDocVersion` are tree-shaken from the bundle** — exported, uncalled.
  They are the v0.29.0 registration gate and check-in chip. Shipped dead until wired.
- **R-23** `waivers.js` and `documents.js` hold two token maps deliberately, to avoid a module
  cycle. A change to either must be made in both until `tokens.js` is extracted.
- **F-5** capacity oversubscription race · **F-6** `guardianGate`/`signerFor`/`applyTierDiscount`
  built and uncalled · **F-7** N+1 in `events_admin.js` · **F-9** two entity names unverified.
- No tests for `documents.js` yet. Admin UI and multi-document `sign.html` not built.

**Gates:** `node --check` on all three changed modules ✅ · esbuild bundle **441,832 bytes**
containing `v0.28.0`, `documentRoutes`, `resolveDocTokens`, `complianceFor`, `tokenRefusal`,
`literalOrgNames` ✅ · migrations 0021/0022/0023 applied and verified against live D1 ✅ ·
`node --test` **not run** — no new tests written.

---

## v0.30.0 — 2026-07-26 — Org scope enforced · capacity race closed · generic file uploads

Absorbs the v0.29.0 patch set, which was written but never pasted (`HEAD` sat at `ea6d385`).
Delivered as a ZIP for upload rather than paste blocks.

### Closed
- **F-11 — org scope was not enforced at the API layer.** `buildCtx` accepted any `X-Org-Id` with
  no existence, `active` or `deleted_at` check, so the seven orgs deactivated by migration 0021
  were fully operable by sending a header — and a malformed header fell back silently to org 1,
  the live business. `buildCtx` now validates and sets `ctx.orgOk`; the router short-circuits to
  **404** (not 403 — a deactivated org should be indistinguishable from one that never existed).
  `listOrgs` filters to `active = 1`, so migration 0021 becomes visible in the switcher for the
  first time: **3 orgs, not 10.**
- **F-12 — unscoped bootstrap admin grant.** `SELECT ?1, id, 'admin' FROM orgs` now carries
  `WHERE active = 1 AND deleted_at IS NULL`. A v0.1 artifact that survived 29 releases and seeded
  exactly the role rows F-11 needed.
- **F-11b — the literal-name guard scanned the narrowest set.** `documents.js` filtered its
  party-name scan to active orgs, so a document naming a deactivated org published clean. Widened
  to every non-deleted org. This is the one predicate in the release that goes wider, deliberately:
  **a guard must scan the widest set** (standards §10 check 3).
- **F-5 — capacity oversubscription race.** `waitlistGate` read the count ~55 lines and four D1
  round trips before the INSERT, so two concurrent submits both passed. Capacity is now re-checked
  *inside* a single atomic `INSERT…SELECT…WHERE`; the loser gets **409 `event_full`**. Same
  reasoning as token consumption in `consent.js postSign`. A valid waitlist claim bypasses by
  design. Residue named, not hidden: a losing race leaves an orphan team row — **R-24, 0.25d**.
- **F-6 (partial) — `applyTierDiscount` called for the first time.** Built and tested in v0.26.0,
  zero call sites for four releases. Wiring it at registration *alone* would have quoted a
  discounted price and charged list price, because `retryPayment` recomputes from
  `events.price_cents`. The quoted figure is therefore stored in `registrations.price_cents`
  (0024) and checkout reads `COALESCE(r.price_cents, e.price_cents)`, so pre-0024 rows are
  unaffected. `guardianGate` and `signerFor` remain uncalled — they need date-of-birth in the
  registration payload, which is a design change, not a patch.
- **F-16 (new) — the test suite was red at HEAD and nobody knew.** Four assertions in
  `family.test.mjs` failed against shipped code. One asserted `{{MEDIA_OPTOUT_EMAIL}}`, retired
  under D-CON-5. **One encoded the F-10 defect itself** — it expected `{{ENTITY}}` to render
  "Boomtown Athletics, LLC" for a Match Point Social fixture with no `legal_entity`, which only
  passed while the `||` fallback existed. F-10 was fixed in the code four releases ago and nobody
  grepped the tests. Root cause is the same class as F-15: the previous release recorded
  `node --test` **not run — no new tests written**. A gate you skip is a gate you do not have.

### Added
- **`worker/src/uploads.js` v1.0 — generic org-scoped file store.** R2 holds the bytes, D1 holds
  the index; the same split `member_profiles.avatar_r2_key` has used since v0.5.0, generalised
  rather than copied a fourth time. `POST/GET /api/uploads`, `GET/PATCH/DELETE /api/uploads/:id`,
  `POST /api/uploads/:id/restore`. Server-side MIME allow-list, 10 MB cap, 2,000-file org quota
  quoted rather than silently truncated, generated R2 keys (the filename never reaches the key),
  soft delete with restore, audit row on every write.
  **SVG and HTML are excluded from the allow-list** — an SVG served from our own origin is stored
  XSS. Non-image/PDF types are served `Content-Disposition: attachment` with a sandbox CSP and
  `nosniff`. Binding resolves `env.UPLOADS || env.AVATARS`, so no new bucket is required and the
  deploy cannot fail on a missing binding.
  Deliberately absent: no compliance, screening, clearance, expiry or approval columns. Those live
  in an external system by owner decision (2026-07-26); a second store for one fact means two
  records that drift.
- **`web/admin-uploads.html` + `web/assets/admin-uploads.js` v1.0.** Drop zone as the single focal
  point, per-file progress, skeleton rows, empty state that names the next action. Dragover changes
  background only — a continuously-firing event gets no transform (§2). Progress is constant
  motion, therefore `linear`. XHR rather than `fetch` because `fetch` has no upload progress.
- **`admin-nav.js` v3.0** — Files added to the People group, beside Settings.
- **Migration 0024** — `uploads` table; `registrations.price_cents`. Additive only. Reversal in
  the file header. Ledger INSERT written against the live `schema_migrations` shape (`version` is
  NOT NULL; there is no UNIQUE on `filename`, so `OR IGNORE` would not dedupe — a `NOT EXISTS`
  guard does).
- **`worker/test/documents.test.mjs` — 26 tests.** `documents.js` shipped in v0.28.0 with none.
  Weighted toward refusals that must happen before a body is hashed and pinned: F-1 bracket
  placeholders, every no-fallback token, per-org party substitution, and **the literal-name guard
  against a DEACTIVATED org** — the F-11 regression test.
- **`worker/test/uploads.test.mjs` — 27 tests.** Path traversal, null bytes, dotfiles, SVG/HTML
  refusal, MIME parameter smuggling, header injection via filename, size boundaries, and the
  fail-closed direction of every normaliser.

### Gates
`node --check` on all four changed modules ✅ · esbuild bundle **458,529 bytes** containing
`v0.30.0`, `uploadRoutes`, `validateUploadRequest`, `applyTierDiscount`, `orgOk`, `safeFilename` ✅
· `node --test` **167/167 pass** (was 163/167 at `ea6d385` — see F-16) ✅ · live D1 read before
every proposed write ✅.

**Call-site census** (standards §6.5, defining file excluded):
`applyTierDiscount` **now has call sites** and leaves the standing list.
`guardianGate` · `signerFor` · `complianceFor` · `nonCompliant` remain at **zero** — expected and
scoped out of this release, not overlooked.

### Known open
- **F-6 remainder** — `guardianGate`, `signerFor` still uncalled.
- **F-6b / F-14** — `complianceFor` blocked on the fail-closed sequencing decision.
- **R-24 (new)** — orphan team row on a lost capacity race, 0.25d.
- **R-23** — `waivers.js` and `documents.js` still hold two token maps to avoid a module cycle.
- **F-7** N+1 in `events_admin.js` · **F-9** two entity names unverified · **F-13** hardcoded
  email sender name.

## v0.31.0 — 2026-07-26 — Documents UI, organisation identity, F-13

**Documents version editor.** `web/admin-documents.html` + `admin-documents.js`. Create a
document, write a version with tokens, publish, assign. Token palette in the right rail, grouped
Org / Signer, insert at cursor in one click with no animation of any kind — standards §2 puts a
100+/day action in the never-animate row. Live preview and the token chips are rendered from the
server's own `resolveDocTokens` and its widest-set literal-name scan, debounced 300 ms, so the
editor cannot tell the author a document is clean and then have publish refuse it. Publishing with
a literal organisation name in the body requires a typed reason of at least 10 characters
(standards §7.3), written to `audit_log`. The assign dialog states the affected count under each
radio from two server-side dry runs; typed confirmation appears only above 50 records.

**New endpoints on `documents.js`.** `GET /api/admin/documents/tokens` and
`POST /api/admin/documents/preview`. Added specifically so the client holds no token map: R-23
already records two deliberate copies in the worker, and a third in JavaScript would be the copy
that lies. Both are numeric-safe against `matchId`, which requires `^\d+$`.

**Organisation settings.** `worker/src/orgs.js`, `web/admin-org-settings.html` +
`admin-org-settings.js`. The screen that fills in the five no-fallback tokens, so a publish
refusal is now actionable. No migration — every column already existed. Writes go through an
explicit allow-list; `legal_entity_verified` is not in it and is set only through
`POST /api/admin/org/verify-entity`, which demands a typed source. Editing `legal_entity` or
`legal_entity_short` clears the verification, and the warning appears while typing rather than
after saving. Admins can reactivate an organisation that v0.30.0 removed from the switcher —
audited, reason required, `active` flag only, nothing dropped.

**F-13 closed, and found to be wider than recorded.** The roadmap listed four hardcoded sender
names. The census found seven more literals in text members actually read: the magic-link subject
in `index.js`, two subject lines in `registrations.js`, the message-relay subject and body in
`messages.js`, the relay's fallback sender label, and a waiver-expiry sentence. `sendEmail()` and
`sendBrevoEmail()` now take an optional `orgId` and resolve through one function,
`orgs.senderIdentity()`, which returns **null** rather than inventing a name — the opposite of the
F-10 shape. A null sender is a refusal, not a guess. Recorded as F-13b.

**Tests.** `worker/test/orgs.test.mjs`, 24 tests. Full suite 323 pass / 0 fail. One test asserts
that `PUBLISH_CRITICAL` equals `documents.NO_FALLBACK` exactly, because a drift between them would
have the settings screen report ready while publish refuses.

**Deferred out of this release.** Requirement 9's cash-payment admin surface. The notification
half already exists — `registrations.js` writes a `cash_pending` notifications row — so what
remains is a queue screen, and it is independent of everything above. Moved to v0.31.1 to keep the
release at two complete items rather than three partial ones.

---

## v0.32.0 — 2026-07-26 — Minors: age-aware registration, guardian invitation, certification

**Migration 0025 — required. The release is not shipped until `SELECT COUNT(*) FROM schema_migrations` reads 25.**

`registrations.js` is age-aware for the first time. Before this release the file held **zero**
matches for `date_of_birth`, `guardian` or `minor` across 49 KB, so a participant of any age
could be registered with no adult attached.

- **D-MIN-9** — a minor's account is created but not activated. New `contacts.activation_state`
  (`active` | `pending_guardian`).
- **D-MIN-11** *(new, owner 2026-07-26)* — a blank guardian date of birth is not a form error.
  The registrant is given an invitation link for the parent, the parent completes their own
  account and certifies the information, and the block lifts.
- **Owner option B** — registration **itself** is blocked, not merely account activation. A minor
  without a certified guardian cannot be registered for anything.
- **D-MIN-8 in force** — the `guardian_required` copy no longer says the guardian signs a waiver.
  There is no waiver gate anywhere. A test asserts the word cannot come back.
- **D-MIN-10** unchanged — the 18th-birthday keep-or-separate prompt stays.

**The invitation link is rendered on screen, not only emailed.** Brevo is paused; an emailed-only
invite would be a block with no key. Email is the enhancement, the on-screen link is the channel.
The token travels in the URL **fragment**, never a query string, so it stays out of access logs
and `Referer` headers — the same reasoning `sign.html` used in v0.25.0.

**F-6 closed.** `guardianGate` had zero call sites since v0.27.0. It now has six, and it is the
only age rule in the codebase: the public registration path, `profiles.js:addChild` and the invite
claim all call the same function. `addChild` previously never checked the parent's own age while
`guardianGate` did — two implementations of one rule, and the live one was the weaker.

**NEW `worker/src/crypto.js`** — a leaf module holding `sha256Hex` and `randomToken`.
`family.js` needed a hash and `consent.js` already imports `family.js`, so importing back would
have created the exact cycle R-23 documents. **F-20 *(new)*: `sha256Hex` is defined four times —
`consent.js`, `calendar.js`, `uploads.js`, `waivers.js`. `crypto.js` is the destination; collapsing
the other four is a separate pass.**

**`access_tokens` was rebuilt** to widen its `kind` CHECK for `guardian_invite`. SQLite cannot
ALTER a CHECK. The table held **0 rows** — verified live before the migration was written — so the
rebuild moved no data. All three indexes are recreated in 0025, plus a partial unique index that
makes two live invites for one minor impossible.

**Tests: 340 pass / 0 fail** across 20 files, up from 323. Bundle 483,736 bytes.

**Deferred on purpose, named so they are not lost:** `complianceFor` / `nonCompliant` as a
non-blocking indicator (F-6b / F-14) and F-18's duplicate `GET /api/family` → v0.33.0. Four items
in one release is how uncalled code ships here.

**Known boundary, stated so it is not mistaken for coverage:** the gate covers the **registrant**.
Team members are name+email rows with no date of birth and are not gated. Extending it to a roster
is a decision, not an oversight.

## v0.32.1 — 2026-07-27 — Deploy gate (re-delivery; the first upload did not land)

**Why this shipped twice.** The v0.32.1 ZIP was uploaded at `40ed3b6` and every file in it landed
wrong: `deploy-worker.yml` v0.3.0's content was written to the repo root as
`0025_guardian_invite.sql`, the rollback SQL overwrote this CHANGELOG and destroyed 700 lines,
and `schema-gate.mjs` plus its tests never arrived at all. `db/migrations/0025` kept its stale
`NOT YET APPLIED` status. No deploy fired, because none of the touched paths matched the old
v0.2.2 workflow's filter — that was luck, not a control.

- **`.github/workflows/deploy-worker.yml` v0.3.0** (was v0.2.2, 2026-07-21). v0.2.2 ran ONE of
  twenty test files (`worker/test/scheduler.test.mjs`) and deployed unconditionally. It was green
  for 31 consecutive runs while covering 5% of the suite, and run #31 deployed v0.32.0 against a
  24-migration schema. Library §2 failure class 3: a guard narrower than the thing it guards is
  worse than no guard, because it reports clean. Now: `node --check` on all 31 modules → full
  suite via `node --test test/*.mjs` → fail-closed pre-deploy schema gate → deploy → cache-busted
  post-deploy version parity against `/api/health`, six attempts.
- **`worker/scripts/schema-gate.mjs` v1.0** — NEW. Refuses to deploy when `db/migrations/` carries
  a migration D1 has not applied. Fails closed on an unreadable D1, a missing `--applied`, an
  empty directory, or any filename it cannot parse.
- **`worker/test/schema_gate.test.mjs` v1.0** — NEW. 16 tests. Suite 340 → **356, 0 fail**.
- **`db/migrations/0025_guardian_invite.sql`** — STATUS flipped to `APPLIED 2026-07-27 16:41:27
  UTC`. A stale NOT-YET-APPLIED on an applied migration is a double-application hazard; 0021
  carried a wrong one for five releases.
- **`db/migrations/2026-07-27_rollback-0025_v1_0.sql`** — restored to its correct path. Captured
  live from `sqlite_master` before the DROP, so it is the real prior definition.
- **This CHANGELOG** — restored from `f5193cc` (700 lines) with these entries appended at the END
  per standing rule 6.

**A bug caught by its own test suite before it ever ran in CI.** The gate's first filename parser
used `/^(\d{4})[-_]/` for the bare `0025_name.sql` convention. That regex matches the *year* of
`2026-07-27_rollback-0025_v1_0.sql` and returns 2026. Since the rollback SQL legitimately lives in
`db/migrations/`, the gate would have computed a repo maximum of 2026, compared it against 25, and
blocked every deploy permanently — failing closed, safely, and for entirely the wrong reason.
Rollbacks are now a recognised-and-skipped category; genuinely unrecognised filenames still block.

**Prerequisite, or the next run fails at the D1 read.** `CLOUDFLARE_API_TOKEN` must carry
**Account → D1 → Read** alongside Workers Scripts:Edit, and **`CLOUDFLARE_ACCOUNT_ID`** must be
set as a repository secret. The gate fails closed by design. Widen the token; do not remove the
gate.

## v0.33.0 — 2026-07-27 — Design tokens: four phantom tokens defined (F-23)

- **`web/assets/tokens.css` v0.3.0** (was v0.2.1). **Four tokens were referenced 126 times across
  23 files and defined zero times:** `--text-dim` (61 uses), `--surface-2` (32), `--warn` (19),
  `--warning` (14). **36 of those declarations were being silently dropped** — a `var()` with no
  fallback naming an undefined property is invalid at computed-value time, so the whole
  declaration is discarded. The 23 no-fallback `--text-dim` uses rendered secondary text at full
  `--text` emphasis: a flat-hierarchy defect on 23 sites, not a colour nit. Where a hardcoded
  fallback existed it was a dark-theme value, so those sites stopped theming and stayed dark in
  light mode. `var(--warn, #E8B54A)` *reported* as tokenised and *behaved* as hardcoded — failure
  class 3 again, in CSS.
- **No new hue.** `--surface-2` and `--warn` were already shipping as inline fallbacks;
  `--warning` and `--text-dim` are pure aliases of tokens that already existed.
- **Contrast computed, not assumed.** Light `--warn` is `#8F6200`, not the previously shipped
  `#9A6A00`: that value measures 4.41:1 on `--surface` and 4.08:1 on `--surface-2` and **failed
  WCAG AA on the two surfaces warn chips actually sit on.** `#8F6200` is the smallest change that
  clears 4.5:1 on all three light surfaces (5.36 / 5.00 / 4.62). Dark `#E8B54A` is unchanged at
  10.43:1. The four hardcoded `#A8A49A` `--text-dim` uses measured 3.25:1 on light `--bg`.
- **No migration and no markup edits.** Defining the tokens fixes all 126 call sites, including
  the 36 that were being dropped. The now-redundant inline fallbacks are harmless; removing them
  is optional cleanup, deliberately deferred so this diff stays one file.
- **Not changed:** the focus-ring conflict (F-24). `docs/2026-07-21_design-handoff_v0.1.md`
  specifies 2px `--accent` at 2px offset on any focusable; tokens.css v0.2.1 sets form controls to
  `--primary` at 1px. Invisible in dark, divergent in light. Needs an owner decision rather than a
  guess.
