/**
 * Boomtown Platform — Membership custom-field registry (M22)
 * File: worker/src/member_fields.js · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.57.0
 * Requires migration 0034 (member_fields, member_field_values).
 *
 * Owner requirement (requirements §2, verbatim intent): "add fields from the system to membership
 * profiles and remove them (make them seen/unseen on forms) as needed; more robust membership
 * system similar to other systems."
 *
 * WHAT THIS IS. `member_profiles` holds the columns the PRODUCT defines — bio, positions, skill
 * level. This is the other half: the fields an ORG invents. Dietary restrictions, jersey size,
 * school, emergency contact, whether they own a team tent. The product cannot enumerate those in
 * advance, so it stops trying and lets the org declare them.
 *
 * HIDE ≠ DELETE — the rule that shapes the whole module. `active = 0` removes a field from every
 * form and every profile while every recorded value stays on disk. Turning it back on restores
 * the answers rather than starting from nothing. A season-specific field can therefore be parked
 * in the off-season and revived, which is what "seen/unseen as needed" actually means. Deleting
 * is separate, rare, and still soft.
 *
 * TWO VISIBILITY SWITCHES, deliberately not one:
 *   member_visible — may the MEMBER see and edit this on their own profile?
 *   show_on_forms  — does it appear on public signup/registration?
 * "Coach notes" is neither: staff-only, and a member must never read it. One combined flag could
 * not express that, and the failure mode would be leaking internal notes to the person they are
 * about. The member-facing routes below filter on member_visible at the SQL level, not in the
 * response mapper, so a field that is not member-visible is never loaded, let alone serialised.
 *
 * Routes (staff — requireStaff, org-scoped):
 *   GET    /api/admin/member-fields                → the registry, inactive included
 *   POST   /api/admin/member-fields                → create
 *   PATCH  /api/admin/member-fields/:id            → rename, retype, reorder, toggle active
 *   DELETE /api/admin/member-fields/:id            → soft delete (values retained)
 *   GET    /api/admin/members/:contactId/fields    → one member's answers, all fields
 *   PUT    /api/admin/members/:contactId/fields    → staff sets answers (incl. staff-only fields)
 * Routes (member — session required):
 *   GET    /api/profile/fields                     → active + member_visible fields and my answers
 *   PUT    /api/profile/fields                     → member sets their OWN answers
 *
 * Pure (unit-tested): slugifyKey · normalizeFieldInput · validateValue · coerceOptions
 */

let json, contactForSession, audit, requireStaff;
export function wireMemberFields(h) {
  ({ json, contactForSession, audit, requireStaff } = h);
}

export const FIELD_TYPES = ["text", "textarea", "email", "phone", "number", "date", "select", "checkbox"];
/** A registry that can grow without limit is a denial-of-service on your own admin page. */
export const MAX_FIELDS_PER_ORG = 60;
export const MAX_VALUE_LEN = 2000;
export const MAX_OPTIONS = 40;

/* ============================ pure helpers (unit-tested) ============================ */

/**
 * Label → stable key. The key is what a value points at, so renaming "Shirt size" to "Jersey
 * size" must never orphan the answers already given.
 * @param {string} label
 * @returns {string} lowercase a–z0–9_ slug, or "" when nothing survives
 */
