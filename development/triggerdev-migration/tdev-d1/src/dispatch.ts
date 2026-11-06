import { randomUUID } from 'node:crypto';
import type { tasks } from '@trigger.dev/sdk';
import { LEAD_TASK_ID, LEAD_TASK_SCHEMA_VERSION, isServerLeadId } from './contract.ts';
import type { LeadRecord, LeadRepository, DispatchOutcome } from './repository.ts';

export type LeadTaskReference = Readonly<{ leadId: string; schemaVersion: 1 }>;
export type LeadTaskDispatcher = { dispatch(reference: LeadTaskReference, correlationId: string): Promise<DispatchOutcome> };
export type StructuredLogger = { event(code: string, fields: Readonly<Record<string, string | number | boolean>>): void };
export const NullLogger: StructuredLogger = { event: () => undefined };

export const validateLeadTaskReference = (input: unknown): LeadTaskReference => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_TASK_REFERENCE');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'leadId,schemaVersion' || !isServerLeadId(value.leadId) || value.schemaVersion !== LEAD_TASK_SCHEMA_VERSION) throw new Error('INVALID_TASK_REFERENCE');
  return { leadId: value.leadId, schemaVersion: LEAD_TASK_SCHEMA_VERSION };
};

export async function dispatchOutboxItem(input: {
  repository: LeadRepository; dispatcher: LeadTaskDispatcher; outboxId: string; now: () => number;
  logger?: StructuredLogger; makeAttemptId?: () => string; leaseMs?: number; maxAttempts?: number; retryDelayMs?: number;
}): Promise<{ kind: 'accepted' | 'rejected' | 'unknown' | 'not_ready' | 'missing' | 'exhausted'; correlationId?: string }> {
  const attemptId = (input.makeAttemptId ?? randomUUID)();
  const logger = input.logger ?? NullLogger;
  const claim = await input.repository.claimDispatch(input.outboxId, attemptId, input.now(), input.leaseMs ?? 30_000, input.maxAttempts ?? 3);
  if (claim.kind !== 'claimed') return { kind: claim.kind };
  const correlationId = `lead-dispatch:${claim.lead.id}:${claim.outbox.dispatchAttempts}`;
  let outcome: DispatchOutcome;
  try {
    outcome = await input.dispatcher.dispatch({ leadId: claim.lead.id, schemaVersion: LEAD_TASK_SCHEMA_VERSION }, correlationId);
  } catch {
    outcome = { kind: 'unknown', code: 'DISPATCH_OUTCOME_UNKNOWN' };
  }
  const committed = await input.repository.recordDispatch(claim.outbox.id, attemptId, outcome, input.now(), input.retryDelayMs ?? 30_000);
  if (!committed) {
    logger.event('dispatch_settlement_lost', { correlationId });
    return { kind: 'unknown', correlationId };
  }
  logger.event(`dispatch_${outcome.kind}`, { correlationId, attempt: claim.outbox.dispatchAttempts });
  return { kind: outcome.kind, correlationId };
}

/** Offline fake only; test code injects it. This class never performs network I/O. */
export class FakeLeadTaskDispatcher implements LeadTaskDispatcher {
  readonly calls: Array<{ taskId: string; reference: LeadTaskReference; correlationId: string }> = [];
  outcomes: DispatchOutcome[] = [];
  async dispatch(referenceInput: LeadTaskReference, correlationId: string): Promise<DispatchOutcome> {
    const reference = validateLeadTaskReference(referenceInput);
    this.calls.push({ taskId: LEAD_TASK_ID, reference, correlationId });
    return this.outcomes.shift() ?? { kind: 'accepted', receiptRef: `fake-run-${this.calls.length}` };
  }
}

