/* DwellHunt booking and private management forms. Secrets stay on the server. */
(() => {
  'use strict';
  const attempts = new Map();
  let loader;
  const errors = {
    HUMAN_VERIFICATION_REQUIRED: 'Complete a fresh verification before submitting.',
    HUMAN_VERIFICATION_FAILED: 'Verification was rejected. Refresh verification and try again.',
    INVALID_REQUEST: 'Check your contact details and consent.',
    INVALID_LOCAL_DATETIME: 'Choose a valid date and time.',
    OUTSIDE_BOOKING_WINDOW: 'Choose a time at least one hour ahead and within 90 days.',
    OUTSIDE_VIEWING_HOURS: 'Choose a 30-minute slot between 09:00 and 18:00 Sri Lanka time.',
    TIMEZONE_CLARIFICATION_REQUIRED: 'Enter a valid time zone, such as Asia/Colombo.',
    AMBIGUOUS_LOCAL_TIME: 'This time occurs twice. Enter its UTC offset under clock-change clarification.',
    NONEXISTENT_LOCAL_TIME: 'Clocks change at this time. Choose another time.',
    INVALID_UTC_OFFSET: 'The UTC offset does not match this date and time zone.',
    PROPERTY_UNAVAILABLE: 'This property is not available for virtual viewing. Contact DwellHunt.',
    DEV_TEST_ROUTING_REQUIRED: 'This Development site currently accepts only the configured test contact.',
    INVALID_OR_EXPIRED_LINK: 'This private booking link is invalid or expired. Contact DwellHunt.',
    VIEWING_NOT_COMPLETED: 'Feedback is available after your agent marks the viewing completed.',
    INVALID_CANCELLATION_STATE: 'This booking can no longer be cancelled from this form.',
    INVALID_FEEDBACK_INTENT: 'Choose your preferred next step.',
    FEEDBACK_ALREADY_SUBMITTED: 'Feedback has already been recorded for this viewing.',
    RATE_LIMITED: 'Too many requests. Please try again later.',
    BUSY_RETRY: 'The service is busy. Check your email before trying again with the same details.',
    SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Check your email before trying again.',
    IDEMPOTENCY_KEY_REUSED: 'Your request details changed. Close this form and contact DwellHunt.'
  };
  const icon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3"/></svg>';
  function loadCaptcha() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!loader) loader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => window.turnstile ? resolve(window.turnstile) : (loader = null, reject(new Error('Verification unavailable.')));
      script.onerror = () => { loader = null; script.remove(); reject(new Error('Verification could not load.')); };
      document.head.append(script);
    });
    return loader;
  }
  function toast(message) {
    document.getElementById('dh-viewing-toast')?.remove();
    const box = document.createElement('aside');
    box.id = 'dh-viewing-toast'; box.setAttribute('role', 'status');
    const text = document.createElement('p'); text.textContent = message;
    const dismiss = document.createElement('button'); dismiss.type = 'button';
    dismiss.textContent = 'Dismiss'; dismiss.onclick = () => box.remove();
    box.append(text, dismiss); document.body.append(box);
  }
  const contactFields = `<fieldset><legend><span>01</span> Your details</legend><div class="dh-grid">
    <label class="dh-wide">Full name<input name="customer_name" required maxlength="120" autocomplete="name" placeholder="Your full name"></label>
    <label>Email<input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"></label>
    <label>WhatsApp<input name="whatsapp" type="tel" required pattern="\\+[1-9][0-9]{7,14}" autocomplete="tel" placeholder="+94771234567"><small>Include your country code.</small></label>
    <label>Country<input name="country" required maxlength="80" autocomplete="country-name" placeholder="Country of residence"></label>
    <label>Your time zone<input name="buyer_timezone" required maxlength="80" placeholder="Asia/Colombo"></label></div></fieldset>
    <fieldset><legend><span>02</span> Choose your time</legend><div class="dh-grid">
    <label>Preferred date<input name="preferred_date" type="date" required></label>
    <label>Preferred time<input name="preferred_time" type="time" required step="60"></label></div>
    <p class="dh-hint">Enter your local date and time. Book at least one hour ahead, within 90 days.</p>
    <details><summary>Clock-change clarification</summary><label>UTC offset in minutes<small>Only needed if your chosen time occurs twice. Colombo: 330; New York in winter: −300.</small><input name="utc_offset_minutes" type="number" min="-840" max="840" step="1"></label></details></fieldset>
    <fieldset><legend><span>03</span> Anything we should know?</legend>
    <label>Notes <small>(optional)</small><textarea name="notes" maxlength="1500" rows="2" placeholder="Questions or preferences for your viewing"></textarea></label></fieldset>`;
  const manageFields = `<fieldset><legend>Your next step</legend><label>What would you like to do?<select name="operation"><option value="cancel">Cancel my viewing</option><option value="feedback">Share viewing feedback</option></select></label>
    <div class="dh-feedback" hidden><label>How can we help next?<select name="intent"><option value="">Choose a next step</option><option value="offer">Make an offer</option><option value="physical_visit">Arrange a physical visit</option><option value="another_property">Explore another property</option><option value="more_information">Request more information</option><option value="not_interested">Not interested</option></select></label>
    <label>Feedback <small>(optional)</small><textarea name="feedback" rows="3" maxlength="1500"></textarea></label></div>
    <p class="dh-hint">Feedback is available after your viewing is marked completed. To reschedule, cancel and submit a new request.</p></fieldset>`;
  function open({ property, management, trigger }) {
    if (document.getElementById('dh-viewing')) return;
    if(!management && Array.isArray(window.DWELLHUNT_VIEWING?.availablePropertyIds) && !window.DWELLHUNT_VIEWING.availablePropertyIds.includes(property.id)){toast('Virtual viewing is not available for this property.');return;}
    const dialog = document.createElement('dialog'); dialog.id = 'dh-viewing';
    dialog.setAttribute('aria-labelledby', 'dh-viewing-heading');
    dialog.innerHTML = `<header class="dh-form-header"><div class="dh-eyebrow">${icon}<span>DWELLHUNT VIRTUAL VIEWINGS</span></div><button class="dh-close" type="button" aria-label="Close booking form">×</button>
      <h2 id="dh-viewing-heading">${management ? 'Manage your viewing' : 'A closer look. Wherever you are.'}</h2><p>${management ? 'Your private booking, in your control.' : 'Meet your agent online and explore the details that matter.'}</p></header>
      <div class="dh-form-content"><div class="dh-property-card"><span>${management ? 'YOUR BOOKING' : 'YOUR SELECTED PROPERTY'}</span><strong class="dh-property"></strong>${management ? '' : '<small>30 minutes · 09:00–18:00 Sri Lanka time</small>'}</div>
      ${window.DWELLHUNT_VIEWING?.testMode ? '<p class="dh-test-notice" role="note">Test booking only — use your verified DwellHunt test contact. This is not a live customer booking service.</p>' : ''}<form>${management ? manageFields : contactFields}<div class="dh-honey" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
      <label class="dh-check"><input name="consent" type="checkbox" required><span>${management ? 'I confirm that I want to submit this booking change.' : 'I consent to booking emails, reminders and viewing follow-up.'}</span></label>
      <label class="dh-check dh-auto-close"><input name="auto_close" type="checkbox" checked><span>Close this form after a successful request.</span></label>
      <div class="dh-verification"><div class="dh-captcha"></div><button class="dh-refresh" type="button">Refresh verification</button></div>
      <button class="dh-submit" type="submit" disabled>${management ? 'Submit booking change' : 'Request virtual viewing'}<span aria-hidden="true">↗</span></button>
      <p class="dh-privacy">${management ? 'Your private link and verification protect this request.' : 'Your request is confirmed only after agent approval.'}</p></form>
      <section class="dh-result" hidden><p role="status" aria-live="polite" tabindex="-1"></p><p class="dh-countdown" hidden></p><button class="dh-keep-open" type="button" hidden>Keep open</button></section></div>`;
    dialog.querySelector('.dh-property').textContent = management ? management.id : property.title;
    const form = dialog.querySelector('form'), status = dialog.querySelector('[role=status]');
    const result = dialog.querySelector('.dh-result'), submit = dialog.querySelector('[type=submit]');
    const close = dialog.querySelector('.dh-close'), refresh = dialog.querySelector('.dh-refresh');
    let token = '', widget, busy = false, finished = false, timer, outcome = '';
    const update = () => { submit.disabled = busy || finished || !token; refresh.disabled = busy || finished; };
    const message = (text, kind = 'error') => { result.hidden = false; result.dataset.kind = kind; status.textContent = text; };
    const keepOpen = () => { clearInterval(timer); dialog.querySelector('.dh-countdown').hidden = true; dialog.querySelector('.dh-keep-open').hidden = true; };
    dialog.querySelector('.dh-keep-open').onclick = keepOpen;
    function autoClose() {
      if (!form.elements.auto_close.checked) return;
      let seconds = 5;
      const countdown = dialog.querySelector('.dh-countdown'); countdown.hidden = false;
      countdown.textContent = `Closing in ${seconds} seconds.`; dialog.querySelector('.dh-keep-open').hidden = false;
      timer = setInterval(() => { seconds--; countdown.textContent = `Closing in ${seconds} seconds.`; if (seconds <= 0) dialog.close(); }, 1000);
    }
    form.noValidate = true;
    if (!management) { try { form.elements.buyer_timezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {} }
    else form.elements.operation.onchange = () => { const feedback = form.elements.operation.value === 'feedback'; dialog.querySelector('.dh-feedback').hidden = !feedback; form.elements.intent.required = feedback; };
    close.onclick = () => dialog.close();
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.addEventListener('close', () => {
      clearInterval(timer);
      try { if (widget !== undefined && window.turnstile) window.turnstile.remove(widget); } catch {}
      dialog.remove(); trigger?.focus(); if (outcome) toast(outcome);
    });
    document.body.append(dialog); dialog.showModal();
    const config = window.DWELLHUNT_VIEWING || {};
    let endpoint;
    try {
      endpoint = new URL(management ? config.buyerActionsUrl : config.bookingUrl);
      const path = management ? '/api/dwellhunt/buyer-actions' : '/api/dwellhunt/bookings';
      if (endpoint.protocol !== 'https:' || !['dwellhunt-viewing-api-dev.countdracula-11537.workers.dev','dwellhunt-viewing-api-production.countdracula-11537.workers.dev'].includes(endpoint.hostname) || endpoint.pathname !== path || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !config.turnstileSiteKey) throw Error();
    } catch { message('This form is awaiting configuration. Please contact DwellHunt.'); return; }
    refresh.onclick = () => { token = ''; update(); try { if (widget !== undefined) window.turnstile.reset(widget); else { loader = null; renderCaptcha(); } } catch { message('Verification could not refresh. Close and reopen this form.', 'verification'); } };
    function renderCaptcha() { loadCaptcha().then(api => {
      if (!dialog.isConnected) return;
      widget = api.render(dialog.querySelector('.dh-captcha'), {
        sitekey: config.turnstileSiteKey, action: management ? 'manage' : 'booking',
        'response-field': false, theme: 'light', size: 'flexible',
        callback: value => { if (!busy && !finished) { token = value; update(); if(result.dataset.kind==='verification'){result.hidden=true;status.textContent='';} } },
        'expired-callback': () => { if (!busy && !finished) { token = ''; update(); message('Verification expired. Refresh verification before submitting.', 'verification'); } },
        'error-callback': () => { if (!busy && !finished) { token = ''; update(); message('Verification could not complete. Refresh it or reopen this form.', 'verification'); } }
      });
    }).catch(() => message('Verification could not load. Use Refresh verification to try again.', 'verification')); }
    renderCaptcha();
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || finished) return;
      if (!form.reportValidity()) { message('Complete the required details and consent before submitting.'); status.focus(); return; }
      let currentToken = '';
      try { currentToken = widget === undefined ? '' : window.turnstile.getResponse(widget); }
      catch { token = ''; update(); message('Verification could not be read. Refresh verification and try again.', 'verification'); status.focus(); return; }
      if (!token || !currentToken) { token = ''; update(); message('Complete fresh verification before submitting.', 'verification'); status.focus(); return; }
      const payload = Object.fromEntries(new FormData(form));
      delete payload.auto_close; delete payload['cf-turnstile-response']; delete payload.turnstile_token;
      payload.consent = form.elements.consent.checked;
      if (management) { payload.booking_id = management.id; payload.manage_token = management.token; if (payload.operation !== 'feedback') { delete payload.feedback; delete payload.intent; } }
      else {
        payload.property_id = property.id; payload.property_title = property.title; payload.property_url = location.href.split(/[?#]/)[0];
        if (payload.utc_offset_minutes === '') delete payload.utc_offset_minutes; else payload.utc_offset_minutes = Number(payload.utc_offset_minutes);
        try { new Intl.DateTimeFormat('en', { timeZone: payload.buyer_timezone }).format(); } catch { message(errors.TIMEZONE_CLARIFICATION_REQUIRED); form.elements.buyer_timezone.focus(); return; }
        const signature = JSON.stringify(payload); let key = attempts.get(signature);
        if (!key) { key = Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join(''); attempts.set(signature, key); }
        payload.idempotency_key = key;
      }
      busy = true; update(); close.disabled = true; form.setAttribute('aria-busy', 'true');
      form.querySelectorAll('input,textarea,select').forEach(el => { el.disabled = true; }); message('Sending your request…', 'pending');
      try {
        const response = await fetch(endpoint.href, {method:'POST', credentials:'omit', referrerPolicy:'no-referrer', headers:{'Content-Type':'text/plain;charset=UTF-8'}, body:JSON.stringify({...payload,turnstile_token:currentToken}), signal:AbortSignal.timeout(70000)});
        const data = await response.json();
        if (!response.ok || data.ok !== true) throw new Error(errors[data.code] || 'Your request was not accepted. Check the details or contact DwellHunt.');
        if (typeof data.status !== 'string' || (!management && typeof data.booking_id !== 'string')) throw new Error('The result could not be confirmed. Check your email before trying again.');
        finished = data.status !== 'reschedule_requested';
        outcome = management ? (data.status === 'cancelling' || data.status === 'cancelled' ? 'Cancellation request recorded. Watch your email for confirmation.' : 'Thank you. Your feedback has been recorded.') : (data.status === 'reschedule_requested' ? '' : `Viewing request received. Reference: ${data.booking_id}. Watch your email for agent confirmation.`);
        message(outcome || 'This time is unavailable. Choose another slot and submit with fresh verification.', finished ? 'success' : 'error');
        if (finished) { form.hidden = true; autoClose(); }
      } catch (error) {
        message(error instanceof TypeError || error.name === 'TimeoutError' || error instanceof SyntaxError ? 'No reliable response was received. Your request may have arrived. Check your email before trying again with the same details.' : error.message);
      } finally {
        busy = false; token = ''; close.disabled = false; form.removeAttribute('aria-busy');
        form.querySelectorAll('input,textarea,select').forEach(el => { el.disabled = finished; });
        if (!finished && widget !== undefined) { try { window.turnstile.reset(widget); } catch { message(status.textContent + ' Close and reopen the form to refresh verification.'); } }
        update(); status.focus();
      }
    });
  }
  document.addEventListener('click', event => { const trigger = event.target.closest?.('[data-dh-viewing-id]'); if (trigger) open({property:{id:trigger.dataset.dhViewingId,title:trigger.dataset.dhViewingTitle},trigger}); });
  function openPrivateLink() {
    const params = new URLSearchParams(location.hash.slice(1));
    const id = params.get('dwellhunt-booking'), token = params.get('token');
    if (!id || !token) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (!/^dh[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(token)) { toast('This private booking link is invalid. Contact DwellHunt.'); return; }
    open({management:{id,token}});
  }
  window.addEventListener('hashchange', openPrivateLink); openPrivateLink();
})();
