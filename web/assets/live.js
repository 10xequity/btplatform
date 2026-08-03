/* Boomtown Platform — Live board (public page script)
   File: web/assets/live.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.73.0

   Owner 2026-08-03: "there needs to be 2 views, an admin view where they are created, then a display
   view for members and public for those who are wanting to see. similar to volleyballlife."

   WHO THIS IS FOR, AND WHAT THAT DECIDES:

   A parent standing beside court 3 on venue wifi, and a laptop plugged into a TV by the door. So:
     - No login. Ever. A wall display cannot sign in and a parent will not.
     - "On now" is the FIRST thing on the page, above standings and brackets. The question people
       actually open this for is "which court, and who is up next", not "what is the point
       differential in Pool B".
     - It refreshes itself every 25 seconds and says when it last did. A scoreboard that has silently
       stopped updating is worse than one that is obviously stale, because nobody double-checks it.
     - No player names anywhere. Team names only — the server does not send anything else, and this
       file could not display a roster of minors even if it tried.

   It fetches ONE endpoint. Polling five would show five different moments of the same tournament. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const ORG = (() => {
    try { return localStorage.getItem("bt_org") || "1"; } catch { return "1"; }
  })();

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let eventId = null;
  let timer = null;

  async function get(path) {
    try {
      const r = await fetch(API + path, { headers: { "X-Org-Id": ORG } });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, data };
    } catch {
      // Venue wifi drops. A network blip must not blank a board somebody is reading across a gym.
      return { ok: false, data: { error: "offline" } };
    }
  }

  /* ---------- pieces ---------- */

  function courtCard(mt) {
    const live = mt.score_a === null || mt.score_b === null;
    return `<li class="lv-court">
      <span class="lv-ct">Court ${mt.court}</span>
      <span class="lv-stage">${esc(mt.stage)}</span>
      <span class="lv-vs">
        <span class="lv-t">${esc(mt.team_a)}</span>
        <span class="lv-sc">${live ? "" : mt.score_a}</span>
      </span>
      <span class="lv-vs">
        <span class="lv-t">${esc(mt.team_b)}</span>
        <span class="lv-sc">${live ? "" : mt.score_b}</span>
      </span>
      ${mt.ref_team ? `<span class="lv-ref">ref ${esc(mt.ref_team)}</span>` : ""}
    </li>`;
  }

  function table(rows) {
    if (!rows.length) return `<p class="lv-none">No results yet.</p>`;
    return `<div class="lv-scroll"><table class="lv-table">
      <thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col">W</th><th scope="col">L</th><th scope="col">+/−</th></tr></thead>
      <tbody>${rows.map((t, i) => `<tr>
        <td>${t.rank || i + 1}</td>
        <td>${esc(t.name)}</td>
        <td>${t.wins}</td><td>${t.losses}</td>
        <td>${t.point_diff > 0 ? "+" : ""}${t.point_diff}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  function bracketHtml(br) {
    return `<section class="lv-bracket">
      <h3 class="lv-h3">${esc(br.name)} bracket${br.champion ? ` — 🏆 ${esc(br.champion)}` : ""}</h3>
      <div class="lv-brscroll">${br.rounds.map((r) => `
        <div class="lv-brround">
          <h4 class="lv-brh">${esc(r.label)}</h4>
          <ul class="lv-brlist">${r.matches.map((mt) => `<li class="lv-brm">
            <span class="${mt.winner === mt.team_a ? "won" : ""}">${esc(mt.team_a || "—")} <b>${mt.score_a ?? ""}</b></span>
            <span class="${mt.winner === mt.team_b ? "won" : ""}">${esc(mt.team_b || "—")} <b>${mt.score_b ?? ""}</b></span>
          </li>`).join("")}</ul>
        </div>`).join("")}</div>
    </section>`;
  }

  /* ---------- render ---------- */

  function render(d) {
    $("lvTitle").textContent = d.event.name;
    $("lvWhen").textContent = [d.event.location, d.event.status === "in_progress" ? "in progress" : d.event.status].filter(Boolean).join(" · ");

    $("lvNow").innerHTML = d.on_now.length
      ? d.on_now.map(courtCard).join("")
      : `<li class="lv-none">${d.results >= d.total_games && d.total_games ? "All games played." : "Nothing on court right now."}</li>`;
    $("lvNext").innerHTML = d.up_next.map(courtCard).join("");
    $("lvNextWrap").hidden = !d.up_next.length;

    const divs = (d.divisions || []).filter((x) => x.pools.length || x.unpooled.length);
    const loose = d.loose_pools || [];
    if (divs.length || loose.length) {
      $("lvStand").innerHTML = divs.map((x) => `
        <section class="lv-div">
          <h3 class="lv-h3">${esc(x.name)}${x.court_from ? ` <span class="lv-sub">courts ${x.court_from}–${x.court_to}</span>` : ""}</h3>
          ${x.pools.map((pl) => `<h4 class="lv-h4">${esc(pl.name)}</h4>${table(pl.standings)}`).join("")}
          ${x.unpooled.length ? `<h4 class="lv-h4">Not in a pool yet</h4>${table(x.unpooled)}` : ""}
        </section>`).join("") +
        loose.map((pl) => `<section class="lv-div"><h3 class="lv-h3">${esc(pl.name)}</h3>${table(pl.standings)}</section>`).join("");
    } else {
      // Small events never set up divisions. One flat table beats an empty screen.
      $("lvStand").innerHTML = `<section class="lv-div">${table(d.overall || [])}</section>`;
    }

    $("lvBrackets").innerHTML = (d.brackets || []).map(bracketHtml).join("");
    $("lvBracketWrap").hidden = !(d.brackets || []).length;

    $("lvProgress").textContent = d.total_games
      ? `${d.results} of ${d.total_games} games played`
      : "";
    stamp();
  }

  function stamp() {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    const ss = String(t.getSeconds()).padStart(2, "0");
    $("lvStamp").textContent = `Updated ${hh}:${mm}:${ss}`;
    $("lvStamp").classList.remove("stale");
  }

  async function refresh() {
    if (!eventId) return;
    const r = await get(`/api/live/events/${eventId}`);
    if (!r.ok) {
      // Keep the last good board on screen and mark it, rather than replacing scores with an error.
      $("lvStamp").textContent = "Can't reach the scoreboard — showing the last update";
      $("lvStamp").classList.add("stale");
      return;
    }
    render(r.data);
  }

  async function pickEvent(id) {
    eventId = id;
    try { history.replaceState(null, "", `?event=${id}`); } catch {}
    await refresh();
  }

  async function start() {
    const r = await get("/api/live/events");
    const list = (r.ok && r.data.events) || [];
    if (!list.length) {
      $("lvTitle").textContent = "Nothing on right now";
      $("lvWhen").textContent = "Check back when the next event starts.";
      $("lvBody").hidden = true;
      return;
    }
    $("lvEvent").innerHTML = list.map((e) =>
      `<option value="${e.id}">${esc(e.name)}</option>`).join("");
    const wanted = Number(new URLSearchParams(location.search).get("event"));
    const chosen = list.find((e) => e.id === wanted) || list[0];
    $("lvEvent").value = String(chosen.id);
    await pickEvent(chosen.id);

    // 25 seconds: often enough that a court call is current, rare enough that a phone on venue wifi
    // is not refetching all afternoon.
    timer = setInterval(refresh, 25000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("lvEvent").addEventListener("change", () => pickEvent(Number($("lvEvent").value)));
    $("lvRefresh").addEventListener("click", refresh);
    // Stop polling while the tab is hidden — a board left open overnight should not keep asking.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) { refresh(); timer = setInterval(refresh, 25000); }
    });
    start();
  });
})();
