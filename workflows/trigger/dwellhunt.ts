import { AbortTaskRunError, queue, schedules, task } from "@trigger.dev/sdk";
import { viewingAction, viewingWorker, callGateway, isGatewayTransportError, type Payload } from "../src/gateway";
import { saveLead } from "../src/leads";

// One queue serializes CRM lookup+append across lead runs in this environment.
const leadsQueue = queue({ name: "dwellhunt-crm", concurrencyLimit: 1 });
const workersQueue = queue({ name: "dwellhunt-viewing-workers", concurrencyLimit: 1 });

// Reminders/follow-ups are recovery sweeps that already run every 1-5 minutes, so one short retry
// is equivalent to the next sweep arriving early. It rides out brief Google errors (e.g. an HTML
// error page) without waiting for the next schedule. Bookings and agent/buyer actions are NOT
// retried: each carries a single-use CAPTCHA token or a one-time action that must never be replayed.
const workerRetry = { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 10_000, factor: 2, randomize: true };
async function sweep(action: "reminders" | "followup") {
  try {
    return await viewingWorker(action);
  } catch (error) {
    if (isGatewayTransportError(error)) throw error; // Google/transport problem: retry once.
    // The script ran and reported a failure (or config is missing): retrying immediately won't help.
    throw new AbortTaskRunError(error instanceof Error ? error.message : String(error));
  }
}

export const newLead = task({ id: "dwellhunt-new-lead", queue: leadsQueue,
  retry: { maxAttempts: 1 }, run: (payload: Payload) => saveLead(payload) });
export const booking = task({ id: "dwellhunt-viewing-booking",
  retry: { maxAttempts: 1 }, run: (payload: Payload) => viewingAction("intake", payload) });
export const agentApproval = task({ id: "dwellhunt-viewing-agent-approval",
  retry: { maxAttempts: 1 }, run: (payload: Payload) => viewingAction("telegram", payload) });
export const buyerAction = task({ id: "dwellhunt-viewing-buyer-actions",
  retry: { maxAttempts: 1 }, run: (payload: Payload) => viewingAction("customer_action", payload) });
export const reminders = schedules.task({ id: "dwellhunt-viewing-reminders-recovery", queue: workersQueue,
  cron: process.env.DWELLHUNT_NATIVE_SCHEDULES === "true" ? { pattern: "* * * * *", timezone: "Asia/Colombo", environments: ["PRODUCTION"] } : undefined,
  retry: workerRetry, run: () => sweep("reminders") });
export const followup = schedules.task({ id: "dwellhunt-viewing-completion-followup", queue: workersQueue,
  cron: process.env.DWELLHUNT_NATIVE_SCHEDULES === "true" ? { pattern: "*/5 * * * *", timezone: "Asia/Colombo", environments: ["PRODUCTION"] } : undefined,
  retry: workerRetry, run: () => sweep("followup") });

export const readiness = task({id:"dwellhunt-viewing-readiness",retry:{maxAttempts:1},run:()=>callGateway("viewing_health",{})});
