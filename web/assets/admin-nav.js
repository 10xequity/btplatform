/* Boomtown Platform — Admin sidebar (shared)
   Version: v2.23 · Date: 2026-08-16 · Ships in: v0.160.0
   v2.23 (§-1j T2-15 / W1): the ◐ toggle's body delegates the flip to the theme service
   (config.js's BT_THEME — the one theme-state writer, both shells; the call literal appears
   ONLY in code so header_shell's verdict cannot be satisfied by this comment — D-33's class),
   and an "Appearance" button is JS-injected beside it
   opening the shared template picker in the existing modal — W1 places templates behind a NAMED
   row, out of the high-frequency toggle's way, and injection keeps 38 static admin headers
   untouched. The listener stays single-bound (the v0.52.0 rule).
   v2.22: ORG HONESTY (roadmap §-1 Block B, audit R1 — the root cause of most of the tester round).
   B1: the switcher offers ONLY orgs where /api/me reports an admin/staff role; the old block
   populated straight from /api/orgs and offered an org the owner had no role in, and one click
   there 403'd the whole admin surface. B2: once the role-filtered list resolves, the header
   wordmark names the ACTIVE org (post-paint text swap, same model as brandLogo's image swap —
   static markup unchanged, so header_shell's byte-identity holds). SELF-HEAL: a stored bt_org
   outside the role list resets to the first role org and reloads once — sticky localStorage
   poison is what turned one stray click into "almost every module is broken". B3/B4 helpers:
   orgEmptyState() renders "No X in <org> yet" with one-tap switch buttons (+ Generate test data
   on org 1, where the seeder writes) instead of a blank board; loadFail() renders a 403 as
   "you don't have access to <org>" instead of blaming the module. B5 (localStorage vs session
   scope) is an owner decision — deliberately not changed here.
   v2.21: the Test data modal no longer greys out Generate when a seed exists. `generate` clears and
   reseeds as of sandbox.js v2.1, so a stale seed is something to replace, not a dead end — the
   button reads "Regenerate test data" and recovery is ONE tap instead of Wipe-then-Generate plus a
   confirm (owner requirement #19, click minimisation).
   v2.20 (v0.56.0): the ✉ badge, unparked. v2.17 shipped the icon with "No badge yet: there is
   no admin unread-count endpoint (queued follow-up)" — GET /api/admin/messages/flags/count now
   exists (staff-only, org-scoped, counting through the SAME predicate as the queue itself so a
   badge can never disagree with the list it points at). mailBadgeFill() mirrors site-nav.js
   v2.14 exactly rather than inventing a second badge: DOM APIs only, idempotent, silent on
   failure. Fill only — #btHdrMail is static markup (v2.19 inversion).
   v2.19 (v0.52.0): STATIC HEADER (uiux-review §6 step 4). The header icons this file used to
   inject (#btHdrMail v2.17, the .brand-logo img v2.4/v2.15) are now static markup on every
   admin page — injection deleted; brandLogo() keeps ONLY the per-org cache-refresh/swap on
   the static img. NEW single-source header behaviors: orgSwitcher population + change
   handling (was duplicated across 12 page scripts; body[data-org-switch-href] overrides the
   reload target for detail pages) and the #themeToggle listener (pre-paint theme is applied
   by the shared inline <head> snippet; this file only handles the toggle).
   v2.18 (v0.51.0): Announcements nav item (mkt group) · pre-paint collapse state moved to the
   shared inline <head> snippet reading the bt_nav cookie (uiux-review §4) — the toggle now
   writes the cookie and retires the legacy localStorage key; no post-paint read remains here.
   v2.17 (v0.48.0): header mail icon (owner 2026-08-02) — every admin page header gets a ✉
   button linking admin-messages.html (the message-report review queue), placed before the
   theme toggle when the page has one, else appended. No badge yet: there is no admin
   unread-count endpoint (queued follow-up). Injected here, single source.
   v2.16 (v0.47.0): STATIC RAIL (uiux-review §3A). Every admin page now ships the rail
   markup in its static HTML (`<aside class="sidebar" data-static="rail">`), so the rail
   paints with the page — no more build-after-paint pop ("reloads every time"). This file
   detects the static rail and only WIRES it (group collapse state + listeners, sandbox
   actions, edge handle, active marking); the JS builder remains solely as a fallback for
   pages without static markup (the rail_static guard asserts the repo has none). Edge
   handle position is bound to the rail width var --bt-rail-w (admin.css v0.6.0, rail
   216px) — the fixed left:219px magic number is gone (uiux-review §2).
   v2.15 (v0.46.0): per-org header logo — renders orgs.logo_url from a localStorage cache
   (instant paint), refreshes from /api/admin/org/profile in the background, falls back to
   the boom icon. The Athletics wordmark PNG is retired from the header.
   v2.13: "Help & FAQ" (admin-faq.html) added to the People group after Documents
   v2.14 (v0.42.0): "Text Messages" (admin-sms.html) added after Marketing & Email
   (v0.40.0, owner req #21 phase 1) — write/publish the public help articles.
   v2.12: Media consent (admin-consent.html) added under People (v0.25.0) — where a
   written media-release opt-out gets recorded. No self-serve equivalent, by design.
   v2.11: Build-status indicators (v0.24.0) — loads assets/build-status.js, which stamps a
   small BETA / WIP chip on any rail item whose module is not finished and puts a one-line
   banner at the top of that page. Adds "Build status" to the Sandbox group. The registry
   lives in build-status.js; nothing in this file needs editing when a status changes.
   v2.6: M14 Phase B — "Message Reports" (admin-messages.html) under Marketing: the review
   queue for member-reported relay messages (content_flags).
   v2.10: Waivers (admin-waivers.html) added under People (v0.22.0) — publish waiver
   versions; every signature pins the version it was shown.
   v2.8: Waitlists (admin-waitlists.html) added after Registrations (v0.19.0).
   v3.0: Files (admin-uploads.html) added to the People group beside Settings — the generic
   upload library is an org-level utility, and Settings is where those already live (v0.30.0).
   v2.7: Point of Sale (admin-pos.html) added to the Money group (M15).
   v2.5: Marketing group (Marketing & Email → admin-marketing.html) between Money and People.
   v2.4 (shipped in v0.15.0): (1) MEMBER-VIEW ISOLATION — guard() now checks the caller's ROLE, not just the
   session: signed-in members with no admin/staff role on any org are bounced to home.html
   before any admin UI renders. The gate also auto-runs on script load, covering admin pages
   that never call guard() themselves (tournament.html, admin-registrations.html). Server
   APIs already 403 non-staff (requireStaff) — this closes the UI shell too. /api/me is
   memoized so the auto-run + a page's own guard() call cost one fetch.
   (2) UX-06 — brand logo (assets/logo-boom-wordmark.png) injected into the header wordmark
   on every admin page; decorative (alt=""), text wordmark remains for assistive tech;
   on logo 404 the text wordmark renders exactly as before.
   v2.3: Ships in v0.14.0 (adds Security & Recovery under People)
   v0.11.0: collapse handle moved to the rail's side edge (owner request) · category
   groups collapse individually (chevron on the label, state remembered per group) ·
   menu reordered for daily flow (Dashboard → Events → Registrations → Check-in →
   ops tools) · SANDBOX group: "View as member" (renders the member experience without
   logging out; Exit pill returns here) + "Test data" modal (generate / wipe the
   TEST 90000+ set via /api/admin/testdata) · BT_ADMIN.fail() — standard error box
   with Back + Dashboard so no page dead-ends.
   v0.7.0 (owner spec): regrouped so every manager function is easy to find
   (Run events / Money / People / Member site) · inline SVG icons that describe
   each destination · collapse-to-icons toggle (persisted, bigger working area) ·
   "← Back" (previous page via history, not just home) · League Manager +
   Sales & Reports links. The rail stays pinned left with identical spacing on
   every admin page; only the content area changes.
   Include AFTER the <div class="admin-layout"> exists. Provides window.BT_ADMIN
   helpers (api(), guard(), esc(), money(), modal helpers) used by all admin pages.
   v2.9: PWA bootstrap — injects manifest/apple meta + registers sw.js on every admin page (v0.20.0).
*/

