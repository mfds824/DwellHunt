import { LISTING_SERVICE } from './listing-service-config.js';

export class ListingServiceError extends Error {
  constructor(code, fields) { super(code); this.code = code; this.fields = fields; }
}
export function createListingService(config = LISTING_SERVICE, fetcher = fetch, browserWindow = typeof window === 'undefined' ? null : window) {
  let session = null;
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());
  let serverAnchor = null, monotonicAnchor = 0;
  const ready = config.enabled === true && [config.apiUrl, config.supabaseUrl].every(value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
  }) && /^(sb_publishable_|eyJ)/.test(config.publishableKey || '');
  async function json(url, options = {}) {
    let result;
    try { result = await fetcher(url, { ...options, cache: 'no-store', signal: AbortSignal.timeout(20000) }); }
    catch { throw new ListingServiceError('CONNECTION_FAILED'); }
    let body; try { body = await result.json(); } catch { throw new ListingServiceError('SERVICE_UNAVAILABLE'); }
    if (!result.ok || body.ok === false) throw new ListingServiceError(body.code || 'REQUEST_FAILED', body.fields);
    return body;
  }
  function requireReady() { if (!ready) throw new ListingServiceError('WORKFLOW_NOT_CONNECTED'); }
  const authUrl = path => config.supabaseUrl.replace(/\/$/, '') + '/auth/v1/' + path;
  const apiUrl = path => config.apiUrl.replace(/\/$/, '') + '/api/dwellhunt/listings' + path;
  const authHeaders = { apikey: config.publishableKey, 'Content-Type': 'application/json' };
  async function request(path, body) {
    requireReady();
    if (!session || session.expiresAt <= Date.now()) { session = null; notify(); throw new ListingServiceError('SIGN_IN_REQUIRED'); }
    return json(apiUrl(path), { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function acceptAccessToken(accessToken, expiresIn = 3600) {
    const user = await json(authUrl('user'), { headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + accessToken } });
    if (!user.id || !user.email || !user.email_confirmed_at || user.is_anonymous) throw new ListingServiceError('VERIFIED_OWNER_REQUIRED');
    session = { token: accessToken, ownerId: user.id, email: user.email, expiresAt: Date.now() + Math.max(0, Number(expiresIn) || 0) * 1000 };
    notify();
    return { id: user.id };
  }
  return {
    ready,
    agentReady: ready && config.agentEnabled === true,
    account: () => session && session.expiresAt > Date.now() ? { id: session.ownerId, email: session.email } : null,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    agentProfile: () => request('/agent/profile'),
    saveAgentProfile: profile => request('/agent/profile', profile),
    dashboard: (offset = 0) => request('/agent/dashboard?offset=' + offset),
    enquiries: id => request('/' + encodeURIComponent(id) + '/enquiries'),
    signedIn: () => !!session && session.expiresAt > Date.now(),
    signOut() { session = null; notify(); },
    async restoreRedirectSession() {
      if (!browserWindow) return false;
      const params = new URLSearchParams((browserWindow.location.hash || '').replace(/^#/, ''));
      if (params.has('error') || params.has('error_code')) {
        browserWindow.history.replaceState(null, '', browserWindow.location.pathname + browserWindow.location.search);
        throw new ListingServiceError('SIGN_IN_LINK_FAILED');
      }
      const accessToken = params.get('access_token');
      if (!accessToken) return false;
      await acceptAccessToken(accessToken, params.get('expires_in'));
      browserWindow.history.replaceState(null, '', browserWindow.location.pathname + browserWindow.location.search);
      return true;
    },
    async sendCode(email) {
      requireReady();
      return json(authUrl('otp'), { method: 'POST', headers: authHeaders, body: JSON.stringify({ email: email.trim(), create_user: true }) });
    },
    async verifyCode(email, code) {
      requireReady();
      const body = await json(authUrl('verify'), { method: 'POST', headers: authHeaders, body: JSON.stringify({ email: email.trim(), token: code.trim(), type: 'email' }) });
      if (!body.access_token) throw new ListingServiceError('VERIFIED_OWNER_REQUIRED');
      // Tokens stay in memory. They are never saved with a draft or printed.
      return acceptAccessToken(body.access_token, body.expires_in);
    },
    findDraft: id => request('/by-draft/' + encodeURIComponent(id)),
    get: id => request('/' + encodeURIComponent(id)),
    async submit(draft, requestKey) {
      if (!requestKey) throw new ListingServiceError('REQUEST_KEY_REQUIRED');
      const result = await request('', { draft, requestKey });
      if (!result.listing?.listingId || !result.listing.submittedAt) throw new ListingServiceError('STORAGE_CONFIRMATION_MISSING');
      return result;
    },
    action: (record, action, payload, requestKey) => request('/' + encodeURIComponent(record.listingId) + '/actions/' + encodeURIComponent(action), { ...payload, expectedVersion: record.version, requestKey }),
    publicUrl: apiUrl,
    serverTime: () => serverAnchor === null ? Date.now() : serverAnchor + performance.now() - monotonicAnchor,
    async publicListings() {
      requireReady(); const result = await json(apiUrl('/public'));
      if (!Array.isArray(result.listings) || !Number.isFinite(Date.parse(result.serverNow))) throw new ListingServiceError('INVALID_PUBLIC_RESPONSE');
      serverAnchor = Date.parse(result.serverNow); monotonicAnchor = performance.now();
      return result.listings;
    },
  };
}
export const listingService = createListingService();
