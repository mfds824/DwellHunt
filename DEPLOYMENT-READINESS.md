# DwellHunt deployment readiness — 28 October 2026

## Decision

Prepared for review, **not approved for production deployment**. Public frontend configuration is complete. Registry routing, live CORS/response behavior, management-link compatibility and broader manual/live regression testing remain open. Automated browser acceptance has passed with mocked services. No push, deployment, live registry import, booking POST or backend setting change was performed.

## Inspected inputs and findings

- Local checkout: `work/DwellHunt`, branch `feature/virtual-viewing-integration`, base `5c3641606224df15ae8c8023942232833725b03e`. Remote `main` matched that SHA at inspection. `git ls-remote --heads` returned no remote feature branch: this integration exists locally as staged/working changes, not a pushed branch. Do not assume GitHub contains the integration yet.
- Reinspected repository tree, index.html, compiled app.js, generated style.css, photo-upload.js, public config, modal, tests and prior guide. No package.json or source/build/lint tooling is available. Existing app behavior remains preserved except the previously reviewed property-detail button hook and relative asset references.
- Input workbook `Dwellhunt Virtualviewing Database.xlsx`: DH_Viewing_Properties has exactly the expected nine headers and ZERO data rows. DH_Viewing_Log, DH_Viewing_State and DwellHunt_Virtual_Viewings also contain headers only; Sheet1 is empty. The 25 viewing columns match the supplied backend. This is a local export; it does not establish the state of any live Google Sheet. Workbook SHA-256: `c24b0e682b74e0dcceed1ba0725470ddce8b51e8f275a897a36da10ebf5d2632`. Workbook unchanged, no private routing values exported.
- Reinspected local feature-package Code.gs, intake workflow and supplied tests. Live deployed Apps Script properties/code and n8n workflow configuration were not accessible. Source compatibility is confirmed; deployed settings still require owner verification. The available feature ZIP is the copy without `(1)` in its filename; the originally named variant remains unavailable.

## Property extraction and URL limitation

All ten IDs/titles were re-extracted from the actual bundled seed array and compared exactly with the previous ID inventory. No IDs were generated or changed. `viewing-property-ids.csv` now includes property_url.

There is **no canonical per-property URL in the inspected data/router**. `navigateToProperty` sets React state and scrolls; it does not update or consume a property URL. Slugs exist as data but do not implement routes. Existing WhatsApp message code constructs `/property/<id>` without `/DwellHunt/`; that pre-existing link does not establish a working route and was left untouched.

The CSVs therefore use only the existing public site address `https://mfds824.github.io/DwellHunt/` as a documented fallback for every property. It opens the homepage, not the individual listing. Do not label these as verified property deep links. Before activation, approve that limitation explicitly or separately implement/review deep links. This task does not change the app router.

Files:

- `DH_Viewing_Properties.template-INACTIVE.csv`: exact nine-column schema, ten real ID/title rows, homepage fallback, active=false, all five private routing columns blank. PRIVATE SETUP DRAFT — do not import incomplete rows into the live registry.
- `DH_Viewing_Properties.approved-import.csv`: exact headers, ZERO records. There are no verified operational rows to release. Never use this file to replace/clear a live sheet.
- `VIEWING-MISSING-CONFIGURATION.md`: REQUIRED_CONFIG markers and verification steps live here, outside operational CSV records. Private completed registry files must remain outside the public repository/Pages assets.

LocalStorage/new listings require admin review and shared publication before exact-ID registry synchronization. Follow the detailed process in VIEWING-MISSING-CONFIGURATION.md. The registry is authoritative for booking, not a mechanism that publishes browser-local properties.

## Frontend and backend contract

`viewing-config.js` now contains the supplied PUBLIC Turnstile key and separate production booking webhook. These two browser-visible values are not server authentication secrets. No TURNSTILE_SECRET, GATEWAY_SECRET or private routing value was added. The existing lead endpoint remains byte-for-byte in the preserved compiled app.

The adapter renders Turnstile action `booking` and submits the genuine callback token. Code.gs `intake` calls `verifyHuman(p,'booking')`, which requires siteverify success, exact configured hostname and matching action. Expected Script Property: `ALLOWED_HOSTNAME=mfds824.github.io`. Verify actual deployment configuration; no hostname check was relaxed. Offsets are minutes east of UTC; Apps Script subtracts them from local wall-clock time. Colombo is +330. The form omits unspecified offset so backend DST ambiguity/gap checks still apply.