/** SDK v4 type adapter. Caller must inject an SDK client; no client, key or Cloud call is created here. */
export function createTriggerDevLeadDispatcher(client: Pick<typeof tasks, 'trigger'>, timeoutMs = 10_000): LeadTaskDispatcher {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('INVALID_DISPATCH_TIMEOUT');
  return {
    async dispatch(referenceInput, correlationId) {
      const reference = validateLeadTaskReference(referenceInput);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
        const triggering = client.trigger(LEAD_TASK_ID, reference, {
            idempotencyKey: correlationId,
            idempotencyKeyTTL: '24h',
            maxAttempts: 1,
          }).then((value) => ({ kind: 'accepted' as const, value }), () => ({ kind: 'unknown' as const }));
        const result = await Promise.race([triggering, timeout]);
        if (result === 'timeout') return { kind: 'unknown', code: 'TRIGGER_TIMEOUT_OUTCOME_UNKNOWN' };
        if (result.kind === 'unknown') return { kind: 'unknown', code: 'TRIGGER_OUTCOME_UNKNOWN' };
        const runId = result.value && typeof result.value === 'object' ? (result.value as { id?: unknown }).id : undefined;
        if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(runId)) return { kind: 'unknown', code: 'TRIGGER_RECEIPT_UNAVAILABLE' };
        return { kind: 'accepted', receiptRef: `trigger-run:${runId}` };
      } catch {
        // A rejected promise cannot prove whether the remote side accepted the task before the failure.
        return { kind: 'unknown', code: 'TRIGGER_OUTCOME_UNKNOWN' };
      } finally { if (timer) clearTimeout(timer); }
    },
  };
}

export type DownstreamOutcome = { kind: 'accepted'; receiptRef: string } | { kind: 'rejected'; code: string; retryable: boolean } | { kind: 'unknown'; code: string };
export type LeadProcessingOperation = (lead: Readonly<LeadRecord>, idempotencyKey: string) => Promise<DownstreamOutcome>;
export type ProcessingResult = { kind: 'downstream_acknowledged' | 'retry' | 'failed' | 'unknown' | 'already_processed' | 'not_ready' | 'missing' | 'exhausted' };

/** Domain runner shared by the SDK task candidate and synthetic tests; injected operation has no provider adapter. */
export async function runLeadProcessing(input: {
  reference: unknown; repository: LeadRepository; now?: () => number; operation: LeadProcessingOperation;
  maxAttempts?: number; leaseMs?: number; retryDelayMs?: number;
}): Promise<ProcessingResult> {
  const reference = validateLeadTaskReference(input.reference);
  const now = input.now ?? Date.now;
  const attemptId = randomUUID();
  const claim = await input.repository.claimProcessing(reference.leadId, attemptId, now(), input.leaseMs ?? 30_000, input.maxAttempts ?? 3);
  if (claim.kind !== 'claimed') return { kind: claim.kind };
  try {
    const outcome = await input.operation(claim.lead, `lead-downstream:${claim.lead.id}`);
    if (outcome.kind === 'accepted') {
      if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(outcome.receiptRef)) {
        await input.repository.completeProcessing(claim.lead.id, attemptId, 'unknown', now(), input.retryDelayMs ?? 30_000);
        return { kind: 'unknown' };
      }
      const saved = await input.repository.completeProcessing(claim.lead.id, attemptId, 'acknowledged', now(), input.retryDelayMs ?? 30_000, outcome.receiptRef);
      return { kind: saved ? 'downstream_acknowledged' : 'unknown' };
    }
    if (outcome.kind === 'unknown') {
      await input.repository.completeProcessing(claim.lead.id, attemptId, 'unknown', now(), input.retryDelayMs ?? 30_000);
      return { kind: 'unknown' };
    }
    const retryable = outcome.retryable;
    const finalAttempt = claim.lead.processingAttempts >= (input.maxAttempts ?? 3);
    const status = retryable && !finalAttempt ? 'retry' : 'failed';
    const saved = await input.repository.completeProcessing(claim.lead.id, attemptId, status, now(), input.retryDelayMs ?? 30_000);
    return { kind: saved ? status : 'unknown' };
  } catch (error) {
    // A thrown bridge call may have been accepted remotely; quarantine until a readback resolves it.
    await input.repository.completeProcessing(claim.lead.id, attemptId, 'unknown', now(), input.retryDelayMs ?? 30_000);
    return { kind: 'unknown' };
  }
}
