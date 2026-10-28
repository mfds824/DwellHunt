# Virtual viewing integration review

Updated preparation: see DEPLOYMENT-READINESS.md and VIEWING-MISSING-CONFIGURATION.md for current registry, CORS diagnostics and release gates.

## Architecture and scope

Inspected the current GitHub repository's index.html, app.js, style.css, photo-upload.js and full file tree before editing. It contains a compiled React application, generated Tailwind CSS, and no package.json, JSX source, build/lint configuration or existing tests. The property detail component (`Jn`) already resolves the selected property object `p` and renders the existing enquiry component (`qn`). One JSX-runtime button was inserted beside that component, using `String(p.id)` and `p.title`; no JSX source is served to the browser. The rest of app.js is preserved. Separate vanilla JavaScript handles a native dialog, avoiding a rebuild or a second React copy. Future upstream bundle rebuilds must carry forward this hook (preferably in recovered source).

Inspected VirtualViewingForm.jsx, SETUP-AND-TESTING.md, Code.gs and 01-booking-intake.json from `C:\Users\sachi\Downloads\DwellHunt-Virtual-Viewing-System.zip`. The exact requested `(1).zip` filename was not found; confirm that this is the intended package before release. The adapter follows its intake contract rather than copying its unbuildable JSX into GitHub Pages.

Branch: `feature/virtual-viewing-integration`. Nothing pushed, deployed, or changed on main or remote services.

## Exact changed files

Modified:
- app.js — one detail-view button hook with the selected listing ID/title.
- index.html — three relative asset references.

New:
- viewing-config.js — supplied public Turnstile key and separate production booking URL.
- virtual-viewing.js — accessible modal, validation, Turnstile, intake and feedback.
- virtual-viewing.css — scoped responsive dialog and button styles.
- viewing-property-ids.csv — ten bundled listing IDs/titles plus the documented homepage URL fallback; not an authoritative registry import.
- tests/preservation.cjs — verifies unchanged existing code against repository HEAD except the intended hook/references.
- tests/virtual-viewing.cjs — isolated Playwright acceptance test with mocked services.
- VIRTUAL-VIEWING-INTEGRATION.md — this configuration, verification and limitations guide.

style.css, photo-upload.js, supabase-config.js, listing/filter/authentication/lead logic and existing chat links have no implementation changes. Static comparison verifies preservation, not their live external integrations.

## Public frontend configuration

The supplied values are now configured in viewing-config.js. Verify the deployed service/widget settings before release:

1. `turnstileSiteKey`: real PUBLIC Cloudflare site key, widget allowed hostname `mfds824.github.io`. The adapter renders action `booking` and sends the callback token as `turnstile_token`. No fabricated tokens or test bypass exists in production code.
2. `bookingUrl`: actual browser-accessible HTTPS n8n PRODUCTION URL ending `/webhook/dwellhunt-virtual-viewing`. Do not use `/webhook-test/`, the lead endpoint, Apps Script URL, credential-bearing URLs, query secrets or private gateway endpoints. A browser-facing webhook URL is inherently public; all authentication secrets must remain server-side. If a custom public route is required, review the adapter's strict path check deliberately.
3. Keep these assets alongside index.html. All references start `./`, preserving `/DwellHunt/`. No frontend build is required.

The request is JSON serialized with `Content-Type: text/plain;charset=UTF-8`, matching the supplied workflow's string-JSON parser and avoiding JSON preflight. n8n must return readable JSON with CORS origin `https://mfds824.github.io` (origin excludes the subpath). Do not switch to no-cors. No cookies/auth headers are sent. Check reverse-proxy CORS and error responses too.

Each distinct payload receives 24 cryptographically random bytes encoded as 48 lowercase hex characters, matching the required key regex. Identical details reuse their key in page memory, including after network failures and modal reopening; edits produce a distinct key. Every retry requires fresh Turnstile verification. Reloading clears this memory; backend semantic deduplication remains necessary. No buyer details are persisted by the new adapter.

## Backend compatibility and registry: separate from frontend

No backend code or n8n workflows were changed or deployed.

- Code.gs `verifyHuman(p,'booking')` already validates siteverify success, exact `ALLOWED_HOSTNAME` and action. Set Script Property `ALLOWED_HOSTNAME=mfds824.github.io` (no scheme/path), and `WEBSITE_URL=https://mfds824.github.io/DwellHunt/`. Keep TURNSTILE_SECRET and GATEWAY_SECRET in server properties/credentials only. Do not remove hostname/action verification.
- `localToUtc` computes `UTC = local wall-clock - offset * 60000`. Offset is minutes EAST of UTC: Colombo +330, New York winter -300. The form sends the buyer's IANA timezone and date/time directly; an optional numeric offset is sent only when explicitly entered, so DST folds require clarification and gaps remain rejected. It never guesses the selected date's offset using the browser's current offset.
- 01-booking-intake.json already permits origin `https://mfds824.github.io`, parses text/plain JSON, forwards only payload, supplies server gateway credentials, and returns safe fields/status. Bind the real Custom Auth credential and Apps Script `/exec` URL in n8n, activate the separate workflow, and verify it responds with `ok`, `booking_id`, `status`, optional `duplicate`. Keep the existing enquiry webhook unchanged.
- Package `DH_Viewing_Properties.csv` is HEADER ONLY. Therefore none of the website's ten bundled IDs can be confirmed present from this package. The live private sheet was not accessible. Reconcile viewing-property-ids.csv with the actual private registry. Each active row needs exact website property ID, canonical title/HTTPS URL, verified agent/calendar/chat/user routing and active=true. Backend deliberately trusts that registry rather than the browser title/URL. Missing/inactive IDs return PROPERTY_UNAVAILABLE.
- The existing website also accepts locally stored/new listings with IDs `prop-${Date.now()}`. The button receives these real runtime IDs too. An administrator must synchronize legitimate published listings into the private registry before booking; do not auto-enrol arbitrary browser data or expose routing credentials. Website listings are currently localStorage-backed rather than a shared authoritative property database.
- Frontend hours copy matches package defaults: 17:00–22:00 Asia/Colombo, 30 minutes, one-hour notice, 90-day horizon. Update both copy and backend settings together if changed.
- The package's cancellation/feedback email links require a management UI for action `manage`. That separate feature is NOT integrated by this booking-only change. Before full-system release, supply a tested management page and matching backend links, or integrate the package management flow with a separate public actions endpoint. Current existing app does not handle those private booking fragments. Do not represent cancellation/feedback links as working based on this patch.

