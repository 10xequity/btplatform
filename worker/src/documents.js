/**
 * Boomtown Platform — Document library, requirements, compliance
 * File: worker/src/documents.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.28.0
 * Migration: 0023 (documents, document_requirements; waiver_versions.document_id;
 *                  signatures.document_id / requirement_id / expires_at)
 *
 * WHY THIS EXISTS
 * waivers.js handles ONE waiver per org, with the version table keyed on org_id alone. Three
 * defects in three sessions all traced to the same root: legal text was code. The owner uploads
 * documents now, tokens fill from the org profile, an org may require SEVERAL documents, and the
 * required version is swappable. Legal entity stops being a build blocker because it becomes a
 * field — and an empty field is a visible refusal rather than a silent wrong answer.
 *
 * WHAT THIS DOES *NOT* REBUILD
 * waivers.js already ships the parts that were hardest to get right, and they are reused rather
 * than copied:
 *   sha256Hex        body hashing
 *   tokensUsed       which tokens a body references
 *   resignRequired   material-flag re-sign rule — the owner's "re-apply to existing signers"
 *                    toggle ALREADY EXISTS as the material flag on publish. material=1 forces a
 *                    re-sign, material=0 leaves signers alone.
 *   pinFor           refuses a signature against a stale version
 * Copying any of those would guarantee they drift. This module owns only what is genuinely new:
 * multiple documents, assignment, and the token registry correction below.
 *
 * TOKEN REGISTRY CORRECTION (F-10, P0)
 * waivers.js WAIVER_TOKENS shipped `ENTITY: (o) => o.legal_entity || "Boomtown Athletics, LLC"`.
 * That fallback silently substitutes Boomtown into any org with no legal_entity, so Queens Club's
 * release would have run to Boomtown Athletics, LLC with no warning anywhere. D-ORG-1 exists
 * precisely to forbid that. DOC_TOKENS below carries NO fallback on party identity or mailing
 * address, and waivers.js must be patched to import from here — see the patch note in the handoff.
 *
 * Staff routes:
 *   GET    /api/admin/documents                     → org's documents + version + signed counts
 *   POST   /api/admin/documents                     { name, kind?, description?, requires_signature? }
 *   PUT    /api/admin/documents/:id                 partial update, allow-listed fields
 *   DELETE /api/admin/documents/:id                 soft delete; refuses while required
 *   GET    /api/admin/documents/:id/versions
 *   POST   /api/admin/documents/:id/versions        { label, body, material?, notes?, publish? }
 *   POST   /api/admin/requirements/preview          { document_id, version_id, applies_to? } → counts
 *   POST   /api/admin/requirements                  assign; supersedes prior; audited
 *   DELETE /api/admin/requirements/:id              deactivate
 *
 * Member routes:
 *   GET    /api/member/compliance                   caller's per-document status
 *
 * Rules baked in:
 *   - Every read and write is scoped to ctx.orgId. No route accepts an org_id from the client.
 *   - Field allow-lists on every write. Never a spread of the request body (standards 8.1).
 *   - Publish refuses on unknown tokens, on empty no-fallback tokens, and on bracket-style
 *     placeholders that a {{...}}-only validator cannot see (the F-1 defect class).
 *   - Compliance is COMPUTED, never stored. A materialised summary drifts from the signatures it
 *     summarises, the same reason there is no stored is_minor.
 *   - Age-based audience filtering is deliberately NOT in SQL. It needs derived age failing closed
 *     (D-MIN-2, D-MIN-3), and that logic lives in family.js. Reimplementing it in SQL would give
 *     two answers to one question.
 */

import { sha256Hex, tokensUsed, resignRequired } from "./waivers.js";

let H = null; // wired: { json, audit, isStaff, requireStaff, contactForSession }
export function wireDocuments(helpers) { H = helpers; }

export const DOC_KINDS = ["waiver", "policy", "consent", "media", "code_of_conduct", "other"];
export const APPLIES_TO = ["all", "adults", "minors", "staff"];
export const SIGNER_RULES = ["self", "guardian", "either"];

