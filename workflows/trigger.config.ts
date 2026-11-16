import { defineConfig } from "@trigger.dev/sdk";

const project = process.env.TRIGGER_PROJECT_REF || "proj_tiihuqzqlbwcbwjibgyu";

export default defineConfig({
  project,
  runtime: "node",
  dirs: ["./trigger", "./trigger-listings"],
  maxDuration: 120,
  // The Apps Script gateway's retry safety must be verified before increasing this.
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
