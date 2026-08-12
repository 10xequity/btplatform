/* Boomtown Platform — Registrations Admin
   Version: v0.3.1 · Date: 2026-08-02
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

  /* v0.52.0: theme is single-source now — pre-paint via the shared <head> snippet, toggle in admin-nav.js v2.19. */
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
    /* v0.52.0: org switcher is single-source now — populated + handled by admin-nav.js v2.19. */
    loadEvents();
  })();

  async function loadEvents() {
    const r = await api("/api/events");
    const events = r.data.events || [];
    $("eventSelect").innerHTML = `<option value="">— choose event —</option>` +
      events.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
    $("eventSelect").onchange = () => {
      eventId = $("eventSelect").value || null;
      $("scoreLinksCard").hidden = true;
      // H-3: the status filters belong to one event's list. Clearing the picker returns to the
      // all-events overview rather than leaving an empty table behind.
      $("regFilters").hidden = !eventId;
      eventId ? loadRegs() : loadOverview();
    };
    // WF-5 H-1 (v0.139.0): the manager hub points this page at ONE event via ?event=N. ADDITIVE
    // on purpose — with no ?event= the page behaves exactly as it did from the rail, which is what
    // makes the hub reversible and what lets this page keep its own way in. An id that is not in
    // this org's list is ignored rather than forced: the picker is the org's own truth.
    const fromUrl = Number(new URLSearchParams(location.search).get("event")) || 0;
    if (fromUrl && events.some((e) => e.id === fromUrl)) {
      $("eventSelect").value = String(fromUrl);
      eventId = String(fromUrl);
      $("regFilters").hidden = false;   // H-3: an event is chosen, so its status filters apply
      loadRegs();
    } else {
      // WF-5 H-3 (v0.141.0): this used to say "Pick an event above." The owner's item 6 asks for
      // the opposite — "all the events and registrations listed for easy access and financial
      // review" — so the no-event state IS the all-events overview now. Choosing an event still
      // switches to that event's list, and the hub always passes ?event=, so its Registrations tab
      // is unaffected.
      loadOverview();
    }
  }

  /* ---------- WF-5 H-3: the all-events financial overview ----------
     NO NEW ROUTE AND NO NEW QUERY. `GET /api/admin/reports/sales` already returns per_event with
     exactly these columns, and `revenueCsv` already renders that same payload as the CSV — the
     "one query, two renderers" this unit was queued to build turned out to be built already
     (reports_export.test.mjs now pins it, because an unpinned true thing is one refactor from
     being false). This screen is the third renderer of the same numbers, never a second source.

     It is a MODE of this page rather than a new page: the rail's Registrations entry should land
     on it, per item 6, and a new page would need a rail slot beside the one that already means
     "registrations". The mode is chosen by the ?event= parameter the hub already passes. */
  async function loadOverview() {
    $("regTable").innerHTML = "<p>Loading…</p>";
    const r = await api("/api/admin/reports/sales");
    if (!r.ok) { $("regTable").innerHTML = `<p>${esc(r.data.error || "Couldn't load the events.")}</p>`; return; }
    const rows = r.data.per_event || [];
    if (!rows.length) {
      $("regTable").innerHTML = "<p>No events yet. Create one on Events &amp; Programs and it will appear here.</p>";
      return;
    }
    const money = window.BT_ADMIN.money;          // ONE money formatter, not a second one
    const totals = rows.reduce((a, e) => ({
      regs: a.regs + (e.registrations || 0),
      card: a.card + (e.card_cents || 0),
      cash: a.cash + (e.cash_cents || 0),
      total: a.total + (e.total_cents || 0),
    }), { regs: 0, card: 0, cash: 0, total: 0 });

    $("regTable").innerHTML = `<table class="regs"><thead><tr>
        <th>Event</th><th>Date</th><th>Type</th><th>Program</th>
        <th>Registered</th><th>Paid (card)</th><th>Paid (cash)</th><th>Total</th><th></th>
      </tr></thead><tbody>` +
      rows.map((e) => `<tr>
        <td>${esc(e.event)}</td>
        <td>${e.starts_at ? esc(String(e.starts_at).slice(0, 10)) : "—"}</td>
        <td>${esc(e.type || "")}</td>
        <td>${esc(e.program || "")}</td>
        <td>${e.registrations || 0}</td>
        <td>${money(e.card_cents || 0)}</td>
        <td>${money(e.cash_cents || 0)}</td>
        <td><strong>${money(e.total_cents || 0)}</strong></td>
        <td><a class="btn ghost" href="admin-manager.html?event=${e.event_id}"
               aria-label="Open the manager for ${esc(e.event)}">Manage →</a></td>
      </tr>`).join("") +
      `</tbody><tfoot><tr>
        <td colspan="4"><strong>${rows.length} event${rows.length === 1 ? "" : "s"}</strong></td>
        <td><strong>${totals.regs}</strong></td>
        <td><strong>${money(totals.card)}</strong></td>
        <td><strong>${money(totals.cash)}</strong></td>
        <td><strong>${money(totals.total)}</strong></td>
        <td></td>
      </tr></tfoot></table>`;
    say(`${rows.length} event${rows.length === 1 ? "" : "s"}. Choose one above to work its registrations.`);
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
        <th>Team</th><th>Captain</th><th>Email</th><th>Status</th><th>Waivers</th><th>Registered</th><th>Reminded</th><th></th>
      </tr></thead><tbody>` +
      regs.map((x) => `<tr>
        <td>${esc(x.team_name)}${x.level ? ` <span style="opacity:.6">(${esc(x.level)})</span>` : ""}</td>
        <td>${esc(x.captain_name || "")}</td>
        <td>${esc(x.email || "")}</td>
        <td><span class="chip ${esc(x.status)}">${esc(x.status)}</span></td>
        <td>${waiverChip(x)}</td>
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

  /* WF-4 (v0.136.0): the waiver mark the owner asked for. Counts arrive from the server through
     the door gate's own predicate (waiver_signed / waiver_members / waiver_no_email) — this page
     renders what it is given and never re-judges. Complete borrows the paid chip's green;
     incomplete borrows pending's amber — the page's existing attention idiom, nothing invented. */
  function waiverChip(x) {
    const total = x.waiver_members ?? 0, signed = x.waiver_signed ?? 0;
    if (!total) return "—";
    const done = signed >= total;
    const noAddr = x.waiver_no_email || 0;
    const title = done ? "Every listed player has a current waiver"
      : `${signed} of ${total} signed${noAddr ? ` · ${noAddr} unsigned with no email — catch them at check-in` : ""}`;
    return `<span class="chip ${done ? "paid" : "pending"}" title="${esc(title)}">${signed}/${total} waivers</span>`;
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

  /* Hand this event's registrants to Marketing as a segment. The registration list is where an
     operator already is when they decide to email the people on it, so the trip is one tap from
     here and a confirm there — no retyping the event, no hunting for it in a second screen. */
  $("emailRegistrants").onclick = () => {
    if (!eventId) { say("Pick an event first.", true); return; }
    location.href = `admin-marketing.html?event=${encodeURIComponent(eventId)}`;
  };

  /* WF-4: chase this event's unsigned waivers now, instead of waiting for the nightly sweep.
     The server applies the same 2-day dedupe the sweep uses and answers with an honest sentence
     (who was reminded, who was skipped as recently nagged, who has no address, and — with no
     mail key set — that nothing was emailed). This button just relays that sentence. */
  $("waiverRemindBtn").onclick = async () => {
    if (!eventId) { say("Pick an event first.", true); return; }
    const btn = $("waiverRemindBtn");
    btn.disabled = true;
    const r = await api(`/api/events/${eventId}/waiver-reminders`, { method: "POST" });
    btn.disabled = false;
    if (!r.ok) { say(esc(r.data.error || "Couldn't send waiver reminders."), true); return; }
    say(esc(r.data.note));
    loadRegs();
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
