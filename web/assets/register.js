/* Boomtown Platform — Public Registration
   Version: v0.5.0 · Date: 2026-07-26 · Ships in: v0.22.0
   v0.5.0: the waiver text is no longer a constant in this file — it arrives with
   /api/events/:id/form as a published version row and the form submits the version id
   alongside the signature. If the organizer publishes new text while this page is open,
   the server returns 409 waiver_stale and we re-render the current text rather than
   record a signature against something the signer never read.
   v0.4.0: waitlists — full events show a "join the waitlist" card instead of the form;
   a ?wtoken= claim link (from the offer email) opens the form with a claim banner and
   passes waitlist_token so the server admits the team into the full event.
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
  const wtoken = (params.get("wtoken") || "").trim();
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
  // v0.5.0: waiver text comes from the server (waiver_versions row). No text lives in this file.
  let ev = null, customFields = [], waiver = null;

  (async function boot() {
    const r = await api(`/api/events/${encodeURIComponent(eventId)}/form`);
    if (!r.ok) { card.innerHTML = `<h1>Registration unavailable</h1><p>${esc(r.data.error || "Please try again later.")}</p>`; return; }
    ev = r.data.event; customFields = r.data.fields || []; waiver = r.data.waiver || null;
    if (!waiver) { // no published waiver = we cannot lawfully take a signature
      card.innerHTML = `<h1>Registration isn't open yet</h1><p>This event can't accept registrations until the organizer publishes the participant waiver. Please check back shortly.</p>`;
      return;
    }
    if (ev.is_full && !wtoken) { renderFullState(); return; } // v0.4.0: waitlist instead of a dead form
    renderForm();
    if (wtoken) {
      const note = document.createElement("p");
      note.className = "msg ok";
      note.setAttribute("role", "status");
      note.textContent = "Waitlist claim link detected — this spot is held for the email your offer was sent to. Register below before the link expires.";
      card.prepend(note);
    }
  })();

  /* ---------- v0.4.0: full event → waitlist card ---------- */
  function renderFullState() {
    const cap = ev.capacity ? ` (${ev.capacity} team cap)` : "";
    card.innerHTML = `
      <h1>${esc(ev.name)}</h1>
      <p><strong>This event is full${cap}.</strong> Join the waitlist and we'll email you the moment a spot opens — offers come with a claim link that holds the spot for you.</p>
      <div class="field"><label for="wlName">Captain name</label><input id="wlName" autocomplete="name" /></div>
      <div class="field"><label for="wlEmail">Email</label><input id="wlEmail" type="email" autocomplete="email" /></div>
      <div class="field"><label for="wlTeam">Team name (optional)</label><input id="wlTeam" /></div>
      <div class="field"><label for="wlPhone">Phone (optional)</label><input id="wlPhone" type="tel" autocomplete="tel" /></div>
      <button id="wlBtn" class="btn">Join the waitlist</button>
      <p id="msg" class="msg" role="status" aria-live="polite"></p>`;
    document.getElementById("wlBtn").addEventListener("click", joinWaitlist);
  }

  async function joinWaitlist() {
    const $ = (id) => document.getElementById(id);
    const msg = $("msg");
    const show = (t, ok) => { msg.className = "msg " + (ok ? "ok" : "err"); msg.textContent = t; };
    const btn = $("wlBtn");
    btn.disabled = true; btn.textContent = "Joining…";
    const r = await api(`/api/events/${encodeURIComponent(eventId)}/waitlist`, {
      method: "POST",
      body: JSON.stringify({ name: $("wlName").value, email: $("wlEmail").value, team_name: $("wlTeam").value, phone: $("wlPhone").value }),
    });
    btn.disabled = false; btn.textContent = "Join the waitlist";
    if (!r.ok) {
      if (r.data && r.data.open_spots) { location.href = `register.html?event=${encodeURIComponent(eventId)}`; return; }
      show((r.data && r.data.error) || "Something went wrong. Please try again.", false);
      return;
    }
    show(r.data.message || `You're #${r.data.position} on the waitlist.`, true);
    btn.remove();
  }

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
      <div class="field">
        <label for="dob">Your date of birth *</label>
        <input id="dob" type="date" autocomplete="bday" required
               aria-describedby="dobHelp" max="${new Date().toISOString().slice(0, 10)}" />
        <p class="help-text" id="dobHelp">Under 18? A parent or guardian confirms their own account first — we'll give you a link to send them.</p>
      </div>
      ${customFields.map(fieldHtml).join("")}
      <h2 style="font-size:1rem">Waiver <span style="opacity:.7;font-weight:400">(${esc(waiver.label)})</span> *</h2>
      <div class="waiver-box" id="waiverBox" tabindex="0" role="region" aria-label="Waiver text — scroll to read in full">${esc(waiver.body)}</div>
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

  /**
   * v0.5.0 — the waiver changed while this form was open. Swap in the new text, clear the
   * acceptance tick and the typed signature, and make the person read it again. Everything
   * else they typed is left alone; losing a whole form to a typo fix would be worse.
   */
  async function refreshWaiver() {
    const r = await api("/api/waiver/current");
    if (!r.ok) {
      show("The waiver was updated. Please reload this page before signing.", false);
      return;
    }
    waiver = r.data.version;
    const box = document.getElementById("waiverBox");
    if (box) {
      box.textContent = waiver.body;
      box.scrollTop = 0;
    }
    const heading = box && box.previousElementSibling;
    if (heading) heading.innerHTML = `Waiver <span style="opacity:.7;font-weight:400">(${esc(waiver.label)})</span> *`;
    const accept = document.getElementById("waiverAccept");
    const sig = document.getElementById("waiverSig");
    if (accept) accept.checked = false;
    if (sig) sig.value = "";
    show("The organizer updated the waiver while you were filling this in. Please read the new text above, tick the box again and re-type your name. Nothing else you entered was lost.", false);
    if (box) box.focus();
  }

  async function submit() {
    const $ = (id) => document.getElementById(id);
    const msg = $("msg");
    const show = (text, ok) => { msg.className = "msg " + (ok ? "ok" : "err"); msg.innerHTML = text; };
    if (!$("dob").value) { show("Enter your date of birth.", false); $("dob").focus(); return; }
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
      date_of_birth: $("dob").value, // v0.32.0 — the gate runs server-side; this is only the input
      waiver_accepted: true, waiver_signature: $("waiverSig").value,
      waiver_version_id: waiver.id, // v0.5.0 — pins the signature to the text rendered above
      payment_method: payEl ? payEl.value : "square", custom,
      waitlist_token: wtoken || undefined, // v0.4.0: claim from the offer email
    };
    const btn = $("submitBtn");
    btn.disabled = true; btn.textContent = "Submitting…";
    const r = await api(`/api/events/${encodeURIComponent(eventId)}/register`, { method: "POST", body: JSON.stringify(body) });
    btn.disabled = false; btn.textContent = "Register";
    if (!r.ok) {
      if (r.data && r.data.event_full && r.data.waitlist_available) { // filled up between load and submit
        show(`${esc(r.data.error)} <a href="register.html?event=${encodeURIComponent(eventId)}">Join the waitlist →</a>`, false);
        return;
      }
      if (r.data && r.data.guardian_required && r.data.invite_url) { // v0.32.0 — D-MIN-11
        const u = r.data.invite_url;
        show(
          `${esc(r.data.error)}
           <div class="field" style="margin-top:12px">
             <label for="inviteUrl">Parent or guardian link</label>
             <input id="inviteUrl" readonly value="${esc(u)}" aria-describedby="inviteHelp" />
             <p class="help-text" id="inviteHelp">Text or email this to them. It works once and expires in 14 days.</p>
           </div>
           <button id="copyInvite" class="btn" type="button" style="margin-right:8px">Copy link</button>
           <a class="btn ghost" href="${esc(u)}">Open it here</a>`,
          false
        );
        const c = document.getElementById("copyInvite");
        if (c) c.onclick = async () => {
          try { await navigator.clipboard.writeText(u); c.textContent = "Copied"; }
          catch { document.getElementById("inviteUrl").select(); c.textContent = "Press Ctrl/Cmd+C"; }
        };
        return;
      }
      if (r.data && r.data.waiver_stale) { // v0.5.0: organizer published new text mid-form
        await refreshWaiver();
        return;
      }
      show(esc(r.data.error || "Something went wrong. Please try again."), false); return;
    }
    if (r.data.checkout_url) {
      show(`${esc(r.data.message)}<br/><a class="btn" style="display:inline-block;margin-top:10px" href="${esc(r.data.checkout_url)}">Pay now →</a>`, true);
      location.href = r.data.checkout_url;
    } else {
      show(esc(r.data.message || "Registered!"), true);
    }
  }
})();
