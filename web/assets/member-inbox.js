/* Boomtown Platform — Member Inbox (member-facing)
   File: web/assets/member-inbox.js · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.17.0
   Threads (GET /api/messages/threads) → conversation (GET /api/messages/thread?id=, marks
   read) → reply (POST /api/messages/reply). Tools: Block (POST /api/messages/block),
   Hide (POST /api/messages/hide), Report a message (POST /api/messages/report).
   Deep link: member-inbox.html?thread=N opens straight into a conversation. */
(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = (iso) => { try { return new Date(iso + "Z").toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso || ""; } };

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
      const resp = await fetch(API + path, Object.assign({ credentials: "include" }, opts, { headers: Object.assign(headers(), (opts.headers || {})) }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
    } catch (e) { return { ok: false, status: 0, data: { error: "Can't reach the server. Check your connection and try again." } }; }
  }

  if (!sessionStorage.getItem("bt_token")) {
    $("box").innerHTML = `<p>Your inbox lives behind sign-in.</p>
      <p style="margin-top:10px"><a class="btn" href="index.html">Sign in</a></p>`;
    return;
  }

  const deepLink = new URLSearchParams(location.search).get("thread");

  /* ---------------- threads list ---------------- */
  async function listThreads() {
    history.replaceState(null, "", location.pathname);
    $("box").innerHTML = '<p class="help-text">Loading…</p>';
    const r = await api("/api/messages/threads");
    if (!r.ok) return failBox(r.data.error || "Couldn't load your inbox.");
    const th = r.data.threads || [];
    if (!th.length) {
      $("box").innerHTML = `<p><b>No conversations yet.</b></p>
        <p class="help-text" style="margin-top:6px">Find teammates and subs in the
        <a href="library.html">Player Library</a> — hit Message on anyone listed.</p>`;
      return;
    }
    $("box").innerHTML = th.map((t) => `
      <div class="th-row" data-open="${t.id}" role="button" tabindex="0"
           aria-label="Conversation with ${esc(t.with)}${t.unread ? `, ${t.unread} unread` : ""}">
        <div class="who"><b>${esc(t.with)}${t.subject ? " · " + esc(t.subject) : ""}</b>
          <span>${esc(t.preview)}</span></div>
        ${t.unread ? `<span class="badge">${t.unread > 9 ? "9+" : t.unread}</span>` : ""}
        <span class="when">${when(t.last_message_at)}</span>
      </div>`).join("");
    document.querySelectorAll("[data-open]").forEach((el) => {
      const go = () => openThread(Number(el.dataset.open));
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  /* ---------------- one conversation ---------------- */
  async function openThread(id) {
    $("box").innerHTML = '<p class="help-text">Loading…</p>';
    const r = await api("/api/messages/thread?id=" + id);
    if (!r.ok) return failBox(r.data.error || "Couldn't open that conversation.");
    const { thread, messages } = r.data;
    const otherId = (thread.other_contact_ids || [])[0];
    $("box").innerHTML = `
      <div class="thread-tools">
        <button class="btn ghost" id="backBtn" type="button">← All conversations</button>
        <span class="spacer" style="flex:1"></span>
        <button class="btn ghost" id="hideBtn" type="button">Hide</button>
        ${otherId ? `<button class="btn ghost" id="blockBtn" type="button">Block</button>` : ""}
      </div>
      ${thread.subject ? `<p style="font-weight:700;margin:0 0 4px">${esc(thread.subject)}</p>` : ""}
      <div id="msgs">${messages.map((m) => `
        <div class="msg${m.mine ? " mine" : ""}">${esc(m.body)}
          <span class="meta">${m.mine ? "You" : esc(m.sender_name)} · ${when(m.created_at)}
          ${m.mine ? "" : ` · <button class="rpt" data-report="${m.id}" type="button">Report</button>`}</span>
        </div>`).join("")}</div>
      <div class="reply-bar">
        <textarea id="replyBody" maxlength="2000" placeholder="Reply…" aria-label="Reply"></textarea>
        <button class="btn" id="replySend" type="button">Send</button>
      </div>`;
    $("box").scrollTop = $("box").scrollHeight;

    $("backBtn").onclick = listThreads;
    $("hideBtn").onclick = async () => {
      const r2 = await api("/api/messages/hide", { method: "POST", body: JSON.stringify({ thread_id: id }) });
      if (r2.ok) listThreads(); else alert(r2.data.error || "Couldn't hide.");
    };
    const blockBtn = $("blockBtn");
    if (blockBtn) blockBtn.onclick = async () => {
      if (!confirm("Block this player? They won't be able to message you, and you won't see each other in the library.")) return;
      const r2 = await api("/api/messages/block", { method: "POST", body: JSON.stringify({ contact_id: otherId }) });
      if (r2.ok) { alert(r2.data.message || "Blocked."); listThreads(); } else alert(r2.data.error || "Couldn't block.");
    };
    document.querySelectorAll("[data-report]").forEach((b) => b.addEventListener("click", async () => {
      const reason = prompt("What's wrong with this message? (goes to the admins)");
      if (reason === null) return;
      const r2 = await api("/api/messages/report", { method: "POST", body: JSON.stringify({ message_id: Number(b.dataset.report), reason }) });
      alert(r2.ok ? (r2.data.message || "Reported.") : (r2.data.error || "Couldn't report."));
    }));
    $("replySend").onclick = async () => {
      const body = $("replyBody").value.trim();
      if (!body) { $("replyBody").focus(); return; }
      $("replySend").disabled = true;
      const r2 = await api("/api/messages/reply", { method: "POST", body: JSON.stringify({ thread_id: id, body }) });
      $("replySend").disabled = false;
      if (!r2.ok) return alert(r2.data.error || "Couldn't send — try again.");
      openThread(id);
    };
  }

  function failBox(msg) {
    $("box").innerHTML = `<p>${esc(msg)}</p>
      <p style="margin-top:10px"><a class="btn ghost" href="member-inbox.html">← Back</a>
      <a class="btn ghost" href="home.html">Dashboard</a></p>`;
  }

  if (deepLink) openThread(Number(deepLink)); else listThreads();
})();
/* Changelog: v1.0 (2026-07-24) — initial Member Inbox logic (M14 Phase B). */
