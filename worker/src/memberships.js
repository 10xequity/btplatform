/**
 * Boomtown Platform — Memberships & Recurring Billing (Module 11)
 * File: worker/src/memberships.js · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.10.0
 *
 * Admin routes (staff/admin of the org):
 *   GET  /api/admin/plans                 → all plans incl. inactive
 *   POST /api/admin/plans                 { name, description?, perks?, price_cents, billing_interval }
 *                                           creates the plan locally AND (when Square keys are set)
 *                                           a Square Catalog SUBSCRIPTION_PLAN + SUBSCRIPTION_PLAN_VARIATION.
 *   PUT  /api/admin/plans/:id             text edits update in place; a PRICE or INTERVAL change creates a
 *                                           NEW Square variation (existing subscribers keep their old price —
 *                                           Square subscriptions are pinned to the variation they bought).
 *   GET  /api/admin/subscriptions         → member, plan, status, started, period end
 *   GET  /api/admin/mrr                   → { mrr_cents, active_count, past_due_count } for the Control Center card
 *
 * Member routes:
 *   GET  /api/plans                       → active plans (public: anyone signed in or not)
 *   POST /api/plans/:id/subscribe         → Square payment link with checkout_options.subscription_plan_id
 *                                           (the VARIATION id — Square then stores the card on file, creates
 *                                           the subscription, and charges on the plan cadence automatically)
 *   GET  /api/profile/subscription        → caller's latest subscription + plan
 *   POST /api/profile/subscription/cancel → Square CancelSubscription (access runs to period end — owner
 *                                           decision D-M11-1 default)
 *
 * Webhook:
 *   membershipWebhook(request, env) replaces squareWebhook as the /api/webhooks/square entry.
 *   It verifies the HMAC itself, handles subscription.* and invoice.* events, and forwards every
 *   other event (payment.*) to registrations.squareWebhook unchanged — registrations.js is NOT modified.
 *
 * Failed charges: Square retries on its own schedule; invoice.scheduled_charge_failed flips the local
 * status to past_due (surfaced on the Control Center MRR card + member banner); invoice.payment_made
 * flips it back to active.
 *
 * Sandbox behavior (no SQUARE_ACCESS_TOKEN): plans can be created/edited locally; subscribe returns a
 * clear "billing not configured" message instead of a link. Nothing breaks.
 *
 * Data: plans + subscriptions tables (migration 0007, applied live 2026-07-24, additive only).
 */

import { squareWebhook } from "./registrations.js";

const SQUARE_VERSION = "2026-05-20";

let json, audit, isStaff, requireStaff;
export function wireMemberships(h) { ({ json, audit, isStaff, requireStaff } = h); }

export async function membershipRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;
  if (p === "/api/plans" && m === "GET") return listPlans(env, ctx);
  if ((x = p.match(/^\/api\/plans\/(\d+)\/subscribe$/)) && m === "POST") return subscribe(env, ctx, +x[1]);
  if (p === "/api/profile/subscription" && m === "GET") return mySubscription(env, ctx);
  if (p === "/api/profile/subscription/cancel" && m === "POST") return cancelMine(env, ctx);
  if (p === "/api/admin/plans" && m === "GET") return adminPlans(env, ctx);
  if (p === "/api/admin/plans" && m === "POST") return createPlan(request, env, ctx);
  if ((x = p.match(/^\/api\/admin\/plans\/(\d+)$/)) && m === "PUT") return updatePlan(request, env, ctx, +x[1]);
  if (p === "/api/admin/subscriptions" && m === "GET") return adminSubs(env, ctx);
  if (p === "/api/admin/mrr" && m === "GET") return mrrCard(env, ctx);
  return null;
}

/* ================= Square helpers ================= */

