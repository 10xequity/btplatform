<!DOCTYPE html>
<!-- Boomtown Platform — Point of Sale (M15) · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.18.0
     Sell (create sale with server-side pricing + promo code), Products, Promo Codes,
     Sponsors, Shifts, Insights (R-02 attendance heatmap + POS sales + R-05 shift coverage).
     Square payments record as SANDBOX until the owner flips standing rule 1. -->
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Point of Sale — Boomtown Athletics</title>
  <link rel="stylesheet" href="assets/tokens.css" />
  <link rel="stylesheet" href="assets/app.css" />
  <link rel="stylesheet" href="assets/admin.css?v=0.18.0" />
  <style>
    .pos-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin: 0 0 16px; border-bottom: 1px solid var(--border); }
    .pos-tab { min-height: 44px; padding: 10px 16px; font: inherit; font-weight: 700; color: var(--text-muted);
      background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer; }
    .pos-tab[aria-selected="true"] { color: var(--primary); border-bottom-color: var(--primary); }
    .pos-tab:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .pos-panel { display: none; }
    .pos-panel.on { display: block; animation: posIn 200ms cubic-bezier(0.23,1,0.32,1); }
    @keyframes posIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .pos-panel.on { animation: none; } }
    .pos-grid { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; align-items: start; }
    @media (max-width: 1020px) { .pos-grid { grid-template-columns: 1fr; } }
    .pos-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); padding: 16px; }
    .pos-card h2 { margin: 0 0 8px; font-size: 17px; }
    .pos-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--border); flex-wrap: wrap; }
    .pos-row:first-of-type { border-top: 0; }
    .pos-row .grow { flex: 1; min-width: 160px; }
    .pos-row .k { font-weight: 700; }
    .pos-row .v { color: var(--text-muted); font-size: 13px; }
    .pos-form label { display: block; font-weight: 700; font-size: 14px; margin: 12px 0 4px; }
    .pos-form input, .pos-form select { width: 100%; font: inherit; padding: 10px 12px; border: 1px solid var(--border);
      border-radius: var(--radius-control); background: var(--surface-raised); color: var(--text); }
    .pos-hint { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
    .pos-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
    .pos-total { font-size: 22px; font-weight: 700; }
    .pos-chip { background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 6px 12px; font-size: 13px; font-weight: 600; }
    .pos-chip.warn { border-color: var(--warn, #e6a23c); color: var(--warn, #e6a23c); }
    .pos-chip.ok { color: var(--positive); }
    .pill { border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 800; background: var(--surface-raised); border: 1px solid var(--border); }
    .pill.voided { color: var(--danger); }
    .pill.recorded { color: var(--positive); }
    .hm-wrap { overflow-x: auto; }
    .hm { display: grid; grid-template-columns: 44px repeat(18, minmax(20px, 1fr)); gap: 2px; min-width: 560px; }
    .hm .cell { aspect-ratio: 1; border-radius: 3px; background: var(--surface-raised); }
    .hm .lab { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; }
    .hm .hlab { font-size: 10px; color: var(--text-muted); text-align: center; }
    button.primary, button.secondary, button.ghost { min-height: 44px; }
    button:active { transform: scale(0.97); transition: transform 120ms cubic-bezier(0.23,1,0.32,1); }
  </style>
</head>
<body>
  <div id="app" class="admin-shell">
    <main class="admin-main" style="padding:16px; max-width:1100px; margin:0 auto;">
      <h1 style="font-size:28px; margin:8px 0 4px;">Point of Sale</h1>
      <p class="pos-hint" style="margin:0 0 12px;">Gear, drop-ins, and anything sold at the desk. Square payments stay in <b>sandbox</b> until you say go — cash and comp record normally.</p>
      <div class="pos-tabs" role="tablist" aria-label="Point of sale sections">
        <button class="pos-tab" role="tab" data-tab="sell" aria-selected="true">Sell</button>
        <button class="pos-tab" role="tab" data-tab="products" aria-selected="false">Products</button>
        <button class="pos-tab" role="tab" data-tab="promos" aria-selected="false">Promo Codes</button>
        <button class="pos-tab" role="tab" data-tab="sponsors" aria-selected="false">Sponsors</button>
        <button class="pos-tab" role="tab" data-tab="shifts" aria-selected="false">Shifts</button>
        <button class="pos-tab" role="tab" data-tab="insights" aria-selected="false">Insights</button>
      </div>

      <section class="pos-panel on" id="panel-sell" role="tabpanel" aria-label="Sell">
        <div class="pos-grid">
          <div class="pos-card pos-form">
            <h2>New sale</h2>
            <label for="sellProduct">Add a product</label>
            <div style="display:flex; gap:8px;">
              <select id="sellProduct" class="grow"></select>
              <button class="secondary" id="sellAdd" type="button">Add</button>
            </div>
            <label for="sellCustomLabel">Or a custom line</label>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <input id="sellCustomLabel" class="grow" placeholder="" aria-label="Custom item label" />
              <input id="sellCustomPrice" type="number" min="0" step="0.01" style="max-width:120px" aria-label="Custom item price in dollars" />
              <button class="secondary" id="sellAddCustom" type="button">Add</button>
            </div>
            <label for="sellPromo">Promo code (optional)</label>
            <div style="display:flex; gap:8px;">
              <input id="sellPromo" class="grow" autocapitalize="characters" />
              <button class="secondary" id="sellPromoCheck" type="button">Check</button>
            </div>
            <div id="promoState" class="pos-hint" aria-live="polite"></div>
            <label for="sellMethod">Payment</label>
            <select id="sellMethod">
              <option value="cash">Cash</option>
              <option value="square">Square (sandbox)</option>
              <option value="comp">Comp — no charge</option>
            </select>
          </div>
          <div class="pos-card">
            <h2>Cart</h2>
            <div id="cart"></div>
            <div class="pos-row" style="justify-content:space-between;">
              <span class="k">Total</span><span class="pos-total" id="cartTotal">$0.00</span>
            </div>
            <div class="pos-actions">
              <button class="primary" id="sellGo" type="button">Record sale</button>
              <button class="ghost" id="sellClear" type="button">Clear</button>
            </div>
            <div id="sellMsg" class="pos-hint" aria-live="polite"></div>
            <h2 style="margin-top:20px;">Recent sales</h2>
            <div id="salesList"></div>
          </div>
        </div>
      </section>

      <section class="pos-panel" id="panel-products" role="tabpanel" aria-label="Products">
        <div class="pos-grid">
          <div class="pos-card pos-form">
            <h2 id="prodFormTitle">Add a product</h2>
            <label for="prodName">Name</label><input id="prodName" />
            <label for="prodPrice">Price (dollars)</label><input id="prodPrice" type="number" min="0" step="0.01" />
            <label for="prodTax">Tax rate (%) — leave 0 for none</label><input id="prodTax" type="number" min="0" step="0.01" value="0" />
            <label for="prodStock">Stock count — leave blank to skip tracking</label><input id="prodStock" type="number" step="1" />
            <div class="pos-actions">
              <button class="primary" id="prodSave" type="button">Save product</button>
              <button class="ghost" id="prodCancel" type="button" hidden>Cancel edit</button>
            </div>
            <div id="prodMsg" class="pos-hint" aria-live="polite"></div>
          </div>
          <div class="pos-card"><h2>Products</h2><div id="prodList"></div></div>
        </div>
      </section>

      <section class="pos-panel" id="panel-promos" role="tabpanel" aria-label="Promo codes">
        <div class="pos-grid">
          <div class="pos-card pos-form">
            <h2 id="promoFormTitle">Add a promo code</h2>
            <label for="pcCode">Code</label><input id="pcCode" autocapitalize="characters" />
            <label for="pcKind">Type</label>
            <select id="pcKind"><option value="percent">Percent off</option><option value="fixed">Dollars off</option></select>
            <label for="pcAmount">Amount (percent or dollars)</label><input id="pcAmount" type="number" min="0" step="0.01" />
            <label for="pcCap">Max uses — leave blank for unlimited</label><input id="pcCap" type="number" min="0" step="1" />
            <label for="pcStart">Starts (optional)</label><input id="pcStart" type="datetime-local" />
            <label for="pcEnd">Expires (optional)</label><input id="pcEnd" type="datetime-local" />
            <div class="pos-actions">
              <button class="primary" id="pcSave" type="button">Save code</button>
              <button class="ghost" id="pcCancel" type="button" hidden>Cancel edit</button>
            </div>
            <div id="pcMsg" class="pos-hint" aria-live="polite"></div>
            <p class="pos-hint">Codes work at the register today; registration checkout picks them up in a later release.</p>
          </div>
          <div class="pos-card"><h2>Codes</h2><div id="promoList"></div></div>
        </div>
      </section>

      <section class="pos-panel" id="panel-sponsors" role="tabpanel" aria-label="Sponsors">
        <div class="pos-grid">
          <div class="pos-card pos-form">
            <h2 id="spFormTitle">Add a sponsor</h2>
            <label for="spName">Name</label><input id="spName" />
            <label for="spLogo">Logo image URL (optional)</label><input id="spLogo" />
            <label for="spLink">Link URL (optional)</label><input id="spLink" />
            <label for="spPlace">Placement</label>
            <select id="spPlace"><option value="home">Home page</option><option value="schedule">Schedule page</option><option value="events">Event pages</option></select>
            <label for="spStart">Runs from (optional)</label><input id="spStart" type="datetime-local" />
            <label for="spEnd">Runs until (optional)</label><input id="spEnd" type="datetime-local" />
            <div class="pos-actions">
              <button class="primary" id="spSave" type="button">Save sponsor</button>
              <button class="ghost" id="spCancel" type="button" hidden>Cancel edit</button>
            </div>
            <div id="spMsg" class="pos-hint" aria-live="polite"></div>
            <p class="pos-hint">Active sponsors are served at <code>/api/sponsors?placement=…</code> — the site slots render whatever is live in its window.</p>
          </div>
          <div class="pos-card"><h2>Sponsors</h2><div id="spList"></div></div>
        </div>
      </section>

      <section class="pos-panel" id="panel-shifts" role="tabpanel" aria-label="Staff shifts">
        <div class="pos-grid">
          <div class="pos-card pos-form">
            <h2 id="shFormTitle">Add a shift</h2>
            <label for="shWho">Staff name</label><input id="shWho" />
            <label for="shRole">Role (optional)</label><input id="shRole" placeholder="" />
            <label for="shStart">Starts</label><input id="shStart" type="datetime-local" />
            <label for="shEnd">Ends</label><input id="shEnd" type="datetime-local" />
            <label for="shNote">Note (optional)</label><input id="shNote" />
            <div class="pos-actions">
              <button class="primary" id="shSave" type="button">Save shift</button>
              <button class="ghost" id="shCancel" type="button" hidden>Cancel edit</button>
            </div>
            <div id="shMsg" class="pos-hint" aria-live="polite"></div>
          </div>
          <div class="pos-card"><h2>Next 14 days</h2><div id="shList"></div></div>
        </div>
      </section>

      <section class="pos-panel" id="panel-insights" role="tabpanel" aria-label="Insights">
        <div class="pos-card" style="margin-bottom:16px;">
          <h2>When the gym is busy <span class="pos-hint">(check-ins, last 8 weeks — 6 AM to midnight)</span></h2>
          <div class="hm-wrap"><div class="hm" id="heatmap" role="img" aria-label="Attendance heatmap by weekday and hour"></div></div>
        </div>
        <div class="pos-grid">
          <div class="pos-card"><h2>Register sales — last 30 days</h2><div id="insSales"></div></div>
          <div class="pos-card"><h2>Shift coverage — next 14 days</h2><div id="insCover"></div></div>
        </div>
      </section>
    </main>
  </div>
  <script src="assets/config.js"></script>
  <script src="assets/admin.js"></script>
  <script src="assets/admin-nav.js"></script>
  <script src="assets/admin-pos.js" defer></script>
</body>
</html>
