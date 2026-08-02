/* Boomtown Platform — Public Member Profile
   File: web/member.js · Version: v1.0 · Date: 2026-07-22 · Ships in: v0.5.0
   Renders /api/public/profile — visibility-gated by the server; never shows contact info. */
(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const app = document.getElementById("app");
  const savedTheme = localStorage.getItem("bt_theme");
  const systemLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme = savedTheme || (systemLight ? "light" : "dark");

  const contactId = Number(new URLSearchParams(location.search).get("contact_id"));
  if (!contactId) return notFound();

  const headers = { "content-type": "application/json" };
  const bearer = sessionStorage.getItem("bt_token");
  if (bearer) headers["Authorization"] = "Bearer " + bearer;
  const org = localStorage.getItem("bt_org");
  if (org) headers["X-Org-Id"] = org;

  fetch(API + "/api/public/profile?contact_id=" + contactId, { headers, credentials: "include" })
    .then((r) => r.ok ? r.json() : Promise.reject())
    .then(render)
    .catch(notFound);

  function render(p) {
    const name = p.contact.display_name;
    const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    const t = p.totals;
    app.innerHTML = `
      <div class="card">
        <div class="profile-head">
          ${p.avatar_url
            ? `<img class="avatar" src="${API + p.avatar_url}" alt="${esc(name)}" />`
            : `<div class="avatar" aria-hidden="true">${esc(initials)}</div>`}
          <div>
            <h1 style="margin:0;font-size:24px">${esc(name)}</h1>
            ${p.instagram_handle ? `<a class="ig-chip" href="https://instagram.com/${encodeURIComponent(p.instagram_handle)}" target="_blank" rel="noopener">@${esc(p.instagram_handle)}</a>` : ""}
          </div>
        </div>
        ${p.bio ? `<p style="margin:14px 0 0">${esc(p.bio)}</p>` : ""}
      </div>
      ${p.results ? `
      <div class="card" style="margin-top:16px">
        <h2 style="font-size:22px;margin:0 0 8px">Results</h2>
        ${p.results.length
          ? `<p class="meta">${t.events} event${t.events === 1 ? "" : "s"} · ${t.wins}–${t.losses}${t.best_finish ? " · best finish " + ordinal(t.best_finish) : ""}</p>` +
            p.results.map((x) => `
              <div class="results-row">
                <div><strong>${esc(x.name)}</strong><div class="meta">${fmtDate(x.starts_at)}</div></div>
                <div class="meta">${x.rank ? ordinal(x.rank) + " of " + x.teams_in_event : ""}</div>
                <div>${x.wins}–${x.losses}</div>
              </div>`).join("")
          : "<p class='meta'>No results yet.</p>"}
      </div>` : ""}`;
    document.title = name + " — Boomtown Athletics";
  }

  function notFound() {
    app.innerHTML = "<div class='card'><h1 style='margin-top:0'>Profile not available</h1><p class='meta'>This profile doesn't exist or isn't shared. If it's yours, sign in on <a href='profile.html'>your profile page</a>.</p></div>";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s.replace(" ", "T"));
    return isNaN(d) ? s : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
})();
