/* Boomtown Platform — Sales & Reports
   File: web/assets/admin-reports.js · Version: v1.1 · Date: 2026-07-24 · Ships in: v0.9.1
   RECOVERY of the lost v0.7.0 file. Renders /api/admin/reports/sales:
   totals, month bars (same hand-rolled SVG approach as the Control Center),
   program + event tables, one-click CSV. */

(function () {
  const { api, guard, esc, money, downloadText } = window.BT_ADMIN;
  const $ = id => document.getElementById(id);
  let report = null;

  const savedTheme = localStorage.getItem("bt_theme");
  document.documentElement.dataset.theme = savedTheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  $("themeToggle").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("bt_theme", next);
  };

  boot();
  async function boot() {
    const me = await guard(); if (!me) return;
    const orgs = await api("/api/orgs");
    const sw = $("orgSwitcher");
    sw.innerHTML = (orgs.data.orgs || []).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("");
    sw.value = localStorage.getItem("bt_org") || "1";
    sw.onchange = () => { localStorage.setItem("bt_org", sw.value); load(); };
    $("csvBtn").onclick = csv;
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
    if (!rows.length) { $("byMonth").innerHTML = `<p class="help-text">No revenue yet — it shows up here as payments land.</p>`; return; }
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
