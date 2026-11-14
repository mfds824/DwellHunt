import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGatewayRequest, callGateway, describeGooglePage, isGatewayTransportError, safeResponse, viewingWorker } from "../src/gateway";
import { scoreLead } from "../src/leads";
import { authorizedTelegram, dispatch } from "../src/api";
import worker, { maintenanceTasksAt } from "../cloudflare/worker";

test("lead scoring preserves HOT, WARM and COLD thresholds and normalizes contact", () => {
  const hot = scoreLead({ name: " Buyer ", email: " BUYER@example.com ", budget: "100", location: "Colombo", property: "House", enquiry_type: "buy", message: "ready to buy" });
  assert.equal(hot.ai_lead_score, 100);
  assert.equal(hot.ai_lead_priority, "HOT");
  assert.equal(hot.email, "buyer@example.com");
  assert.equal(scoreLead({ phone: "123", budget: "100", location: "Colombo" }).ai_lead_priority, "WARM");
  assert.equal(scoreLead({ phone: "123" }).ai_lead_priority, "COLD");
  assert.throws(() => scoreLead({ message: "no contact" }));
});

test("gateway authentication is merged without letting a buyer choose the action", () => {
  process.env.APPS_SCRIPT_AUTH_BODY_JSON = '{"gatewaySecret":"dummy-only"}';
  const request = buildGatewayRequest("intake", { action: "followup", secret: "untrusted" });
  assert.deepEqual(JSON.parse(request.body), { gatewaySecret: "dummy-only", environment: "development", action: "intake", payload: { action: "followup", secret: "untrusted" } });
  process.env.APPS_SCRIPT_AUTH_BODY_JSON = '{"action":"followup"}';
  assert.throws(() => buildGatewayRequest("intake", {}));
  process.env.APPS_SCRIPT_AUTH_BODY_JSON = '{"gatewaySecret":"dummy-only"}';
});

test("booking responses retain validation status and omit private gateway fields", () => {
  assert.deepEqual(safeResponse({ ok: false, httpStatus: 409, code: "SLOT_TAKEN", secret: "private" }), { ok: false, httpStatus: 409, code: "SLOT_TAKEN" });
  for (const bad of [null, {}, { ok: true, httpStatus: 999 }]) assert.equal(safeResponse(bad).httpStatus, 503);
});

