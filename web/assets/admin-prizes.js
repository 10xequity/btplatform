/* Boomtown Platform — Prizes & Inventory (admin)
   File: web/assets/admin-prizes.js · Version: v1.0 · Date: 2026-10-12 · Ships in: v0.213.0
   Award: the event's finishers come off the bracket (GET /api/admin/events/:id/prizes); each row has
   ONE button, which opens a dialog pre-filled with who and what place — two taps to log a medal.
   Inventory: on-hand is derived server-side. Receive: an invoice with lines; the file goes through
   the existing /api/uploads (kind 'receipt') and its id rides on the receipt. Uses BT_ADMIN
   helpers; errors render through fail(). Speaks the hub's ?event= contract. */
(async function () {
  const { api, guard, esc, fail } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;
  const $ = (id) => document.getElementById(id);
  const money = (c) => "$" + ((c || 0) / 100).toFixed(2);
  const cents = (v) => Math.round((+v || 0) * 100);
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const msg = (el, text, ok) => { el.textContent = text || ""; el.className = "pz-msg " + (text ? (ok ? "ok" : "err") : ""); };

  /* ---------- tabs (shared .tabs/.tab component) ---------- */
  const tabs = [...document.querySelectorAll(".tabs [data-tab]")];
  function showTab(key) {
    tabs.forEach((t) => { const on = t.dataset.tab === key; t.classList.toggle("active", on); t.setAttribute("aria-selected", on); });
    document.querySelectorAll(".pz-panel").forEach((p) => p.classList.toggle("on", p.id === "panel-" + key));
    if (key === "inventory") loadItems();
    if (key === "receive") { loadItems(); loadReceipts(); }
  }
  tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

  /* ---------- shared data ---------- */
  let ITEMS = [], EVENT = null;

  async function loadItems() {
    const r = await api("/api/admin/prizes/items?all=1");
    if (!r.ok) return fail(r.data.error || "Could not load prize items.");
    ITEMS = r.data.items;
    renderInventory();
    const opts = ITEMS.filter((i) => i.active).map((i) =>
      `<option value="${i.id}">${esc(i.name)} · ${i.on_hand} on hand</option>`).join("");
    $("awItem").innerHTML = `<option value="">None (cash only)</option>` + opts;
    document.querySelectorAll("#rcLines datalist").forEach((d) => { d.innerHTML = ITEMS.map((i) => `<option value="${esc(i.name)}">`).join(""); });
  }

  /* ================= AWARD ================= */
  async function loadEvents() {
    const r = await api("/api/events"); // staff sessions get every status from this route
    if (!r.ok) return fail(r.data.error || "Could not load events.");
    const evs = r.data.events.filter((e) => e.type === "tournament" || e.type === "league");
    const pre = new URLSearchParams(location.search).get("event");
    $("awEvent").innerHTML = evs.map((e) =>
      `<option value="${e.id}" ${String(e.id) === pre ? "selected" : ""}>${esc(e.name)} · ${esc(String(e.starts_at || "").slice(0, 10))}</option>`).join("")
      || `<option value="">No tournaments or leagues yet</option>`;
    if (pre && !evs.some((e) => String(e.id) === pre)) {
      $("awBasis").textContent = "That event isn't a tournament or league, so it has no finishers to award.";
    }
    await loadSheet();
  }
  $("awEvent").addEventListener("change", loadSheet);

  async function loadSheet() {
    const id = $("awEvent").value;
    if (!id) { $("awFinishers").innerHTML = ""; $("awList").innerHTML = ""; return; }
    const r = await api(`/api/admin/events/${id}/prizes`);
    if (!r.ok) return fail(r.data.error || "Could not load this event's prizes.");
    EVENT = r.data;
    const basis = { bracket: "Read off the bracket: the final's winner, its loser, and both semi-final losers.",
                    standings: "No bracket result yet; these are the pool standings' top three.",
                    none: "No bracket or standings yet. You can still award someone from the team list." }[r.data.basis];
    $("awBasis").textContent = basis;
    const given = (f) => r.data.awards.filter((a) => a.team_id === f.team_id);
    $("awFinishers").innerHTML = r.data.finishers.map((f) => `
      <div class="pz-row">
        <span class="pz-place p${f.place}" aria-label="Place ${f.place}">${f.place}${f.place === 1 ? "st" : f.place === 2 ? "nd" : f.place === 3 ? "rd" : "th"}</span>
        <div class="grow"><div class="k">${esc(f.team)}</div>
          <div class="v">${esc(f.bracket)}${given(f).length ? " · got " + esc(given(f).map(describe).join(", ")) : ""}</div></div>
        <button class="btn primary sm" type="button" data-award="${f.team_id}" data-place="${f.place}" data-bracket="${esc(f.bracket)}">Award</button>
      </div>`).join("") || `<p class="muted">Nobody has finished yet.</p>`;
    $("awCash").textContent = r.data.awards.length
      ? `${r.data.awards.length} award${r.data.awards.length === 1 ? "" : "s"} · cash paid ${money(r.data.cash_total_cents)}`
      : "Nothing logged for this event yet.";
    $("awList").innerHTML = r.data.awards.map((a) => `
      <div class="pz-row">
        <div class="grow"><div class="k">${esc(a.recipient)}${a.place ? ` · ${a.place}${a.place === 1 ? "st" : a.place === 2 ? "nd" : a.place === 3 ? "rd" : "th"}` : ""}${a.bracket_name ? " " + esc(a.bracket_name) : ""}</div>
          <div class="v">${esc(describe(a))}${a.notes ? " · " + esc(a.notes) : ""} · ${esc(String(a.created_at).slice(0, 16))}</div></div>
        <button class="btn ghost sm" type="button" data-void-award="${a.id}">Undo</button>
      </div>`).join("");
    $("awRecipient").innerHTML = r.data.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")
      + `<option value="">Someone else (type a name in notes)</option>`;
  }
  function describe(a) {
    const bits = [];
    if (a.item) bits.push(`${a.qty} × ${a.item}`);
    if (a.cash_cents) bits.push(money(a.cash_cents) + " cash");
    return bits.join(" + ") || "—";
  }

  const dlg = $("awDlg");
  function openAward({ teamId, place, bracket, who }) {
    $("awTeamId").value = teamId || "";
    $("awPlace").value = place || "";
    $("awBracket").value = bracket || "";
    $("awWhoRow").hidden = !!teamId;
    if (teamId) $("awRecipient").value = String(teamId);
    $("awDlgWho").textContent = who ? `${who}${place ? " · " + place + (place === 1 ? "st" : place === 2 ? "nd" : place === 3 ? "rd" : "th") : ""}${bracket ? " · " + bracket : ""}` : "";
    $("awItem").value = ""; $("awQty").value = 1; $("awCashAmt").value = ""; $("awNotes").value = "";
    msg($("awMsg"), "");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    $("awItem").focus();
  }
  $("awFinishers").addEventListener("click", (e) => {
    const b = e.target.closest("[data-award]");
    if (!b) return;
    const f = EVENT.finishers.find((x) => String(x.team_id) === b.dataset.award && String(x.place) === b.dataset.place);
    openAward({ teamId: +b.dataset.award, place: +b.dataset.place, bracket: b.dataset.bracket, who: f ? f.team : "" });
  });
  $("awOther").addEventListener("click", () => { if (!EVENT) return; openAward({}); });
  $("awCancel").addEventListener("click", () => dlg.close());
  $("awList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-void-award]");
    if (!b) return;
    b.disabled = true;
    const r = await api(`/api/admin/prizes/awards/${b.dataset.voidAward}/void`, { method: "POST" });
    if (!r.ok) { b.disabled = false; return fail(r.data.error || "Could not undo that award."); }
    await loadSheet(); await loadItems();
  });
  $("awForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const teamId = $("awTeamId").value || $("awRecipient").value;
    const body = {
      event_id: +$("awEvent").value,
      team_id: teamId ? +teamId : null,
      recipient: teamId ? null : ($("awNotes").value || "").trim(),
      place: $("awPlace").value ? +$("awPlace").value : null,
      bracket_name: $("awBracket").value || null,
      item_id: $("awItem").value ? +$("awItem").value : null,
      qty: +$("awQty").value || 1,
      cash_cents: cents($("awCashAmt").value),
      notes: $("awNotes").value,
    };
    const r = await api("/api/admin/prizes/awards", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return msg($("awMsg"), r.data.error || "Could not log that award.");
    dlg.close();
    await loadSheet(); await loadItems();
  });

  /* ================= INVENTORY ================= */
  function renderInventory() {
    $("invList").innerHTML = ITEMS.map((i) => `
      <div class="pz-row">
        <span class="pz-stock ${i.on_hand <= 0 ? "low" : ""}" aria-label="${i.on_hand} on hand">${i.on_hand}</span>
        <div class="grow"><div class="k">${esc(i.name)}${i.active ? "" : " <span class=\"muted\">(retired)</span>"}</div>
          <div class="v">${i.awarded} awarded · cost ${money(i.unit_cost_cents)}${i.sponsor ? " · from " + esc(i.sponsor) : ""}${i.notes ? " · " + esc(i.notes) : ""}</div></div>
        <button class="btn ghost sm" type="button" data-edit-item="${i.id}">Edit</button>
      </div>`).join("") || `<p class="muted">No prize items yet. Log a receipt, or add one here.</p>`;
  }
  $("invList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit-item]");
    if (!b) return;
    const i = ITEMS.find((x) => String(x.id) === b.dataset.editItem);
    $("itemId").value = i.id; $("itemName").value = i.name; $("itemCost").value = (i.unit_cost_cents / 100).toFixed(2);
    $("itemSponsor").value = i.sponsor_id || ""; $("itemNotes").value = i.notes || "";
    $("itemFormTitle").textContent = "Edit item"; $("itemName").focus();
  });
  $("itemReset").addEventListener("click", () => { $("itemForm").reset(); $("itemId").value = ""; $("itemFormTitle").textContent = "New item"; msg($("itemMsg"), ""); });
  $("itemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("itemId").value;
    const body = { name: $("itemName").value, unit_cost_cents: cents($("itemCost").value), sponsor_id: $("itemSponsor").value || null, notes: $("itemNotes").value };
    const r = await api(id ? `/api/admin/prizes/items/${id}` : "/api/admin/prizes/items", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return msg($("itemMsg"), r.data.error || "Could not save that item.");
    msg($("itemMsg"), "Saved.", true);
    $("itemReset").click();
    await loadItems();
  });
  async function loadSponsors() {
    const r = await api("/api/admin/pos/sponsors");
    if (!r.ok) return;
    $("itemSponsor").innerHTML = `<option value="">Nobody</option>` + (r.data.sponsors || []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  }

  /* ================= RECEIVE ================= */
  function addLine(pref) {
    const row = document.createElement("div");
    row.className = "pz-line";
    const n = $("rcLines").children.length + 1;
    row.innerHTML = `
      <div><label for="rcItem${n}" class="pz-hint">Item</label><input id="rcItem${n}" list="rcItemsList${n}" placeholder="Gold medal" required /><datalist id="rcItemsList${n}">${ITEMS.map((i) => `<option value="${esc(i.name)}">`).join("")}</datalist></div>
      <div><label for="rcQty${n}" class="pz-hint">Qty</label><input id="rcQty${n}" type="number" step="1" required value="${pref && pref.qty || ""}" /></div>
      <div><label for="rcCost${n}" class="pz-hint">Cost each</label><input id="rcCost${n}" type="number" min="0" step="0.01" placeholder="0.00" /></div>
      <button class="btn ghost sm" type="button" aria-label="Remove line">×</button>`;
    row.querySelector("button").addEventListener("click", () => row.remove());
    $("rcLines").appendChild(row);
    row.querySelector("input").focus();
  }
  $("rcAddLine").addEventListener("click", () => addLine());
  addLine();

  function uploadFile(file) {
    // Mirrors admin-uploads.js: raw body, the three auth headers api() sets. kind=receipt, private.
    return new Promise((resolve) => {
      const qs = new URLSearchParams({ filename: file.name, kind: "receipt", visibility: "private" });
      const xhr = new XMLHttpRequest();
      xhr.open("POST", API + "/api/uploads?" + qs.toString(), true);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      const tok = sessionStorage.getItem("bt_token") || localStorage.getItem("bt_token");
      if (tok) xhr.setRequestHeader("Authorization", "Bearer " + tok);
      const org = localStorage.getItem("bt_org");
      if (org) xhr.setRequestHeader("X-Org-Id", org);
      xhr.onload = () => { try { resolve({ status: xhr.status, data: JSON.parse(xhr.responseText || "{}") }); } catch { resolve({ status: xhr.status, data: {} }); } };
      xhr.onerror = () => resolve({ status: 0, data: { error: "The upload did not reach the server." } });
      xhr.send(file);
    });
  }

  $("rcForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg($("rcMsg"), "");
    const lines = [...$("rcLines").children].map((row) => {
      const [item, qty, cost] = row.querySelectorAll("input");
      const existing = ITEMS.find((i) => i.name.toLowerCase() === item.value.trim().toLowerCase());
      return { item_id: existing ? existing.id : null, name: item.value.trim(), qty: +qty.value, unit_cost_cents: cents(cost.value) };
    }).filter((l) => l.name);
    if (!lines.length) return msg($("rcMsg"), "Add at least one line.");
    let upload_id = null;
    const file = $("rcFile").files[0];
    if (file) {
      msg($("rcMsg"), "Uploading the invoice…", true);
      const up = await uploadFile(file);
      if (up.status !== 200 && up.status !== 201) return msg($("rcMsg"), up.data.error || "The invoice file could not be stored; the receipt was not logged.");
      upload_id = up.data.id || (up.data.upload && up.data.upload.id) || null;
    }
    const body = {
      vendor: $("rcVendor").value, source: $("rcSource").value, invoice_no: $("rcInvoice").value, invoice_date: $("rcDate").value,
      total_cents: $("rcTotal").value === "" ? null : cents($("rcTotal").value), upload_id, notes: $("rcNotes").value, lines,
    };
    const r = await api("/api/admin/prizes/receipts", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return msg($("rcMsg"), r.data.error || "Could not log that receipt.");
    msg($("rcMsg"), `Logged: ${r.data.lines} line${r.data.lines === 1 ? "" : "s"} added to stock.`, true);
    $("rcForm").reset(); $("rcLines").innerHTML = ""; addLine();
    await loadItems(); await loadReceipts();
  });

  async function loadReceipts() {
    const r = await api("/api/admin/prizes/receipts");
    if (!r.ok) return fail(r.data.error || "Could not load receipts.");
    $("rcList").innerHTML = r.data.receipts.map((x) => `
      <div class="pz-row">
        <div class="grow"><div class="k">${esc(x.vendor)}${x.invoice_no ? " · #" + esc(x.invoice_no) : ""}${x.source !== "manual" ? ` <span class="muted">(${esc(x.source)})</span>` : ""}</div>
          <div class="v">${esc(x.summary || "")} · ${x.total_cents != null ? money(x.total_cents) + " · " : ""}${esc(x.invoice_date || String(x.created_at).slice(0, 10))}${x.upload_id ? ` · <a href="${API}/api/uploads/${x.upload_id}" target="_blank" rel="noopener">Invoice</a>` : ""}</div></div>
        <button class="btn ghost sm" type="button" data-void-receipt="${x.id}">Void</button>
      </div>`).join("") || `<p class="muted">No receipts yet.</p>`;
  }
  $("rcList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-void-receipt]");
    if (!b) return;
    b.disabled = true;
    const r = await api(`/api/admin/prizes/receipts/${b.dataset.voidReceipt}/void`, { method: "POST" });
    if (!r.ok) { b.disabled = false; return fail(r.data.error || "Could not void that receipt."); }
    await loadItems(); await loadReceipts();
  });

  /* ---------- boot ---------- */
  await loadItems();
  await loadSponsors();
  await loadEvents();
})();