/** Documents an org may hold. A ceiling stops a runaway import turning the sign page into a wall. */
export const MAX_DOCUMENTS_PER_ORG = 25;

/* ============================ token registry ============================ */

/**
 * NO_FALLBACK names the tokens that must refuse rather than guess.
 *
 * The line is: anything identifying the legal party or the mailing address refuses; anything
 * cosmetic may fall back. Naming the wrong company as the party a family releases from liability
 * is the one substitution that must never be guessed (D-ORG-1), and the CAN-SPAM physical address
 * is code-enforced (D-ORG-3).
 */
export const NO_FALLBACK = ["ENTITY", "ENTITY_SHORT", "ORG_NAME", "ORG_EMAIL", "ORG_ADDRESS"];

export const DOC_TOKENS = {
  // Party identity — no fallbacks. See above.
  ENTITY:        (o) => o.legal_entity || "",
  ENTITY_SHORT:  (o) => o.legal_entity_short || "",
  ORG_NAME:      (o) => o.name || "",
  ORG_EMAIL:     (o) => o.admin_email || o.email_sender_address || "",
  ORG_ADDRESS:   (o) => [o.address_line1, o.address_line2,
                         [o.city, o.state].filter(Boolean).join(", "),
                         o.postal_code].filter(Boolean).join(" · "),
  // Cosmetic — safe to omit or default.
  ORG_WEBSITE:   (o) => o.website || "",
  ORG_PHONE:     (o) => o.phone || "",
  ORG_CITY:      (o) => o.city || "",
  ORG_STATE:     (o) => o.state || "",
  ORG_POSTAL:    (o) => o.postal_code || "",
  GOVERNING_STATE: (o) => o.state || "Colorado",
  ORG_TIMEZONE:  (o) => o.timezone || "America/Denver",
  // A dead URL is weaker than no URL for rules incorporated by reference (D-WV-12).
  RULES_REFERENCE: (o) => o.rules_url
    ? `available at ${o.rules_url}`
    : "posted at the facility and available on request",
};

export const DOC_TOKEN_NAMES = Object.keys(DOC_TOKENS);

const TOKEN_RE = /\{\{\s*([A-Z_]+)\s*\}\}/g;

/**
 * Placeholder shapes a {{...}}-only validator cannot see. F-1 shipped `[MEDIA-OPTOUT-EMAIL]`
 * into a candidate that would have been hashed into a signed document, because square brackets
 * are not braces. Each of these refuses the publish.
 */
const BAD_PLACEHOLDER_RE = /\[[A-Z][A-Z0-9 _-]{2,}\]|<[A-Z][A-Z0-9 _-]{2,}>|\bTBD\b|\bXXXX?\b|_{4,}/;

/**
 * Substitute org identity into a tokenised body.
 * Returns { ok, text, unknown[], empty[], badPlaceholder }.
 *   unknown        — token not in the registry (a typo like {{ORG_MAIL}})
 *   empty          — NO_FALLBACK token whose org value is blank
 *   badPlaceholder — a bracket-style placeholder the token validator would miss
 * All three are refusal conditions. Failing closed is the whole point: a published document is
 * hashed and pinned, so a placeholder that reaches publish is permanent.
 */
export function resolveDocTokens(body, org) {
  const o = org || {};
  const unknown = [], empty = [];
  const text = String(body || "").replace(TOKEN_RE, (whole, name) => {
    const fn = DOC_TOKENS[name];
    if (!fn) { if (!unknown.includes(name)) unknown.push(name); return whole; }
    const val = String(fn(o) == null ? "" : fn(o)).trim();
    if (!val) {
      if (NO_FALLBACK.includes(name)) { if (!empty.includes(name)) empty.push(name); return whole; }
      return ""; // cosmetic token, blank value — drop it silently
    }
    return val;
  });
  const bad = BAD_PLACEHOLDER_RE.exec(String(body || ""));
  return {
    ok: unknown.length === 0 && empty.length === 0 && !bad,
    text, unknown, empty, badPlaceholder: bad ? bad[0] : null,
  };
}

