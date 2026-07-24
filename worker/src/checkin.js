/**
 * Boomtown Platform — Check-in & Attendance (Module 10)
 * File: worker/src/checkin.js · Version: v1.0 · Date: 2026-07-23 · Ships in: v0.9.0
 *
 * Staff (door) routes:
 *   GET  /api/events/:id/roster            → every roster member: waiver flag + checked_in state
 *   POST /api/events/:id/checkin           { team_member_id } toggle check-in (soft-delete = undo)
 *   POST /api/events/:id/checkin-walkin    { name, email? } record someone not on a roster
 *   POST /api/events/:id/checkin-token     mint/rotate the public self-check-in token
 *
 * Public (self, token-gated like score links):
 *   GET  /api/checkin/:token               → event name/date + whether self check-in is open
 *   POST /api/checkin/:token               { email } or { name } → records attendance
 *       email match on a roster → linked check-in; otherwise recorded as unverified walk-in.
 *
 * Member:
 *   GET  /api/profile/attendance           → own check-in history (+ managed children)
 *
 * Data: attendance table (migration 0006). Waiver logic mirrors waiverReminderSweep:
 * a valid waiver = waivers row for a contact with that email in this org, not expired.
 */

let json, audit, isStaff, requireStaff;
export function wireCheckin(h) { ({ json, audit, isStaff, requireStaff } = h); }

export async function checkinRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;
  if ((x = p.match(/^\/api\/events\/(\d+)\/roster$/)) && m === "GET") return roster(env, ctx, +x[1]);
  if ((x = p.match(/^\/api\/events\/(\d+)\/checkin$/)) && m === "POST") return staffCheckin(request, env, ctx, +x[1]);
  if ((x = p.match(/^\/api\/events\/(\d+)\/checkin-walkin$/)) && m === "POST") return walkin(request, env, ctx, +x[1]);
  if ((x = p.match(/^\/api\/events\/(\d+)\/checkin-token$/)) && m === "POST") return mintToken(env, ctx, +x[1]);
  if ((x = p.match(/^\/api\/checkin\/([a-f0-9]{16,64})$/))) {
    if (m === "GET") return selfInfo(env, x[1]);
    if (m === "POST") return selfCheckin(request, env, x[1]);
  }
  if (p === "/api/profile/attendance" && m === "GET") return myAttendance(env, ctx);
  return null;
}

async function gate(env, ctx, eventId) {
  const ev = await env.DB.prepare("SELECT * FROM events WHERE id=?1 AND deleted_at IS NULL").bind(eventId).first();
  if (!ev) return { deny: json({ error: "Event not found." }, 404) };
  const deny = await requireStaff(env, ctx, ev.org_id);
  return { ev, deny };
}

/* ---------------- staff: door roster ---------------- */

async function roster(env, ctx, eventId) {
  const { ev, deny } = await gate(env, ctx, eventId);
  if (deny) return deny;
  const rows = (await env.DB.prepare(
    `SELECT tm.id AS team_member_id, tm.member_name, tm.member_email, tm.contact_id,
            t.id AS team_id, t.name AS team_name, t.level_num,
            (SELECT a.id FROM attendance a WHERE a.event_id=?1 AND a.team_member_id=tm.id AND a.deleted_at IS NULL LIMIT 1) AS attendance_id,
            (SELECT a.checked_in_at FROM attendance a WHERE a.event_id=?1 AND a.team_member_id=tm.id AND a.deleted_at IS NULL LIMIT 1) AS checked_in_at,
            EXISTS (SELECT 1 FROM contacts c JOIN waivers w ON w.contact_id=c.id AND w.deleted_at IS NULL AND w.expires_at > datetime('now')
                    WHERE c.org_id=tm.org_id AND c.deleted_at IS NULL
                      AND (c.id = tm.contact_id OR (tm.member_email IS NOT NULL AND c.email = tm.member_email))) AS waiver_ok
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
     WHERE t.event_id = ?1 AND tm.deleted_at IS NULL
     ORDER BY t.name, tm.member_name`
  ).bind(eventId).all()).results;
  const walkins = (await env.DB.prepare(
    `SELECT id AS attendance_id, name_snapshot AS member_name, checked_in_at, method
     FROM attendance WHERE event_id=?1 AND team_member_id IS NULL AND deleted_at IS NULL ORDER BY checked_in_at`
  ).bind(eventId).all()).results;
  return json({
    event: { id: ev.id, name: ev.name, starts_at: ev.starts_at, has_token: !!ev.checkin_token },
    roster: rows, walkins,
    checked_in: rows.filter(r => r.attendance_id).length + walkins.length,
    total: rows.length,
  });
}

async function staffCheckin(request, env, ctx, eventId) {
  const { ev, deny } = await gate(env, ctx, eventId);
  if (deny) return deny;
  const b = await request.json().catch(() => ({}));
  const tmId = Number(b.team_member_id);
  if (!tmId) return json({ error: "Send team_member_id." }, 400);
  const tm = await env.DB.prepare(
    `SELECT tm.*, t.event_id FROM team_members tm JOIN teams t ON t.id=tm.team_id
     WHERE tm.id=?1 AND tm.deleted_at IS NULL`
  ).bind(tmId).first();
  if (!tm || tm.event_id !== eventId) return json({ error: "That person isn't on this event's roster." }, 404);

  const existing = await env.DB.prepare(
    "SELECT id FROM attendance WHERE event_id=?1 AND team_member_id=?2 AND deleted_at IS NULL"
  ).bind(eventId, tmId).first();
  if (existing) { // toggle off = undo
    await env.DB.prepare("UPDATE attendance SET deleted_at=datetime('now') WHERE id=?1").bind(existing.id).run();
    await audit(env, ctx, "attendance.undo", "attendance", existing.id, { event: eventId });
    return json({ ok: true, checked_in: false });
  }
  const ins = await env.DB.prepare(
    `INSERT INTO attendance (org_id, event_id, contact_id, team_member_id, name_snapshot, method, checked_by_user_id)
     VALUES (?1,?2,?3,?4,?5,'staff',?6)`
  ).bind(ev.org_id, eventId, tm.contact_id || null, tmId, tm.member_name, ctx.userId).run();
  await audit(env, ctx, "attendance.checkin", "attendance", ins.meta.last_row_id, { event: eventId, method: "staff" });
  return json({ ok: true, checked_in: true, at: new Date().toISOString() });
}

