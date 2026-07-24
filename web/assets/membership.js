/* Boomtown Platform — Membership (member)
   File: web/assets/membership.js · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.10.0
   Loads active plans + the caller's subscription. Subscribe = POST
   /api/plans/:id/subscribe → redirect to the Square-hosted checkout (Square stores
   the card and renews on the plan cadence). Cancel runs to the end of the paid period. */

(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const token = sessionStorage.getItem("bt_token");
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function headers() {
    const h = { "Content-Type": "application/json", "X-Org-Id": localStorage.getItem("bt_org") || "1" };
    if (token) h.Authorization = "Bearer " + token;
    return h;
  }
  async function api(path, opts = {}) {
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers: headers(), credentials: "include" }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
    } catch (e) { return { ok: false, status: 0, data: { error: "Network problem — check your connection." } }; }
  }
  const money = c => "$" + (c / 100).toFixed(2);
  const say = (msg, isErr) => { $("status").innerHTML = msg ? `<p class="help-text" style="${isErr ? "color:var(--danger,#e5484d)" : ""}">${esc(msg)}</p>` : ""; };

  let sub = null;

  boot();
  async function boot() {
    if (new URLSearchParams(location.search).get("done")) {
      say("Payment received — your membership activates as soon as Square confirms (usually under a minute). Refresh to see it.");
    }
    const me = await api("/api/me");
    const signedIn = me.ok && me.data && me.data.user;
    await loadCurrent(signedIn);
    await loadPlans(signedIn);
  }

  async function loadCurrent(signedIn) {
    if (!signedIn) {
      $("current").innerHTML = `<div class="ms-banner"><b>Sign in to manage a membership.</b>
        <a href="index.html#signin" style="margin-left:8px">Sign in →</a></div>`;
      return;
    }
    const r = await api("/api/profile/subscription");
    sub = r.ok ? r.data.subscription : null;
    if (!sub || sub.status === "canceled" || sub.status === "deactivated") {
      $("current").innerHTML = sub && sub.status === "canceled" && sub.current_period_end
        ? `<div class="ms-banner">Your <b>${esc(sub.plan_name)}</b> membership is canceled — benefits run until <b>${esc(sub.current_period_end.slice(0, 10))}</b>.</div>`
        : "";
      return;
    }
    const price = money(sub.price_cents) + (sub.billing_interval === "ANNUAL" ? "/yr" : "/mo");
    if (sub.status === "past_due") {
      $("current").innerHTML = `<div class="ms-banner warn"><b>Payment issue on your ${esc(sub.plan_name)} membership.</b>
        Square retries your card automatically; to update the card, use the link in Square's email receipt or contact the front desk.</div>`;
    } else if (sub.status === "pending") {
      $("current").innerHTML = `<div class="ms-banner">Checkout started for <b>${esc(sub.plan_name)}</b> — finish payment on the Square page, or pick a plan below to start over.</div>`;
    } else {
      $("current").innerHTML = `<div class="ms-banner ok"><b>${esc(sub.plan_name)}</b> · ${price} · Active${sub.current_period_end ? ` · renews ${esc(sub.current_period_end.slice(0, 10))}` : ""}
        ${sub.card_last4 ? ` · card ····${esc(sub.card_last4)}` : ""}
        <button class="btn ghost" id="cancelBtn" style="margin-left:10px">Cancel membership</button></div>`;
      $("cancelBtn").onclick = cancel;
    }
  }

  async function cancel() {
    if (!confirm("Cancel your membership? You keep benefits until the end of the current billing period.")) return;
    const r = await api("/api/profile/subscription/cancel", { method: "POST" });
    say(r.data.message || r.data.error, !r.ok);
    if (r.ok) { await loadCurrent(true); }
  }

  async function loadPlans(signedIn) {
    const r = await api("/api/plans");
    const plans = (r.ok && r.data.plans) || [];
    if (!plans.length) { $("plans").innerHTML = `<p class="help-text">No membership plans yet — check back soon.</p>`; return; }
    const hasActive = sub && (sub.status === "active" || sub.status === "past_due");
    $("plans").innerHTML = plans.map(p => `
      <section class="plan">
        <h2>${esc(p.name)}</h2>
        <div class="price">${money(p.price_cents)}<small>/${p.billing_interval === "ANNUAL" ? "year" : "month"}</small></div>
        ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ""}
        ${p.perks ? `<ul>${String(p.perks).split("\n").filter(Boolean).map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <button class="btn" data-plan="${p.id}" ${hasActive || !signedIn ? "disabled" : ""}>
          ${hasActive ? "Already a member" : "Subscribe"}</button>
      </section>`).join("");
    $("plans").querySelectorAll("button[data-plan]").forEach(b => b.onclick = () => subscribe(b));
  }

  async function subscribe(btn) {
    btn.disabled = true; btn.textContent = "Starting checkout…";
    const r = await api(`/api/plans/${btn.dataset.plan}/subscribe`, { method: "POST" });
    if (r.ok && r.data.checkout_url) { location.href = r.data.checkout_url; return; }
    say(r.data.message || r.data.error || "Couldn't start checkout.", !r.ok);
    btn.disabled = false; btn.textContent = "Subscribe";
  }
})();
