/**
 * Boomtown Platform — League Sub Finder
 * File: worker/src/subs.js · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.38.0
 *
 * Owner requirement #7 (verbatim): "A way to report if missing, for both solo and team play,
 * to search for a sub — and people who want to substitute can sign up for notifications for
 * subbing opportunities. Lists skill-level preference, gender requirements and type of game."
 * Volleyball only, per the same requirement. Migration 0026.
 *
 * Member routes (session required — the desk knows who is offering to show up):
 *   GET    /api/subs/me                        → { signup, my_open_requests }
 *   POST   /api/subs/signup                    { skill_levels[], genders[], game_types[], note? } → upsert live signup
 *   DELETE /api/subs/signup                    → soft-delete my signup
 *   GET    /api/subs/requests                  → open requests, org-scoped; requester shown as "First L."
 *   POST   /api/subs/requests                  { event_id?, needed_at?, skill_level?, gender_requirement?, game_type?, note? }
 *                                                → create + notify matching signups (in-app + email)
 *   POST   /api/subs/requests/:id/fill         → claim an open request (not your own); requester notified
 *   POST   /api/subs/requests/:id/cancel       → requester (or staff) cancels
 * Staff routes:
 *   GET    /api/admin/subs/signups             → active signups with contact name/email
 *   GET    /api/admin/subs/requests?status=    → requests incl. filled/cancelled, with names
 *
 * Rules baked in (standards §4/§8):
 *   - Every read and write is scoped to ctx.orgId; no route accepts an org_id from the client.
 *   - Member-visible names are "First L." — full names and emails only on /api/admin/*.
 *   - No member email address is ever included in any response body or another member's email.
 *   - Flood guard: OPEN_REQUESTS_MAX open requests per member per org (messages.js precedent).
 *   - Notification fan-out capped at NOTIFY_FANOUT_MAX per request (Worker CPU + D1 limits).
 *   - sendEmail/escapeHtml are INJECTED via wireSubs (waitlists.js precedent — no import cycle).
 * Pure (unit-tested): parseList · subMatches · normalizeSignup · normalizeRequest · displayName
 */

let json, contactForSession, audit, isStaff, requireStaff, sendEmail, escapeHtml;
export function wireSubs(helpers) {
  ({ json, contactForSession, audit, isStaff, requireStaff, sendEmail, escapeHtml } = helpers);
}

/** Flood guard: open requests one member may hold per org. */
export const OPEN_REQUESTS_MAX = 5;
/** Hard ceiling on notified signups per new request. */
export const NOTIFY_FANOUT_MAX = 200;

export const SKILLS = ["any", "b", "bb", "a", "aa", "open"];
export const GENDERS = ["any", "coed", "mens", "womens", "reverse"];
export const GAME_TYPES = ["any", "2s", "4s", "6s"];

/* ============================ pure helpers (unit-tested) ============================ */

/** CSV → normalized lowercase list restricted to `allowed`; empty/invalid → ['any']. */
export function parseList(csv, allowed) {
  const items = String(csv || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean)
    .filter(v => allowed.includes(v));
  if (!items.length || items.includes("any")) return ["any"];
  return [...new Set(items)];
}

/** One preference dimension matches when either side says 'any' or the list holds the value. */
function dimMatches(listCsv, value) {
  const list = String(listCsv || "any").toLowerCase().split(",").map(s => s.trim());
  const v = String(value || "any").toLowerCase();
  return v === "any" || list.includes("any") || list.includes(v);
}

/** A signup matches a request only when ALL THREE dimensions are compatible. */
export function subMatches(signup, request) {
  return dimMatches(signup.skill_levels, request.skill_level)
      && dimMatches(signup.genders, request.gender_requirement)
      && dimMatches(signup.game_types, request.game_type);
}

/** Validate + normalize a signup body. Accepts arrays or CSV strings. */
export function normalizeSignup(body) {
  const toCsv = v => Array.isArray(v) ? v.join(",") : v;
  return {
    skill_levels: parseList(toCsv(body?.skill_levels), SKILLS).join(","),
    genders: parseList(toCsv(body?.genders), GENDERS).join(","),
    game_types: parseList(toCsv(body?.game_types), GAME_TYPES).join(","),
    note: String(body?.note || "").trim().slice(0, 300) || null,
  };
}

