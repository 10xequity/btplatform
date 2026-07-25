/* Boomtown Platform — frontend config
   Version: v0.3.0 · Date: 2026-07-24
   The ONLY file that changes when the backend URL changes.
   v0.3.0: RENTALS_ENABLED feature flag (owner decision D-M12B-2 — the member court-rental
   request form stays HIDDEN until the owner flips this to true). */
window.BT_CONFIG = {
  apiBase: "https://boomtown-api.vvisuth.workers.dev",
  RENTALS_ENABLED: false,
};
