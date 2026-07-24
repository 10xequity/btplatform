/**
 * Boomtown Platform — Court & Facility Management (Module 12, Phase A)
 * File: worker/src/facility.js · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.12.0
 *
 * Staff-gated endpoints:
 *   GET    /api/admin/facility/spaces                → { spaces, presets (with space_ids), operators }
 *   GET    /api/admin/facility/bookings?from&to      → bookings in date range (with space_ids + operator color)
 *   POST   /api/admin/facility/check                 → { conflicts, warnings } for a proposed slot
 *   POST   /api/admin/facility/bookings              → create (single or weekly series); 409 on conflicts
 *                                                      { force:true } overrides WARNINGS only — never hard conflicts
 *   PATCH  /api/admin/facility/bookings/:id          → update; { scope:"one"|"series" } (series = this + future)
 *   DELETE /api/admin/facility/bookings/:id?scope=…  → soft delete (one | series = this + future)
 *   POST   /api/admin/facility/import                → { csv, dry_run } header-mapped CSV import;
 *                                                      per-row errors with line numbers; hard-conflict rows skipped
 *
 * Conflict rule (from the Boomtown Scheduler model):
 *   same date + time overlap + atom-set intersection = HARD conflict,
 *   downgraded to a "share" WARNING only when BOTH bookings carry share_ok=1.
 *   Closures (is_closure=1) always hard-conflict, both directions.
 *
 * Phase B (v0.12.x, separate release): tournament pools + league week slots auto-claim atoms.
 */

let json, audit, requireStaff;
export function wireFacility(h) { ({ json, audit, requireStaff } = h); }

export async function facilityRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  if (!p.startsWith("/api/admin/facility")) return null;
  const deny = await requireStaff(env, ctx); if (deny) return deny;

  if (p === "/api/admin/facility/spaces" && m === "GET") return getSpaces(env);
  if (p === "/api/admin/facility/bookings" && m === "GET") return listBookings(env, url);
  if (p === "/api/admin/facility/check" && m === "POST") return checkOnly(request, env);
  if (p === "/api/admin/facility/bookings" && m === "POST") return createBooking(request, env, ctx);
  const one = p.match(/^\/api\/admin\/facility\/bookings\/(\d+)$/);
  if (one && m === "PATCH") return updateBooking(request, env, ctx, Number(one[1]));
  if (one && m === "DELETE") return deleteBooking(env, ctx, Number(one[1]), url.searchParams.get("scope") || "one");
  if (p === "/api/admin/facility/import" && m === "POST") return importCsv(request, env, ctx);
  return null;
}

/* ---------- reference data ---------- */

async function getSpaces(env) {
  const spaces = (await env.DB.prepare(
    "SELECT id, name, kind, sort FROM spaces WHERE deleted_at IS NULL ORDER BY sort"
  ).all()).results;
  const presets = (await env.DB.prepare(
    "SELECT id, name, sort FROM space_presets WHERE deleted_at IS NULL ORDER BY sort"
  ).all()).results;
  const links = (await env.DB.prepare("SELECT preset_id, space_id FROM preset_spaces").all()).results;
  for (const pr of presets) pr.space_ids = links.filter(l => l.preset_id === pr.id).map(l => l.space_id);
  const operators = (await env.DB.prepare(
    "SELECT id, name, brand_json FROM orgs WHERE deleted_at IS NULL ORDER BY id"
  ).all()).results.map(o => {
    let b = {}; try { b = JSON.parse(o.brand_json || "{}"); } catch {}
    return { id: o.id, name: o.name, color: b.facility_color || "#7A7F87" };
  });
  return json({ ok: true, spaces, presets, operators });
}

/* ---------- bookings ---------- */

