/**
 * Boomtown Platform — Waiver Versioning
 * File: worker/src/waivers.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.22.0
 *
 * The waiver text is a DB record, not a JS constant. Every signature pins the exact
 * version row it was shown, so republishing can never rewrite what somebody agreed to.
 *
 * Public:
 *   GET  /api/waiver/current                → active version for the org (body included)
 *   GET  /api/waiver/versions/:id           → any published version's text (permalink for
 *                                             "view the text I signed"; published legal
 *                                             terms are not secret, so no auth here)
 * Member (session):
 *   GET  /api/waiver/mine                   → my/my children's signatures + needs_resign
 * Staff:
 *   GET  /api/admin/waivers/versions        → list + signature counts (no bodies; keeps it light)
 *   GET  /api/admin/waivers/versions/:id    → one version incl. body
 *   POST /api/admin/waivers/versions        → publish { label, body, material?, notes? }
 *
 * Exports for other modules (one-way imports, no cycles):
 *   currentVersion(env, orgId) · pinFor(env, orgId, claimedVersionId)
 * Pure (unit-tested):
 *   normalizePublish · resignRequired · versionLabel · sha256Hex
 *
 * NOT built on purpose: editing a published body. A published version is immutable —
 * a correction is a new version with material=0. Mutating signed text is the exact
 * failure this module exists to prevent.
 */

let H = null; // wired: { json, audit, isStaff, requireStaff }
export function wireWaivers(helpers) { H = helpers; }

const LABEL_MAX = 40;
const BODY_MIN = 50;      // a real waiver is never 12 characters; catches a truncated paste
const BODY_MAX = 60000;
const NOTES_MAX = 500;

/* ============================ pure helpers (unit-tested) ============================ */

/** SHA-256 hex of a string. WebCrypto is available in Workers and in Node >= 18. */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate + normalize a publish body. Returns { ok, error? , value? }.
 * Rejects rather than silently coerces: publishing the wrong text is not recoverable.
 */
/* ==================== token resolution (v0.27.0) ==================== */

/**
 * ONE canonical waiver body serves every org. The legal text is identical; only the identity
 * details differ. Storing four near-copies guarantees they drift, and a waiver that names the
 * wrong entity or a dead opt-out address is weaker than one that names nothing.
 *
 * ENTITY vs ORG_NAME is the distinction that matters. ENTITY is the legal person the release
 * runs to ("Boomtown Athletics, LLC"). ORG_NAME is the brand a family recognises
 * ("Match Point Social"). If the brands are DBAs of one LLC, ENTITY is the same in all four
 * and only ORG_NAME changes — which is exactly why they must be separate tokens.
 */
export const WAIVER_TOKENS = {
  // v0.27.0 — each company is its own signing entity (owner decision). NO FALLBACK on purpose:
  // an unset legal_entity refuses the publish rather than silently naming the wrong company as
  // the party a family is releasing from liability. That is the one field nobody should guess.
  ENTITY:             (o) => o.legal_entity || "",
  ORG_NAME:           (o) => o.name || "",
  ORG_EMAIL:          (o) => o.admin_email || o.email_sender_address || "",
  ORG_WEBSITE:        (o) => o.website || "",
  ORG_PHONE:          (o) => o.phone || "",
  ORG_ADDRESS:        (o) => [o.address_line1, o.address_line2,
                              [o.city, o.state].filter(Boolean).join(", "),
                              o.postal_code].filter(Boolean).join(" · "),
  // Rules are incorporated by reference. A live URL is stronger than none, but a DEAD URL is
  // weaker than none — so until rules_url is set (domain transfer pending) this renders the
  // fallback wording automatically instead of pointing at a 404.
  RULES_REFERENCE:    (o) => o.rules_url
    ? `posted at ${o.rules_url} and at the facility`
    : "posted at the facility and available on request",
};

/** Every token the text may use. Anything else is a typo, and a typo must not publish. */
export const TOKEN_NAMES = Object.keys(WAIVER_TOKENS);

const TOKEN_RE = /\{\{\s*([A-Z_]+)\s*\}\}/g;

