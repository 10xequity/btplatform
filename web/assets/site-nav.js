/* Boomtown Platform — Site-wide sidebar navigation (shared)
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
   File: web/assets/site-nav.js · Version: v2.13 · Date: 2026-08-02 · Ships in: v0.53.0
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
  if (new URLSearchParams(location.search).get("embed") === "1") return;

  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const here = location.pathname.split("/").pop() || "index.html";
  const token = sessionStorage.getItem("bt_token");

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
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("bt_theme", next); } catch (e) {}
      const lbl = document.getElementById("themeNow"); /* settings.html label, if present */
      if (lbl) lbl.textContent = next === "dark" ? "Dark (black & gold)" : "Light (white & navy)";
    });
    const lo = document.getElementById("logoutBtn");
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
          const orgId = Number(localStorage.getItem("bt_org")) || null;
          const r = (me.roles || []).find(x => !orgId || x.org_id === orgId) || (me.roles || [])[0];
          role = r ? r.role : "member";
        }
      } catch (e) { /* offline: render public nav */ }
    }

    const NAV = [
      { label: "Explore", items: [
        { href: "index.html",    ico: "⌂", text: "Home" },
        { href: "schedule.html", ico: "▣", text: "Schedule" },
        { href: "leagues.html",  ico: "◇", text: "Leagues" },
        { href: "lfg.html",      ico: "◆", text: "Community Play" },
        { href: "library.html",  ico: "◎", text: "Player Library" },
        { href: "help.html",     ico: "?", text: "Help & FAQ" },
      ]},
    ];
    if (signedIn) {
      let unread = 0, inboxUnread = 0;
      try {
        const n = await fetch(API + "/api/notifications", { headers: authHeaders(), credentials: "include" });
        if (n.ok) unread = (await n.json()).unread || 0;
      } catch (e) { /* worker older than v0.9.1 or offline: no badge */ }
      try {
        const iu = await fetch(API + "/api/messages/unread-count", { headers: authHeaders(), credentials: "include" });
        if (iu.ok) inboxUnread = (await iu.json()).unread || 0;
      } catch (e) { /* worker older than v0.17.0 or offline: no badge */ }
      /* v2.13: FILL the static ✉ (badge + aria) — data fill only; the element ships in
         static markup on all 13 canonical member pages (admin v0.52.0 inversion). */
      (function headerMailFill() {
        const a = document.getElementById("btHdrMail");
        if (!a) return;
        a.setAttribute("aria-label", inboxUnread ? "Messages — " + inboxUnread + " unread" : "Messages");
        if (inboxUnread) {
          a.style.position = "relative";
          a.insertAdjacentHTML("beforeend", `<span class="badge" style="position:absolute;top:2px;right:2px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--accent);color:var(--gold-ink);font-size:11px;font-weight:800;display:grid;place-items:center">${inboxUnread > 9 ? "9+" : inboxUnread}</span>`);
        }
      })();
      /* v2.13: reveal Sign out for any signed-in member (button ships hidden, static). */
      (function logoutReveal() {
        const lo = document.getElementById("logoutBtn");
        if (lo && document.getElementById("btHdrMail")) lo.hidden = false;
      })();
      NAV.push({ label: "You", items: [
        { href: "home.html",     ico: "▦", text: "My Dashboard" },
        { href: "home.html#notifications", ico: "◔", text: "Notifications", badge: unread },
        { href: "member-inbox.html", ico: "✉", text: "Inbox", badge: inboxUnread },
        { href: "profile.html",  ico: "◉", text: "My Profile" },
        { href: "membership.html", ico: "★", text: "Membership" },
        { href: "settings.html", ico: "⚙", text: "Settings" },
      ]});
      const demoMember = sessionStorage.getItem("bt_demo_member") === "1";
      /* v2.11: header Admin switch — players who are also staff jump back to the Control
         Center from any member page. Presentation-only gating (v2.2 rule): the admin shell's
         own guard() + server requireStaff remain the enforcement. */
      if (role === "admin" || role === "staff") (function headerAdminReveal() {
        /* v2.13: the Admin link ships static-but-hidden on all 13 canonical member pages
           (owner call 2026-08-02: frame-one markup for everyone, one reveal for staff).
           Presentation-only gating unchanged (v2.2 rule): guard() + requireStaff enforce. */
        const a = document.getElementById("btHdrAdmin");
        if (!a) return;
        a.hidden = false;
        a.addEventListener("click", () => { try { sessionStorage.removeItem("bt_demo_member"); } catch (e) {} });
      })();
      if ((role === "admin" || role === "staff") && demoMember) {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.textContent = "Viewing as member — Exit";
        pill.setAttribute("style",
          "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:60;" +
          "min-height:44px;padding:10px 18px;border-radius:999px;border:1px solid var(--warning,#e6a23c);" +
          "background:var(--surface);color:var(--text);font:inherit;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)");
        pill.onclick = () => { sessionStorage.removeItem("bt_demo_member"); location.href = "admin.html"; };
        document.body.appendChild(pill);
      }
      if ((role === "admin" || role === "staff") && !demoMember) {
        NAV.push({ label: "Manage", items: [
          { href: "tournament.html",          ico: "◫", text: "Tournament Ops" },
          { href: "admin-events.html",        ico: "▤", text: "Events & Programs" },
          { href: "admin-registrations.html", ico: "✓", text: "Registrations" },
          { href: "admin-users.html",         ico: "◉", text: "Member Management" },
        ]});
      }
    } else {
      NAV.push({ label: "Account", items: [
        { href: "index.html#signin", ico: "→", text: "Sign in" },
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
          ${i.href.split("#")[0] === here ? 'aria-current="page"' : ""}><span class="ico" aria-hidden="true">${i.ico}</span>${i.text}${i.badge ? `<span class="badge" aria-label="${i.badge} unread">${i.badge > 9 ? "9+" : i.badge}</span>` : ""}</a>`).join("")}
      </div>`).join("");
    layout.appendChild(aside);
    layout.appendChild(main);
    applyOrgBrand(aside); // v2.12 — async; rail paints with the default first (fail-closed)
  }

  /* v2.12: org-brand rail card. Cache ~5 min per org; fail closed to the default. */
  async function applyOrgBrand(aside) {
    const org = localStorage.getItem("bt_org");
    if (!org || !API || API.includes("PENDING")) return;
    const KEY = "bt_org_brand:" + org;
    let brand = null;
    try {
      const cached = JSON.parse(localStorage.getItem(KEY) || "null");
      if (cached && (Date.now() - cached.at) < 5 * 60 * 1000) brand = cached.v;
    } catch (e) { /* bad cache = no cache */ }
    if (!brand) {
      try {
        const r = await fetch(API + "/api/public/org-brand?org=" + encodeURIComponent(org));
        if (!r.ok) return; // fail closed — default brand stays
        brand = await r.json();
        localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), v: brand }));
      } catch (e) { return; } // offline = default brand stays
    }
    if (!brand || !brand.display_name) return;
    const nameEl = aside.querySelector(".nav-brand-name");
    if (nameEl) nameEl.textContent = brand.display_name;
    const img = aside.querySelector(".nav-brand img");
    if (img && brand.logo_url) {
      img.onerror = () => { img.src = "assets/logo-boom-icon-512.png"; }; // fail closed on 404
      img.src = brand.logo_url;
    }
  }

  function authHeaders() {
    const h = { "content-type": "application/json" };
    if (token) h["Authorization"] = "Bearer " + token;
    const org = localStorage.getItem("bt_org");
    if (org) h["X-Org-Id"] = org;
    return h;
  }

  /* ---------- v2.5: PWA bootstrap (manifest + apple meta + service worker) ---------- */
  (function pwaBootstrap() {
    try {
      const head = document.head;
      if (!document.querySelector('link[rel="manifest"]')) {
        const l = document.createElement("link"); l.rel = "manifest"; l.href = "manifest.webmanifest"; head.appendChild(l);
      }
      if (!document.querySelector('meta[name="theme-color"]')) {
        const t = document.createElement("meta"); t.name = "theme-color"; t.content = "#0B0B0D"; head.appendChild(t);
      }
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
      s.src = "assets/build-status.js?v=0.53.0";
      s.async = false;
      document.head.appendChild(s);
    } catch (e) { /* indicators are never load-blocking */ }
  })();
})();