async function listBookings(env, url) {
  const from = (url.searchParams.get("from") || "").slice(0, 10);
  const to = (url.searchParams.get("to") || from).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return json({ error: "Provide from=YYYY-MM-DD (and optional to=)." }, 400);
  }
  const rows = (await env.DB.prepare(
    `SELECT b.*, o.name AS operator, o.brand_json
     FROM space_bookings b JOIN orgs o ON o.id = b.org_id
     WHERE b.date BETWEEN ?1 AND ?2 AND b.deleted_at IS NULL
     ORDER BY b.date, b.start_min`
  ).bind(from, to).all()).results;
  if (rows.length) {
    const ids = rows.map(r => r.id);
    const links = (await env.DB.prepare(
      `SELECT booking_id, space_id FROM booking_spaces WHERE booking_id IN (${ids.map(() => "?").join(",")})`
    ).bind(...ids).all()).results;
    for (const r of rows) {
      r.space_ids = links.filter(l => l.booking_id === r.id).map(l => l.space_id);
      let b = {}; try { b = JSON.parse(r.brand_json || "{}"); } catch {}
      r.color = b.facility_color || "#7A7F87";
      delete r.brand_json;
    }
  }
  return json({ ok: true, bookings: rows });
}

/** Overlap classifier. Returns { conflicts:[…], warnings:[…] } against live bookings. */
async function findConflicts(env, { date, start_min, end_min, space_ids, is_closure, share_ok, ignore_ids = [] }) {
  if (!space_ids.length) return { conflicts: [], warnings: [] };
  const rows = (await env.DB.prepare(
    `SELECT DISTINCT b.id, b.title, b.start_min, b.end_min, b.share_ok, b.is_closure, b.series_id, o.name AS operator
     FROM space_bookings b
     JOIN booking_spaces bs ON bs.booking_id = b.id
     JOIN orgs o ON o.id = b.org_id
     WHERE b.date = ?1 AND b.deleted_at IS NULL
       AND NOT (b.end_min <= ?2 OR b.start_min >= ?3)
       AND bs.space_id IN (${space_ids.map(() => "?").join(",")})`
  ).bind(date, start_min, end_min, ...space_ids).all()).results;
  const conflicts = [], warnings = [];
  for (const r of rows) {
    if (ignore_ids.includes(r.id)) continue;
    const hard = r.is_closure || is_closure || !(r.share_ok && share_ok);
    (hard ? conflicts : warnings).push({
      id: r.id, title: r.title, operator: r.operator,
      time: `${fmtMin(r.start_min)}–${fmtMin(r.end_min)}`,
      kind: r.is_closure ? "closure" : "booking",
    });
  }
  return { conflicts, warnings };
}

async function checkOnly(request, env) {
  const b = await body(request);
  const v = validateSlot(b); if (v) return json({ error: v }, 400);
  const space_ids = await resolveSpaces(env, b);
  if (!space_ids.length) return json({ error: "Pick at least one court or room (or a preset)." }, 400);
  const res = await findConflicts(env, { ...slot(b), space_ids, ignore_ids: b.ignore_id ? [Number(b.ignore_id)] : [] });
  return json({ ok: true, ...res });
}