function sqBase(env) {
  return env.SQUARE_ENV === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
}
function sqHeaders(env) {
  return {
    "Square-Version": SQUARE_VERSION,
    "Authorization": "Bearer " + env.SQUARE_ACCESS_TOKEN,
    "Content-Type": "application/json",
  };
}
async function sq(env, method, path, body) {
  const resp = await fetch(sqBase(env) + path, {
    method, headers: sqHeaders(env), body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("Square", method, path, resp.status, JSON.stringify(data.errors || data));
    return { error: `Square error ${resp.status}`, data };
  }
  return { data };
}

/** Create the Catalog plan, then a variation carrying the price + cadence. Returns both ids or {error}. */
async function createSquarePlanObjects(env, name, priceCents, interval) {
  const plan = await sq(env, "POST", "/v2/catalog/object", {
    idempotency_key: crypto.randomUUID(),
    object: { type: "SUBSCRIPTION_PLAN", id: "#plan", subscription_plan_data: { name: name.slice(0, 120) } },
  });
  if (plan.error) return plan;
  const planId = plan.data.catalog_object.id;
  const variation = await createSquareVariation(env, planId, name, priceCents, interval);
  if (variation.error) return variation;
  return { planId, variationId: variation.variationId };
}

async function createSquareVariation(env, planId, name, priceCents, interval) {
  const v = await sq(env, "POST", "/v2/catalog/object", {
    idempotency_key: crypto.randomUUID(),
    object: {
      type: "SUBSCRIPTION_PLAN_VARIATION", id: "#var",
      subscription_plan_variation_data: {
        name: name.slice(0, 120),
        subscription_plan_id: planId,
        phases: [{ cadence: interval, ordinal: 0, pricing: { type: "STATIC", price_money: { amount: priceCents, currency: "USD" } } }],
      },
    },
  });
  if (v.error) return v;
  return { variationId: v.data.catalog_object.id };
}

/* ================= member: plans + subscribe ================= */

async function listPlans(env, ctx) {
  const rows = (await env.DB.prepare(
    `SELECT id, name, description, perks, price_cents, currency, billing_interval,
            (square_variation_id IS NOT NULL) AS billable
     FROM plans WHERE org_id=?1 AND active=1 AND deleted_at IS NULL ORDER BY sort_order, price_cents`
  ).bind(ctx.orgId).all()).results;
  return json({ ok: true, plans: rows });
}

async function subscribe(env, ctx, planId) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const plan = await env.DB.prepare(
    "SELECT * FROM plans WHERE id=?1 AND org_id=?2 AND active=1 AND deleted_at IS NULL"
  ).bind(planId, ctx.orgId).first();
  if (!plan) return json({ error: "Plan not found." }, 404);

  const existing = await env.DB.prepare(
    `SELECT id, status FROM subscriptions WHERE user_id=?1 AND org_id=?2 AND deleted_at IS NULL
       AND status IN ('active','past_due') LIMIT 1`
  ).bind(ctx.userId, ctx.orgId).first();
  if (existing) return json({ error: "You already have a membership. Cancel it first to switch plans." }, 409);

  if (!env.SQUARE_ACCESS_TOKEN || !plan.square_variation_id || !env.SQUARE_LOCATION_ID) {
    return json({ ok: true, sandbox: true,
      message: "Billing isn't switched on yet (Square keys not set). Your interest is noted — check back soon." });
  }

  const user = await env.DB.prepare("SELECT email FROM users WHERE id=?1").bind(ctx.userId).first();
  const link = await sq(env, "POST", "/v2/online-checkout/payment-links", {
    idempotency_key: crypto.randomUUID(),
    quick_pay: {
      name: `${plan.name} membership`.slice(0, 120),
      price_money: { amount: plan.price_cents, currency: "USD" },
      location_id: env.SQUARE_LOCATION_ID,
    },
    checkout_options: {
      subscription_plan_id: plan.square_variation_id, // Square requires the VARIATION id here
      redirect_url: `${env.APP_URL}/membership.html?done=1`,
    },
    pre_populated_data: user && user.email ? { buyer_email: user.email } : undefined,
  });
  if (link.error) return json({ error: "Couldn't start checkout. Try again in a minute." }, 502);

  // Pending row so the webhook can attach the Square ids to the right member.
  await env.DB.prepare(
    `INSERT INTO subscriptions (org_id, user_id, plan_id, status) VALUES (?1,?2,?3,'pending')`
  ).bind(ctx.orgId, ctx.userId, plan.id).run();
  await audit(env, ctx, "subscription.checkout", "subscriptions", null, { plan_id: plan.id });
  return json({ ok: true, checkout_url: link.data.payment_link.url,
    message: "Complete payment on the Square page — your card is stored securely by Square for renewals." });
}

