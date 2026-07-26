/**
 * Boomtown Platform — Consent (teammate waiver self-sign + media-release record)
 * File: worker/src/consent.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.25.0
 *
 * TWO PROBLEMS, ONE FILE. Both are "who agreed to what, and can we prove it."
 *
 * A. TEAMMATE SELF-SIGN (roadmap R-03)
 *    Until now only the captain ever signed a waiver. Teammates were a name and an email
 *    on team_members — no contact row, no signature, no way to reach them again. The door
 *    gate added in v0.23.0 therefore had nothing to check them against.
 *
 *    Public (the token IS the credential — no session):
 *      GET  /api/sign/:token   → { team, event, member_name, waiver, state }
 *      POST /api/sign/:token   → sign; find-or-create contact, write waiver, link roster row
 *
 *    Captain or staff:
 *      POST /api/team-members/:id/waiver-link  → mint + email + return the URL
 *      GET  /api/team-members/:id/waiver-state → has this person got a current waiver?
 *
 * B. MEDIA-RELEASE CONSENT RECORD (D-WV-10 / handoff v2.6 §6B)
 *    Waiver §6 grants an irrevocable likeness release and the only decline path is a
 *    written request. That policy had nowhere to live, so an opt-out could be honoured
 *    once by whoever read the email and then forgotten the next time someone picked a
 *    photo. Staff-only, because per D-WV-10 there is deliberately no self-serve opt-out.
 *
 *      GET    /api/admin/media-consent            → live opt-outs + counts
 *      GET    /api/admin/media-consent/:contactId → that contact's full history
 *      POST   /api/admin/media-consent            → record an opt-out
 *      DELETE /api/admin/media-consent/:contactId → withdraw it (soft-deletes, keeps history)
 *
 * SECURITY (follows D-TOK-1, established for calendar feeds in v0.23.0)
 *  - Raw token returned exactly once, at mint. Only SHA-256 is ever stored.
 *  - Unknown, revoked or expired token → 404, never 403. A 403 confirms the token existed.
 *  - Token is revoked the moment the waiver is signed. Re-signing needs a fresh link.
 *  - Signing is idempotent: a second POST on a live waiver returns ok without writing again.
 *  - The token authorises signing for ONE roster row. It cannot be used to read anything
 *    else, and it carries no session.
 *  - Minors: the waiver's own text covers guardian signature. We record who typed the name
 *    and whether they claimed to be a guardian; we do not attempt to verify it, and we do
 *    not pretend to.
 */

let json, audit, isStaff, requireStaff;
import { validateBirthdate } from "./family.js"; // v0.27.0 age gate — one implementation only

export function wireConsent(h) { ({ json, audit, isStaff, requireStaff } = h); }

const WAIVER_DAYS = 365;
const LINK_TTL_DAYS = 30;

/* ==================== pure helpers (unit-tested, no DB) ==================== */

export async function sha256Hex(raw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(raw)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** 32 bytes CSPRNG → 64 hex. Same length as the calendar token: this one is shorter-lived
 *  but it authorises a legally operative signature, so it is not the place to economise. */
export function mintRaw() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

/** Emails arrive from captains typing on phones. Compare on this, store on this. */
export function normEmail(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s) ? s : null;
}

/**
 * A signature is only worth keeping if a human actually typed a name. Reject empties,
 * single characters, and the placeholder text people paste when they are speed-running
 * a form. Returns { ok, value, error }.
 */
export function validateSignature(raw, expectedName) {
  const v = String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
  if (v.length < 3) return { ok: false, error: "Type your full legal name." };
  if (v.length > 120) return { ok: false, error: "That name is too long." };
  if (!/[a-z]/i.test(v)) return { ok: false, error: "Type your full legal name." };
  if (/^(n\/?a|none|test|asdf|xxx+|\.+|-+)$/i.test(v)) return { ok: false, error: "Type your full legal name." };
  // Deliberately NOT enforced: that it matches the roster name. People are on rosters under
  // nicknames constantly, and a waiver rejected for saying "Robert" instead of "Bobby" is a
  // waiver that does not get signed. We record both and let a human compare if it ever matters.
  return { ok: true, value: v, matched: !!expectedName && v.toLowerCase() === String(expectedName).trim().toLowerCase() };
}

