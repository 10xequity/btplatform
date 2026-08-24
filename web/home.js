/* Boomtown Platform — My Dashboard
   File: web/home.js · Version: v2.2.0 · Date: 2026-08-23 · Ships in: v0.14.0 (v2.2.0 in v0.187.0)
   v2.2.0 (§-1r RF-13 score-entry — the "membership account" surface, owner req 2026-08-23): the
   "Your teams" card now shows "Enter your team's scores →" for any team whose event is live — the
   score_url /api/profile/teams already carries (own-team only, never public; the leagues banner was
   the first surface, this is the account he named). No score_url (upcoming/not live) → no action.
   v2.1.0 (§-1h M-4 / §-0 B15): the motion pass — the arrival stagger (once per session, class
   removed after it plays), fill() (first-fill fade; re-renders stay instant), collapse()
   (dismiss/mute closes the list around the item; reduced motion checked in JS because a fenced
   transition never fires transitionend). Values are M-4's, guarded by home_motion.test.mjs.
   v2.0.0 (R3, owner 2026-08-02): announcement/news box from /api/home/feed — admin CTA pinned
   (non-mutable, server-enforced), aggregated news/events/my-events/messages/subs/community
   groups, per-item ✕ + per-category mutes stored SERVER-SIDE (announcement_mutes; the
   localStorage bt_lfg_prefs toggles are retired), results résumé card (/api/profile/resume),
   sub availability strip (opt-in, passive vs actively-looking + level → LFG player_avail).
   v1.4.0: Community-play opportunities card (feed was /api/lfg/opportunities).
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

  /* M-4: a container's FIRST fill fades in (120ms opacity, fenced in the page CSS); every later
     re-render — mutes, invites, show-all — stays instant. A daily screen earns restraint. */
  function fill(el, html) {
    if (!el) return;
    el.innerHTML = html;
    if (el.dataset.btFilled) return;
    el.dataset.btFilled = "1";
    el.classList.add("hm-fill");
    el.addEventListener("animationend", () => el.classList.remove("hm-fill"), { once: true });
  }

  /* M-4: the list closes around a dismissed item (height+opacity, 200ms — the one deliberate
     non-compositor exception; rare and user-initiated). The preference is checked HERE, not
     only in CSS: a fenced transition never runs for reduced-motion users, so transitionend
     would never fire and the caller's await would hang — the check keeps the promise honest. */
  function collapse(el) {
    return new Promise(res => {
      if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) { res(); return; }
      el.style.height = el.scrollHeight + "px";
      el.style.overflow = "hidden";
      void el.offsetHeight;
      el.style.transition = "height 200ms var(--ease-out), opacity 200ms var(--ease-out)";
      el.style.height = "0px";
      el.style.opacity = "0";
      let done = false;
      const fin = () => { if (!done) { done = true; res(); } };
      el.addEventListener("transitionend", fin, { once: true });
      setTimeout(fin, 260); // an interrupted or hidden transition still resolves
    });
  }

  boot();
  async function boot() {
    if (!token) { location.href = "index.html"; return; }
    /* M-4: the arrival stagger — once per session, before the first await so it starts with the
       first paint. The class is removed after the run so panels revealed later (Agreements,
       Court time) never play a late entrance. */
    try {
      if (!sessionStorage.getItem("bt_home_arrived")) {
        sessionStorage.setItem("bt_home_arrived", "1");
        const grid = document.querySelector(".hm-grid");
        if (grid) {
          grid.classList.add("hm-arrive");
          setTimeout(() => grid.classList.remove("hm-arrive"), 900);
        }
      }
    } catch (e) { /* private mode: no flag, no stagger — the page still works */ }
    const me = await api("/api/profile/me");
    if (!me.ok) { location.href = "index.html"; return; }
    const first = ((me.data.contact && me.data.contact.full_name) || "").split(/\s+/)[0];
    if (first) $("hello").textContent = `Welcome back, ${first}`;
    api("/api/profile/connect-teams", { method: "POST" }); // fire-and-forget roster link
    loadMembership();
    loadTeams();
    loadFeed();          // v2.0.0 — the announcement box (replaces notifications/upcoming/lfg cards)
    loadAchievements();  // v2.0.0
    loadAgreements();
    setupPanels();       // v2.0.0 — CTA-row tiles toggle the agreements / rental panels
    setupRental();
  }

  async function loadAgreements() {
    const r = await api("/api/me/agreements");
    const strip = $("statusStrip");
    if (!r.ok) { if (strip) strip.innerHTML = ""; fill($("agrList"), `<p class="help-text" style="margin:0">Couldn't load your agreements right now.</p>`); return; }
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
      fill($("agrList"), `<p class="help-text" style="margin:0">Nothing signed yet — your waiver appears here after your first registration.</p>`);
      return;
    }
    const first = rows.slice(0, 5);
    fill($("agrList"), render(first) + (rows.length > 5
      ? `<button class="btn ghost" id="agrMore" style="margin-top:8px">Show all ${rows.length}</button>` : ""));
    const more = $("agrMore");
    if (more) more.onclick = () => { $("agrList").innerHTML = render(rows); };
  }

  function setupRental() {
    const tile = $("rentalTile");
    if (!tile) return;
    if (!(window.BT_CONFIG && window.BT_CONFIG.RENTALS_ENABLED)) return; // hidden by owner decision
    tile.hidden = false;
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

  /* ================= v2.0.0 — announcement box, mutes, sub availability ================= */

  const CAT_LABEL = { news: "News", events: "Upcoming events", my_events: "My events",
    messages: "Messages", subs: "Sub requests", community: "Community play" };
  const SKILL_OPTS = ["any", "b", "bb", "a", "aa", "open"]; // subs.js SKILLS — one vocabulary

  async function loadFeed() {
    const r = await api("/api/home/feed");
    const groups = $("feedGroups");
    if (!r.ok) { fill(groups, `<p class="help-text" style="margin:0">Couldn't load updates right now.</p>`); return; }
    renderCtas(r.data.ctas || []);
    renderGroups(r.data.categories || {}, r.data.muted_categories || []);
    renderPrefs(r.data.muted_categories || []);
    renderSub(r.data.sub || {});
    loadNotificationsGroup(); // in-app notifications (invites, strike notices) join the box
  }

  function renderCtas(ctas) {
    // Owner rule: the admin priority CTA is pinned first and carries NO mute affordance.
    $("annCtas").innerHTML = ctas.map(c => `
      <div class="ann-cta">
        <div><b>${esc(c.title)}</b>
          ${c.body ? `<div class="b">${esc(c.body)}</div>` : ""}
          ${c.link_url ? `<a href="${esc(c.link_url)}">${esc(c.link_label || "Open")} &rarr;</a>` : ""}</div>
      </div>`).join("");
  }

  function muteBtn(scope, key, label) {
    return `<button class="feed-mute" data-mscope="${scope}" data-mkey="${esc(String(key))}"
      aria-label="${esc(label)}" title="${esc(label)}">&times;</button>`;
  }

  function renderGroups(cat, muted) {
    const out = [];
    if (cat.news && cat.news.length) {
      out.push(`<div class="feed-group"><h3>News</h3>` + cat.news.map(n => `
        <div class="feed-item"><div class="fx"><b>${esc(n.title)}</b>
          ${n.body ? `<span>${esc(n.body)}</span>` : ""}
          ${n.link_url ? `<span><a href="${esc(n.link_url)}">${esc(n.link_label || "More")}</a></span>` : ""}</div>
          ${muteBtn("item", n.id, "Hide this announcement")}</div>`).join("") + `</div>`);
    }
    if (cat.events && cat.events.length) {
      /* v0.137.0 (§-1c D-29): this link read `register.html?event_id=` while register.js reads
         `?event=`, so every View button here landed on the missing-event refusal — for as long as
         the feed has existed. It now calls the shared rule, which also gives the card the SG-1
         fork it never had: a drop-in session opens its sheet, a team event the registration form.
         The feed's own query already selects `type` (announcements.js), so nothing new is fetched. */
      out.push(`<div class="feed-group"><h3>Upcoming events${muteBtn("category", "events", "Hide upcoming events from this box")}</h3>` +
        cat.events.map(e => `
        <div class="feed-item"><div class="fx"><b>${esc(e.name)}</b>
          <span>${fmt(e.starts_at)}${e.location ? " · " + esc(e.location) : ""}</span></div>
          ${((s) => `<a class="btn ghost" style="text-decoration:none" href="${esc(s.href)}"
            ${s.external ? `target="_blank" rel="${esc(s.rel)}"` : ""}>${s.external ? esc(s.label) + " ↗" : "View"}</a>`)(BT_SIGNUP(e))}</div>`).join("") + `</div>`);
    }
    if (cat.my_events && cat.my_events.length) {
      out.push(`<div class="feed-group"><h3>You're signed up${muteBtn("category", "my_events", "Hide my events from this box")}</h3>` +
        cat.my_events.map(e => `
        <div class="feed-item"><div class="fx"><b>${esc(e.name)}</b>
          <span>${fmt(e.starts_at)} · ${esc(e.status)}</span></div>
          <a class="btn ghost" style="text-decoration:none" href="${API}/api/events/ics?event_id=${e.event_id}">Calendar</a></div>`).join("") + `</div>`);
    }
    if (cat.messages && cat.messages.unread > 0) {
      out.push(`<div class="feed-group"><h3>Messages${muteBtn("category", "messages", "Hide messages from this box")}</h3>
        <div class="feed-item"><div class="fx"><b>${cat.messages.unread} unread</b></div>
          <a class="btn ghost" style="text-decoration:none" href="member-inbox.html">Open inbox</a></div></div>`);
    }
    if (cat.subs && cat.subs.length) {
      out.push(`<div class="feed-group"><h3>Teams need subs${muteBtn("category", "subs", "Hide sub requests from this box")}</h3>` +
        cat.subs.map(s => `
        <div class="feed-item"><div class="fx"><b>${esc(s.event_name || "Pickup")}</b>
          <span>${s.needed_at ? fmt(s.needed_at) + " · " : ""}${s.skill_level !== "any" ? esc(s.skill_level).toUpperCase() + " · " : ""}${esc(s.game_type || "")}</span></div>
          <a class="btn ghost" style="text-decoration:none" href="lfg.html">See it</a></div>`).join("") + `</div>`);
    }
    if (cat.community && cat.community.length) {
      const what = (o) => o.kind === "team_need" ? (o.team_name || "Team recruiting")
        : o.kind === "player_avail" ? "Player available" : "Casual game";
      out.push(`<div class="feed-group"><h3>Community play${muteBtn("category", "community", "Hide community play from this box")}</h3>` +
        cat.community.map(o => `
        <a class="feed-item" href="lfg.html" style="text-decoration:none;color:inherit"><div class="fx"><b>${esc(what(o))}</b>
          <span>${[o.skill_level !== "any" ? String(o.skill_level).toUpperCase() : null, o.game_type !== "any" ? o.game_type : null, o.play_at ? fmt(o.play_at) : null].filter(Boolean).map(esc).join(" · ")}</span></div></a>`).join("") + `</div>`);
    }
    fill($("feedGroups"), out.join("") ||
      `<p class="help-text" style="margin:0">Quiet for now — events, messages, and community posts land here.</p>`);
    $("feedGroups").querySelectorAll(".feed-mute").forEach(b => b.onclick = () => mute(b.dataset.mscope, b.dataset.mkey, b));
  }

  async function mute(scope, key, btn) {
    const body = scope === "item" ? { scope, announcement_id: Number(key) } : { scope, category: key };
    const r = await api("/api/announcements/mute", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { $("status").innerHTML = `<p class="notice-err">${esc(r.data.error || "Couldn't hide that.")}</p>`; return; }
    /* M-4: the list closes around the removed item (or group) before the repaint — the refusal
       above keeps the item still, because motion on a failed action would lie about the state. */
    await collapse(btn && (scope === "item" ? btn.closest(".feed-item") : btn.closest(".feed-group")));
    loadFeed();
  }

  function renderPrefs(muted) {
    const box = $("feedPrefs");
    const cats = ["news", "events", "my_events", "messages", "subs", "community"];
    box.hidden = false;
    box.innerHTML = `<span>Show:</span>` + cats.map(c => `
      <label><input type="checkbox" data-cat="${c}" ${muted.includes(c) ? "" : "checked"}> ${CAT_LABEL[c]}</label>`).join("");
    box.querySelectorAll("[data-cat]").forEach(cb => cb.onchange = async () => {
      await api(cb.checked ? "/api/announcements/unmute" : "/api/announcements/mute",
        { method: "POST", body: JSON.stringify({ scope: "category", category: cb.dataset.cat }) });
      loadFeed();
    });
  }

  /* in-app notifications (team invites, LFG notices) — read/dismiss model, joins the box */
  async function loadNotificationsGroup() {
    const r = await api("/api/notifications");
    const list = r.ok ? r.data.notifications || [] : [];
    const unread = list.filter(n => !n.read_at);
    $("readAll").hidden = !unread.length;
    $("readAll").onclick = async () => { await api("/api/notifications/read-all", { method: "POST" }); loadFeed(); };
    if (!unread.length) return;
    const el = document.createElement("div");
    el.className = "feed-group";
    el.innerHTML = `<h3>For you</h3>` + unread.slice(0, 6).map(n => `
      <div class="feed-item ntf" data-id="${n.id}" style="cursor:pointer"><span class="dot" aria-hidden="true"></span>
        <div class="fx"><b>${esc(n.title || n.kind.replace(/_/g, " "))}</b>
          ${n.body ? `<span>${esc(n.body)}</span>` : ""}</div>
        <span class="when">${esc((n.created_at || "").slice(5, 10))}</span></div>`).join("");
    $("feedGroups").prepend(el);
    el.querySelectorAll(".ntf").forEach(x => x.onclick = async () => {
      await api(`/api/notifications/${x.dataset.id}/read`, { method: "POST" });
      await collapse(x); // M-4: same dismiss shape as a mute — the list closes, never jump-cuts
      x.remove();
    });
  }

  /* ---------------- sub availability (owner rule: passive vs actively-looking) ---------------- */
  let SUB = { opt_in: false, mode: "passive", level: null };
  function renderSub(sub) {
    SUB = sub;
    const strip = $("subStrip");
    strip.hidden = false;
    $("subOptIn").checked = !!sub.opt_in;
    $("subModeWrap").hidden = !sub.opt_in;
    $("subActive").checked = sub.mode === "active";
    $("subLevelWrap").hidden = !(sub.opt_in && sub.mode === "active");
    const sel = $("subLevel");
    sel.innerHTML = SKILL_OPTS.map(s => `<option value="${s}" ${s === (sub.level || "any") ? "selected" : ""}>${s === "any" ? "Any" : s.toUpperCase()}</option>`).join("");
    $("subOptIn").onchange = pushSub; $("subActive").onchange = pushSub; sel.onchange = pushSub;
  }
  async function pushSub() {
    const body = { opt_in: $("subOptIn").checked,
      mode: $("subActive").checked ? "active" : "passive", level: $("subLevel").value };
    const r = await api("/api/me/sub-availability", { method: "PUT", body: JSON.stringify(body) });
    $("subMsg").textContent = r.ok
      ? (body.opt_in ? (body.mode === "active" ? "Posted to Community Play." : "Coaches and captains can find you.") : "You're off the sub list.")
      : (r.data.error || "Couldn't save that.");
    if (r.ok) renderSub({ opt_in: body.opt_in, mode: body.mode, level: r.data.level });
  }

  /* ---------------- results résumé (compact) ---------------- */
  async function loadAchievements() {
    const r = await api("/api/profile/resume");
    const box = $("achBox");
    if (!r.ok) { fill(box, `<p class="help-text" style="margin:0">Play your first event and your results start here.</p>`); return; }
    const t = r.data.totals || {};
    const rows = (r.data.results || []).slice(0, 3);
    if (!t.events) { fill(box, `<p class="help-text" style="margin:0">Play your first event and your results start here.</p>`); return; }
    fill(box, `
      <div class="ach-tot">
        <div><span class="n">${t.events}</span><span class="l">events</span></div>
        <div><span class="n">${t.wins || 0}&ndash;${t.losses || 0}</span><span class="l">record</span></div>
        <div><span class="n">${t.best_finish ? "#" + t.best_finish : "&mdash;"}</span><span class="l">best finish</span></div>
        <div><span class="n">${t.points || 0}</span><span class="l">points</span></div>
      </div>` + rows.map(x => `
      <div class="feed-item"><div class="fx"><b>${esc(x.name)}</b>
        <span>${esc(x.team_name || "")}${x.rank ? ` · finished #${x.rank} of ${x.teams_in_event}` : ""} · ${x.wins || 0}&ndash;${x.losses || 0}</span></div></div>`).join("") +
      `<a class="btn ghost" href="profile.html" style="text-decoration:none;margin-top:8px;display:inline-block">Full résumé</a>`);
  }

  /* ---------------- messages summary card ---------------- */
  async function loadMessagesCard() {
    const r = await api("/api/messages/unread-count");
    const n = r.ok ? r.data.unread || 0 : 0;
    fill($("msgBox"), `
      <div class="feed-item"><div class="fx"><b>${n ? n + " unread message" + (n > 1 ? "s" : "") : "No unread messages"}</b>
        <span>${n ? "Someone's waiting on you." : "Community play and team threads land here."}</span></div>
        <a class="btn ${n ? "" : "ghost"}" style="text-decoration:none" href="member-inbox.html">Open inbox</a></div>`);
  }

  /* ---------------- CTA-row panels ---------------- */
  function setupPanels() {
    loadMessagesCard();
    const wire = (tileId, panelId) => {
      const tile = $(tileId), panel = $(panelId);
      if (!tile || !panel) return;
      tile.onclick = () => {
        panel.hidden = !panel.hidden;
        tile.setAttribute("aria-expanded", String(!panel.hidden));
        if (!panel.hidden) panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
      };
    };
    wire("agrTile", "agrPanel");
    wire("rentalTile", "rentalPanel");
  }

  async function loadTeams() {
    const r = await api("/api/profile/teams");
    const teams = r.ok ? r.data.teams || [] : [];
    fill($("teamList"), teams.length ? teams.map(t => `
      <div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="font-weight:700">${esc(t.name)} <span class="help-text" style="font-weight:400">· ${esc(t.event_name)}</span></div>
        ${t.score_url ? `<a class="btn ghost sm" href="${esc(t.score_url)}" style="text-decoration:none;margin:6px 0 2px;display:inline-block">Enter your team&#8217;s scores &#8594;</a>` : ""}
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
      `<p class="help-text" style="margin:0">No teams yet — register for an event and your team shows up here.</p>`);
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
    if (!r.ok) { fill(box, `<p class="help-text">Membership plans are coming soon.</p>`); return; }
    const s = r.data.subscription;
    if (!s || s.status === "canceled" || s.status === "deactivated") {
      fill(box, `<p class="help-text" style="margin:0">No membership yet.</p>
        <a class="btn" href="membership.html" style="margin-top:10px;display:inline-block;text-decoration:none">See plans</a>`);
      return;
    }
    const price = "$" + (s.price_cents / 100).toFixed(2) + (s.billing_interval === "ANNUAL" ? "/yr" : "/mo");
    const line = s.status === "past_due"
      ? `<b style="color:var(--warning,#e6a23c)">Payment issue</b> — update your card from the Membership page.`
      : s.status === "pending"
        ? `Payment pending — finish checkout from the Membership page.`
        : `Active · renews ${s.current_period_end ? s.current_period_end.slice(0, 10) : "on schedule"}`;
    fill(box, `<div style="font-weight:700">${esc(s.plan_name)} <span style="color:var(--text-muted);font-weight:600">${price}</span></div>
      <p class="help-text" style="margin:6px 0 10px">${line}</p>
      <a class="btn ghost" href="membership.html" style="text-decoration:none">Manage membership</a>`);
  }

})();
