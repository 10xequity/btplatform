/* Boomtown Platform — Prizes and prize inventory
   File: worker/src/prizes.js · Version: v1.0 · Date: 2026-10-12 · Ships in: v0.213.0
   Owner ask (2026-10-12): "a prize and inventory management system. Based on tournaments winners
   will receive items, and I want a quick way to log which items they get and an easy way to log
   items we receive either through invoices or through scanning my email for invoices."

   THREE NOUNS. An ITEM is a thing you can hand over (a medal, a shirt, a gift card). A RECEIPT is
   how items arrive — an invoice, a donation, or an opening count/shrinkage ('adjustment') — and it
   carries lines of item × qty, an optional invoice file (uploads.js, kind 'receipt'), and the Gmail
   message id when it was logged from an email so the same invoice cannot be logged twice. An AWARD
   is a finisher walking away with an item (qty) and/or cash — the finance sheets pay 1st–3rd in
   cash and give gear to the rest, so an award carries either or both.

   STOCK IS DERIVED, NEVER STORED: on hand = Σ receipt lines − Σ awards, both filtered to live rows.
   Voiding a receipt or an award is a soft delete and the sum moves on its own. A stored counter is
   wrong the first time a void happens out of order; a sum cannot be.

   FINISHERS ARE READ OFF THE BRACKET. GET /api/admin/events/:id/prizes lists who finished where
   — the final's winner is 1st, its loser 2nd, the semi-final losers 3rd (tied; volleyball brackets
   here play no third-place game) — per bracket, straight from `matches` the same way
   brackets.js's loadBrackets names a champion. No bracket yet → the pool standings' top three,
   labelled as such. The page shows each finisher with an Award button; that is the "quick way".

   EMAIL. A Worker cannot read a Gmail inbox. "Scan my email" is a Claude Code session with the
   Gmail connector: it searches, reads the invoice, and POSTs a receipt here with source 'email' and
   the message id. The dedupe index makes a re-scan harmless (409, not a second receipt). The
   runbook names the exact prompt. All routes requireStaff; every write is audited. */

import { winnerOf } from "./brackets.js"; // the two-point rule lives in ONE place; brackets.js imports nothing from here

let json, audit, requireStaff;
export function wirePrizes(h) { ({ json, audit, requireStaff } = h); }

export const RECEIPT_SOURCES = ["manual", "email", "adjustment"];

const ON_HAND_SQL = `
  COALESCE((SELECT SUM(l.qty) FROM prize_receipt_lines l
             JOIN prize_receipts r ON r.id = l.receipt_id AND r.deleted_at IS NULL
            WHERE l.item_id = i.id AND l.org_id = i.org_id), 0)
  - COALESCE((SELECT SUM(a.qty) FROM prize_awards a
               WHERE a.item_id = i.id AND a.org_id = i.org_id AND a.deleted_at IS NULL), 0)`;

export async function prizesRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  if (!p.startsWith("/api/admin/prizes") && !/^\/api\/admin\/events\/\d+\/prizes$/.test(p)) return null;
  const denied = await requireStaff(env, ctx);
  if (denied) return denied;
  let x;
  if (p === "/api/admin/prizes/items" && m === "GET") return listItems(env, ctx, url);
  if (p === "/api/admin/prizes/items" && m === "POST") return saveItem(request, env, ctx, null);
  if ((x = p.match(/^\/api\/admin\/prizes\/items\/(\d+)$/)) && m === "POST") return saveItem(request, env, ctx, +x[1]);

  if (p === "/api/admin/prizes/receipts" && m === "GET") return listReceipts(env, ctx);
  if (p === "/api/admin/prizes/receipts" && m === "POST") return createReceipt(request, env, ctx);
  if ((x = p.match(/^\/api\/admin\/prizes\/receipts\/(\d+)\/void$/)) && m === "POST") return voidRow(env, ctx, "prize_receipts", +x[1], "prizes.receipt_void");

  if (p === "/api/admin/prizes/awards" && m === "GET") return listAwards(env, ctx, +url.searchParams.get("event") || null);
  if (p === "/api/admin/prizes/awards" && m === "POST") return createAward(request, env, ctx);
  if ((x = p.match(/^\/api\/admin\/prizes\/awards\/(\d+)\/void$/)) && m === "POST") return voidRow(env, ctx, "prize_awards", +x[1], "prizes.award_void");

  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/prizes$/)) && m === "GET") return eventPrizes(env, ctx, +x[1]);
  return null;
}

/* ================= pure (unit-tested) ================= */