async function mySubscription(env, ctx) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const row = await env.DB.prepare(
    `SELECT s.id, s.status, s.started_at, s.canceled_at, s.current_period_end, s.card_brand, s.card_last4,
            p.name AS plan_name, p.price_cents, p.billing_interval
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id=?1 AND s.org_id=?2 AND s.deleted_at IS NULL
     ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'past_due' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, s.id DESC
     LIMIT 1`
  ).bind(ctx.userId, ctx.orgId).first();
  return json({ ok: true, subscription: row || null });
}

async function cancelMine(env, ctx) {
  if (!ctx.session) return json({ error: "Sign in first." }, 401);
  const row = await env.DB.prepare(
    `SELECT * FROM subscriptions WHERE user_id=?1 AND org_id=?2 AND deleted_at IS NULL
       AND status IN ('active','past_due') LIMIT 1`
  ).bind(ctx.userId, ctx.orgId).first();
  if (!row) return json({ error: "No active membership to cancel." }, 404);

  if (row.square_subscription_id && env.SQUARE_ACCESS_TOKEN) {
    const r = await sq(env, "POST", `/v2/subscriptions/${row.square_subscription_id}/cancel`);
    if (r.error) return json({ error: "Square couldn't process the cancelation. Try again shortly." }, 502);
  }
  await env.DB.prepare(
    "UPDATE subscriptions SET status='canceled', canceled_at=datetime('now'), updated_at=datetime('now') WHERE id=?1"
  ).bind(row.id).run();
  await audit(env, ctx, "subscription.cancel", "subscriptions", row.id, {});
  return json({ ok: true, message: "Canceled. You keep member benefits until the end of the current billing period." });
}

/* ================= admin ================= */

