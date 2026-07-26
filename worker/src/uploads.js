/**
 * Boomtown Platform — Generic file uploads
 * File: worker/src/uploads.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.30.0
 * Migration: 0024 (uploads)
 *
 * WHAT THIS IS
 * One org-scoped file store any screen can attach files to. R2 holds the bytes, D1 holds the
 * index — the same split member_profiles.avatar_r2_key has used in production since v0.5.0.
 * This generalises it instead of adding a fourth private copy of the same twelve lines.
 *
 * WHAT THIS IS DELIBERATELY NOT
 *   * Not a compliance, screening or clearance store. Those facts live in an external system by
 *     owner decision (2026-07-26). Two stores for one fact means two records that drift, and no
 *     way to say which is authoritative. There is no clearance column, no expiry, no review date.
 *   * Not an approval workflow. An upload is a file. If a file needs a decision attached, that
 *     belongs to the module that owns the decision.
 *   * Not a document-signing path. documents.js + consent.js already own signing, tokens and
 *     body hashing. This module never writes to signatures, waiver_versions or documents.
 *
 * BUCKET BINDING, AND WHY THERE IS A FALLBACK
 * env.UPLOADS is preferred; env.AVATARS is the fallback. A new R2 bucket has to be created by
 * hand in the Cloudflare dashboard BEFORE the worker deploys, or the deploy fails outright — so
 * shipping a hard dependency on a binding that does not exist yet would break the deploy for a
 * cosmetic naming win. Keys are namespaced `uploads/{org_id}/…`, which cannot collide with the
 * avatar keys already in the bucket. Add an UPLOADS binding later and this file needs no edit.
 *
 * SECURITY — /secure-web-code, standards §8.1
 *   1. MIME allow-list is SERVER-SIDE. The client's Content-Type is a hint, checked against
 *      ALLOWED_TYPES and rejected if absent from it. `accept=` on the input is a convenience.
 *   2. SVG IS NOT ALLOWED. An SVG is a script container; served from our origin it is stored XSS.
 *      Neither is text/html for the same reason. This is the single most important line here.
 *   3. Everything that is not a plain raster image or a PDF is served
 *      `Content-Disposition: attachment`, so the browser downloads rather than renders it.
 *   4. Filenames are sanitised to a display string and NEVER used to build the R2 key. The key is
 *      generated. Path traversal has nothing to traverse.
 *   5. Field writes use an explicit allow-list. No Object.keys(body), no spread into an UPDATE.
 *   6. Every read re-checks org ownership from the row, not from the request.
 *   7. Delete is soft (standards §9.1). The R2 object survives so a mistaken delete is a restore,
 *      not a re-upload. Hard removal is a separate swept job, not a click.
 */

let H = null; // wired: { json, audit, isStaff, requireStaff, contactForSession }
export function wireUploads(helpers) { H = helpers; }

/* ============================ policy constants ============================ */

/** Operator-facing labels. Code-side list, not a CHECK constraint — altering a CHECK in SQLite
 *  requires a table rebuild, and this list will change. Unknown values fall back to 'other'. */
export const UPLOAD_KINDS = [
  "photo", "logo", "roster", "schedule", "form", "receipt",
  "report", "policy", "import", "other",
];

export const VISIBILITIES = ["private", "members", "public"];
export const ENTITIES = ["contact", "event", "document", "league", "team", "org"];

/** 10 MB. Workers accepts far more; this is about what a volunteer at a front desk will wait for
 *  on venue wifi, not about what the platform can technically absorb. */
export const MAX_BYTES = 10 * 1024 * 1024;

/** Per-org ceiling. A runaway import should hit a counted refusal, not a surprise R2 bill. */
export const MAX_FILES_PER_ORG = 2000;

/**
 * Allow-list. Extension is derived from HERE, never from the uploaded filename.
 * SVG and HTML are absent on purpose — see the header, item 2. Do not add them.
 * `inline` = safe to render in the browser from our own origin.
 */
