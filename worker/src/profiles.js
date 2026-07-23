/**
 * Boomtown Platform — Member Profiles + Family Accounts module
 * File: worker/src/profiles.js · Version: v1.0 · Date: 2026-07-22 · Ships in: v0.5.0
 *
 * Member-facing (magic-link session):
 *   GET  /api/profile/me                       → own contact + profile + family summary
 *   POST /api/profile/update                   → bio / instagram / visibility / DOB (self or own child)
 *   POST /api/profile/avatar?contact_id=       → avatar upload to R2 (raw image body, ≤5 MB)
 *   POST /api/profile/reminders                → { contact_id?, opt_in } email reminder toggle
 *   GET  /api/profile/resume?contact_id=       → results résumé from standings history
 *   GET  /api/profile/upcoming                 → self + children upcoming registered events
 * Family:
 *   GET  /api/family                           → active children + waiver status
 *   POST /api/family/add-child                 → { full_name, date_of_birth }
 *   POST /api/family/sign-waiver               → { minor_contact_id, signed_name } guardian signs
 *   POST /api/family/remove-child              → { minor_contact_id }
 *   POST /api/family/ageout                    → { minor_contact_id, email } 18+ handover
 * Public:
 *   GET  /api/public/profile?contact_id=       → visibility-gated profile card + résumé
 *   GET  /api/avatar/<key>                     → avatar image from R2 (immutable cache)
 *   GET  /api/events/ics?event_id=             → .ics calendar file (America/Denver)
 * Staff:
 *   POST /api/seeding/recompute                → { season } materialize season_points from standings
 *   GET  /api/seeding?season=                  → ranked seeding list
 *
 * Rules baked in:
 *   - A member edits only their own profile or an active-guardianship child's.
 *   - Minors: visibility defaults to 'private', instagram hidden; parents sign everything
 *     (waivers row so registrations keep working + signatures ledger row with on_behalf=1).
 *   - Standings remain the ONLY score source; résumé and seeding are read-only derivations.
 *   - Adult signatures also land in the signatures ledger (Module 6 contracts reuse it).
 *   - Points formula (documented for the owner): each event = wins × 10, plus placement
 *     bonus 1st +50 · 2nd +30 · 3rd +20. Tunable later in one place: eventPoints().
 */

let H = null; // wired: { json, audit, isStaff, requireStaff, sendLoginLink }
export function wireProfiles(helpers) { H = helpers; }

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const BIO_MAX = 280;

export async function profileRoutes(request, env, url, ctx) {
  const p = url.pathname;

  if (p.startsWith("/api/avatar/") && request.method === "GET") return serveAvatar(env, p);
  if (p === "/api/events/ics" && request.method === "GET") return eventIcs(env, url);
  if (p === "/api/public/profile" && request.method === "GET") return publicProfile(env, url, ctx);

  if (p === "/api/profile/me" && request.method === "GET") return me(env, ctx);
  if (p === "/api/profile/update" && request.method === "POST") return update(request, env, ctx);
  if (p === "/api/profile/avatar" && request.method === "POST") return avatarUpload(request, env, url, ctx);
  if (p === "/api/profile/reminders" && request.method === "POST") return reminders(request, env, ctx);
  if (p === "/api/profile/resume" && request.method === "GET") return resume(env, url, ctx);
  if (p === "/api/profile/upcoming" && request.method === "GET") return upcoming(env, ctx);

  if (p === "/api/family" && request.method === "GET") return familyList(env, ctx);
  if (p === "/api/family/add-child" && request.method === "POST") return addChild(request, env, ctx);
  if (p === "/api/family/sign-waiver" && request.method === "POST") return signWaiver(request, env, ctx);
  if (p === "/api/family/remove-child" && request.method === "POST") return removeChild(request, env, ctx);
  if (p === "/api/family/ageout" && request.method === "POST") return ageOut(request, env, ctx);

  if (p === "/api/seeding/recompute" && request.method === "POST") return seedingRecompute(request, env, ctx);
  if (p === "/api/seeding" && request.method === "GET") return seedingList(env, url, ctx);

  return null;
}

/* ---------- identity: session user ↔ contact ---------- */

