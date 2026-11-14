type OptionalBinding = "TELEGRAM_WEBHOOK_SECRET" | "TURNSTILE_SECRET_KEY" |
  "AUTOMATION_ENABLED" | "AUTOMATION_ENVIRONMENT" | "VIEWING_TEST_ORIGIN" | "PUBLIC_BOOKINGS_ENABLED";
type Env = Omit<WorkerBindings, OptionalBinding> & Partial<Pick<WorkerBindings, OptionalBinding>>;

const ROUTES: Record<string, string> = {
  "/api/dwellhunt/leads": "dwellhunt-new-lead",
  "/api/dwellhunt/bookings": "dwellhunt-viewing-booking",
  "/api/dwellhunt/agent": "dwellhunt-viewing-agent-approval",
  "/api/dwellhunt/buyer-actions": "dwellhunt-viewing-buyer-actions",
  "/webhook/dwellhunt-ai-leads-v2": "dwellhunt-new-lead",
  "/webhook/dwellhunt-virtual-viewing": "dwellhunt-viewing-booking",
  "/webhook/dwellhunt-viewing-agent": "dwellhunt-viewing-agent-approval",
  "/webhook/dwellhunt-viewing-actions": "dwellhunt-viewing-buyer-actions",
};

const MAX_BODY_BYTES = 65_536;
const TASK_TIMEOUT_MS = 90_000;
const TERMINAL_FAILURES = new Set(["FAILED", "CRASHED", "CANCELED", "INTERRUPTED", "SYSTEM_FAILURE"]);

function json(body: unknown, status: number, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function safeResponse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ok: false, httpStatus: 503, code: "SERVICE_UNAVAILABLE" };
  const result = value as Record<string, unknown>;
  if (typeof result.ok !== "boolean" || !Number.isInteger(result.httpStatus) ||
      Number(result.httpStatus) < 200 || Number(result.httpStatus) > 599)
    return { ok: false, httpStatus: 503, code: "SERVICE_UNAVAILABLE" };
  const safe: Record<string, unknown> = { ok: result.ok, httpStatus: Number(result.httpStatus) };
  for (const key of ["code", "fields", "booking_id", "status", "duplicate", "message", "ignored"])
    if (result[key] !== undefined) safe[key] = result[key];
  return safe;
}

