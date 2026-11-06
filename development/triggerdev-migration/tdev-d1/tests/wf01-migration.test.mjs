import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { leadFingerprint, leadIdentityKey } from '../src/contract.ts';
import { createLeadIntakeHandler } from '../src/intake.ts';
import { InMemoryLeadRepository } from '../src/repository.ts';
import { dispatchOutboxItem, FakeLeadTaskDispatcher, runLeadProcessing } from '../src/dispatch.ts';
import { PostgresLeadRepository } from '../src/postgres-repository.ts';
import { livenessResponse, readinessResponse } from '../src/readiness.ts';

const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootProject = path.resolve(candidateRoot, '../../..');
const fixedNow = 1_794_000_000_000;
const payload = (overrides = {}) => ({
  customer_name: 'Synthetic Buyer', email: 'buyer@example.test', phone: '', enquiry_type: 'general',
  property: '', property_id: '', agency_id: '', location: '', budget: '', message: 'Synthetic enquiry',
  preferred_date: '', source: 'DwellHunt Website', submittedAt: '2026-11-06T12:30:00.000Z', lead_id: 'enq-1793971800000', ...overrides,
});
let counter = 200;
const nextId = () => (++counter).toString(16).padStart(32, '0');
function fakeBindings(repository = new InMemoryLeadRepository()) {
  return { repository, allowedOrigins: ['https://frontend.example.test'], authorize: async () => ({ scopeId: 'fixture-scope' }),
    rateLimit: async () => true, now: () => fixedNow, makeLeadId: nextId };
}
async function ingest(repository = new InMemoryLeadRepository(), input = payload()) {
  const response = await createLeadIntakeHandler(fakeBindings(repository))(new Request('https://api.example.test/v1/leads', {
    method: 'POST', headers: { origin: 'https://frontend.example.test', 'content-type': 'application/json' }, body: JSON.stringify(input),
  }));
  return { response, data: await response.json(), repository };
}

test('WF01 retry identity uses trusted scope plus client token; new website lead IDs preserve distinct requests', async () => {
  const a = payload();
  assert.equal(leadIdentityKey(a, 'scope-a'), leadIdentityKey({ ...a, submittedAt: '2026-11-06T12:31:00.000Z' }, 'scope-a'));
  assert.notEqual(leadIdentityKey(a, 'scope-a'), leadIdentityKey(a, 'scope-b'));
  assert.notEqual(leadIdentityKey(a, 'scope-a'), leadIdentityKey({ ...a, lead_id: 'enq-1793971800999' }, 'scope-a'));
  assert.notEqual(leadFingerprint(a), leadFingerprint({ ...a, message: 'A separate enquiry' }));
  const repository = new InMemoryLeadRepository();
  const first = await ingest(repository);
  const second = await ingest(repository, payload({ lead_id: 'enq-1793971800999' }));
  assert.equal(first.response.status, 202);
  assert.equal(second.response.status, 202);
  assert.equal((await repository.snapshotForTest()).leads.length, 2);
});

test('unknown Trigger.dev dispatch requires readback reconciliation before another dispatch', async () => {
  const { data, repository } = await ingest();
  const outboxId = `lead-dispatch:${data.lead_ref}`;
  let calls = 0;
  const unknown = await dispatchOutboxItem({ repository, outboxId, now: () => fixedNow, dispatcher: { dispatch: async () => { calls++; return { kind: 'unknown', code: 'TIMEOUT_UNKNOWN' }; } } });
  assert.equal(unknown.kind, 'unknown');
  assert.equal((await repository.listRecoverableOutbox(fixedNow + 60_000)).length, 0);
  assert.equal(await repository.reconcileUnknownDispatch(outboxId, { kind: 'unknown', code: 'STILL_UNKNOWN' }, fixedNow, 1_000), true);
  assert.equal(await repository.reconcileUnknownDispatch(outboxId, { kind: 'accepted', receiptRef: 'readback-run-1' }, fixedNow, 1_000), true);
  assert.equal((await repository.getLead(data.lead_ref)).status, 'dispatch_accepted');
  assert.equal((await dispatchOutboxItem({ repository, outboxId, now: () => fixedNow + 100_000, dispatcher: { dispatch: async () => { calls++; return { kind: 'accepted', receiptRef: 'duplicate' }; } } })).kind, 'not_ready');
  assert.equal(calls, 1);
});

