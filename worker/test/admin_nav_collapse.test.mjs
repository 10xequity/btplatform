/**
 * Boomtown Platform — the admin rail groups default COLLAPSED except the active one (owner 2026-08-26)
 * File: worker/test/admin_nav_collapse.test.mjs · Version: v1.0 · Date: 2026-08-26 · Ships in: v0.206.0
 *
 * Owner ("choose A", 2026-08-26): the admin menu has 33 items across 6 collapsible groups, which
 * reads long when every group is open at once. Option A — default every group CLOSED except the
 * one holding the current page, so the rail shows ~6 headers you expand ("get to ~10, subcategories
 * ok"). Two invariants this pins:
 *   1. The DEFAULT (no stored state) is closed for a group that is NOT the active one, open for the
 *      active one. Before this, groups defaulted OPEN (only an explicit "closed" collapsed them).
 *   2. An explicit user toggle still WINS — `bt_navgrp_<key>` = "open" | "closed" overrides the
 *      default either way, so a member who opens Money keeps it open.
 * The behaviour is runtime (DOM + cookie + the active item), which the page-harness cannot drive
 * (querySelectorAll is a stub), so this pins the SOURCE shape with negative controls; the browser
 * check is the live verification at release.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const SRC = blankComments(readFileSync(new URL("../../web/assets/admin-nav.js", import.meta.url), "utf8"));

test("the collapse default closes non-active groups, and honours an explicit stored state", () => {
  // The default branch (no stored value) must close a group that is not the active one — the
  // presence of a `!== activeKey` (or equivalent) default distinguishes Option A from the old
  // always-open default.
  assert.match(SRC, /bt_navgrp_/, "the rail no longer reads the per-group collapse cookie");
  assert.match(SRC, /!==\s*activeKey|activeKey\s*!==|dataset\.key\s*!==\s*activeKey/,
    "no active-group default — groups would still all default open (Option A not applied)");
  // The stored value must be consulted so an explicit toggle wins over the default.
  assert.match(SRC, /stored\s*\?\s*\(?\s*stored\s*===\s*"closed"/,
    "the explicit stored state no longer wins over the default — a user's open/closed choice is lost");
});

test("the active group is derived from the marked-active item (runtime semantics)", () => {
  // Option A must key off the SAME active item markActive() sets, or the open group and the
  // highlighted item could disagree. Pin that the collapse reads the active nav-item's group.
  assert.match(SRC, /nav-item\.active|\.active"\)/, "the collapse default never consults the active nav-item");
  assert.match(SRC, /closest\("\.nav-group"\)/, "the active group is not resolved from the active item's group");
});

test("NC: reverting to the always-open default is caught", () => {
  // The old default was `safeGet(...) === "closed"` with no active-group clause. Simulate it and
  // confirm the Option-A marker disappears — otherwise this guard proves nothing.
  const reverted = SRC.replace(/const closed = stored[^;]*;/, 'const closed = false;');
  assert.notEqual(reverted, SRC, "the mutation did not land — the collapse expression shape changed; update this NC");
  assert.doesNotMatch(reverted, /stored\s*\?\s*\(?\s*stored\s*===\s*"closed"[^;]*activeKey/,
    "the reverted source still carries the active-group default — the detector cannot fail");
});
