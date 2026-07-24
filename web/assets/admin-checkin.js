/* Boomtown Platform — Door Check-in
   File: web/assets/admin-checkin.js · Version: v1.0 · Date: 2026-07-23 · Ships in: v0.9.0
   One tap = in, tap again = undo. Waiver flag = no valid waiver on file (spot it before they play).
   Search filters as you type. QR panel mints/rotates the public self-check-in token. */

(function () {
  const { api, guard, esc, openModal, closeModal } = window.BT_ADMIN;
  const $ = id => document.getElementById(id);
  let eventId = null, data = null, filter = "";

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
    sw.onchange = () => { localStorage.setItem("bt_org", sw.value); loadEvents(); };
    await loadEvents();
    $("search").addEventListener("input", e => { filter = e.target.value.toLowerCase(); renderRoster(); });
    $("walkinBtn").onclick = walkinModal;
    $("qrBtn").onclick = toggleQr;
  }

  async function loadEvents() {
    const r = await api("/api/events");
    const evs = (r.data.events || []).filter(e => ["published", "in_progress"].includes(e.status));
    const sel = $("eventSelect");
    sel.innerHTML = `<option value="">Choose event…</option>` +
      evs.map(e => `<option value="${e.id}">${esc(e.name)}${e.starts_at ? " · " + esc(e.starts_at.slice(0, 10)) : ""}</option>`).join("");
    sel.onchange = () => { eventId = +sel.value || null; $("qrCard").hidden = true; eventId ? load() : null; };
    // Preselect today's event if there's exactly one starting today.
    const today = new Date().toISOString().slice(0, 10);
    const todays = evs.filter(e => (e.starts_at || "").slice(0, 10) === today);
    if (todays.length === 1) { sel.value = todays[0].id; eventId = todays[0].id; load(); }
  }

  async function load() {
    const r = await api(`/api/events/${eventId}/roster`);
    if (!r.ok) { say(r.data.error || "Couldn't load the roster.", false); return; }
    data = r.data;
    renderRoster();
  }

  function renderRoster() {
    if (!data) return;
    $("progress").innerHTML = `<b>${data.checked_in}</b> / ${data.total} in`;
    const byTeam = {};
    for (const p of data.roster) {
      if (filter && !(`${p.member_name} ${p.team_name}`.toLowerCase().includes(filter))) continue;
      (byTeam[p.team_name] = byTeam[p.team_name] || []).push(p);
    }
    let html = Object.entries(byTeam).map(([team, ps]) => `
      <div class="team-head">${esc(team)}</div>` + ps.map(p => `
      <button class="ck-card${p.attendance_id ? " in" : ""}" data-tm="${p.team_member_id}"
        aria-pressed="${p.attendance_id ? "true" : "false"}">
        <div class="who"><div class="n">${esc(p.member_name)}${p.waiver_ok ? "" : `<span class="waiver-flag no">NO WAIVER</span>`}</div>
          <div class="t">${p.checked_in_at ? "in at " + esc(p.checked_in_at.slice(11, 16)) : "tap to check in"}</div></div>
        <div class="mark" aria-hidden="true">✓</div>
      </button>`).join("")).join("");
    if (data.walkins.length && !filter) {
      html += `<div class="team-head">Walk-ins</div>` + data.walkins.map(w => `
        <div class="ck-card in" style="cursor:default"><div class="who"><div class="n">${esc(w.member_name)}</div>
          <div class="t">${esc(w.method)} · ${esc((w.checked_in_at || "").slice(11, 16))}</div></div>
          <div class="mark">✓</div></div>`).join("");
    }
    $("roster").innerHTML = html || `<p class="empty">${filter ? "No names match." : "No roster yet — teams appear here after registration."}</p>`;
    $("roster").querySelectorAll("[data-tm]").forEach(b => b.onclick = () => toggle(b));
  }

  async function toggle(btn) {
    btn.disabled = true;
    const r = await api(`/api/events/${eventId}/checkin`, { method: "POST",
      body: JSON.stringify({ team_member_id: +btn.dataset.tm }) });
    btn.disabled = false;
    if (!r.ok) { say(r.data.error || "That didn't save.", false); return; }
    load();
  }

  function walkinModal() {
    if (!eventId) { say("Pick an event first.", false); return; }
    const back = openModal(`
      <h2>Walk-in check-in</h2>
      <div class="field"><label for="wName">Name *</label><input id="wName" autocomplete="off" /></div>
      <div class="field"><label for="wEmail">Email (links them to a member record if it matches)</label>
        <input id="wEmail" type="email" autocomplete="off" /></div>
      <div class="actions"><button class="btn ghost" data-close>Cancel</button>
        <button class="btn" id="wSave">Check in</button></div>`);
    back.querySelector("[data-close]").onclick = closeModal;
    back.querySelector("#wSave").onclick = async () => {
      const r = await api(`/api/events/${eventId}/checkin-walkin`, { method: "POST",
        body: JSON.stringify({ name: back.querySelector("#wName").value, email: back.querySelector("#wEmail").value }) });
      closeModal();
      say(r.ok ? "Walk-in checked in." : (r.data.error || "Couldn't add the walk-in."), r.ok);
      if (r.ok) load();
    };
  }

  async function toggleQr() {
    if (!eventId) { say("Pick an event first.", false); return; }
    const card = $("qrCard");
    if (!card.hidden) { card.hidden = true; return; }
    await mint(false);
    card.hidden = false;
    $("rotate").onclick = () => mint(true);
  }

  async function mint(rotating) {
    const r = await api(`/api/events/${eventId}/checkin-token`, { method: "POST" });
    if (!r.ok) { say(r.data.error || "Couldn't create the check-in link.", false); return; }
    const url = location.origin + location.pathname.replace(/[^/]*$/, "") + "checkin.html?t=" + r.data.token;
    $("qrUrl").textContent = url;
    $("copyUrl").onclick = () => navigator.clipboard.writeText(url);
    $("qr").innerHTML = "";
    if (window.QRCode) new QRCode($("qr"), { text: url, width: 168, height: 168 });
    else $("qr").textContent = "QR library blocked — use the link.";
    if (rotating) say("Code rotated — the old QR/link is dead.", true);
  }

  function say(text, ok = true) {
    $("status").innerHTML = `<p class="${ok ? "notice-ok" : "notice-err"}">${esc(text)}</p>`;
  }
})();
