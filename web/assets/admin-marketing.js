/* Boomtown Platform — Marketing (admin)
   File: web/assets/admin-marketing.js · Version: v1.2 · Date: 2026-08-06 · Ships in: v0.99.0 (v1.0 shipped in v0.16.0)
   v1.2 — §-1b W-F: segments target one event; ?event= arrives from the registrations screen.
   v1.1 — Marketing SMS scope C: campaigns carry a channel (Email / Text). Text campaigns get a
   plain-text body with a live segment-count meter (480 cap = 3 SMS segments), reuse the same
   segments, and stay clearly labeled in the list. While Twilio is unconfigured the strip says
   texting is off and the API answers 503 — the UI never pretends a text was sent.
   Segments (create/edit/preview with live counts), campaigns (compose → test → send →
   batch progress), compliance address, sandbox-mode messaging. Uses BT_ADMIN helpers;
   errors always render through fail() (Back + Dashboard, standing rule 2). */
(async function () {
  const { api, guard, esc, openModal, closeModal } = window.BT_ADMIN;

  /* K-10(a) (§-0 B8): the copyable widget snippet is BUILT from where this page is actually
     served, not baked into the markup — a baked address hands every future embedder a dead URL
     the day the domain changes, and nobody re-reads a snippet that used to work. `location.href`
     is the one address that is true wherever the app lives; the buster literal below is swept by
     sweep-buster like every other. */
  function fillWidgetSnippet() {
    const el = document.getElementById("widgetSnippet");
    if (!el) return;
    const src = new URL("assets/signup-widget.js?v=0.173.0", location.href).href;
    el.textContent = '<script src="' + src + '" data-org="boomtown" defer><' + '/script>';
  }
  fillWidgetSnippet();

  /* WF-6 (v0.138.0, §-0 B28) — a document handed over by a print screen.
     The owner asked that anywhere there is a print there is also email; BT_ADMIN.emailDocument
     puts the printed text in sessionStorage and sends the operator here, because this page
     already owns everything sending needs — event-scoped segments (W-F), the composer, and a
     sendCampaign that is already honest about production having no mail key. Read ONCE and
     cleared: a draft that survived a refresh would reappear over work the operator had moved on
     from, and this is a hand-off, not a saved document. Nothing here sends anything. */
  const PENDING_DRAFT = (() => {
    try {
      const raw = sessionStorage.getItem("bt_print_draft");
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d && (d.subject || d.body)
        ? { name: String(d.subject || "Schedule"), subject: String(d.subject || ""), html_body: String(d.body || "") }
        : null;
    } catch (e) { return null; }
  })();
  function takeDraft() {
    try { sessionStorage.removeItem("bt_print_draft"); } catch (e) {}
    return PENDING_DRAFT;
  }
  const me = await guard();
  if (!me) return;
  const $ = (id) => document.getElementById(id);
  const fail = (msg) => window.BT_ADMIN.fail($("app"), msg);
  const fmt = (s) => String(s || "").replace("T", " ").slice(0, 16);

  let SEGMENTS = [];
  let EVENTS = [];

  /* The event picker's options. Loaded once at boot — /api/events is already org-scoped, so the
     list an operator can segment by is exactly the list they can see. */
  async function loadEvents() {
    const r = await api("/api/events");
    EVENTS = (r.ok && r.data.events) || [];
  }
  const eventName = (id) => {
    const e = EVENTS.find((x) => Number(x.id) === Number(id));
    return e ? e.name : `event #${id}`;
  };

  /* ---------- overview strip + settings ---------- */
  async function loadOverview() {
    const r = await api("/api/admin/marketing/overview");
    if (!r.ok) return fail(r.data.error || "Could not load marketing overview.");
    const o = r.data;
    $("overviewStrip").innerHTML =
      `<span class="mkt-chip"><b>${o.reachable}</b> reachable contacts</span>` +
      `<span class="mkt-chip">${o.unsubscribed} unsubscribed (never emailed)</span>` +
      (o.email_mode === "sandbox"
        ? `<span class="mkt-chip warn">SANDBOX — no real emails until the Brevo key is set</span>`
        : `<span class="mkt-chip">Email: Brevo connected</span>`) +
      (o.address_set ? `<span class="mkt-chip">Address on file ✓</span>`
                     : `<span class="mkt-chip warn">Mailing address missing — email sending blocked</span>`) +
      (o.sms_mode === "twilio"
        ? `<span class="mkt-chip">Texting: Twilio connected</span>`
        : `<span class="mkt-chip warn">Texting off — A2P registration pending</span>`);
    if (o.mailing_address) $("mailAddr").value = o.mailing_address;
  }

  $("saveAddrBtn").onclick = async () => {
    const r = await api("/api/admin/marketing/settings", {
      method: "POST", body: JSON.stringify({ mailing_address: $("mailAddr").value }),
    });
    $("addrMsg").textContent = r.ok ? "Saved." : (r.data.error || "Could not save.");
    if (r.ok) loadOverview();
  };

  /* ---------- segments ---------- */
  async function loadSegments() {
    const r = await api("/api/admin/marketing/segments");
    if (!r.ok) return fail(r.data.error || "Could not load segments.");
    SEGMENTS = r.data.segments || [];
    $("segList").innerHTML = SEGMENTS.length ? SEGMENTS.map((s) => `
      <div class="mkt-row" data-id="${s.id}">
        <div class="grow"><div class="k">${esc(s.name)}</div>
          <div class="v">${esc(describeFilter(s.filter))}</div></div>
        <span class="status-pill"><b>${s.count}</b> people</span>
        ${s.no_birthdate > 0 ? `<span class="v">${s.no_birthdate} more have no birthdate on file — the age filter can't see them</span>` : ""}
        <button class="btn ghost" data-act="preview">Preview</button>
        <button class="btn ghost" data-act="edit">Edit</button>
        <button class="btn ghost" data-act="del">Delete</button>
      </div>`).join("")
      : `<p class="help-text" style="margin:8px 0 0">No segments yet — create one to choose who gets your first campaign.</p>`;
    $("segList").querySelectorAll("button").forEach((b) => {
      const id = Number(b.closest(".mkt-row").dataset.id);
      if (b.dataset.act === "preview") b.onclick = () => previewSegment(id);
      if (b.dataset.act === "edit") b.onclick = () => segmentModal(SEGMENTS.find((s) => s.id === id));
      if (b.dataset.act === "del") b.onclick = () => deleteSegment(id);
    });
  }

  function describeFilter(f) {
    const bits = [];
    if (f.tags && f.tags.length) bits.push(`tag: ${f.tags.join(", ")}`);
    if (f.played === "any") bits.push("played anything");
    if (f.played === "league") bits.push("played a league");
    if (f.played === "tournament") bits.push("played a tournament");
    if (f.played === "none") bits.push("never played yet");
    if (f.event) bits.push(`registered for ${eventName(f.event)}`);
    if (f.since) bits.push(`joined since ${f.since}`);
    // SG-4: the age band in words. Only members with a birthdate on file can match one.
    const hasMin = Number.isInteger(f.age_min), hasMax = Number.isInteger(f.age_max);
    if (hasMin && hasMax) bits.push(`aged ${f.age_min}–${f.age_max}`);
    else if (hasMin) bits.push(`aged ${f.age_min}+`);
    else if (hasMax) bits.push(`aged ${f.age_max} and under`);
    return bits.length ? bits.join(" · ") : "Everyone reachable";
  }

  function segmentModal(seg, presetEvent) {
    const f = (seg && seg.filter) || (presetEvent ? { event: presetEvent } : {});
    /* Arriving from an event's registrations, the segment is already named for the thing the
       operator was looking at — they confirm rather than compose. */
    const presetName = presetEvent ? `${eventName(presetEvent)} — registrants` : "";
    openModal(`
      <h2 style="margin-top:0">${seg ? "Edit segment" : "New segment"}</h2>
      <div class="mkt-form">
        <label for="mSegName">Name</label>
        <input id="mSegName" value="${seg ? esc(seg.name) : esc(presetName)}" placeholder="League players, fall" />
        <label for="mSegTags">Has any of these tags (comma-separated, optional)</label>
        <input id="mSegTags" value="${f.tags ? esc(f.tags.join(", ")) : ""}" placeholder="newsletter, queens-club" />
        <label for="mSegPlayed">Play history</label>
        <select id="mSegPlayed">
          <option value="">Doesn't matter</option>
          <option value="any" ${f.played === "any" ? "selected" : ""}>Played anything</option>
          <option value="league" ${f.played === "league" ? "selected" : ""}>Played a league</option>
          <option value="tournament" ${f.played === "tournament" ? "selected" : ""}>Played a tournament</option>
          <option value="none" ${f.played === "none" ? "selected" : ""}>Never played yet</option>
        </select>
        <label for="mSegEvent">Registered for a specific event (optional)</label>
        <select id="mSegEvent">
          <option value="">Any event</option>
          ${EVENTS.map((e) => `<option value="${Number(e.id)}" ${Number(f.event) === Number(e.id) ? "selected" : ""}>${esc(e.name)}</option>`).join("")}
        </select>
        <label for="mSegSince">Joined on or after (optional)</label>
        <input id="mSegSince" type="date" value="${f.since || ""}" />
        <label for="mSegAgeMin">Age at least (optional)</label>
        <input id="mSegAgeMin" type="number" min="0" max="120" value="${Number.isInteger(f.age_min) ? f.age_min : ""}" placeholder="40" />
        <label for="mSegAgeMax">Age at most (optional)</label>
        <input id="mSegAgeMax" type="number" min="0" max="120" value="${Number.isInteger(f.age_max) ? f.age_max : ""}" />
        <p class="mkt-hint">Ages come from birthdates on member profiles. Anyone without one can't be seen by an age filter — the counts will say how many that is.</p>
        <div class="mkt-actions">
          <button class="btn" id="mSegSave">${seg ? "Save changes" : "Create segment"}</button>
          <button class="btn ghost" id="mSegCancel">Cancel</button>
          <span class="mkt-hint" id="mSegMsg" role="status"></span>
        </div>
      </div>`);
    $("mSegCancel").onclick = closeModal;
    $("mSegSave").onclick = async () => {
      const body = JSON.stringify({
        name: $("mSegName").value,
        filter: {
          tags: $("mSegTags").value.split(",").map((t) => t.trim()).filter(Boolean),
          played: $("mSegPlayed").value || undefined,
          /* The server coerces this string; sending it raw is deliberate and asEventId is its guard. */
          event: $("mSegEvent").value || undefined,
          since: $("mSegSince").value || undefined,
          age_min: $("mSegAgeMin").value === "" ? undefined : Number($("mSegAgeMin").value),
          age_max: $("mSegAgeMax").value === "" ? undefined : Number($("mSegAgeMax").value),
        },
      });
      const r = seg
        ? await api(`/api/admin/marketing/segments/${seg.id}/update`, { method: "POST", body })
        : await api("/api/admin/marketing/segments", { method: "POST", body });
      if (!r.ok) { $("mSegMsg").textContent = r.data.error || "Could not save."; return; }
      closeModal();
      await loadSegments();
      /* WF-6 (v0.138.0): arrived from a print screen carrying a document. The segment the
         operator just confirmed IS who it goes to, so hand both to the composer rather than
         making them find New campaign and paste. awaited, because campaignModal renders the
         segment picker from SEGMENTS and the one they just made has to be in it. */
      if (PENDING_DRAFT && !seg) { const d = takeDraft(); campaignModal(null, { ...d, segment_id: r.data.id }); }
    };
    /* Cancelling the segment must not throw the document away — the composer opens without a
       segment chosen, which is the same state New campaign gives them. */
    if (PENDING_DRAFT) $("mSegCancel").onclick = () => { closeModal(); campaignModal(null, takeDraft()); };
  }
  $("newSegBtn").onclick = () => segmentModal(null);

  async function previewSegment(id) {
    const r = await api(`/api/admin/marketing/segments/${id}/preview`);
    if (!r.ok) return fail(r.data.error || "Could not preview.");
    openModal(`
      <h2 style="margin-top:0">Who's in this segment</h2>
      <p><b>${r.data.count}</b> reachable people. First ${r.data.sample.length}:</p>
      ${r.data.no_birthdate > 0 ? `<p class="mkt-hint">${r.data.no_birthdate} more contact${r.data.no_birthdate === 1 ? " has" : "s have"} no birthdate on file — the age filter can't see them. They would otherwise be in this segment.</p>` : ""}
      ${r.data.sample.map((c) => `<div class="mkt-row"><div class="grow"><div class="k">${esc(c.full_name || "(no name)")}</div><div class="v">${esc(c.email)}</div></div></div>`).join("") || "<p>No one matches yet.</p>"}
      <div class="mkt-actions"><button class="btn ghost" id="mPrevClose">Close</button></div>`);
    $("mPrevClose").onclick = closeModal;
  }

  async function deleteSegment(id) {
    if (!confirm("Delete this segment? Campaigns already sent keep their records.")) return;
    const r = await api(`/api/admin/marketing/segments/${id}/delete`, { method: "POST" });
    if (!r.ok) return fail(r.data.error || "Could not delete.");
    loadSegments();
  }

  /* ---------- campaigns ---------- */
  async function loadCampaigns() {
    const r = await api("/api/admin/marketing/campaigns");
    if (!r.ok) return fail(r.data.error || "Could not load campaigns.");
    const rows = r.data.campaigns || [];
    $("campList").innerHTML = rows.length ? rows.map((c) => `
      <div class="mkt-row" data-id="${c.id}">
        <div class="grow"><div class="k">${esc(c.name)}${c.sandbox ? " · sandbox" : ""}</div>
          <div class="v">${c.channel === "sms" ? "Text" : "Email"} · ${c.channel === "sms" ? "to" : esc(c.subject || "(no subject)") + " →"} ${esc(c.segment_name || "no segment")}
            ${c.status !== "draft" ? ` · ${c.sent_count}/${c.recipient_count} sent${c.queued_count ? `, ${c.queued_count} queued` : ""}` : ""}</div></div>
        <span class="status-pill ${esc(c.status)}">${esc(c.status)}</span>
        ${c.status === "draft" ? `<button class="btn ghost" data-act="edit">Edit</button>` : ""}
        ${c.status === "sending" ? `<button class="btn" data-act="batch">Send next batch</button>` : ""}
        ${c.status === "draft" ? `<button class="btn ghost" data-act="del">Delete</button>` : ""}
      </div>`).join("")
      : `<p class="help-text" style="margin:8px 0 0">No campaigns yet.</p>`;
    $("campList").querySelectorAll("button").forEach((b) => {
      const id = Number(b.closest(".mkt-row").dataset.id);
      if (b.dataset.act === "edit") b.onclick = () => campaignModal(id);
      if (b.dataset.act === "del") b.onclick = () => deleteCampaign(id);
      if (b.dataset.act === "batch") b.onclick = () => processBatch(id);
    });
  }

  /* WF-6: "preset" pre-fills a NEW campaign from a document handed over by a print screen
     (BT_ADMIN.emailDocument). It is ignored when editing an existing campaign — a saved draft is
     the record, and nothing arriving in a URL gets to overwrite one. */
  async function campaignModal(id, preset) {
    let c = { name: "", subject: "", html_body: "", segment_id: null, channel: "email", sms_body: "" };
    if (!id && preset) c = { ...c, ...preset };
    if (id) {
      const r = await api(`/api/admin/marketing/campaigns/${id}`);
      if (!r.ok) return fail(r.data.error || "Could not open campaign.");
      c = r.data.campaign;
    }
    openModal(`
      <h2 style="margin-top:0">${id ? "Edit campaign" : "New campaign"}</h2>
      <div class="mkt-form">
        <label for="mCName">Name (internal)</label>
        <input id="mCName" value="${esc(c.name)}" placeholder="Fall league early-bird" />
        <label for="mCChan">Channel</label>
        <select id="mCChan">
          <option value="email" ${c.channel !== "sms" ? "selected" : ""}>Email</option>
          <option value="sms" ${c.channel === "sms" ? "selected" : ""}>Text message (SMS)</option>
        </select>
        <div id="mCEmailFields">
        <label for="mCSubj">Subject line</label>
        <input id="mCSubj" value="${esc(c.subject)}" placeholder="Fall leagues open Monday — early-bird pricing" />
        </div>
        <label for="mCSeg">Send to segment</label>
        <select id="mCSeg"><option value="">Choose…</option>
          ${SEGMENTS.map((s) => `<option value="${s.id}" ${c.segment_id === s.id ? "selected" : ""}>${esc(s.name)} (${s.count})</option>`).join("")}
        </select>
        <p class="mkt-hint" id="mCSegNote" role="status"></p>
        <div id="mCBodyEmail">
        <label for="mCBody">Email body (HTML or plain text)</label>
        <textarea id="mCBody" placeholder="Hi {{first_name}}, ...">${esc(c.html_body)}</textarea>
        <p class="mkt-hint">Personalize with {{first_name}}, {{full_name}}, {{email}}. The legal footer (address + unsubscribe) is added automatically — never write your own.</p>
        <label for="mCTest">Test address</label>
        <input id="mCTest" type="email" placeholder="you@boomtownvb.com" />
        </div>
        <div id="mCBodySms" hidden>
        <label for="mCSms">Text message (plain text)</label>
        <textarea id="mCSms" maxlength="480" placeholder="Hi {{first_name}} — fall leagues open Monday. Early-bird pricing this week: boomtownvb.com">${esc(c.sms_body || "")}</textarea>
        <p class="mkt-hint" id="mCSmsMeter" aria-live="polite"></p>
        <p class="mkt-hint">Personalize with {{first_name}}, {{full_name}}. Only people who opted in to texts get it — carriers add STOP/HELP handling automatically.</p>
        </div>
        <div class="mkt-actions">
          <button class="btn ghost" id="mCSave">Save draft</button>
          <button class="btn ghost" id="mCTestBtn">Send test</button>
          <button class="btn" id="mCSendBtn">Send to segment</button>
          <button class="btn ghost" id="mCCancel">Cancel</button>
        </div>
        <div class="mkt-hint" id="mCMsg" role="status" style="margin-top:8px"></div>
        <div id="mCPreview" hidden class="preview-box"></div>
      </div>`);
    $("mCCancel").onclick = closeModal;

    /* SG-4 (§-1o), the owner's requirement in his own words: "the send screen must SAY how many
       of the org's contacts are invisible to the filter." Live coverage is sparse (49 contacts,
       0 birthdates at build time), so an age-filtered send that reaches almost nobody must
       explain itself here, at the moment of sending — or a small send reads as a broken one. */
    const paintSegNote = () => {
      const s = SEGMENTS.find((x) => x.id === Number($("mCSeg").value));
      $("mCSegNote").textContent = s && s.no_birthdate > 0
        ? `${s.no_birthdate} more contact${s.no_birthdate === 1 ? " has" : "s have"} no birthdate on file — the age filter can't see them, so they won't get this.`
        : "";
    };
    paintSegNote();
    $("mCSeg").addEventListener("change", paintSegNote);

    const applyChannel = () => {
      const sms = $("mCChan").value === "sms";
      $("mCBodyEmail").hidden = sms;
      $("mCEmailFields").hidden = sms;
      $("mCBodySms").hidden = !sms;
      $("mCTestBtn").hidden = sms; // reach preview covers text campaigns; no test send yet
      $("mCSendBtn").textContent = sms ? "Text the segment" : "Send to segment";
      meter();
    };
    const meter = () => {
      const n = $("mCSms").value.length;
      const seg = n === 0 ? 0 : Math.ceil(n / 160);
      $("mCSmsMeter").textContent = `${n}/480 characters · ${seg} SMS segment${seg === 1 ? "" : "s"} of 3`;
    };
    $("mCChan").onchange = applyChannel;
    $("mCSms").oninput = meter;
    applyChannel();

    const save = async () => {
      const body = JSON.stringify({
        name: $("mCName").value, subject: $("mCSubj").value,
        html_body: $("mCBody").value, segment_id: Number($("mCSeg").value) || null,
        channel: $("mCChan").value, sms_body: $("mCSms").value,
      });
      const r = id
        ? await api(`/api/admin/marketing/campaigns/${id}/update`, { method: "POST", body })
        : await api("/api/admin/marketing/campaigns", { method: "POST", body });
      if (r.ok && !id) id = r.data.id;
      return r;
    };
    $("mCSave").onclick = async () => {
      const r = await save();
      $("mCMsg").textContent = r.ok ? "Draft saved." : (r.data.error || "Could not save.");
      if (r.ok) loadCampaigns();
    };
    $("mCTestBtn").onclick = async () => {
      const s = await save();
      if (!s.ok) { $("mCMsg").textContent = s.data.error || "Save the draft first."; return; }
      const r = await api(`/api/admin/marketing/campaigns/${id}/test`, {
        method: "POST", body: JSON.stringify({ email: $("mCTest").value }),
      });
      $("mCMsg").textContent = r.ok ? (r.data.message || "Test sent.") : (r.data.error || "Test failed.");
      if (r.ok && r.data.preview_html) { $("mCPreview").hidden = false; $("mCPreview").innerHTML = r.data.preview_html; }
    };
    $("mCSendBtn").onclick = async () => {
      const s = await save();
      if (!s.ok) { $("mCMsg").textContent = s.data.error || "Save the draft first."; return; }
      const isSms = $("mCChan").value === "sms";
      if (!confirm(isSms
        ? "Text everyone in this segment who opted in? Sent campaigns can't be edited."
        : "Send this campaign to the whole segment? Sent campaigns can't be edited.")) return;
      const r = await api(`/api/admin/marketing/campaigns/${id}/send`, { method: "POST" });
      $("mCMsg").textContent = r.ok ? r.data.message : (r.data.error || "Could not send.");
      if (r.ok) { loadCampaigns(); loadOverview(); }
    };
  }
  $("newCampBtn").onclick = () => campaignModal(null);

  async function deleteCampaign(id) {
    if (!confirm("Delete this draft?")) return;
    const r = await api(`/api/admin/marketing/campaigns/${id}/delete`, { method: "POST" });
    if (!r.ok) return fail(r.data.error || "Could not delete.");
    loadCampaigns();
  }

  async function processBatch(id) {
    const r = await api(`/api/admin/marketing/campaigns/${id}/process`, { method: "POST" });
    if (!r.ok) return fail(r.data.error || "Could not process the batch.");
    loadCampaigns();
  }

  await loadOverview();
  await loadEvents();
  await loadSegments();
  await loadCampaigns();

  /* Arrived from "Email these registrants" on an event's registrations: open the new-segment
     form with that event already chosen. Two taps from the registration list to a real segment. */
  const fromEvent = Number(new URLSearchParams(location.search).get("event")) || 0;
  if (fromEvent) segmentModal(null, fromEvent);
  else if (PENDING_DRAFT) campaignModal(null, takeDraft()); // a document with no event still composes
})();
/* Changelog: v1.2 (2026-08-06, v0.99.0) — §-1b W-F: segments can target ONE event. Event picker in
   the segment form, the event named in the segment's description, and a ?event= deep link that
   arrives from the registrations screen with the event chosen and the segment named. */
/* Changelog: v1.1 (2026-08-01, v0.44.0) — Marketing SMS scope C: channel select, plain-text SMS
   body with live segment meter (480 cap), texting status chip, channel-labeled campaign rows,
   channel-aware send confirm. */
/* Changelog: v1.0 (2026-07-24) — initial admin UI for M14 Phase A. */
