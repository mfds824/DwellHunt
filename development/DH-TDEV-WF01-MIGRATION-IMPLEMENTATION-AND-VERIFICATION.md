# DH-TDEV-WF01 — Website Lead Enquiry Intake

**Date:** 6 November 2026 (Asia/Colombo)  
**Status:** **BLOCKED** for migration/cutover; isolated offline candidate implemented and verified  
**Final decision:** **NO-GO** for staging deployment, website switch, or n8n retirement  
**Scope:** Local candidate code and synthetic offline validation only. No external request, credential access, database execution, Trigger.dev Cloud access, deployment, or production change was performed.

## 1. Executive result

An isolated WF01 candidate was added beneath `development/triggerdev-migration/tdev-d1/`. It includes a strict framework-neutral intake handler for the existing fourteen-field payload, injected authorization/rate-limit/origin boundaries, an in-memory fixture repository, an injected Trigger.dev SDK v4 dispatcher/task factory, a PostgreSQL-compatible repository adapter, unexecuted candidate SQL, readiness helpers, and a cutover/rollback runbook. No dependency was installed or changed.

The offline test suite passes (**29 passed, 0 failed**) and the strict no-emit TypeScript check passes. These checks use local fakes and do not prove PostgreSQL concurrency behavior, Trigger.dev Cloud delivery, downstream parity, or production readiness.

The local audit says the website bundle posts to `https://wstmendis.app.n8n.cloud/webhook/dwellhunt-ai-leads-v2` using the fourteen fields listed below. The full live n8n graph and its response configuration were unavailable. Existing project audit metadata reports 12 inactive n8n workflow records; this count and status were not freshly verified remotely. The original lead workflow's current live active state is unknown. The safe operational finding is that the n8n integration has **not** been retired or changed and the website remains **Unchanged**.

**Cutover blockers:** no verified n8n graph/behavioral export; no approved downstream compatibility bridge or delivery receipts; no production host/authentication/anti-abuse/rate-limit binding; no approved durable database or executed schema; WF01 is outside configured Trigger.dev task discovery; no Trigger.dev Cloud connection or staging run; and no explicit switch/retirement authorization. Preserve the legacy route until these are resolved.

## 2. Legacy contract and dependency evidence

### Website request

The source-parity audit and current production bundle identify the legacy webhook above. The website payload is preserved exactly as fourteen string fields:

`customer_name`, `email`, `phone`, `enquiry_type`, `property`, `property_id`, `agency_id`, `location`, `budget`, `message`, `preferred_date`, `source`, `submittedAt`, `lead_id`.

`source` must be `DwellHunt Website`. The candidate validates the exact field set, types, bounds, timestamp, email, and client lead-ID format, and does not use client IDs as authorization. The prior local source audit records that the browser treats an HTTP-success response as successful and does not depend on a particular JSON response body. Candidate new intake responds 202 after lead/outbox persistence; an identical retry responds 200; a conflicting reuse responds 409. The website itself was not changed or pointed at this candidate.

### n8n workflow and downstream behavior

The endpoint identifies the website entry point only. No complete live workflow graph/export was available for verifying validation rules, response body/status details, dedupe behavior, Sheets mappings, Telegram delivery, follow-up scheduling, retry behavior, status updates, or other dependants. Local audit metadata reports 12 inactive workflow records but is not a current remote query and does not prove the exact live state of the lead workflow.

Google Sheets CRM, Telegram notifications, and follow-up/status processing remain existing downstream dependencies. This candidate does **not** call n8n, Sheets, Telegram, email, or any other downstream provider. `src/compatibility.ts` defines only an injected interface; it does not implement or configure a bridge. Forwarding to n8n is deliberately not treated as full migration. Without the graph and a verified receipt-capable compatibility adapter, downstream equivalence and duplicate-side-effect safety cannot be proven.

## 3. Architecture

**Current production path (preserved):**

```text
Website app.js → existing n8n lead webhook → unknown live n8n graph/dependencies
```

**Isolated candidate (not connected or deployed):**

