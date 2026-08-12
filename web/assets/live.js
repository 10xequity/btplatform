/* Boomtown Platform — Live board (public page script)
   File: web/assets/live.js · Version: v1.1 · Date: 2026-08-04 · Ships in: v0.84.0

   v1.1 (owner item 2): diff-driven motion — see the motion block below for why a board that
   re-renders every 25 seconds must animate the DIFF and not the render. Also renders two fields the
   server has been sending with nothing reading them: `degraded`/`degraded_note` since v0.77.0, and
   `current_round` since v0.73.0.

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
     - Captain names only, ABBREVIATED. Owner asked for captains on every tile (2026-08-03); the
       standing rule is "First L. unless the member chose public visibility" (standards §8). A captain
       in a junior league is often a minor, and a page with no login is published to anyone who loads
       it — "Ava S." identifies a team to the people at the event and to nobody else. No other player
       is named, and no email, phone or note is sent at all.

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

  /* H-4 (v0.142.0) — the tile, rebuilt to be read from across a gym.
     What stood here rendered the score at the same size as the team name and left an EMPTY space
     where an unstarted game's number goes. Three changes; nothing else about this card moved:
       · the SCORE is the headline (.lv-sc's clamp in live.html) — a scoreboard is a number first
         and a name second, and 210px tiles of uniform type are not readable at thirty feet;
       · an unplayed game shows LIVE_NO_SCORE instead of nothing, so the tile keeps its shape and
         "not started" is legible rather than looking broken;
       · the side that is ahead carries .lv-lead. A tie crowns nobody and neither does a game with
         no result — at distance you read the bright number, not the two names.
     The seed chip renders ONLY where a seed exists: measured against live D1 before building —
     62 of 70 teams carry one, and one event of six carries none. */
  const LIVE_NO_SCORE = "–";                    // en dash: holds the column, reads as "not yet"

  function courtCard(mt) {
    const unplayed = mt.score_a === null || mt.score_b === null;
    const side = (name, cap, seed, score, lead) => `<span class="lv-vs">
        <span class="lv-t${lead ? " lv-lead" : ""}">${seed != null ? `<span class="lv-seed">${esc(String(seed))}</span>` : ""}${esc(name)}${cap ? `<span class="lv-cap">${esc(cap)}</span>` : ""}</span>
        <span class="lv-sc${lead ? " lv-lead" : ""}">${unplayed ? LIVE_NO_SCORE : score}</span>
      </span>`;
    return `<li class="lv-court" data-k="${esc(keyOf(mt))}">
      <span class="lv-ct">Court ${mt.court}</span>
      <span class="lv-stage">${esc(mt.stage)}</span>
      ${side(mt.team_a, mt.captain_a, mt.seed_a != null ? mt.seed_a : null, mt.score_a, !unplayed && mt.score_a > mt.score_b)}
      ${side(mt.team_b, mt.captain_b, mt.seed_b != null ? mt.seed_b : null, mt.score_b, !unplayed && mt.score_b > mt.score_a)}
      ${mt.ref_team ? `<span class="lv-ref">ref ${esc(mt.ref_team)}</span>` : ""}
    </li>`;
  }

  function table(rows) {
    if (!rows.length) return `<p class="lv-none">No results yet.</p>`;
    return `<div class="lv-scroll"><table class="lv-table">
      <thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col">Captain</th><th scope="col">W</th><th scope="col">L</th><th scope="col">+/−</th></tr></thead>
      <tbody>${rows.map((t, i) => `<tr data-team="${esc(t.name)}">
        <td>${t.rank || i + 1}</td>
        <td>${esc(t.name)}</td>
        <td class="lv-capcell">${esc(t.captain || "")}</td>
        <td>${t.wins}</td><td>${t.losses}</td>
        <td>${t.point_diff > 0 ? "+" : ""}${t.point_diff}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  function bracketHtml(br) {
    return `<section class="lv-bracket">
      <h3 class="lv-h3">${esc(br.name)} bracket${br.champion
        ? ` — <span class="lv-champ" data-br="${esc(br.name)}">🏆 ${esc(br.champion)}</span>` : ""}</h3>
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

  /* ---------- motion · v1.1 · owner item 2 ----------

     "add cool animations to the live view so when things are updated there is an animation that is
     engaging for viewers."

     THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM. `render()` replaces innerHTML wholesale every 25
     seconds, so every node is a new node on every poll. Animating entrances the obvious way would
     therefore replay every card's animation every 25 seconds — motion that carries no information,
     on a display somebody has left running all afternoon. Standards §5 forbids exactly that ("no
     enter-animation on high-frequency controls").

     So the payload is diffed against the previous payload and only the DIFFERENCES are marked. The
     nodes are new; the knowledge of what changed is not in the nodes, it is in `prev`. A poll where
     nothing changed animates nothing at all, which is what makes the motion mean something when it
     does fire: on this board, movement is information.

     What animates, and why each one earns it:
       · a final score landing  → pop + a decaying flash on the card. The headline. A handful of
                                  times per round, which is the right frequency for 180ms of motion.
       · a card new to the board → scale-in from 0.97, never from 0.
       · the round advancing     → the on-now cards stagger in. Once per round: rare, and it says
                                  "this is a NEW set of games", not the same ones re-rendered.
       · a team changing rank    → the row travels from its old position to its new one (FLIP).
       · a champion appearing    → one pop. The rarest moment in the event.
       · first paint             → one stagger, because a wall display loads once a day.

     And what deliberately does NOT animate: exits. A card leaving is destroyed by the innerHTML
     replacement, and keeping it alive to animate it out would mean a keyed reconciler — a much
     larger rewrite of a page whose job is to never blank. An instant exit is the limit case of the
     rule that exits should be faster than entrances, and on a scoreboard "that game is over" is
     carried by the card that replaces it. */

  const reduced = () => {
    try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
  };

  // A match has no id in the public payload. Within a round, one court holds one game, so round+court
  // is its identity — and it stays stable across polls, which is the whole requirement for a diff.
  const keyOf = (mt) => `${mt.round}:${mt.court}`;
  const sigOf = (mt) => `${mt.score_a}/${mt.score_b}`;

  let prev = null;  // snapshot of the last payload rendered. null means "treat the next paint as first".

  function snapshot(d) {
    const cards = new Map();
    for (const mt of [...(d.on_now || []), ...(d.up_next || [])]) cards.set(keyOf(mt), sigOf(mt));
    return {
      cards,
      champs: new Set((d.brackets || []).filter((b) => b.champion).map((b) => b.name)),
      round: d.current_round,
    };
  }

  /** Where every standings row sits right now. Must be read BEFORE innerHTML is replaced. */
  function rowTops() {
    const m = new Map();
    for (const tr of $("lvStand").querySelectorAll("tr[data-team]")) {
      if (!m.has(tr.dataset.team)) m.set(tr.dataset.team, tr.getBoundingClientRect().top);
    }
    return m;
  }

  /** FLIP: put each moved row back where it was, then let it travel to where it now is. */
  function flip(wasAt) {
    if (!wasAt || !wasAt.size) return;
    const moves = [];
    for (const tr of $("lvStand").querySelectorAll("tr[data-team]")) {
      const was = wasAt.get(tr.dataset.team);
      if (was === undefined) continue;                    // new team: it enters, it does not travel
      const dy = was - tr.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;                     // did not move
      moves.push([tr, dy]);
    }
    if (!moves.length) return;
    for (const [tr, dy] of moves) tr.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      for (const [tr] of moves) { tr.classList.add("lv-move"); tr.style.transform = ""; }
    });
    // Drop the transition afterwards so the next render is not fighting a stale one.
    setTimeout(() => { for (const [tr] of moves) tr.classList.remove("lv-move"); }, 600);
  }

  /** Mark the cards whose data actually moved, and the exact score cell that moved on each. */
  function markChanged(before, now) {
    for (const li of document.querySelectorAll("#lvNow [data-k], #lvNext [data-k]")) {
      const had = before.cards.get(li.dataset.k);
      if (had === undefined) { li.classList.add("lv-enter"); continue; }   // new to the board
      const has = now.cards.get(li.dataset.k);
      if (had === has) continue;                                          // nothing moved: stay still
      const cells = li.querySelectorAll(".lv-sc");
      const [oldA, oldB] = String(had).split("/");
      const [newA, newB] = String(has).split("/");
      li.classList.add("lv-changed");
      if (cells[0] && oldA !== newA) cells[0].classList.add("lv-changed");
      if (cells[1] && oldB !== newB) cells[1].classList.add("lv-changed");
      setTimeout(() => {
        li.classList.remove("lv-changed");
        for (const c of cells) c.classList.remove("lv-changed");
      }, 1000);
    }
  }

  function markChampions(before) {
    for (const el of $("lvBrackets").querySelectorAll(".lv-champ")) {
      if (!before.champs.has(el.dataset.br)) el.classList.add("lv-enter");
    }
  }

  /** Cascade, capped: a 16-court event must not spend a second and a half introducing itself. */
  function staggerIn(list) {
    let i = 0;
    for (const el of list.querySelectorAll(".lv-court")) {
      el.style.animationDelay = `${Math.min(i, 8) * 40}ms`;
      el.classList.add("lv-enter");
      i++;
    }
  }

  /* ---------- render ---------- */

  function render(d) {
    /* `degraded` means one of the six reads failed, so part of this payload is a fallback shape
       rather than the truth. That makes "what changed" unknowable — a section that came back empty
       because its read broke looks exactly like a section that emptied — so the board SAYS SO and
       animates nothing at all. Motion here would dress a guess as a fact. Setting `prev` to null
       below means the next healthy poll is treated as a first paint instead of being diffed against
       a payload we know to be incomplete. */
    const quiet = reduced() || !!d.degraded;
    const before = quiet ? null : prev;
    const now = snapshot(d);

    // Read positions BEFORE the innerHTML replacement below destroys the rows we are measuring.
    const wasAt = before ? rowTops() : null;

    const dg = $("lvDegraded");
    dg.hidden = !d.degraded;
    dg.textContent = d.degraded
      ? (d.degraded_note || "Showing what we can — part of this board could not be loaded.")
      : "";

    $("lvTitle").textContent = d.event.name;
    $("lvWhen").textContent = [d.event.location, d.event.status === "in_progress" ? "in progress" : d.event.status].filter(Boolean).join(" · ");
    // current_round has been in the payload since v0.73.0 and was never shown. "Round 3" is the
    // other half of a court call, and it is how a spectator knows the board moved on.
    $("lvRound").textContent = d.current_round ? `Round ${d.current_round}` : "";

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

    if (quiet) {
      prev = null;                                  // do not diff the next poll against a partial read
    } else {
      if (!before) {
        staggerIn($("lvNow"));                      // first paint, or the first healthy poll after one
      } else {
        // A new round is a genuinely new set of games, not the same ones re-rendered. Once per round.
        // This runs BEFORE markChanged because a round change makes every card key new, so both would
        // claim the same cards — and the delay has to be set before the class starts the animation.
        if (before.round !== now.round) staggerIn($("lvNow"));
        markChanged(before, now);
        markChampions(before);
        flip(wasAt);
      }
      prev = now;
    }
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
