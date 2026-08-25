/**
 * Boomtown Platform — Registration + Square + Captain-scoring routes
 * Version: v2.1 · Date: 2026-08-12 · Modules 4 + 8 · Ships in: v0.132.0 · v2.1 in v0.136.0
 *
 * v2.1 (2026-08-12, v0.136.0): WF-4 — the registrations screen sees waivers and can chase them.
 *   listRegistrations gains per-row waiver counts (waiver_members/waiver_signed/waiver_no_email)
 *   through the door gate's canonical pair; the sweep's selection is extracted into ONE shared
 *   `waiverGaps` + `sendWaiverReminders`, and POST /api/events/:id/waiver-reminders is their
 *   second caller (staff-gated, 2-day dedupe binds it too, keyless-honest, counts the
 *   address-less instead of skipping them). Guarded by registrations_waivers.test.mjs.
 *
 * v2.0 (2026-08-11, v0.132.0): SG-1 — THE DROP-IN SHEET (roadmap §-1o; owner "sheets first").
 *   Two PUBLIC routes, living HERE because this module owns registration and contact writes:
 *     GET  /api/events/:id/sheet    → capacity, live count, who is coming ("First L." via
 *                                     personName, standards §8; nameless rows are "Guest")
 *     POST /api/events/:id/signup   → individual sign-up: one-tap for a session, name+email
 *                                     for a guest; free → 'comped', priced → the existing
 *                                     Square link path; team_id and waiver_id stay NULL
 *   The count, the list and the capacity gate all read ACTIVE_REG_STATUSES (now exported by
 *   waitlists.js) — one judgement of "taken". Guarded by signup_sheet.test.mjs.
 *
 * v1.9 (2026-08-05, v0.92.0): W-A — THE ROSTER A REGISTRATION CREATES IS FINALLY VISIBLE AND
 *   EDITABLE (roadmap §-1b; owner 2026-08-05: "the loading of teams and names is not linked
 *   clearly with registration … then that form populates after payment the roster page (which
 *   should be editable)"). submitRegistration has written teams + team_members since day one;
 *   no route ever read them back per-team and no screen could edit them. New, all staff-gated
 *   and org-scoped, living HERE because this module owns the team writes:
 *     GET    /api/admin/teams/:id            → team + members + the registration it came from
 *     PATCH  /api/admin/teams/:id            → rename / set level
 *     POST   /api/admin/teams/:id/members    → add a member {name, email?}
 *     PATCH  /api/admin/team-members/:id     → edit a member's name/email
 *     DELETE /api/admin/team-members/:id     → soft-delete (deleted_at, like everything else)
 *   listRegistrations now returns r.team_id so the registrations table can link to the roster.
 *
 * v1.8 (2026-07-29, v0.35.0): F-27 CLOSED — waiverReminderSweep's NOT EXISTS was a third
 *   hand-rolled copy of "has a live waiver" and it carried F-26 verbatim: `c.email =
 *   tm.member_email` is case-SENSITIVE in SQLite, and there was no contact_id branch at
 *   all. A captain-entered `Jane@X.com` against a contact `jane@x.com`, or a linked member
 *   whose waiver sits under a different email, was nagged daily despite a live waiver.
 *   Both halves now come from checkin.js's exported WAIVER_IDENTITY_MATCH +
 *   WAIVER_LIVE_PREDICATE — the same pair the door roster uses, so the sweep chases
 *   exactly the people the door flags. Correction for the record: v1.2's header (and
 *   checkin.js v1.3's F-27 note) said this function lived in waivers.js; it has always
 *   been here. Org scope (`c.org_id = e.org_id`) is unchanged — the canonical pair
 *   deliberately does not carry org, callers do.
 *
 * v1.7 (2026-07-29, v0.34.0): Option A testability — REMINDABLE_STATUSES + canRemind()
 *   extracted from two inline duplicates (remind, retryPayment) and exported;
 *   timingSafeEqual exported. Behaviour identical; registrations.test.mjs now guards it.
 *   F-22's 'raw throw at :163' is CLOSED-UNLOCATABLE: zero `throw ` statements exist in
 *   this file at v0.34.0 — the citation pointed at pre-v0.32.0 line numbers.
 *
 * v1.6 (2026-07-26, minors): submitRegistration is age-aware for the first time. Before v0.32.0
 *   this file contained zero matches for date_of_birth, guardian or minor across 49 KB — a
 *   participant of any age could be registered with no adult attached. D-MIN-9 + D-MIN-11, and
 *   the owner chose option B: registration itself is blocked, not merely account activation.
 *
 * v1.5 (2026-07-26): + waiverExpirySweep() — emails a member ~30 days before their waiver
 *   lapses. Calendar-driven, one notice per waiver row ever (dedupe on waiver_id, not on a
 *   time window). Pairs with the v0.23.0 door gate in checkin.js. D-WV-8.
 * Mounted by worker/src/index.js (same wire() pattern as tournaments.js).
 *
 * v1.4 (2026-07-26, Waiver versioning):
 *   - submitRegistration resolves the active waiver version via pinFor() BEFORE writing
 *     anything, stores waivers.version_id, and mirrors the label into waiver_text_version.
 *   - A form that rendered a superseded version is rejected 409 { waiver_stale:true } so a
 *     signature is never recorded against text the signer did not read.
 *   - No published waiver at all → 503; registrations stay closed rather than unwaivered.
 *
 * v1.3 (2026-07-25, Waitlists):
 *   - CAPACITY IS NOW ENFORCED: submitRegistration checks events.capacity against
 *     active registrations (pending/email-sent/paid/cash-pending/comped). Full → 409
 *     with { event_full:true, waitlist_available:true }; a valid ?wtoken= claim from
 *     a waitlist offer bypasses the check and marks the entry claimed (waitlists.js).
 *   - GET /api/events/:id/form now returns capacity / spots_taken / is_full.
 *   - NEW POST /api/registrations/:id/cancel (staff) — status → 'cancelled'
 *     (already in the day-one CHECK), then auto-offers the next waitlisted team.
 *
 * v1.2 (2026-07-24, RECOVERY — the v0.7.0 ZIP was never uploaded, so the v1.0/v1.1
 * edits were lost; this restores everything worker/src/index.js v0.9.x imports):
 *   - export sendEmail / escapeHtml / waiverReminderSweep (used by the daily cron)
 *   - v1.5 (2026-07-26): + waiverExpirySweep — T-30 notice before a waiver lapses (D-WV-8)
 *   - POST /api/registrations/:id/retry-payment — mint a FRESH Square link
 *     (Control Center "Rerun" button, admin-dash.js v1.0)
 *
 * Public routes:
 *   GET  /api/events/:id/form           event basics + custom form fields (published events only)
 *   POST /api/events/:id/register       submit a registration (creates contact/waiver/team/registration)
 *   POST /api/webhooks/square           Square webhook (HMAC-verified; flips pending → paid)
 *   GET  /api/score/:token              captain: team + unscored matches
 *   POST /api/score/:token              captain: score one match (2-tap contract: winner + diff)
 *
 * Staff routes (admin/staff role in the event's org):
 *   GET  /api/events/:id/registrations  list (?status= filter)
 *   POST /api/registrations/:id/remind  one-click payment reminder (Brevo, or sandbox link)
 *   POST /api/registrations/:id/mark-paid   cash collected → paid
 *   POST /api/events/:id/import         CSV rows (client-parsed JSON) from Google Forms sheets
 *   POST /api/events/:id/score-links    ensure per-team captain score links, return them
 *
 * Env (all optional — absent keys = sandbox behavior, nothing breaks):
 *   SQUARE_ACCESS_TOKEN          secret — sandbox token first (Square Developer Console)
 *   SQUARE_ENV                   'production' switches base URL; anything else = sandbox
 *   SQUARE_LOCATION_ID           fallback when orgs.square_location_id is empty
 *   SQUARE_WEBHOOK_SIGNATURE_KEY secret — from the webhook subscription
 *   SQUARE_WEBHOOK_URL           the EXACT notification URL registered with Square
 *
 * [FACT] Verified against Square docs 2026-07-21:
 *   - POST {base}/v2/online-checkout/payment-links with idempotency_key + quick_pay{name, price_money, location_id}
 *   - sandbox base: https://connect.squareupsandbox.com
 *   - webhook header x-square-hmacsha256-signature = base64 HMAC-SHA256(signature_key, notification_url + raw_body)
 */
import { refreshStandings } from "./tournaments.js";
import { advanceBracketFor } from "./brackets.js"; // v0.67.0 — no cycle: brackets.js imports only scheduler.js
import { waitlistGate, markClaimed, offerNext, activeRegistrationCount, computeIsFull, ACTIVE_REG_STATUSES } from "./waitlists.js";
import { personName } from "./names.js"; // v0.132.0 SG-1 — names.js imports nothing, no cycle
import { pinFor, currentVersion } from "./waivers.js"; // v1.4 — one-way import, no cycle
import { effectiveTierFor, applyTierDiscount } from "./tiers.js"; // v0.30.0 F-6 — tiers.js imports nothing, no cycle
import { senderIdentity } from "./orgs.js"; // v0.31.0 F-13 — orgs.js imports nothing, no cycle
// v0.32.0 — family.js imports only crypto.js, so this is one-way and cycle-free. These are the
// call sites F-6/F-17 recorded as missing since v0.27.0: built, tested, never invoked.
import { validateBirthdate, guardianGate, guardianshipFor, mintGuardianInvite } from "./family.js";
// v1.8 F-27 — checkin.js has ZERO static imports (wire pattern), so this is one-way, no cycle.
import { WAIVER_LIVE_PREDICATE, WAIVER_IDENTITY_MATCH } from "./checkin.js";

const SQUARE_VERSION = "2026-05-20";

let json, audit, isStaff, requireStaff;
export function wireRegistrations(helpers) { ({ json, audit, isStaff, requireStaff } = helpers); }

/** The only statuses a payment nudge or a payment-link rerun makes sense for. One list, two gates. */
export const REMINDABLE_STATUSES = ["pending", "email-sent"];
export function canRemind(status) { return REMINDABLE_STATUSES.includes(status); }

