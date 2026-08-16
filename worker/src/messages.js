/**
 * Boomtown Platform — Messages, Relay & Player Library module (M14 Phase B)
 * File: worker/src/messages.js · Version: v1.2 · Date: 2026-07-30 · Ships in: v0.36.0
 *
 * v1.2 (2026-07-30, v0.36.0): F-39 — decision A, fail closed. Exported
 *   LIBRARY_ADULT_PREDICATE (member_profiles.date_of_birth NOT NULL and 18+); tierClause()
 *   appends it for both non-staff tiers, and startThread() refuses a recipient who fails
 *   it with the same opaque 404 as 'private'. NULL DOB = not listed, not messageable.
 *   Staff unaffected (spec §3.4). Verified live 2026-07-30: 0 public profiles, 0 profiles
 *   with DOB — blast radius today is one sandbox 'members' profile dropping from search
 *   until a DOB is entered. Decision B (require DOB to set visibility) is the follow-up.
 *
 * v1.1 (2026-07-25, M16): one-click mute from Message Reports —
 *   POST /api/admin/messages/mute   {contact_id, days?, reason?}  (default 7 days; 0 = until unmuted)
 *   POST /api/admin/messages/unmute {contact_id}
 *   member_mutes rows already hard-block sending at senderGate (shipped v0.17.0) —
 *   this only adds the staff write path + sender_muted state on the flags list.
 *   Pure exports muteUntilIso()/normalizeMuteBody() for tests. No schema change
 *   (member_mutes verified live in sqlite_master 2026-07-25).
 *
 * Member-facing (magic-link/passkey session), mounted by worker/src/index.js:
 *   GET  /api/library/search?q=&position=&level=&gender=  → privacy-gated player library.
 *        Tiers (member_profiles.visibility): 'public' = anyone, 'members' = signed-in only,
 *        'private' = hidden from search (admin/staff always see everything, spec §3.4).
 *        Players you've blocked (or who blocked you) never appear in each other's results.
 *   POST /api/messages/start   {to_contact_id, subject?, body} → new DM thread via RELAY:
 *        in-app notification + email through sendEmail(); email addresses are NEVER exposed —
 *        the email shows the sender's display name and links back to the member inbox.
 *   GET  /api/messages/threads                → my inbox (unread counts + last preview)
 *   GET  /api/messages/thread?id=             → one thread (marks it read)
 *   POST /api/messages/reply   {thread_id, body}
 *   GET  /api/messages/unread-count           → badge number for the site nav
 *   POST /api/messages/block   {contact_id}   → they vanish from my search + can't message me
 *   POST /api/messages/unblock {contact_id}
 *   POST /api/messages/hide    {thread_id}    → hides the thread from MY inbox (resurfaces on
 *        a new message from the other side, standard inbox behavior)
 *   POST /api/messages/report  {message_id, reason} → content_flags row + admin notification
 * Staff:
 *   GET  /api/admin/messages/flags?status=open|resolved|dismissed
 *   POST /api/admin/messages/flags/resolve {id, status, note}
 *
 * Abuse guards: 2,000-char body cap · max 10 NEW threads and 60 messages per member per
 * day · member_mutes rows (set by staff) hard-block sending · blocks checked both
 * directions on every send. Sandbox: without BREVO_API_KEY the relay email is skipped and
 * the response says mode:"sandbox" — the in-app notification still lands.
 *
 * Tables (all pre-existing except the four member_profiles columns from migration 0011):
 *   message_threads, messages, thread_participants, member_blocks, member_mutes,
 *   content_flags, notifications · member_profiles +positions +skill_level
 *   +gender_division +height_reach (0011, applied live 2026-07-24).
 */

import { sendEmail, escapeHtml } from "./registrations.js";

let H = null; // wired: { json, audit, isStaff, requireStaff, contactForSession }
export function wireMessages(helpers) { H = helpers; }

const BODY_MAX = 2000;
const SUBJECT_MAX = 120;
const THREADS_PER_DAY = 10;
const MESSAGES_PER_DAY = 60;

/* ================================ pure helpers (unit-tested) ================================ */

