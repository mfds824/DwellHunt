# Configuration and registry approval checklist

No private routing values were supplied or copied into this repository. Do not commit a completed private registry to GitHub Pages or any public repository. The input Excel workbook was inspected read-only and was not modified.

## Next action

Choose ONE real property from `DH_Viewing_Properties.template-INACTIVE.csv`. In your private admin copy, supply and verify its five routing fields below. Keep `active=false` until verification is complete. Do not import the ten incomplete draft rows into the live registry. The approved import CSV deliberately has zero records because no routing has been verified.

| Required setting per property | Status | Verification before activation |
|---|---|---|
| agent_id | REQUIRED_CONFIG | Confirm a stable, actual agent identifier against your authoritative admin record. |
| agent_email | REQUIRED_CONFIG | Confirm the agent owns/monitors this mailbox and can receive viewing replies. |
| calendar_id | REQUIRED_CONFIG | Obtain the exact actual Calendar ID privately; verify backend owner free/busy and event-write access, and Meet support. |
| telegram_chat_id | REQUIRED_CONFIG | Confirm the dedicated viewing bot can deliver to the correct private chat/group. Keep as text. |
| telegram_user_ids | REQUIRED_CONFIG | Verify exact authorized agent user IDs, comma-separated text, against that chat. Chat IDs and user IDs are different. |

All five fields are REQUIRED_CONFIG for each of these exact property IDs:

- prop-cinnamon-gardens-villa
- prop-galle-face-penthouse
- prop-galle-fort-heritage
- prop-rajagiriya-lakeside-rent
- prop-kandy-mountain-residence
- prop-mirissa-beach-land
- prop-wtc-corporate-office
- prop-biyagama-logistics-hub
- prop-dubai-marina-penthouse
- prop-nuwara-eliya-bungalow

## Other verification still required

- [x] Frontend PUBLIC Turnstile key set to `0x4AAAAAAFlgi62lRvCmxFzi`.
- [x] Frontend production booking URL set to `https://wstmendis.app.n8n.cloud/webhook/dwellhunt-virtual-viewing`.
- [ ] Verify this widget allows `mfds824.github.io`, and the server secret matches the public key. Keep the secret only in Script Properties.
- [ ] Verify deployed Script Properties: `ALLOWED_HOSTNAME=mfds824.github.io`, `WEBSITE_URL=https://mfds824.github.io/DwellHunt/`, correct private spreadsheet, TURNSTILE_SECRET and GATEWAY_SECRET. Their live values were not inspected; do not paste secrets into this checklist.
- [ ] Verify n8n's separate production intake workflow is active, uses the deployed Apps Script `/exec` URL and selected Custom Auth credential. Imported package settings alone do not prove live configuration.
- [ ] Diagnose observed OPTIONS HTTP 500 / absent Access-Control-Allow-Origin. Test actual simple POST success and 403/404/409/422/429/503 responses from the website origin with genuine CAPTCHA. Do not disable verification to test.
- [ ] Approve the documented homepage URL fallback or separately implement/test property deep links before activation. The inspected app has no per-property URL router; do not use `/property/<id>` links or invent slug routes.
- [ ] Decide and test cancellation/feedback management UI before full-system release. The booking integration does not implement the package's management email fragments.
- [ ] Run browser acceptance/regression and controlled live backend tests listed in DEPLOYMENT-READINESS.md.

## Manual or admin-approved sync process

1. Reconcile the exact ID and title with a legitimate published listing in the admin's browser. Existing seed listings initialize localStorage; previously saved browser records can differ from current bundled seed data.
2. New listings use `prop-${Date.now()}` and persist only in that browser's `dwellhunt_properties` localStorage. They are not automatically published to every buyer or synchronized with the backend. An active registry row alone does not make a local listing visible to other users. First establish an approved shared publication process and verify the buyer can see the exact same ID. Never auto-enrol client-submitted registry/routing data.
3. Confirm property availability/ownership, ID uniqueness and exact title. Retain exact IDs; never regenerate IDs during spreadsheet import. Resolve ID collisions with the source owner instead of silently renaming.
4. Complete routing in a PRIVATE copy of the nine-column template. The homepage URL is an honest fallback, not a property deep link; it opens the site's homepage. Never construct routes from slugs without application support.
5. After all routing/permissions and URL behavior are verified, copy only approved, complete rows into a private import file in exact header order; change those rows to `active=true`. Keep all unapproved rows out of that file. Do not use the header-only supplied file to replace/clear a live sheet.
6. Back up the live registry privately. Upsert reviewed rows by exact property_id; do not append duplicates or replace unrelated rows. Format identifiers as text, inspect commas in telegram_user_ids and preserve CSV quoting. Do not change state/bookings/log sheets.
7. Run one controlled genuine-CAPTCHA booking; verify the authoritative registry title/routing, requested timezone, pending approval and actual notifications. Record approval privately. Retire properties by setting active=false after considering outstanding bookings; do not delete appointment history.