The supplied n8n intake parses a JSON string body, forces gateway action intake, uses server Custom Auth and returns safe fields. Expected browser responses:

| Situation | Expected response |
|---|---|
| Pending approval | 202 JSON, ok=true, booking_id, status=pending_approval |
| Slot unavailable | 202 JSON, ok=true, status=reschedule_requested |
| Duplicate | 200 JSON, same booking_id, duplicate=true |
| Bad request/timezone/DST | 400 or 422 JSON with safe code/fields |
| CAPTCHA rejected | 403 JSON |
| Unregistered/inactive property | 404 JSON, PROPERTY_UNAVAILABLE |
| Changed key payload | 409 JSON |
| Rate limited | 429 JSON |
| Lock busy/backend unavailable | 503 JSON |

The adapter sends JSON serialized as text/plain;charset=UTF-8, no credentials or custom headers. That is normally a simple CORS POST, not a JSON preflight. Origin must be `https://mfds824.github.io` without `/DwellHunt/`. Successful AND rejected POST responses must have readable JSON and `Access-Control-Allow-Origin: https://mfds824.github.io`; retain Cache-Control: no-store. Do not use no-cors or weaken backend authentication. Cloud/proxy-generated HTML errors may lack CORS even if the workflow does the right thing; frontend safely reports an uncertain network outcome and retains its retry key.

Read-only HTTP observations this run:

- Production website HEAD: 200 OK, served by GitHub Pages. This is reachability only, not regression verification.
- Production booking endpoint OPTIONS with Origin and Access-Control-Request-Method POST: **500**, HTML, no Access-Control-Allow-Origin; Access-Control-Allow-Methods was OPTIONS. This is an unresolved diagnostic, not proof of the simple POST's result. Investigate active route/proxy/CORS with your n8n administrator. No production POST was sent. Actual successful and rejected booking responses remain unverified.

## Tests executed

| Check | Result |
|---|---|
| node --check app.js, virtual-viewing.js, viewing-config.js, tests/virtual-viewing.cjs | PASS |
| node tests/preservation.cjs | PASS: bundle differs only by intended detail hook; CSS, upload, Supabase config and original HTML preserved except asset additions |
| node tests/deployment-readiness.cjs | PASS: public settings, exact ten seed IDs/titles, nine-column inactive draft, zero approved rows, booking action/token/randomness contract, JSON transport and relative assets |
| node ../feature-package/test-system.cjs | 31 PASS, MOCKED Google/Sheets/Calendar/Telegram/email/Turnstile only |
| git diff --check and staged diff check | PASS, no whitespace errors |
| node tests/virtual-viewing.cjs | PASS, exit 0 with Playwright 1.64.1: default headless Chromium, installed Edge, and matching full Chromium (headless). Verified listing hook, subpath assets, fail-closed configuration, payload, secure retry keys, CAPTCHA rejection, unavailable slot, duplicate response, focus restoration, mobile bounds and no runtime errors. Mock services only. |
| Build/lint commands | Unavailable: repository has no package/build/lint configuration |

The browser test now intercepts viewing-config.js with empty test configuration and blocks external requests before loading the app. Its isolated mock booking route cannot send production bookings even with the production public settings in the repository. Production adapter has no mock CAPTCHA bypass.

Pending: broader manual accessibility/layout/regression checks, real Turnstile, booking success/rejection POST/CORS, registry import, agent approval, Meet/Calendar, delivery, cancellation/feedback, Cloudinary, auth and lead/chat regression. Static preservation does not prove external integrations work. Mock test success does not establish end-to-end success.

## Exact deployment checklist

