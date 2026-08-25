/**
 * Boomtown Platform — Pass / credit ledger
 * File: worker/src/passes.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.58.0
 * Requires migration 0035 (passes, pass_redemptions).
 *
 * Owner requirement (2026-08-03): "the ability to assign like class pass or mindbody" plus a
 * configurable membership and payment system.
 *
 * WHY THIS EXISTS, concretely. `membership_tiers.guest_passes_per_month` has shipped for several
 * releases. Staff can set it, the tier screen displays it, and NOTHING IN THE CODEBASE COULD EVER
 * SPEND ONE. The platform promised a member four guest passes a month and had no way to honour it.
 * This module is what makes that column mean something — and the same primitive is a class pass,
 * a lesson pack and a drop-in punch card, so three products come out of one ledger.
 *
 * A pass is: N sessions, valid between two dates, belonging to one contact.
 *   total_sessions = 10   → a punch card / lesson pack
 *   total_sessions = NULL → unlimited within the window (a monthly open-gym pass)
 *   kind = 'guest'        → spent BY the member ON somebody else; guest_name records who
 *
 * THE BALANCE IS DERIVED, NEVER STORED. There is no `used_sessions` column, deliberately.
 * Remaining = total_sessions − COUNT(live redemptions). A stored counter is a second source of
 * truth for one fact, and this codebase has the scar: F-26 was "has a live waiver" written twice,
 * drifted, and a gate passed that should have failed. A counter drifts on reversal, soft-delete
 * or retry; a COUNT() cannot. Every read here goes through PASS_REMAINING_SQL — one definition.
 *
 * REVERSAL IS A STATE CHANGE, NOT A DELETE. The desk mis-scans; the correction must be visible
 * next to the mistake. A reversed redemption stops counting against the balance but stays on the
 * record, with who reversed it and why.
 *
 * Routes (staff — requireStaff, org-scoped):
 *   GET    /api/admin/passes?contact_id=      → passes with live balances
 *   POST   /api/admin/passes                  → issue a pass
 *   POST   /api/admin/passes/:id/redeem       → spend one session
 *   POST   /api/admin/passes/:id/void         → soft-delete a pass (redemptions retained)
 *   POST   /api/admin/pass-redemptions/:id/reverse → undo a redemption
 *   POST   /api/admin/members/:contactId/guest-passes → materialise this month's tier allowance
 * Routes (member — session required):
 *   GET    /api/profile/passes                → my passes and what is left on each
 *
 * Pure (unit-tested): passStatus · normalizePassInput · monthKey · guestPassName
 */

let json, contactForSession, audit, requireStaff;
export function wirePasses(h) {
  ({ json, contactForSession, audit, requireStaff } = h);
}

export const PASS_KINDS = ["session", "guest", "trial", "open_gym"];
export const PASS_SOURCES = ["purchase", "tier_grant", "comp", "manual"];
export const MAX_SESSIONS = 500;

/**
 * ONE definition of "sessions used on this pass" (F-26). Every balance read interpolates this;
 * a second hand-written COUNT is exactly the drift the derived design exists to prevent.
 * Params are positional and fixed: the outer query binds org_id at ?1.
 */
export const PASS_USED_SQL =
  `(SELECT COUNT(*) FROM pass_redemptions r
     WHERE r.pass_id = p.id AND r.org_id = p.org_id
       AND r.deleted_at IS NULL AND r.reversed_at IS NULL)`;

/* ============================ pure helpers (unit-tested) ============================ */

