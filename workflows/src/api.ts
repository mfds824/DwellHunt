import { createHash, timingSafeEqual } from "node:crypto";
import { required, safeResponse, type Payload } from "./gateway";
import { scoreLead } from "./leads";

export const routes: Record<string, string> = {
  "/api/dwellhunt/leads": "dwellhunt-new-lead",
  "/api/dwellhunt/bookings": "dwellhunt-viewing-booking",
  "/api/dwellhunt/agent": "dwellhunt-viewing-agent-approval",
  "/api/dwellhunt/buyer-actions": "dwellhunt-viewing-buyer-actions",
  // Old path suffixes are retained to ease website endpoint migration.
  "/webhook/dwellhunt-ai-leads-v2": "dwellhunt-new-lead",
  "/webhook/dwellhunt-virtual-viewing": "dwellhunt-viewing-booking",
  "/webhook/dwellhunt-viewing-agent": "dwellhunt-viewing-agent-approval",
  "/webhook/dwellhunt-viewing-actions": "dwellhunt-viewing-buyer-actions",
};

export function authorizedTelegram(supplied: string | undefined): boolean {
  const expected = required("TELEGRAM_WEBHOOK_SECRET");
  return !!supplied && Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export type Execute = (taskId: string, payload: Payload, key: string) => Promise<unknown>;
export async function dispatch(path: string, payload: unknown, execute: Execute) {
  const taskId = routes[path];
  if (!taskId) return { status: 404, body: { ok: false, code: "NOT_FOUND" } };
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return { status: 400, body: { ok: false, code: "INVALID_PAYLOAD" } };
  const data = payload as Payload;
  if (taskId === "dwellhunt-new-lead") {
    try { scoreLead(data); } catch { return { status: 400, body: { ok: false, code: "CONTACT_REQUIRED" } }; }
  }
  // Payload identity ensures an ambiguous client retry reuses its existing run.
  const key = createHash("sha256").update(taskId + ":" + JSON.stringify(data)).digest("hex");
  const output = await execute(taskId, data, key);
  if (taskId === "dwellhunt-new-lead") {
    const r = output as { duplicate?: boolean; priority?: string };
    return { status: 200, body: { ok: true, duplicate: r.duplicate, priority: r.priority } };
  }
  const safe = safeResponse(output);
  return { status: safe.httpStatus, body: safe };
}