```text
Future server POST /v1/leads
  → injected origin, authorization, and rate-limit checks
  → strict fourteen-field validation
  → atomic PostgreSQL lead + outbox transaction (adapter candidate only)
  → explicit outbox dispatcher → Trigger.dev v4 task (fake/injected SDK only)
  → injected downstream operation (not implemented; compatibility unverified)
```

The handler is not a server/listener. Required auth, rate limiting, database pool, Trigger client, task discovery, and downstream operation are injected; no production values are configured. The SDK task candidate takes an opaque server lead reference and schema version, not the PII payload. Task acceptance is stored separately from business processing acknowledgement.

## 4. Implementation and exact file inventory

### Existing TDEV-D1 files modified for WF01

- `development/triggerdev-migration/tdev-d1/src/contract.ts` — retry identity now uses trusted scope plus the client retry token; no fixed 15-minute rejection window. Fingerprint excludes `lead_id` and `submittedAt`, permitting ordinary browser retry metadata changes. A new lead token is a distinct enquiry. Same token with changed business content conflicts.
- `development/triggerdev-migration/tdev-d1/src/intake.ts` — uses the revised identity contract and keeps strict bounded request/response handling.
- `development/triggerdev-migration/tdev-d1/src/repository.ts` — explicit dispatch/processing lifecycle, receipts, unknown-outcome quarantine, reconciliation methods, retry limits, and process-local offline adapter.
- `development/triggerdev-migration/tdev-d1/src/dispatch.ts` — injected SDK adapter records Trigger run references; downstream completion requires an explicit acknowledged receipt. Unknown outcomes do not blindly retry.
- `development/triggerdev-migration/tdev-d1/src/task-candidate.ts` — requires an injected downstream processing operation and does not equate task acceptance with processing completion.
- `development/triggerdev-migration/tdev-d1/tests/tdev-d1.test.mjs` — updates retry/receipt/task semantics and checks preservation hashes.

### New files

- `development/triggerdev-migration/tdev-d1/src/postgres-repository.ts` — generic injected pool/connection adapter; parameterized SQL, transaction rollback, advisory identity lock, atomic lead/outbox insertion, transaction claims, attempt fencing, receipts, and unknown states. It includes no driver, environment lookup, URL, or database client.
- `development/triggerdev-migration/tdev-d1/src/compatibility.ts` — downstream processor interface and injected adapter boundary only; no provider implementation.
- `development/triggerdev-migration/tdev-d1/src/readiness.ts` — pure liveness/readiness response helpers. Readiness stays unavailable unless all listed runtime and migration gates are true.
- `development/triggerdev-migration/tdev-d1/database/001-wf01-lead-outbox.candidate.sql` — unexecuted, isolated candidate tables. Identity lookup is non-unique pending policy approval; outbox has one row per candidate lead.
- `development/triggerdev-migration/tdev-d1/deployment-rollback.md` — future prerequisites, controlled cutover sequence, and conservative rollback instructions.
- `development/triggerdev-migration/tdev-d1/tests/wf01-migration.test.mjs` — synthetic request, identity, unknown-outcome, lease-fencing, fake PostgreSQL, candidate SQL, readiness, and preservation tests.

`package.json`, lockfiles, `tsconfig.json`, root `trigger.config.ts`, and configured Trigger.dev tasks were not changed. No package was installed or upgraded.

### Protected files not modified

The production website and lead transport (`index.html`, `app.js`, styles, `photo-upload.js`), existing Cloudinary integration, existing webhook reference, source-app files and property/agency/agent data, GitHub Pages/deployment configuration, n8n files/workflows, Sheets/Telegram integration configuration, root Trigger.dev configuration/tasks, viewing/booking files, Supabase configuration/policies, and SQL/fixture files outside this candidate were left untouched. The existing booking-disabled state and all security gates remain as before. No change was made to booking endpoints/contracts, payments, auth, Calendar, or security approvals.

## 5. Behavior, storage, and idempotency decisions

