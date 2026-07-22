/**
 * Boomtown Platform — Schedule & View Profiles API (spec §3.7)
 * Version: v0.4.0 · Date: 2026-07-22
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

let json, audit, requireStaff;
export function wireSchedule(h) { ({ json, audit, requireStaff } = h); }

export async function scheduleRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;
  let match;

  if (p === "/api/schedule" && m === "GET") return feed(env, url);
  if (p === "/api/schedule/views" && m === "GET") return listViews(env, ctx);
  if (p === "/api/schedule/views" && m === "POST") return createView(request, env, ctx);
  if ((match = p.match(/^\/api\/schedule\/views\/(\d+)$/))) {
    if (m === "PATCH") return patchView(request, env, ctx, +match[1]);
    if (m === "DELETE") return deleteView(env, ctx, +match[1]);
  }
  return null;
}

/* ---------- public feed ---------- */

async function feed(env, url) {
  const slug = url.searchParams.get("view") || "public";
  const view = await env.DB.prepare(
    "SELECT * FROM schedule_views WHERE slug=?1 AND deleted_at IS NULL"
  ).bind(slug).first();
  if (!view) return json({ error: "Unknown schedule view." }, 404);

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
    "SELECT id, slug, name, kind, show_names, show_counts, org_id, type_filter FROM schedule_views WHERE deleted_at IS NULL ORDER BY id"
  ).all()).results;
  return json({ views: rows });
}

async function createView(request, env, ctx) {
  const gate = await requireStaff(env, ctx);
  if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  if (!b.name) return json({ error: "Give the view a name." }, 400);
  const slug = randomSlug();
  const r = await env.DB.prepare(
    `INSERT INTO schedule_views (slug, name, kind, show_names, show_counts, org_id, type_filter)
     VALUES (?1, ?2, 'custom', ?3, ?4, ?5, ?6)`
  ).bind(slug, b.name, b.show_names ? 1 : 0, b.show_counts ? 1 : 0, b.org_id || null, b.type_filter || null).run();
  await audit(env, ctx, "schedule_view.created", "schedule_view", r.meta.last_row_id, { name: b.name });
  return json({ ok: true, id: r.meta.last_row_id, slug });
}

async function patchView(request, env, ctx, id) {
  const gate = await requireStaff(env, ctx);
  if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const allowed = ["name", "show_names", "show_counts", "org_id", "type_filter"];
  const sets = [], vals = [];
  for (const k of allowed) if (k in b) { vals.push(b[k]); sets.push(`${k}=?${vals.length}`); }
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
  const v = await env.DB.prepare("SELECT kind FROM schedule_views WHERE id=?1 AND deleted_at IS NULL").bind(id).first();
  if (!v) return json({ error: "Not found." }, 404);
  if (v.kind !== "custom") return json({ error: "The built-in Public and Internal views can't be deleted." }, 400);
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
