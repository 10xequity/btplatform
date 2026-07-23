/* Boomtown Platform — Leagues
   File: web/assets/leagues.js · Version: v1.0 · Date: 2026-07-23 · Ships in: v0.6.0
   Shows events of type 'league' from GET /api/schedule (public view), grouped into
   In progress / Upcoming / Recent. Register links go to register.html?event=ID.
   Season standings + weekly sub-finder land with Phase 2 (league_weeks); this page is
   their home when they do. */

(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const body = document.getElementById("lgBody");
  const orgFilter = document.getElementById("orgFilter");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let all = [];

  load();
  async function load() {
    try {
      const resp = await fetch(API + "/api/schedule?view=public");
      const data = await resp.json();
      all = (data.events || []).filter(e => e.type === "league");
      const orgs = [...new Map(all.map(e => [e.org_id, e.org_name])).entries()];
      orgFilter.innerHTML = '<option value="">All orgs</option>' +
        orgs.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join("");
      orgFilter.onchange = paint;
      paint();
    } catch (e) {
      body.innerHTML = `<div class="empty">Can't reach the server right now. Check your connection and refresh.</div>`;
    }
  }

  function paint() {
    const org = orgFilter.value;
    const list = all.filter(e => !org || String(e.org_id) === org);
    if (!list.length) {
      body.innerHTML = `<div class="empty">No leagues on the calendar yet. New seasons are announced on the
        <a href="schedule.html">schedule</a> and on Instagram &#8212; check back soon.</div>`;
      return;
    }
    const now = new Date();
    const groups = { "In progress": [], "Upcoming": [], "Recent": [] };
    list.forEach(e => {
      const s = e.starts_at ? new Date(String(e.starts_at).replace(" ", "T")) : null;
      const f = e.ends_at ? new Date(String(e.ends_at).replace(" ", "T")) : s;
      if (e.status === "in_progress" || (s && f && s <= now && now <= f)) groups["In progress"].push(e);
      else if (!s || s > now) groups["Upcoming"].push(e);
      else groups["Recent"].push(e);
    });
    groups["Recent"].reverse();
    body.innerHTML = Object.entries(groups).filter(([, v]) => v.length).map(([label, evs]) => `
      <h2 style="font-size:16px;margin:18px 0 8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">${label}</h2>
      ${evs.map(row).join("")}`).join("");
  }

  function row(e) {
    const d = e.starts_at ? new Date(String(e.starts_at).replace(" ", "T")) : null;
    const open = e.status === "published" && (!d || d > new Date());
    const price = e.price_cents ? "$" + (e.price_cents / 100).toFixed(2).replace(/\.00$/, "") : "";
    return `<div class="lg-ev">
      <div class="lg-date" aria-hidden="true">
        <div class="d">${d ? d.getDate() : "&#8212;"}</div>
        <div class="m">${d ? d.toLocaleString("en-US", { month: "short" }) : ""}</div>
      </div>
      <div class="lg-body">
        <div class="lg-name">${esc(e.name)}</div>
        <div class="lg-meta">${esc(e.org_name || "")}${e.location ? " \u00b7 " + esc(e.location) : ""}${price ? " \u00b7 " + price : ""}${e.registered_count != null ? " \u00b7 " + e.registered_count + " registered" : ""}</div>
      </div>
      <div class="lg-cta">${open
        ? `<a class="btn" href="register.html?event=${e.id}" style="text-decoration:none">Register</a>`
        : `<span class="lg-meta">${e.status === "in_progress" ? "In progress" : "Closed"}</span>`}</div>
    </div>`;
  }
})();
