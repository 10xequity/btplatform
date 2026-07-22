/**
 * Boomtown Platform — Events Admin API (templates, recurring, bulk, CSV export)
 * Version: v0.4.0 · Date: 2026-07-22
 *
 * Adds on top of tournaments.js events CRUD (create/list/get/patch remain there):
 *   GET    /api/admin/templates                 → templates for ctx org
 *   POST   /api/admin/templates                 { name, payload } → save template (payload = event field bag)
 *   DELETE /api/admin/templates/:id
 *   POST   /api/events/:id/save-as-template     { name? }
 *   POST   /api/events/:id/duplicate            { starts_at? } → copy of event (draft)
 *   POST   /api/admin/events/recurring          { base:{...event fields}, rule:{freq:'weekly',interval,count,until?} }
 *   PATCH  /api/admin/series/:sid               { from_event_id, fields } → edit this-and-future instances
 *   DELETE /api/admin/series/:sid?from_event_id=N → cancel this-and-future (status → cancelled)
 *   POST   /api/admin/events/bulk               { rows:[{name,type,starts_at,location,price,capacity,status}] } ≤200
 *   PATCH  /api/admin/events/bulk               { ids:[...], fields:{status?|price_cents?|location?} }
 *   GET    /api/events/:id/registrations.csv    → staff CSV download (fetch with Bearer; UI turns it into a file)
 *   GET    /api/admin/programs / POST / DELETE  → program folders for grouping events
 */

let json, audit, requireStaff;
export function wireEventsAdmin(h) { ({ json, audit, requireStaff } = h); }

const TYPES = ["tournament", "league", "training", "event", "court_rental"];
const STATUSES = ["draft", "published", "in_progress", "completed", "cancelled"];
const MAX_INSTANCES = 52;   // one weekly year — sanity cap
const MAX_BULK = 200;

export async function eventsAdminRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;
  let match;

  if (p === "/api/admin/templates" && m === "GET") return listTemplates(env, ctx);
  if (p === "/api/admin/templates" && m === "POST") return createTemplate(request, env, ctx);
  if ((match = p.match(/^\/api\/admin\/templates\/(\d+)$/)) && m === "DELETE") return deleteTemplate(env, ctx, +match[1]);

  if ((match = p.match(/^\/api\/events\/(\d+)\/save-as-template$/)) && m === "POST") return saveAsTemplate(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/duplicate$/)) && m === "POST") return duplicateEvent(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/registrations\.csv$/)) && m === "GET") return registrationsCsv(env, ctx, +match[1]);

  if (p === "/api/admin/events/recurring" && m === "POST") return createRecurring(request, env, ctx);
  if ((match = p.match(/^\/api\/admin\/series\/([\w-]+)$/))) {
    if (m === "PATCH") return editSeries(request, env, ctx, match[1]);
    if (m === "DELETE") return cancelSeries(env, ctx, match[1], url);
  }
  if (p === "/api/admin/events/bulk" && m === "POST") return bulkCreate(request, env, ctx);
  if (p === "/api/admin/events/bulk" && m === "PATCH") return bulkEdit(request, env, ctx);

  if (p === "/api/admin/programs" && m === "GET") return listPrograms(env, ctx);
  if (p === "/api/admin/programs" && m === "POST") return createProgram(request, env, ctx);
  if ((match = p.match(/^\/api\/admin\/programs\/(\d+)$/)) && m === "DELETE") return deleteProgram(env, ctx, +match[1]);

  return null;
}

/* ---------- shared ---------- */

const EVENT_FIELDS = ["type", "name", "location", "price_cents", "capacity", "court_count", "format_template", "cash_option_enabled", "config_json", "program_id"];

function cleanEventBag(src) {
  const out = {};
  for (const k of EVENT_FIELDS) if (k in src && src[k] !== undefined) out[k] = src[k];
  if (out.type && !TYPES.includes(out.type)) delete out.type;
  return out;
}

