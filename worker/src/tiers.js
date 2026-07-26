/**
 * Boomtown Platform — Membership tiers + entitlements + bulk member actions
 * File: worker/src/tiers.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.26.0
 *
 * WHY THIS IS SEPARATE FROM plans (memberships.js, migration 0007)
 * A PLAN is a billing product: a price, an interval, a Square catalog variation. A TIER is an
 * entitlement level: Bronze / Silver / All-Access. They were the same thing before, which made
 * two questions unanswerable — "is this member at least Silver?" (needed for gated schedule
 * views, discounts, booking windows) and "how do I give a comped coach All-Access without
 * inventing a $0 Square subscription?". Splitting them answers both. A plan may point at a
 * tier; a tier may also be granted by hand, comped, or attached to a sponsorship.
 *
 * Staff routes:
 *   GET    /api/admin/tiers                       → all tiers incl. inactive, with holder counts
 *   POST   /api/admin/tiers                       { name, code?, rank, ...entitlements }
 *   PUT    /api/admin/tiers/:id                   partial update
 *   DELETE /api/admin/tiers/:id                   soft delete; refuses while live grants exist
 *   GET    /api/admin/grants?contact_id=           → grant history for one member
 *   POST   /api/admin/grants                      { contact_id, tier_id, source?, ends_at?, note? }
 *   DELETE /api/admin/grants/:id                  soft delete (revoke)
 *   POST   /api/admin/members/bulk                { action, contact_ids[], ... }  (R-11)
 *
 * Member / public routes:
 *   GET    /api/tiers                             → visible_to_public active tiers (pricing page)
 *   GET    /api/profile/membership                → caller's effective tier + entitlements
 *
 * Rules baked in:
 *   - Every read and write is scoped to ctx.orgId. No route accepts an org_id from the client.
 *   - A tier cannot be hard-deleted and cannot be soft-deleted out from under live holders.
 *   - Bulk actions cap at BULK_MAX ids per call and are audited as one row with the id list,
 *     so "who tagged 400 people" is answerable.
 */

let H = null; // wired: { json, audit, isStaff, requireStaff }
export function wireTiers(helpers) { H = helpers; }

/** Hard ceiling on a single bulk call. Keeps one request inside Worker CPU + D1 limits. */
export const BULK_MAX = 500;

export const BULK_ACTIONS = ["add_tag", "remove_tag", "grant_tier", "unsubscribe", "resubscribe", "export"];

/** Zones the calendar layer can emit a correct VTIMEZONE for. Keep in step with calendar.js. */
export const TZ_WHITELIST = [
  "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Chicago", "America/New_York",
];

/* ==================== pure logic (unit-tested) ==================== */

/**
 * Which grant is in force right now. Highest tier rank wins; among equal ranks the one that
 * started most recently wins. A grant counts only if it has started, has not ended, and has
 * not been soft-deleted.
 *
 * Fails CLOSED on unparseable dates: a grant with a corrupt starts_at is not yet in force, and
 * one with a corrupt ends_at has ended. An entitlement is a credential — same direction as the
 * token and claim-link fixes.
 */
export function effectiveGrant(grants, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const ms = (v) => {
    if (!v) return null;
    let s = String(v).trim().replace(" ", "T");
    if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
    const p = Date.parse(s);
    return Number.isNaN(p) ? NaN : p;
  };
  const live = (Array.isArray(grants) ? grants : []).filter((g) => {
    if (!g || g.deleted_at) return false;
    const s = ms(g.starts_at);
    if (Number.isNaN(s)) return false;           // corrupt start → not in force
    if (s !== null && s > t) return false;        // not started yet
    const e = ms(g.ends_at);
    if (Number.isNaN(e)) return false;           // corrupt end → treat as ended
    if (e !== null && e <= t) return false;       // already ended
    return true;
  });
  if (!live.length) return null;
  live.sort((a, b) => (Number(b.rank || 0) - Number(a.rank || 0))
    || ((ms(b.starts_at) || 0) - (ms(a.starts_at) || 0))
    || (Number(b.id || 0) - Number(a.id || 0)));
  return live[0];
}

/** Does a holder at `heldRank` satisfy a gate requiring `minRank`? No tier held → rank is null. */
export function tierMeetsMin(heldRank, minRank) {
  if (minRank == null) return true;              // no gate
  if (heldRank == null) return false;            // gate exists, member holds nothing
  const h = Number(heldRank), m = Number(minRank);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false; // fail closed
  return h >= m;
}

