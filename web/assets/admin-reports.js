/* Boomtown Platform — Sales & Reports
   File: web/assets/admin-reports.js · Version: v1.4 · Date: 2026-08-02 · Ships in: v0.43.0
   v1.3: "Export for Looker · all companies" — one click fetches
   /api/admin/reports/revenue-all.csv (12-column cross-org contract). The button only
   appears when the signed-in user staffs more than one org, so single-company admins
   never see a control that would duplicate the one next to it. Both exports share
   lookerCsv().
   v1.2: "Export for Looker" — fetches /api/admin/reports/revenue.csv (stable headers, the
   Looker template contract, req #12/#18) and saves it via downloadText.
   RECOVERY of the lost v0.7.0 file. Renders /api/admin/reports/sales:
   totals, month bars (same hand-rolled SVG approach as the Control Center),
   program + event tables, one-click CSV. */

(function () {
  const { api, guard, esc, money, downloadText } = window.BT_ADMIN;
  const $ = id => document.getElementById(id);
  let report = null;

  /* v0.52.0: theme is single-source now — pre-paint via the shared <head> snippet, toggle in admin-nav.js v2.19. */
  boot();
  async function boot() {
    const me = await guard(); if (!me) return;
    /* v0.52.0: org switcher is single-source now — populated + handled by admin-nav.js v2.19. */
    $("csvBtn").onclick = csv;
    // The Looker endpoints return text/csv, not JSON, so api() would choke — mirror its auth.
    async function lookerCsv(path, stem) {
      const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
      const headers = {};
      const t = sessionStorage.getItem("bt_token") || localStorage.getItem("bt_token");
      if (t) headers["Authorization"] = "Bearer " + t;
      const orgId = localStorage.getItem("bt_org");
      if (orgId) headers["X-Org-Id"] = orgId;
      const resp = await fetch(API + path, { headers, credentials: "include" });
      if (!resp.ok) return window.BT_ADMIN.fail(document.getElementById("app"), "The revenue export could not be generated.");
      downloadText(`${stem}-${new Date().toISOString().slice(0, 10)}.csv`, await resp.text());
    }
    $("lookerBtn").onclick = () => lookerCsv("/api/admin/reports/revenue.csv", "boomtown-revenue");
    // Cross-org export only makes sense when there is more than one company to cross.
    const staffedOrgs = (me.roles || []).filter((r) => r.role === "admin" || r.role === "staff").length;
    if (staffedOrgs > 1) {
      $("lookerAllBtn").hidden = false;
      $("lookerAllBtn").onclick = () => lookerCsv("/api/admin/reports/revenue-all.csv", "boomtown-revenue-all");
    }
    load();
  }

  async function load() {
    const r = await api("/api/admin/reports/sales");
    if (!r.ok) { $("status").innerHTML = `<p class="notice-err">${esc(r.data.error || "Couldn't load the report.")}</p>`; return; }
    $("status").innerHTML = "";
    report = r.data;
    totals(); monthBars(); tables();
  }

  function totals() {
    const all = (report.per_event || []).reduce((a, e) => a + (e.total_cents || 0), 0);
    const thisMonth = new Date().toISOString().slice(0, 7);
    const mo = (report.per_month || []).find(m => m.month === thisMonth);
    const regs = (report.per_event || []).reduce((a, e) => a + (e.registrations || 0), 0);
    $("totAll").firstChild.textContent = money(all) === "Free" ? "$0" : money(all);
    $("totMonth").firstChild.textContent = mo && mo.total_cents ? money(mo.total_cents) : "$0";
    $("totRegs").firstChild.textContent = regs;
  }

  function monthBars() {
    const rows = (report.per_month || []).filter(m => m.month !== "undated").slice(-12);
    if (!rows.length) { $("byMonth").innerHTML = `<p class="help-text">No revenue yet; it shows up here as payments land.</p>`; return; }
    const max = Math.max(...rows.map(r => r.total_cents), 1);
    const W = 640, H = 170, padB = 26, padT = 20, step = W / rows.length, bw = Math.min(56, step - 10);
    const bars = rows.map((r, i) => {
      const h = Math.max(2, (r.total_cents / max) * (H - padB - padT));
      const bx = i * step + (step - bw) / 2, by = H - padB - h;
      const lbl = new Date(r.month + "-15").toLocaleDateString("en-US", { month: "short" });
      return `<g><title>${r.month}: ${money(r.total_cents)}</title>
        <rect class="bar" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="4"/>
        ${r.total_cents ? `<text class="val" x="${(bx + bw / 2).toFixed(1)}" y="${(by - 5).toFixed(1)}" text-anchor="middle">${money(r.total_cents)}</text>` : ""}
        <text class="lbl" x="${(bx + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${lbl}</text></g>`;
    }).join("");
    $("byMonth").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue per month">${bars}</svg>`;
  }

  function tables() {
    $("byProgram").innerHTML = (report.per_program || []).map(p => `
      <tr><td>${esc(p.program)}</td><td>${p.events}</td><td>${p.registrations}</td>
      <td>${p.total_cents ? money(p.total_cents) : "$0"}</td></tr>`).join("") ||
      `<tr><td colspan="4" class="help-text">Nothing yet.</td></tr>`;

    $("byEvent").innerHTML = (report.per_event || []).map(e => `
      <tr><td>${esc(e.event)}</td><td>${esc(e.type || "")}</td>
      <td>${e.starts_at ? esc(String(e.starts_at).slice(0, 10)) : "—"}</td>
      <td>${e.registrations}</td>
      <td>${e.card_cents ? money(e.card_cents) : "$0"}</td>
      <td>${e.cash_cents ? money(e.cash_cents) : "$0"}</td>
      <td><strong>${e.total_cents ? money(e.total_cents) : "$0"}</strong></td></tr>`).join("") ||
      `<tr><td colspan="7" class="help-text">Nothing yet.</td></tr>`;
  }

  function csv() {
    if (!report) return;
    const escCsv = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [["event", "type", "date", "program", "registrations", "card_cents", "cash_cents", "total_cents"].join(",")];
    for (const e of report.per_event || []) {
      lines.push([e.event, e.type, e.starts_at, e.program, e.registrations, e.card_cents, e.cash_cents, e.total_cents].map(escCsv).join(","));
    }
    downloadText(`boomtown-sales-${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\r\n"));
  }
})();
