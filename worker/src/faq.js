/**
 * Boomtown Platform — Help & FAQ (owner req #21, phase 1)
 * File: worker/src/faq.js · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.40.0
 *
 * Owner requirement #21 (verbatim): "AI chatbot with a built-in FAQ and troubleshooting
 * manual that can help other users." Build/buy call of record (library §1): FAQ SEARCH
 * FIRST, LLM later. This is the search half — a ranked FAQ lookup any visitor can use,
 * plus staff CRUD. Migration 0028. No LLM anywhere in this module by design.
 *
 * Public routes (no session — help must work before sign-in, schedule.js precedent):
 *   GET  /api/faq?q=refund            → { faqs: [{id, question, answer, tags}] }
 *                                       ranked when q present, sort_order otherwise;
 *                                       published rows only, org-scoped.
 * Staff routes:
 *   GET    /api/admin/faqs            → all rows incl. drafts
 *   POST   /api/admin/faqs            { question, answer, tags?, published?, sort_order? }
 *   PUT    /api/admin/faqs/:id        same body, partial ok
 *   POST   /api/admin/faqs/:id/delete → soft delete
 *
 * Rules baked in (standards §4/§8):
 *   - Every read and write scoped to ctx.orgId; no route accepts an org_id from the client.
 *   - Answers are PLAIN TEXT stored raw, escaped at render by the client (esc helper) —
 *     no HTML accepted, no HTML emitted (secure-web-code: treat all input as hostile).
 *   - Errors are human sentences, not codes (§8).
 *   - Public route is read-only SELECT — no flood-guard writer surface exists here.
 * Pure (unit-tested): tokenizeQuery · scoreFaq · rankFaqs · normalizeFaq
 */

let json, audit, requireStaff;
export function wireFaq(h) { ({ json, audit, requireStaff } = h); }

/** Max lengths — one screen of help, not a manual chapter. */
export const Q_MAX = 300, A_MAX = 5000, TAGS_MAX = 200;

/* ============================ pure helpers (unit-tested) ============================ */

/** Query → lowercase word tokens, 2+ chars, deduped, capped at 8 (CPU bound). */
export function tokenizeQuery(q) {
  return [...new Set(String(q || "").toLowerCase().split(/[^a-z0-9]+/i)
    .filter(t => t.length >= 2))].slice(0, 8);
}

/** Score one FAQ row against tokens: question hit ×3, tag hit ×2, answer hit ×1. */
export function scoreFaq(tokens, row) {
  const q = String(row.question || "").toLowerCase();
  const a = String(row.answer || "").toLowerCase();
  const t = String(row.tags || "").toLowerCase();
  let s = 0;
  for (const tok of tokens) {
    if (q.includes(tok)) s += 3;
    if (t.includes(tok)) s += 2;
    if (a.includes(tok)) s += 1;
  }
  return s;
}

/**
 * Rank rows for a query. Empty/blank query → rows unchanged (caller's sort_order stands).
 * Otherwise: score > 0 only, best first; ties keep sort_order (stable sort).
 */
export function rankFaqs(q, rows) {
  const tokens = tokenizeQuery(q);
  if (!tokens.length) return rows;
  return rows
    .map(r => ({ ...r, _score: scoreFaq(tokens, r) }))
    .filter(r => r._score > 0)
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...r }) => r);
}

/** Validate + normalize a create/update body. Returns { error } or the clean fields. */
export function normalizeFaq(body, { partial = false } = {}) {
  const out = {};
  if (body?.question !== undefined || !partial) {
    const q = String(body?.question || "").trim();
    if (!q) return { error: "Give the question a short, plain wording." };
    if (q.length > Q_MAX) return { error: `Keep the question under ${Q_MAX} characters.` };
    out.question = q;
  }
  if (body?.answer !== undefined || !partial) {
    const a = String(body?.answer || "").trim();
    if (!a) return { error: "Write the answer — plain text, line breaks are fine." };
    if (a.length > A_MAX) return { error: `Keep the answer under ${A_MAX} characters.` };
    out.answer = a;
  }
  if (body?.tags !== undefined) {
    out.tags = String(body.tags || "").toLowerCase().split(",")
      .map(s => s.trim()).filter(Boolean).join(",").slice(0, TAGS_MAX) || null;
  }
  if (body?.published !== undefined) out.published = body.published ? 1 : 0;
  if (body?.sort_order !== undefined) {
    const n = Number(body.sort_order);
    out.sort_order = Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return out;
}

/* ============================ routes ============================ */

export async function faqRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;
  if (p === "/api/faq" && m === "GET") return publicSearch(env, ctx, url);
  if (p === "/api/admin/faqs" && m === "GET") return adminList(env, ctx);
  if (p === "/api/admin/faqs" && m === "POST") return adminCreate(request, env, ctx);
  if ((x = p.match(/^\/api\/admin\/faqs\/(\d+)$/)) && m === "PUT") return adminUpdate(request, env, ctx, +x[1]);
  if ((x = p.match(/^\/api\/admin\/faqs\/(\d+)\/delete$/)) && m === "POST") return adminDelete(env, ctx, +x[1]);
  return null;
}

async function publicSearch(env, ctx, url) {
  const rows = (await env.DB.prepare(
    `SELECT id, question, answer, tags FROM faqs
     WHERE org_id=?1 AND published=1 AND deleted_at IS NULL
     ORDER BY sort_order, id`
  ).bind(ctx.orgId).all()).results;
  return json({ faqs: rankFaqs(url.searchParams.get("q"), rows) });
}

async function adminList(env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const rows = (await env.DB.prepare(
    `SELECT id, question, answer, tags, sort_order, published, updated_at FROM faqs
     WHERE org_id=?1 AND deleted_at IS NULL ORDER BY sort_order, id`
  ).bind(ctx.orgId).all()).results;
  return json({ faqs: rows });
}

async function adminCreate(request, env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));           // fail closed on parse (§4)
  const f = normalizeFaq(b);
  if (f.error) return json({ error: f.error }, 400);
  const r = await env.DB.prepare(
    `INSERT INTO faqs (org_id, question, answer, tags, sort_order, published)
     VALUES (?1,?2,?3,?4,?5,?6)`
  ).bind(ctx.orgId, f.question, f.answer, f.tags ?? null, f.sort_order ?? 0, f.published ?? 0).run();
  await audit(env, ctx, "faq.created", "faq", r.meta.last_row_id, { question: f.question });
  return json({ ok: true, id: r.meta.last_row_id });
}

async function adminUpdate(request, env, ctx, id) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const f = normalizeFaq(b, { partial: true });
  if (f.error) return json({ error: f.error }, 400);
  const cols = Object.keys(f);
  if (!cols.length) return json({ error: "Nothing to change." }, 400);
  const sets = cols.map((c, i) => `${c}=?${i + 3}`).join(", ");
  const r = await env.DB.prepare(
    `UPDATE faqs SET ${sets}, updated_at=datetime('now')
     WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL`
  ).bind(id, ctx.orgId, ...cols.map(c => f[c])).run();
  if (!r.meta.changes) return json({ error: "That FAQ was not found." }, 404);
  await audit(env, ctx, "faq.updated", "faq", id, { fields: cols });
  return json({ ok: true });
}

async function adminDelete(env, ctx, id) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const r = await env.DB.prepare(
    `UPDATE faqs SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL`
  ).bind(id, ctx.orgId).run();
  if (!r.meta.changes) return json({ error: "That FAQ was not found." }, 404);
  await audit(env, ctx, "faq.deleted", "faq", id, {});
  return json({ ok: true });
}
