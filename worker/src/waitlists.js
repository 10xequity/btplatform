/**
 * Boomtown Platform — Waitlists (M16-precursor, "Waitlists" roadmap item)
 * File: worker/src/waitlists.js · Version: v1.1 · Date: 2026-07-25 · Ships in: v0.19.0 · v1.1 ships in v0.20.0
 *
 * Full events queue signups; a drop (admin cancel) auto-offers the next team an
 * expiring claim link that funnels into the normal registration flow (spec v0.2 §3.1).
 *
 * Public:
 *   POST /api/events/:id/waitlist            { email, name, phone?, team_name? } → { position }
 *   GET  /api/events/:id/waitlist/status?email= → { on_list, position, status }
 * Staff:
 *   GET  /api/admin/events/:id/waitlist                → queue + counts
 *   POST /api/admin/events/:id/waitlist/offer-next     { ttl_hours? } → offer next queued
 *   POST /api/admin/waitlists/:id/offer                { ttl_hours? } → offer a specific row (override)
 *   POST /api/admin/waitlists/:id/remove               → soft remove from queue
 *
 * Exports for registrations.js (one-way import; sendEmail is INJECTED via wireWaitlists
 * to avoid a circular module dependency):
 *   activeRegistrationCount(env, eventId) · waitlistGate(env, ev, email, token)
 *   markClaimed(env, waitlistId, regId) · offerNext(env, eventId, opts) · waitlistSweep(env)
 * Pure (unit-tested): computeIsFull · offerExpired · normalizeJoin · nextOfferExpiry
 */

import { sendPushToEmail } from "./push.js"; // v1.1 — push alongside offer email (one-way import, no cycle)

let json, audit, isStaff, requireStaff, sendEmail, escapeHtml;
export function wireWaitlists(helpers) {
  ({ json, audit, isStaff, requireStaff, sendEmail, escapeHtml } = helpers);
}

const OFFER_TTL_HOURS_DEFAULT = 48;
const ACTIVE_REG_STATUSES = "('pending','email-sent','paid','cash-pending','comped')";

/* ============================ pure helpers (unit-tested) ============================ */

/** Full only when a capacity is set and active registrations meet/exceed it. */
export function computeIsFull(capacity, activeCount) {
  const cap = Number(capacity);
  if (!Number.isFinite(cap) || cap <= 0) return false; // NULL/0 capacity = unlimited
  return Number(activeCount) >= cap;
}

/** An offer with no expiry never expires; otherwise compare ISO strings as dates. */
export function offerExpired(nowIso, expiresIso) {
  if (!expiresIso) return false;
  const now = Date.parse(nowIso), exp = Date.parse(expiresIso);
  // Fail closed. A corrupt expires_at previously read as "no expiry", so a claim link stayed
  // live forever — same bug class as the token defect in handoff 2.8 §2a.
  if (!Number.isFinite(exp)) return true;
  if (!Number.isFinite(now)) return false;
  return now > exp;
}