/** Who finished where, from bracket matches. Rows need bracket_name, bracket_round, team ids/names
 *  and scores; `winnerOf` is injected so this file does not have to know the two-point rule.
 *  Returns [{bracket, place, team_id, team}] ordered bracket, place. Ties share a place (two 3rds). */
export function finishersFrom(rows, winnerOf) {
  const out = [];
  const byBracket = new Map();
  for (const r of rows) {
    if (!byBracket.has(r.bracket_name)) byBracket.set(r.bracket_name, []);
    byBracket.get(r.bracket_name).push(r);
  }
  for (const [bracket, mine] of byBracket) {
    const side = (r, s) => (s === "a" ? { team_id: r.team_a_id, team: r.team_a } : { team_id: r.team_b_id, team: r.team_b });
    const other = (s) => (s === "a" ? "b" : "a");
    for (const f of mine.filter((r) => r.bracket_round === 1)) {
      const w = winnerOf(f.score_a, f.score_b);
      if (!w) continue;                                // final not played: nobody has finished yet
      out.push({ bracket, place: 1, ...side(f, w) });
      if (f[`team_${other(w)}_id`]) out.push({ bracket, place: 2, ...side(f, other(w)) });
    }
    for (const s of mine.filter((r) => r.bracket_round === 2)) {
      const w = winnerOf(s.score_a, s.score_b);
      if (!w || !s[`team_${other(w)}_id`]) continue;
      out.push({ bracket, place: 3, ...side(s, other(w)) });
    }
  }
  return out.sort((a, b) => (a.bracket < b.bracket ? -1 : a.bracket > b.bracket ? 1 : a.place - b.place));
}

/** The refusal sentence for an award that exceeds stock, or null when it fits. */
export function stockRefusal(itemName, onHand, qty) {
  if (qty <= onHand) return null;
  return onHand <= 0
    ? `There are none of "${itemName}" on hand. Log a receipt first, or award cash instead.`
    : `Only ${onHand} of "${itemName}" on hand; this award asks for ${qty}.`;
}

/* ================= items ================= */

async function listItems(env, ctx, url) {
  const all = url.searchParams.get("all") === "1";
  const rows = (await env.DB.prepare(
    `SELECT i.id, i.name, i.unit_cost_cents, i.sponsor_id, s.name AS sponsor, i.notes, i.active,
            (${ON_HAND_SQL}) AS on_hand,
            COALESCE((SELECT SUM(a.qty) FROM prize_awards a WHERE a.item_id = i.id AND a.org_id = i.org_id AND a.deleted_at IS NULL), 0) AS awarded
       FROM prize_items i
       LEFT JOIN sponsors s ON s.id = i.sponsor_id
      WHERE i.org_id = ?1 AND i.deleted_at IS NULL ${all ? "" : "AND i.active = 1"}
      ORDER BY i.active DESC, i.name COLLATE NOCASE`
  ).bind(ctx.orgId).all()).results || [];
  return json({ items: rows });
}

async function saveItem(request, env, ctx, id) {
  const b = await request.json().catch(() => ({}));
  if (b.delete && id) {
    await env.DB.prepare("UPDATE prize_items SET deleted_at = datetime('now') WHERE id = ?1 AND org_id = ?2")
      .bind(id, ctx.orgId).run();
    await audit(env, ctx, "prizes.item_delete", "prize_items", id, {});
    return json({ ok: true });
  }
  const name = String(b.name || "").trim().slice(0, 120);
  if (!name) return json({ error: "An item needs a name." }, 400);
  const cost = Math.max(0, Math.round(+b.unit_cost_cents || 0));
  const sponsor = b.sponsor_id ? Math.round(+b.sponsor_id) : null;
  const notes = String(b.notes || "").trim().slice(0, 500) || null;
  const active = b.active === false ? 0 : 1;
  if (id) {
    const r = await env.DB.prepare(
      `UPDATE prize_items SET name = ?1, unit_cost_cents = ?2, sponsor_id = ?3, notes = ?4, active = ?5,
              updated_at = datetime('now') WHERE id = ?6 AND org_id = ?7 AND deleted_at IS NULL`
    ).bind(name, cost, sponsor, notes, active, id, ctx.orgId).run();
    if (!r.meta.changes) return json({ error: "That item isn't here any more." }, 404);
    await audit(env, ctx, "prizes.item_update", "prize_items", id, { name });
    return json({ ok: true, id });
  }
  const ins = await env.DB.prepare(
    "INSERT INTO prize_items (org_id, name, unit_cost_cents, sponsor_id, notes, active) VALUES (?1,?2,?3,?4,?5,?6)"
  ).bind(ctx.orgId, name, cost, sponsor, notes, active).run();
  await audit(env, ctx, "prizes.item_create", "prize_items", ins.meta.last_row_id, { name });
  return json({ ok: true, id: ins.meta.last_row_id });
}