export const ALLOWED_TYPES = {
  "image/jpeg": { ext: "jpg", inline: true },
  "image/png": { ext: "png", inline: true },
  "image/webp": { ext: "webp", inline: true },
  "image/gif": { ext: "gif", inline: true },
  "image/heic": { ext: "heic", inline: false },
  "application/pdf": { ext: "pdf", inline: true },
  "text/csv": { ext: "csv", inline: false },
  "text/plain": { ext: "txt", inline: false },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", inline: false },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", inline: false },
  "application/vnd.ms-excel": { ext: "xls", inline: false },
  "application/msword": { ext: "doc", inline: false },
  "application/zip": { ext: "zip", inline: false },
};

/* ============================ pure helpers ============================ */
/* Exported so worker/test/uploads.test.mjs can assert them without a Worker runtime. */

/**
 * Display-safe filename. This value is shown to humans and used for the download name; it is
 * NEVER part of the R2 key. Strips directory separators, control characters, leading dots.
 */
export function safeFilename(raw, fallbackExt = "bin") {
  let s = String(raw == null ? "" : raw);
  s = s.split("/").pop().split("\\").pop();          // any path component: gone
  s = s.replace(/[\u0000-\u001f\u007f]/g, "");        // control chars
  s = s.replace(/[^A-Za-z0-9._ ()\-]/g, "_");         // conservative visible set
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "");                          // no dotfiles, no "..", no ".."
  if (!s) s = `upload.${fallbackExt}`;
  if (s.length > 120) {                               // keep the extension when truncating
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : "";
    s = s.slice(0, 120 - ext.length) + ext;
  }
  return s;
}

/** Content type from the request, or null. Parameters (`; charset=…`) are dropped before lookup. */
export function normaliseType(headerValue) {
  const t = String(headerValue || "").split(";")[0].trim().toLowerCase();
  return ALLOWED_TYPES[t] ? t : null;
}

/** Generated R2 key. Deterministically shaped, never caller-influenced. */
export function buildKey(orgId, contentType, now = new Date()) {
  const meta = ALLOWED_TYPES[contentType];
  const ext = meta ? meta.ext : "bin";
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `uploads/${Number(orgId)}/${ym}/${crypto.randomUUID()}.${ext}`;
}

export function normaliseKind(k) {
  const v = String(k || "").trim().toLowerCase();
  return UPLOAD_KINDS.includes(v) ? v : "other";
}

export function normaliseVisibility(v) {
  const s = String(v || "").trim().toLowerCase();
  return VISIBILITIES.includes(s) ? s : "private";
}

/** Optional entity link. Both parts must be sane or the link is dropped entirely — a dangling
 *  entity with no id is worse than no link, because a screen will try to resolve it. */
export function normaliseEntity(entity, entityId) {
  const e = String(entity || "").trim().toLowerCase();
  const id = Number(entityId);
  if (!ENTITIES.includes(e) || !Number.isFinite(id) || id <= 0) return { entity: null, entity_id: null };
  return { entity: e, entity_id: Math.trunc(id) };
}