async function adminPlans(env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const rows = (await env.DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id=p.id AND s.status IN ('active','past_due') AND s.deleted_at IS NULL) AS subscriber_count
     FROM plans p WHERE p.org_id=?1 AND p.deleted_at IS NULL ORDER BY p.sort_order, p.id`
  ).bind(ctx.orgId).all()).results;
  return json({ ok: true, plans: rows, billing_configured: !!env.SQUARE_ACCESS_TOKEN });
}

async function createPlan(request, env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const b = await request.json().catch(() => ({}));
  const name = String(b.name || "").trim();
  const price = Math.round(Number(b.price_cents));
  const interval = b.billing_interval === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  if (!name) return json({ error: "Give the plan a name." }, 400);
  if (!(price >= 100)) return json({ error: "Price must be at least $1.00 (Square minimum)." }, 400);

  let squarePlanId = null, squareVariationId = null, warning = null;
  if (env.SQUARE_ACCESS_TOKEN) {
    const s = await createSquarePlanObjects(env, name, price, interval);
    if (s.error) warning = "Saved locally, but Square plan creation failed — members can't subscribe until it's retried (edit + save the plan to retry).";
    else { squarePlanId = s.planId; squareVariationId = s.variationId; }
  } else {
    warning = "Saved locally. Square keys aren't set, so members can't subscribe yet.";
  }

  const r = await env.DB.prepare(
    `INSERT INTO plans (org_id, name, description, perks, price_cents, billing_interval, square_plan_id, square_variation_id, sort_order)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,COALESCE((SELECT MAX(sort_order)+1 FROM plans WHERE org_id=?1),0))`
  ).bind(ctx.orgId, name, b.description || null, b.perks || null, price, interval, squarePlanId, squareVariationId).run();
  await audit(env, ctx, "plan.create", "plans", r.meta.last_row_id, { name, price, interval });
  return json({ ok: true, id: r.meta.last_row_id, warning });
}

async function updatePlan(request, env, ctx, planId) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const plan = await env.DB.prepare(
    "SELECT * FROM plans WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(planId, ctx.orgId).first();
  if (!plan) return json({ error: "Plan not found." }, 404);
  const b = await request.json().catch(() => ({}));

  const name = b.name !== undefined ? String(b.name).trim() : plan.name;
  const price = b.price_cents !== undefined ? Math.round(Number(b.price_cents)) : plan.price_cents;
  const interval = b.billing_interval !== undefined
    ? (b.billing_interval === "ANNUAL" ? "ANNUAL" : "MONTHLY") : plan.billing_interval;
  if (!name) return json({ error: "Give the plan a name." }, 400);
  if (!(price >= 100)) return json({ error: "Price must be at least $1.00 (Square minimum)." }, 400);

  let variationId = plan.square_variation_id, squarePlanId = plan.square_plan_id, warning = null;
  const priceChanged = price !== plan.price_cents || interval !== plan.billing_interval;

  if (env.SQUARE_ACCESS_TOKEN && (priceChanged || !variationId)) {
    if (!squarePlanId) {
      const s = await createSquarePlanObjects(env, name, price, interval);
      if (s.error) warning = "Saved locally, but Square is still not linked — subscribing stays off for this plan.";
      else { squarePlanId = s.planId; variationId = s.variationId; }
    } else {
      const v = await createSquareVariation(env, squarePlanId, name, price, interval);
      if (v.error) warning = "Saved locally, but the new price didn't reach Square — new subscribers would still pay the old price, so subscribing uses the previous variation.";
      else variationId = v.variationId; // NEW variation: existing subscribers keep the price they signed up at.
    }
  }

  await env.DB.prepare(
    `UPDATE plans SET name=?1, description=?2, perks=?3, price_cents=?4, billing_interval=?5,
       active=?6, square_plan_id=?7, square_variation_id=?8, updated_at=datetime('now') WHERE id=?9`
  ).bind(name, b.description !== undefined ? b.description : plan.description,
         b.perks !== undefined ? b.perks : plan.perks, price, interval,
         b.active !== undefined ? (b.active ? 1 : 0) : plan.active,
         squarePlanId, variationId, planId).run();
  await audit(env, ctx, "plan.update", "plans", planId, { priceChanged });
  return json({ ok: true, warning,
    note: priceChanged ? "Existing subscribers keep their old price; the new price applies to new signups only." : null });
}

async function adminSubs(env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const rows = (await env.DB.prepare(
    `SELECT s.id, s.status, s.started_at, s.canceled_at, s.current_period_end, s.card_brand, s.card_last4,
            p.name AS plan_name, p.price_cents, p.billing_interval,
            u.email AS member_email
     FROM subscriptions s JOIN plans p ON p.id=s.plan_id LEFT JOIN users u ON u.id=s.user_id
     WHERE s.org_id=?1 AND s.deleted_at IS NULL AND s.status != 'pending'
     ORDER BY CASE s.status WHEN 'past_due' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, s.id DESC LIMIT 500`
  ).bind(ctx.orgId).all()).results;
  return json({ ok: true, subscriptions: rows });
}

async function mrrCard(env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const row = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN s.status='active' THEN
         CASE p.billing_interval WHEN 'MONTHLY' THEN p.price_cents ELSE p.price_cents/12 END END),0) AS mrr_cents,
       SUM(CASE WHEN s.status='active' THEN 1 ELSE 0 END) AS active_count,
       SUM(CASE WHEN s.status='past_due' THEN 1 ELSE 0 END) AS past_due_count
     FROM subscriptions s JOIN plans p ON p.id=s.plan_id
     WHERE s.org_id=?1 AND s.deleted_at IS NULL`
  ).bind(ctx.orgId).first();
  return json({ ok: true, mrr_cents: row.mrr_cents || 0,
    active_count: row.active_count || 0, past_due_count: row.past_due_count || 0 });
}

/* ================= Square webhook (wraps registrations.squareWebhook) ================= */