export async function registrationRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;
  let match;

  if ((match = p.match(/^\/api\/events\/(\d+)\/form$/)) && m === "GET") return eventForm(env, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/register$/)) && m === "POST") return submitRegistration(request, env, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/sheet$/)) && m === "GET") return eventSheet(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/signup$/)) && m === "POST") return sheetSignup(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/registrations$/)) && m === "GET") return listRegistrations(request, env, ctx, +match[1], url);
  if ((match = p.match(/^\/api\/events\/(\d+)\/waiver-reminders$/)) && m === "POST") return sendEventWaiverReminders(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/registrations\/(\d+)\/remind$/)) && m === "POST") return remind(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/registrations\/(\d+)\/mark-paid$/)) && m === "POST") return markPaid(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/registrations\/(\d+)\/cancel$/)) && m === "POST") return cancelRegistration(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/registrations\/(\d+)\/retry-payment$/)) && m === "POST") return retryPayment(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/team-members\/(\d+)\/invite$/)) && m === "POST") return inviteTeammate(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/admin\/teams\/(\d+)$/)) && m === "GET") return teamRoster(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/admin\/teams\/(\d+)$/)) && m === "PATCH") return patchTeam(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/admin\/teams\/(\d+)\/members$/)) && m === "POST") return addTeamMember(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/admin\/team-members\/(\d+)$/)) && m === "PATCH") return patchTeamMember(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/admin\/team-members\/(\d+)$/)) && m === "DELETE") return removeTeamMember(env, ctx, +match[1]);
  if (p === "/api/profile/connect-teams" && m === "POST") return connectTeams(env, ctx);
  if (p === "/api/profile/teams" && m === "GET") return myTeams(env, ctx);
  if ((match = p.match(/^\/api\/profile\/teams\/(\d+)\/email-scorelink$/)) && m === "POST") return emailScoreLink(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/import$/)) && m === "POST") return importRows(request, env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/score-links$/)) && m === "POST") return scoreLinks(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/score\/([a-f0-9]{16,64})$/))) {
    if (m === "GET") return captainMatches(env, match[1]);
    if (m === "POST") return captainScore(request, env, match[1]);
  }
  return null; // not a registration route
}

/* ================= public: form + submit ================= */

async function loadEvent(env, eventId) {
  return env.DB.prepare(
    "SELECT e.*, o.name AS org_name, o.square_location_id FROM events e JOIN orgs o ON o.id=e.org_id WHERE e.id=?1 AND e.deleted_at IS NULL"
  ).bind(eventId).first();
}

async function eventForm(env, eventId) {
  const ev = await loadEvent(env, eventId);
  if (!ev || !["published", "in_progress"].includes(ev.status)) {
    return json({ error: "This event isn't open for registration." }, 404);
  }
  // PM-1 rule 2 (§-1m, v0.147.0): an event that registers somewhere else must NOT hand back a
  // form, a price or a waiver. "Empty and broken look identical to a user" — a form nobody can
  // submit is worse than no form, because it looks like it works right up to the last button.
  // THE REFUSAL LIVES AT THE DESTINATION ON PURPOSE. Forking the sign-up button is the visible
  // half, but anyone can type `register.html?event=N`, so the one surface a stray link cannot
  // route around is this payload.
  const outward = String(ev.external_url == null ? "" : ev.external_url).trim();
  if (outward) {
    return json({
      event: {
        id: ev.id, org_id: ev.org_id, org_name: ev.org_name, name: ev.name, type: ev.type,
        starts_at: ev.starts_at, location: ev.location, price_cents: 0,
      },
      external_url: outward,
      external_label: String(ev.external_label == null ? "" : ev.external_label).trim() || null,
      fields: [],
    });
  }
  const fields = (await env.DB.prepare(
    "SELECT id, label, field_type, options_json, required, sort_order FROM form_fields WHERE org_id=?1 AND (event_id=?2 OR event_id IS NULL) AND deleted_at IS NULL ORDER BY sort_order, id"
  ).bind(ev.org_id, eventId).all()).results;
  const spotsTaken = await activeRegistrationCount(env, eventId); // v1.3: waitlist-aware form
  const wv = await currentVersion(env, ev.org_id); // v1.4: waiver text is a DB record now
  return json({
    event: {
      id: ev.id, org_id: ev.org_id, org_name: ev.org_name, name: ev.name, type: ev.type,
      starts_at: ev.starts_at, location: ev.location,
      price_cents: ev.price_cents || 0,
      cash_option_enabled: !!ev.cash_option_enabled,
      capacity: ev.capacity || null,
      spots_taken: spotsTaken,
      is_full: computeIsFull(ev.capacity, spotsTaken),
    },
    fields,
    // v1.4 — the waiver travels with the form so the text on screen and the version pinned
    // at submit come from the same read. A second round trip could straddle a publish.
    waiver: wv ? { id: wv.id, label: wv.label, body: wv.body, published_at: wv.published_at } : null,
  });
}

