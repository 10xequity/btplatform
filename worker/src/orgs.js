/**
 * Boomtown Platform — Organisation profile, identity and sender resolution
 * File: worker/src/orgs.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.31.0
 * Migration: none. Every column used here already exists on `orgs` (verified live 2026-07-26).
 *
 * WHY THIS MODULE EXISTS
 * The token registry (standards §9) resolves {{ENTITY}}, {{ORG_NAME}}, {{ORG_EMAIL}},
 * {{ORG_ADDRESS}}, {{ORG_PHONE}} and {{RULES_REFERENCE}} from the `orgs` row at publish time, and
 * five of those are in the NO-FALLBACK set — empty means publish refuses. Until this release there
 * was no screen that could fill them. `/api/admin/org` in tiers.js reads four columns and writes
 * exactly one (timezone). So the documents module could refuse to publish and the operator had no
 * way to fix the refusal. This is the screen that makes the refusal actionable.
 *
 * F-13, AND WHY THE FIX LIVES HERE RATHER THAN AT THE CALL SITES
 * `sendEmail()` took (env, to, subject, html) and had no idea which organisation it was sending
 * for, so the sender name was a literal: "Boomtown Athletics" on every message from every org. A
 * Queens Club registrant got Boomtown-branded email. Patching the four literals in place would
 * have left the next caller free to type a fifth. `senderIdentity()` is the single resolver; the
 * literal is deleted rather than relocated, per standards §8.
 *
 * The census found F-13 is wider than the roadmap recorded — three more literals live in SUBJECT
 * lines (`messages.js`, and two in `registrations.js`), which no document listed. Subjects are
 * member-read text and fall under the same rule. Fixed in this release; recorded as F-13b.
 *
 * SECURITY — /secure-web-code, standards §7.2
 *   1. Writes use an explicit allow-list. No Object.keys(body), no spread into an UPDATE.
 *   2. `legal_entity_verified` is NEVER in that allow-list. It asserts a fact about the world — a
 *      Colorado Secretary of State registration — so it is set by a human who checked, through a
 *      separate endpoint that demands a typed source note. A batch may never carry it along.
 *   3. Editing `legal_entity` or `legal_entity_short` RESETS verified to 0. A verified flag that
 *      survives an edit to the thing it verifies is a lie with a checkbox next to it.
 *   4. Cross-org reads and reactivation are admin-only and audited (roadmap §7). v0.30.0 made the
 *      switcher show only active orgs, which is correct and also means a deactivated org became
 *      unreachable through the UI. This module is the documented way back.
 *   5. Every write produces an audit_log row carrying only changed fields (standards §7.4).
 */

let H = null;
export function wireOrgs(helpers) { H = helpers; }

/* Columns an operator may edit. Everything absent from this list is unwritable through this
   module, including id, slug, active, legal_entity_verified, created_at and deleted_at. */
const EDITABLE = {
  name:                 { max: 200,  trim: true },
  legal_entity:         { max: 200,  trim: true, resetsVerification: true },
  legal_entity_short:   { max: 120,  trim: true, resetsVerification: true },
  admin_email:          { max: 200,  trim: true, email: true },
  email_sender_name:    { max: 120,  trim: true },
  email_sender_address: { max: 200,  trim: true, email: true },
  phone:                { max: 40,   trim: true },
  website:              { max: 300,  trim: true, url: true },
  rules_url:            { max: 300,  trim: true, url: true },
  address_line1:        { max: 200,  trim: true },
  address_line2:        { max: 200,  trim: true },
  city:                 { max: 120,  trim: true },
  state:                { max: 60,   trim: true },
  postal_code:          { max: 20,   trim: true },
  logo_url:             { max: 500,  trim: true, url: true },
  /* D-36: the column shipped in migration 0047 (K-15) with readers on four sites — the catalog
     writer and three payment-link paths, all `orgs.square_location_id || env.SQUARE_LOCATION_ID`
     — and NO writer, so the owner's per-org-locations decision was unusable: NULL on all 6 live
     orgs meant everything landed on the platform location. Empty stays expressible (buildPatch's
     empty→NULL) and means exactly that fallback — the sanctioned exit. `token` refuses values
     that are not even id-shaped; a WRONG-but-shaped id only fails at Square call time, which the
     settings help text says out loud. */
  square_location_id:   { max: 40,   trim: true, token: true },
};

/* The five tokens that refuse rather than fall back (standards §9.2), mapped to the columns that
   feed them. The settings screen shows completeness against this list, so the operator sees what
   publish will refuse on BEFORE they open the document editor rather than after. */