- **Offline-only:** `InMemoryLeadRepository` serializes fixture operations and supports rollback simulation; it is not durable across restart.
- **PostgreSQL candidate:** lead and outbox insert in one transaction. The adapter serializes identity lookup with `pg_advisory_xact_lock` then checks the non-unique identity index. This depends on a single approved writer following the same locking protocol and a reviewed transaction-isolation configuration. Fake-PG tests do not establish behavior on a real server.
- **Idempotency:** prior 15-minute content-based dedupe was removed because it could suppress a legitimate separate enquiry. The candidate treats trusted-principal scope plus `lead_id` as a retry token and detects changed-content token reuse. The token is not authentication. This identity policy, its retention, and operational consequences require product/security approval before production schema or policy adoption. No unique identity constraint was added.
- **Dispatch:** bounded attempts, deterministic per-attempt key, SDK-returned run reference, and explicit retry after definitive rejection. Timeout, thrown calls, lost settlement, or expired leases enter `unknown`; a readback/reconciliation decision is required before retry.
- **Business completion:** Trigger acceptance does not mark the lead processed. A downstream acknowledgement and validated receipt are required. A crash/timeout during downstream work enters `processing_unknown`; only reconciliation can acknowledge or authorize a safe retry.
- **Reconciliation limitation:** repository reconciliation APIs exist, but no Trigger run lookup worker, database-backed scheduler, downstream receipt query, monitoring, or operator console was implemented.
- **Security boundary:** authorization, exact origin policy, host-derived abuse signals, and rate limiter are required injected interfaces. Missing bindings fail closed in the handler tests. No actual public-form auth/anti-abuse design, distributed limiter, host integration, or rate-limit storage is configured. CORS/origin checks alone do not establish identity.
- **Privacy:** logs omit payload PII; task payload contains an opaque reference. No production retention/encryption/key-management controls were configured or assessed against a real database.

## 6. Offline verification

Run from `development/triggerdev-migration/tdev-d1/`:

| Command | Actual result |
|---|---|
| `node --test tests/*.test.mjs` | **PASS** — 29 tests, 29 passed, 0 failed, 0 skipped; exit 0 |
| `node ../../source-app/node_modules/typescript/bin/tsc -p tsconfig.json` | **PASS** — strict no-emit TypeScript check; exit 0 |
| Build / lint | **Not run** — no candidate build/lint command is configured |
| Database migration or SQL | **Not run** — candidate SQL was read by a local test only; it was not submitted to a database |
| Trigger.dev CLI/Cloud | **Not run** — no account, secrets, task discovery, deployment, or network invocation |
| Root website test suites | **Not run** — outside this isolated offline verification scope |

The synthetic suite covers the exact fourteen-field contract and fixed source; malformed, oversized, missing, and extra fields; origin/auth/rate-limit fail-closed behavior; PII-safe logs; atomicity and rollback simulation; repeated versus distinct requests; concurrent fixture retries; bounded dispatch retry; accepted/rejected/unknown task outcomes; unknown dispatch readback; downstream acknowledgement; expired lease/stale worker fencing; injected SDK-shaped calls; fake PostgreSQL transactions and duplicate lookup; readiness gates; candidate SQL invariants; and protected hashes. No real PostgreSQL concurrent-session test or provider end-to-end test was run.

Earlier iterations exposed and corrected a Node strip-only import incompatibility, a TypeScript erasable-syntax incompatibility, and test-fixture assertion/path issues. The final commands above were rerun after those corrections and passed.

## 7. Protected baseline hash comparison

The focused preservation test recomputed all 27 accepted hashes listed below; **all matched**. This provides local evidence that these baseline files were not altered during this task.