async function submitRegistration(request, env, eventId) {
  const ev = await loadEvent(env, eventId);
  if (!ev || !["published", "in_progress"].includes(ev.status)) {
    return json({ error: "This event isn't open for registration." }, 404);
  }
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (!b.team_name || !String(b.team_name).trim()) return json({ error: "Team name is required." }, 400);
  if (!b.captain_name || !String(b.captain_name).trim()) return json({ error: "Captain name is required." }, 400);
  if (!b.waiver_accepted || !b.waiver_signature) return json({ error: "The waiver must be accepted and signed to register." }, 400);

  /* ---------------- age gate (v0.32.0, D-MIN-9 / D-MIN-11, owner option B) ----------------
     Runs BEFORE the waiver pin, the capacity gate and every write. The order is the point: the
     reverse — create the registration, then ask about age — means a minor is already registered
     by the time an adult appears, which is the failure family.js exists to prevent.

     NOTE ON SCOPE, stated so it is not mistaken for coverage: this gates the REGISTRANT (the
     captain submitting the form). Team members are name+email rows with no date of birth and are
     not gated here. Extending the gate to a roster is a separate decision, not an oversight. */
  const dobCheck = validateBirthdate(b.date_of_birth);
  if (!dobCheck.ok) return json({ error: dobCheck.error, need_date_of_birth: true }, 400);

  if (dobCheck.minor) {
    // Find-or-create the contact first. D-MIN-9: the account IS created, it just is not active.
    let mc = await env.DB.prepare(
      "SELECT id, activation_state FROM contacts WHERE org_id=?1 AND email=?2 AND deleted_at IS NULL"
    ).bind(ev.org_id, email).first();
    if (!mc) {
      const ins = await env.DB.prepare(
        "INSERT INTO contacts (org_id, email, full_name, phone, activation_state) VALUES (?1,?2,?3,?4,'pending_guardian')"
      ).bind(ev.org_id, email, b.captain_name, b.captain_phone || null).run();
      mc = { id: ins.meta.last_row_id, activation_state: "pending_guardian" };
    }
    await env.DB.prepare(
      `INSERT INTO member_profiles (org_id, contact_id, date_of_birth, visibility, show_instagram)
       VALUES (?1, ?2, ?3, 'private', 0)
       ON CONFLICT(org_id, contact_id) DO UPDATE SET date_of_birth = excluded.date_of_birth,
                                                     updated_at = datetime('now')`
    ).bind(ev.org_id, mc.id, b.date_of_birth).run();

    // ONE age rule, not a second hand-rolled one. guardianGate decides; this file only reacts.
    // It also catches the case a bespoke `if (link)` would wave through: a linked "guardian" who
    // is not themselves a recorded adult.
    const link = await guardianshipFor(env, ev.org_id, mc.id);
    const gate = guardianGate({
      dateOfBirth: b.date_of_birth,
      guardian: link ? { id: link.guardian_contact_id, date_of_birth: link.guardian_dob } : null,
    });
    if (gate.ok) {
      await env.DB.prepare(
        "UPDATE contacts SET activation_state='active', updated_at=datetime('now') WHERE id=?1 AND org_id=?2"
      ).bind(mc.id, ev.org_id).run();
    } else {
      // Blocked (option B). Mint the invitation and hand back the link IN THE RESPONSE.
      // Brevo is paused, so an emailed-only invite would be a block with no key. The on-screen
      // link is the primary channel and email is the enhancement, never the other way round.
      await env.DB.prepare(
        "UPDATE contacts SET activation_state='pending_guardian', updated_at=datetime('now') WHERE id=?1 AND org_id=?2"
      ).bind(mc.id, ev.org_id).run();
      const inv = await mintGuardianInvite(env, ev.org_id, mc.id, `event:${eventId}`);
      const base = (env.APP_URL || "").replace(/\/+$/, "");
      await audit(env, { orgId: ev.org_id, userId: null }, "family.guardian_invite_issued", "contacts", mc.id,
        { event: eventId, age: dobCheck.age });
      return json({
        error: gate.reason === "guardian_is_minor"
          ? gate.error
          : "This participant is under 18, so a parent or guardian has to complete their own account first. Send them the link below; registration finishes once they confirm.",
        guardian_required: true,
        reason: gate.reason,
        age: dobCheck.age,
        contact_id: mc.id,
        // FRAGMENT, not a query string. A capability token in ?t= lands in server access logs
        // and in the Referer header of every outbound link on the page. sign.html already
        // established this pattern in v0.25.0 for the same reason.
        invite_url: `${base}/guardian-complete.html#t=${inv.token}`,
        invite_expires_at: inv.expires_at,
      }, 409);
    }
  }

  // v1.4 — resolve the waiver version BEFORE anything is written. If the browser rendered an
  // older version than the one now active, refuse: recording consent to text the signer never
  // read is the one failure mode waiver versioning exists to prevent.
  const pin = await pinFor(env, ev.org_id, b.waiver_version_id);
  if (!pin.ok) {
    return json({ error: pin.error, waiver_stale: !!pin.stale, current_version_id: pin.current_version_id }, pin.status);
  }
  const waiverVersion = pin.version;
  const payMethod = b.payment_method === "cash" ? "cash" : "square";
  if (payMethod === "cash" && !ev.cash_option_enabled) {
    return json({ error: "Cash payment isn't available for this event." }, 400); // hidden option enforced server-side
  }

  // v1.3: capacity gate — a valid waitlist claim token admits into a full event.
  const wtoken = String(b.waitlist_token || "").trim() || null;
  const gate = await waitlistGate(env, ev, email, wtoken);
  if (!gate.allowed) {
    return json({ error: gate.error, event_full: true, waitlist_available: !wtoken }, 409);
  }

  // Idempotency, two distinct cases (v0.116.0 widened the second):
  //  - An OPEN registration for this email+event returns its existing checkout link, whatever
  //    the team name — the person is mid-flow and gets their own link back.
  //  - A COMPLETED one ('paid'/'comped') blocks a re-submit only when the TEAM NAME matches:
  //    free events complete instantly as 'comped', so before this branch existed a double-click
  //    on a slow connection wrote two full registrations (two teams, two waivers). The name is
  //    the key because the same captain registering a SECOND team is legitimate and must pass.
  const existing = await env.DB.prepare(
    `SELECT r.id, r.status, r.checkout_url FROM registrations r JOIN contacts c ON c.id=r.contact_id
     LEFT JOIN teams t ON t.id=r.team_id
     WHERE r.event_id=?1 AND c.email=?2 AND r.deleted_at IS NULL
       AND (r.status IN ('pending','email-sent','cash-pending')
            OR (r.status IN ('paid','comped') AND lower(t.name)=lower(?3)))`
  ).bind(eventId, email, String(b.team_name).trim()).first();
  if (existing) {
    const done = existing.status === "paid" || existing.status === "comped";
    return json({ ok: true, duplicate: true, registration_id: existing.id, status: existing.status,
      checkout_url: existing.checkout_url || null,
      message: done ? "You're already registered for this event. See you there!"
                    : "You already have a registration in progress for this event." });
  }

  // Contact (find-or-create per org)
  let contact = await env.DB.prepare(
    "SELECT id FROM contacts WHERE org_id=?1 AND email=?2 AND deleted_at IS NULL"
  ).bind(ev.org_id, email).first();
  if (contact) {
    await env.DB.prepare(
      "UPDATE contacts SET full_name=?1, phone=?2, city=?3, state=?4, instagram=?5, updated_at=datetime('now') WHERE id=?6"
    ).bind(b.captain_name, b.captain_phone || null, b.city || null, b.state || null, b.instagram || null, contact.id).run();
  } else {
    const ins = await env.DB.prepare(
      "INSERT INTO contacts (org_id, email, full_name, phone, city, state, instagram) VALUES (?1,?2,?3,?4,?5,?6,?7)"
    ).bind(ev.org_id, email, b.captain_name, b.captain_phone || null, b.city || null, b.state || null, b.instagram || null).run();
    contact = { id: ins.meta.last_row_id };
  }

  // v0.32.0 — record the date of birth for every registrant, not only minors. ageOn() reads it
  // at render time; nothing stores an is_minor boolean, which would be correct until a birthday.
  await env.DB.prepare(
    `INSERT INTO member_profiles (org_id, contact_id, date_of_birth, visibility)
     VALUES (?1, ?2, ?3, 'members')
     ON CONFLICT(org_id, contact_id) DO UPDATE SET date_of_birth = excluded.date_of_birth,
                                                   updated_at = datetime('now')`
  ).bind(ev.org_id, contact.id, b.date_of_birth).run();

  // Waiver (annual) — v1.4: pinned to the exact published version the form rendered.
  const expires = new Date(Date.now() + 365 * 86400000).toISOString();
  const wIns = await env.DB.prepare(
    "INSERT INTO waivers (org_id, contact_id, waiver_text_version, version_id, signed_at, expires_at, signature_name) VALUES (?1,?2,?3,?4,datetime('now'),?5,?6)"
  ).bind(ev.org_id, contact.id, waiverVersion.label, waiverVersion.id, expires, String(b.waiver_signature).trim()).run();

  // Team + members
  const tIns = await env.DB.prepare(
    "INSERT INTO teams (org_id, event_id, name, level, gender_division, captain_contact_id) VALUES (?1,?2,?3,?4,?5,?6)"
  ).bind(ev.org_id, eventId, String(b.team_name).trim(), b.team_level || null, b.gender_division || null, contact.id).run();
  const teamId = tIns.meta.last_row_id;
  await env.DB.prepare(
    "INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES (?1,?2,?3,?4,?5)"
  ).bind(ev.org_id, teamId, contact.id, b.captain_name, email).run();
  for (const tm of (Array.isArray(b.teammates) ? b.teammates.slice(0, 6) : [])) {
    const name = String(tm.name || "").trim();
    if (!name || name.toLowerCase() === "none") continue;
    await env.DB.prepare(
      "INSERT INTO team_members (org_id, team_id, member_name, member_email) VALUES (?1,?2,?3,?4)"
    ).bind(ev.org_id, teamId, name, (tm.email || "").trim().toLowerCase() || null).run();
  }

  // Registration
  //
  // F-6 (v0.30.0): applyTierDiscount shipped in v0.26.0 with zero call sites. This is the call site.
  // The discounted figure is WRITTEN TO registrations.price_cents (migration 0024) rather than
  // recomputed at checkout, because the grant can lapse between registering and paying — recomputing
  // would quote one price on the confirmation screen and charge another at Square. The price the
  // member was shown is the price that gets charged. retryPayment reads the stored value and falls
  // back to events.price_cents when it is NULL, so the rows that predate this release are unaffected.
  const listPrice = ev.price_cents || 0;
  const tier = await effectiveTierFor(env, ev.org_id, contact.id);
  const price = applyTierDiscount(listPrice, (tier && tier.discount_bps) || 0);
  let status = payMethod === "cash" ? "cash-pending" : (price === 0 ? "comped" : "pending");

  // F-5 (v0.30.0): capacity is re-checked INSIDE the insert. A single INSERT...SELECT...WHERE is
  // atomic, so exactly one of two concurrent submits sees changes === 1 — the same reasoning as the
  // token consumption in consent.js postSign. waitlistGate read the count ~55 lines earlier with
  // four D1 round trips in between, so both submits passed. The status list must stay identical to
  // ACTIVE_REG_STATUSES in waitlists.js. A valid waitlist claim bypasses the check by design: it was
  // deliberately admitted into a full event.
  const claimBypass = wtoken ? 1 : 0;
  const rIns = await env.DB.prepare(
    `INSERT INTO registrations (org_id, event_id, contact_id, team_id, status, payment_method, waiver_id, price_cents)
     SELECT ?1,?2,?3,?4,?5,?6,?7,?8
      WHERE ?9 = 1
         OR (SELECT capacity FROM events WHERE id = ?2) IS NULL
         OR (SELECT capacity FROM events WHERE id = ?2) <= 0
         OR (SELECT COUNT(*) FROM registrations
              WHERE event_id = ?2 AND deleted_at IS NULL
                AND status IN ('pending','email-sent','paid','cash-pending','comped'))
            < (SELECT capacity FROM events WHERE id = ?2)`
  ).bind(ev.org_id, eventId, contact.id, teamId, status, price === 0 ? "comp" : payMethod,
         wIns.meta.last_row_id, price, claimBypass).run();

  if (!rIns.meta || rIns.meta.changes === 0) {
    return json({
      error: "This event filled while you were registering. Join the waitlist and we'll offer you the next open spot.",
      event_full: true, waitlist_available: true,
    }, 409);
  }
  const regId = rIns.meta.last_row_id;

  // Custom field responses
  if (b.custom && typeof b.custom === "object") {
    for (const [fieldId, value] of Object.entries(b.custom)) {
      const f = await env.DB.prepare(
        "SELECT id, label FROM form_fields WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
      ).bind(+fieldId, ev.org_id).first();
      if (f) {
        await env.DB.prepare(
          "INSERT INTO form_responses (org_id, registration_id, field_id, field_label, value) VALUES (?1,?2,?3,?4,?5)"
        ).bind(ev.org_id, regId, f.id, f.label, String(value).slice(0, 2000)).run();
      }
    }
  }

  await audit(env, { orgId: ev.org_id, userId: null }, "registration.create", "registrations", regId, { event: eventId, method: payMethod });
  if (gate.waitlistId) await markClaimed(env, gate.waitlistId, regId); // v1.3: waitlist claim completed

  // Payment
  if (status === "cash-pending") {
    await env.DB.prepare(
      "INSERT INTO notifications (org_id, kind, target, payload_json) VALUES (?1,'cash_pending','admin',?2)"
    ).bind(ev.org_id, JSON.stringify({ registration_id: regId, team: b.team_name, event: ev.name })).run();
    return json({ ok: true, registration_id: regId, status,
      message: "Registered with cash payment. Please bring payment to check-in; an organizer has been notified." });
  }
  if (status === "comped") {
    return json({ ok: true, registration_id: regId, status, message: "Registered! This event is free. See you there!" });
  }

  const link = await createSquareLink(env, ev, `${ev.name} · ${b.team_name}`, price, regId);
  if (link.error) {
    // Square not configured or call failed — registration is saved; payment happens via reminder later.
    return json({ ok: true, registration_id: regId, status: "pending", mode: "sandbox",
      message: "Registered! Online payment isn't connected yet; the organizer will send a payment link.", detail: link.error });
  }
  await env.DB.prepare(
    "UPDATE registrations SET square_order_id=?1, checkout_url=?2, updated_at=datetime('now') WHERE id=?3"
  ).bind(link.order_id, link.url, regId).run();
  return json({ ok: true, registration_id: regId, status: "pending", checkout_url: link.url,
    message: "Registered! Complete payment to lock in your spot." });
}

