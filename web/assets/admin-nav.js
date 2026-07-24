/* Boomtown Platform — Admin sidebar (shared)
   Version: v0.8.0 · Date: 2026-07-23 (Check-in link added)
   v0.7.0 (owner spec): regrouped so every manager function is easy to find
   (Run events / Money / People / Member site) · inline SVG icons that describe
   each destination · collapse-to-icons toggle (persisted, bigger working area) ·
   "← Back" (previous page via history, not just home) · League Manager +
   Sales & Reports links. The rail stays pinned left with identical spacing on
   every admin page; only the content area changes.
   Include AFTER the <div class="admin-layout"> exists. Provides window.BT_ADMIN
   helpers (api(), guard(), esc(), money(), modal helpers) used by all admin pages. */

(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";

  /* ---------- icons (stroke=currentColor) ---------- */
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    dash:    I('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>'),
    events:  I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    regs:    I('<path d="M9 12l2 2 4-5"/><rect x="4" y="4" width="16" height="16" rx="2"/>'),
    ops:     I('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v3M16 3v3M8 11h8M8 15h5"/>'),
    league:  I('<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>'),
    sales:   I('<path d="M4 20V10M10 20V4M16 20v-8M21 20H3"/>'),
    members: I('<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c1.2-3.4 4-4.6 6.5-4.6S14.3 16.6 15.5 20"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.6c2.8-.3 5.2 1 6 4.4"/>'),
    roles:   I('<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1.6"/>'),
    gear:    I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>'),
    home:    I('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
    sched:   I('<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2"/>'),
    embed:   I('<path d="M8 8 4 12l4 4M16 8l4 4-4 4"/>'),
    door:    I('<path d="M13 3h6v18h-6"/><path d="M13 21H4V3h9"/><circle cx="10.5" cy="12" r="1.2"/>'),
    back:    I('<path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/>'),
    chevron: I('<path d="M15 6l-6 6 6 6"/>'),
  };

  /* v0.7.0 rail styles: collapse mode + icon sizing + back bar (layers on admin.css) */
  const extra = document.createElement("style");
  extra.textContent = `
    .nav-item svg { width: 20px; height: 20px; flex: none; opacity: .8; }
    .nav-item.active svg { opacity: 1; }
    .sidebar .rail-foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); }
    .bt-collapse { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px;
      font: inherit; font-size: 15px; font-weight: 600; color: var(--text-muted);
      background: none; border: 0; border-radius: var(--radius-control); padding: 10px 12px; cursor: pointer; }
    .bt-collapse svg { width: 18px; height: 18px; transition: transform 160ms var(--ease-out); }
    html[data-nav="min"] .admin-layout { grid-template-columns: 68px 1fr; }
    html[data-nav="min"] .sidebar .nav-label { visibility: hidden; height: 6px; padding: 0; }
    html[data-nav="min"] .sidebar .nav-item { justify-content: center; padding: 11px 0; }
    html[data-nav="min"] .sidebar .nav-item .txt { display: none; }
    html[data-nav="min"] .bt-collapse { justify-content: center; padding: 10px 0; }
    html[data-nav="min"] .bt-collapse svg { transform: rotate(180deg); }
    html[data-nav="min"] .bt-collapse .txt { display: none; }
    .bt-backbar-admin { margin: 0 0 12px; }
    @media (max-width: 860px) {
      html[data-nav="min"] .admin-layout { grid-template-columns: 1fr; }
      .sidebar .rail-foot { display: none; }
      .sidebar .nav-item .txt { display: inline; }
    }`;
  document.head.appendChild(extra);
  if (localStorage.getItem("bt_nav_collapsed") === "1") document.documentElement.dataset.nav = "min";
  const NAV = [
    { label: "Run events", items: [
      { href: "admin.html",               ico: "dash",   text: "Dashboard" },
      { href: "admin-events.html",        ico: "events", text: "Events & Programs" },
      { href: "tournament.html",          ico: "ops",    text: "Tournament Ops" },
      { href: "admin-league.html",        ico: "league", text: "League Manager" },
      { href: "admin-registrations.html", ico: "regs",   text: "Registrations" },
      { href: "admin-checkin.html",       ico: "door",   text: "Check-in" },
    ]},
    { label: "Money", items: [
      { href: "admin-reports.html",       ico: "sales",  text: "Sales & Reports" },
    ]},
    { label: "People", items: [
      { href: "admin-users.html",         ico: "members", text: "Members" },
      { href: "admin-users.html#roles",   ico: "roles",   text: "Admins & Roles" },
      { href: "settings.html",            ico: "gear",    text: "Settings" },
    ]},
    { label: "Member site", items: [
      { href: "index.html",               ico: "home",  text: "Home" },
      { href: "schedule.html",            ico: "sched", text: "Schedule Page" },
      { href: "leagues.html",             ico: "league", text: "Leagues Page" },
      { href: "admin-events.html#views",  ico: "embed", text: "Views & Embed" },
    ]},
  ];

  const layout = document.querySelector(".admin-layout");
  if (layout) {
    const here = location.pathname.split("/").pop() || "admin.html";
    const aside = document.createElement("aside");
    aside.className = "sidebar";
    aside.setAttribute("aria-label", "Admin sections");
    aside.innerHTML = NAV.map(g => `
      <nav class="nav-group">
        <div class="nav-label">${g.label}</div>
        ${g.items.map(i => `
          <a class="nav-item" href="${i.href}" title="${i.text}">${ICONS[i.ico] || ""}<span class="txt">${i.text}</span></a>`).join("")}
      </nav>`).join("");
    aside.insertAdjacentHTML("beforeend",
      `<div class="rail-foot"><button class="bt-collapse" type="button" aria-label="Collapse navigation">${ICONS.chevron}<span class="txt">Collapse</span></button></div>`);
    layout.prepend(aside);
    aside.querySelector(".bt-collapse").addEventListener("click", () => {
      const min = document.documentElement.dataset.nav === "min";
      if (min) delete document.documentElement.dataset.nav; else document.documentElement.dataset.nav = "min";
      localStorage.setItem("bt_nav_collapsed", min ? "0" : "1");
    });
    // "← Back": previous page via history (falls back to the dashboard)
    const mainEl = layout.querySelector(".admin-main");
    if (mainEl && here !== "admin.html") {
      const sameOrigin = document.referrer && document.referrer.startsWith(location.origin);
      const bar = document.createElement("div");
      bar.className = "bt-backbar-admin";
      bar.innerHTML = `<button class="bt-back" type="button">${ICONS.back}<span>Back</span></button>`;
      bar.querySelector("button").addEventListener("click", () => {
        if (history.length > 1 && sameOrigin) history.back(); else location.href = "admin.html";
      });
      mainEl.prepend(bar);
    }
    // Simpler, correct active marking (page match; hash refines within a page):
    aside.querySelectorAll(".nav-item").forEach(a => {
      const [page, hash] = a.getAttribute("href").split("#");
      const match = page === here && (!hash ? !location.hash : location.hash === "#" + hash);
      a.classList.toggle("active", match);
    });
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
      const isCsv = (resp.headers.get("content-type") || "").includes("text/csv");
      return { ok: resp.ok, status: resp.status,
               data: isCsv ? await resp.text() : await resp.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Check your connection and hard-refresh (Ctrl+F5)." } };
    }
  }

  /* Redirect to sign-in if there's no session; returns /api/me payload if signed in. */
  async function guard() {
    if (!bearer()) { location.href = "index.html"; return null; }
    const me = await api("/api/me");
    if (!me.ok) { location.href = "index.html"; return null; }
    return me.data;
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

  window.BT_ADMIN = { api, guard, esc, money, fmtDT, openModal, closeModal, downloadText };
})();
