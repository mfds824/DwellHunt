import { createHash } from 'node:crypto';

export const LEAD_FIELDS = [
  'customer_name', 'email', 'phone', 'enquiry_type', 'property', 'property_id',
  'agency_id', 'location', 'budget', 'message', 'preferred_date', 'source',
  'submittedAt', 'lead_id',
] as const;

export type LeadPayload = Readonly<Record<(typeof LEAD_FIELDS)[number], string>>;
export const MAX_BODY_BYTES = 16_384;
export const LEAD_TASK_ID = 'dwellhunt-lead-process';
export const LEAD_TASK_SCHEMA_VERSION = 1 as const;

export class LeadInputError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

const maxLengths: Record<(typeof LEAD_FIELDS)[number], number> = {
  customer_name: 120,
  email: 254,
  phone: 32,
  enquiry_type: 80,
  property: 240,
  property_id: 128,
  agency_id: 128,
  location: 180,
  budget: 80,
  message: 3000,
  preferred_date: 100,
  source: 40,
  submittedAt: 24,
  lead_id: 40,
};

function hasOnlyDataProperties(value: Record<string, unknown>): boolean {
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  return Object.keys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
  });
}

export function validateLeadPayload(input: unknown): LeadPayload {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new LeadInputError('INVALID_PAYLOAD');
  const value = input as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || !hasOnlyDataProperties(value)) throw new LeadInputError('INVALID_PAYLOAD');
  const keys = Object.keys(value).sort();
  const expected = [...LEAD_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new LeadInputError('INVALID_PAYLOAD');

  const copy = Object.create(null) as Record<string, string>;
  for (const field of LEAD_FIELDS) {
    const fieldValue = value[field];
    if (typeof fieldValue !== 'string' || fieldValue.length > maxLengths[field]) throw new LeadInputError('INVALID_PAYLOAD');
    if (fieldValue.length > 0 && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(fieldValue)) throw new LeadInputError('INVALID_PAYLOAD');
    copy[field] = fieldValue;
  }

  if (!copy.customer_name.trim() || !copy.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(copy.email)) throw new LeadInputError('INVALID_PAYLOAD');
  if (copy.source !== 'DwellHunt Website') throw new LeadInputError('INVALID_PAYLOAD');
  if (!/^enq-\d{1,20}$/.test(copy.lead_id)) throw new LeadInputError('INVALID_PAYLOAD');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(copy.submittedAt)) throw new LeadInputError('INVALID_PAYLOAD');
  const timestamp = Date.parse(copy.submittedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== copy.submittedAt) throw new LeadInputError('INVALID_PAYLOAD');
  return Object.freeze(copy) as LeadPayload;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Server-computed retry key scoped to a trusted principal. Client lead_id is only an idempotency hint. */
export function leadIdentityKey(payload: LeadPayload, scope: string): string {
  return sha256(JSON.stringify(['dwellhunt-lead-idempotency-v2', scope, payload.lead_id]));
}

/** Transport timestamp and client lead_id are preserved on the wire but excluded from retry identity/fingerprint authority. */
export function leadFingerprint(payload: LeadPayload): string {
  const stableFields = LEAD_FIELDS.filter((field) => field !== 'submittedAt' && field !== 'lead_id');
  return sha256(JSON.stringify(stableFields.map((field) => [field, payload[field]])));
}

export function isServerLeadId(value: unknown): value is string {
  return typeof value === 'string' && /^lead_[a-f0-9]{32}$/.test(value);
}