async function createSquareLink(env, ev, itemName, amountCents, regId, idemKey) {
  if (!env.SQUARE_ACCESS_TOKEN) return { error: "SQUARE_ACCESS_TOKEN not set (sandbox mode)" };
  const locationId = ev.square_location_id || env.SQUARE_LOCATION_ID;
  if (!locationId) return { error: "No Square location ID configured for this org" };
  const base = env.SQUARE_ENV === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
  try {
    const resp = await fetch(base + "/v2/online-checkout/payment-links", {
      method: "POST",
      headers: {
        "Square-Version": SQUARE_VERSION,
        "Authorization": "Bearer " + env.SQUARE_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: idemKey || `bt-reg-${regId}`,
        quick_pay: {
          name: itemName.slice(0, 120),
          price_money: { amount: amountCents, currency: "USD" },
          location_id: locationId,
        },
        checkout_options: {
          redirect_url: `${env.APP_URL}/register.html?event=${ev.id}&done=1`,
        },
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.payment_link) {
      console.error("Square payment link failed", resp.status, JSON.stringify(data.errors || data));
      return { error: `Square error ${resp.status}` };
    }
    return { url: data.payment_link.url, order_id: data.payment_link.order_id };
  } catch (e) {
    console.error("Square fetch failed", e);
    return { error: "Square unreachable" };
  }
}

/* ================= public: the drop-in sheet (§-1o SG-1, v0.132.0) ================= */

/** Sheets exist for drop-in shapes only; league/tournament registration is a team with a waiver. */
const SHEET_TYPES = ["training", "event"];

async function loadSheetEvent(env, eventId) {
  const ev = await loadEvent(env, eventId);
  if (!ev || !SHEET_TYPES.includes(ev.type) || !["published", "in_progress"].includes(ev.status)) return null;
  return ev;
}

/**
 * The PUBLIC sheet: capacity, live count, who is coming. A no-login surface, so standards §8
 * governs every field — names arrive already reduced to "First L." (personName; a member who
 * chose public visibility keeps their full name), a nameless row is "Guest" (never an email
 * local part), and the payload carries no email, phone or contact id at all. The count and the
 * list read the SAME predicate the registration flow enforces (ACTIVE_REG_STATUSES /
 * activeRegistrationCount / computeIsFull) — one judgement of "taken", not two.
 */
async function eventSheet(env, ctx, eventId) {
  const ev = await loadSheetEvent(env, eventId);
  if (!ev) return json({ error: "This event doesn't have a public sign-up sheet." }, 404);
  // PM-1 rule 2, the drop-in half. Same reasoning as eventForm: a live count and a list of who is
  // coming, on a session nobody can sign up for here, is a surface that will never receive data.
  const outward = String(ev.external_url == null ? "" : ev.external_url).trim();
  if (outward) {
    return json({
      event: { id: ev.id, name: ev.name, type: ev.type, starts_at: ev.starts_at, location: ev.location },
      external_url: outward,
      external_label: String(ev.external_label == null ? "" : ev.external_label).trim() || null,
      people: [],
    });
  }
  const spotsTaken = await activeRegistrationCount(env, eventId);
  const rows = (await env.DB.prepare(
    `SELECT c.full_name AS full_name, mp.visibility AS visibility
       FROM registrations r
       LEFT JOIN contacts c ON c.id = r.contact_id
       LEFT JOIN member_profiles mp ON mp.contact_id = c.id AND mp.org_id = r.org_id AND mp.deleted_at IS NULL
      WHERE r.event_id = ?1 AND r.deleted_at IS NULL AND r.status IN ${ACTIVE_REG_STATUSES}
      ORDER BY r.created_at, r.id`
  ).bind(eventId).all()).results;
  const attendees = rows.map((r) => personName(r.full_name, { visibility: r.visibility }) || "Guest");
  const payload = {
    event: {
      id: ev.id, name: ev.name, org_name: ev.org_name, type: ev.type,
      starts_at: ev.starts_at, ends_at: ev.ends_at, location: ev.location,
      price_cents: ev.price_cents || 0,
      capacity: ev.capacity || null,
      spots_taken: spotsTaken,
      is_full: computeIsFull(ev.capacity, spotsTaken),
    },
    attendees,
  };
  if (ctx && ctx.userId) {
    // Only ever a boolean about the CALLER — the sheet stays anonymous for everyone else.
    const mine = await env.DB.prepare(
      `SELECT 1 AS x FROM registrations r
         JOIN contacts c ON c.id = r.contact_id
         JOIN users u ON lower(u.email) = lower(c.email)
        WHERE r.event_id = ?1 AND u.id = ?2 AND r.deleted_at IS NULL AND r.status IN ${ACTIVE_REG_STATUSES}`
    ).bind(eventId, ctx.userId).first();
    payload.viewer = { signed_up: !!mine };
  }
  return json(payload);
}

/**
 * Individual sign-up: one tap for a signed-in member, name+email for a guest. The row it writes
 * IS a registration (team_id and waiver_id NULL — both nullable since migration 0001), so the
 * count, the staff list, cancel-and-notify and the waitlist all see it with no new plumbing.
 *
 * Decisions this route encodes, each deliberate:
 *  · A session OWNS the identity — the email always comes from the account, so signing somebody
 *    else up is not expressible (a body email is ignored, like /api/me ignores foreign ids).
 *  · The name for a signed-in caller is their own record (contact name, else account display
 *    name); a typed name is only used when both are absent (need_name), so the sheet never
 *    becomes a side-door writer of someone's stored name — fill-if-empty only, in both branches.
 *  · D-13: junk email is NO address — refuse 400, store nothing. Honeypot + a per-event flood
 *    band follow the signup-widget idiom (publicSignup in marketing.js).
 *  · No DOB and no waiver here: same exposure class as the public waitlist join (name+email),
 *    and the check-in door gate (WAIVER_LIVE_PREDICATE) remains the waiver enforcement point.
 *  · Free completes as 'comped'; priced runs the EXISTING payment flow (tier discount written to
 *    the row, Square link or honest sandbox message) — never a silent free registration.
 */
async function sheetSignup(request, env, ctx, eventId) {
  const ev = await loadSheetEvent(env, eventId);
  if (!ev) return json({ error: "This event doesn't have a public sign-up sheet." }, 404);
  const b = await request.json().catch(() => ({}));
  if (b.hp) return json({ ok: true, message: "You're on the list!" }); // honeypot: bots see success, nothing is stored

  let email = null, sessionUser = null;
  if (ctx && ctx.userId) {
    sessionUser = await env.DB.prepare(
      "SELECT id, email, display_name FROM users WHERE id=?1 AND deleted_at IS NULL"
    ).bind(ctx.userId).first();
    if (!sessionUser) return json({ error: "Not signed in." }, 401);
    email = String(sessionUser.email).trim().toLowerCase();
  } else {
    email = String(b.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  }
  const bodyName = String(b.name || "").trim().slice(0, 120);
  if (!sessionUser && !bodyName) {
    return json({ error: "Your name is required; it's how the organizer knows who's coming." }, 400);
  }

  // Flood band (publicSignup idiom): cap sign-ups per event per window, before any write.
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM registrations WHERE event_id=?1 AND created_at >= datetime('now','-10 minutes')"
  ).bind(eventId).first();
  if (recent.n >= 30) return json({ error: "Too many sign-ups right now. Try again in a few minutes." }, 429);

  // Duplicate BEFORE capacity: a double tap on a full sheet means "you're on it", not "it's full".
  const existing = await env.DB.prepare(
    `SELECT r.id, r.status, r.checkout_url FROM registrations r JOIN contacts c ON c.id = r.contact_id
      WHERE r.event_id=?1 AND lower(c.email)=?2 AND r.deleted_at IS NULL AND r.status IN ${ACTIVE_REG_STATUSES}`
  ).bind(eventId, email).first();
  if (existing) {
    return json({ ok: true, duplicate: true, registration_id: existing.id, status: existing.status,
      checkout_url: existing.checkout_url || null,
      message: existing.checkout_url && canRemind(existing.status)
        ? "You're already signed up. Finish payment with your link."
        : "You're already on this sheet. See you there!" });
  }

  let contact = await env.DB.prepare(
    "SELECT id, full_name FROM contacts WHERE org_id=?1 AND lower(email)=?2 AND deleted_at IS NULL"
  ).bind(ev.org_id, email).first();
  const name = sessionUser
    ? ((contact && contact.full_name) || String(sessionUser.display_name || "").trim() || bodyName || null)
    : bodyName;
  if (!name) {
    return json({ error: "Add your name so the organizer knows who's coming.", need_name: true }, 400);
  }
  if (!contact) {
    const ins = await env.DB.prepare(
      "INSERT INTO contacts (org_id, email, full_name) VALUES (?1,?2,?3)"
    ).bind(ev.org_id, email, name).run();
    contact = { id: ins.meta.last_row_id, full_name: name };
  } else if (!contact.full_name) {
    await env.DB.prepare(
      "UPDATE contacts SET full_name=?1, updated_at=datetime('now') WHERE id=?2"
    ).bind(name, contact.id).run();
  }

  // F-6: the same two pricing calls the registration flow runs; the figure quoted is the figure written.
  const listPrice = ev.price_cents || 0;
  const tier = await effectiveTierFor(env, ev.org_id, contact.id);
  const price = applyTierDiscount(listPrice, (tier && tier.discount_bps) || 0);
  const status = price === 0 ? "comped" : "pending";
  const method = price === 0 ? "comp" : "square";

  // F-5: capacity re-checked INSIDE the atomic INSERT, against the same statuses the count reads.
  const rIns = await env.DB.prepare(
    `INSERT INTO registrations (org_id, event_id, contact_id, status, payment_method, price_cents)
     SELECT ?1,?2,?3,?4,?5,?6
      WHERE (SELECT capacity FROM events WHERE id = ?2) IS NULL
         OR (SELECT capacity FROM events WHERE id = ?2) <= 0
         OR (SELECT COUNT(*) FROM registrations
              WHERE event_id = ?2 AND deleted_at IS NULL AND status IN ${ACTIVE_REG_STATUSES})
            < (SELECT capacity FROM events WHERE id = ?2)`
  ).bind(ev.org_id, eventId, contact.id, status, method, price).run();
  if (!rIns.meta || rIns.meta.changes === 0) {
    return json({
      error: "This session is full. Join the waitlist and we'll email you if a spot opens.",
      event_full: true, waitlist_available: true,
    }, 409);
  }
  const regId = rIns.meta.last_row_id;
  await audit(env, { orgId: ev.org_id, userId: (ctx && ctx.userId) || null }, "registration.create",
    "registrations", regId, { event: eventId, method, via: "sheet" });

  if (status === "comped") {
    return json({ ok: true, registration_id: regId, status,
      message: listPrice === 0
        ? "You're on the list! This session is free. See you on the court!"
        : "You're on the list! Your membership covers this one. See you on the court!" });
  }
  const link = await createSquareLink(env, ev, `${ev.name} · ${name}`, price, regId);
  if (link.error) {
    return json({ ok: true, registration_id: regId, status: "pending", mode: "sandbox",
      message: "You're signed up! Online payment isn't connected yet; the organizer will send a payment link.",
      detail: link.error });
  }
  await env.DB.prepare(
    "UPDATE registrations SET square_order_id=?1, checkout_url=?2, updated_at=datetime('now') WHERE id=?3"
  ).bind(link.order_id, link.url, regId).run();
  return json({ ok: true, registration_id: regId, status: "pending", checkout_url: link.url,
    message: "You're signed up! Complete payment to lock in your spot." });
}

/* ================= Square webhook ================= */

export async function squareWebhook(request, env) {
  const raw = await request.text();
  const sig = request.headers.get("x-square-hmacsha256-signature") || "";
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY || !env.SQUARE_WEBHOOK_URL) {
    return json({ error: "Webhook not configured." }, 503);
  }
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(env.SQUARE_WEBHOOK_URL + raw));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (!timingSafeEqual(expected, sig)) return json({ error: "Invalid signature." }, 401);

  let body; try { body = JSON.parse(raw); } catch { return json({ ok: true, ignored: "bad json" }); }
  const type = body.type || "";
  const payment = body?.data?.object?.payment;
  if (type.startsWith("payment.") && payment && payment.order_id) {
    const reg = await env.DB.prepare(
      "SELECT id, org_id, status FROM registrations WHERE square_order_id=?1 AND deleted_at IS NULL"
    ).bind(payment.order_id).first();
    if (reg) {
      await env.DB.prepare(
        `INSERT INTO payments (org_id, registration_id, square_payment_id, square_order_id, amount_cents, currency, status, raw_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(square_payment_id) DO UPDATE SET status=?7, raw_json=?8, updated_at=datetime('now')`
      ).bind(reg.org_id, reg.id, payment.id, payment.order_id,
        payment.amount_money?.amount ?? null, payment.amount_money?.currency ?? "USD",
        payment.status || null, JSON.stringify(payment).slice(0, 10000)).run();
      if (payment.status === "COMPLETED" && reg.status !== "paid") {
        await env.DB.prepare("UPDATE registrations SET status='paid', updated_at=datetime('now') WHERE id=?1").bind(reg.id).run();
        await audit(env, { orgId: reg.org_id, userId: null }, "registration.paid", "registrations", reg.id, { via: "square-webhook" });
      }
    }
  }
  return json({ ok: true }); // always 200 after verification so Square stops retrying
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/* ================= staff: list / remind / cash / import ================= */

async function staffEventGate(env, ctx, eventId) {
  const ev = await loadEvent(env, eventId);
  if (!ev) return { deny: json({ error: "Event not found." }, 404) };
  const deny = await requireStaff(env, ctx, ev.org_id);
  return { ev, deny };
}

async function listRegistrations(request, env, ctx, eventId, url) {
  const { ev, deny } = await staffEventGate(env, ctx, eventId);
  if (deny) return deny;
  const status = url.searchParams.get("status");
  // WF-4 (v0.136.0): per-row waiver counts, through the door gate's own pair — the chips on the
  // registrations screen and the door roster read ONE judgement (F-27), never a second spelling.
  // NOTE ON ALIASES: the canonical pair hardcodes `c` (contacts) and `w` (waivers) INSIDE each
  // EXISTS, deliberately shadowing this query's outer `c` — the roster query does the same.
  // A team-less row (an SG-1 sheet sign-up) aggregates over its own registrant: one person,
  // identity by contact id through the same canonical function (email leg NULL).
  const selfSigned = `EXISTS (SELECT 1 FROM contacts c JOIN waivers w ON w.contact_id = c.id AND ${WAIVER_LIVE_PREDICATE}
         WHERE c.org_id = ?2 AND c.deleted_at IS NULL AND ${WAIVER_IDENTITY_MATCH("r.contact_id", "NULL")})`;
  const memberSigned = `EXISTS (SELECT 1 FROM contacts c JOIN waivers w ON w.contact_id = c.id AND ${WAIVER_LIVE_PREDICATE}
              WHERE c.org_id = ?2 AND c.deleted_at IS NULL AND ${WAIVER_IDENTITY_MATCH("tm.contact_id", "tm.member_email")})`;
  const base = `SELECT r.id, r.status, r.payment_method, r.checkout_url, r.last_reminded_at, r.created_at,
      r.team_id, c.email, c.full_name AS captain_name, c.phone, t.name AS team_name, t.level, t.gender_division,
      CASE WHEN r.team_id IS NULL THEN 1 ELSE
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = r.team_id AND tm.deleted_at IS NULL)
      END AS waiver_members,
      CASE WHEN r.team_id IS NULL THEN
        (CASE WHEN ${selfSigned} THEN 1 ELSE 0 END)
      ELSE
        (SELECT COUNT(*) FROM team_members tm
          WHERE tm.team_id = r.team_id AND tm.deleted_at IS NULL AND ${memberSigned})
      END AS waiver_signed,
      CASE WHEN r.team_id IS NULL THEN 0 ELSE
        (SELECT COUNT(*) FROM team_members tm
          WHERE tm.team_id = r.team_id AND tm.deleted_at IS NULL
            AND tm.member_email IS NULL AND NOT ${memberSigned})
      END AS waiver_no_email
    FROM registrations r
    LEFT JOIN contacts c ON c.id=r.contact_id
    LEFT JOIN teams t ON t.id=r.team_id
    WHERE r.event_id=?1 AND r.deleted_at IS NULL`;
  const rows = status
    ? (await env.DB.prepare(base + " AND r.status=?3 ORDER BY r.created_at DESC").bind(eventId, ev.org_id, status).all()).results
    : (await env.DB.prepare(base + " ORDER BY r.created_at DESC").bind(eventId, ev.org_id).all()).results;
  return json({ event: { id: ev.id, name: ev.name, price_cents: ev.price_cents || 0 }, registrations: rows });
}

/* ================= W-A (v0.92.0): the roster a registration creates ================= */

/** One team, its people, and the registration that made it — the link the owner asked to SEE. */
async function teamRoster(env, ctx, teamId) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const team = await env.DB.prepare(
    `SELECT t.id, t.name, t.level, t.gender_division, t.captain_contact_id, t.event_id,
            e.name AS event_name, e.type AS event_type
     FROM teams t JOIN events e ON e.id = t.event_id
     WHERE t.id=?1 AND t.org_id=?2 AND t.deleted_at IS NULL`
  ).bind(teamId, ctx.orgId).first();
  if (!team) return json({ error: "That team doesn't exist." }, 404);
  const members = (await env.DB.prepare(
    `SELECT id, contact_id, member_name, member_email FROM team_members
     WHERE team_id=?1 AND org_id=?2 AND deleted_at IS NULL ORDER BY id`
  ).bind(teamId, ctx.orgId).all()).results;
  const registration = await env.DB.prepare(
    `SELECT id, status, payment_method, created_at FROM registrations
     WHERE team_id=?1 AND org_id=?2 AND deleted_at IS NULL ORDER BY id LIMIT 1`
  ).bind(teamId, ctx.orgId).first();
  return json({ team, members, registration: registration || null });
}

