# Current Development automation

The original existing endpoint serves Code.gs Version 4 (2026-11-11 02:05 Sri Lanka time).
Development Telegram routing is enabled for the verified private test chat only; the guarded
activation helper checks staging registry, bot, private chat and webhook before changing routing.
Test email and dedicated calendar restrictions apply independently of Telegram mode.
Cloudflare supplies the minute timer; the local Trigger.dev Development runner must stay online.
Production remains unchanged. See ../PROJECT_STATE.md for runtime evidence.

The older patch notes below are retained as historical context; do not upload doPost.gs
alongside Code.gs or repeat the completed setup. No new live booking test is implied.

# Original Apps Script gateway diagnostic patch

## Complete local replacement

`Code.gs` is the complete supplied backend plus the reviewed fixes. Publish ONLY
this file when replacing the original Code.gs; do NOT also upload `doPost.gs`,
which contains a duplicate handler for the earlier standalone patch.

Default behavior still requires Telegram. For the authorized manual Development
test mode, explicitly configure Script Properties:

| Name | Value |
| --- | --- |
| DWELLHUNT_ENVIRONMENT | development |
| DEV_DISABLE_TELEGRAM | true |
| DEV_TEST_EMAIL | verified test email, used for both buyer and agent |
| DEV_TEST_CALENDAR_ID | dedicated test calendar ID |
| DEV_OPERATOR_EMAIL | verified Google account running editor functions |
| DEV_BOOKING_ID | exact existing test booking ID, set after a successful intake |

Keep existing gateway, Turnstile, spreadsheet and website properties. No secrets
are included in this code. Both Development flags must match before Telegram
requirements change. In this mode intake rejects unrelated buyer email, agent
email and calendar routing. CAPTCHA remains mandatory and verified once.

After an authorized booking has been submitted once, use its exact ID in
DEV_BOOKING_ID. `developmentProcessTestBooking` delivers that record's pending
email jobs and skips Telegram jobs explicitly. Run `developmentApproveTestBooking`
as DEV_OPERATOR_EMAIL to approve that record, then manually process it to reconcile
Calendar and confirmation email. These controls require matching active/effective
Google users, a current active property, and verified test routing. They have no
public HTTP actions. A pending Meet creation may need another reconciliation;
inspect state first. Do not retry an uncertain email send automatically.

Schedules remain disabled; manual processing does not call bulk tick(). Duplicate
intake still requires a fresh CAPTCHA token; moving lookup ahead of CAPTCHA would
expose existing booking state to an unverified request and is not part of this fix.

Local VM tests mock every service; passing tests do not verify Apps Script runtime,
deployment, permissions, email delivery or Calendar/Meet support.

`appsscript.json` preserves the original manifest and declares `userinfo.email`,
required by Session-based operator identity checks. Google consent must be completed
for that added permission before publishing a revision that uses manual approval.
`developmentReadinessCheck` is read-only and verifies staging schema, test property
routing, calendar read access, write role, Meet support, email quota, and operator
identity without sending messages or creating records.

`doPost.gs` is a local, undeployed replacement for only the original project's
`doPost` handler. Keep its existing intake, CAPTCHA, property, Calendar, email,
authorization and idempotency helpers. Replace the old handler; do not leave two
global `doPost` functions. This is not a complete replacement booking backend.

The patch returns JSON for handled failures and prevents lock cleanup from
masking the response. Internal failures get an allowlisted `diagnostic_code` and
a safe code in the existing `DH_Viewing_Log` table. It never records raw exception
messages, stack traces, payloads, contacts or tokens. Error handling makes no
Telegram or email calls, so an unavailable alert service cannot mask a failure.

This is a diagnostic change, not a confirmed fix for the existing exception.
Before publishing, verify that updating the original deployment will affect only
Development. The user confirmed its spreadsheet points to staging; whether the
same deployment has Production consumers remains unverified. No booking replay
is authorized by this patch. Schedules remain disabled.
