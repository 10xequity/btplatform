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

let json, audit, requireStaff, sendEmail, escapeHtml, ensureEventSquareItem;
export function wireEventsAdmin(h) { ({ json, audit, requireStaff, sendEmail, escapeHtml, ensureEventSquareItem } = h); }

/* K-15: fold ensureEventSquareItem outcomes into one human sentence, or nothing. `undefined`
   drops out of the JSON payload, so a response only carries square_note when a person should
   read it — created items are counted, the first warning is quoted, silence means silence. */
function squareNoteFrom(outcomes) {
  const real = outcomes.filter(Boolean);
  const created = real.filter((o) => o.created).length;
  const warning = (real.find((o) => o.warning) || {}).warning;
  if (!created && !warning) return undefined;
  return [created ? `Square: created ${created} catalog item${created === 1 ? "" : "s"}.` : null, warning]
    .filter(Boolean).join(" ");
}

/* The registration statuses that mean "this person is coming" — read from the schema's CHECK
   constraint, not guessed. A registration the member already cancelled hears nothing. */
const ACTIVE_REG = "('pending','email-sent','paid','cash-pending','comped')";

/**
 * Tell an event's active registrants something happened. First caller: cancellation (§-0 B16).
 * Deliberately shaped as the substrate for the owner's 2026-08-10 requirement that an event
 * screen can "contact and email the participants with information or news" — the recipient
 * selection is the reusable part, the cancellation copy is just this caller's message.
 *
 * Always writes in-app notification rows (the inbox needs no mail key). Emails only when
 * BREVO_API_KEY exists AND the contact has an address — and the returned note SAYS what did not
 * happen, because a control that reports success it did not achieve is this project's
 * most-paid-for defect. One notification per member per event: two teams, one message.
 */
export async function notifyEventCancelled(env, ctx, eventIds, orgId = ctx.orgId) {
  const out = { notified: 0, with_email: 0, emailed: 0, note: "" };
  const ids = (eventIds || []).map(Number).filter(Boolean);
  if (!ids.length) { out.note = "No events needed notifications."; return out; }

  const rows = await activeRegistrantsOf(env, orgId, ids);

  for (const r of rows) {
    await env.DB.prepare(
      `INSERT INTO notifications (org_id, kind, target, contact_id, title, body, link, payload_json, sent_at)
       VALUES (?1,'event_cancelled','member',?2,?3,?4,'home.html',?5,datetime('now'))`
    ).bind(orgId, r.contact_id, `Cancelled: ${r.event_name}`,
      `${r.event_name} has been cancelled. Sorry for the change of plans — any follow-up from the organizers will land here.`,
      JSON.stringify({ event_id: r.event_id })).run();
    out.notified++;
    if (r.email) {
      out.with_email++;
      if (env.BREVO_API_KEY) {
        const first = String(r.full_name || "").split(/\s+/)[0] || "there";
        const ok = await sendEmail(env, r.email, `Cancelled: ${r.event_name}`,
          `<p>Hi ${escapeHtml(first)},</p><p>${escapeHtml(r.event_name)} has been cancelled. Sorry for the change of plans.</p>`,
          orgId);
        if (ok) out.emailed++;
      }
    }
  }

  out.note = emailHonestyNote(env, out);
  await audit(env, ctx, "event.cancel_notified", "events", ids[0],
    { events: ids, notified: out.notified, with_email: out.with_email, emailed: out.emailed });
  return out;
}

/**
 * The ONE recipient selection — SG-5 made B16's promised reuse real. Both notifiers (cancel,
 * news) read this and nothing else, so "who gets told" can never mean two different sets. One
 * row per member per event (DISTINCT): two teams, one message. Statuses are ACTIVE_REG — a
 * registration the member already cancelled hears nothing, from either caller.
 */
