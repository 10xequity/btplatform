/**
 * Boomtown Platform — Check-in & Attendance (Module 10)
 * File: worker/src/checkin.js · Version: v1.4 · Date: 2026-07-29 · Ships in: v0.35.0
 *
 * v1.3 (2026-07-29, D-MIN-8 OVERRIDES D-WV-7): the hard waiver gate is REMOVED.
 *   Owner decision 2026-07-29: "no gating." D-MIN-8 ("no waiver gating anywhere",
 *   2026-07-26) governs, and D-WV-7 (same day, hard gate at the door) is retired.
 *   Roadmap v12 §3 recorded D-MIN-8 as "in force" while this file contradicted it for
 *   three releases; that is now true rather than merely written down.
 *
 *   WHAT REPLACES THE GATE: recording, not refusal. Nobody is turned away, and every
 *   check-in still carries its waiver status — into the response (so the door UI can
 *   show a chip) and into the audit row (so the office can follow up afterwards).
 *   A gate that turns people away at the door and an advisory chip that does not are
 *   two different answers to one question; only one of them can ship. See F-6b/F-14.
 *
 *   REMOVED: waiverGateDecision(), OVERRIDE_MIN_CHARS, all three 409
 *   { waiver_required: true } responses, and the staff override reason. With no gate
 *   there is nothing to override, so an override field would be dead input. Historic
 *   attendance.checkin.waiver_override / attendance.walkin.waiver_override audit rows
 *   are left alone — we stop writing them, we do not rewrite the past.
 *
 *   FIXED, F-26: this file computed "has a live waiver" twice and the two versions
 *   disagreed. roster() matched `c.email = tm.member_email` (case-SENSITIVE, since
 *   SQLite `=` on TEXT is case-sensitive without COLLATE NOCASE) while hasValidWaiver()
 *   matched `lower(c.email) = lower(?)`. A contact stored `Jane@X.com` with a roster row
 *   `jane@x.com` therefore showed waiver_ok:0 on the roster and passed the gate — one
 *   module, one person, two answers. It lands exactly on captain-entered teammate emails,
 *   which are never normalised on entry because teammates never register. Both call sites
 *   now build their match from ONE exported helper so they cannot drift again.
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
 * Data: attendance table (migration 0006).
 *
 * F-27 CLOSED in v0.35.0: waiverReminderSweep (registrations.js — NOT waivers.js, the
 * v1.2 claim named the wrong file) was read and it did NOT mirror this predicate: its
 * email compare was case-sensitive (F-26's exact defect, third site) and it had no
 * contact_id branch. registrations.js v1.8 now builds its NOT EXISTS from the two
 * exports below; registrations.test.mjs guards against a raw compare returning.
 */

let json, audit, isStaff, requireStaff;
export function wireCheckin(h) { ({ json, audit, isStaff, requireStaff } = h); }

/* ---------------------------------------------------------------------------
 * ONE definition of "has a live waiver" (F-26).
 *
 * Both the bulk roster EXISTS and the single-row lookup are built from these two
 * exports, so the case-sensitivity split that shipped in v1.2 cannot recur.
 *
 * SECURITY: neither helper interpolates user data. WAIVER_IDENTITY_MATCH takes SQL
 * *placeholder names* ("?2", "tm.contact_id") supplied by this module as literals in
 * source, never values from a request. The values themselves are bound by the caller
 * via .bind(). There is no injection surface here; if a future edit ever passes a
 * request-derived string into these helpers, that edit is the bug.
 * --------------------------------------------------------------------------- */

/** A waiver row that is neither deleted nor expired. */
export const WAIVER_LIVE_PREDICATE =
  "w.deleted_at IS NULL AND w.expires_at > datetime('now')";

/**
 * Match a waiver's contact to a person, by contact id or by email.
 * Email comparison is lower() on BOTH sides — captain-entered teammate emails are not
 * normalised on entry, so a case-sensitive compare silently misses live waivers.
 * @param {string} contactExpr SQL expression or placeholder for the contact id
 * @param {string} emailExpr   SQL expression or placeholder for the email
 */
export function WAIVER_IDENTITY_MATCH(contactExpr, emailExpr) {
  return `(c.id = ${contactExpr} OR (${emailExpr} IS NOT NULL ` +
         `AND lower(c.email) = lower(${emailExpr})))`;
}

