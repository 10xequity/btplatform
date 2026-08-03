/* Boomtown Platform — Scoring links (admin page script)
   File: web/assets/admin-score-links.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.68.0

   One card per team: name, the link, and a QR code for it. Printable, because the way this actually
   gets used is that someone prints a sheet, cuts it up, and hands a captain a slip of paper at the
   desk. When SMS is live the same link can be texted instead — nothing here needs to change for
   that, the link is the link.

   The QR is drawn locally by assets/qr.js. Nothing on this page reaches an outside host, which
   matters because it is used in a gym on whatever wifi the venue has. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let eventId = null;

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

  async function make() {
    if (!eventId) return;
    $("lNote").textContent = "Working…";
    const r = await api(`/api/events/${eventId}/score-links`, { method: "POST" });
    if (!r.ok) { $("lNote").textContent = ""; return fail("lCards", r.data.error || "Couldn't make the links."); }
    const links = r.data.links || [];
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
    if (!r.ok) return fail("lCards", "Couldn't load your events.");
    const list = (r.data.events || []).slice(0, 40);
    $("lEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    eventId = list.length ? list[0].id : null;
    $("lEmpty").hidden = false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("lEvent").addEventListener("change", () => {
      eventId = Number($("lEvent").value);
      $("lCards").innerHTML = "";
      $("lNote").textContent = "";
      $("lEmpty").hidden = false;
    });
    $("lMake").addEventListener("click", make);
    $("lPrint").addEventListener("click", () => window.print());
    loadEvents();
  });
})();
