/* Boomtown Platform — Admin sidebar (shared)
   Version: v0.6.0 · Date: 2026-07-23 (adds Home, Leagues, Settings)
   Include AFTER the <div class="admin-layout"> exists. Injects the sidebar,
   marks the current page active, and provides window.BT_ADMIN helpers
   (api(), guard(), esc(), money(), modal helpers) used by all admin pages. */

(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const NAV = [
    { label: "Operations", items: [
      { href: "admin.html",               ico: "▦", text: "Dashboard" },
      { href: "admin-events.html",        ico: "▤", text: "Events & Programs" },
      { href: "admin-registrations.html", ico: "✓", text: "Registrations" },
      { href: "tournament.html",          ico: "◫", text: "Tournament Ops" },
    ]},
    { label: "People", items: [
      { href: "admin-users.html",         ico: "◉", text: "Members" },
      { href: "admin-users.html#roles",   ico: "⚿", text: "Admins & Roles" },
      { href: "settings.html",            ico: "⚙", text: "Settings" },
    ]},
    { label: "Public", items: [
      { href: "index.html",               ico: "⌂", text: "Home" },
      { href: "schedule.html",            ico: "▣", text: "Schedule Page" },
      { href: "leagues.html",             ico: "◇", text: "Leagues Page" },
      { href: "admin-events.html#views",  ico: "◨", text: "Views & Embed" },
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
          <a class="nav-item${i.href.split("#")[0] === here && (i.href.includes("#") ? location.hash === "#" + i.href.split("#")[1] : !location.hash || !NAV.flat().length) ? " active" : ""}"
             href="${i.href}"><span class="ico" aria-hidden="true">${i.ico}</span>${i.text}</a>`).join("")}
      </nav>`).join("");
    layout.prepend(aside);
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
