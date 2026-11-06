import type { LeadPayload } from './contract.ts';

export type LeadStatus = 'dispatch_pending' | 'dispatching' | 'dispatch_accepted' | 'dispatch_failed' | 'dispatch_unknown' | 'processing' | 'processing_retry_pending' | 'processing_failed' | 'processing_unknown' | 'downstream_acknowledged';
export type OutboxStatus = 'pending' | 'dispatching' | 'accepted' | 'failed' | 'unknown' | 'exhausted';

export type LeadRecord = {
  id: string;
  payload: LeadPayload;
  identityKey: string;
  fingerprint: string;
  receivedAt: number;
  status: LeadStatus;
  processingAttempts: number;
  processingAttemptId: string | null;
  processingNextAttemptAt: number;
  processingLeaseUntil: number;
  downstreamReceiptRef: string | null;
};

export type OutboxRecord = {
  id: string;
  leadId: string;
  status: OutboxStatus;
  dispatchAttempts: number;
  nextAttemptAt: number;
  leaseUntil: number;
  activeAttemptId: string | null;
  lastFailureCode: string | null;
  dispatchReceiptRef: string | null;
};

export type AcceptedLead = { kind: 'accepted'; lead: LeadRecord; outbox: OutboxRecord };
export type DuplicateLead = { kind: 'duplicate'; lead: LeadRecord; outbox: OutboxRecord };
export type ConflictingLead = { kind: 'conflict' };
export type IntakeCommitResult = AcceptedLead | DuplicateLead | ConflictingLead;
export type DispatchOutcome =
  | { kind: 'accepted'; receiptRef: string }
  | { kind: 'rejected'; code: string }
  | { kind: 'unknown'; code: string };
export type DispatchClaim = { kind: 'claimed'; outbox: OutboxRecord; lead: LeadRecord } | { kind: 'not_ready' | 'missing' | 'exhausted' | 'unknown' };
export type ProcessingClaim = { kind: 'claimed'; lead: LeadRecord } | { kind: 'already_processed' | 'not_ready' | 'missing' | 'exhausted' };
export type ProcessingResolution = { kind: 'accepted'; receiptRef: string } | { kind: 'not_applied'; retrySafe: boolean } | { kind: 'unknown' };

/** Production adapter must atomically commit lead+outbox, serialize the scoped idempotency lookup, and persist attempts/receipts. */
export interface LeadRepository {
  acceptLead(input: { leadId: string; payload: LeadPayload; identityKey: string; fingerprint: string; now: number }): Promise<IntakeCommitResult>;
  getLead(leadId: string): Promise<LeadRecord | undefined>;
  listRecoverableOutbox(now: number): Promise<OutboxRecord[]>;
  claimDispatch(outboxId: string, attemptId: string, now: number, leaseMs: number, maxAttempts: number): Promise<DispatchClaim>;
  recordDispatch(outboxId: string, attemptId: string, outcome: DispatchOutcome, now: number, retryDelayMs: number): Promise<boolean>;
  reconcileUnknownDispatch(outboxId: string, outcome: DispatchOutcome, now: number, retryDelayMs: number): Promise<boolean>;
  expireDispatchLeases(now: number): Promise<number>;
  claimProcessing(leadId: string, attemptId: string, now: number, leaseMs: number, maxAttempts: number): Promise<ProcessingClaim>;
  completeProcessing(leadId: string, attemptId: string, outcome: 'acknowledged' | 'retry' | 'failed' | 'unknown', now: number, retryDelayMs: number, receiptRef?: string): Promise<boolean>;
  reconcileUnknownProcessing(leadId: string, outcome: ProcessingResolution, now: number, retryDelayMs: number): Promise<boolean>;
}

type State = { leads: LeadRecord[]; outbox: OutboxRecord[] };

/** Offline-only, process-local adapter. It simulates transaction publication; it is not durable across restarts. */
export class InMemoryLeadRepository implements LeadRepository {
  #state: State = { leads: [], outbox: [] };
  #tail: Promise<unknown> = Promise.resolve();
  failNextCommit = false;

