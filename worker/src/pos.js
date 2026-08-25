/* Boomtown Platform — POS-lite, Promo Codes, Sponsors, Staff Shifts (M15)
   File: worker/src/pos.js · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.18.0
   Products CRUD → create-sale (server-priced, per-line proportional discount, bp tax,
   stock decrement with negative allowed + amber flag) → void (restock, un-count promo).
   Promo codes back onto the day-one `discounts` table (D-M15-1: +active/starts_at/expires_at
   in migration 0012 — one source of truth, no new table). Sponsors: admin CRUD + public
   GET /api/sponsors. Shifts: admin CRUD. Payments: cash / comp / square — square records
   SANDBOX (square_payment_id NULL, note marked) until owner flips the Square rule; NO real
   Square call is made here (standing rule 1). All admin routes requireStaff; every mutation
   audited. Test rows: keep to contact ids 90000–90999 and wipe (standing rule 6). */

let json, audit, isStaff, requireStaff;
export function wirePos(h) { ({ json, audit, isStaff, requireStaff } = h); }

export async function posRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;
  /* public */
  if (p === "/api/sponsors" && m === "GET") return publicSponsors(env, ctx, url);
  if (!p.startsWith("/api/admin/pos/")) return null;
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  /* products */
  if (p === "/api/admin/pos/products" && m === "GET") return listProducts(env, ctx, url);
  if (p === "/api/admin/pos/products" && m === "POST") return saveProduct(request, env, ctx, null);
  if ((x = p.match(/^\/api\/admin\/pos\/products\/(\d+)$/)) && m === "POST") return saveProduct(request, env, ctx, +x[1]);
  /* sales */
  if (p === "/api/admin/pos/sales" && m === "GET") return listSales(env, ctx, url);
  if (p === "/api/admin/pos/sales" && m === "POST") return createSale(request, env, ctx);
  if ((x = p.match(/^\/api\/admin\/pos\/sales\/(\d+)$/)) && m === "GET") return saleDetail(env, ctx, +x[1]);
  if ((x = p.match(/^\/api\/admin\/pos\/sales\/(\d+)\/void$/)) && m === "POST") return voidSale(request, env, ctx, +x[1]);
  /* promo codes (discounts table) */
  if (p === "/api/admin/pos/promos" && m === "GET") return listPromos(env, ctx);
  if (p === "/api/admin/pos/promos" && m === "POST") return savePromo(request, env, ctx, null);
  if ((x = p.match(/^\/api\/admin\/pos\/promos\/(\d+)$/)) && m === "POST") return savePromo(request, env, ctx, +x[1]);
  if (p === "/api/admin/pos/promo-check" && m === "GET") return promoCheck(env, ctx, url);
  /* sponsors */
  if (p === "/api/admin/pos/sponsors" && m === "GET") return listSponsors(env, ctx);
  if (p === "/api/admin/pos/sponsors" && m === "POST") return saveSponsor(request, env, ctx, null);
  if ((x = p.match(/^\/api\/admin\/pos\/sponsors\/(\d+)$/)) && m === "POST") return saveSponsor(request, env, ctx, +x[1]);
  /* staff shifts */
  if (p === "/api/admin/pos/shifts" && m === "GET") return listShifts(env, ctx, url);
  if (p === "/api/admin/pos/shifts" && m === "POST") return saveShift(request, env, ctx, null);
  if ((x = p.match(/^\/api\/admin\/pos\/shifts\/(\d+)$/)) && m === "POST") return saveShift(request, env, ctx, +x[1]);
  return null;
}

/* ================= pure functions (unit-tested) ================= */

