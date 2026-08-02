/**
 * Boomtown Platform — Calendar feeds (iCal / RFC 5545)
 * File: worker/src/calendar.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.23.0
 *
 * Public feed (NO session — the token IS the credential):
 *   GET  /api/calendar/:token.ics        → text/calendar
 *        Routed in index.js BEFORE the /api/ chain so it never passes through json(),
 *        which since v0.21.0 stamps Cache-Control: no-store on every API response.
 *        A no-store .ics makes every subscribed calendar client re-fetch on every
 *        refresh tick — a self-inflicted load problem. This path sets max-age=900
 *        and answers 304 on a matching If-None-Match.
 *
 * Member (signed in):
 *   GET    /api/profile/calendar          → { subscribed, url|null, created_at }
 *   POST   /api/profile/calendar          → mint (rotates: old one is revoked) { url }
 *   DELETE /api/profile/calendar          → revoke
 *
 * Staff:
 *   GET    /api/admin/calendar            → { subscribed, url|null }
 *   POST   /api/admin/calendar            → mint/rotate the org-wide public feed { url }
 *   DELETE /api/admin/calendar            → revoke
 *
 * SECURITY
 *  - The raw token is returned exactly once, at mint. Only SHA-256 is stored (migration 0016).
 *  - Revoked or unknown token → 404, never 403. A 403 confirms the token existed.
 *  - Feed URLs live forever inside a calendar client's config, so rotation is the only
 *    real remedy; POST always revokes the previous token rather than accumulating them.
 *  - No PII beyond the member's own schedule. The public feed carries published events only.
 *
 * CANCELLATIONS: a soft-deleted or cancelled event is emitted with STATUS:CANCELLED rather
 * than dropped. Dropping a VEVENT does not remove it from a subscriber's calendar — it just
 * stops updating, and the ghost sits there forever. This is the single most common iCal bug.
 */

let json, audit, requireStaff;
export function wireCalendar(h) { ({ json, audit, requireStaff } = h); }

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 365;
const FEED_MAX_AGE = 900;          // 15 min; matches X-PUBLISHED-TTL / REFRESH-INTERVAL
const USE_STAMP_THROTTLE_MIN = 60; // don't write last_used_at on every poll

/* ==================== pure helpers (unit-tested, no DB) ==================== */

/** RFC 5545 §3.3.11 — escape TEXT values. Backslash FIRST or you double-escape. */
export function escapeIcsText(v) {
  return String(v == null ? "" : v)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * RFC 5545 §3.1 — fold content lines at 75 OCTETS (not characters). Continuation lines
 * begin with a single space. Multi-byte characters must never be split mid-sequence,
 * which is why this counts UTF-8 byte length per code point rather than slicing by index.
 */
export function foldIcsLine(line) {
  const s = String(line);
  const enc = new TextEncoder();
  if (enc.encode(s).length <= 75) return s;
  const out = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of s) {                       // iterates code points, not UTF-16 units
    const n = enc.encode(ch).length;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = ch;
      curBytes = n;
      limit = 74;                             // continuation lines lose one octet to the space
    } else {
      cur += ch;
      curBytes += n;
    }
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");
}

/**
 * DB timestamps are UTC in either 'YYYY-MM-DD HH:MM:SS' or ISO form (both appear in this
 * codebase — seed data uses SQLite datetime(), the admin UI posts ISO). Normalise to
 * iCal UTC form: 20260726T143000Z. Returns null on anything unparseable.
 */
