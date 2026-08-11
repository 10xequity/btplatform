/* Boomtown Platform — Public Drop-in Sheet (SG-1)
   File: web/assets/sheet.js · Version: v1.0 · Date: 2026-08-11 · Ships in: v0.132.0
   ?event=ID → GET /api/events/:id/sheet → count + who's coming → POST /api/events/:id/signup.
   The Bearer (sessionStorage bt_token) is attached when present so a signed-in member gets the
   one-tap and the "you're on the list" state; without it the guest name+email form renders.
   Names arrive from the server already reduced to "First L." (standards §8) — nothing here
   ever sees an email or phone number that isn't the visitor's own typing.
   Full → the waitlist lives on register.html (existing machinery, never a second one).
   Priced → the existing payment flow's shapes: checkout_url (redirect) or a sandbox notice. */

(function () {
  const API = (window.BT_CONFIG || {}).apiBase;
  const card = document.getElementById("sheetCard");

  if (!API || API.includes("PENDING")) {
    card.innerHTML = "<h1>One moment</h1><p>The app is still loading its latest settings. Hold <strong>Ctrl</strong> and press <strong>F5</strong> to refresh.</p>";
    return;
  }

  const params = new URLSearchParams(location.search);
  const eventId = params.get("event");
  let token = null;
  try { token = sessionStorage.getItem("bt_token"); } catch (e) {}
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (c) => c ? "$" + (c / 100).toFixed(2).replace(/\.00$/, "") : "Free";
  const TZ = "America/Denver";

  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (token) headers["Authorization"] = "Bearer " + token;
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Check your connection and try again." } };
    }
  }

  if (params.get("done")) {
    card.innerHTML = "<h1>Payment received 🏐</h1><p>You're on the list — check your email for confirmation from Square. See you on the court!</p>";
    return;
  }
  if (!eventId) {
    card.innerHTML = "<h1>Missing event</h1><p>This sheet link is missing an event. Please use the link the organizer shared (it ends in <code>?event=…</code>).</p>";
    return;
  }

  let sheet = null;
  let showNameField = false; // revealed only when the server answers need_name

  function fmtWhen(s) {
    if (!s) return "";
    const d = new Date(String(s).replace(" ", "T"));
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ })
      + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  }

  async function load() {
    const r = await api(`/api/events/${encodeURIComponent(eventId)}/sheet`);
    if (!r.ok) { card.innerHTML = `<h1>Sheet unavailable</h1><p>${esc(r.data.error || "Please try again later.")}</p>`; return; }
    sheet = r.data;
    render();
  }

  function formHtml() {
    const ev = sheet.event;
    if (ev.is_full) {
      return `<div class="sheet-form"><p><strong>This session is full.</strong> Join the waitlist and we'll email you the moment a spot opens.</p>
        <a class="btn" href="register.html?event=${encodeURIComponent(eventId)}">Join the waitlist →</a></div>`;
    }
    if (sheet.viewer && sheet.viewer.signed_up) {
      return `<div class="sheet-form"><p class="msg ok" role="status">You're on the list — see you there! 🏐</p></div>`;
    }
    const btnLabel = ev.price_cents ? "Sign up & pay" : "Count me in";
    if (sheet.viewer) { // signed in, not yet on the list — one tap
      return `<div class="sheet-form">
        ${showNameField ? `<div class="field"><label for="suName">Your name</label><input id="suName" autocomplete="name" /></div>` : ""}
        <button id="signupBtn" class="btn" style="width:100%">${btnLabel}</button>
        <p id="msg" class="msg" role="status" aria-live="polite" hidden></p></div>`;
    }
    return `<div class="sheet-form">
      <div class="field"><label for="suName">Your name</label><input id="suName" autocomplete="name" /></div>
      <div class="field"><label for="suEmail">Email</label><input id="suEmail" type="email" autocomplete="email" /></div>
      <input class="hp-field" type="text" id="suHp" name="company" tabindex="-1" autocomplete="off" aria-hidden="true" />
      <button id="signupBtn" class="btn" style="width:100%">${btnLabel}</button>
      <p id="msg" class="msg" role="status" aria-live="polite" hidden></p></div>`;
  }

  function render() {
    const ev = sheet.event;
    const capLine = ev.capacity
      ? `<span class="n">${ev.spots_taken}</span><span class="cap">of ${ev.capacity} spots taken</span>`
      : `<span class="n">${ev.spots_taken}</span><span class="cap">signed up</span>`;
    const who = sheet.attendees.length
      ? `<ul class="who">${sheet.attendees.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
      : `<p class="muted">No one yet — be the first.</p>`;
    card.innerHTML = `
      <h1>${esc(ev.name)}</h1>
      <p class="sheet-meta">${esc(ev.org_name)}${ev.starts_at ? " · " + esc(fmtWhen(ev.starts_at)) : ""}${ev.location ? " · " + esc(ev.location) : ""}</p>
      <p style="margin-top:10px"><span class="price-chip">${money(ev.price_cents)}</span></p>
      <div class="sheet-count">${capLine}</div>
      <h2 style="font-size:1rem;margin:14px 0 0">Who's coming</h2>
      ${who}
      ${formHtml()}`;
    const btn = document.getElementById("signupBtn");
    if (btn) btn.addEventListener("click", submit);
  }

  function show(text, ok) {
    const msg = document.getElementById("msg");
    if (!msg) return;
    msg.hidden = false;
    msg.className = "msg " + (ok ? "ok" : "err");
    msg.innerHTML = text;
  }

  async function submit() {
    const $ = (id) => document.getElementById(id);
    const body = {};
    if ($("suName")) body.name = $("suName").value;
    if ($("suEmail")) body.email = $("suEmail").value;
    if ($("suHp")) body.hp = $("suHp").value;
    const btn = $("signupBtn");
    btn.disabled = true; btn.textContent = "Signing up…";
    const r = await api(`/api/events/${encodeURIComponent(eventId)}/signup`, { method: "POST", body: JSON.stringify(body) });
    btn.disabled = false; btn.textContent = sheet.event.price_cents ? "Sign up & pay" : "Count me in";
    if (!r.ok) {
      if (r.data && r.data.need_name) { // the account has no name on file — reveal the field once
        showNameField = true;
        render();
        show("Add your name so the organizer knows who's coming.", false);
        const nm = document.getElementById("suName");
        if (nm) nm.focus();
        return;
      }
      if (r.data && r.data.event_full) {
        show(`${esc(r.data.error)} <a href="register.html?event=${encodeURIComponent(eventId)}">Join the waitlist →</a>`, false);
        return;
      }
      show(esc(r.data.error || "Something went wrong. Please try again."), false);
      return;
    }
    if (r.data.checkout_url && !r.data.duplicate) {
      show(`${esc(r.data.message)}<br/><a class="btn" style="display:inline-block;margin-top:10px" href="${esc(r.data.checkout_url)}">Pay now →</a>`, true);
      location.href = r.data.checkout_url;
      return;
    }
    if (r.data.duplicate && r.data.checkout_url) {
      show(`${esc(r.data.message)}<br/><a class="btn" style="display:inline-block;margin-top:10px" href="${esc(r.data.checkout_url)}">Finish payment →</a>`, true);
      return;
    }
    show(esc(r.data.message || "You're on the list!"), true);
    load(); // refresh the count and the names with what the server now knows
  }

  load();
})();
/* Changelog: v1.0 (2026-08-11) — SG-1: the public drop-in sheet. */
