/* Boomtown Platform — Admin Dashboard
   Version: v0.4.1 · Date: 2026-08-02 */
(async function () {
  const { api, guard, esc, money, fmtDT } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  /* v0.52.0: org switcher is single-source now — populated + handled by admin-nav.js v2.19. */

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