| Protected file | Expected SHA-256 | Result |
|---|---|---|
| `index.html` | `96ec20e55887046b99f95989932eaec5bc2f1157f75732ec61369c369758dd36` | MATCH |
| `app.js` | `fca50e8e2e22e8652e32ceebceec097faaae2959bec06e0548e84d942d97aee6` | MATCH |
| `style.css` | `b113a59434d12e872939c25ff5a3f737592281aaf5a85e6b4022a68e26d1ac07` | MATCH |
| `website-modernization.css` | `f2bd7d1bb4dda752467d68c9f094bf980fcd1d1425162bbb8d9be057e061208a` | MATCH |
| `photo-upload.js` | `f9ab5c6a96d5fb10880275fdf1ad3b135965d7cd96b29e5393cb2e7ff05018b1` | MATCH |
| `supabase-config.js` | `a43abc886a24c554b878f5ad4bc15176d68db1625cd45c50721d11e2489af7bc` | MATCH |
| `development/WEBSITE-W002-A-IMPLEMENTATION-AND-VALIDATION-REPORT.md` | `493c568336f52dce1e92ac843f83e611ca60f8e3490d17bfd5c056fbd9243d47` | MATCH |
| `development/WEBSITE-W002-B-PRODUCTION-SOURCE-PARITY-ASSESSMENT.md` | `cdcbf416e1eab1c2c688108ee2b78e8a8fc7fdc88c9693b5fe64210bf717d086` | MATCH |
| `development/WEBSITE-W001-EXISTING-SITE-AUDIT-AND-MODERNIZATION-PLAN.md` | `97f5ca4e83dcf3638575dcdc42ee8f612e9e8f18bf76e656e8bd820ef4a94a42` | MATCH |
| `development/source-app/src/context/MarketplaceContext.tsx` | `590b2ebcf77f94a003cee18912b3891e0ac1428596a3d6160c049a42417fe059` | MATCH |
| `development/source-app/src/data/mockProperties.ts` | `7d0b36c42acaa1a8d51796e8359191da291373a3dfe21bae44ca6c806b5f3cb8` | MATCH |
| `development/source-app/src/data/mockAgencies.ts` | `5fd8684b7a442f52bbd4eb61d0d3a34d8d93fd3dba8209c85a657d46765db6f8` | MATCH |
| `development/source-app/src/data/mockAgents.ts` | `2e9af347109cbe85eaaa849dde4b04f425aece8f8e1d233b83db663d0c3b24b0` | MATCH |
| `development/source-app/package.json` | `e913d174473700b469ebba294b70cab3ba3a341373047cf5d23b5b9ddaf30316` | MATCH |
| `development/source-app/package-lock.json` | `ef550db6d801da500ca3e470b8811734e68be6a34bf395478f312582e4a4fd9a` | MATCH |
| `development/trigger.config.ts` | `7b2b3e11abeff366eeadd2cce697e37757f6f55e8a542badddfa60eb67636e87` | MATCH |
| `development/trigger/viewing.ts` | `428d73c9dca35eab79de80e7a0be9a68869796e6ba7fd6730f3848fc33d28e1b` | MATCH |
| `development/backend/triggerdev/jobs.ts` | `b3b815e5ea236897f3efc8145913d06ee713bccf3e9304b98953cd3ecbc65e35` | MATCH |
| `development/backend/triggerdev/boundary.ts` | `3db2827c540a7540d97a8e37d688a6ef58d8a1fca226a22e4fe0ebc45008e669` | MATCH |
| `development/backend/triggerdev/store.ts` | `d965df8d5b8b7d5b3b42f110b620bc8409be89c6b0b2d941f9d42393341a4ca7` | MATCH |
| `development/backend/triggerdev/service.ts` | `a4b761fd9b4cac0f46258d145cb67035d0e513d9fbc4a65f2bc42b315441b457` | MATCH |
| `development/viewing-config.js` | `3e00ed365141a282619b3e6ebe65ee31002452b519ef476151f476e4e4a77a55` | MATCH |
| `development/virtual-viewing.js` | `e578bd094a693a6a78e5f7b0a21a8aaa55ecce1fe565b277a0222fedf104608c` | MATCH |
| `development/virtual-viewing.css` | `246717173b927e55f3d142a206fa74f71c75d14b6bdad3cd47a2c190ad055077` | MATCH |
| `development/viewing-management.js` | `4b63524a3be957ebf9460b1c460be1686442bcc198ac59f6e6b429728775810e` | MATCH |
| `viewing-config.js` | `72e15e14b3dcc6ee4c262d5d17aabd6162e82c4841014c6719b791350abcb85b` | MATCH |
| `virtual-viewing.js` | `6e8b37901385d0c4feab46a836f0c685e91cde304d37fca858bf59aa6965cc94` | MATCH |
| `virtual-viewing.css` | `e74a8e3d149acd64d642495ac8e91cdcf5c449a2130f7b7158c0cfc82a774065` | MATCH |