/** Content-Disposition for a read. Anything not on the inline list downloads. */
export function dispositionFor(contentType, filename) {
  const meta = ALLOWED_TYPES[contentType];
  const mode = meta && meta.inline ? "inline" : "attachment";
  // RFC 5987: the quoted form for legacy clients, filename* for anything non-ASCII.
  const ascii = safeFilename(filename).replace(/["\\]/g, "_");
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(ascii)}`;
}

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pre-flight validation of everything except the bytes. Pure, so it is fully unit-testable. */
export function validateUploadRequest({ contentType, bytes, kind, visibility }) {
  const type = normaliseType(contentType);
  if (!type) {
    return {
      ok: false, status: 415,
      error: "That file type isn't accepted. Images, PDF, CSV, Office documents and ZIP are.",
    };
  }
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, status: 400, error: "That file is empty." };
  if (n > MAX_BYTES) {
    return {
      ok: false, status: 413,
      error: `That file is ${(n / 1048576).toFixed(1)} MB. ${MAX_BYTES / 1048576} MB is the limit.`,
    };
  }
  return { ok: true, type, bytes: n, kind: normaliseKind(kind), visibility: normaliseVisibility(visibility) };
}

/* ============================ storage binding ============================ */

/** See the header. UPLOADS wins if it exists; AVATARS is the always-present fallback. */
export function bucketFor(env) {
  return env.UPLOADS || env.AVATARS || null;
}

/* ============================ routes ============================ */

export async function uploadRoutes(request, env, url, ctx) {
  const p = url.pathname;
  if (!p.startsWith("/api/uploads")) return null;
  const m = request.method;

  if (p === "/api/uploads" && m === "POST") return createUpload(request, env, ctx, url);
  if (p === "/api/uploads" && m === "GET") return listUploads(env, ctx, url);

  const one = p.match(/^\/api\/uploads\/(\d+)$/);
  if (one && m === "GET") return readUpload(env, ctx, Number(one[1]), url);
  if (one && m === "PATCH") return patchUpload(request, env, ctx, Number(one[1]));
  if (one && m === "DELETE") return deleteUpload(env, ctx, Number(one[1]));

  const restore = p.match(/^\/api\/uploads\/(\d+)\/restore$/);
  if (restore && m === "POST") return restoreUpload(env, ctx, Number(restore[1]));

  return null;
}

/**
 * POST /api/uploads?filename=&kind=&visibility=&entity=&entity_id=&notes=
 * Body: the raw bytes. Content-Type header carries the type.
 *
 * Raw body rather than multipart, matching the avatar route that has worked since v0.5.0. One
 * request, one file, no boundary parsing in a Worker.
 */
async function createUpload(request, env, ctx, url) {
  const deny = await H.requireStaff(env, ctx);
  if (deny) return deny;

  const bucket = bucketFor(env);
  if (!bucket) {
    return H.json({ error: "File storage isn't configured on this deployment yet." }, 503);
  }

  const q = url.searchParams;
  const body = await request.arrayBuffer();

  const v = validateUploadRequest({
    contentType: request.headers.get("Content-Type"),
    bytes: body.byteLength,
    kind: q.get("kind"),
    visibility: q.get("visibility"),
  });
  if (!v.ok) return H.json({ error: v.error }, v.status);

  // Quota. Counted, then quoted — never silently truncated (standards §8.3).
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM uploads WHERE org_id = ?1 AND deleted_at IS NULL"
  ).bind(ctx.orgId).first();
  if (count && count.n >= MAX_FILES_PER_ORG) {
    return H.json({
      error: `This organization is at its ${MAX_FILES_PER_ORG}-file limit (${count.n} stored). Remove some files first.`,
    }, 409);
  }

  const filename = safeFilename(q.get("filename"), ALLOWED_TYPES[v.type].ext);
  const key = buildKey(ctx.orgId, v.type);
  const sha = await sha256Hex(body);
  const link = normaliseEntity(q.get("entity"), q.get("entity_id"));

  // Identical bytes already on file for this org: report it rather than storing a second copy.
  // Not an error — the operator may want two rows — so it is a hint on the response.
  const dupe = await env.DB.prepare(
    "SELECT id, filename FROM uploads WHERE org_id = ?1 AND sha256 = ?2 AND deleted_at IS NULL LIMIT 1"
  ).bind(ctx.orgId, sha).first();

  await bucket.put(key, body, {
    httpMetadata: { contentType: v.type },
    customMetadata: { org_id: String(ctx.orgId), filename },
  });

  let ins;
  try {
    ins = await env.DB.prepare(
      `INSERT INTO uploads (org_id, r2_key, filename, content_type, bytes, sha256, kind,
                            entity, entity_id, visibility, uploaded_by_user_id, notes)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
    ).bind(ctx.orgId, key, filename, v.type, v.bytes, sha, v.kind,
           link.entity, link.entity_id, v.visibility, ctx.userId,
           (q.get("notes") || "").slice(0, 500) || null).run();
  } catch (e) {
    // The index write is what makes the object findable. Without it the bytes are unreachable
    // garbage, so they go rather than linger as an orphan nobody can see or delete.
    try { await bucket.delete(key); } catch {}
    throw e;
  }

  const id = ins.meta.last_row_id;
  await H.audit(env, ctx, "upload.create", "upload", id, {
    filename, kind: v.kind, bytes: v.bytes, content_type: v.type,
    visibility: v.visibility, entity: link.entity, entity_id: link.entity_id,
    source: "staff_upload",
  });

  return H.json({
    ok: true,
    upload: {
      id, filename, kind: v.kind, bytes: v.bytes, content_type: v.type,
      visibility: v.visibility, entity: link.entity, entity_id: link.entity_id,
      url: `/api/uploads/${id}`,
    },
    duplicate_of: dupe ? { id: dupe.id, filename: dupe.filename } : null,
  }, 201);
}