/** SQL fragment gating library rows by privacy tier. Staff see everything (spec §3.4). */
/* F-39 (v0.36.0, decision A): the library and the relay may only expose a profile the
   system can age-verify as an adult. FAIL CLOSED — a NULL date_of_birth is treated as
   a minor, not as an adult. One exported predicate, used by tierClause() below AND by
   startThread()'s recipient check, so the listing filter and the DM gate cannot drift
   apart (library failure class 3: a guard narrower than the thing it guards).
   References member_profiles via alias `p`; ISO date strings compare correctly in SQLite. */
export const LIBRARY_ADULT_PREDICATE =
  "(p.date_of_birth IS NOT NULL AND p.date_of_birth <= date('now','-18 years'))";

export function tierClause(signedIn, staff) {
  if (staff) return "1=1";
  if (signedIn) return "p.visibility IN ('public','members') AND " + LIBRARY_ADULT_PREDICATE;
  return "p.visibility = 'public' AND " + LIBRARY_ADULT_PREDICATE;
}

/** Library filter builder — same {where, binds} contract as marketing.buildSegmentWhere. */
export function buildLibraryWhere(filter) {
  const where = [];
  const binds = [];
  const f = filter || {};
  if (f.q && String(f.q).trim()) {
    where.push("instr(lower(c.full_name), lower(?)) > 0");
    binds.push(String(f.q).trim().slice(0, 80));
  }
  if (f.position && String(f.position).trim()) {
    where.push("instr(lower(coalesce(p.positions,'')), lower(?)) > 0");
    binds.push(String(f.position).trim().slice(0, 40));
  }
  if (f.level && String(f.level).trim()) {
    where.push("lower(coalesce(p.skill_level,'')) = lower(?)");
    binds.push(String(f.level).trim().slice(0, 40));
  }
  if (f.gender && String(f.gender).trim()) {
    where.push("lower(coalesce(p.gender_division,'')) = lower(?)");
    binds.push(String(f.gender).trim().slice(0, 40));
  }
  return { where: where.length ? " AND " + where.join(" AND ") : "", binds };
}

/** Relay email body. Contains the sender's NAME and the message text only — never an
 *  email address; replies happen in the member inbox. */