/** Validate a promo row against now (ISO string). Returns { ok } or { ok:false, reason }. */
export function validatePromo(d, nowIso) {
  if (!d || d.deleted_at) return { ok: false, reason: "Code not found." };
  if (!d.active) return { ok: false, reason: "Code is inactive." };
  if (d.starts_at && nowIso < d.starts_at) return { ok: false, reason: "Code isn't active yet." };
  if (d.expires_at && nowIso > d.expires_at) return { ok: false, reason: "Code has expired." };
  if (d.usage_cap != null && d.used_count >= d.usage_cap) return { ok: false, reason: "Code has reached its usage limit." };
  return { ok: true };
}

/** Compute sale totals. items: [{qty, unit_price_cents, tax_rate_bp}]. promo: {kind,amount}|null.
    Discount is capped at subtotal and spread proportionally per line (last line absorbs
    rounding remainder) BEFORE tax, so tax is charged on what was actually paid. */
export function computeSaleTotals(items, promo) {
  const lines = items.map(it => ({
    ...it,
    line_total_cents: Math.round(it.qty * it.unit_price_cents),
  }));
  const subtotal = lines.reduce((s, l) => s + l.line_total_cents, 0);
  let discount = 0;
  if (promo) {
    discount = promo.kind === "percent"
      ? Math.round(subtotal * Math.min(100, Math.max(0, promo.amount)) / 100)
      : Math.min(subtotal, Math.max(0, promo.amount));
  }
  let spread = 0, tax = 0;
  lines.forEach((l, i) => {
    let lineDisc;
    if (i === lines.length - 1) lineDisc = discount - spread;              // remainder
    else { lineDisc = subtotal ? Math.round(discount * l.line_total_cents / subtotal) : 0; spread += lineDisc; }
    const taxable = Math.max(0, l.line_total_cents - lineDisc);
    tax += Math.round(taxable * (l.tax_rate_bp || 0) / 10000);
  });
  return { subtotal_cents: subtotal, discount_cents: discount, tax_cents: tax,
           total_cents: subtotal - discount + tax };
}

/* ================= products ================= */

async function listProducts(env, ctx, url) {
  const all = url.searchParams.get("all") === "1";
  const rows = (await env.DB.prepare(
    `SELECT id, name, price_cents, tax_rate_bp, stock, active, sort FROM products
     WHERE org_id=?1 AND deleted_at IS NULL ${all ? "" : "AND active=1"} ORDER BY sort, name`
  ).bind(ctx.orgId).all()).results;
  return json({ products: rows });
}

async function saveProduct(request, env, ctx, id) {
  const b = await request.json().catch(() => ({}));
  if (b.delete && id) {
    await env.DB.prepare("UPDATE products SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2")
      .bind(id, ctx.orgId).run();
    await audit(env, ctx, "pos.product_delete", "products", id, {});
    return json({ ok: true });
  }
  const name = String(b.name || "").trim();
  const price = Math.round(+b.price_cents);
  if (!name || !(price >= 0)) return json({ error: "A product needs a name and a price of $0.00 or more." }, 400);
  const tax = Math.max(0, Math.round(+b.tax_rate_bp || 0));
  const stock = (b.stock === null || b.stock === undefined || b.stock === "") ? null : Math.round(+b.stock);
  const active = b.active === false ? 0 : 1;
  const sort = Math.round(+b.sort || 0);
  if (id) {
    await env.DB.prepare(
      `UPDATE products SET name=?1, price_cents=?2, tax_rate_bp=?3, stock=?4, active=?5, sort=?6,
       updated_at=datetime('now') WHERE id=?7 AND org_id=?8 AND deleted_at IS NULL`
    ).bind(name, price, tax, stock, active, sort, id, ctx.orgId).run();
    await audit(env, ctx, "pos.product_update", "products", id, { name });
    return json({ ok: true, id });
  }
  const ins = await env.DB.prepare(
    `INSERT INTO products (org_id, name, price_cents, tax_rate_bp, stock, active, sort)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`
  ).bind(ctx.orgId, name, price, tax, stock, active, sort).run();
  await audit(env, ctx, "pos.product_create", "products", ins.meta.last_row_id, { name });
  return json({ ok: true, id: ins.meta.last_row_id });
}