/** GET /api/uploads?kind=&entity=&entity_id=&q=&include_deleted=1&limit=&offset= */
async function listUploads(env, ctx, url) {
  const deny = await H.requireStaff(env, ctx);
  if (deny) return deny;

  const q = url.searchParams;
  const where = ["u.org_id = ?1"];
  const binds = [ctx.orgId];

  if (q.get("include_deleted") !== "1") where.push("u.deleted_at IS NULL");

  const kind = String(q.get("kind") || "").trim().toLowerCase();
  if (kind && UPLOAD_KINDS.includes(kind)) { binds.push(kind); where.push(`u.kind = ?${binds.length}`); }

  const link = normaliseEntity(q.get("entity"), q.get("entity_id"));
  if (link.entity) {
    binds.push(link.entity); where.push(`u.entity = ?${binds.length}`);
    binds.push(link.entity_id); where.push(`u.entity_id = ?${binds.length}`);
  }

  const search = String(q.get("q") || "").trim();
  if (search) { binds.push(`%${search}%`); where.push(`u.filename LIKE ?${binds.length}`); }

  const limit = Math.min(Math.max(Number(q.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(q.get("offset")) || 0, 0);

  const rows = (await env.DB.prepare(
    `SELECT u.id, u.filename, u.content_type, u.bytes, u.kind, u.entity, u.entity_id,
            u.visibility, u.notes, u.created_at, u.deleted_at, us.email AS uploaded_by
       FROM uploads u
       LEFT JOIN users us ON us.id = u.uploaded_by_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT ${limit} OFFSET ${offset}`
  ).bind(...binds).all()).results;

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM uploads u WHERE ${where.join(" AND ")}`
  ).bind(...binds).first();

  const bytes = await env.DB.prepare(
    "SELECT COALESCE(SUM(bytes),0) AS b FROM uploads WHERE org_id = ?1 AND deleted_at IS NULL"
  ).bind(ctx.orgId).first();

  return H.json({
    uploads: rows.map((r) => ({ ...r, url: `/api/uploads/${r.id}` })),
    total: total ? total.n : 0,
    limit, offset,
    quota: { files: MAX_FILES_PER_ORG, bytes_used: bytes ? bytes.b : 0, max_file_bytes: MAX_BYTES },
    kinds: UPLOAD_KINDS,
  });
}

/**
 * GET /api/uploads/:id — stream the bytes.
 *
 * Visibility is enforced HERE, from the stored row, on every request. A public file stays
 * readable if it is later deactivated at org level — the org check on the row is intentional and
 * narrow: the file's own org owns it. Signed-in reads still go through the router's org guard.
 */
async function readUpload(env, ctx, id, url) {
  const row = await env.DB.prepare(
    "SELECT id, org_id, r2_key, filename, content_type, bytes, visibility, deleted_at FROM uploads WHERE id = ?1"
  ).bind(id).first();
  if (!row || row.deleted_at) return new Response("Not found", { status: 404 });

  if (row.visibility !== "public") {
    const staff = await H.isStaff(env, ctx, row.org_id);
    if (!staff) {
      if (row.visibility === "private") return new Response("Not found", { status: 404 });
      // 'members': any signed-in member of the owning org.
      const me = await H.contactForSession(env, { ...ctx, orgId: row.org_id });
      if (!me) return new Response("Not found", { status: 404 });
    }
  }

  const bucket = bucketFor(env);
  if (!bucket) return new Response("Not found", { status: 404 });
  const obj = await bucket.get(row.r2_key);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", row.content_type);
  headers.set("Content-Disposition", dispositionFor(row.content_type, row.filename));
  // Defence in depth behind the SVG/HTML exclusion: even if a type slipped onto the allow-list,
  // a sandboxed CSP with no script-src cannot execute.
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox; img-src 'self' data:; style-src 'unsafe-inline'");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", row.visibility === "public" ? "public, max-age=3600" : "private, no-store");
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  if (url.searchParams.get("download") === "1") {
    headers.set("Content-Disposition", `attachment; filename="${safeFilename(row.filename).replace(/["\\]/g, "_")}"`);
  }
  return new Response(obj.body, { headers });
}