export const PUBLISH_CRITICAL = [
  { token: "ENTITY",        column: "legal_entity",       label: "Legal entity name" },
  { token: "ENTITY_SHORT",  column: "legal_entity_short", label: "Short entity name" },
  { token: "ORG_NAME",      column: "name",               label: "Organisation name" },
  { token: "ORG_EMAIL",     column: "admin_email",        label: "Contact email" },
  { token: "ORG_ADDRESS",   column: "address_line1",      label: "Street address" },
];

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const isHttpUrl = (s) => /^https?:\/\/[^\s]+$/i.test(s);

/**
 * SENDER IDENTITY — the F-13 resolver. One place, called by every mail path.
 *
 * Resolution order, and the reason for each step:
 *   1. orgs.email_sender_name      — what the operator typed on the settings screen.
 *   2. orgs.name                   — still this org's own name, from the database.
 *   3. env.SENDER_NAME             — deployment config, not a literal in source.
 * There is deliberately no fourth step. If all three are empty the caller gets null and declines
 * to send, because a message signed with the wrong organisation's name is worse than a message
 * that did not go out: the recipient acts on it.
 *
 * The address falls back to env.SENDER_EMAIL because a verified sending domain is an
 * infrastructure fact, not an org identity claim — Brevo will reject an unverified From anyway.
 */
export async function senderIdentity(env, orgId) {
  let row = null;
  if (orgId) {
    row = await env.DB.prepare(
      `SELECT name, email_sender_name, email_sender_address
         FROM orgs WHERE id = ?1 AND deleted_at IS NULL`
    ).bind(orgId).first().catch(() => null);
  }
  const name = (row && (row.email_sender_name || row.name)) || env.SENDER_NAME || null;
  const email = (row && row.email_sender_address) || env.SENDER_EMAIL || null;
  if (!name || !email) return null;
  return { name: String(name).slice(0, 120), email: String(email).slice(0, 200) };
}

/** Which publish-critical fields are still empty. Used by the settings screen and by tests. */
export function missingCritical(org) {
  return PUBLISH_CRITICAL
    .filter((f) => !String((org && org[f.column]) ?? "").trim())
    .map((f) => ({ token: f.token, label: f.label, column: f.column }));
}

/**
 * Validate and normalise an incoming profile patch against EDITABLE.
 * Returns { bag, errors, resetsVerification }. `bag` contains only allow-listed keys whose value
 * actually changed — an unchanged field must not appear in audit_log.detail_json (standards §7.4)
 * and must not trip the verification reset.
 */
export function buildPatch(body, current) {
  const bag = {};
  const errors = [];
  let resetsVerification = false;

  for (const [key, rule] of Object.entries(EDITABLE)) {
    if (!(key in (body || {}))) continue;
    let v = body[key];
    if (v === null) v = "";
    v = String(v);
    if (rule.trim) v = v.trim();
    if (v.length > rule.max) { errors.push(`${key} is longer than ${rule.max} characters.`); continue; }
    if (v && rule.email && !isEmail(v)) { errors.push(`${key} does not look like an email address.`); continue; }
    if (v && rule.url && !isHttpUrl(v)) { errors.push(`${key} must start with http:// or https://.`); continue; }
    if (v && rule.token && !/^[A-Za-z0-9_-]+$/.test(v)) {
      errors.push(`${key} should be the short ID from Square's Locations page — letters, digits, dashes and underscores only.`);
      continue;
    }

    const was = String((current && current[key]) ?? "");
    if (v === was) continue;
    bag[key] = v === "" ? null : v;
    if (rule.resetsVerification) resetsVerification = true;
  }

  if (!Object.keys(bag).length && !errors.length) errors.push("Nothing changed.");
  if ("name" in bag && !bag.name) errors.push("The organisation name cannot be emptied.");
  return { bag, errors, resetsVerification };
}

async function orgRow(env, orgId) {
  return env.DB.prepare(
    `SELECT id, name, slug, active, logo_url, timezone,
            legal_entity, legal_entity_short, legal_entity_verified,
            admin_email, email_sender_name, email_sender_address, phone, website, rules_url,
            address_line1, address_line2, city, state, postal_code, square_location_id,
            created_at, updated_at, deactivated_at
       FROM orgs WHERE id = ?1 AND deleted_at IS NULL`
  ).bind(orgId).first();
}

async function isAdminOf(env, ctx, orgId) {
  if (!ctx.session) return false;
  const r = await env.DB.prepare(
    `SELECT role FROM user_org_roles WHERE user_id = ?1 AND org_id = ?2 AND deleted_at IS NULL`
  ).bind(ctx.userId, orgId).first();
  return !!r && r.role === "admin";
}

