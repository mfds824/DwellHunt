/* "List a property" page: a "Who's listing today?" chooser with agents first, the agent application, email-code
 * sign-in and the agent dashboard. Agents send listings through the owner form (owner-listing.js) with their session,
 * so every listing joins the same DwellHunt review. The backend is the Worker's /api/dwellhunt/agents/* routes. */
const SESSION_KEY = 'dwellhunt_agent_session';
const WHATSAPP_URL = 'https://wa.me/94770153678?text=' + encodeURIComponent('Hi DwellHunt, I would like to list a property development.');

export function loadAgentSession(storage = globalThis.localStorage) {
  try {
    const s = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
    if (s && /^[a-f0-9]{64}$/.test(s.session) && Date.parse(s.expires) > Date.now() && s.agent) return s;
  } catch { /* nothing saved, or storage unavailable */ }
  return null;
}
export function saveAgentSession(value, storage = globalThis.localStorage) { try { storage.setItem(SESSION_KEY, JSON.stringify(value)); } catch { /* private mode */ } }
export function clearAgentSession(storage = globalThis.localStorage) { try { storage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

/** Friendly text for backend codes. */
export function agentMessage(code) {
  return ({
    HUMAN_VERIFICATION_REQUIRED: 'The security check expired or failed. Please complete it again.',
    INVALID_REQUEST: 'Some details need checking. Please review the highlighted fields.',
    INVALID_CODE: 'That code is not right. Check the latest email from DwellHunt and try again.',
    CODE_EXPIRED: 'That code has expired. Ask for a new code.',
    CODE_LOCKED: 'Too many wrong tries. Ask for a new code.',
    SIGNED_OUT: 'Your sign-in has ended. Please sign in again.',
    RATE_LIMITED: 'Too many requests just now. Please try again later.',
  })[code] || 'Something went wrong on our side. Please try again in a few minutes, or message us on WhatsApp.';
}

/** POSTs to an agent route and returns the JSON body. Throws an Error whose message is safe to show. */
export async function agentCall(path, body, fetchImpl = fetch) {
  const base = (globalThis.window?.DWELLHUNT_VIEWING || {}).agentApiUrl;
  if (!base) throw Object.assign(new Error('Agent accounts are being set up. Please try again soon.'), { code: 'NOT_CONFIGURED' });
  let response;
  try {
    response = await fetchImpl(base.replace(/\/$/, '') + '/' + path, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) });
  } catch { throw Object.assign(new Error('We could not reach DwellHunt. Check your connection and try again.'), { code: 'NETWORK' }); }
  let data = {};
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok || data.ok !== true) throw Object.assign(new Error(agentMessage(data.code)), { code: data.code || 'SERVICE_UNAVAILABLE', fields: data.fields });
  return data;
}

/** Splits "+94771234567" for the owner form's country-code and number fields. */
export function phoneParts(phone) {
  const p = String(phone || '');
  return p.startsWith('+94') ? { countryCode: '+94', phoneNumber: p.slice(3) } : { countryCode: '', phoneNumber: '' };
}
export const AGENT_STATUS_LABELS = { 'pending review': 'In review', 'changes requested': 'Changes requested', published: 'Live',
  rejected: 'Not approved', expired: 'Ended', withdrawn: 'Closed' };
const niceDate = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };

