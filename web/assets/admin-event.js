/* Boomtown Platform — Event Management screen
   Version: v0.5.0 · Date: 2026-08-05 · Ships in: v0.90.0
   v0.5.0 (roadmap §-1 Block D1, audit R4): KING OF THE COURT IS FINALLY STARTABLE BY A HUMAN.
   POST /api/admin/events/:id/kotc and POST /api/admin/kotc/:id/players existed and were tested
   since v0.80.0 — and no file in web/ called either, so a fully-built format could not be
   started from the UI and the court board's empty state pointed at a control that did not
   exist. This screen now carries the KOTC card: sessions for this event, "+ New session"
   (name / points to / move up / rounds), and an entry-list picker searching /api/admin/members.
   Creating a session opens the picker immediately — the entry list is always the next thing,
   so the operator is not made to find a second button (owner req #19).
   v0.4.1 · 2026-08-02
   One screen per event: edit details, publish/cancel, duplicate, save-as-template,
   recurring “this and future” editing, registrations (remind / mark paid), CSV download,
   and the public sign-up + pay link (register.html?event=N). */
(async function () {
  const { api, guard, esc, money, fmtDT, openModal, closeModal, downloadText } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  /* v0.52.0: org switcher is single-source now — populated + handled by admin-nav.js v2.19.
     Change lands on admin-events.html via body[data-org-switch-href]: this event id doesn't
     exist under the new org, so a plain reload would 404. */

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
    loadKotc();
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

      <div class="card" style="padding:16px;margin-bottom:18px">
        <h2 style="font-size:16px;margin:0 0 6px">King of the Court</h2>
        <p class="help-text">Run a King or Queen of the Court night on this event: create a session,
          add the entry list, then seat the nets on the <a href="admin-kotc.html">court board</a>.
          Every player gets their own score link at entry.</p>
        <div id="kotcList" style="margin-bottom:10px"></div>
        <button class="btn ghost" id="kotcNew">+ New session</button>
      </div>

      <div class="page-head">
        <h2 style="font-size:17px;margin:0">Registrations</h2>
        <div class="spacer"></div>
        <button class="btn ghost" id="csvBtn">⬇ Download CSV</button>
      </div>
      <div id="regsWrap" class="card" style="padding:0"><div class="empty">Loading…</div></div>`;

    document.getElementById("copyLink").addEventListener("click", () =>
      navigator.clipboard.writeText(regLink()).then(() => alert("Link copied.")));
    document.getElementById("kotcNew").addEventListener("click", newSession);
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
      const nn = r.ok && r.data.cancelled_notice ? ` ${r.data.cancelled_notice.notified} registered member(s) notified in-app. ${r.data.cancelled_notice.note}` : "";
      alert(r.ok ? `Cancelled ${r.data.cancelled} events.${nn}` : (r.data.error || "Failed."));
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
    // B16 (v0.129.0): cancelling now tells the registered people, and the director sees what
    // actually happened — including, honestly, that nothing was emailed when no mail key is set.
    else if (r.data.cancelled_notice) {
      const n = r.data.cancelled_notice;
      alert(`Cancelled. ${n.notified} registered member${n.notified === 1 ? "" : "s"} notified in-app. ${n.note}`);
    }
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

  /* ---------- King of the Court (Block D1) ---------- */

  async function loadKotc() {
    const wrap = document.getElementById("kotcList");
    if (!wrap) return;
    const r = await api("/api/admin/kotc");
    if (!r.ok) { wrap.innerHTML = `<span class="help-text">Couldn't load the sessions — reload to try again.</span>`; return; }
    const mine = (r.data.sessions || []).filter((s) => s.event_id === id);
    if (!mine.length) {
      wrap.innerHTML = `<span class="help-text">No sessions on this event yet.</span>`;
      return;
    }
    wrap.innerHTML = mine.map((s) => `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--border)">
        <b>${esc(s.name)}</b>
        <span class="help-text">${s.players} player${s.players === 1 ? "" : "s"}
          · ${s.rounds ? `round ${s.rounds}` : "not started"} · games to ${s.points_to}</span>
        <div class="spacer"></div>
        <button class="btn ghost" data-kotc-add="${s.id}">Add players</button>
        <a class="btn ghost" href="admin-kotc.html" style="text-decoration:none">Court board →</a>
      </div>`).join("");
    wrap.querySelectorAll("[data-kotc-add]").forEach((b) =>
      b.addEventListener("click", () => addPlayers(Number(b.dataset.kotcAdd))));
  }

  function newSession() {
    const back = openModal(`
      <h2>New King of the Court session</h2>
      <div class="field"><label>Session name</label><input id="ks_name" value="King of the Court" /></div>
      <div class="row2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>Games to</label><input id="ks_pts" type="number" min="1" value="21" /></div>
        <div class="field"><label>Move up per round</label><input id="ks_up" type="number" min="1" value="1" /></div>
      </div>
      <div class="field"><label>Rounds planned (optional)</label><input id="ks_rounds" type="number" min="1" placeholder="decide on the night" /></div>
      <div class="actions"><button class="btn ghost" id="ks_cancel">Cancel</button><button class="btn" id="ks_go">Create session</button></div>`);
    back.querySelector("#ks_cancel").addEventListener("click", closeModal);
    back.querySelector("#ks_go").addEventListener("click", async () => {
      const r = await api(`/api/admin/events/${id}/kotc`, { method: "POST", body: JSON.stringify({
        name: back.querySelector("#ks_name").value.trim() || "King of the Court",
        points_to: Number(back.querySelector("#ks_pts").value) || 21,
        move_up: Number(back.querySelector("#ks_up").value) || 1,
        rounds_planned: Number(back.querySelector("#ks_rounds").value) || null,
      }) });
      if (!r.ok) return alert(r.data.error || "Couldn't create the session.");
      closeModal();
      loadKotc();
      addPlayers(r.data.session_id); // the entry list is always the next step — open it, don't make them find it
    });
  }

  function addPlayers(sessionId) {
    const picked = new Map(); // contact_id → name; survives across searches so re-searching never unticks anyone
    const back = openModal(`
      <h2>Add players to the entry list</h2>
      <p class="help-text">Search your members and tick everyone playing. Re-adding somebody keeps
        their existing score link.</p>
      <div class="field"><label>Search members</label><input id="kp_q" placeholder="name, email or phone" /></div>
      <div id="kp_list" role="group" aria-label="Members found" style="max-height:260px;overflow:auto;margin:8px 0"></div>
      <div class="actions">
        <span id="kp_count" class="help-text" role="status" aria-live="polite"></span>
        <div class="spacer"></div>
        <button class="btn ghost" id="kp_cancel">Close</button>
        <button class="btn" id="kp_go" disabled>Add players</button>
      </div>`);
    const listEl = back.querySelector("#kp_list");
    const countEl = back.querySelector("#kp_count");
    const goBtn = back.querySelector("#kp_go");
    const sayCount = () => {
      countEl.textContent = picked.size ? `${picked.size} selected` : "";
      goBtn.disabled = !picked.size;
      goBtn.textContent = picked.size ? `Add ${picked.size} player${picked.size === 1 ? "" : "s"}` : "Add players";
    };
    const paint = (rows) => {
      listEl.innerHTML = rows.length ? rows.map((c) => `
        <label style="display:flex;align-items:center;gap:10px;min-height:44px;padding:0 4px;cursor:pointer">
          <input type="checkbox" data-cid="${c.id}" ${picked.has(c.id) ? "checked" : ""} />
          <span>${esc(c.full_name || c.email || "(no name)")}</span>
          <span class="help-text">${esc(c.email || "")}</span>
        </label>`).join("")
        : `<p class="help-text" style="padding:8px 4px">Nobody matches that search.</p>`;
      listEl.querySelectorAll("input[data-cid]").forEach((cb) => {
        cb.addEventListener("change", () => {
          const c = rows.find((x) => x.id === Number(cb.dataset.cid));
          if (cb.checked) picked.set(c.id, c.full_name || c.email || "");
          else picked.delete(Number(cb.dataset.cid));
          sayCount();
        });
      });
    };
    let t = null;
    const search = async () => {
      const q = back.querySelector("#kp_q").value.trim();
      const r = await api("/api/admin/members" + (q ? "?q=" + encodeURIComponent(q) : ""));
      if (!r.ok) { listEl.innerHTML = `<p class="help-text" style="padding:8px 4px">${esc(r.data.error || "Couldn't search members.")}</p>`; return; }
      paint(r.data.members || []);
    };
    back.querySelector("#kp_q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(search, 250); });
    back.querySelector("#kp_cancel").addEventListener("click", closeModal);
    goBtn.addEventListener("click", async () => {
      const r = await api(`/api/admin/kotc/${sessionId}/players`, { method: "POST", body: JSON.stringify({
        players: [...picked.keys()].map((cid) => ({ contact_id: cid })),
      }) });
      if (!r.ok) return alert(r.data.error || "Couldn't add the players.");
      closeModal();
      loadKotc();
    });
    search(); // first paint is the member list unfiltered — something to tick with zero typing
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
        <td>${g.team_id
          ? `<button class="btn ghost" type="button" data-roster="${g.team_id}" aria-label="Open the roster for ${esc(g.team_name || "this team")}">${esc(g.team_name || "Team")}</button>`
          : esc(g.team_name || g.captain_name || "—")}${g.level ? ` <span class="help-text">${esc(g.level)}</span>` : ""}</td>
        <td>${esc(g.email || "")}${g.phone ? `<div class="help-text">${esc(g.phone)}</div>` : ""}</td>
        <td><span class="chip ${g.status}">${g.status}</span></td>
        <td>${fmtDT(g.created_at)}</td>
        <td>
          ${["pending", "email-sent"].includes(g.status) ? `<button class="btn ghost" data-remind="${g.id}">Remind</button>` : ""}
          ${g.status === "cash-pending" ? `<button class="btn ghost" data-paid="${g.id}">Mark collected</button>` : ""}
        </td></tr>`).join("")}
    </tbody></table>`;
    // W-A (v0.92.0): the team a registration created is one tap away — and editable there.
    wrap.querySelectorAll("[data-roster]").forEach(b => b.addEventListener("click", () =>
      window.BT_ROSTER && window.BT_ROSTER.open(Number(b.dataset.roster))));
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