(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";

  /* ---------- module registry (v0.128.0, roadmap §-1l P-1) ----------
     THE ONE SOURCE. The org-settings screen renders its checkboxes from this same object
     (window.BT_MODULES — every admin page loads this file, so it is always there first), and the
     server deliberately keeps NO copy: it stores an opaque slug list, and only this registry says
     what a slug means. Two consumers, one list, zero drift (D-22's lesson at design time).

     WHAT MAY NEVER APPEAR HERE, and org_modules.test.mjs enforces it: admin.html (the front
     door), admin-org-settings.html (the switch that turns modules back on — hiding it is a
     lockout), settings.html, admin-security.html, admin-users.html (members are the substrate of
     everything), admin-events.html (every league and tournament is created there). Hiding is a
     VIEW decision; every route stays gated exactly as before.

     A page may belong to TWO modules (the schedule editor serves leagues and tournaments alike);
     it hides only when EVERY owner is off. Keys are the contract with the database — renaming one
     orphans every org that saved it, so keys are forever even if labels change. This registry is
     also the intended substrate for per-ACCOUNT module toggles (the owner's 2026-08-10 events
     brief), which is why keys, not pages, are the stored vocabulary. */
  window.BT_MODULES = [
    { key: "registrations", label: "Registrations & Check-in", pages: ["admin-registrations.html", "admin-waitlists.html", "admin-checkin.html"] },
    { key: "tryouts",       label: "Tryouts & Squads",         pages: ["admin-tryouts.html", "admin-squads.html"] },
    { key: "facility",      label: "Facility Calendar",        pages: ["admin-facility.html"] },
    { key: "tournaments",   label: "Tournaments",              pages: ["tournament.html", "admin-brackets.html", "admin-divisions.html", "admin-pool-board.html", "admin-score-links.html", "admin-schedule-editor.html"] },
    { key: "leagues",       label: "Leagues",                  pages: ["admin-league.html", "admin-schedule-editor.html"] },
    { key: "kotc",          label: "Court Board (KOTC)",       pages: ["admin-kotc.html"] },
    { key: "reports",       label: "Sales & Reports",          pages: ["admin-reports.html"] },
    { key: "pos",           label: "Point of Sale",            pages: ["admin-pos.html"] },
    { key: "memberships",   label: "Memberships & Passes",     pages: ["admin-plans.html", "admin-tiers.html", "admin-member-fields.html", "admin-passes.html"] },
    { key: "staffpay",      label: "Staff Pay",                pages: ["admin-staff-pay.html"] },
    { key: "announcements", label: "Announcements",            pages: ["admin-announcements.html"] },
    { key: "marketing",     label: "Marketing, Email & SMS",   pages: ["admin-marketing.html", "admin-sms.html", "admin-messages.html"] },
    { key: "waivers",       label: "Waivers",                  pages: ["admin-waivers.html"] },
    { key: "library",       label: "Documents, Help & Files",  pages: ["admin-documents.html", "admin-faq.html", "admin-uploads.html"] },
  ];

  /** Pages to remove for a given off-list. Pure — the guard executes these exact bytes. A page
      with two owners survives until EVERY owner is off; unknown keys own nothing and hide
      nothing, so stale config fails open to a fuller menu, never an emptier one. */
  function pagesToHide(registry, off) {
    const offSet = new Set(Array.isArray(off) ? off : []);
    const out = [];
    for (const mod of registry) {
      if (!offSet.has(mod.key)) continue;
      for (const page of mod.pages) {
        const owners = registry.filter((m2) => m2.pages.includes(page));
        if (owners.every((m2) => offSet.has(m2.key)) && !out.includes(page)) out.push(page);
      }
    }
    return out;
  }

  /** Remove the rail links for this org's hidden modules, and any group left empty. DOM REMOVAL,
      never the hidden attribute — [hidden] loses to any author display rule and .nav-item carries
      one (the v0.119.0 overlay class, learned on eleven elements across nine pages). Removal has
      no cascade to argue with, and a reload restores everything, because this is a view filter
      over static markup, not state. */
  function applyModuleFilter(ctx) {
    const active = (ctx && ctx.orgs || []).find((o) => Number(o.id) === Number(ctx.current));
    const off = active && active.modules_off;
    if (!off || !off.length) return;
    const gone = new Set(pagesToHide(window.BT_MODULES, off));
    if (!gone.size) return;
    document.querySelectorAll(".sidebar .nav-item[href]").forEach((a) => {
      const page = (a.getAttribute("href") || "").split("#")[0];
      if (gone.has(page)) a.remove();
    });
    document.querySelectorAll(".sidebar .nav-group").forEach((g) => {
      if (!g.querySelector(".nav-item")) g.remove();
    });
  }

  /* ---------- icons (stroke=currentColor) ---------- */
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    dash:    I('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>'),
    events:  I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    regs:    I('<path d="M9 12l2 2 4-5"/><rect x="4" y="4" width="16" height="16" rx="2"/>'),
    ops:     I('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v3M16 3v3M8 11h8M8 15h5"/>'),
    league:  I('<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>'),
    sales:   I('<path d="M4 20V10M10 20V4M16 20v-8M21 20H3"/>'),
    mega:    I('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6M18 7a7 7 0 0 1 0 10"/>'),
    members: I('<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c1.2-3.4 4-4.6 6.5-4.6S14.3 16.6 15.5 20"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.6c2.8-.3 5.2 1 6 4.4"/>'),
    roles:   I('<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1.6"/>'),
    gear:    I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>'),
    home:    I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
    sched:   I('<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2"/>'),
    embed:   I('<path d="M8 8 4 12l4 4M16 8l4 4-4 4"/>'),
    door:    I('<path d="M13 3h6v18h-6"/><path d="M13 21H4V3h9"/><circle cx="10.5" cy="12" r="1.2"/>'),
    back:    I('<path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/>'),
    chevron: I('<path d="M15 6l-6 6 6 6"/>'),
    files:   I('<path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13 3v6h6"/>'),
  };

  /* v0.7.0 rail styles: collapse mode + icon sizing + back bar (layers on admin.css) */
  const extra = document.createElement("style");
  extra.textContent = `
    /* v0.52.0: .wordmark / .brand-logo moved to app.css v0.8.0 — the header is static now */
    .nav-item svg { width: 20px; height: 20px; flex: none; opacity: .8; }
    .nav-item.active svg { opacity: 1; }
    .sidebar .rail-foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); }
    .bt-collapse { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px;
      font: inherit; font-size: 15px; font-weight: 600; color: var(--text-muted);
      background: none; border: 0; border-radius: var(--radius-control); padding: 10px 12px; cursor: pointer; }
    .bt-collapse svg { width: 18px; height: 18px; transition: transform 160ms var(--ease-out); }
    html[data-nav="min"] { --bt-rail-w: 68px; }
    html[data-nav="min"] .sidebar .nav-label { visibility: hidden; height: 6px; padding: 0; }
    html[data-nav="min"] .sidebar .nav-item { justify-content: center; padding: 11px 0; }
    html[data-nav="min"] .sidebar .nav-item .txt { display: none; }
    html[data-nav="min"] .bt-collapse { justify-content: center; padding: 10px 0; }
    html[data-nav="min"] .bt-collapse svg { transform: rotate(180deg); }
    html[data-nav="min"] .bt-collapse .txt { display: none; }
    .bt-backbar-admin { margin: 0 0 12px; }
    /* v0.116.0: .bt-back rides .btn.ghost.sm; these two rules are the parts .btn cannot know —
       icon/label alignment and the icon's SIZE. A viewBox-only SVG with no width falls back to
       the replaced-element default (~300×150px), which is the owner's "back buttons too big,
       text wrapping and clipping" report rendered literally. human_chaos.test.mjs guards both. */
    .bt-back { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
    .bt-back svg { width: 16px; height: 16px; flex: none; }
    /* v0.11.0: side-edge collapse handle (fixed → immune to the rail's own scroll/clip) */
    .bt-edge { position: fixed; top: 50vh; left: calc(var(--bt-rail-w, 216px) - 13px); transform: translateY(-50%);
      width: 26px; height: 56px; display: grid; place-items: center; cursor: pointer;
      background: var(--surface); border: 1px solid var(--border); border-radius: 13px;
      color: var(--text-muted); z-index: 11; }
    .bt-edge:hover, .bt-edge:focus-visible { color: var(--text); border-color: var(--primary); }
    .bt-edge svg { width: 16px; height: 16px; transition: transform 160ms var(--ease-out); }
    html[data-nav="min"] .bt-edge svg { transform: rotate(180deg); }
    @media (max-width: 860px) { .bt-edge { display: none; } }
    /* v0.11.0: collapsible groups */
    .nav-label { display: flex; align-items: center; cursor: pointer; user-select: none; min-height: 32px; }
    .nav-label .grp-chev { margin-left: auto; width: 14px; height: 14px; opacity: .6; transition: transform 160ms var(--ease-out); }
    .nav-group.closed .grp-chev { transform: rotate(-90deg); }
    .nav-group.closed .nav-item { display: none; }
    html[data-nav="min"] .nav-group.closed .nav-item { display: flex; } /* icon mode ignores group collapse */
    /* v0.11.0: sandbox group + fail box */
    .nav-group.sandbox { border-top: 1px dashed var(--border); padding-top: 8px; }
    .nav-group.sandbox .nav-label { color: var(--warning, #e6a23c); }
    .bt-fail { border: 1px solid var(--border); border-radius: var(--radius-card);
      padding: 18px; background: var(--surface); }
    .bt-fail .bt-fail-actions { display: flex; gap: 10px; margin-top: 12px; }
    /* v2.22: org-scoped empty state (Block B3) — same visual family as .bt-fail, calmer voice:
       an empty org is a situation, not an error. Actions wrap for narrow boards. */
    .bt-empty-org { border: 1px dashed var(--border); border-radius: var(--radius-card);
      padding: 18px; background: var(--surface); }
    .bt-empty-org .bt-fail-actions { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
    @media (max-width: 860px) {
      html[data-nav="min"] .admin-layout { grid-template-columns: 1fr; }
      .sidebar .rail-foot { display: none; }
      .sidebar .nav-item .txt { display: inline; }
    }`;
  document.head.appendChild(extra);
  /* v2.18: pre-paint collapse state is applied by the shared inline <head> snippet on every
     page (bt_nav cookie) — no post-paint read here, so the rail cannot snap after paint. */
  const NAV = [
    { label: "Run events", key: "run", items: [
      { href: "admin.html",               ico: "dash",   text: "Dashboard" },
      { href: "admin-events.html",        ico: "events", text: "Events & Programs" },
      { href: "admin-registrations.html", ico: "regs",   text: "Registrations" },
      { href: "admin-waitlists.html",     ico: "regs",   text: "Waitlists" },
      { href: "admin-checkin.html",       ico: "door",   text: "Check-in" },
      { href: "admin-tryouts.html",       ico: "regs",   text: "Tryouts" },
      { href: "admin-squads.html",        ico: "members", text: "Tryout Squads" },
      { href: "admin-facility.html",      ico: "sched",  text: "Facility Calendar" },
      { href: "tournament.html",          ico: "ops",    text: "Tournament Ops" },
      { href: "admin-league.html",        ico: "league", text: "League Manager" },
      { href: "admin-schedule-editor.html", ico: "sched",  text: "Schedule Editor" },
      { href: "admin-brackets.html",       ico: "sched",  text: "Brackets" },
      { href: "admin-divisions.html",     ico: "league", text: "Divisions" },
      { href: "admin-pool-board.html",    ico: "sched",  text: "Pool Board" },
      { href: "admin-kotc.html",          ico: "sched",  text: "Court Board" },
      { href: "admin-score-links.html",   ico: "ops",    text: "Scoring Links" },
    ]},
    { label: "Money", key: "money", items: [
      { href: "admin-reports.html",       ico: "sales",  text: "Sales & Reports" },
      { href: "admin-pos.html",           ico: "sales",  text: "Point of Sale" },
      { href: "admin-plans.html",         ico: "sales",  text: "Membership Plans" },
      { href: "admin-tiers.html",          ico: "roles",  text: "Membership Levels" },
      { href: "admin-member-fields.html",    ico: "roles",  text: "Membership Fields" },
      { href: "admin-passes.html",        ico: "sales",  text: "Passes & Credits" },
      { href: "admin-staff-pay.html",        ico: "sales",  text: "Staff Pay" },
    ]},
    { label: "Marketing", key: "mkt", items: [
      { href: "admin-announcements.html", ico: "mega",   text: "Announcements" },
      { href: "admin-marketing.html",     ico: "sales",  text: "Marketing & Email" },
      { href: "admin-sms.html",           ico: "sales",  text: "Text Messages" },
      { href: "admin-messages.html",      ico: "members", text: "Message Reports" },
    ]},
    { label: "People", key: "people", items: [
      { href: "admin-users.html",         ico: "members", text: "Members" },
      { href: "admin-users.html#roles",   ico: "roles",   text: "Admins & Roles" },
      { href: "admin-security.html",      ico: "roles",   text: "Security & Recovery" },
      { href: "admin-waivers.html",       ico: "members", text: "Waivers" },
      { href: "admin-documents.html",     ico: "files",   text: "Documents" },
      { href: "admin-faq.html",           ico: "files",   text: "Help & FAQ" },
      { href: "admin-uploads.html",       ico: "files",   text: "Files" },
      { href: "admin-org-settings.html",  ico: "gear",    text: "Organization" },
      { href: "settings.html",            ico: "gear",    text: "Settings" },
    ]},
    { label: "Member site", key: "site", items: [
      { href: "index.html",               ico: "home",  text: "Home" },
      { href: "schedule.html",            ico: "sched", text: "Schedule Page" },
      { href: "live.html",                ico: "ops",   text: "Live Scoreboard" },
      { href: "leagues.html",             ico: "league", text: "Leagues Page" },
      { href: "admin-events.html#views",  ico: "embed", text: "Views & Embed" },
      { href: "admin-calendar.html",       ico: "sched", text: "Calendar Feeds" },
    ]},
  ];

  const layout = document.querySelector(".admin-layout");
  if (layout) {
    const here = location.pathname.split("/").pop() || "admin.html";
    /* v2.16 static rail (uiux-review §3A): every repo page ships the rail in static HTML —
       this branch only WIRES it. The builder below is a fallback for a page that lacks the
       static markup; the rail_static guard asserts the repo has no such page. */
    let aside = layout.querySelector('.sidebar[data-static="rail"]');
    if (!aside) {
    aside = document.createElement("aside");
    aside.className = "sidebar";
    aside.setAttribute("aria-label", "Admin sections");
    aside.innerHTML = NAV.map(g => `
      <nav class="nav-group${localStorage.getItem("bt_navgrp_" + g.key) === "closed" ? " closed" : ""}" data-key="${g.key}">
        <div class="nav-label" role="button" tabindex="0" aria-expanded="${localStorage.getItem("bt_navgrp_" + g.key) !== "closed"}">${g.label}<span class="grp-chev">${ICONS.chevron}</span></div>
        ${g.items.map(i => `
          <a class="nav-item" href="${i.href}" title="${i.text}">${ICONS[i.ico] || ""}<span class="txt">${i.text}</span></a>`).join("")}
      </nav>`).join("");
    // SANDBOX group (demo tools — visible to staff; everything it does is reversible)
    aside.insertAdjacentHTML("beforeend", `
      <nav class="nav-group sandbox" data-key="sandbox">
        <div class="nav-label" role="button" tabindex="0" aria-expanded="true">Sandbox<span class="grp-chev">${ICONS.chevron}</span></div>
        <a class="nav-item" href="#" id="btViewMember" title="View as member">${ICONS.members}<span class="txt">View as member</span></a>
        <a class="nav-item" href="#" id="btTestData" title="Test data">${ICONS.regs}<span class="txt">Test data…</span></a>
        <a class="nav-item" href="admin-buildstatus.html" title="Build status">${ICONS.ops}<span class="txt">Build status</span></a>
      </nav>`);
    // v0.11.0: collapse handle on the rail's side edge (was a bottom button)
    aside.insertAdjacentHTML("beforeend",
      `<button class="bt-edge" type="button" aria-label="Collapse or expand navigation">${ICONS.chevron}</button>`);
    layout.prepend(aside);
    }
    /* Group collapse state — static markup ships all-open; the persisted state is applied
       here (idempotent for the JS-built fallback too). Pre-paint application of collapse
       state is the queued uiux-review §6 step-3 release, not this one. */
    aside.querySelectorAll(".nav-group").forEach(g => {
      const closed = localStorage.getItem("bt_navgrp_" + g.dataset.key) === "closed";
      g.classList.toggle("closed", closed);
      const lbl = g.querySelector(".nav-label");
      if (lbl) lbl.setAttribute("aria-expanded", String(!closed));
    });
    aside.querySelector(".bt-edge").addEventListener("click", () => {
      const min = document.documentElement.dataset.nav === "min";
      if (min) delete document.documentElement.dataset.nav; else document.documentElement.dataset.nav = "min";
      document.cookie = "bt_nav=" + (min ? "" : "min") + "; path=/; max-age=31536000; SameSite=Lax";
      try { localStorage.removeItem("bt_nav_collapsed"); } catch (e) {} // retire the pre-v0.51 key
    });
    // group collapse (remembered per group; keyboard: Enter/Space)
    aside.querySelectorAll(".nav-group .nav-label").forEach(lbl => {
      const toggle = () => {
        const grp = lbl.closest(".nav-group");
        const closed = grp.classList.toggle("closed");
        lbl.setAttribute("aria-expanded", String(!closed));
        localStorage.setItem("bt_navgrp_" + grp.dataset.key, closed ? "closed" : "open");
      };
      lbl.addEventListener("click", toggle);
      lbl.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    });
    // sandbox actions
    aside.querySelector("#btViewMember").addEventListener("click", async e => {
      e.preventDefault();
      /* v0.107.0 (§-1f F-1) — the drop is now REAL, and the order here is the whole point.
         Tell the SERVER first and only navigate once it has confirmed: migration 0043 put
         acting_role on the session, so until that call returns the preview would still carry full
         admin privileges and would show 200s where a member gets 403s — which is the one thing
         this button exists to reveal. The sessionStorage flag stays because it drives the
         presentation half (the admin-page bounce and the Exit pill) that has worked since v0.15.0;
         it is no longer the mechanism, only the signal that a drop is in force.
         FAIL CLOSED: if the server call fails we do NOT navigate, because a preview that silently
         kept admin rights is worse than no preview. */
      const r = await api("/api/auth/act-as", { method: "POST", body: JSON.stringify({ role: "member" }) });
      if (!r.ok) { alert("Couldn't switch to the member view. Try again."); return; }
      sessionStorage.setItem("bt_demo_member", "1");
      location.href = "home.html";
    });
    aside.querySelector("#btTestData").addEventListener("click", async e => {
      e.preventDefault();
      const st = await api("/api/admin/testdata");
      const seeded = st.ok && st.data.seeded;
      const c = (st.ok && st.data.counts) || {};
      const back = openModal(`
        <h2 style="margin:0 0 8px">Test data <span style="font-size:12px;color:var(--warning,#e6a23c);font-weight:700">SANDBOX</span></h2>
        <p class="help-text">Sample events, teams, games, and registrations — all marked TEST, all in the 90000+ ID range, all removable with one click. Real data can't be touched.</p>
        <p style="font-size:14px">${seeded
          ? `Currently seeded: ${c.events || 0} events · ${c.teams || 0} teams · ${c.matches || 0} games · ${c.registrations || 0} registrations · ${c.contacts || 0} contacts`
          : "No test data at the moment."}</p>
        ${seeded ? `<p class="help-text">Regenerating replaces what's there with a fresh set. Use it if the sample data looks wrong or out of date — you can't get two copies.</p>` : ""}
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn" id="tdGen">${seeded ? "Regenerate test data" : "Generate test data"}</button>
          <button class="btn ghost" id="tdWipe" ${seeded ? "" : "disabled"}>Wipe test data</button>
          <button class="btn ghost" id="tdClose">Close</button>
        </div>
        <div id="tdStatus" role="status" aria-live="polite" style="margin-top:10px"></div>`);
      const say = m => { back.querySelector("#tdStatus").textContent = m || ""; };
      back.querySelector("#tdClose").onclick = closeModal;
      back.querySelector("#tdGen").onclick = async () => {
        say(seeded ? "Replacing…" : "Creating…");
        const r = await api("/api/admin/testdata/generate", { method: "POST" });
        say(r.data.message || r.data.error);
        if (r.ok) setTimeout(() => location.reload(), 1200);
      };
      back.querySelector("#tdWipe").onclick = async () => {
        if (!confirm("Wipe all TEST data (the 90000+ range)? Real data is never touched.")) return;
        say("Wiping…");
        const r = await api("/api/admin/testdata/wipe", { method: "POST" });
        say(r.data.message || r.data.error);
        if (r.ok) setTimeout(() => location.reload(), 1200);
      };
    });
    // "← Back": previous page via history (falls back to the dashboard)
    const mainEl = layout.querySelector(".admin-main");
    if (mainEl && here !== "admin.html") {
      const sameOrigin = document.referrer && document.referrer.startsWith(location.origin);
      const bar = document.createElement("div");
      bar.className = "bt-backbar-admin";
      bar.innerHTML = `<button class="btn ghost sm bt-back" type="button">${ICONS.back}<span>Back</span></button>`;
      bar.querySelector("button").addEventListener("click", () => {
        if (history.length > 1 && sameOrigin) history.back(); else location.href = "admin.html";
      });
      mainEl.prepend(bar);
    }
    /* Active marking. Page match; hash refines within a page.
       DETAIL PAGES NEED A PARENT. `admin-event.html` is one event — the page where a tournament is
       actually built — and it is deliberately not a nav destination, so an exact match finds
       nothing and the whole rail sits dark. The director's own report: "the buttons in tournaments
       are not correctly highlighted." Falling back to the section the page belongs to is what every
       other rail does, and it answers "where am I" instead of leaving it blank.
       nav_highlight.test.mjs asserts every rail-bearing page resolves to exactly one item. */
    const PARENT = {
      "admin-event.html": "admin-events.html",     // one event → Events & Programs
      "admin-manager.html": "admin-events.html",   // one event's manager hub → Events & Programs (WF-5)
      "admin-consent.html": "admin-waivers.html",  // media consent → Waivers (same family of signed agreements)
    };
    const markActive = () => {
      const items = [...aside.querySelectorAll(".nav-item")];
      let hit = false;
      items.forEach(a => {
        const [page, hash] = a.getAttribute("href").split("#");
        const match = page === here && (!hash ? !location.hash : location.hash === "#" + hash);
        a.classList.toggle("active", match);
        if (match) hit = true;
      });
      if (hit || !PARENT[here]) return;
      const parent = items.find(a => a.getAttribute("href") === PARENT[here]);
      if (parent) parent.classList.add("active");
    };
    markActive();
    window.addEventListener("hashchange", () => {
      aside.querySelectorAll(".nav-item").forEach(a => {
        const [page, hash] = a.getAttribute("href").split("#");
        a.classList.toggle("active", page === here && (!hash ? !location.hash : location.hash === "#" + hash));
      });
    });
  }

  /* ---------- shared helpers ---------- */
  const bearer = () => sessionStorage.getItem("bt_token");

  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    const t = bearer();
    if (t) headers["Authorization"] = "Bearer " + t;
    const orgId = localStorage.getItem("bt_org");
    if (orgId) headers["X-Org-Id"] = orgId;
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers, credentials: "include" }));
      // v0.26.0 — a 401 means the session is gone (30-day expiry, or revoked). Previously this
      // fell through as a generic error and buttons appeared to do nothing. Clear the dead
      // credential and send the user somewhere that can fix it.
      if (resp.status === 401 && !path.startsWith("/api/auth/")) {
        try { sessionStorage.removeItem("bt_token"); localStorage.removeItem("bt_token"); } catch (e) {}
        if (!/[?&]expired=1/.test(location.search)) {
          location.href = "index.html?expired=1&from=" + encodeURIComponent(location.pathname.split("/").pop() || "");
        }
        return { ok: false, status: 401, data: { error: "Your session expired. Sign in again." } };
      }
      const isCsv = (resp.headers.get("content-type") || "").includes("text/csv");
      return { ok: resp.ok, status: resp.status,
               data: isCsv ? await resp.text() : await resp.json().catch(() => ({})) };
    } catch (e) {
      /* v0.116.0: fetch only THROWS at the network/CORS layer — which can be OUR fault (a header,
         a cert, a dead deploy) just as easily as the user's connection. The old text blamed the
         user's wifi unconditionally and sent the one person who could report a real bug looking
         in the wrong place (the v0.115.0 CORS outage read as "check your connection" for a day). */
      return { ok: false, status: 0, data: { error: "Couldn't reach the server. It may be a problem on our side — try again in a moment; if it keeps happening, hard-refresh (Ctrl+F5) and check your connection." } };
    }
  }

  /* Redirect to sign-in if there's no session; bounce non-staff to home.html (v2.4).
     Returns /api/me payload only for admin/staff. Memoized: auto-run + page guard() = 1 fetch.

     v2.23 (v0.101.0, owner 2026-08-06) — EVERY BOUNCE USES location.replace, NEVER location.href.
     This is the mechanism behind the owner's "members page v admin page seems to switch back and
     forth and expose the admin page". `location.href` PUSHES a history entry, so a bounce leaves
     [..., admin.html, home.html] on the stack: press Back and the browser re-enters admin.html,
     repaints the ENTIRE static admin shell (admin.html ships the rail and all module names as
     markup, so it is on screen before /api/me can answer), and guard() bounces forward again.
     Back never escapes and the admin shell is re-exposed every time. `replace` overwrites the
     entry instead, so the page a user was bounced off is not somewhere Back can return to.
     The `bt_demo_member` path (View as member) is the likeliest way to hit it: while that flag is
     set every admin page bounces, so Back-to-the-Control-Center loops until the flag is cleared.
     NOT changed: line ~289's "View as member" and the two history.back() helpers — those are
     deliberate user navigations, and a user's own click SHOULD be in their history. */
  let _mePromise = null;
  async function guard() {
    // Admin pages exit member-demo mode automatically (View-as-member is presentation only).
    if (sessionStorage.getItem("bt_demo_member") === "1") { location.replace("home.html"); return null; }
    if (!bearer()) { location.replace("index.html"); return null; }
    if (!_mePromise) _mePromise = api("/api/me");
    const me = await _mePromise;
    if (!me.ok) { location.replace("index.html"); return null; }
    // v2.4 member-view isolation: staff/admin on ANY org may enter (org switcher rescopes);
    // everyone else never sees the admin shell. Server-side requireStaff still enforces per-org.
    const roles = (me.data && me.data.roles) || [];
    if (!roles.some((r) => r.role === "admin" || r.role === "staff")) {
      location.replace("home.html"); return null;
    }
    return me.data;
  }

  /* v2.20 (v0.56.0): FILL the badge on the static ✉ (#btHdrMail → the message-report queue).
     v2.17 shipped the icon with "No badge yet: there is no admin unread-count endpoint"; the
     endpoint now exists (GET /api/admin/messages/flags/count, staff-only, org-scoped).

     Deliberately mirrors site-nav.js v2.14's member fill rather than inventing a second badge:
     DOM APIs only (textContent can never be parsed as markup), idempotent (reuse-or-remove, so a
     second run cannot stack a second badge), and silent on failure — an operator whose worker is
     offline should see no badge, never a broken header. Fill only; the element is static markup. */
  async function mailBadgeFill() {
    const a = document.getElementById("btHdrMail");
    if (!a) return;
    let open = 0;
    try {
      const r = await api("/api/admin/messages/flags/count");
      if (r.ok) open = Number(r.data && r.data.open) || 0;
    } catch (e) { /* offline, or a worker older than v0.56.0: no badge, no noise */ }
    a.setAttribute("aria-label", open ? "Message reports — " + open + " waiting" : "Message reports");
    let badge = a.querySelector(".badge");
    if (open) {
      a.style.position = "relative";
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "badge";
        badge.setAttribute("style", "position:absolute;top:2px;right:2px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--accent);color:var(--gold-ink);font-size:11px;font-weight:800;display:grid;place-items:center");
        a.appendChild(badge);
      }
      badge.textContent = open > 9 ? "9+" : String(open);
    } else if (badge) {
      badge.remove();
    }
  }

  /* v0.11.0: standard dead-end recovery — render an error WITH a way back. */
  function fail(el, msg) {
    if (typeof el === "string") el = document.getElementById(el);
    if (!el) return;
    el.innerHTML = `<div class="bt-fail"><b>${esc(msg || "Something went wrong.")}</b>
      <div class="bt-fail-actions">
        <button class="btn ghost" type="button" data-act="back">← Back</button>
        <a class="btn" href="admin.html" style="text-decoration:none">Go to Dashboard</a>
        <button class="btn ghost" type="button" data-act="retry">Reload</button>
      </div></div>`;
    el.querySelector('[data-act="back"]').onclick = () =>
      (history.length > 1 && document.referrer.startsWith(location.origin)) ? history.back() : (location.href = "admin.html");
    el.querySelector('[data-act="retry"]').onclick = () => location.reload();
  }

  /* v2.22 (Block B4): an access error names the ORG and never blames the module. A 403 means
     the server said "no staff role here" — the fix is switching org, so switching is the action
     offered. Every other failure keeps the standard fail() box, with the server's own sentence
     when it sent one. */
  async function loadFail(el, r, what) {
    if (typeof el === "string") el = document.getElementById(el);
    if (!el) return;
    if (r && r.status === 403) {
      const ctx = await orgsReady;
      const id = Number(localStorage.getItem("bt_org")) || 0;
      const hit = (ctx.all || []).find((o) => Number(o.id) === id);
      const org = hit ? hit.name : "this organization";
      el.innerHTML = `<div class="bt-fail"><b>You don't have access to ${esc(org)}.</b>
        <p class="help-text" style="margin:6px 0 0">Your account has no staff role there — the ${esc(what || "page")} itself is fine. Switch to one of your organizations to keep working.</p>
        <div class="bt-fail-actions"></div></div>`;
      orgSwitchActions(el.querySelector(".bt-fail-actions"), ctx);
      return;
    }
    fail(el, (r && r.data && r.data.error) || "Couldn't load this page.");
  }

  /* v2.22 (Block B3): an EMPTY org must be distinguishable from a broken module. "No events
     yet" on a board that worked yesterday reads as breakage; this names the org, offers a
     one-tap switch to each of the caller's other orgs, and on org 1 offers Generate test data
     (the sandbox seeder writes its whole range as org 1 — offering it elsewhere would generate
     data the current view can never show; org-scoped seeding is recorded in roadmap §-1c). */
  async function orgEmptyState(el, what) {
    if (typeof el === "string") el = document.getElementById(el);
    if (!el) return;
    const ctx = await orgsReady;
    const active = (ctx.orgs || []).find((o) => Number(o.id) === Number(ctx.current));
    let orgName = "this organization";
    try { orgName = (active && active.name) || localStorage.getItem("bt_org_name") || orgName; } catch (e) {}
    el.innerHTML = `<div class="bt-empty-org"><b>No ${esc(what || "events")} in ${esc(orgName)} yet.</b>
      <p class="help-text" style="margin:6px 0 0">If you expected data here, you may be working in the wrong organization.</p>
      <div class="bt-fail-actions"></div></div>`;
    orgSwitchActions(el.querySelector(".bt-fail-actions"), ctx);
  }

  /* Shared action row for the two states above: one button per other role-org (a switch is one
     tap, owner req #19), plus Generate test data where the seed can actually land (org 1). */
  function orgSwitchActions(box, ctx) {
    if (!box) return;
    const current = Number(localStorage.getItem("bt_org")) || 0;
    (ctx.orgs || []).filter((o) => Number(o.id) !== current).forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn ghost";
      b.textContent = "Switch to " + o.name;
      b.onclick = () => {
        try { localStorage.setItem("bt_org", String(o.id)); } catch (e) {}
        const href = document.body.dataset.orgSwitchHref;
        if (href) location.href = href; else location.reload();
      };
      box.appendChild(b);
    });
    if (current === 1 && document.getElementById("btTestData")) {
      const g = document.createElement("button");
      g.type = "button";
      g.className = "btn";
      g.textContent = "Generate test data";
      g.onclick = () => document.getElementById("btTestData").click();
      box.appendChild(g);
    }
  }

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = c => c ? "$" + (c / 100).toFixed(2).replace(/\.00$/, "") : "Free";
  const fmtDT = s => {
    if (!s) return "—";
    const d = new Date(s.replace(" ", "T"));
    return isNaN(d) ? s : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  function openModal(html) {
    closeModal();
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    back.addEventListener("click", e => { if (e.target === back) closeModal(); });
    document.addEventListener("keydown", escClose);
    document.body.appendChild(back);
    const f = back.querySelector("input,select,textarea,button");
    if (f) f.focus();
    return back;
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }
  function closeModal() {
    const b = document.querySelector(".modal-back");
    if (b) b.remove();
    document.removeEventListener("keydown", escClose);
  }
  function downloadText(filename, text, mime = "text/csv") {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  /* v2.21 (v0.138.0, WF-6) — ONE CSV row spelling for every export screen.
     Quoting a cell is a judgement — comma, quote, newline, and the doubled quote Excel wants —
     and it was about to be written a third and a fourth time. Callers pass an array of cells. */
  function csvRow(cells) {
    return (cells || []).map((c) => {
      const s = c == null ? "" : String(c);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",");
  }

  /* v2.21 (v0.138.0, WF-6) — HAND A PRINTED DOCUMENT TO THE CAMPAIGN COMPOSER.
     The owner asked that anywhere there is a print, there is also email. The email half is NOT a
     new sender: marketing.js already ships event-scoped segments (W-F), campaigns, and a
     sendCampaign that is already honest about production having no mail key — and
     admin-marketing.js already accepts ?event= and opens the segment form with that event
     chosen. This hands the document across to that path, so the keyless honesty lives in ONE
     place and cannot drift. RECIPIENT DEFAULT, SAID OUT LOUD: the event's own registrants, which
     is what ?event= already selects; the operator can change the segment before sending, and
     nothing is sent by pressing this button.
     The body travels through sessionStorage, not the URL: a league schedule runs to thousands of
     characters and a URL is not a transport for a document. Same origin, same tab, and the
     composer clears the key once it has read it. */
  function emailDocument(eventId, subject, body) {
    try {
      sessionStorage.setItem("bt_print_draft", JSON.stringify({
        event: Number(eventId) || 0, subject: String(subject || ""), body: String(body || ""),
      }));
    } catch (e) { /* private mode: the composer still opens, just without the draft */ }
    location.href = "admin-marketing.html?event=" + (Number(eventId) || 0) + "&draft=1";
  }

  /* v2.4 UX-06: put the logo in the header wordmark. Decorative — text stays for AT.
     v2.5 (v0.46.0): per-org logo. Renders instantly from the localStorage cache (or the boom
     icon — the Athletics wordmark PNG is retired from the header, its baked-in text contradicted
     the pre-rename app brand), then refreshes the cache from the org profile in the
     background and swaps only on change. Paint never waits on the network. */
  /* v2.4 UX-06 · v2.5 per-org logo · v2.19 STATIC: the <img class="brand-logo"> ships in the
     page markup (fallback icon src), so the header paints complete on frame one. This block
     only (a) swaps in the cached per-org logo, (b) refreshes the cache from the org profile
     in the background and swaps ONLY on change, (c) falls back cleanly on a dead URL.
     Paint never waits on the network. */
  (function brandLogo() {
    const img = document.querySelector(".wordmark .brand-logo");
    if (!img) return;
    const FALLBACK = img.getAttribute("src"); // the static fallback icon, buster included
    const cacheKey = "bt_org_logo:" + (localStorage.getItem("bt_org") || "");
    const cached = localStorage.getItem(cacheKey);
    if (cached) img.src = cached;
    img.onerror = () => { // a dead cached URL falls back; a dead fallback removes cleanly
      if (img.src.indexOf("logo-boom-icon") === -1) { try { localStorage.removeItem(cacheKey); } catch (e) {} img.src = FALLBACK; }
      else img.remove();
    };
    api("/api/admin/org/profile").then((r) => {
      if (!r.ok) return;
      const fresh = (r.data.org && r.data.org.logo_url) || "";
      const prev = localStorage.getItem(cacheKey) || "";
      if (fresh === prev) return;
      try { fresh ? localStorage.setItem(cacheKey, fresh) : localStorage.removeItem(cacheKey); } catch (e) {}
      img.src = fresh || FALLBACK;
    }).catch(() => {});
  })();

  /* v2.19: unified org switcher — SINGLE SOURCE (uiux-review §6 step 4). Populates the static
     #orgSwitcher on every admin page, selects the persisted org, and on change persists +
     reloads. Detail pages whose URL pins a record in the OLD org declare
     <body data-org-switch-href="..."> to navigate to a safe landing instead (admin-event.html
     → admin-events.html — a reload there would 404 the event under the new org). The 12
     per-page copies of this block are deleted this release; header_shell.test.mjs guards
     against their return. Click budget unchanged: open + pick = 2 (owner req #19).
     v2.22 (Block B): the option list is the INTERSECTION of /api/orgs and the caller's
     admin/staff roles from /api/me — the server enforces per-org access (requireStaff), so an
     org outside that set can only ever produce 403s, and offering it was audit root cause R1.
     A stored bt_org outside the set self-heals to the first role org; the reload fires only
     when a poisoned value was actually replaced AND the write took (a blocked localStorage
     write must not loop the page). orgsReady lets orgEmptyState()/loadFail() reuse this fetch. */
  let _orgsResolve;
  const orgsReady = new Promise((res) => { _orgsResolve = res; });
  (function orgSwitcher() {
    const sw = document.getElementById("orgSwitcher");
    if (!sw) { _orgsResolve({ orgs: [], all: [], current: null }); return; }
    Promise.all([api("/api/orgs"), guard()]).then(([r, me]) => {
      if (!r.ok || !me) { _orgsResolve({ orgs: [], all: [], current: null }); return; }
      const all = r.data.orgs || [];
      const roleIds = new Set((me.roles || [])
        .filter((x) => x.role === "admin" || x.role === "staff")
        .map((x) => Number(x.org_id)));
      const orgs = all.filter((o) => roleIds.has(Number(o.id)));
      if (!orgs.length) { _orgsResolve({ orgs: [], all, current: null }); return; } // guard() already bounced non-staff
      const stored = Number(localStorage.getItem("bt_org")) || 0;
      let current = stored;
      if (!orgs.some((o) => Number(o.id) === current)) {
        current = Number(orgs[0].id);
        try { localStorage.setItem("bt_org", String(current)); } catch (e) {}
        if (stored && Number(localStorage.getItem("bt_org")) === current) { location.reload(); return; } // heal, then re-fetch everything this page already loaded under the poisoned org
      }
      try { if (!localStorage.getItem("bt_org")) localStorage.setItem("bt_org", String(current)); } catch (e) {} // first visit: persist so api() sends X-Org-Id (admin.js precedent)
      sw.innerHTML = orgs.map((o) => `<option value="${o.id}" ${Number(o.id) === current ? "selected" : ""}>${esc(o.name)}</option>`).join("");
      const active = orgs.find((o) => Number(o.id) === current);
      try { localStorage.setItem("bt_org_name", (active && active.name) || ""); } catch (e) {}
      if (active) orgWordmark(active.name);
      _orgsResolve({ orgs, all, current });
    }).catch(() => _orgsResolve({ orgs: [], all: [], current: null }));
    sw.addEventListener("change", () => {
      localStorage.setItem("bt_org", sw.value);
      const href = document.body.dataset.orgSwitchHref;
      if (href) location.href = href; else location.reload();
    });
  })();

  // P-1 (v0.128.0): once the role-filtered org list resolves, trim the rail to the ACTIVE org's
  // modules. Rides the fetch the switcher already made — no extra request, and a failure to
  // resolve leaves the full rail (fail open: a fuller menu, never an emptier one).
  orgsReady.then(applyModuleFilter).catch(() => {});

  /* v2.22 (Block B2): the header wordmark names the ACTIVE org. The static markup ships the
     app brand so the header paints complete on frame one; once the role-filtered list resolves,
     the text becomes the org being acted in — "which org am I in?" is answered top-left on
     every admin screen, beside that org's own logo. DOM APIs only (text can never parse as
     markup); the last word keeps the accent <span> so the two-tone wordmark survives any name. */
  function orgWordmark(name) {
    const wm = document.querySelector(".wordmark");
    if (!wm || !name) return;
    const img = wm.querySelector(".brand-logo");
    while (wm.lastChild && wm.lastChild !== img) wm.removeChild(wm.lastChild);
    const parts = String(name).trim().split(/\s+/);
    const last = parts.length > 1 ? parts.pop() : "";
    wm.appendChild(document.createTextNode(parts.join(" ") + (last ? " " : "")));
    if (last) {
      const sp = document.createElement("span");
      sp.textContent = last;
      wm.appendChild(sp);
    }
  }

  /* v2.19: theme toggle — SINGLE SOURCE. The shared inline <head> snippet applies the saved
     (or system) theme BEFORE first paint; this listener only flips + persists. Fired often →
     the swap itself is instant, no transition (emil: no animation on high-frequency actions). */
  (function themeToggle() {
    const t = document.getElementById("themeToggle");
    if (!t) return;
    t.addEventListener("click", () => {
      /* v2.23 (T2-15): the flip is BT_THEME's — mode toggles instantly, and the side you land
         on restores the template you last used there (or the plain default). */
      BT_THEME.toggleMode();
      syncThemeColor();
    });
    /* v2.23 (T2-15/W1): the Appearance entry — the template picker behind a NAMED control,
       injected so the static headers stay untouched. Shares config.js's one picker. */
    const ap = document.createElement("button");
    ap.type = "button";
    ap.id = "btAppearance";
    ap.className = "btn ghost";
    ap.textContent = "Appearance";
    t.insertAdjacentElement("afterend", ap);
    ap.addEventListener("click", () => {
      openModal(`<h3 style="margin:0 0 10px">Appearance</h3>
        <p class="tpl-hint">Four looks, plus the plain light and dark defaults. Applies on every page, on this device.</p>
        <div id="btTplPick" class="tpl-chips"></div>`);
      BT_THEME.mountPicker(document.getElementById("btTplPick"), () => syncThemeColor());
    });
  })();

  /* v2.4: the role gate runs on EVERY admin page load — including pages that never call
     guard() themselves — so members never see admin options.
     v2.20: the ✉ badge fills off the SAME resolved gate. guard() is memoized, so this costs no
     extra /api/me, and chaining it here means the count is never fetched for a visitor who is
     about to be bounced. A rejected guard leaves the header exactly as it painted. */
  guard().then((me) => { if (me) mailBadgeFill(); }).catch(() => {});

  window.BT_ADMIN = { api, guard, esc, money, fmtDT, openModal, closeModal, downloadText, csvRow, emailDocument, fail, loadFail, orgEmptyState, orgsReady };

  /* v0.59.0: keep <meta name="theme-color"> in step with the ACTIVE theme.
     It was pinned to #0B0B0D on every page, so a member in light mode saw a near-black status
     bar above a white page — and in an installed PWA that bar is the app's own title bar. The
     value is read from the --bg token rather than hardcoded a second time, so it cannot drift
     from the stylesheet. */
  function syncThemeColor() {
    try {
      const el = document.querySelector('meta[name="theme-color"]');
      if (!el) return;
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      if (bg) el.setAttribute("content", bg);
    } catch (e) { /* chrome colour is never load-blocking */ }
  }

  /* ---------- v2.9: PWA bootstrap (manifest + apple meta + service worker) ---------- */
  (function pwaBootstrap() {
    try {
      const head = document.head;
      if (!document.querySelector('link[rel="manifest"]')) {
        const l = document.createElement("link"); l.rel = "manifest"; l.href = "manifest.webmanifest"; head.appendChild(l);
      }
      if (!document.querySelector('meta[name="theme-color"]')) {
        const t = document.createElement("meta"); t.name = "theme-color"; t.content = "#0B0B0D"; head.appendChild(t);
      }
      syncThemeColor();
      if (!document.querySelector('link[rel="apple-touch-icon"]')) {
        const a = document.createElement("link"); a.rel = "apple-touch-icon"; a.href = "assets/logo-boom-icon-512.png"; head.appendChild(a);
      }
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
    } catch (e) { /* PWA extras are never load-blocking */ }
  })();
  /* ---------- v0.24.0: build-status indicators (single registry, see build-status.js) ---------- */
  (function statusBootstrap() {
    try {
      if (window.BT_STATUS || document.getElementById("bt-status-js")) return;
      var s = document.createElement("script");
      s.id = "bt-status-js";
      s.src = "assets/build-status.js?v=0.165.0";
      s.async = false;
      document.head.appendChild(s);
    } catch (e) { /* indicators are never load-blocking */ }
  })();
})();
