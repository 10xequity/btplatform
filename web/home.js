/* Boomtown Platform — My Dashboard
   File: web/home.js · Version: v1.3.0 · Date: 2026-07-24 · Ships in: v0.14.0
   v1.3.0 (M12.5): waiver-status chips (self + children), Agreements card
   (/api/me/agreements), Request-court-time card gated by BT_CONFIG.RENTALS_ENABLED.
   RECOVERY of the lost v0.7.0 member dashboard. On load: silently links roster
   rows to this account (POST /api/profile/connect-teams), then renders the
   notification inbox, upcoming events, and teams (captains can send invites). */

(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const token = sessionStorage.getItem("bt_token");
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function headers() {
    const h = { "content-type": "application/json" };
    if (token) h["Authorization"] = "Bearer " + token;
    const org = localStorage.getItem("bt_org");
    if (org) h["X-Org-Id"] = org;
    return h;
  }
  async function api(path, opts = {}) {
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers: headers(), credentials: "include" }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Check your connection and refresh." } };
    }
  }
  const fmt = s => {
    if (!s) return "";
    const d = new Date(String(s).replace(" ", "T"));
    return isNaN(d) ? s : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  boot();
  async function boot() {
    if (!token) { location.href = "index.html"; return; }
    const me = await api("/api/profile/me");
    if (!me.ok) { location.href = "index.html"; return; }
    const first = ((me.data.contact && me.data.contact.full_name) || "").split(/\s+/)[0];
    if (first) $("hello").textContent = `Welcome back, ${first}`;
    api("/api/profile/connect-teams", { method: "POST" }); // fire-and-forget roster link
    loadMembership();
    loadNotifications(); loadUpcoming(); loadTeams();
    loadAgreements();
    setupRental();
  }

  async function loadAgreements() {
    const r = await api("/api/me/agreements");
    const strip = $("statusStrip");
    if (!r.ok) { if (strip) strip.innerHTML = ""; $("agrList").innerHTML = `<p class="help-text" style="margin:0">Couldn't load your agreements right now.</p>`; return; }
    const st = r.data.status || {};
    const chips = [];
    const one = (c, who) => chips.push(c.waiver_ok
      ? `<span class="chip ok">✓ ${esc(who)}: waiver signed${c.expires_at ? " · good through " + esc(String(c.expires_at).slice(0, 10)) : ""}</span>`
      : `<span class="chip warn">! ${esc(who)}: waiver needed · <a href="profile.html">sign now</a></span>`);
    if (st.self) one(st.self, "You");
    (st.children || []).forEach(k => one(k, k.name || "Child"));
    if (strip) strip.innerHTML = chips.join("");

    const rows = r.data.agreements || [];
    const label = a => (a.document_type === "waiver" ? "Liability waiver" : esc(a.document_type)) + (a.document_ref ? ` <span class="help-text">(${esc(a.document_ref)})</span>` : "");
    const render = (list) => list.map(a => `
      <div class="agr-row">
        <div><b>${label(a)}</b></div>
        <div>${esc(String(a.signed_at || "").slice(0, 10))}</div>
        <div class="sub">For ${esc(a.subject_name)} · signed by ${esc(a.signed_name)}${a.on_behalf ? " (guardian)" : ""}${a.expires_at ? " · expires " + esc(String(a.expires_at).slice(0, 10)) : ""}</div>
      </div>`).join("");
    if (!rows.length) {
      $("agrList").innerHTML = `<p class="help-text" style="margin:0">Nothing signed yet — your waiver appears here after your first registration.</p>`;
      return;
    }
    const first = rows.slice(0, 5);
    $("agrList").innerHTML = render(first) + (rows.length > 5
      ? `<button class="btn ghost" id="agrMore" style="margin-top:8px">Show all ${rows.length}</button>` : "");
    const more = $("agrMore");
    if (more) more.onclick = () => { $("agrList").innerHTML = render(rows); };
  }

  function setupRental() {
    const card = $("rentalCard");
    if (!card) return;
    if (!(window.BT_CONFIG && window.BT_CONFIG.RENTALS_ENABLED)) return; // hidden by owner decision
    card.hidden = false;
    $("rqSend").onclick = async () => {
      const btn = $("rqSend"); btn.disabled = true;
      const me = await api("/api/profile/me");
      const c = (me.ok && me.data.contact) || {};
      const r = await api("/api/rental-request", { method: "POST", body: JSON.stringify({
        name: c.full_name || c.display_name || "Member", email: c.email || "",
        date: $("rqDate").value, start: $("rqStart").value, end: $("rqEnd").value,
        spaces_text: $("rqSpaces").value, notes: $("rqNotes").value,
      }) });
      btn.disabled = false;
      $("rqMsg").innerHTML = `<p class="${r.ok ? "notice-ok" : "notice-err"}" style="margin:0">${esc(r.data.message || r.data.error || "Something went wrong.")}</p>`;
      if (r.ok) { $("rqSpaces").value = ""; $("rqNotes").value = ""; }
    };
  }

  async function loadNotifications() {
    const r = await api("/api/notifications");
    const list = r.ok ? r.data.notifications || [] : [];
    $("readAll").hidden = !list.some(n => !n.read_at);
    $("ntfList").innerHTML = list.length ? list.map(n => `
      <div class="ntf ${n.read_at ? "read" : ""}" data-id="${n.id}">
        <span class="dot" aria-hidden="true"></span>
        <div><div class="t">${esc(n.title || n.kind.replace(/_/g, " "))}</div>
          ${n.body ? `<div class="b">${esc(n.body)}</div>` : ""}</div>
        <span class="when">${esc((n.created_at || "").slice(5, 10))}</span>
      </div>`).join("") :
      `<p class="help-text" style="margin:0">You're all caught up. Event reminders and updates land here.</p>`;
    $("ntfList").querySelectorAll(".ntf:not(.read)").forEach(el => {
      el.style.cursor = "pointer";
      el.onclick = async () => {
        await api(`/api/notifications/${el.dataset.id}/read`, { method: "POST" });
        el.classList.add("read");
      };
    });
    $("readAll").onclick = async () => {
      await api("/api/notifications/read-all", { method: "POST" });
      loadNotifications();
    };
  }

  async function loadUpcoming() {
    const r = await api("/api/profile/upcoming");
    const rows = r.ok ? r.data.upcoming || [] : [];
    $("upList").innerHTML = rows.length ? rows.map(u => `
      <div class="up-row">
        <div class="nm"><b>${esc(u.name)}</b>
          <span>${fmt(u.starts_at)}${u.location ? " · " + esc(u.location) : ""}${u.full_name ? " · " + esc(u.full_name) : ""}</span></div>
        <a class="btn ghost" style="text-decoration:none" href="${API}/api/events/ics?event_id=${u.event_id}">Add to calendar</a>
      </div>`).join("") :
      `<p class="help-text" style="margin:0">Nothing on the calendar for you yet.
        <a href="schedule.html">See the schedule</a> and grab a spot.</p>`;
  }

  async function loadTeams() {
    const r = await api("/api/profile/teams");
    const teams = r.ok ? r.data.teams || [] : [];
    $("teamList").innerHTML = teams.length ? teams.map(t => `
      <div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="font-weight:700">${esc(t.name)} <span class="help-text" style="font-weight:400">· ${esc(t.event_name)}</span></div>
        ${t.members.map(m => `
          <div class="tm-member" data-tm="${m.id}">
            <span>${esc(m.name || "Unnamed")}${m.is_sub ? " (sub)" : ""}</span>
            ${m.connected
              ? `<span class="st ok">Connected</span>`
              : t.is_captain && m.email_on_file
                ? `<button class="btn ghost" data-invite="${m.id}">${m.invited ? "Invite again" : "Invite"}</button>`
                : `<span class="st">${m.email_on_file ? (m.invited ? "Invited" : "Not connected") : "No email on file"}</span>`}
          </div>`).join("")}
      </div>`).join("") :
      `<p class="help-text" style="margin:0">No teams yet — register for an event and your team shows up here.</p>`;
    $("teamList").querySelectorAll("[data-invite]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      const r2 = await api(`/api/team-members/${b.dataset.invite}/invite`, { method: "POST" });
      b.disabled = false;
      $("status").innerHTML = `<p class="${r2.ok ? "notice-ok" : "notice-err"}">${esc(r2.data.message || r2.data.error || "")}</p>`;
      if (r2.ok) loadTeams();
    });
  }

  async function loadMembership() {
    const box = $("memBox");
    if (!box) return;
    const r = await api("/api/profile/subscription");
    if (!r.ok) { box.innerHTML = `<p class="help-text">Membership plans are coming soon.</p>`; return; }
    const s = r.data.subscription;
    if (!s || s.status === "canceled" || s.status === "deactivated") {
      box.innerHTML = `<p class="help-text" style="margin:0">No membership yet.</p>
        <a class="btn" href="membership.html" style="margin-top:10px;display:inline-block;text-decoration:none">See plans</a>`;
      return;
    }
    const price = "$" + (s.price_cents / 100).toFixed(2) + (s.billing_interval === "ANNUAL" ? "/yr" : "/mo");
    const line = s.status === "past_due"
      ? `<b style="color:var(--warning,#e6a23c)">Payment issue</b> — update your card from the Membership page.`
      : s.status === "pending"
        ? `Payment pending — finish checkout from the Membership page.`
        : `Active · renews ${s.current_period_end ? s.current_period_end.slice(0, 10) : "on schedule"}`;
    box.innerHTML = `<div style="font-weight:700">${esc(s.plan_name)} <span style="color:var(--text-muted);font-weight:600">${price}</span></div>
      <p class="help-text" style="margin:6px 0 10px">${line}</p>
      <a class="btn ghost" href="membership.html" style="text-decoration:none">Manage membership</a>`;
  }

})();