/* ================= receipts ================= */

async function listReceipts(env, ctx) {
  const rows = (await env.DB.prepare(
    `SELECT r.id, r.vendor, r.invoice_no, r.invoice_date, r.total_cents, r.upload_id, r.source,
            r.email_message_id, r.notes, r.created_at,
            (SELECT COUNT(*) FROM prize_receipt_lines l WHERE l.receipt_id = r.id) AS line_count,
            (SELECT COALESCE(SUM(l.qty), 0) FROM prize_receipt_lines l WHERE l.receipt_id = r.id) AS qty_total,
            (SELECT GROUP_CONCAT(i.name || ' ×' || l.qty, ', ') FROM prize_receipt_lines l JOIN prize_items i ON i.id = l.item_id
              WHERE l.receipt_id = r.id) AS summary
       FROM prize_receipts r
      WHERE r.org_id = ?1 AND r.deleted_at IS NULL
      ORDER BY r.created_at DESC, r.id DESC LIMIT 200`
  ).bind(ctx.orgId).all()).results || [];
  return json({ receipts: rows });
}

/** Body: { vendor, invoice_no, invoice_date, total_cents, upload_id, source, email_message_id, notes,
 *          lines: [{ item_id | name, qty, unit_cost_cents }] }
 *  A line with `name` and no item_id finds that item by name (case-insensitive) or creates it, so
 *  logging a new kind of prize off an invoice is one step, not two. */
async function createReceipt(request, env, ctx) {
  const b = await request.json().catch(() => ({}));
  const vendor = String(b.vendor || "").trim().slice(0, 120);
  const source = RECEIPT_SOURCES.includes(b.source) ? b.source : "manual";
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!vendor) return json({ error: "A receipt needs a vendor (or 'Opening count' for an adjustment)." }, 400);
  if (!lines.length) return json({ error: "Add at least one line: which item, and how many." }, 400);
  if (lines.length > 100) return json({ error: "A receipt is capped at 100 lines." }, 400);

  const emailId = String(b.email_message_id || "").trim().slice(0, 120) || null;
  if (emailId) {
    const dupe = await env.DB.prepare(
      "SELECT id, vendor, invoice_no FROM prize_receipts WHERE org_id = ?1 AND email_message_id = ?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, emailId).first();
    if (dupe) return json({ error: `That email is already logged as receipt #${dupe.id} (${dupe.vendor}${dupe.invoice_no ? " " + dupe.invoice_no : ""}).`, receipt_id: dupe.id }, 409);
  }

  // Resolve every line to an item id BEFORE writing anything, so a bad line writes nothing.
  const resolved = [];
  for (const ln of lines) {
    const qty = Math.round(+ln.qty);
    if (!Number.isFinite(qty) || qty === 0) return json({ error: "Every line needs a whole-number quantity." }, 400);
    if (qty < 0 && source !== "adjustment") return json({ error: "A negative quantity is only allowed on an adjustment (shrinkage or a miscount)." }, 400);
    const cost = Math.max(0, Math.round(+ln.unit_cost_cents || 0));
    let itemId = ln.item_id ? Math.round(+ln.item_id) : null;
    if (itemId) {
      const it = await env.DB.prepare("SELECT id FROM prize_items WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL")
        .bind(itemId, ctx.orgId).first();
      if (!it) return json({ error: `Item ${itemId} isn't in this organization's prize list.` }, 400);
    } else {
      const name = String(ln.name || "").trim().slice(0, 120);
      if (!name) return json({ error: "Every line needs an item (pick one, or type a new item's name)." }, 400);
      const found = await env.DB.prepare(
        "SELECT id FROM prize_items WHERE org_id = ?1 AND deleted_at IS NULL AND name = ?2 COLLATE NOCASE"
      ).bind(ctx.orgId, name).first();
      if (found) itemId = found.id;
      else {
        const ins = await env.DB.prepare(
          "INSERT INTO prize_items (org_id, name, unit_cost_cents) VALUES (?1, ?2, ?3)"
        ).bind(ctx.orgId, name, cost).run();
        itemId = ins.meta.last_row_id;
        await audit(env, ctx, "prizes.item_create", "prize_items", itemId, { name, via: "receipt" });
      }
    }
    resolved.push({ itemId, qty, cost });
  }

  const total = b.total_cents === null || b.total_cents === undefined || b.total_cents === "" ? null : Math.round(+b.total_cents);
  const ins = await env.DB.prepare(
    `INSERT INTO prize_receipts (org_id, vendor, invoice_no, invoice_date, total_cents, upload_id, source, email_message_id, notes, created_by_user_id)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`
  ).bind(ctx.orgId, vendor,
         String(b.invoice_no || "").trim().slice(0, 60) || null,
         String(b.invoice_date || "").trim().slice(0, 10) || null,
         Number.isFinite(total) ? total : null,
         b.upload_id ? Math.round(+b.upload_id) : null,
         source, emailId,
         String(b.notes || "").trim().slice(0, 500) || null,
         ctx.userId || null).run();
  const id = ins.meta.last_row_id;
  // The lines land in ONE batch (D-59's rule): a receipt is all of its lines or none of them.
  await env.DB.batch(resolved.map((r) => env.DB.prepare(
    "INSERT INTO prize_receipt_lines (org_id, receipt_id, item_id, qty, unit_cost_cents) VALUES (?1,?2,?3,?4,?5)"
  ).bind(ctx.orgId, id, r.itemId, r.qty, r.cost)));
  // Keep each item's "last known cost" current from a priced invoice line.
  for (const r of resolved.filter((r) => r.cost > 0)) {
    await env.DB.prepare("UPDATE prize_items SET unit_cost_cents = ?1, updated_at = datetime('now') WHERE id = ?2 AND org_id = ?3")
      .bind(r.cost, r.itemId, ctx.orgId).run();
  }
  await audit(env, ctx, "prizes.receipt_create", "prize_receipts", id, { vendor, source, lines: resolved.length, email_message_id: emailId });
  return json({ ok: true, id, lines: resolved.length });
}

