/* Standalone adapter for the existing compiled React property detail view. */
(() => {
  'use strict';
  let loader;
  const attempts = new Map(); // Memory only: no buyer details in persistent storage.
  const errors = {
    HUMAN_VERIFICATION_FAILED: 'Verification was rejected. Complete a fresh CAPTCHA and retry.',
    HUMAN_VERIFICATION_REQUIRED: 'Complete verification before submitting.',
    INVALID_REQUEST: 'Check your name, email, international WhatsApp, country and consent.',
    TIMEZONE_CLARIFICATION_REQUIRED: 'Enter a valid IANA time zone, such as Asia/Colombo.',
    AMBIGUOUS_LOCAL_TIME: 'This time occurs twice. Expand clock-change clarification and enter the intended UTC offset.',
    NONEXISTENT_LOCAL_TIME: 'This time does not exist because clocks change. Choose another time.',
    INVALID_UTC_OFFSET: 'The UTC offset does not match this date and time zone.',
    INVALID_LOCAL_DATETIME: 'Choose a valid date and time.',
    OUTSIDE_VIEWING_HOURS: 'Choose a time within 17:00–22:00 Sri Lanka time, allowing 30 minutes.',
    OUTSIDE_BOOKING_WINDOW: 'Choose a time at least one hour ahead and within 90 days.',
    PROPERTY_UNAVAILABLE: 'This property is not registered or available for viewing. Contact the agent.',
    RATE_LIMITED: 'Too many requests. Please retry later.',
    BUSY_RETRY: 'The booking service is busy. Retry with the same details.',
    IDEMPOTENCY_KEY_REUSED: 'The request key was already used for different details. Close and contact the agent.',
    SERVICE_UNAVAILABLE: 'The booking service is unavailable. Retry with the same details.'
  };
  function loadCaptcha() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!loader) loader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Verification unavailable.'));
      script.onerror = () => { loader = null; script.remove(); reject(new Error('Verification could not load. Close and reopen to retry.')); };
      document.head.append(script);
    });
    return loader;
  }
  document.addEventListener('click', event => {
    const trigger = event.target.closest?.('[data-dh-viewing-id]');
    if (trigger) open({ id: trigger.dataset.dhViewingId, title: trigger.dataset.dhViewingTitle }, trigger);
  });
  function open(property, trigger) {
    if (document.getElementById('dh-viewing')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'dh-viewing';
    dialog.setAttribute('aria-labelledby', 'dh-viewing-heading');
    dialog.innerHTML = `<button class="dh-close" type="button" aria-label="Close booking form">Close</button>
      <h2 id="dh-viewing-heading">Book Virtual Viewing</h2><p class="dh-property"></p>
      <form>
      <label>Full name<input name="customer_name" required maxlength="120" autocomplete="name"></label>
      <label>Email<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
      <label>WhatsApp <small>(E.164, e.g. +94771234567)</small><input name="whatsapp" type="tel" required pattern="\\+[1-9][0-9]{7,14}" autocomplete="tel"></label>
      <label>Country<input name="country" required maxlength="80" autocomplete="country-name"></label>
      <label>Your IANA time zone<input name="buyer_timezone" required maxlength="80" placeholder="Asia/Colombo"></label>
      <label>Preferred date in your time zone<input name="preferred_date" type="date" required></label>
      <label>Preferred time in your time zone<input name="preferred_time" type="time" required step="60"></label>
      <p>Viewings last 30 minutes and run 17:00–22:00 Sri Lanka time. Choose at least one hour ahead, within 90 days. Agent approval is required.</p>
      <details><summary>Clock-change clarification (if requested)</summary><label>UTC offset in minutes east of UTC <small>(Colombo 330; New York winter -300)</small><input name="utc_offset_minutes" type="number" min="-840" max="840" step="1"></label></details>
      <label>Notes (optional)<textarea name="notes" maxlength="1500"></textarea></label>
      <div class="dh-honey" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
      <label><input name="consent" type="checkbox" required> I consent to booking emails, reminders and viewing follow-up.</label>
      <div class="dh-captcha"></div><button type="submit" disabled>Request virtual viewing</button>
      </form><p role="status" aria-live="polite" tabindex="-1"></p>`;
    dialog.querySelector('.dh-property').textContent = property.title;
    const form = dialog.querySelector('form'), status = dialog.querySelector('[role=status]');
    form.addEventListener('submit', event => event.preventDefault());
    const submit = form.querySelector('[type=submit]');
    let token = '', widget, busy = false, finished = false;
    const update = () => { submit.disabled = busy || finished || !token; };
    try { form.elements.buyer_timezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* Buyer enters zone. */ }
    dialog.querySelector('.dh-close').onclick = () => dialog.close();
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.addEventListener('close', () => {
      if (widget !== undefined) window.turnstile.remove(widget);
      dialog.remove(); trigger.focus();
    });
    document.body.append(dialog); dialog.showModal();
    const config = window.DWELLHUNT_VIEWING || {};
    let endpoint;
    try {
      endpoint = new URL(config.bookingUrl);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !endpoint.pathname.endsWith('/webhook/dwellhunt-virtual-viewing') || !config.turnstileSiteKey) throw Error();
    } catch {
      status.textContent = 'Virtual viewing booking is awaiting configuration. Please contact the property agent.';
      return;
    }
    loadCaptcha().then(api => {
      if (!dialog.isConnected) return;
      widget = api.render(dialog.querySelector('.dh-captcha'), {
        sitekey: config.turnstileSiteKey, action: 'booking',
        callback: value => { token = value; update(); },
        'expired-callback': () => { token = ''; update(); status.textContent = 'Verification expired. Complete it again.'; },
        'error-callback': () => { token = ''; update(); status.textContent = 'Verification failed. Retry the CAPTCHA or reopen this form.'; }
      });
    }).catch(() => { status.textContent = 'Verification could not load. Close and reopen this form to retry.'; });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || finished || !token || !form.reportValidity()) return;
      const payload = Object.fromEntries(new FormData(form));
      payload.consent = form.elements.consent.checked;
      payload.property_id = property.id;
      payload.property_title = property.title;
      payload.property_url = location.href.split(/[?#]/)[0];
      if (payload.utc_offset_minutes === '') delete payload.utc_offset_minutes;
      else payload.utc_offset_minutes = Number(payload.utc_offset_minutes);
      try { new Intl.DateTimeFormat('en', { timeZone: payload.buyer_timezone }).format(); }
      catch { status.textContent = errors.TIMEZONE_CLARIFICATION_REQUIRED; form.elements.buyer_timezone.focus(); return; }
      const signature = JSON.stringify(payload);
      let key = attempts.get(signature);
      if (!key) {
        key = Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('');
        attempts.set(signature, key);
      }
      busy = true; update(); status.textContent = 'Submitting your request…';
      dialog.querySelector('.dh-close').disabled = true;
      form.querySelectorAll('input,textarea').forEach(el => { el.disabled = true; });
      try {
        const response = await fetch(endpoint.href, {
          method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ ...payload, idempotency_key: key, turnstile_token: token }),
          signal: AbortSignal.timeout(70000)
        });
        const data = await response.json();
        if (!response.ok || data.ok !== true) throw new Error(errors[data.code] || `Booking rejected (${response.status}). Check your details or contact the agent.`);
        if (typeof data.booking_id !== 'string' || typeof data.status !== 'string') throw new Error('Unexpected booking response. Retry with the same details.');
        status.textContent = `Booking ${data.booking_id}: ${data.status.replaceAll('_', ' ')}. ${data.duplicate ? 'Your earlier request was found. ' : ''}${data.status === 'reschedule_requested' ? 'This slot is unavailable. Choose another date/time and submit again.' : 'Request recorded; await agent confirmation by email.'}`;
        finished = data.status !== 'reschedule_requested';
      } catch (error) {
        status.textContent = error instanceof TypeError || error.name === 'TimeoutError' || error instanceof SyntaxError
          ? 'No reliable response was received. Your request may have arrived. Retry the same details with fresh verification to avoid a duplicate.' : error.message;
      } finally {
        busy = false; token = '';
        form.querySelectorAll('input,textarea').forEach(el => { el.disabled = finished; });
        dialog.querySelector('.dh-close').disabled = false;
        if (widget !== undefined) window.turnstile.reset(widget);
        update(); status.focus();
      }
    });
  }
})();