/** Validate + normalize a public join body. Returns { ok, error? , value? }. */
export function normalizeJoin(body) {
  const email = String(body?.email || "").trim().toLowerCase();
  const name = String(body?.name || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (!name) return { ok: false, error: "Name is required." };
  return {
    ok: true,
    value: {
      email,
      name: name.slice(0, 120),
      phone: String(body?.phone || "").trim().slice(0, 40) || null,
      team_name: String(body?.team_name || "").trim().slice(0, 120) || null,
    },
  };
}

/** ttlHours clamped to 1–168 (a week); returns SQLite-friendly ISO string. */
export function nextOfferExpiry(nowMs, ttlHours) {
  const h = Math.min(168, Math.max(1, Number(ttlHours) || OFFER_TTL_HOURS_DEFAULT));
  return new Date(nowMs + h * 3600000).toISOString().replace("T", " ").slice(0, 19);
}

/* ============================ shared queries ============================ */

export async function activeRegistrationCount(env, eventId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM registrations WHERE event_id=?1 AND status IN ${ACTIVE_REG_STATUSES} AND deleted_at IS NULL`
  ).bind(eventId).first();
  return row?.n || 0;
}

/**
 * Gate used by submitRegistration. ev = loaded event row (has capacity, org_id).
 * Returns { allowed:true, waitlistId? } or { allowed:false, error }.
 * A valid unexpired offer token for this event+email always admits (that's its job,
 * the spot was freed for this team) and pins the claim to the row.
 */
export async function waitlistGate(env, ev, email, token) {
  if (token) {
    const w = await env.DB.prepare(
      "SELECT id, email, status, offer_expires_at FROM waitlists WHERE offer_token=?1 AND event_id=?2 AND deleted_at IS NULL"
    ).bind(token, ev.id).first();
    if (!w || w.status !== "offered" || w.email !== email) {
      return { allowed: false, error: "This waitlist link isn't valid for that email address. Use the email the offer was sent to." };
    }
    if (offerExpired(new Date().toISOString(), w.offer_expires_at)) {
      await env.DB.prepare("UPDATE waitlists SET status='expired', updated_at=datetime('now') WHERE id=?1").bind(w.id).run();
      return { allowed: false, error: "This waitlist offer has expired — the spot went to the next team. You can rejoin the waitlist." };
    }
    return { allowed: true, waitlistId: w.id };
  }
  const count = await activeRegistrationCount(env, ev.id);
  if (computeIsFull(ev.capacity, count)) {
    return { allowed: false, error: "This event is full. Join the waitlist and we'll email you if a spot opens." };
  }
  return { allowed: true };
}

export async function markClaimed(env, waitlistId, regId) {
  await env.DB.prepare(
    "UPDATE waitlists SET status='claimed', claimed_registration_id=?1, updated_at=datetime('now') WHERE id=?2"
  ).bind(regId, waitlistId).run();
}

/* ============================ offer engine ============================ */

/**
 * Offer the next queued entry for an event (or a specific row via opts.rowId).
 * Skips (marks 'removed') queued entries that already hold an active registration.
 * Returns { offered:false, reason } or { offered:true, waitlist_id, email, expires_at }.
 */
export async function offerNext(env, eventId, opts = {}) {
  const ev = await env.DB.prepare(
    "SELECT id, org_id, name, capacity, status FROM events WHERE id=?1 AND deleted_at IS NULL"
  ).bind(eventId).first();
  if (!ev) return { offered: false, reason: "Event not found." };
  if (!["published", "in_progress"].includes(ev.status)) return { offered: false, reason: "Event isn't open for registration." };

  if (!opts.rowId) {
    const count = await activeRegistrationCount(env, eventId);
    if (computeIsFull(ev.capacity, count)) return { offered: false, reason: "Event is still full — no open spot to offer." };
  }

  for (let guard = 0; guard < 25; guard++) { // bounded loop over skippable entries
    const w = opts.rowId
      ? await env.DB.prepare(
          "SELECT * FROM waitlists WHERE id=?1 AND event_id=?2 AND deleted_at IS NULL"
        ).bind(opts.rowId, eventId).first()
      : await env.DB.prepare(
          "SELECT * FROM waitlists WHERE event_id=?1 AND status='queued' AND deleted_at IS NULL ORDER BY position LIMIT 1"
        ).bind(eventId).first();
    if (!w) return { offered: false, reason: opts.rowId ? "Waitlist entry not found." : "Waitlist is empty." };
    if (opts.rowId && !["queued", "offered", "expired"].includes(w.status)) {
      return { offered: false, reason: `Entry is ${w.status} — only queued, offered, or expired entries can be (re)offered.` };
    }

    // Skip anyone who already registered by other means.
    const already = await env.DB.prepare(
      `SELECT r.id FROM registrations r JOIN contacts c ON c.id=r.contact_id
       WHERE r.event_id=?1 AND c.email=?2 AND r.status IN ${ACTIVE_REG_STATUSES} AND r.deleted_at IS NULL`
    ).bind(eventId, w.email).first();
    if (already) {
      await env.DB.prepare("UPDATE waitlists SET status='removed', updated_at=datetime('now') WHERE id=?1").bind(w.id).run();
      if (opts.rowId) return { offered: false, reason: "That team already has an active registration — entry removed." };
      continue;
    }

    const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const expires = nextOfferExpiry(Date.now(), opts.ttlHours);
    await env.DB.prepare(
      `UPDATE waitlists SET status='offered', offer_token=?1, offer_expires_at=?2, offered_at=datetime('now'),
       updated_at=datetime('now') WHERE id=?3`
    ).bind(token, expires, w.id).run();

    const site = env.SITE_ORIGIN || "https://10xequity.github.io/btplatform";
    const link = `${site}/web/register.html?event=${eventId}&wtoken=${token}`;
    try {
      await sendEmail(env, w.email, `A spot opened up — ${ev.name}`,
        `<p>Hi ${escapeHtml(w.name)},</p>
         <p>A spot just opened in <strong>${escapeHtml(ev.name)}</strong> and your team is next on the waitlist.</p>
         <p><a href="${link}">Claim your spot →</a></p>
         <p>This link holds the spot until <strong>${escapeHtml(expires)} UTC</strong>. If it expires, the spot is offered to the next team in line.</p>`);
    } catch (e) { console.error("waitlist offer email failed", e); } // offer still stands; admin screen shows the link state
    try { // v1.1: push notification alongside the email (no-op until VAPID secrets are set)
      await sendPushToEmail(env, w.email, {
        title: "A spot opened up! 🏐",
        body: `You're next in line for ${ev.name}. Tap to claim before the offer expires.`,
        url: link, tag: `bt-wl-${w.id}`,
      });
    } catch (e) { console.error("waitlist offer push failed", e); }
    return { offered: true, waitlist_id: w.id, email: w.email, name: w.name, expires_at: expires };
  }
  return { offered: false, reason: "Too many skippable entries in a row — check the queue." };
}