/** Human-readable refusal, kept beside the check so the two cannot diverge. */
export function tokenRefusal(res) {
  const parts = [];
  if (res.badPlaceholder) {
    parts.push(`Found the placeholder ${res.badPlaceholder}. Only {{TOKEN}} placeholders are recognised — bracketed text would be published verbatim into the signed document.`);
  }
  if (res.unknown?.length) {
    parts.push(`Unknown token${res.unknown.length === 1 ? "" : "s"} ${res.unknown.map((t) => `{{${t}}}`).join(", ")}. Valid: ${DOC_TOKEN_NAMES.map((t) => `{{${t}}}`).join(", ")}.`);
  }
  if (res.empty?.length) {
    parts.push(`This organisation has no value for ${res.empty.map((t) => `{{${t}}}`).join(", ")}. Set it under Organisation settings first — publishing would leave the placeholder in signed text.`);
  }
  return parts.join(" ");
}

/**
 * Did the author type a company name instead of a token? The F-8 defect class.
 * Warn rather than refuse: "Boomtown Fieldhouse" may legitimately appear in facility rules.
 */
export function literalOrgNames(text, orgs) {
  const t = String(text || "");
  const hits = [];
  for (const o of orgs || []) {
    for (const n of [o.legal_entity, o.name]) {
      if (n && String(n).length > 3 && t.includes(n) && !hits.includes(n)) hits.push(n);
    }
  }
  return hits;
}