export function relayEmailHtml(senderName, bodyText, inboxUrl, orgName = null) {
  // F-13b (v0.31.0): the org name was a literal in member-read body text and in the fallback
  // sender label. Standards §8 — it comes from the org profile or the sentence omits it.
  const org = escapeHtml(String(orgName || "").trim());
  const name = escapeHtml(String(senderName || "A member"));
  const text = escapeHtml(String(bodyText || "")).replace(/\n/g, "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111">
    <p><strong>${name}</strong> sent you a message${org ? " on " + org : ""}:</p>
    <blockquote style="margin:12px 0;padding:12px 16px;border-left:3px solid #E4B33C;background:#f6f6f4">${text}</blockquote>
    <p><a href="${inboxUrl}" style="color:#8a6d1a">Open your inbox to reply</a> — replies stay inside
    the platform, so your email address is never shared.</p>
  </div>`;
}

/** true when a member has hit a daily send ceiling. */
export function overFlood(count, limit) {
  return Number(count || 0) >= Number(limit);
}

/* ==================================== routing ==================================== */

export async function messagesRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;

  if (p === "/api/library/search" && m === "GET") return librarySearch(env, url, ctx);

  if (p === "/api/messages/start" && m === "POST") return startThread(request, env, ctx);
  if (p === "/api/messages/threads" && m === "GET") return listThreads(env, ctx);
  if (p === "/api/messages/thread" && m === "GET") return readThread(env, url, ctx);
  if (p === "/api/messages/reply" && m === "POST") return reply(request, env, ctx);
  if (p === "/api/messages/unread-count" && m === "GET") return unreadCount(env, ctx);
  if (p === "/api/messages/block" && m === "POST") return setBlock(request, env, ctx, true);
  if (p === "/api/messages/unblock" && m === "POST") return setBlock(request, env, ctx, false);
  if (p === "/api/messages/hide" && m === "POST") return hideThread(request, env, ctx);
  if (p === "/api/messages/report" && m === "POST") return reportMessage(request, env, ctx);
  if (p === "/api/admin/messages/mute" && m === "POST") return adminMute(request, env, ctx, true);
  if (p === "/api/admin/messages/unmute" && m === "POST") return adminMute(request, env, ctx, false);

  if (p === "/api/admin/messages/flags" && m === "GET") return adminFlags(env, url, ctx);
  if (p === "/api/admin/messages/flags/count" && m === "GET") return adminFlagCount(env, ctx);
  if (p === "/api/admin/messages/flags/resolve" && m === "POST") return adminResolveFlag(request, env, ctx);

  return null;
}

/* ==================================== library ==================================== */

async function librarySearch(env, url, ctx) {
  const signedIn = !!ctx.session;
  const staff = signedIn && (await H.isStaff(env, ctx));
  const me = signedIn ? await H.contactForSession(env, ctx) : null;

  const filter = {
    q: url.searchParams.get("q") || "",
    position: url.searchParams.get("position") || "",
    level: url.searchParams.get("level") || "",
    gender: url.searchParams.get("gender") || "",
  };
  const { where, binds } = buildLibraryWhere(filter);

  let blockSql = "";
  const blockBinds = [];
  if (me) {
    blockSql = ` AND c.id != ?
      AND c.id NOT IN (SELECT blocked_contact_id FROM member_blocks
                       WHERE org_id=? AND blocker_contact_id=? AND deleted_at IS NULL)
      AND c.id NOT IN (SELECT blocker_contact_id FROM member_blocks
                       WHERE org_id=? AND blocked_contact_id=? AND deleted_at IS NULL)`;
    blockBinds.push(me.id, ctx.orgId, me.id, ctx.orgId, me.id);
  }

  const rows = (await env.DB.prepare(
    `SELECT c.id AS contact_id, c.full_name, p.positions, p.skill_level, p.gender_division,
            p.height_reach, p.bio, p.visibility, p.avatar_r2_key
     FROM member_profiles p
     JOIN contacts c ON c.id = p.contact_id AND c.deleted_at IS NULL
     WHERE p.org_id = ? AND p.deleted_at IS NULL AND ${tierClause(signedIn, staff)}${where}${blockSql}
     ORDER BY c.full_name COLLATE NOCASE LIMIT 50`
  ).bind(ctx.orgId, ...binds, ...blockBinds).all()).results;

  return H.json({
    players: rows.map((r) => ({
      contact_id: r.contact_id,
      name: r.full_name,
      positions: r.positions || null,
      skill_level: r.skill_level || null,
      gender_division: r.gender_division || null,
      height_reach: r.height_reach || null,
      bio: r.bio ? String(r.bio).slice(0, 200) : null,
      visibility: r.visibility,
      avatar_url: r.avatar_r2_key ? `/api/avatar/${r.avatar_r2_key}` : null,
      can_message: signedIn && !staff ? true : signedIn, // signed-in members can message anyone listed
    })),
    signed_in: signedIn,
  });
}

/* ==================================== relay + inbox ==================================== */

async function startThread(request, env, ctx) {
  const gate = await senderGate(env, ctx);
  if (gate.err) return gate.err;
  const me = gate.me;

  const b = await request.json().catch(() => ({}));
  const toId = Number(b.to_contact_id);
  const body = String(b.body || "").trim().slice(0, BODY_MAX);
  const subject = String(b.subject || "").trim().slice(0, SUBJECT_MAX) || null;
  if (!toId) return H.json({ error: "Pick a player to message." }, 400);
  if (!body) return H.json({ error: "Write a message first." }, 400);
  if (toId === me.id) return H.json({ error: "That's you — pick another player." }, 400);

  const to = await env.DB.prepare(
    `SELECT c.id, c.email, c.full_name, p.visibility, ${LIBRARY_ADULT_PREDICATE} AS adult_ok
     FROM contacts c LEFT JOIN member_profiles p ON p.contact_id=c.id AND p.org_id=c.org_id AND p.deleted_at IS NULL
     WHERE c.id=?1 AND c.org_id=?2 AND c.deleted_at IS NULL`
  ).bind(toId, ctx.orgId).first();
  const staff = await H.isStaff(env, ctx);
  // Hidden players are unreachable for regular members (admin can always contact, spec §3.4).
  // F-39 (v0.36.0): so is anyone the system cannot age-verify as an adult — same predicate
  // as the library listing, same opaque 404 (the response must not disclose WHY, least of
  // all that the target is a minor). LEFT JOIN means no profile row → adult_ok is NULL → refused.
  if (!to || (!staff && ((to.visibility || "private") === "private" || !to.adult_ok))) {
    return H.json({ error: "This player can't be messaged." }, 404);
  }
  if (await blockedEitherWay(env, ctx.orgId, me.id, toId)) {
    return H.json({ error: "You can't message this player." }, 403);
  }

  const started = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM message_threads WHERE org_id=?1 AND created_by_contact_id=?2 AND created_at >= datetime('now','-1 day') AND deleted_at IS NULL"
  ).bind(ctx.orgId, me.id).first();
  if (overFlood(started.n, THREADS_PER_DAY)) {
    return H.json({ error: "You've started a lot of conversations today — try again tomorrow." }, 429);
  }
  const floodErr = await messageFlood(env, ctx.orgId, me.id);
  if (floodErr) return floodErr;

  const th = await env.DB.prepare(
    "INSERT INTO message_threads (org_id, kind, subject, created_by_contact_id, last_message_at) VALUES (?1,'dm',?2,?3,datetime('now'))"
  ).bind(ctx.orgId, subject, me.id).run();
  const threadId = th.meta.last_row_id;
  await env.DB.prepare(
    "INSERT INTO thread_participants (org_id, thread_id, contact_id, last_read_at) VALUES (?1,?2,?3,datetime('now')), (?1,?2,?4,NULL)"
  ).bind(ctx.orgId, threadId, me.id, toId).run();
  await env.DB.prepare(
    "INSERT INTO messages (org_id, thread_id, sender_contact_id, body) VALUES (?1,?2,?3,?4)"
  ).bind(ctx.orgId, threadId, me.id, body).run();

  const mode = await notifyAndRelay(env, ctx, me, to, threadId, body);
  await H.audit(env, ctx, "message.start", "message_threads", threadId, { to_contact_id: toId, mode });
  return H.json({ ok: true, thread_id: threadId, mode });
}

async function reply(request, env, ctx) {
  const gate = await senderGate(env, ctx);
  if (gate.err) return gate.err;
  const me = gate.me;

  const b = await request.json().catch(() => ({}));
  const threadId = Number(b.thread_id);
  const body = String(b.body || "").trim().slice(0, BODY_MAX);
  if (!threadId || !body) return H.json({ error: "Write a message first." }, 400);

  const mine = await env.DB.prepare(
    "SELECT tp.id FROM thread_participants tp JOIN message_threads t ON t.id=tp.thread_id AND t.deleted_at IS NULL WHERE tp.thread_id=?1 AND tp.contact_id=?2 AND tp.org_id=?3"
  ).bind(threadId, me.id, ctx.orgId).first();
  if (!mine) return H.json({ error: "Conversation not found." }, 404);

  const others = (await env.DB.prepare(
    "SELECT tp.contact_id, c.email, c.full_name FROM thread_participants tp JOIN contacts c ON c.id=tp.contact_id AND c.deleted_at IS NULL WHERE tp.thread_id=?1 AND tp.contact_id != ?2"
  ).bind(threadId, me.id).all()).results;
  for (const o of others) {
    if (await blockedEitherWay(env, ctx.orgId, me.id, o.contact_id)) {
      return H.json({ error: "You can't message this player." }, 403);
    }
  }
  const floodErr = await messageFlood(env, ctx.orgId, me.id);
  if (floodErr) return floodErr;

  await env.DB.prepare(
    "INSERT INTO messages (org_id, thread_id, sender_contact_id, body) VALUES (?1,?2,?3,?4)"
  ).bind(ctx.orgId, threadId, me.id, body).run();
  await env.DB.prepare(
    "UPDATE message_threads SET last_message_at=datetime('now'), updated_at=datetime('now') WHERE id=?1"
  ).bind(threadId).run();
  // A new message resurfaces the thread for everyone who had hidden it (standard inbox behavior).
  await env.DB.prepare(
    "UPDATE thread_participants SET deleted_at=NULL WHERE thread_id=?1 AND contact_id != ?2"
  ).bind(threadId, me.id).run();

  let mode = "sandbox";
  for (const o of others) mode = await notifyAndRelay(env, ctx, me, o, threadId, body);
  await H.audit(env, ctx, "message.reply", "message_threads", threadId, { mode });
  return H.json({ ok: true, mode });
}

async function listThreads(env, ctx) {
  const me = await requireMember(env, ctx);
  if (me.err) return me.err;
  const rows = (await env.DB.prepare(
    `SELECT t.id, t.subject, t.last_message_at,
        (SELECT m.body FROM messages m WHERE m.thread_id=t.id AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS preview,
        (SELECT COUNT(*) FROM messages m WHERE m.thread_id=t.id AND m.deleted_at IS NULL
           AND m.sender_contact_id != ?2
           AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)) AS unread,
        (SELECT group_concat(c.full_name, ', ') FROM thread_participants tp2
           JOIN contacts c ON c.id=tp2.contact_id WHERE tp2.thread_id=t.id AND tp2.contact_id != ?2) AS with_names
     FROM thread_participants tp
     JOIN message_threads t ON t.id=tp.thread_id AND t.deleted_at IS NULL
     WHERE tp.contact_id=?2 AND tp.org_id=?1 AND tp.deleted_at IS NULL
     ORDER BY t.last_message_at DESC LIMIT 100`
  ).bind(ctx.orgId, me.me.id).all()).results;
  return H.json({ threads: rows.map((r) => ({
    id: r.id, subject: r.subject, with: r.with_names || "(left)", last_message_at: r.last_message_at,
    preview: r.preview ? String(r.preview).slice(0, 120) : "", unread: r.unread,
  })) });
}

async function readThread(env, url, ctx) {
  const me = await requireMember(env, ctx);
  if (me.err) return me.err;
  const threadId = Number(url.searchParams.get("id"));
  const mine = await env.DB.prepare(
    "SELECT tp.id FROM thread_participants tp JOIN message_threads t ON t.id=tp.thread_id AND t.deleted_at IS NULL WHERE tp.thread_id=?1 AND tp.contact_id=?2 AND tp.org_id=?3"
  ).bind(threadId, me.me.id, ctx.orgId).first();
  if (!mine) return H.json({ error: "Conversation not found." }, 404);

  const t = await env.DB.prepare("SELECT id, subject FROM message_threads WHERE id=?1").bind(threadId).first();
  const msgs = (await env.DB.prepare(
    `SELECT m.id, m.sender_contact_id, c.full_name AS sender_name, m.body, m.created_at, m.deleted_at
     FROM messages m JOIN contacts c ON c.id=m.sender_contact_id
     WHERE m.thread_id=?1 ORDER BY m.id ASC LIMIT 500`
  ).bind(threadId).all()).results;
  const others = (await env.DB.prepare(
    "SELECT contact_id FROM thread_participants WHERE thread_id=?1 AND contact_id != ?2"
  ).bind(threadId, me.me.id).all()).results;

  await env.DB.prepare(
    "UPDATE thread_participants SET last_read_at=datetime('now') WHERE thread_id=?1 AND contact_id=?2"
  ).bind(threadId, me.me.id).run();

  return H.json({
    thread: { id: t.id, subject: t.subject, other_contact_ids: others.map((o) => o.contact_id) },
    my_contact_id: me.me.id,
    messages: msgs.map((m) => ({
      id: m.id, sender_contact_id: m.sender_contact_id, sender_name: m.sender_name,
      body: m.deleted_at ? "(message removed)" : m.body, created_at: m.created_at, mine: m.sender_contact_id === me.me.id,
    })),
  });
}

async function unreadCount(env, ctx) {
  const me = await requireMember(env, ctx);
  if (me.err) return me.err;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messages m
     JOIN thread_participants tp ON tp.thread_id=m.thread_id AND tp.contact_id=?2 AND tp.deleted_at IS NULL
     JOIN message_threads t ON t.id=m.thread_id AND t.deleted_at IS NULL
     WHERE m.org_id=?1 AND m.deleted_at IS NULL AND m.sender_contact_id != ?2
       AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)`
  ).bind(ctx.orgId, me.me.id).first();
  return H.json({ unread: row.n });
}

