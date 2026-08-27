/* Boomtown Platform — Tournament Ops
   Version: v0.6.1 · Date: 2026-08-27 · Ships in: v0.210.0 (v0.6.1: inlineRename mechanics →
   BT_ADMIN.inlineEdit, §-1c D-60; v0.6.0 shipped in v0.175.0)
   v0.5.0 (owner request + B21): the pool grid defaults to courts down the side / rounds across
   the top with a switch back (shared key bt_grid_axis, cells keep their round/court identity);
   the day-sheet buttons disable while composing, print-day gains one named exit shared by
   afterprint and the on-screen hatch.
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
  /* B22 (v0.165.0): storage that cannot take the page down. A private-mode or blocked-cookie
     profile THROWS on access rather than returning null — and both reads below run during
     boot, so one bare touch kills the page before a single row renders. The fallback is
     deliberate: where storage is blocked the axis switch stops REMEMBERING across reloads, it
     does not stop working — a control that silently does nothing is the worse failure. Every
     raw touch in this file lives in the wrappers below, which is what grid_axis.test.mjs
     enforces. (This block used to say config.js kept its own closure-private copy of the same
     shape; D-42 below ended that — config.js now shares the page map too.) */
  /* D-42 (v0.167.0): ONE fallback map per PAGE, not one per module. v0.166.0 gave each guarded
     file its own closure-private Map, which is coherent inside a file and incoherent across a
     page: with storage blocked, this module's write was invisible to every other module on the
     same page, so two of them disagreed about state they both read from one place (measured:
     `bt_org` and `bt_token` are touched by four guarded modules; tournament.html co-loads
     admin-nav.js, which WRITES bt_org, with this page's reader). The map hangs off `window`
     so every guarded file on the page shares one object for the page's lifetime; the
     `x || (x = new Map())` form is load-order-independent, so whichever script runs first
     creates it and the rest join it. Storage stays the source of truth whenever it works —
     the map is consulted only when a read throws or comes back empty. */
  const localMem = window.BT_MEM_FALLBACK || (window.BT_MEM_FALLBACK = new Map());
  const sessionMem = window.BT_SESSION_FALLBACK || (window.BT_SESSION_FALLBACK = new Map());
  const safeGet = (k) => {
    try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) {}
    return localMem.has(k) ? localMem.get(k) : null;
  };
  const safeSet = (k, v) => { localMem.set(k, v); try { localStorage.setItem(k, v); } catch (e) {} };
  const safeSession = (k) => {
    try { const v = sessionStorage.getItem(k); if (v != null) return v; } catch (e) {}
    return sessionMem.has(k) ? sessionMem.get(k) : null;
  };

  let bearer = safeSession("bt_token") || null;
  let currentEvent = null, teams = [], teamName = {}, teamCaptain = {}, matches = [], formats = {};
  /** "Net Assets — Ava S." where a captain is known; the bare name otherwise (T2-3). */
  const teamLabel = (id) => teamName[id] + (teamCaptain[id] ? ` · ${teamCaptain[id]}` : "");

  /* theme + org (same behavior as index) */
  /* v0.52.0: theme is single-source now — pre-paint via the shared <head> snippet, toggle in admin-nav.js v2.19. */
  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (bearer) headers["Authorization"] = "Bearer " + bearer;
    const orgId = safeGet("bt_org");
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
    $("eventSelect").innerHTML = `<option value="">Choose an event…</option>` +
      evs.map((e) => `<option value="${e.id}">${e.name}${e.starts_at ? " · " + e.starts_at.slice(0, 10) : ""}</option>`).join("");
    $("eventSelect").onchange = () => $("eventSelect").value && openEvent(+$("eventSelect").value);
    // E3 (v0.91.0, audit §6.5): every other module opens on the first real event; this page used
    // to sit on the placeholder and look like it had loaded nothing. Same rule now, any count.
    // WF-5 H-2 (v0.140.0): the manager hub points this page at ONE event via ?event=N. ADDITIVE —
    // with no ?event= the page behaves exactly as it did from the rail, which is what makes the hub
    // reversible and keeps this page's own way in. An id this org cannot see is ignored, never
    // forced: the picker is the org's own truth.
    const fromUrl = Number(new URLSearchParams(location.search).get("event")) || 0;
    const pick = (fromUrl && evs.some((e) => e.id === fromUrl)) ? fromUrl : (evs.length ? evs[0].id : 0);
    if (pick) { $("eventSelect").value = pick; openEvent(pick); }
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
    $("printTitle").textContent = `${currentEvent.name} · Pool Play`;
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

  /* v0.208.0 (owner 2026-08-26, "add the double click to edit to the tournament page too"): the
     roster in #teamsPanel lists the event's teams, each name double-click editable — the League
     board's affordance ported here. Team names otherwise appeared only read-only in the grid,
     standings and byes, so fixing a pasted typo meant delete-and-re-add. The captain (T2-3) shows
     read-only beside the name for identification; it is a CONTACT (captain_contact_id), not a team
     field, so the rename never touches it — patchTeam takes { name } only, exactly as on the League
     board. A rename refreshAll()s, so the grid/standings/byes pick up the new name. */
  const sayTeam = (msg) => { const el = $("teamMsg"); if (el) el.textContent = msg || ""; };

  function renderTeamList() {
    const list = $("teamList");
    if (!list) return;
    list.innerHTML = teams.map((t) =>
      `<li class="tm-team" data-team="${t.id}">` +
        `<span class="tm-name bt-inline-edit" data-team-name="${t.id}" tabindex="0" role="button" ` +
          `title="Double-click to rename this team">${dsEsc(t.name)}</span>` +
        (t.captain ? `<span class="tm-cap">${dsEsc(t.captain)}</span>` : "") +
      `</li>`).join("");
    list.querySelectorAll("[data-team-name]").forEach(inlineRename);
  }

  /* Double-click (or Enter) a static team name -> an input; Enter/blur commits via the EXISTING
     PATCH /api/admin/teams/:id route, Escape cancels; focus returns to the cell on cancel, no-op
     and error alike. An empty or unchanged name never hits the server. v0.6.1 (§-1c D-60,
     v0.210.0): the DOM/focus/latch mechanics moved to BT_ADMIN.inlineEdit (admin-nav.js loads
     just above this script in tournament.html) — one owner for this page and the League board.
     Guard: admin_inline_edit.test.mjs; the PATCH and the captain-is-never-sent pin stay here in
     tournament_inline_rename.test.mjs. */
  function inlineRename(span) {
    const teamId = Number(span.dataset.teamName);
    BT_ADMIN.inlineEdit(span, {
      onStart: () => sayTeam(""),
      commit: async (name) => {
        const r = await api(`/api/admin/teams/${teamId}`, { method: "PATCH", body: JSON.stringify({ name }) });
        if (r.ok) { refreshAll(); } else { sayTeam(r.data.error || "Couldn't rename the team."); }
        return r.ok;
      },
    });
  }

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
    /* T2-4: the buttons are the RECOMMENDED window (the server says which — 8–10 pool games, so
       the bracket fits under 16 total). The rest stay reachable behind a disclosure with the
       server's reason on each, because these are defaults a director overrides, not refusals.
       When nothing is recommended there is no disclosure to hide behind — the note explains the
       shortfall and every count is offered directly, exactly as before this change. */
    const btn = (o) => `<button class="btn ghost" data-plr="${o.rounds}" style="margin:0 6px 6px 0">
        ${o.gamesPerTeam} games each · ${o.rounds} rounds${o.byesPerTeam ? ` · sits ${o.byesPerTeam}` : ""}</button>`;
    const rec = opts.filter((o) => o.recommended);
    const rest = opts.filter((o) => !o.recommended);
    $("plChoices").innerHTML = (r.data.note ? `<p class="muted" style="margin:0 0 6px">${r.data.note}</p>` : "") +
      (rec.length ? rec.map(btn).join("") : opts.map(btn).join("")) +
      (rec.length && rest.length ? `<details style="margin-top:6px"><summary class="muted" style="cursor:pointer;min-height:44px;display:flex;align-items:center">Show ${rest.length} more round count${rest.length === 1 ? "" : "s"}</summary>` +
        rest.map((o) => `<div style="margin:6px 0">${btn(o)}<span class="muted" style="font-size:13px">${o.why || ""}</span></div>`).join("") + `</details>` : "");
    document.querySelectorAll("[data-plr]").forEach((b) => b.onclick = () => previewPlan(t, c, +b.dataset.plr));
    // One tap saved: if a listed option hits the asked-for games exactly, preview it right away.
    const want = +$("plGames").value || 8;
    const hit = opts.find((o) => o.gamesPerTeam === want);
    if (hit) previewPlan(t, c, hit.rounds);
  };

  async function previewPlan(t, c, rounds) {
    const r = await api("/api/admin/formats/plan", { method: "POST", body: JSON.stringify({
      teams: t, courts: c, rounds, target_games: +$("plGames").value || undefined,
      points_to: +$("plPoints").value || undefined, // T2-4: the server accepted this for six releases; the screen finally sends it
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
    const body = { courts: +$("plCourts").value, rounds: plannedRounds, assign_refs: true,
      points_to: +$("plPoints").value || undefined }; // T2-4: the committed matches carry the same points the preview showed
    let r = await api(`/api/admin/events/${currentEvent.id}/generate-schedule`, { method: "POST", body: JSON.stringify(body) });
    if (r.status === 409) {
      if (!confirm(`${r.data.error} Replace it with this plan?`)) return;
      r = await api(`/api/admin/events/${currentEvent.id}/generate-schedule`, { method: "POST", body: JSON.stringify({ ...body, replace: true }) });
    }
    $("plMsg").textContent = r.ok ? "Schedule written. It's below." : (r.data.error || "Couldn't write the schedule.");
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
    // T2-3: the captain, for the moments where two team names look alike. Kept OUT of the dense
    // grid cell and put where a director is actually identifying a team under time pressure.
    teamCaptain = Object.fromEntries(teams.map((t) => [t.id, t.captain || ""]));
    $("teamCount").textContent = teams.length ? `(${teams.length})` : "";
    renderTeamList(); // v0.208.0: the double-click-editable roster (owner 2026-08-26)
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
          : `Round ${w.round}: ${teamName[w.team_id] || w.team_id} on two courts`).join(" · ")}.
          Your call stands; this is just a heads-up.</div>`
      : "";
  }

  /* Grid axis (owner, 2026-08-16): courts down the side and rounds across the top is the
     DEFAULT; the old shape stays one press away, remembered per device under the ONE key the
     Schedule Editor shares. Cells keep data-round/data-court in both shapes, so scoring, drag
     and the PATCH payload never notice the orientation. */
  const courtsDown = () => safeGet("bt_grid_axis") !== "rounds-down";
  $("axisBtn").onclick = () => {
    safeSet("bt_grid_axis", courtsDown() ? "rounds-down" : "courts-down");
    renderGrid();
  };
  /* B22: the OTHER tab's flip. A tab never receives its own storage event, so this fires only
     when the Schedule Editor (or a second copy of this page) changed the preference — which is
     the whole reason the key is shared. Filtered by key: this page must not repaint on every
     unrelated write (bt_theme, bt_org, the nav state). */
  window.addEventListener("storage", (e) => { if (e.key === "bt_grid_axis") renderGrid(); });

  function renderGrid() {
    const grid = $("poolGrid");
    if (!matches.length) { $("gridPanel").hidden = true; return; }
    $("gridPanel").hidden = false;
    const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
    const courts = [...new Set(matches.map((m) => m.court))].sort((a, b) => a - b);
    const cellAt = (r, c) => {
      const m = matches.find((x) => x.round === r && x.court === c);
      return `<td data-round="${r}" data-court="${c}" class="drop-cell">` + (m ? matchCell(m) : "") + `</td>`;
    };
    const byesIn = (r) => {
      const playing = new Set(matches.filter((m) => m.round === r).flatMap((m) => [m.team_a_id, m.team_b_id]));
      return teams.filter((t) => !playing.has(t.id)).map((t) => t.name).join(", ") || "—";
    };
    let html;
    if (courtsDown()) {
      html = `<tr><th>Court</th>${rounds.map((r) => `<th>Round ${r}</th>`).join("")}</tr>`;
      for (const c of courts) {
        html += `<tr><td class="round-label">${c}</td>${rounds.map((r) => cellAt(r, c)).join("")}</tr>`;
      }
      html += `<tr><td class="round-label">Bye / Work</td>${rounds.map((r) => `<td class="bye-col">${byesIn(r)}</td>`).join("")}</tr>`;
    } else {
      html = `<tr><th>Round</th>${courts.map((c) => `<th>Court ${c}</th>`).join("")}<th>Bye / Work</th></tr>`;
      for (const r of rounds) {
        html += `<tr><td class="round-label">${r}</td>${courts.map((c) => cellAt(r, c)).join("")}<td class="bye-col">${byesIn(r)}</td></tr>`;
      }
    }
    grid.innerHTML = html;
    $("axisBtn").textContent = courtsDown() ? "Courts across the top" : "Courts down the side";

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
      aria-label="${teamLabel(m.team_a_id)} versus ${teamLabel(m.team_b_id)}${scored ? `, ${m.score_a} to ${m.score_b}` : ", tap to score"}">
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
    // T2-4b (v0.122.0): the chips used to STOP at 15 (Math.min(points_to, 15)) while the server
    // has never had a cap — so a 21-0 game could not be recorded at all. Chips stay for the common
    // margins (the two-tap path is the whole point of this sheet); the numeric box carries the
    // rest, bounded by points_to. Same shape the league dialog already ships.
    const diffs = Array.from({ length: Math.min(m.points_to, 10) }, (_, i) => i + 1);
    sheet.innerHTML = `
      <h4>Who won? <span class="muted">(to ${m.points_to}, cap ${m.cap})</span></h4>
      <div class="tap-row">
        <button class="btn" data-w="a">${teamLabel(m.team_a_id)}</button>
        <button class="btn" data-w="b">${teamLabel(m.team_b_id)}</button>
        <button class="btn ghost" data-w="x">Cancel</button>
      </div>
      <div id="diffRow" hidden>
        <h4>Won by…</h4>
        <div class="tap-row">${diffs.map((d) => `<button class="diff-chip" data-d="${d}">${d}</button>`).join("")}
          <input id="diffCustom" type="number" min="1" max="${m.points_to}" placeholder="More"
                 style="width:84px;min-height:44px" aria-label="Point difference" /></div>
      </div>`;
    let winner = null;
    sheet.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => {
      if (b.dataset.w === "x") return closeSheet();
      winner = b.dataset.w;
      sheet.querySelector("#diffRow").hidden = false;   // tap 1 done
    }));
    const send = async (diff) => {
      await api(`/api/matches/${matchId}/score`, { method: "POST", body: JSON.stringify({ winner, diff }) });
      closeSheet();
      refreshAll();
    };
    sheet.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => winner && send(+b.dataset.d)));  // tap 2
    sheet.querySelector("#diffCustom").addEventListener("change", (e) => {
      const d = +e.target.value;
      if (winner && d >= 1) send(d);
    });
    /* D-40 (v0.167.0): the listener used to be an inline function that removed itself ONLY when
       Escape was actually pressed — so closing by Cancel or by scoring left it attached, and every
       subsequent open added another. Named handler, detached on EVERY close path. */
    function onEsc(e) { if (e.key === "Escape") closeSheet(); }
    function closeSheet() { sheet.hidden = true; sheet.classList.remove("open"); document.removeEventListener("keydown", onEsc); }
    document.addEventListener("keydown", onEsc);
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
    /* RF-1(f) (v0.175.0, owner 2026-08-18): "nothing happens" was still true after T2-5, twice
       over. (1) The engine answers 409 unless replace:true and this handler never offered it —
       the second press was strictly silent in effect. admin-brackets.js generate() (and this
       page's own plCommit) is the behaviour, copied: confirm with the server's own sentence,
       re-POST with replace — through ONE gen() writer site, which is what bracket_rewire's
       uniqueness pin licences. (2) The outcome rendered into #warningsBox, a whole grid ABOVE
       this button — right words, wrong place. It speaks at #bracketNote beside the button now;
       #warningsBox stays the schedule generator's voice. Guards: bracket_rewire.test.mjs v1.1. */
    const body = { a_size: +$("aSize").value };
    const gen = (b) => api(`/api/admin/events/${currentEvent.id}/brackets`, { method: "POST", body: JSON.stringify(b) });
    let r = await gen(body);
    if (r.status === 409 && r.data.existing_matches) {
      if (!window.confirm(`${r.data.error}\n\nReplace it? The current bracket is set aside, not lost.`)) return;
      r = await gen({ ...body, replace: true });
    }
    const note = $("bracketNote");
    note.hidden = false;
    note.innerHTML = r.ok
      ? `<div class="notice">${(r.data.summary || []).join(" · ")} &#8212; <a href="admin-brackets.html?event=${currentEvent.id}">open the bracket board</a> to run it.</div>`
      : `<div class="warn-banner">${r.data.error || "Bracket failed."}</div>`;
  };

  /* ---------- print + CSV + email (WF-6: all three, wherever there is one) ---------- */
  $("printBtn").onclick = () => print();

  /* ONE row builder, two renderers. The downloaded sheet and the emailed sheet must never
     disagree about what a game IS. This file also used to carry its own CSV quoting — a third
     spelling of a judgement that now lives once, in BT_ADMIN.csvRow (v0.138.0). */
  const sheetRows = () => matches.map((m) => [m.round, m.court,
    teamName[m.team_a_id] || "", teamName[m.team_b_id] || "", teamName[m.ref_team_id] || "",
    m.score_a ?? "", m.score_b ?? ""]);

  $("csvBtn").onclick = () => {
    const { csvRow, downloadText } = window.BT_ADMIN;
    const lines = [csvRow(["round", "court", "team_a", "team_b", "ref", "score_a", "score_b"]),
      ...sheetRows().map(csvRow)];
    downloadText(`${new Date().toISOString().slice(0, 10)}_${(currentEvent.name || "schedule").replace(/\W+/g, "-")}_schedule.csv`,
      lines.join("\r\n"));
  };

  $("emailBtn").onclick = () => {
    if (!currentEvent) return;
    const body = [currentEvent.name, "",
      ...sheetRows().map((r) => `Round ${r[0]} · Court ${r[1]}: ${r[2] || "TBD"} vs ${r[3] || "TBD"}${r[4] ? ` (ref ${r[4]})` : ""}`)].join("\n");
    window.BT_ADMIN.emailDocument(currentEvent.id, `${currentEvent.name} · pool sheet`, body);
  };

  /* ---------- the day sheet (§-1n P-E / §-0 B19) ----------
     The printed artifact the desk holds: schedule, pools and bracket, ONE print job with a page
     break per section (the pool sheet already breaks standings to its own page — literal
     single-sheet was never this product's meaning). A print MODE of this page, H-3's precedent:
     no new page, no new route — the Pools and Bracket sections read the pool board's and
     admin-brackets' own GETs, both already called by their screens; Schedule reuses sheetRows(),
     so the printed games and the emailed/CSV games can never disagree. ONE composer, two
     outputs (print HTML + email text) — the WF-6 one-row-builder rule, applied whole. */
  const dsEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* The two score spellings, computed OUTSIDE the html statements so every interpolation that
     reaches innerHTML is a single dsEsc(...) call — the shape day_sheet.test.mjs enforces. */
  const rowScore = (r) => (r[5] !== "" || r[6] !== "" ? `${r[5]}–${r[6]}` : "");
  const mtScore = (mt) => (mt.winner ? `${mt.score_a ?? ""}–${mt.score_b ?? ""}` : "");

  async function composeDaySheet() {
    const [board, br] = await Promise.all([
      api(`/api/admin/events/${currentEvent.id}/board`),
      api(`/api/admin/events/${currentEvent.id}/brackets`),
    ]);
    const text = [`${currentEvent.name} · day sheet`, ""];
    let html = `<h3 class="ds-h">${dsEsc(currentEvent.name)} · day sheet</h3>`;

    // 1. Schedule — the same rows the CSV and the emailed pool sheet are built from.
    const rows = sheetRows();
    html += `<div class="ds-section"><h4 class="ds-h">Schedule</h4>` + (rows.length
      ? `<table><tr><th>Round</th><th>Court</th><th>Team A</th><th>Team B</th><th>Ref</th><th>Score</th></tr>` +
        rows.map((r) => `<tr><td>${dsEsc(r[0])}</td><td>${dsEsc(r[1])}</td><td>${dsEsc(r[2] || "TBD")}</td><td>${dsEsc(r[3] || "TBD")}</td><td>${dsEsc(r[4])}</td><td>${dsEsc(rowScore(r))}</td></tr>`).join("") + `</table>`
      : `<p class="ds-note">No pool games yet. Generate the schedule first.</p>`) + `</div>`;
    text.push("SCHEDULE", ...(rows.length
      ? rows.map((r) => `Round ${r[0]} · Court ${r[1]}: ${r[2] || "TBD"} vs ${r[3] || "TBD"}${r[4] ? ` (ref ${r[4]})` : ""}`)
      : ["No pool games yet."]), "");

    // 2. Pools — the board's own read; who is in which pool, with the frozen team number.
    html += `<div class="ds-section"><h4 class="ds-h">Pools</h4>`;
    if (!board.ok) {
      html += `<p class="ds-note">Couldn't load the pool board right now.</p>`;
      text.push("POOLS", "Couldn't load the pool board right now.", "");
    } else {
      const pools = board.data.pools || [];
      const teams = board.data.teams || [];
      const divName = Object.fromEntries((board.data.divisions || []).map((d) => [d.id, d.name]));
      text.push("POOLS");
      if (!pools.length) {
        html += `<p class="ds-note">No pool board saved yet.</p>`;
        text.push("No pool board saved yet.");
      } else {
        for (const pool of pools) {
          const inPool = teams.filter((t) => t.pool_id === pool.id);
          const courts = pool.court_from ? ` · courts ${pool.court_from}–${pool.court_to || pool.court_from}` : "";
          const division = divName[pool.division_id] ? `${divName[pool.division_id]} · ` : "";
          const meta = `${division}${inPool.length} teams${courts}`;
          html += `<p class="ds-sub"><b>${dsEsc(pool.name)}</b> (${dsEsc(meta)})</p>` +
            `<table><tr><th>#</th><th>Team</th><th>Level</th></tr>` +
            inPool.map((t) => `<tr><td>${dsEsc(t.board_no)}</td><td>${dsEsc(t.name)}</td><td>${dsEsc(t.level || "")}</td></tr>`).join("") + `</table>`;
          text.push(`${pool.name} (${meta})`,
            ...inPool.map((t) => `  #${t.board_no} ${t.name}${t.level ? ` (${t.level})` : ""}`));
        }
      }
      text.push("");
    }
    html += `</div>`;

    // 3. Bracket — admin-brackets' own read; pairings by round, the stored score pair printed
    //    as it is stored, TBD where a slot waits on a result.
    html += `<div class="ds-section"><h4 class="ds-h">Bracket</h4>`;
    if (!br.ok) {
      html += `<p class="ds-note">Couldn't load the bracket right now.</p>`;
      text.push("BRACKET", "Couldn't load the bracket right now.");
    } else {
      const list = br.data.brackets || [];
      text.push("BRACKET");
      if (!list.length) {
        html += `<p class="ds-note">No bracket yet; it appears here once pool play breaks.</p>`;
        text.push("No bracket yet.");
      } else {
        for (const b of list) {
          html += `<p class="ds-sub"><b>${dsEsc(b.name)} bracket</b>${b.champion ? ` · 🏆 ${dsEsc(b.champion)}` : ""}</p>`;
          text.push(`${b.name} bracket${b.champion ? ` · winner: ${b.champion}` : ""}`);
          for (const round of b.rounds || []) {
            html += `<p class="ds-sub">${dsEsc(round.label)}</p><table><tr><th>Team A</th><th>Team B</th><th>Score</th></tr>` +
              (round.matches || []).map((mt) => `<tr><td>${dsEsc(mt.team_a || mt.waiting_a || "TBD")}</td><td>${dsEsc(mt.team_b || mt.waiting_b || "TBD")}</td><td>${dsEsc(mtScore(mt))}</td></tr>`).join("") + `</table>`;
            text.push(`  ${round.label}: ` + (round.matches || []).map((mt) =>
              `${mt.team_a || mt.waiting_a || "TBD"} vs ${mt.team_b || mt.waiting_b || "TBD"}${mt.winner ? ` (${mtScore(mt)})` : ""}`).join(" · "));
          }
        }
      }
    }
    html += `</div>`;

    $("daySheet").innerHTML = html;
    return text.join("\n");
  }

  /* B21 (v0.164.0, owner-forwarded review): the buttons hold still while they work — a second
     tap during a slow read must not stack sends or print dialogs. ONE named exit from print-day
     serves the afterprint listener and the on-screen hatch. A stale print-day changes nothing
     on screen (every swap rule is print-scoped); its one real cost is the NEXT print job
     printing the wrong document — when a browser opens no dialog and afterprint never comes,
     the hatch is the visible way out. Re-adding the SAME function reference cannot stack
     listeners, which is why the exit is named rather than inline. */
  const exitPrintDay = () => document.body.classList.remove("print-day");
  $("dayPrintClose").onclick = exitPrintDay;
  /* B22: the same exit from the keyboard. Gated on the MODE as well as the key, so this never
     competes with the score sheet's own Escape — with print-day off it does nothing at all. */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("print-day")) exitPrintDay();
  });

  const whileBusy = async (btn, job) => {
    const was = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Composing…";
    try { await job(); } finally { btn.disabled = false; btn.textContent = was; }
  };

  $("daySheetBtn").onclick = () => {
    if (!currentEvent) return;
    return whileBusy($("daySheetBtn"), async () => {
      await composeDaySheet();
      document.body.classList.add("print-day");
      addEventListener("afterprint", exitPrintDay, { once: true });
      print();
    });
  };

  $("dayEmailBtn").onclick = () => {
    if (!currentEvent) return;
    return whileBusy($("dayEmailBtn"), async () => {
      const body = await composeDaySheet();
      window.BT_ADMIN.emailDocument(currentEvent.id, `${currentEvent.name} · day sheet`, body);
    });
  };
})();
