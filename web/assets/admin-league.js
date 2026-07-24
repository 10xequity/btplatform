/* Boomtown Platform — League Manager
   File: web/assets/admin-league.js · Version: v1.1 · Date: 2026-07-24 · Ships in: v0.9.1
   RECOVERY of the lost v0.7.0 file. Levels board (gap-capped weekly scheduler),
   generate/remove weeks, 2-tap scoring (winner → point diff), standings, staff pick. */

(function () {
  const { api, guard, esc, openModal, closeModal } = window.BT_ADMIN;
  const $ = id => document.getElementById(id);
  let leagueId = null, data = null;

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
    sw.onchange = () => { localStorage.setItem("bt_org", sw.value); loadLeagues(); };
    $("genWeek").onclick = generateWeek;
    $("saveLevels").onclick = saveLevels;
    await loadLeagues();
  }

  async function loadLeagues() {
    const r = await api("/api/admin/leagues");
    if (!r.ok) { say(r.data.error, true); return; }
    const leagues = r.data.leagues || [];
    const sel = $("leagueSelect");
    $("emptyMsg").hidden = leagues.length > 0;
    $("board").hidden = true;
    sel.innerHTML = `<option value="">Choose league…</option>` + leagues.map(l =>
      `<option value="${l.id}">${esc(l.name)} · ${l.team_count} team${l.team_count === 1 ? "" : "s"} · wk ${l.weeks_played}</option>`).join("");
    sel.onchange = () => { leagueId = +sel.value || null; leagueId ? load() : ($("board").hidden = true); };
    const live = leagues.find(l => l.status === "in_progress") || leagues[0];
    if (live) { sel.value = live.id; leagueId = live.id; load(); }
  }

  async function load() {
    const r = await api(`/api/leagues/${leagueId}/board`);
    if (!r.ok) { say(r.data.error, true); return; }
    data = r.data;
    $("board").hidden = false;
    $("emptyMsg").hidden = true;
    renderLevels(); renderStaff(); renderStandings(); renderWeeks();
    $("genHint").textContent = data.teams.length < 2 ? "Add at least 2 teams first." : "";
  }

  function renderLevels() {
    $("levels").innerHTML = data.teams.map(t => `
      <div class="lvl-row" data-team="${t.id}">
        <span class="nm">${esc(t.name)}</span>
        <span class="rec">${t.wins}–${t.losses}</span>
        <select aria-label="Level for ${esc(t.name)}">
          ${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === t.level_num ? " selected" : ""}>${n}</option>`).join("")}
        </select>
      </div>`).join("") || `<p class="help-text">No teams yet — teams land here from registrations or Tournament Ops.</p>`;
  }

  async function saveLevels() {
    const levels = [...$("levels").querySelectorAll(".lvl-row")].map(row => ({
      team_id: +row.dataset.team, level_num: +row.querySelector("select").value,
    }));
    if (!levels.length) return;
    const r = await api(`/api/leagues/${leagueId}/levels`, { method: "POST", body: JSON.stringify({ levels }) });
    say(r.ok ? "Levels saved" : r.data.error, !r.ok);
    if (r.ok) load();
  }

  function renderStaff() {
    const sel = $("staffSelect");
    sel.innerHTML = `<option value="">Nobody assigned</option>` + (data.staff_options || []).map(s =>
      `<option value="${s.contact_id}">${esc(s.full_name || "Unnamed")}</option>`).join("");
    sel.value = data.event.staff_contact_id || "";
    sel.onchange = async () => {
      const r = await api(`/api/leagues/${leagueId}/staff`, {
        method: "POST", body: JSON.stringify({ contact_id: sel.value ? +sel.value : null }),
      });
      say(r.ok ? "Staff updated" : r.data.error, !r.ok);
    };
  }

  function renderStandings() {
    $("standings").innerHTML = (data.standings || []).map(s => `
      <tr><td>${s.rank ?? "—"}</td><td>${esc(s.name)}</td><td>${s.wins}–${s.losses}</td>
      <td>${s.point_diff > 0 ? "+" : ""}${s.point_diff}</td></tr>`).join("") ||
      `<tr><td colspan="4" class="help-text">Standings fill in after the first scored game.</td></tr>`;
  }

  function renderWeeks() {
    const weeks = data.weeks || [];
    $("weeks").innerHTML = weeks.length ? weeks.map(w => {
      const unscored = w.matches.every(m => m.score_a == null);
      return `<section class="card wk-card">
        <div class="wk-head"><h3>Week ${w.round}</h3><div class="spacer"></div>
          ${unscored ? `<button class="btn ghost" data-delweek="${w.round}">Remove week</button>` : ""}</div>
        ${w.matches.map(m => matchRow(m)).join("")}
      </section>`;
    }).join("") : `<section class="card"><p class="help-text" style="margin:0">No weeks yet. Set team levels, then generate week 1.</p></section>`;

    $("weeks").querySelectorAll("[data-score]").forEach(b => b.onclick = () => scoreModal(+b.dataset.score));
    $("weeks").querySelectorAll("[data-delweek]").forEach(b => b.onclick = async () => {
      const wk = b.dataset.delweek;
      const r = await api(`/api/leagues/${leagueId}/week/${wk}`, { method: "DELETE" });
      say(r.ok ? `Week ${wk} removed` : r.data.error, !r.ok);
      if (r.ok) load();
    });
  }

  function matchRow(m) {
    const scored = m.score_a != null;
    const aWin = scored && m.score_a > m.score_b;
    return `<div class="mt-row">
      <span class="court">Court ${m.court}</span>
      <span class="vs"><b class="${aWin ? "win" : ""}">${esc(m.team_a || "TBD")}</b> vs
        <b class="${scored && !aWin ? "win" : ""}">${esc(m.team_b || "TBD")}</b></span>
      ${scored
        ? `<span class="score">${m.score_a}–${m.score_b}</span>`
        : `<button class="btn ghost" data-score="${m.id}">Score</button>`}
    </div>`;
  }

  function scoreModal(matchId) {
    let m = null;
    for (const w of data.weeks) { const hit = w.matches.find(x => x.id === matchId); if (hit) m = hit; }
    if (!m) return;
    const back = openModal(`
      <h2>Who won?</h2>
      <div class="diff-btns">
        <button class="btn" data-w="a">${esc(m.team_a)}</button>
        <button class="btn" data-w="b">${esc(m.team_b)}</button>
      </div>
      <div id="diffStep" hidden>
        <p style="margin:6px 0 4px">By how many points?</p>
        <div class="diff-btns">
          ${[1, 2, 3, 4, 5].map(n => `<button class="btn ghost" data-d="${n}">${n}</button>`).join("")}
          <input id="diffCustom" type="number" min="1" max="${m.points_to}" placeholder="More" style="width:84px" aria-label="Point difference" />
        </div>
      </div>
      <div class="actions"><button class="btn ghost" data-cancel>Cancel</button></div>`);
    let winner = null;
    back.querySelectorAll("[data-w]").forEach(b => b.onclick = () => {
      winner = b.dataset.w;
      back.querySelectorAll("[data-w]").forEach(x => x.classList.toggle("ghost", x !== b));
      back.querySelector("#diffStep").hidden = false;
    });
    const send = async diff => {
      const r = await api(`/api/matches/${matchId}/score`, { method: "POST", body: JSON.stringify({ winner, diff }) });
      closeModal();
      say(r.ok ? "Score saved" : r.data.error, !r.ok);
      if (r.ok) load();
    };
    back.querySelectorAll("[data-d]").forEach(b => b.onclick = () => winner && send(+b.dataset.d));
    back.querySelector("#diffCustom").addEventListener("change", e => {
      const d = +e.target.value;
      if (winner && d >= 1) send(d);
    });
    back.querySelector("[data-cancel]").onclick = closeModal;
  }

  async function generateWeek() {
    if (!leagueId) return;
    $("genWeek").disabled = true;
    const r = await api(`/api/leagues/${leagueId}/week`, { method: "POST", body: JSON.stringify({}) });
    $("genWeek").disabled = false;
    if (!r.ok) { say(r.data.error, true); return; }
    let note = `Week ${r.data.round} created — ${r.data.matches} game${r.data.matches === 1 ? "" : "s"}`;
    if ((r.data.byes || []).length) note += ` · sitting: ${r.data.byes.map(b => b.name).join(", ")}`;
    say(note, false);
    if ((r.data.warnings || []).length) {
      $("status").insertAdjacentHTML("beforeend",
        `<p class="warn-note">${r.data.warnings.map(w =>
          w.type === "rematch" ? `${esc(w.teams[0])} vs ${esc(w.teams[1])} is meeting ${w.count === 2 ? "again" : "for time " + w.count}` :
          `${esc(w.teams[0])} has no opponent within 2 levels — adjust levels or add a team`).join(" · ")}</p>`);
    }
    load();
  }

  function say(msg, isErr) {
    $("status").innerHTML = msg ? `<p class="${isErr ? "notice-err" : "notice-ok"}">${esc(msg)}</p>` : "";
  }
})();
