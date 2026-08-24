/* Boomtown Platform — Player Library (member-facing)
   File: web/assets/library.js · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.17.0
   Search the privacy-tiered library (GET /api/library/search), compose a relay message
   (POST /api/messages/start — addresses never exposed), and edit "My player card"
   (GET /api/profile/me + POST /api/profile/update, profiles.js v1.1 fields). */
(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
      const resp = await fetch(API + path, Object.assign({ headers: headers(), credentials: "include" }, opts, { headers: Object.assign(headers(), (opts.headers || {})) }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Check your connection and try again." } };
    }
  }

  const signedIn = !!sessionStorage.getItem("bt_token");

  /* ---------------- search ---------------- */
  async function search() {
    const f = new FormData($("filters"));
    const qs = new URLSearchParams();
    for (const k of ["q", "position", "level", "gender"]) { const v = (f.get(k) || "").trim(); if (v) qs.set(k, v); }
    $("results").innerHTML = '<p class="help-text">Searching…</p>';
    const r = await api("/api/library/search?" + qs.toString());
    if (!r.ok) { $("results").innerHTML = `<p class="help-text">${esc(r.data.error || "Search failed — try again.")}</p>`; return; }
    render(r.data.players || []);
  }

  function render(players) {
    if (!players.length) {
      $("results").innerHTML = `<div class="pl-card"><div class="who"><b>No players found</b>
        <p class="pl-bio">Try fewer filters${signedIn ? "" : " — or <a href='index.html'>sign in</a> to see members-only profiles"}.</p></div></div>`;
      return;
    }
    $("results").innerHTML = players.map((p) => {
      const initials = esc((p.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase());
      const tags = [p.positions, p.skill_level, p.gender_division, p.height_reach].filter(Boolean)
        .map((t) => `<span class="pl-tag">${esc(t)}</span>`).join("");
      const msgBtn = signedIn
        ? `<button class="btn" data-msg="${p.contact_id}" data-name="${esc(p.name)}" type="button">Message</button>`
        : `<a class="btn ghost" href="index.html">Sign in to message</a>`;
      return `<div class="pl-card">
        ${p.avatar_url ? `<img class="avatar" src="${API}${esc(p.avatar_url)}" alt="" loading="lazy">` : `<div class="avatar" aria-hidden="true">${initials}</div>`}
        <div class="who">
          <b><a href="member.html?contact_id=${p.contact_id}" style="color:inherit">${esc(p.name)}</a></b>
          <div class="pl-tags">${tags || '<span class="pl-tag">No details yet</span>'}</div>
          ${p.bio ? `<p class="pl-bio">${esc(p.bio)}</p>` : ""}
        </div>
        <div>${msgBtn}</div>
      </div>`;
    }).join("");
    document.querySelectorAll("[data-msg]").forEach((b) => b.addEventListener("click", () => compose(Number(b.dataset.msg), b.dataset.name)));
  }

  /* ---------------- relay compose ---------------- */
  function compose(contactId, name) {
    const wrap = document.createElement("div");
    wrap.className = "compose-modal";
    wrap.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Message ${esc(name)}">
      <h2 style="margin:0 0 4px;font-size:17px">Message ${esc(name)}</h2>
      <p class="help-text" style="margin:0 0 10px">Delivered in-app and by email through Boomtown —
        your email address stays private.</p>
      <input id="cmpSubject" placeholder="Subject (optional)" maxlength="120">
      <textarea id="cmpBody" placeholder="Write your message…" maxlength="2000" aria-label="Message body"></textarea>
      <div class="row-actions">
        <button class="btn ghost" id="cmpCancel" type="button">Cancel</button>
        <button class="btn" id="cmpSend" type="button">Send</button>
      </div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    wrap.querySelector("#cmpCancel").onclick = close;
    document.addEventListener("keydown", function esco(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esco); } });
    wrap.querySelector("#cmpBody").focus();
    wrap.querySelector("#cmpSend").onclick = async () => {
      const body = wrap.querySelector("#cmpBody").value.trim();
      if (!body) { wrap.querySelector("#cmpBody").focus(); return; }
      wrap.querySelector("#cmpSend").disabled = true;
      const r = await api("/api/messages/start", { method: "POST", body: JSON.stringify({
        to_contact_id: contactId, subject: wrap.querySelector("#cmpSubject").value.trim(), body }) });
      if (!r.ok) { alert(r.data.error || "Couldn't send — try again."); wrap.querySelector("#cmpSend").disabled = false; return; }
      close();
      location.href = "member-inbox.html?thread=" + r.data.thread_id;
    };
  }

  /* ---------------- my player card ---------------- */
  async function loadMyCard() {
    if (!signedIn) return;
    const r = await api("/api/profile/me");
    if (!r.ok) return; // no member record yet — card stays hidden
    const p = r.data.profile || {};
    $("mc_positions").value = p.positions || "";
    $("mc_level").value = p.skill_level || "";
    $("mc_gender").value = p.gender_division || "";
    $("mc_height").value = p.height_reach || "";
    $("mc_visibility").value = p.visibility || "members";
    $("myCard").hidden = false;
    $("mcSave").addEventListener("click", async () => {
      $("mcSave").disabled = true; $("mcStatus").textContent = "Saving…";
      const r2 = await api("/api/profile/update", { method: "POST", body: JSON.stringify({
        positions: $("mc_positions").value, skill_level: $("mc_level").value,
        gender_division: $("mc_gender").value, height_reach: $("mc_height").value,
        visibility: $("mc_visibility").value }) });
      $("mcSave").disabled = false;
      $("mcStatus").textContent = r2.ok ? "Saved ✓" : (r2.data.error || "Couldn't save — try again.");
      if (r2.ok) search();
    });
  }

  $("filters").addEventListener("submit", (e) => { e.preventDefault(); search(); });
  search();
  loadMyCard();
})();
/* Changelog: v1.0 (2026-07-24) — initial Player Library logic (M14 Phase B). */
