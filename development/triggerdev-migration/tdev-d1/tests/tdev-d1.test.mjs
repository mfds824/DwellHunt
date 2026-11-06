import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { LEAD_FIELDS, LEAD_TASK_ID, MAX_BODY_BYTES, validateLeadPayload } from '../src/contract.ts';
import { createLeadIntakeHandler, LEAD_INTAKE_PATH } from '../src/intake.ts';
import { InMemoryLeadRepository } from '../src/repository.ts';
import { dispatchOutboxItem, FakeLeadTaskDispatcher, createTriggerDevLeadDispatcher, runLeadProcessing } from '../src/dispatch.ts';
import { createLeadProcessingTaskCandidate } from '../src/task-candidate.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
let sequence = 0;
const nextId = () => (++sequence).toString(16).padStart(32, '0');
const payload = (overrides = {}) => ({
  customer_name: ' Buyer Name ', email: 'buyer@example.test', phone: '+94771234567', enquiry_type: 'general',
  property: 'Synthetic Colombo Apartment', property_id: 'prop-synthetic-001', agency_id: 'agency-synthetic-001',
  location: 'Colombo', budget: '', message: 'Please contact me.', preferred_date: '', source: 'DwellHunt Website',
  submittedAt: '2026-11-06T12:30:00.000Z', lead_id: 'enq-1793971800000', ...overrides,
});
const bindings = (extra = {}) => ({
  repository: new InMemoryLeadRepository(), allowedOrigins: ['https://frontend.example.test'],
  authorize: async () => ({ scopeId: 'synthetic-authorized-client' }), rateLimit: async () => true,
  now: () => 1_794_000_000_000, makeLeadId: nextId, ...extra,
});
const request = (body = payload(), options = {}) => new Request(`https://intake.example.test${options.path ?? LEAD_INTAKE_PATH}`, {
  method: options.method ?? 'POST', headers: { origin: 'https://frontend.example.test', 'content-type': options.contentType ?? 'application/json', ...(options.headers ?? {}) },
  ...(options.noBody ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
async function submit(handler, body = payload(), options = {}) {
  const response = await handler(request(body, options));
  return { response, data: response.status === 204 ? null : await response.json() };
}

test('contract: exact fourteen fields, source literal and original wire values survive unchanged', () => {
  const original = payload({ email: 'Buyer.Mixed@Example.Test' });
  const validated = validateLeadPayload(original);
  assert.deepEqual(LEAD_FIELDS, ['customer_name','email','phone','enquiry_type','property','property_id','agency_id','location','budget','message','preferred_date','source','submittedAt','lead_id']);
  assert.equal(Object.keys(validated).length, 14);
  for (const key of LEAD_FIELDS) assert.equal(validated[key], original[key]);
  assert.equal(validated.customer_name, ' Buyer Name ');
  assert.equal(validated.email, 'Buyer.Mixed@Example.Test');
  assert.equal(validated.source, 'DwellHunt Website');
});

test('contract rejects missing, extra, mistyped, malformed identifier, timestamp, email and oversized string values', () => {
  const { lead_id, ...missing } = payload();
  assert.throws(() => validateLeadPayload(missing), /INVALID_PAYLOAD/);
  assert.throws(() => validateLeadPayload(payload({ extra: 'not permitted' })), /INVALID_PAYLOAD/);
  assert.throws(() => validateLeadPayload(payload({ phone: 9477 })), /INVALID_PAYLOAD/);
  assert.throws(() => validateLeadPayload(payload({ lead_id: 'client-owned' })), /INVALID_PAYLOAD/);
  assert.throws(() => validateLeadPayload(payload({ submittedAt: 'not-a-time' })), /INVALID_PAYLOAD/);
  assert.throws(() => validateLeadPayload(payload({ email: 'bad email' })), /INVALID_PAYLOAD/);
  assert.throws(() => validateLeadPayload(payload({ message: 'x'.repeat(3001) })), /INVALID_PAYLOAD/);
  const accessor = payload();
  Object.defineProperty(accessor, 'email', { enumerable: true, get() { throw new Error('must not evaluate'); } });
  assert.throws(() => validateLeadPayload(accessor), /INVALID_PAYLOAD/);
});

test('HTTP rejects invalid method, route, query, JSON media type, malformed JSON, invalid UTF-8 and oversized body', async () => {
  const handler = createLeadIntakeHandler(bindings());
  assert.equal((await submit(handler, undefined, { method: 'GET', noBody: true })).response.status, 405);
  assert.equal((await submit(handler, payload(), { path: '/v1/other' })).response.status, 404);
  assert.equal((await submit(handler, payload(), { path: `${LEAD_INTAKE_PATH}?x=1` })).response.status, 404);
  assert.equal((await submit(handler, payload(), { contentType: 'text/plain' })).response.status, 415);
  assert.equal((await submit(handler, '{')).response.status, 400);
  const invalidUtf8 = new Request(`https://intake.example.test${LEAD_INTAKE_PATH}`, { method: 'POST', headers: { origin: 'https://frontend.example.test', 'content-type': 'application/json' }, body: new Uint8Array([0xff]) });
  assert.equal((await handler(invalidUtf8)).status, 400);
  assert.equal((await submit(handler, 'x'.repeat(MAX_BODY_BYTES + 1))).response.status, 413);
});

test('CORS is origin-scoped, preflight is bodyless, and CORS alone does not authorize intake', async () => {
  let authCalls = 0;
  const handler = createLeadIntakeHandler(bindings({ authorize: async () => { authCalls++; return null; } }));
  const preflight = await handler(new Request(`https://intake.example.test${LEAD_INTAKE_PATH}`, { method: 'OPTIONS', headers: { origin: 'https://frontend.example.test' } }));
  assert.equal(preflight.status, 204);
  assert.equal(await preflight.text(), '');
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://frontend.example.test');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  assert.equal((await submit(handler)).response.status, 401);
  assert.equal(authCalls, 1);
  const denied = await handler(new Request(`https://intake.example.test${LEAD_INTAKE_PATH}`, { method: 'POST', headers: { origin: 'https://attacker.example.test', 'content-type': 'application/json' }, body: JSON.stringify(payload()) }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal(authCalls, 1);
});

test('missing auth, abuse control, origin or repository bindings fail closed', async () => {
  for (const partial of [
    { authorize: undefined }, { rateLimit: undefined }, { repository: undefined }, { allowedOrigins: undefined },
  ]) {
    const handler = createLeadIntakeHandler(bindings(partial));
    assert.equal((await submit(handler)).response.status, 503);
  }
  const noAuth = createLeadIntakeHandler(bindings({ authorize: async () => { throw new Error('private auth detail'); } }));
  const denied = await submit(noAuth);
  assert.equal(denied.response.status, 401);
  assert.equal(JSON.stringify(denied.data).includes('private auth detail'), false);
});

test('rate limit rejects without persistence; untrusted agency/property IDs remain inert payload values', async () => {
  const repository = new InMemoryLeadRepository();
  const handler = createLeadIntakeHandler(bindings({ repository, rateLimit: async () => false }));
  assert.equal((await submit(handler)).response.status, 429);
  assert.equal((await repository.snapshotForTest()).leads.length, 0);
  const openInputRepository = new InMemoryLeadRepository();
  const openInput = createLeadIntakeHandler(bindings({ repository: openInputRepository }));
  const result = await submit(openInput, payload({ property_id: 'client-claimed-property', agency_id: 'client-claimed-agency' }));
  assert.equal(result.response.status, 202);
  const stored = (await openInputRepository.snapshotForTest()).leads[0];
  assert.equal(stored.payload.property_id, 'client-claimed-property');
  assert.equal(stored.payload.agency_id, 'client-claimed-agency');
  assert.notEqual(stored.id, stored.payload.lead_id);
});

test('logs contain only safe correlation and event fields, never payload PII', async () => {
  const events = [];
  const handler = createLeadIntakeHandler(bindings({ logger: { event: (code, fields) => events.push({ code, fields }) } }));
  assert.equal((await submit(handler)).response.status, 202);
  const text = JSON.stringify(events);
  for (const secret of ['Buyer Name', 'buyer@example.test', '+94771234567', 'Please contact me.']) assert.equal(text.includes(secret), false);
  assert.equal(events[0].code, 'lead_committed');
  assert.deepEqual(Object.keys(events[0].fields).sort(), ['correlationId']);
});

test('lead and outbox commit atomically before 202 acknowledgement; failure leaves no row', async () => {
  const repository = new InMemoryLeadRepository(); repository.failNextCommit = true;
  const handler = createLeadIntakeHandler(bindings({ repository }));
  const failed = await submit(handler);
  assert.equal(failed.response.status, 503);
  assert.deepEqual(failed.data, { ok: false, code: 'PERSISTENCE_UNAVAILABLE', correlation_id: failed.data.correlation_id });
  assert.deepEqual(await repository.snapshotForTest(), { leads: [], outbox: [] });
  const accepted = await submit(handler);
  assert.equal(accepted.response.status, 202);
  assert.equal(accepted.data.dispatch_status, 'pending');
  const snapshot = await repository.snapshotForTest();
  assert.equal(snapshot.leads.length, 1);
  assert.equal(snapshot.outbox.length, 1);
  assert.equal(snapshot.outbox[0].leadId, snapshot.leads[0].id);
});

test('server-derived idempotency scopes the client retry token to auth; timestamp changes do not alter retry identity', async () => {
  const repository = new InMemoryLeadRepository();
  const handler = createLeadIntakeHandler(bindings({ repository }));
  const first = await submit(handler);
  const retry = await submit(handler, payload({ submittedAt: '2026-11-06T12:31:00.000Z' }));
  assert.equal(first.response.status, 202);
  assert.equal(retry.response.status, 200);
  assert.equal(first.data.lead_ref, retry.data.lead_ref);
  assert.equal(retry.data.status, 'duplicate');
  const state = await repository.snapshotForTest();
  assert.equal(state.leads.length, 1);
  assert.equal(state.outbox.length, 1);
});

test('same scoped client retry token with changed business content conflicts; a new lead ID stays distinct', async () => {
  const repository = new InMemoryLeadRepository();
  const handler = createLeadIntakeHandler(bindings({ repository }));
  assert.equal((await submit(handler)).response.status, 202);
  const conflict = await submit(handler, payload({ message: 'Different request content' }));
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.data.code, 'IDEMPOTENCY_CONFLICT');
  const distinct = await submit(handler, payload({ lead_id: 'enq-1793971800999' }));
  assert.equal(distinct.response.status, 202);
  assert.equal((await repository.snapshotForTest()).leads.length, 2);
});

test('concurrent same-token retries create one lead/outbox; an independently generated lead ID is accepted immediately', async () => {
  const repository = new InMemoryLeadRepository();
  const handler = createLeadIntakeHandler(bindings({ repository }));
  const responses = await Promise.all(Array.from({ length: 12 }, () => submit(handler)));
  assert.equal(responses.filter((item) => item.response.status === 202).length, 1);
  assert.equal((await repository.snapshotForTest()).leads.length, 1);
  assert.equal((await submit(handler, payload({ lead_id: 'enq-1793971800999' }))).response.status, 202);
  assert.equal((await repository.snapshotForTest()).leads.length, 2);
});

test('simulated process stop after commit leaves recoverable pending outbox and acknowledgement is not downstream delivery', async () => {
  const repository = new InMemoryLeadRepository();
  const handler = createLeadIntakeHandler(bindings({ repository }));
  const accepted = await submit(handler);
  assert.equal(accepted.response.status, 202);
  assert.equal(accepted.data.dispatch_status, 'pending');
  assert.equal((await repository.listRecoverableOutbox(1_794_000_000_000)).length, 1);
  assert.equal((await repository.getLead(accepted.data.lead_ref)).status, 'dispatch_pending');
});

test('fake Trigger.dev dispatch uses the fixed task ID and opaque payload, records acceptance separately from processing', async () => {
  const repository = new InMemoryLeadRepository();
  const handler = createLeadIntakeHandler(bindings({ repository }));
  const accepted = await submit(handler);
  const dispatcher = new FakeLeadTaskDispatcher();
  const result = await dispatchOutboxItem({ repository, dispatcher, outboxId: `lead-dispatch:${accepted.data.lead_ref}`, now: () => 1_794_000_000_000, makeAttemptId: () => 'attempt-test-1' });
  assert.equal(result.kind, 'accepted');
  assert.equal(dispatcher.calls.length, 1);
  assert.equal(dispatcher.calls[0].taskId, LEAD_TASK_ID);
  assert.deepEqual(dispatcher.calls[0].reference, { leadId: accepted.data.lead_ref, schemaVersion: 1 });
  assert.equal(JSON.stringify(dispatcher.calls).includes('buyer@example.test'), false);
  const lead = await repository.getLead(accepted.data.lead_ref);
  assert.equal(lead.status, 'dispatch_accepted');
  assert.equal((await runLeadProcessing({ reference: dispatcher.calls[0].reference, repository, operation: async () => ({ kind: 'accepted', receiptRef: 'fake-downstream-receipt' }) })).kind, 'downstream_acknowledged');
  assert.equal((await repository.getLead(accepted.data.lead_ref)).status, 'downstream_acknowledged');
});

test('known rejection is recoverable with explicit bounded retry; no uncontrolled automatic retry', async () => {
  const repository = new InMemoryLeadRepository();
  const handler = createLeadIntakeHandler(bindings({ repository }));
  const accepted = await submit(handler);
  const dispatcher = new FakeLeadTaskDispatcher(); dispatcher.outcomes = [{ kind: 'rejected', code: 'TASK_REJECTED' }, { kind: 'accepted', receiptRef: 'fake-run-retry' }];
  const outboxId = `lead-dispatch:${accepted.data.lead_ref}`;
  assert.equal((await dispatchOutboxItem({ repository, dispatcher, outboxId, now: () => 1000, makeAttemptId: () => 'attempt-r1', retryDelayMs: 5000 })).kind, 'rejected');
  assert.equal(dispatcher.calls.length, 1);
  assert.equal((await repository.listRecoverableOutbox(5999)).length, 0);
  assert.equal((await dispatchOutboxItem({ repository, dispatcher, outboxId, now: () => 5999, makeAttemptId: () => 'attempt-too-early' })).kind, 'not_ready');
  assert.equal(dispatcher.calls.length, 1);
  assert.equal((await dispatchOutboxItem({ repository, dispatcher, outboxId, now: () => 6000, makeAttemptId: () => 'attempt-r2' })).kind, 'accepted');
  assert.equal(dispatcher.calls.length, 2);
});

test('timeout/throw becomes unknown and is never blindly redispatched', async () => {
  const repository = new InMemoryLeadRepository();
  const handler = createLeadIntakeHandler(bindings({ repository }));
  const accepted = await submit(handler);
  const outboxId = `lead-dispatch:${accepted.data.lead_ref}`;
  const result = await dispatchOutboxItem({ repository, dispatcher: { dispatch: async () => { throw new Error('private remote detail'); } }, outboxId, now: () => 1000, makeAttemptId: () => 'attempt-u1' });
  assert.equal(result.kind, 'unknown');
  assert.equal((await repository.getLead(accepted.data.lead_ref)).status, 'dispatch_unknown');
  assert.equal((await repository.listRecoverableOutbox(100_000)).length, 0);
  assert.equal((await dispatchOutboxItem({ repository, dispatcher: new FakeLeadTaskDispatcher(), outboxId, now: () => 100_000 })).kind, 'unknown');
});

test('expired dispatch lease is quarantined as unknown, not retried', async () => {
  const repository = new InMemoryLeadRepository();
  const handler = createLeadIntakeHandler(bindings({ repository }));
  const accepted = await submit(handler);
  const outboxId = `lead-dispatch:${accepted.data.lead_ref}`;
  const claim = await repository.claimDispatch(outboxId, 'crashed-attempt', 1000, 1000, 3);
  assert.equal(claim.kind, 'claimed');
  assert.equal(await repository.expireDispatchLeases(2001), 1);
  assert.equal((await repository.getLead(accepted.data.lead_ref)).status, 'dispatch_unknown');
  assert.equal((await repository.listRecoverableOutbox(3000)).length, 0);
});

test('injected SDK adapter uses official SDK-compatible tasks.trigger API without default client or network', async () => {
  const calls = [];
  const adapter = createTriggerDevLeadDispatcher({ trigger: async (...args) => { calls.push(args); return { id: 'synthetic-run-id' }; } });
  const outcome = await adapter.dispatch({ leadId: `lead_${'b'.repeat(32)}`, schemaVersion: 1 }, 'lead-dispatch-correlation:synthetic');
  assert.deepEqual(outcome, { kind: 'accepted', receiptRef: 'trigger-run:synthetic-run-id' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], LEAD_TASK_ID);
  assert.deepEqual(calls[0][1], { leadId: `lead_${'b'.repeat(32)}`, schemaVersion: 1 });
  assert.deepEqual(calls[0][2], { idempotencyKey: 'lead-dispatch-correlation:synthetic', idempotencyKeyTTL: '24h', maxAttempts: 1 });
  const uncertain = createTriggerDevLeadDispatcher({ trigger: async () => { throw new Error('remote outcome unknown'); } });
  assert.deepEqual(await uncertain.dispatch({ leadId: `lead_${'c'.repeat(32)}`, schemaVersion: 1 }, 'correlation'), { kind: 'unknown', code: 'TRIGGER_OUTCOME_UNKNOWN' });
  const hanging = createTriggerDevLeadDispatcher({ trigger: async () => new Promise(() => undefined) }, 5);
  assert.deepEqual(await hanging.dispatch({ leadId: `lead_${'d'.repeat(32)}`, schemaVersion: 1 }, 'correlation-timeout'), { kind: 'unknown', code: 'TRIGGER_TIMEOUT_OUTCOME_UNKNOWN' });
});

test('SDK task candidate requires downstream acknowledgement and retries only after definitive retryable rejection', async () => {
  const repository = new InMemoryLeadRepository();
  const handler = createLeadIntakeHandler(bindings({ repository }));
  await submit(handler);
  const accepted = (await repository.snapshotForTest()).leads[0];
  await repository.claimDispatch(`lead-dispatch:${accepted.id}`, 'task-prepare', 1_794_000_000_000, 1000, 3);
  await repository.recordDispatch(`lead-dispatch:${accepted.id}`, 'task-prepare', { kind: 'accepted', receiptRef: 'synthetic-trigger-run' }, 1_794_000_000_000, 1000);
  const downstream = async () => ({ kind: 'accepted', receiptRef: 'synthetic-downstream-receipt' });
  const task = createLeadProcessingTaskCandidate(repository, downstream);
  assert.equal(task.id, LEAD_TASK_ID);
  assert.equal((await runLeadProcessing({ reference: { leadId: accepted.id, schemaVersion: 1 }, repository, operation: downstream })).kind, 'downstream_acknowledged');
  assert.equal((await runLeadProcessing({ reference: { leadId: accepted.id, schemaVersion: 1 }, repository, operation: downstream })).kind, 'already_processed');
  const againRepo = new InMemoryLeadRepository();
  assert.equal((await submit(createLeadIntakeHandler(bindings({ repository: againRepo })))).response.status, 202);
  const again = (await againRepo.snapshotForTest()).leads[0];
  await againRepo.claimDispatch(`lead-dispatch:${again.id}`, 'task-prepare-2', 1_794_000_000_000, 1000, 3);
  await againRepo.recordDispatch(`lead-dispatch:${again.id}`, 'task-prepare-2', { kind: 'accepted', receiptRef: 'synthetic-trigger-run-2' }, 1_794_000_000_000, 1000);
  assert.equal((await runLeadProcessing({ reference: { leadId: again.id, schemaVersion: 1 }, repository: againRepo, operation: async () => ({ kind: 'rejected', code: 'TEMPORARY', retryable: true }), now: () => 1000, retryDelayMs: 2000 })).kind, 'retry');
  assert.equal((await runLeadProcessing({ reference: { leadId: again.id, schemaVersion: 1 }, repository: againRepo, operation: downstream, now: () => 2999 })).kind, 'not_ready');
  assert.equal((await runLeadProcessing({ reference: { leadId: again.id, schemaVersion: 1 }, repository: againRepo, operation: downstream, now: () => 3000 })).kind, 'downstream_acknowledged');
});

test('preservation: accepted production, W002-A, source-data, workflow and Trigger.dev baseline files retain exact hashes', async () => {
  const expected = {
    'index.html': '96ec20e55887046b99f95989932eaec5bc2f1157f75732ec61369c369758dd36',
    'website-modernization.css': 'f2bd7d1bb4dda752467d68c9f094bf980fcd1d1425162bbb8d9be057e061208a',
    'app.js': 'fca50e8e2e22e8652e32ceebceec097faaae2959bec06e0548e84d942d97aee6',
    'style.css': 'b113a59434d12e872939c25ff5a3f737592281aaf5a85e6b4022a68e26d1ac07',
    'photo-upload.js': 'f9ab5c6a96d5fb10880275fdf1ad3b135965d7cd96b29e5393cb2e7ff05018b1',
    'supabase-config.js': 'a43abc886a24c554b878f5ad4bc15176d68db1625cd45c50721d11e2489af7bc',
    'development/WEBSITE-W002-A-IMPLEMENTATION-AND-VALIDATION-REPORT.md': '493c568336f52dce1e92ac843f83e611ca60f8e3490d17bfd5c056fbd9243d47',
    'development/WEBSITE-W002-B-PRODUCTION-SOURCE-PARITY-ASSESSMENT.md': 'cdcbf416e1eab1c2c688108ee2b78e8a8fc7fdc88c9693b5fe64210bf717d086',
    'development/WEBSITE-W001-EXISTING-SITE-AUDIT-AND-MODERNIZATION-PLAN.md': '97f5ca4e83dcf3638575dcdc42ee8f612e9e8f18bf76e656e8bd820ef4a94a42',
    'development/source-app/src/context/MarketplaceContext.tsx': '590b2ebcf77f94a003cee18912b3891e0ac1428596a3d6160c049a42417fe059',
    'development/source-app/src/data/mockProperties.ts': '7d0b36c42acaa1a8d51796e8359191da291373a3dfe21bae44ca6c806b5f3cb8',
    'development/source-app/src/data/mockAgencies.ts': '5fd8684b7a442f52bbd4eb61d0d3a34d8d93fd3dba8209c85a657d46765db6f8',
    'development/source-app/src/data/mockAgents.ts': '2e9af347109cbe85eaaa849dde4b04f425aece8f8e1d233b83db663d0c3b24b0',
    'development/source-app/package.json': 'e913d174473700b469ebba294b70cab3ba3a341373047cf5d23b5b9ddaf30316',
    'development/source-app/package-lock.json': 'ef550db6d801da500ca3e470b8811734e68be6a34bf395478f312582e4a4fd9a',
    'development/trigger.config.ts': '7b2b3e11abeff366eeadd2cce697e37757f6f55e8a542badddfa60eb67636e87',
    'development/trigger/viewing.ts': '428d73c9dca35eab79de80e7a0be9a68869796e6ba7fd6730f3848fc33d28e1b',
    'development/backend/triggerdev/jobs.ts': 'b3b815e5ea236897f3efc8145913d06ee713bccf3e9304b98953cd3ecbc65e35',
    'development/backend/triggerdev/boundary.ts': '3db2827c540a7540d97a8e37d688a6ef58d8a1fca226a22e4fe0ebc45008e669',
    'development/backend/triggerdev/store.ts': 'd965df8d5b8b7d5b3b42f110b620bc8409be89c6b0b2d941f9d42393341a4ca7',
    'development/backend/triggerdev/service.ts': 'a4b761fd9b4cac0f46258d145cb67035d0e513d9fbc4a65f2bc42b315441b457',
    'development/viewing-config.js': '3e00ed365141a282619b3e6ebe65ee31002452b519ef476151f476e4e4a77a55',
    'development/virtual-viewing.js': 'e578bd094a693a6a78e5f7b0a21a8aaa55ecce1fe565b277a0222fedf104608c',
    'development/virtual-viewing.css': '246717173b927e55f3d142a206fa74f71c75d14b6bdad3cd47a2c190ad055077',
    'development/viewing-management.js': '4b63524a3be957ebf9460b1c460be1686442bcc198ac59f6e6b429728775810e',
    'viewing-config.js': '72e15e14b3dcc6ee4c262d5d17aabd6162e82c4841014c6719b791350abcb85b',
    'virtual-viewing.js': '6e8b37901385d0c4feab46a836f0c685e91cde304d37fca858bf59aa6965cc94',
    'virtual-viewing.css': 'e74a8e3d149acd64d642495ac8e91cdcf5c449a2130f7b7158c0cfc82a774065',
  };
  const mismatches = [];
  for (const [relative, hash] of Object.entries(expected)) {
    const content = await readFile(path.join(projectRoot, relative));
    const actual = createHash('sha256').update(content).digest('hex');
    if (actual !== hash) mismatches.push(`${relative}:${actual}`);
  }
  assert.deepEqual(mismatches, []);
});
