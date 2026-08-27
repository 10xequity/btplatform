/* Boomtown Platform — League Manager
   File: web/assets/admin-league.js · Version: v1.7 · Date: 2026-08-27 · Ships in: v0.93.0
   (v1.7 in v0.211.0: the strength-of-power playoff fixture — syncFormatControls keeps the
   rounds/games selects honest per format, full match best-of-3 is a pods-only choice.
   v1.6.1 in v0.210.0: inlineRename mechanics → BT_ADMIN.inlineEdit, §-1c D-60)

   v1.5 (§-1r RF-2 Unit B + RF-3, owner rules 2026-08-24):
   · The generate press sends roundsPerNight (1-3) and gamesPerMatch (1-2) from the toolbar
     selects. A structured night renders each game's number ("Game N", the night's play order)
     and the copy/CSV/email shapes carry it, so the schedule reads in order on paper and in a text.
   · Forfeits: the score modal offers "X forfeits" — POST { forfeit_by } stores the conventional
     points_to-0 plus the flag; a forfeited row reads "25-0 · forfeit". The differential rule
     (one point, not twenty-five) lives server-side in computeStandings, never here.
   v1.4 (§-1b W-B): the week is HAND-EDITABLE AND EXPORTABLE, closing the owner's league loop.
   · Edit a matchup by ENTRY: every unscored game gets Edit → two team pickers →
     POST /api/admin/events/:id/schedule/teams (built in formats.js since the format engine,
     uncalled until now — struck from the reachability baseline this release).
   · Drag-and-drop lives in the Schedule Editor, where it always did — the toolbar now links
     there with the league preselected (?event=), instead of leaving the path undiscoverable.
   · Export: Print schedule (print stylesheet — the sheet on the gym door) and a per-week
     "Copy as text" that produces paste-ready lines for a group text or email.
   Scoring stays 2-tap winner → point margin — the owner's differential rule was already the
   design here and on the captains' score links; verified, not rebuilt.
   v1.3 (v0.92.0, W-A): Roster button per team → shared roster modal (team-roster.js).
   v1.2 · 2026-08-02 · RECOVERY of the lost v0.7.0 file. Levels board (gap-capped weekly
   scheduler), generate/remove weeks, 2-tap scoring (winner → point diff), standings, staff pick. */

