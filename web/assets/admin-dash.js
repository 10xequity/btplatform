/* Boomtown Platform — Control Center (manager home)
   File: web/assets/admin-dash.js · Version: v1.2 · Date: 2026-07-24 · Ships in: v0.8.0
   Data: one call to GET /api/admin/dashboard (reports.js v1.1).
   Actions inline: Remind (existing link) and Rerun (fresh Square link) straight from
   the overdue list — no navigating to the Registrations page for routine follow-up. */

(async function () {
  const { api, guard, esc, money } = window.BT_ADMIN;
  const $ = id => document.getElementById(id);
  const me = await guard();
  if (!me) return;

  $("today").textContent = new Date().toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric" });
  const first = ((me.user && (me.user.display_name || me.user.email)) || "").split(/[@\s]/)[0];
  if (first) $("hello").textContent = `Morning, ${first.charAt(0).toUpperCase() + first.slice(1)}`;

  /* org switcher (shared pattern) */
  const sw = $("orgSwitcher");
  const orgs = (await api("/api/orgs")).data.orgs || [];
  const current = Number(localStorage.getItem("bt_org")) || (orgs[0] && orgs[0].id) || 1;
  sw.innerHTML = orgs.map(o => `<option value="${o.id}" ${o.id === current ? "selected" : ""}>${esc(o.name)}</option>`).join("");
  sw.addEventListener("change", () => { localStorage.setItem("bt_org", sw.value); location.reload(); });

  load();
  async function load() {
    const r = await api("/api/admin/dashboard");
    if (!r.ok) {
      $("kpis").innerHTML = `<div class="empty">${esc(r.data.error || "Couldn't load the dashboard.")}</div>`;
      return;
    }
    const d = r.data;
    kpis(d); schedule(d.events || []); due(d.unpaid || []); trend(d.trend || []); alerts(d.alerts || []);
    mrr(); // v0.10.0: memberships card (separate endpoint so old workers don't break the dashboard)
  }

  function kpis(d) {
    const monthName = new Date().toLocaleDateString("en-US", { month: "long" });
    $("kpis").innerHTML = `
      <div class="kpi gold"><div class="n">${money(d.received_cents)}</div>
        <div class="l">Received in ${esc(monthName)}</div>
        <div class="sub">${money(d.card_cents)} card · ${money(d.cash_cents)} cash</div></div>
      <div class="kpi ${d.outstanding_cents > 0 ? "warn" : ""}"><div class="n">${money(d.outstanding_cents)}</div>
        <div class="l">Outstanding</div>
        <div class="sub">${(d.unpaid || []).length} registration${(d.unpaid || []).length === 1 ? "" : "s"} to chase</div></div>
      <div class="kpi"><div class="n">${d.member_count}</div><div class="l">Members</div>
        <div class="sub">contacts in this org</div></div>
      <div class="kpi"><div class="n">${(d.events || []).length}</div><div class="l">Live &amp; upcoming events</div>
        <div class="sub">published or in progress</div></div>`;
  }

  async function mrr() {
    try {
      const r = await api("/api/admin/mrr");
      if (!r.ok) return; // worker older than v0.10.0 — skip silently
      const d = r.data;
      const el = document.createElement("div");
      el.className = "kpi" + (d.past_due_count > 0 ? " warn" : "");
      el.innerHTML = `<div class="n">${money(d.mrr_cents)}</div><div class="l">Monthly recurring revenue</div>
        <div class="sub">${d.active_count} active membership${d.active_count === 1 ? "" : "s"}${d.past_due_count ? ` · <b>${d.past_due_count} payment issue${d.past_due_count === 1 ? "" : "s"}</b>` : ""} · <a href="admin-plans.html">Manage →</a></div>`;
      $("kpis").appendChild(el);
    } catch (e) { /* non-fatal */ }
  }

  function schedule(rows) {
    const now = Date.now();
    $("sched").innerHTML = rows.length ? rows.map(e => {
      const dt = e.starts_at ? new Date(e.starts_at.replace(" ", "T")) : null;
      const live = e.status === "in_progress" || (dt && Math.abs(dt - now) < 6 * 3600000 && dt <= now);
      return `<div class="sched-row">
        <div class="when${live ? " live" : ""}">
          <div class="d">${live ? "LIVE" : (dt ? dt.getDate() : "TBD")}</div>
          <div class="m">${live ? "now" : (dt ? dt.toLocaleString("en-US", { month: "short" }) : "")}</div></div>
        <div class="info">
          <div class="n">${esc(e.name)}</div>
          <div class="l">${esc(e.type)}${dt ? " · " + dt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}${e.location ? " · " + esc(e.location) : ""}${e.staff_name ? " · staff: " + esc(e.staff_name) : ""} · ${e.regs} reg${e.regs === 1 ? "" : "s"}</div></div>
        <a class="btn ghost" style="text-decoration:none;padding:6px 12px;min-height:38px;font-size:13.5px"
           href="admin-event.html?id=${e.id}">Open</a></div>`;
    }).join("") : `<p class="help-text">Nothing scheduled. <a href="admin-events.html">Create an event →</a></p>`;
  }

  function due(rows) {
    $("due").innerHTML = rows.length ? rows.map(u => `
      <div class="due-row" data-id="${u.id}">
        <div class="who"><div class="n">${esc(u.team_name || u.full_name || u.email || "Registration #" + u.id)}</div>
          <div class="e">${esc(u.event_name)} · ${esc(u.status)}${u.last_reminded_at ? " · reminded " + esc(u.last_reminded_at.slice(5, 10)) : ""}</div></div>
        <span class="amt">${money(u.price_cents)}</span>
        <button class="btn ghost" data-remind="${u.id}">Remind</button>
        <button class="btn ghost" data-retry="${u.id}">Rerun</button>
      </div>`).join("") : `<p class="help-text">Nobody owes you money right now. 🏐</p>`;
    $("due").querySelectorAll("[data-remind]").forEach(b => b.onclick = () => act(b, `/api/registrations/${b.dataset.remind}/remind`));
    $("due").querySelectorAll("[data-retry]").forEach(b => b.onclick = () => act(b, `/api/registrations/${b.dataset.retry}/retry-payment`));
  }

  async function act(btn, path) {
    btn.disabled = true;
    const r = await api(path, { method: "POST" });
    btn.disabled = false;
    const s = $("dueStatus");
    if (!r.ok) { s.innerHTML = `<p class="notice-err">${esc(r.data.error || "That didn't work.")}</p>`; return; }
    s.innerHTML = `<p class="notice-ok">${esc(r.data.message)}</p>` +
      (r.data.checkout_url && !r.data.emailed && r.data.mode !== "email"
        ? `<code style="font-size:12.5px;overflow-wrap:anywhere">${esc(r.data.checkout_url)}</code>` : "");
    load();
  }

  /* 7-day activity bars — same hand-rolled SVG approach as Sales & Reports. */
  function trend(rows) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const hit = rows.find(r => r.day === d);
      days.push({ day: d, n: hit ? hit.n : 0 });
    }
    const max = Math.max(...days.map(x => x.n), 1);
    const W = 560, H = 150, padB = 24, padT = 16, step = W / 7, bw = Math.min(52, step - 12);
    const bars = days.map((x, i) => {
      const h = Math.max(2, (x.n / max) * (H - padB - padT));
      const bx = i * step + (step - bw) / 2, by = H - padB - h;
      const lbl = new Date(x.day + "T12:00").toLocaleDateString("en-US", { weekday: "short" });
      return `<g><title>${lbl}: ${x.n}</title>
        <rect class="bar" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="4"/>
        ${x.n ? `<text class="val" x="${(bx + bw / 2).toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle">${x.n}</text>` : ""}
        <text class="lbl" x="${(bx + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${lbl}</text></g>`;
    }).join("");
    $("trend").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Registrations per day, last 7 days">${bars}</svg>`;
  }

  function alerts(rows) {
    $("alerts").innerHTML = rows.length ? rows.map(a => {
      let extra = "";
      try { const p = JSON.parse(a.payload_json || "{}"); if (p.team) extra = `${p.team} — ${p.event || ""}`; } catch {}
      return `<div class="alert-row"><span class="k">${esc(a.kind.replace(/_/g, " "))}</span>
        <span>${esc(a.title || extra || a.body || "")}</span>
        <span class="help-text" style="margin-left:auto;flex:none">${esc((a.created_at || "").slice(5, 16).replace("T", " "))}</span></div>`;
    }).join("") : `<p class="help-text">All clear — cash-pending flags and system alerts land here.</p>`;
  }
})();
