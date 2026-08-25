/* Boomtown Platform — Leagues
   File: web/assets/leagues.js · Version: v1.7 · Date: 2026-08-23 · Ships in: v0.185.0
   v1.7 (§-1r RF-13 score-entry, owner req 2026-08-23): the "your league tonight" banner now offers
   the signed-in member their OWN team's score entry — /api/profile/teams carries a per-team score_url
   for a live event (surfaced only to a member of that team, never on the public board). The banner
   card became a container (an anchor cannot nest the second link); no score_url → no action shown.
   v1.6 (Gemini review 2026-08-23, round 2): the live-board gate now checks `completed` EXPLICITLY
   (a completed league with no parseable date still links its standings, aligning with schedule.js),
   and the aria-label's name prefix is conditional (no dangling " — " when a league has no name).
   v1.5 (Gemini review 2026-08-23): the live-board link gains an aria-label with the event name
   (WCAG 2.4.4 — identical link texts in a list); a comment documents why the `d <= now` fallback
   is safe against cancelled events (the public feed excludes them server-side).
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
        // RF-13 (owner req 2026-08-23): score entry "accessible through membership account and
        // tournament/league page." /api/profile/teams carries this team's own score link (score_url)
        // once the event is live — surfaced only to this signed-in member of the team, never on the
        // public board. No score_url (upcoming, or not yet live) → the action is simply absent.
        const scoreCta = t.score_url
          ? `<a class="lg-tn-score" href="${esc(t.score_url)}">Enter your team&#8217;s scores &#8594;</a>`
          : "";
        cards.push(`<div class="lg-tonight">
          <div><strong>Tonight &#8212; ${esc(ev.name)}:</strong> ${line}.</div>
          <div class="lg-tn-actions"><a class="lg-tn-go" href="live.html?event=${encodeURIComponent(t.event_id)}">See the live board &#8594;</a>${scoreCta}</div></div>`);
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

  /* The started-but-not-open case (below) links the live board. The d<=now fallback is SAFE against
     the cancelled case Gemini flagged (2026-08-23): the ONLY source here is /api/schedule?view=public,
     whose worker query is status IN ('published','in_progress','completed') — cancelled and draft
     never reach this list, so no explicit exclusion is added (this repo does not guard states the
     server prevents). The link carries an event-name aria-label so a screen-reader links list can
     tell identical "Standings & scores" links apart (WCAG 2.4.4). */
  function row(e) {
    const d = e.starts_at ? new Date(String(e.starts_at).replace(" ", "T")) : null;
    const open = e.status === "published" && (!d || d > new Date());
    const price = e.price_cents ? "$" + (e.price_cents / 100).toFixed(2).replace(/\.00$/, "") : "";
    /* A started-or-finished league links its live board. `completed` is checked EXPLICITLY (Gemini
       2026-08-24, aligning with schedule.js's hasLiveView) so a completed league with no parseable
       start date still reaches its final standings instead of falling through to "Closed". The
       name prefix is conditional so a nameless event has no dangling " — " in its aria-label. */
    const liveOk = e.status === "in_progress" || e.status === "completed" || (d && d <= new Date());
    const nm = e.name ? esc(e.name.trim()) : "";
    // D-55 (Gemini nicety): aria-label only when named — a nameless link's visible "Standings & scores" is already its name.
    const liveAria = nm ? ` aria-label="${nm}, standings and scores"` : "";
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
        : liveOk
          ? `<a class="btn ghost" href="live.html?event=${encodeURIComponent(e.id)}" style="text-decoration:none"${liveAria}>Standings &amp; scores</a>`
          : `<span class="lg-meta">Closed</span>`}</div>
    </div>`;
  }
})();
