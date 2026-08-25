/**
 * Boomtown Platform — Kiosk check-in (PIN/barcode, owner req #20)
 * File: worker/src/kiosk.js · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.39.0
 *
 * Req #20 verbatim: profiles collect pictures, plus a bar code scanner option or PIN,
 * displaying the profile and payment/overdue status and DENYING where appropriate;
 * "should be able to run off an ipad or tablet."
 *
 * WHAT THE DENY IS — AND IS NOT. The kiosk denies on an OWED BALANCE and on
 * not-on-roster. It NEVER gates on waiver status: D-MIN-8 ("no waiver gating anywhere",
 * owner 2026-07-26, re-affirmed 2026-07-29 "no gating") governs, exactly as checkin.js
 * v1.3 records. The deny req #20 asks for is the payment/overdue deny — the gym-desk
 * pattern — and that is the only deny here.
 *
 * ONE CODE, TWO INPUTS. Option A (owner-approved 2026-07-30): a random 8-char code from
 * a 31-char alphabet (no 0/O/1/I/L) is minted per contact. The profile page renders it
 * as a Code 128 barcode AND shows it in large type. A keyboard-wedge scanner and a
 * finger on the kiosk keyboard land in the same input field — one lookup path, no
 * separate PIN credential to memorize, zero member setup (mint-on-first-view).
 *
 * TOKEN REUSE. The kiosk authenticates by the event's existing checkin_token (minted by
 * staff via POST /api/events/:id/checkin-token — checkin.js precedent). One token per
 * event powers both checkin.html (member self check-in) and kiosk.html (desk iPad);
 * revoking it kills both, which is the desired blast radius.
 *
 * NAME ON SCREEN. The result screen shows the code-holder their own full name + photo —
 * the publicContactFields(self=true) precedent (profiles.js): possession of the code IS
 * the self. Standards §8 "First L." protects member-to-member surfaces, and every OTHER
 * member visible on this surface is nobody: the kiosk shows one person at a time.
 *
 * Routes:
 *   GET  /api/kiosk/:token            → event boot info for the kiosk screen (public, token-gated)
 *   POST /api/kiosk/:token/scan       → { code } → profile + decision (+ attendance row on allow)
 *   GET  /api/profile/kiosk-code      → own code, minted on first call (session)
 *   POST /api/profile/kiosk-code      → regenerate own code — old barcode stops working (session)
 *
 * Org scope: contacts / member_profiles / team_members / attendance statements all carry
 * org_id (F-11). The events lookup is BY TOKEN and unscoped by design — the token is the
 * credential, exactly as checkin.js eventByToken. Guarded in kiosk.test.mjs with a
 * negative control. Flood: unknown-code misses are rate-limited per event via audit_log
 * (messages.js flood precedent, adapted to a sessionless surface).
 */

let json, contactForSession, audit, isStaff, requireStaff;
export function wireKiosk(h) { ({ json, contactForSession, audit, isStaff, requireStaff } = h); }

import { balanceCents } from "./checkin.js"; // pure helper; checkin.js does not import kiosk.js — no cycle

/* ---------------- pure helpers (unit-tested) ---------------- */

/** No 0/O/1/I/L: unambiguous when read off a key tag or typed at a desk. 31^8 ≈ 8.5e11. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 8;
/** Unknown-code misses allowed per event per window before the kiosk asks for the desk. */
export const MISS_LIMIT = 30;
export const MISS_WINDOW_MIN = 5;

/** Random code via rejection sampling — no modulo bias (31*8=248 accepted byte values). */
export function mintCode(randomBytes) {
  const src = randomBytes || crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 4));
  let out = "";
  for (let i = 0; i < src.length && out.length < CODE_LENGTH; i++) {
    if (src[i] < 248) out += CODE_ALPHABET[src[i] % CODE_ALPHABET.length];
  }
  while (out.length < CODE_LENGTH) { // astronomically rare top-up
    const extra = crypto.getRandomValues(new Uint8Array(8));
    for (const b of extra) if (b < 248 && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % 31];
  }
  return out;
}