async function createBooking(request, env, ctx) {
  const b = await body(request);
  const v = validateSlot(b); if (v) return json({ error: v }, 400);
  if (!b.title || !String(b.title).trim()) return json({ error: "Give the booking a title." }, 400);
  const org_id = Number(b.org_id) || 1;
  const space_ids = await resolveSpaces(env, b);
  if (!space_ids.length) return json({ error: "Pick at least one court or room (or a preset)." }, 400);

  // Expand weekly series
  const dates = [b.date];
  let series_id = null;
  if (b.repeat_weekly && b.repeat_until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.repeat_until)) return json({ error: "Repeat-until must be a date." }, 400);
    series_id = crypto.randomUUID();
    let d = new Date(b.date + "T00:00:00Z");
    const until = new Date(b.repeat_until + "T00:00:00Z");
    for (let i = 0; i < 52; i++) { // hard cap: one year of weeks
      d = new Date(d.getTime() + 7 * 86400000);
      if (d > until) break;
      dates.push(d.toISOString().slice(0, 10));
    }
  }

  // Conflict check every date first — never half-write a series.
  const problems = [];
  for (const date of dates) {
    const { conflicts, warnings } = await findConflicts(env, { ...slot(b), date, space_ids });
    if (conflicts.length) problems.push({ date, conflicts, hard: true });
    else if (warnings.length && !b.force) problems.push({ date, warnings, hard: false });
  }
  if (problems.length) {
    const anyHard = problems.some(p => p.hard);
    return json({
      error: anyHard ? "Booking conflicts with existing reservations." : "Time is shared with another booking.",
      hard: anyHard, problems,
      hint: anyHard ? "Change the time, courts, or Court Share settings." : "Send again with force:true (Book anyway) to accept the share.",
    }, 409);
  }

  const created = [];
  for (const date of dates) {
    const ins = await env.DB.prepare(
      `INSERT INTO space_bookings (org_id, event_id, title, date, start_min, end_min, preset_id, share_ok,
        is_closure, staffing_json, catering, door_charge_cents, poc_name, poc_email, poc_phone,
        est_attendees, series_id, notes)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`
    ).bind(
      org_id, b.event_id ? Number(b.event_id) : null, String(b.title).trim(), date,
      slot(b).start_min, slot(b).end_min, b.preset_id ? Number(b.preset_id) : null,
      b.share_ok ? 1 : 0, b.is_closure ? 1 : 0,
      JSON.stringify(b.staffing || {}), b.catering || null,
      b.door_charge_cents != null && b.door_charge_cents !== "" ? Number(b.door_charge_cents) : null,
      b.poc_name || null, b.poc_email || null, b.poc_phone || null,
      b.est_attendees ? Number(b.est_attendees) : null, series_id, b.notes || null
    ).run();
    const id = ins.meta.last_row_id;
    for (const sid of space_ids) {
      await env.DB.prepare("INSERT INTO booking_spaces (booking_id, space_id) VALUES (?1, ?2)").bind(id, sid).run();
    }
    created.push({ id, date });
  }
  await audit(env, ctx, "facility.book", "space_bookings", created[0].id,
    { title: b.title, dates: dates.length, spaces: space_ids.length, series_id });
  return json({ ok: true, created, series_id });
}

async function updateBooking(request, env, ctx, id) {
  const b = await body(request);
  const row = await env.DB.prepare("SELECT * FROM space_bookings WHERE id=?1 AND deleted_at IS NULL").bind(id).first();
  if (!row) return json({ error: "Booking not found." }, 404);

  const scope = b.scope === "series" && row.series_id ? "series" : "one";
  const targets = scope === "one" ? [row] : (await env.DB.prepare(
    "SELECT * FROM space_bookings WHERE series_id=?1 AND date>=?2 AND deleted_at IS NULL ORDER BY date"
  ).bind(row.series_id, row.date).all()).results;

  // Merge changes over existing values (date changes apply to 'one' scope only).
  const start_min = b.start != null || b.start_min != null ? slot(b, row).start_min : row.start_min;
  const end_min = b.end != null || b.end_min != null ? slot(b, row).end_min : row.end_min;
  if (end_min <= start_min) return json({ error: "End time must be after start time." }, 400);
  const share_ok = b.share_ok != null ? (b.share_ok ? 1 : 0) : row.share_ok;
  const is_closure = b.is_closure != null ? (b.is_closure ? 1 : 0) : row.is_closure;
  const space_ids = (b.space_ids || b.preset_id) ? await resolveSpaces(env, b)
    : (await env.DB.prepare("SELECT space_id FROM booking_spaces WHERE booking_id=?1").bind(id).all()).results.map(r => r.space_id);
  if (!space_ids.length) return json({ error: "A booking must reserve at least one court or room." }, 400);
  const newDate = scope === "one" && b.date ? String(b.date).slice(0, 10) : null;

  // Re-check conflicts for every affected row
  const problems = [];
  for (const t of targets) {
    const date = newDate || t.date;
    const { conflicts, warnings } = await findConflicts(env,
      { date, start_min, end_min, space_ids, is_closure, share_ok, ignore_ids: targets.map(x => x.id) });
    if (conflicts.length) problems.push({ date, conflicts, hard: true });
    else if (warnings.length && !b.force) problems.push({ date, warnings, hard: false });
  }
  if (problems.length) {
    const anyHard = problems.some(p => p.hard);
    return json({ error: anyHard ? "Change conflicts with existing reservations." : "Time is shared with another booking.",
      hard: anyHard, problems }, 409);
  }

  for (const t of targets) {
    await env.DB.prepare(
      `UPDATE space_bookings SET org_id=?1, title=?2, date=?3, start_min=?4, end_min=?5, preset_id=?6,
        share_ok=?7, is_closure=?8, staffing_json=?9, catering=?10, door_charge_cents=?11,
        poc_name=?12, poc_email=?13, poc_phone=?14, est_attendees=?15, notes=?16, updated_at=datetime('now')
       WHERE id=?17`
    ).bind(
      b.org_id != null ? Number(b.org_id) : t.org_id,
      b.title != null ? String(b.title).trim() : t.title,
      newDate || t.date, start_min, end_min,
      b.preset_id !== undefined ? (b.preset_id ? Number(b.preset_id) : null) : t.preset_id,
      share_ok, is_closure,
      b.staffing !== undefined ? JSON.stringify(b.staffing || {}) : t.staffing_json,
      b.catering !== undefined ? (b.catering || null) : t.catering,
      b.door_charge_cents !== undefined ? (b.door_charge_cents !== "" && b.door_charge_cents != null ? Number(b.door_charge_cents) : null) : t.door_charge_cents,
      b.poc_name !== undefined ? (b.poc_name || null) : t.poc_name,
      b.poc_email !== undefined ? (b.poc_email || null) : t.poc_email,
      b.poc_phone !== undefined ? (b.poc_phone || null) : t.poc_phone,
      b.est_attendees !== undefined ? (b.est_attendees ? Number(b.est_attendees) : null) : t.est_attendees,
      b.notes !== undefined ? (b.notes || null) : t.notes,
      t.id
    ).run();
    if (b.space_ids || b.preset_id) {
      await env.DB.prepare("DELETE FROM booking_spaces WHERE booking_id=?1").bind(t.id).run();
      for (const sid of space_ids) {
        await env.DB.prepare("INSERT INTO booking_spaces (booking_id, space_id) VALUES (?1, ?2)").bind(t.id, sid).run();
      }
    }
  }
  await audit(env, ctx, "facility.update", "space_bookings", id, { scope, rows: targets.length });
  return json({ ok: true, updated: targets.length, scope });
}

