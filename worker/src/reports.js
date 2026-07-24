/**
 * Boomtown Platform — Sales Reports + Member Notifications
 * File: worker/src/reports.js · Version: v1.1 · Date: 2026-07-23 · Ships in: v0.8.0 (v1.0 base same day)
 *
 * v1.1: GET /api/admin/dashboard — single call powering the Control Center home
 *   (this-month money, overdue/unpaid list with actionable IDs, 7-day registration
 *   trend, today + upcoming events, member count, latest admin notifications).
 *
 *   GET  /api/admin/reports/sales     (staff) → per-program, per-month, per-event revenue
 *   GET  /api/notifications           (member) → own inbox (title/body/link/read_at) + unread count
 *   POST /api/notifications/:id/read  (member) → mark one read
 *   POST /api/notifications/read-all  (member) → mark all read
 *
 * Revenue source of truth: `payments` mirror of Square webhooks (COMPLETED only),
 * plus cash-collected and comped registrations counted at the event price so the
 * program totals match what actually ran. Each row carries its basis.
 */

let json, audit, isStaff, requireStaff;
export function wireReports(h) { ({ json, audit, isStaff, requireStaff } = h); }

export async function reportRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;
  if (p === "/api/admin/reports/sales" && m === "GET") return sales(env, ctx);
  if (p === "/api/admin/dashboard" && m === "GET") return dashboard(env, ctx);
  if (p === "/api/notifications" && m === "GET") return inbox(env, ctx);
  if ((x = p.match(/^\/api\/notifications\/(\d+)\/read$/)) && m === "POST") return markRead(env, ctx, +x[1]);
  if (p === "/api/notifications/read-all" && m === "POST") return readAll(env, ctx);
  return null;
}

/* ---------------- sales (staff) ---------------- */

async function sales(env, ctx) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const org = ctx.orgId;

  // Card revenue: Square COMPLETED payments. Cash/comp: registration status at event price.
  const perEvent = (await env.DB.prepare(
    `SELECT e.id AS event_id, e.name AS event, e.type, e.starts_at,
            COALESCE(p.name, '(no program)') AS program,
            COALESCE(sq.card_cents, 0) AS card_cents,
            COALESCE(cash.n, 0) * COALESCE(e.price_cents, 0) AS cash_cents,
            COALESCE(regs.n, 0) AS registrations
     FROM events e
     LEFT JOIN programs p ON p.id = e.program_id
     LEFT JOIN (SELECT r.event_id, SUM(pm.amount_cents) AS card_cents
                FROM payments pm JOIN registrations r ON r.id = pm.registration_id
                WHERE pm.status='COMPLETED' AND pm.deleted_at IS NULL GROUP BY r.event_id) sq ON sq.event_id = e.id
     LEFT JOIN (SELECT event_id, COUNT(*) AS n FROM registrations
                WHERE status='paid' AND payment_method='cash' AND deleted_at IS NULL GROUP BY event_id) cash ON cash.event_id = e.id
     LEFT JOIN (SELECT event_id, COUNT(*) AS n FROM registrations
                WHERE status IN ('paid','comped','cash-pending') AND deleted_at IS NULL GROUP BY event_id) regs ON regs.event_id = e.id
     WHERE e.org_id = ?1 AND e.deleted_at IS NULL
     ORDER BY e.starts_at DESC`
  ).bind(org).all()).results.map(r => ({ ...r, total_cents: (r.card_cents || 0) + (r.cash_cents || 0) }));

  const byProgram = {}, byMonth = {};
  for (const r of perEvent) {
    byProgram[r.program] = byProgram[r.program] || { program: r.program, events: 0, registrations: 0, total_cents: 0 };
    byProgram[r.program].events++;
    byProgram[r.program].registrations += r.registrations;
    byProgram[r.program].total_cents += r.total_cents;
    const month = (r.starts_at || "").slice(0, 7) || "undated";
    byMonth[month] = byMonth[month] || { month, total_cents: 0, events: 0 };
    byMonth[month].total_cents += r.total_cents;
    byMonth[month].events++;
  }
  return json({
    per_event: perEvent,
    per_program: Object.values(byProgram).sort((a, b) => b.total_cents - a.total_cents),
    per_month: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)),
  });
}

/* ---------------- control center (staff) ---------------- */

