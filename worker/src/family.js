/**
 * Boomtown Platform — Families, guardians and minors
 * File: worker/src/family.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.27.0
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

let H = null; // wired: { json, audit, requireStaff, contactForSession }
export function wireFamily(helpers) { H = helpers; }

/** Age of majority. A named constant because it appears in several gates and one day may vary. */
export const AGE_OF_MAJORITY = 18;

export const DOMINANT_HANDS = ["left", "right", "ambidextrous"];

export const SEPARATION_CHOICES = ["kept", "separated"];

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
      error: "This participant is under 18. A parent or guardian has to create or sign in to their own account first — they sign the waiver and the child's profile is created under their family.",
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

/* ==================== routes ==================== */

export async function familyRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  const { json } = H;

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

  /* ---- record the keep-or-separate decision at 18 ---- */
  if (p === "/api/family/age-out" && m === "POST") {
    if (!ctx.session) return json({ error: "Sign in first." }, 401);
    const b = await request.json().catch(() => ({}));
    const gid = Number(b.guardianship_id);
    const choice = String(b.choice || "");
    if (!gid) return json({ error: "guardianship_id is required." }, 400);
    if (!SEPARATION_CHOICES.includes(choice)) {
      return json({ error: `choice must be one of: ${SEPARATION_CHOICES.join(", ")}.` }, 400);
    }

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

    const sep = choice === "separated";
    await env.DB.prepare(
      `UPDATE guardianships
          SET separation_choice = ?1,
              aged_out_at = COALESCE(aged_out_at, datetime('now')),
              separated_at = CASE WHEN ?2 = 1 THEN datetime('now') ELSE separated_at END,
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
      // The member becomes their own account: drop the family link, keep the guardianship row.
      await env.DB.prepare(
        "UPDATE contacts SET family_id = NULL, updated_at = datetime('now') WHERE id=?1 AND org_id=?2"
      ).bind(g.minor_contact_id, ctx.orgId).run();
    }

    await H.audit(env, ctx, "family.age_out", "guardianships", gid,
      { choice, minor_contact_id: g.minor_contact_id, resign: requirements.resign });

    return json({ ok: true, choice, requirements });
  }

  return null;
}