export function slugifyKey(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/** Options list → clean array of non-empty trimmed strings, deduped, capped. */
export function coerceOptions(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const o of arr) {
    const s = String(o ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s.slice(0, 120));
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/**
 * Validate + normalize a field definition from the admin form.
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function normalizeFieldInput(body, { existingKey = null } = {}) {
  const label = String(body?.label ?? "").trim();
  if (!label) return { ok: false, error: "Give the field a name." };
  if (label.length > 120) return { ok: false, error: "That name is too long; keep it under 120 characters." };

  const field_type = String(body?.field_type ?? "text");
  if (!FIELD_TYPES.includes(field_type)) {
    return { ok: false, error: `"${field_type}" isn't a field type we support.` };
  }

  const options = coerceOptions(body?.options);
  if (field_type === "select" && options.length < 2) {
    return { ok: false, error: "A dropdown needs at least two choices." };
  }

  // The key never changes once set. Renaming the label is a display change, not a data migration.
  const field_key = existingKey || slugifyKey(label);
  if (!field_key) return { ok: false, error: "That name needs at least one letter or number." };

  return {
    ok: true,
    value: {
      label,
      field_key,
      field_type,
      options_json: JSON.stringify(field_type === "select" ? options : []),
      help_text: String(body?.help_text ?? "").trim().slice(0, 300) || null,
      required: body?.required ? 1 : 0,
      member_visible: body?.member_visible === undefined ? 1 : (body.member_visible ? 1 : 0),
      show_on_forms: body?.show_on_forms ? 1 : 0,
      active: body?.active === undefined ? 1 : (body.active ? 1 : 0),
      sort_order: Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0,
    },
  };
}

/**
 * Validate one submitted answer against its field definition.
 * Empty is allowed unless the field is required — a half-filled profile is normal, and refusing
 * to save the rest of someone's answers because one optional box is blank is hostile.
 *
 * @param {{field_type:string, options_json:string, required:number, label:string}} field
 * @param {unknown} raw
 * @returns {{ok:true, value:string|null} | {ok:false, error:string}}
 */
export function validateValue(field, raw) {
  const type = field.field_type;
  const label = field.label || "This field";

  if (type === "checkbox") {
    // A checkbox is never "missing" — it is yes or no. Required means it must be YES.
    const on = raw === true || raw === 1 || raw === "1" || raw === "true" || raw === "yes";
    if (field.required && !on) return { ok: false, error: `${label} has to be ticked.` };
    return { ok: true, value: on ? "1" : "0" };
  }

  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!s) {
    if (field.required) return { ok: false, error: `${label} is required.` };
    return { ok: true, value: null };
  }
  if (s.length > MAX_VALUE_LEN) {
    return { ok: false, error: `${label} is too long; keep it under ${MAX_VALUE_LEN} characters.` };
  }

  if (type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    return { ok: false, error: `${label} needs to be a valid email address.` };
  }
  if (type === "number" && !Number.isFinite(Number(s))) {
    return { ok: false, error: `${label} needs to be a number.` };
  }
  if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { ok: false, error: `${label} needs to be a date, like 2026-08-31.` };
  }
  if (type === "select") {
    let opts = [];
    try { opts = JSON.parse(field.options_json || "[]"); } catch { opts = []; }
    // Fail closed: a corrupt options list must reject the write, not accept anything.
    if (!Array.isArray(opts) || !opts.includes(s)) {
      return { ok: false, error: `"${s}" isn't one of the choices for ${label}.` };
    }
  }
  return { ok: true, value: s };
}

/* ============================ shared queries ============================ */

const FIELD_COLS =
  "id, field_key, label, field_type, options_json, help_text, required, member_visible, show_on_forms, active, sort_order";

/** Shape a DB row for the wire. options_json stays a string on disk, an array in JSON. */
function fieldOut(r) {
  let options = [];
  try { options = JSON.parse(r.options_json || "[]"); } catch { options = []; }
  return {
    id: r.id, key: r.field_key, label: r.label, field_type: r.field_type, options,
    help_text: r.help_text, required: !!r.required, member_visible: !!r.member_visible,
    show_on_forms: !!r.show_on_forms, active: !!r.active, sort_order: r.sort_order,
  };
}

async function loadField(env, orgId, id) {
  return env.DB.prepare(
    `SELECT ${FIELD_COLS} FROM member_fields WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL`
  ).bind(id, orgId).first();
}

/**
 * Write one member's answers. Shared by the staff and member routes so there is ONE upsert and
 * ONE validation pass; the routes differ only in WHICH fields they are allowed to touch.
 */
