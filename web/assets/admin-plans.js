/* Boomtown Platform — Memberships (admin)
   File: web/assets/admin-plans.js · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.10.0
   Reads /api/admin/plans, /api/admin/subscriptions, /api/admin/mrr.
   Create/edit posts to /api/admin/plans — the worker also creates the Square
   Catalog plan + variation, so a plan is instantly sellable once Square keys exist. */

(function () {
  const { api, guard, esc, money } = window.BT_ADMIN;
  const $ = id => document.getElementById(id);
  let editingId = null;

  const savedTheme = localStorage.getItem("bt_theme");
  document.documentElement.dataset.theme = savedTheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  $("themeToggle").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("bt_theme", next);
  };

  boot();
  async function boot() {
    const me = await guard(); if (!me) return;
    const orgs = await api("/api/orgs");
    const sw = $("orgSwitcher");
    sw.innerHTML = (orgs.data.orgs || []).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("");
    sw.value = localStorage.getItem("bt_org") || "1";
    sw.onchange = () => { localStorage.setItem("bt_org", sw.value); load(); };
    $("planForm").onsubmit = save;
    $("cancelEdit").onclick = resetForm;
    load();
  }

  const say = (msg, isErr) => { $("status").innerHTML = msg ? `<p class="help-text" style="${isErr ? "color:var(--danger,#e5484d)" : ""}">${esc(msg)}</p>` : ""; };

  async function load() {
    const [pl, subs, m] = await Promise.all([
      api("/api/admin/plans"), api("/api/admin/subscriptions"), api("/api/admin/mrr"),
    ]);
    if (!pl.ok) { say(pl.data.error || "Couldn't load plans.", true); return; }

    $("billingNote").innerHTML = pl.data.billing_configured ? "" :
      `<div class="card" style="border-color:var(--warning,#e6a23c);margin-bottom:12px"><b>Square keys aren't set</b> —
       plans save locally but members can't subscribe yet. Add SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID
       (and the webhook key) as worker secrets, then edit + save each plan once to link it to Square.</div>`;

    if (m.ok) {
      $("mrr").firstChild.nodeValue = money(m.data.mrr_cents);
      $("activeN").firstChild.nodeValue = String(m.data.active_count);
      $("dueN").firstChild.nodeValue = String(m.data.past_due_count);
      $("dueN").parentElement.parentElement.style.borderColor = m.data.past_due_count > 0 ? "var(--warning,#e6a23c)" : "";
    }

    const plans = pl.data.plans || [];
    $("planRows").innerHTML = plans.length ? plans.map(p => `
      <tr>
        <td><b>${esc(p.name)}</b>${p.description ? `<div class="help-text">${esc(p.description)}</div>` : ""}</td>
        <td>${money(p.price_cents)}</td>
        <td>${p.billing_interval === "ANNUAL" ? "Annual" : "Monthly"}</td>
        <td>${p.subscriber_count}</td>
        <td>${p.square_variation_id ? "Linked ✓" : `<span class="pill off">not linked</span>`}</td>
        <td>${p.active ? `<span class="pill active">on sale</span>` : `<span class="pill off">hidden</span>`}</td>
        <td style="white-space:nowrap">
          <button class="btn ghost" data-edit="${p.id}">Edit</button>
          <button class="btn ghost" data-toggle="${p.id}" data-to="${p.active ? 0 : 1}">${p.active ? "Hide" : "Show"}</button>
        </td>
      </tr>`).join("") : `<tr><td colspan="7" class="help-text">No plans yet — create the first one above.</td></tr>`;
    $("planRows").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => startEdit(plans.find(p => p.id == b.dataset.edit)));
    $("planRows").querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => {
      const r = await api(`/api/admin/plans/${b.dataset.toggle}`, { method: "PUT", body: JSON.stringify({ active: +b.dataset.to }) });
      say(r.data.warning || r.data.error || (r.ok ? "Saved." : ""), !r.ok); load();
    });

    const rows = (subs.ok && subs.data.subscriptions) || [];
    $("subRows").innerHTML = rows.length ? rows.map(s => `
      <tr>
        <td>${esc(s.member_email || "—")}</td>
        <td>${esc(s.plan_name)} · ${money(s.price_cents)}/${s.billing_interval === "ANNUAL" ? "yr" : "mo"}</td>
        <td><span class="pill ${s.status === "active" ? "active" : s.status === "past_due" ? "past_due" : "off"}">${esc(s.status.replace("_", " "))}</span></td>
        <td>${esc((s.started_at || "").slice(0, 10))}</td>
        <td>${esc((s.current_period_end || "").slice(0, 10))}</td>
        <td>${s.card_last4 ? "····" + esc(s.card_last4) : "—"}</td>
      </tr>`).join("") : `<tr><td colspan="6" class="help-text">No subscribers yet.</td></tr>`;
  }

  function startEdit(p) {
    editingId = p.id;
    $("formTitle").textContent = `Edit: ${p.name}`;
    $("pName").value = p.name; $("pPrice").value = (p.price_cents / 100).toFixed(2);
    $("pInterval").value = p.billing_interval;
    $("pDesc").value = p.description || ""; $("pPerks").value = p.perks || "";
    $("saveBtn").textContent = "Save changes";
    $("cancelEdit").hidden = false; $("priceNote").hidden = false;
    $("pName").focus();
  }
  function resetForm() {
    editingId = null;
    $("formTitle").textContent = "New plan";
    $("planForm").reset();
    $("saveBtn").textContent = "Create plan";
    $("cancelEdit").hidden = true; $("priceNote").hidden = true;
  }

  async function save(e) {
    e.preventDefault();
    const body = {
      name: $("pName").value.trim(),
      price_cents: Math.round(parseFloat($("pPrice").value) * 100),
      billing_interval: $("pInterval").value,
      description: $("pDesc").value.trim() || null,
      perks: $("pPerks").value.trim() || null,
    };
    if (!body.name || !(body.price_cents >= 100)) { say("Name and a price of at least $1.00 are required.", true); return; }
    $("saveBtn").disabled = true;
    const r = editingId
      ? await api(`/api/admin/plans/${editingId}`, { method: "PUT", body: JSON.stringify(body) })
      : await api("/api/admin/plans", { method: "POST", body: JSON.stringify(body) });
    $("saveBtn").disabled = false;
    say(r.data.warning || r.data.note || r.data.error || (r.ok ? "Saved." : "Save failed."), !r.ok);
    if (r.ok) { resetForm(); load(); }
  }
})();