async function dashboard(env, ctx) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const org = ctx.orgId;

  // Money this month: received (card COMPLETED + cash marked paid) vs outstanding.
  const month = new Date().toISOString().slice(0, 7);
  const card = await env.DB.prepare(
    `SELECT COALESCE(SUM(pm.amount_cents),0) AS c FROM payments pm
     JOIN registrations r ON r.id = pm.registration_id
     WHERE r.org_id=?1 AND pm.status='COMPLETED' AND pm.deleted_at IS NULL
       AND substr(pm.created_at,1,7)=?2`
  ).bind(org, month).first();
  const cash = await env.DB.prepare(
    `SELECT COALESCE(SUM(e.price_cents),0) AS c FROM registrations r
     JOIN events e ON e.id=r.event_id
     WHERE r.org_id=?1 AND r.status='paid' AND r.payment_method='cash' AND r.deleted_at IS NULL
       AND substr(r.updated_at,1,7)=?2`
  ).bind(org, month).first();

  // Outstanding: unpaid registrations on live events — the follow-up list.
  const unpaid = (await env.DB.prepare(
    `SELECT r.id, r.status, r.created_at, r.last_reminded_at, c.email, c.full_name,
            t.name AS team_name, e.name AS event_name, e.price_cents
     FROM registrations r
     LEFT JOIN contacts c ON c.id=r.contact_id
     LEFT JOIN teams t ON t.id=r.team_id
     JOIN events e ON e.id=r.event_id AND e.deleted_at IS NULL AND e.status IN ('published','in_progress')
     WHERE r.org_id=?1 AND r.status IN ('pending','email-sent','cash-pending') AND r.deleted_at IS NULL
     ORDER BY r.created_at ASC LIMIT 12`
  ).bind(org).all()).results;
  const outstanding_cents = unpaid.reduce((a, u) => a + (u.price_cents || 0), 0);

  // 7-day registration trend (all statuses except cancelled — activity, not money).
  const trend = (await env.DB.prepare(
    `SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM registrations
     WHERE org_id=?1 AND deleted_at IS NULL AND created_at >= datetime('now','-7 days')
     GROUP BY day ORDER BY day`
  ).bind(org).all()).results;

  // Today + next events, with live registration counts and assigned staff.
  const events = (await env.DB.prepare(
    `SELECT e.id, e.name, e.type, e.starts_at, e.location, e.status, e.staff_contact_id,
            sc.full_name AS staff_name,
            (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id AND r.deleted_at IS NULL AND r.status!='cancelled') AS regs
     FROM events e LEFT JOIN contacts sc ON sc.id=e.staff_contact_id
     WHERE e.org_id=?1 AND e.deleted_at IS NULL AND e.status IN ('published','in_progress')
       AND (e.starts_at IS NULL OR e.starts_at >= datetime('now','-12 hours'))
     ORDER BY e.starts_at ASC LIMIT 8`
  ).bind(org).all()).results;

  const members = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM contacts WHERE org_id=?1 AND deleted_at IS NULL"
  ).bind(org).first();

  // Latest admin-facing notifications (cash pending etc.) — the "needs attention" feed.
  const alerts = (await env.DB.prepare(
    `SELECT id, kind, title, body, payload_json, created_at FROM notifications
     WHERE org_id=?1 AND target='admin' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 6`
  ).bind(org).all()).results;

  return json({
    month,
    received_cents: (card.c || 0) + (cash.c || 0),
    card_cents: card.c || 0,
    cash_cents: cash.c || 0,
    outstanding_cents,
    unpaid,
    trend,
    events,
    member_count: members.n || 0,
    alerts,
  });
}

/* ---------------- notifications (member) ---------------- */

/** All contact rows across orgs for the signed-in user's email. */
async function myContactIds(env, ctx) {
  if (!ctx.session) return [];
  const u = await env.DB.prepare("SELECT email FROM users WHERE id=?1").bind(ctx.userId).first();
  if (!u) return [];
  const rows = (await env.DB.prepare(
    "SELECT id FROM contacts WHERE email=?1 AND deleted_at IS NULL"
  ).bind(u.email.toLowerCase()).all()).results;
  return rows.map(r => r.id);
}

async function inbox(env, ctx) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const ids = await myContactIds(env, ctx);
  if (!ids.length) return json({ notifications: [], unread: 0 });
  const ph = ids.map((_, i) => "?" + (i + 1)).join(",");
  const rows = (await env.DB.prepare(
    `SELECT id, kind, title, body, link, read_at, created_at FROM notifications
     WHERE contact_id IN (${ph}) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`
  ).bind(...ids).all()).results;
  return json({ notifications: rows, unread: rows.filter(r => !r.read_at).length });
}

async function markRead(env, ctx, id) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const ids = await myContactIds(env, ctx);
  if (!ids.length) return json({ ok: true });
  const ph = ids.map((_, i) => "?" + (i + 2)).join(",");
  await env.DB.prepare(
    `UPDATE notifications SET read_at=datetime('now') WHERE id=?1 AND contact_id IN (${ph}) AND read_at IS NULL`
  ).bind(id, ...ids).run();
  return json({ ok: true });
}

async function readAll(env, ctx) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const ids = await myContactIds(env, ctx);
  if (!ids.length) return json({ ok: true });
  const ph = ids.map((_, i) => "?" + (i + 1)).join(",");
  await env.DB.prepare(
    `UPDATE notifications SET read_at=datetime('now') WHERE contact_id IN (${ph}) AND read_at IS NULL`
  ).bind(...ids).run();
  return json({ ok: true });
}

/** Shared helper for other modules: file an in-app notification for one contact. */
export async function notify(env, orgId, contactId, kind, title, body, link) {
  if (!contactId) return;
  await env.DB.prepare(
    "INSERT INTO notifications (org_id, kind, target, contact_id, title, body, link) VALUES (?1,?2,'member',?3,?4,?5,?6)"
  ).bind(orgId, kind, contactId, title, body || null, link || null).run();
}
