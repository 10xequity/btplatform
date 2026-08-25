/* Boomtown Platform — Point of Sale (admin)
   File: web/assets/admin-pos.js · Version: v1.1 · Date: 2026-08-03 · Ships in: v0.82.0
   Sell (cart with server-side pricing — the client only sends product ids/qty; totals shown
   here are estimates and the server's math wins), Products, Promo Codes (discounts table,
   D-M15-1), Sponsors, Shifts, Insights (R-02 heatmap, POS sales, R-05 coverage).
   Uses BT_ADMIN helpers; errors always render through fail() (Back + Dashboard, rule 2).

   v1.1 — every row-action button here shipped as `class="ghost"` with no `btn`. `.ghost` is not a
   standalone class: app.css declares it as `.btn.ghost`, so these rendered as user-agent default
   controls — grey face, black text — in both themes, which is the owner's "many of the buttons
   text is not colored properly". They are `btn ghost sm` now: the shared compact variant, which is
   what a row action is. `button_vocabulary.test.mjs` fails if a modifier ever ships without `btn`. */
(async function () {
  const { api, guard, esc } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;
  const $ = (id) => document.getElementById(id);
  const fail = (msg) => window.BT_ADMIN.fail($("app"), msg);
  const money = (c) => "$" + ((c || 0) / 100).toFixed(2);
  const dollarsToCents = (v) => Math.round((+v || 0) * 100);
  const pctToBp = (v) => Math.round((+v || 0) * 100);
  const fmt = (s) => String(s || "").replace("T", " ").slice(0, 16);
  const localToSql = (v) => (v ? v.replace("T", " ") + ":00" : null);

  /* ---------- tabs ---------- */
  document.querySelectorAll(".pos-tab").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".pos-tab").forEach((t) => t.setAttribute("aria-selected", t === b));
      document.querySelectorAll(".pos-panel").forEach((p) => p.classList.remove("on"));
      $("panel-" + b.dataset.tab).classList.add("on");
      if (b.dataset.tab === "insights") loadInsights();
    });
  });

  /* ---------- sell ---------- */
  let PRODUCTS = [], CART = [], PROMO = null;

  async function loadProducts() {
    const r = await api("/api/admin/pos/products?all=1");
    if (!r.ok) return fail(r.data.error || "Could not load products.");
    PRODUCTS = r.data.products;
    $("sellProduct").innerHTML = PRODUCTS.filter((p) => p.active)
      .map((p) => `<option value="${p.id}">${esc(p.name)} · ${money(p.price_cents)}</option>`).join("")
      || `<option value="">No products yet; add one on the Products tab</option>`;
    renderProdList();
  }

  function cartEstimate() {
    const sub = CART.reduce((s, i) => s + i.qty * i.unit_price_cents, 0);
    let disc = 0;
    if (PROMO) disc = PROMO.kind === "percent" ? Math.round(sub * Math.min(100, PROMO.amount) / 100) : Math.min(sub, PROMO.amount);
    const tax = CART.reduce((s, i) => {
      const line = i.qty * i.unit_price_cents;
      const lineDisc = sub ? Math.round(disc * line / sub) : 0;
      return s + Math.round(Math.max(0, line - lineDisc) * (i.tax_rate_bp || 0) / 10000);
    }, 0);
    return sub - disc + tax;
  }

  function renderCart() {
    $("cart").innerHTML = CART.map((i, n) =>
      `<div class="pos-row"><span class="grow"><span class="k">${esc(i.label)}</span> <span class="v">× ${i.qty} · ${money(i.unit_price_cents)}${i.tax_rate_bp ? " +tax" : ""}</span></span>
       <button class="btn ghost sm" data-less="${n}" aria-label="Remove one ${esc(i.label)}">−</button>
       <button class="btn ghost sm" data-more="${n}" aria-label="Add one ${esc(i.label)}">+</button></div>`).join("")
      || `<div class="pos-hint">Nothing yet; add a product or a custom line.</div>`;
    $("cartTotal").textContent = money(cartEstimate());
    $("cart").querySelectorAll("[data-more]").forEach((b) => b.onclick = () => { CART[+b.dataset.more].qty++; renderCart(); });
    $("cart").querySelectorAll("[data-less]").forEach((b) => b.onclick = () => {
      const i = +b.dataset.less; if (--CART[i].qty <= 0) CART.splice(i, 1); renderCart();
    });
  }

  $("sellAdd").onclick = () => {
    const p = PRODUCTS.find((x) => x.id === +$("sellProduct").value);
    if (!p) return;
    const ex = CART.find((c) => c.product_id === p.id);
    if (ex) ex.qty++;
    else CART.push({ product_id: p.id, label: p.name, qty: 1, unit_price_cents: p.price_cents, tax_rate_bp: p.tax_rate_bp });
    renderCart();
  };
  $("sellAddCustom").onclick = () => {
    const label = $("sellCustomLabel").value.trim(), price = dollarsToCents($("sellCustomPrice").value);
    if (!label) { $("sellMsg").textContent = "Custom lines need a label."; return; }
    CART.push({ product_id: null, label, qty: 1, unit_price_cents: price, tax_rate_bp: 0 });
    $("sellCustomLabel").value = ""; $("sellCustomPrice").value = "";
    renderCart();
  };
  $("sellPromoCheck").onclick = async () => {
    const code = $("sellPromo").value.trim();
    PROMO = null; $("promoState").textContent = "";
    if (!code) { renderCart(); return; }
    const r = await api("/api/admin/pos/promo-check?code=" + encodeURIComponent(code));
    if (r.ok && r.data.ok) { PROMO = r.data.promo; $("promoState").innerHTML = `<span class="pos-chip ok">✓ ${esc(PROMO.code)} · ${PROMO.kind === "percent" ? PROMO.amount + "% off" : money(PROMO.amount) + " off"}</span>`; }
    else $("promoState").innerHTML = `<span class="pos-chip warn">${esc((r.data && (r.data.reason || r.data.error)) || "That code didn't check out.")}</span>`;
    renderCart();
  };
  $("sellClear").onclick = () => { CART = []; PROMO = null; $("sellPromo").value = ""; $("promoState").textContent = ""; renderCart(); };
  $("sellGo").onclick = async () => {
    if (!CART.length) { $("sellMsg").textContent = "Add at least one item first."; return; }
    $("sellGo").disabled = true;
    const r = await api("/api/admin/pos/sales", { method: "POST", body: JSON.stringify({
      items: CART.map((i) => i.product_id ? { product_id: i.product_id, qty: i.qty } : { label: i.label, qty: i.qty, unit_price_cents: i.unit_price_cents }),
      payment_method: $("sellMethod").value,
      discount_code: PROMO ? PROMO.code : undefined,
    }) });
    $("sellGo").disabled = false;
    if (!r.ok) { $("sellMsg").textContent = r.data.error || "Could not record the sale."; return; }
    $("sellMsg").innerHTML = `Recorded: ${money(r.data.total_cents)}${r.data.sandbox ? ' <span class="pos-chip warn">SANDBOX: no card was charged</span>' : ""}` +
      (r.data.stock_warnings.length ? ` <span class="pos-chip warn">Stock below zero: ${esc(r.data.stock_warnings.join(", "))}</span>` : "");
    $("sellClear").click();
    loadSales(); loadProducts();
  };

  async function loadSales() {
    const r = await api("/api/admin/pos/sales");
    if (!r.ok) return;
    $("salesList").innerHTML = r.data.sales.slice(0, 12).map((s) =>
      `<div class="pos-row"><span class="grow"><span class="k">${money(s.total_cents)}</span>
        <span class="v">${esc(s.contact_name || "Walk-in")} · ${s.item_count} item${s.item_count === 1 ? "" : "s"} · ${s.payment_method} · ${fmt(s.created_at)}</span></span>
       <span class="pill ${s.status}">${s.status}</span>
       ${s.status === "recorded" ? `<button class="btn ghost sm" data-void="${s.id}">Void</button>` : ""}</div>`).join("")
      || `<div class="pos-hint">No sales yet today.</div>`;
    $("salesList").querySelectorAll("[data-void]").forEach((b) => b.onclick = async () => {
      const reason = prompt("Why void this sale? (kept in the record)") || "";
      const r2 = await api(`/api/admin/pos/sales/${b.dataset.void}/void`, { method: "POST", body: JSON.stringify({ reason }) });
      if (!r2.ok) return fail(r2.data.error || "Could not void the sale.");
      loadSales(); loadProducts();
    });
  }

  /* ---------- products ---------- */
  let editProd = null;
  function renderProdList() {
    $("prodList").innerHTML = PRODUCTS.map((p) =>
      `<div class="pos-row"><span class="grow"><span class="k">${esc(p.name)}</span>
        <span class="v">${money(p.price_cents)}${p.tax_rate_bp ? " · " + (p.tax_rate_bp / 100).toFixed(2) + "% tax" : ""}${p.stock !== null && p.stock !== undefined ? " · stock " + p.stock : ""}${p.active ? "" : " · inactive"}</span></span>
       <button class="btn ghost sm" data-edit="${p.id}">Edit</button>
       <button class="btn ghost sm" data-toggle="${p.id}">${p.active ? "Deactivate" : "Activate"}</button></div>`).join("")
      || `<div class="pos-hint">No products yet.</div>`;
    $("prodList").querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
      const p = PRODUCTS.find((x) => x.id === +b.dataset.edit); editProd = p.id;
      $("prodFormTitle").textContent = "Edit product"; $("prodCancel").hidden = false;
      $("prodName").value = p.name; $("prodPrice").value = (p.price_cents / 100).toFixed(2);
      $("prodTax").value = (p.tax_rate_bp / 100).toFixed(2); $("prodStock").value = p.stock ?? "";
    });
    $("prodList").querySelectorAll("[data-toggle]").forEach((b) => b.onclick = async () => {
      const p = PRODUCTS.find((x) => x.id === +b.dataset.toggle);
      const r = await api(`/api/admin/pos/products/${p.id}`, { method: "POST", body: JSON.stringify({
        name: p.name, price_cents: p.price_cents, tax_rate_bp: p.tax_rate_bp, stock: p.stock, active: !p.active }) });
      if (!r.ok) return fail(r.data.error || "Could not update the product.");
      loadProducts();
    });
  }
  $("prodCancel").onclick = () => { editProd = null; $("prodFormTitle").textContent = "Add a product"; $("prodCancel").hidden = true;
    ["prodName", "prodPrice", "prodStock"].forEach((i) => $(i).value = ""); $("prodTax").value = "0"; };
  $("prodSave").onclick = async () => {
    const body = { name: $("prodName").value, price_cents: dollarsToCents($("prodPrice").value),
      tax_rate_bp: pctToBp($("prodTax").value), stock: $("prodStock").value === "" ? null : +$("prodStock").value };
    const r = await api("/api/admin/pos/products" + (editProd ? "/" + editProd : ""), { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { $("prodMsg").textContent = r.data.error || "Could not save the product."; return; }
    $("prodMsg").textContent = "Saved."; $("prodCancel").click(); loadProducts();
  };

  /* ---------- promo codes ---------- */
  let editPromo = null;
  async function loadPromos() {
    const r = await api("/api/admin/pos/promos");
    if (!r.ok) return fail(r.data.error || "Could not load promo codes.");
    $("promoList").innerHTML = r.data.promos.map((p) =>
      `<div class="pos-row"><span class="grow"><span class="k">${esc(p.code)}</span>
        <span class="v">${p.kind === "percent" ? p.amount + "% off" : money(p.amount) + " off"} · used ${p.used_count}${p.usage_cap != null ? "/" + p.usage_cap : ""}${p.expires_at ? " · until " + fmt(p.expires_at) : ""}${p.active ? "" : " · inactive"}</span></span>
       <button class="btn ghost sm" data-pedit="${p.id}">Edit</button>
       <button class="btn ghost sm" data-pdel="${p.id}">Delete</button></div>`).join("")
      || `<div class="pos-hint">No codes yet.</div>`;
    $("promoList").querySelectorAll("[data-pedit]").forEach((b) => b.onclick = () => {
      const p = r.data.promos.find((x) => x.id === +b.dataset.pedit); editPromo = p.id;
      $("promoFormTitle").textContent = "Edit promo code"; $("pcCancel").hidden = false;
      $("pcCode").value = p.code; $("pcKind").value = p.kind;
      $("pcAmount").value = p.kind === "fixed" ? (p.amount / 100).toFixed(2) : p.amount;
      $("pcCap").value = p.usage_cap ?? "";
      $("pcStart").value = p.starts_at ? p.starts_at.replace(" ", "T").slice(0, 16) : "";
      $("pcEnd").value = p.expires_at ? p.expires_at.replace(" ", "T").slice(0, 16) : "";
    });
    $("promoList").querySelectorAll("[data-pdel]").forEach((b) => b.onclick = async () => {
      if (!confirm("Delete this code? Past sales keep their record.")) return;
      const r2 = await api(`/api/admin/pos/promos/${b.dataset.pdel}`, { method: "POST", body: JSON.stringify({ delete: true }) });
      if (!r2.ok) return fail(r2.data.error || "Could not delete the code.");
      loadPromos();
    });
  }
  $("pcCancel").onclick = () => { editPromo = null; $("promoFormTitle").textContent = "Add a promo code"; $("pcCancel").hidden = true;
    ["pcCode", "pcAmount", "pcCap", "pcStart", "pcEnd"].forEach((i) => $(i).value = ""); };
  $("pcSave").onclick = async () => {
    const kind = $("pcKind").value;
    const body = { code: $("pcCode").value, kind,
      amount: kind === "fixed" ? dollarsToCents($("pcAmount").value) : Math.round(+$("pcAmount").value),
      usage_cap: $("pcCap").value === "" ? null : +$("pcCap").value,
      starts_at: localToSql($("pcStart").value), expires_at: localToSql($("pcEnd").value) };
    const r = await api("/api/admin/pos/promos" + (editPromo ? "/" + editPromo : ""), { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { $("pcMsg").textContent = r.data.error || "Could not save the code."; return; }
    $("pcMsg").textContent = "Saved."; $("pcCancel").click(); loadPromos();
  };

  /* ---------- sponsors ---------- */
  let editSp = null;
  async function loadSponsors() {
    const r = await api("/api/admin/pos/sponsors");
    if (!r.ok) return fail(r.data.error || "Could not load sponsors.");
    $("spList").innerHTML = r.data.sponsors.map((s) =>
      `<div class="pos-row"><span class="grow"><span class="k">${esc(s.name)}</span>
        <span class="v">${esc(s.placement)}${s.starts_at ? " · from " + fmt(s.starts_at) : ""}${s.ends_at ? " · until " + fmt(s.ends_at) : ""}${s.active ? "" : " · inactive"}</span></span>
       <button class="btn ghost sm" data-sedit="${s.id}">Edit</button>
       <button class="btn ghost sm" data-sdel="${s.id}">Delete</button></div>`).join("")
      || `<div class="pos-hint">No sponsors yet.</div>`;
    $("spList").querySelectorAll("[data-sedit]").forEach((b) => b.onclick = () => {
      const s = r.data.sponsors.find((x) => x.id === +b.dataset.sedit); editSp = s.id;
      $("spFormTitle").textContent = "Edit sponsor"; $("spCancel").hidden = false;
      $("spName").value = s.name; $("spLogo").value = s.logo_url || ""; $("spLink").value = s.link_url || "";
      $("spPlace").value = s.placement;
      $("spStart").value = s.starts_at ? s.starts_at.replace(" ", "T").slice(0, 16) : "";
      $("spEnd").value = s.ends_at ? s.ends_at.replace(" ", "T").slice(0, 16) : "";
    });
    $("spList").querySelectorAll("[data-sdel]").forEach((b) => b.onclick = async () => {
      if (!confirm("Delete this sponsor?")) return;
      const r2 = await api(`/api/admin/pos/sponsors/${b.dataset.sdel}`, { method: "POST", body: JSON.stringify({ delete: true }) });
      if (!r2.ok) return fail(r2.data.error || "Could not delete the sponsor.");
      loadSponsors();
    });
  }
  $("spCancel").onclick = () => { editSp = null; $("spFormTitle").textContent = "Add a sponsor"; $("spCancel").hidden = true;
    ["spName", "spLogo", "spLink", "spStart", "spEnd"].forEach((i) => $(i).value = ""); };
  $("spSave").onclick = async () => {
    const body = { name: $("spName").value, logo_url: $("spLogo").value || null, link_url: $("spLink").value || null,
      placement: $("spPlace").value, starts_at: localToSql($("spStart").value), ends_at: localToSql($("spEnd").value) };
    const r = await api("/api/admin/pos/sponsors" + (editSp ? "/" + editSp : ""), { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { $("spMsg").textContent = r.data.error || "Could not save the sponsor."; return; }
    $("spMsg").textContent = "Saved."; $("spCancel").click(); loadSponsors();
  };

  /* ---------- shifts ---------- */
  let editSh = null;
  const dayISO = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
  async function loadShifts() {
    const r = await api(`/api/admin/pos/shifts?from=${dayISO(0)}&to=${dayISO(14)}`);
    if (!r.ok) return fail(r.data.error || "Could not load shifts.");
    $("shList").innerHTML = r.data.shifts.map((s) =>
      `<div class="pos-row"><span class="grow"><span class="k">${esc(s.who || "—")}</span>
        <span class="v">${s.role_label ? esc(s.role_label) + " · " : ""}${fmt(s.starts_at)} → ${fmt(s.ends_at)}${s.note ? " · " + esc(s.note) : ""}</span></span>
       <button class="btn ghost sm" data-hedit="${s.id}">Edit</button>
       <button class="btn ghost sm" data-hdel="${s.id}">Delete</button></div>`).join("")
      || `<div class="pos-hint">No shifts in the next two weeks.</div>`;
    $("shList").querySelectorAll("[data-hedit]").forEach((b) => b.onclick = () => {
      const s = r.data.shifts.find((x) => x.id === +b.dataset.hedit); editSh = s.id;
      $("shFormTitle").textContent = "Edit shift"; $("shCancel").hidden = false;
      $("shWho").value = s.who || ""; $("shRole").value = s.role_label || "";
      $("shStart").value = s.starts_at.replace(" ", "T").slice(0, 16);
      $("shEnd").value = s.ends_at.replace(" ", "T").slice(0, 16);
      $("shNote").value = s.note || "";
    });
    $("shList").querySelectorAll("[data-hdel]").forEach((b) => b.onclick = async () => {
      if (!confirm("Delete this shift?")) return;
      const r2 = await api(`/api/admin/pos/shifts/${b.dataset.hdel}`, { method: "POST", body: JSON.stringify({ delete: true }) });
      if (!r2.ok) return fail(r2.data.error || "Could not delete the shift.");
      loadShifts();
    });
  }
  $("shCancel").onclick = () => { editSh = null; $("shFormTitle").textContent = "Add a shift"; $("shCancel").hidden = true;
    ["shWho", "shRole", "shStart", "shEnd", "shNote"].forEach((i) => $(i).value = ""); };
  $("shSave").onclick = async () => {
    const body = { name_snapshot: $("shWho").value, role_label: $("shRole").value,
      starts_at: localToSql($("shStart").value), ends_at: localToSql($("shEnd").value), note: $("shNote").value };
    const r = await api("/api/admin/pos/shifts" + (editSh ? "/" + editSh : ""), { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { $("shMsg").textContent = r.data.error || "Could not save the shift."; return; }
    $("shMsg").textContent = "Saved."; $("shCancel").click(); loadShifts();
  };

  /* ---------- insights ---------- */
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let insightsLoaded = false;
  async function loadInsights() {
    if (insightsLoaded) return;
    insightsLoaded = true;
    const hm = await api("/api/admin/reports/heatmap?weeks=8");
    if (hm.ok) {
      const { grid, max } = hm.data;
      const H0 = 6, H1 = 23; // show 6 AM–midnight
      let html = `<div class="lab"></div>` + Array.from({ length: H1 - H0 + 1 }, (_, i) =>
        `<div class="hlab">${(H0 + i) % 12 || 12}${H0 + i < 12 ? "a" : "p"}</div>`).join("");
      for (let d = 0; d < 7; d++) {
        html += `<div class="lab">${DAYS[d]}</div>`;
        for (let h = H0; h <= H1; h++) {
          const n = grid[d][h], op = max ? (0.12 + 0.88 * n / max) : 0;
          html += `<div class="cell" title="${DAYS[d]} ${h}:00 · ${n} check-in${n === 1 ? "" : "s"}" style="${n ? `background: var(--primary); opacity:${op.toFixed(2)};` : ""}"></div>`;
        }
      }
      $("heatmap").innerHTML = html;
    }
    const ps = await api(`/api/admin/reports/pos-sales?from=${dayISO(-30)}&to=${dayISO(0)}`);
    if (ps.ok) {
      const totalC = ps.data.by_day.reduce((s, d) => s + d.total_cents, 0);
      $("insSales").innerHTML =
        `<div class="pos-row"><span class="k grow">Total</span><span class="pos-total">${money(totalC)}</span></div>` +
        (ps.data.by_product.slice(0, 8).map((p) =>
          `<div class="pos-row"><span class="grow">${esc(p.label)} <span class="v">× ${p.qty}</span></span><span class="k">${money(p.total_cents)}</span></div>`).join("")
          || `<div class="pos-hint">No register sales in the last 30 days.</div>`);
    }
    const sc = await api(`/api/admin/reports/shift-coverage?from=${dayISO(0)}&to=${dayISO(14)}`);
    if (sc.ok) {
      const evByDay = Object.fromEntries(sc.data.events.map((e) => [e.day, e.events]));
      const shByDay = Object.fromEntries(sc.data.shifts.map((s) => [s.day, s.shifts]));
      const days = [...new Set([...Object.keys(evByDay), ...Object.keys(shByDay)])].sort();
      $("insCover").innerHTML = days.map((d) => {
        const ev = evByDay[d] || 0, sh = shByDay[d] || 0;
        const gap = ev > 0 && sh === 0;
        return `<div class="pos-row"><span class="k grow">${d}</span>
          <span class="v">${ev} event${ev === 1 ? "" : "s"} · ${sh} shift${sh === 1 ? "" : "s"}</span>
          ${gap ? '<span class="pos-chip warn">No one scheduled</span>' : ""}</div>`;
      }).join("") || `<div class="pos-hint">Nothing on the calendar in the next two weeks.</div>`;
    }
  }

  /* ---------- boot ---------- */
  await loadProducts();
  renderCart();
  loadSales(); loadPromos(); loadSponsors(); loadShifts();
})();
