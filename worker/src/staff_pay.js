/**
 * Boomtown Platform — Staff / coach rates and shift pay
 * File: worker/src/staff_pay.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.58.0
 * Requires migration 0035 (staff_rates + 8 pay columns on staff_shifts).
 *
 * Owner requirement (2026-08-03): "assign staff/coaches with variable pay rates. We can add a
 * time and payroll function in a future build." This is the foundation that future build needs:
 * who is assigned, at what rate, on what basis, for how long — and what that came to.
 *
 * THE RATE CARD AND THE SHIFT ARE SEPARATE ON PURPOSE. `staff_rates` is what a person is paid
 * *going forward*; the shift stores what they were *actually* paid, frozen the moment it is
 * approved. Raise a coach's rate in September and August's approved shifts must not silently
 * restate — that is the same discipline as pinning a waiver's version to a signature, applied to
 * money. An unapproved shift recomputes freely; an approved one never moves again.
 *
 * ONE PERSON CAN HAVE SEVERAL RATES. A rate row may carry a `role_label`, so the same coach is
 * paid one rate for coaching and another for reffing. Lookup prefers the role-specific rate and
 * falls back to the person's general rate. Rates are date-bounded, so a raise is a new row, not
 * an edit — the old number stays readable next to the shifts it produced.
 *
 * NO PAYROLL EXPORT, NO TAX, NO HOURS TRACKING. Deliberately. This records intent and outcome;
 * it does not file anything, withhold anything, or clock anyone in. Saying so plainly matters,
 * because a half-built payroll feature that looks complete is how people get paid wrong.
 *
 * Routes (all staff — requireStaff, org-scoped):
 *   GET    /api/admin/staff-rates?contact_id= → rate cards
 *   POST   /api/admin/staff-rates             → add a rate (supersedes by date, never edits)
 *   DELETE /api/admin/staff-rates/:id         → soft delete
 *   POST   /api/admin/shifts/:id/assign       → attach a person + resolve their rate
 *   POST   /api/admin/shifts/:id/approve      → freeze the pay numbers
 *   GET    /api/admin/shifts/pay?from=&to=    → what is owed, by person, over a window
 *
 * Pure (unit-tested): PAY_BASES · hoursBetween · computePay · pickRate · normalizeRateInput
 */

let json, audit, requireStaff;
export function wireStaffPay(h) {
  ({ json, audit, requireStaff } = h);
}

export const PAY_BASES = ["hourly", "flat", "per_session"];
/** A rate this high is a typo — almost certainly dollars typed into a cents field. */
export const MAX_RATE_CENTS = 100000;

/* ============================ pure helpers (unit-tested) ============================ */

function ms(v) {
  if (!v) return NaN;
  let s = String(v).trim().replace(" ", "T");
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  return Date.parse(s);
}

/**
 * Hours between two timestamps, or NaN if either is unreadable.
 * @returns {number}
 */