/** Cron: expire stale offers, then auto-offer the next team for each affected event. */
export async function waitlistSweep(env) {
  const stale = (await env.DB.prepare(
    "SELECT id, event_id FROM waitlists WHERE status='offered' AND offer_expires_at < datetime('now') AND deleted_at IS NULL"
  ).all()).results;
  const events = new Set();
  for (const w of stale) {
    await env.DB.prepare("UPDATE waitlists SET status='expired', updated_at=datetime('now') WHERE id=?1").bind(w.id).run();
    events.add(w.event_id);
  }
  const offers = [];
  for (const eventId of events) {
    const r = await offerNext(env, eventId, {});
    if (r.offered) offers.push({ event_id: eventId, waitlist_id: r.waitlist_id });
  }
  return { expired: stale.length, autoOffered: offers.length, offers };
}

/* ============================ routes ============================ */

export async function waitlistRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;
  let match;

  if ((match = p.match(/^\/api\/events\/(\d+)\/waitlist$/)) && m === "POST") return joinWaitlist(request, env, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/waitlist\/status$/)) && m === "GET") return waitlistStatus(env, +match[1], url);
  if ((match = p.match(/^\/api\/admin\/events\/(\d+)\/waitlist$/)) && m === "GET") return adminList(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/admin\/events\/(\d+)\/waitlist\/offer-next$/)) && m === "POST") return adminOfferNext(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/admin\/waitlists\/(\d+)\/offer$/)) && m === "POST") return adminOfferRow(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/admin\/waitlists\/(\d+)\/remove$/)) && m === "POST") return adminRemove(env, ctx, +match[1]);
  return null; // not a waitlist route
}

async function loadOpenEvent(env, eventId) {
  const ev = await env.DB.prepare(
    "SELECT id, org_id, name, capacity, status FROM events WHERE id=?1 AND deleted_at IS NULL"
  ).bind(eventId).first();
  if (!ev || !["published", "in_progress"].includes(ev.status)) return null;
  return ev;
}

async function joinWaitlist(request, env, eventId) {
  const ev = await loadOpenEvent(env, eventId);
  if (!ev) return json({ error: "This event isn't open for registration." }, 404);

  const v = normalizeJoin(await request.json().catch(() => ({})));
  if (!v.ok) return json({ error: v.error }, 400);
  const { email, name, phone, team_name } = v.value;

  // The waitlist is only for full events — otherwise point them at normal registration.
  const count = await activeRegistrationCount(env, eventId);
  if (!computeIsFull(ev.capacity, count)) {
    return json({ error: "Good news — this event has open spots. Register normally instead.", open_spots: true }, 409);
  }

  // Dedupe: an existing live entry returns its position instead of double-queueing.
  const existing = await env.DB.prepare(
    "SELECT id, position, status FROM waitlists WHERE event_id=?1 AND email=?2 AND status IN ('queued','offered') AND deleted_at IS NULL"
  ).bind(eventId, email).first();
  if (existing) {
    const ahead = await queuedAhead(env, eventId, existing.position);
    return json({ ok: true, duplicate: true, position: ahead + 1, status: existing.status,
      message: "You're already on this waitlist." });
  }

  const pos = (await env.DB.prepare(
    "SELECT COALESCE(MAX(position),0)+1 AS p FROM waitlists WHERE event_id=?1"
  ).bind(eventId).first()).p;
  const ins = await env.DB.prepare(
    "INSERT INTO waitlists (org_id, event_id, email, name, phone, team_name, status, position) VALUES (?1,?2,?3,?4,?5,?6,'queued',?7)"
  ).bind(ev.org_id, eventId, email, name, phone, team_name, pos).run();
  await audit(env, { orgId: ev.org_id, userId: null }, "waitlist.join", "waitlists", ins.meta.last_row_id, { event: eventId });

  const ahead = await queuedAhead(env, eventId, pos);
  return json({ ok: true, position: ahead + 1,
    message: `You're #${ahead + 1} on the waitlist. We'll email ${email} if a spot opens.` });
}

