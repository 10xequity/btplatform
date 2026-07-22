/**
 * Boomtown Platform — Admin API (users, roles, membership)
 * Version: v0.4.0 · Date: 2026-07-22
 *
 * Role model (spec §3.8): admin (full) / staff (ops) / member, per org.
 * Everything here except member listing requires ADMIN (not just staff) for the target org.
 *
 * Endpoints:
 *   GET    /api/admin/users                      → users + their roles across all orgs the caller admins
 *   POST   /api/admin/users                      { email, display_name?, org_id, role } → create-or-find user, assign role
 *   POST   /api/admin/users/:id/role             { org_id, role }        → set/replace role in one org
 *   DELETE /api/admin/users/:id/role?org_id=N    → revoke role in one org (soft)
 *   GET    /api/admin/members?q=&page=           → contacts (membership) list for ctx org, staff-visible
 *   PATCH  /api/admin/members/:id                { full_name?, phone?, city?, state?, instagram?, tags_json?, unsubscribed? }
 *   GET    /api/admin/permissions                → static role-capability matrix (for the UI)
 */

let json, audit, isStaff, requireStaff;
export function wireAdmin(h) { ({ json, audit, isStaff, requireStaff } = h); }

async function isAdmin(env, ctx, orgId) {
  if (!ctx.session) return false;
  const row = await env.DB.prepare(
    "SELECT 1 FROM user_org_roles WHERE user_id=?1 AND org_id=?2 AND role='admin' AND deleted_at IS NULL"
  ).bind(ctx.userId, orgId).first();
  return !!row;
}
async function requireAdmin(env, ctx, orgId = ctx.orgId) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  if (!(await isAdmin(env, ctx, orgId))) return json({ error: "Admin role required for this org." }, 403);
  return null;
}

const ROLES = ["admin", "staff", "member"];

/* Static capability matrix shown in the UI so "permissions" are explicit, not folklore. */
const PERMISSIONS = {
  admin:  { manage_users: true,  manage_events: true,  registrations: true,  finance_export: true,  crm_export: true,  score_entry: true },
  staff:  { manage_users: false, manage_events: true,  registrations: true,  finance_export: false, crm_export: false, score_entry: true },
  member: { manage_users: false, manage_events: false, registrations: false, finance_export: false, crm_export: false, score_entry: false },
};

export async function adminRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;
  let match;

  if (p === "/api/admin/permissions" && m === "GET") return json({ roles: ROLES, permissions: PERMISSIONS });

  if (p === "/api/admin/users" && m === "GET") return listUsers(env, ctx);
  if (p === "/api/admin/users" && m === "POST") return addUser(request, env, ctx);
  if ((match = p.match(/^\/api\/admin\/users\/(\d+)\/role$/))) {
    if (m === "POST") return setRole(request, env, ctx, +match[1]);
    if (m === "DELETE") return revokeRole(env, ctx, +match[1], url);
  }
  if (p === "/api/admin/members" && m === "GET") return listMembers(env, ctx, url);
  if ((match = p.match(/^\/api\/admin\/members\/(\d+)$/)) && m === "PATCH") return patchMember(request, env, ctx, +match[1]);

  return null;
}

/* ---------- users & roles ---------- */

async function adminOrgIds(env, ctx) {
  const rows = (await env.DB.prepare(
    "SELECT org_id FROM user_org_roles WHERE user_id=?1 AND role='admin' AND deleted_at IS NULL"
  ).bind(ctx.userId).all()).results;
  return rows.map(r => r.org_id);
}

async function listUsers(env, ctx) {
  const gate = await requireAdmin(env, ctx);
  if (gate) return gate;
  const myOrgs = await adminOrgIds(env, ctx);
  const users = (await env.DB.prepare(
    "SELECT id, email, display_name, totp_enabled, created_at FROM users WHERE deleted_at IS NULL ORDER BY id"
  ).all()).results;
  const roles = (await env.DB.prepare(
    "SELECT user_id, org_id, role FROM user_org_roles WHERE deleted_at IS NULL"
  ).all()).results;
  for (const u of users) {
    u.roles = roles.filter(r => r.user_id === u.id)
      .map(r => ({ org_id: r.org_id, role: r.role, editable: myOrgs.includes(r.org_id) }));
  }
  return json({ users, admin_org_ids: myOrgs });
}

