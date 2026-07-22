/* Boomtown Platform — Events & Programs Admin
   Version: v0.4.0 · Date: 2026-07-22
   Calendar with HTML5 drag-and-drop (template chip → day = create; event → day = reschedule),
   recurring series, bulk CSV import (paste or file), bulk edit, view profiles + embed snippet. */
(async function () {
  const { api, guard, esc, money, fmtDT, openModal, closeModal } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  /* ---------- org switcher ---------- */
  const sw = document.getElementById("orgSwitcher");
  const orgs = (await api("/api/orgs")).data.orgs || [];
  const currentOrg = Number(localStorage.getItem("bt_org")) || (orgs[0] && orgs[0].id) || 1;
  sw.innerHTML = orgs.map(o => `<option value="${o.id}" ${o.id === currentOrg ? "selected" : ""}>${esc(o.name)}</option>`).join("");
  localStorage.setItem("bt_org", String(currentOrg));
  sw.addEventListener("change", () => { localStorage.setItem("bt_org", sw.value); location.reload(); });

  /* ---------- state ---------- */
  let events = [], templates = [], views = [];
  let calCursor = new Date(); calCursor.setDate(1);
  const selected = new Set();

  async function loadAll() {
    const [ev, tp, vw] = await Promise.all([api("/api/events"), api("/api/admin/templates"), api("/api/schedule/views")]);
    events = ev.data.events || [];
    templates = tp.data.templates || [];
    views = vw.data.views || [];
    renderPalette(); renderCalendar(); renderList(); renderViews();
  }

  /* ---------- tabs ---------- */
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));
  function showTab(name) {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    for (const s of ["calendar", "list", "views"]) document.getElementById("tab-" + s).hidden = s !== name;
    location.hash = name === "calendar" ? "" : name;
  }
  if (location.hash === "#views") showTab("views");

  /* ---------- template palette ---------- */
  function renderPalette() {
    const p = document.getElementById("palette");
    const chips = templates.map(t =>
      `<span class="tpl-chip" draggable="true" data-tpl="${t.id}" title="Drag onto a day">
         ⠿ ${esc(t.name)} <span class="x" data-del="${t.id}" title="Delete template" role="button" tabindex="0">×</span></span>`).join("");
    p.innerHTML = chips + `<span class="tpl-chip" draggable="true" data-tpl="blank">⠿ Blank event</span>`;
    p.querySelectorAll("[data-del]").forEach(x => x.addEventListener("click", async e => {
      e.stopPropagation();
      if (!confirm("Delete this template? Events already created from it are not affected.")) return;
      await api("/api/admin/templates/" + x.dataset.del, { method: "DELETE" });
      loadAll();
    }));
    p.querySelectorAll(".tpl-chip").forEach(c => c.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "template", id: c.dataset.tpl }));
    }));
  }

  /* ---------- calendar ---------- */
  document.getElementById("calPrev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
  document.getElementById("calNext").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
  document.getElementById("calToday").addEventListener("click", () => { calCursor = new Date(); calCursor.setDate(1); renderCalendar(); });

  function ymd(d) { return d.toISOString().slice(0, 10); }

  function renderCalendar() {
    const grid = document.getElementById("calGrid");
    const y = calCursor.getFullYear(), mo = calCursor.getMonth();
    document.getElementById("calTitle").textContent =
      calCursor.toLocaleString("en-US", { month: "long", year: "numeric" });
    const first = new Date(y, mo, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const todayStr = ymd(new Date(Date.now() - new Date().getTimezoneOffset() * 60000));
    let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dayEvents = events.filter(e => e.starts_at && e.starts_at.slice(0, 10) === ds);
      html += `<div class="cal-day${d.getMonth() !== mo ? " other" : ""}${ds === todayStr ? " today" : ""}" data-date="${ds}">
        <div class="dnum">${d.getDate()}</div>
        ${dayEvents.map(e => `<a class="cal-ev ${e.status}" draggable="true" data-ev="${e.id}"
            href="admin-event.html?id=${e.id}" title="${esc(e.name)} — click to manage, drag to reschedule">${esc(e.name)}</a>`).join("")}
      </div>`;
    }
    grid.innerHTML = html;

    grid.querySelectorAll(".cal-ev").forEach(el => el.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "event", id: el.dataset.ev }));
    }));
    grid.querySelectorAll(".cal-day").forEach(day => {
      day.addEventListener("dragover", e => { e.preventDefault(); day.classList.add("drop-ok"); });
      day.addEventListener("dragleave", () => day.classList.remove("drop-ok"));
      day.addEventListener("drop", async e => {
        e.preventDefault(); day.classList.remove("drop-ok");
        let payload; try { payload = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
        const date = day.dataset.date;
        if (payload.kind === "template") {
          const tpl = payload.id === "blank" ? {} : JSON.parse((templates.find(t => t.id == payload.id) || {}).payload_json || "{}");
          eventModal({ ...tpl, starts_at: date + " 09:00" });
        } else if (payload.kind === "event") {
          const ev = events.find(x => x.id == payload.id);
          if (!ev) return;
          const time = (ev.starts_at || "").slice(11, 16) || "09:00";
          const r = await api("/api/events/" + ev.id, { method: "PATCH", body: JSON.stringify({ starts_at: `${date} ${time}` }) });
          if (!r.ok) alert(r.data.error || "Couldn't move that event.");
          loadAll();
        }
      });
    });
  }

  /* ---------- create / edit modal ---------- */
  const TYPES = ["tournament", "league", "training", "event", "court_rental"];
  document.getElementById("newEventBtn").addEventListener("click", () => eventModal({}));

  function eventModal(pre) {
    const back = openModal(`
      <h2>${pre.id ? "Edit event" : "New event"}</h2>
      <div class="field"><label>Name</label><input id="m_name" value="${esc(pre.name || "")}" /></div>
      <div class="row2">
        <div class="field"><label>Type</label><select id="m_type">
          ${TYPES.map(t => `<option ${pre.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="field"><label>Status</label><select id="m_status">
          ${["draft", "published"].map(s => `<option ${(pre.status || "draft") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Date</label><input id="m_date" type="date" value="${(pre.starts_at || "").slice(0, 10)}" /></div>
        <div class="field"><label>Start time</label><input id="m_time" type="time" value="${(pre.starts_at || "").slice(11, 16) || "09:00"}" /></div>
      </div>
      <div class="row2">
        <div class="field"><label>Price (USD, 0 = free)</label><input id="m_price" type="number" min="0" step="0.01" value="${((pre.price_cents || 0) / 100).toFixed(2)}" /></div>
        <div class="field"><label>Capacity (blank = unlimited)</label><input id="m_cap" type="number" min="1" value="${pre.capacity || ""}" /></div>
      </div>
      <div class="field"><label>Location</label><input id="m_loc" value="${esc(pre.location || "")}" /></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:14px">
        <input type="checkbox" id="m_cash" ${pre.cash_option_enabled ? "checked" : ""} /> Enable hidden cash option (admin-only)</label>
      <div class="actions">
        <button class="btn ghost" id="m_cancel">Cancel</button>
        <button class="btn ghost" id="m_saveTpl" title="Save these settings as a reusable template">Save as template</button>
        <button class="btn" id="m_save">${pre.id ? "Save changes" : "Create event"}</button>
      </div>`);
    const bag = () => ({
      name: back.querySelector("#m_name").value.trim(),
      type: back.querySelector("#m_type").value,
      status: back.querySelector("#m_status").value,
      starts_at: back.querySelector("#m_date").value ? `${back.querySelector("#m_date").value} ${back.querySelector("#m_time").value || "09:00"}` : null,
      price_cents: Math.round(Number(back.querySelector("#m_price").value || 0) * 100),
      capacity: Number(back.querySelector("#m_cap").value) || null,
      location: back.querySelector("#m_loc").value.trim() || null,
      cash_option_enabled: back.querySelector("#m_cash").checked ? 1 : 0,
    });
    back.querySelector("#m_cancel").addEventListener("click", closeModal);
    back.querySelector("#m_saveTpl").addEventListener("click", async () => {
      const b = bag();
      const name = prompt("Template name:", b.name ? b.name + " template" : "New template");
      if (!name) return;
      await api("/api/admin/templates", { method: "POST", body: JSON.stringify({ name, payload: b }) });
      loadAll(); closeModal();
    });
    back.querySelector("#m_save").addEventListener("click", async () => {
      const b = bag();
      if (!b.name) return alert("Give the event a name.");
      if (!b.starts_at) return alert("Pick a date.");
      const r = pre.id
        ? await api("/api/events/" + pre.id, { method: "PATCH", body: JSON.stringify(b) })
        : await api("/api/events", { method: "POST", body: JSON.stringify(b) });
      if (!r.ok) return alert(r.data.error || "Save failed.");
      closeModal(); loadAll();
    });
  }

  /* ---------- recurring ---------- */
  document.getElementById("newRecurringBtn").addEventListener("click", () => {
    const back = openModal(`
      <h2>Recurring event series</h2>
      <p class="help-text">Creates one event per date — you can edit or cancel “this and future” later from any instance.</p>
      <div class="field"><label>Name</label><input id="r_name" placeholder="e.g. Tuesday League Night" /></div>
      <div class="row2">
        <div class="field"><label>Type</label><select id="r_type">${TYPES.map(t => `<option>${t}</option>`).join("")}</select></div>
        <div class="field"><label>Repeats</label><select id="r_freq"><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option></select></div>
      </div>
      <div class="row2">
        <div class="field"><label>First date</label><input id="r_date" type="date" /></div>
        <div class="field"><label>Start time</label><input id="r_time" type="time" value="18:00" /></div>
      </div>
      <div class="row2">
        <div class="field"><label>How many times (max 52)</label><input id="r_count" type="number" min="1" max="52" value="8" /></div>
        <div class="field"><label>Price (USD)</label><input id="r_price" type="number" min="0" step="0.01" value="0" /></div>
      </div>
      <div class="field"><label>Location</label><input id="r_loc" /></div>
      <div class="actions"><button class="btn ghost" id="r_cancel">Cancel</button><button class="btn" id="r_go">Create series</button></div>`);
    back.querySelector("#r_cancel").addEventListener("click", closeModal);
    back.querySelector("#r_go").addEventListener("click", async () => {
      const date = back.querySelector("#r_date").value;
      const name = back.querySelector("#r_name").value.trim();
      if (!name || !date) return alert("Name and first date are required.");
      const r = await api("/api/admin/events/recurring", { method: "POST", body: JSON.stringify({
        base: { name, type: back.querySelector("#r_type").value,
          starts_at: `${date} ${back.querySelector("#r_time").value || "18:00"}`,
          price_cents: Math.round(Number(back.querySelector("#r_price").value || 0) * 100),
          location: back.querySelector("#r_loc").value.trim() || null },
        rule: { freq: back.querySelector("#r_freq").value, count: Number(back.querySelector("#r_count").value) || 8 },
      })});
      if (!r.ok) return alert(r.data.error || "Couldn't create the series.");
      alert(`Created ${r.data.count} events. They're drafts — publish from the list when ready.`);
      closeModal(); loadAll();
    });
  });

  /* ---------- bulk import (CSV paste or file) ---------- */
  document.getElementById("bulkImportBtn").addEventListener("click", () => {
    const back = openModal(`
      <h2>Bulk import events</h2>
      <p class="help-text">CSV with a header row. Columns (any order): <code>name, type, date, time, location, price, capacity, status</code>.
        Only <code>name</code> and <code>date</code> (YYYY-MM-DD) are required. Export a Google Sheet as CSV, or paste rows below.</p>
      <div class="field"><label>Upload CSV file</label><input type="file" id="b_file" accept=".csv,text/csv" /></div>
      <div class="field"><label>…or paste CSV</label><textarea id="b_text" rows="7" placeholder="name,type,date,time,location,price\nSpring Open,tournament,2026-08-15,09:00,Memorial Park,40"></textarea></div>
      <div id="b_notice"></div>
      <div class="actions"><button class="btn ghost" id="b_cancel">Cancel</button><button class="btn" id="b_go">Import</button></div>`);
    back.querySelector("#b_cancel").addEventListener("click", closeModal);
    back.querySelector("#b_file").addEventListener("change", e => {
      const f = e.target.files[0];
      if (f) f.text().then(t => { back.querySelector("#b_text").value = t; });
    });
    back.querySelector("#b_go").addEventListener("click", async () => {
      const rows = parseCsv(back.querySelector("#b_text").value);
      if (!rows.length) return alert("No rows found — check the header line.");
      const mapped = rows.map(r => ({
        name: r.name, type: r.type || "event",
        starts_at: r.date ? `${r.date} ${r.time || "09:00"}` : null,
        location: r.location || null, price: r.price, capacity: Number(r.capacity) || null,
        status: r.status || "draft",
      }));
      const res = await api("/api/admin/events/bulk", { method: "POST", body: JSON.stringify({ rows: mapped }) });
      if (!res.ok) return alert(res.data.error || "Import failed.");
      const n = back.querySelector("#b_notice");
      n.innerHTML = `<p class="notice-ok">Created ${res.data.created} events.</p>` +
        (res.data.skipped.length ? `<p class="notice-err">Skipped ${res.data.skipped.length}: ${res.data.skipped.map(s => `row ${s.row} (${esc(s.reason)})`).join(", ")}</p>` : "");
      loadAll();
    });
  });

  function parseCsv(text) {
    const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
    if (lines.length < 2) return [];
    const split = l => {
      const out = []; let cur = "", q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === "," && !q) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur); return out.map(s => s.trim().replace(/^"|"$/g, ""));
    };
    const head = split(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, "_"));
    return lines.slice(1).map(l => {
      const cells = split(l), o = {};
      head.forEach((h, i) => o[h] = cells[i] || "");
      return o;
    });
  }

  /* ---------- list + bulk edit ---------- */
  document.getElementById("listSearch").addEventListener("input", renderList);
  document.getElementById("listStatus").addEventListener("change", renderList);
  document.getElementById("bulkEditBtn").addEventListener("click", bulkEditModal);

  function renderList() {
    const q = document.getElementById("listSearch").value.toLowerCase();
    const st = document.getElementById("listStatus").value;
    const rows = events
      .filter(e => (!q || e.name.toLowerCase().includes(q)) && (!st || e.status === st))
      .sort((a, b) => (b.starts_at || "").localeCompare(a.starts_at || ""));
    const wrap = document.getElementById("listWrap");
    if (!rows.length) { wrap.innerHTML = `<div class="empty">No events match.</div>`; return; }
    wrap.innerHTML = `<table class="tbl"><thead><tr>
        <th class="select-col"><input type="checkbox" id="selAll" aria-label="Select all" /></th>
        <th>Event</th><th>When</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(e => `<tr>
        <td><input type="checkbox" class="selRow" data-id="${e.id}" ${selected.has(e.id) ? "checked" : ""} aria-label="Select ${esc(e.name)}" /></td>
        <td><a href="admin-event.html?id=${e.id}">${esc(e.name)}</a></td>
        <td>${fmtDT(e.starts_at)}</td><td>${e.type}</td>
        <td><span class="chip ${e.status}">${e.status.replace("_", " ")}</span></td>
        <td><a href="admin-event.html?id=${e.id}">Manage →</a></td></tr>`).join("")}
    </tbody></table>`;
    wrap.querySelector("#selAll").addEventListener("change", e => {
      wrap.querySelectorAll(".selRow").forEach(c => { c.checked = e.target.checked; toggleSel(c); });
    });
    wrap.querySelectorAll(".selRow").forEach(c => c.addEventListener("change", () => toggleSel(c)));
    syncSelUi();
  }
  function toggleSel(c) { c.checked ? selected.add(+c.dataset.id) : selected.delete(+c.dataset.id); syncSelUi(); }
  function syncSelUi() {
    document.getElementById("selCount").textContent = selected.size ? `${selected.size} selected` : "";
    document.getElementById("bulkEditBtn").disabled = !selected.size;
  }

  function bulkEditModal() {
    const back = openModal(`
      <h2>Bulk edit ${selected.size} events</h2>
      <p class="help-text">Only the fields you fill in are changed.</p>
      <div class="field"><label>Status</label><select id="be_status"><option value="">— leave as is —</option>
        <option>draft</option><option>published</option><option>completed</option><option>cancelled</option></select></div>
      <div class="row2">
        <div class="field"><label>Price (USD)</label><input id="be_price" type="number" min="0" step="0.01" placeholder="leave blank" /></div>
        <div class="field"><label>Location</label><input id="be_loc" placeholder="leave blank" /></div>
      </div>
      <div class="actions"><button class="btn ghost" id="be_cancel">Cancel</button><button class="btn" id="be_go">Apply</button></div>`);
    back.querySelector("#be_cancel").addEventListener("click", closeModal);
    back.querySelector("#be_go").addEventListener("click", async () => {
      const fields = {};
      const st = back.querySelector("#be_status").value; if (st) fields.status = st;
      const pr = back.querySelector("#be_price").value; if (pr !== "") fields.price_cents = Math.round(Number(pr) * 100);
      const lo = back.querySelector("#be_loc").value.trim(); if (lo) fields.location = lo;
      if (!Object.keys(fields).length) return alert("Fill in at least one field.");
      const r = await api("/api/admin/events/bulk", { method: "PATCH", body: JSON.stringify({ ids: [...selected], fields }) });
      if (!r.ok) return alert(r.data.error || "Bulk edit failed.");
      selected.clear(); closeModal(); loadAll();
    });
  }

  /* ---------- views & embed ---------- */
  document.getElementById("newViewBtn").addEventListener("click", () => viewModal(null));
  document.getElementById("copyEmbed").addEventListener("click", () => {
    navigator.clipboard.writeText(document.getElementById("embedSnippet").textContent)
      .then(() => alert("Copied. Paste it into your website's HTML."));
  });

  function appBase() { return location.origin + location.pathname.replace(/[^/]*$/, ""); }

  function renderViews() {
    const wrap = document.getElementById("viewsWrap");
    wrap.innerHTML = `<table class="tbl"><thead><tr><th>View</th><th>Names</th><th>Counts</th><th>Org</th><th>Link</th><th></th></tr></thead><tbody>
      ${views.map(v => `<tr>
        <td>${esc(v.name)} ${v.kind !== "custom" ? '<span class="chip">built-in</span>' : ""}</td>
        <td>${v.show_names ? "Shown" : "Hidden"}</td><td>${v.show_counts ? "Shown" : "Hidden"}</td>
        <td>${v.org_id ? esc((orgs.find(o => o.id === v.org_id) || {}).name || v.org_id) : "All"}</td>
        <td><a href="schedule.html?view=${v.slug}" target="_blank" rel="noopener">open ↗</a></td>
        <td>${v.kind === "custom" ? `<button class="btn ghost" data-edit="${v.id}">Edit</button>
             <button class="btn ghost" data-delv="${v.id}">Delete</button>`
            : `<button class="btn ghost" data-edit="${v.id}">Edit</button>`}</td></tr>`).join("")}
    </tbody></table>`;
    wrap.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => viewModal(views.find(v => v.id == b.dataset.edit))));
    wrap.querySelectorAll("[data-delv]").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("Delete this view? Any embedded widget using its link stops working.")) return;
      await api("/api/schedule/views/" + b.dataset.delv, { method: "DELETE" }); loadAll();
    }));
    document.getElementById("embedSnippet").textContent =
      `<script src="${appBase()}widget.js" data-view="public" data-theme="auto"><\/script>`;
  }

  function viewModal(v) {
    const back = openModal(`
      <h2>${v ? "Edit view" : "New view"}</h2>
      <div class="field"><label>Name</label><input id="v_name" value="${esc(v ? v.name : "")}" ${v && v.kind !== "custom" ? "disabled" : ""} /></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:14px;margin-bottom:8px">
        <input type="checkbox" id="v_names" ${v && v.show_names ? "checked" : ""} /> Show participant / team names</label>
      <label style="display:flex;gap:8px;align-items:center;font-size:14px;margin-bottom:8px">
        <input type="checkbox" id="v_counts" ${v && v.show_counts ? "checked" : ""} /> Show registered counts</label>
      <div class="field"><label>Limit to org</label><select id="v_org"><option value="">All orgs</option>
        ${orgs.map(o => `<option value="${o.id}" ${v && v.org_id === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div>
      <div class="actions"><button class="btn ghost" id="v_cancel">Cancel</button><button class="btn" id="v_save">Save</button></div>`);
    back.querySelector("#v_cancel").addEventListener("click", closeModal);
    back.querySelector("#v_save").addEventListener("click", async () => {
      const body = {
        name: back.querySelector("#v_name").value.trim() || (v && v.name),
        show_names: back.querySelector("#v_names").checked ? 1 : 0,
        show_counts: back.querySelector("#v_counts").checked ? 1 : 0,
        org_id: Number(back.querySelector("#v_org").value) || null,
      };
      const r = v ? await api("/api/schedule/views/" + v.id, { method: "PATCH", body: JSON.stringify(body) })
                  : await api("/api/schedule/views", { method: "POST", body: JSON.stringify(body) });
      if (!r.ok) return alert(r.data.error || "Save failed.");
      closeModal(); loadAll();
    });
  }

  loadAll();
})();
