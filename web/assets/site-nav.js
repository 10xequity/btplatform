/* Boomtown Platform — Site-wide sidebar navigation (shared)
   v2.22 (v0.172.0, §-1r RF-12(4)/(2) + §-1c D-19/D-50, owner 2026-08-18): the member menu is
   rebuilt most-useful-first per his order — You (Home · Notifications · Inbox) · Play · Explore ·
   Account. "Home" is now the member's own home (home.html); the public card grid's one signed-in
   route is named "Explore" (his option B), ending D-19's two-homes collision. The Notifications
   item's #notifications anchor now EXISTS (home.html's feed box carries the id — D-50), and the
   signed-out Sign in item drops its dead #signin fragment. See the block comment at the NAV
   build; guards in member_nav_paint.test.mjs v1.1.
   v2.21 (v0.171.0, §-1r RF-12, owner 2026-08-18): the staff/admin header reveal is DELETED with
   the static #btHdrAdmin anchor it revealed — "There should be no admin access from this
   screen." No member surface offers a route to the admin shell any more; staff go by URL or
   bookmark. The one admin.html reference left in this file's code is the "Viewing as member —
   Exit" pill, the only way out of the preview mode (admin pages bounce back while
   bt_demo_member is set). Guards: header_actions.test.mjs v4.0.
   v2.20 (v0.162.0, §-1h M-4 / §-0 B15): the header ✉ badge pops (1→1.15→1, 160ms, WAAPI) ONLY
   when the unread count changed within the session; first sight sets the baseline silently and
   reduced motion is checked explicitly. Guarded by home_motion.test.mjs.
   v2.19 (v0.160.0, §-1j T2-15 / W1): the ◐ toggle's body delegates the flip to the theme
   service (config.js's BT_THEME — the one theme-state writer, both shells; the call literal
   appears ONLY in code so header_shell's verdict cannot be satisfied by this comment —
   D-33's class). The toggle STAYS an instant mode flip
   with a single marker-gated listener (the v0.52.0 double-bind rule is unchanged); what changed
   is that flipping now returns you to the colour template you last used on that side, and the
   settings label reads BT_THEME.describe() instead of restating the two default names.
   v2.18 (v0.143.0, §-0 B29 / §-1c D-28): the member-facing contact link resolves through the
   organization instead of a hard-coded address. applyOrgBrand now fills any [data-org-contact]
   anchor from the brand payload's admin_email, and the filler is exposed as window.btOrgContact
   for pages that render their own markup after the rail has painted (settings.js). Fail-closed
   by markup: the anchors ship href="help.html" and are only ever rewritten to a mailto: once a
   non-empty address resolves. See the block comment above btOrgContact for the TDZ note.
   v2.14 (v0.53.1, external code review 2026-08-02): two fixes from the review.
   (1) headerMailFill builds the badge with DOM APIs instead of insertAdjacentHTML and is
   IDEMPOTENT (reuses/removes an existing .badge). The v2.13 form appended unconditionally,
   so any second run would have stacked a second badge — the v2.10 injector had an
   idempotency guard and deleting the injector deleted the guard with it. The template
   literal was not reachable as XSS (the endpoint returns SELECT COUNT(*), an integer) but
   the DOM form removes the latent hazard if that endpoint ever changes shape.
   (2) #logoutBtn is revealed SYNCHRONOUSLY from the local token, not from the /api/me
   response. In v2.13 a slow or 5xx /api/me left a signed-in member with no way to sign out.
   Revealing on a stale token is the better failure: the click clears it and returns to login.
   v2.13 (v0.53.0, owner 2026-08-02): the unified static MEMBER header (admin v0.52.0
   precedent, inverted here too). The v2.10 mail and v2.11 Admin-switch INJECTORS are
   DELETED — 13 member pages now ship one canonical static header (wordmark img + Admin
   [hidden] + ✉ + ◐ + Sign out [hidden]). This file becomes the single-source BEHAVIOR
   owner: theme-toggle listener + logout (per-page copies in register.js/score.js/settings.js
   deleted — a surviving copy double-binds and kills the button, v0.52.0 failure class),
   signed-in reveal of #logoutBtn, staff/admin reveal of the static #btHdrAdmin (+ the
   bt_demo_member clear), and the ✉ unread-badge FILL on the static #btHdrMail (data fill is
   the sole post-paint mutation, the brandLogo-swap precedent). All of it is gated on the
   canonical-header marker (#btHdrMail present): index.html keeps its reduced login header
   and app.js stays that page's behavior owner. Brand text: Boomtown Athletics (D-ORG-5).
   v2.12 (v0.50.0 R3): (1) org-brand rail card — the nav-brand name/logo now resolve from
   GET /api/public/org-brand?org=<bt_org> (queued since v0.46.0 §3.2). localStorage cache
   bt_org_brand:<org> (~5 min, matching the endpoint's Cache-Control); FAIL-CLOSED to the
   default Boomtown icon/wordmark when the org is unknown, the fetch fails, or fields are
   empty — a member never sees a broken rail. (2) rail visual pass to the design guide:
   the brand card's hardcoded #000/#F2F0EA move behind tokens with the same literals as
   fallbacks (uiux-review §1 — the card is deliberately dark so gold-on-dark logos read).
   v2.15 (v0.101.0, owner 2026-08-06): the member sidebar stops advertising the admin shell.
   The "Manage" group — four admin destinations pushed into the MEMBER nav for any staff viewer —
   is deleted; the admin shell already links back to the member site, so the two offered each
   other and the owner reported the member page "switching back and forth and exposing the admin
   page". The single header #btHdrAdmin link remains the way back. Also: the role lookup no longer
   falls back to `roles[0]`, which handed a caller their role in ANOTHER org when they had none in
   the org on screen. Both are presentation-only — requireStaff re-checks userId + orgId on every
   admin route — but presentation is what was reported. Guards: header_actions.test.mjs.
   File: web/assets/site-nav.js · Version: v2.23 · Date: 2026-08-22 · Ships in: v0.180.0
   v2.23 (owner req 2026-08-22): "Sub-Finder" (subs.html) added to the signed-in Play group — the
   sub finder is its own module now (moved off leagues.html); one rail button leads to it.
   v2.11: header "Admin" switch (owner 2026-08-02) — staff/admin who are also players get a
   header button on member pages to jump back to the Control Center, next to the mail icon
   and theme toggle. Clears bt_demo_member on click (same escape as the exit pill). Role-gated
   client-side for presentation only; guard() + requireStaff remain the real gate (v2.2 rule).
   v2.10: header mail icon (owner 2026-08-02) — ✉ with live unread badge, injected (the
   “re-layout release will absorb it into static markup” note came true: v2.13 did).
   v2.9: brand — rail chip became the boom icon + brand text (the wordmark PNG carried the
   pre-rename volleyball brand, contradicting the app brand); badge ink is var(--gold-ink)
   (white-on-gold was an AA failure — contrast pass, uiux-review §1).
   v2.8: "Community Play" (lfg.html) in Explore — LFG board, v0.45.0.
   v2.7: "Help & FAQ" (help.html) in Explore (v0.40.0, owner req #21 phase 1) — public,
   works signed-out; the searchable article set lives in admin-faq.html.
   v2.6: Build-status indicators (v0.24.0) — loads assets/build-status.js, which stamps a
   small BETA / WIP chip on member-rail items that are not finished (Membership and Register
   are SANDBOX; nothing on the member side is WIP today) and shows a dismissible banner at
   the top of those pages. Registry lives in build-status.js, not here.
   v2.4: M14 Phase B — "Player Library" item (library.html) in Explore; signed-in "Inbox"
   item (member-inbox.html) with a live unread badge (GET /api/messages/unread-count,
   silent fallback on older workers). Absorbs the v2.3 brand work below.
   v2.3 (re-issued; the original v0.15.0 paste never landed): brand logo — the wordmark PNG
   (assets/logo-boom-wordmark.png) renders on a black chip at the top of the rail, links
   home; hidden in the mobile horizontal-rail mode (the header wordmark already shows).
   v2.2: View-as-member demo mode — when sessionStorage bt_demo_member=1 (set from the
   admin rail's Sandbox group) the Manage group is hidden and a fixed "Viewing as
   member — Exit" pill returns to the Control Center. Presentation only: the server
   role never changes, and admin pages bounce back to home.html while the flag is on.
   v2.1: Membership item under "You" (membership.html — plans, status, cancel).
   v2.0 (RECOVERY of the lost v0.7.0 nav): member notifications bell — signed-in
   members get "My Dashboard" and a "Notifications" item with a live unread badge
   (GET /api/notifications); both land on home.html. Everything else unchanged.
   UX pattern: persistent left rail (gymdesk-style) matching the Tournament Ops sidebar;
   collapses to a horizontal scroll bar on narrow screens (volleyballlife mobile pattern).
   Self-contained: injects its own styles (tokens only), wraps <main>/#app automatically.
   Role-aware: reads /api/me when a session exists; staff/admin see the Manage group.
   Skips itself entirely in ?embed=1 mode. Include with: <script src="assets/site-nav.js" defer></script>
   v2.5: PWA bootstrap — injects manifest/apple meta + registers sw.js on every page (v0.20.0).
*/