async function addUser(request, env, ctx) {
  const b = await request.json().catch(() => ({}));
  const email = (b.email || "").trim().toLowerCase();
  const orgId = Number(b.org_id), role = b.role;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (!ROLES.includes(role)) return json({ error: "Role must be admin, staff, or member." }, 400);
  const gate = await requireAdmin(env, ctx, orgId);
  if (gate) return gate;

  let user = await env.DB.prepare("SELECT id FROM users WHERE email=?1 AND deleted_at IS NULL").bind(email).first();
  if (!user) {
    const r = await env.DB.prepare(
      "INSERT INTO users (email, display_name) VALUES (?1, ?2)"
    ).bind(email, b.display_name || null).run();
    user = { id: r.meta.last_row_id };
  }
  await upsertRole(env, user.id, orgId, role);
  await audit(env, ctx, "user.role_set", "user", user.id, { org_id: orgId, role, email });
  return json({ ok: true, user_id: user.id, note: "They sign in with the normal magic-link — no password to set up." });
}

async function setRole(request, env, ctx, userId) {
  const b = await request.json().catch(() => ({}));
  const orgId = Number(b.org_id), role = b.role;
  if (!ROLES.includes(role)) return json({ error: "Role must be admin, staff, or member." }, 400);
  const gate = await requireAdmin(env, ctx, orgId);
  if (gate) return gate;
  // Guard: don't let the last admin of an org demote themselves by accident.
  if (userId === ctx.userId && role !== "admin") {
    const others = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user_org_roles WHERE org_id=?1 AND role='admin' AND user_id<>?2 AND deleted_at IS NULL"
    ).bind(orgId, userId).first();
    if (!others.n) return json({ error: "You're the only admin of this org — assign another admin first." }, 400);
  }
  await upsertRole(env, userId, orgId, role);
  await audit(env, ctx, "user.role_set", "user", userId, { org_id: orgId, role });
  return json({ ok: true });
}

async function revokeRole(env, ctx, userId, url) {
  const orgId = Number(url.searchParams.get("org_id"));
  const gate = await requireAdmin(env, ctx, orgId);
  if (gate) return gate;
  if (userId === ctx.userId) {
    const others = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user_org_roles WHERE org_id=?1 AND role='admin' AND user_id<>?2 AND deleted_at IS NULL"
    ).bind(orgId, userId).first();
    if (!others.n) return json({ error: "You're the only admin of this org — assign another admin first." }, 400);
  }
  await env.DB.prepare(
    "UPDATE user_org_roles SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE user_id=?1 AND org_id=?2"
  ).bind(userId, orgId).run();
  await audit(env, ctx, "user.role_revoked", "user", userId, { org_id: orgId });
  return json({ ok: true });
}

async function upsertRole(env, userId, orgId, role) {
  await env.DB.prepare(
    `INSERT INTO user_org_roles (user_id, org_id, role) VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id, org_id) DO UPDATE SET role=?3, deleted_at=NULL, updated_at=datetime('now')`
  ).bind(userId, orgId, role).run();
}

/* ---------- membership (contacts) ---------- */

async function listMembers(env, ctx, url) {
  const gate = await requireStaff(env, ctx);
  if (gate) return gate;
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const per = 50, off = (page - 1) * per;
  const like = `%${q}%`;
  const where = "org_id=?1 AND deleted_at IS NULL" + (q ? " AND (full_name LIKE ?2 OR email LIKE ?2 OR phone LIKE ?2)" : "");
  const binds = q ? [ctx.orgId, like] : [ctx.orgId];
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE ${where}`).bind(...binds).first()).n;
  const rows = (await env.DB.prepare(
    `SELECT id, email, full_name, phone, city, state, instagram, tags_json, unsubscribed, created_at
     FROM contacts WHERE ${where} ORDER BY full_name COLLATE NOCASE, id LIMIT ${per} OFFSET ${off}`
  ).bind(...binds).all()).results;
  return json({ members: rows, total, page, per });
}

async function patchMember(request, env, ctx, id) {
  const gate = await requireStaff(env, ctx);
  if (gate) return gate;
  const row = await env.DB.prepare("SELECT org_id FROM contacts WHERE id=?1 AND deleted_at IS NULL").bind(id).first();
  if (!row || row.org_id !== ctx.orgId) return json({ error: "Not found in this org." }, 404);
  const b = await request.json().catch(() => ({}));
  const allowed = ["full_name", "phone", "city", "state", "instagram", "tags_json", "unsubscribed"];
  const sets = [], vals = [];
  for (const k of allowed) if (k in b) { vals.push(b[k]); sets.push(`${k}=?${vals.length}`); }
  if (!sets.length) return json({ error: "Nothing to update." }, 400);
  vals.push(id);
  await env.DB.prepare(`UPDATE contacts SET ${sets.join(",")}, updated_at=datetime('now') WHERE id=?${vals.length}`).bind(...vals).run();
  await audit(env, ctx, "member.updated", "contact", id, b);
  return json({ ok: true });
}