async function setBlock(request, env, ctx, block) {
  const me = await requireMember(env, ctx);
  if (me.err) return me.err;
  const b = await request.json().catch(() => ({}));
  const otherId = Number(b.contact_id);
  if (!otherId || otherId === me.me.id) return H.json({ error: "Pick a player first." }, 400);
  if (block) {
    await env.DB.prepare(
      `INSERT INTO member_blocks (org_id, blocker_contact_id, blocked_contact_id) VALUES (?1,?2,?3)
       ON CONFLICT(org_id, blocker_contact_id, blocked_contact_id) DO UPDATE SET deleted_at=NULL`
    ).bind(ctx.orgId, me.me.id, otherId).run();
  } else {
    await env.DB.prepare(
      "UPDATE member_blocks SET deleted_at=datetime('now') WHERE org_id=?1 AND blocker_contact_id=?2 AND blocked_contact_id=?3"
    ).bind(ctx.orgId, me.me.id, otherId).run();
  }
  await H.audit(env, ctx, block ? "message.block" : "message.unblock", "member_blocks", otherId, {});
  return H.json({ ok: true, message: block ? "Blocked. They can't message you and you won't see each other in the library." : "Unblocked." });
}

async function hideThread(request, env, ctx) {
  const me = await requireMember(env, ctx);
  if (me.err) return me.err;
  const b = await request.json().catch(() => ({}));
  await env.DB.prepare(
    "UPDATE thread_participants SET deleted_at=datetime('now') WHERE thread_id=?1 AND contact_id=?2 AND org_id=?3"
  ).bind(Number(b.thread_id), me.me.id, ctx.orgId).run();
  return H.json({ ok: true, message: "Hidden. It comes back if they message you again — use Block to stop that." });
}