async function ownContact(env, ctx, createIfMissing = true) {
  if (!ctx.session) return null;
  const user = await env.DB.prepare(
    "SELECT id, email, display_name FROM users WHERE id=?1 AND deleted_at IS NULL"
  ).bind(ctx.userId).first();
  if (!user) return null;

  let contact = await env.DB.prepare(
    "SELECT * FROM contacts WHERE org_id=?1 AND deleted_at IS NULL AND (user_id=?2 OR email=?3) ORDER BY user_id DESC LIMIT 1"
  ).bind(ctx.orgId, user.id, user.email).first();

  if (contact && !contact.user_id) {
    await env.DB.prepare("UPDATE contacts SET user_id=?1, updated_at=datetime('now') WHERE id=?2")
      .bind(user.id, contact.id).run();
    contact.user_id = user.id;
  }
  if (!contact && createIfMissing) {
    const ins = await env.DB.prepare(
      "INSERT INTO contacts (org_id, user_id, email, full_name) VALUES (?1, ?2, ?3, ?4)"
    ).bind(ctx.orgId, user.id, user.email, user.display_name || null).run();
    contact = await env.DB.prepare("SELECT * FROM contacts WHERE id=?1").bind(ins.meta.last_row_id).first();
  }
  return contact;
}

/** contact ids the caller may manage: self + active-guardianship children. */
async function managedContactIds(env, ctx) {
  const self = await ownContact(env, ctx);
  if (!self) return { self: null, ids: [] };
  const kids = (await env.DB.prepare(
    "SELECT minor_contact_id FROM guardianships WHERE org_id=?1 AND guardian_contact_id=?2 AND status='active' AND deleted_at IS NULL"
  ).bind(ctx.orgId, self.id).all()).results.map((r) => r.minor_contact_id);
  return { self, ids: [self.id, ...kids] };
}

async function getOrCreateProfile(env, orgId, contactId) {
  let prof = await env.DB.prepare(
    "SELECT * FROM member_profiles WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
  ).bind(orgId, contactId).first();
  if (!prof) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO member_profiles (org_id, contact_id) VALUES (?1, ?2)"
    ).bind(orgId, contactId).run();
    prof = await env.DB.prepare(
      "SELECT * FROM member_profiles WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
    ).bind(orgId, contactId).first();
  }
  return prof;
}

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00");
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/* ---------- profile ---------- */

async function me(env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const contact = await ownContact(env, ctx);
  const profile = await getOrCreateProfile(env, ctx.orgId, contact.id);
  const waiver = await validWaiver(env, ctx.orgId, contact.id);
  const family = await familyRows(env, ctx.orgId, contact.id);
  return H.json({
    contact: publicContactFields(contact, true),
    profile: profileFields(profile),
    waiver_ok: !!waiver,
    family,
  });
}

async function update(request, env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const body = await safeJson(request);
  const { self, ids } = await managedContactIds(env, ctx);
  const targetId = Number(body.contact_id) || self.id;
  if (!ids.includes(targetId)) return H.json({ error: "You can only edit your own profile or your children's." }, 403);

  const prof = await getOrCreateProfile(env, ctx.orgId, targetId);
  const isChild = targetId !== self.id;

  const fields = {};
  if (typeof body.bio === "string") fields.bio = body.bio.slice(0, BIO_MAX);
  if (typeof body.instagram_handle === "string") {
    const h = body.instagram_handle.replace(/^@+/, "").trim();
    if (h && !/^[A-Za-z0-9._]{1,30}$/.test(h)) return H.json({ error: "That Instagram handle doesn't look right. Letters, numbers, dots and underscores only." }, 400);
    fields.instagram_handle = h || null;
  }
  if (["public", "members", "private"].includes(body.visibility)) fields.visibility = body.visibility;
  if (body.show_history === 0 || body.show_history === 1) fields.show_history = body.show_history;
  if (body.show_instagram === 0 || body.show_instagram === 1) fields.show_instagram = body.show_instagram;
  if (typeof body.date_of_birth === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date_of_birth)) {
    fields.date_of_birth = body.date_of_birth;
  }
  if (typeof body.full_name === "string" && body.full_name.trim() && !isChild) {
    await env.DB.prepare("UPDATE contacts SET full_name=?1, updated_at=datetime('now') WHERE id=?2")
      .bind(body.full_name.trim().slice(0, 120), targetId).run();
  }

  // Minors stay conservative: no public visibility for under-18s.
  const dob = fields.date_of_birth || prof.date_of_birth;
  const age = ageFromDob(dob);
  if (age !== null && age < 18 && fields.visibility === "public") fields.visibility = "members";

  const keys = Object.keys(fields);
  if (keys.length) {
    const sets = keys.map((k, i) => `${k}=?${i + 1}`).join(", ");
    const vals = keys.map((k) => fields[k]);
    await env.DB.prepare(
      `UPDATE member_profiles SET ${sets}, updated_at=datetime('now') WHERE id=?${keys.length + 1}`
    ).bind(...vals, prof.id).run();
  }
  await H.audit(env, ctx, "profile.update", "member_profiles", prof.id, { fields: keys, for_child: isChild });
  const fresh = await env.DB.prepare("SELECT * FROM member_profiles WHERE id=?1").bind(prof.id).first();
  return H.json({ ok: true, profile: profileFields(fresh) });
}