export async function membershipWebhook(request, env) {
  const raw = await request.text();
  const sig = request.headers.get("x-square-hmacsha256-signature") || "";
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY || !env.SQUARE_WEBHOOK_URL) return json({ error: "Webhook not configured." }, 503);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(env.SQUARE_WEBHOOK_URL + raw));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (!timingSafeEqual(expected, sig)) return json({ error: "Invalid signature." }, 401);

  let body; try { body = JSON.parse(raw); } catch { return json({ ok: true, ignored: "bad json" }); }
  const type = body.type || "";

  if (type.startsWith("subscription.")) {
    const sub = body?.data?.object?.subscription;
    if (sub) await upsertFromSquare(env, sub, raw);
    return json({ ok: true });
  }
  if (type.startsWith("invoice.")) {
    const inv = body?.data?.object?.invoice;
    const sqId = inv && inv.subscription_id;
    if (sqId) {
      if (type === "invoice.payment_made") {
        await env.DB.prepare(
          "UPDATE subscriptions SET status='active', updated_at=datetime('now') WHERE square_subscription_id=?1 AND status IN ('past_due','pending','active')"
        ).bind(sqId).run();
      } else if (type === "invoice.scheduled_charge_failed" || type === "invoice.payment_failed") {
        await env.DB.prepare(
          "UPDATE subscriptions SET status='past_due', updated_at=datetime('now') WHERE square_subscription_id=?1 AND status IN ('active','pending')"
        ).bind(sqId).run();
      }
    }
    return json({ ok: true });
  }
  // Everything else (payment.*) → the existing registrations handler, untouched.
  return squareWebhook(new Request("https://internal/webhook", { method: "POST", headers: request.headers, body: raw }), env);
}

const STATUS_MAP = { PENDING: "pending", ACTIVE: "active", PAUSED: "past_due", CANCELED: "canceled", DEACTIVATED: "deactivated" };

async function upsertFromSquare(env, sub, raw) {
  const status = STATUS_MAP[sub.status] || "pending";
  const periodEnd = sub.charged_through_date || null;
  const canceledAt = sub.canceled_date || null;

  const existing = await env.DB.prepare(
    "SELECT id FROM subscriptions WHERE square_subscription_id=?1 AND deleted_at IS NULL"
  ).bind(sub.id).first();
  if (existing) {
    await env.DB.prepare(
      `UPDATE subscriptions SET status=?1, current_period_end=?2, canceled_at=COALESCE(?3, canceled_at),
         raw_json=?4, updated_at=datetime('now') WHERE id=?5`
    ).bind(status, periodEnd, canceledAt, raw.slice(0, 8000), existing.id).run();
    return;
  }

  // New Square subscription → find the plan by variation, the member by customer email.
  const plan = await env.DB.prepare(
    "SELECT id, org_id FROM plans WHERE square_variation_id=?1 AND deleted_at IS NULL"
  ).bind(sub.plan_variation_id).first();
  if (!plan) { console.error("subscription webhook: unknown variation", sub.plan_variation_id); return; }

  let userId = null;
  if (sub.customer_id && env.SQUARE_ACCESS_TOKEN) {
    const c = await sq(env, "GET", `/v2/customers/${sub.customer_id}`);
    const email = c.data && c.data.customer && c.data.customer.email_address;
    if (email) {
      const u = await env.DB.prepare("SELECT id FROM users WHERE lower(email)=lower(?1)").bind(email).first();
      if (u) userId = u.id;
    }
  }

  // Attach to the member's pending checkout row when one exists; otherwise insert fresh.
  const pending = userId ? await env.DB.prepare(
    `SELECT id FROM subscriptions WHERE user_id=?1 AND plan_id=?2 AND status='pending'
       AND square_subscription_id IS NULL AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`
  ).bind(userId, plan.id).first() : null;

  if (pending) {
    await env.DB.prepare(
      `UPDATE subscriptions SET square_subscription_id=?1, square_customer_id=?2, status=?3,
         started_at=COALESCE(?4, datetime('now')), current_period_end=?5, raw_json=?6, updated_at=datetime('now') WHERE id=?7`
    ).bind(sub.id, sub.customer_id || null, status, sub.start_date || null, periodEnd, raw.slice(0, 8000), pending.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO subscriptions (org_id, user_id, plan_id, square_subscription_id, square_customer_id, status, started_at, current_period_end, raw_json)
       VALUES (?1,?2,?3,?4,?5,?6,COALESCE(?7, datetime('now')),?8,?9)`
    ).bind(plan.org_id, userId, plan.id, sub.id, sub.customer_id || null, status, sub.start_date || null, periodEnd, raw.slice(0, 8000)).run();
  }
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