async function loadOrgEvent(env, ctx, id) {
  const ev = await env.DB.prepare("SELECT * FROM events WHERE id=?1 AND deleted_at IS NULL").bind(id).first();
  return ev && ev.org_id === ctx.orgId ? ev : null;
}

async function insertEvent(env, orgId, bag, startsAt, seriesId, recurrenceJson, status) {
  const r = await env.DB.prepare(
    `INSERT INTO events (org_id, type, name, starts_at, ends_at, location, capacity, court_count,
       format_template, config_json, status, cash_option_enabled, price_cents, series_id, recurrence_json, program_id)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)`
  ).bind(
    orgId, bag.type || "event", bag.name || "Untitled event", startsAt || null, bag.ends_at || null,
    bag.location || null, bag.capacity || null, bag.court_count || null, bag.format_template || null,
    bag.config_json || "{}", status || "draft", bag.cash_option_enabled ? 1 : 0, bag.price_cents || 0,
    seriesId || null, recurrenceJson || null, bag.program_id || null
  ).run();
  return r.meta.last_row_id;
}

/* ---------- templates ---------- */

async function listTemplates(env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const rows = (await env.DB.prepare(
    "SELECT id, name, payload_json, updated_at FROM event_templates WHERE org_id=?1 AND deleted_at IS NULL ORDER BY name"
  ).bind(ctx.orgId).all()).results;
  return json({ templates: rows });
}

async function createTemplate(request, env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  if (!b.name) return json({ error: "Give the template a name." }, 400);
  const payload = cleanEventBag(b.payload || {});
  const r = await env.DB.prepare(
    "INSERT INTO event_templates (org_id, name, payload_json) VALUES (?1, ?2, ?3)"
  ).bind(ctx.orgId, b.name, JSON.stringify(payload)).run();
  await audit(env, ctx, "template.created", "event_template", r.meta.last_row_id, { name: b.name });
  return json({ ok: true, id: r.meta.last_row_id });
}

async function deleteTemplate(env, ctx, id) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  await env.DB.prepare(
    "UPDATE event_templates SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2"
  ).bind(id, ctx.orgId).run();
  return json({ ok: true });
}

async function saveAsTemplate(request, env, ctx, eventId) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const ev = await loadOrgEvent(env, ctx, eventId);
  if (!ev) return json({ error: "Event not found in this org." }, 404);
  const b = await request.json().catch(() => ({}));
  const r = await env.DB.prepare(
    "INSERT INTO event_templates (org_id, name, payload_json) VALUES (?1, ?2, ?3)"
  ).bind(ctx.orgId, b.name || `${ev.name} template`, JSON.stringify(cleanEventBag(ev))).run();
  await audit(env, ctx, "template.created", "event_template", r.meta.last_row_id, { from_event: eventId });
  return json({ ok: true, id: r.meta.last_row_id });
}

/* ---------- duplicate ---------- */

async function duplicateEvent(request, env, ctx, eventId) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const ev = await loadOrgEvent(env, ctx, eventId);
  if (!ev) return json({ error: "Event not found in this org." }, 404);
  const b = await request.json().catch(() => ({}));
  const bag = cleanEventBag(ev);
  bag.name = b.name || `${ev.name} (copy)`;
  const id = await insertEvent(env, ctx.orgId, bag, b.starts_at || ev.starts_at, null, null, "draft");
  await audit(env, ctx, "event.duplicated", "event", id, { from: eventId });
  return json({ ok: true, id });
}

/* ---------- recurring ---------- */

function expandRule(startsAt, rule) {
  // rule: { freq:'weekly'|'biweekly'|'monthly', count?, until?'YYYY-MM-DD' }
  const out = [];
  if (!startsAt) return out;
  const stepDays = rule.freq === "biweekly" ? 14 : rule.freq === "weekly" ? 7 : 0; // monthly handled below
  let d = new Date(startsAt.replace(" ", "T") + (startsAt.length <= 10 ? "T00:00" : ""));
  if (isNaN(d)) return out;
  const until = rule.until ? new Date(rule.until + "T23:59") : null;
  const count = Math.min(Number(rule.count) || (until ? MAX_INSTANCES : 4), MAX_INSTANCES);
  for (let i = 0; i < count; i++) {
    if (until && d > until) break;
    out.push(d.toISOString().slice(0, 16).replace("T", " "));
    if (stepDays) d = new Date(d.getTime() + stepDays * 86400000);
    else d = new Date(new Date(d).setMonth(d.getMonth() + 1)); // monthly: same day-of-month
  }
  return out;
}