test("Apps Script HTML errors produce a safe gateway diagnostic instead of a JSON parser crash", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.APPS_SCRIPT_EXEC_URL;
  const originalAuth = process.env.APPS_SCRIPT_AUTH_BODY_JSON;
  globalThis.fetch = async () => new Response("<!DOCTYPE html><p>private upstream details</p>", {
    status: 200, headers: { "content-type": "text/html; charset=utf-8" },
  });
  process.env.APPS_SCRIPT_EXEC_URL = "https://script.google.com/macros/s/dummy/exec";
  process.env.APPS_SCRIPT_AUTH_BODY_JSON = '{"gatewaySecret":"dummy-only"}';
  try {
    await assert.rejects(
      callGateway("intake", {}),
      error => {
        assert.match(String(error), /non-JSON \(HTTP 200, text\/html; UNRECOGNIZED_PAGE\)/);
        assert.doesNotMatch(String(error), /private upstream details|DOCTYPE/);
        assert.equal(isGatewayTransportError(error), true);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.APPS_SCRIPT_EXEC_URL;
    else process.env.APPS_SCRIPT_EXEC_URL = originalUrl;
    if (originalAuth === undefined) delete process.env.APPS_SCRIPT_AUTH_BODY_JSON;
    else process.env.APPS_SCRIPT_AUTH_BODY_JSON = originalAuth;
  }
});

test("Google platform pages are classified by fixed codes with a sanitized title only", () => {
  assert.equal(describeGooglePage("<html><head><title>Error</title></head><body>Authorization is needed to perform this action.</body></html>"),
    'AUTHORIZATION_REQUIRED, page title "Error"');
  assert.equal(describeGooglePage("<title>Sign in - Google Accounts</title><form action='https://accounts.google.com/x'>"),
    'SIGN_IN_REQUIRED, page title "Sign in - Google Accounts"');
  assert.match(describeGooglePage("<title>Error</title>Service invoked too many times for one day: urlfetch."), /^QUOTA_EXCEEDED/);
  assert.match(describeGooglePage("<title>Error</title>Script function not found: doPost"), /^FUNCTION_NOT_FOUND/);
  assert.match(describeGooglePage("<title>Google Drive - Page Not Found</title>"), /^DEPLOYMENT_NOT_FOUND/);
  assert.match(describeGooglePage("<title>Error</title>We're sorry, a server error occurred. Please wait a bit and try again."), /^GOOGLE_SERVER_ERROR/);
  // Titles are reduced to plain text and capped; markup, symbols and body text never leak.
  const hostile = describeGooglePage(`<title><script>alert(1)</script>${"x".repeat(200)}</title><p>buyer@example.test secret-token</p>`);
  assert.doesNotMatch(hostile, /[<>@]|buyer|secret-token/);
  assert.ok(hostile.length < 120);
  assert.equal(describeGooglePage("<p>no title</p>"), "UNRECOGNIZED_PAGE");
});

test("only Google/transport failures are marked retryable; script-reported failures are not", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.APPS_SCRIPT_EXEC_URL;
  const originalAuth = process.env.APPS_SCRIPT_AUTH_BODY_JSON;
  const originalSchedules = process.env.DWELLHUNT_ENABLE_SCHEDULES;
  process.env.APPS_SCRIPT_EXEC_URL = "https://script.google.com/macros/s/dummy/exec";
  process.env.APPS_SCRIPT_AUTH_BODY_JSON = '{"gatewaySecret":"dummy-only"}';
  process.env.DWELLHUNT_ENABLE_SCHEDULES = "true";
  const retryable = async (respond: typeof fetch) => {
    globalThis.fetch = respond;
    try { await viewingWorker("reminders"); return "succeeded"; }
    catch (error) { return isGatewayTransportError(error) ? "retry" : "no-retry"; }
  };
  try {
    assert.equal(await retryable(async () => { throw new TypeError("fetch failed"); }), "retry");
    assert.equal(await retryable(async () => new Response("bad gateway", { status: 502 })), "retry");
    assert.equal(await retryable(async () => new Response("<title>Error</title>", { status: 200, headers: { "content-type": "text/html" } })), "retry");
    assert.equal(await retryable(async () => new Response("{oops", { status: 200, headers: { "content-type": "application/json" } })), "retry");
    // The script answered: delivery errors and explicit failures are reported, not retried.
    assert.equal(await retryable(async () => Response.json({ ok: true, httpStatus: 200, processed: 2, errors: 1 })), "no-retry");
    assert.equal(await retryable(async () => Response.json({ ok: false, httpStatus: 503, code: "SERVICE_UNAVAILABLE", diagnostic_code: "CALENDAR_ACCESS_FAILED" })), "no-retry");
    assert.equal(await retryable(async () => Response.json({ ok: true, httpStatus: 200, processed: 2, errors: 0 })), "succeeded");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [["APPS_SCRIPT_EXEC_URL", originalUrl], ["APPS_SCRIPT_AUTH_BODY_JSON", originalAuth], ["DWELLHUNT_ENABLE_SCHEDULES", originalSchedules]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("replacement website paths dispatch to the same business actions", async () => {
  let legacyLeadTask = "";
  const legacyLead = await dispatch("/webhook/dwellhunt-ai-leads-v2", { email: "buyer@example.test" }, async id => {
    legacyLeadTask = id;
    return { priority: "WARM" };
  });
  assert.equal(legacyLeadTask, "dwellhunt-new-lead");
  assert.equal(legacyLead.status, 200);

  for (const [path, expected] of [
    ["/api/dwellhunt/bookings", "dwellhunt-viewing-booking"],
    ["/api/dwellhunt/agent", "dwellhunt-viewing-agent-approval"],
    ["/api/dwellhunt/buyer-actions", "dwellhunt-viewing-buyer-actions"],
    ["/webhook/dwellhunt-virtual-viewing", "dwellhunt-viewing-booking"],
  ]) {
    let capturedKey = "";
    const execute = async (id: string, payload: unknown, key: string) => {
      assert.equal(id, expected); assert.deepEqual(payload, { booking_id: "dummy" }); capturedKey = key;
      return { ok: true, httpStatus: 200, booking_id: "dummy", private: "omit" };
    };
    const result = await dispatch(path, { booking_id: "dummy" }, execute);
    assert.equal(result.status, 200);
    assert.equal(capturedKey.length, 64);
    assert.equal("private" in result.body, false);
  }
});

test("invalid requests do not enqueue tasks", async () => {
  const execute = async () => { throw new Error("must not execute"); };
  assert.equal((await dispatch("/api/dwellhunt/bookings", [], execute)).status, 400);
  assert.equal((await dispatch("/api/dwellhunt/leads", {}, execute)).status, 400);
  assert.equal((await dispatch("/missing", {}, execute)).status, 404);
});

test("lead honeypot submissions are accepted quietly and never enqueued", async () => {
  const execute = async () => { throw new Error("must not execute"); };
  const result = await dispatch("/api/dwellhunt/leads", { email: "bot@example.test", website: "https://spam.example.test" }, execute);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  let received: Record<string, unknown> | undefined;
  const ok = await dispatch("/api/dwellhunt/leads", { email: "buyer@example.test", website: "" },
    async (_id, payload) => { received = payload; return { duplicate: false, priority: "COLD" }; });
  assert.equal(ok.status, 200);
  assert.equal(received && "website" in received, false);
});

test("Worker drops a filled lead honeypot after human verification without starting a task", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.includes("siteverify")) return Response.json({ success: true, hostname: "development.dwellhunt-viewing-dev.pages.dev", action: "lead" });
    throw new Error("must not reach Trigger.dev");
  };
  try {
    const response = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/leads", {
      method: "POST", headers: { Origin: "https://development.dwellhunt-viewing-dev.pages.dev", "Content-Type": "text/plain" },
      body: JSON.stringify({ turnstile_token: "dummy-token", email: "bot@example.test", website: "filled" }) }), {
      TRIGGER_SECRET_KEY: "dummy-trigger-secret", WEBSITE_ORIGIN: "https://development.dwellhunt-viewing-dev.pages.dev",
      TELEGRAM_WEBHOOK_SECRET: "dummy-telegram-secret", TURNSTILE_SECRET_KEY: "dummy-turnstile-secret",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.filter(u => !u.includes("siteverify")).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking forwards a fresh Turnstile token for Apps Script to verify exactly once", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded: Record<string, unknown> | undefined;
  let siteverifyCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("siteverify")) { siteverifyCalls++; throw new Error("booking must not consume the token in the Worker"); }
    if (url.includes("/tasks/dwellhunt-viewing-booking/trigger")) {
      const body = JSON.parse(String(init?.body));
      forwarded = body.payload;
      return Response.json({ id: "run_mock123" });
    }
    if (url.includes("/runs/run_mock123"))
      return Response.json({ status: "COMPLETED", output: { ok: true, httpStatus: 200, booking_id: "dhmock" } });
    throw new Error("Unexpected network request in mock test");
  };

  try {
    const response = await worker.fetch(new Request(
      "https://api.example.test/webhook/dwellhunt-virtual-viewing",
      { method: "POST", headers: { Origin: "https://development.dwellhunt-viewing-dev.pages.dev", "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ booking_id: "dummy-booking", turnstile_token: "dummy-token" }) },
    ), {
      TRIGGER_SECRET_KEY: "dummy-trigger-secret", WEBSITE_ORIGIN: "https://development.dwellhunt-viewing-dev.pages.dev",
      TELEGRAM_WEBHOOK_SECRET: "dummy-telegram-secret", TURNSTILE_SECRET_KEY: "dummy-turnstile-secret",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(forwarded, { booking_id: "dummy-booking", turnstile_token: "dummy-token" });
    assert.equal(siteverifyCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking rejects missing CAPTCHA tokens and ignores client verification flags", async () => {
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error("must not call upstream without a token"); };
  try {
    const response = await worker.fetch(new Request(
      "https://api.example.test/api/dwellhunt/bookings",
      { method: "POST", headers: { Origin: "https://development.dwellhunt-viewing-dev.pages.dev", "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: "dummy-booking", turnstile_verified: true }) },
    ), {
      TRIGGER_SECRET_KEY: "dummy-trigger-secret", WEBSITE_ORIGIN: "https://development.dwellhunt-viewing-dev.pages.dev",
      TELEGRAM_WEBHOOK_SECRET: "dummy-telegram-secret", TURNSTILE_SECRET_KEY: "dummy-turnstile-secret",
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, code: "HUMAN_VERIFICATION_REQUIRED" });
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Turnstile HTTP failures log only status and allowlisted error codes", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let warning: unknown;
  globalThis.fetch = async () => Response.json({ success: false, "error-codes": ["invalid-input-secret", "not safe to log"] }, { status: 400 });
  console.warn = (...args: unknown[]) => { warning = args; };
  try {
    const response = await worker.fetch(new Request(
      "https://api.example.test/api/dwellhunt/leads",
      { method: "POST", headers: { Origin: "https://development.dwellhunt-viewing-dev.pages.dev", "Content-Type": "text/plain" },
        body: JSON.stringify({ turnstile_token: "dummy-token" }) },
    ), {
      TRIGGER_SECRET_KEY: "dummy-trigger-secret", WEBSITE_ORIGIN: "https://development.dwellhunt-viewing-dev.pages.dev",
      TELEGRAM_WEBHOOK_SECRET: "dummy-telegram-secret", TURNSTILE_SECRET_KEY: "dummy-turnstile-secret",
    });
    assert.equal(response.status, 403);
    const log = JSON.stringify(warning);
    assert.match(log, /siteverify_http_error/);
    assert.match(log, /400/);
    assert.match(log, /invalid-input-secret/);
    assert.doesNotMatch(log, /not safe to log|dummy-token|dummy-turnstile-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("Telegram callbacks require the configured provider secret", () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "dummy-provider-secret";
  assert.equal(authorizedTelegram("dummy-provider-secret"), true);
  assert.equal(authorizedTelegram("wrong"), false);
  assert.equal(authorizedTelegram(undefined), false);
});

test("Development timer enqueues maintenance with bounded queue lifetime and minute idempotency", async () => {
  const originalFetch=globalThis.fetch;
  const calls: {url:string;body:any}[]=[];
  globalThis.fetch=async(input,init)=>{calls.push({url:String(input),body:JSON.parse(String(init?.body))});return Response.json({id:'run_mock'});};
  const env={TRIGGER_SECRET_KEY:'dummy',WEBSITE_ORIGIN:'https://development.dwellhunt-viewing-dev.pages.dev',
    AUTOMATION_ENABLED:'true',AUTOMATION_ENVIRONMENT:'development'};
  const pending:Promise<unknown>[]=[];
  try {
    worker.scheduled({scheduledTime:300_000},env,{waitUntil:p=>{pending.push(p);}});
    await Promise.all(pending);
    assert.equal(calls.length,2);
    assert.equal(calls[0].body.options.ttl,'2m');
    assert.equal(calls[0].body.options.idempotencyKey,'development-cron:dwellhunt-viewing-reminders-recovery:5');
    assert.equal(maintenanceTasksAt(360_000).length,1);
    calls.length=0;
    worker.scheduled({scheduledTime:300_000},{...env,AUTOMATION_ENVIRONMENT:'production'},{waitUntil:p=>{pending.push(p);}});
    worker.scheduled({scheduledTime:300_000},{...env,AUTOMATION_ENABLED:'false'},{waitUntil:p=>{pending.push(p);}});
    assert.equal(calls.length,0);
  } finally {globalThis.fetch=originalFetch;}
});

test("buyer management forwards fresh CAPTCHA to Apps Script without consuming it", async () => {
  const originalFetch=globalThis.fetch;
  let forwarded:Record<string,unknown>|undefined;
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    assert.ok(!url.includes('siteverify'));
    if(url.includes('/trigger')){forwarded=JSON.parse(String(init?.body)).payload;return Response.json({id:'run_mockmanage'});}
    return Response.json({status:'COMPLETED',output:{ok:true,httpStatus:202,status:'cancelling'}});
  };
  try {
    const r=await worker.fetch(new Request('https://example.test/api/dwellhunt/buyer-actions',{
      method:'POST',headers:{Origin:'https://development.dwellhunt-viewing-dev.pages.dev','Content-Type':'application/json'},
      body:JSON.stringify({turnstile_token:'fresh-dummy',manage_token:'dummy-private',operation:'cancel'})
    }),{TRIGGER_SECRET_KEY:'dummy',WEBSITE_ORIGIN:'https://development.dwellhunt-viewing-dev.pages.dev'});
    assert.equal(r.status,202);assert.equal(forwarded?.turnstile_token,'fresh-dummy');
  } finally {globalThis.fetch=originalFetch;}
});

test("an unconfigured Telegram webhook rejects requests before any task is triggered", async () => {
  const r=await worker.fetch(new Request('https://example.test/api/dwellhunt/agent',{
    method:'POST',headers:{'x-telegram-bot-api-secret-token':'untrusted','Content-Type':'application/json'},body:'{}'
  }),{TRIGGER_SECRET_KEY:'dummy',WEBSITE_ORIGIN:'https://development.dwellhunt-viewing-dev.pages.dev'});
  assert.equal(r.status,401);
});

test("scheduled workers make no external requests before cutover", async () => {
  process.env.DWELLHUNT_ENABLE_SCHEDULES = "false";
  assert.deepEqual(await viewingWorker("reminders"), { skipped: true, reason: "Schedules disabled" });
  assert.deepEqual(await viewingWorker("followup"), { skipped: true, reason: "Schedules disabled" });
});


test('GitHub test origin is permitted only for viewing routes in Development', async () => {
  const env={TRIGGER_SECRET_KEY:'dummy',WEBSITE_ORIGIN:'https://development.dwellhunt-viewing-dev.pages.dev',AUTOMATION_ENVIRONMENT:'development',VIEWING_TEST_ORIGIN:'https://mfds824.github.io'};
  const request=(path:string,origin='https://mfds824.github.io')=>new Request('https://api.example.test'+path,{method:'OPTIONS',headers:{Origin:origin}});
  for(const path of ['/api/dwellhunt/bookings','/api/dwellhunt/buyer-actions']) {
    const r=await worker.fetch(request(path),env);assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://mfds824.github.io');
  }
  for(const path of ['/api/dwellhunt/leads','/api/dwellhunt/agent'])assert.equal((await worker.fetch(request(path),env)).status,403);
  assert.equal((await worker.fetch(request('/api/dwellhunt/bookings','https://attacker.example'),env)).status,403);
  assert.equal((await worker.fetch(request('/api/dwellhunt/bookings'),{...env,AUTOMATION_ENVIRONMENT:'production'})).status,403);
});


test('Production gateway context is selected by server config and does not alter listing requests', () => {
  const old=process.env.DWELLHUNT_GATEWAY_ENVIRONMENT;process.env.APPS_SCRIPT_AUTH_BODY_JSON='{"gatewaySecret":"dummy-only"}';
  try {process.env.DWELLHUNT_GATEWAY_ENVIRONMENT='production';
    const body=JSON.parse(buildGatewayRequest('intake',{environment:'development'}).body);
    assert.equal(body.environment,'production');assert.equal(body.payload.environment,'development');
    assert.equal(JSON.parse(buildGatewayRequest('listing_tracking_health',{}).body).environment,undefined);
    process.env.DWELLHUNT_GATEWAY_ENVIRONMENT='development';assert.equal(JSON.parse(buildGatewayRequest('intake',{environment:'production'}).body).environment,'development');
  }finally{if(old===undefined)delete process.env.DWELLHUNT_GATEWAY_ENVIRONMENT;else process.env.DWELLHUNT_GATEWAY_ENVIRONMENT=old;}
});


test('Production bookings fail closed until the explicit launch gate is enabled',async()=>{
 const r=await worker.fetch(new Request('https://api.example.test/api/dwellhunt/bookings',{method:'POST',headers:{Origin:'https://mfds824.github.io','Content-Type':'application/json'},body:'{}'}),{TRIGGER_SECRET_KEY:'mock',WEBSITE_ORIGIN:'https://mfds824.github.io',AUTOMATION_ENVIRONMENT:'production',PUBLIC_BOOKINGS_ENABLED:'false'});
 assert.equal(r.status,503);assert.equal((await r.json() as any).code,'BOOKINGS_NOT_OPEN');
});

const directEnv = {
  TRIGGER_SECRET_KEY: "dummy-trigger-secret", WEBSITE_ORIGIN: "https://development.dwellhunt-viewing-dev.pages.dev",
  TELEGRAM_WEBHOOK_SECRET: "dummy-telegram-secret", TURNSTILE_SECRET_KEY: "dummy-turnstile-secret",
  AUTOMATION_ENABLED: "true", AUTOMATION_ENVIRONMENT: "development", VIEWING_BACKEND: "apps-script",
  APPS_SCRIPT_EXEC_URL: "https://script.google.com/macros/s/dummy/exec",
  APPS_SCRIPT_AUTH_BODY_JSON: JSON.stringify({ gateway_secret: "dummy-gateway-secret" }),
};

test("direct mode sends a booking straight to Apps Script with a fresh token and never calls Trigger.dev", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true, httpStatus: 202, booking_id: "dhabc", status: "pending_approval", private: "x" });
  };
  try {
    const response = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/bookings", {
      method: "POST", headers: { Origin: directEnv.WEBSITE_ORIGIN, "Content-Type": "text/plain" },
      body: JSON.stringify({ turnstile_token: "fresh-token", property_id: "prop-1", idempotency_key: "k".repeat(20) }) }), directEnv);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, httpStatus: 202, booking_id: "dhabc", status: "pending_approval" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, directEnv.APPS_SCRIPT_EXEC_URL);
    assert.equal(calls[0].body.action, "intake");
    assert.equal(calls[0].body.environment, "development");
    assert.equal(calls[0].body.gateway_secret, "dummy-gateway-secret");
    assert.equal(calls[0].body.payload.turnstile_token, "fresh-token");
    assert.ok(!calls.some(c => c.url.includes("trigger.dev") || c.url.includes("siteverify")));
  } finally { globalThis.fetch = originalFetch; }
});

test("direct mode hides gateway failures behind a generic 503 and logs only a fixed code", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs: unknown[] = [];
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    for (const [reply, code] of [
      [() => new Response("<html><title>Sign in</title>secret page</html>", { headers: { "content-type": "text/html" } }), "GATEWAY_NON_JSON"],
      [() => Response.json({ ok: false, code: "SERVICE_UNAVAILABLE", diagnostic_code: "CALENDAR_ACCESS_FAILED", detail: "private" }), "SCRIPT_CALENDAR_ACCESS_FAILED"],
    ] as const) {
      globalThis.fetch = async () => reply();
      const response = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/buyer-actions", {
        method: "POST", headers: { Origin: directEnv.WEBSITE_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ turnstile_token: "fresh-token", booking_id: "dhabc" }) }), directEnv);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, code: "SERVICE_UNAVAILABLE" });
      const log = JSON.stringify(logs.at(-1));
      assert.match(log, new RegExp(code));
      assert.doesNotMatch(log, /secret page|private|fresh-token|dummy-gateway-secret/);
    }
    globalThis.fetch = async () => Response.json({});
    const badConfig = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/bookings", {
      method: "POST", headers: { Origin: directEnv.WEBSITE_ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ turnstile_token: "t" }) }), { ...directEnv, APPS_SCRIPT_EXEC_URL: "https://evil.example.test/exec" });
    assert.equal(badConfig.status, 503);
    assert.match(JSON.stringify(logs.at(-1)), /CONFIG_EXEC_URL/);
  } finally { globalThis.fetch = originalFetch; console.error = originalError; }
});

