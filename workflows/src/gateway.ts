export type GatewayAction = "intake" | "telegram" | "customer_action" | "reminders" | "followup" | "lead" | "lead_digest" | "meet_readiness" |
 "viewing_health" | "listing_tracking_health" | "listing_sheet_sync" | "listing_reminder" | "listing_reminder_lookup";
export type Payload = Record<string, unknown>;
export type SafeResponse = { ok: boolean; httpStatus: number; [key: string]: unknown };

export function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("REQUIRED_CONFIG_")) throw new Error(`Missing configuration: ${name}`);
  return value;
}

function jsonObject(value: string): Payload {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Authentication must be a JSON object");
  return parsed as Payload;
}

export function buildGatewayRequest(action: GatewayAction, payload: Payload) {
  const auth = jsonObject(required("APPS_SCRIPT_AUTH_BODY_JSON"));
  const headers = jsonObject(process.env.APPS_SCRIPT_AUTH_HEADERS_JSON || "{}");
  if (Object.keys(headers).some(k => ["content-type", "host", "content-length"].includes(k.toLowerCase())) ||
      Object.values(headers).some(v => typeof v !== "string")) throw new Error("Invalid authentication headers");
  if ("action" in auth || "payload" in auth) throw new Error("Authentication cannot override gateway action or payload");
  return {
    method: "POST",
    headers: { ...headers as Record<string, string>, "Content-Type": "application/json" },
    body: JSON.stringify({ ...auth, action, payload,
      ...(["intake","telegram","customer_action","reminders","followup","viewing_health","lead","lead_digest","meet_readiness"].includes(action)
        ? {environment: process.env.DWELLHUNT_GATEWAY_ENVIRONMENT === "production" ? "production" : "development"} : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  };
}

export function safeResponse(result: unknown): SafeResponse {
  if (!result || typeof result !== "object") return { ok: false, httpStatus: 503, code: "SERVICE_UNAVAILABLE" };
  const r = result as Payload;
  if (typeof r.ok !== "boolean" || !Number.isInteger(r.httpStatus) || Number(r.httpStatus) < 200 || Number(r.httpStatus) > 599)
    return { ok: false, httpStatus: 503, code: "SERVICE_UNAVAILABLE" };
  const safe: SafeResponse = { ok: r.ok, httpStatus: Number(r.httpStatus) };
  for (const key of ["code", "fields", "booking_id", "status", "duplicate", "message", "ignored"])
    if (r[key] !== undefined) safe[key] = r[key];
  return safe;
}

/**
 * The Apps Script web app never answered (Google served its own page, the HTTP request failed,
 * or the body was unreadable). The script's own JSON answers never use this class, so callers
 * can tell "Google/transport problem" apart from "the script ran and reported a failure".
 */
export class GatewayTransportError extends Error {
  override name = "GatewayTransportError";
}

export function isGatewayTransportError(error: unknown): error is GatewayTransportError {
  return error instanceof GatewayTransportError;
}

// Fixed phrases from Google's own platform pages. Only the matching CODE is reported, never page text.
const GOOGLE_PAGE_SIGNATURES: ReadonlyArray<[RegExp, string]> = [
  [/authori[sz]ation is (?:needed|required)|needs your permission|requires authori[sz]ation/i, "AUTHORIZATION_REQUIRED"],
  [/accounts\.google\.com|sign in - google accounts|to continue to google/i, "SIGN_IN_REQUIRED"],
  [/you need (?:access|permission)|don't have (?:access|permission)|access denied|not authorized/i, "ACCESS_DENIED"],
  [/script function not found/i, "FUNCTION_NOT_FOUND"],
  [/service invoked too many times|too many simultaneous invocations|quota|rate limit/i, "QUOTA_EXCEEDED"],
  [/exceeded maximum execution time|timed? ?out/i, "EXECUTION_TIMEOUT"],
  [/page not found|unable to open the file|file you have requested does not exist/i, "DEPLOYMENT_NOT_FOUND"],
  [/server error|temporarily unavailable|try again later|internal error/i, "GOOGLE_SERVER_ERROR"],
];

/**
 * Builds a short, safe description of an HTML page Google returned instead of the script's JSON.
 * Reports a fixed classification code plus the page <title> reduced to plain letters/digits/punctuation,
 * so failures can be diagnosed without recording page bodies, request data or credentials.
 */
export function describeGooglePage(html: string): string {
  const sample = html.slice(0, 64_000);
  const kind = GOOGLE_PAGE_SIGNATURES.find(([pattern]) => pattern.test(sample))?.[1] ?? "UNRECOGNIZED_PAGE";
  const rawTitle = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(sample)?.[1] ?? "";
  const title = rawTitle
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[^A-Za-z0-9 .,:'()&-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return title ? `${kind}, page title "${title}"` : kind;
}

export async function callGateway(action: GatewayAction, payload: Payload): Promise<Payload> {
  const url = new URL(required("APPS_SCRIPT_EXEC_URL"));
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !url.pathname.endsWith("/exec"))
    throw new Error("APPS_SCRIPT_EXEC_URL must be a Google Apps Script /exec deployment");
  let response: Response;
  try {
    response = await fetch(url, buildGatewayRequest(action, payload));
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out after 60s" : "network error";
    throw new GatewayTransportError(`Apps Script request ${reason}.`);
  }
  if (!response.ok) throw new GatewayTransportError(`Apps Script request failed (${response.status})`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() || "unknown";
  if (contentType !== "application/json" && !contentType.endsWith("+json")) {
    let page = "UNREADABLE_PAGE";
    try { page = describeGooglePage(await response.text()); } catch { /* keep the generic code */ }
    throw new GatewayTransportError(`Apps Script gateway returned non-JSON (HTTP ${response.status}, ${contentType}; ${page}); inspect that execution in Apps Script.`);
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new GatewayTransportError(`Apps Script gateway returned malformed JSON (HTTP ${response.status}, ${contentType}).`);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid Apps Script response");
  const failure = result as Payload;
  // Keep diagnosis in the private task error; the API returns its generic failure.
  const diagnostics = ["PROPERTY_CONFIG", "CALENDAR_ACCESS_FAILED", "EVENT_IDENTITY_MISMATCH",
    "TELEGRAM_FAILED", "UNKNOWN_EMAIL_TEMPLATE", "GATEWAY_TYPEERROR", "GATEWAY_REFERENCEERROR",
    "GATEWAY_SYNTAXERROR", "GATEWAY_UNEXPECTED_ERROR", "CONFIG_GATEWAY_SECRET", "CONFIG_SPREADSHEET_ID",
    "CONFIG_TURNSTILE_SECRET", "CONFIG_ALLOWED_HOSTNAME", "CONFIG_TELEGRAM_BOT_TOKEN",
    "CONFIG_OPS_CHAT_ID", "CONFIG_WEBSITE_URL"];
  if (failure.ok === false && failure.code === "SERVICE_UNAVAILABLE" &&
      typeof failure.diagnostic_code === "string" &&
      (diagnostics.includes(failure.diagnostic_code) || /^GOOGLE_[1-5][0-9]{2}$/.test(failure.diagnostic_code)))
    throw new Error(`Apps Script failed: ${failure.diagnostic_code}`);
  return result as Payload;
}

export async function viewingAction(action: "intake" | "telegram" | "customer_action", payload: Payload) {
  return safeResponse(await callGateway(action, payload));
}

export async function viewingWorker(action: "reminders" | "followup") {
  if (process.env.DWELLHUNT_ENABLE_SCHEDULES !== "true") return { skipped: true, reason: "Schedules disabled" };
  const result = await callGateway(action, {});
  if (result.ok !== true || Number(result.errors || 0) > 0)
    throw new Error("DwellHunt worker failed. Inspect private DH_Viewing_Log.");
  return { ok: true, processed: result.processed, errors: result.errors };
}