async function createRecurring(request, env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const bag = cleanEventBag(b.base || {});
  const rule = b.rule || {};
  if (!["weekly", "biweekly", "monthly"].includes(rule.freq)) return json({ error: "Repeat must be weekly, biweekly, or monthly." }, 400);
  const dates = expandRule(b.base && b.base.starts_at, rule);
  if (!dates.length) return json({ error: "Couldn't build any dates from that rule — check the start date." }, 400);
  const seriesId = crypto.randomUUID();
  const ids = [];
  for (const dt of dates) ids.push(await insertEvent(env, ctx.orgId, bag, dt, seriesId, JSON.stringify(rule), b.status || "draft"));
  await audit(env, ctx, "series.created", "event", ids[0], { series_id: seriesId, instances: ids.length, rule });
  return json({ ok: true, series_id: seriesId, event_ids: ids, count: ids.length });
}

async function editSeries(request, env, ctx, seriesId) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const from = await loadOrgEvent(env, ctx, Number(b.from_event_id));
  if (!from || from.series_id !== seriesId) return json({ error: "That event isn't part of this series (or not in this org)." }, 404);
  const bag = cleanEventBag(b.fields || {});
  const extra = {};
  if (b.fields && b.fields.status && STATUSES.includes(b.fields.status)) extra.status = b.fields.status;
  const sets = [], vals = [];
  for (const [k, v] of Object.entries({ ...bag, ...extra })) { vals.push(v); sets.push(`${k}=?${vals.length}`); }
  if (!sets.length) return json({ error: "Nothing to update." }, 400);
  vals.push(seriesId, ctx.orgId, from.starts_at);
  const r = await env.DB.prepare(
    `UPDATE events SET ${sets.join(",")}, updated_at=datetime('now')
     WHERE series_id=?${vals.length - 2} AND org_id=?${vals.length - 1} AND starts_at>=?${vals.length} AND deleted_at IS NULL`
  ).bind(...vals).run();
  await audit(env, ctx, "series.edited", "event", from.id, { series_id: seriesId, fields: Object.keys(bag) });
  return json({ ok: true, updated: r.meta.changes });
}

async function cancelSeries(env, ctx, seriesId, url) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const from = await loadOrgEvent(env, ctx, Number(url.searchParams.get("from_event_id")));
  if (!from || from.series_id !== seriesId) return json({ error: "That event isn't part of this series (or not in this org)." }, 404);
  const r = await env.DB.prepare(
    `UPDATE events SET status='cancelled', updated_at=datetime('now')
     WHERE series_id=?1 AND org_id=?2 AND starts_at>=?3 AND deleted_at IS NULL`
  ).bind(seriesId, ctx.orgId, from.starts_at).run();
  await audit(env, ctx, "series.cancelled", "event", from.id, { series_id: seriesId });
  return json({ ok: true, cancelled: r.meta.changes });
}

/* ---------- bulk ---------- */

async function bulkCreate(request, env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, MAX_BULK) : [];
  if (!rows.length) return json({ error: "No rows to import." }, 400);
  const created = [], skipped = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.name || !r.starts_at) { skipped.push({ row: i + 1, reason: "Missing name or date" }); continue; }
    const bag = cleanEventBag(r);
    if (r.price != null && r.price_cents == null) bag.price_cents = Math.round(Number(r.price) * 100) || 0;
    const status = STATUSES.includes(r.status) ? r.status : "draft";
    try {
      const id = await insertEvent(env, ctx.orgId, bag, r.starts_at, null, null, status);
      created.push(id);
    } catch (e) { skipped.push({ row: i + 1, reason: "Database rejected the row" }); }
  }
  await audit(env, ctx, "events.bulk_created", "event", created[0] || 0, { count: created.length, skipped: skipped.length });
  return json({ ok: true, created: created.length, skipped });
}