async function patchTeam(request, env, ctx, teamId) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const row = await env.DB.prepare(
    "SELECT id FROM teams WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(teamId, ctx.orgId).first();
  if (!row) return json({ error: "That team doesn't exist." }, 404);
  const b = await request.json().catch(() => ({}));
  const sets = [], vals = [];
  if ("name" in b) {
    const name = String(b.name || "").trim();
    if (!name) return json({ error: "A team needs a name." }, 400);
    vals.push(name); sets.push(`name=?${vals.length}`);
  }
  if ("level" in b) { vals.push(String(b.level || "").trim() || null); sets.push(`level=?${vals.length}`); }
  if (!sets.length) return json({ error: "Nothing to change." }, 400);
  vals.push(teamId, ctx.orgId);
  await env.DB.prepare(
    `UPDATE teams SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=?${vals.length - 1} AND org_id=?${vals.length}`
  ).bind(...vals).run();
  await audit(env, ctx, "team.update", "teams", teamId, b);
  return teamRoster(env, ctx, teamId);
}

async function addTeamMember(request, env, ctx, teamId) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const team = await env.DB.prepare(
    "SELECT id FROM teams WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(teamId, ctx.orgId).first();
  if (!team) return json({ error: "That team doesn't exist." }, 404);
  const b = await request.json().catch(() => ({}));
  const name = String(b.name || "").trim();
  if (!name) return json({ error: "A member needs a name." }, 400);
  const email = String(b.email || "").trim().toLowerCase() || null;
  await env.DB.prepare(
    "INSERT INTO team_members (org_id, team_id, member_name, member_email) VALUES (?1,?2,?3,?4)"
  ).bind(ctx.orgId, teamId, name, email).run();
  await audit(env, ctx, "team.member_added", "teams", teamId, { name });
  return teamRoster(env, ctx, teamId);
}

async function patchTeamMember(request, env, ctx, memberId) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const row = await env.DB.prepare(
    "SELECT id, team_id FROM team_members WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(memberId, ctx.orgId).first();
  if (!row) return json({ error: "That person isn't on the roster." }, 404);
  const b = await request.json().catch(() => ({}));
  const sets = [], vals = [];
  if ("name" in b) {
    const name = String(b.name || "").trim();
    if (!name) return json({ error: "A member needs a name." }, 400);
    vals.push(name); sets.push(`member_name=?${vals.length}`);
  }
  if ("email" in b) { vals.push(String(b.email || "").trim().toLowerCase() || null); sets.push(`member_email=?${vals.length}`); }
  if (!sets.length) return json({ error: "Nothing to change." }, 400);
  vals.push(memberId, ctx.orgId);
  await env.DB.prepare(
    `UPDATE team_members SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=?${vals.length - 1} AND org_id=?${vals.length}`
  ).bind(...vals).run();
  await audit(env, ctx, "team.member_updated", "team_members", memberId, b);
  return teamRoster(env, ctx, row.team_id);
}

async function removeTeamMember(env, ctx, memberId) {
  const deny = await requireStaff(env, ctx);
  if (deny) return deny;
  const row = await env.DB.prepare(
    "SELECT id, team_id, member_name FROM team_members WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(memberId, ctx.orgId).first();
  if (!row) return json({ error: "That person isn't on the roster." }, 404);
  await env.DB.prepare(
    "UPDATE team_members SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?1 AND org_id=?2"
  ).bind(memberId, ctx.orgId).run();
  await audit(env, ctx, "team.member_removed", "team_members", memberId, { name: row.member_name });
  return teamRoster(env, ctx, row.team_id);
}

async function remind(env, ctx, regId) {
  const reg = await env.DB.prepare(
    `SELECT r.*, c.email, t.name AS team_name, e.name AS event_name, e.org_id AS ev_org
     FROM registrations r LEFT JOIN contacts c ON c.id=r.contact_id
     LEFT JOIN teams t ON t.id=r.team_id JOIN events e ON e.id=r.event_id
     WHERE r.id=?1 AND r.deleted_at IS NULL`
  ).bind(regId).first();
  if (!reg) return json({ error: "Registration not found." }, 404);
  const deny = await requireStaff(env, ctx, reg.ev_org);
  if (deny) return deny;
  if (!canRemind(reg.status)) return json({ error: `Can't remind a registration with status '${reg.status}'.` }, 400);
  if (!reg.checkout_url) return json({ error: "No payment link exists yet for this registration (Square not connected when they registered)." }, 400);

  await env.DB.prepare("UPDATE registrations SET last_reminded_at=datetime('now') WHERE id=?1").bind(regId).run();

  // F-13 (v0.31.0): reg.ev_org is the org that owns this event, so this path can name itself
  // correctly. Resolved before the request is built — a null sender is a refusal, not a guess.
  const mailFrom = await senderIdentity(env, reg.ev_org);
  if (env.BREVO_API_KEY && mailFrom) {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        sender: mailFrom,
        to: [{ email: reg.email }],
        subject: `Payment reminder · ${reg.event_name}`,
        htmlContent: `<p>Hi! Your team <strong>${reg.team_name}</strong> is registered for <strong>${reg.event_name}</strong>, but payment hasn't come through yet.</p><p><a href="${reg.checkout_url}">Complete your payment here</a> to lock in your spot.</p>`,
      }),
    });
    if (!resp.ok) return json({ error: "Reminder email failed to send. Try again." }, 502);
    await env.DB.prepare("UPDATE registrations SET status='email-sent', updated_at=datetime('now') WHERE id=?1 AND status='pending'").bind(regId).run();
    await audit(env, { orgId: reg.ev_org, userId: ctx.userId }, "registration.remind", "registrations", regId, { mode: "email" });
    return json({ ok: true, mode: "email", message: `Reminder sent to ${reg.email}.` });
  }
  await audit(env, { orgId: reg.ev_org, userId: ctx.userId }, "registration.remind", "registrations", regId, { mode: "sandbox" });
  return json({ ok: true, mode: "sandbox", checkout_url: reg.checkout_url,
    message: "Email isn't connected yet (sandbox). Copy this payment link and send it yourself." });
}

async function markPaid(env, ctx, regId) {
  const reg = await env.DB.prepare(
    "SELECT r.id, r.status, r.org_id, e.price_cents FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.id=?1 AND r.deleted_at IS NULL"
  ).bind(regId).first();
  if (!reg) return json({ error: "Registration not found." }, 404);
  const deny = await requireStaff(env, ctx, reg.org_id);
  if (deny) return deny;
  if (reg.status === "paid") return json({ ok: true, message: "Already marked paid." });
  await env.DB.prepare("UPDATE registrations SET status='paid', updated_at=datetime('now') WHERE id=?1").bind(regId).run();
  await env.DB.prepare(
    "INSERT INTO payments (org_id, registration_id, amount_cents, currency, status) VALUES (?1,?2,?3,'USD','CASH_COLLECTED')"
  ).bind(reg.org_id, regId, reg.price_cents || 0).run();
  await audit(env, { orgId: reg.org_id, userId: ctx.userId }, "registration.cash-collected", "registrations", regId, {});
  return json({ ok: true, message: "Marked paid (cash collected)." });
}