async function avatarUpload(request, env, url, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  if (!env.AVATARS) return H.json({ error: "Photo storage isn't set up yet. Email admin@boomtownvb.com." }, 503);

  const { self, ids } = await managedContactIds(env, ctx);
  const targetId = Number(url.searchParams.get("contact_id")) || self.id;
  if (!ids.includes(targetId)) return H.json({ error: "You can only edit your own profile or your children's." }, 403);

  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim();
  const ext = AVATAR_TYPES[type];
  if (!ext) return H.json({ error: "We can't read that file type. JPG or PNG works best." }, 415);
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > AVATAR_MAX_BYTES) return H.json({ error: "That photo is too large (5 MB max)." }, 413);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return H.json({ error: "That upload was empty. Try again." }, 400);
  if (body.byteLength > AVATAR_MAX_BYTES) return H.json({ error: "That photo is too large (5 MB max)." }, 413);

  const prof = await getOrCreateProfile(env, ctx.orgId, targetId);
  const key = `avatars/${ctx.orgId}/${targetId}/${Date.now()}.${ext}`;
  await env.AVATARS.put(key, body, { httpMetadata: { contentType: type } });
  if (prof.avatar_r2_key) { try { await env.AVATARS.delete(prof.avatar_r2_key); } catch {} }
  await env.DB.prepare(
    "UPDATE member_profiles SET avatar_r2_key=?1, updated_at=datetime('now') WHERE id=?2"
  ).bind(key, prof.id).run();
  await H.audit(env, ctx, "profile.avatar", "member_profiles", prof.id, { bytes: body.byteLength });
  return H.json({ ok: true, avatar_url: `/api/avatar/${key}` });
}