test("direct mode keeps Telegram secret checks and forwards agent callbacks to Apps Script", async () => {
  const originalFetch = globalThis.fetch;
  const actions: string[] = [];
  globalThis.fetch = async (_input, init) => { actions.push(JSON.parse(String(init?.body)).action); return Response.json({ ok: true, httpStatus: 200, status: "approved" }); };
  try {
    const denied = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/agent", {
      method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "wrong" }, body: "{}" }), directEnv);
    assert.equal(denied.status, 401);
    const ok = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/agent", {
      method: "POST", headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "dummy-telegram-secret" },
      body: JSON.stringify({ callback_query: { id: "1" } }) }), directEnv);
    assert.equal(ok.status, 200);
    assert.deepEqual(actions, ["telegram"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("direct mode timer runs reminders every minute and follow-up every fifth minute without Trigger.dev", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = async (input, init) => { calls.push({ url: String(input), body: JSON.parse(String(init?.body)) }); return Response.json({ ok: true, processed: 1, errors: 0 }); };
  const pending: Promise<unknown>[] = [];
  try {
    worker.scheduled({ scheduledTime: 300_000 }, directEnv, { waitUntil: p => { pending.push(p); } });
    worker.scheduled({ scheduledTime: 360_000 }, directEnv, { waitUntil: p => { pending.push(p); } });
    await Promise.all(pending);
    assert.deepEqual(calls.map(c => c.body.action).sort(), ["followup", "reminders", "reminders"]);
    assert.ok(calls.every(c => c.url === directEnv.APPS_SCRIPT_EXEC_URL && c.body.environment === "development"));
    calls.length = 0;
    worker.scheduled({ scheduledTime: 300_000 }, { ...directEnv, AUTOMATION_ENABLED: "false" }, { waitUntil: p => { pending.push(p); } });
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("direct mode verifies the lead's Turnstile token, then saves the lead through Apps Script", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("siteverify")) { calls.push({ url, body: String(init?.body) }); return Response.json({ success: true, hostname: "development.dwellhunt-viewing-dev.pages.dev", action: "lead" }); }
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true, httpStatus: 200, status: "received", duplicate: false });
  };
  try {
    const response = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/leads", {
      method: "POST", headers: { Origin: directEnv.WEBSITE_ORIGIN, "Content-Type": "text/plain" },
      body: JSON.stringify({ turnstile_token: "lead-token", customer_name: "Buyer", email: "buyer@example.test", consent: true, website: "" }) }), directEnv);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, httpStatus: 200, status: "received", duplicate: false });
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /siteverify/);
    assert.equal(calls[1].url, directEnv.APPS_SCRIPT_EXEC_URL);
    assert.equal(calls[1].body.action, "lead");
    assert.equal("turnstile_token" in calls[1].body.payload, false);
    assert.equal("website" in calls[1].body.payload, false);
    assert.ok(!calls.some(c => c.url.includes("trigger.dev")));
    globalThis.fetch = async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] });
    const rejected = await worker.fetch(new Request("https://api.example.test/api/dwellhunt/leads", {
      method: "POST", headers: { Origin: directEnv.WEBSITE_ORIGIN, "Content-Type": "text/plain" },
      body: JSON.stringify({ turnstile_token: "bad", customer_name: "Buyer", email: "buyer@example.test", consent: true }) }), directEnv);
    assert.equal(rejected.status, 403);
  } finally { globalThis.fetch = originalFetch; }
});
