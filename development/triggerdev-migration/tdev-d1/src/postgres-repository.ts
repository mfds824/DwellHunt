import { isServerLeadId, validateLeadPayload } from './contract.ts';
import type { LeadPayload } from './contract.ts';
import type { LeadRepository, LeadRecord, OutboxRecord, IntakeCommitResult, DispatchClaim, DispatchOutcome, ProcessingClaim, ProcessingResolution } from './repository.ts';

export type PgResult<Row = Record<string, unknown>> = { rows: Row[]; rowCount?: number | null };
export interface PgConnection {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<PgResult<Row>>;
  release(): void;
}
export interface PgPool { connect(): Promise<PgConnection> }

const LEADS = 'dh_tdev_d1_lead_candidate';
const OUTBOX = 'dh_tdev_d1_outbox_candidate';
type Row = Record<string, unknown>;

function time(value: unknown): number {
  const result = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(result)) throw new Error('DB_TIMESTAMP_INVALID');
  return result;
}
function lead(row: Row): LeadRecord {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) as unknown : row.payload;
  return {
    id: String(row.lead_id), payload: validateLeadPayload(payload), identityKey: String(row.identity_key), fingerprint: String(row.fingerprint),
    receivedAt: time(row.received_at), status: String(row.status) as LeadRecord['status'],
    processingAttempts: Number(row.processing_attempts), processingAttemptId: row.processing_attempt_id == null ? null : String(row.processing_attempt_id),
    processingNextAttemptAt: time(row.processing_next_attempt_at), processingLeaseUntil: time(row.processing_lease_until),
    downstreamReceiptRef: row.downstream_receipt_ref == null ? null : String(row.downstream_receipt_ref),
  };
}
function outbox(row: Row): OutboxRecord {
  return {
    id: String(row.outbox_id), leadId: String(row.lead_id), status: String(row.status) as OutboxRecord['status'],
    dispatchAttempts: Number(row.dispatch_attempts), nextAttemptAt: time(row.next_attempt_at), leaseUntil: time(row.lease_until),
    activeAttemptId: row.active_attempt_id == null ? null : String(row.active_attempt_id),
    lastFailureCode: row.last_failure_code == null ? null : String(row.last_failure_code),
    dispatchReceiptRef: row.dispatch_receipt_ref == null ? null : String(row.dispatch_receipt_ref),
  };
}
const LEAD_SELECT = `SELECT * FROM ${LEADS} WHERE lead_id=$1`;
const OUTBOX_SELECT = `SELECT * FROM ${OUTBOX} WHERE outbox_id=$1`;

