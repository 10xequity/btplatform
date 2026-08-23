/* Boomtown Platform — Leagues
   File: web/assets/leagues.js · Version: v1.2 · Date: 2026-08-22 · Ships in: v0.179.0
   v1.2 (§-1r RF-10): "your league tonight" — a member-scoped banner over two existing routes
   (/api/profile/teams + /api/live/events/:id): tonight's court and opponent, or up-next, or a
   plain "your league is live", each linking the live board. One grouping judgement (groupOf)
   feeds both the headings and the banner; the decoration rule (any failure renders nothing)
   is pinned in league_tonight.test.mjs.
   v1.1: Sub finder lands (owner req #7) — the Phase-2 home this file reserved in v1.0.
   Signed-in members can join the sub list (skill / gender / game-type chips), post a
   "need a sub" request, and claim open requests. Signed-out visitors see a sign-in nudge.
   v1.0 (2026-07-23): league events from GET /api/schedule grouped In progress / Upcoming / Recent. */

(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const body = document.getElementById("lgBody");
  const orgFilter = document.getElementById("orgFilter");
  const subsEl = document.getElementById("subFinder");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let all = [];

  /* v0.120.0 (T2-13): this wrapper claimed to share app.js/profile.js's convention while never
     attaching the bearer token those files send — so every signed-in visit 401'd and the sub
     finder showed its sign-in card to signed-in members. token_convention.test.mjs now holds the
     rule for the whole corpus: credentials + X-Org-Id means Authorization too. */
  async function api(path, opts) {
    const headers = Object.assign({ "Content-Type": "application/json" }, (opts || {}).headers || {});
    const t = sessionStorage.getItem("bt_token");
    if (t) headers["Authorization"] = "Bearer " + t;
    const orgId = localStorage.getItem("bt_org");
    if (orgId) headers["X-Org-Id"] = orgId;
    const resp = await fetch(API + path, Object.assign({}, opts, { headers, credentials: "include" }));
    return resp.json();
  }

  load();
  loadSubs();

  async function load() {
    try {
      const resp = await fetch(API + "/api/schedule?view=public");
      const data = await resp.json();
      all = (data.events || []).filter(e => e.type === "league");
      const orgs = [...new Map(all.map(e => [e.org_id, e.org_name])).entries()];
      orgFilter.innerHTML = '<option value="">All orgs</option>' +
        orgs.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join("");
      orgFilter.onchange = paint;
      paint();
      tonight(); // RF-10: decoration — deliberately not awaited, the list never waits on it
    } catch (e) {
      body.innerHTML = `<div class="empty">Can't reach the server right now. Check your connection and refresh.</div>`;
    }
  }

  /* ═══ RF-10 (v0.179.0): your league tonight — a member-scoped read over two EXISTING routes.
     /api/profile/teams names the member's teams (with event_id); /api/live/events/:id names who
     is on which court — by team NAME only, deliberately (the payload's no-personal-data walker),
     so the member's game is found by exact name match within their own event. THE DECORATION
     RULE: any failure — signed out, no teams, a fetch error, a name mismatch — renders NOTHING.
     This page's job is the list; a banner must never take it down. */
  async function tonight() {
    const box = document.getElementById("lgTonight");
    if (!box) return;
    try {
      if (!sessionStorage.getItem("bt_token")) return; // signed out: don't burn a 401 round trip
      const now = new Date();
      const live = all.filter(e => groupOf(e, now) === "In progress");
      if (!live.length) return;
      const mine = ((await api("/api/profile/teams")).teams || [])
        .filter(t => live.some(e => e.id === t.event_id));
      if (!mine.length) return;
      const cards = [];
      for (const t of mine) {
        const ev = live.find(e => e.id === t.event_id);
        const d = await api(`/api/live/events/${t.event_id}`);
        const inMatch = mt => mt.team_a === t.name || mt.team_b === t.name;
        const say = (mt, when) => {
          const opp = mt.team_a === t.name ? mt.team_b : mt.team_a;
          return `${when} on Court ${Number(mt.court) || "?"}${opp ? ` vs ${esc(opp)}` : ""}`;
        };
        const onNow = (d.on_now || []).find(inMatch);
        const upNext = (d.up_next || []).find(inMatch);
        const line = onNow ? say(onNow, "you're on now") : upNext ? say(upNext, "you're up next") : "your league is live";
        cards.push(`<a class="lg-tonight" href="live.html?event=${encodeURIComponent(t.event_id)}">
          <strong>Tonight &#8212; ${esc(ev.name)}:</strong> ${line}. <span class="lg-tn-go">See the live board &#8594;</span></a>`);
      }
      box.innerHTML = cards.join("");
    } catch (e) { /* decoration: any failure renders nothing */ }
  }

  /** ONE judgement: which group an event belongs to. paint() renders the headings by it and
      tonight() (RF-10) reads "In progress" through the SAME test — a banner claiming a league is
      live while its heading says Upcoming is the two-readers drift this file must not grow. */
  function groupOf(e, now) {
    const s = e.starts_at ? new Date(String(e.starts_at).replace(" ", "T")) : null;
    const f = e.ends_at ? new Date(String(e.ends_at).replace(" ", "T")) : s;
    if (e.status === "in_progress" || (s && f && s <= now && now <= f)) return "In progress";
    if (!s || s > now) return "Upcoming";
    return "Recent";
  }

  function paint() {
    const org = orgFilter.value;
    const list = all.filter(e => !org || String(e.org_id) === org);
    if (!list.length) {
      body.innerHTML = `<div class="empty">No leagues on the calendar yet. New seasons are announced on the
        <a href="schedule.html">schedule</a> and on Instagram &#8212; check back soon.</div>`;
      return;
    }
    const now = new Date();
    const groups = { "In progress": [], "Upcoming": [], "Recent": [] };
    list.forEach(e => groups[groupOf(e, now)].push(e));
    groups["Recent"].reverse();
    body.innerHTML = Object.entries(groups).filter(([, v]) => v.length).map(([label, evs]) => `
      <h2 style="font-size:16px;margin:18px 0 8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">${label}</h2>
      ${evs.map(row).join("")}`).join("");
  }

  function row(e) {
    const d = e.starts_at ? new Date(String(e.starts_at).replace(" ", "T")) : null;
    const open = e.status === "published" && (!d || d > new Date());
    const price = e.price_cents ? "$" + (e.price_cents / 100).toFixed(2).replace(/\.00$/, "") : "";
    return `<div class="lg-ev">
      <div class="lg-date" aria-hidden="true">
        <div class="d">${d ? d.getDate() : "&#8212;"}</div>
        <div class="m">${d ? d.toLocaleString("en-US", { month: "short" }) : ""}</div>
      </div>
      <div class="lg-body">
        <div class="lg-name">${esc(e.name)}</div>
        <div class="lg-meta">${esc(e.org_name || "")}${e.location ? " \u00b7 " + esc(e.location) : ""}${price ? " \u00b7 " + price : ""}${e.registered_count != null ? " \u00b7 " + e.registered_count + " registered" : ""}</div>
      </div>
      <div class="lg-cta">${open
        ? ((s) => `<a class="btn" href="${esc(s.href)}" style="text-decoration:none"
            ${s.external ? `target="_blank" rel="${esc(s.rel)}"` : ""}>${s.external ? esc(s.label) + " ↗" : "Register"}</a>`)(BT_SIGNUP(e))
        : `<span class="lg-meta">${e.status === "in_progress" ? "In progress" : "Closed"}</span>`}</div>
    </div>`;
  }

  /* ============================ Sub finder (v1.1) ============================ */

  const SKILLS = [["any","Any"],["b","B"],["bb","BB"],["a","A"],["aa","AA"],["open","Open"]];
  const GENDERS = [["any","Any"],["coed","Coed"],["mens","Men's"],["womens","Women's"],["reverse","Reverse"]];
  const GAMES = [["any","Any"],["2s","Doubles"],["4s","Fours"],["6s","Sixes"]];
  const LBL = Object.fromEntries([...SKILLS, ...GENDERS, ...GAMES]);
  let me = null; // { signup, my_open_requests } when signed in

  async function loadSubs() {
    if (!subsEl) return;
    try {
      me = await api("/api/subs/me");
    } catch (e) { subsEl.innerHTML = ""; return; }
    if (me && me.error) {
      // Two different truths behind one 401: no session at all, or a session whose account has
      // no member profile in this org. A "Sign in" button for the second is a dead-end loop —
      // they ARE signed in — and an error that misdiagnoses is worse than none (v0.115.0).
      const signedIn = !!sessionStorage.getItem("bt_token");
      subsEl.innerHTML = signedIn
        ? `<div class="sub-card"><div class="sub-title">Sub finder</div>
        <p class="lg-meta" style="margin:6px 0 10px">Your sign-in isn't linked to a member profile in this
        organization yet, so the sub list can't include you. Ask your organizer to add you as a member.</p></div>`
        : `<div class="sub-card"><div class="sub-title">Sub finder</div>
        <p class="lg-meta" style="margin:6px 0 10px">Short a player, or want to get called when a team needs one?
        Sign in to join the sub list and see open requests.</p>
        <a class="btn" href="index.html" style="text-decoration:none">Sign in</a></div>`;
      return;
    }
    renderSubs();
    refreshBoard();
  }

  function chipRow(name, options, selected) {
    const sel = String(selected || "any").split(",");
    return options.map(([v, label]) => `
      <button type="button" class="sub-chip${sel.includes(v) ? " on" : ""}" data-group="${name}" data-v="${v}"
        aria-pressed="${sel.includes(v)}">${label}</button>`).join("");
  }

  function renderSubs() {
    const s = me.signup;
    subsEl.innerHTML = `
      <div class="sub-card">
        <div class="sub-title">Be a sub</div>
        <p class="lg-meta" style="margin:4px 0 8px">${s
          ? "You're on the sub list. Update your preferences any time."
          : "Get notified when a team is short a player that matches you."}</p>
        <div class="sub-grid">
          <div><div class="sub-lab">Skill</div><div class="sub-chips" id="chipSkill">${chipRow("skill", SKILLS, s && s.skill_levels)}</div></div>
          <div><div class="sub-lab">Gender</div><div class="sub-chips" id="chipGender">${chipRow("gender", GENDERS, s && s.genders)}</div></div>
          <div><div class="sub-lab">Game</div><div class="sub-chips" id="chipGame">${chipRow("game", GAMES, s && s.game_types)}</div></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn" id="subSave">${s ? "Update preferences" : "Join the sub list"}</button>
          ${s ? `<button class="btn ghost" id="subLeave">Leave the list</button>` : ""}
        </div>
        <div class="lg-meta" id="subMsg" role="status" aria-live="polite" style="margin-top:8px"></div>
      </div>
      <div class="sub-card">
        <div class="sub-title">Need a sub?</div>
        <div class="sub-grid" style="margin-top:8px">
          <label class="sub-lab" style="display:block">When
            <input type="datetime-local" id="reqWhen" class="sub-input" aria-label="When the sub is needed"></label>
          <label class="sub-lab" style="display:block">Skill
            <select id="reqSkill" class="sub-input">${SKILLS.map(([v,l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
          <label class="sub-lab" style="display:block">Gender
            <select id="reqGender" class="sub-input">${GENDERS.map(([v,l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
          <label class="sub-lab" style="display:block">Game
            <select id="reqGame" class="sub-input">${GAMES.map(([v,l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
        </div>
        <label class="sub-lab" style="display:block;margin-top:8px">Note (optional)
          <input type="text" id="reqNote" class="sub-input" maxlength="300" placeholder="e.g. Thursday coed 6s at Fieldhouse, 6:30pm"></label>
        <div style="margin-top:10px"><button class="btn" id="reqPost">Post request</button></div>
        <div class="lg-meta" id="reqMsg" role="status" aria-live="polite" style="margin-top:8px"></div>
      </div>
      <div class="sub-card" id="subBoard">
        <div class="sub-title">Open requests</div>
        <div id="boardBody" class="lg-meta" style="margin-top:6px">Loading&#8230;</div>
      </div>`;

    subsEl.querySelectorAll(".sub-chip").forEach(ch => ch.addEventListener("click", () => {
      const group = ch.dataset.group, v = ch.dataset.v;
      const peers = subsEl.querySelectorAll(`.sub-chip[data-group="${group}"]`);
      if (v === "any") { peers.forEach(p => setChip(p, p.dataset.v === "any")); return; }
      setChip(ch, !ch.classList.contains("on"));
      const anyChip = subsEl.querySelector(`.sub-chip[data-group="${group}"][data-v="any"]`);
      const others = [...peers].filter(p => p.dataset.v !== "any");
      if (others.some(p => p.classList.contains("on"))) setChip(anyChip, false);
      else setChip(anyChip, true); // nothing selected → back to Any, never an empty state
    }));
    function setChip(el, on) { el.classList.toggle("on", on); el.setAttribute("aria-pressed", String(on)); }

    const picked = group => [...subsEl.querySelectorAll(`.sub-chip[data-group="${group}"].on`)].map(c => c.dataset.v);
    document.getElementById("subSave").onclick = async () => {
      const r = await api("/api/subs/signup", { method: "POST", body: JSON.stringify({
        skill_levels: picked("skill"), genders: picked("gender"), game_types: picked("game") }) });
      document.getElementById("subMsg").textContent = r.message || r.error || "";
      if (r.ok) { me.signup = r.signup; }
    };
    const leave = document.getElementById("subLeave");
    if (leave) leave.onclick = async () => {
      const r = await api("/api/subs/signup", { method: "DELETE" });
      document.getElementById("subMsg").textContent = r.message || r.error || "";
      if (r.ok) { me.signup = null; renderSubs(); refreshBoard(); }
    };
    document.getElementById("reqPost").onclick = async () => {
      const r = await api("/api/subs/requests", { method: "POST", body: JSON.stringify({
        needed_at: (document.getElementById("reqWhen").value || "").replace("T", " "),
        skill_level: document.getElementById("reqSkill").value,
        gender_requirement: document.getElementById("reqGender").value,
        game_type: document.getElementById("reqGame").value,
        note: document.getElementById("reqNote").value }) });
      document.getElementById("reqMsg").textContent = r.message || r.error || "";
      if (r.ok) refreshBoard();
    };
  }

  async function refreshBoard() {
    const el = document.getElementById("boardBody");
    if (!el) return;
    const data = await api("/api/subs/requests");
    const rows = (data && data.requests) || [];
    if (!rows.length) { el.textContent = "No open requests right now."; return; }
    el.innerHTML = rows.map(r => {
      const bits = [LBL[r.skill_level], LBL[r.gender_requirement], LBL[r.game_type]]
        .filter(b => b && b !== "Any").join(" \u00b7 ");
      return `<div class="sub-req">
        <div style="flex:1;min-width:0">
          <div style="color:var(--text)">${esc(r.requester)}${r.event_name ? " \u00b7 " + esc(r.event_name) : ""}</div>
          <div>${r.needed_at ? esc(r.needed_at) + (bits ? " \u00b7 " : "") : ""}${bits}${r.note ? " \u00b7 " + esc(r.note) : ""}</div>
        </div>
        ${r.mine
          ? `<button class="btn ghost" data-cancel="${r.id}">Cancel</button>`
          : `<button class="btn" data-fill="${r.id}">I can play</button>`}
      </div>`;
    }).join("");
    el.querySelectorAll("[data-fill]").forEach(b => b.onclick = async () => {
      const r = await api(`/api/subs/requests/${b.dataset.fill}/fill`, { method: "POST" });
      el.previousElementSibling.insertAdjacentHTML("afterend", "");
      alertRow(r); refreshBoard();
    });
    el.querySelectorAll("[data-cancel]").forEach(b => b.onclick = async () => {
      const r = await api(`/api/subs/requests/${b.dataset.cancel}/cancel`, { method: "POST" });
      alertRow(r); refreshBoard();
    });
    function alertRow(r) {
      const msg = document.createElement("div");
      msg.className = "lg-meta"; msg.setAttribute("role", "status");
      msg.style.margin = "8px 0 0"; msg.textContent = r.message || r.error || "";
      el.parentElement.appendChild(msg);
      setTimeout(() => msg.remove(), 6000);
    }
  }
})();
