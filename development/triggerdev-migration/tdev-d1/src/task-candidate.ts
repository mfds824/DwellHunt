import { schemaTask } from '@trigger.dev/sdk';
import { isServerLeadId } from './contract.ts';
import { runLeadProcessing } from './dispatch.ts';
import type { LeadProcessingOperation } from './dispatch.ts';
import type { LeadRepository } from './repository.ts';

/** Factory for an isolated SDK-compatible task. It is not included in root trigger.config.ts discovery. */
export function createLeadProcessingTaskCandidate(repository: LeadRepository, downstream: LeadProcessingOperation) {
  return schemaTask({
    id: 'dwellhunt-lead-process',
    schema: (input: unknown) => {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_TASK_REFERENCE');
      const value = input as Record<string, unknown>;
      if (Object.keys(value).sort().join(',') !== 'leadId,schemaVersion' || !isServerLeadId(value.leadId) || value.schemaVersion !== 1) throw new Error('INVALID_TASK_REFERENCE');
      return { leadId: value.leadId, schemaVersion: 1 as const };
    },
    maxDuration: 30,
    retry: { maxAttempts: 1 },
    run: async (reference) => runLeadProcessing({ reference, repository, operation: downstream }),
  });
}
