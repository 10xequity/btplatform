/* Boomtown Platform — Captain Self-Scoring
   Version: v0.3.0 · Date: 2026-07-21
   Link: score.html?t=TOKEN (from the admin "Captain score links" button).
   Tap 1: We won / They won → Tap 2: point margin → submits. No sign-in needed. */

(function () {
  const API = (window.BT_CONFIG || {}).apiBase;
  const app = document.getElementById("scoreApp");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  if (!API || API.includes("PENDING")) {
    app.innerHTML = "<div class='card'><h1>One moment</h1><p>Settings still loading. Pull down to refresh.</p></div>";
    return;
  }
  /* theme: pre-paint snippet applies it; site-nav.js v2.13 owns the toggle listener
     (per-page copy DELETED in v0.53.0 — a surviving copy double-binds → dead button). */

  async function api(path, opts = {}) {
    const headers = { "content-type": "application/json" };
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers }));
      return { ok: resp.ok, data: await resp.json().catch(() => ({})) };
    } catch {
      return { ok: false, data: { error: "Can't reach the server. Check your signal and try again." } };
    }
  }

  const token = new URLSearchParams(location.search).get("t");
  if (!token) { app.innerHTML = "<div class='card'><h1>Missing link code</h1><p>Use the exact link your organizer sent you.</p></div>"; return; }

  let team = null;

  async function load() {
    const r = await api(`/api/score/${encodeURIComponent(token)}`);
    if (!r.ok) { app.innerHTML = `<div class='card'><h1>Hmm</h1><p>${esc(r.data.error)}</p></div>`; return; }
    team = r.data.team;
    const pending = r.data.matches.filter((m) => m.score_a === null && m.score_b === null && m.team_a && m.team_b);
    const done = r.data.matches.filter((m) => m.score_a !== null);

    // Owner 2026-08-03: "get rid of that page after scores are submitted." Once a team has nothing
    // left to enter, this stops being a scoring page — leaving the taps up invites someone to come
    // back and re-score a finished game, which is a call to the desk either way.
    if (!pending.length && done.length) return retire(r.data, done);

    app.innerHTML = `<div class="card">
        <h1 style="font-size:1.2rem">${esc(team.name)}</h1>
        <p class="meta">${esc(r.data.event)} · tap who won, then the point margin</p>
      </div>` +
      (pending.length ? pending.map(matchCard).join("") : "<div class='card'><p>Nothing to score yet; your next game will appear here.</p></div>") +
      (done.length ? `<div class="card"><h2 style="font-size:1rem">Already scored</h2>${done.map(scoredLine).join("")}</div>` : "");
    pending.forEach(wire);
  }

  /** The finished state. Their results stay visible; the controls do not. */
  function retire(data, done) {
    app.innerHTML = `<div class="card">
        <h1 style="font-size:1.2rem">${esc(data.team.name)} · all done</h1>
        <p class="meta">${esc(data.event)}</p>
        <p>Every game has a score. Thanks. Nothing else to do here.</p>
      </div>
      <div class="card"><h2 style="font-size:1rem">Your results</h2>${done.map(scoredLine).join("")}</div>
      <div class="card"><p class="meta">Something wrong? The tournament desk can fix any score.</p></div>`;
  }

  const scoredLine = (m) =>
    `<p class="meta">${esc(m.stage_label || "Pool")} · vs ${esc(opp(m))} · ${m.score_a}–${m.score_b}</p>`;

  const opp = (m) => (m.team_a === team.name ? m.team_b : m.team_a);

  function matchCard(m) {
    // The stage matters to the people playing: "Quarter-final" is a different thing to walk onto a
    // court for than "Pool", and until v0.67.0 bracket games were not shown here at all.
    return `<div class="match" id="m${m.id}">
      <h3>${esc(m.stage_label || "Pool")} · vs ${esc(opp(m))}</h3>
      <div class="meta">Court ${m.court} · game to ${m.points_to}</div>
      <div class="taps">
        <button class="btn" data-win="us">We won</button>
        <button class="btn ghost" data-win="them">They won</button>
      </div>
      <div class="diffs" hidden></div>
    </div>`;
  }

  function wire(m) {
    const el = document.getElementById("m" + m.id);
    const diffs = el.querySelector(".diffs");
    el.querySelectorAll("[data-win]").forEach((b) => {
      b.onclick = () => {
        const winner = b.dataset.win;
        diffs.hidden = false;
        diffs.innerHTML = [1, 2, 3, 5, 8].map((d) => `<button class="btn ghost" data-d="${d}">by ${d}${d === 8 ? "+" : ""}</button>`).join("");
        diffs.querySelectorAll("[data-d]").forEach((db) => {
          db.onclick = async () => {
            el.querySelectorAll("button").forEach((x) => (x.disabled = true));
            const r = await api(`/api/score/${encodeURIComponent(token)}`, {
              method: "POST",
              body: JSON.stringify({ match_id: m.id, winner, diff: +db.dataset.d }),
            });
            if (!r.ok) {
              el.querySelectorAll("button").forEach((x) => (x.disabled = false));
              el.insertAdjacentHTML("beforeend", `<p class="meta" style="color:#c55">${esc(r.data.error)}</p>`);
              return;
            }
            el.classList.add("done");
            el.innerHTML = `<h3>${esc(m.stage_label || "Pool")} · vs ${esc(opp(m))}</h3><p class="result">Saved: ${r.data.score_a}–${r.data.score_b} ✓</p>`;
            // That was the team's last game — reload so the page retires itself rather than
            // sitting there looking like it still wants something.
            if (r.data.done) setTimeout(load, 900);
          };
        });
      };
    });
  }

  load();
})();
