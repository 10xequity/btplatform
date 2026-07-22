/* Boomtown Platform — Event Management screen
   Version: v0.4.0 · Date: 2026-07-22
   One screen per event: edit details, publish/cancel, duplicate, save-as-template,
   recurring “this and future” editing, registrations (remind / mark paid), CSV download,
   and the public sign-up + pay link (register.html?event=N). */
(async function () {
  const { api, guard, esc, money, fmtDT, openModal, closeModal, downloadText } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  const sw = document.getElementById("orgSwitcher");
  const orgs = (await api("/api/orgs")).data.orgs || [];
  const currentOrg = Number(localStorage.getItem("bt_org")) || (orgs[0] && orgs[0].id) || 1;
  sw.innerHTML = orgs.map(o => `<option value="${o.id}" ${o.id === currentOrg ? "selected" : ""}>${esc(o.name)}</option>`).join("");
  sw.addEventListener("change", () => { localStorage.setItem("bt_org", sw.value); location.href = "admin-events.html"; });

  const id = Number(new URLSearchParams(location.search).get("id"));
  const main = document.getElementById("main");
  if (!id) { main.innerHTML = `<div class="empty">No event selected. <a href="admin-events.html">Back to events →</a></div>`; return; }

  let ev = null;

  async function load() {
    const r = await api("/api/events/" + id);
    if (!r.ok) { main.innerHTML = `<div class="empty">${esc(r.data.error || "Event not found.")} <a href="admin-events.html">Back →</a></div>`; return; }
    ev = r.data.event || r.data;
    render();
    loadRegs();
  }

  function regLink() { return location.origin + location.pathname.replace(/[^/]*$/, "") + "register.html?event=" + id; }

  function render() {
    const s = ev.starts_at || "";
    main.innerHTML = `
      <div class="page-head">
        <a class="btn ghost" href="admin-events.html" aria-label="Back to events">‹</a>
        <h1>${esc(ev.name)}</h1>
        <span class="chip ${ev.status}">${ev.status.replace("_", " ")}</span>
        <div class="spacer"></div>
        ${ev.status === "draft" ? `<button class="btn" id="publishBtn">Publish</button>` : ""}
        ${["published", "in_progress"].includes(ev.status) ? `<button class="btn ghost" id="cancelBtn">Cancel event</button>` : ""}
        <button class="btn ghost" id="dupBtn">Duplicate</button>
        <button class="btn ghost" id="tplBtn">Save as template</button>
        ${ev.type === "tournament" ? `<a class="btn ghost" href="tournament.html?event=${id}">Tournament ops →</a>` : ""}
      </div>

      ${ev.series_id ? `<div class="card" style="padding:10px 14px;margin-bottom:14px">
        ↻ Part of a recurring series.
        <button class="btn ghost" id="seriesEditBtn">Edit this &amp; future</button>
        <button class="btn ghost" id="seriesCancelBtn">Cancel this &amp; future</button></div>` : ""}

      <div class="card" style="padding:16px;margin-bottom:18px">
        <h2 style="font-size:16px;margin:0 0 10px">Details</h2>
        <div class="modal-body">
          <div class="row2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="field"><label>Name</label><input id="e_name" value="${esc(ev.name)}" /></div>
            <div class="field"><label>Location</label><input id="e_loc" value="${esc(ev.location || "")}" /></div>
            <div class="field"><label>Date</label><input id="e_date" type="date" value="${s.slice(0, 10)}" /></div>
            <div class="field"><label>Start time</label><input id="e_time" type="time" value="${s.slice(11, 16) || "09:00"}" /></div>
            <div class="field"><label>Price (USD)</label><input id="e_price" type="number" min="0" step="0.01" value="${((ev.price_cents || 0) / 100).toFixed(2)}" /></div>
            <div class="field"><label>Capacity</label><input id="e_cap" type="number" min="1" value="${ev.capacity || ""}" placeholder="unlimited" /></div>
          </div>
          <label style="display:flex;gap:8px;align-items:center;font-size:14px;margin:8px 0">
            <input type="checkbox" id="e_cash" ${ev.cash_option_enabled ? "checked" : ""} /> Hidden cash option (admin-only, flags CASH-PENDING)</label>
          <button class="btn" id="saveBtn">Save details</button>
          <span id="saveNotice" style="margin-left:10px"></span>
        </div>
      </div>

      <div class="card" style="padding:16px;margin-bottom:18px">
        <h2 style="font-size:16px;margin:0 0 6px">Sign-up &amp; pay link</h2>
        <p class="help-text">Anyone with this link can register${(ev.price_cents || 0) > 0 ? " and pay by card (Square)" : ""}.
          ${ev.status === "draft" ? "<strong>Publish the event first — drafts aren't open for registration.</strong>" : ""}</p>
        <code style="user-select:all">${esc(regLink())}</code>
        <button class="btn ghost" id="copyLink" style="margin-left:8px">Copy link</button>
      </div>

      <div class="page-head">
        <h2 style="font-size:17px;margin:0">Registrations</h2>
        <div class="spacer"></div>
        <button class="btn ghost" id="csvBtn">⬇ Download CSV</button>
      </div>
      <div id="regsWrap" class="card" style="padding:0"><div class="empty">Loading…</div></div>`;

    document.getElementById("copyLink").addEventListener("click", () =>
      navigator.clipboard.writeText(regLink()).then(() => alert("Link copied.")));
    document.getElementById("saveBtn").addEventListener("click", save);
    document.getElementById("dupBtn").addEventListener("click", duplicate);
    document.getElementById("tplBtn").addEventListener("click", saveTemplate);
    document.getElementById("csvBtn").addEventListener("click", csv);
    const pb = document.getElementById("publishBtn");
    if (pb) pb.addEventListener("click", () => setStatus("published"));
    const cb = document.getElementById("cancelBtn");
    if (cb) cb.addEventListener("click", () => {
      if (confirm("Cancel this event? It stays visible as cancelled; registrations are kept.")) setStatus("cancelled");
    });
    const se = document.getElementById("seriesEditBtn");
    if (se) se.addEventListener("click", seriesEdit);
    const sc = document.getElementById("seriesCancelBtn");
    if (sc) sc.addEventListener("click", async () => {
      if (!confirm("Cancel this event AND all future events in the series?")) return;
      const r = await api(`/api/admin/series/${ev.series_id}?from_event_id=${id}`, { method: "DELETE" });
      alert(r.ok ? `Cancelled ${r.data.cancelled} events.` : (r.data.error || "Failed."));
      load();
    });
  }

  async function save() {
    const body = {
      name: document.getElementById("e_name").value.trim(),
      location: document.getElementById("e_loc").value.trim() || null,
      starts_at: document.getElementById("e_date").value
        ? `${document.getElementById("e_date").value} ${document.getElementById("e_time").value || "09:00"}` : null,
      price_cents: Math.round(Number(document.getElementById("e_price").value || 0) * 100),
      capacity: Number(document.getElementById("e_cap").value) || null,
      cash_option_enabled: document.getElementById("e_cash").checked ? 1 : 0,
    };
    const r = await api("/api/events/" + id, { method: "PATCH", body: JSON.stringify(body) });
    const n = document.getElementById("saveNotice");
    n.className = r.ok ? "notice-ok" : "notice-err";
    n.textContent = r.ok ? "Saved." : (r.data.error || "Save failed.");
    if (r.ok) setTimeout(load, 600);
  }

  async function setStatus(status) {
    const r = await api("/api/events/" + id, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!r.ok) alert(r.data.error || "Couldn't change status.");
    load();
  }

  async function duplicate() {
    const r = await api(`/api/events/${id}/duplicate`, { method: "POST", body: JSON.stringify({}) });
    if (!r.ok) return alert(r.data.error || "Duplicate failed.");
    location.href = "admin-event.html?id=" + r.data.id;
  }

  async function saveTemplate() {
    const name = prompt("Template name:", ev.name + " template");
    if (!name) return;
    const r = await api(`/api/events/${id}/save-as-template`, { method: "POST", body: JSON.stringify({ name }) });
    alert(r.ok ? "Template saved — find it on the Events calendar palette." : (r.data.error || "Failed."));
  }

  function seriesEdit() {
    const back = openModal(`
      <h2>Edit this &amp; future events</h2>
      <p class="help-text">Applies to this event and every later one in the series. Leave a field blank to keep it unchanged.</p>
      <div class="field"><label>Location</label><input id="sf_loc" placeholder="unchanged" /></div>
      <div class="row2">
        <div class="field"><label>Price (USD)</label><input id="sf_price" type="number" min="0" step="0.01" placeholder="unchanged" /></div>
        <div class="field"><label>Status</label><select id="sf_status"><option value="">unchanged</option>
          <option>draft</option><option>published</option></select></div>
      </div>
      <div class="actions"><button class="btn ghost" id="sf_cancel">Cancel</button><button class="btn" id="sf_go">Apply to future</button></div>`);
    back.querySelector("#sf_cancel").addEventListener("click", closeModal);
    back.querySelector("#sf_go").addEventListener("click", async () => {
      const fields = {};
      const lo = back.querySelector("#sf_loc").value.trim(); if (lo) fields.location = lo;
      const pr = back.querySelector("#sf_price").value; if (pr !== "") fields.price_cents = Math.round(Number(pr) * 100);
      const st = back.querySelector("#sf_status").value; if (st) fields.status = st;
      if (!Object.keys(fields).length) return alert("Nothing to change.");
      const r = await api("/api/admin/series/" + ev.series_id, { method: "PATCH",
        body: JSON.stringify({ from_event_id: id, fields }) });
      alert(r.ok ? `Updated ${r.data.updated} events.` : (r.data.error || "Failed."));
      closeModal(); load();
    });
  }

  async function loadRegs() {
    const r = await api(`/api/events/${id}/registrations`);
    const wrap = document.getElementById("regsWrap");
    if (!r.ok) { wrap.innerHTML = `<div class="empty">${esc(r.data.error || "Couldn't load registrations.")}</div>`; return; }
    const regs = r.data.registrations || [];
    if (!regs.length) { wrap.innerHTML = `<div class="empty">No registrations yet. Share the sign-up link above.</div>`; return; }
    wrap.innerHTML = `<table class="tbl"><thead><tr>
        <th>Team / Name</th><th>Contact</th><th>Status</th><th>Registered</th><th></th></tr></thead><tbody>
      ${regs.map(g => `<tr>
        <td>${esc(g.team_name || g.captain_name || "—")}${g.level ? ` <span class="help-text">${esc(g.level)}</span>` : ""}</td>
        <td>${esc(g.email || "")}${g.phone ? `<div class="help-text">${esc(g.phone)}</div>` : ""}</td>
        <td><span class="chip ${g.status}">${g.status}</span></td>
        <td>${fmtDT(g.created_at)}</td>
        <td>
          ${["pending", "email-sent"].includes(g.status) ? `<button class="btn ghost" data-remind="${g.id}">Remind</button>` : ""}
          ${g.status === "cash-pending" ? `<button class="btn ghost" data-paid="${g.id}">Mark collected</button>` : ""}
        </td></tr>`).join("")}
    </tbody></table>`;
    wrap.querySelectorAll("[data-remind]").forEach(b => b.addEventListener("click", async () => {
      const rr = await api(`/api/registrations/${b.dataset.remind}/remind`, { method: "POST" });
      alert(rr.ok ? (rr.data.dev_note || "Reminder sent.") : (rr.data.error || "Failed."));
      loadRegs();
    }));
    wrap.querySelectorAll("[data-paid]").forEach(b => b.addEventListener("click", async () => {
      const rr = await api(`/api/registrations/${b.dataset.paid}/mark-paid`, { method: "POST" });
      if (!rr.ok) alert(rr.data.error || "Failed.");
      loadRegs();
    }));
  }

  async function csv() {
    const r = await api(`/api/events/${id}/registrations.csv`);
    if (!r.ok) return alert((r.data && r.data.error) || "Export failed.");
    downloadText(`event-${id}-registrations-${new Date().toISOString().slice(0, 10)}.csv`, r.data);
  }

  load();
})();
