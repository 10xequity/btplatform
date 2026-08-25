/* Boomtown Platform — Community Play (LFG)
   File: web/assets/lfg.js · Version: v1.0 · Date: 2026-08-01 · Ships in: v0.45.0
   Board over GET /api/lfg/listings, reliability strip from /api/lfg/me. Commit shows the
   "on N team(s)" heads-up the owner asked for at full-commit time. Withdraw warns when it
   will count as a bail. Report-no-show is owner-only and appears only once game time has
   passed (server enforces both; UI just doesn't offer dead buttons). Message uses the
   library.js relay pattern — POST /api/messages/start, addresses never exposed.
   Tab/list swaps have NO animation (high-frequency, standards §5); cards stagger on first
   paint only. All content escaped at render. */
(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function headers() {
    const h = { "content-type": "application/json" };
    const t = sessionStorage.getItem("bt_token");
    if (t) h["Authorization"] = "Bearer " + t;
    const org = localStorage.getItem("bt_org");
    if (org) h["X-Org-Id"] = org;
    return h;
  }
  async function api(path, opts = {}) {
    try {
      const r = await fetch(API + path, Object.assign({}, opts, { headers: headers(), credentials: "include" }));
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Check your connection and refresh." } };
    }
  }
  const fmtWhen = (s) => {
    if (!s) return "";
    const d = new Date(String(s).replace(" ", "T"));
    return isNaN(d) ? esc(s) : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const KIND_LABEL = { team_need: "Team recruiting", player_avail: "Player available", casual: "Casual game" };
  const caut = (c) => c === "yellow" ? '<span class="caut yellow" title="A no-show was reported in the last 14 days" aria-label="Caution: recent no-show">&#9888;</span>'
    : c === "red" ? '<span class="caut red" title="Paused after repeated no-shows" aria-label="Caution: repeated no-shows">&#9888;</span>' : "";

  let kind = "";
  let firstPaint = true;

  boot();
  async function boot() {
    if (!sessionStorage.getItem("bt_token")) { location.href = "index.html"; return; }
    document.querySelectorAll(".lfg-tab").forEach((b) => b.addEventListener("click", () => {
      kind = b.dataset.kind;
      document.querySelectorAll(".lfg-tab").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      load();
    }));
    $("postToggle").addEventListener("click", () => {
      const f = $("postForm");
      f.hidden = !f.hidden;
      $("postToggle").setAttribute("aria-expanded", String(!f.hidden));
      if (!f.hidden) $("fKind").focus();
    });
    $("fCancel").addEventListener("click", () => { $("postForm").hidden = true; $("postToggle").setAttribute("aria-expanded", "false"); });
    $("fKind").addEventListener("change", () => { $("fTeamWrap").style.display = $("fKind").value === "team_need" ? "" : "none"; });
    $("fKind").dispatchEvent(new Event("change"));
    $("postForm").addEventListener("submit", submitPost);
    await Promise.all([loadMe(), load()]);
  }

  async function loadMe() {
    const r = await api("/api/lfg/me");
    const el = $("meStrip");
    if (!r.ok) { el.innerHTML = ""; return; }
    const d = r.data;
    const bits = [];
    const rel = d.reliability || {};
    bits.push(`<span class="lfg-chip">Showed ${rel.showed || 0} &middot; Bailed ${rel.bailed || 0}</span>`);
    if (d.teams_count > 0) bits.push(`<span class="lfg-chip">On ${d.teams_count} team${d.teams_count === 1 ? "" : "s"}</span>`);
    if (d.banned_until) bits.push(`<span class="lfg-chip danger">&#9888; Paused until ${esc(String(d.banned_until).slice(0, 10))}</span>`);
    else if (d.caution === "yellow") bits.push('<span class="lfg-chip warn">&#9888; A no-show was reported; a second pauses community play for 30 days</span>');
    el.innerHTML = bits.join("");
  }

  async function load() {
    const r = await api("/api/lfg/listings" + (kind ? "?kind=" + kind : ""));
    const el = $("list");
    if (!r.ok) { el.innerHTML = `<div class="lfg-empty">${esc(r.data.error || "Couldn't load posts. Try again.")}</div>`; return; }
    const rows = r.data.listings || [];
    if (!rows.length) {
      el.innerHTML = '<div class="lfg-empty">Nothing posted here yet. Be the first: tap "Post something."</div>';
      return;
    }
    el.innerHTML = rows.map((l, i) => card(l, i)).join("");
    el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => act(b)));
    firstPaint = false;
  }

  function card(l, i) {
    const title = l.kind === "team_need" ? l.team_name : (l.kind === "player_avail" ? `${l.poster} wants to play` : (l.location_note || "Casual game"));
    const meta = [
      l.skill_level !== "any" ? l.skill_level.toUpperCase() : null,
      l.game_type !== "any" ? l.game_type : null,
      l.gender_requirement !== "any" ? l.gender_requirement : null,
      l.play_at ? fmtWhen(l.play_at) : null,
      l.location_note && l.kind !== "casual" ? esc(l.location_note) : null,
      l.spots != null ? `${l.committed - 1}/${l.spots} spots filled` : null,
    ].filter(Boolean).join(" &middot; ");
    const roster = (l.roster || []).map((m) =>
      `<span class="lfg-name">${esc(m.name)}${caut(m.caution)}</span>`).join("");
    const past = l.play_at && !isNaN(Date.parse(String(l.play_at).replace(" ", "T"))) &&
      Date.parse(String(l.play_at).replace(" ", "T")) < Date.now();
    const acts = [];
    if (!l.mine && !l.joined) acts.push(`<button class="btn" data-act="join" data-id="${l.id}">Commit</button>`);
    if (!l.mine && l.joined) acts.push(`<button class="btn ghost" data-act="withdraw" data-id="${l.id}" data-when="${esc(l.play_at || "")}">Withdraw</button>`);
    if (!l.mine) acts.push(`<button class="btn ghost" data-act="msg" data-id="${l.poster_contact_id}" data-name="${esc(l.poster)}">Message ${esc(l.poster)}</button>`);
    if (l.mine) acts.push(`<button class="btn ghost" data-act="close" data-id="${l.id}">Close post</button>`);
    if (l.mine && past && (l.roster || []).length > 1) acts.push(`<button class="btn ghost" data-act="noshow" data-id="${l.id}">Report a no-show</button>`);
    return `<article class="lfg-card${firstPaint ? " enter" : ""}"${firstPaint ? ` style="animation-delay:${Math.min(i, 6) * 40}ms"` : ""}>
      <div class="lfg-kind">${KIND_LABEL[l.kind] || ""}${l.mine ? " &middot; yours" : ""}</div>
      <h3>${esc(title)}${caut(l.poster_caution)}</h3>
      <div class="lfg-meta">Posted by ${esc(l.poster)}${meta ? " &middot; " + meta : ""}</div>
      ${l.note ? `<p class="lfg-note">${esc(l.note)}</p>` : ""}
      ${roster ? `<div class="lfg-roster" aria-label="Committed players">${roster}</div>` : ""}
      <div class="lfg-actions">${acts.join("")}</div>
    </article>`;
  }

  async function act(b) {
    const actName = b.dataset.act, id = b.dataset.id;
    if (actName === "msg") return compose(Number(id), b.dataset.name);
    if (actName === "withdraw") {
      const when = b.dataset.when && Date.parse(String(b.dataset.when).replace(" ", "T"));
      // 12 here mirrors BAIL_WINDOW_HOURS for the confirm copy only — the server decides what counts.
      if (when && when > Date.now() && when - Date.now() <= 12 * 3600 * 1000 &&
        !confirm("Game time is inside 12 hours; withdrawing now counts on your reliability record. Withdraw anyway?")) return;
    }
    if (actName === "close" && !confirm("Close this post? People will stop seeing it.")) return;
    if (actName === "noshow") return noShow(Number(id));
    b.disabled = true;
    const r = await api(`/api/lfg/listings/${id}/${actName === "close" ? "close" : actName}`, { method: "POST", body: "{}" });
    b.disabled = false;
    if (!r.ok) { alert(r.data.error || "That didn't go through. Try again."); return; }
    if (actName === "join" && r.data.teams_note) alert(r.data.teams_note);
    if (actName === "withdraw" && r.data.note) alert(r.data.note);
    await Promise.all([loadMe(), load()]);
  }

  async function noShow(listingId) {
    const r = await api("/api/lfg/listings?kind="); // roster comes with the board payload
    const l = (r.data.listings || []).find((x) => x.id === listingId);
    const others = (l && l.roster) || []; // owner is in this list; picking yourself gets a clean server refusal
    if (!others.length) { alert("No one else was committed to this game."); return; }
    const menu = others.map((m, i) => `${i + 1}. ${m.name}`).join("\n");
    const pick = prompt(`Who didn't show?\n${menu}\n\nEnter a number:`);
    const idx = Number(pick) - 1;
    if (!(idx >= 0 && idx < others.length)) return;
    if (!confirm(`Report ${others[idx].name} as a no-show? A caution shows by their name for 14 days; a second report pauses them for 30 days.`)) return;
    const res = await api(`/api/lfg/listings/${listingId}/report-no-show`, {
      method: "POST", body: JSON.stringify({ contact_id: others[idx].contact_id }),
    });
    if (!res.ok) { alert(res.data.error || "That didn't go through. Try again."); return; }
    alert(res.data.banned ? "Reported. That was their second; community play is paused for them for 30 days." : "Reported. A caution now shows by their name.");
    load();
  }

  /* Relay compose — library.js pattern; addresses never exposed. */
  function compose(contactId, name) {
    const old = document.getElementById("lfgCompose");
    if (old) old.remove();
    const wrap = document.createElement("div");
    wrap.id = "lfgCompose";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Message " + name);
    wrap.setAttribute("style", "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:70;padding:16px");
    wrap.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;max-width:480px;width:100%;padding:16px;display:grid;gap:10px">
      <h3 style="margin:0">Message ${esc(name)}</h3>
      <p class="muted" style="margin:0;font-size:13.5px">Goes to their inbox here. Your email stays private.</p>
      <input id="cmpSubject" maxlength="120" placeholder="Subject (optional)" style="min-height:44px;font:inherit;background:var(--surface-2,#1C1C21);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 10px" />
      <textarea id="cmpBody" maxlength="2000" placeholder="Say when you can play, what you're looking for…" style="min-height:96px;font:inherit;background:var(--surface-2,#1C1C21);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 10px"></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn ghost" id="cmpCancel" type="button" style="min-height:44px">Cancel</button>
        <button class="btn" id="cmpSend" type="button" style="min-height:44px">Send</button>
      </div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    wrap.querySelector("#cmpCancel").onclick = close;
    wrap.querySelector("#cmpBody").focus();
    wrap.querySelector("#cmpSend").onclick = async () => {
      const body = wrap.querySelector("#cmpBody").value.trim();
      if (!body) { wrap.querySelector("#cmpBody").focus(); return; }
      wrap.querySelector("#cmpSend").disabled = true;
      const r = await api("/api/messages/start", { method: "POST", body: JSON.stringify({
        to_contact_id: contactId, subject: wrap.querySelector("#cmpSubject").value.trim(), body }) });
      if (!r.ok) { alert(r.data.error || "Couldn't send. Try again."); wrap.querySelector("#cmpSend").disabled = false; return; }
      close();
      location.href = "member-inbox.html?thread=" + r.data.thread_id;
    };
  }

  async function submitPost(e) {
    e.preventDefault();
    $("fSubmit").disabled = true;
    const body = {
      kind: $("fKind").value,
      team_name: $("fTeam").value,
      skill_level: $("fSkill").value,
      game_type: $("fType").value,
      gender_requirement: $("fGender").value,
      spots: $("fSpots").value || null,
      play_at: $("fWhen").value ? new Date($("fWhen").value).toISOString() : null,
      location_note: $("fWhere").value,
      positions: $("fPos").value,
      note: $("fNote").value,
    };
    const r = await api("/api/lfg/listings", { method: "POST", body: JSON.stringify(body) });
    $("fSubmit").disabled = false;
    if (!r.ok) { alert(r.data.error || "Couldn't post. Try again."); return; }
    $("postForm").reset();
    $("postForm").hidden = true;
    $("postToggle").setAttribute("aria-expanded", "false");
    $("fKind").dispatchEvent(new Event("change"));
    await Promise.all([loadMe(), load()]);
  }
})();
