/**
 * Boomtown Platform — Families, guardians and minors
 * File: worker/src/family.js · Version: v1.2 · Date: 2026-07-29 · Ships in: v0.34.0
 *
 * v1.2 (2026-07-29, v0.34.0): F-18/F-25 closed — POST /api/family/age-out is now the ONLY
 *   age-out endpoint. It records the D-MIN-10 keep-or-separate choice AND, on 'separated',
 *   absorbs everything profiles.js's deleted /api/family/ageout did: email transfer with an
 *   org-scoped clash check BEFORE any write, guardianship end (status='ended',
 *   end_reason='aged_out'), and the sign-in link. Idempotent: a second 'separated' call
 *   returns {already:true} and never re-sends the link. validateAgeOutPayload() exported
 *   pure for family.test.mjs.
 *
 * WHY GUARDIAN-FIRST, AND WHY IT IS NOT NEGOTIABLE
 * A minor cannot form a binding waiver. If a 15-year-old completes registration and signs, the
 * document is void — which is strictly worse than having no waiver at all, because the front desk
 * believes the person is covered. The v0.25.0 teammate self-sign link had exactly this hole: a
 * captain typed an email, the holder signed, and nobody asked how old they were.
 *
 * So the gate runs BEFORE the minor's record is written, not after:
 *   birthdate says minor → halt → require a guardian account → guardian signs → then the child's
 *   profile is created inside a family.
 *
 * The reverse order (create the child, then ask for a guardian) means a minor has already
 * self-registered and possibly self-signed by the time an adult appears. That is the failure this
 * module exists to prevent.
 *
 * AGE IS ALWAYS DERIVED, NEVER STORED
 * There is no is_minor column and there will not be one. A stored boolean is correct until a
 * birthday and silently wrong after it — it would keep an adult in guardian-signed state, or
 * worse, let a minor age into self-signing without anyone re-signing anything. Age is computed
 * from member_profiles.date_of_birth at read time, every time.
 *
 * Migration 0019 provides: families, contacts.family_id, guardianships.aged_out_at /
 * separation_choice / separated_at. member_profiles.date_of_birth already existed.
 */

import { sha256Hex, randomToken } from "./crypto.js"; // leaf; consent.js imports THIS file, so it cannot be the source

let H = null; // wired: { json, audit, requireStaff, contactForSession }
export function wireFamily(helpers) { H = helpers; }

/** Age of majority. A named constant because it appears in several gates and one day may vary. */
export const AGE_OF_MAJORITY = 18;

export const DOMINANT_HANDS = ["left", "right", "ambidextrous"];

export const SEPARATION_CHOICES = ["kept", "separated"];

/**
 * Pure request validation for POST /api/family/age-out. Exported for tests.
 * 'kept' needs no email. 'separated' may carry one; if the contact already has their own
 * email (minors created through registration do), the handler falls back to it.
 */
export function validateAgeOutPayload(b = {}) {
  const gid = Number(b.guardianship_id);
  if (!gid) return { ok: false, status: 400, error: "guardianship_id is required." };
  const choice = String(b.choice || "");
  if (!SEPARATION_CHOICES.includes(choice)) {
    return { ok: false, status: 400, error: `choice must be one of: ${SEPARATION_CHOICES.join(", ")}.` };
  }
  const email = String(b.email || "").trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, status: 400, error: "Enter a valid email address." };
  }
  return { ok: true, gid, choice, email: email || null };
}

/** D-MIN-9 / migration 0025. A contact is 'active' or waiting on a linked adult. */
export const ACTIVATION_STATES = ["active", "pending_guardian"];

/** How long a guardian invitation stays usable. Long enough to hand a phone to a parent later. */
export const GUARDIAN_INVITE_TTL_DAYS = 14;

/**
 * The certification a guardian types their name against (D-MIN-11).
 *
 * IT DELIBERATELY NAMES NO ORGANISATION. Standards §8 forbids an org name, entity, address or
 * email as a literal in anything a member reads, and F-8, F-10, F-13 and F-13b are four separate
 * costumes of that same defect. A string with no party identity in it cannot become a fifth.
 * The wording is about the signer's own statement, which is what is actually being attested.
 *
 * Changing this string changes its hash, which is the point: every stored certification pins the
 * exact wording that was on screen, the same way D-DOC-8 pins a signature to a body_sha.
 */
