/**
 * Boomtown Platform — Member Portal module (M12.5)
 * File: worker/src/member_portal.js · Version: v1.1 · Date: 2026-07-26 · Ships in: v0.22.0 (was v1.0, v0.14.0)
 *
 * Member-facing (magic-link/passkey session), mounted by worker/src/index.js:
 *   GET /api/me/agreements → everything this member (and their children) has signed:
 *     { status: { self: {contact_id, name, waiver_ok, expires_at},
 *                 children: [{contact_id, name, waiver_ok, expires_at}] },
 *       agreements: [{ document_type, document_ref, subject_name, signed_name,
 *                      on_behalf, signed_at }] }
 *
 * Sources of truth (read-only here):
 *   - waivers            — every waiver acceptance (registration flow + family signing)
 *   - signatures         — the Module-6 ledger (guardian + adult signatures, contracts later)
 *   - guardianships      — which children this member manages
 * Rows from both tables describing the same signing are merged (dedupeAgreements).
 * Rental requests POST is in facility.js (/api/rental-request) — not duplicated here.
 */

let H = null; // wired: { json, audit, isStaff, requireStaff, sendLoginLink, contactForSession }
export function wireMemberPortal(helpers) { H = helpers; }

export async function memberPortalRoutes(request, env, url, ctx) {
  const p = url.pathname;
  if (p === "/api/me/agreements" && request.method === "GET") return myAgreements(env, ctx);
  return null;
}

async function myAgreements(env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const self = await H.contactForSession(env, ctx);
  if (!self) return H.json({ error: "No member record found for this account yet." }, 404);

  const kids = (await env.DB.prepare(
    `SELECT c.id, c.full_name FROM guardianships g
     JOIN contacts c ON c.id = g.minor_contact_id AND c.deleted_at IS NULL
     WHERE g.org_id=?1 AND g.guardian_contact_id=?2 AND g.status='active' AND g.deleted_at IS NULL`
  ).bind(ctx.orgId, self.id).all()).results;

  const ids = [self.id, ...kids.map((k) => k.id)];
  const qs = ids.map(() => "?").join(",");

  // Latest valid waiver per managed contact → status chips.
  const wrows = (await env.DB.prepare(
    `SELECT contact_id, MAX(expires_at) AS expires_at
     FROM waivers WHERE org_id=?1 AND deleted_at IS NULL AND contact_id IN (${qs})
     GROUP BY contact_id`
  ).bind(ctx.orgId, ...ids).all()).results;
  const expiry = Object.fromEntries(wrows.map((w) => [w.contact_id, w.expires_at]));
  const now = new Date().toISOString();
  const chip = (id, name) => ({
    contact_id: id, name,
    waiver_ok: !!expiry[id] && expiry[id] > now,
    expires_at: expiry[id] || null,
  });

  // Ledger rows (either as subject or as signer).
  const sigs = (await env.DB.prepare(
    `SELECT s.id, s.document_type, s.document_ref, s.version_id, s.signed_name, s.signed_at, s.on_behalf,
            sub.full_name AS subject_name
     FROM signatures s
     JOIN contacts sub ON sub.id = s.subject_contact_id AND sub.deleted_at IS NULL
     WHERE s.org_id=?1 AND s.deleted_at IS NULL
       AND (s.subject_contact_id IN (${qs}) OR s.signer_contact_id IN (${qs}))
     ORDER BY s.signed_at DESC LIMIT 200`
  ).bind(ctx.orgId, ...ids, ...ids).all()).results;

  // Waiver acceptances (registration flow writes waivers only — no ledger row).
  const waivers = (await env.DB.prepare(
    `SELECT w.id, w.contact_id, w.waiver_text_version, w.version_id, w.signed_at, w.expires_at, w.signature_name,
            c.full_name AS subject_name
     FROM waivers w JOIN contacts c ON c.id = w.contact_id AND c.deleted_at IS NULL
     WHERE w.org_id=?1 AND w.deleted_at IS NULL AND w.contact_id IN (${qs})
     ORDER BY w.signed_at DESC LIMIT 200`
  ).bind(ctx.orgId, ...ids).all()).results;

  return H.json({
    status: { self: chip(self.id, self.full_name || "You"), children: kids.map((k) => chip(k.id, k.full_name)) },
    agreements: dedupeAgreements(sigs, waivers),
  });
}

/**
 * Merge ledger + waiver rows into one list; a family signWaiver writes BOTH tables,
 * so a waiver row is dropped when a ledger waiver for the same subject on the same
 * day already exists. Pure — unit-tested in worker/test/member_portal.test.mjs.
 */
export function dedupeAgreements(sigs, waivers) {
  const out = [];
  const seen = new Set();
  for (const s of sigs || []) {
    seen.add(`waiver|${s.subject_name}|${String(s.signed_at || "").slice(0, 10)}`);
    out.push({
      document_type: s.document_type,
      document_ref: s.document_ref || null,
      subject_name: s.subject_name,
      signed_name: s.signed_name,
      on_behalf: s.on_behalf ? 1 : 0,
      signed_at: s.signed_at,
      version_id: s.version_id ?? null, // v1.1 — lets the UI link "view the text I signed"
    });
  }
  for (const w of waivers || []) {
    const key = `waiver|${w.subject_name}|${String(w.signed_at || "").slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      document_type: "waiver",
      document_ref: `waiver:${w.waiver_text_version}`,
      subject_name: w.subject_name,
      signed_name: w.signature_name,
      on_behalf: 0,
      signed_at: w.signed_at,
      expires_at: w.expires_at,
      version_id: w.version_id ?? null, // v1.1
    });
  }
  out.sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)));
  return out;
}

/* D-18 (v0.166.0): the private copy is gone — this module resolves the signed-in member through
   the ONE shared rule (H.contactForSession). Its old comment said "kept local — profiles doesn't
   export it", which was the honest reason at the time and is exactly how one rule became four:
   the shared helper now exists and is injected, so nothing has to be kept local. */
