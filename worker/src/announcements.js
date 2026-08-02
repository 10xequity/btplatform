/**
 * Boomtown Platform — Announcements, member home feed, sub availability
 * File: worker/src/announcements.js · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.50.0
 *
 * Owner spec (handoff v0_49_0 §3, decided 2026-08-02):
 *   (1) Admin priority CTA posts (kind='cta') push to every member, are PINNED FIRST and
 *       CANNOT be dismissed or muted — this module refuses to write a mute for a cta
 *       (fail closed; the schema carries no cta-mute rows because no route will create one).
 *   (2) Members can hide/mute everything else: this-one (scope='item') or all-future
 *       (scope='category': news, events, my_events, messages, subs, community).
 *   (3) The box aggregates upcoming events, registered events, messages, invites, subs.
 *   (4) Sub availability is opt-in with passive vs actively-looking state; actively-looking
 *       members post the level they want to play at — that upserts ONE LFG player_avail
 *       listing tracked by member_profiles.sub_lfg_listing_id, so leaving active mode closes
 *       exactly that listing and never a hand-posted one.
 *
 * Member routes (session required):
 *   GET    /api/home/feed                      → { ctas, categories:{...}, muted_categories, sub }
 *   POST   /api/announcements/mute             → { scope:'item'|'category', announcement_id?|category? }
 *   POST   /api/announcements/unmute           → same body; soft-deleted mute restored to live
 *   PUT    /api/me/sub-availability            → { opt_in, mode:'passive'|'active', level? }
 * Staff routes (requireStaff):
 *   GET    /api/admin/announcements            → all posts incl. scheduled/expired (not deleted)
 *   POST   /api/admin/announcements            → { kind, title, body?, link_url?, link_label?, starts_at?, ends_at? }
 *   PUT    /api/admin/announcements/:id        → same fields, partial
 *   DELETE /api/admin/announcements/:id        → soft delete
 * Public (mounted in index.js BEFORE buildCtx — the icsFeed precedent; NO session):
 *   GET    /api/public/org-brand?org=<id|slug> → { org_id, display_name, logo_url }
 *       Only active, non-deleted orgs resolve; only the three brand fields ever leave
 *       (standards §8 — no email/legal fields); Cache-Control ~5 minutes.
 *
 * Rules baked in (standards §4/§8):
 *   - Every org-scoped read and write binds ctx.orgId; no route accepts an org_id for
 *     scoping from the client (F-11: index.js fails closed before this module sees ctx).
 *   - CTA pinning and non-mutability are SERVER rules, not UI conveniences.
 *   - Feed category keys are the shared vocabulary for mutes; unknown categories are
 *     rejected (fail closed on parse, offerExpired precedent).
 *   - Member-visible strings carry no other member's email (messages.js rule).
 * Pure (unit-tested): isLive · muteKeyValid · normalizeSubBody · CATEGORIES
 */

import { SKILLS } from "./subs.js"; // shared volleyball vocab (0026)

let json, contactForSession, audit, isStaff, requireStaff;
export function wireAnnouncements(helpers) {
  ({ json, contactForSession, audit, isStaff, requireStaff } = helpers);
}

/** Feed categories a member may mute. 'cta' is deliberately NOT here. */
export const CATEGORIES = ["news", "events", "my_events", "messages", "subs", "community"];

/** Upcoming-events window and list caps for the aggregated box. */
export const UPCOMING_DAYS = 30;
export const FEED_CAP = 6; // per category — click-minimization (req #19), the box stays a box

/* ============================ pure helpers (unit-tested) ============================ */

/** A post is live when not deleted, started (or unscheduled), and not yet ended. */
export function isLive(row, now = new Date()) {
  if (!row || row.deleted_at) return false;
  const t = (v) => Date.parse(String(v).replace(" ", "T") + "Z");
  if (row.starts_at && t(row.starts_at) > now.getTime()) return false;
  if (row.ends_at && t(row.ends_at) <= now.getTime()) return false;
  return true;
}

/** Validate a mute request body. CTA items and unknown categories fail closed. */
export function muteKeyValid(body) {
  if (!body || typeof body !== "object") return false;
  if (body.scope === "item") return Number.isInteger(body.announcement_id) && body.announcement_id > 0;
  if (body.scope === "category") return CATEGORIES.includes(body.category);
  return false;
}

/** Normalize a sub-availability body; null = invalid (fail closed). */
export function normalizeSubBody(body) {
  if (!body || typeof body !== "object") return null;
  const opt_in = body.opt_in === true || body.opt_in === 1;
  const mode = body.mode === "active" ? "active" : "passive";
  let level = null;
  if (mode === "active") {
    level = String(body.level || "any").toLowerCase();
    if (!SKILLS.includes(level)) return null;
  }
  return { opt_in, mode, level };
}