/** Which tokens appear in a body, in order of first use, de-duplicated. */
export function tokensUsed(body) {
  const seen = [];
  for (const m of String(body || "").matchAll(TOKEN_RE)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

/**
 * Substitute org identity into a tokenised body.
 * Returns { ok, text, unknown[], empty[] }.
 *   unknown — tokens the registry doesn't recognise (a typo like {{ORG_MAIL}})
 *   empty   — recognised tokens whose org value is blank
 * Both are refusal conditions at publish time. A waiver rendered with a literal
 * "{{MEDIA_OPTOUT_EMAIL}}" in §6, or with an empty one, has no working decline path — which is
 * the specific thing the text promises. Failing closed here is the whole point.
 */
export function resolveWaiverTokens(body, org) {
  const o = org || {};
  const unknown = [], empty = [];
  const text = String(body || "").replace(TOKEN_RE, (whole, name) => {
    const fn = WAIVER_TOKENS[name];
    if (!fn) { if (!unknown.includes(name)) unknown.push(name); return whole; }
    const val = String(fn(o) == null ? "" : fn(o)).trim();
    if (!val) { if (!empty.includes(name)) empty.push(name); return whole; }
    return val;
  });
  return { ok: unknown.length === 0 && empty.length === 0, text, unknown, empty };
}

/** Human-readable reason a publish was refused. Kept next to the check so they can't diverge. */
export function tokenFailureMessage(res) {
  const parts = [];
  if (res.unknown.length) {
    parts.push(`Unknown token${res.unknown.length === 1 ? "" : "s"} ${res.unknown.map((t) => `{{${t}}}`).join(", ")}. Valid tokens: ${TOKEN_NAMES.map((t) => `{{${t}}}`).join(", ")}.`);
  }
  if (res.empty.length) {
    parts.push(`This organisation has no value for ${res.empty.map((t) => `{{${t}}}`).join(", ")}. Fill it in under Organisation settings first — publishing would leave the placeholder in the signed text.`);
  }
  return parts.join(" ");
}

export function normalizePublish(body) {
  const label = String(body?.label ?? "").trim();
  const text = String(body?.body ?? "").replace(/\r\n/g, "\n").trim();
  const notesRaw = String(body?.notes ?? "").trim();

  if (!label) return { ok: false, error: "Give this version a label (for example: v2)." };
  if (label.length > LABEL_MAX) return { ok: false, error: `Label must be ${LABEL_MAX} characters or fewer.` };
  if (!/^[\w.\- ()]+$/.test(label)) return { ok: false, error: "Label can use letters, numbers, spaces, dots, dashes and brackets only." };
  if (text.length < BODY_MIN) return { ok: false, error: `The waiver text looks too short (${text.length} characters). Paste the full document.` };
  if (text.length > BODY_MAX) return { ok: false, error: `The waiver text is too long (max ${BODY_MAX} characters).` };

  // material defaults to 1 (safe direction): an unspecified change is treated as substantive.
  let material = 1;
  if (body && Object.prototype.hasOwnProperty.call(body, "material")) {
    const m = body.material;
    material = (m === false || m === 0 || m === "0" || m === "false" || m === "no") ? 0 : 1;
  }

  return { ok: true, value: { label, body: text, material, notes: notesRaw.slice(0, NOTES_MAX) || null } };
}

/**
 * Does this signer have to sign again?
 * @param signedVersionId  version pinned to their newest valid signature (null if unpinned)
 * @param currentVersionId active version id
 * @param versionsAfter    versions published after theirs, each { material }
 *
 * Rule: only a MATERIAL version published after yours forces a re-sign. A typo fix
 * (material=0) leaves everyone alone — that is the whole point of the flag.
 */
export function resignRequired(signedVersionId, currentVersionId, versionsAfter) {
  if (!signedVersionId) return true;                       // never pinned = unknown text = re-sign
  if (Number(signedVersionId) === Number(currentVersionId)) return false;
  return (versionsAfter || []).some((v) => Number(v?.material) === 1);
}

/** Display label with a legacy hint, so "v1-legacy" reads honestly in member UI. */
export function versionLabel(row) {
  if (!row) return "unknown version";
  return row.label === "v1-legacy" ? "v1 (pre-versioning)" : String(row.label);
}

/* ============================ shared queries (imported elsewhere) ============================ */

/** The one active version for an org, or null. */
export async function currentVersion(env, orgId) {
  return env.DB.prepare(
    `SELECT id, org_id, label, body, body_sha, material, status, published_at, notes
       FROM waiver_versions
      WHERE org_id = ?1 AND status = 'active' AND deleted_at IS NULL
      ORDER BY published_at DESC, id DESC LIMIT 1`
  ).bind(orgId).first();
}

/**
 * Resolve the version a new signature must pin to.
 * If the client sends the version_id it rendered and that is no longer current, we REFUSE.
 * Reason: the member read text A and we would otherwise record consent to text B.
 * Returns { ok:true, version } or { ok:false, status, error, stale? }.
 */
export async function pinFor(env, orgId, claimedVersionId) {
  const cur = await currentVersion(env, orgId);
  if (!cur) {
    return { ok: false, status: 503, error: "No waiver is published yet. An organizer must publish one before registrations can be accepted." };
  }
  if (claimedVersionId != null && String(claimedVersionId) !== "" && Number(claimedVersionId) !== Number(cur.id)) {
    return {
      ok: false, status: 409, stale: true,
      error: "The waiver was updated while this form was open. Please reload and read the current waiver before signing.",
      current_version_id: cur.id,
    };
  }
  return { ok: true, version: cur };
}

/* ============================ routes ============================ */

export async function waiverRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  const isPublic = p.startsWith("/api/waiver");
  const isAdmin = p.startsWith("/api/admin/waivers");
  if (!isPublic && !isAdmin) return null;

  if (p === "/api/waiver/current" && m === "GET") return getCurrent(env, ctx);
  if (p === "/api/waiver/mine" && m === "GET") return getMine(env, ctx);

  const pubMatch = p.match(/^\/api\/waiver\/versions\/(\d+)$/);
  if (pubMatch && m === "GET") return getVersionPublic(env, ctx, Number(pubMatch[1]));

  if (isAdmin) {
    const deny = await H.requireStaff(env, ctx); if (deny) return deny;
    if (p === "/api/admin/waivers/versions" && m === "GET") return listVersions(env, ctx);
    if (p === "/api/admin/waivers/versions" && m === "POST") return publishVersion(request, env, ctx);
    const one = p.match(/^\/api\/admin\/waivers\/versions\/(\d+)$/);
    if (one && m === "GET") return getVersionAdmin(env, ctx, Number(one[1]));
  }
  return null;
}

async function getCurrent(env, ctx) {
  const v = await currentVersion(env, ctx.orgId);
  if (!v) return H.json({ error: "No waiver is published for this organization yet." }, 404);
  return H.json({
    version: {
      id: v.id, label: v.label, display_label: versionLabel(v),
      body: v.body, body_sha: v.body_sha, published_at: v.published_at,
    },
  });
}

async function getVersionPublic(env, ctx, id) {
  const v = await env.DB.prepare(
    `SELECT id, org_id, label, body, body_sha, status, published_at
       FROM waiver_versions WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL`
  ).bind(id, ctx.orgId).first();
  if (!v) return H.json({ error: "That waiver version was not found." }, 404);
  return H.json({
    version: {
      id: v.id, label: v.label, display_label: versionLabel(v),
      body: v.body, body_sha: v.body_sha, status: v.status, published_at: v.published_at,
    },
  });
}

/** Member view: what did I sign, when, and do I need to sign again? */
async function getMine(env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);

  // Same resolution order as member_portal.ownContact — user_id wins over email match.
  const user = await env.DB.prepare("SELECT id, email FROM users WHERE id=?1 AND deleted_at IS NULL").bind(ctx.userId).first();
  const self = user && await env.DB.prepare(
    "SELECT id FROM contacts WHERE org_id=?1 AND deleted_at IS NULL AND (user_id=?2 OR email=?3) ORDER BY user_id DESC LIMIT 1"
  ).bind(ctx.orgId, user.id, user.email).first();
  if (!self) return H.json({ signatures: [], needs_resign: false, current_version_id: null });

  const kids = (await env.DB.prepare(
    "SELECT minor_contact_id AS id FROM guardianships WHERE org_id = ?1 AND guardian_contact_id = ?2 AND status='active' AND deleted_at IS NULL"
  ).bind(ctx.orgId, self.id).all()).results || [];
  const ids = [self.id, ...kids.map((k) => k.id)];
  const qs = ids.map((_, i) => `?${i + 2}`).join(",");

  const rows = (await env.DB.prepare(
    `SELECT w.id, w.contact_id, w.version_id, w.waiver_text_version, w.signed_at, w.expires_at,
            w.signature_name, c.full_name AS subject_name,
            v.label AS version_label
       FROM waivers w
       JOIN contacts c ON c.id = w.contact_id
       LEFT JOIN waiver_versions v ON v.id = w.version_id
      WHERE w.org_id = ?1 AND w.deleted_at IS NULL AND w.contact_id IN (${qs})
      ORDER BY w.signed_at DESC`
  ).bind(ctx.orgId, ...ids).all()).results || [];

  const cur = await currentVersion(env, ctx.orgId);
  // Basis for the re-sign question = the signer's own newest UNEXPIRED waiver. SQLite stores
  // 'YYYY-MM-DD HH:MM:SS' (UTC, no Z), so normalize before comparing — a naive string compare
  // against an ISO timestamp silently misreads every row.
  const nowMs = Date.now();
  const unexpired = (r) => {
    const t = Date.parse(String(r.expires_at || "").replace(" ", "T") + "Z");
    return Number.isFinite(t) && t > nowMs;
  };
  const newest = rows.filter((r) => r.contact_id === self.id).find(unexpired)
              || rows.find(unexpired)
              || null;

  let after = [];
  if (cur && newest && newest.version_id && Number(newest.version_id) !== Number(cur.id)) {
    after = (await env.DB.prepare(
      `SELECT material FROM waiver_versions
        WHERE org_id = ?1 AND deleted_at IS NULL AND id > ?2 ORDER BY id ASC`
    ).bind(ctx.orgId, newest.version_id).all()).results || [];
  }

  return H.json({
    current_version_id: cur ? cur.id : null,
    current_version_label: cur ? versionLabel(cur) : null,
    needs_resign: resignRequired(newest ? newest.version_id : null, cur ? cur.id : null, after),
    signatures: rows.map((r) => ({
      waiver_id: r.id, contact_id: r.contact_id, subject_name: r.subject_name,
      version_id: r.version_id,
      version_label: r.version_label ? versionLabel({ label: r.version_label }) : (r.waiver_text_version || "unknown"),
      signed_at: r.signed_at, expires_at: r.expires_at, signature_name: r.signature_name,
    })),
  });
}

