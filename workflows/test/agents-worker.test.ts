import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker";

const env = {
  TRIGGER_SECRET_KEY: "dummy-trigger-secret", WEBSITE_ORIGIN: "https://development.dwellhunt-viewing-dev.pages.dev",
  TELEGRAM_WEBHOOK_SECRET: "dummy-telegram-secret", TURNSTILE_SECRET_KEY: "dummy-turnstile-secret",
  AUTOMATION_ENABLED: "true", AUTOMATION_ENVIRONMENT: "development", VIEWING_BACKEND: "apps-script",
  APPS_SCRIPT_EXEC_URL: "https://script.google.com/macros/s/dummy/exec",
  APPS_SCRIPT_AUTH_BODY_JSON: JSON.stringify({ gateway_secret: "dummy-gateway-secret" }),
};
const SESSION = "a".repeat(64);
const post = (path: string, body: unknown) => new Request("https://api.example.test/api/dwellhunt/agents/" + path, {
  method: "POST", headers: { Origin: env.WEBSITE_ORIGIN, "Content-Type": "text/plain" }, body: JSON.stringify(body) });

function stub(reply: Record<string, unknown>, turnstileAction = "") {
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("siteverify")) { calls.push({ url, body: String(init?.body) });
      return Response.json({ success: true, hostname: "development.dwellhunt-viewing-dev.pages.dev", action: turnstileAction }); }
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return Response.json(reply);
  };
  return calls;
}

test("agent sign-up needs a human check for action agent_signup and drops honeypot bots", async () => {
  const original = globalThis.fetch;
  try {
    let calls = stub({ ok: true, httpStatus: 200, status: "pending" }, "agent_signup");
    const ok = await worker.fetch(post("signup", { turnstile_token: "t", name: "Kamal", email: "k@example.test" }), env);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, httpStatus: 200, status: "pending" });
    assert.equal(calls[1].body.action, "agent_signup");
    assert.equal("turnstile_token" in calls[1].body.payload, false);
    calls = stub({ ok: true, httpStatus: 200 }, "lead");
    assert.equal((await worker.fetch(post("signup", { turnstile_token: "t" }), env)).status, 403, "token for another action is refused");
    calls = stub({ ok: true, httpStatus: 200 }, "agent_signup");
    const bot = await worker.fetch(post("signup", { turnstile_token: "t", website: "spam" }), env);
    assert.deepEqual(await bot.json(), { ok: true });
    assert.equal(calls.filter(c => !c.url.includes("siteverify")).length, 0);
  } finally { globalThis.fetch = original; }
});

test("asking for a code needs the agent_signin human check; checking it does not", async () => {
  const original = globalThis.fetch;
  try {
    let calls = stub({ ok: true, httpStatus: 200, status: "sent" }, "agent_signin");
    assert.equal((await worker.fetch(post("code", { turnstile_token: "t", email: "k@example.test" }), env)).status, 200);
    assert.equal(calls[1].body.action, "agent_code");
    calls = stub({ ok: true, httpStatus: 200, status: "signed_in", session: SESSION, expires: "2026-12-16T00:00:00.000Z",
      agent: { id: "AG-2611-0001", name: "Kamal", agency: "Lanka Homes", email: "k@example.test", phone: "+9477", private: "x" }, secret: "x" });
    const r = await worker.fetch(post("verify", { email: "k@example.test", code: "123456" }), env);
    const body = await r.json() as any;
    assert.equal(r.status, 200);
    assert.ok(!calls.some(c => c.url.includes("siteverify")));
    assert.equal(body.session, SESSION);
    assert.deepEqual(body.agent, { id: "AG-2611-0001", name: "Kamal", agency: "Lanka Homes", email: "k@example.test" });
    assert.equal("secret" in body, false);
  } finally { globalThis.fetch = original; }
});

test("dashboard and sign-out need a well-formed session before reaching Apps Script", async () => {
  const original = globalThis.fetch;
  try {
    let calls = stub({ ok: true, httpStatus: 200 });
    const bad = await worker.fetch(post("me", { session: "not-a-token" }), env);
    assert.equal(bad.status, 401); assert.deepEqual(await bad.json(), { ok: false, code: "SIGNED_OUT" });
    assert.equal(calls.length, 0);
    calls = stub({ ok: true, httpStatus: 200, status: "signed_in", agent: { id: "AG-1", name: "K", agency: "A", email: "e" },
      listings: [{ reference: "OL-2611-0001", title: "Villa", status: "published", ownerPhone: "+94771234567" }] });
    const me = await worker.fetch(post("me", { session: SESSION }), env);
    const body = await me.json() as any;
    assert.equal(calls[0].body.action, "agent_me");
    assert.equal(body.listings[0].reference, "OL-2611-0001");
    assert.equal("ownerPhone" in body.listings[0], false);
    calls = stub({ ok: false, httpStatus: 401, code: "SIGNED_OUT" });
    assert.equal((await worker.fetch(post("signout", { session: SESSION }), env)).status, 401);
  } finally { globalThis.fetch = original; }
});

test("an agent listing needs both a session and the owner_listing human check", async () => {
  const original = globalThis.fetch;
  try {
    let calls = stub({ ok: true, httpStatus: 200, status: "received", reference: "OL-2611-0002" }, "owner_listing");
    assert.equal((await worker.fetch(post("listings", { turnstile_token: "t" }), env)).status, 401);
    assert.equal(calls.length, 0);
    const ok = await worker.fetch(post("listings", { session: SESSION, turnstile_token: "t", website: "" }), env);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json() as any).reference, "OL-2611-0002");
    assert.equal(calls[1].body.action, "agent_listing");
    assert.equal(calls[1].body.payload.session, SESSION);
    calls = stub({ ok: true, httpStatus: 200 }, "agent_signup");
    assert.equal((await worker.fetch(post("listings", { session: SESSION, turnstile_token: "t" }), env)).status, 403);
  } finally { globalThis.fetch = original; }
});
