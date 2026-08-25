/* Boomtown Platform — Staff pay (admin page script)
   File: web/assets/admin-staff-pay.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.61.0

   Drives the rate cards and shift-pay report shipped in v0.58.0.

   TWO THINGS THIS SCREEN REFUSES TO DO, both deliberate:
   1. It never adds approved and pending together. They are separate columns with separate
      headings, because "owed" and "might be owed" are different questions and one combined figure
      is how somebody gets overpaid.
   2. It never edits a rate in place. A new rate is a new row with its own start date, so last
      month's approved shifts keep the number they were approved at. Changing history silently is
      the failure this design exists to prevent.

   Money is typed in DOLLARS and converted here, because nobody thinks in cents and "2500" in a
   rate box is the single most likely way to pay a coach a hundred times too much. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let picked = null;
  let rates = [];

  const BASIS_LABEL = { hourly: "Per hour", flat: "Flat per shift", per_session: "Per session" };

  const money = (cents) =>
    cents === null || cents === undefined ? "—" :
    (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

  /** Dollars a human typed → whole cents. "25", "25.00" and "$25" all work; junk becomes null. */
  function toCents(text) {
    const s = String(text || "").replace(/[^0-9.]/g, "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }

  /* ---------- person picker ---------- */

  let timer = null;
  function wireSearch(input, results, onPick) {
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { results.innerHTML = ""; return; }
      timer = setTimeout(async () => {
        const r = await api("/api/admin/members?q=" + encodeURIComponent(q));
        if (!r.ok) { results.innerHTML = ""; return; }
        const list = (r.data.members || []).slice(0, 8);
        results.innerHTML = list.length
          ? list.map((m) => `<button type="button" data-id="${m.id}" role="option" aria-selected="false">${esc(m.full_name || "(no name)")}</button>`).join("")
          : `<p class="mf-note">Nobody matches “${esc(q)}”.</p>`;
        results.querySelectorAll("button[data-id]").forEach((b) =>
          b.addEventListener("click", () => {
            onPick({ id: Number(b.dataset.id), name: b.textContent });
            results.innerHTML = "";
          }));
      }, 250);
    });
  }

  /* ---------- rate card ---------- */

  function rateRow(r) {
    return `<tr>
      <td data-label="Person">${esc(r.full_name || ("#" + r.contact_id))}</td>
      <td data-label="Paid for">${r.role_label ? esc(r.role_label) : '<span class="mf-note">any role</span>'}</td>
      <td data-label="Basis">${esc(BASIS_LABEL[r.pay_basis] || r.pay_basis)}</td>
      <td data-label="Rate" class="num">${money(r.rate_cents)}</td>
      <td data-label="Actions" class="mf-actions-cell"><div class="mf-actions">
        <button class="btn ghost" data-del="${r.id}">Remove</button>
      </div></td>
    </tr>`;
  }

  async function loadRates() {
    const r = await api("/api/admin/staff-rates");
    if (!r.ok) return fail("rBody", r.data.error || "Couldn't load the rate card.");
    rates = r.data.rates || [];
    $("rBody").innerHTML = rates.map(rateRow).join("");
    $("rEmpty").hidden = rates.length > 0;
    $("rBody").querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => removeRate(Number(b.dataset.del))));
  }

  async function removeRate(id) {
    if (!window.confirm("Remove this rate?\n\nShifts already approved keep the numbers they were approved at; this only affects shifts assigned from now on.")) return;
    const r = await api(`/api/admin/staff-rates/${id}`, { method: "DELETE" });
    if (!r.ok) return fail("rBody", r.data.error || "Couldn't remove that rate.");
    loadRates();
  }

  async function submitRate(e) {
    e.preventDefault();
    $("rErr").textContent = "";
    if (!picked) { $("rErr").textContent = "Pick a person first."; $("rSearch").focus(); return; }
    const cents = toCents($("rAmount").value);
    if (cents === null) { $("rErr").textContent = "Enter the rate in dollars, like 25.00."; return; }

    const save = $("rSave");
    save.disabled = true; const was = save.textContent; save.textContent = "Saving…";
    const r = await api("/api/admin/staff-rates", {
      method: "POST",
      body: JSON.stringify({
        contact_id: picked.id,
        role_label: $("rRole").value.trim(),
        pay_basis: $("rBasis").value,
        rate_cents: cents,
      }),
    });
    save.disabled = false; save.textContent = was;
    if (!r.ok) { $("rErr").textContent = r.data.error || "Couldn't save that rate."; return; }
    picked = null;
    ["rSearch", "rRole", "rAmount"].forEach((k) => { $(k).value = ""; });
    $("rForm").hidden = true;
    loadRates();
  }

  /* ---------- what's owed ---------- */

  async function loadPay() {
    const from = $("pFrom").value || "";
    const to = $("pTo").value || "";
    const qs = [];
    if (from) qs.push("from=" + encodeURIComponent(from));
    if (to) qs.push("to=" + encodeURIComponent(to));
    const r = await api("/api/admin/shifts/pay" + (qs.length ? "?" + qs.join("&") : ""));
    if (!r.ok) return fail("payBody", r.data.error || "Couldn't load the pay report.");
    const people = r.data.people || [];
    $("payBody").innerHTML = people.map((p) => `<tr>
      <td data-label="Person">${esc(p.name || ("#" + p.contact_id))}</td>
      <td data-label="Shifts" class="num">${p.shifts}${p.units ? ` <span class="mf-note">${Number(p.units).toFixed(2)} units</span>` : ""}</td>
      <td data-label="Approved" class="num"><b>${money(p.approved_cents)}</b></td>
      <td data-label="Awaiting approval" class="num">${money(p.pending_cents)}</td>
    </tr>`).join("");
    $("payEmpty").hidden = people.length > 0;
  }

  /* ---------- boot ---------- */

  document.addEventListener("DOMContentLoaded", () => {
    $("rNew").addEventListener("click", () => {
      const showing = !$("rForm").hidden;
      $("rForm").hidden = showing;
      if (!showing) $("rSearch").focus();
    });
    $("rCancel").addEventListener("click", () => {
      picked = null;
      ["rSearch", "rRole", "rAmount"].forEach((k) => { $(k).value = ""; });
      $("rErr").textContent = "";
      $("rForm").hidden = true;
    });
    $("rForm").addEventListener("submit", submitRate);
    wireSearch($("rSearch"), $("rResults"), (m) => { picked = m; $("rSearch").value = m.name; });

    // Default the report to this month — the question people actually arrive with.
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    $("pFrom").value = first.toISOString().slice(0, 10);
    $("pTo").value = now.toISOString().slice(0, 10);
    $("pRun").addEventListener("click", loadPay);

    loadRates();
    loadPay();
  });
})();