/* ================= awards ================= */

async function listAwards(env, ctx, eventId) {
  const rows = (await env.DB.prepare(
    `SELECT a.id, a.event_id, e.name AS event, a.team_id, a.recipient, a.place, a.bracket_name,
            a.item_id, i.name AS item, a.qty, a.cash_cents, a.notes, a.created_at
       FROM prize_awards a
       LEFT JOIN prize_items i ON i.id = a.item_id
       LEFT JOIN events e ON e.id = a.event_id
      WHERE a.org_id = ?1 AND a.deleted_at IS NULL ${eventId ? "AND a.event_id = ?2" : ""}
      ORDER BY a.created_at DESC, a.id DESC LIMIT 300`
  ).bind(...(eventId ? [ctx.orgId, eventId] : [ctx.orgId])).all()).results || [];
  return json({ awards: rows });
}

/** Body: { event_id, team_id?, recipient?, place?, bracket_name?, item_id?, qty?, cash_cents?, notes? } */
async function createAward(request, env, ctx) {
  const b = await request.json().catch(() => ({}));
  const eventId = Math.round(+b.event_id);
  if (!eventId) return json({ error: "An award belongs to an event." }, 400);
  const ev = await env.DB.prepare("SELECT id, name FROM events WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL")
    .bind(eventId, ctx.orgId).first();
  if (!ev) return json({ error: "That event isn't here." }, 404);

  let teamId = b.team_id ? Math.round(+b.team_id) : null;
  let recipient = String(b.recipient || "").trim().slice(0, 120) || null;
  if (teamId) {
    const t = await env.DB.prepare("SELECT id, name FROM teams WHERE id = ?1 AND org_id = ?2 AND event_id = ?3 AND deleted_at IS NULL")
      .bind(teamId, ctx.orgId, eventId).first();
    if (!t) return json({ error: "That team isn't in this event." }, 400);
    recipient = recipient || t.name;
  }
  if (!recipient) return json({ error: "Who is this for? Pick a team or type a name." }, 400);

  const itemId = b.item_id ? Math.round(+b.item_id) : null;
  const qty = itemId ? Math.round(+b.qty || 1) : 0;
  const cash = Math.max(0, Math.round(+b.cash_cents || 0));
  if (!itemId && !cash) return json({ error: "An award needs an item, a cash amount, or both." }, 400);
  if (itemId && !(qty >= 1)) return json({ error: "Quantity must be at least 1." }, 400);

  let itemName = null;
  if (itemId) {
    const it = await env.DB.prepare(
      `SELECT i.id, i.name, (${ON_HAND_SQL}) AS on_hand FROM prize_items i WHERE i.id = ?1 AND i.org_id = ?2 AND i.deleted_at IS NULL`
    ).bind(itemId, ctx.orgId).first();
    if (!it) return json({ error: "That prize item isn't here." }, 400);
    const refusal = stockRefusal(it.name, it.on_hand, qty);
    if (refusal) return json({ error: refusal, on_hand: it.on_hand }, 409);
    itemName = it.name;
  }

  const place = b.place ? Math.round(+b.place) : null;
  const ins = await env.DB.prepare(
    `INSERT INTO prize_awards (org_id, event_id, team_id, recipient, place, bracket_name, item_id, qty, cash_cents, notes, awarded_by_user_id)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`
  ).bind(ctx.orgId, eventId, teamId, recipient, place,
         String(b.bracket_name || "").trim().slice(0, 40) || null,
         itemId, qty, cash,
         String(b.notes || "").trim().slice(0, 500) || null,
         ctx.userId || null).run();
  await audit(env, ctx, "prizes.award", "prize_awards", ins.meta.last_row_id,
    { event_id: eventId, recipient, place, item: itemName, qty, cash_cents: cash });
  return json({ ok: true, id: ins.meta.last_row_id });
}

