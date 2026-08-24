/* Boomtown Platform — frontend config
   Version: v0.8.0 · Date: 2026-08-24
   v0.8.0 (v0.194.0, §-1r RF-15, owner 2026-08-24): BT_THEME.attachPicker — "Theme picker should
   be available from the button, not just from menu. And option to choose colors should be
   available." The ◐ opens a compact popover mounting the SAME six chips mountPicker renders on
   Settings and the admin Appearance modal (one judgement, third mount); Light/Dark are the first
   two chips, so the flip stays one tap inside the picker. Every shell hands its button here, and
   a DOMContentLoaded fallback binds shell-less pages (kiosk, check-in, waiver, guardian) that
   carry the button alone. Guards: header_shell.test.mjs v4.1.
   The ONLY file that changes when the backend URL changes.
   v0.3.0: RENTALS_ENABLED feature flag (owner decision D-M12B-2 — the member court-rental
   request form stays HIDDEN until the owner flips this to true).
   v0.4.0 (v0.137.0, §-1c D-29): BT_SIGNUP_LINK — the one place that decides where a sign-up
   link points. It sits here because config.js is the only script all three callers load.
   v0.5.0 (v0.140.0, WF-5 H-2): the embed CHILD, moved here from admin-nav.js for the same
   reason — H-2's Live tab is a MEMBER page, and config.js is the only script both shells load.
   v0.7.0 (v0.176.0, §-1r RF-7): BT_CAL — the calendar day cap, one judgement for both grids. */
window.BT_CONFIG = {
  apiBase: "https://boomtown-api.vvisuth.workers.dev",
  RENTALS_ENABLED: false,
};

/* THE CALENDAR DAY CAP — ONE JUDGEMENT, TWO READERS (§-1r RF-7, v0.176.0).
   WF-1a (v0.133.0) capped the ADMIN month grid: a busy day stacked every event and stretched its
   whole grid row, so busy weeks towered over empty ones. The MEMBER calendar (schedule.js) never
   got it — "the calendar boxes are STILL not correct" was the owner reading that honestly. The
   judgement lives HERE because config.js is the one script BOTH shells load (BT_SIGNUP_LINK's and
   BT_THEME's precedent): admin-events.js and schedule.js both render through split() and neither
   carries its own cap literal — events_calendar.test.mjs executes THIS object through the admin
   cell builder and forbids a second spelling in either reader. */
window.BT_CAL = {
  DAY_CAP: 3,
  /** shown/hidden split for one day's events — the whole cap judgement. */
  split(dayEvents) {
    const shown = dayEvents.slice(0, this.DAY_CAP);
    return { shown, hidden: dayEvents.length - shown.length };
  },
};

/* WHERE A SIGN-UP LINK POINTS — ONE JUDGEMENT, EVERY CALLER.
   SG-1 (v0.132.0) decided the first axis: drop-in types (training, event) sign up on the public
   sheet, team types keep the registration form. The rule was then written out twice —
   schedule.js:17 and admin-event.js:42 — and home.js, which never got it, linked
   `register.html?event_id=` while register.js reads `?event=`, so every "View" button on the
   member home landed on the missing-event refusal (D-29). Both halves moved here: the page AND
   the parameter, because splitting them is what let one caller get the parameter wrong alone.

   v0.6.0 (v0.147.0, §-1m PM-1 / §-0 B6) — A SECOND AXIS, AND A SIGNATURE CHANGE THAT IS THE
   POINT. An event can now carry `external_url` and send people to Volleyball Life / Volo instead
   of registering them here. The cheap way to add that was a third parameter,
   `BT_SIGNUP_LINK(type, id, externalUrl)` — and a caller that forgot it would have silently
   produced the internal link, which is D-29 happening a second time in the same function. It now
   takes the WHOLE EVENT and returns the WHOLE DECISION, so "forgot to pass the external URL" is
   not expressible. Building this unit found `leagues.js` doing exactly what the old comment
   forbade: a member-facing Register button with its own href, producing the same string as the
   helper today and silently ignoring an external URL tomorrow.

   Returns { href, external, label, rel, target }. §-1m's rule 1 is why the last three exist: an
   outbound link must be VISIBLY outbound, "or we have made a third party look like us". */
window.BT_SIGNUP = function (event) {
  const e = event || {};
  const url = String(e.external_url == null ? "" : e.external_url).trim();
  if (url) {
    const label = String(e.external_label == null ? "" : e.external_label).trim();
    return {
      href: url,
      external: true,
      // Never the bare URL as the label: a link whose words are "https://…" tells a member the
      // address but not what pressing it does.
      label: label || "Register on their site",
      rel: "noopener noreferrer",
      target: "_blank",
    };
  }
  const page = (e.type === "training" || e.type === "event") ? "sheet.html?event=" : "register.html?event=";
  return { href: page + encodeURIComponent(e.id), external: false, label: "Sign up", rel: "", target: "" };
};

