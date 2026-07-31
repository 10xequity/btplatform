/**
 * Boomtown Platform — Sales Reports + Member Notifications
 * File: worker/src/reports.js · Version: v1.5 · Date: 2026-07-31 · Ships in: v0.43.0
 *
 * v1.5 (2026-07-31, v0.43.0): GET /api/admin/reports/revenue-all.csv (staff) — cross-org
 *   Looker feed. One CSV across EVERY org where the caller holds admin/staff in
 *   user_org_roles; the org set is DERIVED server-side (bound user_id) and never accepted
 *   from the client (F-11 stands). This is the reports module's ONE deliberate cross-org
 *   read, confined to the marked block below (SMS STOP/START precedent) and shape-guarded
 *   by reports_export.test.mjs with negative controls. New 12-column header contract
 *   (org_id + org prepended); the single-org 10-column contract is untouched.
 *
 * v1.4 (2026-07-30, v0.40.0): GET /api/admin/reports/revenue.csv (staff) — owner req #12/#18.
 *   One flat, stable-header CSV (per-event revenue rows) built for the Looker Studio template
 *   (docs/2026-07-30_looker-template_v1_0.md). The build/buy call of record stands: export to
 *   a free Looker template, do NOT build a report builder. Headers are a CONTRACT — the
 *   Looker template maps them by name; renaming one breaks every saved report. Escaping is
 *   RFC 4180 (csvCell, unit-tested). Pure helpers exported: csvCell · buildRevenueCsv.
 *
 * v1.3 (2026-07-30, v0.36.0): admin alerts persist until resolved. The dashboard feed
 *   now returns only read_at IS NULL rows (an open cash flag can no longer scroll off
 *   at LIMIT 6), and POST /api/admin/alerts/:id/dismiss (staff) resolves one, reusing
 *   read_at — collision-free with the member inbox, which filters on contact_id.
 *
 * v1.2 (M15): GET /api/admin/reports/heatmap?weeks=N (R-02, attendance by weekday × hour),
 *   GET /api/admin/reports/pos-sales?from&to (POS revenue by day + by product),
 *   GET /api/admin/reports/shift-coverage?from&to (R-05, shifts alongside event counts per day).
 *   buildHeatmap() exported for unit tests.
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
  if ((x = p.match(/^\/api\/admin\/alerts\/(\d+)\/dismiss$/)) && m === "POST") return dismissAlert(env, ctx, +x[1]);
  if (p === "/api/notifications/read-all" && m === "POST") return readAll(env, ctx);
  if (p === "/api/admin/reports/revenue.csv" && m === "GET") return revenueCsv(env, ctx); // v1.4 req #12/#18
  if (p === "/api/admin/reports/revenue-all.csv" && m === "GET") return revenueAllCsv(env, ctx); // v1.5 cross-org
  if (p === "/api/admin/reports/heatmap" && m === "GET") return heatmap(env, ctx, url);
  if (p === "/api/admin/reports/pos-sales" && m === "GET") return posSales(env, ctx, url);
  if (p === "/api/admin/reports/shift-coverage" && m === "GET") return shiftCoverage(env, ctx, url);
  return null;
}

/* ---------------- revenue CSV export — Looker template feed (v1.4) ---------------- */

