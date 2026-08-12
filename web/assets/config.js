/* Boomtown Platform — frontend config
   Version: v0.4.0 · Date: 2026-08-12
   The ONLY file that changes when the backend URL changes.
   v0.3.0: RENTALS_ENABLED feature flag (owner decision D-M12B-2 — the member court-rental
   request form stays HIDDEN until the owner flips this to true).
   v0.4.0 (v0.137.0, §-1c D-29): BT_SIGNUP_LINK — the one place that decides where a sign-up
   link points. It sits here because config.js is the only script all three callers load.
   v0.5.0 (v0.140.0, WF-5 H-2): the embed CHILD, moved here from admin-nav.js for the same
   reason — H-2's Live tab is a MEMBER page, and config.js is the only script both shells load. */
window.BT_CONFIG = {
  apiBase: "https://boomtown-api.vvisuth.workers.dev",
  RENTALS_ENABLED: false,
};

/* WHERE A SIGN-UP LINK POINTS — ONE JUDGEMENT, THREE CALLERS.
   SG-1 (v0.132.0) decided it: drop-in types (training, event) sign up on the public sheet, team
   types keep the registration form. The rule was then written out twice — schedule.js:17 and
   admin-event.js:42 — and home.js, which never got it, linked `register.html?event_id=` while
   register.js reads `?event=`, so every "View" button on the member home landed on the
   missing-event refusal (D-29). Both halves live here now: the page AND the parameter, because
   splitting them is what let one caller get the parameter wrong on its own.
   Callers: assets/schedule.js · assets/admin-event.js · home.js. Add a caller, never a copy. */
window.BT_SIGNUP_LINK = function (type, eventId) {
  const page = (type === "training" || type === "event") ? "sheet.html?event=" : "register.html?event=";
  return page + encodeURIComponent(eventId);
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