async function deleteBooking(env, ctx, id, scope) {
  const row = await env.DB.prepare("SELECT * FROM space_bookings WHERE id=?1 AND deleted_at IS NULL").bind(id).first();
  if (!row) return json({ error: "Booking not found." }, 404);
  let n = 1;
  if (scope === "series" && row.series_id) {
    const res = await env.DB.prepare(
      "UPDATE space_bookings SET deleted_at=datetime('now') WHERE series_id=?1 AND date>=?2 AND deleted_at IS NULL"
    ).bind(row.series_id, row.date).run();
    n = res.meta.changes;
  } else {
    await env.DB.prepare("UPDATE space_bookings SET deleted_at=datetime('now') WHERE id=?1").bind(id).run();
  }
  await audit(env, ctx, "facility.delete", "space_bookings", id, { scope, rows: n });
  return json({ ok: true, deleted: n, scope });
}

/* ---------- CSV import ---------- */

const HEADER_MAP = [
  [/^date$/i, "date"], [/^start( time)?$/i, "start"], [/^end( time)?$/i, "end"],
  [/^(title|event( name)?)$/i, "title"], [/^(operator|org(anization)?)$/i, "operator"],
  [/^(booked as|preset|spaces?|courts?)$/i, "spaces"], [/^(court )?share$/i, "share"],
  [/^(facility )?staff(ing)?( level)?$/i, "staff"], [/^bar( staff)?$/i, "bar"],
  [/^catering$/i, "catering"], [/^door( charge)?$/i, "door"],
  [/^poc( name)?$/i, "poc_name"], [/^poc email$/i, "poc_email"], [/^poc phone$/i, "poc_phone"],
  [/^(est(imated)? )?attendees$/i, "attendees"], [/^notes?$/i, "notes"],
  [/^(repeat|series)$/i, "repeat"], [/^(closure|closed)$/i, "closure"],
];

