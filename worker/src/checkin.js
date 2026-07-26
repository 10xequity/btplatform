/**
 * Boomtown Platform — Check-in & Attendance (Module 10)
 * File: worker/src/checkin.js · Version: v1.2 · Date: 2026-07-26 · Ships in: v0.23.0
 *
 * v1.2 (2026-07-26, D-WV-7): the NO WAIVER chip is now a HARD GATE, not a warning.
 *   Owner decision 2026-07-26: nobody participates without a current, unexpired waiver.
 *   Enforcement lives here rather than at registration because teammates never register —
 *   the captain enters their name and email, so there is no teammate-side submit to block.
 *   The door is the first moment an un-waivered player actually exists as a person.
 *
 *   Staff check-in / walk-in without a valid waiver → 409 { waiver_required: true }.
 *   Staff may override with a typed reason (>= 8 chars); the override is AUDITED with the
 *   reason attached, because an override with no accountability is just a disabled gate.
 *   The public self-check-in link has NO override — a player cannot wave themselves through.
 *
 * v1.1 (2026-07-25, M16): balance-due at the door (Gymdesk pattern, standards §4) —
 *   roster rows carry the team's registration id/status and a server-computed
 *   balance_cents (event price when status is pending/email-sent/cash-pending;
 *   0 for paid/comped/none). Event payload adds price_cents. balanceCents() is a
 *   pure export for tests. Quick-resolve reuses POST /api/registrations/:id/mark-paid.
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

/** Minimum characters in an override reason. "ok" and "x" are not accountability. */
export const OVERRIDE_MIN_CHARS = 8;

/**
 * Pure gate decision — no DB, unit-tested in checkin.test.mjs.
 * @param {boolean} waiverOk  a current unexpired waiver exists for this person
 * @param {string}  reason    typed staff override reason, if any
 * @param {boolean} canOverride  false on the public self-check-in path
 * @returns {{allow:boolean, overridden:boolean, reason:string|null, error:string|null}}
 */
export function waiverGateDecision(waiverOk, reason, canOverride = true) {
  if (waiverOk) return { allow: true, overridden: false, reason: null, error: null };
  const r = String(reason == null ? "" : reason).trim();
  if (!canOverride) {
    return { allow: false, overridden: false, reason: null,
      error: "We don't have a current waiver on file for you. Sign it on your phone or see the front desk — it takes a minute." };
  }
  if (r.length >= OVERRIDE_MIN_CHARS) {
    return { allow: true, overridden: true, reason: r, error: null };
  }
  return { allow: false, overridden: false, reason: null,
    error: r.length
      ? `Override reason must be at least ${OVERRIDE_MIN_CHARS} characters — say what happened.`
      : "No current waiver on file. Have them sign, or check in with an override reason." };
}

/** Does this roster person have a live waiver? Same definition as roster()'s waiver_ok
 *  and waiverReminderSweep: a non-expired waivers row for a contact with that email. */