async function walkin(request, env, ctx, eventId) {
  const { ev, deny } = await gate(env, ctx, eventId);
  if (deny) return deny;
  const b = await request.json().catch(() => ({}));
  const name = String(b.name || "").trim();
  if (!name) return json({ error: "Walk-in needs a name." }, 400);
  const email = String(b.email || "").trim().toLowerCase() || null;
  let contactId = null;
  if (email) {
    const c = await env.DB.prepare(
      "SELECT id FROM contacts WHERE org_id=?1 AND email=?2 AND deleted_at IS NULL"
    ).bind(ev.org_id, email).first();
    if (c) contactId = c.id;
  }
  const ins = await env.DB.prepare(
    `INSERT INTO attendance (org_id, event_id, contact_id, name_snapshot, method, checked_by_user_id)
     VALUES (?1,?2,?3,?4,'staff',?5)`
  ).bind(ev.org_id, eventId, contactId, name, ctx.userId).run();
  await audit(env, ctx, "attendance.walkin", "attendance", ins.meta.last_row_id, { event: eventId });
  return json({ ok: true, id: ins.meta.last_row_id });
}

async function mintToken(env, ctx, eventId) {
  const { ev, deny } = await gate(env, ctx, eventId);
  if (deny) return deny;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("UPDATE events SET checkin_token=?1, updated_at=datetime('now') WHERE id=?2").bind(token, eventId).run();
  await audit(env, ctx, "checkin.token", "events", eventId, {});
  return json({ ok: true, token, url: `${env.APP_URL}/checkin.html?t=${token}` });
}

/* ---------------- public: self check-in ---------------- */

async function eventByToken(env, token) {
  return env.DB.prepare(
    "SELECT * FROM events WHERE checkin_token=?1 AND deleted_at IS NULL AND status IN ('published','in_progress')"
  ).bind(token).first();
}

async function selfInfo(env, token) {
  const ev = await eventByToken(env, token);
  if (!ev) return json({ error: "This check-in link isn't active." }, 404);
  return json({ event: { name: ev.name, starts_at: ev.starts_at, location: ev.location } });
}

async function selfCheckin(request, env, token) {
  const ev = await eventByToken(env, token);
  if (!ev) return json({ error: "This check-in link isn't active." }, 404);
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase();
  const name = String(b.name || "").trim();
  if (!email && !name) return json({ error: "Enter your email (or your name)." }, 400);

  // Roster match by email → linked check-in with the same dedupe as staff taps.
  if (email) {
    const tm = await env.DB.prepare(
      `SELECT tm.id, tm.contact_id, tm.member_name FROM team_members tm
       JOIN teams t ON t.id=tm.team_id AND t.deleted_at IS NULL
       WHERE t.event_id=?1 AND tm.deleted_at IS NULL AND tm.member_email=?2 LIMIT 1`
    ).bind(ev.id, email).first();
    if (tm) {
      const dup = await env.DB.prepare(
        "SELECT id FROM attendance WHERE event_id=?1 AND team_member_id=?2 AND deleted_at IS NULL"
      ).bind(ev.id, tm.id).first();
      if (dup) return json({ ok: true, already: true, message: `You're already checked in — see you on the court!` });
      await env.DB.prepare(
        `INSERT INTO attendance (org_id, event_id, contact_id, team_member_id, name_snapshot, method)
         VALUES (?1,?2,?3,?4,?5,'self')`
      ).bind(ev.org_id, ev.id, tm.contact_id || null, tm.id, tm.member_name).run();
      return json({ ok: true, message: `Checked in — welcome, ${tm.member_name}! 🏐` });
    }
  }
  // Not on a roster: record as unverified so the desk can sort it out.
  await env.DB.prepare(
    `INSERT INTO attendance (org_id, event_id, name_snapshot, method) VALUES (?1,?2,?3,'self')`
  ).bind(ev.org_id, ev.id, name || email).run();
  return json({ ok: true, unmatched: true,
    message: "Checked in. We couldn't find you on a roster — please stop by the desk so staff can sort you in." });
}

/* ---------------- member: my attendance ---------------- */

async function myAttendance(env, ctx) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const u = await env.DB.prepare("SELECT email FROM users WHERE id=?1").bind(ctx.userId).first();
  if (!u) return json({ attendance: [] });
  const rows = (await env.DB.prepare(
    `SELECT a.checked_in_at, a.method, e.name AS event_name, e.starts_at, e.type
     FROM attendance a
     JOIN contacts c ON c.id = a.contact_id AND c.deleted_at IS NULL
     JOIN events e ON e.id = a.event_id AND e.deleted_at IS NULL
     WHERE c.email = ?1 AND a.deleted_at IS NULL
     ORDER BY a.checked_in_at DESC LIMIT 50`
  ).bind(u.email.toLowerCase()).all()).results;
  return json({ attendance: rows, total: rows.length });
}