export function hoursBetween(startsAt, endsAt) {
  const a = ms(startsAt), b = ms(endsAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return (b - a) / 3600000;
}

/**
 * What a shift costs.
 *
 * FAILS CLOSED, and returns a REASON rather than a zero. A silent 0 in a pay column is
 * indistinguishable from "this person worked for free", and somebody will believe it. When the
 * inputs cannot support a number, this says so and the shift stays unapprovable.
 *
 * @param {{pay_basis:string, pay_rate_cents:number, starts_at:string, ends_at:string, pay_units?:number}} shift
 * @returns {{ok:true, units:number, amount_cents:number} | {ok:false, error:string}}
 */
export function computePay(shift) {
  const basis = shift?.pay_basis;
  if (!PAY_BASES.includes(basis)) return { ok: false, error: "This shift has no pay basis set." };

  const rate = Number(shift?.pay_rate_cents);
  if (!Number.isInteger(rate) || rate < 0) return { ok: false, error: "This shift has no rate set." };
  if (rate > MAX_RATE_CENTS) return { ok: false, error: "That rate looks like dollars typed into a cents box." };

  if (basis === "flat") return { ok: true, units: 1, amount_cents: rate };

  if (basis === "per_session") {
    const units = Number(shift?.pay_units);
    if (!Number.isFinite(units) || units <= 0) return { ok: false, error: "Set how many sessions this shift covers." };
    return { ok: true, units, amount_cents: Math.round(rate * units) };
  }

  // hourly
  const hours = hoursBetween(shift?.starts_at, shift?.ends_at);
  if (!Number.isFinite(hours)) return { ok: false, error: "This shift's start or end time isn't readable." };
  if (hours <= 0) return { ok: false, error: "This shift ends before it starts." };
  if (hours > 24) return { ok: false, error: "That shift is longer than a day — check the dates." };
  return { ok: true, units: hours, amount_cents: Math.round(rate * hours) };
}

/**
 * Which rate applies to a person doing a particular job on a particular day.
 * Prefers an exact role match over a general rate; among equals, the most recently effective wins.
 *
 * @param {Array<{role_label:string|null, effective_from:string, effective_to:string|null}>} rates
 * @param {string|null} roleLabel
 * @param {string} whenIso
 * @returns {object|null}
 */
export function pickRate(rates, roleLabel, whenIso) {
  const when = ms(whenIso);
  if (!Number.isFinite(when)) return null;
  const live = (rates || []).filter((r) => {
    if (r.deleted_at) return false;
    const from = ms(r.effective_from);
    if (Number.isFinite(from) && when < from) return false;
    const to = r.effective_to ? ms(r.effective_to) : null;
    if (to !== null && Number.isFinite(to) && when > to) return false;
    return true;
  });
  const exact = live.filter((r) => r.role_label && roleLabel && r.role_label === roleLabel);
  const general = live.filter((r) => !r.role_label);
  const pool = exact.length ? exact : general;
  if (!pool.length) return null;
  return pool.sort((a, b) => ms(b.effective_from) - ms(a.effective_from))[0];
}

/** Validate a new rate card row. */
export function normalizeRateInput(body) {
  const basis = String(body?.pay_basis ?? "hourly");
  if (!PAY_BASES.includes(basis)) return { ok: false, error: `"${basis}" isn't a pay basis we support.` };
  const rate = Number(body?.rate_cents);
  if (!Number.isInteger(rate) || rate < 0) return { ok: false, error: "Enter the rate in whole cents." };
  if (rate > MAX_RATE_CENTS) return { ok: false, error: "That rate looks like dollars typed into a cents box." };
  return {
    ok: true,
    value: {
      pay_basis: basis,
      rate_cents: rate,
      role_label: String(body?.role_label ?? "").trim().slice(0, 60) || null,
      effective_from: body?.effective_from ? String(body.effective_from).trim() : null,
      effective_to: body?.effective_to ? String(body.effective_to).trim() : null,
      note: String(body?.note ?? "").trim().slice(0, 200) || null,
    },
  };
}

/* ============================ routes ============================ */

export async function staffPayRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;

  if (p === "/api/admin/staff-rates" && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const contactId = Number(url.searchParams.get("contact_id")) || null;
    const rows = (await env.DB.prepare(
      `SELECT r.id, r.contact_id, c.full_name, r.role_label, r.pay_basis, r.rate_cents,
              r.effective_from, r.effective_to, r.note
       FROM staff_rates r LEFT JOIN contacts c ON c.id = r.contact_id AND c.org_id = r.org_id
       WHERE r.org_id=?1 AND r.deleted_at IS NULL ${contactId ? "AND r.contact_id=?2" : ""}
       ORDER BY r.contact_id, r.effective_from DESC LIMIT 300`
    ).bind(...(contactId ? [ctx.orgId, contactId] : [ctx.orgId])).all()).results || [];
    return json({ rates: rows });
  }

  if (p === "/api/admin/staff-rates" && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const contactId = Number(body.contact_id);
    if (!contactId) return json({ error: "Pick a person first." }, 400);
    const person = await env.DB.prepare(
      "SELECT id FROM contacts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(contactId, ctx.orgId).first();
    if (!person) return json({ error: "That person isn't in this organisation." }, 404);

    const norm = normalizeRateInput(body);
    if (!norm.ok) return json({ error: norm.error }, 400);
    const v = norm.value;

    const ins = await env.DB.prepare(
      `INSERT INTO staff_rates (org_id, contact_id, role_label, pay_basis, rate_cents,
                                effective_from, effective_to, note, created_by)
       VALUES (?1,?2,?3,?4,?5, COALESCE(?6, datetime('now')), ?7,?8,?9)`
    ).bind(ctx.orgId, contactId, v.role_label, v.pay_basis, v.rate_cents,
           v.effective_from, v.effective_to, v.note, ctx.userId || null).run();

    await audit(env, ctx, "staff_rate.add", "staff_rates", ins.meta.last_row_id,
      { contact_id: contactId, basis: v.pay_basis, rate_cents: v.rate_cents });
    return json({ ok: true, rate_id: ins.meta.last_row_id });
  }

  if ((x = p.match(/^\/api\/admin\/staff-rates\/(\d+)$/)) && m === "DELETE") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const id = +x[1];
    const r = await env.DB.prepare(
      "SELECT id FROM staff_rates WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(id, ctx.orgId).first();
    if (!r) return json({ error: "That rate doesn't exist." }, 404);
    await env.DB.prepare("UPDATE staff_rates SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2")
      .bind(id, ctx.orgId).run();
    await audit(env, ctx, "staff_rate.delete", "staff_rates", id, {});
    return json({ ok: true });
  }

  /* ---- assign a person to a shift and resolve what they are paid for it ---- */
  if ((x = p.match(/^\/api\/admin\/shifts\/(\d+)\/assign$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const shiftId = +x[1];
    const body = await request.json().catch(() => ({}));

    const shift = await env.DB.prepare(
      "SELECT id, starts_at, ends_at, role_label, approved_at FROM staff_shifts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(shiftId, ctx.orgId).first();
    if (!shift) return json({ error: "That shift doesn't exist." }, 404);
    if (shift.approved_at) return json({ error: "That shift is already approved. Reopen it before changing the pay." }, 409);

    const contactId = Number(body.contact_id);
    if (!contactId) return json({ error: "Pick a person first." }, 400);
    const person = await env.DB.prepare(
      "SELECT id, full_name FROM contacts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(contactId, ctx.orgId).first();
    if (!person) return json({ error: "That person isn't in this organisation." }, 404);

    const roleLabel = String(body.role_label || shift.role_label || "").trim() || null;
    const rates = (await env.DB.prepare(
      "SELECT * FROM staff_rates WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, contactId).all()).results || [];
    const rate = pickRate(rates, roleLabel, shift.starts_at);

    // An explicit override beats the rate card, but the card is the default so nobody has to
    // remember a number at 7am.
    const basis = body.pay_basis || (rate && rate.pay_basis) || null;
    const rateCents = body.pay_rate_cents !== undefined ? Number(body.pay_rate_cents)
                                                        : (rate ? rate.rate_cents : null);
    if (!basis || rateCents === null || Number.isNaN(rateCents)) {
      return json({
        error: `No pay rate is set for ${person.full_name}${roleLabel ? ` as ${roleLabel}` : ""}. Add a rate card first, or set the rate on this shift.`,
      }, 409);
    }

    const pay = computePay({
      pay_basis: basis, pay_rate_cents: rateCents,
      starts_at: shift.starts_at, ends_at: shift.ends_at,
      pay_units: body.pay_units,
    });
    if (!pay.ok) return json({ error: pay.error }, 400);

    await env.DB.prepare(
      `UPDATE staff_shifts SET contact_id=?1, name_snapshot=?2, role_label=?3, pay_basis=?4,
              pay_rate_cents=?5, pay_units=?6, pay_amount_cents=?7, event_id=COALESCE(?8, event_id),
              updated_at=datetime('now')
       WHERE id=?9 AND org_id=?10`
    ).bind(contactId, person.full_name, roleLabel, basis, rateCents, pay.units, pay.amount_cents,
           body.event_id ? Number(body.event_id) : null, shiftId, ctx.orgId).run();

    await audit(env, ctx, "shift.assign", "staff_shifts", shiftId,
      { contact_id: contactId, basis, rate_cents: rateCents, amount_cents: pay.amount_cents });
    return json({ ok: true, units: pay.units, amount_cents: pay.amount_cents, rate_source: body.pay_rate_cents !== undefined ? "override" : "rate_card" });
  }

  /* ---- approve: freeze the numbers ---- */
  if ((x = p.match(/^\/api\/admin\/shifts\/(\d+)\/approve$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const id = +x[1];
    const shift = await env.DB.prepare(
      "SELECT id, contact_id, pay_amount_cents, approved_at FROM staff_shifts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(id, ctx.orgId).first();
    if (!shift) return json({ error: "That shift doesn't exist." }, 404);
    if (shift.approved_at) return json({ error: "That shift is already approved." }, 409);
    if (!shift.contact_id) return json({ error: "Assign someone to the shift first." }, 409);
    if (shift.pay_amount_cents === null) return json({ error: "This shift has no pay worked out yet." }, 409);

    await env.DB.prepare(
      "UPDATE staff_shifts SET approved_at=datetime('now'), approved_by=?1, updated_at=datetime('now') WHERE id=?2 AND org_id=?3"
    ).bind(ctx.userId || null, id, ctx.orgId).run();
    await audit(env, ctx, "shift.approve", "staff_shifts", id, { amount_cents: shift.pay_amount_cents });
    return json({ ok: true, note: "Approved. The rate and total on this shift are now fixed." });
  }

  /* ---- what is owed, over a window ---- */
  if (p === "/api/admin/shifts/pay" && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const from = url.searchParams.get("from") || "1970-01-01";
    const to = url.searchParams.get("to") || "2999-12-31";
    const rows = (await env.DB.prepare(
      `SELECT s.contact_id, COALESCE(c.full_name, s.name_snapshot) AS name,
              COUNT(*) AS shifts,
              SUM(CASE WHEN s.approved_at IS NOT NULL THEN 1 ELSE 0 END) AS approved_shifts,
              SUM(COALESCE(s.pay_units, 0)) AS units,
              SUM(CASE WHEN s.approved_at IS NOT NULL THEN COALESCE(s.pay_amount_cents,0) ELSE 0 END) AS approved_cents,
              SUM(CASE WHEN s.approved_at IS NULL THEN COALESCE(s.pay_amount_cents,0) ELSE 0 END) AS pending_cents
       FROM staff_shifts s LEFT JOIN contacts c ON c.id = s.contact_id AND c.org_id = s.org_id
       WHERE s.org_id=?1 AND s.deleted_at IS NULL AND s.contact_id IS NOT NULL
         AND s.starts_at >= ?2 AND s.starts_at <= ?3
       GROUP BY s.contact_id ORDER BY name`
    ).bind(ctx.orgId, from, to).all()).results || [];
    // Approved and pending are reported SEPARATELY and never summed into one figure: "owed" and
    // "might be owed" are different questions, and merging them is how someone gets overpaid.
    return json({ from, to, people: rows });
  }

  return null;
}
