/* Boomtown Platform — Tournament Ops
   Version: v0.4.0 · Date: 2026-08-05 · Ships in: v0.94.0
   v0.4.0 (§-1b W-C): "Plan the day" — the formats planner (options → plan → commit) finally has
   a screen. It shows equal-game round options, the plain-sentence plan summary, and the owner's
   pool-split defaults (6–11 per pool, 15→8+7, 16→8+8, 17→9+8, 19→10+9; a 5-team pool doubles its
   round robin) before a single match is written; committing 409s over an existing schedule and
   replaces only on an explicit second press. Three D-4-baseline routes gain their callers here.
   Also (v0.91.0 E3): auto-open the first event.
   v0.3.1 · 2026-08-02 (v0.3.0: network-failure + stale-config guards, matching app.js v0.2.4)
   Flow: pick/create event → paste teams → generate (feasibility gate with one-tap fixes)
   → live grid (drag to move, tap to score in 2 taps) → standings → bracket → print/CSV. */

(function () {
  const API = (window.BT_CONFIG || {}).apiBase;
  const $ = (id) => document.getElementById(id);

  /* config guard — catches a stale cached config.js */
  if (!API || API.includes("PENDING")) {
    document.getElementById("app").innerHTML =
      "<div class='card'><h1>One moment</h1><p>The app is still loading its latest settings. Hold <strong>Ctrl</strong> and press <strong>F5</strong> to refresh. If this message stays after a few minutes, tell Claude.</p></div>";
    return;
  }
  let bearer = sessionStorage.getItem("bt_token") || null;
  let currentEvent = null, teams = [], teamName = {}, matches = [], formats = {};

  /* theme + org (same behavior as index) */
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

  /* ---------- boot ---------- */
  (async function boot() {
    if (!bearer) { location.href = "index.html"; return; }
    const me = await api("/api/me");
    if (!me.ok) { location.href = "index.html"; return; }
    /* v0.52.0: org switcher is single-source now — populated + handled by admin-nav.js v2.19. */
    formats = (await api("/api/formats")).data.formats || {};
    $("evTemplate").innerHTML = `<option value="">Custom</option>` +
      Object.keys(formats).map((k) => `<option value="${k}">${k}</option>`).join("");
    $("evTemplate").onchange = () => {
      const t = formats[$("evTemplate").value];
      if (t) $("evCourts").value = t.courts;
    };
    loadEvents();
  })();

  async function loadEvents() {
    const evs = (await api("/api/events")).data.events || [];
    $("eventSelect").innerHTML = `<option value="">— choose event —</option>` +
      evs.map((e) => `<option value="${e.id}">${e.name}${e.starts_at ? " · " + e.starts_at.slice(0, 10) : ""}</option>`).join("");
    $("eventSelect").onchange = () => $("eventSelect").value && openEvent(+$("eventSelect").value);
    // E3 (v0.91.0, audit §6.5): every other module opens on the first real event; this page used
    // to sit on the placeholder and look like it had loaded nothing. Same rule now, any count.
    if (evs.length) { $("eventSelect").value = evs[0].id; openEvent(evs[0].id); }
  }

  /* ---------- create event (≤10 clicks from template) ---------- */
  $("newEventBtn").onclick = () => { $("newEventForm").hidden = !$("newEventForm").hidden; };
  $("createEventBtn").onclick = async () => {
    const body = {
      name: $("evName").value.trim(),
      starts_at: $("evDate").value || null,
      format_template: $("evTemplate").value || null,
      court_count: +$("evCourts").value || 4,
      type: "tournament",
    };
    if (!body.name) return ($("newEventMsg").textContent = "Give it a name.");
    const r = await api("/api/events", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return ($("newEventMsg").textContent = r.data.error || "Could not create.");
    $("newEventForm").hidden = true;
    await loadEvents();
    $("eventSelect").value = r.data.id;
    openEvent(r.data.id);
  };

  async function openEvent(id) {
    const r = await api(`/api/events/${id}`);
    if (!r.ok) return;
    currentEvent = r.data.event;
    $("teamsPanel").hidden = false;
    $("planPanel").hidden = false; // W-C: the planner opens with the event
    if (currentEvent.court_count) $("plCourts").value = currentEvent.court_count;
    $("printTitle").textContent = `${currentEvent.name} — Pool Play`;
    await refreshAll();
  }

  /* ---------- teams ---------- */
  $("addTeamsBtn").onclick = async () => {
    const names = $("teamPaste").value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    await api(`/api/events/${currentEvent.id}/teams`, { method: "POST", body: JSON.stringify({ names }) });
    $("teamPaste").value = "";
    refreshAll();
  };

  /* ---------- W-C (v0.94.0): plan the day — the formats planner finally has a screen ----------
     options → plan (with the owner's pool-split defaults and plain-sentence summary) → commit.
     The three routes existed since the format engine shipped and had no caller (D-4 baseline);
     this panel is their screen. Commit replaces an existing schedule only after an explicit
     second press — the server 409s first and says what it would do. */
  let plannedRounds = null;

  $("plOptions").onclick = async () => {
    const t = +$("plTeams").value, c = +$("plCourts").value;
    plannedRounds = null;
    $("plCommit").hidden = true;
    $("plSummary").textContent = "";
    if (!t || !c) { $("plChoices").innerHTML = `<span class="muted">Enter teams and courts first.</span>`; return; }
    const r = await api(`/api/admin/formats/options?teams=${t}&courts=${c}`);
    if (!r.ok) { $("plChoices").innerHTML = `<span class="muted">${r.data.error || "Couldn't work out the options."}</span>`; return; }
    const opts = r.data.options || [];
    $("plChoices").innerHTML = (r.data.note ? `<p class="muted" style="margin:0 0 6px">${r.data.note}</p>` : "") +
      opts.map((o) => `<button class="btn ghost" data-plr="${o.rounds}" style="margin:0 6px 6px 0">
        ${o.gamesPerTeam} games each · ${o.rounds} rounds${o.byesPerTeam ? ` · sits ${o.byesPerTeam}` : ""}</button>`).join("");
    document.querySelectorAll("[data-plr]").forEach((b) => b.onclick = () => previewPlan(t, c, +b.dataset.plr));
    // One tap saved: if a listed option hits the asked-for games exactly, preview it right away.
    const want = +$("plGames").value || 8;
    const hit = opts.find((o) => o.gamesPerTeam === want);
    if (hit) previewPlan(t, c, hit.rounds);
  };

  async function previewPlan(t, c, rounds) {
    const r = await api("/api/admin/formats/plan", { method: "POST", body: JSON.stringify({
      teams: t, courts: c, rounds, target_games: +$("plGames").value || undefined,
    }) });
    if (!r.ok) { $("plSummary").textContent = r.data.error || "That plan didn't work out."; return; }
    plannedRounds = rounds;
    const split = r.data.pool_split;
    $("plSummary").innerHTML =
      (r.data.summary || []).map((s) => `<div>${s}</div>`).join("") +
      (split && split.note ? `<div style="margin-top:4px"><b>Pools:</b> ${split.note}${split.sizes && split.sizes.some((s) => s === 5) ? " A 5-team pool doubles its round robin so nobody goes home under 8 games." : ""}</div>` : "");
    $("plCommit").hidden = false;
    $("plCommit").textContent = `Use this plan (${rounds} rounds)`;
  }

  $("plCommit").onclick = async () => {
    if (!plannedRounds || !currentEvent) return;
    const body = { courts: +$("plCourts").value, rounds: plannedRounds, assign_refs: true };
    let r = await api(`/api/admin/events/${currentEvent.id}/generate-schedule`, { method: "POST", body: JSON.stringify(body) });
    if (r.status === 409) {
      if (!confirm(`${r.data.error} Replace it with this plan?`)) return;
      r = await api(`/api/admin/events/${currentEvent.id}/generate-schedule`, { method: "POST", body: JSON.stringify({ ...body, replace: true }) });
    }
    $("plMsg").textContent = r.ok ? "Schedule written — it's below." : (r.data.error || "Couldn't write the schedule.");
    if (r.ok) refreshAll();
  };

  /* ---------- generate + feasibility ---------- */
  $("generateBtn").onclick = () => generate({});
  async function generate(extra) {
    const r = await api(`/api/events/${currentEvent.id}/schedule`, { method: "POST", body: JSON.stringify(extra) });
    const f = r.data.feasibility;
    const box = $("feasBox");
    if (r.status === 409) {
      box.innerHTML = `<div class="warn-banner">${r.data.error}
        <div><button class="btn fix-btn" id="confirmWipe">Regenerate anyway (wipes scores)</button></div></div>`;
      $("confirmWipe").onclick = () => generate({ ...extra, confirm_wipe_scores: true });
      return;
    }
    if (f && !r.data.generated) {
      box.innerHTML = `<div class="warn-banner"><strong>Doesn't fit yet.</strong> ${f.warnings.join(" ")}
        <div>${(f.fixes || []).map((fx, i) => `<button class="btn ghost fix-btn" data-i="${i}">${fx.why}</button>`).join("")}
        <button class="btn ghost fix-btn" id="forceGen">Generate anyway</button></div></div>`;
      box.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => generate({ ...extra, ...f.fixes[+b.dataset.i].change })));
      $("forceGen").onclick = () => generate({ ...extra, force: true });
      return;
    }
    if (r.ok && r.data.generated) {
      box.innerHTML = `<div class="notice">Schedule set: ${r.data.rounds} rounds, est ${Math.round(f.estMinutes / 6) / 10} hr, ${f.pointsPerTeam} pts/team, bye spread ${r.data.byeSpread}.</div>`;
      refreshAll();
    } else if (!r.ok) {
      box.innerHTML = `<div class="warn-banner">${r.data.error || "Generation failed."}</div>`;
    }
  }

  /* ---------- grid ---------- */
  async function refreshAll() {
    const [sched, tms] = await Promise.all([
      api(`/api/events/${currentEvent.id}/schedule`),
      api(`/api/events/${currentEvent.id}/teams`),
    ]);
    teams = tms.data.teams || [];
    teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]));
    $("teamCount").textContent = teams.length ? `(${teams.length})` : "";
    if (teams.length) $("plTeams").value = teams.length; // W-C: the field count is the default, not a retype
    matches = (sched.data.matches || []).filter((m) => m.stage === "pool");
    renderWarnings(sched.data.warnings || []);
    renderGrid();
    renderStandings();
  }

  function renderWarnings(warnings) {
    $("warningsBox").innerHTML = warnings.length
      ? `<div class="warn-banner">⚠ ${warnings.map((w) =>
          w.type === "rematch" ? `Rematch: ${w.pair.split("-").map((id) => teamName[id] || id).join(" vs ")}`
          : `Round ${w.round}: ${teamName[w.team_id] || w.team_id} on two courts`).join(" · ")}
          — your call stands; this is just a heads-up.</div>`
      : "";
  }

  function renderGrid() {
    const grid = $("poolGrid");
    if (!matches.length) { $("gridPanel").hidden = true; return; }
    $("gridPanel").hidden = false;
    const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
    const courts = [...new Set(matches.map((m) => m.court))].sort((a, b) => a - b);
    let html = `<tr><th>Round</th>${courts.map((c) => `<th>Court ${c}</th>`).join("")}<th>Bye / Work</th></tr>`;
    for (const r of rounds) {
      const inRound = matches.filter((m) => m.round === r);
      const playing = new Set(inRound.flatMap((m) => [m.team_a_id, m.team_b_id]));
      const byes = teams.filter((t) => !playing.has(t.id)).map((t) => t.name).join(", ");
      html += `<tr><td class="round-label">${r}</td>`;
      for (const c of courts) {
        const m = inRound.find((x) => x.court === c);
        html += `<td data-round="${r}" data-court="${c}" class="drop-cell">` + (m ? matchCell(m) : "") + `</td>`;
      }
      html += `<td class="bye-col">${byes || "—"}</td></tr>`;
    }
    grid.innerHTML = html;

    grid.querySelectorAll(".match-cell").forEach((el) => {
      el.onclick = () => openScoreSheet(+el.dataset.id);
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", el.dataset.id); el.classList.add("dragging"); });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
    });
    grid.querySelectorAll(".drop-cell").forEach((cell) => {
      cell.addEventListener("dragover", (e) => { e.preventDefault(); cell.classList.add("drop-target"); });
      cell.addEventListener("dragleave", () => cell.classList.remove("drop-target"));
      cell.addEventListener("drop", async (e) => {
        e.preventDefault(); cell.classList.remove("drop-target");
        const id = +e.dataTransfer.getData("text/plain");
        const r = await api(`/api/matches/${id}`, { method: "PATCH",
          body: JSON.stringify({ round: +cell.dataset.round, court: +cell.dataset.court }) });
        renderWarnings(r.data.warnings || []);
        refreshAll();
      });
    });
  }

  function matchCell(m) {
    const scored = m.score_a != null;
    return `<div class="match-cell${scored ? " scored" : ""}" data-id="${m.id}" role="button" tabindex="0"
      aria-label="${teamName[m.team_a_id]} versus ${teamName[m.team_b_id]}${scored ? `, ${m.score_a} to ${m.score_b}` : ", tap to score"}">
      <span class="vs">${teamName[m.team_a_id] || "?"} <span class="muted">vs</span> ${teamName[m.team_b_id] || "?"}</span>
      ${scored ? `<span class="score">${m.score_a}–${m.score_b}</span>` : ""}
      ${m.ref_team_id ? `<span class="ref">ref: ${teamName[m.ref_team_id] || ""}</span>` : ""}
    </div>`;
  }

  /* ---------- 2-tap scoring: tap winner, tap differential ---------- */
  function openScoreSheet(matchId) {
    const m = matches.find((x) => x.id === matchId);
    const sheet = $("scoreSheet");
    sheet.hidden = false;
    sheet.classList.add("open");
    const diffs = Array.from({ length: Math.min(m.points_to, 15) }, (_, i) => i + 1);
    sheet.innerHTML = `
      <h4>Who won? <span class="muted">(to ${m.points_to}, cap ${m.cap})</span></h4>
      <div class="tap-row">
        <button class="btn" data-w="a">${teamName[m.team_a_id]}</button>
        <button class="btn" data-w="b">${teamName[m.team_b_id]}</button>
        <button class="btn ghost" data-w="x">Cancel</button>
      </div>
      <div id="diffRow" hidden>
        <h4>Won by…</h4>
        <div class="tap-row">${diffs.map((d) => `<button class="diff-chip" data-d="${d}">${d}</button>`).join("")}</div>
      </div>`;
    let winner = null;
    sheet.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => {
      if (b.dataset.w === "x") return closeSheet();
      winner = b.dataset.w;
      sheet.querySelector("#diffRow").hidden = false;   // tap 1 done
    }));
    sheet.querySelectorAll("[data-d]").forEach((b) => (b.onclick = async () => {  // tap 2
      await api(`/api/matches/${matchId}/score`, { method: "POST", body: JSON.stringify({ winner, diff: +b.dataset.d }) });
      closeSheet();
      refreshAll();
    }));
    function closeSheet() { sheet.hidden = true; sheet.classList.remove("open"); }
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { closeSheet(); document.removeEventListener("keydown", esc); } });
  }

  /* ---------- standings + bracket ---------- */
  async function renderStandings() {
    const r = await api(`/api/events/${currentEvent.id}/standings`);
    const rows = r.data.standings || [];
    $("standingsPanel").hidden = rows.length === 0;
    $("standingsTable").innerHTML =
      `<tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>±</th><th>PF</th></tr>` +
      rows.map((s) => `<tr><td>${s.rank}</td><td>${s.name}</td><td>${s.wins}</td><td>${s.losses}</td><td>${s.point_diff > 0 ? "+" : ""}${s.point_diff}</td><td>${s.points_for}</td></tr>`).join("");
  }

  $("bracketBtn").onclick = async () => {
    // T2-5 (v0.121.0): this POSTed the legacy /api/events/:id/bracket, which wrote only the first
    // round and skipped byes — "breaking does nothing" was the owner reading that result honestly.
    // The modern engine (preview / advance / slot / forfeit, division court ranges) owns brackets;
    // the body key is a_size — the engine ignores unknown keys, so the old aSize silently defaulted.
    const r = await api(`/api/admin/events/${currentEvent.id}/brackets`, { method: "POST", body: JSON.stringify({ a_size: +$("aSize").value }) });
    $("warningsBox").innerHTML = r.ok
      ? `<div class="notice">${(r.data.summary || []).join(" · ")} &#8212; <a href="admin-brackets.html?event=${currentEvent.id}">open the bracket board</a> to run it.</div>`
      : `<div class="warn-banner">${r.data.error || "Bracket failed."}</div>`;
  };

  /* ---------- print + CSV ---------- */
  $("printBtn").onclick = () => print();
  $("csvBtn").onclick = () => {
    const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = ["round,court,team_a,team_b,ref,score_a,score_b"];
    for (const m of matches) lines.push([m.round, m.court, esc(teamName[m.team_a_id]), esc(teamName[m.team_b_id]), esc(teamName[m.ref_team_id] || ""), m.score_a ?? "", m.score_b ?? ""].join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${new Date().toISOString().slice(0, 10)}_${(currentEvent.name || "schedule").replace(/\W+/g, "-")}_schedule.csv`;
    a.click();
  };
})();