async function reportMessage(request, env, ctx) {
  const me = await requireMember(env, ctx);
  if (me.err) return me.err;
  const b = await request.json().catch(() => ({}));
  const msgId = Number(b.message_id);
  const reason = String(b.reason || "").trim().slice(0, 500);
  const msg = await env.DB.prepare(
    `SELECT m.id FROM messages m JOIN thread_participants tp ON tp.thread_id=m.thread_id AND tp.contact_id=?2
     WHERE m.id=?1 AND m.org_id=?3`
  ).bind(msgId, me.me.id, ctx.orgId).first();
  if (!msg) return H.json({ error: "Message not found." }, 404);
  await env.DB.prepare(
    "INSERT INTO content_flags (org_id, target_type, target_id, reporter_contact_id, reason) VALUES (?1,'message',?2,?3,?4)"
  ).bind(ctx.orgId, msgId, me.me.id, reason || null).run();
  await env.DB.prepare(
    "INSERT INTO notifications (org_id, kind, target, payload_json) VALUES (?1,'message_flag','admin',?2)"
  ).bind(ctx.orgId, JSON.stringify({ message_id: msgId, reporter_contact_id: me.me.id })).run();
  await H.audit(env, ctx, "message.report", "messages", msgId, { reason: reason || null });
  return H.json({ ok: true, message: "Reported. An admin will review it." });
}

