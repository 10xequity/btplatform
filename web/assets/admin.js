/* Boomtown Platform — Admin Dashboard
   Version: v0.4.0 · Date: 2026-07-22 */
(async function () {
  const { api, guard, esc, money, fmtDT } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  // Org switcher (shared pattern: value persists in localStorage, pages read X-Org-Id)
  const sw = document.getElementById("orgSwitcher");
  const orgs = (await api("/api/orgs")).data.orgs || [];
  const current = Number(localStorage.getItem("bt_org")) || (orgs[0] && orgs[0].id) || 1;
  sw.innerHTML = orgs.map(o => `<option value="${o.id}" ${o.id === current ? "selected" : ""}>${esc(o.name)}</option>`).join("");
  localStorage.setItem("bt_org", String(current));
  sw.addEventListener("change", () => { localStorage.setItem("bt_org", sw.value); location.reload(); });

  const events = (await api("/api/events")).data.events || [];
  const now = new Date();
  const upcoming = events.filter(e => e.starts_at && new Date(e.starts_at.replace(" ", "T")) >= now && e.status !== "cancelled")
                         .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const drafts = events.filter(e => e.status === "draft").length;
  const published = events.filter(e => e.status === "published").length;

  document.getElementById("stats").innerHTML = `
    <div class="stat-card"><div class="n">${upcoming.length}</div><div class="l">Upcoming events</div></div>
    <div class="stat-card"><div class="n">${published}</div><div class="l">Published</div></div>
    <div class="stat-card"><div class="n">${drafts}</div><div class="l">Drafts</div></div>
    <div class="stat-card"><div class="n">${events.length}</div><div class="l">Total events</div></div>`;

  const up = document.getElementById("upcoming");
  if (!upcoming.length) {
    up.innerHTML = `<div class="empty">No upcoming events yet. <a href="admin-events.html">Create one →</a></div>`;
  } else {
    up.innerHTML = `<table class="tbl"><thead><tr><th>Event</th><th>When</th><th>Status</th><th></th></tr></thead><tbody>
      ${upcoming.slice(0, 8).map(e => `<tr class="row-link" onclick="location.href='admin-event.html?id=${e.id}'">
        <td>${esc(e.name)}</td><td>${fmtDT(e.starts_at)}</td>
        <td><span class="chip ${e.status}">${e.status.replace("_", " ")}</span></td>
        <td><a href="admin-event.html?id=${e.id}">Manage →</a></td></tr>`).join("")}
    </tbody></table>`;
  }
})();