/** Display position = live entries ahead of you + 1 (raw position never reuses numbers). */
async function queuedAhead(env, eventId, position) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM waitlists WHERE event_id=?1 AND status IN ('queued','offered') AND position<?2 AND deleted_at IS NULL"
  ).bind(eventId, position).first();
  return row?.n || 0;
}

async function waitlistStatus(env, eventId, url) {
  const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return json({ error: "email is required" }, 400);
  const w = await env.DB.prepare(
    "SELECT position, status FROM waitlists WHERE event_id=?1 AND email=?2 AND status IN ('queued','offered') AND deleted_at IS NULL"
  ).bind(eventId, email).first();
  if (!w) return json({ on_list: false });
  const ahead = await queuedAhead(env, eventId, w.position);
  return json({ on_list: true, position: ahead + 1, status: w.status });
}

/* ---------------- staff ---------------- */

async function adminList(env, ctx, eventId) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const ev = await env.DB.prepare(
    "SELECT id, name, capacity, status FROM events WHERE id=?1 AND deleted_at IS NULL"
  ).bind(eventId).first();
  if (!ev) return json({ error: "Event not found." }, 404);
  const rows = (await env.DB.prepare(
    `SELECT id, email, name, phone, team_name, status, position, offer_expires_at, offered_at,
            claimed_registration_id, created_at
     FROM waitlists WHERE event_id=?1 AND deleted_at IS NULL ORDER BY position`
  ).bind(eventId).all()).results;
  const active = await activeRegistrationCount(env, eventId);
  return json({ event: { id: ev.id, name: ev.name, capacity: ev.capacity },
    spots_taken: active, is_full: computeIsFull(ev.capacity, active), waitlist: rows });
}

async function adminOfferNext(request, env, ctx, eventId) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const b = await request.json().catch(() => ({}));
  const r = await offerNext(env, eventId, { ttlHours: b.ttl_hours });
  if (r.offered) await audit(env, ctx, "waitlist.offer", "waitlists", r.waitlist_id, { event: eventId, via: "offer-next" });
  return json(r, r.offered ? 200 : 409);
}

async function adminOfferRow(request, env, ctx, rowId) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const w = await env.DB.prepare("SELECT id, event_id FROM waitlists WHERE id=?1 AND deleted_at IS NULL").bind(rowId).first();
  if (!w) return json({ error: "Waitlist entry not found." }, 404);
  const b = await request.json().catch(() => ({}));
  // Admin override: offering a specific row ignores the is-it-full check by design.
  const r = await offerNext(env, w.event_id, { rowId, ttlHours: b.ttl_hours });
  if (r.offered) await audit(env, ctx, "waitlist.offer", "waitlists", rowId, { event: w.event_id, via: "override" });
  return json(r, r.offered ? 200 : 409);
}

async function adminRemove(env, ctx, rowId) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const w = await env.DB.prepare("SELECT id, event_id, status FROM waitlists WHERE id=?1 AND deleted_at IS NULL").bind(rowId).first();
  if (!w) return json({ error: "Waitlist entry not found." }, 404);
  if (w.status === "claimed") return json({ error: "This entry already claimed a spot — manage it from Registrations." }, 409);
  await env.DB.prepare("UPDATE waitlists SET status='removed', updated_at=datetime('now') WHERE id=?1").bind(rowId).run();
  await audit(env, ctx, "waitlist.remove", "waitlists", rowId, { event: w.event_id });
  return json({ ok: true });
}
