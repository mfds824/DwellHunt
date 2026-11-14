import { tasks } from "@trigger.dev/sdk";
import { telegram } from "../src/leads";

tasks.onFailure(async ({ ctx }) => {
  if (!ctx.task.id.startsWith("dwellhunt-")) return;
  // Never include payloads, gateway credentials, errors or buyer contact details.
  await telegram(`DwellHunt workflow failed. Task: ${ctx.task.id}. Run: ${ctx.run.id}. Inspect the failed run.`);
});
