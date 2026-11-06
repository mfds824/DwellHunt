# DH-TDEV-WF01 deployment and rollback candidate

This is a local deployment plan, not deployment authorization. Root GitHub Pages assets, root `trigger.config.ts`, existing Trigger.dev booking tasks, n8n, and database policies are unchanged.

## Future environment contract

The future server host must supply only server-side values for the names listed in `src/readiness.ts`. No values or URLs are stored here. Do not expose database or Trigger.dev credentials in the browser. The route contract is `POST /v1/leads`; health is liveness-only and readiness returns unavailable until all bindings and the legacy compatibility review are complete.

Task discovery currently points to `./trigger` in the root `development/trigger.config.ts`. The WF01 task candidate is under `triggerdev-migration/tdev-d1/src/` and is not registered/discovered. Any future task-discovery change needs its own review and must not accidentally load booking/security tasks.

## Required cutover sequence (not executed)

1. Obtain an owner-approved export/read-only verification of the exact legacy lead workflow graph, response behavior, CRM writes, Telegram notifications, follow-up scheduling, retry settings, and any downstream dependencies.
2. Approve the database schema, retention/PII controls, idempotency identity policy, locking strategy, and a safe isolated staging database. Review the candidate SQL before execution; current SQL/fixtures gate prohibits applying it.
3. Provide reviewed server authentication/public-form anti-abuse, distributed rate limiting, exact CORS origins, host timeouts, and a downstream compatibility adapter. Do not invent a second Sheets/Telegram sender.
4. Resolve Trigger.dev dependency/security gates; bind a dedicated development/staging project and secret scope; register only the reviewed WF01 task; deploy through an approved environment process.
5. Validate synthetic staging intake, retries, duplicates, downstream receipts, unknown outcome reconciliation, monitoring, and rollback. Confirm no duplicate CRM row, notification, or follow-up.
6. Obtain explicit website-switch authorization. The current production bundle continues to call n8n until then.
7. Monitor and retain the reversible endpoint setting. Retire the specific n8n workflow only after its graph and dependants are verified and separate retirement approval is given.

## Rollback design

Before an authorized cutover, record the exact website endpoint configuration and keep the current n8n route and workflow intact. Rollback would switch the server routing setting back to the known current n8n route, stop new Trigger.dev dispatch, preserve outbox rows and unknown outcomes for reconciliation, and avoid replaying uncertain jobs. Do not delete candidate records, resend uncertain deliveries, deactivate n8n, or reverse external side effects automatically. No rollback switch, endpoint, workflow, or deployment is configured or executed by this candidate.
