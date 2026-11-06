import { randomUUID } from 'node:crypto';
import { LEAD_FIELDS, MAX_BODY_BYTES, LeadInputError, leadFingerprint, leadIdentityKey, validateLeadPayload } from './contract.ts';
import type { LeadPayload } from './contract.ts';
import type { LeadRepository } from './repository.ts';
import type { StructuredLogger } from './dispatch.ts';
import { NullLogger } from './dispatch.ts';

export const LEAD_INTAKE_PATH = '/v1/leads';
export type AuthorizedPrincipal = Readonly<{ scopeId: string }>;
export type IntakeBindings = {
  repository?: LeadRepository;
  allowedOrigins?: readonly string[];
  authorize?: (request: Request) => Promise<AuthorizedPrincipal | null>;
  rateLimit?: (request: Request, principal: AuthorizedPrincipal) => Promise<boolean>;
  now?: () => number;
  makeLeadId?: () => string;
  logger?: StructuredLogger;
};

type PublicResult = { ok: true; status: 'accepted' | 'duplicate'; lead_ref: string; dispatch_status: 'pending' | 'previously_recorded' };
type PublicErrorBody = { ok: false; code: string; correlation_id: string };

function response(status: number, body: object, origin?: string, allowed = false): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
  if (allowed && origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    headers['Access-Control-Max-Age'] = '300';
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

async function readBody(request: Request): Promise<string> {
  if (!request.body) throw new LeadInputError('INVALID_BODY');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new LeadInputError('BODY_TOO_LARGE'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new LeadInputError('INVALID_BODY'); }
}

function safeCode(error: unknown): string {
  if (error instanceof LeadInputError && ['INVALID_BODY', 'BODY_TOO_LARGE', 'INVALID_PAYLOAD'].includes(error.code)) return error.code;
  return 'SERVICE_UNAVAILABLE';
}

/** Framework-neutral contract only. It does not start a listener or load environment variables. */
export function createLeadIntakeHandler(bindings: IntakeBindings) {
  const logger = bindings.logger ?? NullLogger;
  return async function handleLeadIntake(request: Request): Promise<Response> {
    const correlationId = `lead-intake:${(bindings.makeLeadId ?? (() => randomUUID().replaceAll('-', '')))()}`;
    const origin = request.headers.get('origin') ?? undefined;
    const origins = bindings.allowedOrigins;
    const originAllowed = !!origin && !!origins?.includes(origin);
    const respond = (status: number, body: object) => response(status, body, origin, originAllowed);
    const log = (code: string) => logger.event(code, { correlationId });

    if (request.method === 'OPTIONS') {
      if (!origins?.length) return respond(503, { ok: false, code: 'INTAKE_UNAVAILABLE', correlation_id: correlationId });
      if (!originAllowed || !origins?.length) return respond(403, { ok: false, code: 'ORIGIN_NOT_ALLOWED', correlation_id: correlationId });
      return respond(204, {});
    }
    if (request.method !== 'POST') return respond(405, { ok: false, code: 'METHOD_NOT_ALLOWED', correlation_id: correlationId });
    if (!origins?.length) {
      log('intake_bindings_missing');
      return respond(503, { ok: false, code: 'INTAKE_UNAVAILABLE', correlation_id: correlationId });
    }
    if (!originAllowed) return respond(403, { ok: false, code: 'ORIGIN_NOT_ALLOWED', correlation_id: correlationId });
    if (new URL(request.url).pathname !== LEAD_INTAKE_PATH || new URL(request.url).search) return respond(404, { ok: false, code: 'NOT_FOUND', correlation_id: correlationId });
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) return respond(415, { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', correlation_id: correlationId });
    if (!bindings.repository || !bindings.authorize || !bindings.rateLimit || !bindings.now) {
      log('intake_bindings_missing');
      return respond(503, { ok: false, code: 'INTAKE_UNAVAILABLE', correlation_id: correlationId });
    }

    let payload: LeadPayload;
    try { payload = validateLeadPayload(JSON.parse(await readBody(request))); }
    catch (error) {
      const code = error instanceof SyntaxError ? 'INVALID_BODY' : safeCode(error);
      log('intake_rejected');
      return respond(code === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, code, correlation_id: correlationId });
    }

    let principal: AuthorizedPrincipal | null;
    try { principal = await bindings.authorize(request); }
    catch { principal = null; }
    if (!principal || typeof principal.scopeId !== 'string' || !principal.scopeId) {
      log('intake_authorization_denied');
      return respond(401, { ok: false, code: 'UNAUTHORIZED', correlation_id: correlationId });
    }
    let allowed: boolean;
    try { allowed = await bindings.rateLimit(request, principal); }
    catch { allowed = false; }
    if (!allowed) {
      log('intake_rate_limited');
      return respond(429, { ok: false, code: 'RATE_LIMITED', correlation_id: correlationId });
    }

    try {
      const result = await bindings.repository.acceptLead({
        leadId: `lead_${(bindings.makeLeadId ?? (() => randomUUID().replaceAll('-', '')))()}`,
        payload,
        identityKey: leadIdentityKey(payload, principal.scopeId),
        fingerprint: leadFingerprint(payload),
        now: bindings.now(),
      });
      if (result.kind === 'conflict') {
        log('intake_idempotency_conflict');
        return respond(409, { ok: false, code: 'IDEMPOTENCY_CONFLICT', correlation_id: correlationId });
      }
      const body: PublicResult = { ok: true, status: result.kind, lead_ref: result.lead.id,
        dispatch_status: result.kind === 'accepted' ? 'pending' : 'previously_recorded' };
      log(result.kind === 'accepted' ? 'lead_committed' : 'lead_duplicate');
      return respond(result.kind === 'accepted' ? 202 : 200, body);
    } catch {
      log('intake_commit_failed');
      return respond(503, { ok: false, code: 'PERSISTENCE_UNAVAILABLE', correlation_id: correlationId });
    }
  };
}

export function isExactLeadContract(payload: LeadPayload): boolean {
  return Object.keys(payload).length === LEAD_FIELDS.length && LEAD_FIELDS.every((key) => Object.hasOwn(payload, key));
}