/** Slug a tier name into a stable code. Used only when the caller doesn't supply one. */
export function tierCode(name) {
  return String(name || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "tier";
}

/** Registration price after a tier discount. Basis points, floored at zero, integer cents. */
export function applyTierDiscount(priceCents, discountBps) {
  const p = Number(priceCents), d = Number(discountBps);
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (!Number.isFinite(d) || d <= 0) return Math.round(p);
  const bps = Math.min(d, 10000);                // never negative, never more than 100% off
  return Math.max(0, Math.round(p - (p * bps) / 10000));
}

/** Validate a bulk request before it touches the database. Returns { ok, error?, ids? }. */
export function validateBulk(body) {
  const action = String((body && body.action) || "");
  if (!BULK_ACTIONS.includes(action)) return { ok: false, error: "Unknown bulk action." };
  const raw = Array.isArray(body.contact_ids) ? body.contact_ids : [];
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return { ok: false, error: "Select at least one member." };
  if (ids.length > BULK_MAX) {
    return { ok: false, error: `That's ${ids.length} members. ${BULK_MAX} is the most one action can cover — narrow the selection or run it in batches.` };
  }
  if ((action === "add_tag" || action === "remove_tag")) {
    const tag = String(body.tag || "").trim();
    if (!tag) return { ok: false, error: "Give the tag a name." };
    if (tag.length > 40) return { ok: false, error: "Tags are 40 characters or fewer." };
  }
  if (action === "grant_tier" && !Number(body.tier_id)) {
    return { ok: false, error: "Pick a tier to grant." };
  }
  return { ok: true, action, ids };
}

/** Merge a tag into a tags_json array without duplicating it. Returns the new JSON string. */
export function withTag(tagsJson, tag) {
  let tags = [];
  try { const p = JSON.parse(tagsJson || "[]"); if (Array.isArray(p)) tags = p; } catch { tags = []; }
  const clean = String(tag).trim();
  if (clean && !tags.some((t) => String(t).toLowerCase() === clean.toLowerCase())) tags.push(clean);
  return JSON.stringify(tags);
}

/** Remove a tag (case-insensitive) from a tags_json array. */
export function withoutTag(tagsJson, tag) {
  let tags = [];
  try { const p = JSON.parse(tagsJson || "[]"); if (Array.isArray(p)) tags = p; } catch { tags = []; }
  const clean = String(tag).trim().toLowerCase();
  return JSON.stringify(tags.filter((t) => String(t).toLowerCase() !== clean));
}

/* ==================== data access ==================== */

const TIER_FIELDS = [
  "name", "code", "rank", "description", "perks", "color",
  "guest_passes_per_month", "open_gym_included", "booking_window_days",
  "discount_bps", "visible_to_public", "active", "sort_order",
];

const INT_FIELDS = new Set([
  "rank", "guest_passes_per_month", "booking_window_days", "discount_bps",
  "open_gym_included", "visible_to_public", "active", "sort_order",
]);

function coerceTier(b) {
  const out = {};
  for (const k of TIER_FIELDS) {
    if (!(k in b) || b[k] === undefined) continue;
    if (INT_FIELDS.has(k)) {
      if (b[k] === null || b[k] === "") { out[k] = k === "booking_window_days" ? null : 0; continue; }
      const n = Number(b[k]);
      out[k] = Number.isFinite(n) ? Math.trunc(n) : 0;
    } else {
      out[k] = b[k] == null ? null : String(b[k]);
    }
  }
  return out;
}

/**
 * Live grants for one contact, joined to tier rank so effectiveGrant can sort. Exported because
 * schedule.js needs the same answer to gate a view and must not duplicate the query.
 */
export async function grantsForContact(env, orgId, contactId) {
  if (!contactId) return [];
  return (await env.DB.prepare(
    `SELECT g.id, g.tier_id, g.source, g.starts_at, g.ends_at, g.deleted_at,
            t.name AS tier_name, t.code AS tier_code, t.rank AS rank,
            t.discount_bps, t.guest_passes_per_month, t.open_gym_included, t.booking_window_days
       FROM membership_grants g
       JOIN membership_tiers t ON t.id = g.tier_id AND t.deleted_at IS NULL AND t.active = 1
      WHERE g.org_id = ?1 AND g.contact_id = ?2 AND g.deleted_at IS NULL
      ORDER BY t.rank DESC, g.starts_at DESC`
  ).bind(orgId, contactId).all()).results;
}

/** The caller's effective tier, or null. Used by gating code across modules. */
export async function effectiveTierFor(env, orgId, contactId) {
  const g = effectiveGrant(await grantsForContact(env, orgId, contactId));
  return g || null;
}

/* ==================== routes ==================== */

export async function tiersRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  const { json } = H;

  /* ---------- public pricing surface ---------- */
  if (p === "/api/tiers" && m === "GET") {
    const rows = (await env.DB.prepare(
      `SELECT id, name, code, rank, description, perks, color, discount_bps,
              guest_passes_per_month, open_gym_included, booking_window_days
         FROM membership_tiers
        WHERE org_id = ?1 AND deleted_at IS NULL AND active = 1 AND visible_to_public = 1
        ORDER BY sort_order, rank DESC, id`
    ).bind(ctx.orgId).all()).results;
    return json({ tiers: rows });
  }

  /* ---------- the caller's own membership ---------- */
  if (p === "/api/profile/membership" && m === "GET") {
    if (!ctx.session) return json({ error: "Sign in first." }, 401);
    const contact = await H.contactForSession(env, ctx);
    if (!contact) return json({ tier: null, note: "No member record is linked to this sign-in yet." });
    const grants = await grantsForContact(env, ctx.orgId, contact.id);
    const live = effectiveGrant(grants);
    return json({
      tier: live ? {
        id: live.tier_id, name: live.tier_name, code: live.tier_code, rank: live.rank,
        discount_bps: live.discount_bps, guest_passes_per_month: live.guest_passes_per_month,
        open_gym_included: !!live.open_gym_included, booking_window_days: live.booking_window_days,
        source: live.source, ends_at: live.ends_at,
      } : null,
      history: grants.map((g) => ({
        tier_name: g.tier_name, source: g.source, starts_at: g.starts_at, ends_at: g.ends_at,
      })),
    });
  }

  /* ---------- staff: org settings (timezone) ---------- */
  if (p === "/api/admin/org") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    if (m === "GET") {
      const org = await env.DB.prepare(
        "SELECT id, name, slug, timezone FROM orgs WHERE id=?1 AND deleted_at IS NULL"
      ).bind(ctx.orgId).first();
      if (!org) return json({ error: "Organization not found." }, 404);
      return json({ org, timezone: org.timezone || "America/Denver" });
    }
    if (m === "PUT") {
      const b = await request.json().catch(() => ({}));
      const tz = String(b.timezone || "").trim();
      // Whitelist. A free-text zone reaches every calendar emission, and an invalid IANA name
      // produces a VTIMEZONE nothing can resolve — so it is validated here, not at render time.
      if (!TZ_WHITELIST.includes(tz)) {
        return json({ error: `Unsupported time zone. Supported: ${TZ_WHITELIST.join(", ")}.` }, 400);
      }
      await env.DB.prepare("UPDATE orgs SET timezone=?1, updated_at=datetime('now') WHERE id=?2")
        .bind(tz, ctx.orgId).run();
      await H.audit(env, ctx, "org.timezone", "orgs", ctx.orgId, { timezone: tz });
      return json({ ok: true, timezone: tz });
    }
    return json({ error: "Method not allowed." }, 405);
  }

  /* ---------- staff: tiers ---------- */
  if (p === "/api/admin/tiers" && m === "GET") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const rows = (await env.DB.prepare(
      `SELECT t.*, (
         SELECT COUNT(*) FROM membership_grants g
          WHERE g.tier_id = t.id AND g.deleted_at IS NULL
            AND (g.ends_at IS NULL OR g.ends_at > datetime('now'))
       ) AS holders
         FROM membership_tiers t
        WHERE t.org_id = ?1 AND t.deleted_at IS NULL
        ORDER BY t.sort_order, t.rank DESC, t.id`
    ).bind(ctx.orgId).all()).results;
    return json({ tiers: rows });
  }

  if (p === "/api/admin/tiers" && m === "POST") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const b = await request.json().catch(() => ({}));
    const name = String(b.name || "").trim();
    if (!name) return json({ error: "Give the tier a name." }, 400);
    const bag = coerceTier({ ...b, name, code: String(b.code || "").trim() || tierCode(name) });
    if (bag.discount_bps != null && (bag.discount_bps < 0 || bag.discount_bps > 10000)) {
      return json({ error: "Discount must be between 0 and 10000 basis points (0-100%)." }, 400);
    }
    const cols = Object.keys(bag);
    const dup = await env.DB.prepare(
      "SELECT id FROM membership_tiers WHERE org_id=?1 AND code=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, bag.code).first();
    if (dup) return json({ error: `A live tier already uses the code "${bag.code}".` }, 409);

    const r = await env.DB.prepare(
      `INSERT INTO membership_tiers (org_id, ${cols.join(",")})
       VALUES (?1, ${cols.map((_, i) => `?${i + 2}`).join(",")})`
    ).bind(ctx.orgId, ...cols.map((c) => bag[c])).run();
    await H.audit(env, ctx, "tier.create", "membership_tiers", r.meta.last_row_id, { name, code: bag.code });
    return json({ ok: true, id: r.meta.last_row_id });
  }

  const tierId = p.match(/^\/api\/admin\/tiers\/(\d+)$/);
  if (tierId) {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const id = Number(tierId[1]);
    const row = await env.DB.prepare(
      "SELECT * FROM membership_tiers WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(id, ctx.orgId).first();
    if (!row) return json({ error: "Tier not found in this organization." }, 404);

    if (m === "PUT") {
      const b = await request.json().catch(() => ({}));
      const bag = coerceTier(b);
      delete bag.code; // a code is a stable key; renaming it silently breaks any rule using it
      if (!Object.keys(bag).length) return json({ error: "Nothing to update." }, 400);
      const cols = Object.keys(bag);
      await env.DB.prepare(
        `UPDATE membership_tiers SET ${cols.map((c, i) => `${c}=?${i + 1}`).join(",")},
           updated_at=datetime('now')
         WHERE id=?${cols.length + 1} AND org_id=?${cols.length + 2}`
      ).bind(...cols.map((c) => bag[c]), id, ctx.orgId).run();
      await H.audit(env, ctx, "tier.update", "membership_tiers", id, bag);
      return json({ ok: true });
    }

    if (m === "DELETE") {
      const holders = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM membership_grants
          WHERE tier_id=?1 AND deleted_at IS NULL AND (ends_at IS NULL OR ends_at > datetime('now'))`
      ).bind(id).first();
      if (holders && holders.n > 0) {
        return json({
          error: `${holders.n} member${holders.n === 1 ? "" : "s"} still hold this tier. Move them first, or set the tier inactive instead — deleting it would strip their entitlements silently.`,
          holders: holders.n,
        }, 409);
      }
      await env.DB.prepare(
        "UPDATE membership_tiers SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2"
      ).bind(id, ctx.orgId).run();
      await H.audit(env, ctx, "tier.delete", "membership_tiers", id, { name: row.name });
      return json({ ok: true });
    }
    return json({ error: "Method not allowed." }, 405);
  }

  /* ---------- staff: grants ---------- */
  if (p === "/api/admin/grants" && m === "GET") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const contactId = Number(url.searchParams.get("contact_id"));
    if (!contactId) return json({ error: "contact_id is required." }, 400);
    const grants = await grantsForContact(env, ctx.orgId, contactId);
    const live = effectiveGrant(grants);
    return json({ grants, effective_tier_id: live ? live.tier_id : null });
  }

  if (p === "/api/admin/grants" && m === "POST") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const b = await request.json().catch(() => ({}));
    const contactId = Number(b.contact_id), tId = Number(b.tier_id);
    if (!contactId || !tId) return json({ error: "contact_id and tier_id are both required." }, 400);
    const source = ["subscription", "manual", "comp", "staff", "sponsor"].includes(b.source) ? b.source : "manual";

    // Both sides must belong to the caller's org. Without this, an id from another tenant grants.
    const c = await env.DB.prepare(
      "SELECT id, full_name FROM contacts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(contactId, ctx.orgId).first();
    if (!c) return json({ error: "Member not found in this organization." }, 404);
    const t = await env.DB.prepare(
      "SELECT id, name FROM membership_tiers WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(tId, ctx.orgId).first();
    if (!t) return json({ error: "Tier not found in this organization." }, 404);

    const r = await env.DB.prepare(
      `INSERT INTO membership_grants (org_id, contact_id, tier_id, source, ends_at, note, granted_by)
       VALUES (?1,?2,?3,?4,?5,?6,?7)`
    ).bind(ctx.orgId, contactId, tId, source, b.ends_at || null,
           b.note ? String(b.note).slice(0, 500) : null, ctx.userId || null).run();
    await H.audit(env, ctx, "tier.grant", "contacts", contactId,
      { tier_id: tId, tier: t.name, source, ends_at: b.ends_at || null });
    return json({ ok: true, id: r.meta.last_row_id });
  }

  const grantId = p.match(/^\/api\/admin\/grants\/(\d+)$/);
  if (grantId && m === "DELETE") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const id = Number(grantId[1]);
    const g = await env.DB.prepare(
      "SELECT id, contact_id, tier_id FROM membership_grants WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(id, ctx.orgId).first();
    if (!g) return json({ error: "Grant not found in this organization." }, 404);
    await env.DB.prepare(
      "UPDATE membership_grants SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?1 AND org_id=?2"
    ).bind(id, ctx.orgId).run();
    await H.audit(env, ctx, "tier.revoke", "contacts", g.contact_id, { grant_id: id, tier_id: g.tier_id });
    return json({ ok: true });
  }

  /* ---------- staff: bulk member actions (R-11) ---------- */
  if (p === "/api/admin/members/bulk" && m === "POST") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const b = await request.json().catch(() => ({}));
    const v = validateBulk(b);
    if (!v.ok) return json({ error: v.error }, 400);
    const { action, ids } = v;

    // Only ever operate on rows that belong to this org. Ids the caller doesn't own are
    // silently dropped rather than erroring, and the count difference is reported back.
    const ph = ids.map((_, i) => `?${i + 2}`).join(",");
    const owned = (await env.DB.prepare(
      `SELECT id, tags_json, unsubscribed, email, full_name FROM contacts
        WHERE org_id = ?1 AND deleted_at IS NULL AND id IN (${ph})`
    ).bind(ctx.orgId, ...ids).all()).results;
    if (!owned.length) return json({ error: "None of those members are in this organization." }, 404);
    const ownedIds = owned.map((r) => r.id);
    const skipped = ids.length - ownedIds.length;

    if (action === "export") {
      const head = "contact_id,full_name,email,unsubscribed,tags";
      const esc = (s) => {
        const v2 = s == null ? "" : String(s);
        return /[",\n]/.test(v2) ? `"${v2.replace(/"/g, '""')}"` : v2;
      };
      const body = owned.map((r) => {
        let tags = []; try { tags = JSON.parse(r.tags_json || "[]") || []; } catch { tags = []; }
        return [r.id, esc(r.full_name), esc(r.email), r.unsubscribed ? 1 : 0, esc(tags.join("|"))].join(",");
      });
      await H.audit(env, ctx, "members.bulk.export", "contacts", null, { count: owned.length });
      return new Response([head, ...body].join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="boomtown-members-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    let changed = 0;

    if (action === "add_tag" || action === "remove_tag") {
      const tag = String(b.tag).trim();
      // tags_json is a JSON array in a TEXT column, so this is a read-modify-write. Batched into
      // one D1 round-trip instead of N sequential awaits.
      const stmts = owned.map((r) => env.DB.prepare(
        "UPDATE contacts SET tags_json=?2, updated_at=datetime('now') WHERE id=?1 AND org_id=?3"
      ).bind(r.id, action === "add_tag" ? withTag(r.tags_json, tag) : withoutTag(r.tags_json, tag), ctx.orgId));
      if (stmts.length) await env.DB.batch(stmts);
      changed = stmts.length;
      await H.audit(env, ctx, `members.bulk.${action}`, "contacts", null,
        { tag, count: changed, ids: ownedIds.slice(0, 200) });
    } else if (action === "unsubscribe" || action === "resubscribe") {
      const to = action === "unsubscribe" ? 1 : 0;
      const oph = ownedIds.map((_, i) => `?${i + 3}`).join(",");
      const res = await env.DB.prepare(
        `UPDATE contacts SET unsubscribed=?1, updated_at=datetime('now')
          WHERE org_id=?2 AND id IN (${oph})`
      ).bind(to, ctx.orgId, ...ownedIds).run();
      changed = res.meta ? res.meta.changes : ownedIds.length;
      await H.audit(env, ctx, `members.bulk.${action}`, "contacts", null,
        { count: changed, ids: ownedIds.slice(0, 200) });
    } else if (action === "grant_tier") {
      const tId = Number(b.tier_id);
      const t = await env.DB.prepare(
        "SELECT id, name FROM membership_tiers WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
      ).bind(tId, ctx.orgId).first();
      if (!t) return json({ error: "Tier not found in this organization." }, 404);
      const stmts = ownedIds.map((cid) => env.DB.prepare(
        `INSERT INTO membership_grants (org_id, contact_id, tier_id, source, ends_at, note, granted_by)
         VALUES (?1,?2,?3,'manual',?4,?5,?6)`
      ).bind(ctx.orgId, cid, tId, b.ends_at || null,
             b.note ? String(b.note).slice(0, 500) : "bulk grant", ctx.userId || null));
      if (stmts.length) await env.DB.batch(stmts);
      changed = stmts.length;
      await H.audit(env, ctx, "members.bulk.grant_tier", "contacts", null,
        { tier_id: tId, tier: t.name, count: changed, ids: ownedIds.slice(0, 200) });
    }

    return json({
      ok: true, action, changed, skipped,
      note: skipped ? `${skipped} selected member${skipped === 1 ? "" : "s"} were not in this organization and were skipped.` : null,
    });
  }

  return null;
}