/* ============================ public: org brand ============================ */

/**
 * NO session, NO ctx — resolves an org by id or slug for member-page branding.
 * Returns exactly three fields; a wider SELECT here would leak org PII to the world.
 */
export async function publicOrgBrand(env, url) {
  const q = String(url.searchParams.get("org") || "").trim();
  if (!q) return json({ error: "Which organization?" }, 400);
  const byId = /^\d+$/.test(q);
  const row = await env.DB.prepare(
    `SELECT id, name, logo_url FROM orgs
      WHERE ${byId ? "id = ?1" : "slug = lower(?1)"} AND active = 1 AND deleted_at IS NULL`
  ).bind(byId ? Number(q) : q.toLowerCase()).first();
  if (!row) return json({ error: "That organization isn't available." }, 404);
  const res = json({ org_id: row.id, display_name: row.name, logo_url: row.logo_url || null });
  res.headers.set("Cache-Control", "public, max-age=300"); // ~5 min (spec, handoff §4)
  return res;
}

/* ============================ routes ============================ */

export async function announcementsRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;

  /* ---------------- member: the aggregated home feed ---------------- */
  if (p === "/api/home/feed" && m === "GET") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    const now = new Date();

    const mutes = (await env.DB.prepare(
      `SELECT scope, category, announcement_id FROM announcement_mutes
        WHERE org_id = ?1 AND contact_id = ?2 AND deleted_at IS NULL`
    ).bind(ctx.orgId, me.id).all()).results || [];
    const mutedCategories = new Set(mutes.filter((x) => x.scope === "category").map((x) => x.category));
    const mutedItems = new Set(mutes.filter((x) => x.scope === "item").map((x) => x.announcement_id));

    const posts = (await env.DB.prepare(
      `SELECT id, kind, title, body, link_url, link_label, starts_at, ends_at, created_at
         FROM announcements
        WHERE org_id = ?1 AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 50`
    ).bind(ctx.orgId).all()).results || [];
    const live = posts.filter((r) => isLive(r, now));
    const ctas = live.filter((r) => r.kind === "cta"); // pinned, never muted — server rule
    const news = mutedCategories.has("news")
      ? []
      : live.filter((r) => r.kind === "news" && !mutedItems.has(r.id)).slice(0, FEED_CAP);

    const categories = { news };

    if (!mutedCategories.has("events")) {
      categories.events = (await env.DB.prepare(
        `SELECT id, name, type, starts_at, location FROM events
          WHERE org_id = ?1 AND status = 'published' AND deleted_at IS NULL
            AND starts_at >= datetime('now') AND starts_at <= datetime('now', '+${UPCOMING_DAYS} days')
          ORDER BY starts_at ASC LIMIT ${FEED_CAP}`
      ).bind(ctx.orgId).all()).results || [];
    }

    if (!mutedCategories.has("my_events")) {
      categories.my_events = (await env.DB.prepare(
        `SELECT r.id AS registration_id, r.status, e.id AS event_id, e.name, e.starts_at
           FROM registrations r JOIN events e ON e.id = r.event_id AND e.deleted_at IS NULL
          WHERE r.org_id = ?1 AND r.contact_id = ?2 AND r.deleted_at IS NULL
            AND r.status IN ('paid','cash-pending','comped','pending','email-sent')
            AND (e.starts_at IS NULL OR e.starts_at >= datetime('now','-1 day'))
          ORDER BY e.starts_at ASC LIMIT ${FEED_CAP}`
      ).bind(ctx.orgId, me.id).all()).results || [];
    }

    if (!mutedCategories.has("messages")) {
      // mirrors messages.js unreadCount exactly — one definition of "unread"
      const u = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM messages m
         JOIN thread_participants tp ON tp.thread_id=m.thread_id AND tp.contact_id=?2 AND tp.deleted_at IS NULL
         JOIN message_threads t ON t.id=m.thread_id AND t.deleted_at IS NULL
         WHERE m.org_id=?1 AND m.deleted_at IS NULL AND m.sender_contact_id != ?2
           AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)`
      ).bind(ctx.orgId, me.id).first().catch(() => null);
      categories.messages = { unread: (u && u.n) || 0 };
    }

    if (!mutedCategories.has("subs")) {
      categories.subs = (await env.DB.prepare(
        `SELECT r.id, r.needed_at, r.skill_level, r.game_type, e.name AS event_name
           FROM sub_requests r LEFT JOIN events e ON e.id = r.event_id AND e.deleted_at IS NULL
          WHERE r.org_id = ?1 AND r.status = 'open' AND r.deleted_at IS NULL
          ORDER BY COALESCE(r.needed_at, r.created_at) ASC LIMIT ${FEED_CAP}`
      ).bind(ctx.orgId).all()).results || [];
    }

    if (!mutedCategories.has("community")) {
      categories.community = (await env.DB.prepare(
        `SELECT id, kind, team_name, skill_level, game_type, play_at FROM lfg_listings
          WHERE org_id = ?1 AND status = 'open' AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT ${FEED_CAP}`
      ).bind(ctx.orgId).all()).results || [];
    }

    const prof = await env.DB.prepare(
      `SELECT sub_opt_in, sub_mode, sub_level FROM member_profiles
        WHERE org_id = ?1 AND contact_id = ?2 AND deleted_at IS NULL`
    ).bind(ctx.orgId, me.id).first();

    return json({
      ctas,
      categories,
      muted_categories: [...mutedCategories],
      muted_items: [...mutedItems],
      sub: {
        opt_in: !!(prof && prof.sub_opt_in),
        mode: (prof && prof.sub_mode) || "passive",
        level: (prof && prof.sub_level) || null,
      },
    });
  }

  /* ---------------- member: mute / unmute ---------------- */
  if ((p === "/api/announcements/mute" || p === "/api/announcements/unmute") && m === "POST") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Send scope and what to mute." }, 400); }
    if (!muteKeyValid(body)) return json({ error: "Send scope 'item' with announcement_id, or scope 'category' with a known category." }, 400);

    if (body.scope === "item") {
      // Owner rule 1: the admin priority CTA can never be muted — fail closed, org-scoped lookup.
      const target = await env.DB.prepare(
        "SELECT kind FROM announcements WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL"
      ).bind(body.announcement_id, ctx.orgId).first();
      if (!target) return json({ error: "That announcement isn't available." }, 404);
      if (target.kind === "cta") return json({ error: "This announcement is from your organization and can't be hidden." }, 403);
    }

    const cat = body.scope === "category" ? body.category : null;
    const itemId = body.scope === "item" ? body.announcement_id : null;
    if (p.endsWith("/mute")) {
      await env.DB.prepare(
        `INSERT INTO announcement_mutes (org_id, contact_id, scope, category, announcement_id)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (org_id, contact_id, scope, category, announcement_id)
         DO UPDATE SET deleted_at = NULL`
      ).bind(ctx.orgId, me.id, body.scope, cat, itemId).run();
    } else {
      await env.DB.prepare(
        `UPDATE announcement_mutes SET deleted_at = datetime('now')
          WHERE org_id = ?1 AND contact_id = ?2 AND scope = ?3
            AND category IS ?4 AND announcement_id IS ?5 AND deleted_at IS NULL`
      ).bind(ctx.orgId, me.id, body.scope, cat, itemId).run();
    }
    return json({ ok: true });
  }

  /* ---------------- member: sub availability (owner rule 4) ---------------- */
  if (p === "/api/me/sub-availability" && m === "PUT") {
    const me = await contactForSession(env, ctx);
    if (!me) return json({ error: "Sign in first." }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Send opt_in, mode, and (when active) level." }, 400); }
    const norm = normalizeSubBody(body);
    if (!norm) return json({ error: `Pick a level from: ${SKILLS.join(", ")}.` }, 400);

    const prof = await env.DB.prepare(
      `SELECT id, sub_lfg_listing_id FROM member_profiles
        WHERE org_id = ?1 AND contact_id = ?2 AND deleted_at IS NULL`
    ).bind(ctx.orgId, me.id).first();
    if (!prof) {
      await env.DB.prepare(
        "INSERT INTO member_profiles (org_id, contact_id) VALUES (?1, ?2) ON CONFLICT (org_id, contact_id) DO NOTHING"
      ).bind(ctx.orgId, me.id).run();
    }
    const linked = prof ? prof.sub_lfg_listing_id : null;

    let listingId = linked;
    if (norm.opt_in && norm.mode === "active") {
      if (linked) {
        await env.DB.prepare(
          `UPDATE lfg_listings SET skill_level = ?1, status = 'open', updated_at = datetime('now')
            WHERE id = ?2 AND org_id = ?3 AND deleted_at IS NULL`
        ).bind(norm.level, linked, ctx.orgId).run();
      } else {
        const r = await env.DB.prepare(
          `INSERT INTO lfg_listings (org_id, kind, created_by_contact_id, skill_level, note, status)
           VALUES (?1, 'player_avail', ?2, ?3, 'Available to sub — posted from my dashboard', 'open')`
        ).bind(ctx.orgId, me.id, norm.level).run();
        listingId = r.meta.last_row_id;
      }
    } else if (linked) {
      // leaving active mode closes exactly the availability-managed listing, never a hand-posted one
      await env.DB.prepare(
        `UPDATE lfg_listings SET status = 'closed', updated_at = datetime('now')
          WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL`
      ).bind(linked, ctx.orgId).run();
      listingId = null;
    }

    await env.DB.prepare(
      `UPDATE member_profiles
          SET sub_opt_in = ?1, sub_opt_in_at = CASE WHEN ?1 = 1 THEN COALESCE(sub_opt_in_at, datetime('now')) ELSE sub_opt_in_at END,
              sub_mode = ?2, sub_level = ?3, sub_lfg_listing_id = ?4, updated_at = datetime('now')
        WHERE org_id = ?5 AND contact_id = ?6 AND deleted_at IS NULL`
    ).bind(norm.opt_in ? 1 : 0, norm.mode, norm.level, listingId, ctx.orgId, me.id).run();
    await audit(env, ctx, "sub_availability.set", "member_profiles", me.id,
      JSON.stringify({ opt_in: norm.opt_in, mode: norm.mode, level: norm.level }));
    return json({ ok: true, opt_in: norm.opt_in, mode: norm.mode, level: norm.level, lfg_listing_id: listingId });
  }

  /* ---------------- staff: authoring ---------------- */
  if (p === "/api/admin/announcements" && m === "GET") {
    const denial = await requireStaff(env, ctx);
    if (denial) return denial;
    const rows = (await env.DB.prepare(
      `SELECT id, kind, title, body, link_url, link_label, starts_at, ends_at, created_at, updated_at
         FROM announcements WHERE org_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`
    ).bind(ctx.orgId).all()).results || [];
    return json({ announcements: rows });
  }

  if (p === "/api/admin/announcements" && m === "POST") {
    const denial = await requireStaff(env, ctx);
    if (denial) return denial;
    let b;
    try { b = await request.json(); } catch { return json({ error: "Send at least a kind and a title." }, 400); }
    const kind = b.kind === "cta" ? "cta" : "news";
    const title = String(b.title || "").trim();
    if (!title) return json({ error: "A title is required." }, 400);
    if (title.length > 200) return json({ error: "Keep the title under 200 characters." }, 400);
    const r = await env.DB.prepare(
      `INSERT INTO announcements (org_id, kind, title, body, link_url, link_label, starts_at, ends_at, created_by_user_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    ).bind(ctx.orgId, kind, title, b.body || null, b.link_url || null, b.link_label || null,
           b.starts_at || null, b.ends_at || null, ctx.userId || null).run();
    await audit(env, ctx, "announcement.create", "announcements", r.meta.last_row_id, title);
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  }

  let mm = p.match(/^\/api\/admin\/announcements\/(\d+)$/);
  if (mm && m === "PUT") {
    const denial = await requireStaff(env, ctx);
    if (denial) return denial;
    let b;
    try { b = await request.json(); } catch { return json({ error: "Nothing to update." }, 400); }
    const id = Number(mm[1]);
    const cur = await env.DB.prepare(
      "SELECT id FROM announcements WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL"
    ).bind(id, ctx.orgId).first();
    if (!cur) return json({ error: "That announcement isn't available." }, 404);
    const kind = b.kind === "cta" ? "cta" : b.kind === "news" ? "news" : null;
    await env.DB.prepare(
      `UPDATE announcements SET
          kind = COALESCE(?1, kind), title = COALESCE(?2, title), body = COALESCE(?3, body),
          link_url = COALESCE(?4, link_url), link_label = COALESCE(?5, link_label),
          starts_at = COALESCE(?6, starts_at), ends_at = COALESCE(?7, ends_at),
          updated_at = datetime('now')
        WHERE id = ?8 AND org_id = ?9 AND deleted_at IS NULL`
    ).bind(kind, b.title ? String(b.title).trim() : null, b.body ?? null, b.link_url ?? null,
           b.link_label ?? null, b.starts_at ?? null, b.ends_at ?? null, id, ctx.orgId).run();
    await audit(env, ctx, "announcement.update", "announcements", id, null);
    return json({ ok: true });
  }
  if (mm && m === "DELETE") {
    const denial = await requireStaff(env, ctx);
    if (denial) return denial;
    const id = Number(mm[1]);
    await env.DB.prepare(
      "UPDATE announcements SET deleted_at = datetime('now') WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL"
    ).bind(id, ctx.orgId).run();
    await audit(env, ctx, "announcement.delete", "announcements", id, null);
    return json({ ok: true });
  }

  return null;
}
