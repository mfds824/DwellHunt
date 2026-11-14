# DwellHunt Trigger.dev migration

Current Development workflow is connected to the existing Development website and Worker.
See PROJECT_STATE.md for verified destinations and evidence. Production remains unchanged.

## Current automatic Development mode

The existing Development Worker invokes reminders/recovery each minute and completion/follow-up
each fifth minute. Its cron is guarded by the Development origin/environment and enabled flag;
queued maintenance expires after two minutes. Native Trigger Production schedules remain off.
Keep this computer awake and `npm run dev` running: the Development runner executes these tasks.
Telegram approval routes only to the verified private test account. Existing test email/calendar
restrictions remain enforced even with Telegram enabled.

Static source is in `website/`; upload that complete folder only to Pages branch `development`.
It contains no workflow code, environment files, tests or dependencies. The booking form has
optional five-second success auto-close and a Keep open control. CAPTCHA is validated once,
in Apps Script, including buyer management actions. No automatic submission retries.

The remaining migration/setup notes below describe the original scaffold; PROJECT_STATE.md
supersedes their old deployment status. Do not follow Production setup steps without authorization.

| Exported n8n workflow | Replacement |
| --- | --- |
| AI Virtual Viewing Booking System (11 nodes) | `dwellhunt-new-lead`: normalize contact, deduplicate CRM, rule-based HOT/WARM/COLD scoring, append Google Sheets row, Telegram alert |
| AI Virtual Viewing Booking System (5 nodes) | `dwellhunt-viewing-booking`: Apps Script `intake` |
| Virtual Viewing Agent Approval | `dwellhunt-viewing-agent-approval`: Apps Script `telegram` |
| Virtual Viewing Buyer Actions | `dwellhunt-viewing-buyer-actions`: Apps Script `customer_action` |
| Virtual Viewing Reminders and Recovery | `dwellhunt-viewing-reminders-recovery`: Apps Script `reminders`, every minute |
| Virtual Viewing Completion and Follow-up | `dwellhunt-viewing-completion-followup`: Apps Script `followup`, every five minutes |
| Virtual Viewing Operations Alerts | `trigger/init.ts` global terminal-failure hook, Telegram alert without buyer details |

The four dummy QA workflows are covered by local auth/routing tests rather than deployed endpoints. The staging Telegram chat-ID listener is a diagnostic, not a business workflow; its export is retained but it is not activated in Trigger.dev.

## Preserved dependencies

This replaces the n8n orchestration layer. It retains Google Apps Script for property validation, timezone handling, booking state, buyer tokens, agent identity/nonces, reminders and completion logic. The complete Apps Script implementation is in `apps-script/Code.gs`. Existing Google Sheets and Telegram dependencies remain.

The legacy lead workflow uses fixed scoring rules despite its AI name; those rules are preserved. Phone-only leads now deduplicate by phone instead of comparing blank emails. New leads without either email or phone are rejected. Existing Google Sheets columns are mapped by header name and appended with `RAW` values.

## Setup and deployment

