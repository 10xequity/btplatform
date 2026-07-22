/**
 * Boomtown Platform — Registration + Square + Captain-scoring routes
 * Version: v0.3.0 · Date: 2026-07-21 · Module 4
 * Mounted by worker/src/index.js (same wire() pattern as tournaments.js).
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

const SQUARE_VERSION = "2026-05-20";

let json, audit, isStaff, requireStaff;
export function wireRegistrations(helpers) { ({ json, audit, isStaff, requireStaff } = helpers); }

export async function registrationRoutes(request, env, url, ctx) {
  const p = url.pathname;
  const m = request.method;
  let match;

  if ((match = p.match(/^\/api\/events\/(\d+)\/form$/)) && m === "GET") return eventForm(env, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/register$/)) && m === "POST") return submitRegistration(request, env, +match[1]);
  if ((match = p.match(/^\/api\/events\/(\d+)\/registrations$/)) && m === "GET") return listRegistrations(request, env, ctx, +match[1], url);
  if ((match = p.match(/^\/api\/registrations\/(\d+)\/remind$/)) && m === "POST") return remind(env, ctx, +match[1]);
  if ((match = p.match(/^\/api\/registrations\/(\d+)\/mark-paid$/)) && m === "POST") return markPaid(env, ctx, +match[1]);
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
  const fields = (await env.DB.prepare(
    "SELECT id, label, field_type, options_json, required, sort_order FROM form_fields WHERE org_id=?1 AND (event_id=?2 OR event_id IS NULL) AND deleted_at IS NULL ORDER BY sort_order, id"
  ).bind(ev.org_id, eventId).all()).results;
  return json({
    event: {
      id: ev.id, org_id: ev.org_id, org_name: ev.org_name, name: ev.name, type: ev.type,
      starts_at: ev.starts_at, location: ev.location,
      price_cents: ev.price_cents || 0,
      cash_option_enabled: !!ev.cash_option_enabled,
    },
    fields,
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
  const payMethod = b.payment_method === "cash" ? "cash" : "square";
  if (payMethod === "cash" && !ev.cash_option_enabled) {
    return json({ error: "Cash payment isn't available for this event." }, 400); // hidden option enforced server-side
  }

  // Idempotency: an open registration for this email+event returns its existing checkout link.
  const existing = await env.DB.prepare(
    `SELECT r.id, r.status, r.checkout_url FROM registrations r JOIN contacts c ON c.id=r.contact_id
     WHERE r.event_id=?1 AND c.email=?2 AND r.status IN ('pending','email-sent','cash-pending') AND r.deleted_at IS NULL`
  ).bind(eventId, email).first();
  if (existing) {
    return json({ ok: true, duplicate: true, registration_id: existing.id, status: existing.status,
      checkout_url: existing.checkout_url || null,
      message: "You already have a registration in progress for this event." });
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

  // Waiver (annual)
  const expires = new Date(Date.now() + 365 * 86400000).toISOString();
  const wIns = await env.DB.prepare(
    "INSERT INTO waivers (org_id, contact_id, waiver_text_version, signed_at, expires_at, signature_name) VALUES (?1,?2,'v1',datetime('now'),?3,?4)"
  ).bind(ev.org_id, contact.id, expires, String(b.waiver_signature).trim()).run();

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
  const price = ev.price_cents || 0;
  let status = payMethod === "cash" ? "cash-pending" : (price === 0 ? "comped" : "pending");
  const rIns = await env.DB.prepare(
    "INSERT INTO registrations (org_id, event_id, contact_id, team_id, status, payment_method, waiver_id) VALUES (?1,?2,?3,?4,?5,?6,?7)"
  ).bind(ev.org_id, eventId, contact.id, teamId, status, price === 0 ? "comp" : payMethod, wIns.meta.last_row_id).run();
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

  // Payment
  if (status === "cash-pending") {
    await env.DB.prepare(
      "INSERT INTO notifications (org_id, kind, target, payload_json) VALUES (?1,'cash_pending','admin',?2)"
    ).bind(ev.org_id, JSON.stringify({ registration_id: regId, team: b.team_name, event: ev.name })).run();
    return json({ ok: true, registration_id: regId, status,
      message: "Registered with cash payment. Please bring payment to check-in — an organizer has been notified." });
  }
  if (status === "comped") {
    return json({ ok: true, registration_id: regId, status, message: "Registered — this event is free. See you there!" });
  }

  const link = await createSquareLink(env, ev, `${ev.name} — ${b.team_name}`, price, regId);
  if (link.error) {
    // Square not configured or call failed — registration is saved; payment happens via reminder later.
    return json({ ok: true, registration_id: regId, status: "pending", mode: "sandbox",
      message: "Registered! Online payment isn't connected yet — the organizer will send a payment link.", detail: link.error });
  }
  await env.DB.prepare(
    "UPDATE registrations SET square_order_id=?1, checkout_url=?2, updated_at=datetime('now') WHERE id=?3"
  ).bind(link.order_id, link.url, regId).run();
  return json({ ok: true, registration_id: regId, status: "pending", checkout_url: link.url,
    message: "Registered! Complete payment to lock in your spot." });
}

async function createSquareLink(env, ev, itemName, amountCents, regId) {
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
        idempotency_key: `bt-reg-${regId}`,
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

function timingSafeEqual(a, b) {
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
  const base = `SELECT r.id, r.status, r.payment_method, r.checkout_url, r.last_reminded_at, r.created_at,
      c.email, c.full_name AS captain_name, c.phone, t.name AS team_name, t.level, t.gender_division
    FROM registrations r
    LEFT JOIN contacts c ON c.id=r.contact_id
    LEFT JOIN teams t ON t.id=r.team_id
    WHERE r.event_id=?1 AND r.deleted_at IS NULL`;
  const rows = status
    ? (await env.DB.prepare(base + " AND r.status=?2 ORDER BY r.created_at DESC").bind(eventId, status).all()).results
    : (await env.DB.prepare(base + " ORDER BY r.created_at DESC").bind(eventId).all()).results;
  return json({ event: { id: ev.id, name: ev.name, price_cents: ev.price_cents || 0 }, registrations: rows });
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
  if (!["pending", "email-sent"].includes(reg.status)) return json({ error: `Can't remind a registration with status '${reg.status}'.` }, 400);
  if (!reg.checkout_url) return json({ error: "No payment link exists yet for this registration (Square not connected when they registered)." }, 400);

  await env.DB.prepare("UPDATE registrations SET last_reminded_at=datetime('now') WHERE id=?1").bind(regId).run();

  if (env.BREVO_API_KEY) {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Boomtown Athletics", email: env.SENDER_EMAIL || "no-reply@boomtownvb.com" },
        to: [{ email: reg.email }],
        subject: `Payment reminder — ${reg.event_name}`,
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

async function importRows(request, env, ctx, eventId) {
  const { ev, deny } = await staffEventGate(env, ctx, eventId);
  if (deny) return deny;
  const b = await request.json().catch(() => ({}));
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return json({ error: "No rows to import." }, 400);
  if (rows.length > 500) return json({ error: "Max 500 rows per import — split the file." }, 400);

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

async function scoreLinks(env, ctx, eventId) {
  const { ev, deny } = await staffEventGate(env, ctx, eventId);
  if (deny) return deny;
  const teams = (await env.DB.prepare(
    "SELECT id, name, score_token FROM teams WHERE event_id=?1 AND deleted_at IS NULL ORDER BY name"
  ).bind(eventId).all()).results;
  const links = [];
  for (const t of teams) {
    let token = t.score_token;
    if (!token) {
      token = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, "0")).join("");
      await env.DB.prepare("UPDATE teams SET score_token=?1, updated_at=datetime('now') WHERE id=?2").bind(token, t.id).run();
    }
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
  const matches = (await env.DB.prepare(
    `SELECT m.id, m.round, m.court, m.points_to, m.game_number, m.score_a, m.score_b, m.team_a_id, m.team_b_id,
       ta.name AS team_a, tb.name AS team_b
     FROM matches m LEFT JOIN teams ta ON ta.id=m.team_a_id LEFT JOIN teams tb ON tb.id=m.team_b_id
     WHERE m.event_id=?1 AND m.stage='pool' AND m.deleted_at IS NULL AND (m.team_a_id=?2 OR m.team_b_id=?2)
     ORDER BY m.round, m.game_number`
  ).bind(team.event_id, team.id).all()).results;
  return json({ team: { id: team.id, name: team.name }, event: team.event_name, matches });
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
  return json({ ok: true, score_a: sa, score_b: sb });
}