## Verification performed and limits

- `node --check app.js`, `node --check virtual-viewing.js`, `node --check viewing-config.js`: passed.
- `node tests/preservation.cjs`: checks the complete original compiled app survives with only the single hook and intended index references; checks original CSS/upload/config files.
- Package `node test-system.cjs`: 31 tests passed, with mocked Google/Sheets/Telegram/email/Turnstile services. These verify timezone/DST, registry trust, CAPTCHA rejection, duplicate protection, availability, approval/recovery, reminders and gateway authentication.
- Repository has no available build/lint scripts or pre-existing test suite.
- `node tests/virtual-viewing.cjs`: PASS, exit 0 with Playwright 1.64.1 using default headless Chromium, installed Edge, and matching full Chromium (headless). Verified the real listing hook, subpath assets, fail-closed configuration, payload, secure retry keys, CAPTCHA rejection, unavailable slot, duplicate response, focus restoration, mobile bounds and no runtime errors. Dependencies and matching browsers were installed in an isolated temporary folder; no project dependency files were added. `DH_PLAYWRIGHT` points to that Playwright module; `PLAYWRIGHT_BROWSERS_PATH` selects the isolated browser folder, and `DH_BROWSER` optionally selects Edge or full Chromium. External requests are blocked and services are mocked only in this test; production CAPTCHA is unchanged. Broader manual accessibility/regression checks and live end-to-end tests remain pending.
- No live booking, CAPTCHA, Cloudinary upload, Telegram/WhatsApp, authentication, private registry, n8n import, Google Calendar/Meet or delivery test was performed. Public configuration is set, but live service behavior remains unverified. The supplied workbook has zero registry rows; see the readiness report.

## Manual browser acceptance before GitHub Pages release

- [ ] Serve under `/DwellHunt/` over localhost HTTP (not file://). Confirm index and three new assets return 200; open the existing home/search/detail views without console errors.
- [ ] Compare listing counts, filters, saved properties, compare, currency, map, dashboard, authentication and navigation with the original site. Test returning from detail and selecting another listing; each button must carry that listing's actual ID/title, including a locally added listing.
- [ ] Submit a controlled existing customer enquiry and confirm the original lead workflow receives it unchanged. Test Cloudinary upload in the listing form, and existing WhatsApp/Telegram links separately.
- [ ] At widths 375, 768 and 1440, open booking, inspect labels and scrolling, Tab/Shift+Tab containment, Escape close, close button and focus return. Background must be inert. Verify no horizontal overflow; check with screen reader.
- [ ] Blank public configuration must disable submission and show contact-agent guidance. Block Turnstile: no request may submit. Test expiry, rejected and reused tokens; fresh verification must be required after every attempt.
- [ ] Use the real allowed staging hostname/widget, active staging booking workflow and registered property. Verify request payload in DevTools: selected ID/title, buyer zone/date/time, true consent, fresh genuine token, correct optional numeric east-of-UTC offset and valid random idempotency key. Never log/copy tokens or buyer PII into tickets.
- [ ] Invalid email/WhatsApp/consent fails; invalid IANA zone, impossible date/DST gap, ambiguous DST time, mismatched offset and outside-hours/window requests show clear feedback. Test a disabled/unknown property ID and rate limit.
- [ ] Interrupt the response after intake. Retry identical details with fresh verification; same key/same booking must return. Edit date/time: new key. Exercise busy service/network/invalid JSON and duplicate response.
- [ ] An occupied slot returns `reschedule_requested`; show unavailable feedback and allow a new time. Pending status must never imply a confirmed viewing. Confirm no additional request on double click.
- [ ] Have an authorized agent approve the controlled booking. Verify correct buyer/Colombo times, private registry routing, one Calendar event and real Meet link. Verify notification delivery; complete management-link compatibility work before full-system launch.
- [ ] After approval to deploy, publish only the reviewed branch/artifacts using the existing Pages process. Test `https://mfds824.github.io/DwellHunt/`, relative assets, real Turnstile hostname/action and readable n8n responses on the actual origin. Repeat the existing lead/photo/auth/chat regression checks.

Additional preparation files: DH_Viewing_Properties.template-INACTIVE.csv, DH_Viewing_Properties.approved-import.csv, VIEWING-MISSING-CONFIGURATION.md, DEPLOYMENT-READINESS.md and tests/deployment-readiness.cjs. The inactive template is setup-only and the approved import is header-only until private routing is verified.

Rollback: revert the single bundle hook and three index references, or revert this integration branch's changes. Do not deactivate existing lead workflows. Resolve any outstanding viewing appointments before disabling new backend workers.
