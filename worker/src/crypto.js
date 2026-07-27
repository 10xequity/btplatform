/**
 * Boomtown Platform — shared crypto primitives
 * File: worker/src/crypto.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.32.0
 *
 * A LEAF MODULE. It imports nothing and it must stay that way.
 *
 * Why it exists: `sha256Hex` is currently defined FOUR times — consent.js:53, calendar.js:247,
 * uploads.js:150, waivers.js (documents.js imports that one). That is F-20. family.js needed a
 * fifth and importing consent.js would have created a real cycle, because consent.js already
 * imports validateBirthdate from family.js. That is the same trap R-23 documents for
 * waivers.js/documents.js, and the way out is a leaf both sides can import.
 *
 * v0.32.0 uses this from family.js only. Collapsing the other four into it is a separate pass —
 * folding a four-module refactor into a minors release is how uncalled and half-wired code
 * ships here.
 */

/** Lowercase hex SHA-256 of a string. Same output as the four copies it will replace. */
export async function sha256Hex(raw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(raw)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes as hex. The token is the credential; only its hash is ever stored. */
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
