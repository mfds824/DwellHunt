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
    assert.deepEqual(body.agent, { id: "AG-2611-0001", name: "Kamal", agency: "Lanka Homes", email: "k@example.test", phone: "+9477" });
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

const get = (path: string) => new Request("https://api.example.test/api/dwellhunt/agents/" + path, { method: "GET", headers: { Origin: env.WEBSITE_ORIGIN } });

test("public agent pages are GET-only, need a well-formed id and leak no contact details", async () => {
  const original = globalThis.fetch;
  try {
    let calls = stub({ ok: true, httpStatus: 200, agent: { id: "AG-2611-0001", name: "K", agency: "Lanka Homes", email: "k@x.test", phone: "+9477",
      bio: "Hi", areas: ["Colombo 05"], logo: "https://evil.example.test/x.jpg", verified: true,
      stories: [{ id: "PS-1", kind: "story", caption: "Just listed", photo: "https://res.cloudinary.com/d/a.jpg", secret: "x" }], posts: [], listings: [] } });
    const r = await worker.fetch(get("public/one?id=AG-2611-0001"), env);
    const body = await r.json() as any;
    assert.equal(r.status, 200); assert.equal(calls[0].body.action, "agent_public"); assert.equal(calls[0].body.payload.id, "AG-2611-0001");
    assert.equal("email" in body.agent, false); assert.equal("phone" in body.agent, false);
    assert.equal(body.agent.logo, "", "non-Cloudinary logo dropped");
    assert.equal("secret" in body.agent.stories[0], false);
    calls = stub({ ok: true, httpStatus: 200 });
    assert.equal((await worker.fetch(get("public/one?id=../../x"), env)).status, 404);
    assert.equal(calls.length, 0);
    assert.equal((await worker.fetch(post("public", {}), env)).status, 405);
    calls = stub({ ok: true, httpStatus: 200, agents: [{ id: "AG-2611-0001", agency: "A", email: "e@x.test", listingCount: 2, stories: [] }] });
    const list = await worker.fetch(get("public"), env);
    const lb = await list.json() as any;
    assert.equal(lb.agents.length, 1); assert.equal(lb.agents[0].listingCount, 2); assert.equal("email" in lb.agents[0], false);
    assert.equal(calls[0].body.action, "agents_public");
  } finally { globalThis.fetch = original; }
});

test("posting and profile edits need a session but no human check", async () => {
  const original = globalThis.fetch;
  try {
    let calls = stub({ ok: true, httpStatus: 200, status: "posted", reference: "PS-abc" });
    assert.equal((await worker.fetch(post("posts", { caption: "Hi" }), env)).status, 401);
    assert.equal(calls.length, 0);
    const ok = await worker.fetch(post("posts", { session: SESSION, kind: "story", caption: "Hi" }), env);
    assert.equal(ok.status, 200); assert.equal((await ok.json() as any).reference, "PS-abc");
    assert.ok(!calls.some(c => c.url.includes("siteverify")));
    assert.equal(calls[0].body.action, "agent_post");
    calls = stub({ ok: true, httpStatus: 200, status: "saved" });
    assert.equal((await worker.fetch(post("profile", { session: SESSION, bio: "x" }), env)).status, 200);
    assert.equal(calls[0].body.action, "agent_profile_save");
  } finally { globalThis.fetch = original; }
});