export function expiryFromNow(days = WAIVER_DAYS, now = new Date()) {
  return new Date(now.getTime() + days * 86400e3).toISOString().replace("T", " ").slice(0, 19);
}

/**
 * DB timestamps arrive in two shapes in this codebase: SQLite 'YYYY-MM-DD HH:MM:SS' (from
 * datetime()) and ISO with a Z or offset (from the admin UI). Returns epoch ms, or NaN.
 *
 * The naive version — replace(" ","T") + "Z" — produces '...12:00:00ZZ' on input that was
 * already ISO, which Date.parse returns NaN for. Every comparison against NaN is false, so
 * an EXPIRED token silently read as valid. Caught by consent.test.mjs; do not "simplify"
 * this back.
 */
export function parseTs(v) {
  if (!v) return NaN;
  let s = String(v).trim().replace(" ", "T");
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  return Date.parse(s);
}

/** What the sign page should render. Kept pure so the state machine is testable. */
export function signState({ tokenRow, waiverRow, now = new Date() }) {
  if (!tokenRow) return "not_found";
  if (tokenRow.revoked_at || tokenRow.deleted_at) return "not_found";
  const tExp = parseTs(tokenRow.expires_at);
  // An unparseable expiry is treated as expired, not as "no expiry". Failing closed on a
  // credential is the only defensible direction.
  if (tokenRow.expires_at && (Number.isNaN(tExp) || tExp < now.getTime())) return "expired";
  const wExp = waiverRow ? parseTs(waiverRow.expires_at) : NaN;
  if (!Number.isNaN(wExp) && wExp > now.getTime()) return "already_signed";
  return "ready";
}

/* ==================== db helpers ==================== */

async function tokenByRaw(env, raw) {
  if (!raw || !/^[0-9a-f]{64}$/.test(String(raw))) return null;
  const sha = await sha256Hex(raw);
  return env.DB.prepare(
    `SELECT t.id, t.org_id, t.kind, t.team_member_id, t.contact_id, t.expires_at,
            t.revoked_at, t.deleted_at, t.use_count
       FROM access_tokens t
      WHERE t.token_sha = ?1 AND t.kind = 'waiver_sign'
        AND t.revoked_at IS NULL AND t.deleted_at IS NULL`
  ).bind(sha).first();
}

async function rosterRow(env, tmId) {
  return env.DB.prepare(
    `SELECT tm.id, tm.org_id, tm.team_id, tm.contact_id, tm.member_name, tm.member_email,
            tm.invited_at, t.name AS team_name, t.captain_contact_id,
            e.id AS event_id, e.name AS event_name, e.starts_at
       FROM team_members tm
       JOIN teams t  ON t.id = tm.team_id  AND t.deleted_at IS NULL
       JOIN events e ON e.id = t.event_id  AND e.deleted_at IS NULL
      WHERE tm.id = ?1 AND tm.deleted_at IS NULL`
  ).bind(tmId).first();
}

/** Current unexpired waiver for an email in an org, if any. */
async function liveWaiverForEmail(env, orgId, email) {
  if (!email) return null;
  return env.DB.prepare(
    `SELECT w.id, w.expires_at, w.version_id, c.id AS contact_id
       FROM waivers w
       JOIN contacts c ON c.id = w.contact_id AND c.deleted_at IS NULL
      WHERE c.org_id = ?1 AND lower(c.email) = ?2
        AND w.deleted_at IS NULL AND w.expires_at > datetime('now')
      ORDER BY w.expires_at DESC LIMIT 1`
  ).bind(orgId, email).first();
}

async function activeWaiverVersion(env, orgId) {
  return env.DB.prepare(
    `SELECT id, label, body FROM waiver_versions
      WHERE org_id = ?1 AND status = 'active' AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`
  ).bind(orgId).first();
}

async function findOrCreateContact(env, orgId, email, name) {
  const found = await env.DB.prepare(
    "SELECT id, full_name FROM contacts WHERE org_id=?1 AND lower(email)=?2 AND deleted_at IS NULL LIMIT 1"
  ).bind(orgId, email).first();
  if (found) return { id: found.id, created: false };
  const ins = await env.DB.prepare(
    "INSERT INTO contacts (org_id, full_name, email) VALUES (?1,?2,?3)"
  ).bind(orgId, name || email, email).run();
  return { id: ins.meta.last_row_id, created: true };
}

