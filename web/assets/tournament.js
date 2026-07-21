/* Boomtown Platform — Tournament Ops
   Version: v0.2 · Date: 2026-07-21
   Flow: pick/create event → paste teams → generate (feasibility gate with one-tap fixes)
   → live grid (drag to move, tap to score in 2 taps) → standings → bracket → print/CSV. */

(function () {
  const API = window.BT_CONFIG.apiBase;
  const $ = (id) => document.getElementById(id);
  let bearer = sessionStorage.getItem("bt_token") || null;
  let currentEvent = null, teams = [], teamName = {}, matches = [], formats = {};

  /* theme + org (same behavior as index) */
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
    const resp = await fetch(API + path, Object.assign({}, opts, { headers, credentials: "include" }));
    return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
  }

  /* ---------- boot ---------- */
  (async function boot() {
    if (!bearer) { location.href = "index.html"; return; }
    const me = await api("/api/me");
    if (!me.ok) { location.href = "index.html"; return; }
    const orgs = (await api("/api/orgs")).data.orgs || [];
    const sw = $("orgSwitcher");
    sw.innerHTML = orgs.map((o) => `<option value="${o.id}">${o.name}</option>`).join("");
    const saved = localStorage.getItem("bt_org");
    if (saved) sw.value = saved;
    sw.onchange = () => { localStorage.setItem("bt_org", sw.value); loadEvents(); };
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
    if (evs.length === 1) { $("eventSelect").value = evs[0].id; openEvent(evs[0].id); }
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
    const r = await api(`/api/events/${currentEvent.id}/bracket`, { method: "POST", body: JSON.stringify({ aSize: +$("aSize").value }) });
    $("warningsBox").innerHTML = r.ok
      ? `<div class="notice">Brackets created: ${r.data.brackets.map((b) => `${b.name} (${b.teams})`).join(", ")}. Semis & finals are best-of-3 (21-21-15).</div>`
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