/** v1.3: staff cancel — frees the spot and auto-offers the next waitlisted team. */
async function cancelRegistration(env, ctx, regId) {
  const reg = await env.DB.prepare(
    "SELECT r.id, r.org_id, r.event_id, r.status FROM registrations r WHERE r.id=?1 AND r.deleted_at IS NULL"
  ).bind(regId).first();
  if (!reg) return json({ error: "Registration not found." }, 404);
  const deny = await staffEventGate(env, ctx, reg.event_id); if (deny) return deny;
  if (reg.status === "cancelled") return json({ ok: true, already: true, status: "cancelled" });
  await env.DB.prepare(
    "UPDATE registrations SET status='cancelled', updated_at=datetime('now') WHERE id=?1"
  ).bind(regId).run();
  await audit(env, ctx, "registration.cancel", "registrations", regId, { event: reg.event_id, was: reg.status });
  // NOTE: refunds stay manual in Square (SANDBOX rule 1); cancelling here only frees the spot.
  const offer = await offerNext(env, reg.event_id, {});
  return json({ ok: true, status: "cancelled",
    waitlist_offer: offer.offered ? { email: offer.email, expires_at: offer.expires_at } : null,
    waitlist_note: offer.offered ? `Spot offered to ${offer.name} (${offer.email}).` : offer.reason });
}

async function importRows(request, env, ctx, eventId) {
  const { ev, deny } = await staffEventGate(env, ctx, eventId);
  if (deny) return deny;
  const b = await request.json().catch(() => ({}));
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return json({ error: "No rows to import." }, 400);
  if (rows.length > 500) return json({ error: "Max 500 rows per import. Split the file." }, 400);

  let imported = 0; const skipped = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const email = String(r.email || "").trim().toLowerCase();
    const teamName = String(r.team_name || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { skipped.push({ row: i + 1, reason: "bad email" }); continue; }
    if (!teamName) { skipped.push({ row: i + 1, reason: "missing team name" }); continue; }
    const dup = await env.DB.prepare(
      `SELECT r.id FROM registrations r JOIN contacts c ON c.id=r.contact_id
       WHERE r.event_id=?1 AND c.email=?2 AND r.deleted_at IS NULL`
    ).bind(eventId, email).first();
    if (dup) { skipped.push({ row: i + 1, reason: "already registered" }); continue; }

    let contact = await env.DB.prepare("SELECT id FROM contacts WHERE org_id=?1 AND email=?2 AND deleted_at IS NULL").bind(ev.org_id, email).first();
    if (!contact) {
      const ins = await env.DB.prepare(
        "INSERT INTO contacts (org_id, email, full_name, phone, city, state, instagram) VALUES (?1,?2,?3,?4,?5,?6,?7)"
      ).bind(ev.org_id, email, r.captain_name || null, r.phone || null, r.city || null, r.state || null, r.instagram || null).run();
      contact = { id: ins.meta.last_row_id };
    }
    const tIns = await env.DB.prepare(
      "INSERT INTO teams (org_id, event_id, name, level, gender_division, captain_contact_id) VALUES (?1,?2,?3,?4,?5,?6)"
    ).bind(ev.org_id, eventId, teamName, r.level || null, r.gender_division || null, contact.id).run();
    for (const name of (Array.isArray(r.teammates) ? r.teammates.slice(0, 6) : [])) {
      const n = String(name).trim();
      if (n && n.toLowerCase() !== "none") {
        await env.DB.prepare("INSERT INTO team_members (org_id, team_id, member_name) VALUES (?1,?2,?3)").bind(ev.org_id, tIns.meta.last_row_id, n).run();
      }
    }
    const status = ["pending", "email-sent", "paid", "cash-pending", "comped"].includes(r.status) ? r.status : "paid";
    await env.DB.prepare(
      "INSERT INTO registrations (org_id, event_id, contact_id, team_id, status, payment_method) VALUES (?1,?2,?3,?4,?5,'square')"
    ).bind(ev.org_id, eventId, contact.id, tIns.meta.last_row_id, status).run();
    imported++;
  }
  await audit(env, { orgId: ev.org_id, userId: ctx.userId }, "registrations.import", "events", eventId, { imported, skipped: skipped.length });
  return json({ ok: true, imported, skipped });
}

/* ================= captain self-scoring ================= */

/* The per-team self-scoring token IS the credential — no login, see captainMatches. It is minted
   lazily the first time a link is actually needed, and only ever for a team the caller is entitled
   to: staff opening Scoring Links (scoreLinks), or a team member reaching their own team's scores
   from their account (myTeams). One spelling for the mint so the two paths cannot drift. */