async function hasValidWaiver(env, orgId, { contactId = null, email = null }) {
  if (!contactId && !email) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM waivers w
      JOIN contacts c ON c.id = w.contact_id AND c.deleted_at IS NULL
      WHERE c.org_id = ?1 AND w.deleted_at IS NULL AND w.expires_at > datetime('now')
        AND (c.id = ?2 OR (?3 IS NOT NULL AND lower(c.email) = lower(?3)))
      LIMIT 1`
  ).bind(orgId, contactId, email).first();
  return !!row;
}

/* v1.1: statuses that still owe money. comped/paid/cancelled owe nothing. */
export const OWED_STATUSES = ["pending", "email-sent", "cash-pending"];
export function balanceCents(regStatus, priceCents) {
  if (!regStatus || !OWED_STATUSES.includes(String(regStatus))) return 0;
  const p = Number(priceCents);
  return Number.isFinite(p) && p > 0 ? Math.round(p) : 0;
}

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
            (SELECT r.id FROM registrations r WHERE r.event_id=?1 AND r.team_id=t.id AND r.status != 'cancelled' AND r.deleted_at IS NULL ORDER BY r.id LIMIT 1) AS reg_id,
            (SELECT r.status FROM registrations r WHERE r.event_id=?1 AND r.team_id=t.id AND r.status != 'cancelled' AND r.deleted_at IS NULL ORDER BY r.id LIMIT 1) AS reg_status,
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
  for (const r of rows) r.balance_cents = balanceCents(r.reg_status, ev.price_cents);
  return json({
    event: { id: ev.id, name: ev.name, starts_at: ev.starts_at, has_token: !!ev.checkin_token, price_cents: ev.price_cents || 0 },
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
  if (existing) { // toggle off = undo — never gated; you can always take a check-in back
    await env.DB.prepare("UPDATE attendance SET deleted_at=datetime('now') WHERE id=?1").bind(existing.id).run();
    await audit(env, ctx, "attendance.undo", "attendance", existing.id, { event: eventId });
    return json({ ok: true, checked_in: false });
  }

  // v1.2 waiver gate. A paid registrant is never turned away — staff override and the
  // player signs at the desk. What we refuse is a SILENT check-in with no waiver.
  const ok = await hasValidWaiver(env, ev.org_id, { contactId: tm.contact_id, email: tm.member_email });
  const g = waiverGateDecision(ok, b.override_reason, true);
  if (!g.allow) {
    return json({ error: g.error, waiver_required: true, override_available: true,
      team_member_id: tmId, member_name: tm.member_name, member_email: tm.member_email || null }, 409);
  }

  const ins = await env.DB.prepare(
    `INSERT INTO attendance (org_id, event_id, contact_id, team_member_id, name_snapshot, method, checked_by_user_id)
     VALUES (?1,?2,?3,?4,?5,'staff',?6)`
  ).bind(ev.org_id, eventId, tm.contact_id || null, tmId, tm.member_name, ctx.userId).run();
  await audit(env, ctx, g.overridden ? "attendance.checkin.waiver_override" : "attendance.checkin",
    "attendance", ins.meta.last_row_id,
    { event: eventId, method: "staff", ...(g.overridden ? { waiver_override_reason: g.reason } : {}) });
  return json({ ok: true, checked_in: true, waiver_overridden: g.overridden, at: new Date().toISOString() });
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

  // v1.2: a walk-in with no email can never match a waiver, so this gate fires on nearly
  // every walk-in by design — the desk either collects a signature or types why not.
  const ok = await hasValidWaiver(env, ev.org_id, { contactId, email });
  const g = waiverGateDecision(ok, b.override_reason, true);
  if (!g.allow) {
    return json({ error: g.error, waiver_required: true, override_available: true, walkin_name: name }, 409);
  }

  const ins = await env.DB.prepare(
    `INSERT INTO attendance (org_id, event_id, contact_id, name_snapshot, method, checked_by_user_id)
     VALUES (?1,?2,?3,?4,'staff',?5)`
  ).bind(ev.org_id, eventId, contactId, name, ctx.userId).run();
  await audit(env, ctx, g.overridden ? "attendance.walkin.waiver_override" : "attendance.walkin",
    "attendance", ins.meta.last_row_id,
    { event: eventId, ...(g.overridden ? { waiver_override_reason: g.reason } : {}) });
  return json({ ok: true, id: ins.meta.last_row_id, waiver_overridden: g.overridden });
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
      // v1.2 gate, NO override on the public path — a player can't wave themselves through.
      const okW = await hasValidWaiver(env, ev.org_id, { contactId: tm.contact_id, email });
      const g = waiverGateDecision(okW, null, false);
      if (!g.allow) {
        return json({ error: g.error, waiver_required: true,
          sign_url: `${env.APP_URL || ""}/profile.html`, member_name: tm.member_name }, 409);
      }
      await env.DB.prepare(
        `INSERT INTO attendance (org_id, event_id, contact_id, team_member_id, name_snapshot, method)
         VALUES (?1,?2,?3,?4,?5,'self')`
      ).bind(ev.org_id, ev.id, tm.contact_id || null, tm.id, tm.member_name).run();
      return json({ ok: true, message: `Checked in — welcome, ${tm.member_name}! 🏐` });
    }
  }
  // Not on a roster: record as unverified so the desk can sort it out.
  // v1.2 deliberately does NOT hard-gate here. This person is already being sent to the
  // desk, and the desk's walk-in route IS gated — so the waiver check happens there, with
  // a human present who can take a signature. Refusing at this step would leave someone
  // who just typed their name at a dead end with no way forward.
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
     WHERE c.email = ?1 AND a.org_id = ?2 AND a.deleted_at IS NULL
     ORDER BY a.checked_in_at DESC LIMIT 50`
  ).bind(u.email.toLowerCase(), ctx.orgId).all()).results;
  return json({ attendance: rows, total: rows.length });
}

/* Changelog: v1.1 (2026-07-25) — balanceCents()/OWED_STATUSES + reg balance on roster (M16).
   v1.0 (2026-07-23) — initial check-in module. */