/* ==================================== admin ==================================== */

/**
 * ONE definition of "a message report in this org, with this status" (F-26 lesson: the same
 * predicate written twice drifts, and the two copies then disagree in public). The queue and the
 * header badge count MUST select through this — a badge that says 3 over a queue showing 2 is
 * worse than no badge, because the operator stops trusting the number and then stops looking.
 * Params are positional and fixed: ?1 = org id, ?2 = status.
 */
export const MESSAGE_FLAG_SCOPE = "f.org_id=?1 AND f.target_type='message' AND f.status=?2";

/** Statuses the queue and the badge both recognise. Anything else falls back to 'open'. */
export const FLAG_STATUSES = ["open", "resolved", "dismissed"];

/** Pure: the status a query should actually use. Unknown/absent → 'open' (what the badge counts). */
export function flagStatusOf(raw) {
  return FLAG_STATUSES.includes(raw) ? raw : "open";
}

/**
 * Badge number for the static admin ✉ (#btHdrMail). Parked since v0.48.0 with the note "no badge
 * yet: there is no admin unread-count endpoint" — this is that endpoint. Staff-only and
 * org-scoped like every other admin read.
 */
async function adminFlagCount(env, ctx) {
  const denied = await H.requireStaff(env, ctx);
  if (denied) return denied;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM content_flags f WHERE ${MESSAGE_FLAG_SCOPE}`
  ).bind(ctx.orgId, "open").first();
  return H.json({ open: (row && row.n) || 0 });
}

async function adminFlags(env, url, ctx) {
  const denied = await H.requireStaff(env, ctx);
  if (denied) return denied;
  const status = flagStatusOf(url.searchParams.get("status"));
  const rows = (await env.DB.prepare(
    `SELECT f.id, f.target_id AS message_id, f.reason, f.status, f.created_at, f.resolution_note,
            rep.full_name AS reporter_name, m.body AS message_body, snd.full_name AS sender_name,
            snd.id AS sender_contact_id,
            EXISTS (SELECT 1 FROM member_mutes mm WHERE mm.org_id = f.org_id AND mm.contact_id = snd.id
                    AND mm.deleted_at IS NULL AND (mm.muted_until IS NULL OR mm.muted_until > datetime('now'))) AS sender_muted,
            m.thread_id
     FROM content_flags f
     JOIN contacts rep ON rep.id = f.reporter_contact_id
     LEFT JOIN messages m ON m.id = f.target_id
     LEFT JOIN contacts snd ON snd.id = m.sender_contact_id
     WHERE ${MESSAGE_FLAG_SCOPE}
     ORDER BY f.created_at DESC LIMIT 200`
  ).bind(ctx.orgId, status).all()).results;
  return H.json({ flags: rows });
}

/* ---------------- v1.1: one-click mute (M16) ---------------- */

/** Pure: mute expiry ISO from a day count. 0/blank = permanent (NULL). Clamped 1–365. */
export function muteUntilIso(days, nowMs = Date.now()) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return null; // permanent until unmuted
  const clamped = Math.min(365, Math.max(1, Math.round(d)));
  return new Date(nowMs + clamped * 86400000).toISOString().replace("T", " ").slice(0, 19);
}

/** Pure: normalize the mute request body. */
export function normalizeMuteBody(b) {
  const contactId = Number(b && b.contact_id);
  return {
    contactId: Number.isInteger(contactId) && contactId > 0 ? contactId : null,
    days: b && b.days !== undefined ? Number(b.days) : 7,
    reason: String((b && b.reason) || "").trim().slice(0, 300) || null,
  };
}

async function adminMute(request, env, ctx, mute) {
  const denied = await H.requireStaff(env, ctx);
  if (denied) return denied;
  const b = normalizeMuteBody(await request.json().catch(() => ({})));
  if (!b.contactId) return H.json({ error: "contact_id required." }, 400);
  const contact = await env.DB.prepare(
    "SELECT id, full_name FROM contacts WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(b.contactId, ctx.orgId).first();
  if (!contact) return H.json({ error: "Member not found." }, 404);
  if (mute) {
    const until = muteUntilIso(b.days);
    await env.DB.prepare(
      "INSERT INTO member_mutes (org_id, contact_id, reason, muted_until, muted_by_user_id) VALUES (?1,?2,?3,?4,?5)"
    ).bind(ctx.orgId, b.contactId, b.reason, until, ctx.userId).run();
    await H.audit(env, ctx, "message.mute", "member_mutes", b.contactId, { days: b.days, until, reason: b.reason });
    return H.json({ ok: true, muted: true, until,
      message: until ? `${contact.full_name || "Member"} muted until ${until.slice(0, 10)}.`
                     : `${contact.full_name || "Member"} muted until you unmute them.` });
  }
  await env.DB.prepare(
    "UPDATE member_mutes SET deleted_at=datetime('now') WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL"
  ).bind(ctx.orgId, b.contactId).run();
  await H.audit(env, ctx, "message.unmute", "member_mutes", b.contactId, {});
  return H.json({ ok: true, muted: false, message: `${contact.full_name || "Member"} can message again.` });
}

async function adminResolveFlag(request, env, ctx) {
  const denied = await H.requireStaff(env, ctx);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  const status = ["resolved", "dismissed"].includes(b.status) ? b.status : "resolved";
  const note = String(b.note || "").trim().slice(0, 500) || null;
  const flag = await env.DB.prepare(
    "SELECT id FROM content_flags WHERE id=?1 AND org_id=?2 AND target_type='message'"
  ).bind(id, ctx.orgId).first();
  if (!flag) return H.json({ error: "Flag not found." }, 404);
  await env.DB.prepare(
    "UPDATE content_flags SET status=?1, resolution_note=?2, resolved_by_user_id=?3, resolved_at=datetime('now') WHERE id=?4"
  ).bind(status, note, ctx.userId, id).run();
  await H.audit(env, ctx, "message.flag_resolve", "content_flags", id, { status, note });
  return H.json({ ok: true });
}

/* ==================================== shared bits ==================================== */

async function requireMember(env, ctx) {
  if (!ctx.session) return { err: H.json({ error: "Sign in first." }, 401) };
  const me = await H.contactForSession(env, ctx);
  if (!me) return { err: H.json({ error: "No member record found for this account yet." }, 404) };
  return { me };
}

/** Sign-in + contact + mute check, shared by both send paths. */
async function senderGate(env, ctx) {
  const g = await requireMember(env, ctx);
  if (g.err) return g;
  const mute = await env.DB.prepare(
    `SELECT id FROM member_mutes WHERE org_id=?1 AND contact_id=?2 AND deleted_at IS NULL
     AND (muted_until IS NULL OR muted_until > datetime('now'))`
  ).bind(ctx.orgId, g.me.id).first();
  if (mute) {
    // D-30: the pause is an ORG moderation action, so the org's own contact address (B29's
    // orgs.admin_email — the one the operator sets on their settings screen) is the right door
    // to knock on; the old literal sent Match Point and Colorado Boom members to Boomtown. An
    // org that set no address gets a whole sentence, never a dangling "Email ."
    const org = await env.DB.prepare("SELECT admin_email FROM orgs WHERE id=?1").bind(ctx.orgId).first();
    const addr = String((org && org.admin_email) || "").trim();
    return { err: H.json({ error: addr
      ? `Messaging is paused on your account. Email ${addr} if you think this is a mistake.`
      : "Messaging is paused on your account. If you think this is a mistake, contact your organization." }, 403) };
  }
  return g;
}

async function messageFlood(env, orgId, contactId) {
  const sent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM messages WHERE org_id=?1 AND sender_contact_id=?2 AND created_at >= datetime('now','-1 day')"
  ).bind(orgId, contactId).first();
  if (overFlood(sent.n, MESSAGES_PER_DAY)) {
    return H.json({ error: "Daily message limit reached — try again tomorrow." }, 429);
  }
  return null;
}

async function blockedEitherWay(env, orgId, a, b) {
  const row = await env.DB.prepare(
    `SELECT id FROM member_blocks WHERE org_id=?1 AND deleted_at IS NULL
     AND ((blocker_contact_id=?2 AND blocked_contact_id=?3) OR (blocker_contact_id=?3 AND blocked_contact_id=?2)) LIMIT 1`
  ).bind(orgId, a, b).first();
  return !!row;
}

/** Notification row + relay email (never exposes an address). Returns "email" | "sandbox". */
async function notifyAndRelay(env, ctx, me, to, threadId, body) {
  const senderName = me.full_name || "A member";
  const preview = String(body).slice(0, 140);
  await env.DB.prepare(
    `INSERT INTO notifications (org_id, kind, target, contact_id, title, body, link, payload_json, sent_at)
     VALUES (?1,'message','member',?2,?3,?4,?5,?6,datetime('now'))`
  ).bind(ctx.orgId, to.contact_id || to.id, `New message from ${senderName}`, preview,
         "member-inbox.html", JSON.stringify({ thread_id: threadId })).run();
  if (!to.email) return "sandbox";
  // K-10(a): APP_URL is the configured frontend address; the old SITE_ORIGIN fallback was the
  // live path because that variable is set nowhere.
  const inboxUrl = env.APP_URL + "/member-inbox.html";
  // F-13 (v0.31.0): ctx.orgId reaches both the sender identity and the body, so a Queens Club
  // relay is branded Queens Club rather than Boomtown.
  const orgRow = await env.DB.prepare("SELECT name FROM orgs WHERE id = ?1").bind(ctx.orgId).first();
  const ok = await sendEmail(env, to.email, `New message from ${senderName}`,
    relayEmailHtml(senderName, body, inboxUrl, orgRow && orgRow.name), ctx.orgId);
  return ok ? "email" : "sandbox";
}

/* D-18 (v0.166.0): the private copy that used to live here is gone. This module resolves the
   signed-in member through the ONE shared rule (index.js contactForSession, injected as
   H.contactForSession) — see its header for why the link, not the address, is authoritative.
   The old comment here said "same rule as member_portal.js", which was true and was the
   problem: the rule existed in four places at once. */

/* Changelog: v1.1 (2026-07-25) — one-click mute routes + sender_muted on flags (M16).
   v1.0 (2026-07-24) — initial messaging/relay module (M14 Phase B). */