  async #atomic<T>(work: (draft: State) => T | Promise<T>): Promise<T> {
    const operation = this.#tail.then(async () => {
      const draft = structuredClone(this.#state);
      const result = await work(draft);
      if (this.failNextCommit) { this.failNextCommit = false; throw new Error('MOCK_COMMIT_FAILED'); }
      this.#state = structuredClone(draft);
      return result;
    });
    this.#tail = operation.catch(() => undefined);
    return operation;
  }

  acceptLead(input: { leadId: string; payload: LeadPayload; identityKey: string; fingerprint: string; now: number }): Promise<IntakeCommitResult> {
    return this.#atomic((state) => {
      const prior = state.leads.find((lead) => lead.identityKey === input.identityKey);
      if (prior) {
        const outbox = state.outbox.find((entry) => entry.leadId === prior.id);
        if (!outbox) throw new Error('INVARIANT_OUTBOX_MISSING');
        if (prior.fingerprint === input.fingerprint) return { kind: 'duplicate', lead: prior, outbox };
        return { kind: 'conflict' };
      }
      const lead: LeadRecord = { id: input.leadId, payload: input.payload, identityKey: input.identityKey, fingerprint: input.fingerprint,
        receivedAt: input.now, status: 'dispatch_pending', processingAttempts: 0, processingAttemptId: null, processingNextAttemptAt: 0, processingLeaseUntil: 0, downstreamReceiptRef: null };
      const outbox: OutboxRecord = { id: `lead-dispatch:${input.leadId}`, leadId: input.leadId, status: 'pending', dispatchAttempts: 0,
        nextAttemptAt: 0, leaseUntil: 0, activeAttemptId: null, lastFailureCode: null, dispatchReceiptRef: null };
      state.leads.push(lead);
      state.outbox.push(outbox);
      return { kind: 'accepted', lead, outbox };
    });
  }

  async getLead(leadId: string): Promise<LeadRecord | undefined> {
    await this.#tail;
    const lead = this.#state.leads.find((item) => item.id === leadId);
    return lead && structuredClone(lead);
  }

  async listRecoverableOutbox(now: number): Promise<OutboxRecord[]> {
    await this.#tail;
    return structuredClone(this.#state.outbox.filter((entry) => entry.status === 'pending' || (entry.status === 'failed' && entry.nextAttemptAt <= now)));
  }

  claimDispatch(outboxId: string, attemptId: string, now: number, leaseMs: number, maxAttempts: number): Promise<DispatchClaim> {
    return this.#atomic((state) => {
      const outbox = state.outbox.find((entry) => entry.id === outboxId);
      if (!outbox) return { kind: 'missing' };
      if (outbox.status === 'unknown' || (outbox.status === 'dispatching' && outbox.leaseUntil <= now)) {
        const lead = state.leads.find((item) => item.id === outbox.leadId);
        if (outbox.status === 'dispatching' && lead) { outbox.status = 'unknown'; outbox.activeAttemptId = null; lead.status = 'dispatch_unknown'; }
        return { kind: 'unknown' };
      }
      if (outbox.status === 'accepted' || outbox.status === 'exhausted') return { kind: 'not_ready' };
      if (outbox.status === 'dispatching' || outbox.nextAttemptAt > now) return { kind: 'not_ready' };
      if (outbox.dispatchAttempts >= maxAttempts) { outbox.status = 'exhausted'; outbox.lastFailureCode ??= 'RETRY_LIMIT'; return { kind: 'exhausted' }; }
      const lead = state.leads.find((item) => item.id === outbox.leadId);
      if (!lead) return { kind: 'missing' };
      outbox.status = 'dispatching'; outbox.dispatchAttempts += 1; outbox.activeAttemptId = attemptId; outbox.leaseUntil = now + leaseMs;
      lead.status = 'dispatching';
      return { kind: 'claimed', outbox, lead };
    });
  }

  recordDispatch(outboxId: string, attemptId: string, outcome: DispatchOutcome, now: number, retryDelayMs: number): Promise<boolean> {
    return this.#atomic((state) => {
      const outbox = state.outbox.find((entry) => entry.id === outboxId);
      const lead = outbox && state.leads.find((item) => item.id === outbox.leadId);
      if (!outbox || !lead || outbox.status !== 'dispatching' || outbox.activeAttemptId !== attemptId) return false;
      outbox.activeAttemptId = null; outbox.leaseUntil = 0;
      if (outcome.kind === 'accepted') { outbox.status = 'accepted'; outbox.lastFailureCode = null; outbox.dispatchReceiptRef = safeReceipt(outcome.receiptRef); lead.status = 'dispatch_accepted'; }
      else if (outcome.kind === 'unknown') { outbox.status = 'unknown'; outbox.lastFailureCode = safeCode(outcome.code); lead.status = 'dispatch_unknown'; }
      else { outbox.status = 'failed'; outbox.lastFailureCode = safeCode(outcome.code); outbox.nextAttemptAt = now + retryDelayMs; lead.status = 'dispatch_failed'; }
      return true;
    });
  }

  reconcileUnknownDispatch(outboxId: string, outcome: DispatchOutcome, now: number, retryDelayMs: number): Promise<boolean> {
    return this.#atomic((state) => {
      const outbox = state.outbox.find((entry) => entry.id === outboxId);
      const lead = outbox && state.leads.find((item) => item.id === outbox.leadId);
      if (!outbox || !lead || outbox.status !== 'unknown') return false;
      if (outcome.kind === 'unknown') { outbox.lastFailureCode = safeCode(outcome.code); return true; }
      if (outcome.kind === 'accepted') { outbox.status = 'accepted'; outbox.dispatchReceiptRef = safeReceipt(outcome.receiptRef); outbox.lastFailureCode = null; lead.status = 'dispatch_accepted'; return true; }
      outbox.status = 'failed'; outbox.lastFailureCode = safeCode(outcome.code); outbox.nextAttemptAt = now + retryDelayMs; lead.status = 'dispatch_failed';
      return true;
    });
  }

  expireDispatchLeases(now: number): Promise<number> {
    return this.#atomic((state) => {
      let expired = 0;
      for (const outbox of state.outbox) if (outbox.status === 'dispatching' && outbox.leaseUntil <= now) {
        outbox.status = 'unknown'; outbox.activeAttemptId = null; outbox.lastFailureCode = 'DISPATCH_OUTCOME_UNKNOWN'; outbox.leaseUntil = 0;
        const lead = state.leads.find((item) => item.id === outbox.leadId); if (lead) lead.status = 'dispatch_unknown';
        expired++;
      }
      return expired;
    });
  }

  claimProcessing(leadId: string, attemptId: string, now: number, leaseMs: number, maxAttempts: number): Promise<ProcessingClaim> {
    return this.#atomic((state) => {
      const lead = state.leads.find((item) => item.id === leadId);
      if (!lead) return { kind: 'missing' };
      if (lead.status === 'downstream_acknowledged') return { kind: 'already_processed' };
      if (lead.status === 'processing' && lead.processingLeaseUntil <= now) {
        // Downstream may have accepted a request before a worker stopped; require reconciliation, never blind retry.
        lead.status = 'processing_unknown'; lead.processingAttemptId = null; lead.processingLeaseUntil = 0;
        return { kind: 'not_ready' };
      }
      if (!['dispatch_accepted', 'processing_retry_pending'].includes(lead.status)) return { kind: 'not_ready' };
      if (lead.processingNextAttemptAt > now || lead.processingLeaseUntil > now) return { kind: 'not_ready' };
      if (lead.processingAttempts >= maxAttempts) { lead.status = 'processing_failed'; return { kind: 'exhausted' }; }
      lead.processingAttempts += 1; lead.processingAttemptId = attemptId; lead.processingLeaseUntil = now + leaseMs; lead.status = 'processing';
      return { kind: 'claimed', lead };
    });
  }

  completeProcessing(leadId: string, attemptId: string, outcome: 'acknowledged' | 'retry' | 'failed' | 'unknown', now: number, retryDelayMs: number, receiptRef?: string): Promise<boolean> {
    return this.#atomic((state) => {
      const lead = state.leads.find((item) => item.id === leadId);
      if (!lead || lead.status !== 'processing' || lead.processingAttemptId !== attemptId) return false;
      lead.processingAttemptId = null; lead.processingLeaseUntil = 0;
      if (outcome === 'acknowledged') { lead.status = 'downstream_acknowledged'; lead.downstreamReceiptRef = safeReceipt(receiptRef ?? ''); }
      else if (outcome === 'retry') { lead.status = 'processing_retry_pending'; lead.processingNextAttemptAt = now + retryDelayMs; }
      else if (outcome === 'unknown') lead.status = 'processing_unknown';
      else lead.status = 'processing_failed';
      return true;
    });
  }

  reconcileUnknownProcessing(leadId: string, outcome: ProcessingResolution, now: number, retryDelayMs: number): Promise<boolean> {
    return this.#atomic((state) => {
      const lead = state.leads.find((item) => item.id === leadId);
      if (!lead || lead.status !== 'processing_unknown') return false;
      if (outcome.kind === 'unknown') return true;
      if (outcome.kind === 'accepted') { lead.status = 'downstream_acknowledged'; lead.downstreamReceiptRef = safeReceipt(outcome.receiptRef); return true; }
      if (outcome.retrySafe) { lead.status = 'processing_retry_pending'; lead.processingNextAttemptAt = now + retryDelayMs; }
      else lead.status = 'processing_failed';
      return true;
    });
  }

  async snapshotForTest(): Promise<{ leads: LeadRecord[]; outbox: OutboxRecord[] }> {
    await this.#tail;
    return structuredClone(this.#state);
  }
}

function safeCode(value: string): string { return /^[A-Z0-9_]{1,48}$/.test(value) ? value : 'DISPATCH_FAILED'; }
function safeReceipt(value: string): string { if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw new Error('INVALID_RECEIPT_REFERENCE'); return value; }