async function writeValues(env, ctx, contactId, answers, allowedFields) {
  const byId = new Map(allowedFields.map((f) => [String(f.id), f]));
  const byKey = new Map(allowedFields.map((f) => [f.field_key, f]));

  const writes = [];
  for (const [k, raw] of Object.entries(answers || {})) {
    const field = byId.get(String(k)) || byKey.get(k);
    // Silently ignoring an unknown key would let a member post at a staff-only field and get a
    // 200 back. Refuse, and name it.
    if (!field) return { ok: false, error: `There's no field called "${k}" you can edit.` };
    const v = validateValue(field, raw);
    if (!v.ok) return { ok: false, error: v.error };
    writes.push({ field, value: v.value });
  }

  // Required fields the caller left out entirely are still required.
  for (const f of allowedFields) {
    if (!f.required) continue;
    const touched = writes.some((w) => w.field.id === f.id);
    if (touched) continue;
    const existing = await env.DB.prepare(
      "SELECT value FROM member_field_values WHERE org_id=?1 AND contact_id=?2 AND field_id=?3 AND deleted_at IS NULL"
    ).bind(ctx.orgId, contactId, f.id).first();
    const has = existing && existing.value !== null && String(existing.value).trim() !== "" &&
                !(f.field_type === "checkbox" && existing.value === "0");
    if (!has) return { ok: false, error: `${f.label} is required.` };
  }

  for (const w of writes) {
    await env.DB.prepare(
      `INSERT INTO member_field_values (org_id, contact_id, field_id, value, updated_by)
       VALUES (?1,?2,?3,?4,?5)
       ON CONFLICT (org_id, contact_id, field_id) WHERE deleted_at IS NULL
       DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=datetime('now')`
    ).bind(ctx.orgId, contactId, w.field.id, w.value, ctx.userId || null).run();
  }
  return { ok: true, written: writes.length };
}

/** Answers for one contact, keyed by field id. */
async function valuesFor(env, orgId, contactId) {
  const rows = (await env.DB.prepare(
    "SELECT field_id, value FROM member_field_values WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
  ).bind(orgId, contactId).all()).results || [];
  const out = {};
  for (const r of rows) out[r.field_id] = r.value;
  return out;
}

/* ============================ routes ============================ */