/** PostgreSQL-compatible adapter over an injected pool. No driver, connection string or environment read is included. */
export class PostgresLeadRepository implements LeadRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) { this.pool = pool; }

  async #tx<T>(operation: (connection: PgConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const result = await operation(connection);
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      try { await connection.query('ROLLBACK'); } catch { /* original failure is retained */ }
      throw error;
    } finally { connection.release(); }
  }

  async acceptLead(input: { leadId: string; payload: LeadPayload; identityKey: string; fingerprint: string; now: number }): Promise<IntakeCommitResult> {
    const validatedPayload = validateLeadPayload(input.payload);
    if (!isServerLeadId(input.leadId) || !/^[a-f0-9]{64}$/.test(input.identityKey) || !/^[a-f0-9]{64}$/.test(input.fingerprint) || !Number.isFinite(input.now)) throw new Error('INVALID_LEAD_REPOSITORY_INPUT');
    return this.#tx(async (connection) => {
      // Hash-key collisions only serialize unrelated requests; the lookup remains the business decision.
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.identityKey]);
      const found = await connection.query<Row>(`SELECT * FROM ${LEADS} WHERE identity_key=$1 FOR UPDATE`, [input.identityKey]);
      if (found.rows[0]) {
        const existing = lead(found.rows[0]);
        const entry = await connection.query<Row>(`SELECT * FROM ${OUTBOX} WHERE lead_id=$1`, [existing.id]);
        if (!entry.rows[0]) throw new Error('INVARIANT_OUTBOX_MISSING');
        if (existing.fingerprint === input.fingerprint) return { kind: 'duplicate', lead: existing, outbox: outbox(entry.rows[0]) };
        return { kind: 'conflict' };
      }
      await connection.query(`INSERT INTO ${LEADS}
        (lead_id, identity_key, fingerprint, payload, received_at, status, processing_attempts, processing_next_attempt_at, processing_lease_until)
        VALUES ($1,$2,$3,$4::jsonb,to_timestamp($5 / 1000.0),'dispatch_pending',0,to_timestamp(0),to_timestamp(0))`,
      [input.leadId, input.identityKey, input.fingerprint, JSON.stringify(validatedPayload), input.now]);
      const outboxId = `lead-dispatch:${input.leadId}`;
      await connection.query(`INSERT INTO ${OUTBOX}
        (outbox_id, lead_id, status, dispatch_attempts, next_attempt_at, lease_until)
        VALUES ($1,$2,'pending',0,to_timestamp(0),to_timestamp(0))`, [outboxId, input.leadId]);
      const leadRecord: LeadRecord = { id: input.leadId, payload: validatedPayload, identityKey: input.identityKey, fingerprint: input.fingerprint,
        receivedAt: input.now, status: 'dispatch_pending', processingAttempts: 0, processingAttemptId: null,
        processingNextAttemptAt: 0, processingLeaseUntil: 0, downstreamReceiptRef: null };
      const outboxRecord: OutboxRecord = { id: outboxId, leadId: input.leadId, status: 'pending', dispatchAttempts: 0,
        nextAttemptAt: 0, leaseUntil: 0, activeAttemptId: null, lastFailureCode: null, dispatchReceiptRef: null };
      return { kind: 'accepted', lead: leadRecord, outbox: outboxRecord };
    });
  }

  async getLead(leadId: string): Promise<LeadRecord | undefined> {
    const connection = await this.pool.connect();
    try { const result = await connection.query<Row>(LEAD_SELECT, [leadId]); return result.rows[0] ? lead(result.rows[0]) : undefined; }
    finally { connection.release(); }
  }

  async listRecoverableOutbox(now: number): Promise<OutboxRecord[]> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<Row>(`SELECT * FROM ${OUTBOX} WHERE status='pending' OR (status='failed' AND next_attempt_at<=to_timestamp($1 / 1000.0)) ORDER BY next_attempt_at`, [now]);
      return result.rows.map(outbox);
    } finally { connection.release(); }
  }

  async claimDispatch(outboxId: string, attemptId: string, now: number, leaseMs: number, maxAttempts: number): Promise<DispatchClaim> {
    return this.#tx(async (connection) => {
      const selected = await connection.query<Row>(`${OUTBOX_SELECT} FOR UPDATE`, [outboxId]);
      if (!selected.rows[0]) return { kind: 'missing' };
      const entry = outbox(selected.rows[0]);
      if (entry.status === 'unknown') return { kind: 'unknown' };
      if (entry.status === 'dispatching' && entry.leaseUntil <= now) {
        await connection.query(`UPDATE ${OUTBOX} SET status='unknown',active_attempt_id=NULL,lease_until=to_timestamp(0),last_failure_code='DISPATCH_OUTCOME_UNKNOWN' WHERE outbox_id=$1`, [outboxId]);
        await connection.query(`UPDATE ${LEADS} SET status='dispatch_unknown' WHERE lead_id=$1`, [entry.leadId]);
        return { kind: 'unknown' };
      }
      if (entry.status === 'accepted' || entry.status === 'exhausted' || entry.status === 'dispatching' || entry.nextAttemptAt > now) return { kind: 'not_ready' };
      if (entry.dispatchAttempts >= maxAttempts) {
        await connection.query(`UPDATE ${OUTBOX} SET status='exhausted',last_failure_code=COALESCE(last_failure_code,'RETRY_LIMIT') WHERE outbox_id=$1`, [outboxId]);
        return { kind: 'exhausted' };
      }
      const leadResult = await connection.query<Row>(`${LEAD_SELECT} FOR UPDATE`, [entry.leadId]);
      if (!leadResult.rows[0]) return { kind: 'missing' };
      const attempts = entry.dispatchAttempts + 1;
      await connection.query(`UPDATE ${OUTBOX} SET status='dispatching',dispatch_attempts=$2,active_attempt_id=$3,lease_until=to_timestamp($4 / 1000.0) WHERE outbox_id=$1`, [outboxId, attempts, attemptId, now + leaseMs]);
      await connection.query(`UPDATE ${LEADS} SET status='dispatching' WHERE lead_id=$1`, [entry.leadId]);
      return { kind: 'claimed', outbox: { ...entry, status: 'dispatching', dispatchAttempts: attempts, activeAttemptId: attemptId, leaseUntil: now + leaseMs }, lead: lead(leadResult.rows[0]) };
    });
  }

  async recordDispatch(outboxId: string, attemptId: string, outcome: DispatchOutcome, now: number, retryDelayMs: number): Promise<boolean> {
    return this.#tx(async (connection) => {
      const result = await connection.query<Row>(`${OUTBOX_SELECT} FOR UPDATE`, [outboxId]);
      if (!result.rows[0]) return false;
      const entry = outbox(result.rows[0]);
      if (entry.status !== 'dispatching' || entry.activeAttemptId !== attemptId) return false;
      await this.#writeDispatchOutcome(connection, entry, outcome, now, retryDelayMs);
      return true;
    });
  }

  async reconcileUnknownDispatch(outboxId: string, outcome: DispatchOutcome, now: number, retryDelayMs: number): Promise<boolean> {
    return this.#tx(async (connection) => {
      const result = await connection.query<Row>(`${OUTBOX_SELECT} FOR UPDATE`, [outboxId]);
      if (!result.rows[0]) return false;
      const entry = outbox(result.rows[0]);
      if (entry.status !== 'unknown') return false;
      if (outcome.kind === 'unknown') { await connection.query(`UPDATE ${OUTBOX} SET last_failure_code=$2 WHERE outbox_id=$1`, [outboxId, code(outcome.code)]); return true; }
      await this.#writeDispatchOutcome(connection, entry, outcome, now, retryDelayMs);
      return true;
    });
  }

  async #writeDispatchOutcome(connection: PgConnection, entry: OutboxRecord, outcome: DispatchOutcome, now: number, retryDelayMs: number): Promise<void> {
    if (outcome.kind === 'accepted') {
      await connection.query(`UPDATE ${OUTBOX} SET status='accepted',active_attempt_id=NULL,lease_until=to_timestamp(0),dispatch_receipt_ref=$2,last_failure_code=NULL WHERE outbox_id=$1`, [entry.id, receipt(outcome.receiptRef)]);
      await connection.query(`UPDATE ${LEADS} SET status='dispatch_accepted' WHERE lead_id=$1`, [entry.leadId]);
    } else if (outcome.kind === 'rejected') {
      await connection.query(`UPDATE ${OUTBOX} SET status='failed',active_attempt_id=NULL,lease_until=to_timestamp(0),last_failure_code=$2,next_attempt_at=to_timestamp($3 / 1000.0) WHERE outbox_id=$1`, [entry.id, code(outcome.code), now + retryDelayMs]);
      await connection.query(`UPDATE ${LEADS} SET status='dispatch_failed' WHERE lead_id=$1`, [entry.leadId]);
    } else {
      await connection.query(`UPDATE ${OUTBOX} SET status='unknown',active_attempt_id=NULL,lease_until=to_timestamp(0),last_failure_code=$2 WHERE outbox_id=$1`, [entry.id, code(outcome.code)]);
      await connection.query(`UPDATE ${LEADS} SET status='dispatch_unknown' WHERE lead_id=$1`, [entry.leadId]);
    }
  }

  async expireDispatchLeases(now: number): Promise<number> {
    return this.#tx(async (connection) => {
      const result = await connection.query<Row>(`SELECT outbox_id,lead_id FROM ${OUTBOX} WHERE status='dispatching' AND lease_until<=to_timestamp($1 / 1000.0) FOR UPDATE SKIP LOCKED`, [now]);
      for (const row of result.rows) {
        const entry = outbox({ ...row, status: 'dispatching', dispatch_attempts: 0, next_attempt_at: 0, lease_until: 0, active_attempt_id: null, last_failure_code: null, dispatch_receipt_ref: null });
        await connection.query(`UPDATE ${OUTBOX} SET status='unknown',active_attempt_id=NULL,lease_until=to_timestamp(0),last_failure_code='DISPATCH_OUTCOME_UNKNOWN' WHERE outbox_id=$1`, [entry.id]);
        await connection.query(`UPDATE ${LEADS} SET status='dispatch_unknown' WHERE lead_id=$1`, [entry.leadId]);
      }
      return result.rows.length;
    });
  }

  async claimProcessing(leadId: string, attemptId: string, now: number, leaseMs: number, maxAttempts: number): Promise<ProcessingClaim> {
    return this.#tx(async (connection) => {
      const result = await connection.query<Row>(`${LEAD_SELECT} FOR UPDATE`, [leadId]);
      if (!result.rows[0]) return { kind: 'missing' };
      const item = lead(result.rows[0]);
      if (item.status === 'downstream_acknowledged') return { kind: 'already_processed' };
      if (item.status === 'processing' && item.processingLeaseUntil <= now) {
        await connection.query(`UPDATE ${LEADS} SET status='processing_unknown',processing_attempt_id=NULL,processing_lease_until=to_timestamp(0) WHERE lead_id=$1`, [leadId]);
        return { kind: 'not_ready' };
      }
      if (!['dispatch_accepted', 'processing_retry_pending'].includes(item.status) || item.processingNextAttemptAt > now || item.processingLeaseUntil > now) return { kind: 'not_ready' };
      if (item.processingAttempts >= maxAttempts) { await connection.query(`UPDATE ${LEADS} SET status='processing_failed' WHERE lead_id=$1`, [leadId]); return { kind: 'exhausted' }; }
      const attempts = item.processingAttempts + 1;
      await connection.query(`UPDATE ${LEADS} SET status='processing',processing_attempts=$2,processing_attempt_id=$3,processing_lease_until=to_timestamp($4 / 1000.0) WHERE lead_id=$1`, [leadId, attempts, attemptId, now + leaseMs]);
      return { kind: 'claimed', lead: { ...item, status: 'processing', processingAttempts: attempts, processingAttemptId: attemptId, processingLeaseUntil: now + leaseMs } };
    });
  }

  async completeProcessing(leadId: string, attemptId: string, outcome: 'acknowledged' | 'retry' | 'failed' | 'unknown', now: number, retryDelayMs: number, receiptRef?: string): Promise<boolean> {
    return this.#tx(async (connection) => {
      const result = await connection.query<Row>(`${LEAD_SELECT} FOR UPDATE`, [leadId]);
      if (!result.rows[0]) return false;
      const item = lead(result.rows[0]);
      if (item.status !== 'processing' || item.processingAttemptId !== attemptId) return false;
      const status = outcome === 'acknowledged' ? 'downstream_acknowledged' : outcome === 'retry' ? 'processing_retry_pending' : outcome === 'unknown' ? 'processing_unknown' : 'processing_failed';
      await connection.query(`UPDATE ${LEADS} SET status=$2,processing_attempt_id=NULL,processing_lease_until=to_timestamp(0),processing_next_attempt_at=CASE WHEN $2='processing_retry_pending' THEN to_timestamp($3 / 1000.0) ELSE processing_next_attempt_at END,downstream_receipt_ref=$4 WHERE lead_id=$1`, [leadId, status, now + retryDelayMs, outcome === 'acknowledged' ? receipt(receiptRef ?? '') : null]);
      return true;
    });
  }

  async reconcileUnknownProcessing(leadId: string, outcome: ProcessingResolution, now: number, retryDelayMs: number): Promise<boolean> {
    return this.#tx(async (connection) => {
      const result = await connection.query<Row>(`${LEAD_SELECT} FOR UPDATE`, [leadId]);
      if (!result.rows[0]) return false;
      const item = lead(result.rows[0]);
      if (item.status !== 'processing_unknown') return false;
      if (outcome.kind === 'unknown') return true;
      if (outcome.kind === 'accepted') {
        await connection.query(`UPDATE ${LEADS} SET status='downstream_acknowledged',downstream_receipt_ref=$2 WHERE lead_id=$1`, [leadId, receipt(outcome.receiptRef)]);
      } else {
        await connection.query(`UPDATE ${LEADS} SET status=$2,processing_next_attempt_at=CASE WHEN $2='processing_retry_pending' THEN to_timestamp($3 / 1000.0) ELSE processing_next_attempt_at END WHERE lead_id=$1`, [leadId, outcome.retrySafe ? 'processing_retry_pending' : 'processing_failed', now + retryDelayMs]);
      }
      return true;
    });
  }
}

function code(value: string): string { return /^[A-Z0-9_]{1,48}$/.test(value) ? value : 'DISPATCH_FAILED'; }
function receipt(value: string): string { if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw new Error('INVALID_RECEIPT_REFERENCE'); return value; }