async function listVersions(env, ctx) {
  const rows = (await env.DB.prepare(
    `SELECT v.id, v.label, v.material, v.status, v.published_at, v.notes, v.body_sha,
            LENGTH(v.body) AS body_chars,
            (SELECT COUNT(*) FROM waivers w WHERE w.version_id = v.id AND w.deleted_at IS NULL) AS signature_count
       FROM waiver_versions v
      WHERE v.org_id = ?1 AND v.deleted_at IS NULL
      ORDER BY v.published_at DESC, v.id DESC`
  ).bind(ctx.orgId).all()).results || [];

  // Members who would be prompted to re-sign if a material version were published right now.
  const activeSigners = await env.DB.prepare(
    "SELECT COUNT(DISTINCT contact_id) AS n FROM waivers WHERE org_id = ?1 AND deleted_at IS NULL AND expires_at > datetime('now')"
  ).bind(ctx.orgId).first();

  return H.json({ versions: rows, active_signer_count: activeSigners ? activeSigners.n : 0 });
}

async function getVersionAdmin(env, ctx, id) {
  const v = await env.DB.prepare(
    `SELECT * FROM waiver_versions WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL`
  ).bind(id, ctx.orgId).first();
  if (!v) return H.json({ error: "That waiver version was not found." }, 404);
  return H.json({ version: v });
}