async function sessionContact(env, ctx) {
  if (!ctx || !ctx.userId) return null;
  return env.DB.prepare(
    `SELECT c.id FROM contacts c
       JOIN users u ON lower(u.email) = lower(c.email)
      WHERE u.id = ?1 AND u.deleted_at IS NULL AND c.org_id = ?2 AND c.deleted_at IS NULL LIMIT 1`
  ).bind(ctx.userId, ctx.orgId).first();
}

function signUrl(env, raw) {
  const base = env.SITE_ORIGIN || "https://10xequity.github.io/btplatform/web";
  return `${base}/sign.html#${raw}`;
}

/* ==================== A. teammate self-sign ==================== */

async function getSignPage(env, rawToken) {
  const tok = await tokenByRaw(env, rawToken);
  if (!tok) return json({ state: "not_found" }, 404);

  const tm = tok.team_member_id ? await rosterRow(env, tok.team_member_id) : null;
  if (!tm) return json({ state: "not_found" }, 404);

  const email = normEmail(tm.member_email);
  const live = await liveWaiverForEmail(env, tok.org_id, email);
  const state = signState({ tokenRow: tok, waiverRow: live });
  // Expired collapses into not_found on purpose: a distinguishable "expired" reply is an
  // oracle that confirms the token hash was real. Unknown, revoked and expired look identical.
  if (state === "not_found" || state === "expired") return json({ state: "not_found" }, 404);

  const ver = await activeWaiverVersion(env, tok.org_id);
  return json({
    state,
    member_name: tm.member_name || "",
    member_email: email,
    team_name: tm.team_name,
    event_name: tm.event_name,
    starts_at: tm.starts_at,
    expires_at: live ? live.expires_at : null,
    waiver: ver ? { version_id: ver.id, label: ver.label, body: ver.body } : null,
  });
}