async function importCsv(request, env, ctx) {
  const b = await body(request);
  if (!b.csv || typeof b.csv !== "string") return json({ error: "Paste CSV text in the csv field." }, 400);
  const rows = parseCsv(b.csv);
  if (rows.length < 2) return json({ error: "CSV needs a header row plus at least one data row." }, 400);

  // Map headers
  const header = rows[0].map(h => {
    const clean = h.trim();
    for (const [re, key] of HEADER_MAP) if (re.test(clean)) return key;
    return null; // unmapped columns ignored (the 38-col template has many we don't ingest)
  });
  const need = ["date", "start", "end", "title", "operator"];
  const missing = need.filter(k => !header.includes(k));
  if (missing.length) return json({ error: `CSV is missing required column(s): ${missing.join(", ")}.` }, 400);

  const { presets } = await refData(env);
  const spaces = (await env.DB.prepare("SELECT id, name FROM spaces WHERE deleted_at IS NULL").all()).results;
  const orgs = (await env.DB.prepare("SELECT id, name, slug FROM orgs WHERE deleted_at IS NULL").all()).results;

  const results = { imported: 0, skipped: [], errors: [] };
  for (let i = 1; i < rows.length; i++) {
    const line = i + 1;
    const r = {};
    rows[i].forEach((cell, ci) => { if (header[ci]) r[header[ci]] = cell.trim(); });
    if (!Object.values(r).some(v => v)) continue; // blank line

    const date = parseDate(r.date);
    const start_min = parseTime(r.start), end_min = parseTime(r.end);
    if (!date) { results.errors.push({ line, error: `Unreadable date "${r.date}".` }); continue; }
    if (start_min == null || end_min == null || end_min <= start_min) {
      results.errors.push({ line, error: `Bad time range "${r.start}"–"${r.end}".` }); continue;
    }
    if (!r.title) { results.errors.push({ line, error: "Missing title." }); continue; }
    const org = orgs.find(o => o.name.toLowerCase() === (r.operator || "").toLowerCase()
      || o.slug === (r.operator || "").toLowerCase()
      || o.name.toLowerCase().includes((r.operator || "").toLowerCase()) && r.operator);
    if (!org) { results.errors.push({ line, error: `Unknown operator "${r.operator}".` }); continue; }
    const space_ids = parseSpacesText(r.spaces || "", presets, spaces);
    if (!space_ids.length) { results.errors.push({ line, error: `No courts/rooms recognized in "${r.spaces || ""}".` }); continue; }

    const share_ok = /^(y|yes|1|true|share)/i.test(r.share || "") ? 1 : 0;
    const is_closure = /^(y|yes|1|true)/i.test(r.closure || "") ? 1 : 0;
    const { conflicts, warnings } = await findConflicts(env, { date, start_min, end_min, space_ids, is_closure, share_ok });
    if (conflicts.length) { results.skipped.push({ line, reason: "Hard conflict", with: conflicts.map(c => c.title) }); continue; }

    if (!b.dry_run) {
      const ins = await env.DB.prepare(
        `INSERT INTO space_bookings (org_id, title, date, start_min, end_min, share_ok, is_closure,
          staffing_json, catering, door_charge_cents, poc_name, poc_email, poc_phone, est_attendees, notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`
      ).bind(org.id, r.title, date, start_min, end_min, share_ok, is_closure,
        JSON.stringify({ facility: num(r.staff), bar: num(r.bar) }),
        r.catering || null, r.door ? Math.round(parseFloat(String(r.door).replace(/[$,]/g, "")) * 100) || null : null,
        r.poc_name || null, r.poc_email || null, r.poc_phone || null,
        num(r.attendees), r.notes || null).run();
      for (const sid of space_ids) {
        await env.DB.prepare("INSERT INTO booking_spaces (booking_id, space_id) VALUES (?1, ?2)").bind(ins.meta.last_row_id, sid).run();
      }
    }
    results.imported++;
    if (warnings.length) results.skipped.push({ line, reason: "Imported as shared time", with: warnings.map(w => w.title) });
  }
  if (!b.dry_run) await audit(env, ctx, "facility.import", "space_bookings", null,
    { imported: results.imported, errors: results.errors.length });
  return json({ ok: true, dry_run: !!b.dry_run, ...results });
}

/* ---------- helpers ---------- */

