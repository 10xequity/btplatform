/* Boomtown Platform — Public Registration
   Version: v0.3.0 · Date: 2026-07-21
   Flow: ?event=ID → load form → fill → submit → Square checkout link (or sandbox/cash/free notice).
   Accessibility: real <label>s, keyboard-first, aria-live status region. No animation on inputs. */

(function () {
  const API = (window.BT_CONFIG || {}).apiBase;
  const card = document.getElementById("regCard");

  if (!API || API.includes("PENDING")) {
    card.innerHTML = "<h1>One moment</h1><p>The app is still loading its latest settings. Hold <strong>Ctrl</strong> and press <strong>F5</strong> to refresh.</p>";
    return;
  }

  /* theme (same behavior as other pages) */
  const savedTheme = localStorage.getItem("bt_theme");
  document.documentElement.dataset.theme = savedTheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.getElementById("themeToggle").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("bt_theme", next);
  };

  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Check your connection and try again." } };
    }
  }

  const params = new URLSearchParams(location.search);
  const eventId = params.get("event");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  if (params.get("done")) {
    card.innerHTML = "<h1>Payment received 🏐</h1><p>You're all set — check your email for confirmation from Square. See you on the court!</p>";
    return;
  }
  if (!eventId) {
    card.innerHTML = "<h1>Missing event</h1><p>This registration link is missing an event. Please use the link the organizer shared (it ends in <code>?event=…</code>).</p>";
    return;
  }

  const LEVELS = ["Recreational", "BB/A", "A/AA", "AA-Qualifier"];
  const DIVISIONS = ["Women's", "Men's", "Coed", "Reverse Coed"];
  // ADMIN: replace with the full Boomtown Athletics LLC waiver text before real registrations (see install doc §5).
  const WAIVER_TEXT = "BOOMTOWN ATHLETICS LLC — RELEASE OF LIABILITY (PLACEHOLDER — admin must replace with the full official waiver text before going live). By signing below I acknowledge the risks inherent to athletic activity and release Boomtown Athletics LLC, its organizations (Boomtown Volleyball, Match Point Social, Queens Club), staff, and venues from liability for injury or loss arising from my participation.";

  let ev = null, customFields = [];

  (async function boot() {
    const r = await api(`/api/events/${encodeURIComponent(eventId)}/form`);
    if (!r.ok) { card.innerHTML = `<h1>Registration unavailable</h1><p>${esc(r.data.error || "Please try again later.")}</p>`; return; }
    ev = r.data.event; customFields = r.data.fields || [];
    renderForm();
  })();

  function fieldHtml(f) {
    const req = f.required ? " required" : "";
    const id = `cf_${f.id}`;
    const label = `<label for="${id}">${esc(f.label)}${f.required ? " *" : ""}</label>`;
    if (f.field_type === "select") {
      let opts = []; try { opts = JSON.parse(f.options_json || "[]"); } catch {}
      return `<div class="field">${label}<select id="${id}" data-custom="${f.id}"${req}><option value="">Choose…</option>${opts.map((o) => `<option>${esc(o)}</option>`).join("")}</select></div>`;
    }
    if (f.field_type === "checkbox") {
      return `<div class="field check"><input type="checkbox" id="${id}" data-custom="${f.id}" /><label for="${id}">${esc(f.label)}</label></div>`;
    }
    if (f.field_type === "textarea") {
      return `<div class="field">${label}<textarea id="${id}" data-custom="${f.id}" rows="3"${req}></textarea></div>`;
    }
    const type = f.field_type === "email" ? "email" : f.field_type === "phone" ? "tel" : "text";
    return `<div class="field">${label}<input type="${type}" id="${id}" data-custom="${f.id}"${req} /></div>`;
  }

  function renderForm() {
    const price = ev.price_cents ? `$${(ev.price_cents / 100).toFixed(2)}` : "Free";
    const teammateRows = Array.from({ length: 6 }, (_, i) => `
      <div class="teammate-row">
        <div class="field"><label for="tmn${i}">Teammate ${i + 2} name</label><input id="tmn${i}" placeholder="None" /></div>
        <div class="field"><label for="tme${i}">Teammate ${i + 2} email</label><input id="tme${i}" type="email" placeholder="(optional)" /></div>
      </div>`).join("");
    card.innerHTML = `
      <h1>${esc(ev.name)}</h1>
      <p>${esc(ev.org_name)}${ev.starts_at ? " · " + esc(ev.starts_at.slice(0, 10)) : ""}${ev.location ? " · " + esc(ev.location) : ""}</p>
      <p class="price">Entry: ${price}</p>
      <div class="field"><label for="email">Captain email *</label><input id="email" type="email" required autocomplete="email" /></div>
      <div class="two-col">
        <div class="field"><label for="level">Team level *</label><select id="level" required>${LEVELS.map((l) => `<option>${l}</option>`).join("")}</select></div>
        <div class="field"><label for="division">Gender division *</label><select id="division" required>${DIVISIONS.map((d) => `<option>${d}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label for="teamName">Team name *</label><input id="teamName" required /></div>
      <div class="two-col">
        <div class="field"><label for="captainName">Captain name *</label><input id="captainName" required autocomplete="name" /></div>
        <div class="field"><label for="captainPhone">Captain phone</label><input id="captainPhone" type="tel" autocomplete="tel" /></div>
      </div>
      <h2 style="font-size:1rem">Teammates <span style="opacity:.7">(type "None" or leave blank if no sub)</span></h2>
      ${teammateRows}
      <div class="two-col">
        <div class="field"><label for="city">City</label><input id="city" /></div>
        <div class="field"><label for="state">State</label><input id="state" /></div>
      </div>
      <div class="field"><label for="instagram">Instagram handle(s) <span style="opacity:.7">(optional)</span></label><input id="instagram" placeholder="@yourteam" /></div>
      ${customFields.map(fieldHtml).join("")}
      <h2 style="font-size:1rem">Waiver *</h2>
      <div class="waiver-box" tabindex="0" aria-label="Waiver text">${esc(WAIVER_TEXT)}</div>
      <div class="field check"><input type="checkbox" id="waiverAccept" /><label for="waiverAccept">I have read and agree to the waiver *</label></div>
      <div class="field"><label for="waiverSig">Type your full legal name to sign *</label><input id="waiverSig" autocomplete="name" /></div>
      ${ev.price_cents ? `
      <h2 style="font-size:1rem">Payment *</h2>
      <div class="field check"><input type="radio" name="pay" id="paySquare" value="square" checked /><label for="paySquare">Pay online (card via Square)</label></div>
      ${ev.cash_option_enabled ? `<div class="field check"><input type="radio" name="pay" id="payCash" value="cash" /><label for="payCash">Pay cash at check-in</label></div>` : ""}` : ""}
      <button id="submitBtn" class="btn" style="width:100%;margin-top:10px">Register${ev.price_cents ? " & continue to payment" : ""}</button>
      <div id="msg" role="status" aria-live="polite"></div>`;
    document.getElementById("submitBtn").onclick = submit;
  }

  async function submit() {
    const $ = (id) => document.getElementById(id);
    const msg = $("msg");
    const show = (text, ok) => { msg.className = "msg " + (ok ? "ok" : "err"); msg.innerHTML = text; };
    if (!$("waiverAccept").checked || !$("waiverSig").value.trim()) { show("Please accept the waiver and type your name to sign it.", false); return; }

    const teammates = [];
    for (let i = 0; i < 6; i++) {
      const name = $(`tmn${i}`).value.trim();
      if (name) teammates.push({ name, email: $(`tme${i}`).value.trim() });
    }
    const custom = {};
    document.querySelectorAll("[data-custom]").forEach((el) => {
      custom[el.dataset.custom] = el.type === "checkbox" ? (el.checked ? "yes" : "no") : el.value;
    });
    const payEl = document.querySelector("input[name=pay]:checked");
    const body = {
      email: $("email").value, team_level: $("level").value, gender_division: $("division").value,
      team_name: $("teamName").value, captain_name: $("captainName").value, captain_phone: $("captainPhone").value,
      teammates, city: $("city").value, state: $("state").value, instagram: $("instagram").value,
      waiver_accepted: true, waiver_signature: $("waiverSig").value,
      payment_method: payEl ? payEl.value : "square", custom,
    };
    const btn = $("submitBtn");
    btn.disabled = true; btn.textContent = "Submitting…";
    const r = await api(`/api/events/${encodeURIComponent(eventId)}/register`, { method: "POST", body: JSON.stringify(body) });
    btn.disabled = false; btn.textContent = "Register";
    if (!r.ok) { show(esc(r.data.error || "Something went wrong. Please try again."), false); return; }
    if (r.data.checkout_url) {
      show(`${esc(r.data.message)}<br/><a class="btn" style="display:inline-block;margin-top:10px" href="${esc(r.data.checkout_url)}">Pay now →</a>`, true);
      location.href = r.data.checkout_url;
    } else {
      show(esc(r.data.message || "Registered!"), true);
    }
  }
})();