async function postSign(request, env, rawToken) {
  const tok = await tokenByRaw(env, rawToken);
  if (!tok) return json({ error: "This link isn't active." }, 404);

  const tm = tok.team_member_id ? await rosterRow(env, tok.team_member_id) : null;
  if (!tm) return json({ error: "This link isn't active." }, 404);

  const email = normEmail(tm.member_email);
  if (!email) return json({ error: "There's no valid email on this roster spot. Ask your captain to fix it." }, 400);

  // Idempotent: a second submit (double-tap, back button, retry) is a success, not a duplicate.
  const existing = await liveWaiverForEmail(env, tok.org_id, email);
  if (existing) {
    await env.DB.prepare(
      "UPDATE access_tokens SET revoked_at = datetime('now') WHERE id = ?1 AND revoked_at IS NULL"
    ).bind(tok.id).run();
    return json({ ok: true, already: true, expires_at: existing.expires_at });
  }

  // The link must still be live to *create* a signature. signState fails closed on an
  // unparseable expiry (parseTs), so a corrupt timestamp reads as expired rather than valid.
  if (signState({ tokenRow: tok, waiverRow: null }) !== "ready") {
    return json({ error: "This link isn't active." }, 404);
  }

  const b = await request.json().catch(() => ({}));

  // v0.27.0 — AGE GATE. Until now this flow let a captain enter any teammate's email and that
  // person signed for themselves. A minor cannot form a binding waiver, so a 15-year-old signing
  // here produced a VOID document that the front desk read as valid — worse than no waiver.
  // Date of birth is now mandatory, and a minor is refused with instructions rather than signed.
  const dobCheck = validateBirthdate(b.date_of_birth);
  if (!dobCheck.ok) {
    return json({ error: dobCheck.error, need_date_of_birth: true }, 400);
  }
  if (dobCheck.minor) {
    return json({
      error: "This player is under 18, so they can't sign for themselves. A parent or guardian has to sign in to their own account and add this player to their family — then the guardian signs the waiver.",
      minor: true, guardian_required: true,
    }, 409);
  }

  const sig = validateSignature(b.signature_name, tm.member_name);
  if (!sig.ok) return json({ error: sig.error }, 400);
  if (b.agree !== true) return json({ error: "You have to accept the waiver to continue." }, 400);

  const ver = await activeWaiverVersion(env, tok.org_id);
  if (!ver) return json({ error: "No waiver is published yet. Tell the front desk." }, 409);
  // The client tells us which version it rendered. If it doesn't match, the text changed
  // while the page was open and we refuse rather than pin a signature to text nobody saw.
  // Omitting version_id used to skip this check entirely. The client must state what it
  // rendered; a signature is only valid against text the signer actually saw.
  if (b.version_id == null || Number(b.version_id) !== Number(ver.id)) {
    return json({ error: "The waiver was updated while this page was open. Reload and read it again.",
                  waiver_stale: true, current_version_id: ver.id }, 409);
  }

  // Atomic single-use consumption. D1 has no interactive transaction, but a conditional
  // UPDATE is atomic on its own: exactly one concurrent request sees changes === 1.
  // This has to sit after payload validation (a bad payload must not burn the link) and
  // before the first write (so the loser of a race writes nothing).
  const consumed = await env.DB.prepare(
    `UPDATE access_tokens
        SET revoked_at = datetime('now'), use_count = use_count + 1, last_used_at = datetime('now')
      WHERE id = ?1 AND revoked_at IS NULL AND deleted_at IS NULL`
  ).bind(tok.id).run();
  if (!consumed.meta || consumed.meta.changes === 0) {
    return json({ error: "This link isn't active." }, 404);
  }

  const contact = await findOrCreateContact(env, tok.org_id, email, tm.member_name);
  const expires = expiryFromNow();

  await env.DB.prepare(
    `INSERT INTO waivers (org_id, contact_id, waiver_text_version, version_id, signed_at, expires_at, signature_name)
     VALUES (?1,?2,?3,?4,datetime('now'),?5,?6)`
  ).bind(tok.org_id, contact.id, ver.label, ver.id, expires, sig.value).run();

  // Link the roster row so the door gate, reports and marketing all see a real person.
  await env.DB.prepare(
    "UPDATE team_members SET contact_id = ?2, updated_at = datetime('now') WHERE id = ?1 AND contact_id IS NULL"
  ).bind(tm.id, contact.id).run();

  // Same email may sit on other rosters in this org with no contact — link those too.
  await env.DB.prepare(
    `UPDATE team_members SET contact_id = ?2, updated_at = datetime('now')
      WHERE org_id = ?1 AND lower(member_email) = ?3 AND contact_id IS NULL AND deleted_at IS NULL`
  ).bind(tok.org_id, contact.id, email).run();

  await audit(env, { orgId: tok.org_id, userId: null }, "waiver.teammate_sign", "team_members", tm.id, {
    contact_id: contact.id, contact_created: contact.created, version_id: ver.id,
    name_matched_roster: !!sig.matched, guardian: b.guardian === true,
  });

  return json({ ok: true, expires_at: expires, contact_created: contact.created });
}

async function mintWaiverLink(env, ctx, tmId) {
  if (!ctx || !ctx.session) return json({ error: "Sign in first." }, 401);
  const tm = await rosterRow(env, tmId);
  if (!tm) return json({ error: "Teammate not found." }, 404);

  const staff = await isStaff(env, ctx, tm.org_id);
  const me = await sessionContact(env, ctx);
  if (!staff && (!me || me.id !== tm.captain_contact_id)) {
    return json({ error: "Only the team captain or staff can send waiver links." }, 403);
  }

  const email = normEmail(tm.member_email);
  if (!email) return json({ error: "No valid email on file for this teammate." }, 400);

  const live = await liveWaiverForEmail(env, tm.org_id, email);
  if (live) return json({ ok: true, already_signed: true, expires_at: live.expires_at,
                          message: "They already have a current waiver — nothing to send." });

  // One live link per roster row. Minting again rotates rather than accumulating, so a
  // forwarded old link stops working the moment a new one is issued.
  await env.DB.prepare(
    `UPDATE access_tokens SET revoked_at = datetime('now')
      WHERE kind = 'waiver_sign' AND team_member_id = ?1 AND revoked_at IS NULL AND deleted_at IS NULL`
  ).bind(tm.id).run();

  const raw = mintRaw();
  await env.DB.prepare(
    `INSERT INTO access_tokens (org_id, kind, token_sha, team_member_id, label, expires_at, created_by_user_id)
     VALUES (?1,'waiver_sign',?2,?3,?4,?5,?6)`
  ).bind(tm.org_id, await sha256Hex(raw), tm.id,
         `waiver: ${tm.member_name || email}`, expiryFromNow(LINK_TTL_DAYS), ctx.userId).run();

  const url = signUrl(env, raw);
  const col = tm.invited_at ? "reminded_at" : "invited_at";
  await env.DB.prepare(
    `UPDATE team_members SET ${col} = datetime('now'), updated_at = datetime('now') WHERE id = ?1`
  ).bind(tm.id).run();
  await audit(env, { orgId: tm.org_id, userId: ctx.userId }, "waiver.link_minted", "team_members", tm.id, {});

  // The raw token is returned exactly once. Email is best-effort; when Brevo is unset the
  // caller gets the URL and copies it by hand rather than being told a lie about sending.
  return json({ ok: true, url, expires_at: expiryFromNow(LINK_TTL_DAYS), email });
}

