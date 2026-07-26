/**
 * Boomtown Platform — Schedule & View Profiles API (spec §3.7)
 * Version: v0.5.0 · Date: 2026-07-26 (v0.5.0: real view ownership, public/internal/staff
 * visibility, and optional membership-tier gating — migration 0018)
 *
 * View profiles: 'public' and 'internal' built-ins + unlimited named custom views.
 * Custom views get an unguessable slug. Visibility toggles are enforced HERE,
 * server-side — hiding names in the UI alone would leak via the API.
 *
 * Endpoints:
 *   GET  /api/schedule?view=slug&from=YYYY-MM-DD&to=YYYY-MM-DD&org=N   (public, no auth)
 *   GET  /api/schedule/views          → staff: list views (custom slugs included)
 *   POST /api/schedule/views          { name, show_names, show_counts, org_id?, type_filter? }
 *   PATCH  /api/schedule/views/:id
 *   DELETE /api/schedule/views/:id    (built-ins can't be deleted)
 */

import { effectiveGrant, grantsForContact } from "./tiers.js"; // v0.26.0 membership gating

let json, audit, requireStaff, contactForSession;
export function wireSchedule(h) { ({ json, audit, requireStaff, contactForSession } = h); }

export async function scheduleRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;
  let match;

  if (p === "/api/schedule" && m === "GET") return feed(env, url, ctx);
  if (p === "/api/schedule/views" && m === "GET") return listViews(env, ctx);
  if (p === "/api/schedule/views" && m === "POST") return createView(request, env, ctx);
  if ((match = p.match(/^\/api\/schedule\/views\/(\d+)$/))) {
    if (m === "PATCH") return patchView(request, env, ctx, +match[1]);
    if (m === "DELETE") return deleteView(env, ctx, +match[1]);
  }
  return null;
}

/* ==================== view access gates (pure, unit-tested) ==================== */

/**
 * MAY THIS CALLER CHANGE THIS VIEW?
 *
 * schedule_views.org_id is NOT ownership — migration 0003 documents it as "NULL = all orgs",
 * i.e. a content filter. An external review proposed scoping mutations by it; that would have
 * made the two seeded built-ins (org_id NULL) uneditable by every user in the system. Migration
 * 0018 adds owner_org_id for real ownership. A NULL owner means platform-global, and only an
 * admin may touch those — staff of one tenant must not repoint the view another tenant renders.
 */
export function canMutateView(view, ctx) {
  if (!view) return { ok: false, reason: "not_found" };
  if (view.kind !== "custom") return { ok: false, reason: "builtin" };
  if (view.owner_org_id == null) {
    return ctx && ctx.role === "admin"
      ? { ok: true }
      : { ok: false, reason: "global_admin_only" };
  }
  if (Number(view.owner_org_id) !== Number(ctx && ctx.orgId)) return { ok: false, reason: "not_found" };
  return { ok: true };
}

/**
 * MAY THIS CALLER READ THIS VIEW?
 *   public   — anyone holding the slug
 *   internal — any signed-in member of the owning org
 *   staff    — staff or admin of the owning org
 * A membership gate (min_tier_id / require_membership) layers on top; BOTH must pass.
 * Unknown visibility values fail closed, so a typo cannot silently publish a staff view.
 */
export function canReadView(view, ctx, heldTierRank = null, minTierRank = null) {
  if (!view) return { ok: false, status: 404 };
  const vis = String(view.visibility || "public");
  const signedIn = !!(ctx && ctx.session);
  const role = ctx && ctx.role;
  const sameOrg = view.owner_org_id == null || Number(view.owner_org_id) === Number(ctx && ctx.orgId);

  if (vis === "public") { /* no auth needed */ }
  else if (vis === "internal") {
    if (!signedIn) return { ok: false, status: 401, reason: "sign_in" };
    if (!sameOrg) return { ok: false, status: 404 };
  } else if (vis === "staff") {
    if (!signedIn) return { ok: false, status: 401, reason: "sign_in" };
    if (!sameOrg || (role !== "staff" && role !== "admin")) return { ok: false, status: 404 };
  } else {
    return { ok: false, status: 404, reason: "unknown_visibility" }; // fail closed
  }

  if (view.require_membership || view.min_tier_id != null) {
    if (!signedIn) return { ok: false, status: 401, reason: "sign_in" };
    if (role === "staff" || role === "admin") return { ok: true }; // staff always see their own views
    if (heldTierRank == null) return { ok: false, status: 403, reason: "membership_required" };
    if (minTierRank != null && Number(heldTierRank) < Number(minTierRank)) {
      return { ok: false, status: 403, reason: "tier_too_low" };
    }
  }
  return { ok: true };
}

