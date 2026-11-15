import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker";

const env: any = {
  TRIGGER_SECRET_KEY: "dummy-trigger-secret", WEBSITE_ORIGIN: "https://development.dwellhunt-viewing-dev.pages.dev",
  TELEGRAM_WEBHOOK_SECRET: "dummy-telegram-secret", TURNSTILE_SECRET_KEY: "dummy-turnstile-secret",
  AUTOMATION_ENABLED: "true", AUTOMATION_ENVIRONMENT: "development", VIEWING_BACKEND: "apps-script",
  APPS_SCRIPT_EXEC_URL: "https://script.google.com/macros/s/dummy/exec",
  APPS_SCRIPT_AUTH_BODY_JSON: JSON.stringify({ gateway_secret: "dummy-gateway-secret" }),
};
const post = (body: unknown, origin = env.WEBSITE_ORIGIN) => new Request("https://api.example.test/api/dwellhunt/owner-listings", {
  method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: JSON.stringify(body) });

async function withFetch(handler: (url: string, init: any) => Response | Promise<Response>, run: (calls: { url: string; body: any }[]) => Promise<void>) {
  const original = globalThis.fetch, calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    calls.push({ url, body: url.includes("siteverify") ? String(init?.body) : init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(url, init);
  }) as typeof fetch;
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test("an owner listing needs a Turnstile pass for the owner_listing action, then goes to Apps Script without the token", async () => {
  await withFetch(url => url.includes("siteverify")
    ? Response.json({ success: true, hostname: "development.dwellhunt-viewing-dev.pages.dev", action: "owner_listing" })
    : Response.json({ ok: true, httpStatus: 200, status: "received", duplicate: false, reference: "OL-2611-0001", secret: "x" }), async calls => {
    const r = await worker.fetch(post({ turnstile_token: "tok", website: "", owner: { name: "N" } }), env);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, httpStatus: 200, status: "received", duplicate: false, reference: "OL-2611-0001" });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.action, "owner_listing");
    assert.equal("turnstile_token" in calls[1].body.payload, false);
    assert.equal("website" in calls[1].body.payload, false);
  });
  await withFetch(url => url.includes("siteverify")
    ? Response.json({ success: true, hostname: "development.dwellhunt-viewing-dev.pages.dev", action: "lead" })
    : Response.json({ ok: true, httpStatus: 200 }), async calls => {
    const r = await worker.fetch(post({ turnstile_token: "lead-token" }), env);
    assert.equal(r.status, 403, "a token minted for another form is refused");
    assert.equal(calls.length, 1);
  });
});

test("a filled honeypot or a foreign origin never reaches Apps Script", async () => {
  await withFetch(url => url.includes("siteverify")
    ? Response.json({ success: true, hostname: "development.dwellhunt-viewing-dev.pages.dev", action: "owner_listing" })
    : Response.json({ ok: true, httpStatus: 200 }), async calls => {
    const bot = await worker.fetch(post({ turnstile_token: "tok", website: "spam.example" }), env);
    assert.equal(bot.status, 200);
    assert.ok(!calls.some(c => c.url.includes("script.google.com")));
    assert.equal((await worker.fetch(post({ turnstile_token: "tok" }, "https://attacker.example"), env)).status, 403);
  });
});

test("owner listings fail closed when the Apps Script backend is not selected", async () => {
  await withFetch(url => url.includes("siteverify")
    ? Response.json({ success: true, hostname: "development.dwellhunt-viewing-dev.pages.dev", action: "owner_listing" })
    : Response.json({ ok: true }), async calls => {
    const r = await worker.fetch(post({ turnstile_token: "tok" }), { ...env, VIEWING_BACKEND: undefined });
    assert.equal(r.status, 503);
    assert.ok(!calls.some(c => c.url.includes("trigger.dev") || c.url.includes("script.google.com")));
  });
});

test("the public feed is GET-only, returns only listings, and is briefly cached", async () => {
  await withFetch(() => Response.json({ ok: true, httpStatus: 200, listings: [{ reference: "OL-2611-0001", title: "Flat" }], private: "x" }), async calls => {
    const r = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/owner-listings/public", { headers: { Origin: env.WEBSITE_ORIGIN } }), env);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, listings: [{ reference: "OL-2611-0001", title: "Flat" }] });
    assert.equal(r.headers.get("Cache-Control"), "public, max-age=120");
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), env.WEBSITE_ORIGIN);
    assert.equal(calls[0].body.action, "owner_listings_public");
    const preflight = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/owner-listings/public", { method: "OPTIONS", headers: { Origin: env.WEBSITE_ORIGIN } }), env);
    assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
    const wrong = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/owner-listings/public", { method: "POST", body: "{}" }), env);
    assert.equal(wrong.status, 405);
  });
  await withFetch(() => new Response("<html>", { status: 500 }), async () => {
    const r = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/owner-listings/public"), env);
    assert.equal(r.status, 503);
  });
});