async function activeRegistrantsOf(env, orgId, ids) {
  const ph = ids.map((_, i) => `?${i + 2}`).join(",");
  return (await env.DB.prepare(
    `SELECT DISTINCT r.event_id, r.contact_id, c.email, c.full_name, e.name AS event_name
       FROM registrations r
       JOIN contacts c ON c.id = r.contact_id AND c.deleted_at IS NULL
       JOIN events e   ON e.id = r.event_id
      WHERE r.org_id = ?1 AND r.event_id IN (${ph}) AND r.deleted_at IS NULL
        AND r.status IN ${ACTIVE_REG}`
  ).bind(orgId, ...ids).all()).results || [];
}

/** The mail-key honesty, verbatim across both notifiers — a control that reports success it
    did not achieve is this project's most-paid-for defect, and it must not creep back through
    a second spelling of these sentences. */
function emailHonestyNote(env, out) {
  return env.BREVO_API_KEY
    ? `Emailed ${out.emailed} of ${out.with_email} member(s) with an address.`
    : (out.with_email
      ? `${out.with_email} member(s) have an email address, but no mail key is set — nothing was emailed. Everyone still sees this in their member inbox.`
      : "No email addresses on file — members will see this in their member inbox.");
}

/**
 * SG-5 (§-1o), the owner's 23:09 requirement: "That screen also needs to be able to contact and
 * email the participants with information or news." B16's second caller, as its header promised
 * — same selection, same honesty sentences, the operator's own words as the body. The inbox
 * renderer (home.js) escapes title and body, and the email path runs escapeHtml, so typed text
 * cannot become markup on either surface.
 */
export async function notifyEventParticipants(env, ctx, eventId, message, orgId = ctx.orgId) {
  const out = { notified: 0, with_email: 0, emailed: 0, note: "" };
  const rows = await activeRegistrantsOf(env, orgId, [Number(eventId)]);
  if (!rows.length) {
    out.note = "Nobody is signed up yet, so there was no one to tell.";
    await audit(env, ctx, "event.participants_notified", "events", Number(eventId),
      { notified: 0, with_email: 0, emailed: 0, chars: message.length });
    return out;
  }
  for (const r of rows) {
    await env.DB.prepare(
      `INSERT INTO notifications (org_id, kind, target, contact_id, title, body, link, payload_json, sent_at)
       VALUES (?1,'event_news','member',?2,?3,?4,'home.html',?5,datetime('now'))`
    ).bind(orgId, r.contact_id, `Update: ${r.event_name}`, message,
      JSON.stringify({ event_id: r.event_id })).run();
    out.notified++;
    if (r.email) {
      out.with_email++;
      if (env.BREVO_API_KEY) {
        const first = String(r.full_name || "").split(/\s+/)[0] || "there";
        const ok = await sendEmail(env, r.email, `Update: ${r.event_name}`,
          `<p>Hi ${escapeHtml(first)},</p><p>${escapeHtml(message)}</p><p>— about ${escapeHtml(r.event_name)}</p>`,
          orgId);
        if (ok) out.emailed++;
      }
    }
  }
  out.note = emailHonestyNote(env, out);
  await audit(env, ctx, "event.participants_notified", "events", Number(eventId),
    { notified: out.notified, with_email: out.with_email, emailed: out.emailed, chars: message.length });
  return out;
}

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
  if ((match = p.match(/^\/api\/events\/(\d+)\/notify$/)) && m === "POST") return notifyParticipants(request, env, ctx, +match[1]);

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

/* SG-5: the route behind the event screen's "Message everyone signed up" card. Gates on the
   EVENT'S org (patchEvent's shape — the event decides whose staff may speak to its people).
   Refusals are sentences and write nothing; the honest zero is a 200, because an empty guest
   list is not a failure. */