export const VIEW_VISIBILITIES = ["public", "internal", "staff"];

/* ---------- public feed ---------- */

async function feed(env, url, ctx) {
  const slug = url.searchParams.get("view") || "public";
  const view = await env.DB.prepare(
    "SELECT * FROM schedule_views WHERE slug=?1 AND deleted_at IS NULL"
  ).bind(slug).first();
  if (!view) return json({ error: "Unknown schedule view." }, 404);

  // v0.26.0 — visibility is enforced here, not in the page. A staff-only or membership-gated
  // view must not be readable just because someone has the slug.
  let heldRank = null, minRank = null;
  if (view.require_membership || view.min_tier_id != null || view.visibility !== "public") {
    if (view.min_tier_id != null) {
      const mt = await env.DB.prepare(
        "SELECT rank FROM membership_tiers WHERE id=?1 AND deleted_at IS NULL"
      ).bind(view.min_tier_id).first();
      minRank = mt ? mt.rank : null;
    }
    if (ctx && ctx.session && (view.require_membership || view.min_tier_id != null)) {
      const contact = await contactForSession(env, ctx);
      if (contact) {
        const g = effectiveGrant(await grantsForContact(env, ctx.orgId, contact.id));
        heldRank = g ? g.rank : null;
      }
    }
  }
  const gate = canReadView(view, ctx, heldRank, minRank);
  if (!gate.ok) {
    if (gate.status === 401) return json({ error: "Sign in to see this schedule." }, 401);
    if (gate.status === 403) {
      return json({
        error: gate.reason === "tier_too_low"
          ? "This schedule is for a higher membership level."
          : "This schedule is for members only.",
        membership_required: true,
      }, 403);
    }
    return json({ error: "Unknown schedule view." }, 404);
  }

  const from = safeDate(url.searchParams.get("from")) || isoAddDays(-30);
  const to = safeDate(url.searchParams.get("to")) || isoAddDays(120);
  const orgParam = Number(url.searchParams.get("org")) || null;
  const orgId = view.org_id || orgParam; // a view locked to an org wins over the query param

  const binds = [from, to];
  let where = "e.deleted_at IS NULL AND e.status IN ('published','in_progress','completed') AND date(e.starts_at) BETWEEN ?1 AND ?2";
  if (orgId) { binds.push(orgId); where += ` AND e.org_id=?${binds.length}`; }
  if (view.type_filter) {
    const types = view.type_filter.split(",").map(t => t.trim()).filter(Boolean);
    if (types.length) {
      where += ` AND e.type IN (${types.map((_, i) => `?${binds.length + i + 1}`).join(",")})`;
      binds.push(...types);
    }
  }
  const rows = (await env.DB.prepare(
    `SELECT e.id, e.org_id, o.name AS org_name, o.slug AS org_slug, e.type, e.name,
            e.starts_at, e.ends_at, e.location, e.status, e.price_cents, e.capacity
     FROM events e JOIN orgs o ON o.id=e.org_id WHERE ${where}
     ORDER BY e.starts_at, e.id LIMIT 500`
  ).bind(...binds).all()).results;

  if (view.show_counts || view.show_names) {
    for (const ev of rows) {
      if (view.show_counts) {
        const c = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM registrations WHERE event_id=?1 AND deleted_at IS NULL AND status<>'cancelled'"
        ).bind(ev.id).first();
        ev.registered_count = c.n;
      }
      if (view.show_names) {
        ev.team_names = (await env.DB.prepare(
          "SELECT name FROM teams WHERE event_id=?1 AND deleted_at IS NULL ORDER BY name LIMIT 100"
        ).bind(ev.id).all()).results.map(r => r.name);
      }
    }
  }
  return json({
    view: { slug: view.slug, name: view.name, show_names: !!view.show_names, show_counts: !!view.show_counts },
    events: rows, from, to,
  });
}

/* ---------- staff: manage views ---------- */

async function listViews(env, ctx) {
  const gate = await requireStaff(env, ctx);
  if (gate) return gate;
  const rows = (await env.DB.prepare(
    `SELECT id, slug, name, kind, show_names, show_counts, org_id, type_filter,
            owner_org_id, visibility, min_tier_id, require_membership
       FROM schedule_views
      WHERE deleted_at IS NULL AND (owner_org_id IS NULL OR owner_org_id = ?1)
      ORDER BY kind = 'custom', id`
  ).bind(ctx.orgId).all()).results;
  return json({ views: rows });
}