/* ================= sales ================= */

async function createSale(request, env, ctx) {
  const b = await request.json().catch(() => ({}));
  const method = ["cash", "square", "comp"].includes(b.payment_method) ? b.payment_method : null;
  if (!method) return json({ error: "Pick a payment method: cash, square, or comp." }, 400);
  const reqItems = Array.isArray(b.items) ? b.items.slice(0, 50) : [];
  if (!reqItems.length) return json({ error: "Add at least one item to the sale." }, 400);

  /* server-side pricing: product lines are re-priced from the products table;
     custom lines need an explicit label + unit price. */
  const items = [];
  for (const it of reqItems) {
    const qty = Math.max(1, Math.min(999, Math.round(+it.qty || 1)));
    if (it.product_id) {
      const prod = await env.DB.prepare(
        "SELECT id, name, price_cents, tax_rate_bp, stock FROM products WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
      ).bind(+it.product_id, ctx.orgId).first();
      if (!prod) return json({ error: "One of the products no longer exists. Refresh and try again." }, 400);
      items.push({ product_id: prod.id, label: prod.name, qty, unit_price_cents: prod.price_cents,
                   tax_rate_bp: prod.tax_rate_bp, stock: prod.stock });
    } else {
      const label = String(it.label || "").trim();
      const price = Math.round(+it.unit_price_cents);
      if (!label || !(price >= 0)) return json({ error: "Custom line items need a label and a price." }, 400);
      items.push({ product_id: null, label, qty, unit_price_cents: price,
                   tax_rate_bp: Math.max(0, Math.round(+it.tax_rate_bp || 0)), stock: null });
    }
  }

  /* promo */
  let promo = null;
  if (b.discount_code) {
    promo = await env.DB.prepare(
      "SELECT * FROM discounts WHERE org_id=?1 AND code=?2 COLLATE NOCASE AND deleted_at IS NULL"
    ).bind(ctx.orgId, String(b.discount_code).trim()).first();
    const v = validatePromo(promo, new Date().toISOString().slice(0, 19).replace("T", " "));
    if (!v.ok) return json({ error: v.reason }, 400);
  }

  const t = computeSaleTotals(items, promo);
  if (t.total_cents < 0) return json({ error: "Total can't be negative." }, 400);

  const contactId = b.contact_id ? +b.contact_id : null;
  const ins = await env.DB.prepare(
    `INSERT INTO sales (org_id, contact_id, subtotal_cents, discount_cents, discount_id, tax_cents,
      total_cents, payment_method, square_payment_id, note, created_by)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9,?10)`
  ).bind(ctx.orgId, contactId, t.subtotal_cents, t.discount_cents, promo ? promo.id : null,
         t.tax_cents, t.total_cents, method,
         method === "square" ? "[SANDBOX] recorded without a live Square charge" : (b.note || null),
         ctx.userId).run();
  const saleId = ins.meta.last_row_id;

  const lowStock = [];
  for (const it of items) {
    const line = Math.round(it.qty * it.unit_price_cents);
    await env.DB.prepare(
      `INSERT INTO sale_items (sale_id, product_id, label, qty, unit_price_cents, tax_rate_bp, line_total_cents)
       VALUES (?1,?2,?3,?4,?5,?6,?7)`
    ).bind(saleId, it.product_id, it.label, it.qty, it.unit_price_cents, it.tax_rate_bp, line).run();
    if (it.product_id && it.stock !== null && it.stock !== undefined) {
      await env.DB.prepare("UPDATE products SET stock=stock-?1, updated_at=datetime('now') WHERE id=?2")
        .bind(it.qty, it.product_id).run();
      if (it.stock - it.qty < 0) lowStock.push(it.label);
    }
  }
  if (promo) {
    await env.DB.prepare("UPDATE discounts SET used_count=used_count+1, updated_at=datetime('now') WHERE id=?1")
      .bind(promo.id).run();
  }
  await audit(env, ctx, "pos.sale", "sales", saleId,
    { total: t.total_cents, method, items: items.length, promo: promo ? promo.code : null });
  return json({ ok: true, id: saleId, ...t, sandbox: method === "square", stock_warnings: lowStock });
}