/** Timestamps arrive in two shapes; both are UTC. The v0.54.0 lesson, applied on arrival. */
function ms(v) {
  if (!v) return null;
  let s = String(v).trim().replace(" ", "T");
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * What is left on a pass, and whether it can be spent right now.
 *
 * FAILS CLOSED. An unparseable date means "not usable", never "usable forever" — the same
 * direction as offerExpired and the capability-token fix. A pass is a thing of value; when the
 * data is corrupt the safe answer is to refuse and let a human look.
 *
 * @param {{total_sessions:number|null, starts_at:string, expires_at:string|null, deleted_at:string|null}} pass
 * @param {number} used live redemption count
 * @param {string} nowIso
 * @returns {{remaining:number|null, usable:boolean, reason:string|null}} remaining null = unlimited
 */
export function passStatus(pass, used = 0, nowIso = new Date().toISOString()) {
  const now = ms(nowIso);
  if (!Number.isFinite(now)) return { remaining: 0, usable: false, reason: "Can't read the current time." };
  if (pass?.deleted_at) return { remaining: 0, usable: false, reason: "This pass was voided." };

  const start = ms(pass?.starts_at);
  if (start !== null && !Number.isFinite(start)) {
    return { remaining: 0, usable: false, reason: "This pass has an unreadable start date." };
  }
  if (start !== null && now < start) {
    return { remaining: null, usable: false, reason: "This pass hasn't started yet." };
  }

  const exp = ms(pass?.expires_at);
  if (exp !== null && !Number.isFinite(exp)) {
    return { remaining: 0, usable: false, reason: "This pass has an unreadable expiry date." };
  }
  if (exp !== null && now > exp) {
    return { remaining: 0, usable: false, reason: "This pass has expired." };
  }

  const total = pass?.total_sessions;
  if (total === null || total === undefined) {
    return { remaining: null, usable: true, reason: null }; // unlimited within the window
  }
  const remaining = Math.max(0, Number(total) - Number(used || 0));
  if (remaining <= 0) return { remaining: 0, usable: false, reason: "This pass is all used up." };
  return { remaining, usable: true, reason: null };
}

/** Validate + normalize a pass being issued. */
export function normalizePassInput(body) {
  const name = String(body?.name ?? "").trim();
  if (!name) return { ok: false, error: "Give the pass a name, like \"10-session punch card\"." };
  if (name.length > 120) return { ok: false, error: "That name is too long." };

  const kind = String(body?.kind ?? "session");
  if (!PASS_KINDS.includes(kind)) return { ok: false, error: `"${kind}" isn't a pass type we support.` };
  const source = String(body?.source ?? "purchase");
  if (!PASS_SOURCES.includes(source)) return { ok: false, error: `"${source}" isn't a pass source we support.` };

  let total = body?.total_sessions;
  if (total === null || total === undefined || total === "") {
    total = null; // unlimited within the window
  } else {
    total = Number(total);
    if (!Number.isInteger(total) || total < 1) {
      return { ok: false, error: "Sessions must be a whole number of 1 or more; leave it blank for unlimited." };
    }
    if (total > MAX_SESSIONS) return { ok: false, error: `That's more than ${MAX_SESSIONS} sessions. Split it into separate passes.` };
  }

  // An unlimited pass with no end date never expires and can never be reconciled. Refuse it.
  const expires = body?.expires_at ? String(body.expires_at).trim() : null;
  if (total === null && !expires) {
    return { ok: false, error: "An unlimited pass needs an end date, otherwise it never runs out." };
  }
  if (expires && !Number.isFinite(ms(expires))) {
    return { ok: false, error: "That expiry date isn't readable. Use a date like 2026-12-31." };
  }

  const price = body?.price_cents === null || body?.price_cents === undefined || body?.price_cents === ""
    ? null : Number(body.price_cents);
  if (price !== null && (!Number.isInteger(price) || price < 0)) {
    return { ok: false, error: "Price has to be a whole number of cents, or blank." };
  }

  return {
    ok: true,
    value: {
      name, kind, source, total_sessions: total,
      starts_at: body?.starts_at ? String(body.starts_at).trim() : null,
      expires_at: expires,
      price_cents: price,
      tier_id: body?.tier_id ? Number(body.tier_id) : null,
      note: String(body?.note ?? "").trim().slice(0, 300) || null,
    },
  };
}

/** "2026-08" — the allowance bucket a monthly guest-pass grant belongs to. */
export function monthKey(nowIso = new Date().toISOString()) {
  return String(nowIso).slice(0, 7);
}

/** Stable, human name for an auto-granted allowance, so a second grant is detectable. */
export function guestPassName(tierName, month) {
  return `${tierName} guest passes · ${month}`;
}

/* ============================ shared queries ============================ */

const PASS_SELECT =
  `SELECT p.id, p.contact_id, p.name, p.kind, p.source, p.total_sessions, p.starts_at,
          p.expires_at, p.price_cents, p.tier_id, p.note, p.deleted_at,
          c.full_name AS member_name,
          ${PASS_USED_SQL} AS used
   FROM passes p LEFT JOIN contacts c ON c.id = p.contact_id AND c.org_id = p.org_id`;

function passOut(r, nowIso) {
  const st = passStatus(r, r.used, nowIso);
  return {
    id: r.id, contact_id: r.contact_id, member_name: r.member_name, name: r.name, kind: r.kind, source: r.source,
    total_sessions: r.total_sessions, used: r.used,
    remaining: st.remaining, usable: st.usable, reason: st.reason,
    starts_at: r.starts_at, expires_at: r.expires_at, price_cents: r.price_cents,
    tier_id: r.tier_id, note: r.note,
  };
}

/* ============================ routes ============================ */

export async function passesRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  const now = new Date().toISOString();
  let x;

  /* ---------------- staff ---------------- */

  if (p === "/api/admin/passes" && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const contactId = Number(url.searchParams.get("contact_id")) || null;
    const rows = (await env.DB.prepare(
      `${PASS_SELECT} WHERE p.org_id=?1 AND p.deleted_at IS NULL
        ${contactId ? "AND p.contact_id=?2" : ""}
       ORDER BY p.created_at DESC LIMIT 200`
    ).bind(...(contactId ? [ctx.orgId, contactId] : [ctx.orgId])).all()).results || [];
    return json({ passes: rows.map((r) => passOut(r, now)) });
  }

  if (p === "/api/admin/passes" && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const contactId = Number(body.contact_id);
    if (!contactId) return json({ error: "Pick a member first." }, 400);
    const contact = await env.DB.prepare(
      "SELECT id FROM contacts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(contactId, ctx.orgId).first();
    if (!contact) return json({ error: "That member isn't in this organisation." }, 404);

    const norm = normalizePassInput(body);
    if (!norm.ok) return json({ error: norm.error }, 400);
    const v = norm.value;

    const ins = await env.DB.prepare(
      `INSERT INTO passes (org_id, contact_id, name, kind, source, total_sessions, starts_at,
                           expires_at, price_cents, tier_id, note, created_by)
       VALUES (?1,?2,?3,?4,?5,?6, COALESCE(?7, datetime('now')), ?8,?9,?10,?11,?12)`
    ).bind(ctx.orgId, contactId, v.name, v.kind, v.source, v.total_sessions, v.starts_at,
           v.expires_at, v.price_cents, v.tier_id, v.note, ctx.userId || null).run();

    await audit(env, ctx, "pass.issue", "passes", ins.meta.last_row_id,
      { contact_id: contactId, sessions: v.total_sessions, kind: v.kind });
    return json({ ok: true, pass_id: ins.meta.last_row_id });
  }

  if ((x = p.match(/^\/api\/admin\/passes\/(\d+)\/redeem$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const passId = +x[1];
    const body = await request.json().catch(() => ({}));

    const row = await env.DB.prepare(
      `${PASS_SELECT} WHERE p.id=?2 AND p.org_id=?1`
    ).bind(ctx.orgId, passId).first();
    if (!row) return json({ error: "That pass doesn't exist." }, 404);

    const st = passStatus(row, row.used, now);
    // Refuse loudly with the human reason. A silent no-op at the door is how someone gets in free
    // and nobody notices for a month.
    if (!st.usable) return json({ error: st.reason || "That pass can't be used.", remaining: st.remaining }, 409);

    if (row.kind === "guest" && !String(body.guest_name || "").trim()) {
      return json({ error: "Who's the guest? Add a name so the pass is accounted for." }, 400);
    }

    const ins = await env.DB.prepare(
      `INSERT INTO pass_redemptions (org_id, pass_id, contact_id, event_id, attendance_id, guest_name, redeemed_by)
       VALUES (?1,?2,?3,?4,?5,?6,?7)`
    ).bind(ctx.orgId, passId, row.contact_id, body.event_id ? Number(body.event_id) : null,
           body.attendance_id ? Number(body.attendance_id) : null,
           String(body.guest_name || "").trim().slice(0, 120) || null, ctx.userId || null).run();

    const after = passStatus(row, Number(row.used) + 1, now);
    await audit(env, ctx, "pass.redeem", "passes", passId,
      { redemption_id: ins.meta.last_row_id, remaining: after.remaining });
    return json({ ok: true, redemption_id: ins.meta.last_row_id, remaining: after.remaining });
  }

  if ((x = p.match(/^\/api\/admin\/pass-redemptions\/(\d+)\/reverse$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const id = +x[1];
    const body = await request.json().catch(() => ({}));
    const r = await env.DB.prepare(
      "SELECT id, pass_id, reversed_at FROM pass_redemptions WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(id, ctx.orgId).first();
    if (!r) return json({ error: "That redemption doesn't exist." }, 404);
    if (r.reversed_at) return json({ error: "That one was already reversed." }, 409);

    await env.DB.prepare(
      `UPDATE pass_redemptions SET reversed_at=datetime('now'), reversed_by=?1, reverse_reason=?2
       WHERE id=?3 AND org_id=?4`
    ).bind(ctx.userId || null, String(body.reason || "").trim().slice(0, 200) || null, id, ctx.orgId).run();

    await audit(env, ctx, "pass.reverse", "pass_redemptions", id, { pass_id: r.pass_id });
    return json({ ok: true, note: "Session put back. The original entry stays on the record." });
  }

  if ((x = p.match(/^\/api\/admin\/passes\/(\d+)\/void$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const id = +x[1];
    const row = await env.DB.prepare(
      "SELECT id FROM passes WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(id, ctx.orgId).first();
    if (!row) return json({ error: "That pass doesn't exist." }, 404);
    await env.DB.prepare("UPDATE passes SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2")
      .bind(id, ctx.orgId).run();
    await audit(env, ctx, "pass.void", "passes", id, {});
    return json({ ok: true, note: "Pass voided. The history of what was used stays." });
  }

  /* ---- materialise a tier's monthly guest allowance into a real, spendable pass ---- */
  if ((x = p.match(/^\/api\/admin\/members\/(\d+)\/guest-passes$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const contactId = +x[1];

    // The live tier for this member, through the grant table that already decides entitlement.
    const tier = await env.DB.prepare(
      `SELECT t.id, t.name, t.guest_passes_per_month
       FROM membership_grants g JOIN membership_tiers t ON t.id = g.tier_id AND t.org_id = g.org_id
       WHERE g.org_id=?1 AND g.contact_id=?2 AND g.deleted_at IS NULL
         AND (g.starts_at IS NULL OR g.starts_at <= datetime('now'))
         AND (g.ends_at IS NULL OR g.ends_at > datetime('now'))
       ORDER BY t.rank DESC LIMIT 1`
    ).bind(ctx.orgId, contactId).first();

    if (!tier) return json({ error: "That member has no active membership tier." }, 409);
    if (!tier.guest_passes_per_month) {
      return json({ error: `The ${tier.name} tier doesn't include guest passes.` }, 409);
    }

    const month = monthKey(now);
    const name = guestPassName(tier.name, month);
    // Idempotent: running this twice in a month must not double the allowance.
    const already = await env.DB.prepare(
      "SELECT id FROM passes WHERE org_id=?1 AND contact_id=?2 AND name=?3 AND deleted_at IS NULL"
    ).bind(ctx.orgId, contactId, name).first();
    if (already) return json({ ok: true, pass_id: already.id, already_granted: true });

    const endOfMonth = `${month}-28T23:59:59Z`; // conservative: never grants past the month
    const ins = await env.DB.prepare(
      `INSERT INTO passes (org_id, contact_id, name, kind, source, total_sessions, expires_at, tier_id, created_by)
       VALUES (?1,?2,?3,'guest','tier_grant',?4,?5,?6,?7)`
    ).bind(ctx.orgId, contactId, name, tier.guest_passes_per_month, endOfMonth, tier.id, ctx.userId || null).run();

    await audit(env, ctx, "pass.tier_grant", "passes", ins.meta.last_row_id,
      { contact_id: contactId, tier_id: tier.id, sessions: tier.guest_passes_per_month });
    return json({ ok: true, pass_id: ins.meta.last_row_id, sessions: tier.guest_passes_per_month });
  }

  /* ---------------- member: my own passes ---------------- */

  if (p === "/api/profile/passes" && m === "GET") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    const rows = (await env.DB.prepare(
      `${PASS_SELECT} WHERE p.org_id=?1 AND p.contact_id=?2 AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC LIMIT 100`
    ).bind(ctx.orgId, me.id).all()).results || [];
    return json({ passes: rows.map((r) => passOut(r, now)) });
  }

  return null;
}