async function voidRow(env, ctx, table, id, action) {
  const r = await env.DB.prepare(`UPDATE ${table} SET deleted_at = datetime('now') WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL`)
    .bind(id, ctx.orgId).run();
  if (!r.meta.changes) return json({ error: "Nothing to void; it's already gone." }, 404);
  await audit(env, ctx, action, table, id, {});
  return json({ ok: true });
}

/* ================= the event's prize sheet ================= */

async function eventPrizes(env, ctx, eventId) {
  const ev = await env.DB.prepare("SELECT id, name, type, status FROM events WHERE id = ?1 AND org_id = ?2 AND deleted_at IS NULL")
    .bind(eventId, ctx.orgId).first();
  if (!ev) return json({ error: "That event isn't here." }, 404);

  const rows = (await env.DB.prepare(
    `SELECT b.name AS bracket_name, m.bracket_round, m.team_a_id, m.team_b_id, m.score_a, m.score_b,
            ta.name AS team_a, tb.name AS team_b
       FROM matches m
       JOIN brackets b ON b.id = m.bracket_id AND b.deleted_at IS NULL
       LEFT JOIN teams ta ON ta.id = m.team_a_id
       LEFT JOIN teams tb ON tb.id = m.team_b_id
      WHERE m.org_id = ?1 AND m.event_id = ?2 AND m.bracket_id IS NOT NULL AND m.deleted_at IS NULL
        AND m.bracket_round IN (1, 2)
      ORDER BY b.id, m.bracket_round, m.bracket_slot`
  ).bind(ctx.orgId, eventId).all()).results || [];
  let finishers = finishersFrom(rows, winnerOf);
  let basis = "bracket";
  if (!finishers.length) {
    const st = (await env.DB.prepare(
      `SELECT s.team_id, t.name AS team, s.rank FROM standings s JOIN teams t ON t.id = s.team_id
        WHERE s.org_id = ?1 AND s.event_id = ?2 AND s.deleted_at IS NULL AND s.rank IS NOT NULL
        ORDER BY s.rank LIMIT 3`
    ).bind(ctx.orgId, eventId).all()).results || [];
    finishers = st.map((r) => ({ bracket: "Pool standings", place: r.rank, team_id: r.team_id, team: r.team }));
    basis = finishers.length ? "standings" : "none";
  }
  const teams = (await env.DB.prepare(
    "SELECT id, name FROM teams WHERE org_id = ?1 AND event_id = ?2 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE"
  ).bind(ctx.orgId, eventId).all()).results || [];
  const awards = (await env.DB.prepare(
    `SELECT a.id, a.team_id, a.recipient, a.place, a.bracket_name, a.item_id, i.name AS item, a.qty, a.cash_cents, a.notes, a.created_at
       FROM prize_awards a LEFT JOIN prize_items i ON i.id = a.item_id
      WHERE a.org_id = ?1 AND a.event_id = ?2 AND a.deleted_at IS NULL ORDER BY a.created_at DESC, a.id DESC`
  ).bind(ctx.orgId, eventId).all()).results || [];
  const cash_total_cents = awards.reduce((s, a) => s + (a.cash_cents || 0), 0);
  return json({ event: ev, basis, finishers, teams, awards, cash_total_cents });
}