const newScoreToken = () =>
  [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function ensureScoreToken(env, team) {
  if (team.score_token) return team.score_token;
  const token = newScoreToken();
  // Conditional on score_token IS NULL so two requests minting for the SAME team at once (a whole
  // team opening the app when the league goes live now all hit myTeams) cannot overwrite each other:
  // the loser's UPDATE changes nothing, and it adopts the token the winner already handed out rather
  // than returning a token that is no longer in the row (a dead link that 404s at captainMatches).
  const res = await env.DB.prepare(
    "UPDATE teams SET score_token=?1, updated_at=datetime('now') WHERE id=?2 AND score_token IS NULL"
  ).bind(token, team.id).run();
  if (res && res.meta && res.meta.changes === 0) {
    const row = await env.DB.prepare("SELECT score_token FROM teams WHERE id=?1").bind(team.id).first();
    if (row && row.score_token) return row.score_token;
  }
  return token;
}

/* Scoring is OPEN for an event that is live — marked in_progress, or started by date. A
   missing/unparseable date is not a start signal (matches the client's groupOf; the D-53/RF-4b
   lesson — nothing on the owner's path reliably sets in_progress). One spelling for both the account
   link (myTeams) and the email path (emailScoreLink), so they cannot disagree about "live". */
function scoringOpen(startsAt, status) {
  if (status === "in_progress") return true;
  const s = startsAt ? new Date(String(startsAt).replace(" ", "T")) : null;
  return !!(s && !isNaN(s.getTime()) && s <= new Date());
}

async function scoreLinks(env, ctx, eventId) {
  const { ev, deny } = await staffEventGate(env, ctx, eventId);
  if (deny) return deny;
  const teams = (await env.DB.prepare(
    "SELECT id, name, score_token FROM teams WHERE event_id=?1 AND deleted_at IS NULL ORDER BY name"
  ).bind(eventId).all()).results;
  const links = [];
  for (const t of teams) {
    const token = await ensureScoreToken(env, t);
    links.push({ team_id: t.id, team: t.name, url: `${env.APP_URL}/score.html?t=${token}` });
  }
  return json({ ok: true, links });
}

async function teamByToken(env, token) {
  return env.DB.prepare(
    "SELECT t.id, t.name, t.event_id, t.org_id, e.name AS event_name FROM teams t JOIN events e ON e.id=t.event_id WHERE t.score_token=?1 AND t.deleted_at IS NULL"
  ).bind(token).first();
}

async function captainMatches(env, token) {
  const team = await teamByToken(env, token);
  if (!team) return json({ error: "This scoring link isn't valid. Ask the organizer for a new one." }, 404);
  // v0.67.0: was `AND m.stage='pool'`. Bracket games were invisible to the teams playing them, so
  // the self-scoring link silently stopped working at exactly the point in the day when the desk is
  // busiest. A team's games are a team's games — pool and bracket alike.
  const matches = (await env.DB.prepare(
    `SELECT m.id, m.round, m.court, m.points_to, m.game_number, m.score_a, m.score_b, m.team_a_id, m.team_b_id,
       m.bracket_id, m.bracket_round, ta.name AS team_a, tb.name AS team_b
     FROM matches m LEFT JOIN teams ta ON ta.id=m.team_a_id LEFT JOIN teams tb ON tb.id=m.team_b_id
     WHERE m.event_id=?1 AND m.deleted_at IS NULL AND (m.team_a_id=?2 OR m.team_b_id=?2)
     ORDER BY m.round, m.game_number`
  ).bind(team.event_id, team.id).all()).results;
  const stageLabel = (r) =>
    r.bracket_id == null ? "Pool"
      : r.bracket_round === 1 ? "Final"
      : r.bracket_round === 2 ? "Semi-final"
      : r.bracket_round === 3 ? "Quarter-final"
      : `Round of ${2 ** r.bracket_round}`;
  const withLabels = matches.map((r) => ({ ...r, stage_label: stageLabel(r) }));
  const remaining = withLabels.filter((r) => r.score_a === null || r.score_b === null).length;
  return json({
    team: { id: team.id, name: team.name }, event: team.event_name,
    matches: withLabels,
    // The page uses this to retire itself once there is nothing left to enter (owner 2026-08-03:
    // "get rid of that page after scores are submitted").
    remaining,
    done: remaining === 0 && withLabels.length > 0,
  });
}

async function captainScore(request, env, token) {
  const team = await teamByToken(env, token);
  if (!team) return json({ error: "This scoring link isn't valid." }, 404);
  const b = await request.json().catch(() => ({}));
  const matchId = +b.match_id;
  const winner = b.winner; // 'us' | 'them'
  const diff = +b.diff;
  if (!matchId || !["us", "them"].includes(winner) || !(diff >= 1)) {
    return json({ error: "Send match_id, winner ('us'|'them') and diff ≥ 1." }, 400);
  }
  const mt = await env.DB.prepare(
    "SELECT * FROM matches WHERE id=?1 AND deleted_at IS NULL"
  ).bind(matchId).first();
  if (!mt || (mt.team_a_id !== team.id && mt.team_b_id !== team.id)) return json({ error: "That game isn't yours to score." }, 403);
  if (mt.score_a !== null || mt.score_b !== null) return json({ error: "This game is already scored. Ask the tournament desk to change it." }, 409);
  const weAreA = mt.team_a_id === team.id;
  const aWon = (winner === "us") === weAreA;
  const w = mt.points_to, l = Math.max(0, mt.points_to - diff);
  const [sa, sb] = aWon ? [w, l] : [l, w];
  await env.DB.prepare("UPDATE matches SET score_a=?1, score_b=?2, updated_at=datetime('now') WHERE id=?3").bind(sa, sb, matchId).run();
  await audit(env, { orgId: mt.org_id, userId: null }, "match.score.captain", "matches", matchId, { team: team.id, winner, diff });
  await refreshStandings(env, mt.event_id, mt.org_id);
  // A captain finishing a quarter-final on their phone must move the bracket on, same as the desk.
  // Anything less means the bracket is only correct when staff happen to be the ones typing.
  await advanceBracketFor(env, mt.org_id, mt.event_id);

  // How much is left for this team, so the page can retire itself when they are done.
  const left = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM matches
      WHERE event_id=?1 AND deleted_at IS NULL AND (team_a_id=?2 OR team_b_id=?2)
        AND (score_a IS NULL OR score_b IS NULL)`
  ).bind(mt.event_id, team.id).first();
  return json({ ok: true, score_a: sa, score_b: sb, remaining: left.n, done: left.n === 0 });
}

/* ================================================================
 * v1.2 recovery additions (Module 8 — lost v0.7.0 ZIP, rebuilt 2026-07-24)
 * ================================================================ */

/** Shared HTML escaper — also imported by index.js (cron email bodies). */
export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Shared Brevo sender. Returns true on success, false in sandbox mode or on failure. */
export async function sendEmail(env, to, subject, htmlContent, orgId = null) {
  if (!env.BREVO_API_KEY) return false; // sandbox: caller decides what to surface
  // F-13 (v0.31.0). This function had no idea which organisation it was sending for, so the
  // sender was a literal and every Queens Club registrant received Boomtown-branded email.
  // Patching the literal at each call site would have left the next caller free to type a
  // fifth one, so the literal is deleted and replaced by one resolver (orgs.js).
  // orgId is optional for backward compatibility with callers that have no org in scope;
  // those resolve through deployment config, which is not a company name in source.
  const who = await senderIdentity(env, orgId);
  if (!who) return false;
  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        sender: who,
        to: [{ email: to }],
        subject,
        htmlContent,
      }),
    });
    return resp.ok;
  } catch { return false; }
}

/**
 * WF-4 (v0.136.0): THE ONE SELECTION of "roster members with no live waiver", shared by the
 * daily sweep and the registrations screen's send-now — a second caller is never a second
 * implementation (B16's shape). Built from the door gate's own pair (WAIVER_IDENTITY_MATCH +
 * WAIVER_LIVE_PREDICATE, F-27), so the door, the sweep, the chips and the button can never
 * disagree about who is unsigned. Unlike the pre-WF-4 sweep SQL, the 2-day dedupe and the
 * has-an-address rule are NOT baked into the WHERE: each row carries `email` (may be null) and
 * `already` (reminded in the last 2 days), so callers can COUNT the unreachable and the
 * recently-reminded honestly instead of silently dropping them.
 */
async function waiverGaps(env, { eventId = null, withinDays = null, limit = 400 } = {}) {
  const windowSql = Number(withinDays) > 0
    ? `AND e.starts_at BETWEEN datetime('now') AND datetime('now', '+${Number(withinDays)} days')`
    : "";
  return (await env.DB.prepare(
    `SELECT DISTINCT tm.member_email AS email, tm.member_name AS name, tm.contact_id,
            e.org_id, e.name AS event_name, e.starts_at,
            EXISTS (SELECT 1 FROM notifications n
                    WHERE n.kind = 'waiver_reminder'
                      AND n.created_at > datetime('now', '-2 days')
                      AND json_extract(n.payload_json, '$.email') = tm.member_email) AS already
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
     JOIN events e ON e.id = t.event_id AND e.deleted_at IS NULL
       AND e.status IN ('published','in_progress')
       AND (?1 IS NULL OR e.id = ?1)
       ${windowSql}
     WHERE tm.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM waivers w
                       JOIN contacts c ON c.id = w.contact_id AND c.deleted_at IS NULL
                       WHERE c.org_id = e.org_id
                         AND ${WAIVER_IDENTITY_MATCH("tm.contact_id", "tm.member_email")}
                         AND ${WAIVER_LIVE_PREDICATE})
     LIMIT ?2`
  ).bind(eventId, limit).all()).results;
}

/** The ONE sender: in-app row always, email when an address exists (keyless-honest — sendEmail
 *  returns false with no BREVO_API_KEY and the CALLER reports what was not sent). Rows passed in
 *  are assumed already filtered to email-bearing, not-recently-reminded members. */
async function sendWaiverReminders(env, rows) {
  let sent = 0;
  for (const r of rows) {
    const when = (r.starts_at || "").replace("T", " ").slice(0, 16);
    const ok = await sendEmail(env, r.email, "One thing before you play: sign your waiver",
      `<p>Hi ${escapeHtml(r.name || "there")}, you're on a roster for <strong>${escapeHtml(r.event_name)}</strong> (${when}), but we don't have a signed waiver for you yet.</p>` +
      `<p><a href="${env.APP_URL}/">Sign in with this email</a> to take care of it, or sign at check-in; it takes a minute either way.</p>`);
    await env.DB.prepare(
      "INSERT INTO notifications (org_id, kind, target, contact_id, title, body, payload_json, sent_at) VALUES (?1,'waiver_reminder',?2,?3,?4,?5,?6,datetime('now'))"
    ).bind(r.org_id, r.contact_id ? "member" : "log", r.contact_id || null,
      "Waiver needed", `Sign your waiver before ${r.event_name}. You can do it at check-in too.`,
      JSON.stringify({ email: r.email })).run();
    if (ok) sent++;
  }
  return sent;
}

/** Daily cron (original v0.7.0 design): chase roster members on UPCOMING events
 *  who have NO valid waiver on file — the same people the door page flags NO
 *  WAIVER. Max 1 email per person per 48h (deduped via a 'waiver_reminder'
 *  notifications row; contact-less roster emails dedupe on payload email).
 *  v0.136.0: composition of the shared selection + sender above; semantics unchanged —
 *  address-less and recently-reminded rows are filtered here exactly as the old WHERE did,
 *  and the 100-per-run send cap is applied AFTER the filter, as before. */
export async function waiverReminderSweep(env) {
  const gaps = await waiverGaps(env, { withinDays: 14 });
  const due = gaps.filter((r) => r.email && !r.already).slice(0, 100);
  const sent = await sendWaiverReminders(env, due);
  return { due: due.length, emailed: sent };
}

/** WF-4(b): the registrations screen's "send waiver reminders now" — the shared selection scoped
 *  to ONE event, honest three ways: the 2-day dedupe binds this caller too (a double press does
 *  not double-nag, and says so), members with no address are counted rather than silently
 *  skipped (they sign at check-in — the door gate still catches them), and with no mail key the
 *  response says plainly that nothing was emailed while the in-app rows stand. */
async function sendEventWaiverReminders(env, ctx, eventId) {
  const { ev, deny } = await staffEventGate(env, ctx, eventId);
  if (deny) return deny;
  const gaps = await waiverGaps(env, { eventId });
  const noEmail = gaps.filter((r) => !r.email);
  const already = gaps.filter((r) => r.email && r.already);
  const due = gaps.filter((r) => r.email && !r.already);
  const sent = await sendWaiverReminders(env, due);
  await audit(env, { orgId: ev.org_id, userId: ctx.userId }, "waivers.remind_event", "events", eventId,
    { missing: gaps.length, notified: due.length, emailed: sent, no_email: noEmail.length, recently_reminded: already.length });
  const bits = [];
  bits.push(due.length
    ? `Reminded ${due.length} ${due.length === 1 ? "person" : "people"} in their member inbox.`
    : "Nobody new to remind.");
  if (sent === 0 && due.length > 0) bits.push("No mail key is set, so nothing was emailed; they'll see it when they sign in.");
  if (already.length) bits.push(`${already.length} ${already.length === 1 ? "was" : "were"} already reminded in the last two days and not nagged again.`);
  if (noEmail.length) bits.push(`${noEmail.length} ${noEmail.length === 1 ? "has" : "have"} no email address on the roster; catch them at check-in.`);
  return json({ ok: true, missing: gaps.length, notified: due.length, emailed: sent,
    no_email: noEmail.length, recently_reminded: already.length, note: bits.join(" ") });
}

/**
 * v1.5 (2026-07-26) — T-30 EXPIRY NOTICE. Distinct from waiverReminderSweep above, which is
 * event-driven ("you're on a roster in 14 days and have no waiver at all"). This one is
 * calendar-driven: a waiver that is still valid today but expires within 30 days.
 *
 * Owner decision 2026-07-26: waivers expire at one year and do NOT auto-renew; members get
 * roughly 30 days' warning. Waiver text v2 §8 states the notice is a courtesy and that the
 * member stays responsible whether or not it arrives — so a delivery failure here is not a
 * platform correctness problem, but we still only try once.
 *
 * IDEMPOTENCY: one notice per waiver row, ever. The dedupe key is the waiver id inside a
 * 'waiver_expiring' notifications row — NOT a time window. A 30-day window with a 48h
 * dedupe would email the same member fifteen times.
 */
export async function waiverExpirySweep(env) {
  const rows = (await env.DB.prepare(
    `SELECT w.id AS waiver_id, w.org_id, w.expires_at, w.contact_id,
            c.email, c.full_name AS name
       FROM waivers w
       JOIN contacts c ON c.id = w.contact_id AND c.deleted_at IS NULL
      WHERE w.deleted_at IS NULL
        AND c.email IS NOT NULL
        AND w.expires_at > datetime('now')
        AND w.expires_at <= datetime('now', '+30 days')
        -- Skip anyone who already re-signed: a newer waiver for the same contact wins.
        AND NOT EXISTS (SELECT 1 FROM waivers w2
                        WHERE w2.contact_id = w.contact_id AND w2.deleted_at IS NULL
                          AND w2.expires_at > w.expires_at)
        AND NOT EXISTS (SELECT 1 FROM notifications n
                        WHERE n.kind = 'waiver_expiring'
                          AND json_extract(n.payload_json, '$.waiver_id') = w.id)
      LIMIT 100`
  ).all()).results;

  let sent = 0;
  for (const r of rows) {
    const on = String(r.expires_at || "").replace("T", " ").slice(0, 10);
    const ok = await sendEmail(env, r.email, "Your waiver expires soon",
      `<p>Hi ${escapeHtml(r.name || "there")}, your signed waiver expires on <strong>${escapeHtml(on)}</strong>.</p>` +
      `<p>Waivers run for one year and don't renew automatically. After that date you won't be able to register for or play until you sign a new one.</p>` +
      `<p><a href="${env.APP_URL}/profile.html">Sign in and re-sign now</a>; it takes about a minute.</p>`);
    await env.DB.prepare(
      "INSERT INTO notifications (org_id, kind, target, contact_id, title, body, payload_json, sent_at) VALUES (?1,'waiver_expiring',?2,?3,?4,?5,?6,datetime('now'))"
    ).bind(r.org_id, r.contact_id ? "member" : "log", r.contact_id || null,
      "Waiver expiring", `Your waiver expires ${on}. Re-sign to keep playing.`,
      JSON.stringify({ waiver_id: r.waiver_id, email: r.email, expires_at: r.expires_at })).run();
    if (ok) sent++;
  }
  return { due: rows.length, emailed: sent };
}

/** Control Center "Rerun": mint a FRESH Square payment link (new idempotency key)
 *  for a still-unpaid registration, replacing the stored link. */
async function retryPayment(env, ctx, regId) {
  const reg = await env.DB.prepare(
    `SELECT r.id, r.status, r.org_id, c.email, t.name AS team_name,
            e.id AS event_id, e.name AS event_name,
            -- v0.30.0: the price the member was quoted wins. NULL on rows written before 0024,
            -- where the event list price WAS the quoted price, so the fallback is exact.
            COALESCE(r.price_cents, e.price_cents) AS price_cents
     FROM registrations r
     LEFT JOIN contacts c ON c.id = r.contact_id
     LEFT JOIN teams t ON t.id = r.team_id
     JOIN events e ON e.id = r.event_id
     WHERE r.id = ?1 AND r.deleted_at IS NULL`
  ).bind(regId).first();
  if (!reg) return json({ error: "Registration not found." }, 404);
  const deny = await requireStaff(env, ctx, reg.org_id);
  if (deny) return deny;
  if (!canRemind(reg.status)) {
    return json({ error: `Can't rerun a registration with status '${reg.status}'.` }, 400);
  }
  if (!(reg.price_cents > 0)) return json({ error: "This event is free; nothing to charge." }, 400);

  // square_location_id comes from the event's org row (same lookup remind/submit use)
  const orgLoc = await env.DB.prepare(
    "SELECT o.square_location_id FROM events e JOIN orgs o ON o.id=e.org_id WHERE e.id=?1"
  ).bind(reg.event_id).first();
  const evLike = { id: reg.event_id, square_location_id: orgLoc && orgLoc.square_location_id };

  const link = await createSquareLink(env, evLike, `${reg.event_name} · ${reg.team_name || "registration"}`,
    reg.price_cents, regId, `bt-reg-${regId}-r${Date.now()}`);
  if (link.error) {
    return json({ ok: true, mode: "sandbox",
      message: "Square isn't connected yet (sandbox), so no new link was created.", detail: link.error });
  }
  await env.DB.prepare(
    "UPDATE registrations SET square_order_id=?1, checkout_url=?2, updated_at=datetime('now') WHERE id=?3"
  ).bind(link.order_id, link.url, regId).run();
  await audit(env, ctx, "registration.retry-payment", "registrations", regId, {});

  if (reg.email && await sendEmail(env, reg.email, `New payment link · ${reg.event_name}`,
      `<p>Here's a fresh payment link for <strong>${escapeHtml(reg.team_name || "your registration")}</strong>: <a href="${link.url}">complete your payment</a> to lock in your spot.</p>`)) {
    await env.DB.prepare("UPDATE registrations SET status='email-sent', last_reminded_at=datetime('now') WHERE id=?1").bind(regId).run();
    return json({ ok: true, mode: "email", emailed: true, checkout_url: link.url,
      message: `New link created and emailed to ${reg.email}.` });
  }
  return json({ ok: true, mode: "sandbox", checkout_url: link.url,
    message: "New link created. Email isn't connected yet. Copy it and send it yourself." });
}