/**
 * Non-blocking waiver advisory. The replacement for v1.2's gate: it describes, it never
 * refuses. Pure, so it is unit-tested without a DB.
 *
 * `level` maps to design tokens, not to raw colour — 'ok' → --positive, 'warn' → --warn
 * (web/assets/tokens.css v0.3.0). Callers must not invent a third level; a chip with more
 * states than the data has is how F-23 happened.
 *
 * @param {boolean} waiverOk a current unexpired waiver exists for this person
 * @returns {{compliant:boolean, level:'ok'|'warn', label:string, detail:string|null,
 *            blocks:false}}
 */
export function waiverAdvisory(waiverOk) {
  if (waiverOk) {
    return { compliant: true, level: "ok", label: "Waiver on file",
      detail: null, blocks: false };
  }
  return { compliant: false, level: "warn", label: "No waiver on file",
    detail: "They can play today. Ask them to sign when there's a moment. " +
            "it takes about a minute on their phone.",
    blocks: false };
}

/** Does this person have a live waiver? Built from the shared helpers above. */
async function hasValidWaiver(env, orgId, { contactId = null, email = null }) {
  if (!contactId && !email) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM waivers w
      JOIN contacts c ON c.id = w.contact_id AND c.deleted_at IS NULL
      WHERE c.org_id = ?1 AND ${WAIVER_LIVE_PREDICATE}
        AND ${WAIVER_IDENTITY_MATCH("?2", "?3")}
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
            EXISTS (SELECT 1 FROM contacts c JOIN waivers w ON w.contact_id=c.id AND ${WAIVER_LIVE_PREDICATE}
                    WHERE c.org_id=tm.org_id AND c.deleted_at IS NULL
                      AND ${WAIVER_IDENTITY_MATCH("tm.contact_id", "tm.member_email")}) AS waiver_ok
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
     WHERE t.event_id = ?1 AND tm.deleted_at IS NULL
     ORDER BY t.name, tm.member_name`
  ).bind(eventId).all()).results;
  const walkins = (await env.DB.prepare(
    `SELECT id AS attendance_id, name_snapshot AS member_name, checked_in_at, method
     FROM attendance WHERE event_id=?1 AND team_member_id IS NULL AND deleted_at IS NULL ORDER BY checked_in_at`
  ).bind(eventId).all()).results;
  for (const r of rows) {
    r.balance_cents = balanceCents(r.reg_status, ev.price_cents);
    r.waiver = waiverAdvisory(!!r.waiver_ok); // v1.3 — chip data, never a gate
  }
  return json({
    event: { id: ev.id, name: ev.name, starts_at: ev.starts_at, has_token: !!ev.checkin_token, price_cents: ev.price_cents || 0 },
    roster: rows, walkins,
    checked_in: rows.filter(r => r.attendance_id).length + walkins.length,
    total: rows.length,
    waivers_missing: rows.filter(r => !r.waiver_ok).length, // v1.3 — one number for the desk
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

  // v1.3 (D-MIN-8): status is read and RECORDED. It never blocks.
  const ok = await hasValidWaiver(env, ev.org_id, { contactId: tm.contact_id, email: tm.member_email });
  const advisory = waiverAdvisory(ok);

  const ins = await env.DB.prepare(
    `INSERT INTO attendance (org_id, event_id, contact_id, team_member_id, name_snapshot, method, checked_by_user_id)
     VALUES (?1,?2,?3,?4,?5,'staff',?6)`
  ).bind(ev.org_id, eventId, tm.contact_id || null, tmId, tm.member_name, ctx.userId).run();
  await audit(env, ctx, "attendance.checkin", "attendance", ins.meta.last_row_id,
    { event: eventId, method: "staff", waiver_ok: ok });
  return json({ ok: true, checked_in: true, waiver: advisory, at: new Date().toISOString() });
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
      "SELECT id FROM contacts WHERE org_id=?1 AND lower(email)=?2 AND deleted_at IS NULL"
    ).bind(ev.org_id, email).first();
    if (c) contactId = c.id;
  }

  // v1.3: a walk-in with no email can never match a waiver. Under D-WV-7 that meant this
  // path refused nearly every walk-in; now it records them and flags the gap.
  const ok = await hasValidWaiver(env, ev.org_id, { contactId, email });
  const advisory = waiverAdvisory(ok);

  const ins = await env.DB.prepare(
    `INSERT INTO attendance (org_id, event_id, contact_id, name_snapshot, method, checked_by_user_id)
     VALUES (?1,?2,?3,?4,'staff',?5)`
  ).bind(ev.org_id, eventId, contactId, name, ctx.userId).run();
  await audit(env, ctx, "attendance.walkin", "attendance", ins.meta.last_row_id,
    { event: eventId, waiver_ok: ok });
  return json({ ok: true, id: ins.meta.last_row_id, waiver: advisory });
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

  if (email) {
    const tm = await env.DB.prepare(
      `SELECT tm.id, tm.contact_id, tm.member_name FROM team_members tm
       JOIN teams t ON t.id=tm.team_id AND t.deleted_at IS NULL
       WHERE t.event_id=?1 AND tm.deleted_at IS NULL AND lower(tm.member_email)=?2 LIMIT 1`
    ).bind(ev.id, email).first();
    if (tm) {
      const dup = await env.DB.prepare(
        "SELECT id FROM attendance WHERE event_id=?1 AND team_member_id=?2 AND deleted_at IS NULL"
      ).bind(ev.id, tm.id).first();
      if (dup) return json({ ok: true, already: true, message: `You're already checked in. See you on the court!` });

      // v1.3 (D-MIN-8): checked in either way. If a waiver is missing the member gets a
      // nudge and a link, not a closed door.
      const okW = await hasValidWaiver(env, ev.org_id, { contactId: tm.contact_id, email });
      await env.DB.prepare(
        `INSERT INTO attendance (org_id, event_id, contact_id, team_member_id, name_snapshot, method)
         VALUES (?1,?2,?3,?4,?5,'self')`
      ).bind(ev.org_id, ev.id, tm.contact_id || null, tm.id, tm.member_name).run();
      return json({ ok: true,
        message: `Checked in. Welcome, ${tm.member_name}! 🏐`,
        waiver: okW ? waiverAdvisory(true) : {
          ...waiverAdvisory(false),
          label: "We don't have your waiver yet",
          detail: "You're checked in. When you have a minute, signing takes about a minute.",
          sign_url: `${env.APP_URL || ""}/profile.html`,
        } });
    }
  }
  // Not on a roster: record as unverified so the desk can sort it out.
  await env.DB.prepare(
    `INSERT INTO attendance (org_id, event_id, name_snapshot, method) VALUES (?1,?2,?3,'self')`
  ).bind(ev.org_id, ev.id, name || email).run();
  return json({ ok: true, unmatched: true,
    message: "Checked in. We couldn't find you on a roster; please stop by the desk so staff can sort you in." });
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
     WHERE lower(c.email) = ?1 AND a.org_id = ?2 AND a.deleted_at IS NULL
     ORDER BY a.checked_in_at DESC LIMIT 50`
  ).bind(u.email.toLowerCase(), ctx.orgId).all()).results;
  return json({ attendance: rows, total: rows.length });
}

/* Changelog:
   v1.4 (2026-07-29) — comment-only: F-27 note corrected (the sweep lives in
     registrations.js, not waivers.js) and closed — registrations.js v1.8 now imports
     WAIVER_IDENTITY_MATCH + WAIVER_LIVE_PREDICATE from here. No behaviour change.
   v1.3 (2026-07-29) — D-MIN-8 overrides D-WV-7: hard waiver gate removed (3x 409 sites,
     waiverGateDecision, OVERRIDE_MIN_CHARS). Replaced with waiverAdvisory(), a
     non-blocking chip payload carried on the roster, both staff paths and the public
     path, plus waiver_ok recorded on every audit row and a waivers_missing count for the
     desk. F-26 fixed: roster() and hasValidWaiver() built two different email matches
     (case-sensitive vs case-insensitive); both now derive from WAIVER_IDENTITY_MATCH.
     Three further raw email compares normalised to lower() for the same reason.
   v1.1 (2026-07-25) — balanceCents()/OWED_STATUSES + reg balance on roster (M16).
   v1.0 (2026-07-23) — initial check-in module. */