/* THE EMBED CHILD — ONE IMPLEMENTATION FOR EVERY PAGE IN THE APP.
   The manager hub (WF-5) shows existing pages inside same-origin iframes. `?embed=1` puts a page
   in chromeless mode (body.embed — the rule set lives once in app.css) and reports its height so
   the hub can size the frame to its content instead of scrolling inside a box.

   IT LIVES HERE RATHER THAN IN admin-nav.js, WHERE H-1 PUT IT. H-2's Live Scoring Board tab is
   `live.html`, a MEMBER page: it loads site-nav.js and app.css and has never loaded the admin
   shell, so a child living in admin-nav.js could not reach it — and a second copy in site-nav.js
   would have been a third implementation of one message. config.js is the only script both shells
   load, which is exactly why BT_SIGNUP_LINK is here too.

   THE CONTRACT IS NOT NEW: schedule.js has posted {bt_widget_height, slug} to its parent since
   v0.4.0 and web/widget.js has been the parent that listens and filters by slug. This is the same
   message. It stays a separate implementation from widget.js because widget.js is a drop-in
   <script> served to EXTERNAL customer sites and cannot import from this repo —
   manager_hub.test.mjs asserts the key is identical across all four files.

   `slug` is echoed back untouched: two frames on one page must never resize each other. */
(function embedChild() {
  const q = new URLSearchParams(location.search);
  if (q.get("embed") !== "1") return;
  const slug = q.get("slug") || "";
  document.documentElement.classList.add("embed");
  const mark = () => document.body && document.body.classList.add("embed");
  mark();
  document.addEventListener("DOMContentLoaded", mark);
  const post = () => {
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage({ bt_widget_height: document.documentElement.scrollHeight, slug }, "*");
  };
  document.addEventListener("DOMContentLoaded", () => {
    post();
    // These pages render after their own fetches, so one post at load would freeze the frame at
    // its empty height. Observing the body covers every later render without any page knowing.
    if (window.ResizeObserver && document.body) new ResizeObserver(post).observe(document.body);
  });
  window.addEventListener("load", post);
})();

/* THE THEME SERVICE — v0.7.0 (v0.160.0, §-1j T2-15 / §-0 B13 / work-order W1).
   ONE place a theme choice becomes state. It sits here for BT_SIGNUP's exact reason: config.js
   is the only script both shells load, and the alternative was a second copy of this logic in
   site-nav.js and admin-nav.js — the D-32 two-consumer shape from birth.

   THE STATE MODEL. `data-theme` on <html> keeps its day-one meaning: the binary MODE
   (light|dark) — every existing selector, JS comparison and the widget's embed contract are
   untouched. `data-template` is a SECOND attribute naming one of W1's four palettes
   (tokens.css owns the values; theme_tokens.test.mjs pins that this list and those blocks are
   one set). Storage: `bt_theme` = mode, unchanged; `bt_template` = the ACTIVE template or
   absent; `bt_template_light`/`bt_template_dark` remember the last pick per mode ("" = the
   plain default), which is the demo's lastLight/lastDark behaviour — the ◐ toggle stays an
   instant mode flip and returns you to the template you used on that side, or the default if
   you never picked one. A user who never touches the picker has no template keys and gets
   byte-for-byte today's behaviour.

   The pre-paint half lives in each page's head (the byte-identical bt_template line, applied
   before the first stylesheet); this service is the WRITE side. */