1. Keep this local feature branch. Review the complete patch against base SHA above. Confirm the intended feature ZIP version. Do not merge to main or trigger Pages yet.
2. Privately back up existing Pages files, lead workflow and backend registry/configuration. Record a known-good Pages revision and backend version. Do not put private backups in the public repository.
3. Complete one property's private registry routing per VIEWING-MISSING-CONFIGURATION.md. Verify IDs as text, canonical/fallback URL decision, actual agent/calendar permissions, dedicated bot/chat and agent user allowlist. Review a unique complete row; only then set active=true in a private approved import. Import/upsert only approved complete rows after a private sheet backup; preserve other rows and all booking/state/log history. Repeat for other approved properties later.
4. Verify deployed Apps Script version, exact private spreadsheet, public hostname, matching private Turnstile secret and server-only gateway secret. Verify separate n8n intake production path and selected Custom Auth credential. Diagnose the observed CORS/OPTIONS error; confirm JSON/CORS on the POST status matrix above. Do not touch the lead workflow.
5. Resolve management email fragment support and test it before full-system launch, or explicitly limit rollout to a reviewed booking-only pilot with a supported cancellation/contact process. Do not claim the package's management links work today.
6. Automated browser acceptance passed with Playwright 1.64.1 using isolated temporary dependencies and browsers; no project dependency files were added. Rerun after changes. Perform remaining manual tests at 375/768/1440 widths: real property detail selection, keyboard/screen reader labels/focus, Escape/close, modal scroll, missing/expired/rejected CAPTCHA, invalid input/timezone/DST, ambiguous explicit offset, timeout/offline/retry, unavailable slot, duplicate and double click. Use genuine tokens for server tests; staging test fixtures must not ship as runtime code.
7. Compare existing home/search/filter/currency/save/compare/map/listing/dashboard/auth flows with baseline. Test Cloudinary upload, customer enquiry to the unchanged lead workflow, WhatsApp and Telegram. Record actual results. Preserve the pre-existing URL limitations in the release notes if not fixed separately.
8. Run one controlled complete staging booking through registry, n8n, Apps Script, authorized approval, Calendar/Meet and delivery. Confirm pending is not shown as confirmed, one event exists, and buyer-local/Colombo times agree. Test retry with fresh CAPTCHA and the same key. Verify rejection responses are readable from the real website origin.
9. Only after these checks, request your explicit approval to push the feature branch. Review a PR and obtain separate approval before merging/deploying through the existing Pages process. This preparation grants neither approval.
10. After approved deployment, verify `/DwellHunt/` and every relative asset return 200 with correct MIME types, reload without stale cache, verify Turnstile hostname/action, repeat booking and existing lead/photo/auth/chat smoke tests, and monitor sanitized failures. Roll back if critical checks fail.

## Rollback

Before deployment, keep production unchanged and revert only local review changes if needed. After an approved deployment, redeploy the recorded known-good Pages revision or revert only this integration's changes (one app hook, three index references and added integration assets/config), preserving unrelated subsequent edits. Do not blindly reset current main.

Leave the existing lead workflow and its bot untouched. Stop new viewing intake/disable affected registry rows only after reviewing pending appointments, and keep viewing workers running long enough to resolve/cancel existing requests and notify buyers. Restore private registry backups only through an ID-aware review; never overwrite current booking/state history. Clear stale frontend assets/cache and recheck the original website functions.

## Exact file changes

Compared with the previous prepared integration, modified: `viewing-config.js`, `viewing-property-ids.csv`, `tests/virtual-viewing.cjs`, `VIRTUAL-VIEWING-INTEGRATION.md`.

New this preparation: `DH_Viewing_Properties.template-INACTIVE.csv`, `DH_Viewing_Properties.approved-import.csv`, `VIEWING-MISSING-CONFIGURATION.md`, `DEPLOYMENT-READINESS.md`, `tests/deployment-readiness.cjs`.

The complete patch against original main additionally includes the previously prepared modifications to `app.js` and `index.html`, and previously new `virtual-viewing.js`, `virtual-viewing.css`, `tests/preservation.cjs`. No additional app hook, router change or existing stylesheet/upload/lead implementation change was made this run. The Excel workbook and Downloads config copy were not changed this run; the configured repository version is included in the new deliverables.

## Your exact next action

Privately complete and verify the five routing fields for ONE chosen real property using VIEWING-MISSING-CONFIGURATION.md, then prepare only that approved complete row for the private registry. Do not upload the inactive draft or header-only file to replace the live sheet. In parallel, have your n8n administrator diagnose the observed 500/CORS response. Keep deployment on hold until the checklist passes; do not send secrets through the frontend or public repository.