async function notifyParticipants(request, env, ctx, eventId) {
  const ev = await env.DB.prepare("SELECT id, org_id FROM events WHERE id=?1 AND deleted_at IS NULL").bind(eventId).first();
  if (!ev) return json({ error: "Event not found." }, 404);
  const deny = await requireStaff(env, ctx, ev.org_id);
  if (deny) return deny;
  const b = await request.json().catch(() => ({}));
  const message = String(b.message || "").trim();
  if (!message) return json({ error: "Write the message first — nothing was sent." }, 400);
  if (message.length > 2000) return json({ error: "Keep the message under 2,000 characters — nothing was sent." }, 400);
  const out = await notifyEventParticipants(env, ctx, eventId, message, ev.org_id);
  return json({ ok: true, ...out });
}

/* ---------- shared ---------- */

/* v0.174.0 (§-1c D-53): "ends_at" joins the list — it was stripped here before insertEvent's
   bag.ends_at bind could see it, making that bind dead code and every bulk/recurring row NULL. */
const EVENT_FIELDS = ["type", "name", "location", "price_cents", "capacity", "court_count", "format_template", "cash_option_enabled", "config_json", "program_id", "external_url", "external_label", "min_signups", "ends_at"];

/**
 * SG-2 (§-1o): the ONE spelling of what a threshold may be — a whole number of sign-ups, 1 or
 * more; anything else (junk, 0, negatives) means "no minimum" and stores NULL, matching the UI,
 * which sends 0 for an emptied field. Exported because the rule sits on two write paths:
 * cleanEventBag here (create / duplicate / bulk / series) and tournaments.js's patchEvent (the
 * event page's own save). min_signups is the FLOOR of the band whose CEILING is `capacity`.
 */
export function cleanMinSignups(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}

/**
 * D-34 (§-1c): the ONE spelling of what a price or capacity may be, on every route that writes
 * them. Junk is REFUSED in a sentence, never coerced — this differs from cleanMinSignups on
 * purpose: junk clearing a threshold turns a feature off, but junk silently making an event
 * FREE or UNLIMITED changes money and admission. Price 0 = free and capacity NULL = unlimited
 * are the UI's own conventions (an emptied field sends exactly those). Mutates the bag in
 * place; returns a refusal sentence, or null when the state is fine.
 */
export function cleanPriceCapacity(bag) {
  if ("price_cents" in bag) {
    if (bag.price_cents === null || bag.price_cents === "") bag.price_cents = 0;
    const p = Number(bag.price_cents);
    if (!Number.isFinite(p) || p < 0) return "Price must be zero or more dollars — nothing was saved.";
    bag.price_cents = Math.round(p);
  }
  if ("capacity" in bag) {
    if (bag.capacity === null || bag.capacity === "") {
      bag.capacity = null;
    } else {
      const c = Number(bag.capacity);
      if (!Number.isFinite(c) || Math.round(c) < 1) {
        return "Capacity must be a whole number of one or more — leave it empty for unlimited.";
      }
      bag.capacity = Math.round(c);
    }
  }
  return null;
}

function cleanEventBag(src) {
  const out = {};
  for (const k of EVENT_FIELDS) if (k in src && src[k] !== undefined) out[k] = src[k];
  if (out.type && !TYPES.includes(out.type)) delete out.type;
  if ("min_signups" in out) out.min_signups = cleanMinSignups(out.min_signups);
  return out;
}

/**
 * §-1m PM-1 rule 3: "it must be impossible to set both a price and an external URL, or the
 * product contradicts itself." Returns a sentence to refuse with, or null when the state is fine.
 *
 * IT TAKES THE RESULTING STATE, NOT THE REQUEST. A write carrying only `external_url`, aimed at
 * an event that is already priced, contains one field and still produces the contradiction — and
 * live D1 on 2026-08-13 had 6 of 7 events priced, so that is the common path rather than a
 * corner. Every caller merges the stored row with the incoming bag and passes the ANSWER here.
 *
 * EXPORTED BECAUSE THE TWO HALVES OF THE RULE SIT ON TWO WRITE PATHS. `price_cents` is settable
 * through this module (bulk edit, create, duplicate); `external_url` is settable through
 * `tournaments.js`'s patchEvent, which is the route the admin event page calls. Two copies of one
 * judgement is how they come to disagree, so there is one function and two importers.
 */
