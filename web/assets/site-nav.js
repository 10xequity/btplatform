/* Boomtown Platform — Site-wide sidebar navigation (shared)
   File: web/assets/site-nav.js · Version: v1.0 · Date: 2026-07-23 · Ships in: v0.6.0
   UX pattern: persistent left rail (gymdesk-style) matching the Tournament Ops sidebar;
   collapses to a horizontal scroll bar on narrow screens (volleyballlife mobile pattern).
   Self-contained: injects its own styles (tokens only), wraps <main>/#app automatically.
   Role-aware: reads /api/me when a session exists; staff/admin see the Manage group.
   Skips itself entirely in ?embed=1 mode. Include with: <script src="assets/site-nav.js" defer></script> */

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
  .site-layout > main, .site-layout > .site-content { flex: 1; min-width: 0; }
  @media (hover: hover) and (pointer: fine) { .site-nav .nav-item:hover { background: var(--surface); } }
  @media (max-width: 860px) {
    .site-layout { display: block; }
    .site-nav { position: static; width: auto; max-height: none; display: flex; gap: 4px;
      overflow-x: auto; padding: 8px 12px; border-bottom: 1px solid var(--border);
      -webkit-overflow-scrolling: touch; }
    .site-nav .nav-group { display: flex; gap: 4px; }
    .site-nav .nav-label { display: none; }
    .site-nav .nav-item { white-space: nowrap; padding: 8px 12px; }
    .site-nav .nav-item.active { box-shadow: inset 0 -2px 0 0 var(--accent); }
  }`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

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
      ]},
    ];
    if (signedIn) {
      NAV.push({ label: "You", items: [
        { href: "profile.html",  ico: "◉", text: "My Profile" },
        { href: "settings.html", ico: "⚙", text: "Settings" },
      ]});
      if (role === "admin" || role === "staff") {
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
    aside.innerHTML = NAV.map(g => `
      <div class="nav-group" role="group" aria-label="${g.label}">
        <div class="nav-label">${g.label}</div>
        ${g.items.map(i => `<a class="nav-item${i.href.split("#")[0] === here ? " active" : ""}" href="${i.href}"
          ${i.href.split("#")[0] === here ? 'aria-current="page"' : ""}><span class="ico" aria-hidden="true">${i.ico}</span>${i.text}</a>`).join("")}
      </div>`).join("");
    layout.appendChild(aside);
    layout.appendChild(main);
  }

  function authHeaders() {
    const h = { "content-type": "application/json" };
    if (token) h["Authorization"] = "Bearer " + token;
    const org = localStorage.getItem("bt_org");
    if (org) h["X-Org-Id"] = org;
    return h;
  }
})();
