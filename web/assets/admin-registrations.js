/* Boomtown Platform — Registrations Admin
   Version: v0.3.0 · Date: 2026-07-21
   Staff-gated. Unpaid list + 1-click reminder (≤3 clicks per spec §4), cash collect,
   Google Forms CSV import (client-side RFC-4180 parse + header auto-mapping), captain score links. */

(function () {
  const API = (window.BT_CONFIG || {}).apiBase;
  const $ = (id) => document.getElementById(id);
  let bearer = sessionStorage.getItem("bt_token") || null;
  let currentFilter = "", eventId = null;

  if (!API || API.includes("PENDING")) {
    $("app").innerHTML = "<div class='card'><h1>One moment</h1><p>Settings still loading. Hold <strong>Ctrl</strong> and press <strong>F5</strong>.</p></div>";
    return;
  }

  const savedTheme = localStorage.getItem("bt_theme");
  document.documentElement.dataset.theme = savedTheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  $("themeToggle").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("bt_theme", next);
  };

  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (bearer) headers["Authorization"] = "Bearer " + bearer;
    const orgId = localStorage.getItem("bt_org");
    if (orgId) headers["X-Org-Id"] = orgId;
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers, credentials: "include" }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, networkError: true,
        data: { error: "Can't reach the server. Check your internet connection, hard-refresh (Ctrl+F5), and try again." } };
    }
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (t, err) => { $("status").innerHTML = `<span style="color:${err ? "#c55" : "inherit"}">${t}</span>`; };

  /* ---------- boot ---------- */
  (async function boot() {
    if (!bearer) { location.href = "index.html"; return; }
    const me = await api("/api/me");
    if (!me.ok) { location.href = "index.html"; return; }
    const orgs = (await api("/api/orgs")).data.orgs || [];
    const sw = $("orgSwitcher");
    sw.innerHTML = orgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("");
    const saved = localStorage.getItem("bt_org");
    if (saved) sw.value = saved;
    sw.onchange = () => { localStorage.setItem("bt_org", sw.value); loadEvents(); };
    loadEvents();
  })();

  async function loadEvents() {
    const r = await api("/api/events");
    const events = r.data.events || [];
    $("eventSelect").innerHTML = `<option value="">— choose event —</option>` +
      events.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
    $("eventSelect").onchange = () => { eventId = $("eventSelect").value || null; $("scoreLinksCard").hidden = true; loadRegs(); };
    $("regTable").innerHTML = "<p>Pick an event above.</p>";
  }

  /* ---------- registrations table ---------- */
  document.querySelectorAll("[data-filter]").forEach((b) => {
    b.onclick = () => {
      currentFilter = b.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      loadRegs();
    };
  });

  async function loadRegs() {
    if (!eventId) return;
    const q = currentFilter === "unpaid" ? "" : currentFilter ? `?status=${currentFilter}` : "";
    const r = await api(`/api/events/${eventId}/registrations${q}`);
    if (!r.ok) { say(esc(r.data.error), true); return; }
    let regs = r.data.registrations || [];
    if (currentFilter === "unpaid") regs = regs.filter((x) => ["pending", "email-sent", "cash-pending"].includes(x.status));
    if (!regs.length) { $("regTable").innerHTML = "<p>No registrations here yet.</p>"; return; }
    $("regTable").innerHTML = `<table class="regs"><thead><tr>
        <th>Team</th><th>Captain</th><th>Email</th><th>Status</th><th>Registered</th><th>Reminded</th><th></th>
      </tr></thead><tbody>` +
      regs.map((x) => `<tr>
        <td>${esc(x.team_name)}${x.level ? ` <span style="opacity:.6">(${esc(x.level)})</span>` : ""}</td>
        <td>${esc(x.captain_name || "")}</td>
        <td>${esc(x.email || "")}</td>
        <td><span class="chip ${esc(x.status)}">${esc(x.status)}</span></td>
        <td>${esc((x.created_at || "").slice(0, 10))}</td>
        <td>${esc((x.last_reminded_at || "—").slice(0, 10))}</td>
        <td>
          ${["pending", "email-sent"].includes(x.status) && x.checkout_url ? `<button class="btn ghost" data-remind="${x.id}">Remind</button>` : ""}
          ${x.status === "cash-pending" ? `<button class="btn ghost" data-cash="${x.id}">Mark paid</button>` : ""}
        </td>
      </tr>`).join("") + "</tbody></table>";
    document.querySelectorAll("[data-remind]").forEach((b) => { b.onclick = () => remind(b.dataset.remind, b); });
    document.querySelectorAll("[data-cash]").forEach((b) => { b.onclick = () => markPaid(b.dataset.cash); });
  }

  async function remind(id, btn) {
    btn.disabled = true;
    const r = await api(`/api/registrations/${id}/remind`, { method: "POST" });
    btn.disabled = false;
    if (!r.ok) { say(esc(r.data.error), true); return; }
    if (r.data.mode === "sandbox") {
      say(`${esc(r.data.message)}<br/><code>${esc(r.data.checkout_url)}</code> <button class="btn ghost" id="cpL">Copy link</button>`);
      $("cpL").onclick = () => navigator.clipboard.writeText(r.data.checkout_url).then(() => say("Link copied ✓"));
    } else say(esc(r.data.message));
    loadRegs();
  }

  async function markPaid(id) {
    const r = await api(`/api/registrations/${id}/mark-paid`, { method: "POST" });
    say(esc(r.data.message || r.data.error), !r.ok);
    loadRegs();
  }

  /* ---------- registration link ---------- */
  $("copyRegLink").onclick = () => {
    if (!eventId) { say("Pick an event first.", true); return; }
    const link = location.href.replace(/admin-registrations\.html.*/, `register.html?event=${eventId}`);
    navigator.clipboard.writeText(link).then(() => say(`Registration link copied ✓ <code>${esc(link)}</code>`));
  };

  /* ---------- captain score links ---------- */
  $("scoreLinksBtn").onclick = async () => {
    if (!eventId) { say("Pick an event first.", true); return; }
    const r = await api(`/api/events/${eventId}/score-links`, { method: "POST" });
    if (!r.ok) { say(esc(r.data.error), true); return; }
    $("scoreLinksCard").hidden = false;
    $("scoreLinksList").innerHTML = (r.data.links || []).map((l) => `
      <div class="linkrow"><strong>${esc(l.team)}</strong><code>${esc(l.url)}</code>
        <button class="btn ghost" data-copy="${esc(l.url)}">Copy</button></div>`).join("") || "<p>No teams yet — add teams first.</p>";
    document.querySelectorAll("[data-copy]").forEach((b) => {
      b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = "Copied ✓"; setTimeout(() => (b.textContent = "Copy"), 1500); });
    });
  };

  /* ---------- CSV import (Google Forms response sheets) ---------- */
  function parseCSV(text) { // minimal RFC-4180: quoted fields, embedded commas/newlines
    const rows = []; let row = [], cur = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.some((x) => x !== "")) rows.push(row);
        row = [];
      } else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x !== "")) rows.push(row); }
    return rows;
  }

  // Header auto-mapping for the live Google Forms column names.
  const HEADER_MAP = [
    [/email/i, "email"],
    [/team\s*name/i, "team_name"],
    [/captain.*name|name.*captain/i, "captain_name"],
    [/phone/i, "phone"],
    [/level/i, "level"],
    [/gender|division/i, "gender_division"],
    [/city/i, "city"],
    [/state/i, "state"],
    [/instagram/i, "instagram"],
  ];

  $("csvFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !eventId) { say(eventId ? "No file chosen." : "Pick an event first.", true); return; }
    const text = await file.text();
    const grid = parseCSV(text);
    if (grid.length < 2) { say("That CSV looks empty (needs a header row + data rows).", true); return; }
    const headers = grid[0];
    const colFor = {};
    headers.forEach((h, idx) => {
      for (const [re, key] of HEADER_MAP) if (re.test(h) && !(key in colFor)) { colFor[key] = idx; break; }
    });
    const teammateCols = headers.map((h, idx) => (/teammate/i.test(h) && !/email/i.test(h) ? idx : -1)).filter((x) => x >= 0);
    if (!("email" in colFor) || !("team_name" in colFor)) {
      say(`Couldn't find Email and Team Name columns. Found headers: ${headers.map(esc).join(" · ")}`, true);
      return;
    }
    const rows = grid.slice(1).map((r) => ({
      email: r[colFor.email] || "", team_name: r[colFor.team_name] || "",
      captain_name: colFor.captain_name != null ? r[colFor.captain_name] : "",
      phone: colFor.phone != null ? r[colFor.phone] : "",
      level: colFor.level != null ? r[colFor.level] : "",
      gender_division: colFor.gender_division != null ? r[colFor.gender_division] : "",
      city: colFor.city != null ? r[colFor.city] : "", state: colFor.state != null ? r[colFor.state] : "",
      instagram: colFor.instagram != null ? r[colFor.instagram] : "",
      teammates: teammateCols.map((c) => r[c]).filter(Boolean),
      status: "paid", // historical imports were already paid via the old flow
    }));
    if (!confirm(`Import ${rows.length} rows into this event as PAID registrations? (Rows already registered are skipped.)`)) return;
    say("Importing…");
    const r = await api(`/api/events/${eventId}/import`, { method: "POST", body: JSON.stringify({ rows }) });
    if (!r.ok) { say(esc(r.data.error), true); return; }
    const sk = r.data.skipped || [];
    say(`Imported ${r.data.imported} ✓${sk.length ? ` · skipped ${sk.length}: ${sk.slice(0, 5).map((s) => `row ${s.row} (${esc(s.reason)})`).join(", ")}${sk.length > 5 ? "…" : ""}` : ""}`);
    e.target.value = "";
    loadRegs();
  };
})();