/** Validate + normalize a request body. Single values; unknown → 'any'. Fail closed on junk ids. */
export function normalizeRequest(body) {
  const one = (v, allowed) => { const s = String(v || "any").toLowerCase().trim(); return allowed.includes(s) ? s : "any"; };
  const eventId = Number(body?.event_id);
  const neededAt = String(body?.needed_at || "").trim();
  // Accept only 'YYYY-MM-DD HH:MM' / ISO-ish strings; anything else is dropped, not stored.
  const neededOk = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(neededAt);
  return {
    event_id: Number.isInteger(eventId) && eventId > 0 ? eventId : null,
    needed_at: neededOk ? neededAt.replace("T", " ") : null,
    skill_level: one(body?.skill_level, SKILLS),
    gender_requirement: one(body?.gender_requirement, GENDERS),
    game_type: one(body?.game_type, GAME_TYPES),
    note: String(body?.note || "").trim().slice(0, 300) || null,
  };
}

/** Member-visible name: "First L." (standards §8). Null-safe. */
export function displayName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "A member";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

const LABELS = { b: "B", bb: "BB", a: "A", aa: "AA", open: "Open", coed: "Coed", mens: "Men's", womens: "Women's", reverse: "Reverse coed", "2s": "Doubles", "4s": "Fours", "6s": "Sixes", any: "Any" };
function label(v) { return LABELS[String(v || "any").toLowerCase()] || "Any"; }

/* ============================ shared queries ============================ */

async function myOpenRequestCount(env, orgId, contactId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sub_requests WHERE org_id=?1 AND requested_by_contact_id=?2 AND status='open' AND deleted_at IS NULL"
  ).bind(orgId, contactId).first();
  return row ? row.n : 0;
}

/** Notify matching, active signups about a new request. Individual emails — never a shared To. */
async function notifyMatches(env, orgId, req, requesterName, eventName) {
  const signups = (await env.DB.prepare(
    `SELECT s.contact_id, s.skill_levels, s.genders, s.game_types, c.email, c.full_name
       FROM sub_signups s JOIN contacts c ON c.id = s.contact_id AND c.deleted_at IS NULL
      WHERE s.org_id = ?1 AND s.deleted_at IS NULL AND s.contact_id != ?2
      LIMIT ${NOTIFY_FANOUT_MAX * 2}`
  ).bind(orgId, req.requested_by_contact_id).all()).results || [];

  const bits = [label(req.skill_level) + " level", label(req.gender_requirement), label(req.game_type)]
    .filter(b => b !== "Any").join(" · ");
  const when = req.needed_at ? ` on ${req.needed_at}` : "";
  const where = eventName ? ` for ${eventName}` : "";
  const title = "Sub opportunity";
  const body = `${requesterName} needs a sub${where}${when}${bits ? ` — ${bits}` : ""}. Open the Leagues page to claim it.`;

  let notified = 0;
  for (const s of signups) {
    if (notified >= NOTIFY_FANOUT_MAX) break;
    if (!subMatches(s, req)) continue;
    await env.DB.prepare(
      `INSERT INTO notifications (org_id, kind, target, contact_id, title, body, link, payload_json, sent_at)
       VALUES (?1,'sub_opportunity','member',?2,?3,?4,'leagues.html',?5,datetime('now'))`
    ).bind(orgId, s.contact_id, title, body, JSON.stringify({ request_id: req.id })).run();
    if (s.email) {
      // Copy contains no org email literal (standards §8 / F-40) and no other member's address.
      await sendEmail(env, s.email,
        "Sub opportunity — someone needs a player",
        `<p>Hi ${escapeHtml(displayName(s.full_name))},</p><p>${escapeHtml(body)}</p><p>First to claim it gets the spot.</p>`,
        orgId);
    }
    notified++;
  }
  return notified;
}

/* ============================ routes ============================ */

