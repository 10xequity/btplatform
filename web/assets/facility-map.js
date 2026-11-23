/* Boomtown Platform — "Where's my court?"
   File: web/assets/facility-map.js · Version: v1.0 · Date: 2026-11-23 · Ships in: v0.217.0

   Owner 2026-11-23: "volleyball courts are estimated 2 per zone 1-7, zone 7 has 3 volleyball courts.
   Count sequentially up. We may add that as a button to where's my court and then link to the map."

   ONE numbering, the one migration 0055 already seeded into `spaces` (VB 1–15):
     Zone 1 = VB 1–2 · Zone 2 = VB 3–4 · Zone 3 = VB 5–6 · Zone 4 = VB 7–8   (hardwood)
     Zone 5 = VB 9–10 · Zone 6 = VB 11–12 · Zone 7 = VB 13–15
   `zoneOf` is that rule as arithmetic, so a court number on a schedule and a zone on the floor can
   never disagree. The drawing is a SCHEMATIC (it says so on the page): zone boxes in reading order
   with the courts numbered inside them, the chosen court filled. The full map (the 2D/3D facility
   map from 2026-11-12) is linked when `BT_CONFIG.facilityMapUrl` is set; until then the schematic
   is the map, and the button never dead-ends.

   Usage: BT_FACILITY_MAP.open(court) opens the dialog; BT_FACILITY_MAP.button(court) returns a
   44px button that opens it. Tokens only; no colour beyond --accent for the chosen court. */
(function () {
  "use strict";
  const TOTAL = 15;
  function zoneOf(court) {
    const c = Number(court);
    if (!Number.isInteger(c) || c < 1 || c > TOTAL) return null;
    if (c <= 8) return Math.ceil(c / 2);
    if (c <= 10) return 5;
    if (c <= 12) return 6;
    return 7;
  }
  const ZONES = [
    { z: 1, courts: [1, 2], floor: "hardwood" }, { z: 2, courts: [3, 4], floor: "hardwood" },
    { z: 3, courts: [5, 6], floor: "hardwood" }, { z: 4, courts: [7, 8], floor: "hardwood" },
    { z: 5, courts: [9, 10], floor: "sport" }, { z: 6, courts: [11, 12], floor: "sport" },
    { z: 7, courts: [13, 14, 15], floor: "sport" },
  ];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* The schematic: Zones 1–4 across the top (the hardwood end), Zones 5–7 across the bottom, the
     entrance on the north side. Not to scale — court boxes are equal so the numbers stay legible on
     a phone, which is where this is read. */
  function svg(court) {
    const W = 640, H = 400, pad = 16;
    const zoneW = (W - pad * 5) / 4, topH = 160, botY = pad * 2 + topH + 24;
    const bottomW = (W - pad * 4) / 3, botH = H - botY - pad;
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Schematic of the building: court ${esc(court)} is in zone ${esc(zoneOf(court))}" style="width:100%;height:auto;display:block">
      <rect x="0" y="0" width="${W}" height="${H}" fill="var(--surface-2)" rx="12"/>
      <text x="${W / 2}" y="${pad + 2}" text-anchor="middle" font-size="12" fill="var(--text-muted)">▲ main entrance / parking (north) ▲</text>`;
    const zoneBox = (zn, x, y, w, h, courtsAcross) => {
      const cw = (w - 12) / courtsAcross, ch = Math.min(56, (h - 36));
      out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="var(--surface)" stroke="var(--border)"/>
        <text x="${x + 10}" y="${y + 18}" font-size="13" font-weight="700" fill="var(--text)">Zone ${zn.z}</text>`;
      zn.courts.forEach((c, i) => {
        const cx = x + 6 + i * cw, cy = y + 28;
        const mine = Number(c) === Number(court);
        out += `<rect x="${cx + 3}" y="${cy}" width="${cw - 6}" height="${ch}" rx="6"
            fill="${mine ? "var(--accent)" : "var(--surface-raised)"}" stroke="${mine ? "var(--gold-ink)" : "var(--border)"}" stroke-width="${mine ? 2 : 1}"/>
          <text x="${cx + cw / 2}" y="${cy + ch / 2 + 6}" text-anchor="middle" font-size="${mine ? 20 : 16}" font-weight="700" fill="${mine ? "var(--gold-ink)" : "var(--text)"}">${c}</text>`;
      });
    };
    ZONES.slice(0, 4).forEach((zn, i) => zoneBox(zn, pad + i * (zoneW + pad), pad * 2 + 8, zoneW, topH, 1));
    ZONES.slice(4).forEach((zn, i) => zoneBox(zn, pad + i * (bottomW + pad), botY, bottomW, botH, zn.courts.length));
    out += `<text x="${pad}" y="${pad * 2 + topH + 20}" font-size="11" fill="var(--text-muted)">Zones 1–4: hardwood (one basketball court each). Zones 5–7: sport court. Schematic, not to scale.</text></svg>`;
    return out;
  }

  let dlg = null;
  function ensure() {
    if (dlg) return dlg;
    const style = document.createElement("style");
    style.textContent = `
      .fm-dialog { border: 1px solid var(--border); border-radius: var(--radius-card); padding: 0; max-width: 680px; width: calc(100% - 24px); background: var(--surface-raised); color: var(--text); }
      .fm-dialog::backdrop { background: rgba(0,0,0,.55); }
      .fm-body { padding: 16px; }
      .fm-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
      .fm-head h2 { margin: 0; font-size: var(--fs-h2); flex: 1; }
      .fm-foot { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
      .fm-btn { min-height: 44px; }`;
    document.head.appendChild(style);
    dlg = document.createElement("dialog");
    dlg.className = "fm-dialog";
    dlg.setAttribute("aria-label", "Where's my court");
    document.body.appendChild(dlg);
    return dlg;
  }

  function open(court) {
    const d = ensure();
    const z = zoneOf(court);
    const url = (window.BT_CONFIG || {}).facilityMapUrl;
    d.innerHTML = `<div class="fm-body">
      <div class="fm-head"><h2>${z ? `Court ${esc(court)} is in Zone ${z}` : `Court ${esc(court)}`}</h2>
        <button class="btn ghost fm-btn" type="button" data-fm-close aria-label="Close">✕</button></div>
      ${z ? svg(court) : `<p class="meta">That court number isn't on the building map (courts run 1–${TOTAL}). Ask the desk.</p>`}
      <div class="fm-foot">
        ${url ? `<a class="btn ghost fm-btn" href="${esc(url)}" target="_blank" rel="noopener">Open the full map ↗</a>` : ""}
        <button class="btn fm-btn" type="button" data-fm-close>Got it</button>
      </div></div>`;
    d.querySelectorAll("[data-fm-close]").forEach((b) => (b.onclick = () => d.close()));
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }

  /** A 44px button that opens the map for `court`. Pass extra classes for the host page's look. */
  function button(court, cls = "btn ghost") {
    const z = zoneOf(court);
    return `<button type="button" class="${esc(cls)} fm-btn" data-fm-court="${esc(court)}" aria-label="Where is court ${esc(court)}">📍 Court ${esc(court)}${z ? ` · Zone ${z}` : ""}</button>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-fm-court]");
    if (b) open(b.dataset.fmCourt);
  });

  window.BT_FACILITY_MAP = { zoneOf, open, button, TOTAL_COURTS: TOTAL };
})();
