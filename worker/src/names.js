/**
 * Boomtown Platform — how a person's name is written
 * File: worker/src/names.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.74.0
 *
 * ONE definition, because the alternative is two — and the day they disagree is the day a minor's
 * full name appears on a public scoreboard while every admin screen insists the rule is being
 * followed.
 *
 * THE RULE (standards §8, owner requirement, recorded in CLAUDE.md §4):
 *   "Names render 'First L.' unless the member chose public visibility."
 *
 * So the same captain is "Ava Stone" on a director's screen and "Ava S." on the wall display —
 * unless that person set their profile to public, in which case the wall gets the full name too,
 * because they asked for it.
 *
 * WHY THIS IS NOT PARANOIA. A captain in a junior league is frequently a minor. A public board needs
 * no login, so anything on it is published to anyone who loads the page and indexed by anything that
 * crawls it. "Ava S." identifies a team to the people at the event and nobody else, which is exactly
 * the amount of identification a scoreboard needs.
 *
 * This module imports nothing. Every other module may import it.
 */

/**
 * @param {string|null} fullName  as stored, e.g. "Ava Stone" or "TEST Ava Stone"
 * @param {object} opts
 *   - `full`       true on staff-only surfaces: return the name as stored.
 *   - `visibility` the member's own choice ('public' | 'members' | 'private'), when known.
 * @returns {string|null} null when there is no name — callers must handle a team with no captain,
 *          which is the normal state until somebody fills it in.
 */
export function personName(fullName, opts = {}) {
  const raw = String(fullName == null ? "" : fullName).trim();
  if (!raw) return null;
  if (opts.full) return raw;
  if (opts.visibility === "public") return raw;
  return abbreviate(raw);
}

/**
 * "Ava Stone" → "Ava S." · "Ava" → "Ava" · "Mary Jo Van Dyke" → "Mary J."
 *
 * The FIRST word is the given name and the SECOND supplies the initial. Taking the LAST word instead
 * looks equivalent and is not: "Mary Jo Van Dyke" becomes "Mary D.", which is a different person to
 * anyone who knows her, and single-word names would break entirely.
 *
 * A trailing initial is not doubled — "Ava S." stays "Ava S." rather than becoming "Ava S.." — because
 * some rosters are already stored abbreviated and running this twice must be harmless.
 */
export function abbreviate(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  const second = parts[1];
  // Already an initial, with or without the full stop.
  if (/^[A-Za-z]\.?$/.test(second)) return `${parts[0]} ${second.replace(/\.?$/, ".")}`;
  return `${parts[0]} ${second[0].toUpperCase()}.`;
}

/**
 * The SQL fragment for a team's captain. Written once here so a screen cannot quietly join a
 * different table and get a different answer.
 *
 * Expects `teams` aliased as `t`. Yields `captain_name` and `captain_visibility`.
 */
export const CAPTAIN_JOIN = `
  LEFT JOIN contacts cap ON cap.id = t.captain_contact_id AND cap.deleted_at IS NULL
  LEFT JOIN member_profiles cmp ON cmp.contact_id = cap.id AND cmp.org_id = t.org_id AND cmp.deleted_at IS NULL`;
export const CAPTAIN_COLS = `cap.full_name AS captain_name, cmp.visibility AS captain_visibility`;