export const GUARDIAN_CERTIFICATION_TEXT =
  "I confirm that I am the parent or legal guardian of the participant named above, " +
  "that I am 18 years of age or older, and that the information I have entered is " +
  "accurate and complete to the best of my knowledge.";

/* ==================== pure logic (unit-tested) ==================== */

/** Parse a date-only or datetime string to a UTC-midnight epoch. NaN on anything unusable. */
function dayMs(v) {
  if (!v) return NaN;
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return NaN;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Rejects 2026-02-30 and similar, which Date.UTC would silently roll forward.
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return NaN;
  return t;
}

/**
 * Whole years completed on `now`. Returns null when the birthdate is missing or unparseable —
 * null means "unknown", which callers must treat as blocking, not as adult.
 */
export function ageOn(dateOfBirth, now = new Date()) {
  const b = dayMs(dateOfBirth);
  if (Number.isNaN(b)) return null;
  const n = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(n.getTime())) return null;
  const bd = new Date(b);
  let age = n.getUTCFullYear() - bd.getUTCFullYear();
  const beforeBirthday =
    n.getUTCMonth() < bd.getUTCMonth() ||
    (n.getUTCMonth() === bd.getUTCMonth() && n.getUTCDate() < bd.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < 0) return null;            // a birthdate in the future is not an age
  return age;
}

/**
 * Is this person a minor? FAILS CLOSED: an unknown or unparseable birthdate returns true.
 * Treating "we don't know" as adult is how a child ends up signing their own waiver.
 */
export function isMinor(dateOfBirth, now = new Date()) {
  const age = ageOn(dateOfBirth, now);
  if (age == null) return true;
  return age < AGE_OF_MAJORITY;
}

/** Implausible birthdates, caught at entry rather than becoming a 130-year-old member. */
export function validateBirthdate(dateOfBirth, now = new Date()) {
  const b = dayMs(dateOfBirth);
  if (Number.isNaN(b)) return { ok: false, error: "Enter a date of birth as YYYY-MM-DD." };
  const age = ageOn(dateOfBirth, now);
  if (age == null) return { ok: false, error: "That date of birth is in the future." };
  if (age > 120) return { ok: false, error: "Check the date of birth — that's over 120 years old." };
  return { ok: true, age, minor: age < AGE_OF_MAJORITY };
}

/**
 * THE GATE. Decides whether a registration/profile write may proceed.
 *
 * `guardian` is the resolved guardian contact (or null). For an adult it is ignored.
 * For a minor, a guardian is mandatory and must be an adult themselves — otherwise a 16-year-old
 * could be nominated as their 14-year-old sibling's guardian.
 */
export function guardianGate({ dateOfBirth, guardian = null, now = new Date() }) {
  const check = validateBirthdate(dateOfBirth, now);
  if (!check.ok) return { ok: false, reason: "bad_dob", status: 400, error: check.error };

  if (!check.minor) return { ok: true, minor: false, age: check.age };

  if (!guardian) {
    return {
      ok: false, minor: true, age: check.age, reason: "guardian_required", status: 409,
      // D-MIN-8 struck the "they sign the waiver" clause: there is no waiver gate anywhere.
      // The requirement is a linked adult account, not a signature.
      error: "This participant is under 18. A parent or guardian has to create or sign in to their own account first, and the child's profile is created under their family.",
    };
  }
  // The guardian's own age is checked the same way, and fails closed for the same reason.
  if (isMinor(guardian.date_of_birth, now)) {
    return {
      ok: false, minor: true, age: check.age, reason: "guardian_is_minor", status: 409,
      error: "The named parent or guardian is not recorded as an adult. A guardian must be 18 or older with a date of birth on file.",
    };
  }
  return { ok: true, minor: true, age: check.age, guardian_contact_id: guardian.id };
}

/**
 * Who may sign for this participant. A minor never signs for themselves, so the returned
 * signer is the guardian and the subject is the child — which is exactly the shape
 * signatures.subject_contact_id / signer_contact_id / on_behalf already expects.
 */
export function signerFor({ contact, dateOfBirth, guardian = null, now = new Date() }) {
  if (!isMinor(dateOfBirth, now)) {
    return { signer_contact_id: contact ? contact.id : null, subject_contact_id: contact ? contact.id : null, on_behalf: 0 };
  }
  if (!guardian) return null; // caller must run guardianGate first
  return { signer_contact_id: guardian.id, subject_contact_id: contact ? contact.id : null, on_behalf: 1 };
}