test('definitive negative dispatch readback permits bounded, delayed retry only', async () => {
  const { data, repository } = await ingest();
  const outboxId = `lead-dispatch:${data.lead_ref}`;
  const failed = await dispatchOutboxItem({ repository, outboxId, now: () => 100, dispatcher: { dispatch: async () => ({ kind: 'unknown', code: 'TIMEOUT_UNKNOWN' }) } });
  assert.equal(failed.kind, 'unknown');
  assert.equal(await repository.reconcileUnknownDispatch(outboxId, { kind: 'rejected', code: 'READBACK_NOT_FOUND' }, 100, 500), true);
  const fake = new FakeLeadTaskDispatcher();
  assert.equal((await dispatchOutboxItem({ repository, outboxId, now: () => 599, dispatcher: fake })).kind, 'not_ready');
  assert.equal(fake.calls.length, 0);
  assert.equal((await dispatchOutboxItem({ repository, outboxId, now: () => 600, dispatcher: fake })).kind, 'accepted');
  assert.equal(fake.calls.length, 1);
});

test('downstream thrown outcome is quarantined and only readback can acknowledge without replay', async () => {
  const { data, repository } = await ingest();
  const outboxId = `lead-dispatch:${data.lead_ref}`;
  await dispatchOutboxItem({ repository, outboxId, now: () => fixedNow, dispatcher: new FakeLeadTaskDispatcher() });
  let sends = 0;
  const reference = { leadId: data.lead_ref, schemaVersion: 1 };
  assert.equal((await runLeadProcessing({ reference, repository, operation: async () => { sends++; throw new Error('ambiguous downstream timeout'); }, now: () => fixedNow })).kind, 'unknown');
  assert.equal((await repository.getLead(data.lead_ref)).status, 'processing_unknown');
  assert.equal(await repository.reconcileUnknownProcessing(data.lead_ref, { kind: 'accepted', receiptRef: 'legacy-readback-123' }, fixedNow, 1000), true);
  assert.equal((await repository.getLead(data.lead_ref)).status, 'downstream_acknowledged');
  assert.equal((await runLeadProcessing({ reference, repository, operation: async () => { sends++; return { kind: 'accepted', receiptRef: 'would-be-duplicate' }; }, now: () => fixedNow + 1 })).kind, 'already_processed');
  assert.equal(sends, 1);
});

test('expired processing lease fences stale worker and moves to unknown instead of retrying downstream', async () => {
  const { data, repository } = await ingest();
  await dispatchOutboxItem({ repository, outboxId: `lead-dispatch:${data.lead_ref}`, now: () => 100, dispatcher: new FakeLeadTaskDispatcher() });
  let finish;
  const stalled = runLeadProcessing({ reference: { leadId: data.lead_ref, schemaVersion: 1 }, repository, now: () => 100, leaseMs: 10,
    operation: () => new Promise((resolve) => { finish = resolve; }) });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await runLeadProcessing({ reference: { leadId: data.lead_ref, schemaVersion: 1 }, repository, now: () => 111,
    operation: async () => ({ kind: 'accepted', receiptRef: 'must-not-run' }) });
  assert.equal(second.kind, 'not_ready');
  assert.equal((await repository.getLead(data.lead_ref)).status, 'processing_unknown');
  finish({ kind: 'accepted', receiptRef: 'stale-worker' });
  assert.equal((await stalled).kind, 'unknown');
  assert.equal((await repository.getLead(data.lead_ref)).status, 'processing_unknown');
});

class RecordingPgPool {
  statements = [];
  failOutboxInsert = false;
  existingLead;
  existingOutbox;
  released = 0;
  async connect() {
    return {
      query: async (text, values = []) => {
        this.statements.push({ text, values });
        if (this.failOutboxInsert && text.includes('INSERT INTO dh_tdev_d1_outbox_candidate')) throw new Error('SYNTHETIC_OUTBOX_INSERT_FAILURE');
        if (text.includes('SELECT * FROM dh_tdev_d1_lead_candidate WHERE identity_key')) return { rows: this.existingLead ? [this.existingLead] : [] };
        if (text.includes('SELECT * FROM dh_tdev_d1_outbox_candidate WHERE lead_id')) return { rows: this.existingOutbox ? [this.existingOutbox] : [] };
        return { rows: [] };
      },
      release: () => { this.released++; },
    };
  }
}

