/* Boomtown Platform — Leagues
   File: web/assets/leagues.js · Version: v1.4 · Date: 2026-08-23 · Ships in: v0.181.0
   v1.4 (owner req 2026-08-23): an in-progress or past league now links to its live board
   (live.html?event=N — standings & scores) instead of rendering the dead "In progress"/"Closed"
   text. Members can finally reach the tournament view from the list. schedule.js does the same.
   v1.3 (owner req 2026-08-22): the Sub finder MOVED OUT to its own module (web/assets/subs.js on
   subs.html). This file is the league list again — nothing here touches /api/subs/* any more; the
   top "Sub-Finder" button on leagues.html links to the module. See subs.js for the moved code.
   v1.2 (§-1r RF-10): "your league tonight" — a member-scoped banner over two existing routes
   (/api/profile/teams + /api/live/events/:id): tonight's court and opponent, or up-next, or a
   plain "your league is live", each linking the live board. One grouping judgement (groupOf)
   feeds both the headings and the banner; the decoration rule (any failure renders nothing)
   is pinned in league_tonight.test.mjs.
   v1.1: Sub finder shipped here first (owner req #7); moved to its own module in v1.3.
   v1.0 (2026-07-23): league events from GET /api/schedule grouped In progress / Upcoming / Recent. */

(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const body = document.getElementById("lgBody");
  const orgFilter = document.getElementById("orgFilter");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let all = [];

  /* v0.120.0 (T2-13): this wrapper claimed to share app.js/profile.js's convention while never
     attaching the bearer token those files send — so every signed-in call 401'd. Its consumer is
     now tonight() (/api/profile/teams, /api/live/events/:id); token_convention.test.mjs holds the
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
        : (e.status === "in_progress" || (d && d <= new Date()))
          ? `<a class="btn ghost" href="live.html?event=${encodeURIComponent(e.id)}" style="text-decoration:none">Standings &amp; scores</a>`
          : `<span class="lg-meta">Closed</span>`}</div>
    </div>`;
  }
})();
