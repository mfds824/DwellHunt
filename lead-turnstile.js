/* Adds a Cloudflare human check to the enquiry form and the "Report this listing" form, and sends them to the DwellHunt Production Worker. */
(() => {
  'use strict';
  const config = window.DWELLHUNT_VIEWING || {};
  const originalFetch = window.fetch.bind(window);
  let loader;

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!loader) loader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Verification unavailable.'));
      script.onerror = () => { loader = null; script.remove(); reject(new Error('Verification could not load.')); };
      document.head.append(script);
    });
    return loader;
  }

  function verifyLead(kind = LEAD) {
    if (!config.turnstileSiteKey) return Promise.reject(new Error('Lead submission is awaiting staging verification setup.'));
    return new Promise((resolve, reject) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'dh-lead-verification';
      dialog.setAttribute('aria-labelledby', 'dh-lead-verification-title');
      const heading = document.createElement('h2');
      heading.id = 'dh-lead-verification-title';
      heading.textContent = kind.title;
      const message = document.createElement('p');
      message.textContent = kind.message;
      const widgetHost = document.createElement('div');
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      dialog.append(heading, message, widgetHost, cancel);
      let widget;
      let settled = false;
      let timer;
      const finish = (error, token) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (widget !== undefined && window.turnstile) window.turnstile.remove(widget);
        dialog.close();
        dialog.remove();
        if (error) reject(error); else resolve(token);
      };
      cancel.addEventListener('click', () => finish(new Error('Verification was cancelled.')));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(new Error('Verification was cancelled.')); });
      document.body.append(dialog);
      dialog.showModal();
      timer = setTimeout(() => finish(new Error('Verification timed out.')), 120_000);
      loadTurnstile().then(api => {
        if (settled) return;
        widget = api.render(widgetHost, {
          sitekey: config.turnstileSiteKey,
          action: kind.action,
          callback: token => finish(null, token),
          'error-callback': () => finish(new Error('Verification failed. Please retry.')),
          'expired-callback': () => { message.textContent = 'Verification expired. Please close and retry your enquiry.'; }
        });
      }).catch(error => finish(error));
    });
  }

  const LEAD = { action: 'lead', title: 'Verify your enquiry', message: 'Complete the security check to send your enquiry.' };
  const REPORT = { action: 'listing_report', title: 'Verify your report', message: 'Complete the security check to send your report.' };
  const allowed = (value, path) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'dwellhunt-viewing-api-production.countdracula-11537.workers.dev' ||
          url.pathname !== path || url.search || url.hash || url.username || url.password) return null;
      return url.href;
    } catch { return null; }
  };
  const target = allowed(config.leadUrl, '/api/dwellhunt/leads');
  const reportTarget = allowed(config.listingReportUrl, '/api/dwellhunt/listing-report');

  window.fetch = async (input, init = {}) => {
    const requested = input instanceof Request ? input.url : String(input);
    const kind = target && requested === target ? LEAD : reportTarget && requested === reportTarget ? REPORT : null;
    if (!kind) return originalFetch(input, init);
    if (typeof init.body !== 'string') throw new Error('Invalid request. Please retry.');
    const payload = JSON.parse(init.body);
    const token = await verifyLead(kind);
    return originalFetch(requested, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ...payload, turnstile_token: token })
    });
  };
})();
