import type { LeadRecord } from './repository.ts';
import type { DownstreamOutcome, LeadProcessingOperation } from './dispatch.ts';

/** Port for the already-authorized lead processor. Its concrete identity/graph must be verified before binding. */
export interface ExistingLeadProcessor {
  deliver(payload: LeadRecord['payload'], idempotencyKey: string): Promise<DownstreamOutcome>;
}

/** Compatibility seam only. No n8n URL, HTTP client, credential or network default is provided. */
export function createExistingLeadCompatibilityProcessor(adapter: ExistingLeadProcessor): LeadProcessingOperation {
  return (lead, idempotencyKey) => adapter.deliver(lead.payload, idempotencyKey);
}
