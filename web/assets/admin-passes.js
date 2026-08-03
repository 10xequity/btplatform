/* Boomtown Platform — Passes & credits (admin page script)
   File: web/assets/admin-passes.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.59.0

   Drives web/admin-passes.html against the v0.58.0 pass ledger. The balance shown here is the
   one the server derives from redemptions — this file never computes or caches a remaining
   count, because a second copy of that number is exactly the drift the ledger avoids (F-26).

   Click budget (owner req #19): issue a pass = 1 click to open the form, 1 to save.
   Spend a session = 1 click. Undo a session = 1 click plus a confirm, because it moves money.

   Every control is a real <button> with a 44px target and its own label. Errors are human
   sentences from the server, shown in place, never an alert() and never a code. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let picked = null;      // the member the form is about
  let filterContact = null;

  /* ---------- money + dates, formatted for people ---------- */

  const money = (cents) =>
    cents === null || cents === undefined ? "" :
    (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

  /** "31 Aug 2026", or "no end date". Locale-aware via Intl, never hand-formatted. */
  function whenLabel(iso) {
    if (!iso) return "no end date";
    const d = new Date(String(iso).replace(" ", "T") + (/[Zz]$/.test(iso) ? "" : "Z"));
    if (Number.isNaN(d.getTime())) return "unreadable date";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  /** Dollars typed by a human → whole cents, or null. "120", "120.00" and "$120" all work. */
  function toCents(text) {
    const s = String(text || "").replace(/[^0-9.]/g, "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }

  /* ---------- member picker ---------- */

  let searchTimer = null;
  function wireSearch(input, results, onPick) {
    input.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ""; return; }
      // Debounced: a keystroke is not a query. 250ms is under the threshold where typing feels
      // laggy but well above one request per character.
      searchTimer = setTimeout(async () => {
        const r = await api("/api/admin/members?q=" + encodeURIComponent(q));
        if (!r.ok) { results.innerHTML = ""; return; }
        const list = (r.data.members || r.data.contacts || []).slice(0, 8);
        results.innerHTML = list.length
          ? list.map((m) => `<button type="button" data-id="${m.id}" role="option" aria-selected="false">${esc(m.full_name || "(no name)")}<span class="mf-note"> · ${esc(m.email || "")}</span></button>`).join("")
          : `<p class="mf-note">Nobody matches “${esc(q)}”.</p>`;
        results.querySelectorAll("button[data-id]").forEach((b) => {
          b.addEventListener("click", () => {
            onPick({ id: Number(b.dataset.id), name: b.textContent.split(" · ")[0] });
            results.innerHTML = "";
          });
        });
      }, 250);
    });
  }

  /* ---------- the table ---------- */

  function rowHtml(p) {
    // remaining === null means unlimited within the window — "0 left" would be a lie.
    const left = p.remaining === null ? "unlimited" : `${p.remaining} left`;
    const cls = p.usable ? "mf-left" : "mf-left out";
    const why = p.usable ? "" : `<div class="mf-note">${esc(p.reason || "Not usable")}</div>`;
    return `<tr>
      <td data-label="Member">${esc(p.member_name || ("#" + p.contact_id))}</td>
      <td data-label="Pass"><b>${esc(p.name)}</b><div class="mf-note">${esc(p.kind.replace("_", " "))}${p.price_cents ? " · " + money(p.price_cents) : ""}</div></td>
      <td data-label="Left" class="num"><span class="${cls}">${esc(left)}</span>${why}</td>
      <td data-label="Ends" class="num">${esc(whenLabel(p.expires_at))}</td>
      <td data-label="Actions" class="mf-actions-cell"><div class="mf-actions">
        <button class="btn" data-spend="${p.id}" ${p.usable ? "" : "disabled"}>Use a session</button>
        <button class="btn ghost" data-void="${p.id}">Void</button>
      </div></td>
    </tr>`;
  }

  async function load() {
    const qs = filterContact ? "?contact_id=" + filterContact : "";
    const r = await api("/api/admin/passes" + qs);
    if (!r.ok) return fail("pBody", r.data.error || "Couldn't load passes.");
    const rows = r.data.passes || [];
    $("pBody").innerHTML = rows.map(rowHtml).join("");
    $("pEmpty").hidden = rows.length > 0;
    $("pTable").hidden = rows.length === 0;

    $("pBody").querySelectorAll("[data-spend]").forEach((b) =>
      b.addEventListener("click", () => spend(Number(b.dataset.spend), b)));
    $("pBody").querySelectorAll("[data-void]").forEach((b) =>
      b.addEventListener("click", () => voidPass(Number(b.dataset.void))));
  }

  /* ---------- actions ---------- */

  async function spend(id, btn) {
    const row = btn.closest("tr");
    const isGuest = /guest/i.test(row ? row.textContent : "");
    const body = {};
    if (isGuest) {
      // A guest pass is spent on somebody else; the server refuses without a name, so ask here
      // rather than letting the desk hit an error they cannot act on.
      const who = window.prompt("Who is the guest?");
      if (who === null) return;
      if (!who.trim()) return fail("pBody", "A guest pass needs the guest's name.");
      body.guest_name = who.trim();
    }
    btn.disabled = true;
    const r = await api(`/api/admin/passes/${id}/redeem`, { method: "POST", body: JSON.stringify(body) });
    btn.disabled = false;
    if (!r.ok) return fail("pBody", r.data.error || "Couldn't use that pass.");
    load();
  }

  async function voidPass(id) {
    if (!window.confirm("Void this pass? What has already been used stays on the record.")) return;
    const r = await api(`/api/admin/passes/${id}/void`, { method: "POST", body: "{}" });
    if (!r.ok) return fail("pBody", r.data.error || "Couldn't void that pass.");
    load();
  }

  /* ---------- issue form ---------- */

  function resetForm() {
    picked = null;
    ["pSearch", "pName", "pSessions", "pExpires", "pPrice"].forEach((k) => { $(k).value = ""; });
    $("pKind").value = "session";
    $("pResults").innerHTML = "";
    $("pErr").textContent = "";
  }

  async function submit(e) {
    e.preventDefault();
    $("pErr").textContent = "";
    if (!picked) { $("pErr").textContent = "Pick a member first."; $("pSearch").focus(); return; }

    const sessions = $("pSessions").value.trim();
    const body = {
      contact_id: picked.id,
      name: $("pName").value.trim(),
      kind: $("pKind").value,
      total_sessions: sessions === "" ? null : Number(sessions),
      expires_at: $("pExpires").value || null,
      price_cents: toCents($("pPrice").value),
    };

    const save = $("pSave");
    const label = save.textContent;
    save.disabled = true; save.textContent = "Saving…";
    const r = await api("/api/admin/passes", { method: "POST", body: JSON.stringify(body) });
    save.disabled = false; save.textContent = label;

    // The server's message is the human one — it knows why. Show it next to the form, in place.
    if (!r.ok) { $("pErr").textContent = r.data.error || "Couldn't issue that pass."; return; }
    resetForm();
    $("pForm").hidden = true;
    load();
  }

  /* ---------- boot ---------- */

  document.addEventListener("DOMContentLoaded", () => {
    $("pNew").addEventListener("click", () => {
      const showing = !$("pForm").hidden;
      $("pForm").hidden = showing;
      if (!showing) $("pSearch").focus();
    });
    $("pCancel").addEventListener("click", () => { resetForm(); $("pForm").hidden = true; });
    $("pForm").addEventListener("submit", submit);

    wireSearch($("pSearch"), $("pResults"), (m) => {
      picked = m;
      $("pSearch").value = m.name;
    });

    const filterResults = document.createElement("div");
    filterResults.className = "mf-results";
    $("pFilter").parentNode.appendChild(filterResults);
    wireSearch($("pFilter"), filterResults, (m) => {
      filterContact = m.id;
      $("pFilter").value = m.name;
      load();
    });
    $("pClear").addEventListener("click", () => {
      filterContact = null; $("pFilter").value = ""; filterResults.innerHTML = ""; load();
    });

    load();
  });
})();