/**
 * Publish a new version. Retire + insert run in ONE batch (single transaction), and the
 * partial unique index ux_waiver_versions_active makes a concurrent second publish fail
 * loudly instead of quietly producing two active versions.
 */
async function publishVersion(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const v = normalizePublish(body);
  if (!v.ok) return H.json({ error: v.error }, 400);

  // v0.27.0 — TOKEN RESOLUTION AT PUBLISH TIME, not at render time.
  //
  // The submitted text may use {{ORG_NAME}}, {{MEDIA_OPTOUT_EMAIL}} and friends, so one canonical
  // waiver serves every org. But what gets STORED is the resolved text, and body_sha pins it.
  // Resolving at render instead would mean a signed document changes retroactively the day
  // somebody edits an org's email — a signed legal record has to stay byte-reproducible.
  //
  // Publish REFUSES on an unknown token or an org with a blank value. A waiver whose §6 promises
  // a written decline path to a literal "{{MEDIA_OPTOUT_EMAIL}}" has no decline path at all, and
  // that is precisely the clause the owner's decision rests on.
  const org = await env.DB.prepare(
    `SELECT id, name, website, admin_email, email_sender_address, phone,
            address_line1, address_line2, city, state, postal_code
       FROM orgs WHERE id = ?1 AND deleted_at IS NULL`
  ).bind(ctx.orgId).first();
  if (!org) return H.json({ error: "Organization not found." }, 404);

  const used = tokensUsed(v.value.body);
  const resolved = resolveWaiverTokens(v.value.body, org);
  if (!resolved.ok) {
    return H.json({
      error: tokenFailureMessage(resolved),
      tokens_used: used, unknown_tokens: resolved.unknown, empty_tokens: resolved.empty,
    }, 400);
  }
  v.value.body = resolved.text;

  const dupLabel = await env.DB.prepare(
    "SELECT id FROM waiver_versions WHERE org_id = ?1 AND label = ?2 AND deleted_at IS NULL"
  ).bind(ctx.orgId, v.value.label).first();
  if (dupLabel) return H.json({ error: `Version "${v.value.label}" already exists. Pick a new label.` }, 409);

  const sha = await sha256Hex(v.value.body);
  const prev = await currentVersion(env, ctx.orgId);

  if (prev && prev.body_sha === sha) {
    return H.json({ error: "That text is identical to the version already published. Nothing to publish." }, 409);
  }

  try {
    const stmts = [];
    if (prev) {
      stmts.push(env.DB.prepare(
        "UPDATE waiver_versions SET status='retired', updated_at=datetime('now') WHERE id = ?1 AND status='active'"
      ).bind(prev.id));
    }
    stmts.push(env.DB.prepare(
      `INSERT INTO waiver_versions (org_id, label, body, body_sha, material, status, published_by_user_id, supersedes_id, notes)
       VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8)`
    ).bind(ctx.orgId, v.value.label, v.value.body, sha, v.value.material, ctx.userId || null, prev ? prev.id : null, v.value.notes));
    const res = await env.DB.batch(stmts);
    const inserted = res[res.length - 1];
    const newId = inserted?.meta?.last_row_id;

    await H.audit(env, ctx, "waiver.publish_version", "waiver_versions", newId, {
      label: v.value.label, material: v.value.material, supersedes: prev ? prev.label : null, body_sha: sha,
    });

    return H.json({
      ok: true,
      version: { id: newId, label: v.value.label, material: v.value.material, body_sha: sha },
      superseded: prev ? { id: prev.id, label: prev.label } : null,
      resign_prompted: v.value.material === 1,
    });
  } catch (e) {
    if (String(e && e.message).includes("UNIQUE")) {
      return H.json({ error: "Someone else published a version a moment ago. Reload the page and try again." }, 409);
    }
    throw e;
  }
}