/** RFC 4180 cell: null/undefined → empty; quote when the value holds , " or newline. */
export function csvCell(v) {
  const s2 = v == null ? "" : String(v);
  return /[",\r\n]/.test(s2) ? `"${s2.replace(/"/g, '""')}"` : s2;
}

/**
 * Rows → CSV text. HEADERS ARE A CONTRACT with the Looker template — never rename.
 * One row per event: month is derived (YYYY-MM of starts_at) so Looker can group
 * without a calculated field; cents kept as integers (Looker divides by 100 once).
 */
export const REVENUE_CSV_HEADERS = [
  "event_id", "event", "type", "program", "starts_at", "month",
  "registrations", "card_cents", "cash_cents", "total_cents",
];
export function buildRevenueCsv(rows) {
  const lines = [REVENUE_CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push([
      r.event_id, r.event, r.type, r.program, r.starts_at,
      (r.starts_at || "").slice(0, 7) || "undated",
      r.registrations, r.card_cents, r.cash_cents, r.total_cents,
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

async function revenueCsv(env, ctx) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  // Same source of truth as sales(): card = Square COMPLETED, cash/comp at event price.
  const res = await sales(env, ctx);
  const { per_event } = await res.json();
  await audit(env, ctx, "reports.revenue.exported", "reports", null, { rows: per_event.length });
  return new Response(buildRevenueCsv(per_event), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="boomtown-revenue-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

/* ---------------- cross-org revenue CSV — Looker feed across staffed orgs (v1.5) ---------------- */

/**
 * 12-column contract for the cross-company Looker page: org_id + org, then the same
 * 10 columns as the single-org feed. HEADERS ARE A CONTRACT — never rename either set.
 */
export const CROSS_ORG_REVENUE_CSV_HEADERS = [
  "org_id", "org",
  "event_id", "event", "type", "program", "starts_at", "month",
  "registrations", "card_cents", "cash_cents", "total_cents",
];
export function buildCrossOrgRevenueCsv(rows) {
  const lines = [CROSS_ORG_REVENUE_CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push([
      r.org_id, r.org,
      r.event_id, r.event, r.type, r.program, r.starts_at,
      (r.starts_at || "").slice(0, 7) || "undated",
      r.registrations, r.card_cents, r.cash_cents, r.total_cents,
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

async function revenueAllCsv(env, ctx) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  /* CROSS-ORG READ — deliberate, confined exception (the module's only one).
     Scope: revenue aggregation across exactly the orgs where THIS caller holds
     admin/staff in user_org_roles (bound user_id, soft-delete honoured), and the
     org itself is active and not deleted — the same visibility rule the switcher
     enforces. No client-supplied org id or list is read anywhere in this handler
     (F-11). Guarded with negative controls in reports_export.test.mjs. */
  const rows = (await env.DB.prepare(
    `SELECT og.id AS org_id, og.name AS org,
            e.id AS event_id, e.name AS event, e.type, e.starts_at,
            COALESCE(p.name, '(no program)') AS program,
            COALESCE(sq.card_cents, 0) AS card_cents,
            COALESCE(cash.n, 0) * COALESCE(e.price_cents, 0) AS cash_cents,
            COALESCE(regs.n, 0) AS registrations
     FROM events e
     JOIN orgs og ON og.id = e.org_id AND og.active = 1 AND og.deleted_at IS NULL
     JOIN user_org_roles uor ON uor.org_id = e.org_id
          AND uor.user_id = ?1 AND uor.role IN ('admin','staff') AND uor.deleted_at IS NULL
     LEFT JOIN programs p ON p.id = e.program_id
     LEFT JOIN (SELECT r.event_id, SUM(pm.amount_cents) AS card_cents
                FROM payments pm JOIN registrations r ON r.id = pm.registration_id AND r.deleted_at IS NULL
                WHERE pm.status='COMPLETED' AND pm.deleted_at IS NULL GROUP BY r.event_id) sq ON sq.event_id = e.id
     LEFT JOIN (SELECT event_id, COUNT(*) AS n FROM registrations
                WHERE status='paid' AND payment_method='cash' AND deleted_at IS NULL GROUP BY event_id) cash ON cash.event_id = e.id
     LEFT JOIN (SELECT event_id, COUNT(*) AS n FROM registrations
                WHERE status IN ('paid','comped','cash-pending') AND deleted_at IS NULL GROUP BY event_id) regs ON regs.event_id = e.id
     WHERE e.deleted_at IS NULL
     ORDER BY og.id ASC, e.starts_at DESC`
  ).bind(ctx.userId).all()).results.map(r => ({ ...r, total_cents: (r.card_cents || 0) + (r.cash_cents || 0) }));
  /* END CROSS-ORG READ */
  await audit(env, ctx, "reports.revenue_all.exported", "reports", null,
    { rows: rows.length, orgs: new Set(rows.map(r => r.org_id)).size });
  return new Response(buildCrossOrgRevenueCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="boomtown-revenue-all-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
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
                FROM payments pm JOIN registrations r ON r.id = pm.registration_id AND r.deleted_at IS NULL
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
     JOIN registrations r ON r.id = pm.registration_id AND r.deleted_at IS NULL
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

  // Admin-facing notifications (cash pending etc.) — the "needs attention" feed.
  // v1.3: only UNRESOLVED rows. The old query was newest-6 regardless of state, so the
  // 7th-oldest open cash flag silently fell off the only surface that shows it. read_at
  // doubles as "resolved" for target='admin' rows — safe to reuse, because these rows
  // carry contact_id NULL and the member inbox filters on contact_id IN (…), so the two
  // consumers can never see each other's rows.
  const alerts = (await env.DB.prepare(
    `SELECT id, kind, title, body, payload_json, created_at FROM notifications
     WHERE org_id=?1 AND target='admin' AND read_at IS NULL AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 6`
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

/* v1.3 (v0.36.0): staff resolve an admin alert. Org-scoped in the WHERE (F-11 class),
   target='admin' pinned so this path can never touch a member's inbox row. */
async function dismissAlert(env, ctx, id) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const r = await env.DB.prepare(
    `UPDATE notifications SET read_at=datetime('now')
     WHERE id=?1 AND org_id=?2 AND target='admin' AND read_at IS NULL AND deleted_at IS NULL`
  ).bind(id, ctx.orgId).run();
  if (!r.meta.changes) return json({ error: "Alert not found or already cleared." }, 404);
  await audit(env, ctx, "alert.dismiss", "notifications", id, {});
  return json({ ok: true, message: "Cleared." });
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


/* ---------------- M15: attendance heatmap (R-02) ---------------- */

/** Pure: rows of {dow:'0'-'6', hour:'00'-'23', n} → 7×24 matrix + max (unit-tested). */
export function buildHeatmap(rows) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const r of rows) {
    const d = +r.dow, h = +r.hour, n = +r.n || 0;
    if (d >= 0 && d <= 6 && h >= 0 && h <= 23) { grid[d][h] += n; if (grid[d][h] > max) max = grid[d][h]; }
  }
  return { grid, max };
}

async function heatmap(env, ctx, url) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const weeks = Math.min(52, Math.max(1, +url.searchParams.get("weeks") || 8));
  const rows = (await env.DB.prepare(
    `SELECT strftime('%w', checked_in_at) AS dow, strftime('%H', checked_in_at) AS hour, COUNT(*) AS n
     FROM attendance WHERE org_id=?1 AND deleted_at IS NULL
       AND checked_in_at >= datetime('now', ?2)
     GROUP BY dow, hour`
  ).bind(ctx.orgId, `-${weeks * 7} days`).all()).results;
  return json({ weeks, ...buildHeatmap(rows) });
}

/* ---------------- M15: POS sales report ---------------- */

async function posSales(env, ctx, url) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const from = url.searchParams.get("from") || "0000";
  const to = url.searchParams.get("to") || "9999";
  const byDay = (await env.DB.prepare(
    `SELECT date(created_at) AS day, COUNT(*) AS sales, SUM(total_cents) AS total_cents
     FROM sales WHERE org_id=?1 AND status='recorded' AND date(created_at) BETWEEN ?2 AND ?3
     GROUP BY day ORDER BY day`
  ).bind(ctx.orgId, from, to).all()).results;
  const byProduct = (await env.DB.prepare(
    `SELECT si.label, SUM(si.qty) AS qty, SUM(si.line_total_cents) AS total_cents
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.org_id=?1 AND s.status='recorded' AND date(s.created_at) BETWEEN ?2 AND ?3
     GROUP BY si.label ORDER BY total_cents DESC LIMIT 50`
  ).bind(ctx.orgId, from, to).all()).results;
  return json({ by_day: byDay, by_product: byProduct });
}

/* ---------------- M15: shift coverage (R-05) ---------------- */

async function shiftCoverage(env, ctx, url) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const from = url.searchParams.get("from") || "0000";
  const to = url.searchParams.get("to") || "9999";
  const shifts = (await env.DB.prepare(
    `SELECT date(sh.starts_at) AS day, COUNT(*) AS shifts
     FROM staff_shifts sh WHERE sh.org_id=?1 AND sh.deleted_at IS NULL
       AND date(sh.starts_at) BETWEEN ?2 AND ?3 GROUP BY day`
  ).bind(ctx.orgId, from, to).all()).results;
  const events = (await env.DB.prepare(
    `SELECT date(starts_at) AS day, COUNT(*) AS events
     FROM events WHERE org_id=?1 AND deleted_at IS NULL
       AND date(starts_at) BETWEEN ?2 AND ?3 GROUP BY day`
  ).bind(ctx.orgId, from, to).all()).results;
  return json({ shifts, events });
}

/** Shared helper for other modules: file an in-app notification for one contact. */
export async function notify(env, orgId, contactId, kind, title, body, link) {
  if (!contactId) return;
  await env.DB.prepare(
    "INSERT INTO notifications (org_id, kind, target, contact_id, title, body, link) VALUES (?1,?2,'member',?3,?4,?5,?6)"
  ).bind(orgId, kind, contactId, title, body || null, link || null).run();
}