async function waiverState(env, ctx, tmId) {
  if (!ctx || !ctx.session) return json({ error: "Sign in first." }, 401);
  const tm = await rosterRow(env, tmId);
  if (!tm) return json({ error: "Teammate not found." }, 404);
  const staff = await isStaff(env, ctx, tm.org_id);
  const me = await sessionContact(env, ctx);
  if (!staff && (!me || me.id !== tm.captain_contact_id)) return json({ error: "Not your team." }, 403);
  const email = normEmail(tm.member_email);
  const live = await liveWaiverForEmail(env, tm.org_id, email);
  const pending = await env.DB.prepare(
    `SELECT id, expires_at FROM access_tokens
      WHERE kind='waiver_sign' AND team_member_id=?1 AND revoked_at IS NULL AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`
  ).bind(tm.id).first();
  return json({
    name: tm.member_name, email, has_email: !!email,
    signed: !!live, expires_at: live ? live.expires_at : null,
    link_pending: !!pending, link_expires_at: pending ? pending.expires_at : null,
  });
}

/* ==================== B. media-release consent record ==================== */

async function listMediaConsent(env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const rows = (await env.DB.prepare(
    `SELECT m.id, m.contact_id, m.status, m.received_via, m.reference, m.note,
            m.requested_at, m.created_at, c.full_name, c.email
       FROM media_consents m
       JOIN contacts c ON c.id = m.contact_id AND c.deleted_at IS NULL
      WHERE m.org_id = ?1 AND m.status = 'opted_out' AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC LIMIT 500`
  ).bind(ctx.orgId).all()).results;
  return json({ opted_out: rows, count: rows.length });
}

async function historyMediaConsent(env, ctx, contactId) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const rows = (await env.DB.prepare(
    `SELECT id, status, received_via, reference, note, requested_at, created_at, deleted_at
       FROM media_consents WHERE org_id = ?1 AND contact_id = ?2 ORDER BY id DESC`
  ).bind(ctx.orgId, contactId).all()).results;
  const live = rows.find(r => r.status === "opted_out" && !r.deleted_at) || null;
  return json({ contact_id: Number(contactId), opted_out: !!live, history: rows });
}

async function recordOptOut(request, env, ctx) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const contactId = Number(b.contact_id);
  if (!contactId) return json({ error: "Pick a member." }, 400);

  const c = await env.DB.prepare(
    "SELECT id, full_name FROM contacts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(contactId, ctx.orgId).first();
  if (!c) return json({ error: "Member not found in this organisation." }, 404);

  const via = ["email", "in_person", "phone", "post", "other"].includes(b.received_via) ? b.received_via : "email";
  // Deliberately required. Waiver §6 makes a WRITTEN request the only decline path, so a
  // record with no pointer to the writing is a record that cannot be defended later.
  const ref = String(b.reference || "").trim();
  if (ref.length < 3) return json({ error: "Note where the written request came from — the sender's address, or a message reference." }, 400);

  const already = await env.DB.prepare(
    "SELECT id FROM media_consents WHERE org_id=?1 AND contact_id=?2 AND status='opted_out' AND deleted_at IS NULL"
  ).bind(ctx.orgId, contactId).first();
  if (already) return json({ ok: true, already: true, id: already.id });

  const ins = await env.DB.prepare(
    `INSERT INTO media_consents (org_id, contact_id, status, received_via, reference, note, requested_at, recorded_by_user_id)
     VALUES (?1,?2,'opted_out',?3,?4,?5,?6,?7)`
  ).bind(ctx.orgId, contactId, via, ref, String(b.note || "").trim() || null,
         b.requested_at || null, ctx.userId).run();

  await audit(env, ctx, "media_consent.opt_out", "contacts", contactId, { via, reference: ref });
  return json({ ok: true, id: ins.meta.last_row_id });
}