1. Copy `.env.example` to `.env` locally. Fill in the Trigger.dev project reference and environment key. Keep secrets out of website JavaScript and Git.
2. Set `APPS_SCRIPT_EXEC_URL` and `APPS_SCRIPT_AUTH_BODY_JSON` using the existing Apps Script Script Property `GATEWAY_SECRET`: `{"gatewaySecret":"<GATEWAY_SECRET value>"}`. The inspected `doPost()` validates `p.gatewaySecret` from the JSON body, so `APPS_SCRIPT_AUTH_HEADERS_JSON={}` is sufficient. Keep the secret in local/Trigger.dev environment configuration only. Client data cannot select the gateway action or override authentication.
3. Share the CRM sheet with the Google service account. Set its email, private key, sheet ID and tab name. Match the CRM headers in `src/leads.ts`.
4. Set the Telegram bot token, operations chat ID and a webhook secret. Configure these secrets in the Trigger.dev environment as well as the API host where applicable. Set `WEBSITE_ORIGIN` to the site's actual origin.
5. Run `npm ci`, `npm run check` and `npm test`. Run `npx trigger.dev login`, then `npm run dev` for development or `npm run deploy` for production. The project reference is already configured; `TRIGGER_PROJECT_REF` can override it. The CLI loads the project's `.env` file by default; deployed task secrets must also be configured in the appropriate Trigger.dev environment.
6. The Cloudflare Worker option is scaffolded in `cloudflare/worker.ts` and `wrangler.jsonc`. It uses the Worker API at the configured `WEBSITE_ORIGIN`, Trigger.dev secret key, and Telegram webhook secret. Add `TRIGGER_SECRET_KEY` and `TELEGRAM_WEBHOOK_SECRET` as encrypted Development secrets in Cloudflare. First run it locally with `npx wrangler@latest dev`; do not deploy it until its local behavior is reviewed. The Worker waits up to 90 seconds for a task result.
7. The Node alternative is `src/server.ts` as a persistent HTTPS service using `npm run start:api`. Its host/proxy must allow requests up to 90 seconds. GitHub Pages alone cannot host this API.
8. Update the website endpoints and Telegram webhook to the chosen API host. Telegram must send `X-Telegram-Bot-Api-Secret-Token`, configured through its `setWebhook` `secret_token` parameter.
9. Verify a test booking, duplicate, invalid property/slot, agent approval, buyer cancellation/reschedule, and a lead saved to CRM with its Telegram alert. Verify gateway auth rejects invalid requests. These checks need real configured services and have not run here.
10. Enable `DWELLHUNT_ENABLE_SCHEDULES=true` in the production Trigger.dev environment after checking reminders/follow-up on test data. Both schedules target production only; with the flag false they exit without contacting Apps Script. Configure platform alerts too if notifications are required for crashes/system failures, which `onFailure` does not cover.

## Website endpoints

| POST path on the new API host | Task |
| --- | --- |
| `/api/dwellhunt/leads` | New lead |
| `/api/dwellhunt/bookings` | Viewing booking |
| `/api/dwellhunt/agent` | Telegram agent callback (provider secret required) |
| `/api/dwellhunt/buyer-actions` | Buyer management action (gateway validates buyer token) |

Old `/webhook/...` suffixes are also accepted on the new API host. Send `Content-Type: application/json`. Booking responses preserve the gateway's public response fields and HTTP status. A submission returns its final business result, not an immediate queue acknowledgement. Failed/unavailable task execution returns a generic 503 without internal error details.

The backend computes a 24-hour task idempotency key from the task ID and exact JSON payload. Retrying an ambiguous HTTP timeout with the same payload reuses its existing run; a timeout does not prove the booking failed. This is bounded retry protection, not permanent business deduplication. The Apps Script gateway must still enforce booking/token/nonce constraints.

## Verification and operational limits

Local tests use dummy values and mocked task execution, without sending messages or changing bookings. Run `npm run check` and `npm test`.

Task execution attempts are limited to one, matching the absence of configured retries in the exports. Do not increase retries until gateway idempotency is verified. Lead lookup and append are serialized within the production task queue, but Google Sheets offers no atomic uniqueness guarantee across external writers/environments. If Telegram fails after a lead row is appended, manually recover its notification; replaying the whole lead task will see a duplicate. A database-backed outbox would be needed for stronger guarantees.

Put request-rate controls and abuse protection on the API host before exposing public forms. CORS is configured for the website origin but is not authentication. Telegram provider authentication is checked by the API and buyer authorization remains in Apps Script.

The current Trigger.dev CLI's development dependencies have npm audit findings; the production SDK/API dependency audit is clean. Do not use npm's suggested forced downgrade to the obsolete CLI 1.x.

## n8n backup

`backups/n8n-dwellhunt-2026-11-07.json` contains all 12 MCP workflow exports before archival, including QA and staging drafts. It is ignored by Git and does not include credential secrets. Archival is reversible; no n8n credential or data source is deleted.

References: [Trigger.dev tasks](https://trigger.dev/docs/tasks/overview), [scheduled tasks](https://trigger.dev/docs/tasks/scheduled), [configuration](https://trigger.dev/docs/config/config-file).
