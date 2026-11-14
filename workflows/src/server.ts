import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { runs, tasks } from "@trigger.dev/sdk";
import { authorizedTelegram, dispatch, routes, type Execute } from "./api";
import { required } from "./gateway";

required("TRIGGER_SECRET_KEY");
const origin = required("WEBSITE_ORIGIN");
required("TELEGRAM_WEBHOOK_SECRET");

const execute: Execute = async (id, payload, idempotencyKey) => {
  const signal = AbortSignal.timeout(90_000);
  const bounded = <T>(promise: PromiseLike<T>) => new Promise<T>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => reject(new Error("Task response deadline exceeded"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  const handle = await bounded(tasks.trigger(id, payload, { idempotencyKey, idempotencyKeyTTL: "24h" }));
  while (true) {
    signal.throwIfAborted();
    const run = await bounded(runs.retrieve(handle.id));
    if (run.isCompleted) {
      if (!run.isSuccess) throw new Error("Task failed");
      return run.output;
    }
    await delay(500, undefined, { signal });
  }
};

const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Vary", "Origin");
  const send = (status: number, body: unknown) => { res.writeHead(status); res.end(JSON.stringify(body)); };
  if (req.headers.origin && req.headers.origin !== origin) return send(403, { ok: false, code: "ORIGIN_DENIED" });
  if (req.headers.origin === origin) res.setHeader("Access-Control-Allow-Origin", origin);
  const path = new URL(req.url || "/", "http://localhost").pathname;
  if (!routes[path]) return send(404, { ok: false, code: "NOT_FOUND" });
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204); return res.end();
  }
  if (req.method !== "POST") return send(405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  if (routes[path] === "dwellhunt-viewing-agent-approval" &&
      !authorizedTelegram(String(req.headers["x-telegram-bot-api-secret-token"] || "")))
    return send(401, { ok: false, code: "UNAUTHORIZED" });
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json"))
    return send(415, { ok: false, code: "JSON_REQUIRED" });
  let body = "", size = 0;
  try {
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > 65_536) return send(413, { ok: false, code: "PAYLOAD_TOO_LARGE" });
      body += chunk.toString();
    }
  } catch { return send(400, { ok: false, code: "INVALID_BODY" }); }
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return send(400, { ok: false, code: "INVALID_JSON" }); }
  try {
    const result = await dispatch(path, payload, execute);
    send(result.status, result.body);
  } catch {
    // An upstream timeout may have committed. Retry the same payload to reuse the run.
    send(503, { ok: false, code: "SERVICE_UNAVAILABLE" });
  }
});
server.requestTimeout = 100_000;
server.headersTimeout = 15_000;
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => console.log("DwellHunt workflow API listening"));