async function listSales(env, ctx, url) {
  const from = url.searchParams.get("from") || "0000";
  const to = url.searchParams.get("to") || "9999";
  const rows = (await env.DB.prepare(
    `SELECT s.id, s.created_at, s.total_cents, s.payment_method, s.status, s.contact_id,
            c.full_name AS contact_name,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
     FROM sales s LEFT JOIN contacts c ON c.id = s.contact_id
     WHERE s.org_id=?1 AND date(s.created_at) BETWEEN ?2 AND ?3
     ORDER BY s.created_at DESC LIMIT 200`
  ).bind(ctx.orgId, from, to).all()).results;
  return json({ sales: rows });
}

async function saleDetail(env, ctx, id) {
  const sale = await env.DB.prepare(
    `SELECT s.*, c.full_name AS contact_name FROM sales s
     LEFT JOIN contacts c ON c.id = s.contact_id WHERE s.id=?1 AND s.org_id=?2`
  ).bind(id, ctx.orgId).first();
  if (!sale) return json({ error: "Sale not found." }, 404);
  const items = (await env.DB.prepare("SELECT * FROM sale_items WHERE sale_id=?1").bind(id).all()).results;
  return json({ sale, items });
}

async function voidSale(request, env, ctx, id) {
  const b = await request.json().catch(() => ({}));
  const sale = await env.DB.prepare("SELECT * FROM sales WHERE id=?1 AND org_id=?2").bind(id, ctx.orgId).first();
  if (!sale) return json({ error: "Sale not found." }, 404);
  if (sale.status === "voided") return json({ error: "This sale is already voided." }, 400);
  await env.DB.prepare(
    "UPDATE sales SET status='voided', voided_at=datetime('now'), void_reason=?1 WHERE id=?2"
  ).bind(String(b.reason || "").slice(0, 300) || null, id).run();
  /* restock tracked products */
  const items = (await env.DB.prepare(
    "SELECT product_id, qty FROM sale_items WHERE sale_id=?1 AND product_id IS NOT NULL"
  ).bind(id).all()).results;
  for (const it of items) {
    await env.DB.prepare(
      "UPDATE products SET stock=stock+?1, updated_at=datetime('now') WHERE id=?2 AND stock IS NOT NULL"
    ).bind(it.qty, it.product_id).run();
  }
  if (sale.discount_id) {
    await env.DB.prepare(
      "UPDATE discounts SET used_count=MAX(0, used_count-1), updated_at=datetime('now') WHERE id=?1"
    ).bind(sale.discount_id).run();
  }
  await audit(env, ctx, "pos.void", "sales", id, { reason: b.reason || null });
  return json({ ok: true });
}

/* ================= promo codes (discounts table, D-M15-1) ================= */

async function listPromos(env, ctx) {
  const rows = (await env.DB.prepare(
    `SELECT id, code, kind, amount, usage_cap, used_count, active, starts_at, expires_at
     FROM discounts WHERE org_id=?1 AND deleted_at IS NULL ORDER BY active DESC, code`
  ).bind(ctx.orgId).all()).results;
  return json({ promos: rows });
}

