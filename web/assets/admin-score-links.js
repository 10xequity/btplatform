/* Boomtown Platform — Scoring links (admin page script)
   File: web/assets/admin-score-links.js · Version: v1.1 · Date: 2026-08-05 · Ships in: v0.91.0

   v1.1 (Block E3, audit §6.3): the first paint was a line of small text under empty controls and
   read as a blank page. The empty state is now an intentional block whose primary button IS the
   one step (Get links) — auto-loading was considered and rejected because minting links is a
   write, and a page paint must never write.

   One card per team: name, the link, and a QR code for it. Printable, because the way this actually
   gets used is that someone prints a sheet, cuts it up, and hands a captain a slip of paper at the
   desk. When SMS is live the same link can be texted instead — nothing here needs to change for
   that, the link is the link.

   The QR is drawn locally by assets/qr.js. Nothing on this page reaches an outside host, which
   matters because it is used in a gym on whatever wifi the venue has. */
(function () {
  "use strict";
  const { api, esc, fail, downloadText, csvRow, emailDocument } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let eventId = null;
  // WF-6: the minted cards, kept so the CSV and the email export the SAME set the page shows.
  // Never re-minted for an export: Get links is a POST that mints credentials, and an export
  // that quietly writes is the rule this page already refuses to break (E3, v0.91.0).
  let links = [];

  function card(l) {
    // The token is in the URL and the URL is the credential — so it is shown, never hidden behind
    // a "copy" button alone. Someone reading it off a screen to a captain has to be able to see it.
    const qr = window.BTQR
      ? window.BTQR.svg(l.url, { size: 148, label: `Scoring link for ${l.team}` })
      : "";
    return `<div class="sl-card">
      <h2 class="sl-team">${esc(l.team)}</h2>
      <div class="sl-qr">${qr}</div>
      <p class="sl-url">${esc(l.url)}</p>
      <div class="sl-actions">
        <button class="btn ghost sl-copy" type="button" data-url="${esc(l.url)}">Copy link</button>
        <button class="btn ghost sl-png" type="button" data-url="${esc(l.url)}" data-team="${esc(l.team)}">Save image</button>
      </div>
    </div>`;
  }

  /* WF-6 (v0.138.0) — print's two siblings, over the same cards the page is showing.
     The URL is the credential (see card() above), so this CSV is a list of credentials: it
     exists because handing them out IS the job — a mail merge, a text, a sheet on the desk —
     and it carries exactly what the printed card carries, no more. Neither export mints:
     Get links is a POST, and an export that quietly writes is the rule this page already keeps. */
  function csvCards() {
    if (!links.length) { $("lNote").textContent = "Press Get links first — nothing has been minted for this event yet."; return; }
    const rows = [csvRow(["Team", "Scoring link"]), ...links.map((l) => csvRow([l.team, l.url]))];
    downloadText(`${new Date().toISOString().slice(0, 10)}_scoring-links.csv`, rows.join("\r\n"));
    $("lNote").textContent = `Downloaded ${links.length} link${links.length === 1 ? "" : "s"}.`;
  }

  function emailCards() {
    if (!links.length) { $("lNote").textContent = "Press Get links first — nothing has been minted for this event yet."; return; }
    const body = ["Your scoring link — two taps to record a result, and it stops asking once your team is finished.", "",
      ...links.map((l) => `${l.team}: ${l.url}`)].join("\n");
    emailDocument(eventId, "Your scoring link", body);
  }

  async function make() {
    if (!eventId) return;
    $("lNote").textContent = "Working…";
    const r = await api(`/api/events/${eventId}/score-links`, { method: "POST" });
    if (!r.ok) { $("lNote").textContent = ""; return fail("lCards", r.data.error || "Couldn't make the links."); }
    links = r.data.links || [];
    $("lEmpty").hidden = links.length > 0;
    $("lCards").innerHTML = links.map(card).join("");
    $("lNote").textContent = links.length
      ? `${links.length} team${links.length === 1 ? "" : "s"}. A link keeps working all event — the page just stops asking once that team has no games left.`
      : "No teams on this event yet.";

    $("lCards").querySelectorAll(".sl-copy").forEach((b) => {
      b.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.url);
          const was = b.textContent;
          b.textContent = "Copied ✓";
          setTimeout(() => { b.textContent = was; }, 1400);
        } catch {
          // Clipboard access is refused often enough — on http, or without a user gesture the
          // browser trusts — that failing silently would look like a broken button.
          $("lNote").textContent = "Couldn't reach the clipboard — select the link and copy it.";
        }
      });
    });

    // "Save image" writes a PNG. Owner 2026-08-03: the QR is for sending by text or email, and
    // neither carries an inline SVG — mail clients strip it and SMS has no markup at all.
    $("lCards").querySelectorAll(".sl-png").forEach((b) => {
      b.addEventListener("click", () => {
        const ok = window.BTQR && window.BTQR.download(b.dataset.url, `scoring-${b.dataset.team}`, { scale: 10 });
        $("lNote").textContent = ok
          ? `Saved a PNG for ${b.dataset.team}. Attach it to a text or an email — the link inside it is the same one.`
          : "Couldn't make the image here — use Copy link instead.";
      });
    });
  }

  async function loadEvents() {
    const r = await api("/api/events");
    if (!r.ok) return BT_ADMIN.loadFail("lCards", r, "events"); // v0.89.0 Block B4: a 403 names the org, not the module
    const list = (r.data.events || []).slice(0, 40);
    $("lEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    // WF-5 H-2 (v0.140.0): the manager hub points this page at ONE event via ?event=N. ADDITIVE —
    // with no ?event= the page behaves exactly as it did from the rail, which is what makes the hub
    // reversible and keeps this page's own way in. An id this org cannot see is ignored, never
    // forced: the picker is the org's own truth.
    const fromUrl = Number(new URLSearchParams(location.search).get("event")) || 0;
    eventId = list.length ? list[0].id : null;
    if (fromUrl && list.some((e) => e.id === fromUrl)) eventId = fromUrl;
    if (!eventId) return BT_ADMIN.orgEmptyState("lCards", "events"); // v0.89.0 Block B3: an empty org is not a broken module
    $("lEmpty").hidden = false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("lEvent").value = String(eventId || "");
    $("lEvent").addEventListener("change", () => {
      eventId = Number($("lEvent").value);
      $("lCards").innerHTML = "";
      $("lNote").textContent = "";
      $("lEmpty").hidden = false;
    });
    $("lMake").addEventListener("click", make);
    // E3 (v0.91.0, audit §6.3): the empty state is now the instruction AND the action. Links are
    // deliberately NOT minted on page load — Get links is a POST that mints credentials, and a
    // paint should never write — so the one step is made unmissable instead.
    $("lEmptyGo").addEventListener("click", make);
    $("lPrint").addEventListener("click", () => window.print());
    $("lCsv").addEventListener("click", csvCards);
    $("lEmail").addEventListener("click", emailCards);
    loadEvents();
  });
})();