/** Admin on ANY org. Reactivation targets an org the caller cannot currently switch into, so the
 *  per-org check in requireStaff cannot be the gate — by construction ctx.orgId is a different org. */
async function isAdminAnywhere(env, ctx) {
  if (!ctx.session) return false;
  const r = await env.DB.prepare(
    `SELECT 1 AS ok FROM user_org_roles WHERE user_id = ?1 AND role = 'admin' AND deleted_at IS NULL LIMIT 1`
  ).bind(ctx.userId).first();
  return !!r;
}

export async function orgRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;

  /* ---------- current org profile ---------- */

  if (p === "/api/admin/org/profile" && m === "GET") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const org = await orgRow(env, ctx.orgId);
    if (!org) return H.json({ error: "Organization not found." }, 404);
    return H.json({
      org,
      missing_critical: missingCritical(org),
      can_publish: missingCritical(org).length === 0,
      is_admin: await isAdminOf(env, ctx, ctx.orgId),
    });
  }

  if (p === "/api/admin/org/profile" && m === "PUT") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const body = await request.json().catch(() => ({}));
    const before = await orgRow(env, ctx.orgId);
    if (!before) return H.json({ error: "Organization not found." }, 404);

    const { bag, errors, resetsVerification } = buildPatch(body, before);
    if (errors.length) return H.json({ error: errors[0], errors }, 400);

    // The reset is applied server-side, never trusted from the client, and only when the entity
    // fields actually changed value.
    const applied = { ...bag };
    if (resetsVerification && Number(before.legal_entity_verified) === 1) applied.legal_entity_verified = 0;

    const keys = Object.keys(applied);
    const sets = keys.map((k, i) => `${k} = ?${i + 2}`).join(", ");
    await env.DB.prepare(
      `UPDATE orgs SET ${sets}, updated_at = datetime('now') WHERE id = ?1 AND deleted_at IS NULL`
    ).bind(ctx.orgId, ...keys.map((k) => applied[k])).run();

    const beforeChanged = {};
    for (const k of keys) beforeChanged[k] = before[k] ?? null;
    await H.audit(env, ctx, "org.profile.update", "orgs", ctx.orgId, {
      before: beforeChanged, after: applied, reason: null, source: "single_edit",
    });

    const after = await orgRow(env, ctx.orgId);
    return H.json({
      ok: true,
      org: after,
      missing_critical: missingCritical(after),
      verification_reset: Object.prototype.hasOwnProperty.call(applied, "legal_entity_verified"),
    });
  }

  /* ---------- module visibility (v0.128.0, roadmap §-1l P-1) ----------
     Which modules this org HIDES from its admin menu, as a slug array. A VIEW filter, never a
     permission: nothing anywhere reads this for authorization, and org_modules.test.mjs asserts a
     hidden module's routes answer exactly as before. The server stores an opaque sanitized list
     and keeps NO registry of its own — web/assets/admin-nav.js's BT_MODULES is the single
     semantic source, so the meaning of a key cannot drift between two copies. Separate from the
     profile PUT because that flow is per-field text rules and this is one atomic list. */

  if (p === "/api/admin/org/modules" && m === "GET") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const row = await env.DB.prepare(
      "SELECT modules_off_json FROM orgs WHERE id = ?1 AND deleted_at IS NULL"
    ).bind(ctx.orgId).first();
    if (!row) return H.json({ error: "Organization not found." }, 404);
    let off = [];
    try { off = JSON.parse(row.modules_off_json || "[]"); } catch { off = []; }
    return H.json({ off: Array.isArray(off) ? off : [] });
  }

  if (p === "/api/admin/org/modules" && m === "PUT") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const body = await request.json().catch(() => ({}));
    // Refused wholesale, never coerced: a config write that silently drops half its input is a
    // control reporting success it did not achieve. Slugs only, bounded count and length.
    if (!Array.isArray(body.off)) return H.json({ error: "Send the hidden modules as a list." }, 400);
    if (body.off.length > 32) return H.json({ error: "That's more modules than exist." }, 400);
    const off = [];
    for (const k of body.off) {
      if (typeof k !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(k)) {
        return H.json({ error: "Module keys are short lowercase slugs." }, 400);
      }
      if (!off.includes(k)) off.push(k);
    }
    const before = await env.DB.prepare(
      "SELECT modules_off_json FROM orgs WHERE id = ?1 AND deleted_at IS NULL"
    ).bind(ctx.orgId).first();
    if (!before) return H.json({ error: "Organization not found." }, 404);
    await env.DB.prepare(
      "UPDATE orgs SET modules_off_json = ?2, updated_at = datetime('now') WHERE id = ?1 AND deleted_at IS NULL"
    ).bind(ctx.orgId, JSON.stringify(off)).run();
    await H.audit(env, ctx, "org.modules.update", "orgs", ctx.orgId, {
      before: before.modules_off_json || "[]", after: JSON.stringify(off),
    });
    return H.json({ ok: true, off });
  }

  /* ---------- legal entity verification ----------
     Separate endpoint on purpose. This asserts that a human opened the Colorado SOS business
     search and read the registration back. Standards §7.3: a claim about the world needs a typed
     reason, not a checkbox, because a checkbox acquires a habit. */

  if (p === "/api/admin/org/verify-entity" && m === "POST") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    if (!(await isAdminOf(env, ctx, ctx.orgId))) {
      return H.json({ error: "Only an admin of this organization can confirm the legal entity." }, 403);
    }
    const b = await request.json().catch(() => ({}));
    const verified = b?.verified ? 1 : 0;
    const source = String(b?.source ?? "").trim();
    if (verified && source.length < 10) {
      return H.json({ error: "Say where you checked, in at least 10 characters — for example \"Colorado SOS search 2026-07-26\"." }, 400);
    }
    const before = await orgRow(env, ctx.orgId);
    if (!before) return H.json({ error: "Organization not found." }, 404);
    if (verified && !String(before.legal_entity || "").trim()) {
      return H.json({ error: "Enter the legal entity name before confirming it." }, 409);
    }

    await env.DB.prepare(
      `UPDATE orgs SET legal_entity_verified = ?1, updated_at = datetime('now') WHERE id = ?2`
    ).bind(verified, ctx.orgId).run();
    await H.audit(env, ctx, "org.entity.verify", "orgs", ctx.orgId, {
      before: { legal_entity_verified: before.legal_entity_verified },
      after: { legal_entity_verified: verified },
      reason: verified ? source : "unverified by admin",
      source: "override",
    });
    return H.json({ ok: true, legal_entity_verified: verified });
  }

  /* ---------- cross-org list and reactivation ----------
     v0.30.0 correctly stopped the switcher listing the seven deactivated orgs. That closed a real
     hole (F-11) and also removed the only path back. Admin-only, audited, and it never exposes
     member data — name, slug and status only. */

  if (p === "/api/admin/orgs/all" && m === "GET") {
    if (!(await isAdminAnywhere(env, ctx))) {
      return H.json({ error: "Admin role required to view deactivated organizations." }, 403);
    }
    const r = await env.DB.prepare(
      `SELECT id, name, slug, active, deactivated_at,
              legal_entity, legal_entity_verified
         FROM orgs WHERE deleted_at IS NULL ORDER BY active DESC, id`
    ).all();
    return H.json({ orgs: r.results || [] });
  }

  const react = p.match(/^\/api\/admin\/orgs\/(\d+)\/(reactivate|deactivate)$/);
  if (react && m === "POST") {
    const targetId = Number(react[1]);
    const wantActive = react[2] === "reactivate" ? 1 : 0;
    if (!(await isAdminAnywhere(env, ctx))) {
      return H.json({ error: "Admin role required to change organization status." }, 403);
    }
    const b = await request.json().catch(() => ({}));
    const reason = String(b?.reason ?? "").trim();
    if (reason.length < 10) {
      return H.json({ error: "Give a reason of at least 10 characters. This changes what every admin can see." }, 400);
    }
    const before = await env.DB.prepare(
      `SELECT id, name, active FROM orgs WHERE id = ?1 AND deleted_at IS NULL`
    ).bind(targetId).first();
    if (!before) return H.json({ error: "Organization not found." }, 404);
    if (Number(before.active) === wantActive) {
      return H.json({ error: `${before.name} is already ${wantActive ? "active" : "deactivated"}.` }, 409);
    }
    // Soft state only — standards §7.1. The row is never dropped; orgs(id) is an FK target.
    // deactivated_at is stamped by SQLite so it matches every other timestamp in the schema;
    // a JS-generated string here would drift from datetime('now') on format and on clock.
    await env.DB.prepare(
      wantActive
        ? `UPDATE orgs SET active = 1, deactivated_at = NULL, updated_at = datetime('now') WHERE id = ?1`
        : `UPDATE orgs SET active = 0, deactivated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1`
    ).bind(targetId).run();

    await H.audit(env, ctx, wantActive ? "org.reactivate" : "org.deactivate", "orgs", targetId, {
      before: { active: before.active }, after: { active: wantActive },
      reason, source: "override",
    });
    return H.json({ ok: true, id: targetId, active: wantActive, name: before.name });
  }

  return null;
}