export function externalPriceConflict(next) {
  const url = String((next && next.external_url) == null ? "" : next.external_url).trim();
  const price = Number((next && next.price_cents) || 0);
  if (url && price > 0) {
    return "An event can have a price or an outside registration link, not both — we cannot take "
      + "a payment for a sign-up that happens somewhere else. Clear one before setting the other.";
  }
  return null;
}

async function loadOrgEvent(env, ctx, id) {
  const ev = await env.DB.prepare("SELECT * FROM events WHERE id=?1 AND deleted_at IS NULL").bind(id).first();
  return ev && ev.org_id === ctx.orgId ? ev : null;
}

/**
 * Returns { id, square } — square is ensureEventSquareItem's outcome for a priced insert, null
 * otherwise. K-15's creation hook lives HERE because this is the one INSERT all four creation
 * paths flow through (duplicate, recurring, bulk import, templates-via-duplicate); a hook at the
 * callers is a hook the fifth caller forgets. The return SHAPE changed with it, deliberately —
 * every caller had to be visited (PM-1's shape-not-arity lesson). The Square write happens after
 * the INSERT and never throws, so a Square outage cannot cost the operator their event.
 */
async function insertEvent(env, orgId, bag, startsAt, seriesId, recurrenceJson, status) {
  const r = await env.DB.prepare(
    `INSERT INTO events (org_id, type, name, starts_at, ends_at, location, capacity, court_count,
       format_template, config_json, status, cash_option_enabled, price_cents, series_id, recurrence_json, program_id, min_signups)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`
  ).bind(
    orgId, bag.type || "event", bag.name || "Untitled event", startsAt || null, bag.ends_at || null,
    bag.location || null, bag.capacity || null, bag.court_count || null, bag.format_template || null,
    bag.config_json || "{}", status || "draft", bag.cash_option_enabled ? 1 : 0, bag.price_cents || 0,
    seriesId || null, recurrenceJson || null, bag.program_id || null, bag.min_signups ?? null
  ).run();
  const id = r.meta.last_row_id;
  const square = Number(bag.price_cents) > 0 ? await ensureEventSquareItem(env, id) : null;
  return { id, square };
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
  const { id, square } = await insertEvent(env, ctx.orgId, bag, b.starts_at || ev.starts_at, null, null, "draft");

  // The LIVE division structure rides along (v0.127.0). For the owner's stated use case — "set up
  // next season from this one" — the divisions ARE the configuration: Open/A/BB, their order,
  // their court ranges. Until now the copy took only the events row, so every season began by
  // retyping them. The boundary stays absolute in the other direction: teams, registrations,
  // matches and standings are a SEASON, never configuration, and none of them is read here —
  // a duplicate that brought registrations along would re-register a whole field in one press.
  const divs = (await env.DB.prepare(
    `SELECT name, rank, court_from, court_to, target_bracket_size, notes FROM divisions
      WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL ORDER BY rank, id`
  ).bind(ctx.orgId, eventId).all()).results || [];
  for (const d of divs) {
    await env.DB.prepare(
      `INSERT INTO divisions (org_id, event_id, name, rank, court_from, court_to, target_bracket_size, notes)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
    ).bind(ctx.orgId, id, d.name, d.rank, d.court_from, d.court_to, d.target_bracket_size, d.notes).run();
  }

  await audit(env, ctx, "event.duplicated", "event", id, { from: eventId, divisions: divs.length });
  // K-15: a duplicate's SUCCESSFUL item is silent (the operator lands on the new event; the item
  // is visible in Square) — only a warning is worth interrupting the navigation for.
  return json({ ok: true, id, divisions: divs.length, square_note: square && square.warning ? square.warning : undefined });
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
  /* v0.174.0 (§-1c D-53): each instance's ends_at derives from its OWN date + the base's end
     TIME-OF-DAY. The base's ends_at verbatim would stamp instance 1's end on every instance —
     a January end on a March night, wrong in both directions for RF-4b's date rule. A series
     night ends the same day it starts; base ends_at absent → instances stay NULL (unknown). */
  const endsForInstance = (startsAt) =>
    bag.ends_at && startsAt ? `${String(startsAt).slice(0, 10)} ${String(bag.ends_at).slice(11, 16)}` : null;
  const ids = [], squares = [];
  for (const dt of dates) {
    const { id, square } = await insertEvent(env, ctx.orgId, { ...bag, ends_at: endsForInstance(dt) }, dt, seriesId, JSON.stringify(rule), b.status || "draft");
    ids.push(id); squares.push(square);
  }
  await audit(env, ctx, "series.created", "event", ids[0], { series_id: seriesId, instances: ids.length, rule });
  return json({ ok: true, series_id: seriesId, event_ids: ids, count: ids.length, square_note: squareNoteFrom(squares) });
}

async function editSeries(request, env, ctx, seriesId) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const from = await loadOrgEvent(env, ctx, Number(b.from_event_id));
  if (!from || from.series_id !== seriesId) return json({ error: "That event isn't part of this series (or not in this org)." }, 404);
  const bag = cleanEventBag(b.fields || {});
  // D-34's junk rule rides every writer of price/capacity — one spelling, refused in a sentence.
  const pcErr = cleanPriceCapacity(bag);
  if (pcErr) return json({ error: pcErr }, 400);
  // D-35: this was the third write path that skipped PM-1's rule 3 — a set-based UPDATE across
  // "this and future" could price an outward instance (or point a priced one outward). The check
  // is the RESULT PER INSTANCE (bulkEdit's clash shape, both directions): the incoming value
  // wins where present, the stored one otherwise, and ONE clash refuses the WHOLE write —
  // a half-applied series edit leaves the operator guessing which sessions took it.
  const touchesPrice = "price_cents" in bag, touchesUrl = "external_url" in bag;
  if (touchesPrice || touchesUrl) {
    const rows = (await env.DB.prepare(
      `SELECT id, starts_at, price_cents, external_url FROM events
        WHERE series_id=?1 AND org_id=?2 AND starts_at>=?3 AND deleted_at IS NULL`
    ).bind(seriesId, ctx.orgId, from.starts_at).all()).results || [];
    const clash = rows.filter((e) => externalPriceConflict({
      external_url: touchesUrl ? bag.external_url : e.external_url,
      price_cents: touchesPrice ? bag.price_cents : e.price_cents,
    }));
    if (clash.length) {
      return json({
        error: externalPriceConflict({ external_url: "x", price_cents: 1 })
          + ` ${clash.length === 1 ? "One session clashes" : `${clash.length} sessions clash`} (`
          + clash.map((e) => String(e.starts_at || "").slice(0, 10)).join(", ")
          + "); nothing in the series was changed.",
      }, 400);
    }
  }
  const extra = {};
  if (b.fields && b.fields.status && STATUSES.includes(b.fields.status)) extra.status = b.fields.status;
  const sets = [], vals = [];
  /* v0.174.0 (§-1c D-53): a series edit carrying ends_at derives PER ROW — each instance's own
     date + the incoming end TIME-OF-DAY (createRecurring's endsForInstance rule, in SQL). The
     set-based UPDATE would otherwise stamp one verbatim datetime across different nights. An
     incoming value with no time part is refused in a sentence, never guessed. */
  if ("ends_at" in bag) {
    const endTime = String(bag.ends_at ?? "").slice(11, 16);
    if (bag.ends_at !== null && !/^\d\d:\d\d$/.test(endTime)) {
      return json({ error: "To change when series nights end, send a full date-and-time — its time of day is applied to each night's own date." }, 400);
    }
    delete bag.ends_at;
    if (endTime) { vals.push(endTime); sets.push(`ends_at = date(starts_at) || ' ' || ?${vals.length}`); }
    else sets.push("ends_at = NULL");
  }
  for (const [k, v] of Object.entries({ ...bag, ...extra })) { vals.push(v); sets.push(`${k}=?${vals.length}`); }
  if (!sets.length) return json({ error: "Nothing to update." }, 400);
  vals.push(seriesId, ctx.orgId, from.starts_at);
  const r = await env.DB.prepare(
    `UPDATE events SET ${sets.join(",")}, updated_at=datetime('now')
     WHERE series_id=?${vals.length - 2} AND org_id=?${vals.length - 1} AND starts_at>=?${vals.length} AND deleted_at IS NULL`
  ).bind(...vals).run();
  await audit(env, ctx, "series.edited", "event", from.id, { series_id: seriesId, fields: Object.keys(bag) });
  // K-15's hook, fourth pricing writer: a series priced HERE used to get no catalog items until
  // a bulk reprice — the exact missed moment D-35's record named. The hook re-reads each row and
  // is idempotent and keyless-silent, so every instance can be offered safely.
  let squares = [];
  if (touchesPrice && Number(bag.price_cents) > 0) {
    const ids = (await env.DB.prepare(
      `SELECT id FROM events WHERE series_id=?1 AND org_id=?2 AND starts_at>=?3 AND deleted_at IS NULL`
    ).bind(seriesId, ctx.orgId, from.starts_at).all()).results || [];
    for (const e of ids) squares.push(await ensureEventSquareItem(env, e.id));
  }
  return json({ ok: true, updated: r.meta.changes, square_note: squareNoteFrom(squares) });
}

async function cancelSeries(env, ctx, seriesId, url) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const from = await loadOrgEvent(env, ctx, Number(url.searchParams.get("from_event_id")));
  if (!from || from.series_id !== seriesId) return json({ error: "That event isn't part of this series (or not in this org)." }, 404);
  // Capture who is actually TRANSITIONING before the write — an instance already cancelled must
  // not have its registrants re-notified by a second sweep of the same series (B16).
  const affected = ((await env.DB.prepare(
    `SELECT id FROM events
      WHERE series_id=?1 AND org_id=?2 AND starts_at>=?3 AND deleted_at IS NULL AND status != 'cancelled'`
  ).bind(seriesId, ctx.orgId, from.starts_at).all()).results || []).map((e) => e.id);
  const r = await env.DB.prepare(
    `UPDATE events SET status='cancelled', updated_at=datetime('now')
     WHERE series_id=?1 AND org_id=?2 AND starts_at>=?3 AND deleted_at IS NULL`
  ).bind(seriesId, ctx.orgId, from.starts_at).run();
  const notice = await notifyEventCancelled(env, ctx, affected);
  await audit(env, ctx, "series.cancelled", "event", from.id, { series_id: seriesId });
  return json({ ok: true, cancelled: r.meta.changes, cancelled_notice: notice });
}

/* ---------- bulk ---------- */

async function bulkCreate(request, env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, MAX_BULK) : [];
  if (!rows.length) return json({ error: "No rows to import." }, 400);
  const created = [], skipped = [], squares = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.name || !r.starts_at) { skipped.push({ row: i + 1, reason: "Missing name or date" }); continue; }
    const bag = cleanEventBag(r);
    if (r.price != null && r.price_cents == null) bag.price_cents = Math.round(Number(r.price) * 100) || 0;
    const status = STATUSES.includes(r.status) ? r.status : "draft";
    try {
      const { id, square } = await insertEvent(env, ctx.orgId, bag, r.starts_at, null, null, status);
      created.push(id); squares.push(square);
    } catch (e) { skipped.push({ row: i + 1, reason: "Database rejected the row" }); }
  }
  await audit(env, ctx, "events.bulk_created", "event", created[0] || 0, { count: created.length, skipped: skipped.length });
  return json({ ok: true, created: created.length, skipped, square_note: squareNoteFrom(squares) });
}

async function bulkEdit(request, env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, MAX_BULK);
  if (!ids.length) return json({ error: "Select at least one event." }, 400);
  const f = b.fields || {};
  const sets = [], vals = [];
  if (f.status && STATUSES.includes(f.status)) { vals.push(f.status); sets.push(`status=?${vals.length}`); }
  // PM-1 rule 3, the price half. This is the ONE route that can put a price on an event, so it is
  // the one that can price an event registering somewhere else. Any id in the batch that already
  // points outward refuses the whole write rather than pricing some of them — a bulk edit that
  // half-applied would leave the operator guessing which.
  if (f.price_cents != null && Number(f.price_cents) > 0) {
    const ph = ids.map((_, i) => `?${i + 2}`).join(",");
    const clash = (await env.DB.prepare(
      `SELECT name FROM events WHERE org_id=?1 AND id IN (${ph}) AND deleted_at IS NULL
         AND external_url IS NOT NULL AND TRIM(external_url) <> ''`
    ).bind(ctx.orgId, ...ids).all()).results || [];
    if (clash.length) {
      return json({
        error: externalPriceConflict({ external_url: "x", price_cents: Number(f.price_cents) })
          + ` ${clash.length === 1 ? "One event registers" : `${clash.length} events register`} elsewhere: `
          + clash.map((e) => e.name).join(", ") + ".",
      }, 400);
    }
  }
  if (f.price_cents != null) { vals.push(Number(f.price_cents) || 0); sets.push(`price_cents=?${vals.length}`); }
  if (f.location != null) { vals.push(f.location); sets.push(`location=?${vals.length}`); }
  if (f.program_id !== undefined) { vals.push(f.program_id || null); sets.push(`program_id=?${vals.length}`); }
  if (!sets.length) return json({ error: "Nothing to update. Bulk edit supports status, price, location, program." }, 400);
  // B16: when this bulk sets status to cancelled, only the events TRANSITIONING into it get their
  // registrants notified — one already cancelled in the batch stays silent (a re-save is not news).
  let toNotify = [];
  if (f.status === "cancelled") {
    const ph = ids.map((_, i) => `?${i + 2}`).join(",");
    toNotify = ((await env.DB.prepare(
      `SELECT id FROM events WHERE org_id=?1 AND id IN (${ph}) AND deleted_at IS NULL AND status != 'cancelled'`
    ).bind(ctx.orgId, ...ids).all()).results || []).map((e) => e.id);
  }
  const idPh = ids.map((_, i) => `?${vals.length + i + 2}`).join(",");
  vals.push(ctx.orgId, ...ids);
  const r = await env.DB.prepare(
    `UPDATE events SET ${sets.join(",")}, updated_at=datetime('now')
     WHERE org_id=?${sets.length + 1} AND id IN (${idPh}) AND deleted_at IS NULL`
  ).bind(...vals).run();
  const notice = toNotify.length ? await notifyEventCancelled(env, ctx, toNotify) : undefined;
  // K-15: this is the one route that can price an EXISTING event, so it is where an already-live
  // event earns its Square catalog item. After the UPDATE, on the RESULT — ensure re-reads each
  // row, so an id that ended up unpriced, external or already-itemed skips itself.
  let squareNote;
  if (f.price_cents != null && Number(f.price_cents) > 0) {
    const squares = [];
    for (const id of ids) squares.push(await ensureEventSquareItem(env, id));
    squareNote = squareNoteFrom(squares);
  }
  await audit(env, ctx, "events.bulk_edited", "event", ids[0], { count: ids.length, fields: Object.keys(f) });
  return json({ ok: true, updated: r.meta.changes, cancelled_notice: notice, square_note: squareNote });
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