export function toIcsUtc(v) {
  if (!v) return null;
  let s = String(v).trim().replace(" ", "T");
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * The events table stores naive local wall-clock ("2026-08-01 16:00:00" = 4pm in Aurora).
 * The admin UI builds it as `<input type=date> + " " + <input type=time>` and the worker
 * stores that string untouched, so there is no timezone in it to honour. Emitting it with a
 * trailing Z claims it is UTC and shifts every event 6-7 hours early in the subscriber's
 * calendar. Format it floating and bind it to a VTIMEZONE instead. DTSTAMP stays UTC because
 * that one really is an instant.
 */
export const DEFAULT_TZID = "America/Denver"; // Aurora, Colorado — the operating facility

/** Read an org's IANA zone, falling back to the default. Never throws on a missing column. */
export async function orgTimezone(env, orgId) {
  try {
    const r = await env.DB.prepare("SELECT timezone FROM orgs WHERE id=?1").bind(orgId).first();
    return (r && r.timezone) || DEFAULT_TZID;
  } catch { return DEFAULT_TZID; }
}

export function toIcsLocal(v) {
  if (!v) return null;
  const m = String(v).trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] || "00"}`;
}

/**
 * US DST rules per zone. Only the zones the facility plausibly operates in are enumerated —
 * shipping a full tzdata table into a Worker to support four zones is not a trade worth making.
 * An unlisted zone still works: it falls back to the Denver block and X-WR-TIMEZONE carries the
 * real name, which every major client honours. Extend the table, don't special-case callers.
 */
const TZ_RULES = {
  "America/Denver":      { std: "-0700", dst: "-0600", stdName: "MST", dstName: "MDT" },
  "America/Phoenix":     { std: "-0700", dst: "-0700", stdName: "MST", dstName: "MST" }, // no DST
  "America/Los_Angeles": { std: "-0800", dst: "-0700", stdName: "PST", dstName: "PDT" },
  "America/Chicago":     { std: "-0600", dst: "-0500", stdName: "CST", dstName: "CDT" },
  "America/New_York":    { std: "-0500", dst: "-0400", stdName: "EST", dstName: "EDT" },
};

export const SUPPORTED_TZIDS = Object.keys(TZ_RULES);

/** VTIMEZONE block for a zone. TZID references do not resolve in strict clients without one. */
export function icsVtimezone(tzid = DEFAULT_TZID) {
  const r = TZ_RULES[tzid] || TZ_RULES[DEFAULT_TZID];
  const zone = TZ_RULES[tzid] ? tzid : DEFAULT_TZID;
  if (r.std === r.dst) {
    // A zone with no DST needs one STANDARD component and no recurrence switching.
    return [
      "BEGIN:VTIMEZONE", `TZID:${zone}`,
      "BEGIN:STANDARD", `TZOFFSETFROM:${r.std}`, `TZOFFSETTO:${r.std}`, `TZNAME:${r.stdName}`,
      "DTSTART:19700101T000000", "END:STANDARD",
      "END:VTIMEZONE",
    ];
  }
  return [
    "BEGIN:VTIMEZONE", `TZID:${zone}`,
    "BEGIN:DAYLIGHT", `TZOFFSETFROM:${r.std}`, `TZOFFSETTO:${r.dst}`, `TZNAME:${r.dstName}`,
    "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", `TZOFFSETFROM:${r.dst}`, `TZOFFSETTO:${r.std}`, `TZNAME:${r.stdName}`,
    "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

/** Add hours to a wall-clock string without ever leaving wall-clock. */
export function addWallHours(v, hours) {
  const iso = toIcsLocal(v);
  if (!iso) return null;
  const d = new Date(Date.UTC(
    +iso.slice(0, 4), +iso.slice(4, 6) - 1, +iso.slice(6, 8),
    +iso.slice(9, 11), +iso.slice(11, 13), +iso.slice(13, 15)
  ));
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString().slice(0, 19).replace(/[-:]/g, "");
}

/** Stable UID. Must not change between polls or clients duplicate the event. */
export function icsUid(eventId, host) {
  return `bt-event-${eventId}@${host || "boomtown"}`;
}

/**
 * Build a complete VCALENDAR. `events` rows need: id, name, starts_at, ends_at, location,
 * type, status, deleted_at, price_cents.
 */
export function buildIcs(events, opts = {}) {
  const name = opts.calName || "Boomtown Volleyball";
  const host = opts.host || "boomtown";
  const appUrl = opts.appUrl || "";
  const stamp = toIcsUtc(opts.now || new Date().toISOString());
  const tzid = opts.tzid || DEFAULT_TZID;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Boomtown Volleyball//Boomtown Platform v0.23.0//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(name)}`,
    `X-WR-TIMEZONE:${tzid}`,
    `X-PUBLISHED-TTL:PT${Math.round(FEED_MAX_AGE / 60)}M`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${Math.round(FEED_MAX_AGE / 60)}M`,
    ...icsVtimezone(tzid),
  ];

  for (const e of events) {
    const dtStart = toIcsLocal(e.starts_at);
    if (!dtStart) continue;                    // an event with no usable start is not an event
    // No end time → assume 2h so the block is visible rather than a zero-width sliver.
    const dtEnd = toIcsLocal(e.ends_at) || addWallHours(e.starts_at, 2);
    const cancelled = !!e.deleted_at || e.status === "cancelled";

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${icsUid(e.id, host)}`);
    lines.push(`DTSTAMP:${stamp}`);
    // TZID form, not Z — see the toIcsLocal comment. These are wall-clock, not instants.
    lines.push(`DTSTART;TZID=${tzid}:${dtStart}`);
    if (dtEnd) lines.push(`DTEND;TZID=${tzid}:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcsText((cancelled ? "CANCELLED — " : "") + (e.name || "Boomtown event"))}`);
    if (e.location) lines.push(`LOCATION:${escapeIcsText(e.location)}`);
    const bits = [];
    if (e.type) bits.push(`Type: ${e.type}`);
    if (e.price_cents > 0) bits.push(`Entry: $${(e.price_cents / 100).toFixed(2)}`);
    if (bits.length) lines.push(`DESCRIPTION:${escapeIcsText(bits.join("\n"))}`);
    if (appUrl) lines.push(`URL:${appUrl}/tournament.html?e=${e.id}`);
    lines.push(`STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`);
    // Bumping SEQUENCE on cancellation makes clients accept the update over their cached copy.
    lines.push(`SEQUENCE:${cancelled ? 1 : 0}`);
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Cheap deterministic ETag so polling clients get 304s instead of full bodies. */
export function feedEtag(rows) {
  let h = 2166136261;
  const src = rows.map(r => `${r.id}:${r.updated_at || ""}:${r.deleted_at || ""}`).join("|") + `#${rows.length}`;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `W/"${(h >>> 0).toString(16)}"`;
}

