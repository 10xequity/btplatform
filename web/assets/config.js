/* Boomtown Platform — frontend config
   Version: v0.4.0 · Date: 2026-08-12
   The ONLY file that changes when the backend URL changes.
   v0.3.0: RENTALS_ENABLED feature flag (owner decision D-M12B-2 — the member court-rental
   request form stays HIDDEN until the owner flips this to true).
   v0.4.0 (v0.137.0, §-1c D-29): BT_SIGNUP_LINK — the one place that decides where a sign-up
   link points. It sits here because config.js is the only script all three callers load. */
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