## 8. Trigger.dev, database, and deployment readiness

- **Trigger.dev Cloud:** Not connected. No credentials were read, no CLI discovery/deployment was run, and no task was invoked remotely.
- **Task discovery:** root `development/trigger.config.ts` still declares `dirs: ['./trigger']`. WF01 candidate files are outside that directory and are not registered/discovered. Root config was protected and unchanged.
- **Database:** no database was connected. SQL is a candidate only. Schema review, identity policy approval, transaction-isolation validation, concurrency testing against PostgreSQL, backup/retention policy, PII controls, and separate permission to execute are still required. The SQL/fixtures gate remains NO-GO.
- **Website:** **Unchanged**; production source still uses n8n.
- **n8n:** **Not retired or modified.** Current remote active state was not independently verified; preserve it as operationally required until a read-only owner-approved check proves otherwise.
- **Security gates:** H4/H5 remain OPEN, SECURITY GATE CLOSED, SQL/FIXTURES NO-GO, and production booking disabled. No gate was changed.

## 9. Remaining blockers and next authorized sequence

1. Obtain a read-only, owner-approved export or inspection of the exact website lead workflow and all downstream graphs, response semantics, dedupe policy, retries, and dependencies; map each effect and receipt.
2. Approve the idempotency/token and retention policy and review SQL, PostgreSQL isolation/locking assumptions, least-privilege role, encryption, backup, and recovery design.
3. Define and review a public-form protection design (trusted origin, server-side abuse signals, distributed rate limits, optional challenge) suitable for a public website; configure an approved host without exposing credentials in the browser.
4. Implement one verified downstream compatibility bridge with durable receipts/idempotency that preserves Sheets, Telegram, follow-up, and status effects without sending duplicate effects. Do not dual-run the old graph and new senders without a dedupe plan.
5. Resolve Trigger.dev SDK/vendor/security gates, bind a dedicated staging project, register only the reviewed WF01 task, and verify task/run lookup and reconciliation in staging.
6. Separately authorize staging schema execution and synthetic end-to-end tests; prove concurrent identical/conflicting intake, failure recovery, no duplicate CRM rows/Telegram messages/follow-ups, monitoring, and rollback.
7. Obtain explicit production endpoint-switch authorization. Then monitor reversibly. Retire only the exact legacy lead workflow after separate explicit approval and proof no other active workflow depends on it.

No steps involving external systems were taken. The report and candidate files are the full local result; stop here pending explicit implementation/cutover authorization.

## 10. Deployment and rollback (prepared, not executed)

There is no deployment artifact, route, or secret configuration. A future deployment must use an approved isolated staging environment, private server-side database/Trigger credentials, reviewed host limits and auth/abuse controls, and WF01-only task registration. Do not point the public website at the candidate until all blockers above are closed and an explicit switch is authorized.

For a future authorized cutover, retain the existing n8n endpoint/workflow and record the current website route. Rollback should switch the server-side route back to the verified n8n path, stop new Trigger dispatch, preserve outbox and unknown records, and reconcile uncertain outcomes before any replay. Do not automatically repeat uncertain CRM/Telegram/follow-up side effects. No rollback action was executed.

## 11. Final decision

**NO-GO.** This is a passing offline implementation candidate, not a production migration. Downstream equivalence, durable operation on PostgreSQL, Trigger.dev Cloud operation, and live n8n status are unverified. The website remains on its current n8n integration; do not retire that workflow.