async function savePromo(request, env, ctx, id) {
  const b = await request.json().catch(() => ({}));
  if (b.delete && id) {
    await env.DB.prepare("UPDATE discounts SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2")
      .bind(id, ctx.orgId).run();
    await audit(env, ctx, "pos.promo_delete", "discounts", id, {});
    return json({ ok: true });
  }
  const code = String(b.code || "").trim().toUpperCase().replace(/\s+/g, "");
  const kind = ["percent", "fixed"].includes(b.kind) ? b.kind : null;
  const amount = Math.round(+b.amount);
  if (!code || !kind || !(amount > 0)) return json({ error: "A code needs a name, a type, and an amount above zero." }, 400);
  if (kind === "percent" && amount > 100) return json({ error: "Percent discounts can't exceed 100." }, 400);
  const cap = (b.usage_cap === null || b.usage_cap === undefined || b.usage_cap === "") ? null : Math.max(0, Math.round(+b.usage_cap));
  const active = b.active === false ? 0 : 1;
  const starts = b.starts_at || null, expires = b.expires_at || null;
  const dupe = await env.DB.prepare(
    "SELECT id FROM discounts WHERE org_id=?1 AND code=?2 COLLATE NOCASE AND deleted_at IS NULL AND id<>?3"
  ).bind(ctx.orgId, code, id || 0).first();
  if (dupe) return json({ error: "That code already exists." }, 400);
  if (id) {
    await env.DB.prepare(
      `UPDATE discounts SET code=?1, kind=?2, amount=?3, usage_cap=?4, active=?5, starts_at=?6,
       expires_at=?7, updated_at=datetime('now') WHERE id=?8 AND org_id=?9 AND deleted_at IS NULL`
    ).bind(code, kind, amount, cap, active, starts, expires, id, ctx.orgId).run();
    await audit(env, ctx, "pos.promo_update", "discounts", id, { code });
    return json({ ok: true, id });
  }
  const ins = await env.DB.prepare(
    `INSERT INTO discounts (org_id, code, kind, amount, usage_cap, active, starts_at, expires_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
  ).bind(ctx.orgId, code, kind, amount, cap, active, starts, expires).run();
  await audit(env, ctx, "pos.promo_create", "discounts", ins.meta.last_row_id, { code });
  return json({ ok: true, id: ins.meta.last_row_id });
}

async function promoCheck(env, ctx, url) {
  const code = String(url.searchParams.get("code") || "").trim();
  const d = await env.DB.prepare(
    "SELECT * FROM discounts WHERE org_id=?1 AND code=?2 COLLATE NOCASE AND deleted_at IS NULL"
  ).bind(ctx.orgId, code).first();
  const v = validatePromo(d, new Date().toISOString().slice(0, 19).replace("T", " "));
  if (!v.ok) return json({ ok: false, reason: v.reason });
  return json({ ok: true, promo: { id: d.id, code: d.code, kind: d.kind, amount: d.amount } });
}

/* ================= sponsors ================= */

async function publicSponsors(env, ctx, url) {
  const placement = String(url.searchParams.get("placement") || "home").slice(0, 40);
  const rows = (await env.DB.prepare(
    `SELECT name, logo_url, link_url FROM sponsors
     WHERE org_id=?1 AND placement=?2 AND active=1 AND deleted_at IS NULL
       AND (starts_at IS NULL OR starts_at <= datetime('now'))
       AND (ends_at IS NULL OR ends_at >= datetime('now'))
     ORDER BY sort, name`
  ).bind(ctx.orgId, placement).all()).results;
  return json({ sponsors: rows });
}

async function listSponsors(env, ctx) {
  const rows = (await env.DB.prepare(
    `SELECT id, name, logo_url, link_url, placement, active, sort, starts_at, ends_at
     FROM sponsors WHERE org_id=?1 AND deleted_at IS NULL ORDER BY placement, sort, name`
  ).bind(ctx.orgId).all()).results;
  return json({ sponsors: rows });
}

async function saveSponsor(request, env, ctx, id) {
  const b = await request.json().catch(() => ({}));
  if (b.delete && id) {
    await env.DB.prepare("UPDATE sponsors SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2")
      .bind(id, ctx.orgId).run();
    await audit(env, ctx, "pos.sponsor_delete", "sponsors", id, {});
    return json({ ok: true });
  }
  const name = String(b.name || "").trim();
  if (!name) return json({ error: "A sponsor needs a name." }, 400);
  const vals = [name, b.logo_url || null, b.link_url || null,
    String(b.placement || "home").slice(0, 40), b.active === false ? 0 : 1,
    Math.round(+b.sort || 0), b.starts_at || null, b.ends_at || null];
  if (id) {
    await env.DB.prepare(
      `UPDATE sponsors SET name=?1, logo_url=?2, link_url=?3, placement=?4, active=?5, sort=?6,
       starts_at=?7, ends_at=?8, updated_at=datetime('now') WHERE id=?9 AND org_id=?10 AND deleted_at IS NULL`
    ).bind(...vals, id, ctx.orgId).run();
    await audit(env, ctx, "pos.sponsor_update", "sponsors", id, { name });
    return json({ ok: true, id });
  }
  const ins = await env.DB.prepare(
    `INSERT INTO sponsors (org_id, name, logo_url, link_url, placement, active, sort, starts_at, ends_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
  ).bind(ctx.orgId, ...vals).run();
  await audit(env, ctx, "pos.sponsor_create", "sponsors", ins.meta.last_row_id, { name });
  return json({ ok: true, id: ins.meta.last_row_id });
}

/* ================= staff shifts ================= */

async function listShifts(env, ctx, url) {
  const from = url.searchParams.get("from") || "0000";
  const to = url.searchParams.get("to") || "9999";
  const rows = (await env.DB.prepare(
    `SELECT sh.id, sh.user_id, COALESCE(u.display_name, sh.name_snapshot, u.email) AS who,
            sh.role_label, sh.starts_at, sh.ends_at, sh.note
     FROM staff_shifts sh LEFT JOIN users u ON u.id = sh.user_id
     WHERE sh.org_id=?1 AND sh.deleted_at IS NULL AND date(sh.starts_at) BETWEEN ?2 AND ?3
     ORDER BY sh.starts_at`
  ).bind(ctx.orgId, from, to).all()).results;
  return json({ shifts: rows });
}

async function saveShift(request, env, ctx, id) {
  const b = await request.json().catch(() => ({}));
  if (b.delete && id) {
    await env.DB.prepare("UPDATE staff_shifts SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2")
      .bind(id, ctx.orgId).run();
    await audit(env, ctx, "pos.shift_delete", "staff_shifts", id, {});
    return json({ ok: true });
  }
  const starts = String(b.starts_at || "").trim(), ends = String(b.ends_at || "").trim();
  if (!starts || !ends || ends <= starts) return json({ error: "A shift needs a start and an end, and the end must be after the start." }, 400);
  const userId = b.user_id ? +b.user_id : null;
  const nameSnap = userId ? null : (String(b.name_snapshot || "").trim() || null);
  if (!userId && !nameSnap) return json({ error: "Pick a staff member or type a name." }, 400);
  const vals = [userId, nameSnap, String(b.role_label || "").slice(0, 60) || null, starts, ends,
    String(b.note || "").slice(0, 300) || null];
  if (id) {
    await env.DB.prepare(
      `UPDATE staff_shifts SET user_id=?1, name_snapshot=?2, role_label=?3, starts_at=?4, ends_at=?5,
       note=?6, updated_at=datetime('now') WHERE id=?7 AND org_id=?8 AND deleted_at IS NULL`
    ).bind(...vals, id, ctx.orgId).run();
    await audit(env, ctx, "pos.shift_update", "staff_shifts", id, {});
    return json({ ok: true, id });
  }
  const ins = await env.DB.prepare(
    `INSERT INTO staff_shifts (org_id, user_id, name_snapshot, role_label, starts_at, ends_at, note)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`
  ).bind(ctx.orgId, ...vals).run();
  await audit(env, ctx, "pos.shift_create", "staff_shifts", ins.meta.last_row_id, {});
  return json({ ok: true, id: ins.meta.last_row_id });
}