/**
 * PATCH /api/uploads/:id — metadata only. The bytes are immutable: a different file is a
 * different upload, so an id always refers to the same content.
 *
 * Explicit field allow-list (standards §8.1). Never Object.keys(body).
 */
const PATCHABLE = ["filename", "kind", "visibility", "entity", "entity_id", "notes"];

async function patchUpload(request, env, ctx, id) {
  const row = await env.DB.prepare(
    "SELECT id, org_id, filename, kind, visibility, deleted_at FROM uploads WHERE id = ?1"
  ).bind(id).first();
  if (!row || row.deleted_at) return H.json({ error: "That file isn't there." }, 404);
  const deny = await H.requireStaff(env, ctx, row.org_id);
  if (deny) return deny;

  const body = await request.json().catch(() => ({}));
  const sets = [], binds = [];
  const before = {}, after = {};

  for (const f of PATCHABLE) {
    if (!(f in body)) continue;
    let val;
    if (f === "filename") val = safeFilename(body.filename);
    else if (f === "kind") val = normaliseKind(body.kind);
    else if (f === "visibility") val = normaliseVisibility(body.visibility);
    else if (f === "notes") val = String(body.notes || "").slice(0, 500) || null;
    else continue; // entity / entity_id are handled together, below
    binds.push(val); sets.push(`${f} = ?${binds.length}`);
    before[f] = row[f]; after[f] = val;
  }

  if ("entity" in body || "entity_id" in body) {
    const link = normaliseEntity(body.entity, body.entity_id);
    binds.push(link.entity); sets.push(`entity = ?${binds.length}`);
    binds.push(link.entity_id); sets.push(`entity_id = ?${binds.length}`);
    after.entity = link.entity; after.entity_id = link.entity_id;
  }

  if (!sets.length) return H.json({ error: "Nothing to change." }, 400);

  binds.push(id);
  await env.DB.prepare(
    `UPDATE uploads SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?${binds.length}`
  ).bind(...binds).run();

  await H.audit(env, ctx, "upload.update", "upload", id, { before, after, source: "single_edit" });
  return H.json({ ok: true, id, changed: Object.keys(after) });
}

/**
 * DELETE /api/uploads/:id — soft. Standards §9.1: deactivate, never drop. The R2 object stays,
 * so an accidental delete is one restore rather than "ask them to send it again."
 */
async function deleteUpload(env, ctx, id) {
  const row = await env.DB.prepare(
    "SELECT id, org_id, filename, deleted_at FROM uploads WHERE id = ?1"
  ).bind(id).first();
  if (!row) return H.json({ error: "That file isn't there." }, 404);
  const deny = await H.requireStaff(env, ctx, row.org_id);
  if (deny) return deny;
  if (row.deleted_at) return H.json({ ok: true, id, already: true });

  await env.DB.prepare(
    "UPDATE uploads SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1"
  ).bind(id).run();
  await H.audit(env, ctx, "upload.delete", "upload", id, {
    before: { filename: row.filename, deleted_at: null },
    after: { deleted_at: "now" }, source: "single_edit",
  });
  return H.json({ ok: true, id, restorable: true });
}

/** POST /api/uploads/:id/restore — the reason delete is soft. */
async function restoreUpload(env, ctx, id) {
  const row = await env.DB.prepare(
    "SELECT id, org_id, filename, deleted_at FROM uploads WHERE id = ?1"
  ).bind(id).first();
  if (!row) return H.json({ error: "That file isn't there." }, 404);
  const deny = await H.requireStaff(env, ctx, row.org_id);
  if (deny) return deny;
  if (!row.deleted_at) return H.json({ ok: true, id, already: true });

  await env.DB.prepare(
    "UPDATE uploads SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?1"
  ).bind(id).run();
  await H.audit(env, ctx, "upload.restore", "upload", id, { filename: row.filename, source: "single_edit" });
  return H.json({ ok: true, id });
}
