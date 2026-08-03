/* Boomtown Platform — Divisions (admin page script)
   File: web/assets/admin-divisions.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.71.0

   The screen every other division feature was waiting on. Court ranges, team assignment, and the
   balancer's proposals — all of which existed only as API calls until now, which meant a director
   could not use any of it.

   THREE THINGS THIS SCREEN IS BUILT AROUND:

   1. COURTS ARE A RANGE AND THE RANGES MUST NOT OVERLAP. Twelve courts split three ways is 1-4, 5-8,
      9-12. Two divisions handed the same court is not caught by anybody until two teams walk onto it,
      so the overlap is shown here, live, before Save is even pressed. The server refuses it too —
      this is the courtesy, not the guard.

   2. THE BALANCER PROPOSES AND THE DIRECTOR DECIDES. Owner 2026-08-03, asked directly: "Propose, you
      approve." So every suggestion arrives with the numbers behind it and two buttons. Declining is a
      first-class action, recorded, not a matter of ignoring the row — because "was this looked at?"
      gets asked later.

   3. THE REASON IS THE PRODUCT. A proposal that says "move Team 14 down" is useless. One that says
      "2 wins against an A median of 6, and BB is a closer match" can be read out loud to a parent.
      The server writes those sentences; this file only displays them. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let eventId = null;
  let courtCount = 0;
  let rows = [];             // local division rows being edited
  let plan = null;           // last balancer result
  let dirty = false;

  /* ---------- divisions ---------- */

  function divisionRow(d, i) {
    return `<tr data-i="${i}">
      <td><input class="dv-in dv-name" value="${esc(d.name || "")}" data-f="name" aria-label="Division name" maxlength="40" /></td>
      <td><input class="dv-in dv-num" type="number" inputmode="numeric" min="1" max="99" value="${d.rank ?? i + 1}" data-f="rank" aria-label="Rank, 1 is the top division" /></td>
      <td><input class="dv-in dv-num" type="number" inputmode="numeric" min="1" max="99" value="${d.court_from ?? ""}" data-f="court_from" aria-label="First court" /></td>
      <td><input class="dv-in dv-num" type="number" inputmode="numeric" min="1" max="99" value="${d.court_to ?? ""}" data-f="court_to" aria-label="Last court" /></td>
      <td class="dv-count">${d.id ? `${(d.teams || []).length} team${(d.teams || []).length === 1 ? "" : "s"}` : "new"}</td>
      <td><button class="btn ghost dv-del" type="button" data-del="${i}" aria-label="Remove ${esc(d.name || "this division")}">Remove</button></td>
    </tr>`;
  }

  /** Which courts are claimed twice, computed locally so the warning appears while typing. */
  function overlaps() {
    const owner = new Map(), clash = [];
    for (const d of rows) {
      const from = Number(d.court_from), to = Number(d.court_to);
      if (!from || !to || to < from) continue;
      for (let c = from; c <= to; c++) {
        if (owner.has(c)) clash.push(`court ${c} (${owner.get(c)} and ${d.name || "unnamed"})`);
        else owner.set(c, d.name || "unnamed");
      }
    }
    return { clash, claimed: owner.size };
  }

  function renderDivisions() {
    $("dvRows").innerHTML = rows.map(divisionRow).join("")
      || `<tr><td colspan="6" class="dv-empty">No divisions yet. Add one, or use Suggest from courts.</td></tr>`;

    const { clash, claimed } = overlaps();
    const backwards = rows.filter((d) => d.court_from && d.court_to && Number(d.court_to) < Number(d.court_from));
    const problems = [
      ...clash.map((c) => `Two divisions are given ${c}.`),
      ...backwards.map((d) => `${d.name || "A division"} has its last court before its first.`),
      ...(rows.some((d) => !String(d.name || "").trim()) ? ["Every division needs a name."] : []),
    ];
    $("dvWarn").innerHTML = problems.map((p) => `<li>${esc(p)}</li>`).join("");
    $("dvWarn").hidden = !problems.length;
    $("dvCourts").textContent = courtCount
      ? `${claimed} of ${courtCount} courts assigned`
      : `${claimed} courts assigned`;
    $("dvSave").disabled = !dirty || problems.length > 0;
    $("dvState").textContent = dirty ? (problems.length ? "Fix the problems above" : "Unsaved changes") : "Saved";
    $("dvState").className = "dv-state" + (dirty ? " dirty" : "");
    wireDivisions();
  }

  function wireDivisions() {
    $("dvRows").querySelectorAll(".dv-in").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = Number(inp.closest("tr").dataset.i);
        const f = inp.dataset.f;
        rows[i][f] = f === "name" ? inp.value : (inp.value === "" ? null : Number(inp.value));
        dirty = true;
        // Only the warning strip and the buttons change while typing; re-rendering the table would
        // steal focus out of the field mid-keystroke.
        const { clash } = overlaps();
        $("dvWarn").hidden = !clash.length && !rows.some((d) => !String(d.name || "").trim());
        renderStatusOnly();
      });
    });
    $("dvRows").querySelectorAll("[data-del]").forEach((b) => {
      b.addEventListener("click", () => {
        const i = Number(b.dataset.del);
        const d = rows[i];
        if (d.id && (d.teams || []).length &&
            !window.confirm(`${d.name} has ${d.teams.length} team(s). Removing it puts them back with no division. Continue?`)) return;
        rows.splice(i, 1);
        dirty = true;
        renderDivisions();
      });
    });
  }

  /** Repaint the strip and buttons without touching the inputs. */
  function renderStatusOnly() {
    const { clash, claimed } = overlaps();
    const backwards = rows.filter((d) => d.court_from && d.court_to && Number(d.court_to) < Number(d.court_from));
    const problems = [
      ...clash.map((c) => `Two divisions are given ${c}.`),
      ...backwards.map((d) => `${d.name || "A division"} has its last court before its first.`),
      ...(rows.some((d) => !String(d.name || "").trim()) ? ["Every division needs a name."] : []),
    ];
    $("dvWarn").innerHTML = problems.map((p) => `<li>${esc(p)}</li>`).join("");
    $("dvWarn").hidden = !problems.length;
    $("dvCourts").textContent = courtCount ? `${claimed} of ${courtCount} courts assigned` : `${claimed} courts assigned`;
    $("dvSave").disabled = !dirty || problems.length > 0;
    $("dvState").textContent = dirty ? (problems.length ? "Fix the problems above" : "Unsaved changes") : "Saved";
    $("dvState").className = "dv-state" + (dirty ? " dirty" : "");
  }

  /**
   * Suggest a layout from the court count. Three divisions on twelve courts is the owner's own shape;
   * the general rule is four courts each, which is what a division needs to run a pool without
   * waiting on another division's court.
   */
  function suggest() {
    if (!courtCount) {
      $("dvNote").textContent = "This event has no court count set, so there is nothing to divide. Set it on the event first.";
      return;
    }
    const per = 4;
    const k = Math.max(1, Math.floor(courtCount / per));
    const names = ["Open", "A", "BB", "B", "C", "D"];
    rows = Array.from({ length: k }, (_, i) => ({
      id: null, name: names[i] || `Division ${i + 1}`, rank: i + 1,
      court_from: i * per + 1, court_to: (i + 1) * per, teams: [],
    }));
    // Any remainder goes to the bottom division rather than being left unassigned — an unclaimed
    // court is a court nobody schedules.
    const used = k * per;
    if (used < courtCount) rows[k - 1].court_to = courtCount;
    dirty = true;
    $("dvNote").textContent = `${k} division${k === 1 ? "" : "s"} of ${per} courts from ${courtCount} courts. Rename them and press Save.`;
    renderDivisions();
  }

  async function saveDivisions() {
    const payload = {
      replace: true,
      divisions: rows.map((d, i) => ({
        name: d.name, rank: Number(d.rank) || i + 1,
        court_from: d.court_from || undefined, court_to: d.court_to || undefined,
      })),
    };
    // `replace: true` clears division_id on every team, so say so rather than surprising anyone.
    const assigned = rows.reduce((n, d) => n + (d.teams || []).length, 0);
    if (assigned && !window.confirm(
      `Saving rebuilds the divisions for this event. ${assigned} team assignment(s) will be cleared and you'll need to place teams again on the Pool Board. Continue?`
    )) return;

    const r = await api(`/api/admin/events/${eventId}/divisions`, { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) return fail("dvNote", r.data.error || "Couldn't save those divisions.");
    dirty = false;
    $("dvNote").textContent = `Saved ${r.data.divisions.length} division${r.data.divisions.length === 1 ? "" : "s"}.`;
    load();
  }

  /* ---------- the balancer ---------- */

  function proposalRow(p, i) {
    const what = p.kind === "move_down" ? `Move to ${esc(p.to_division)}`
      : p.kind === "move_up" ? `Move up to ${esc(p.to_division)}`
      : p.kind === "drop_from_bracket" ? "Leave out of bracket play"
      : "Play the others at their level";
    return `<li class="dv-prop" data-p="${i}">
      <div class="dv-prop-head">
        <b>${esc(p.team)}</b>
        <span class="dv-prop-what">${what}</span>
      </div>
      <p class="dv-prop-why">${esc(p.reason)}</p>
      <p class="dv-prop-num">${p.wins}–${p.losses} · ${p.games_played} game${p.games_played === 1 ? "" : "s"} played · ${esc(p.from_division)} median ${p.division_median_wins}</p>
      <div class="dv-prop-act">
        <button class="btn" type="button" data-yes="${i}">Accept</button>
        <button class="btn ghost" type="button" data-no="${i}">Decline</button>
      </div>
    </li>`;
  }

  function renderPlan() {
    if (!plan) { $("dvPlan").innerHTML = ""; $("dvProps").innerHTML = ""; return; }
    $("dvPlan").innerHTML = (plan.summary || []).map((s) => `<li>${esc(s)}</li>`).join("");
    const props = plan.proposals || [];
    $("dvProps").innerHTML = props.length
      ? props.map(proposalRow).join("")
      : `<li class="dv-empty">${esc(plan.note || "Every team looks well placed.")}</li>`;
    $("dvAll").hidden = props.length < 2;
    $("dvPlanNote").textContent = plan.note || "";

    $("dvProps").querySelectorAll("[data-yes]").forEach((b) =>
      b.addEventListener("click", () => decide([props[Number(b.dataset.yes)]], "accepted")));
    $("dvProps").querySelectorAll("[data-no]").forEach((b) =>
      b.addEventListener("click", () => decide([props[Number(b.dataset.no)]], "rejected")));
  }

  async function check() {
    const r = await api(`/api/admin/events/${eventId}/divisions/plan`);
    if (!r.ok) return fail("dvPlanNote", r.data.error || "Couldn't work out a plan.");
    plan = r.data;
    renderPlan();
  }

  async function decide(list, status) {
    const decisions = list.map((p) => ({
      team_id: p.team_id, kind: p.kind, from_division_id: p.from_division_id,
      to_division_id: p.to_division_id, reason: p.reason, status,
      wins: p.wins, losses: p.losses, games_played: p.games_played,
      division_median_wins: p.division_median_wins,
    }));
    const r = await api(`/api/admin/events/${eventId}/divisions/moves`, {
      method: "POST", body: JSON.stringify({ decisions }),
    });
    if (!r.ok) return fail("dvPlanNote", r.data.error || "Couldn't record that.");
    $("dvPlanNote").textContent = r.data.note;
    await load();
    await check();     // the numbers moved, so the plan has to be recomputed rather than patched
  }

  /* ---------- load ---------- */

  async function load() {
    if (!eventId) return;
    const r = await api(`/api/admin/events/${eventId}/divisions`);
    if (!r.ok) return fail("dvNote", r.data.error || "Couldn't load the divisions.");
    rows = (r.data.divisions || []).map((d) => ({ ...d }));
    dirty = false;
    const ev = await api(`/api/events/${eventId}`);
    courtCount = (ev.ok && ev.data.event && ev.data.event.court_count) || 0;
    $("dvUnassigned").textContent = r.data.unassigned
      ? `${r.data.unassigned} team${r.data.unassigned === 1 ? "" : "s"} not in a division yet — place them on the Pool Board.`
      : "";
    renderDivisions();
  }

  async function loadEvents() {
    const r = await api("/api/events");
    if (!r.ok) return fail("dvNote", "Couldn't load your events.");
    const list = (r.data.events || []).slice(0, 40);
    $("dvEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    eventId = list.length ? list[0].id : null;
    load();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("dvEvent").addEventListener("change", () => {
      if (dirty && !window.confirm("You have unsaved division changes. Switch event and lose them?")) {
        $("dvEvent").value = String(eventId);
        return;
      }
      eventId = Number($("dvEvent").value);
      plan = null; renderPlan();
      load();
    });
    $("dvAdd").addEventListener("click", () => {
      rows.push({ id: null, name: "", rank: rows.length + 1, court_from: null, court_to: null, teams: [] });
      dirty = true;
      renderDivisions();
      const last = $("dvRows").querySelector("tr:last-child .dv-name");
      if (last) last.focus();
    });
    $("dvSuggest").addEventListener("click", suggest);
    $("dvSave").addEventListener("click", saveDivisions);
    $("dvCheck").addEventListener("click", check);
    $("dvAll").addEventListener("click", () => {
      if (!plan || !plan.proposals.length) return;
      if (!window.confirm(`Accept all ${plan.proposals.length} suggestions?`)) return;
      decide(plan.proposals, "accepted");
    });
    window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
    loadEvents();
  });
})();