/* ==================== token helpers ==================== */

export async function sha256Hex(raw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(raw)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** 32 bytes of CSPRNG → 64 hex chars. This string is a bearer credential that will sit in a
 *  calendar client's config indefinitely, so it is deliberately longer than the 16-byte
 *  check-in token, which is short-lived and event-scoped. */
function mintRaw() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function issue(env, { orgId, kind, contactId = null, label = null, userId = null }) {
  // Rotate: one live token per (kind, owner). Revoking first also satisfies
  // ux_access_tokens_public_cal, which would otherwise reject the insert.
  await env.DB.prepare(
    `UPDATE access_tokens SET revoked_at = datetime('now')
      WHERE org_id = ?1 AND kind = ?2 AND revoked_at IS NULL AND deleted_at IS NULL
        AND ((?3 IS NULL AND contact_id IS NULL) OR contact_id = ?3)`
  ).bind(orgId, kind, contactId).run();

  const raw = mintRaw();
  const sha = await sha256Hex(raw);
  await env.DB.prepare(
    `INSERT INTO access_tokens (org_id, kind, token_sha, contact_id, label, created_by_user_id)
     VALUES (?1,?2,?3,?4,?5,?6)`
  ).bind(orgId, kind, sha, contactId, label, userId).run();
  return raw;
}

async function revokeAll(env, orgId, kind, contactId) {
  const r = await env.DB.prepare(
    `UPDATE access_tokens SET revoked_at = datetime('now')
      WHERE org_id = ?1 AND kind = ?2 AND revoked_at IS NULL AND deleted_at IS NULL
        AND ((?3 IS NULL AND contact_id IS NULL) OR contact_id = ?3)`
  ).bind(orgId, kind, contactId).run();
  return r.meta.changes || 0;
}

async function liveToken(env, orgId, kind, contactId) {
  return env.DB.prepare(
    `SELECT id, created_at, last_used_at, use_count FROM access_tokens
      WHERE org_id = ?1 AND kind = ?2 AND revoked_at IS NULL AND deleted_at IS NULL
        AND ((?3 IS NULL AND contact_id IS NULL) OR contact_id = ?3)
      ORDER BY id DESC LIMIT 1`
  ).bind(orgId, kind, contactId).first();
}

/** Session user → contact row in this org. Contacts key on email, users key on email. */
async function contactForSession(env, ctx) {
  if (!ctx || !ctx.userId) return null;
  return env.DB.prepare(
    `SELECT c.id, c.full_name FROM contacts c
     JOIN users u ON lower(u.email) = lower(c.email)
     WHERE u.id = ?1 AND u.deleted_at IS NULL AND c.org_id = ?2 AND c.deleted_at IS NULL
     LIMIT 1`
  ).bind(ctx.userId, ctx.orgId).first();
}

function feedUrl(env, raw) {
  const base = env.API_ORIGIN || "https://boomtown-api.vvisuth.workers.dev";
  return `${base}/api/calendar/${raw}.ics`;
}

/* ==================== the public feed ==================== */

function icsResponse(body, etag, status = 200) {
  return new Response(status === 304 ? null : body, {
    status,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="boomtown.ics"',
      "Cache-Control": `public, max-age=${FEED_MAX_AGE}`,
      "ETag": etag,
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const notFoundIcs = () =>
  new Response("This calendar link isn't active.\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

/**
 * Entry point for GET /api/calendar/:token.ics — called from index.js OUTSIDE the json()
 * chain. Never throws to the caller; a broken feed returns 404 rather than a 500 that a
 * calendar client will retry forever.
 */
export async function icsFeed(env, url, request) {
  try {
    const m = url.pathname.match(/^\/api\/calendar\/([a-f0-9]{64})\.ics$/i);
    if (!m) return notFoundIcs();
    const sha = await sha256Hex(m[1].toLowerCase());

    const tok = await env.DB.prepare(
      `SELECT id, org_id, kind, contact_id, last_used_at FROM access_tokens
        WHERE token_sha = ?1 AND revoked_at IS NULL AND deleted_at IS NULL
          AND (expires_at IS NULL OR expires_at > datetime('now'))`
    ).bind(sha).first();
    if (!tok || (tok.kind !== "calendar_member" && tok.kind !== "calendar_public")) {
      return notFoundIcs();
    }

    const from = `-${WINDOW_PAST_DAYS} days`;
    const to = `+${WINDOW_FUTURE_DAYS} days`;
    let rows;

    if (tok.kind === "calendar_public") {
      rows = (await env.DB.prepare(
        `SELECT id, name, starts_at, ends_at, location, type, status, price_cents, updated_at, deleted_at
           FROM events
          WHERE org_id = ?1
            AND status IN ('published','in_progress','completed','cancelled')
            AND starts_at BETWEEN datetime('now', ?2) AND datetime('now', ?3)
          ORDER BY starts_at LIMIT 500`
      ).bind(tok.org_id, from, to).all()).results;
    } else {
      // Member feed: events this contact is rostered on, matched by contact_id OR by the
      // email on their contact row (teammates are added by email and have no contact_id).
      rows = (await env.DB.prepare(
        `SELECT DISTINCT e.id, e.name, e.starts_at, e.ends_at, e.location, e.type, e.status,
                e.price_cents, e.updated_at, e.deleted_at
           FROM events e
           JOIN teams t ON t.id IS NOT NULL AND t.event_id = e.id AND t.deleted_at IS NULL
           JOIN team_members tm ON tm.team_id = t.id AND tm.deleted_at IS NULL
           LEFT JOIN contacts c ON c.id = ?2 AND c.deleted_at IS NULL
          WHERE e.org_id = ?1
            AND (tm.contact_id = ?2 OR (tm.member_email IS NOT NULL AND c.email IS NOT NULL
                                        AND lower(tm.member_email) = lower(c.email)))
            AND e.starts_at BETWEEN datetime('now', ?3) AND datetime('now', ?4)
          ORDER BY e.starts_at LIMIT 500`
      ).bind(tok.org_id, tok.contact_id, from, to).all()).results;
    }

    const etag = feedEtag(rows);
    if ((request && request.headers.get("If-None-Match")) === etag) return icsResponse(null, etag, 304);

    // Throttled usage stamp — a subscribed client polls every ~15 min and we are not
    // writing to D1 on every one of those.
    const stale = !tok.last_used_at ||
      (Date.now() - Date.parse(String(tok.last_used_at).replace(" ", "T") + "Z")) > USE_STAMP_THROTTLE_MIN * 60e3;
    if (stale) {
      await env.DB.prepare(
        "UPDATE access_tokens SET last_used_at = datetime('now'), use_count = use_count + 1 WHERE id = ?1"
      ).bind(tok.id).run();
    }

    const body = buildIcs(rows, {
      calName: tok.kind === "calendar_public" ? "Boomtown Volleyball — Events" : "Boomtown Volleyball — My Schedule",
      host: url.hostname,
      appUrl: env.APP_URL || "",
      tzid: await orgTimezone(env, tok.org_id),
    });
    return icsResponse(body, etag);
  } catch (e) {
    console.error("ics feed failed", e);
    return notFoundIcs();
  }
}

/* ==================== management routes ==================== */

export async function calendarRoutes(request, env, url, ctx) {
  const p = url.pathname;

  /* ---- member's own feed ---- */
  if (p === "/api/profile/calendar") {
    if (!ctx.session) return json({ error: "Sign in first." }, 401);
    const contact = await contactForSession(env, ctx);
    if (!contact) return json({ error: "No member record is linked to this sign-in yet." }, 404);

    if (request.method === "GET") {
      const t = await liveToken(env, ctx.orgId, "calendar_member", contact.id);
      return json({
        subscribed: !!t,
        created_at: t ? t.created_at : null,
        last_used_at: t ? t.last_used_at : null,
        // The raw token is unrecoverable by design — GET can never rebuild the URL.
        url: null,
        note: t ? "Your link exists. If you've lost it, create a new one — the old one stops working." : null,
      });
    }
    if (request.method === "POST") {
      const raw = await issue(env, {
        orgId: ctx.orgId, kind: "calendar_member", contactId: contact.id,
        label: contact.full_name || null, userId: ctx.userId,
      });
      await audit(env, ctx, "calendar.token.mint", "contacts", contact.id, { kind: "calendar_member" });
      return json({ ok: true, url: feedUrl(env, raw), once: true });
    }
    if (request.method === "DELETE") {
      const n = await revokeAll(env, ctx.orgId, "calendar_member", contact.id);
      await audit(env, ctx, "calendar.token.revoke", "contacts", contact.id, { revoked: n });
      return json({ ok: true, revoked: n });
    }
    return json({ error: "Method not allowed." }, 405);
  }

  /* ---- org-wide public feed (staff) ---- */
  if (p === "/api/admin/calendar") {
    const deny = await requireStaff(env, ctx);
    if (deny) return deny;

    if (request.method === "GET") {
      const t = await liveToken(env, ctx.orgId, "calendar_public", null);
      return json({
        subscribed: !!t, created_at: t ? t.created_at : null,
        last_used_at: t ? t.last_used_at : null, use_count: t ? t.use_count : 0, url: null,
      });
    }
    if (request.method === "POST") {
      const raw = await issue(env, {
        orgId: ctx.orgId, kind: "calendar_public", contactId: null,
        label: "Public events feed", userId: ctx.userId,
      });
      await audit(env, ctx, "calendar.token.mint", "orgs", ctx.orgId, { kind: "calendar_public" });
      return json({ ok: true, url: feedUrl(env, raw), once: true });
    }
    if (request.method === "DELETE") {
      const n = await revokeAll(env, ctx.orgId, "calendar_public", null);
      await audit(env, ctx, "calendar.token.revoke", "orgs", ctx.orgId, { revoked: n });
      return json({ ok: true, revoked: n });
    }
    return json({ error: "Method not allowed." }, 405);
  }

  return null;
}