/** Scanner wedges append CR/LF and people type spaces and lowercase. Null = not a code. */
export function normalizeCode(raw) {
  const s = String(raw == null ? "" : raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{4,32}$/.test(s) ? s : null;
}

/**
 * The whole door policy in one pure function, in precedence order.
 * D-MIN-8: waiver status is deliberately NOT an input — it cannot gate what it never reaches.
 */
export function scanDecision({ found, onRoster, balanceCents: owed, alreadyIn }) {
  if (!found) return { status: "unknown" };
  if (!onRoster) return { status: "deny", reason: "not_registered" };
  if (Number(owed) > 0) return { status: "deny", reason: "balance_due" };
  return { status: "ok", already: !!alreadyIn };
}

/** §8-shape helper for any surface that is NOT the code-holder's own result screen. */
export function displayName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Member";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/* ---------------- routes ---------------- */

export async function kioskRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;
  if ((x = p.match(/^\/api\/kiosk\/([a-f0-9]{16,64})$/)) && m === "GET") return bootInfo(env, x[1]);
  if ((x = p.match(/^\/api\/kiosk\/([a-f0-9]{16,64})\/scan$/)) && m === "POST") return scan(request, env, x[1]);
  if (p === "/api/profile/kiosk-code" && m === "GET") return myCode(env, ctx, false);
  if (p === "/api/profile/kiosk-code" && m === "POST") return myCode(env, ctx, true);
  return null;
}

async function eventByToken(env, token) { // checkin.js precedent — token is the credential
  return env.DB.prepare(
    "SELECT * FROM events WHERE checkin_token=?1 AND deleted_at IS NULL AND status IN ('published','in_progress')"
  ).bind(token).first();
}

async function bootInfo(env, token) {
  const ev = await eventByToken(env, token);
  if (!ev) return json({ error: "This kiosk link isn't active. Ask staff to open a fresh one." }, 404);
  return json({ event: { name: ev.name, starts_at: ev.starts_at, location: ev.location } });
}