export function slugify(s) {
  return String(s || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "document";
}

/* ============================ shared queries ============================ */

/** The org row every token resolves from. One query, one source of truth. */
export async function orgProfile(env, orgId) {
  return env.DB.prepare(
    `SELECT id, name, legal_entity, legal_entity_short, legal_entity_verified, admin_email,
            email_sender_address, website, phone, address_line1, address_line2, city, state,
            postal_code, timezone, rules_url
       FROM orgs WHERE id = ?1 AND deleted_at IS NULL`
  ).bind(orgId).first();
}

/** Active version of one document, or null. Document-scoped, unlike waivers.currentVersion. */
export async function currentDocVersion(env, orgId, documentId) {
  return env.DB.prepare(
    `SELECT id, org_id, document_id, label, body, body_sha, material, status, published_at, notes
       FROM waiver_versions
      WHERE org_id = ?1 AND document_id = ?2 AND status = 'active' AND deleted_at IS NULL
      ORDER BY published_at DESC, id DESC LIMIT 1`
  ).bind(orgId, documentId).first();
}

/**
 * Members who are missing at least one required document.
 *
 * (r.retroactive = 0 OR s.version_id = r.version_id) is the whole re-apply toggle in one
 * predicate: future-only counts any unexpired signature, retroactive counts only the current
 * version. Drives the registration gate, the check-in chip and the assignment preview from one
 * query, so the three can never disagree.
 *
 * Audience (applies_to) is filtered by the CALLER using derived age — not here. See header.
 */
export async function nonCompliant(env, orgId, limit = 500) {
  const r = await env.DB.prepare(
    `SELECT c.id AS contact_id, c.first_name, c.last_name, c.email,
            r.id AS requirement_id, r.document_id, r.applies_to, r.signer_rule,
            d.name AS document_name
       FROM contacts c
       JOIN document_requirements r
            ON r.org_id = c.org_id AND r.active = 1 AND r.deleted_at IS NULL
           AND r.effective_from <= datetime('now')
       JOIN documents d
            ON d.id = r.document_id AND d.active = 1 AND d.deleted_at IS NULL
           AND d.requires_signature = 1
       LEFT JOIN signatures s
            ON s.subject_contact_id = c.id
           AND s.document_id = r.document_id
           AND s.deleted_at IS NULL
           AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
           AND (r.retroactive = 0 OR s.version_id = r.version_id)
      WHERE c.org_id = ?1 AND c.deleted_at IS NULL AND s.id IS NULL
      ORDER BY c.last_name, c.first_name
      LIMIT ?2`
  ).bind(orgId, Math.min(Number(limit) || 500, 2000)).all();
  return r.results || [];
}

/** Per-document status for one member. Mirrors nonCompliant so the two cannot disagree. */
export async function complianceFor(env, orgId, contactId) {
  const r = await env.DB.prepare(
    `SELECT d.id AS document_id, d.name, d.kind, d.sort_order,
            r.id AS requirement_id, r.version_id AS required_version_id, r.retroactive,
            r.signer_rule, r.term_days,
            s.id AS signature_id, s.version_id AS signed_version_id,
            s.signed_at, s.expires_at, s.signer_contact_id, s.on_behalf
       FROM document_requirements r
       JOIN documents d ON d.id = r.document_id AND d.active = 1 AND d.deleted_at IS NULL
       LEFT JOIN signatures s
            ON s.subject_contact_id = ?2
           AND s.document_id = r.document_id
           AND s.deleted_at IS NULL
           AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
           AND (r.retroactive = 0 OR s.version_id = r.version_id)
      WHERE r.org_id = ?1 AND r.active = 1 AND r.deleted_at IS NULL
        AND r.effective_from <= datetime('now')
      ORDER BY d.sort_order, d.id`
  ).bind(orgId, contactId).all();

  const rows = r.results || [];
  return {
    compliant: rows.every((x) => x.signature_id != null),
    outstanding: rows.filter((x) => x.signature_id == null).map((x) => x.name),
    documents: rows.map((x) => ({
      document_id: x.document_id, name: x.name, kind: x.kind,
      status: x.signature_id ? "current" : "outstanding",
      signed_at: x.signed_at || null, expires_at: x.expires_at || null,
      signed_by_other: x.signature_id ? Number(x.on_behalf) === 1 : null,
      required_version_id: x.required_version_id,
    })),
  };
}

/* ============================ routes ============================ */

export async function documentRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;

  /* ---------- staff: documents ---------- */

  if (p === "/api/admin/documents" && m === "GET") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const r = await env.DB.prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM waiver_versions v
                WHERE v.document_id = d.id AND v.deleted_at IS NULL) AS version_count,
              (SELECT COUNT(*) FROM signatures s
                WHERE s.document_id = d.id AND s.deleted_at IS NULL) AS signed_count,
              (SELECT r.id FROM document_requirements r
                WHERE r.document_id = d.id AND r.active = 1 AND r.deleted_at IS NULL
                LIMIT 1) AS requirement_id
         FROM documents d
        WHERE d.org_id = ?1 AND d.deleted_at IS NULL
        ORDER BY d.sort_order, d.id`
    ).bind(ctx.orgId).all();
    return H.json({ documents: r.results || [] });
  }

  if (p === "/api/admin/documents" && m === "POST") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const b = await request.json().catch(() => ({}));
    const name = String(b?.name ?? "").trim();
    if (!name) return H.json({ error: "A document name is required." }, 400);
    const kind = DOC_KINDS.includes(b?.kind) ? b.kind : "waiver";

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM documents WHERE org_id = ?1 AND deleted_at IS NULL`
    ).bind(ctx.orgId).first();
    if (Number(count?.n || 0) >= MAX_DOCUMENTS_PER_ORG) {
      return H.json({ error: `This organisation already has ${MAX_DOCUMENTS_PER_ORG} documents, the maximum. Deactivate one before adding another.` }, 409);
    }

    const slug = slugify(b?.slug || name);
    const clash = await env.DB.prepare(
      `SELECT id FROM documents WHERE org_id = ?1 AND slug = ?2 AND deleted_at IS NULL`
    ).bind(ctx.orgId, slug).first();
    if (clash) return H.json({ error: `A document with the reference "${slug}" already exists.` }, 409);

    const r = await env.DB.prepare(
      `INSERT INTO documents (org_id, name, slug, kind, description, requires_signature, sort_order)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(ctx.orgId, name, slug, kind,
           b?.description ? String(b.description).slice(0, 2000) : null,
           b?.requires_signature === false ? 0 : 1,
           Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : 100).run();

    await H.audit(env, ctx, "document.create", "documents", r.meta.last_row_id, { name, slug, kind });
    return H.json({ ok: true, id: r.meta.last_row_id, slug }, 201);
  }

  const docId = matchId(p, "/api/admin/documents/");
  if (docId && m === "PUT") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const b = await request.json().catch(() => ({}));
    // Allow-list. Never a spread of the body (standards 8.1) — org_id, slug and id are not editable.
    const bag = {};
    if (b?.name != null) bag.name = String(b.name).trim().slice(0, 200);
    if (b?.description != null) bag.description = String(b.description).slice(0, 2000);
    if (DOC_KINDS.includes(b?.kind)) bag.kind = b.kind;
    if (b?.requires_signature != null) bag.requires_signature = b.requires_signature ? 1 : 0;
    if (b?.active != null) bag.active = b.active ? 1 : 0;
    if (Number.isFinite(Number(b?.sort_order))) bag.sort_order = Number(b.sort_order);
    const keys = Object.keys(bag);
    if (!keys.length) return H.json({ error: "Nothing to update." }, 400);

    const sets = keys.map((k, i) => `${k} = ?${i + 3}`).join(", ");
    const r = await env.DB.prepare(
      `UPDATE documents SET ${sets}, updated_at = datetime('now')
        WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL`
    ).bind(docId, ctx.orgId, ...keys.map((k) => bag[k])).run();
    if (!r.meta.changes) return H.json({ error: "Document not found." }, 404);

    await H.audit(env, ctx, "document.update", "documents", docId, bag);
    return H.json({ ok: true });
  }

  if (docId && m === "DELETE") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    // Refuse while required. Soft-deleting a required document would silently stop enforcing a
    // signature the org still believes it collects — same guard shape as deleting a live tier.
    const req = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM document_requirements
        WHERE document_id = ?1 AND org_id = ?2 AND active = 1 AND deleted_at IS NULL`
    ).bind(docId, ctx.orgId).first();
    if (Number(req?.n || 0) > 0) {
      return H.json({ error: "This document is currently required. Remove the requirement first, then deactivate the document." }, 409);
    }
    const r = await env.DB.prepare(
      `UPDATE documents SET deleted_at = datetime('now'), active = 0
        WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL`
    ).bind(docId, ctx.orgId).run();
    if (!r.meta.changes) return H.json({ error: "Document not found." }, 404);
    await H.audit(env, ctx, "document.delete", "documents", docId, {});
    return H.json({ ok: true });
  }

  /* ---------- staff: versions ---------- */

  const verListId = matchSub(p, "/api/admin/documents/", "/versions");
  if (verListId && m === "GET") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const r = await env.DB.prepare(
      `SELECT id, label, body_sha, material, status, published_at, notes, tokens_json,
              source_r2_key, length(body) AS body_length
         FROM waiver_versions
        WHERE document_id = ?1 AND org_id = ?2 AND deleted_at IS NULL
        ORDER BY published_at DESC, id DESC`
    ).bind(verListId, ctx.orgId).all();
    return H.json({ versions: r.results || [] });
  }

  if (verListId && m === "POST") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const b = await request.json().catch(() => ({}));
    const label = String(b?.label ?? "").trim();
    const template = String(b?.body ?? "").replace(/\r\n/g, "\n").trim();
    if (!label) return H.json({ error: "A version label is required, for example v2." }, 400);
    if (template.length < 50) return H.json({ error: "The document text looks too short to publish." }, 400);

    const doc = await env.DB.prepare(
      `SELECT id, name FROM documents WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL`
    ).bind(verListId, ctx.orgId).first();
    if (!doc) return H.json({ error: "Document not found." }, 404);

    const org = await orgProfile(env, ctx.orgId);
    const res = resolveDocTokens(template, org);
    if (!res.ok) return H.json({ error: tokenRefusal(res), unknown: res.unknown, empty: res.empty, bad_placeholder: res.badPlaceholder }, 422);

    // F-8 guard: warn, do not refuse. Requires explicit confirm_literal_names to proceed.
    const allOrgs = await env.DB.prepare(
      // F-11 (v0.30.0): a GUARD must scan the WIDEST set, not the narrowest. Filtering to active orgs
      // meant a document containing a deactivated org's name published clean — the scan list was
      // narrower than the set of real party names. Standards §10 check 3. Opposite direction from
      // every other v0.30.0 predicate change, deliberately.
      `SELECT name, legal_entity FROM orgs WHERE deleted_at IS NULL`
    ).all();
    const literals = literalOrgNames(res.text, allOrgs.results || []);
    if (literals.length && !b?.confirm_literal_names) {
      return H.json({
        error: `The text contains the literal name${literals.length === 1 ? "" : "s"} ${literals.join(", ")}. Use {{ENTITY}} or {{ORG_NAME}} so each organisation publishes its own name. Resubmit with confirm_literal_names to publish anyway.`,
        literal_names: literals, needs_confirmation: true,
      }, 409);
    }

    const publish = b?.publish !== false;
    const material = b?.material === false ? 0 : 1;
    const sha = await sha256Hex(res.text);
    const used = tokensUsed(template);
    const snapshot = {};
    for (const t of used) if (DOC_TOKENS[t]) snapshot[t] = String(DOC_TOKENS[t](org) ?? "");

    const dupe = await env.DB.prepare(
      `SELECT id FROM waiver_versions
        WHERE document_id = ?1 AND label = ?2 AND deleted_at IS NULL`
    ).bind(verListId, label).first();
    if (dupe) return H.json({ error: `Version "${label}" already exists for this document.` }, 409);

    const stmts = [];
    if (publish) {
      // Retire the previous active version. Signatures stay pinned to the version they saw —
      // never re-pointed, or the audit trail would claim consent to unread text.
      stmts.push(env.DB.prepare(
        `UPDATE waiver_versions SET status = 'retired', updated_at = datetime('now')
          WHERE document_id = ?1 AND org_id = ?2 AND status = 'active' AND deleted_at IS NULL`
      ).bind(verListId, ctx.orgId));
    }
    stmts.push(env.DB.prepare(
      `INSERT INTO waiver_versions
         (org_id, document_id, label, body, body_template, body_sha, material, status,
          published_by_user_id, notes, tokens_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    ).bind(ctx.orgId, verListId, label, res.text, template, sha, material,
           publish ? "active" : "legacy", ctx.userId,
           b?.notes ? String(b.notes).slice(0, 1000) : null, JSON.stringify(snapshot)));

    const out = await env.DB.batch(stmts);
    const newId = out[out.length - 1].meta.last_row_id;

    await H.audit(env, ctx, publish ? "document.version.publish" : "document.version.draft",
                  "waiver_versions", newId,
                  { document_id: verListId, label, material, body_sha: sha, tokens: used,
                    entity_verified: Number(org?.legal_entity_verified || 0) });

    return H.json({
      ok: true, id: newId, body_sha: sha, tokens: used,
      entity_unverified: Number(org?.legal_entity_verified || 0) === 0
        ? `${org?.name}'s legal entity name "${org?.legal_entity}" has not been verified against the Secretary of State.`
        : null,
    }, 201);
  }

  /* ---------- staff: token registry and dry-run preview (v0.31.0) ----------

     WHY THE CLIENT DOES NOT RESOLVE TOKENS ITSELF
     R-23 already records that `waivers.js` and `documents.js` hold two token maps deliberately,
     to avoid a module cycle, and that a change to either must be made in both. A hand-written
     copy in admin-documents.js would have made a THIRD, in a different language, maintained by a
     different habit — and the client's copy is the one that tells the author "this will publish
     cleanly" right before the server disagrees.

     So the editor asks the server. The preview is the real `resolveDocTokens` and the real
     literal-name scan, debounced client-side. Cost: one small request per pause in typing on a
     staff-only screen. That is the cheaper side of the trade by a wide margin — the alternative
     is a preview that can lie, on the one screen whose output gets hashed and pinned forever. */

  if (p === "/api/admin/documents/tokens" && m === "GET") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const org = await orgProfile(env, ctx.orgId);
    return H.json({
      tokens: DOC_TOKEN_NAMES.map((name) => ({
        name,
        no_fallback: NO_FALLBACK.includes(name),
        // The resolved value for THIS org, so the palette can show what each token will become.
        sample: String(DOC_TOKENS[name](org || {}) ?? ""),
      })),
      no_fallback: NO_FALLBACK,
      org_name: org?.name || null,
      legal_entity_verified: Number(org?.legal_entity_verified || 0) === 1,
    });
  }

  if (p === "/api/admin/documents/preview" && m === "POST") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const b = await request.json().catch(() => ({}));
    const template = String(b?.body ?? "").replace(/\r\n/g, "\n");
    const org = await orgProfile(env, ctx.orgId);
    const res = resolveDocTokens(template, org);

    // Same widest-set scan the publish path runs (standards §8 check 3, F-11). Surfaced here so
    // the author sees it while typing rather than as a 409 after clicking Publish.
    const allOrgs = await env.DB.prepare(
      `SELECT name, legal_entity FROM orgs WHERE deleted_at IS NULL`
    ).all();
    const literals = literalOrgNames(res.text, allOrgs.results || []);

    return H.json({
      ok: res.ok,
      text: res.text,
      unknown: res.unknown,
      empty: res.empty,
      bad_placeholder: res.badPlaceholder,
      literal_names: literals,
      refusal: res.ok ? null : tokenRefusal(res),
      entity_unverified: Number(org?.legal_entity_verified || 0) === 0,
      length: res.text.length,
    });
  }

  /* ---------- staff: requirements ---------- */

  if (p === "/api/admin/requirements/preview" && m === "POST") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const b = await request.json().catch(() => ({}));
    const documentId = Number(b?.document_id);
    const versionId = Number(b?.version_id);
    if (!documentId || !versionId) return H.json({ error: "document_id and version_id are required." }, 400);
    const retro = b?.retroactive ? 1 : 0;

    // Who becomes non-compliant if this is assigned retroactively? Server-side count only —
    // a client-side array length is not a safety check.
    const q = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM contacts c
        WHERE c.org_id = ?1 AND c.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM signatures s
             WHERE s.subject_contact_id = c.id AND s.document_id = ?2 AND s.deleted_at IS NULL
               AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
               AND (?3 = 0 OR s.version_id = ?4))`
    ).bind(ctx.orgId, documentId, retro, versionId).first();

    const affected = Number(q?.n || 0);
    return H.json({
      affected_count: affected,
      retroactive: retro === 1,
      requires_typed_confirmation: retro === 1 && affected > 50,
      message: retro === 1
        ? `${affected} member${affected === 1 ? "" : "s"} become non-compliant immediately and cannot register or check in until they sign again.`
        : `${affected} member${affected === 1 ? "" : "s"} have not signed this document. Existing signatures stay valid until they expire.`,
    });
  }

  if (p === "/api/admin/requirements" && m === "POST") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const b = await request.json().catch(() => ({}));
    const documentId = Number(b?.document_id);
    const versionId = Number(b?.version_id);
    if (!documentId || !versionId) return H.json({ error: "document_id and version_id are required." }, 400);

    const appliesTo = APPLIES_TO.includes(b?.applies_to) ? b.applies_to : "all";
    const signerRule = SIGNER_RULES.includes(b?.signer_rule) ? b.signer_rule : "either";
    const retro = b?.retroactive ? 1 : 0;
    const termDays = b?.term_days === null ? null
      : (Number.isFinite(Number(b?.term_days)) ? Number(b.term_days) : 365);

    // Verify both belong to this org. Never trust an id pair from the client.
    const ver = await env.DB.prepare(
      `SELECT v.id, v.label, v.material FROM waiver_versions v
        WHERE v.id = ?1 AND v.document_id = ?2 AND v.org_id = ?3 AND v.deleted_at IS NULL`
    ).bind(versionId, documentId, ctx.orgId).first();
    if (!ver) return H.json({ error: "That version does not belong to this document." }, 404);

    const prior = await env.DB.prepare(
      `SELECT id, version_id FROM document_requirements
        WHERE org_id = ?1 AND document_id = ?2 AND applies_to = ?3
          AND active = 1 AND deleted_at IS NULL`
    ).bind(ctx.orgId, documentId, appliesTo).first();

    let affected = 0;
    if (retro === 1) {
      const q = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM contacts c
          WHERE c.org_id = ?1 AND c.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM signatures s
              WHERE s.subject_contact_id = c.id AND s.document_id = ?2
                AND s.deleted_at IS NULL AND s.version_id = ?3)`
      ).bind(ctx.orgId, documentId, versionId).first();
      affected = Number(q?.n || 0);
      // Guard mirrors the bulk-edit pattern: above 50, the caller must echo the count back.
      if (affected > 50 && Number(b?.confirm_affected_count) !== affected) {
        return H.json({
          error: `This locks ${affected} members out of registration and check-in until they re-sign. Resubmit with confirm_affected_count set to ${affected}, or assign it as future-only instead.`,
          affected_count: affected, needs_typed_confirmation: true,
        }, 409);
      }
    }

    const stmts = [];
    // The partial unique index permits one active requirement per (org, document, audience), so
    // the prior row must be deactivated in the same batch or the insert fails.
    if (prior) {
      stmts.push(env.DB.prepare(
        `UPDATE document_requirements SET active = 0, deleted_at = datetime('now')
          WHERE id = ?1`).bind(prior.id));
    }
    stmts.push(env.DB.prepare(
      `INSERT INTO document_requirements
         (org_id, document_id, version_id, applies_to, signer_rule, term_days,
          effective_from, retroactive, invalidated_count, superseded_requirement_id,
          created_by_user_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, datetime('now')), ?8, ?9, ?10, ?11)`
    ).bind(ctx.orgId, documentId, versionId, appliesTo, signerRule, termDays,
           b?.effective_from ? String(b.effective_from) : null,
           retro, retro === 1 ? affected : null, prior ? prior.id : null, ctx.userId));

    const out = await env.DB.batch(stmts);
    const newId = out[out.length - 1].meta.last_row_id;

    await H.audit(env, ctx, "document.requirement.assign", "document_requirements", newId, {
      document_id: documentId, version_id: versionId, version_label: ver.label,
      applies_to: appliesTo, signer_rule: signerRule, term_days: termDays,
      retroactive: retro, affected_count: retro === 1 ? affected : null,
      superseded_requirement_id: prior ? prior.id : null,
      prior_version_id: prior ? prior.version_id : null,
      source: "document_requirement",
    });

    return H.json({ ok: true, id: newId, affected_count: retro === 1 ? affected : 0 }, 201);
  }

  const reqId = matchId(p, "/api/admin/requirements/");
  if (reqId && m === "DELETE") {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    const r = await env.DB.prepare(
      `UPDATE document_requirements SET active = 0, deleted_at = datetime('now')
        WHERE id = ?1 AND org_id = ?2 AND active = 1 AND deleted_at IS NULL`
    ).bind(reqId, ctx.orgId).run();
    if (!r.meta.changes) return H.json({ error: "Requirement not found." }, 404);
    await H.audit(env, ctx, "document.requirement.remove", "document_requirements", reqId, {});
    return H.json({ ok: true });
  }

  /* ---------- member ---------- */

  if (p === "/api/member/compliance" && m === "GET") {
    const contact = await H.contactForSession(env, ctx);
    if (!contact) return H.json({ error: "Sign in first." }, 401);
    const out = await complianceFor(env, ctx.orgId, contact.id);
    return H.json(out);
  }

  return null; // not ours
}

/* ============================ path helpers ============================ */

function matchId(p, prefix) {
  if (!p.startsWith(prefix)) return null;
  const rest = p.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

function matchSub(p, prefix, suffix) {
  if (!p.startsWith(prefix) || !p.endsWith(suffix)) return null;
  const mid = p.slice(prefix.length, p.length - suffix.length);
  if (!/^\d+$/.test(mid)) return null;
  return Number(mid);
}

export { resignRequired };
