/* Boomtown Platform — Captain Self-Scoring
   Version: v0.3.0 · Date: 2026-07-21
   Link: score.html?t=TOKEN (from the admin "Captain score links" button).
   Tap 1: We won / They won → Tap 2: point margin → submits. No sign-in needed. */

(function () {
  const API = (window.BT_CONFIG || {}).apiBase;
  const app = document.getElementById("scoreApp");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  if (!API || API.includes("PENDING")) {
    app.innerHTML = "<div class='card'><h1>One moment</h1><p>Settings still loading — pull down to refresh.</p></div>";
    return;
  }
  const savedTheme = localStorage.getItem("bt_theme");
  document.documentElement.dataset.theme = savedTheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.getElementById("themeToggle").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("bt_theme", next);
  };

  async function api(path, opts = {}) {
    const headers = { "content-type": "application/json" };
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers }));
      return { ok: resp.ok, data: await resp.json().catch(() => ({})) };
    } catch {
      return { ok: false, data: { error: "Can't reach the server — check your signal and try again." } };
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
    app.innerHTML = `<div class="card">
        <h1 style="font-size:1.2rem">${esc(team.name)}</h1>
        <p class="meta">${esc(r.data.event)} · tap who won, then the point margin</p>
      </div>` +
      (pending.length ? pending.map(matchCard).join("") : "<div class='card'><p>No games waiting for a score. 🎉</p></div>") +
      (done.length ? `<div class="card"><h2 style="font-size:1rem">Already scored</h2>${done.map((m) => `<p class="meta">R${m.round} vs ${esc(opp(m))} — ${m.score_a}–${m.score_b}</p>`).join("")}</div>` : "");
    pending.forEach(wire);
  }

  const opp = (m) => (m.team_a === team.name ? m.team_b : m.team_a);

  function matchCard(m) {
    return `<div class="match" id="m${m.id}">
      <h3>Round ${m.round} — vs ${esc(opp(m))}</h3>
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
            el.innerHTML = `<h3>Round ${m.round} — vs ${esc(opp(m))}</h3><p class="result">Saved: ${r.data.score_a}–${r.data.score_b} ✓</p>`;
          };
        });
      };
    });
  }

  load();
})();