async function scan(request, env, token) {
  const ev = await eventByToken(env, token);
  if (!ev) return json({ error: "This kiosk link isn't active. Ask staff to open a fresh one." }, 404);

  // Flood guard: too many unknown codes at this event lately → cool off (guessing or a broken scanner).
  const miss = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM audit_log
     WHERE org_id=?1 AND action='kiosk.miss' AND entity='events' AND entity_id=?2
       AND created_at > datetime('now', ?3)`
  ).bind(ev.org_id, String(ev.id), `-${MISS_WINDOW_MIN} minutes`).first();
  if (miss && Number(miss.n) >= MISS_LIMIT) {
    return json({ error: "Too many unrecognized codes right now. Please see the desk." }, 429);
  }

  const body = await request.json().catch(() => ({}));
  const code = normalizeCode(body.code);
  if (!code) return json({ error: "Scan your pass, or type the 8-character code from your profile." }, 400);

  const c = await env.DB.prepare(
    "SELECT id, full_name, email FROM contacts WHERE org_id=?1 AND kiosk_code=?2 AND deleted_at IS NULL"
  ).bind(ev.org_id, code).first();

  if (!c) {
    await audit(env, { orgId: ev.org_id, userId: null }, "kiosk.miss", "events", ev.id, {});
    return json({ status: "unknown", message: "We don't recognize that code. Try again, or see the desk." }, 404);
  }

  // Roster match: contact link first, captain-typed email second — LOWERED BOTH SIDES (F-26).
  const tm = await env.DB.prepare(
    `SELECT tm.id AS team_member_id, tm.member_name, t.name AS team_name,
            (SELECT r.status FROM registrations r
              WHERE r.event_id=?1 AND r.team_id=t.id AND r.status != 'cancelled' AND r.deleted_at IS NULL
              ORDER BY r.id LIMIT 1) AS reg_status,
            (SELECT a.id FROM attendance a
              WHERE a.event_id=?1 AND a.team_member_id=tm.id AND a.deleted_at IS NULL LIMIT 1) AS attendance_id
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
     WHERE t.event_id=?1 AND tm.org_id=?2 AND tm.deleted_at IS NULL
       AND (tm.contact_id=?3 OR (tm.member_email IS NOT NULL AND lower(tm.member_email)=lower(?4)))
     LIMIT 1`
  ).bind(ev.id, ev.org_id, c.id, c.email || "").first();

  const prof = await env.DB.prepare(
    "SELECT avatar_r2_key FROM member_profiles WHERE org_id=?1 AND contact_id=?2"
  ).bind(ev.org_id, c.id).first();

  const owed = tm ? balanceCents(tm.reg_status, ev.price_cents) : 0;
  const d = scanDecision({ found: true, onRoster: !!tm, balanceCents: owed, alreadyIn: tm && !!tm.attendance_id });

  const member = {
    full_name: c.full_name || (tm && tm.member_name) || "Member",
    avatar_url: prof && prof.avatar_r2_key ? `/api/avatar/${prof.avatar_r2_key}` : null,
    team_name: tm ? tm.team_name : null,
  };

  if (d.status === "deny") {
    await audit(env, { orgId: ev.org_id, userId: null }, "kiosk.deny", "events", ev.id,
      { contact_id: c.id, reason: d.reason, balance_cents: owed });
    const message = d.reason === "balance_due"
      ? `There's a balance of $${(owed / 100).toFixed(2)} on your registration. Please see the desk to get checked in.`
      : "We couldn't find you on today's roster. Please see the desk.";
    return json({ status: "deny", reason: d.reason, balance_cents: owed, member, message });
  }

  if (!d.already) {
    try {
      const ins = await env.DB.prepare(
        `INSERT INTO attendance (org_id, event_id, contact_id, team_member_id, name_snapshot, method)
         VALUES (?1,?2,?3,?4,?5,'kiosk')`
      ).bind(ev.org_id, ev.id, c.id, tm.team_member_id, member.full_name).run();
      await audit(env, { orgId: ev.org_id, userId: null }, "kiosk.checkin", "attendance",
        ins.meta.last_row_id, { event: ev.id, contact_id: c.id });
    } catch (e) {
      // Two kiosks, one person, same instant: ux_attendance_member_live wins the race for us.
      if (!/UNIQUE|constraint/i.test(String(e && e.message))) throw e;
      d.already = true;
    }
  }

  return json({
    status: "ok", already: !!d.already, member,
    message: d.already ? "You're already checked in. Have a great game!" : "You're checked in. Have a great game!",
  });
}

async function myCode(env, ctx, regenerate) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const c = await contactForSession(env, ctx);
  if (!c) return json({ error: "Sign in first." }, 401);

  if (!regenerate && c.kiosk_code) return json({ code: c.kiosk_code });

  // Mint (or re-mint). The live-unique index is the referee; retry on the rare collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mintCode();
    try {
      await env.DB.prepare(
        "UPDATE contacts SET kiosk_code=?1, updated_at=datetime('now') WHERE id=?2 AND org_id=?3 AND deleted_at IS NULL"
      ).bind(code, c.id, ctx.orgId).run();
      await audit(env, ctx, regenerate && c.kiosk_code ? "kiosk.code.regenerate" : "kiosk.code.mint", "contacts", c.id, {});
      return json({ code, regenerated: !!(regenerate && c.kiosk_code) });
    } catch (e) {
      if (!/UNIQUE|constraint/i.test(String(e && e.message))) throw e;
    }
  }
  return json({ error: "Couldn't make a code just now. Try again in a moment." }, 500);
}