/* ---------- teammate connect / invite (lost v0.7.0 feature, rebuilt) ---------- */

async function myContact(env, ctx) {
  if (!ctx.session) return null;
  const u = await env.DB.prepare("SELECT email FROM users WHERE id=?1 AND deleted_at IS NULL").bind(ctx.userId).first();
  if (!u) return null;
  return env.DB.prepare(
    "SELECT id, email, full_name FROM contacts WHERE org_id=?1 AND email=?2 AND deleted_at IS NULL"
  ).bind(ctx.orgId, u.email.toLowerCase()).first();
}

/** Link roster rows that were entered by a captain (name + email, no account yet)
 *  to the signed-in member's contact. Idempotent; home.html calls it on load. */
async function connectTeams(env, ctx) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const u = await env.DB.prepare("SELECT email FROM users WHERE id=?1 AND deleted_at IS NULL").bind(ctx.userId).first();
  if (!u) return json({ error: "Sign in first." }, 401);
  const email = u.email.toLowerCase();
  const r = await env.DB.prepare(
    `UPDATE team_members SET contact_id = (
        SELECT c.id FROM contacts c
        WHERE c.email = ?1 AND c.org_id = team_members.org_id AND c.deleted_at IS NULL),
      updated_at = datetime('now')
     WHERE member_email = ?1 AND contact_id IS NULL AND deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM contacts c2 WHERE c2.email = ?1 AND c2.org_id = team_members.org_id AND c2.deleted_at IS NULL)`
  ).bind(email).run();
  return json({ ok: true, linked: r.meta.changes });
}

/** Teams I'm on (this org, upcoming or in-progress events), with the roster —
 *  powers the home.html "Your teams" panel and captain invite buttons. */
async function myTeams(env, ctx) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const me = await myContact(env, ctx);
  if (!me) return json({ teams: [] });
  const teams = (await env.DB.prepare(
    `SELECT DISTINCT t.id, t.name, t.captain_contact_id, t.score_token, e.id AS event_id, e.name AS event_name,
            e.starts_at, e.type, e.status AS event_status
     FROM teams t
     JOIN events e ON e.id = t.event_id AND e.deleted_at IS NULL
       AND e.status IN ('published','in_progress')
     LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.deleted_at IS NULL
     WHERE t.org_id = ?1 AND t.deleted_at IS NULL
       AND (t.captain_contact_id = ?2 OR tm.contact_id = ?2)
     ORDER BY e.starts_at`
  ).bind(ctx.orgId, me.id).all()).results;
  for (const t of teams) {
    t.is_captain = t.captain_contact_id === me.id;
    /* RF-13 (owner req 2026-08-23): "score entry ... accessible through membership account and
       tournament/league page." A team on THIS account can reach its own score entry once the event
       is live (scoringOpen — date-derived, see the helper); the token is surfaced only here to a
       member of this team, never on the public board or schedule. Upcoming events surface no link
       and mint no token. */
    t.score_url = scoringOpen(t.starts_at, t.event_status)
      ? `${env.APP_URL}/score.html?t=${await ensureScoreToken(env, t)}` : null;
    delete t.score_token;    // the raw token never ships as its own field; score_url carries it, own-team only
    delete t.event_status;   // internal to the gate above
    t.members = (await env.DB.prepare(
      `SELECT id, member_name, member_email, contact_id, invited_at, is_sub
       FROM team_members WHERE team_id=?1 AND deleted_at IS NULL ORDER BY id`
    ).bind(t.id).all()).results.map(m => ({
      id: m.id, name: m.member_name, is_sub: !!m.is_sub,
      connected: !!m.contact_id, invited: !!m.invited_at,
      email_on_file: !!m.member_email,
    }));
  }
  return json({ teams });
}

/** Captain (or staff) emails a roster member an invite to create their profile. */
async function inviteTeammate(env, ctx, tmId) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const tm = await env.DB.prepare(
    `SELECT tm.id, tm.org_id, tm.member_name, tm.member_email, tm.contact_id, tm.invited_at,
            t.name AS team_name, t.captain_contact_id, e.name AS event_name
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
     JOIN events e ON e.id = t.event_id AND e.deleted_at IS NULL
     WHERE tm.id = ?1 AND tm.deleted_at IS NULL`
  ).bind(tmId).first();
  if (!tm) return json({ error: "Teammate not found." }, 404);
  const me = await myContact(env, ctx);
  const staff = await isStaff(env, ctx, tm.org_id);
  if (!staff && (!me || me.id !== tm.captain_contact_id)) {
    return json({ error: "Only the team captain (or staff) can send invites." }, 403);
  }
  if (tm.contact_id) return json({ ok: true, message: "They already have a profile; nothing to send." });
  if (!tm.member_email) return json({ error: "No email on file for this teammate. Ask them to register or give you their email." }, 400);

  const col = tm.invited_at ? "reminded_at" : "invited_at";
  const ok = await sendEmail(env, tm.member_email, `You're on ${tm.team_name}`,
    `<p>Hi ${escapeHtml(tm.member_name || "there")}, you're on the roster for <strong>${escapeHtml(tm.team_name)}</strong> (${escapeHtml(tm.event_name)}).</p>` +
    `<p><a href="${env.APP_URL}/">Sign in with this email</a> to see your schedule, results, and reminders.</p>`);
  await env.DB.prepare(
    `UPDATE team_members SET ${col}=datetime('now'), updated_at=datetime('now') WHERE id=?1`
  ).bind(tmId).run();
  await audit(env, { orgId: tm.org_id, userId: ctx.userId }, "teammate.invite", "team_members", tmId, { mode: ok ? "email" : "sandbox" });
  return ok
    ? json({ ok: true, mode: "email", message: `Invite sent to ${tm.member_email}.` })
    : json({ ok: true, mode: "sandbox", message: "Email isn't connected yet (sandbox); marked as invited, but no email went out." });
}

/* RF-13 score-entry, the EMAIL channel (owner req 2026-08-23: score entry "presented in email").
   The captain (or staff) emails their OWN team its scoring link — the third surface over the same
   score_url the account card and leagues banner use. The token is a credential, so this stays
   own-team: only the captain/staff of THIS team may send, and it goes only to that team's own roster
   addresses. Live-gated (scoringOpen) and keyless-honest (sendEmail returns false in sandbox → the
   caller surfaces the "not connected" sentence, the standing email rule — the link is still on the
   page). */
async function emailScoreLink(env, ctx, teamId) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const team = await env.DB.prepare(
    `SELECT t.id, t.org_id, t.name, t.score_token, t.captain_contact_id,
            e.name AS event_name, e.starts_at, e.status
     FROM teams t JOIN events e ON e.id = t.event_id AND e.deleted_at IS NULL
     WHERE t.id = ?1 AND t.deleted_at IS NULL`
  ).bind(teamId).first();
  if (!team) return json({ error: "Team not found." }, 404);
  const me = await myContact(env, ctx);
  const staff = await isStaff(env, ctx, team.org_id);
  if (!staff && (!me || me.id !== team.captain_contact_id)) {
    return json({ error: "Only the team captain (or staff) can email the scoring link." }, 403);
  }
  if (!scoringOpen(team.starts_at, team.status)) {
    return json({ error: "Scoring isn't open for this event yet; the link appears once play starts." }, 409);
  }
  const roster = (await env.DB.prepare(
    `SELECT member_name, member_email FROM team_members
     WHERE team_id=?1 AND deleted_at IS NULL AND member_email IS NOT NULL AND member_email <> ''`
  ).bind(teamId).all()).results;
  if (!roster.length) return json({ error: "No teammate has an email on file to send to." }, 400);

  const url = `${env.APP_URL}/score.html?t=${await ensureScoreToken(env, team)}`;
  let sent = 0;
  for (const r of roster) {
    const ok = await sendEmail(env, r.member_email, `Score your games · ${team.name}`,
      `<p>Hi ${escapeHtml(r.member_name || "there")}, here is your scoring link for <strong>${escapeHtml(team.name)}</strong> (${escapeHtml(team.event_name)}).</p>` +
      `<p><a href="${escapeHtml(url)}">Enter your team's scores</a>: tap the winner, then the point margin. No sign-in needed; keep this link to your team.</p>`,
      team.org_id);
    if (ok) sent++;
  }
  await audit(env, { orgId: team.org_id, userId: ctx.userId }, "team.email_scorelink", "teams", teamId,
    { recipients: roster.length, mode: sent ? "email" : "sandbox" });
  return sent
    ? json({ ok: true, mode: "email", message: `Scoring link sent to ${sent} teammate${sent === 1 ? "" : "s"}.` })
    : json({ ok: true, mode: "sandbox", message: "Email isn't connected yet (sandbox); nothing was sent, but the link is ready on this page." });
}