async function bulkEdit(request, env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, MAX_BULK);
  if (!ids.length) return json({ error: "Select at least one event." }, 400);
  const f = b.fields || {};
  const sets = [], vals = [];
  if (f.status && STATUSES.includes(f.status)) { vals.push(f.status); sets.push(`status=?${vals.length}`); }
  if (f.price_cents != null) { vals.push(Number(f.price_cents) || 0); sets.push(`price_cents=?${vals.length}`); }
  if (f.location != null) { vals.push(f.location); sets.push(`location=?${vals.length}`); }
  if (f.program_id !== undefined) { vals.push(f.program_id || null); sets.push(`program_id=?${vals.length}`); }
  if (!sets.length) return json({ error: "Nothing to update. Bulk edit supports status, price, location, program." }, 400);
  const idPh = ids.map((_, i) => `?${vals.length + i + 2}`).join(",");
  vals.push(ctx.orgId, ...ids);
  const r = await env.DB.prepare(
    `UPDATE events SET ${sets.join(",")}, updated_at=datetime('now')
     WHERE org_id=?${sets.length + 1} AND id IN (${idPh}) AND deleted_at IS NULL`
  ).bind(...vals).run();
  await audit(env, ctx, "events.bulk_edited", "event", ids[0], { count: ids.length, fields: Object.keys(f) });
  return json({ ok: true, updated: r.meta.changes });
}

/* ---------- registrations CSV ---------- */

async function registrationsCsv(env, ctx, eventId) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const ev = await loadOrgEvent(env, ctx, eventId);
  if (!ev) return json({ error: "Event not found in this org." }, 404);
  const rows = (await env.DB.prepare(
    `SELECT r.id, r.status, r.payment_method, r.created_at, c.full_name, c.email, c.phone, c.city, c.state,
            t.name AS team_name, t.level, t.gender_division
     FROM registrations r
     LEFT JOIN contacts c ON c.id=r.contact_id
     LEFT JOIN teams t ON t.id=r.team_id
     WHERE r.event_id=?1 AND r.deleted_at IS NULL ORDER BY r.id`
  ).bind(eventId).all()).results;
  const esc = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const header = ["registration_id", "status", "payment_method", "registered_at", "name", "email", "phone", "city", "state", "team", "level", "division"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([r.id, r.status, r.payment_method, r.created_at, r.full_name, r.email, r.phone, r.city, r.state, r.team_name, r.level, r.gender_division].map(esc).join(","));
  }
  await audit(env, ctx, "registrations.exported", "event", eventId, { rows: rows.length });
  return new Response(lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="event-${eventId}-registrations.csv"`,
    },
  });
}

/* ---------- programs ---------- */

async function listPrograms(env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const rows = (await env.DB.prepare(
    "SELECT id, name, description, type FROM programs WHERE org_id=?1 AND deleted_at IS NULL ORDER BY name"
  ).bind(ctx.orgId).all()).results;
  return json({ programs: rows });
}

async function createProgram(request, env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  if (!b.name) return json({ error: "Give the program a name." }, 400);
  const type = TYPES.includes(b.type) ? b.type : "event";
  const r = await env.DB.prepare(
    "INSERT INTO programs (org_id, name, description, type) VALUES (?1,?2,?3,?4)"
  ).bind(ctx.orgId, b.name, b.description || null, type).run();
  await audit(env, ctx, "program.created", "program", r.meta.last_row_id, { name: b.name });
  return json({ ok: true, id: r.meta.last_row_id });
}

async function deleteProgram(env, ctx, id) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  await env.DB.prepare("UPDATE programs SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2").bind(id, ctx.orgId).run();
  await env.DB.prepare("UPDATE events SET program_id=NULL WHERE program_id=?1 AND org_id=?2").bind(id, ctx.orgId).run();
  return json({ ok: true });
}