window.BT_THEME = (function () {
  const TEMPLATES = [
    { key: "daylight", label: "Daylight", mode: "light" },
    { key: "chalk", label: "Chalk", mode: "light" },
    { key: "midnight", label: "Midnight", mode: "dark" },
    { key: "court-navy", label: "Court Navy", mode: "dark" },
  ];
  const byKey = (k) => TEMPLATES.find((t) => t.key === k) || null;
  const root = () => document.documentElement;
  /* D-42 (v0.167.0): this pair joins the page-level fallback map. bt_theme's only two writers are
     app.js and this service; app.js already reads through the shared map, so a private one here
     would leave the theme split in a blocked-storage profile — the exact split D-42 removes. */
  const localMem = window.BT_MEM_FALLBACK || (window.BT_MEM_FALLBACK = new Map());
  const get = (k) => {
    try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) {}
    return localMem.has(k) ? localMem.get(k) : null;
  };
  const put = (k, v) => {
    v == null ? localMem.delete(k) : localMem.set(k, v);
    try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {}
  };

  function state() {
    const tpl = byKey(root().dataset.template || "");
    return { mode: root().dataset.theme === "light" ? "light" : "dark", template: tpl ? tpl.key : "" };
  }
  /* choose() takes one of SIX values: "light" / "dark" (the plain defaults) or a template key.
     A template carries its own mode, so choosing one can never produce the junk pairing the
     CSS is defensive about. Unknown keys degrade to the dark default — the same fail-open the
     pre-paint line has. */
  function choose(key) {
    const tpl = byKey(key);
    const mode = tpl ? tpl.mode : (key === "light" ? "light" : "dark");
    if (tpl) root().dataset.template = tpl.key; else delete root().dataset.template;
    root().dataset.theme = mode;
    put("bt_theme", mode);
    put("bt_template", tpl ? tpl.key : null);
    put("bt_template_" + mode, tpl ? tpl.key : "");
    return state();
  }
  /* The ◐ toggle: flip the mode, restore that side's remembered template (or its default). */
  function toggleMode() {
    const next = state().mode === "dark" ? "light" : "dark";
    return choose(get("bt_template_" + next) || next);
  }
  /* The human name of the current choice — settings.html's #themeNow label reads this. */
  function describe() {
    const s = state();
    const tpl = byKey(s.template);
    return tpl ? tpl.label : (s.mode === "dark" ? "Dark (black & gold)" : "Light (white & navy)");
  }
  /* ONE picker, both shells. Six chips; swatches paint themselves from tokens.css by carrying
     the data-theme/data-template attribute — no hex is restated here, so the swatch cannot
     drift from the palette it advertises. */
  function mountPicker(container, onChange) {
    const CHOICES = [
      { key: "light", label: "Light", attr: 'data-theme="light"' },
      { key: "dark", label: "Dark", attr: 'data-theme="dark"' },
    ].concat(TEMPLATES.map((t) => ({ key: t.key, label: t.label, attr: 'data-template="' + t.key + '"' })));
    const active = state().template || state().mode;
    container.innerHTML = CHOICES.map((c) => (
      '<button type="button" class="tpl-chip' + (c.key === active ? " active" : "") + '" data-choose="' + c.key + '" aria-pressed="' + (c.key === active) + '">' +
      '<span class="tpl-sw" ' + c.attr + ' aria-hidden="true"><i class="sw-bg"></i><i class="sw-primary"></i><i class="sw-surface"></i><i class="sw-accent"></i></span>' +
      '<span class="tpl-name">' + c.label + "</span></button>"
    )).join("");
    container.addEventListener("click", (e) => {
      const b = e.target.closest("[data-choose]");
      if (!b) return;
      choose(b.dataset.choose);
      container.querySelectorAll(".tpl-chip").forEach((chip) => {
        const on = chip.dataset.choose === b.dataset.choose;
        chip.classList.toggle("active", on);
        chip.setAttribute("aria-pressed", String(on));
      });
      if (onChange) onChange(state());
    });
  }
  /* RF-15 (v0.194.0): the picker, FROM the button. The click is bound HERE — the service is the
     one binder — and opens a fixed-positioned popover computed from the button's rect, so no
     shell has to provide a positioning context. The chips are mountPicker's (mounted once,
     re-synced on every open so a choice made elsewhere — Settings, the admin Appearance modal —
     reads back correctly). Closes on Escape (focus returned), outside click, or re-press.
     Idempotent per button via data-bt-picker: a second attach, including the DOMContentLoaded
     fallback below, is a no-op, so a shell and the fallback can never double-bind. */
  function attachPicker(btn, onChange) {
    if (!btn || btn.dataset.btPicker) return;
    btn.dataset.btPicker = "1";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    const pop = document.createElement("div");
    pop.className = "theme-pop";
    pop.hidden = true;
    pop.setAttribute("aria-label", "Theme and colors");
    const chips = document.createElement("div");
    chips.className = "tpl-chips";
    pop.appendChild(chips);
    document.body.appendChild(pop);
    let mounted = false;
    const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    const syncActive = () => {
      const active = state().template || state().mode;
      pop.querySelectorAll(".tpl-chip").forEach((chip) => {
        const on = chip.dataset.choose === active;
        chip.classList.toggle("active", on);
        chip.setAttribute("aria-pressed", String(on));
      });
    };
    btn.addEventListener("click", () => {
      if (!pop.hidden) { close(); return; }
      if (!mounted) { mounted = true; mountPicker(chips, onChange); }
      syncActive();
      const r = btn.getBoundingClientRect();
      pop.style.top = (r.bottom + 8) + "px";
      pop.style.right = Math.max(8, window.innerWidth - r.right) + "px";
      pop.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    });
    document.addEventListener("click", (e) => {
      if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !pop.hidden) { close(); btn.focus(); }
    });
  }

  return { templates: TEMPLATES, state, choose, toggleMode, describe, mountPicker, attachPicker };
})();

/* RF-15: the binder of last resort — a page with a ◐ but NO shell script (kiosk, check-in, the
   waiver page, the guardian landing) gets the picker by carrying the button alone. Runs at
   DOMContentLoaded, which is AFTER every shell binder (sync scripts and deferred site-nav both
   precede it), and attachPicker's data-bt-picker guard makes a second attach a no-op — so a
   shell's onChange always wins where a shell exists. */
document.addEventListener("DOMContentLoaded", () => {
  const t = document.getElementById("themeToggle");
  if (t && !t.dataset.btPicker) window.BT_THEME.attachPicker(t);
});