function sameSecret(value: string | null, expected: string | undefined) {
  if (!value || !expected || value.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < value.length; i++) mismatch |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

async function idempotencyKey(taskId: string, payload: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(`${taskId}:${JSON.stringify(payload)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

type TurnstileCheck =
  | { ok: true }
  | { ok: false; reason: string; errorCodes?: string[]; hostname?: string; action?: string; httpStatus?: number };

async function verifyTurnstile(
  token: unknown,
  secret: string | undefined,
  expectedHostname: string,
  expectedAction?: string,
): Promise<TurnstileCheck> {
  if (typeof token !== "string" || !token) return { ok: false, reason: "missing_token" };
  if (!secret) return { ok: false, reason: "missing_secret" };
  const body = new URLSearchParams({ secret, response: token });
  let response: Response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return { ok: false, reason: "siteverify_network_error" };
  }
  if (!response.ok) {
    let errorCodes: string[] = [];
    try {
      const rejected: unknown = await response.json();
      if (rejected && typeof rejected === "object" && !Array.isArray(rejected)) {
        const codes = (rejected as { "error-codes"?: unknown })["error-codes"];
        if (Array.isArray(codes))
          errorCodes = codes.filter((code): code is string => typeof code === "string" && /^[a-z0-9-]{1,64}$/.test(code)).slice(0, 8);
      }
    } catch { /* Keep only the HTTP status when Siteverify returns a non-JSON error. */ }
    return { ok: false, reason: "siteverify_http_error", httpStatus: response.status, errorCodes };
  }

  let result: unknown;
  try { result = await response.json(); } catch {
    return { ok: false, reason: "siteverify_invalid_response" };
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    return { ok: false, reason: "siteverify_invalid_response" };

  const checked = result as { success?: unknown; hostname?: unknown; action?: unknown; "error-codes"?: unknown };
  const errorCodes = Array.isArray(checked["error-codes"])
    ? checked["error-codes"].filter((code): code is string => typeof code === "string" && /^[a-z0-9-]{1,64}$/.test(code)).slice(0, 8)
    : [];
  const hostname = typeof checked.hostname === "string" ? checked.hostname.slice(0, 253) : undefined;
  const action = typeof checked.action === "string" ? checked.action.slice(0, 32) : undefined;
  if (checked.success !== true)
    return { ok: false, reason: "siteverify_rejected", errorCodes };
  if (hostname !== expectedHostname)
    return { ok: false, reason: "hostname_mismatch", hostname, action };
  if (expectedAction && action !== expectedAction)
    return { ok: false, reason: "action_mismatch", hostname, action };
  return { ok: true };
}

async function triggerAndWait(taskId: string, payload: Record<string, unknown>, key: string, secret: string) {
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  const started = await fetch(`https://api.trigger.dev/api/v1/tasks/${encodeURIComponent(taskId)}/trigger`, {
    method: "POST",
    headers,
    body: JSON.stringify({ payload, options: { idempotencyKey: key, ttl: "24h" } }),
  });
  if (!started.ok) throw new Error("Trigger.dev rejected the task request");
  const startBody: unknown = await started.json();
  const runId = startBody && typeof startBody === "object" ? (startBody as { id?: unknown }).id : undefined;
  if (typeof runId !== "string" || !/^run_[a-zA-Z0-9]+$/.test(runId)) throw new Error("Invalid task run response");

  const deadline = Date.now() + TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`https://api.trigger.dev/api/v3/runs/${encodeURIComponent(runId)}`, { headers });
    if (!response.ok) throw new Error("Could not read the task run status");
    const run: unknown = await response.json();
    if (!run || typeof run !== "object") throw new Error("Invalid task run status");
    const result = run as { status?: unknown; output?: unknown };
    if (result.status === "COMPLETED") return result.output;
    if (typeof result.status === "string" && TERMINAL_FAILURES.has(result.status))
      throw new Error("Trigger.dev task failed");
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw new Error("Task response deadline exceeded");
}

export function maintenanceTasksAt(scheduledTime: number): string[] {
  const tasks = ["dwellhunt-viewing-reminders-recovery"];
  if (Math.floor(scheduledTime / 60_000) % 5 === 0)
    tasks.push("dwellhunt-viewing-completion-followup");
  return tasks;
}