/**
 * The 18th-birthday transition. Returns the state a guardianship is in so the UI can prompt once
 * and the back end can enforce the consequence.
 *
 *   'minor'          — still under 18, guardianship live
 *   'prompt'         — turned 18, no choice recorded yet: ask keep-or-separate
 *   'kept'           — chose to stay on the family account; guardian keeps signing
 *   'separated'      — split into their own account; they sign for themselves from now on
 *
 * A separated guardianship is NOT deleted. The row stays so the connection remains visible and
 * the signature history stays reconstructable — the same reasoning as D-CON-4 on consent history.
 */
export function ageOutState({ dateOfBirth, guardianship = null, now = new Date() }) {
  const minor = isMinor(dateOfBirth, now);
  const g = guardianship || {};
  if (minor) return { state: "minor", self_signs: false, prompt: false };
  if (g.separation_choice === "separated") {
    return { state: "separated", self_signs: true, prompt: false, separated_at: g.separated_at || null };
  }
  if (g.separation_choice === "kept") {
    // Kept on the family account: the guardian still signs, and the member can separate later.
    return { state: "kept", self_signs: false, prompt: false, may_separate: true };
  }
  return {
    state: "prompt", self_signs: false, prompt: true,
    message: "This member turned 18. They can stay on the family account or move to their own. Separating means they re-sign the waiver in their own name.",
  };
}

/**
 * Separating creates a new standalone account, and every form the guardian signed on their behalf
 * has to be re-signed by the member themselves. Returns what must be redone.
 */
export function separationRequirements({ hasLiveWaiver = false, hasMediaConsent = false } = {}) {
  const resign = [];
  if (hasLiveWaiver) resign.push("waiver");
  if (hasMediaConsent) resign.push("media_release");
  return {
    resign,
    // The old waiver is not voided retroactively — it covered the period it covered. But it does
    // not carry forward under a new signer, so the member is un-covered until they re-sign.
    blocks_participation: resign.includes("waiver"),
    note: resign.length
      ? "Signatures made by a guardian don't transfer to a new account. The member re-signs in their own name before their next session."
      : "Nothing to re-sign.",
  };
}

/**
 * PUBLIC DISPLAY NAME.
 *
 * D9 is "first name + last initial" in public. For minors the owner asked for an "M" marker and
 * an abbreviated surname. The marker is deliberately withheld from PUBLIC views: publishing
 * "Ava R. (M)" on an open schedule page hands anyone on the internet a machine-readable list of
 * which children are on which court at which time. Staff need that signal; strangers do not.
 * `visibility` is the schedule_views column added in migration 0018.
 */
export function displayName(fullName, { minor = false, visibility = "public" } = {}) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0];
  const abbreviated = parts.length > 1 ? `${first} ${parts[parts.length - 1][0]}.` : first;
  const staffSide = visibility === "internal" || visibility === "staff";
  if (minor && staffSide) return `${abbreviated} (M)`;
  return abbreviated;
}

/** Whitelist for the bio field. Free text here reaches the public player card. */
export function normalizeDominantHand(v) {
  if (v == null || v === "") return { ok: true, value: null };
  const s = String(v).trim().toLowerCase();
  if (DOMINANT_HANDS.includes(s)) return { ok: true, value: s };
  return { ok: false, error: `Dominant hand must be one of: ${DOMINANT_HANDS.join(", ")}.` };
}

