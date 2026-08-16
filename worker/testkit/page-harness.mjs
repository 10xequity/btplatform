/**
 * Boomtown Platform — page harness (testkit)
 * File: worker/testkit/page-harness.mjs · Version: v1.0 · Date: 2026-08-16 · Ships in: v0.164.0
 *
 * Runs a web/assets page script headlessly so a test can drive its real handlers and read the
 * HTML it actually produced — the runtime grain the static scans cannot reach (a `+`-concatenated
 * interpolation passes a template-literal regex and still ships an injection; only executing the
 * composer catches it). This is NOT a DOM: elements are recording stubs keyed by id, and
 * querySelectorAll returns nothing — so wiring done per-rendered-node (drag handlers, per-cell
 * focus) is invisible here and stays covered by the static pins in the test files. What IS real:
 * every fetch/api payload the test injects, every innerHTML the page writes, every classList and
 * disabled flip, in order.
 *
 * The page script is evaluated with `new Function(...globals)` in the host realm, so Node's own
 * Promise/URLSearchParams serve the script and one setImmediate flush settles any pure-microtask
 * boot chain (microtasks run to exhaustion before the next macrotask).
 */

function makeClassList() {
  const s = new Set();
  return {
    add: (...c) => c.forEach((x) => s.add(x)),
    remove: (...c) => c.forEach((x) => s.delete(x)),
    contains: (c) => s.has(c),
    toggle: (c) => (s.has(c) ? (s.delete(c), false) : (s.add(c), true)),
    has: (c) => s.has(c), // convenience alias for tests
  };
}

function makeEl(id) {
  const listeners = {};
  return {
    id, innerHTML: "", textContent: "", value: "", hidden: false, disabled: false,
    className: "", dataset: {}, style: {}, classList: makeClassList(),
    setAttribute() {}, getAttribute: () => null, removeAttribute() {}, focus() {},
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    querySelectorAll: () => [], querySelector: () => null,
    closest: () => null, appendChild() {},
    onclick: null, onchange: null,
    _listeners: listeners,
    /** Fire like a user: the onclick property AND any click listeners, returning onclick's value
     *  so async handlers can be awaited. */
    click() {
      const r = this.onclick ? this.onclick() : undefined;
      (listeners.click || []).forEach((fn) => fn());
      return r;
    },
  };
}

export function makeDocument() {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const listeners = {};
  const document = {
    getElementById: el,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    body: makeEl("body"),
    documentElement: makeEl("documentElement"),
    cookie: "",
    _fire: (t, ev = {}) => (listeners[t] || []).forEach((fn) => fn(ev)),
  };
  return { document, el };
}

function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

/** Flush the microtask-driven boot chain: microtasks drain before the macrotask fires. */
export const settle = () => new Promise((r) => setImmediate(r));

/**
 * Run web/assets/tournament.js against injected route payloads.
 * `routes(path, opts)` returns { ok?, status?, data } for each api() call the page makes.
 * Returns handles: el(id), document, printed() count, fireGlobal(type) for afterprint, emails[].
 */
export async function runTournament(js, routes) {
  const { document, el } = makeDocument();
  const emails = [];
  let printed = 0;
  const globalListeners = {};
  const window = {
    BT_CONFIG: { apiBase: "https://t.test" },
    BT_ADMIN: {
      csvRow: (a) => a.join(","),
      downloadText() {},
      emailDocument: (id, subject, body) => emails.push({ id, subject, body }),
    },
    matchMedia: () => ({ matches: false }),
  };
  const fetch = async (url, opts) => {
    const path = String(url).replace("https://t.test", "");
    const hit = routes(path, opts) || {};
    return { ok: hit.ok !== false, status: hit.status || (hit.ok === false ? 500 : 200),
      json: async () => hit.data || {} };
  };
  const addEventListener = (t, fn) => { (globalListeners[t] ||= new Set()).add(fn); };
  const localStorage = makeStorage();
  const run = new Function(
    "window", "document", "sessionStorage", "localStorage", "location",
    "fetch", "print", "addEventListener", "confirm", "alert",
    js);
  run(window, document, makeStorage({ bt_token: "tok" }), localStorage,
    { href: "https://t.test/tournament.html", search: "" },
    fetch, () => { printed++; }, addEventListener, () => true, () => {});
  await settle();
  return {
    el, document, window, emails, localStorage,
    printed: () => printed,
    fireGlobal: (t) => { const set = globalListeners[t] || new Set(); const fns = [...set]; set.clear(); fns.forEach((fn) => fn()); },
  };
}

/**
 * Run web/assets/admin-schedule-editor.js against a mocked BT_ADMIN.api.
 * `apiMock(path, opts)` returns { ok, status?, data }. DOMContentLoaded is fired for the caller.
 */
export async function runScheduleEditor(js, apiMock) {
  const { document, el } = makeDocument();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const BT_ADMIN = {
    api: async (path, opts) => apiMock(path, opts),
    esc,
    fail: (id, msg) => { el(id).innerHTML = String(msg); },
    loadFail: (id, r) => { el(id).innerHTML = "load failed"; },
    orgEmptyState: (id) => { el(id).innerHTML = "empty org"; },
  };
  const window = {
    BT_ADMIN,
    confirm: () => true,
    addEventListener() {},
  };
  const run = new Function("window", "document", "localStorage", "location", "BT_ADMIN", js);
  const localStorage = makeStorage();
  run(window, document, localStorage, { search: "" }, BT_ADMIN);
  document._fire("DOMContentLoaded");
  await settle();
  return { el, document, localStorage };
}