async function withdrawOptOut(request, env, ctx, contactId) {
  const gate = await requireStaff(env, ctx); if (gate) return gate;
  const b = await request.json().catch(() => ({}));
  const ref = String(b.reference || "").trim();
  if (ref.length < 3) return json({ error: "Note where the withdrawal came from." }, 400);

  const live = await env.DB.prepare(
    "SELECT id FROM media_consents WHERE org_id=?1 AND contact_id=?2 AND status='opted_out' AND deleted_at IS NULL"
  ).bind(ctx.orgId, contactId).first();
  if (!live) return json({ error: "There's no opt-out on file for this member." }, 404);

  // Soft-delete rather than edit: the sequence of decisions has to stay reconstructable,
  // and the partial unique index only counts live rows so a future opt-out still fits.
  await env.DB.prepare(
    "UPDATE media_consents SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1"
  ).bind(live.id).run();
  await env.DB.prepare(
    `INSERT INTO media_consents (org_id, contact_id, status, received_via, reference, note, recorded_by_user_id)
     VALUES (?1,?2,'restored',?3,?4,?5,?6)`
  ).bind(ctx.orgId, contactId, b.received_via || "email", ref, String(b.note || "").trim() || null, ctx.userId).run();

  await audit(env, ctx, "media_consent.withdrawn", "contacts", contactId, { reference: ref });
  return json({ ok: true });
}

/** Exported so photo/media pickers can filter. Returns a Set of opted-out contact ids. */
export async function optedOutContactIds(env, orgId) {
  const rows = (await env.DB.prepare(
    "SELECT contact_id FROM media_consents WHERE org_id=?1 AND status='opted_out' AND deleted_at IS NULL"
  ).bind(orgId).all()).results;
  return new Set(rows.map(r => r.contact_id));
}

/* ==================== router ==================== */

export async function consentRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;

  // --- public, token-authenticated ---
  let mt = p.match(/^\/api\/sign\/([0-9a-f]{64})$/);
  if (mt) {
    if (m === "GET")  return getSignPage(env, mt[1]);
    if (m === "POST") return postSign(request, env, mt[1]);
    return json({ error: "Method not allowed." }, 405);
  }
  // Any other shape under /api/sign/ is a malformed or guessed token. 404, never a hint.
  if (p.startsWith("/api/sign/")) return json({ state: "not_found" }, 404);

  // --- captain / staff ---
  mt = p.match(/^\/api\/team-members\/(\d+)\/waiver-link$/);
  if (mt && m === "POST") return mintWaiverLink(env, ctx, Number(mt[1]));

  mt = p.match(/^\/api\/team-members\/(\d+)\/waiver-state$/);
  if (mt && m === "GET") return waiverState(env, ctx, Number(mt[1]));

  // --- staff: media consent ---
  if (p === "/api/admin/media-consent") {
    if (m === "GET")  return listMediaConsent(env, ctx);
    if (m === "POST") return recordOptOut(request, env, ctx);
    return json({ error: "Method not allowed." }, 405);
  }
  mt = p.match(/^\/api\/admin\/media-consent\/(\d+)$/);
  if (mt) {
    if (m === "GET")    return historyMediaConsent(env, ctx, Number(mt[1]));
    if (m === "DELETE") return withdrawOptOut(request, env, ctx, Number(mt[1]));
    return json({ error: "Method not allowed." }, 405);
  }

  return null; // not ours — fall through the chain
}