async function enqueueMaintenance(scheduledTime: number, env: Env) {
  for (const taskId of maintenanceTasksAt(scheduledTime)) {
    const response = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TRIGGER_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payload: {}, options: {
        idempotencyKey: `${env.AUTOMATION_ENVIRONMENT}-cron:${taskId}:${Math.floor(scheduledTime / 60_000)}`,
        ttl: "2m",
      } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Viewing automation enqueue failed (${response.status})`);
  }
}

export default {
  scheduled(event: { scheduledTime: number }, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    const validTarget = (env.AUTOMATION_ENVIRONMENT === "development" && env.WEBSITE_ORIGIN === "https://development.dwellhunt-viewing-dev.pages.dev") ||
      (env.AUTOMATION_ENVIRONMENT === "production" && env.WEBSITE_ORIGIN === "https://mfds824.github.io");
    if (env.AUTOMATION_ENABLED !== "true" || !validTarget) return;
    ctx.waitUntil(enqueueMaintenance(event.scheduledTime, env));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const path = new URL(request.url).pathname;
    const taskId = ROUTES[path];
    const githubTest = env.AUTOMATION_ENVIRONMENT === "development" &&
      env.VIEWING_TEST_ORIGIN === "https://mfds824.github.io" && origin === env.VIEWING_TEST_ORIGIN &&
      ["dwellhunt-viewing-booking", "dwellhunt-viewing-buyer-actions"].includes(taskId);
    const cors: HeadersInit = { Vary: "Origin" };
    if (origin && origin !== env.WEBSITE_ORIGIN && !githubTest) return json({ ok: false, code: "ORIGIN_DENIED" }, 403);
    if (origin && (origin === env.WEBSITE_ORIGIN || githubTest)) {
      Object.assign(cors, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
    }

    if (!taskId) return json({ ok: false, code: "NOT_FOUND" }, 404, cors);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, cors);
    if(env.AUTOMATION_ENVIRONMENT === "production" && env.PUBLIC_BOOKINGS_ENABLED !== "true" &&
      ["dwellhunt-viewing-booking","dwellhunt-viewing-buyer-actions"].includes(taskId))
      return json({ok:false,code:"BOOKINGS_NOT_OPEN"},503,cors);
    if (taskId === "dwellhunt-viewing-agent-approval" &&
        !sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), env.TELEGRAM_WEBHOOK_SECRET))
      return json({ ok: false, code: "UNAUTHORIZED" }, 401, cors);
    const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
    // The staging booking UI sends text/plain JSON to avoid an unnecessary CORS preflight.
    if (!contentType.startsWith("application/json") && !contentType.startsWith("text/plain"))
      return json({ ok: false, code: "JSON_REQUIRED" }, 415, cors);

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
      return json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, 413, cors);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({ ok: false, code: "INVALID_JSON" }, 400, cors); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return json({ ok: false, code: "INVALID_PAYLOAD" }, 400, cors);

    const data = payload as Record<string, unknown>;
    if (taskId !== "dwellhunt-viewing-agent-approval") {
      const turnstileToken = data.turnstile_token ?? data.turnstileToken ?? data["cf-turnstile-response"];
      if (taskId === "dwellhunt-viewing-booking" || taskId === "dwellhunt-viewing-buyer-actions") {
        // Apps Script is the sole Siteverify verifier for bookings and management actions. Forward the fresh token
        // through the authenticated Trigger.dev -> Apps Script gateway without consuming it here.
        if (typeof turnstileToken !== "string" || !turnstileToken || turnstileToken.length > 2048)
          return json({ ok: false, code: "HUMAN_VERIFICATION_REQUIRED" }, 403, cors);
        delete data.turnstileToken;
        delete data["cf-turnstile-response"];
        data.turnstile_token = turnstileToken;
      } else {
      let expectedHostname: string;
      try { expectedHostname = new URL(env.WEBSITE_ORIGIN).hostname; } catch {
        console.error("Turnstile configuration invalid", { reason: "invalid_website_origin" });
        return json({ ok: false, code: "SERVICE_UNAVAILABLE" }, 503, cors);
      }
      const expectedAction = taskId === "dwellhunt-new-lead" ? "lead" : undefined;
      const check = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, expectedHostname, expectedAction);
      if (!check.ok) {
        console.warn("Turnstile verification rejected", {
          reason: check.reason,
          httpStatus: check.httpStatus,
          errorCodes: check.errorCodes,
          hostname: check.hostname,
          action: check.action,
        });
        return json({ ok: false, code: "HUMAN_VERIFICATION_REQUIRED" }, 403, cors);
      }
      delete data.turnstileToken;
      delete data.turnstile_token;
      delete data["cf-turnstile-response"];
      }
    }
    if (taskId === "dwellhunt-new-lead" &&
        !(typeof data.email === "string" && data.email.trim()) &&
        !(typeof data.phone === "string" && data.phone.trim()))
      return json({ ok: false, code: "CONTACT_REQUIRED" }, 400, cors);

    try {
      const output = await triggerAndWait(taskId, data, await idempotencyKey(taskId, data), env.TRIGGER_SECRET_KEY);
      if (taskId === "dwellhunt-new-lead") {
        const result = output && typeof output === "object" ? output as Record<string, unknown> : {};
        return json({ ok: true, duplicate: result.duplicate, priority: result.priority }, 200, cors);
      }
      const safe = safeResponse(output);
      return json(safe, Number(safe.httpStatus), cors);
    } catch {
      // Do not reveal secret values, request contents, or upstream internals to callers.
      return json({ ok: false, code: "SERVICE_UNAVAILABLE" }, 503, cors);
    }
  },
};