export function createListPropertyPage(React, { OwnerStart, OwnerListing, createOwnerDraft }) {
  const h = React.createElement;
  const primary = 'dh-agent-primary', secondary = 'dh-agent-secondary';

  /** Cloudflare human check for one action; returns [token, reset]. */
  function useHumanCheck(ref, action, active) {
    const [token, setToken] = React.useState('');
    const widget = React.useRef(null);
    React.useEffect(() => {
      const config = window.DWELLHUNT_VIEWING || {};
      if (!active || !ref.current || !config.turnstileSiteKey) return;
      let cancelled = false;
      const load = () => window.turnstile ? Promise.resolve(window.turnstile) : new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
        s.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('unavailable')); s.onerror = reject; document.head.append(s);
      });
      load().then(api => {
        if (cancelled || !ref.current) return;
        widget.current = api.render(ref.current, { sitekey: config.turnstileSiteKey, action, theme: 'light', size: 'flexible',
          callback: setToken, 'expired-callback': () => setToken(''), 'error-callback': () => setToken('') });
      }).catch(() => { /* the send button explains that the check is needed */ });
      return () => { cancelled = true; try { if (widget.current !== null && window.turnstile) window.turnstile.remove(widget.current); } catch { /* ignore */ } widget.current = null; setToken(''); };
    }, [active, action]);
    const reset = () => { setToken(''); try { if (widget.current !== null) window.turnstile?.reset(widget.current); } catch { /* ignore */ } };
    return [token, reset];
  }

  const input = (id, label, value, onChange, extra = {}) => h('div', { className: 'dh-agent-field' },
    h('label', { htmlFor: id }, label), h('input', { id, value, onChange: e => onChange(e.target.value), ...extra }));
  const shell = (...children) => h('div', { className: 'dh-owner dh-agent py-12 bg-stone-50 min-h-screen' }, h('div', { className: 'dh-agent-wrap' }, ...children));

  function SignIn({ onSignedIn, onApply, onBack }) {
    const [email, setEmail] = React.useState('');
    const [code, setCode] = React.useState('');
    const [step, setStep] = React.useState('email');
    const [state, setState] = React.useState({ busy: false, message: '' });
    const check = React.useRef(null);
    const [token, reset] = useHumanCheck(check, 'agent_signin', step === 'email');
    const askCode = async event => {
      event.preventDefault();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setState({ busy: false, message: 'Enter the email address you applied with.' }); return; }
      if (!token) { setState({ busy: false, message: 'Please complete the security check.' }); return; }
      setState({ busy: true, message: '' });
      try { await agentCall('code', { email: email.trim(), turnstile_token: token }); setStep('code'); setState({ busy: false, message: '' }); }
      catch (error) { reset(); setState({ busy: false, message: error.message }); }
    };
    const verify = async event => {
      event.preventDefault();
      if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) { setState({ busy: false, message: 'Enter the 6-digit code from the email.' }); return; }
      setState({ busy: true, message: '' });
      try {
        const r = await agentCall('verify', { email: email.trim(), code: code.replace(/\s/g, '') });
        const session = { session: r.session, expires: r.expires, agent: r.agent };
        saveAgentSession(session); onSignedIn(session);
      } catch (error) { setState({ busy: false, message: error.message }); if (['CODE_EXPIRED', 'CODE_LOCKED'].includes(error.code)) { setCode(''); setStep('email'); } }
    };
    return shell(
      h('button', { type: 'button', className: 'dh-agent-back', onClick: onBack }, '← Back'),
      h('section', { className: 'dh-agent-card' },
        h('p', { className: 'dh-agent-eyebrow' }, 'Agent portal'),
        h('h1', null, step === 'email' ? 'Sign in as an agent' : 'Check your email'),
        step === 'email'
          ? h('form', { onSubmit: askCode, noValidate: true, className: 'dh-agent-form' },
              h('p', { className: 'dh-agent-lead' }, 'Enter the email you applied with. We’ll send you a 6-digit code — there’s no password to remember.'),
              input('dh-agent-signin-email', 'Email address', email, setEmail, { type: 'email', autoComplete: 'email', required: true }),
              h('div', { ref: check, className: 'dh-captcha', 'aria-label': 'Security check' }),
              state.message && h('p', { role: 'alert', className: 'dh-agent-error' }, state.message),
              h('button', { type: 'submit', className: primary, disabled: state.busy }, state.busy ? 'Sending…' : 'Email me a code'))
          : h('form', { onSubmit: verify, noValidate: true, className: 'dh-agent-form' },
              h('p', { className: 'dh-agent-lead' }, `If ${email.trim()} has an approved agent account, a 6-digit code is on its way. It expires in 10 minutes.`),
              input('dh-agent-code', '6-digit code', code, setCode, { inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 7, required: true }),
              state.message && h('p', { role: 'alert', className: 'dh-agent-error' }, state.message),
              h('button', { type: 'submit', className: primary, disabled: state.busy }, state.busy ? 'Checking…' : 'Sign in'),
              h('button', { type: 'button', className: 'dh-agent-link', onClick: () => { setStep('email'); setCode(''); setState({ busy: false, message: '' }); } }, 'Use a different email or send a new code')),
        h('p', { className: 'dh-agent-foot' }, 'New to DwellHunt? ', h('button', { type: 'button', className: 'dh-agent-link', onClick: onApply }, 'Apply for an agent account →'))));
  }

  function Apply({ onSignIn, onBack }) {
    const [f, setF] = React.useState({ name: '', agency: '', email: '', countryCode: '+94', phoneNumber: '', registrationNo: '', consent: false });
    const [state, setState] = React.useState({ busy: false, message: '', fields: [], done: false });
    const check = React.useRef(null), honeypot = React.useRef(null);
    const [token, reset] = useHumanCheck(check, 'agent_signup', !state.done);
    const set = key => value => setF(old => ({ ...old, [key]: value }));
    const phone = (f.countryCode + f.phoneNumber.replace(/^0/, '')).replace(/[\s()-]/g, '');
    const submit = async event => {
      event.preventDefault();
      const missing = [];
      if (f.name.trim().length < 2) missing.push('name');
      if (f.agency.trim().length < 2) missing.push('agency');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) missing.push('email');
      if (!/^\+[1-9]\d{6,14}$/.test(phone)) missing.push('phone');
      if (!f.consent) missing.push('consent');
      if (missing.length) { setState({ busy: false, message: 'Please complete the highlighted fields.', fields: missing, done: false }); return; }
      if (!token) { setState({ busy: false, message: 'Please complete the security check.', fields: [], done: false }); return; }
      setState({ busy: true, message: '', fields: [], done: false });
      try {
        await agentCall('signup', { name: f.name.trim(), agency: f.agency.trim(), email: f.email.trim(), phone, registrationNo: f.registrationNo.trim(),
          consent: true, turnstile_token: token, website: honeypot.current?.value || '' });
        setState({ busy: false, message: '', fields: [], done: true });
      } catch (error) { reset(); setState({ busy: false, message: error.message, fields: error.fields || [], done: false }); }
    };
    const bad = key => state.fields.includes(key) || undefined;
    if (state.done) return shell(h('section', { className: 'dh-agent-card dh-agent-center' },
      h('div', { className: 'dh-agent-icon', 'aria-hidden': 'true' }, '✓'),
      h('h1', null, 'Application received'),
      h('p', { className: 'dh-agent-lead' }, `Thank you, ${f.name.trim()}. Our team will check your details, usually within 1 working day, and may call or WhatsApp you. We’ll email ${f.email.trim()} as soon as your account is approved.`),
      h('button', { type: 'button', className: secondary, onClick: onSignIn }, 'Go to agent sign-in')));
    return shell(
      h('button', { type: 'button', className: 'dh-agent-back', onClick: onBack }, '← Back'),
      h('section', { className: 'dh-agent-card' },
        h('p', { className: 'dh-agent-eyebrow' }, 'Agent portal'),
        h('h1', null, 'Apply for an agent account'),
        h('p', { className: 'dh-agent-lead' }, 'DwellHunt checks every agent before they can list. Once approved, you sign in with a code sent to your email.'),
        h('form', { onSubmit: submit, noValidate: true, className: 'dh-agent-form' },
          input('dh-agent-name', 'Your full name', f.name, set('name'), { autoComplete: 'name', 'aria-invalid': bad('name') }),
          input('dh-agent-agency', 'Agency or company name', f.agency, set('agency'), { autoComplete: 'organization', 'aria-invalid': bad('agency') }),
          input('dh-agent-email', 'Work email', f.email, set('email'), { type: 'email', autoComplete: 'email', 'aria-invalid': bad('email') }),
          h('div', { className: 'dh-agent-field' }, h('label', { htmlFor: 'dh-agent-phone' }, 'Phone / WhatsApp'),
            h('div', { className: 'dh-agent-phone' },
              h('input', { 'aria-label': 'Country code', value: f.countryCode, onChange: e => set('countryCode')(e.target.value), maxLength: 5, className: 'dh-agent-cc' }),
              h('input', { id: 'dh-agent-phone', type: 'tel', value: f.phoneNumber, onChange: e => set('phoneNumber')(e.target.value), autoComplete: 'tel-national', placeholder: '77 123 4567', 'aria-invalid': bad('phone') }))),
          input('dh-agent-reg', 'Agent registration number (optional)', f.registrationNo, set('registrationNo'), { maxLength: 40 }),
          h('label', { className: 'dh-agent-consent', 'data-invalid': bad('consent') },
            h('input', { type: 'checkbox', checked: f.consent, onChange: e => set('consent')(e.target.checked) }),
            h('span', null, 'DwellHunt may use these details to check my application and contact me, as described in the ', h('a', { href: './privacy.html', target: '_blank', rel: 'noopener noreferrer' }, 'privacy policy'), '.')),
          h('div', { className: 'dh-hp', 'aria-hidden': 'true' }, h('label', null, 'Leave empty', h('input', { ref: honeypot, type: 'text', tabIndex: -1, autoComplete: 'off', defaultValue: '' }))),
          h('div', { ref: check, className: 'dh-captcha', 'aria-label': 'Security check' }),
          state.message && h('p', { role: 'alert', className: 'dh-agent-error' }, state.message),
          h('button', { type: 'submit', className: primary, disabled: state.busy }, state.busy ? 'Sending…' : 'Send application')),
        h('p', { className: 'dh-agent-foot' }, 'Already approved? ', h('button', { type: 'button', className: 'dh-agent-link', onClick: onSignIn }, 'Sign in →'))));
  }

  function Dashboard({ session, onCreate, onSignedOut }) {
    const [data, setData] = React.useState({ loading: true, listings: [], message: '' });
    React.useEffect(() => {
      let live = true;
      agentCall('me', { session: session.session })
        .then(r => { if (live) setData({ loading: false, listings: r.listings || [], message: '' }); })
        .catch(error => { if (!live) return; if (error.code === 'SIGNED_OUT') { clearAgentSession(); onSignedOut(); } else setData({ loading: false, listings: [], message: error.message }); });
      return () => { live = false; };
    }, [session.session]);
    const signOut = () => { agentCall('signout', { session: session.session }).catch(() => {}); clearAgentSession(); onSignedOut(); };
    const a = session.agent || {};
    return shell(
      h('section', { className: 'dh-agent-card' },
        h('div', { className: 'dh-agent-dash-head' },
          h('div', null, h('p', { className: 'dh-agent-eyebrow' }, 'Agent portal · ✓ Verified agent'),
            h('h1', null, a.name || 'Your dashboard'), h('p', { className: 'dh-agent-lead' }, `${a.agency || ''}${a.id ? ' · ' + a.id : ''}`)),
          h('div', { className: 'dh-agent-dash-actions' },
            h('button', { type: 'button', className: primary, onClick: onCreate }, '+ New listing'),
            h('button', { type: 'button', className: secondary, onClick: signOut }, 'Sign out'))),
        h('h2', { className: 'dh-agent-h2' }, 'Your listings'),
        data.loading ? h('p', { className: 'dh-agent-lead', role: 'status' }, 'Loading your listings…')
          : data.message ? h('p', { role: 'alert', className: 'dh-agent-error' }, data.message)
          : !data.listings.length ? h('div', { className: 'dh-agent-empty' }, h('p', null, 'You haven’t sent any listings yet.'),
              h('p', null, 'Every listing is checked by DwellHunt before it goes live for 1 month. Buyer enquiries are emailed to you.'))
          : h('ul', { className: 'dh-agent-list' }, data.listings.map(l => h('li', { key: l.reference },
              h('div', null, h('p', { className: 'dh-agent-title' }, l.title || l.reference),
                h('p', { className: 'dh-agent-meta' }, [l.reference, l.city, l.price ? `${l.currency} ${Number(l.price).toLocaleString('en-US')}${l.pricePeriod ? ' / ' + l.pricePeriod : ''}` : ''].filter(Boolean).join(' · '))),
              h('div', { className: 'dh-agent-status', 'data-status': l.status },
                AGENT_STATUS_LABELS[l.status] || l.status,
                l.status === 'published' && l.expiresAt ? h('small', null, 'until ' + niceDate(l.expiresAt)) : null,
                l.status === 'pending review' && l.sentAt ? h('small', null, 'sent ' + niceDate(l.sentAt)) : null))))));
  }

  function AgentPortal({ onBack }) {
    const [session, setSession] = React.useState(() => loadAgentSession());
    const [view, setView] = React.useState(() => loadAgentSession() ? 'dashboard' : 'signin');
    const [draft, setDraft] = React.useState(null);
    React.useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [view, !!draft]);
    const signedOut = () => { setSession(null); setDraft(null); setView('signin'); };
    if (session && draft) return h(OwnerListing, { draft, onDraftChange: setDraft, agent: session, onStart: () => { setDraft(null); setView('dashboard'); } });
    if (session && view === 'create') return h(OwnerStart, { agent: session.agent, onAgencyPortal: () => setView('dashboard'),
      onContinue: (purpose, category) => {
        const a = session.agent || {};
        // The agent's verified identity is used by the backend; these fill the owner form's contact step.
        setDraft({ ...createOwnerDraft({ listingRole: 'owner', listingPurpose: purpose, propertyCategory: category }),
          ownerName: a.name || '', email: a.email || '', ...phoneParts(a.phone), preferredContact: 'whatsapp', step: 1 });
      } });
    if (session && view === 'dashboard') return h(Dashboard, { session, onCreate: () => setView('create'), onSignedOut: signedOut });
    if (view === 'apply') return h(Apply, { onSignIn: () => setView('signin'), onBack });
    return h(SignIn, { onBack, onApply: () => setView('apply'), onSignedIn: s => { setSession(s); setView('dashboard'); } });
  }

  function Chooser({ onAgent, onOwner }) {
    const point = text => h('li', null, h('span', { 'aria-hidden': 'true' }, '✓'), text);
    return shell(
      h('div', { className: 'dh-agent-hero' },
        h('span', { className: 'dh-agent-pill' }, 'FOR AGENTS, AGENCIES AND OWNERS'),
        h('h1', null, 'List a property on DwellHunt'),
        h('p', null, 'Who’s listing today?')),
      h('div', { className: 'dh-agent-choices' },
        h('section', { className: 'dh-agent-choice dh-agent-choice-main' },
          h('div', { className: 'dh-agent-choice-top' }, h('span', { className: 'dh-agent-choice-icon', 'aria-hidden': 'true' }, '💼'), h('span', { className: 'dh-agent-tag' }, 'Most listings')),
          h('h2', null, 'I’m an agent or agency'),
          h('p', null, 'List many properties and get screened buyer enquiries by email.'),
          h('ul', null, point('Verified agent badge'), point('HOT / WARM lead scoring'), point('Your own listing dashboard')),
          h('button', { type: 'button', className: primary, onClick: onAgent }, 'Agent sign-in or apply →'),
          h('a', { className: 'dh-agent-small', href: WHATSAPP_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Development or housing project? Talk to us')),
        h('section', { className: 'dh-agent-choice' },
          h('div', { className: 'dh-agent-choice-top' }, h('span', { className: 'dh-agent-choice-icon', 'aria-hidden': 'true' }, '🏠')),
          h('h2', null, 'I own the property'),
          h('p', null, 'Free for owners. 7 short steps, and your phone number stays private.'),
          h('ul', null, point('Annex, apartment or villa'), point('Checked by DwellHunt'), point('Enquiries screened for you')),
          h('button', { type: 'button', className: secondary, onClick: onOwner }, 'List my property'))));
  }

  return function ListPropertyPage({ startAgent = false }) {
    const [mode, setMode] = React.useState(startAgent ? 'agent' : '');
    const [ownerDraft, setOwnerDraft] = React.useState(null);
    React.useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [mode]);
    if (mode === 'agent') return h(AgentPortal, { onBack: () => setMode('') });
    if (mode === 'owner') return ownerDraft
      ? h(OwnerListing, { draft: ownerDraft, onDraftChange: setOwnerDraft, onStart: () => { setOwnerDraft(null); setMode(''); } })
      : h(OwnerStart, { onAgencyPortal: () => setMode('agent'),
          onContinue: (purpose, category) => setOwnerDraft(createOwnerDraft({ listingRole: 'owner', listingPurpose: purpose, propertyCategory: category })) });
    return h(Chooser, { onAgent: () => setMode('agent'), onOwner: () => setMode('owner') });
  };
}