/** Family display name from a guardian's name. "Reyes" → "Reyes Family". */
export function familyNameFor(guardianFullName) {
  const parts = String(guardianFullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Family";
  return `${parts[parts.length - 1]} Family`;
}

/* ==================== data access ==================== */

/** A contact plus the birthdate that lives on member_profiles. */
export async function contactWithDob(env, orgId, contactId) {
  if (!contactId) return null;
  return env.DB.prepare(
    `SELECT c.id, c.org_id, c.full_name, c.email, c.family_id,
            mp.date_of_birth, mp.dominant_hand
       FROM contacts c
       LEFT JOIN member_profiles mp ON mp.contact_id = c.id AND mp.deleted_at IS NULL
      WHERE c.id = ?1 AND c.org_id = ?2 AND c.deleted_at IS NULL`
  ).bind(contactId, orgId).first();
}

/** The live guardianship for a minor, if any. */
export async function guardianshipFor(env, orgId, minorContactId) {
  return env.DB.prepare(
    `SELECT g.*, c.full_name AS guardian_name, mp.date_of_birth AS guardian_dob
       FROM guardianships g
       JOIN contacts c ON c.id = g.guardian_contact_id AND c.deleted_at IS NULL
       LEFT JOIN member_profiles mp ON mp.contact_id = c.id AND mp.deleted_at IS NULL
      WHERE g.org_id = ?1 AND g.minor_contact_id = ?2
        AND g.status = 'active' AND g.deleted_at IS NULL
      ORDER BY g.id DESC LIMIT 1`
  ).bind(orgId, minorContactId).first();
}


/* ==================== guardian invitations (D-MIN-11) ==================== */

/**
 * Mint a single-use invitation for the adult who will claim a pending minor.
 *
 * Reuses the shape consent.js proved for waiver_sign tokens: 32 random bytes, only the SHA
 * stored, expiring, revoked on use. The raw token is returned ONCE and never persisted.
 *
 * Re-minting revokes any live invite for the same minor first. Migration 0025 backs that with a
 * partial unique index, so a race that slips past this still cannot leave two live invites.
 */
export async function mintGuardianInvite(env, orgId, minorContactId, label = null) {
  await env.DB.prepare(
    `UPDATE access_tokens SET revoked_at = datetime('now')
      WHERE org_id = ?1 AND kind = 'guardian_invite' AND contact_id = ?2
        AND revoked_at IS NULL AND deleted_at IS NULL`
  ).bind(orgId, minorContactId).run();

  const raw = randomToken();
  const expires = new Date(Date.now() + GUARDIAN_INVITE_TTL_DAYS * 86_400_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO access_tokens (org_id, kind, token_sha, contact_id, label, expires_at)
     VALUES (?1, 'guardian_invite', ?2, ?3, ?4, ?5)`
  ).bind(orgId, await sha256Hex(raw), minorContactId, label, expires).run();

  return { token: raw, expires_at: expires };
}

/**
 * Resolve an invite token to its pending minor. Fails closed on every unhappy path and returns
 * the SAME shape for "wrong token" and "expired token" reasons the caller can distinguish, but
 * never leaks whether a token merely expired versus never existed to an unauthenticated caller.
 */
export async function loadGuardianInvite(env, rawToken) {
  const raw = String(rawToken || "").trim();
  if (!/^[a-f0-9]{32,64}$/.test(raw)) return { ok: false, status: 404, error: "This invitation link isn't valid." };
  const row = await env.DB.prepare(
    `SELECT t.id, t.org_id, t.contact_id, t.expires_at, t.revoked_at, t.use_count,
            c.full_name, c.email, c.activation_state, mp.date_of_birth
       FROM access_tokens t
       JOIN contacts c ON c.id = t.contact_id AND c.deleted_at IS NULL
       LEFT JOIN member_profiles mp ON mp.contact_id = c.id AND mp.deleted_at IS NULL
      WHERE t.token_sha = ?1 AND t.kind = 'guardian_invite' AND t.deleted_at IS NULL`
  ).bind(await sha256Hex(raw)).first();

  if (!row) return { ok: false, status: 404, error: "This invitation link isn't valid." };
  if (row.revoked_at) return { ok: false, status: 410, error: "This invitation has already been used." };
  if (row.expires_at && row.expires_at < new Date().toISOString()) {
    return { ok: false, status: 410, error: "This invitation has expired. Ask for a new one.", expired: true };
  }
  return { ok: true, token_id: row.id, invite: row };
}

/** Burn the token. Same atomic single-shot UPDATE consent.js:284 uses — the WHERE clause is the lock. */
export async function consumeGuardianInvite(env, tokenId) {
  const res = await env.DB.prepare(
    `UPDATE access_tokens
        SET revoked_at = datetime('now'), use_count = use_count + 1, last_used_at = datetime('now')
      WHERE id = ?1 AND revoked_at IS NULL`
  ).bind(tokenId).run();
  return (res.meta && res.meta.changes) === 1;
}

/* ==================== routes ==================== */


export async function familyRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  const { json } = H;

  /* ---- v1.3 (v0.58.0, owner 2026-08-03): CONNECTED-ACCOUNTS OVERVIEW.
     `/api/family` answers "who is in my household". This answers "what do I have to deal with":
     one read covering every connected account — what is unpaid, what is coming up, what passes
     are left. A parent with three children currently has to open three profiles to discover they
     owe money on one of them. That is the problem this closes.

     Read-only and fully derived. It writes nothing and invents no state, so it cannot disagree
     with the screens it summarises. Pass balances are counted the same way passes.js counts them
     (live, unreversed redemptions) rather than kept as a second tally — F-26. ---- */
  if (p === "/api/family/overview" && m === "GET") {
    if (!ctx.session) return json({ error: "Sign in first." }, 401);
    const self = await H.contactForSession(env, ctx);
    if (!self) return json({ accounts: [], total_owed_cents: 0 });

    // Self + every active minor under this guardian. Deliberately NOT "everyone sharing a
    // family_id": guardianship is the relationship that grants visibility, and an adult who
    // merely shares a family row is not someone whose balance you may read.
    const minors = (await env.DB.prepare(
      `SELECT c.id, c.full_name FROM guardianships g
         JOIN contacts c ON c.id = g.minor_contact_id AND c.deleted_at IS NULL
        WHERE g.org_id=?1 AND g.guardian_contact_id=?2 AND g.status='active' AND g.deleted_at IS NULL`
    ).bind(ctx.orgId, self.id).all()).results || [];

    const people = [{ id: self.id, full_name: self.full_name, self: true },
                    ...minors.map((k) => ({ id: k.id, full_name: k.full_name, self: false }))];

    const accounts = [];
    for (const person of people) {
      const unpaid = (await env.DB.prepare(
        `SELECT r.id, r.status, r.price_cents, e.name AS event_name, e.starts_at
           FROM registrations r JOIN events e ON e.id = r.event_id AND e.org_id = r.org_id
          WHERE r.org_id=?1 AND r.contact_id=?2 AND r.deleted_at IS NULL
            AND r.status IN ('pending','email-sent','cash-pending')
          ORDER BY e.starts_at LIMIT 20`
      ).bind(ctx.orgId, person.id).all()).results || [];

      const upcoming = (await env.DB.prepare(
        `SELECT e.id, e.name, e.starts_at, r.status
           FROM registrations r JOIN events e ON e.id = r.event_id AND e.org_id = r.org_id
          WHERE r.org_id=?1 AND r.contact_id=?2 AND r.deleted_at IS NULL
            AND r.status != 'cancelled' AND e.starts_at >= datetime('now')
          ORDER BY e.starts_at LIMIT 10`
      ).bind(ctx.orgId, person.id).all()).results || [];

      const passes = (await env.DB.prepare(
        `SELECT p.id, p.name, p.total_sessions, p.expires_at,
                (SELECT COUNT(*) FROM pass_redemptions r
                  WHERE r.pass_id = p.id AND r.org_id = p.org_id
                    AND r.deleted_at IS NULL AND r.reversed_at IS NULL) AS used
           FROM passes p
          WHERE p.org_id=?1 AND p.contact_id=?2 AND p.deleted_at IS NULL
            AND (p.expires_at IS NULL OR p.expires_at > datetime('now'))
          ORDER BY p.expires_at LIMIT 10`
      ).bind(ctx.orgId, person.id).all()).results || [];

      accounts.push({
        contact_id: person.id,
        name: person.full_name,
        is_self: person.self,
        owes_cents: unpaid.reduce((n, r) => n + (Number(r.price_cents) || 0), 0),
        unpaid: unpaid.map((r) => ({ registration_id: r.id, event: r.event_name, starts_at: r.starts_at, status: r.status })),
        upcoming: upcoming.map((e) => ({ event_id: e.id, name: e.name, starts_at: e.starts_at, status: e.status })),
        passes: passes.map((q) => ({
          id: q.id, name: q.name, expires_at: q.expires_at,
          remaining: q.total_sessions === null ? null : Math.max(0, q.total_sessions - q.used),
        })),
      });
    }

    return json({ accounts, total_owed_cents: accounts.reduce((n, a) => n + a.owes_cents, 0) });
  }

  /* ---- pre-flight age check. The registration form calls this BEFORE writing anything. ---- */
  if (p === "/api/family/age-check" && m === "POST") {
    const b = await request.json().catch(() => ({}));
    const check = validateBirthdate(b.date_of_birth);
    if (!check.ok) return json({ error: check.error }, 400);
    return json({
      minor: check.minor, age: check.age,
      guardian_required: check.minor,
      message: check.minor
        ? "Under 18 — a parent or guardian signs and the profile is created under their family account."
        : null,
    });
  }

  /* ---- the caller's family ---- */
  if (p === "/api/family" && m === "GET") {
    if (!ctx.session) return json({ error: "Sign in first." }, 401);
    const self = await H.contactForSession(env, ctx);
    if (!self) return json({ family: null, members: [] });

    const kids = (await env.DB.prepare(
      `SELECT c.id, c.full_name, mp.date_of_birth, g.id AS guardianship_id,
              g.separation_choice, g.separated_at, g.aged_out_at
         FROM guardianships g
         JOIN contacts c ON c.id = g.minor_contact_id AND c.deleted_at IS NULL
         LEFT JOIN member_profiles mp ON mp.contact_id = c.id AND mp.deleted_at IS NULL
        WHERE g.org_id = ?1 AND g.guardian_contact_id = ?2
          AND g.status = 'active' AND g.deleted_at IS NULL
        ORDER BY mp.date_of_birth`
    ).bind(ctx.orgId, self.id).all()).results;

    const family = self.family_id
      ? await env.DB.prepare("SELECT id, name FROM families WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL")
          .bind(self.family_id, ctx.orgId).first()
      : null;

    return json({
      family,
      guardian: { contact_id: self.id, name: self.full_name },
      members: kids.map((k) => {
        const st = ageOutState({ dateOfBirth: k.date_of_birth, guardianship: k });
        return {
          contact_id: k.id,
          name: displayName(k.full_name, { minor: isMinor(k.date_of_birth), visibility: "internal" }),
          full_name: k.full_name,
          age: ageOn(k.date_of_birth),
          minor: isMinor(k.date_of_birth),
          guardianship_id: k.guardianship_id,
          ...st,
        };
      }),
    });
  }

  /* ---- D-MIN-10: record the keep-or-separate decision at 18.
     v1.2 — the SINGLE age-out endpoint (F-18/F-25). 'separated' also transfers the sign-in
     email and ends the guardianship, absorbing profiles.js's deleted /api/family/ageout. ---- */
  if (p === "/api/family/age-out" && m === "POST") {
    if (!ctx.session) return json({ error: "Sign in first." }, 401);
    const b = await request.json().catch(() => ({}));
    const v = validateAgeOutPayload(b);
    if (!v.ok) return json({ error: v.error }, v.status);
    const { gid, choice } = v;

    const self = await H.contactForSession(env, ctx);
    const staff = ctx.role === "staff" || ctx.role === "admin";
    // Either the guardian, the member themselves, or staff may record it. Nobody else.
    const g = await env.DB.prepare(
      `SELECT g.*, mp.date_of_birth
         FROM guardianships g
         LEFT JOIN member_profiles mp ON mp.contact_id = g.minor_contact_id AND mp.deleted_at IS NULL
        WHERE g.id = ?1 AND g.org_id = ?2 AND g.deleted_at IS NULL`
    ).bind(gid, ctx.orgId).first();
    if (!g) return json({ error: "Not found in this organization." }, 404);
    const mine = self && (self.id === g.guardian_contact_id || self.id === g.minor_contact_id);
    if (!mine && !staff) return json({ error: "Not found in this organization." }, 404);

    // Cannot age out someone who is still a minor.
    if (isMinor(g.date_of_birth)) {
      return json({ error: "This member is still under 18. The guardian stays responsible until their 18th birthday." }, 409);
    }

    // Idempotent: separation is one-way and already done. Never re-send the sign-in link.
    if (g.separation_choice === "separated") {
      return json({ ok: true, already: true, choice: "separated" });
    }

    const sep = choice === "separated";
    let emailTransferred = false;
    let targetEmail = null;

    if (sep) {
      // Everything that can refuse runs BEFORE the first write — F-5's lesson. A guardianship
      // ended with no reachable account behind it is the failure mode this ordering prevents.
      const contact = await env.DB.prepare(
        "SELECT id, email FROM contacts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
      ).bind(g.minor_contact_id, ctx.orgId).first();
      if (!contact) return json({ error: "Not found in this organization." }, 404);

      targetEmail = v.email || (contact.email || "").trim().toLowerCase() || null;
      if (!targetEmail) {
        return json({ error: "Enter their email address — it's how they'll sign in." }, 400);
      }
      if (targetEmail !== (contact.email || "").trim().toLowerCase()) {
        const clash = await env.DB.prepare(
          "SELECT id FROM contacts WHERE org_id=?1 AND email=?2 AND id != ?3 AND deleted_at IS NULL"
        ).bind(ctx.orgId, targetEmail, g.minor_contact_id).first();
        // Standards §8: no literal org email in member-facing copy (F-40's fix, not its fifth costume).
        if (clash) return json({ error: "That email is already on another account here. Ask the front desk and they'll sort it out." }, 409);
        await env.DB.prepare(
          "UPDATE contacts SET email=?1, updated_at=datetime('now') WHERE id=?2 AND org_id=?3"
        ).bind(targetEmail, g.minor_contact_id, ctx.orgId).run();
        emailTransferred = true;
      }
    }

    await env.DB.prepare(
      `UPDATE guardianships
          SET separation_choice = ?1,
              aged_out_at = COALESCE(aged_out_at, datetime('now')),
              separated_at = CASE WHEN ?2 = 1 THEN datetime('now') ELSE separated_at END,
              status      = CASE WHEN ?2 = 1 THEN 'ended' ELSE status END,
              ended_at    = CASE WHEN ?2 = 1 THEN datetime('now') ELSE ended_at END,
              end_reason  = CASE WHEN ?2 = 1 THEN 'aged_out' ELSE end_reason END,
              updated_at = datetime('now')
        WHERE id = ?3 AND org_id = ?4`
    ).bind(choice, sep ? 1 : 0, gid, ctx.orgId).run();

    let requirements = { resign: [], blocks_participation: false, note: "Nothing to re-sign." };
    if (sep) {
      const w = await env.DB.prepare(
        `SELECT 1 FROM waivers WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL
           AND expires_at > datetime('now') LIMIT 1`
      ).bind(ctx.orgId, g.minor_contact_id).first();
      requirements = separationRequirements({ hasLiveWaiver: !!w });
      // The member becomes their own account: drop the family link. The guardianship row stays
      // (status='ended') — history is ended, never deleted.
      await env.DB.prepare(
        "UPDATE contacts SET family_id = NULL, updated_at = datetime('now') WHERE id=?1 AND org_id=?2"
      ).bind(g.minor_contact_id, ctx.orgId).run();
      await H.sendLoginLink(env, targetEmail); // history rides on contact_id — nothing moves
    }

    await H.audit(env, ctx, "family.age_out", "guardianships", gid,
      { choice, minor_contact_id: g.minor_contact_id, resign: requirements.resign, email_transferred: emailTransferred });

    return json({ ok: true, choice, requirements,
      message: sep ? "Invitation sent. Their history goes with them." : "They'll stay on your family account. They can separate any time." });
  }

  /* ---- guardian invitation: read (public — the token IS the credential) ---- */
  if ((p.match(/^\/api\/guardian-invite\/[a-f0-9]{32,64}$/)) && m === "GET") {
    const res = await loadGuardianInvite(env, p.split("/").pop());
    if (!res.ok) return json({ error: res.error, expired: !!res.expired }, res.status);
    const inv = res.invite;
    // Deliberately narrow: enough for the adult to recognise the child, nothing more. No email,
    // no address, no other family members. An invite link is not an account.
    return json({
      ok: true,
      participant: {
        full_name: inv.full_name,
        age: ageOn(inv.date_of_birth),
        minor: isMinor(inv.date_of_birth),
        activation_state: inv.activation_state,
      },
      certification_text: GUARDIAN_CERTIFICATION_TEXT,
      already_active: inv.activation_state === "active",
    });
  }

  /* ---- guardian invitation: claim + certify ---- */
  if ((p.match(/^\/api\/guardian-invite\/[a-f0-9]{32,64}\/claim$/)) && m === "POST") {
    if (!ctx.session) return json({ error: "Create your own account or sign in first, then open this link again." }, 401);

    const token = p.split("/")[3];
    const b = await request.json().catch(() => ({}));
    const typedName = String(b.certified_name || "").trim().slice(0, 120);
    const guardianDob = String(b.guardian_date_of_birth || "").trim();

    if (b.certified !== true) return json({ error: "Tick the confirmation box to continue." }, 400);
    if (!typedName || typedName.split(/\s+/).length < 2) return json({ error: "Type your full legal name." }, 400);

    const res = await loadGuardianInvite(env, token);
    if (!res.ok) return json({ error: res.error, expired: !!res.expired }, res.status);
    const inv = res.invite;

    const self = await H.contactForSession(env, ctx);
    if (!self) return json({ error: "Your account has no contact record in this organization yet." }, 409);
    if (self.id === inv.contact_id) return json({ error: "A participant can't be their own guardian." }, 409);
    if (inv.org_id !== ctx.orgId) return json({ error: "This invitation isn't valid here." }, 404);

    // The guardian's own date of birth. Accept it here if it is missing, because D-MIN-11 says a
    // blank DOB is a thing to collect, not a wall to hit.
    let dob = self.date_of_birth || null;
    if (!dob && guardianDob) {
      const vb = validateBirthdate(guardianDob);
      if (!vb.ok) return json({ error: vb.error }, 400);
      await env.DB.prepare(
        `INSERT INTO member_profiles (org_id, contact_id, date_of_birth, visibility)
         VALUES (?1, ?2, ?3, 'members')
         ON CONFLICT(org_id, contact_id) DO UPDATE SET date_of_birth = excluded.date_of_birth,
                                                       updated_at = datetime('now')`
      ).bind(ctx.orgId, self.id, guardianDob).run();
      dob = guardianDob;
    }
    if (!dob) return json({ error: "Enter your own date of birth to continue.", need_guardian_dob: true }, 400);

    // ONE age rule for the whole platform. guardianGate already refuses a guardian who is not a
    // recorded adult; this is the call site it has been missing since v0.27.0 (F-6, F-17).
    const gate = guardianGate({
      dateOfBirth: inv.date_of_birth,
      guardian: { id: self.id, date_of_birth: dob },
    });
    if (!gate.ok) return json({ error: gate.error, reason: gate.reason }, gate.status);

    // Burn the token BEFORE writing. If two tabs race, exactly one wins the UPDATE.
    if (!(await consumeGuardianInvite(env, res.token_id))) {
      return json({ error: "This invitation has already been used." }, 410);
    }

    const sha = await sha256Hex(GUARDIAN_CERTIFICATION_TEXT);
    await env.DB.prepare(
      `INSERT INTO guardianships
         (org_id, guardian_contact_id, minor_contact_id,
          certified_by_contact_id, certified_at, certified_name, certification_sha)
       VALUES (?1, ?2, ?3, ?2, datetime('now'), ?4, ?5)
       ON CONFLICT(org_id, guardian_contact_id, minor_contact_id) DO UPDATE SET
          status = 'active', deleted_at = NULL,
          certified_by_contact_id = excluded.certified_by_contact_id,
          certified_at = excluded.certified_at,
          certified_name = excluded.certified_name,
          certification_sha = excluded.certification_sha,
          updated_at = datetime('now')`
    ).bind(ctx.orgId, self.id, inv.contact_id, typedName, sha).run();

    // Family: reuse the guardian's if they have one, otherwise create it. familyNameFor already
    // owns the naming so two callers cannot drift apart on it.
    let familyId = self.family_id || null;
    if (!familyId) {
      const f = await env.DB.prepare(
        "INSERT INTO families (org_id, name, primary_contact_id) VALUES (?1, ?2, ?3)"
      ).bind(ctx.orgId, familyNameFor(self.full_name), self.id).run();
      familyId = f.meta.last_row_id;
      await env.DB.prepare("UPDATE contacts SET family_id=?1, updated_at=datetime('now') WHERE id=?2")
        .bind(familyId, self.id).run();
    }

    // D-MIN-9 satisfied: an adult account exists and is linked, so the minor activates.
    await env.DB.prepare(
      `UPDATE contacts SET activation_state = 'active', family_id = ?1, updated_at = datetime('now')
        WHERE id = ?2 AND org_id = ?3`
    ).bind(familyId, inv.contact_id, ctx.orgId).run();

    await H.audit(env, ctx, "family.guardian_certified", "contacts", inv.contact_id, {
      guardian_contact_id: self.id, certified_name: typedName, certification_sha: sha,
    });

    return json({
      ok: true,
      participant: { contact_id: inv.contact_id, full_name: inv.full_name },
      family_id: familyId,
      message: "Account confirmed. The participant can be registered now.",
    });
  }

  return null;
}
