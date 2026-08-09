/**
 * Boomtown Platform — Security & Recovery module (M13)
 * File: worker/src/security.js · Version: v1.2 · Date: 2026-07-26 · Ships in: v0.23.0 (v1.2: comment only — access_tokens joins waiver_versions as explicitly NOT restorable)
 *
 * Staff routes (admin/staff role), mounted by worker/src/index.js:
 *   GET  /api/admin/security/log?kind=&q=&before=&limit=
 *        → audit_log view (newest first, id-cursor paging). kind presets:
 *          all | auth | deletes | money | facility | roles
 *   GET  /api/admin/security/deleted?entity=events|teams|contacts|space_bookings|rental_requests|registrations
 *        → soft-deleted rows (the "trash can"), newest 50
 *   POST /api/admin/security/restore   { entity, id }  → clears deleted_at (whitelisted tables only)
 *   POST /api/admin/security/rescue-link { email }     → admin-issued magic sign-in link for a
 *        locked-out member (passkey lost / can't find email). Sandbox mode returns the link
 *        on-screen; with Brevo configured the member gets the email. Always audited.
 *
 * Rules baked in:
 *   - Restore is whitelist-only (RESTORE_WHITELIST). Auth/security tables (users, sessions,
 *     magic_links, webauthn_credentials, audit_log) are deliberately NOT restorable here.
 *   - Nothing in this module writes except restore + the rescue-link issue, both audited.
 */

let H = null; // wired: { json, audit, isStaff, requireStaff, sendLoginLink }
export function wireSecurity(helpers) { H = helpers; }

/** entity → columns used to label rows in the trash view. Keys are the ONLY restorable tables. */
export const RESTORE_WHITELIST = {
  events:          { label: "name",           extra: "starts_at" },
  teams:           { label: "name",           extra: "event_id" },
  contacts:        { label: "full_name",      extra: "email" },
  space_bookings:  { label: "title",          extra: "date" },
  rental_requests: { label: "requester_name", extra: "date" },
  registrations:   { label: "status",         extra: "event_id" },
  // v0.22.0 — waiver_versions is DELIBERATELY ABSENT, same rule as waivers/signatures (M13):
  // legal records are not resurrectable from the UI. There is also no delete route for a
  // waiver version — a published version is immutable and permanent by design.
};

const KIND_FILTERS = {
  all: null,
  auth: "a.action LIKE 'auth.%' OR a.action LIKE '%rescue%'",
  deletes: "a.action LIKE '%delete%' OR a.action LIKE '%restore%'",
  money: "a.action LIKE '%payment%' OR a.action LIKE '%refund%' OR a.action LIKE '%subscription%' OR a.action LIKE '%plan%'",
  facility: "a.action LIKE 'facility.%' OR a.action LIKE 'rental.%'",
  roles: "a.action LIKE '%role%' OR a.action LIKE 'user.%'",
};

export async function securityRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  if (!p.startsWith("/api/admin/security")) return null;
  const deny = await H.requireStaff(env, ctx); if (deny) return deny;

  if (p === "/api/admin/security/log" && m === "GET") return securityLog(env, url);
  if (p === "/api/admin/security/deleted" && m === "GET") return deletedList(env, ctx, url);
  if (p === "/api/admin/security/restore" && m === "POST") return restoreRow(request, env, ctx);
  if (p === "/api/admin/security/rescue-link" && m === "POST") return rescueLink(request, env, ctx);
  return null;
}

async function securityLog(env, url) {
  const kind = url.searchParams.get("kind") || "all";
  if (!(kind in KIND_FILTERS)) return H.json({ error: "Unknown log filter." }, 400);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
  const before = Number(url.searchParams.get("before")) || 0;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);

  const where = ["1=1"];
  const binds = [];
  if (KIND_FILTERS[kind]) where.push(`(${KIND_FILTERS[kind]})`);
  if (q) { where.push("(a.action LIKE ?" + (binds.length + 1) + " OR a.entity LIKE ?" + (binds.length + 1) + " OR u.email LIKE ?" + (binds.length + 1) + ")"); binds.push(`%${q}%`); }
  if (before) { where.push("a.id < ?" + (binds.length + 1)); binds.push(before); }

  const rows = (await env.DB.prepare(
    `SELECT a.id, a.org_id, a.action, a.entity, a.entity_id, a.detail_json, a.created_at, u.email AS actor
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY a.id DESC LIMIT ${limit}`
  ).bind(...binds).all()).results;
  return H.json({ log: rows, next_before: rows.length === limit ? rows[rows.length - 1].id : null });
}

async function deletedList(env, ctx, url) {
  const entity = url.searchParams.get("entity") || "events";
  const cfg = RESTORE_WHITELIST[entity];
  if (!cfg) return H.json({ error: "That entity can't be viewed here." }, 400);
  const rows = (await env.DB.prepare(
    `SELECT id, ${cfg.label} AS label, ${cfg.extra} AS extra, deleted_at
     FROM ${entity} WHERE org_id=?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50`
  ).bind(ctx.orgId).all()).results;
  return H.json({ entity, rows });
}

async function restoreRow(request, env, ctx) {
  const b = await request.json().catch(() => ({}));
  const entity = String(b.entity || "");
  const id = Number(b.id);
  const cfg = RESTORE_WHITELIST[entity];
  if (!cfg) return H.json({ error: "That entity can't be restored from here." }, 400);
  if (!id) return H.json({ error: "Missing id." }, 400);
  const row = await env.DB.prepare(
    `SELECT id, deleted_at FROM ${entity} WHERE id=?1 AND org_id=?2`
  ).bind(id, ctx.orgId).first();
  if (!row) return H.json({ error: "Row not found." }, 404);
  if (!row.deleted_at) return H.json({ error: "That row isn't deleted." }, 409);
  await env.DB.prepare(
    `UPDATE ${entity} SET deleted_at=NULL, updated_at=datetime('now') WHERE id=?1 AND org_id=?2`
  ).bind(id, ctx.orgId).run();
  await H.audit(env, ctx, "security.restore", entity, id, {});
  return H.json({ ok: true, entity, id });
}

async function rescueLink(request, env, ctx) {
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return H.json({ error: "Enter a valid email address." }, 400);
  const user = await env.DB.prepare(
    "SELECT id FROM users WHERE email=?1 AND deleted_at IS NULL"
  ).bind(email).first();
  if (!user) return H.json({ error: "No account with that email. Check the Members list for the address on file." }, 404);
  const res = await H.sendLoginLink(env, email); // sandbox: returns dev_link on-screen; Brevo: emails it
  const data = await res.json().catch(() => ({}));
  /* v0.117.0 (S-3b): a non-OK from sendLoginLink — the flood 429, or the Brevo 502 — must
     SURFACE. The old re-wrap answered { ok: true, note: "a link was emailed" } around a body
     that contained no link at all: success reported, nothing achieved, and the admin walks
     away believing the member is rescued. No audit row either — no link was issued. */
  if (!res.ok) return H.json(data, res.status);
  await H.audit(env, ctx, "security.rescue_link", "users", user.id, { email });
  return H.json({ ok: true, ...data, note: data.dev_link
    ? "Sandbox mode — hand this one-time link to the member (expires in 15 minutes)."
    : "A sign-in link was emailed to the member (expires in 15 minutes)." });
}
