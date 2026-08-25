/**
 * Boomtown Platform — §-1r RF-21: the load/speed baseline
 * File: worker/scripts/load-baseline.mjs · Version: v1.0 · Date: 2026-08-25 · Ships in: v0.197.0
 *
 * Owner 2026-08-24 (point 8): "Load and speed test all modules." This drives the REAL router
 * in-process against the sandbox seed (the same 90000-series fixture the admin's Generate
 * test data button makes), so it measures the code's own cost — SQL shape, payload assembly —
 * without network noise and without touching production. Two modes per route: N sequential
 * requests (p50/p95/max per call) and one burst of C concurrent requests (the whole burst's
 * wall time — the router is single-threaded in-process, so this measures queueing, not
 * parallelism). Non-2xx counts are failures and are printed loudly.
 *
 * A SCRIPT, not a test, deliberately: wall-clock assertions flake under CI load and a red that
 * cries wolf gets deleted. The durable artifact is the baseline table this prints, recorded in
 * roadmap §-1r RF-21 — rerun after a change, compare, and the drift is the finding.
 *
 * Usage:  node worker/scripts/load-baseline.mjs [--n=50] [--c=20] [--json]
 */
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? Number(hit.split("=")[1]) : d;
};
const N = arg("n", 50);
const C = arg("c", 20);
const JSON_OUT = process.argv.includes("--json");

function makeEnv() {
  const DB = createD1(SCHEMA);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  await res.text(); // the payload is part of the cost being measured
  return res.status;
}

async function signIn(env, email) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  const asked = await (await worker.fetch(new Request(`${ORIGIN}/api/auth/request-link`, {
    method: "POST", headers, body: JSON.stringify({ email }) }), env)).json();
  const v = await (await worker.fetch(new Request(`${ORIGIN}/api/auth/verify`, {
    method: "POST", headers, body: JSON.stringify({ token: String(asked.dev_link).split("token=")[1] }) }), env)).json();
  return v.token;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function measure(env, route) {
  const times = [];
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const status = await call(env, route.method, route.path, route);
    times.push(performance.now() - t0);
    if (status >= 400) bad++;
  }
  times.sort((a, b) => a - b);
  const t0 = performance.now();
  const burst = await Promise.all(Array.from({ length: C }, () => call(env, route.method, route.path, route)));
  const burstMs = performance.now() - t0;
  bad += burst.filter((s) => s >= 400).length;
  return {
    name: route.name, method: route.method, path: route.path,
    p50: +pct(times, 50).toFixed(1), p95: +pct(times, 95).toFixed(1), max: +times[times.length - 1].toFixed(1),
    burst_ms: +burstMs.toFixed(1), non2xx: bad,
  };
}

const env = makeEnv();
env.DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
env.DB.exec("INSERT INTO waiver_versions (id, org_id, label, body, body_sha, status) VALUES (1,1,'w1','I agree.','sha-1','active')");
env.DB.exec("INSERT INTO schedule_views (slug, name, kind, show_counts) VALUES ('public','Public','public',1)");
const staffTok = await signIn(env, "director@bt.test");
{
  const u = env.DB.one("SELECT id FROM users WHERE email='director@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
}
const seeded = await call(env, "POST", "/api/admin/testdata/generate", { token: staffTok });
if (seeded >= 400) { console.error("sandbox seed refused:", seeded); process.exit(1); }
const memberTok = await signIn(env, "player@bt.test");
env.DB.exec(`INSERT INTO contacts (id, org_id, email, full_name) VALUES (70,1,'player@bt.test','Pat Lee')`);
env.DB.exec(`INSERT INTO member_profiles (org_id, contact_id, visibility, date_of_birth) VALUES (1,70,'public',date('now','-30 years'))`);

const from = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
const to = new Date(Date.now() + 180 * 86400e3).toISOString().slice(0, 10);
const ROUTES = [
  { name: "health",             method: "GET", path: "/api/health" },
  { name: "public org-brand",   method: "GET", path: "/api/public/org-brand?org=1" },
  { name: "public schedule",    method: "GET", path: `/api/schedule?view=public&from=${from}&to=${to}` },
  { name: "public live board",  method: "GET", path: "/api/live/events/90004" },
  { name: "public kotc live",   method: "GET", path: "/api/live/kotc/90001" },
  { name: "me",                 method: "GET", path: "/api/me", token: memberTok },
  { name: "notifications",      method: "GET", path: "/api/notifications", token: memberTok },
  { name: "messages unread",    method: "GET", path: "/api/messages/unread-count", token: memberTok },
  { name: "profile upcoming",   method: "GET", path: "/api/profile/upcoming", token: memberTok },
  { name: "profile teams",      method: "GET", path: "/api/profile/teams", token: memberTok },
  { name: "lfg listings",       method: "GET", path: "/api/lfg/listings", token: memberTok },
  { name: "subs requests",      method: "GET", path: "/api/subs/requests", token: memberTok },
  { name: "faq list",           method: "GET", path: "/api/faq" },
  { name: "admin programs",     method: "GET", path: "/api/admin/programs", token: staffTok },
  { name: "admin registrations", method: "GET", path: "/api/events/90002/registrations", token: staffTok },
  { name: "admin league board", method: "GET", path: "/api/leagues/90003/board", token: staffTok },
  { name: "admin dashboard",    method: "GET", path: "/api/admin/dashboard", token: staffTok },
  { name: "admin sales report", method: "GET", path: "/api/admin/reports/sales", token: staffTok },
  { name: "admin users",        method: "GET", path: "/api/admin/users", token: staffTok },
];

const results = [];
for (const r of ROUTES) results.push(await measure(env, r));

if (JSON_OUT) {
  console.log(JSON.stringify({ n: N, c: C, results }, null, 2));
} else {
  console.log(`RF-21 in-process baseline — N=${N} sequential + one burst of C=${C} per route (ms)`);
  console.log("route".padEnd(24) + "p50".padStart(8) + "p95".padStart(8) + "max".padStart(8) + "burst".padStart(9) + "  non-2xx");
  for (const r of results) {
    console.log(r.name.padEnd(24) + String(r.p50).padStart(8) + String(r.p95).padStart(8) +
      String(r.max).padStart(8) + String(r.burst_ms).padStart(9) + (r.non2xx ? `  !! ${r.non2xx}` : "  0"));
  }
  const bad = results.filter((r) => r.non2xx);
  console.log(bad.length ? `\nFAILURES on: ${bad.map((r) => r.name).join(", ")} — a baseline with reds is not a baseline` : "\nall routes answered 2xx");
}