async function createView(request, env, ctx) {
  const gate = await requireStaff(env, ctx);
  if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  if (!b.name) return json({ error: "Give the view a name." }, 400);
  const slug = randomSlug();
  const visibility = VIEW_VISIBILITIES.includes(b.visibility) ? b.visibility : "public";
  let minTierId = null;
  if (b.min_tier_id != null && b.min_tier_id !== "") {
    // A gate may only reference a tier in the caller's own org.
    const t = await env.DB.prepare(
      "SELECT id FROM membership_tiers WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(Number(b.min_tier_id), ctx.orgId).first();
    if (!t) return json({ error: "That membership tier isn't in this organization." }, 400);
    minTierId = t.id;
  }
  const r = await env.DB.prepare(
    `INSERT INTO schedule_views (slug, name, kind, show_names, show_counts, org_id, type_filter,
       owner_org_id, visibility, min_tier_id, require_membership)
     VALUES (?1, ?2, 'custom', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(slug, b.name, b.show_names ? 1 : 0, b.show_counts ? 1 : 0,
         b.org_id || null, b.type_filter || null,
         ctx.orgId, visibility, minTierId,
         (b.require_membership || minTierId != null) ? 1 : 0).run();
  await audit(env, ctx, "schedule_view.created", "schedule_view", r.meta.last_row_id,
    { name: b.name, visibility, min_tier_id: minTierId });
  return json({ ok: true, id: r.meta.last_row_id, slug, visibility });
}

async function patchView(request, env, ctx, id) {
  const gate = await requireStaff(env, ctx);
  if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const view = await env.DB.prepare(
    "SELECT id, kind, owner_org_id FROM schedule_views WHERE id=?1 AND deleted_at IS NULL"
  ).bind(id).first();
  const may = canMutateView(view, ctx);
  if (!may.ok) {
    if (may.reason === "builtin") return json({ error: "The built-in Public and Internal views can't be edited." }, 400);
    if (may.reason === "global_admin_only") return json({ error: "This view is shared across organizations. Only an admin can change it." }, 403);
    return json({ error: "View not found in this organization." }, 404);
  }

  const allowed = ["name", "show_names", "show_counts", "org_id", "type_filter",
                   "visibility", "min_tier_id", "require_membership"];
  if ("visibility" in b && !VIEW_VISIBILITIES.includes(b.visibility)) {
    return json({ error: `Visibility must be one of: ${VIEW_VISIBILITIES.join(", ")}.` }, 400);
  }
  if (b.min_tier_id != null && b.min_tier_id !== "") {
    const t = await env.DB.prepare(
      "SELECT id FROM membership_tiers WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(Number(b.min_tier_id), ctx.orgId).first();
    if (!t) return json({ error: "That membership tier isn't in this organization." }, 400);
  }
  const sets = [], vals = [];
  for (const k of allowed) if (k in b) {
    let v = b[k];
    if (k === "require_membership") v = v ? 1 : 0;
    if (k === "min_tier_id") v = (v === "" || v == null) ? null : Number(v);
    vals.push(v); sets.push(`${k}=?${vals.length}`);
  }
  if (!sets.length) return json({ error: "Nothing to update." }, 400);
  vals.push(id);
  await env.DB.prepare(
    `UPDATE schedule_views SET ${sets.join(",")}, updated_at=datetime('now') WHERE id=?${vals.length} AND deleted_at IS NULL`
  ).bind(...vals).run();
  await audit(env, ctx, "schedule_view.updated", "schedule_view", id, b);
  return json({ ok: true });
}

async function deleteView(env, ctx, id) {
  const gate = await requireStaff(env, ctx);
  if (gate) return gate;
  const v = await env.DB.prepare(
    "SELECT id, kind, owner_org_id FROM schedule_views WHERE id=?1 AND deleted_at IS NULL"
  ).bind(id).first();
  const may = canMutateView(v, ctx);
  if (!may.ok) {
    if (may.reason === "builtin") return json({ error: "The built-in Public and Internal views can't be deleted." }, 400);
    if (may.reason === "global_admin_only") return json({ error: "This view is shared across organizations. Only an admin can delete it." }, 403);
    return json({ error: "View not found in this organization." }, 404);
  }
  await env.DB.prepare("UPDATE schedule_views SET deleted_at=datetime('now') WHERE id=?1").bind(id).run();
  await audit(env, ctx, "schedule_view.deleted", "schedule_view", id, {});
  return json({ ok: true });
}

/* ---------- utils ---------- */

function safeDate(s) { return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function isoAddDays(d) {
  const t = new Date(Date.now() + d * 86400000);
  return t.toISOString().slice(0, 10);
}
function randomSlug() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return "v-" + [...bytes].map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
}
