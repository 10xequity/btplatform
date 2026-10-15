/**
 * Boomtown Platform — the 2026-10-15 external review, F1: sandbox sign-in needs a key
 * File: worker/test/sandbox_login_key.test.mjs · Version: v1.0 · Date: 2026-10-15 · Ships in: v0.216.0
 *
 * THE HOLE (reproduced by the review): with no BREVO_API_KEY the worker runs sign-in in sandbox
 * mode and returns the magic link IN THE RESPONSE to whoever asked. That is the live
 * configuration while the email gate is owner-held, so anyone who knows an admin's email can
 * mint that admin's session with one POST.
 *
 * THE SHAPE (opt-in, so it can ship without locking the owner out): when the secret
 * SANDBOX_LOGIN_KEY is set and no email provider is configured, the sandbox link is returned only
 * to a request carrying the matching `sandbox_key`. A mismatch is refused BEFORE any magic_links
 * row is written, with one sentence that is byte-identical for a known and an unknown address
 * (the user-enumeration line auth_rate_limit.test.mjs already holds). With BREVO_API_KEY set the
 * key is irrelevant: the link is emailed, never returned. With neither secret set the behaviour
 * is unchanged (this harness and 52 other files depend on it), which is exactly why the owner's
 * one-step action is recorded in the gates runbook §1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";
const KEY = "correct-horse-battery-staple";

function makeEnv(extra = {}) {
  return { DB: createD1(SCHEMA), APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN,
    API_ORIGIN: "https://api.boomtown.test", ALLOWED_ORIGINS: ORIGIN, ...extra };
}

async function ask(env, body) {
  const res = await worker.fetch(new Request("https://api.boomtown.test/api/auth/request-link", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" },
    body: JSON.stringify(body),
  }), env);
  const raw = await res.text();
  return { status: res.status, data: JSON.parse(raw), raw };
}

const links = (env) => env.DB.one("SELECT COUNT(*) AS n FROM magic_links").n;

test("F1: with the key set and none sent, the sandbox link is refused and no row is written", async () => {
  const env = makeEnv({ SANDBOX_LOGIN_KEY: KEY });
  const r = await ask(env, { email: "owner@boomtown.test" });
  assert.equal(r.status, 403, r.raw);
  assert.equal(r.data.sandbox_locked, true);
  assert.equal(r.data.dev_link, undefined, "the link must not leak in the refusal");
  assert.equal(links(env), 0, "a refused request writes nothing");
});

test("F1: a wrong key is refused byte-identically for a known and an unknown address", async () => {
  const env = makeEnv({ SANDBOX_LOGIN_KEY: KEY });
  env.DB.exec("INSERT INTO users (id, email) VALUES (1, 'known@boomtown.test')");
  const known = await ask(env, { email: "known@boomtown.test", sandbox_key: "nope" });
  const unknown = await ask(env, { email: "nobody@boomtown.test", sandbox_key: "nope" });
  assert.equal(known.status, 403); assert.equal(unknown.status, 403);
  assert.equal(known.raw, unknown.raw, "the refusal must not be an enumeration oracle");
  assert.equal(links(env), 0);
});

test("F1: the right key returns the sandbox link and it verifies", async () => {
  const env = makeEnv({ SANDBOX_LOGIN_KEY: KEY });
  const r = await ask(env, { email: "owner@boomtown.test", sandbox_key: KEY });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.data.mode, "sandbox");
  assert.match(String(r.data.dev_link), /token=/);
  const token = String(r.data.dev_link).split("token=")[1];
  const v = await worker.fetch(new Request("https://api.boomtown.test/api/auth/verify", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ token }),
  }), env);
  assert.equal(v.status, 200);
});

test("F1: with an email provider configured the key is not consulted and the link is never returned", async () => {
  const env = makeEnv({ SANDBOX_LOGIN_KEY: KEY, BREVO_API_KEY: "brevo-test", SENDER_EMAIL: "no-reply@boomtown.test", SENDER_NAME: "Boomtown" });
  env.DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1)");
  const realFetch = globalThis.fetch;
  let brevoCalls = 0;
  globalThis.fetch = async (url) => { brevoCalls++; assert.match(String(url), /brevo/); return new Response("{}", { status: 201 }); };
  try {
    const r = await ask(env, { email: "owner@boomtown.test" });
    assert.equal(r.status, 200, r.raw);
    assert.equal(r.data.mode, "email");
    assert.equal(r.data.dev_link, undefined);
    assert.equal(brevoCalls, 1);
  } finally { globalThis.fetch = realFetch; }
});

test("F1 compatibility pin: with neither secret set the sandbox link is still returned (the harness contract)", async () => {
  const env = makeEnv();
  const r = await ask(env, { email: "owner@boomtown.test" });
  assert.equal(r.status, 200, r.raw);
  assert.match(String(r.data.dev_link), /token=/);
});

test("F1: the login page sends the stored key and prompts for it on a locked refusal", () => {
  const app = readFileSync(new URL("../../web/assets/app.js", import.meta.url), "utf8");
  assert.match(app, /sandbox_key: safeGet\("bt_sandbox_key"\)/, "the request must carry the stored key");
  assert.match(app, /r\.data\.sandbox_locked\) return sandboxKeyPrompt\(\)/, "a locked refusal must open the prompt");
  assert.match(app, /safeSet\("bt_sandbox_key"/, "the prompt must store the key once per device");
});