export async function subsRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;

  /* ---------------- member: my signup + counts ---------------- */
  if (p === "/api/subs/me" && m === "GET") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    const signup = await env.DB.prepare(
      "SELECT id, skill_levels, genders, game_types, note, created_at FROM sub_signups WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, me.id).first();
    return json({ signup: signup || null, my_open_requests: await myOpenRequestCount(env, ctx.orgId, me.id) });
  }

  /* ---------------- member: opt in / update prefs ---------------- */
  if (p === "/api/subs/signup" && m === "POST") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    const v = normalizeSignup(await safeBody(request));
    const live = await env.DB.prepare(
      "SELECT id FROM sub_signups WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, me.id).first();
    if (live) {
      await env.DB.prepare(
        "UPDATE sub_signups SET skill_levels=?1, genders=?2, game_types=?3, note=?4, updated_at=datetime('now') WHERE id=?5 AND org_id=?6"
      ).bind(v.skill_levels, v.genders, v.game_types, v.note, live.id, ctx.orgId).run();
    } else {
      await env.DB.prepare(
        "INSERT INTO sub_signups (org_id, contact_id, skill_levels, genders, game_types, note) VALUES (?1,?2,?3,?4,?5,?6)"
      ).bind(ctx.orgId, me.id, v.skill_levels, v.genders, v.game_types, v.note).run();
    }
    await audit(env, ctx, "subs.signup", "sub_signups", me.id, v);
    return json({ ok: true, signup: v, message: "You're on the sub list. We'll notify you when a spot matches your preferences." });
  }

  /* ---------------- member: opt out ---------------- */
  if (p === "/api/subs/signup" && m === "DELETE") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    await env.DB.prepare(
      "UPDATE sub_signups SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, me.id).run();
    await audit(env, ctx, "subs.optout", "sub_signups", me.id, {});
    return json({ ok: true, message: "You're off the sub list. Rejoin any time." });
  }

  /* ---------------- member: browse open requests ---------------- */
  if (p === "/api/subs/requests" && m === "GET") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    const rows = (await env.DB.prepare(
      `SELECT r.id, r.event_id, e.name AS event_name, r.needed_at, r.skill_level,
              r.gender_requirement, r.game_type, r.note, r.created_at,
              c.full_name AS requester_full, (r.requested_by_contact_id = ?2) AS mine
         FROM sub_requests r
         JOIN contacts c ON c.id = r.requested_by_contact_id
         LEFT JOIN events e ON e.id = r.event_id AND e.deleted_at IS NULL
        WHERE r.org_id = ?1 AND r.status = 'open' AND r.deleted_at IS NULL
        ORDER BY COALESCE(r.needed_at, r.created_at) ASC LIMIT 100`
    ).bind(ctx.orgId, me.id).all()).results || [];
    return json({
      requests: rows.map(r => ({
        id: r.id, event_id: r.event_id, event_name: r.event_name, needed_at: r.needed_at,
        skill_level: r.skill_level, gender_requirement: r.gender_requirement, game_type: r.game_type,
        note: r.note, created_at: r.created_at, requester: displayName(r.requester_full), mine: !!r.mine,
      })),
    });
  }

  /* ---------------- member: post a request ---------------- */
  if (p === "/api/subs/requests" && m === "POST") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    if ((await myOpenRequestCount(env, ctx.orgId, me.id)) >= OPEN_REQUESTS_MAX) {
      return json({ error: `You already have ${OPEN_REQUESTS_MAX} open sub requests. Cancel one before posting another.` }, 429);
    }
    const v = normalizeRequest(await safeBody(request));
    let eventName = null;
    if (v.event_id) {
      const ev = await env.DB.prepare(
        "SELECT id, name FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
      ).bind(v.event_id, ctx.orgId).first();
      if (!ev) return json({ error: "That event isn't available." }, 404); // org-scoped: a foreign event id fails closed
      eventName = ev.name;
    }
    const ins = await env.DB.prepare(
      `INSERT INTO sub_requests (org_id, event_id, requested_by_contact_id, needed_at, skill_level, gender_requirement, game_type, note)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
    ).bind(ctx.orgId, v.event_id, me.id, v.needed_at, v.skill_level, v.gender_requirement, v.game_type, v.note).run();
    const reqRow = { id: ins.meta.last_row_id, requested_by_contact_id: me.id, ...v };
    const notified = await notifyMatches(env, ctx.orgId, reqRow, displayName(me.full_name), eventName);
    await audit(env, ctx, "subs.request.create", "sub_requests", reqRow.id, { ...v, notified });
    return json({ ok: true, request_id: reqRow.id, notified,
      message: notified ? `Posted — ${notified} matching sub${notified === 1 ? "" : "s"} notified.` : "Posted. No matching subs are signed up yet; it stays visible on the sub board." });
  }

  /* ---------------- member: claim / cancel ---------------- */
  const act = p.match(/^\/api\/subs\/requests\/(\d+)\/(fill|cancel)$/);
  if (act && m === "POST") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    const id = +act[1];
    const row = await env.DB.prepare(
      `SELECT r.*, c.email AS requester_email, c.full_name AS requester_full
         FROM sub_requests r JOIN contacts c ON c.id = r.requested_by_contact_id
        WHERE r.id=?1 AND r.org_id=?2 AND r.deleted_at IS NULL`
    ).bind(id, ctx.orgId).first();
    if (!row) return json({ error: "That request isn't available." }, 404);

    if (act[2] === "fill") {
      if (row.status !== "open") return json({ error: "Someone already took this one." }, 409);
      if (row.requested_by_contact_id === me.id) return json({ error: "You can't fill your own request." }, 400);
      const upd = await env.DB.prepare(
        "UPDATE sub_requests SET status='filled', filled_by_contact_id=?1, filled_at=datetime('now'), updated_at=datetime('now') WHERE id=?2 AND org_id=?3 AND status='open'"
      ).bind(me.id, id, ctx.orgId).run();
      if (!upd.meta.changes) return json({ error: "Someone already took this one." }, 409); // atomic guard: WHERE status='open' loses the race safely
      const subName = displayName(me.full_name);
      await env.DB.prepare(
        `INSERT INTO notifications (org_id, kind, target, contact_id, title, body, link, payload_json, sent_at)
         VALUES (?1,'sub_filled','member',?2,'Your sub request was filled',?3,'leagues.html',?4,datetime('now'))`
      ).bind(ctx.orgId, row.requested_by_contact_id, `${subName} is covering your spot. See you on the court.`,
             JSON.stringify({ request_id: id })).run();
      if (row.requester_email) {
        await sendEmail(env, row.requester_email, "Your sub request was filled",
          `<p>Hi ${escapeHtml(displayName(row.requester_full))},</p><p>${escapeHtml(subName)} is covering your spot. See you on the court.</p>`, ctx.orgId);
      }
      await audit(env, ctx, "subs.request.fill", "sub_requests", id, { by: me.id });
      return json({ ok: true, message: "You're in — the requester has been notified. Thanks for stepping up." });
    }

    // cancel: requester or staff only
    if (row.requested_by_contact_id !== me.id && !(await isStaff(env, ctx))) {
      return json({ error: "Only the requester can cancel this." }, 403);
    }
    if (row.status !== "open") return json({ error: "This request is already closed." }, 409);
    await env.DB.prepare(
      "UPDATE sub_requests SET status='cancelled', updated_at=datetime('now') WHERE id=?1 AND org_id=?2 AND status='open'"
    ).bind(id, ctx.orgId).run();
    await audit(env, ctx, "subs.request.cancel", "sub_requests", id, {});
    return json({ ok: true, message: "Request cancelled." });
  }

  /* ---------------- staff ---------------- */
  if (p === "/api/admin/subs/signups" && m === "GET") {
    const gate = await requireStaff(env, ctx); if (gate) return gate;
    const rows = (await env.DB.prepare(
      `SELECT s.id, s.contact_id, c.full_name, c.email, s.skill_levels, s.genders, s.game_types, s.note, s.created_at
         FROM sub_signups s JOIN contacts c ON c.id = s.contact_id AND c.deleted_at IS NULL
        WHERE s.org_id = ?1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 500`
    ).bind(ctx.orgId).all()).results || [];
    return json({ signups: rows });
  }
  if (p === "/api/admin/subs/requests" && m === "GET") {
    const gate = await requireStaff(env, ctx); if (gate) return gate;
    const status = url.searchParams.get("status");
    const rows = (await env.DB.prepare(
      `SELECT r.*, c.full_name AS requester_name, f.full_name AS filled_by_name, e.name AS event_name
         FROM sub_requests r
         JOIN contacts c ON c.id = r.requested_by_contact_id
         LEFT JOIN contacts f ON f.id = r.filled_by_contact_id
         LEFT JOIN events e ON e.id = r.event_id
        WHERE r.org_id = ?1 AND r.deleted_at IS NULL AND (?2 IS NULL OR r.status = ?2)
        ORDER BY r.created_at DESC LIMIT 500`
    ).bind(ctx.orgId, status || null).all()).results || [];
    return json({ requests: rows });
  }

  return null;
}

async function safeBody(request) {
  try { return await request.json(); } catch { return {}; }
}