export async function memberFieldsRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;

  /* ---------------- staff: the registry ---------------- */

  if (p === "/api/admin/member-fields" && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const rows = (await env.DB.prepare(
      `SELECT ${FIELD_COLS} FROM member_fields WHERE org_id=?1 AND deleted_at IS NULL
       ORDER BY sort_order, id`
    ).bind(ctx.orgId).all()).results || [];
    return json({ fields: rows.map(fieldOut) });
  }

  if (p === "/api/admin/member-fields" && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const norm = normalizeFieldInput(await request.json().catch(() => ({})));
    if (!norm.ok) return json({ error: norm.error }, 400);
    const v = norm.value;

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM member_fields WHERE org_id=?1 AND deleted_at IS NULL"
    ).bind(ctx.orgId).first();
    if (count.n >= MAX_FIELDS_PER_ORG) {
      return json({ error: `You've reached the limit of ${MAX_FIELDS_PER_ORG} custom fields. Hide one you no longer use.` }, 400);
    }

    const clash = await env.DB.prepare(
      "SELECT id, active FROM member_fields WHERE org_id=?1 AND field_key=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, v.field_key).first();
    if (clash) {
      return json({
        error: clash.active
          ? `You already have a field called "${v.label}".`
          : `"${v.label}" already exists but is hidden. Turn it back on to keep the answers people already gave.`,
        existing_id: clash.id,
      }, 409);
    }

    const ins = await env.DB.prepare(
      `INSERT INTO member_fields (org_id, field_key, label, field_type, options_json, help_text,
                                  required, member_visible, show_on_forms, active, sort_order)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`
    ).bind(ctx.orgId, v.field_key, v.label, v.field_type, v.options_json, v.help_text,
           v.required, v.member_visible, v.show_on_forms, v.active, v.sort_order).run();

    await audit(env, ctx, "member_field.create", "member_fields", ins.meta.last_row_id, { key: v.field_key });
    return json({ ok: true, field: fieldOut({ ...v, id: ins.meta.last_row_id }) });
  }

  if ((x = p.match(/^\/api\/admin\/member-fields\/(\d+)$/)) && m === "PATCH") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const id = +x[1];
    const current = await loadField(env, ctx.orgId, id);
    if (!current) return json({ error: "That field doesn't exist." }, 404);

    const body = await request.json().catch(() => ({}));
    // The key is immutable: values point at it. A label change is cosmetic, by design.
    const norm = normalizeFieldInput({ ...fieldOut(current), ...body }, { existingKey: current.field_key });
    if (!norm.ok) return json({ error: norm.error }, 400);
    const v = norm.value;

    await env.DB.prepare(
      `UPDATE member_fields SET label=?1, field_type=?2, options_json=?3, help_text=?4, required=?5,
              member_visible=?6, show_on_forms=?7, active=?8, sort_order=?9, updated_at=datetime('now')
       WHERE id=?10 AND org_id=?11 AND deleted_at IS NULL`
    ).bind(v.label, v.field_type, v.options_json, v.help_text, v.required,
           v.member_visible, v.show_on_forms, v.active, v.sort_order, id, ctx.orgId).run();

    await audit(env, ctx, "member_field.update", "member_fields", id,
      { key: current.field_key, active: v.active });
    return json({ ok: true, field: fieldOut({ ...v, id }) });
  }

  if ((x = p.match(/^\/api\/admin\/member-fields\/(\d+)$/)) && m === "DELETE") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const id = +x[1];
    const current = await loadField(env, ctx.orgId, id);
    if (!current) return json({ error: "That field doesn't exist." }, 404);
    // Soft delete only. The answers stay: someone may need them for a refund dispute next season.
    await env.DB.prepare(
      "UPDATE member_fields SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2"
    ).bind(id, ctx.orgId).run();
    await audit(env, ctx, "member_field.delete", "member_fields", id, { key: current.field_key });
    return json({ ok: true, note: "Field removed. The answers people already gave are kept." });
  }

  /* ---------------- staff: one member's answers ---------------- */

  if ((x = p.match(/^\/api\/admin\/members\/(\d+)\/fields$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const contactId = +x[1];
    const rows = (await env.DB.prepare(
      `SELECT ${FIELD_COLS} FROM member_fields WHERE org_id=?1 AND deleted_at IS NULL AND active=1
       ORDER BY sort_order, id`
    ).bind(ctx.orgId).all()).results || [];
    const values = await valuesFor(env, ctx.orgId, contactId);
    return json({ fields: rows.map(fieldOut), values });
  }

  if ((x = p.match(/^\/api\/admin\/members\/(\d+)\/fields$/)) && m === "PUT") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const contactId = +x[1];
    const contact = await env.DB.prepare(
      "SELECT id FROM contacts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(contactId, ctx.orgId).first();
    if (!contact) return json({ error: "That member isn't in this organisation." }, 404);

    // Staff may write every ACTIVE field, including ones members cannot see.
    const allowed = (await env.DB.prepare(
      `SELECT ${FIELD_COLS} FROM member_fields WHERE org_id=?1 AND deleted_at IS NULL AND active=1`
    ).bind(ctx.orgId).all()).results || [];
    const body = await request.json().catch(() => ({}));
    const w = await writeValues(env, ctx, contactId, body.values, allowed);
    if (!w.ok) return json({ error: w.error }, 400);
    await audit(env, ctx, "member_field.set", "contacts", contactId, { fields: w.written });
    return json({ ok: true, saved: w.written });
  }

  /* ---------------- member: their own answers ---------------- */

  if (p === "/api/profile/fields" && m === "GET") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    // member_visible is filtered in SQL: a staff-only field is never loaded, let alone sent.
    const rows = (await env.DB.prepare(
      `SELECT ${FIELD_COLS} FROM member_fields
       WHERE org_id=?1 AND deleted_at IS NULL AND active=1 AND member_visible=1
       ORDER BY sort_order, id`
    ).bind(ctx.orgId).all()).results || [];
    const all = await valuesFor(env, ctx.orgId, me.id);
    const visible = {};
    for (const r of rows) if (all[r.id] !== undefined) visible[r.id] = all[r.id];
    return json({ fields: rows.map(fieldOut), values: visible });
  }

  if (p === "/api/profile/fields" && m === "PUT") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    const allowed = (await env.DB.prepare(
      `SELECT ${FIELD_COLS} FROM member_fields
       WHERE org_id=?1 AND deleted_at IS NULL AND active=1 AND member_visible=1`
    ).bind(ctx.orgId).all()).results || [];
    const body = await request.json().catch(() => ({}));
    const w = await writeValues(env, ctx, me.id, body.values, allowed);
    if (!w.ok) return json({ error: w.error }, 400);
    await audit(env, ctx, "member_field.self_set", "contacts", me.id, { fields: w.written });
    return json({ ok: true, saved: w.written });
  }

  return null;
}