(function () {
  /* D-42 (v0.167.0): ONE fallback map per PAGE, not one per module. v0.166.0 gave each guarded
     file its own closure-private Map, which is coherent inside a file and incoherent across a
     page: with storage blocked, this module's write was invisible to every other module on the
     same page, so two of them disagreed about state they both read from one place (measured:
     `bt_org` and `bt_token` are touched by four guarded modules; tournament.html co-loads
     admin-nav.js, which WRITES bt_org, with this page's reader). The map hangs off `window`
     so every guarded file on the page shares one object for the page's lifetime; the
     `x || (x = new Map())` form is load-order-independent, so whichever script runs first
     creates it and the rest join it. Storage stays the source of truth whenever it works —
     the map is consulted only when a read throws or comes back empty. */
  const localMem = window.BT_MEM_FALLBACK || (window.BT_MEM_FALLBACK = new Map());
  const sessionMem = window.BT_SESSION_FALLBACK || (window.BT_SESSION_FALLBACK = new Map());
  const safeGet = (k) => { try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) {} return localMem.has(k) ? localMem.get(k) : null; };
  const safeSet = (k, v) => { localMem.set(k, v); try { localStorage.setItem(k, v); } catch (e) {} };
  const safeDel = (k) => { localMem.delete(k); try { localStorage.removeItem(k); } catch (e) {} };
  const ssGet = (k) => { try { const v = sessionStorage.getItem(k); if (v != null) return v; } catch (e) {} return sessionMem.has(k) ? sessionMem.get(k) : null; };
  const ssSet = (k, v) => { sessionMem.set(k, v); try { sessionStorage.setItem(k, v); } catch (e) {} };
  const ssDel = (k) => { sessionMem.delete(k); try { sessionStorage.removeItem(k); } catch (e) {} };
  if (new URLSearchParams(location.search).get("embed") === "1") return;

  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const here = location.pathname.split("/").pop() || "index.html";
  const token = ssGet("bt_token");

  /* ---------- styles (tokens only, per design-system v1.0) ---------- */
  const css = `
  .site-layout { display: flex; align-items: flex-start; max-width: 1240px; margin: 0 auto; }
  .site-nav { position: sticky; top: 76px; flex: none; width: 216px; padding: 20px 12px 40px;
    max-height: calc(100dvh - 76px); overflow-y: auto; }
  .site-nav .nav-label { font-size: 12px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: var(--text-muted, var(--text-dim, #A8A49A)); margin: 18px 12px 6px; }
  .site-nav .nav-group:first-child .nav-label { margin-top: 0; }
  .site-nav .nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
    min-height: 44px; border-radius: var(--radius-control, 8px); color: var(--text);
    text-decoration: none; font-size: 15px; font-weight: 600; }
  .site-nav .nav-item .ico { width: 18px; text-align: center; opacity: .8; }
  .site-nav .nav-item.active { background: var(--surface); color: var(--primary);
    box-shadow: inset 2px 0 0 0 var(--accent); }
  .site-nav .nav-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .site-nav .badge { margin-left: auto; flex: none; min-width: 20px; height: 20px; padding: 0 6px;
    border-radius: 999px; background: var(--accent); color: var(--gold-ink); font-size: 12px; font-weight: 800;
    display: grid; place-items: center; }
  .site-nav .nav-brand { display: flex; align-items: center; gap: 10px; margin: 0 4px 14px; padding: 10px 12px; border-radius: var(--radius-card, 10px);
    background: var(--brand-card-bg, #000); border: 1px solid var(--border); text-decoration: none; }
  .site-nav .nav-brand img { width: 36px; height: 36px; display: block; flex: none; }
  .site-nav .nav-brand-name { color: var(--brand-card-ink, #F2F0EA); font-weight: 700; font-size: 15px; line-height: 1.2; }
  .site-nav .nav-brand:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .site-layout > main, .site-layout > .site-content { flex: 1; min-width: 0; }
  @media (hover: hover) and (pointer: fine) { .site-nav .nav-item:hover { background: var(--surface); } }
  @media (max-width: 860px) {
    .site-layout { display: block; }
    .site-nav { position: static; width: auto; max-height: none; display: flex; gap: 4px;
      overflow-x: auto; padding: 8px 12px; border-bottom: 1px solid var(--border);
      -webkit-overflow-scrolling: touch; }
    .site-nav .nav-group { display: flex; gap: 4px; }
    .site-nav .nav-label { display: none; }
    .site-nav .nav-brand { display: none; }
    .site-nav .nav-item { white-space: nowrap; padding: 8px 12px; }
    .site-nav .nav-item.active { box-shadow: inset 0 -2px 0 0 var(--accent); }
  }`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- v2.13: single-source header behaviors (canonical static header only) ----------
     Bound SYNCHRONOUSLY so the toggle works before /api/me resolves. Marker-gated: the
     canonical member header ships #btHdrMail; index.html's reduced login header does not,
     so app.js keeps owning that page (no double-bind). */
  const canonHdr = !!document.getElementById("btHdrMail");
  if (canonHdr) {
    const tt = document.getElementById("themeToggle");
    if (tt) tt.addEventListener("click", () => {
      /* v2.19 (T2-15): the flip is BT_THEME's — mode toggles instantly, and the side you land
         on restores the template you last used there (or the plain default). */
      BT_THEME.toggleMode();
      syncThemeColor();
      const lbl = document.getElementById("themeNow"); /* settings.html label, if present */
      if (lbl) lbl.textContent = BT_THEME.describe();
    });
    const lo = document.getElementById("logoutBtn");
    /* v2.14: reveal from the LOCAL token, synchronously. Waiting on /api/me meant a slow or
       failing call left a signed-in member unable to sign out. A stale token showing the
       button is the safe direction — clicking it clears the token and lands on login. */
    if (lo && token) lo.hidden = false;
    if (lo) lo.addEventListener("click", async () => {
      try { await fetch(API + "/api/auth/logout", { method: "POST", headers: authHeaders(), credentials: "include" }); } catch (e) {}
      try { sessionStorage.removeItem("bt_token"); sessionStorage.removeItem("bt_demo_member"); } catch (e) {}
      location.href = "index.html";
    });
  }

  /* ---------- build nav after we know the role ---------- */
  init();
  async function init() {
    let role = null, signedIn = false;
    if (token && API && !API.includes("PENDING")) {
      try {
        const resp = await fetch(API + "/api/me", { headers: authHeaders(), credentials: "include" });
        if (resp.ok) {
          signedIn = true;
          const me = await resp.json();
          const orgId = Number(safeGet("bt_org")) || null;
          /* v2.15: NO `|| roles[0]` fallback. A role in ANOTHER org is not a role HERE, and the
             fallback meant someone who is a plain member in the org on screen but staff somewhere
             else was shown the Admin link for an org they hold no role in. Presentation-only —
             every /api/admin route re-checks server-side against userId + orgId (index.js
             requireStaff) — but presentation is exactly what the owner saw. No org chosen yet
             (orgId null) still takes the first role: that is "before you have picked", not
             "wrong org". */
          const r = (me.roles || []).find(x => !orgId || Number(x.org_id) === orgId);
          role = r ? r.role : "member";
        }
      } catch (e) { /* offline: render public nav */ }
    }

    /* v2.22 (§-1r RF-12(4) + RF-12(2) + D-19/D-50, owner 2026-08-18): the member menu is built
       per state, most-useful-first — his words: "Realign that menu from most useful to least
       useful. Inbox should be 2 or 3, while Home at #1, then notifications… Group things
       together that make sense."
       · HOME IS THE MEMBER'S OWN HOME (home.html — the screen titled My Dashboard), because his
         item 12 said "Dashboard should be the primary screen for members". That reading is an
         assumption recorded in roadmap §-1r; if he corrects it, his word governs.
       · The public card grid (index.html) keeps exactly ONE signed-in route, named EXPLORE —
         his option B — which also ends D-19 (two landing pages both named like home).
       · Groups follow the §-1f F-5/F-6 proposal (delivered v0.106.0, held until his order):
         You (the badge-bearing three, his order) · Play (the product; Leagues above Live scores
         because a league night is a weekly destination, live scores an event-day one) ·
         Explore (browse surfaces) · Account (convention: account last, Help with it).
       · F-5's signed-out/signed-in position stability is deliberately traded away — his
         explicit order outranks it. Signed-out keeps the public list with Home first: a
         visitor's home IS the front door.
       Guards: member_nav_paint.test.mjs v1.1 (his order · one Explore route · no duplicate
       names · the fragment contract). */
    const NAV = [];
    if (signedIn) {
      /* v2.16 (§-1c D-15) — THE BADGE FETCHES NO LONGER GATE THE RAIL.
         They used to sit here, two SERIALLY AWAITED round trips before the rail was appended at
         the bottom of this function. The rail is not in static markup on any member page, so a
         member page rendered with NO navigation column until /api/me, /api/notifications and
         /api/messages/unread-count had all returned — then inserted a whole column and displaced
         everything beside it. That is the "shift" in the owner's "menus shift and reload every
         interaction"; the "reload" half is that every rail item is an <a href>, which is the
         §-1d/§-1g C-2 frame question and NOT this change.
         The rail's STRUCTURE depends only on `role`. The counts are decoration on two items, so
         they are filled into the live DOM by fillNavBadges() AFTER the append, and fetched in
         PARALLEL rather than in series. member_nav_paint.test.mjs pins the ordering. */
      NAV.push({ label: "You", items: [
        { href: "home.html",     ico: "⌂", text: "Home" },
        { href: "home.html#notifications", ico: "◔", text: "Notifications", key: "notifications" },
        { href: "member-inbox.html", ico: "✉", text: "Inbox", key: "inbox" },
      ]});
      NAV.push({ label: "Play", items: [
        { href: "schedule.html", ico: "▣", text: "Schedule" },
        { href: "leagues.html",  ico: "◇", text: "Leagues" },
        { href: "live.html",     ico: "◉", text: "Live scores" },
        { href: "lfg.html",      ico: "◆", text: "Community Play" },
        { href: "subs.html",     ico: "◈", text: "Sub-Finder" },
      ]});
      NAV.push({ label: "Explore", items: [
        { href: "index.html",    ico: "▦", text: "Explore" },
        { href: "library.html",  ico: "◎", text: "Player Library" },
      ]});
      NAV.push({ label: "Account", items: [
        { href: "profile.html",  ico: "◉", text: "My Profile" },
        { href: "membership.html", ico: "★", text: "Membership" },
        { href: "settings.html", ico: "⚙", text: "Settings" },
        { href: "help.html",     ico: "?", text: "Help & FAQ" },
      ]});
      const demoMember = ssGet("bt_demo_member") === "1";
      /* v2.17 (§-1r RF-12, owner 2026-08-18): the v2.11/v2.13 header Admin reveal is GONE, with
         the static #btHdrAdmin anchor it revealed. His words: "There should be no admin access
         from this screen." Said honestly: the anchor granted nothing — every admin route is
         gated server-side — but an affordance the owner ordered off the surface stays off.
         Staff reach the Control Center by URL or bookmark now. The ONE admin.html reference
         below (the exit pill) is the only way OUT of the view-as-member preview: admin pages
         bounce back to home.html while bt_demo_member is set, so removing the pill would trap
         staff in the preview. header_actions.test.mjs pins both halves. */
      if ((role === "admin" || role === "staff") && demoMember) {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.textContent = "Viewing as member — Exit";
        pill.setAttribute("style",
          "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:60;" +
          "min-height:44px;padding:10px 18px;border-radius:999px;border:1px solid var(--warning,#e6a23c);" +
          "background:var(--surface);color:var(--text);font:inherit;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)");
        pill.onclick = () => exitMemberView("admin.html");
        document.body.appendChild(pill);
      }
      /* v2.15 (owner 2026-08-06): the "Manage" group is GONE from the member sidebar.
         It pushed four admin destinations (Tournament Ops, Events & Programs, Registrations,
         Member Management) into the MEMBER navigation for any staff viewer, and the admin shell
         header links back to the member site — so the two shells offered each other and the owner
         reported the member page "switching back and forth and exposing the admin page".
         (Until RF-12 the way back was the one header link; now there is none by design.)
         A second, four-item copy of the admin rail on the member site is duplication, not a
         shortcut, and it is what made the member site read as an admin surface.
         Also serves the same report's "menus need to be optimized and reviewed for brevity". */
    } else {
      NAV.push({ label: "Explore", items: [
        { href: "index.html",    ico: "⌂", text: "Home" },
        { href: "schedule.html", ico: "▣", text: "Schedule" },
        { href: "leagues.html",  ico: "◇", text: "Leagues" },
        { href: "live.html",     ico: "◉", text: "Live scores" },
        { href: "lfg.html",      ico: "◆", text: "Community Play" },
        { href: "library.html",  ico: "◎", text: "Player Library" },
        { href: "help.html",     ico: "?", text: "Help & FAQ" },
      ]});
      NAV.push({ label: "Account", items: [
        /* D-50's class: index.html has no id="signin" — the login card is JS-rendered — so the
           old #signin fragment was dead weight. The page IS the sign-in screen; link it plainly. */
        { href: "index.html",    ico: "→", text: "Sign in" },
      ]});
    }

    const main = document.querySelector("main") || document.getElementById("app");
    if (!main || document.querySelector(".site-nav")) return;
    const layout = document.createElement("div");
    layout.className = "site-layout";
    main.parentNode.insertBefore(layout, main);
    const aside = document.createElement("nav");
    aside.className = "site-nav";
    aside.setAttribute("aria-label", "Site navigation");
    aside.innerHTML = `<a class="nav-brand" href="index.html" aria-label="Boomtown Athletics home">
      <img src="assets/logo-boom-icon-512.png" alt="" width="36" height="36"><span class="nav-brand-name">Boomtown Athletics</span></a>` + NAV.map(g => `
      <div class="nav-group" role="group" aria-label="${g.label}">
        <div class="nav-label">${g.label}</div>
        ${g.items.map(i => `<a class="nav-item${i.href.split("#")[0] === here ? " active" : ""}" href="${i.href}"
          ${i.key ? `data-nav-key="${i.key}"` : ""}
          ${i.href.split("#")[0] === here ? 'aria-current="page"' : ""}><span class="ico" aria-hidden="true">${i.ico}</span>${i.text}</a>`).join("")}
      </div>`).join("");
    layout.appendChild(aside);
    layout.appendChild(main);
    applyOrgBrand(aside); // v2.12 — async; rail paints with the default first (fail-closed)
    if (signedIn) fillNavBadges(aside); // v2.16 — AFTER the append, deliberately not awaited
  }

  /* v2.16 (§-1c D-15): the unread counts, fetched in PARALLEL and written into the rail that is
     already on screen. Nothing here can delay the rail — it is called after appendChild and is
     not awaited. Both endpoints fail closed to 0, exactly as the serial version did. */
  async function fillNavBadges(aside) {
    const count = async (path) => {
      try {
        const r = await fetch(API + path, { headers: authHeaders(), credentials: "include" });
        return r.ok ? ((await r.json()).unread || 0) : 0;
      } catch (e) { return 0; } // worker older than v0.9.1/v0.17.0, or offline: no badge
    };
    const [unread, inboxUnread] = await Promise.all([
      count("/api/notifications"),
      count("/api/messages/unread-count"),
    ]);
    setNavBadge(aside && aside.querySelector('[data-nav-key="notifications"]'), unread, "unread");
    setNavBadge(aside && aside.querySelector('[data-nav-key="inbox"]'), inboxUnread, "unread");
    headerMailFill(inboxUnread);
  }

  /* DOM APIs, idempotent — the v2.14 rule. textContent can never be parsed as markup, and reusing
     or removing an existing .badge means a second run cannot stack a second one. */
  function setNavBadge(el, n, word) {
    if (!el) return;
    let badge = el.querySelector(".badge");
    if (n) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "badge";
        el.appendChild(badge);
      }
      badge.setAttribute("aria-label", n + " " + word);
      badge.textContent = n > 9 ? "9+" : String(n);
    } else if (badge) {
      badge.remove();
    }
  }

  /* v2.13: FILL the static ✉ (badge + aria) — data fill only; the element ships in static markup
     on all 13 canonical member pages (admin v0.52.0 inversion). v2.16: takes the count as an
     argument now that it runs after the rail paints rather than inside the fetch block. */
  function headerMailFill(inboxUnread) {
    const a = document.getElementById("btHdrMail");
    if (!a) return;
    a.setAttribute("aria-label", inboxUnread ? "Messages — " + inboxUnread + " unread" : "Messages");
    let badge = a.querySelector(".badge");
    if (inboxUnread) {
      a.style.position = "relative";
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "badge";
        badge.setAttribute("style", "position:absolute;top:2px;right:2px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--accent);color:var(--gold-ink);font-size:11px;font-weight:800;display:grid;place-items:center");
        a.appendChild(badge);
      }
      badge.textContent = inboxUnread > 9 ? "9+" : String(inboxUnread);
      /* v2.20 (M-4, v0.162.0): pop ONLY when the count CHANGED within this session — state
         indication, never decoration. First sight of a session sets the baseline silently, so
         an unchanged load never moves. WAAPI on the badge itself: CSS performance, no class a
         page stylesheet could restyle, and the preference check is explicit. */
      try {
        const seen = ssGet("bt_mail_seen");
        if (seen !== null && Number(seen) !== inboxUnread &&
            !matchMedia("(prefers-reduced-motion: reduce)").matches) {
          badge.animate(
            [{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }],
            { duration: 160, easing: "ease-out" });
        }
        ssSet("bt_mail_seen", String(inboxUnread));
      } catch (e) { /* private mode: no baseline, no pop */ }
    } else if (badge) {
      badge.remove();
      try { sessionStorage.setItem("bt_mail_seen", "0"); } catch (e) {}
    }
  }

  /* v2.12: org-brand rail card. Cache ~5 min per org; fail closed to the default. */
  async function applyOrgBrand(aside) {
    const org = safeGet("bt_org");
    if (!org || !API || API.includes("PENDING")) return;
    const KEY = "bt_org_brand:" + org;
    let brand = null;
    try {
      const cached = JSON.parse(safeGet(KEY) || "null");
      if (cached && (Date.now() - cached.at) < 5 * 60 * 1000) brand = cached.v;
    } catch (e) { /* bad cache = no cache */ }
    if (!brand) {
      try {
        const r = await fetch(API + "/api/public/org-brand?org=" + encodeURIComponent(org));
        if (!r.ok) return; // fail closed — default brand stays
        brand = await r.json();
        safeSet(KEY, JSON.stringify({ at: Date.now(), v: brand }));
      } catch (e) { return; } // offline = default brand stays
    }
    if (!brand) return;
    /* v2.18 (v0.143.0, §-0 B29): the contact fill runs BEFORE the display_name bail-out below.
       A brand row with a name but no logo, or an address but no name, must still fill what it
       has — the two are independent fields and bailing early on one silently dropped the other. */
    btOrgContact(brand);
    if (!brand.display_name) return;
    const nameEl = aside.querySelector(".nav-brand-name");
    if (nameEl) nameEl.textContent = brand.display_name;
    const img = aside.querySelector(".nav-brand img");
    if (img && brand.logo_url) {
      img.onerror = () => { img.src = "assets/logo-boom-icon-512.png"; }; // fail closed on 404
      img.src = brand.logo_url;
    }
  }

  /* ── v2.18 (v0.143.0) — §-0 B29 / §-1c D-28 / standards §8 F-40: the member-facing contact link.
     Five member-facing sites hard-coded admin@boomtownvb.com, so members of every organization
     that is not Boomtown were told to write to Boomtown. Every org already sets its own Contact
     email (Organization Settings → orgs.admin_email → the {{ORG_EMAIL}} token); this reads it.

     FAIL CLOSED, AND THE FALLBACK LIVES IN THE MARKUP, NOT HERE. Each contact anchor ships
     href="help.html" in source. This function only ever REPLACES that with a mailto:, and only
     once a non-empty address has resolved — so an offline member, a member with no bt_org, a 5xx
     and a null admin_email all leave a live page link rather than a dead mailto:. The link text
     is destination-agnostic ("Contact us" / "Request change"), so nothing is rewritten but the
     href and there is no post-paint copy flash.

     WHY IT IS EXPOSED ON window. The rail paints once, early. settings.js renders its "Email
     (your sign-in)" row later, from its own /api/me response — its anchor does not exist when
     the rail's pass runs, so a private fill would leave exactly one of the five sites unfilled
     forever. Idempotent and safe to call from anywhere, as many times as a page likes.

     THE REMEMBERED BRAND HANGS OFF THE FUNCTION, NOT A `let`, AND THAT IS NOT A STYLE CHOICE.
     `init()` is invoked at the top of this file, ABOVE this point. It is async, so when a token
     exists it yields at its first `await` and the rest of the module body runs before the rail
     renders — but a SIGNED-OUT visitor with a bt_org and a warm brand cache never awaits: init
     runs straight through to the render, applyOrgBrand finds the cached brand synchronously, and
     this function is called while the module body below it has not executed yet. A `let` here
     would be in the temporal dead zone on exactly that path and would throw a ReferenceError
     that no signed-in test would ever see. A function declaration is hoisted whole, so a
     property on it is always assignable. Structurally impossible beats remembered. */
  function btOrgContact(brand) {
    if (brand) btOrgContact.last = brand;
    const email = btOrgContact.last && btOrgContact.last.admin_email;
    if (!email) return; // fail closed — the markup's help.html fallback stands
    document.querySelectorAll("[data-org-contact]").forEach((a) => {
      const subject = a.getAttribute("data-org-contact-subject");
      a.setAttribute("href", "mailto:" + email + (subject ? "?subject=" + encodeURIComponent(subject) : ""));
    });
  }
  window.btOrgContact = btOrgContact;

  /* v2.17 (§-1f F-1, v0.107.0) — LEAVE "acting as a member", server side first.
     Since migration 0043 the drop is a real privilege drop on the session row, so clearing the
     sessionStorage flag alone would strand an admin in a shell where every call 403s: the way back
     would look available and do nothing. BOTH exits — the Exit pill and the header Admin link —
     route through here, because there is no such thing as a half-cleared drop.
     It navigates even if the call fails: the destination re-checks server-side and shows an honest
     error, which beats trapping someone on a member page with a button that refuses to work. */
  async function exitMemberView(dest) {
    try {
      await fetch(API + "/api/auth/act-as", {
        method: "POST", headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
        credentials: "include", body: JSON.stringify({ role: null }),
      });
    } catch (e) { /* offline: fall through — the destination will re-check and say so */ }
    try { sessionStorage.removeItem("bt_demo_member"); } catch (e) {}
    location.href = dest;
  }

  function authHeaders() {
    const h = { "content-type": "application/json" };
    if (token) h["Authorization"] = "Bearer " + token;
    const org = safeGet("bt_org");
    if (org) h["X-Org-Id"] = org;
    return h;
  }

  /* ---------- v2.5: PWA bootstrap (manifest + apple meta + service worker) ---------- */
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
      s.src = "assets/build-status.js?v=0.184.0";
      s.async = false;
      document.head.appendChild(s);
    } catch (e) { /* indicators are never load-blocking */ }
  })();
})();
