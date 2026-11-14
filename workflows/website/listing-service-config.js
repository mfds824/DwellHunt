// Public configuration only. Enable after the deployed synthetic acceptance checks.
// Never put a Supabase service/secret key or gateway credentials in this file.
export const LISTING_SERVICE = Object.freeze({
  enabled: false,
  agentEnabled: false,
  apiUrl: '',
  supabaseUrl: '',
  publishableKey: '',
});