async function serveAvatar(env, pathname) {
  if (!env.AVATARS) return new Response("Not found", { status: 404 });
  const key = pathname.slice("/api/avatar/".length);
  if (!/^avatars\/\d+\/\d+\/\d+\.(jpg|png|webp)$/.test(key)) return new Response("Not found", { status: 404 });
  const obj = await env.AVATARS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

async function reminders(request, env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const body = await safeJson(request);
  const { self, ids } = await managedContactIds(env, ctx);
  const targetId = Number(body.contact_id) || self.id;
  if (!ids.includes(targetId)) return H.json({ error: "You can only edit your own profile or your children's." }, 403);
  const optIn = body.opt_in ? 1 : 0;
  const prof = await getOrCreateProfile(env, ctx.orgId, targetId);
  await env.DB.prepare(
    "UPDATE member_profiles SET reminder_opt_in=?1, reminder_opt_in_at=CASE WHEN ?1=1 THEN datetime('now') ELSE reminder_opt_in_at END, updated_at=datetime('now') WHERE id=?2"
  ).bind(optIn, prof.id).run();
  await H.audit(env, ctx, optIn ? "reminders.opt_in" : "reminders.opt_out", "member_profiles", prof.id, {});
  return H.json({ ok: true, reminder_opt_in: optIn });
}

/* ---------- résumé + upcoming ---------- */

function eventPoints(wins, rank) {
  let pts = (wins || 0) * 10;
  if (rank === 1) pts += 50;
  else if (rank === 2) pts += 30;
  else if (rank === 3) pts += 20;
  return pts;
}

async function resumeRows(env, orgId, contactId) {
  const rows = (await env.DB.prepare(
    `SELECT e.id AS event_id, e.name, e.starts_at, t.name AS team_name,
            s.wins, s.losses, s.point_diff, s.rank,
            (SELECT COUNT(*) FROM standings s2 WHERE s2.event_id=e.id AND s2.deleted_at IS NULL) AS teams_in_event
     FROM team_members tm
     JOIN teams t   ON t.id = tm.team_id AND t.deleted_at IS NULL
     JOIN standings s ON s.event_id = t.event_id AND s.team_id = t.id AND s.deleted_at IS NULL
     JOIN events e  ON e.id = t.event_id AND e.deleted_at IS NULL
     WHERE tm.contact_id = ?1 AND tm.deleted_at IS NULL AND e.org_id = ?2
     ORDER BY e.starts_at DESC`
  ).bind(contactId, orgId).all()).results;
  return rows.map((r) => ({ ...r, points: eventPoints(r.wins, r.rank) }));
}

async function resume(env, url, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const { self, ids } = await managedContactIds(env, ctx);
  const targetId = Number(url.searchParams.get("contact_id")) || self.id;
  if (!ids.includes(targetId) && !(await H.isStaff(env, ctx))) {
    return H.json({ error: "You can only view your own results or your children's." }, 403);
  }
  const rows = await resumeRows(env, ctx.orgId, targetId);
  return H.json({ results: rows, totals: totals(rows) });
}

function totals(rows) {
  const t = { events: rows.length, wins: 0, losses: 0, points: 0, best_finish: null };
  for (const r of rows) {
    t.wins += r.wins || 0; t.losses += r.losses || 0; t.points += r.points;
    if (r.rank && (t.best_finish === null || r.rank < t.best_finish)) t.best_finish = r.rank;
  }
  return t;
}

async function upcoming(env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const { ids } = await managedContactIds(env, ctx);
  const marks = ids.map((_, i) => `?${i + 2}`).join(",");
  const rows = (await env.DB.prepare(
    `SELECT r.contact_id, c.full_name, e.id AS event_id, e.name, e.type, e.starts_at, e.location, r.status
     FROM registrations r
     JOIN events e ON e.id = r.event_id AND e.deleted_at IS NULL
     JOIN contacts c ON c.id = r.contact_id
     WHERE r.org_id = ?1 AND r.deleted_at IS NULL AND r.status != 'cancelled'
       AND r.contact_id IN (${marks})
       AND e.status IN ('published','in_progress')
       AND (e.starts_at IS NULL OR e.starts_at >= datetime('now','-12 hours'))
     ORDER BY e.starts_at ASC`
  ).bind(ctx.orgId, ...ids).all()).results;
  return H.json({ upcoming: rows });
}

/* ---------- public profile ---------- */

function displayName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "Boomtown member";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

function publicContactFields(c, self = false) {
  const out = { id: c.id, display_name: displayName(c.full_name) };
  if (self) { out.full_name = c.full_name; out.email = c.email; }
  return out;
}

function profileFields(p) {
  if (!p) return null;
  return {
    contact_id: p.contact_id,
    avatar_url: p.avatar_r2_key ? `/api/avatar/${p.avatar_r2_key}` : null,
    instagram_handle: p.instagram_handle,
    bio: p.bio,
    date_of_birth: p.date_of_birth,
    visibility: p.visibility,
    show_history: p.show_history,
    show_instagram: p.show_instagram,
    reminder_opt_in: p.reminder_opt_in,
  };
}

async function publicProfile(env, url, ctx) {
  const contactId = Number(url.searchParams.get("contact_id"));
  if (!contactId) return H.json({ error: "Not found" }, 404);
  const prof = await env.DB.prepare(
    "SELECT * FROM member_profiles WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
  ).bind(ctx.orgId, contactId).first();
  const contact = await env.DB.prepare(
    "SELECT * FROM contacts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(contactId, ctx.orgId).first();
  if (!prof || !contact) return H.json({ error: "Not found" }, 404);

  const isSelfOrChild = ctx.session ? (await managedContactIds(env, ctx)).ids.includes(contactId) : false;
  const staff = ctx.session ? await H.isStaff(env, ctx) : false;
  const vis = prof.visibility;
  const allowed = isSelfOrChild || staff ||
    (vis === "public") || (vis === "members" && !!ctx.session);
  if (!allowed) return H.json({ error: "Not found" }, 404);

  const out = {
    contact: publicContactFields(contact),
    avatar_url: prof.avatar_r2_key ? `/api/avatar/${prof.avatar_r2_key}` : null,
    bio: prof.bio,
    instagram_handle: prof.show_instagram ? prof.instagram_handle : null,
  };
  if (prof.show_history) {
    const rows = await resumeRows(env, ctx.orgId, contactId);
    out.results = rows; out.totals = totals(rows);
  }
  return H.json(out);
}

/* ---------- family ---------- */

async function familyRows(env, orgId, guardianContactId) {
  const rows = (await env.DB.prepare(
    `SELECT g.id AS guardianship_id, g.minor_contact_id, g.status, c.full_name,
            p.date_of_birth, p.avatar_r2_key, p.reminder_opt_in
     FROM guardianships g
     JOIN contacts c ON c.id = g.minor_contact_id AND c.deleted_at IS NULL
     LEFT JOIN member_profiles p ON p.contact_id = g.minor_contact_id AND p.org_id = g.org_id AND p.deleted_at IS NULL
     WHERE g.org_id = ?1 AND g.guardian_contact_id = ?2 AND g.status = 'active' AND g.deleted_at IS NULL
     ORDER BY g.created_at`
  ).bind(orgId, guardianContactId).all()).results;

  const out = [];
  for (const r of rows) {
    const waiver = await validWaiver(env, orgId, r.minor_contact_id);
    const age = ageFromDob(r.date_of_birth);
    out.push({
      contact_id: r.minor_contact_id,
      full_name: r.full_name,
      display_name: displayName(r.full_name),
      age,
      turns_18_soon: age !== null && age === 17 && monthsUntil18(r.date_of_birth) <= 2,
      is_adult: age !== null && age >= 18,
      avatar_url: r.avatar_r2_key ? `/api/avatar/${r.avatar_r2_key}` : null,
      waiver_ok: !!waiver,
      reminder_opt_in: r.reminder_opt_in || 0,
    });
  }
  return out;
}

function monthsUntil18(dob) {
  const d = new Date(dob + "T00:00:00");
  const eighteenth = new Date(d.getFullYear() + 18, d.getMonth(), d.getDate());
  return (eighteenth - new Date()) / (1000 * 60 * 60 * 24 * 30.44);
}

async function validWaiver(env, orgId, contactId) {
  return env.DB.prepare(
    "SELECT id, signed_at, expires_at FROM waivers WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1"
  ).bind(orgId, contactId).first();
}

async function familyList(env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const self = await ownContact(env, ctx);
  return H.json({ family: await familyRows(env, ctx.orgId, self.id) });
}

async function addChild(request, env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const body = await safeJson(request);
  const name = (body.full_name || "").trim().slice(0, 120);
  const dob = body.date_of_birth;
  if (!name || name.split(/\s+/).length < 2) return H.json({ error: "Enter your child's first and last name." }, 400);
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return H.json({ error: "Enter their date of birth." }, 400);
  const age = ageFromDob(dob);
  if (age === null || age < 0 || age > 25) return H.json({ error: "That date of birth doesn't look right." }, 400);
  if (age >= 18) return H.json({ error: "They're 18 or older — they can create their own account with their email instead." }, 400);

  const self = await ownContact(env, ctx);
  const ins = await env.DB.prepare(
    "INSERT INTO contacts (org_id, full_name) VALUES (?1, ?2)"
  ).bind(ctx.orgId, name).run();
  const childId = ins.meta.last_row_id;
  await env.DB.prepare(
    "INSERT INTO member_profiles (org_id, contact_id, date_of_birth, visibility, show_instagram) VALUES (?1, ?2, ?3, 'private', 0)"
  ).bind(ctx.orgId, childId, dob).run();
  await env.DB.prepare(
    "INSERT INTO guardianships (org_id, guardian_contact_id, minor_contact_id) VALUES (?1, ?2, ?3)"
  ).bind(ctx.orgId, self.id, childId).run();
  await H.audit(env, ctx, "family.add_child", "guardianships", childId, { guardian: self.id });
  return H.json({ ok: true, contact_id: childId, display_name: displayName(name) });
}

async function guardianshipOf(env, ctx, minorContactId) {
  const self = await ownContact(env, ctx);
  if (!self) return null;
  const g = await env.DB.prepare(
    "SELECT * FROM guardianships WHERE org_id=?1 AND guardian_contact_id=?2 AND minor_contact_id=?3 AND status='active' AND deleted_at IS NULL"
  ).bind(ctx.orgId, self.id, minorContactId).first();
  return g ? { self, g } : null;
}

async function signWaiver(request, env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const body = await safeJson(request);
  const minorId = Number(body.minor_contact_id);
  const signedName = (body.signed_name || "").trim().slice(0, 120);
  if (!signedName || signedName.split(/\s+/).length < 2) return H.json({ error: "Type your full legal name." }, 400);

  const link = await guardianshipOf(env, ctx, minorId);
  if (!link) return H.json({ error: "This child isn't in your family." }, 403);

  const prof = await getOrCreateProfile(env, ctx.orgId, minorId);
  const age = ageFromDob(prof.date_of_birth);
  const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();

  const w = await env.DB.prepare(
    "INSERT INTO waivers (org_id, contact_id, waiver_text_version, signed_at, expires_at, signature_name) VALUES (?1, ?2, 'v1-PLACEHOLDER', datetime('now'), ?3, ?4)"
  ).bind(ctx.orgId, minorId, expires, signedName).run();
  await env.DB.prepare(
    `INSERT INTO signatures (org_id, subject_contact_id, signer_contact_id, on_behalf, minor_age_at_signing,
       document_type, document_ref, signed_name, ip, user_agent)
     VALUES (?1, ?2, ?3, 1, ?4, 'waiver', ?5, ?6, ?7, ?8)`
  ).bind(
    ctx.orgId, minorId, link.self.id, age,
    "waiver:v1-PLACEHOLDER", signedName,
    request.headers.get("CF-Connecting-IP") || null,
    (request.headers.get("User-Agent") || "").slice(0, 200)
  ).run();
  await H.audit(env, ctx, "family.sign_waiver", "waivers", w.meta.last_row_id, { minor: minorId, on_behalf: true });
  return H.json({ ok: true, waiver_ok: true, signed_by: signedName });
}

async function removeChild(request, env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const body = await safeJson(request);
  const link = await guardianshipOf(env, ctx, Number(body.minor_contact_id));
  if (!link) return H.json({ error: "This child isn't in your family." }, 403);
  await env.DB.prepare(
    "UPDATE guardianships SET status='ended', ended_at=datetime('now'), end_reason='removed_by_guardian', updated_at=datetime('now') WHERE id=?1"
  ).bind(link.g.id).run();
  await H.audit(env, ctx, "family.remove_child", "guardianships", link.g.id, {});
  return H.json({ ok: true });
}

async function ageOut(request, env, ctx) {
  if (!ctx.session) return H.json({ error: "Sign in first." }, 401);
  const body = await safeJson(request);
  const minorId = Number(body.minor_contact_id);
  const email = (body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return H.json({ error: "Enter a valid email address." }, 400);

  const link = await guardianshipOf(env, ctx, minorId);
  if (!link) return H.json({ error: "This person isn't in your family." }, 403);

  const prof = await getOrCreateProfile(env, ctx.orgId, minorId);
  const age = ageFromDob(prof.date_of_birth);
  if (age === null || age < 18) return H.json({ error: "This works on their 18th birthday — not before." }, 400);

  const clash = await env.DB.prepare(
    "SELECT id FROM contacts WHERE org_id=?1 AND email=?2 AND id != ?3 AND deleted_at IS NULL"
  ).bind(ctx.orgId, email, minorId).first();
  if (clash) return H.json({ error: "That email is already on another account. Email admin@boomtownvb.com and we'll sort it out." }, 409);

  await env.DB.prepare("UPDATE contacts SET email=?1, updated_at=datetime('now') WHERE id=?2").bind(email, minorId).run();
  await env.DB.prepare(
    "UPDATE guardianships SET status='ended', ended_at=datetime('now'), end_reason='aged_out', updated_at=datetime('now') WHERE id=?1"
  ).bind(link.g.id).run();
  await H.sendLoginLink(env, email); // their playing history rides on contact_id — nothing moves
  await H.audit(env, ctx, "family.ageout", "guardianships", link.g.id, { minor: minorId });
  return H.json({ ok: true, message: "Invitation sent. Their history goes with them." });
}

/* ---------- ICS ---------- */

async function eventIcs(env, url) {
  const eventId = Number(url.searchParams.get("event_id"));
  if (!eventId) return new Response("Not found", { status: 404 });
  const e = await env.DB.prepare(
    "SELECT id, name, starts_at, ends_at, location, status FROM events WHERE id=?1 AND deleted_at IS NULL AND status IN ('published','in_progress')"
  ).bind(eventId).first();
  if (!e || !e.starts_at) return new Response("Not found", { status: 404 });

  const dt = (s) => s.replace(/[-:]/g, "").replace(/\.\d+/, "").slice(0, 15);
  const start = dt(e.starts_at);
  const end = e.ends_at ? dt(e.ends_at) : dt(new Date(new Date(e.starts_at).getTime() + 2 * 3600_000).toISOString().slice(0, 19));
  const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Boomtown Athletics//btplatform//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", "TZID:America/Denver",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0700", "TZOFFSETTO:-0600", "TZNAME:MDT",
    "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:-0600", "TZOFFSETTO:-0700", "TZNAME:MST",
    "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:event-${e.id}@boomtownvb.com`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`,
    `DTSTART;TZID=America/Denver:${start}`,
    `DTEND;TZID=America/Denver:${end}`,
    `SUMMARY:${esc(e.name)}`,
    e.location ? `LOCATION:${esc(e.location)}` : null,
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="boomtown-event-${e.id}.ics"`,
    },
  });
}

/* ---------- seeding (staff) ---------- */

async function seedingRecompute(request, env, ctx) {
  const gate = await H.requireStaff(env, ctx);
  if (gate) return gate;
  const body = await safeJson(request);
  const season = String(body.season || new Date().getFullYear());
  if (!/^\d{4}$/.test(season)) return H.json({ error: "Season should be a year, like 2026." }, 400);

  const rows = (await env.DB.prepare(
    `SELECT tm.contact_id, e.id AS event_id, s.wins, s.losses, s.rank
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
     JOIN standings s ON s.event_id = t.event_id AND s.team_id = t.id AND s.deleted_at IS NULL
     JOIN events e ON e.id = t.event_id AND e.deleted_at IS NULL
     WHERE e.org_id = ?1 AND tm.contact_id IS NOT NULL AND tm.deleted_at IS NULL
       AND strftime('%Y', e.starts_at) = ?2 AND e.status IN ('in_progress','completed')`
  ).bind(ctx.orgId, season).all()).results;

  const byContact = new Map();
  for (const r of rows) {
    const c = byContact.get(r.contact_id) || { events: new Set(), wins: 0, losses: 0, points: 0, best: null };
    c.events.add(r.event_id);
    c.wins += r.wins || 0; c.losses += r.losses || 0;
    c.points += eventPoints(r.wins, r.rank);
    if (r.rank && (c.best === null || r.rank < c.best)) c.best = r.rank;
    byContact.set(r.contact_id, c);
  }

  await env.DB.prepare("DELETE FROM season_points WHERE org_id=?1 AND season=?2").bind(ctx.orgId, season).run();
  for (const [contactId, c] of byContact) {
    await env.DB.prepare(
      "INSERT INTO season_points (org_id, season, contact_id, events_played, wins, losses, points, best_finish) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
    ).bind(ctx.orgId, season, contactId, c.events.size, c.wins, c.losses, c.points, c.best).run();
  }
  await H.audit(env, ctx, "seeding.recompute", "season_points", season, { players: byContact.size });
  return H.json({ ok: true, season, players: byContact.size });
}

async function seedingList(env, url, ctx) {
  const gate = await H.requireStaff(env, ctx);
  if (gate) return gate;
  const season = url.searchParams.get("season") || String(new Date().getFullYear());
  const rows = (await env.DB.prepare(
    `SELECT sp.*, c.full_name FROM season_points sp
     JOIN contacts c ON c.id = sp.contact_id
     WHERE sp.org_id=?1 AND sp.season=?2 ORDER BY sp.points DESC, sp.wins DESC`
  ).bind(ctx.orgId, season).all()).results;
  return H.json({ season, seeding: rows.map((r, i) => ({ seed: i + 1, ...r })) });
}

/* ---------- utils ---------- */

async function safeJson(request) { try { return await request.json(); } catch { return {}; } }
