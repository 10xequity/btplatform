/* Boomtown Platform — Facility Calendar (admin)
   Version: v1.0 · Date: 2026-07-24 · Ships in: v0.12.0
   Day grid (spaces × time, 6:00–23:00) + Week list, conflict-checked booking modal,
   weekly series, closures, CSV importer. */
(async function () {
  const { api, guard, esc } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  const fail = (msg) => (window.BT_ADMIN.fail
    ? window.BT_ADMIN.fail(document.getElementById("calRoot"), msg)
    : (document.getElementById("calRoot").innerHTML = `<div class="empty">${esc(msg)}</div>`));

  // Org switcher (shared pattern)
  const sw = document.getElementById("orgSwitcher");
  const orgsRes = await api("/api/orgs");
  const orgs = (orgsRes.data && orgsRes.data.orgs) || [];
  const currentOrg = Number(localStorage.getItem("bt_org")) || (orgs[0] && orgs[0].id) || 1;
  sw.innerHTML = orgs.map(o => `<option value="${o.id}" ${o.id === currentOrg ? "selected" : ""}>${esc(o.name)}</option>`).join("");
  localStorage.setItem("bt_org", String(currentOrg));
  sw.addEventListener("change", () => { localStorage.setItem("bt_org", sw.value); location.reload(); });

  // Reference data
  const ref = await api("/api/admin/facility/spaces");
  if (!ref.ok) return fail(ref.data.error || "Could not load the facility spaces.");
  const { spaces, presets, operators } = ref.data;
  const opColor = Object.fromEntries(operators.map(o => [o.id, o.color]));
  const opName = Object.fromEntries(operators.map(o => [o.id, o.name]));

  document.getElementById("legend").innerHTML = operators
    .map(o => `<span class="op"><span class="dot" style="background:${o.color}"></span>${esc(o.name)}</span>`).join("");

  // State
  const DAY_START = 6 * 60, DAY_END = 23 * 60, PX_PER_MIN = 48 / 60; // 48px per hour
  let view = "day";
  let anchor = todayStr();
  let bookings = [];

  const root = document.getElementById("calRoot");
  const datePick = document.getElementById("datePick");
  const dateLabel = document.getElementById("dateLabel");

  document.getElementById("prevBtn").addEventListener("click", () => move(view === "day" ? -1 : -7));
  document.getElementById("nextBtn").addEventListener("click", () => move(view === "day" ? 1 : 7));
  document.getElementById("todayBtn").addEventListener("click", () => { anchor = todayStr(); load(); });
  datePick.addEventListener("change", () => { if (datePick.value) { anchor = datePick.value; load(); } });
  document.getElementById("viewDay").addEventListener("click", () => setView("day"));
  document.getElementById("viewWeek").addEventListener("click", () => setView("week"));
  document.getElementById("newBtn").addEventListener("click", () => openModal(null, { is_closure: false }));
  document.getElementById("closureBtn").addEventListener("click", () => openModal(null, { is_closure: true }));
  document.getElementById("importBtn").addEventListener("click", openImport);

  function setView(v) {
    view = v;
    document.getElementById("viewDay").setAttribute("aria-pressed", String(v === "day"));
    document.getElementById("viewWeek").setAttribute("aria-pressed", String(v === "week"));
    load();
  }
  function move(days) {
    const d = new Date(anchor + "T00:00:00");
    d.setDate(d.getDate() + days);
    anchor = d.toISOString().slice(0, 10);
    load();
  }

  async function load() {
    datePick.value = anchor;
    const [from, to] = view === "day" ? [anchor, anchor] : weekRange(anchor);
    dateLabel.textContent = view === "day" ? longDate(anchor) : `${shortDate(from)} – ${shortDate(to)}`;
    const res = await api(`/api/admin/facility/bookings?from=${from}&to=${to}`);
    if (!res.ok) return fail(res.data.error || "Could not load bookings.");
    bookings = res.data.bookings || [];
    view === "day" ? renderDay() : renderWeek(from);
  }

  /* ---------- day grid ---------- */
  function renderDay() {
    const cols = spaces; // 13 courts + 6 rooms, sorted
    const height = (DAY_END - DAY_START) * PX_PER_MIN;
    const firstRoomIdx = cols.findIndex(s => s.kind === "room");
    let html = `<div class="fc-wrap"><div class="fc-grid" style="--ncols:${cols.length}">`;
    html += `<div class="fc-head"></div>`;
    cols.forEach((s, i) => {
      html += `<div class="fc-head ${s.kind}${i === firstRoomIdx ? " divide" : ""}">${esc(s.name)}</div>`;
    });
    // time column
    html += `<div class="fc-timecol" style="height:${height}px">`;
    for (let m = DAY_START; m <= DAY_END; m += 60) {
      html += `<div class="fc-time" style="top:${(m - DAY_START) * PX_PER_MIN}px">${hourLabel(m)}</div>`;
    }
    html += `</div>`;
    // space columns
    cols.forEach((s, i) => {
      html += `<div class="fc-col${i === firstRoomIdx ? " divide" : ""}" style="height:${height}px" data-space="${s.id}">`;
      for (let m = DAY_START + 60; m < DAY_END; m += 60) {
        html += `<div class="fc-hourline" style="top:${(m - DAY_START) * PX_PER_MIN}px"></div>`;
      }
      for (const b of bookings) {
        if (!b.space_ids.includes(s.id)) continue;
        const top = Math.max(0, (b.start_min - DAY_START) * PX_PER_MIN);
        const h = Math.max(18, (Math.min(b.end_min, DAY_END) - Math.max(b.start_min, DAY_START)) * PX_PER_MIN - 2);
        const cls = "fc-block" + (b.is_closure ? " closure" : "") + (b.share_ok ? " shared" : "");
        html += `<button class="${cls}" style="--op:${opColor[b.org_id] || "#7A7F87"};top:${top}px;height:${h}px"
          data-id="${b.id}" title="${esc(b.title)} · ${esc(opName[b.org_id] || "")} · ${fmtMin(b.start_min)}–${fmtMin(b.end_min)}">
          <span class="t">${esc(b.title)}</span>${fmtMin(b.start_min)}</button>`;
      }
      html += `</div>`;
    });
    html += `</div></div>`;
    root.innerHTML = html;
    // now line
    if (anchor === todayStr()) {
      const now = new Date(); const m = now.getHours() * 60 + now.getMinutes();
      if (m >= DAY_START && m <= DAY_END) {
        const line = document.createElement("div");
        line.className = "fc-nowline";
        line.style.top = `${(m - DAY_START) * PX_PER_MIN + 33}px`; // + header height
        root.querySelector(".fc-grid").appendChild(line);
      }
    }
    root.querySelectorAll(".fc-block").forEach(el =>
      el.addEventListener("click", () => openModal(bookings.find(b => b.id === Number(el.dataset.id)))));
    if (!bookings.length) {
      const note = document.createElement("p");
      note.className = "empty";
      note.innerHTML = `Nothing booked on this day yet. <a href="#" id="emptyNew">Add the first booking →</a>`;
      root.appendChild(note);
      note.querySelector("#emptyNew").addEventListener("click", (e) => { e.preventDefault(); openModal(null, {}); });
    }
  }

  /* ---------- week list ---------- */
  function renderWeek(from) {
    const days = [...Array(7)].map((_, i) => addDays(from, i));
    root.innerHTML = `<div class="fc-week">` + days.map(d => {
      const list = bookings.filter(b => b.date === d).sort((a, b) => a.start_min - b.start_min);
      return `<section class="card fc-daycard">
        <h3><button data-day="${d}">${longDate(d)}</button></h3>
        ${list.length ? `<ul>${list.map(b => `<li><button data-id="${b.id}" style="--op:${opColor[b.org_id] || "#7A7F87"}">
            <strong>${fmtMin(b.start_min)}</strong> ${esc(b.title)}${b.is_closure ? " · CLOSED" : ""}</button></li>`).join("")}</ul>`
          : `<div class="none">Open all day</div>`}
      </section>`;
    }).join("") + `</div>`;
    root.querySelectorAll("[data-day]").forEach(el =>
      el.addEventListener("click", () => { anchor = el.dataset.day; setView("day"); }));
    root.querySelectorAll("[data-id]").forEach(el =>
      el.addEventListener("click", () => openModal(bookings.find(b => b.id === Number(el.dataset.id)))));
  }

  /* ---------- booking modal ---------- */
  function openModal(existing, seed = {}) {
    const b = existing || { date: anchor, start_min: 18 * 60, end_min: 20 * 60, org_id: currentOrg,
      space_ids: [], share_ok: 0, is_closure: seed.is_closure ? 1 : 0, staffing_json: "{}" };
    let staffing = {}; try { staffing = JSON.parse(b.staffing_json || "{}"); } catch {}
    const ov = document.createElement("div");
    ov.className = "fc-overlay";
    ov.innerHTML = `<div class="fc-modal" role="dialog" aria-modal="true" aria-label="${existing ? "Edit booking" : "New booking"}">
      <h2 style="margin:0 0 12px;font-size:18px">${existing ? "Edit booking" : (b.is_closure ? "Add facility closure" : "New booking")}</h2>
      <div class="fc-form">
        <div class="full"><label for="fTitle">Title</label><input id="fTitle" maxlength="140" value="${esc(b.title || (b.is_closure ? "Facility closed" : ""))}" /></div>
        <div><label for="fOrg">Operator</label><select id="fOrg">${operators.map(o =>
          `<option value="${o.id}" ${o.id === b.org_id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div>
        <div><label for="fDate">Date</label><input id="fDate" type="date" value="${b.date}" /></div>
        <div><label for="fStart">Start</label><input id="fStart" type="time" value="${toHM(b.start_min)}" /></div>
        <div><label for="fEnd">End</label><input id="fEnd" type="time" value="${toHM(b.end_min)}" /></div>
        <div class="full"><label for="fPreset">Booked as (preset — checks the courts below)</label>
          <select id="fPreset"><option value="">Custom selection</option>${presets.map(p =>
            `<option value="${p.id}" ${p.id === b.preset_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
        <div class="full"><label>Courts &amp; rooms reserved</label>
          <div class="fc-atoms">${spaces.map(s =>
            `<label><input type="checkbox" value="${s.id}" ${b.space_ids.includes(s.id) ? "checked" : ""} /> ${esc(s.name)}</label>`).join("")}</div></div>
        <div class="fc-check"><input type="checkbox" id="fShare" ${b.share_ok ? "checked" : ""} />
          <label for="fShare" style="margin:0">Court Share OK (overlaps become a warning, not a conflict)</label></div>
        <div class="fc-check"><input type="checkbox" id="fClosure" ${b.is_closure ? "checked" : ""} />
          <label for="fClosure" style="margin:0">Facility closure (blocks everything on these spaces)</label></div>
        ${existing ? "" : `<div class="fc-check"><input type="checkbox" id="fRepeat" />
          <label for="fRepeat" style="margin:0">Repeat weekly until</label></div>
        <div><label for="fUntil" class="sr-only">Repeat until</label><input id="fUntil" type="date" disabled /></div>`}
        <details class="fc-more full"><summary>Staffing, catering &amp; contact details</summary>
          <div class="fc-form" style="margin-top:10px">
            <div><label for="fStaff">Facility staff</label><input id="fStaff" type="number" min="0" value="${staffing.facility ?? ""}" /></div>
            <div><label for="fBar">Bar staff (Oda Up)</label><input id="fBar" type="number" min="0" value="${staffing.bar ?? ""}" /></div>
            <div><label for="fCater">Catering</label><input id="fCater" maxlength="140" value="${esc(b.catering || "")}" /></div>
            <div><label for="fDoor">Door charge (USD)</label><input id="fDoor" type="number" min="0" step="0.01"
              value="${b.door_charge_cents != null ? (b.door_charge_cents / 100).toFixed(2) : ""}" /></div>
            <div><label for="fPoc">POC name</label><input id="fPoc" value="${esc(b.poc_name || "")}" /></div>
            <div><label for="fPocE">POC email</label><input id="fPocE" type="email" value="${esc(b.poc_email || "")}" /></div>
            <div><label for="fPocP">POC phone</label><input id="fPocP" value="${esc(b.poc_phone || "")}" /></div>
            <div><label for="fAtt">Estimated attendees</label><input id="fAtt" type="number" min="0" value="${b.est_attendees ?? ""}" /></div>
            <div class="full"><label for="fNotes">Notes</label><textarea id="fNotes" maxlength="500">${esc(b.notes || "")}</textarea></div>
          </div></details>
        <div class="fc-conflicts full" id="fConf"></div>
      </div>
      <div class="fc-actions">
        ${existing ? `<button class="btn ghost" id="fDelete" style="color:var(--danger)">Delete${b.series_id ? "…" : ""}</button>` : ""}
        <span style="flex:1"></span>
        <button class="btn ghost" id="fCancel">Cancel</button>
        ${existing && b.series_id ? `<button class="btn ghost" id="fSaveSeries">Save series</button>` : ""}
        <button class="btn" id="fSave">${existing ? "Save changes" : "Book it"}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const q = (id) => ov.querySelector("#" + id);
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    q("fTitle").focus();
    q("fCancel").addEventListener("click", close);
    if (q("fRepeat")) q("fRepeat").addEventListener("change", () => { q("fUntil").disabled = !q("fRepeat").checked; });
    q("fPreset").addEventListener("change", () => {
      const p = presets.find(x => x.id === Number(q("fPreset").value));
      ov.querySelectorAll(".fc-atoms input").forEach(cb => { cb.checked = p ? p.space_ids.includes(Number(cb.value)) : cb.checked; });
    });

    const gather = () => ({
      title: q("fTitle").value.trim(),
      org_id: Number(q("fOrg").value),
      date: q("fDate").value,
      start: q("fStart").value, end: q("fEnd").value,
      preset_id: q("fPreset").value ? Number(q("fPreset").value) : null,
      space_ids: [...ov.querySelectorAll(".fc-atoms input:checked")].map(cb => Number(cb.value)),
      share_ok: q("fShare").checked, is_closure: q("fClosure").checked,
      staffing: { facility: q("fStaff").value ? Number(q("fStaff").value) : null, bar: q("fBar").value ? Number(q("fBar").value) : null },
      catering: q("fCater").value.trim(), door_charge_cents: q("fDoor").value ? Math.round(parseFloat(q("fDoor").value) * 100) : null,
      poc_name: q("fPoc").value.trim(), poc_email: q("fPocE").value.trim(), poc_phone: q("fPocP").value.trim(),
      est_attendees: q("fAtt").value ? Number(q("fAtt").value) : null, notes: q("fNotes").value.trim(),
      repeat_weekly: q("fRepeat") ? q("fRepeat").checked : false,
      repeat_until: q("fUntil") ? q("fUntil").value : null,
    });

    const showProblems = (data, canForce) => {
      const box = q("fConf");
      box.style.display = "block";
      box.className = "fc-conflicts full" + (data.hard ? "" : " warn");
      const items = (data.problems || []).flatMap(p =>
        (p.conflicts || p.warnings || []).map(c => `${p.date}: ${c.title} (${c.operator}, ${c.time})${c.kind === "closure" ? " — closure" : ""}`));
      box.innerHTML = `<strong>${esc(data.error)}</strong><ul>${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` +
        (data.hard ? `<p style="margin:6px 0 0">Change the time, courts, or Court Share settings.</p>`
          : (canForce ? `<button class="btn" id="fForce" style="margin-top:8px">Book anyway (shared)</button>` : ""));
      if (!data.hard && canForce) q("fForce").addEventListener("click", () => save(true));
    };

    const save = async (force) => {
      const payload = { ...gather(), force: !!force };
      if (!payload.title) return showProblems({ error: "Give the booking a title.", problems: [] }, false);
      const res = existing
        ? await api(`/api/admin/facility/bookings/${existing.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, scope: "one" }) })
        : await api("/api/admin/facility/bookings", { method: "POST", body: JSON.stringify(payload) });
      if (res.ok) { close(); load(); }
      else if (res.status === 409) showProblems(res.data, true);
      else showProblems({ error: res.data.error || "Could not save the booking.", problems: [] }, false);
    };
    q("fSave").addEventListener("click", () => save(false));
    if (q("fSaveSeries")) q("fSaveSeries").addEventListener("click", async () => {
      const res = await api(`/api/admin/facility/bookings/${existing.id}`,
        { method: "PATCH", body: JSON.stringify({ ...gather(), scope: "series" }) });
      if (res.ok) { close(); load(); } else if (res.status === 409) showProblems(res.data, true);
      else showProblems({ error: res.data.error || "Could not save the series.", problems: [] }, false);
    });
    if (q("fDelete")) q("fDelete").addEventListener("click", async () => {
      let scope = "one";
      if (existing.series_id) {
        scope = confirm("OK = delete this and all FUTURE weeks in the series.\nCancel = ask again for just this one.") ? "series" : "one";
        if (scope === "one" && !confirm("Delete just this booking?")) return;
      } else if (!confirm(`Delete "${existing.title}"?`)) return;
      const res = await api(`/api/admin/facility/bookings/${existing.id}?scope=${scope}`, { method: "DELETE" });
      if (res.ok) { close(); load(); } else alert(res.data.error || "Could not delete.");
    });
  }

  /* ---------- CSV import ---------- */
  function openImport() {
    const ov = document.createElement("div");
    ov.className = "fc-overlay";
    ov.innerHTML = `<div class="fc-modal fc-import" role="dialog" aria-modal="true" aria-label="Import bookings from CSV">
      <h2 style="margin:0 0 8px;font-size:18px">Import bookings from CSV</h2>
      <p style="margin:0 0 10px;font-size:13.5px;color:var(--text-muted)">
        Needs columns: <strong>Date, Start, End, Title, Operator</strong>. Recognized extras:
        Spaces/Booked As, Court Share, Staff, Bar, Catering, Door Charge, POC Name/Email/Phone, Attendees, Notes, Closure.
        Unknown columns are ignored. Rows with hard conflicts are skipped and reported.</p>
      <textarea id="iCsv" placeholder="Date,Start,End,Title,Operator,Booked As,Court Share&#10;8/2/2026,6:00 PM,9:00 PM,Open Gym,Boomtown Volleyball,Full Hardwood,No"></textarea>
      <div class="report" id="iReport"></div>
      <div class="fc-actions">
        <button class="btn ghost" id="iCancel">Cancel</button>
        <button class="btn ghost" id="iDry">Preview (dry run)</button>
        <button class="btn" id="iGo" disabled>Import</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const q = (id) => ov.querySelector("#" + id);
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    q("iCancel").addEventListener("click", close);
    const run = async (dry) => {
      const res = await api("/api/admin/facility/import", { method: "POST", body: JSON.stringify({ csv: q("iCsv").value, dry_run: dry }) });
      const rep = q("iReport");
      if (!res.ok) { rep.innerHTML = `<span style="color:var(--danger)">${esc(res.data.error || "Import failed.")}</span>`; return; }
      const d = res.data;
      rep.innerHTML = `<strong>${d.dry_run ? "Preview" : "Done"}:</strong> ${d.imported} row(s) ${d.dry_run ? "would import" : "imported"}.` +
        (d.skipped.length ? `<br/>Skipped/notes: ${d.skipped.map(s => `line ${s.line} (${esc(s.reason)})`).join(", ")}` : "") +
        (d.errors.length ? `<br/><span style="color:var(--danger)">Errors: ${d.errors.map(e2 => `line ${e2.line}: ${esc(e2.error)}`).join("; ")}</span>` : "");
      q("iGo").disabled = !(d.dry_run && d.imported > 0);
      if (!d.dry_run) { setTimeout(() => { close(); load(); }, 900); }
    };
    q("iDry").addEventListener("click", () => run(true));
    q("iGo").addEventListener("click", () => run(false));
  }

  /* ---------- date/time utils ---------- */
  function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function addDays(s, n) { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function weekRange(s) { const d = new Date(s + "T00:00:00"); const dow = (d.getDay() + 6) % 7; return [addDays(s, -dow), addDays(s, 6 - dow)]; } // Mon–Sun
  function longDate(s) { return new Date(s + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
  function shortDate(s) { return new Date(s + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  function hourLabel(m) { const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}${h >= 12 ? "p" : "a"}`; }
  function fmtMin(m) { const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0"); return `${((h + 11) % 12) + 1}:${mm}${h >= 12 ? "p" : "a"}`; }
  function toHM(m) { return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }

  load();
})();
/* Changelog: v1.0 (2026-07-24) — initial page logic for Module 12 Phase A. */
