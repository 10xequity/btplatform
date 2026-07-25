/* Boomtown Platform — Security & Recovery (admin)
   File: web/assets/admin-security.js · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.14.0
   Audit-log viewer (kind presets + search + id-cursor paging, no animation on paging —
   frequency rule), whitelist-only Restore with confirm, lockout rescue link. */
(async function () {
  const { api, guard, esc } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;
  const $ = (id) => document.getElementById(id);
  const fail = (msg) => (window.BT_ADMIN.fail
    ? window.BT_ADMIN.fail($("app"), msg)
    : ($("app").innerHTML = `<div class="empty">${esc(msg)}</div>`));

  const fmt = (s) => String(s || "").replace("T", " ").slice(0, 16);

  /* ---------- security log ---------- */
  let nextBefore = null;
  async function loadLog(append) {
    const kind = $("logKind").value, q = encodeURIComponent($("logQ").value.trim());
    const before = append && nextBefore ? `&before=${nextBefore}` : "";
    const r = await api(`/api/admin/security/log?kind=${kind}&q=${q}${before}`);
    if (!r.ok) return fail(r.data.error || "Could not load the security log.");
    const rows = r.data.log || [];
    nextBefore = r.data.next_before;
    $("logMore").hidden = !nextBefore;
    const html = rows.map((l) => {
      let d = "";
      try { const j = JSON.parse(l.detail_json || "{}"); const ks = Object.keys(j); if (ks.length) d = ks.slice(0, 4).map(k => `${k}: ${typeof j[k] === "object" ? JSON.stringify(j[k]) : j[k]}`).join(" · "); } catch {}
      return `<div class="log-row">
        <span class="act">${esc(l.action)}</span>
        <span>${esc(l.entity || "")}${l.entity_id ? " #" + esc(l.entity_id) : ""}</span>
        <span class="when">${esc(fmt(l.created_at))}</span>
        <span class="who">${esc(l.actor || "system")}${d ? " · " + esc(d) : ""}</span>
      </div>`;
    }).join("");
    if (append) $("logList").insertAdjacentHTML("beforeend", html);
    else $("logList").innerHTML = html || `<p class="help-text" style="margin:0">Nothing in the log for this filter yet.</p>`;
  }
  $("logGo").onclick = () => loadLog(false);
  $("logKind").onchange = () => loadLog(false);
  $("logQ").addEventListener("keydown", (e) => { if (e.key === "Enter") loadLog(false); });
  $("logMore").onclick = () => loadLog(true);

  /* ---------- trash & restore ---------- */
  async function loadTrash() {
    const entity = $("trEntity").value;
    const r = await api(`/api/admin/security/deleted?entity=${entity}`);
    if (!r.ok) { $("trList").innerHTML = `<p class="help-text" style="margin:0">${esc(r.data.error || "Could not load.")}</p>`; return; }
    const rows = r.data.rows || [];
    $("trList").innerHTML = rows.length ? rows.map((t) => `
      <div class="tr-row" data-id="${t.id}">
        <span class="lbl">${esc(t.label || "(no name)")}</span>
        <span class="meta">${esc(t.extra == null ? "" : String(t.extra))}</span>
        <span class="meta grow">deleted ${esc(fmt(t.deleted_at))}</span>
        <button class="btn ghost" data-restore="${t.id}">Restore</button>
      </div>`).join("")
      : `<p class="help-text" style="margin:0">The trash is empty for this list.</p>`;
    $("trList").querySelectorAll("[data-restore]").forEach((b) => b.onclick = async () => {
      if (!confirm("Restore this item? It reappears everywhere it used to be.")) return;
      b.disabled = true;
      const r2 = await api("/api/admin/security/restore", { method: "POST", body: JSON.stringify({ entity, id: Number(b.dataset.restore) }) });
      b.disabled = false;
      if (r2.ok) loadTrash();
      else alert(r2.data.error || "Could not restore.");
    });
  }
  $("trEntity").onchange = loadTrash;

  /* ---------- lockout rescue ---------- */
  $("rescueGo").onclick = async () => {
    const email = $("rescueEmail").value.trim();
    const btn = $("rescueGo"); btn.disabled = true;
    const r = await api("/api/admin/security/rescue-link", { method: "POST", body: JSON.stringify({ email }) });
    btn.disabled = false;
    if (!r.ok) { $("rescueOut").innerHTML = `<p class="notice-err" style="margin:0">${esc(r.data.error || "Could not issue a link.")}</p>`; return; }
    $("rescueOut").innerHTML = `<p class="notice-ok" style="margin:0">${esc(r.data.note || r.data.message || "Done.")}</p>` +
      (r.data.dev_link ? `<p style="margin:6px 0 0"><a href="${esc(r.data.dev_link)}">${esc(r.data.dev_link)}</a>
        <button class="btn ghost" id="copyLink" style="margin-left:8px">Copy</button></p>` : "");
    const cp = $("copyLink");
    if (cp) cp.onclick = () => { navigator.clipboard.writeText(r.data.dev_link); cp.textContent = "Copied"; };
  };

  loadLog(false);
  loadTrash();
})();
