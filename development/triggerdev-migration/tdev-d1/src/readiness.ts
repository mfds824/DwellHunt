export type Workflow01Bindings = Readonly<{
  durableRepository: boolean;
  authorization: boolean;
  rateLimiter: boolean;
  triggerClient: boolean;
  triggerTaskDiscovered: boolean;
  downstreamCompatibility: boolean;
  legacyWorkflowVerified: boolean;
  migrationApproved: boolean;
}>;

const required: readonly (keyof Workflow01Bindings)[] = [
  'durableRepository', 'authorization', 'rateLimiter', 'triggerClient', 'triggerTaskDiscovered',
  'downstreamCompatibility', 'legacyWorkflowVerified', 'migrationApproved',
];

/** Health is process liveness only; it deliberately does not imply dependencies or workflow readiness. */
export function livenessResponse(): Response {
  return new Response(JSON.stringify({ status: 'alive' }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/** Readiness is false until every server-side dependency and workflow compatibility gate is reviewed. */
export function readinessResponse(bindings: Partial<Workflow01Bindings>): Response {
  const ready = required.every((key) => bindings[key] === true);
  return new Response(JSON.stringify({ status: ready ? 'ready' : 'not_ready' }), {
    status: ready ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const requiredServerEnvironmentNames = Object.freeze([
  'DWELLHUNT_WF01_DATABASE_URL',
  'DWELLHUNT_WF01_TRIGGER_SECRET_KEY',
  'DWELLHUNT_WF01_TRIGGER_PROJECT_REF',
  'DWELLHUNT_WF01_ALLOWED_ORIGINS',
  'DWELLHUNT_WF01_AUTH_ADAPTER',
  'DWELLHUNT_WF01_RATE_LIMIT_ADAPTER',
  'DWELLHUNT_WF01_DOWNSTREAM_ADAPTER',
]);