test('PostgreSQL-compatible repository commits receipt and outbox in one parameterized transaction', async () => {
  const pool = new RecordingPgPool();
  const repository = new PostgresLeadRepository(pool);
  const input = payload({ customer_name: "Synthetic'); SELECT pg_sleep(999); --" });
  const result = await repository.acceptLead({ leadId: `lead_${'e'.repeat(32)}`, payload: input,
    identityKey: 'a'.repeat(64), fingerprint: 'b'.repeat(64), now: fixedNow });
  assert.equal(result.kind, 'accepted');
  const sql = pool.statements.map((item) => item.text);
  assert.equal(sql[0], 'BEGIN');
  assert(sql.findIndex((text) => text.includes('pg_advisory_xact_lock')) < sql.findIndex((text) => text.includes('WHERE identity_key=$1')));
  assert(sql.some((text) => text.includes('INSERT INTO dh_tdev_d1_lead_candidate')));
  assert(sql.some((text) => text.includes('INSERT INTO dh_tdev_d1_outbox_candidate')));
  assert.equal(sql.at(-1), 'COMMIT');
  assert.equal(sql.some((text) => text.includes(input.customer_name)), false);
  assert.equal(pool.released, 1);
});

test('PostgreSQL transaction rolls back partial lead/outbox failure and releases the connection', async () => {
  const pool = new RecordingPgPool(); pool.failOutboxInsert = true;
  const repository = new PostgresLeadRepository(pool);
  await assert.rejects(() => repository.acceptLead({ leadId: `lead_${'f'.repeat(32)}`, payload: payload(), identityKey: 'c'.repeat(64), fingerprint: 'd'.repeat(64), now: fixedNow }));
  assert.equal(pool.statements.at(-1).text, 'ROLLBACK');
  assert.equal(pool.statements.some((item) => item.text === 'COMMIT'), false);
  assert.equal(pool.released, 1);
});

test('PostgreSQL advisory lookup returns prior duplicate without writing another lead or outbox', async () => {
  const body = payload();
  const identityKey = leadIdentityKey(body, 'fixture-scope');
  const fingerprint = leadFingerprint(body);
  const pool = new RecordingPgPool();
  pool.existingLead = { lead_id: `lead_${'1'.repeat(32)}`, identity_key: identityKey, fingerprint, payload: body, received_at: new Date(fixedNow), status: 'dispatch_pending', processing_attempts: 0, processing_attempt_id: null, processing_next_attempt_at: new Date(0), processing_lease_until: new Date(0), downstream_receipt_ref: null };
  pool.existingOutbox = { outbox_id: `lead-dispatch:lead_${'1'.repeat(32)}`, lead_id: `lead_${'1'.repeat(32)}`, status: 'pending', dispatch_attempts: 0, next_attempt_at: new Date(0), lease_until: new Date(0), active_attempt_id: null, last_failure_code: null, dispatch_receipt_ref: null };
  const repository = new PostgresLeadRepository(pool);
  const result = await repository.acceptLead({ leadId: `lead_${'2'.repeat(32)}`, payload: body, identityKey, fingerprint, now: fixedNow });
  assert.equal(result.kind, 'duplicate');
  assert.equal(pool.statements.some((item) => item.text.includes('INSERT INTO')), false);
  assert.equal(pool.statements.at(-1).text, 'COMMIT');
});

test('candidate SQL is isolated, unexecuted, has no identity-key unique constraint, and runbook keeps execution gated', async () => {
  const migration = await readFile(path.join(candidateRoot, 'database', '001-wf01-lead-outbox.candidate.sql'), 'utf8');
  const runbook = await readFile(path.join(candidateRoot, 'deployment-rollback.md'), 'utf8');
  assert.match(migration, /candidate only/i);
  assert.match(migration, /No unique constraint is proposed on identity_key/i);
  assert.doesNotMatch(migration, /UNIQUEs*(s*identity_keys*)/i);
  assert.match(runbook, /current SQL\/fixtures gate prohibits applying it/i);
  assert.match(runbook, /legacy lead workflow graph/i);
  assert.equal(await readFile(path.join(rootProject, 'development', 'trigger.config.ts'), 'utf8').then((text) => text.includes("dirs:['./trigger']")), true);
});

test('liveness and readiness are distinct and readiness fails until migration gates are complete', async () => {
  assert.equal(livenessResponse().status, 200);
  const notReady = readinessResponse({ durableRepository: true, authorization: true, rateLimiter: true });
  assert.equal(notReady.status, 503);
  const ready = readinessResponse({ durableRepository: true, authorization: true, rateLimiter: true, triggerClient: true,
    triggerTaskDiscovered: true, downstreamCompatibility: true, legacyWorkflowVerified: true, migrationApproved: true });
  assert.equal(ready.status, 200);
});