async function refData(env) {
  const presets = (await env.DB.prepare("SELECT id, name FROM space_presets WHERE deleted_at IS NULL").all()).results;
  const links = (await env.DB.prepare("SELECT preset_id, space_id FROM preset_spaces").all()).results;
  for (const p of presets) p.space_ids = links.filter(l => l.preset_id === p.id).map(l => l.space_id);
  return { presets };
}

/** Accepts { space_ids:[…] } and/or { preset_id } → union of atoms. */
async function resolveSpaces(env, b) {
  const out = new Set((b.space_ids || []).map(Number).filter(Boolean));
  if (b.preset_id) {
    const links = (await env.DB.prepare("SELECT space_id FROM preset_spaces WHERE preset_id=?1")
      .bind(Number(b.preset_id)).all()).results;
    for (const l of links) out.add(l.space_id);
  }
  return [...out];
}

function validateSlot(b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) return "Date must be YYYY-MM-DD.";
  const s = slot(b);
  if (s.start_min == null || s.end_min == null) return "Provide start and end times.";
  if (s.end_min <= s.start_min) return "End time must be after start time.";
  return null;
}

/** Normalizes {start:"18:00"|start_min} → minutes. */
function slot(b, fallback = {}) {
  const start_min = b.start_min != null ? Number(b.start_min) : (b.start != null ? parseTime(b.start) : fallback.start_min);
  const end_min = b.end_min != null ? Number(b.end_min) : (b.end != null ? parseTime(b.end) : fallback.end_min);
  return { date: b.date, start_min, end_min, is_closure: b.is_closure ? 1 : 0, share_ok: b.share_ok ? 1 : 0 };
}

function parseTime(t) {
  if (t == null || t === "") return null;
  const s = String(t).trim();
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampm) {
    let h = Number(ampm[1]) % 12; if (/pm/i.test(ampm[3])) h += 12;
    return h * 60 + Number(ampm[2] || 0);
  }
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  return null;
}

function parseDate(d) {
  if (!d) return null;
  const iso = String(d).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = String(d).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const y = us[3].length === 2 ? "20" + us[3] : us[3];
    return `${y}-${String(us[1]).padStart(2, "0")}-${String(us[2]).padStart(2, "0")}`;
  }
  return null;
}

/** "Full Hardwood", "VB 1-8", "VB 1, VB 3", "Yoga-Den" → atom ids. */
function parseSpacesText(text, presets, spaces) {
  const out = new Set();
  const t = text.trim();
  if (!t) return [];
  const preset = presets.find(p => p.name.toLowerCase().includes(t.toLowerCase())
    || t.toLowerCase().includes(p.name.toLowerCase().replace(/\s*\(.*\)$/, "").trim()));
  if (preset) { preset.space_ids.forEach(id => out.add(id)); return [...out]; }
  const range = t.match(/vb\s*(\d{1,2})\s*[-–]\s*(?:vb\s*)?(\d{1,2})/i);
  if (range) {
    for (let n = Number(range[1]); n <= Number(range[2]); n++) {
      const sp = spaces.find(s => s.name.toLowerCase() === `vb ${n}`); if (sp) out.add(sp.id);
    }
  }
  for (const part of t.split(/[,;+]/)) {
    const clean = part.trim().toLowerCase();
    if (!clean) continue;
    const sp = spaces.find(s => s.name.toLowerCase() === clean || s.name.toLowerCase() === clean.replace(/^court\s*/, "vb "));
    if (sp) out.add(sp.id);
  }
  return [...out];
}

/** Minimal CSV parser handling quoted cells and CRLF. */
function parseCsv(text) {
  const rows = []; let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x !== "")) rows.push(row);
  return rows;
}

function num(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function fmtMin(m) { const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0"); const ap = h >= 12 ? "PM" : "AM"; return `${((h + 11) % 12) + 1}:${mm} ${ap}`; }
async function body(request) { try { return await request.json(); } catch { return {}; } }

/* exported for worker/test/facility.test.mjs */
export { findConflicts, parseTime, parseDate, parseSpacesText, parseCsv };

/* Changelog: v1.0 (2026-07-24) — Module 12 Phase A: spaces/presets, conflict engine,
   bookings CRUD w/ weekly series, closures, header-mapped CSV importer. */