(function () {
  const { api, guard, esc, openModal, closeModal, downloadText, csvRow, emailDocument } = window.BT_ADMIN;
  const $ = id => document.getElementById(id);
  let leagueId = null, data = null;

  /* v0.52.0: theme is single-source now — pre-paint via the shared <head> snippet, toggle in admin-nav.js v2.19. */
  boot();
  async function boot() {
    const me = await guard(); if (!me) return;
    /* v0.52.0: org switcher is single-source now — populated + handled by admin-nav.js v2.19. */
    $("genWeek").onclick = generateWeek;
    $("saveLevels").onclick = saveLevels;
    $("printWeeks").onclick = () => window.print(); // W-B: the schedule is a hand-out; print is export
    // WF-6 (v0.138.0): print gets its two siblings. The owner asked for all three wherever
    // there is one, and the whole schedule — not one week — is what a hand-out contains.
    $("csvWeeks").onclick = csvWeeks;
    $("emailWeeks").onclick = emailWeeks;
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
    // WF-5 H-2 (v0.140.0): the manager hub points this page at ONE event via ?event=N. ADDITIVE —
    // with no ?event= the page behaves exactly as it did from the rail, which is what makes the hub
    // reversible and keeps this page's own way in. An id this org cannot see is ignored, never
    // forced: the picker is the org's own truth.
    const fromUrl = Number(new URLSearchParams(location.search).get("event")) || 0;
    // A league's id IS its event id (the schedule-editor link has passed it as ?event= since W-B).
    const live = leagues.find(l => l.id === fromUrl)
      || leagues.find(l => l.status === "in_progress") || leagues[0];
    if (live) { sel.value = live.id; leagueId = live.id; load(); }
  }

  async function load() {
    const r = await api(`/api/leagues/${leagueId}/board`);
    if (!r.ok) { say(r.data.error, true); return; }
    data = r.data;
    $("board").hidden = false;
    $("emptyMsg").hidden = true;
    $("editorLink").href = `admin-schedule-editor.html?event=${leagueId}`; // W-B: drag-drop lives there
    renderLevels(); renderStaff(); renderStandings(); renderWeeks();
    $("genHint").textContent = data.teams.length < 2 ? "Add at least 2 teams first." : "";
  }

  function renderLevels() {
    $("levels").innerHTML = data.teams.map(t => `
      <div class="lvl-row" data-team="${t.id}">
        <span class="nm bt-inline-edit" data-team-name="${t.id}" tabindex="0" role="button" title="Double-click to rename this team">${esc(t.name)}</span>
        <span class="rec">${t.wins}–${t.losses}</span>
        <select aria-label="Level for ${esc(t.name)}">
          ${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === t.level_num ? " selected" : ""}>${n}</option>`).join("")}
        </select>
        <button class="btn ghost" type="button" data-roster="${t.id}" aria-label="Open the roster for ${esc(t.name)}">Roster</button>
        <button class="btn ghost" type="button" data-move="${t.id}" data-name="${esc(t.name)}" aria-label="Move ${esc(t.name)} to another league">Move</button>
      </div>`).join("") || `<p class="help-text">No teams yet; teams land here from registrations or Tournament Ops.</p>`;
    // W-A (v0.92.0): each team opens the roster its registration created — names editable there.
    $("levels").querySelectorAll("[data-roster]").forEach(b => b.addEventListener("click", () =>
      window.BT_ROSTER && window.BT_ROSTER.open(Number(b.dataset.roster))));
    // T2-1b (v0.193.0): move a team to another league — the server refuses while it has games here.
    $("levels").querySelectorAll("[data-move]").forEach(b => b.addEventListener("click", () =>
      moveModal(Number(b.dataset.move), b.dataset.name)));
    // v1.6 (owner 2026-08-26): double-click a team name to rename it in place — the QC generator's
    // EditableField ported to the board (the roster modal's rename still works too).
    $("levels").querySelectorAll("[data-team-name]").forEach(inlineRename);
  }

  /* Double-click (or Enter) a static team name → an input; Enter/blur commits via the EXISTING
     PATCH /api/admin/teams/:id route, Escape cancels. An empty or unchanged name never hits the
     server. v1.6.1 (§-1c D-60, v0.210.0): the DOM/focus/latch mechanics moved to
     BT_ADMIN.inlineEdit — one owner for this board and Tournament Ops. The board thereby GAINS
     the focus-restore on a failed or no-op commit that v0.207.0 had put on its Escape path only
     (the drift D-60 recorded). Guard: admin_inline_edit.test.mjs; the PATCH stays pinned here
     by league_inline_rename.test.mjs. */
  function inlineRename(span) {
    const teamId = Number(span.dataset.teamName);
    BT_ADMIN.inlineEdit(span, {
      commit: async (name) => {
        const r = await api(`/api/admin/teams/${teamId}`, { method: "PATCH", body: JSON.stringify({ name }) });
        if (r.ok) { load(); } else { say(r.data.error || "Couldn't rename the team.", true); }
        return r.ok;
      },
    });
  }

  /* T2-1b: the destination list is the league picker's own, minus this league. Registrations stay
     on the original event (the server says so too) — this moves scheduling, not money. */
  function moveModal(teamId, name) {
    const opts = [...$("leagueSelect").options]
      .filter(o => o.value && Number(o.value) !== leagueId)
      .map(o => `<option value="${o.value}">${esc(o.textContent)}</option>`).join("");
    if (!opts) { say("No other league to move to. Create one first.", true); return; }
    const back = openModal(`
      <h2>Move ${esc(name)}</h2>
      <p class="help-text">Registrations stay on the original event; this moves the team's
        scheduling only. A team with games on this schedule can't move until those matchups
        are cleared.</p>
      <div class="field"><label>To league</label><select id="mvTo">${opts}</select></div>
      <div class="actions"><button class="btn ghost" id="mvCancel">Cancel</button>
        <button class="btn" id="mvGo">Move team</button></div>`);
    back.querySelector("#mvCancel").onclick = closeModal;
    back.querySelector("#mvGo").onclick = async () => {
      const r = await api(`/api/admin/events/${leagueId}/teams/${teamId}/move-event`, {
        method: "POST", body: JSON.stringify({ to_event_id: +back.querySelector("#mvTo").value }),
      });
      closeModal();
      say(r.ok ? `${name} moved to ${r.data.to}. ${r.data.note || ""}` : r.data.error, !r.ok);
      if (r.ok) load();
    };
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
    /* RF-2 Unit A: a long season scrolls forever. Each week card gets an id (#wk-N); the toolbar's
       jump control (hidden until there are 2+ weeks) lands on any of them, each week carries an
       "↑ Top" link back to the toolbar, and a per-week chevron collapses its matches (the pool
       board's #pbCollapse idiom). No pairing/engine change — this is navigation only. */
    const jump = $("weekJump");
    if (jump) {
      jump.hidden = weeks.length < 2;
      jump.innerHTML = weeks.length < 2 ? "" :
        `<option value="">Jump to week…</option>` +
        weeks.map(w => `<option value="wk-${w.round}">Week ${w.round}</option>`).join("");
      jump.onchange = () => {
        const el = jump.value && document.getElementById(jump.value);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        jump.value = "";
      };
    }
    $("weeks").innerHTML = weeks.length ? weeks.map(w => {
      const unscored = w.matches.every(m => m.score_a == null);
      return `<section class="card wk-card" id="wk-${w.round}">
        <div class="wk-head">
          <button class="btn ghost sm wk-collapse no-print" type="button" aria-expanded="true" aria-controls="wkb-${w.round}" title="Collapse or expand this week">▾</button>
          <h3>Week ${w.round}</h3><div class="spacer"></div>
          <a class="wk-top no-print" href="#weekTop">↑ Top</a>
          <button class="btn ghost no-print" data-copyweek="${w.round}">Copy as text</button>
          ${unscored ? `<button class="btn ghost" data-delweek="${w.round}">Remove week</button>` : ""}</div>
        <div class="wk-body" id="wkb-${w.round}">${w.matches.map(m => matchRow(m, w.matches.some(x => (x.game_number || 1) > 1))).join("")}</div>
      </section>`;
    }).join("") : `<section class="card"><p class="help-text" style="margin:0">No weeks yet. Set team levels, then generate week 1.</p></section>`;

    $("weeks").querySelectorAll(".wk-collapse").forEach(b => b.onclick = () => {
      const body = document.getElementById(b.getAttribute("aria-controls"));
      const open = b.getAttribute("aria-expanded") === "true";
      b.setAttribute("aria-expanded", String(!open));
      b.textContent = open ? "▸" : "▾";
      if (body) body.hidden = open;
    });
    $("weeks").querySelectorAll("[data-score]").forEach(b => b.onclick = () => scoreModal(+b.dataset.score));
    $("weeks").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => matchupModal(+b.dataset.edit));
    $("weeks").querySelectorAll("[data-copyweek]").forEach(b => b.onclick = () => copyWeek(+b.dataset.copyweek, b));
    $("weeks").querySelectorAll("[data-delweek]").forEach(b => b.onclick = async () => {
      const wk = b.dataset.delweek;
      const r = await api(`/api/leagues/${leagueId}/week/${wk}`, { method: "DELETE" });
      say(r.ok ? `Week ${wk} removed` : r.data.error, !r.ok);
      if (r.ok) load();
    });
  }

  /* RF-3 remnant (v0.195.0, owner 2026-08-24 point 3): "add a note that this team has played
     together prior (last week recency bias) and denote not to do that but can be ignored if
     necessary." ADVISORY, never blocking — the note names the most recent prior week and nothing
     refuses the pairing. Computed HERE from data.weeks (the board payload already carries every
     match), so there is no payload change. A pair has met when an EARLIER match — a lower round,
     or the same round with a lower game number (a same-night rotation is the maximum recency) —
     holds the same two teams, in either order. Returns the most recent prior week, 0 for never.
     Guards: league_week_nav.test.mjs v1.1. */
  function metBefore(aId, bId, round, game) {
    let last = 0;
    for (const w of data.weeks || []) for (const x of w.matches) {
      if (!x.team_a_id || !x.team_b_id) continue;
      if (!(x.round < round || (x.round === round && (x.game_number || 1) < (game || 1)))) continue;
      const same = (x.team_a_id === aId && x.team_b_id === bId) ||
                   (x.team_a_id === bId && x.team_b_id === aId);
      if (same && x.round > last) last = x.round;
    }
    return last;
  }

  /* RF-2B: `structured` is true when the WEEK carries game numbers past 1 (a multi-rotation or
     two-game night) — only then does the row show its play order, so a plain week stays clean. */
  function matchRow(m, structured) {
    const scored = m.score_a != null;
    const aWin = scored && m.score_a > m.score_b;
    // RF-3: the recency note rides UNSCORED rows only — a finished game is history, not a plan.
    const met = !scored && m.team_a_id && m.team_b_id ? metBefore(m.team_a_id, m.team_b_id, m.round, m.game_number) : 0;
    return `<div class="mt-row">
      <span class="court">Court ${m.court}${structured ? ` · Game ${m.game_number || 1}` : ""}</span>
      <span class="vs"><b class="${aWin ? "win" : ""}">${esc(m.team_a || "TBD")}</b> vs
        <b class="${scored && !aWin ? "win" : ""}">${esc(m.team_b || "TBD")}</b></span>
      ${met ? `<span class="mt-met no-print" title="These teams already played each other in week ${met}. Avoid a rematch if you can; keep it if you need to.">Played together · wk ${met}</span>` : ""}
      ${scored
        ? `<span class="score">${m.score_a}–${m.score_b}${m.forfeit_by ? " · forfeit" : ""}</span>`
        : `<button class="btn ghost no-print" data-edit="${m.id}" aria-label="Change who plays this game">Edit</button>
           <button class="btn ghost" data-score="${m.id}">Score</button>`}
    </div>`;
  }

  /* W-B: edit a matchup by ENTRY — pick the two teams from lists, no dragging required. Scored
     games are deliberately not editable here: changing who played a finished game rewrites
     history; remove the score first if it was truly the wrong pairing. */
  function matchupModal(matchId) {
    let m = null;
    for (const w of data.weeks) { const hit = w.matches.find(x => x.id === matchId); if (hit) m = hit; }
    if (!m) return;
    const opts = (sel) => data.teams.map(t =>
      `<option value="${t.id}"${t.id === sel ? " selected" : ""}>${esc(t.name)}</option>`).join("");
    const back = openModal(`
      <h2>Who plays this game?</h2>
      <div class="row2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>Team A</label><select id="muA">${opts(m.team_a_id)}</select></div>
        <div class="field"><label>Team B</label><select id="muB">${opts(m.team_b_id)}</select></div>
      </div>
      <p class="help-text" id="muMet" role="status" aria-live="polite" style="margin:8px 0 0"></p>
      <div class="actions"><button class="btn ghost" id="muCancel">Cancel</button>
        <button class="btn" id="muGo">Save matchup</button></div>`);
    /* RF-3 (v0.195.0): the live recency note — recomputed as either select changes, advisory
       only (his "can be ignored if necessary"): the Save button never gates on it. */
    const muSync = () => {
      const a = +back.querySelector("#muA").value, b = +back.querySelector("#muB").value;
      const met = a && b && a !== b ? metBefore(a, b, m.round, m.game_number) : 0;
      back.querySelector("#muMet").textContent = met
        ? `These teams already played each other in week ${met}. Avoid a rematch if you can; keep it if you need to.`
        : "";
    };
    muSync();
    back.querySelector("#muA").onchange = muSync;
    back.querySelector("#muB").onchange = muSync;
    back.querySelector("#muCancel").onclick = closeModal;
    back.querySelector("#muGo").onclick = async () => {
      const r = await api(`/api/admin/events/${leagueId}/schedule/teams`, { method: "POST", body: JSON.stringify({
        match_id: matchId,
        team_a_id: +back.querySelector("#muA").value,
        team_b_id: +back.querySelector("#muB").value,
      }) });
      closeModal();
      say(r.ok ? "Matchup updated" : r.data.error, !r.ok);
      if (r.ok) load();
    };
  }

  /* W-B: the week as paste-ready text — a group text or an email carries no table, so this is
     the export that actually gets used between the print-outs. */
  /* WF-6: ONE line shape for a week, read by "Copy as text" AND by the emailed schedule. These
     were about to be two spellings of the same sentence, and the pasted week and the emailed
     week disagreeing about how a score reads is exactly the drift this repo keeps paying for. */
  function weekLines(w) {
    const structured = w.matches.some(x => (x.game_number || 1) > 1); // RF-2B: play order only when the night has one
    return [`Week ${w.round}`,
      ...w.matches.map(m => `${structured ? `Game ${m.game_number || 1} · ` : ""}Court ${m.court}: ${m.team_a || "TBD"} vs ${m.team_b || "TBD"}${m.score_a != null ? ` (${m.score_a}–${m.score_b}${m.forfeit_by ? " forfeit" : ""})` : ""}`)];
  }

  /* WF-6: the whole schedule as a spreadsheet. One row per game, unplayed games included with
     empty score cells — a schedule that hid its unplayed games would be a results sheet. */
  function csvWeeks() {
    const weeks = (data && data.weeks) || [];
    if (!weeks.length) { say("No weeks yet. Generate week 1 first.", true); return; }
    const rows = [csvRow(["Week", "Game", "Court", "Team A", "Team B", "Score A", "Score B", "Forfeit"])];
    for (const w of weeks) {
      for (const m of w.matches) {
        rows.push(csvRow([w.round, m.game_number || 1, m.court, m.team_a || "", m.team_b || "",
          m.score_a != null ? m.score_a : "", m.score_b != null ? m.score_b : "",
          m.forfeit_by ? (m.forfeit_by === "a" ? (m.team_a || "A") : (m.team_b || "B")) : ""]));
      }
    }
    downloadText(`${new Date().toISOString().slice(0, 10)}_${(data.event.name || "league").replace(/\W+/g, "-")}_schedule.csv`,
      rows.join("\r\n"));
    say(`Downloaded ${rows.length - 1} game(s).`);
  }

  /* WF-6 / B10 "email the schedule": hands the SAME text the print-out carries to the campaign
     composer, with this league's registrants already the target. Nothing is sent from here. */
  function emailWeeks() {
    const weeks = (data && data.weeks) || [];
    if (!weeks.length) { say("No weeks yet. Generate week 1 first.", true); return; }
    const body = [data.event.name, "", ...weeks.flatMap(w => [...weekLines(w), ""])].join("\n");
    emailDocument(leagueId, `${data.event.name} · schedule`, body);
  }

  async function copyWeek(round, btn) {
    const w = (data.weeks || []).find(x => x.round === round);
    if (!w) return;
    const lines = [`${data.event.name} · Week ${round}`, ...weekLines(w).slice(1)];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      const was = btn.textContent;
      btn.textContent = "Copied ✓";
      setTimeout(() => { btn.textContent = was; }, 1400);
    } catch {
      say("Couldn't reach the clipboard. Print the schedule instead.", true);
    }
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
      <p class="help-text" style="margin:12px 0 4px">Or record a forfeit: pick the team that didn't play.
        It shows as ${m.points_to}–0, but only moves the standings differential by one point.</p>
      <div class="diff-btns">
        <button class="btn ghost" data-ff="a">${esc(m.team_a)} forfeits</button>
        <button class="btn ghost" data-ff="b">${esc(m.team_b)} forfeits</button>
      </div>
      <div class="actions"><button class="btn ghost" data-cancel>Cancel</button></div>`);
    let winner = null;
    back.querySelectorAll("[data-w]").forEach(b => b.onclick = () => {
      winner = b.dataset.w;
      back.querySelectorAll("[data-w]").forEach(x => x.classList.toggle("ghost", x !== b));
      back.querySelector("#diffStep").hidden = false;
    });
    // RF-3 (owner ruling 2026-08-24): one press, no second step — the server writes the
    // conventional score and the flag; the one-point rule lives in computeStandings.
    back.querySelectorAll("[data-ff]").forEach(b => b.onclick = async () => {
      const r = await api(`/api/matches/${matchId}/score`, { method: "POST", body: JSON.stringify({ forfeit_by: b.dataset.ff }) });
      closeModal();
      say(r.ok ? `Forfeit recorded: ${m.points_to}–0, one point of differential` : r.data.error, !r.ok);
      if (r.ok) load();
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
    // RF-2B: the night's shape rides the press. Missing selects (an old cached shell) fall back
    // to today's single-game night — the server clamps either way (rounds 1-3; games 1-2
    // level-capped, 1-3 pods).
    // v1.6 (owner 2026-08-26): pairingMode picks the format — "level-capped" (skill-gapped weekly
    // pairing, the default) or "wins-pods" (rank by standings, pods of 4, 3 fresh opponents/night).
    // v1.7 (owner 2026-08-27): in wins-pods, gamesPerMatch is the playoff FIXTURE — a match,
    // set, or game depending on time — and rounds stays server-ignored (the pod RR is the night).
    const body = {
      pairingMode: ($("wkMode") && $("wkMode").value) || "level-capped",
      roundsPerNight: Number($("wkRounds") && $("wkRounds").value) || 1,
      gamesPerMatch: Number($("wkGames") && $("wkGames").value) || 1,
    };
    const r = await api(`/api/leagues/${leagueId}/week`, { method: "POST", body: JSON.stringify(body) });
    $("genWeek").disabled = false;
    if (!r.ok) { say(r.data.error, true); return; }
    let note = `Week ${r.data.round} created: ${r.data.matches} game${r.data.matches === 1 ? "" : "s"}`;
    if ((r.data.byes || []).length) note += ` · sitting: ${[...new Set(r.data.byes.map(b => b.name))].join(", ")}`;
    say(note, false);
    if ((r.data.warnings || []).length) {
      $("status").insertAdjacentHTML("beforeend",
        `<p class="warn-note">${r.data.warnings.map(w =>
          w.type === "rematch" ? `${esc(w.teams[0])} vs ${esc(w.teams[1])} is meeting ${w.count === 2 ? "again" : "for time " + w.count}` :
          `${esc(w.teams[0])} has no opponent within 2 levels; adjust levels or add a team`).join(" · ")}</p>`);
    }
    load();
  }

  /* v1.7 (owner 2026-08-27): "For league we do placement pool (we call strenght of power games)
     this may be a match or 1 set or game depending on time." The pods format IS that placement
     structure, so the fixture select is where time turns into games. Full match (best of 3) is a
     pods-only choice: the level-capped night keeps RF-2B's owner cap of 2 (option 3 hides and a
     stranded 3 falls back to 2). The rounds select is honestly DISABLED for pods instead of the
     silent no-op it was: the 3-slot pod round-robin IS the night's structure.
     Guard: league_wins_pods.test.mjs v1.1. */
  function syncFormatControls() {
    const mode = $("wkMode"), rounds = $("wkRounds"), games = $("wkGames"), g3 = $("wkGames3");
    if (!mode || !rounds || !games) return;              // an old cached shell: leave defaults
    const pods = mode.value === "wins-pods";
    if (g3) { g3.hidden = !pods; g3.disabled = !pods; }
    if (!pods && games.value === "3") games.value = "2";
    rounds.disabled = pods;
    rounds.title = pods ? "Pods always play the 3-slot round robin. Pick games per matchup to fit the time." : "";
    $("genHint").textContent = pods
      ? "Strength of power: teams pod by standings and play 3 placement matchups. Games per matchup 3 is a full match, best of 3."
      : "";
  }
  if ($("wkMode")) { $("wkMode").addEventListener("change", syncFormatControls); syncFormatControls(); }

  function say(msg, isErr) {
    $("status").innerHTML = msg ? `<p class="${isErr ? "notice-err" : "notice-ok"}">${esc(msg)}</p>` : "";
  }
})();
