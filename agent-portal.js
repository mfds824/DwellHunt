/* "List a property" page: a "Who's listing today?" chooser with agents first, the agent application, email-code
 * sign-in and the agent dashboard. Agents send listings through the owner form (owner-listing.js) with their session,
 * so every listing joins the same DwellHunt review. The backend is the Worker's /api/dwellhunt/agents/* routes. */
import { passwordKey, passwordProblem } from './password-strength.js?v=20261124-pw1';
import { verifiedBadge } from './verified-badge.js?v=20261124-vb2';
import { uploadPropertyFile, validatePropertyFile } from './property-upload.js';

const SESSION_KEY = 'dwellhunt_agent_session';
const WHATSAPP_URL = 'https://wa.me/94770153678?text=' + encodeURIComponent('Hi DwellHunt, I would like to list a property development.');

/** "Keep me signed in" uses localStorage; otherwise the sign-in lives in sessionStorage and ends with the browser tab. */
export function loadAgentSession(storage) {
  const stores = storage ? [storage] : [() => globalThis.localStorage, () => globalThis.sessionStorage];
  for (const entry of stores) {
    try {
      const s = JSON.parse((typeof entry === 'function' ? entry() : entry).getItem(SESSION_KEY) || 'null');
      if (s && /^[a-f0-9]{64}$/.test(s.session) && Date.parse(s.expires) > Date.now() && s.agent) return s;
    } catch { /* nothing saved, or storage unavailable */ }
  }
  return null;
}
export function clearAgentSession(storage) {
  for (const get of storage ? [() => storage] : [() => globalThis.localStorage, () => globalThis.sessionStorage]) {
    try { get().removeItem(SESSION_KEY); } catch { /* ignore */ }
  }
}
export function saveAgentSession(value, remember = true) {
  clearAgentSession();
  try { (remember ? globalThis.localStorage : globalThis.sessionStorage).setItem(SESSION_KEY, JSON.stringify(value)); } catch { /* private mode */ }
}

/** Friendly text for backend codes. */
export function agentMessage(code) {
  return ({
    HUMAN_VERIFICATION_REQUIRED: 'The security check expired or failed. Please complete it again.',
    INVALID_REQUEST: 'Some details need checking. Please review the highlighted fields.',
    INVALID_CODE: 'That code is not right. Check the latest email from DwellHunt and try again.',
    CODE_EXPIRED: 'That code has expired. Ask for a new code.',
    CODE_LOCKED: 'Too many wrong tries. Ask for a new code.',
    INVALID_LOGIN: 'That email and password did not work. Check them, or sign in with an email code. After several wrong tries, password sign-in pauses for 15 minutes.',
    PASSWORD_UNAVAILABLE: 'Password sign-in is not available right now. Please use an email code.',
    CODE_REQUIRED: 'For your security, please sign in with a new email code before changing your password.',
    SIGNED_OUT: 'Your sign-in has ended. Please sign in again.',
    RATE_LIMITED: 'Too many requests just now. Please try again later.',
    BUSY_RETRY: 'DwellHunt is busy for a moment. Please complete the security check again and retry.',
  })[code] || 'Something went wrong on our side. Please try again in a few minutes, or message us on WhatsApp.';
}

const RETRYABLE = new Set(['verify', 'password', 'me', 'signout', 'profile', 'posts', 'posts/delete', 'telegram']);
/** POSTs to an agent route and returns the JSON body. Calls without a one-time human-check token are retried
 * a few times when the backend is briefly busy. Throws an Error whose message is safe to show. */
export async function agentCall(path, body, fetchImpl = fetch, pause = ms => new Promise(r => setTimeout(r, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { return await agentCallOnce(path, body, fetchImpl); }
    catch (error) { if (error.code !== 'BUSY_RETRY' || !RETRYABLE.has(path) || attempt >= 3) throw error; await pause(1500 * (attempt + 1)); }
  }
}
async function agentCallOnce(path, body, fetchImpl) {
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

  const KNOWN_KEY = 'dwellhunt_agent_known';
  const markKnown = () => { try { localStorage.setItem(KNOWN_KEY, '1'); } catch { /* private mode */ } };
  const isKnown = () => { try { return localStorage.getItem(KNOWN_KEY) === '1'; } catch { return false; } };
  const tabs = (active, onApply, onSignIn) => h('div', { className: 'dh-agent-tabs', role: 'tablist', 'aria-label': 'Agent portal' },
    h('button', { type: 'button', role: 'tab', 'aria-selected': active === 'apply', className: active === 'apply' ? 'is-active' : '', onClick: onApply }, 'New agent? Apply'),
    h('button', { type: 'button', role: 'tab', 'aria-selected': active === 'signin', className: active === 'signin' ? 'is-active' : '', onClick: onSignIn }, 'Approved? Sign in'));
  const input = (id, label, value, onChange, extra = {}) => h('div', { className: 'dh-agent-field' },
    h('label', { htmlFor: id }, label), h('input', { id, value, onChange: e => onChange(e.target.value), ...extra }));
  const shell = (...children) => h('div', { className: 'dh-owner dh-agent py-12 bg-stone-50 min-h-screen' }, h('div', { className: 'dh-agent-wrap' }, ...children));

  /** A password box with a Show/Hide button; autoComplete tells the browser when to offer to save or fill it. */
  function PasswordField({ id, label, value, onChange, autoComplete, hint }) {
    const [show, setShow] = React.useState(false);
    return h('div', { className: 'dh-agent-field' }, h('label', { htmlFor: id }, label),
      h('div', { className: 'dh-agent-password' },
        h('input', { id, name: 'password', type: show ? 'text' : 'password', value, onChange: e => onChange(e.target.value), autoComplete, maxLength: 128, required: true, 'aria-describedby': hint ? id + '-hint' : undefined }),
        h('button', { type: 'button', onClick: () => setShow(v => !v), 'aria-label': show ? 'Hide password' : 'Show password' }, show ? 'Hide' : 'Show')),
      hint && h('p', { id: id + '-hint', className: 'dh-agent-hint' }, hint));
  }

  /** start: "password" (normal) or "email" (an emailed code, used first time, as a backup and to change the password). */
  function SignIn({ onSignedIn, onApply, onBack, start = 'password' }) {
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [newPassword, setNewPassword] = React.useState('');
    const [remember, setRemember] = React.useState(true);
    const [code, setCode] = React.useState('');
    const [step, setStep] = React.useState(start);
    const [choose, setChoose] = React.useState(start === 'email'); // offer a new password after the code
    const [pending, setPending] = React.useState(null);
    const [state, setState] = React.useState({ busy: false, message: '' });
    const check = React.useRef(null);
    const [token, reset] = useHumanCheck(check, 'agent_signin', (step === 'password' || step === 'email') && step);
    const go = next => { setStep(next); setState({ busy: false, message: '' }); };
    const problem = message => setState({ busy: false, message });
    const emailOk = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const keep = r => { markKnown(); const session = { session: r.session, expires: r.expires, agent: r.agent }; saveAgentSession(session, remember); return session; };
    const login = async event => {
      event.preventDefault();
      if (!emailOk()) return problem('Enter the email address you applied with.');
      if (!password) return problem('Enter your password, or use an email code.');
      if (!token) return problem('Please complete the security check.');
      setState({ busy: true, message: '' });
      try { onSignedIn(keep(await agentCall('login', { email: email.trim(), passwordKey: await passwordKey(password, email), remember, turnstile_token: token }))); }
      catch (error) { reset(); problem(error.message); }
    };
    const askCode = async event => {
      event.preventDefault();
      if (!emailOk()) return problem('Enter the email address you applied with.');
      if (!token) return problem('Please complete the security check.');
      setState({ busy: true, message: '' });
      try { await agentCall('code', { email: email.trim(), turnstile_token: token }); markKnown(); go('code'); }
      catch (error) { reset(); problem(error.message); }
    };
    const verify = async event => {
      event.preventDefault();
      if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) return problem('Enter the 6-digit code from the email.');
      setState({ busy: true, message: '' });
      try {
        const r = await agentCall('verify', { email: email.trim(), code: code.replace(/\s/g, ''), remember });
        const session = keep(r);
        if (r.passwordSet === false || choose) { setPending(session); go('create'); } else onSignedIn(session);
      } catch (error) { problem(error.message); if (['CODE_EXPIRED', 'CODE_LOCKED'].includes(error.code)) { setCode(''); setStep('email'); } }
    };
    const create = async event => {
      event.preventDefault();
      const weak = passwordProblem(newPassword, email);
      if (weak) return problem(weak);
      setState({ busy: true, message: '' });
      try { await agentCall('password', { session: pending.session, email: email.trim(), passwordKey: await passwordKey(newPassword, email) }); onSignedIn(pending); }
      catch (error) { problem(error.message); }
    };
    const emailField = input('dh-agent-signin-email', 'Email address', email, setEmail, { type: 'email', name: 'username', autoComplete: 'username', required: true });
    const captcha = h('div', { ref: check, key: step, className: 'dh-captcha', 'aria-label': 'Security check' });
    const keepBox = h('label', { className: 'dh-agent-remember' },
      h('input', { type: 'checkbox', checked: remember, onChange: e => setRemember(e.target.checked) }),
      h('span', null, 'Keep me signed in on this device for 30 days', h('small', null, 'Leave this unticked on a shared computer.')));
    const error = state.message && h('p', { role: 'alert', className: 'dh-agent-error' }, state.message);
    const link = (label, onClick) => h('button', { type: 'button', className: 'dh-agent-link', onClick }, label);
    const submit = (busy, label) => h('button', { type: 'submit', className: primary, disabled: state.busy }, state.busy ? busy : label);
    const notice = h('p', { className: 'dh-agent-notice' }, 'No account yet? ', link('Apply first', onApply), '. DwellHunt usually approves within 1 working day.');
    const form = {
      password: () => h('form', { key: 'password', onSubmit: login, noValidate: true, className: 'dh-agent-form' },
        emailField,
        h(PasswordField, { id: 'dh-agent-password', label: 'Password', value: password, onChange: setPassword, autoComplete: 'current-password' }),
        h('div', { className: 'dh-agent-row' }, link('Forgot password?', () => { setChoose(true); go('email'); })),
        keepBox, captcha, error, submit('Signing in…', 'Sign in'),
        h('button', { type: 'button', className: secondary, onClick: () => { setChoose(false); go('email'); } }, 'Email me a code instead'),
        h('p', { className: 'dh-agent-hint' }, 'First time here? Use an email code, then create your password.'), notice),
      email: () => h('form', { key: 'email', onSubmit: askCode, noValidate: true, className: 'dh-agent-form' },
        h('p', { className: 'dh-agent-lead' }, choose ? 'We’ll email you a 6-digit code. After you enter it, you can create a new password.' : 'We’ll email you a 6-digit code.'),
        emailField, keepBox, captcha, error, submit('Sending…', 'Email me a code'),
        link('Sign in with a password', () => { setChoose(false); go('password'); }), notice),
      code: () => h('form', { key: 'code', onSubmit: verify, noValidate: true, className: 'dh-agent-form' },
        h('p', { className: 'dh-agent-lead' }, `If ${email.trim()} belongs to an approved agent, a 6-digit code arrives within a minute. Check your spam folder too. The code expires in 10 minutes.`),
        h('p', { className: 'dh-agent-notice' }, 'No email? Codes are only sent to approved agents, so you may need to ', link('apply first', onApply), ', or your application may still be waiting for approval.'),
        input('dh-agent-code', '6-digit code', code, setCode, { inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 7, required: true }),
        error, submit('Checking…', 'Continue'),
        link('Use a different email or send a new code', () => { setCode(''); go('email'); })),
      create: () => h('form', { key: 'create', onSubmit: create, noValidate: true, className: 'dh-agent-form' },
        h('p', { className: 'dh-agent-lead' }, 'You’re signed in. Next time you can use this password instead of an email code.'),
        h('input', { type: 'email', name: 'username', value: email.trim(), readOnly: true, autoComplete: 'username', className: 'dh-agent-hidden-user', tabIndex: -1, 'aria-hidden': 'true' }),
        h(PasswordField, { id: 'dh-agent-new-password', label: 'New password', value: newPassword, onChange: setNewPassword, autoComplete: 'new-password',
          hint: 'At least 10 characters. Your browser may offer to save it. Saving signs out your other devices.' }),
        error, submit('Saving…', 'Save password'),
        h('button', { type: 'button', className: secondary, disabled: state.busy, onClick: () => onSignedIn(pending) }, 'Skip for now')),
    };
    return shell(
      h('button', { type: 'button', className: 'dh-agent-back', onClick: onBack }, '← Back'),
      h('section', { className: 'dh-agent-card' },
        h('p', { className: 'dh-agent-eyebrow' }, 'Agent portal'),
        step !== 'create' && tabs('signin', onApply, () => {}),
        h('h1', null, { password: 'Sign in as an agent', email: choose ? 'Create a new password' : 'Sign in with an email code', code: 'Check your email', create: 'Create your password' }[step]),
        form[step]()));
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
        const r = await agentCall('signup', { name: f.name.trim(), agency: f.agency.trim(), email: f.email.trim(), phone, registrationNo: f.registrationNo.trim(),
          consent: true, turnstile_token: token, website: honeypot.current?.value || '' });
        markKnown();
        if (r.duplicate && r.status === 'approved') { reset(); setState({ busy: false, message: '', fields: [], done: false, approved: true }); return; }
        setState({ busy: false, message: '', fields: [], done: true, already: !!r.duplicate });
      } catch (error) { reset(); setState({ busy: false, message: error.message, fields: error.fields || [], done: false }); }
    };
    const bad = key => state.fields.includes(key) || undefined;
    if (state.done) return shell(h('section', { className: 'dh-agent-card dh-agent-center' },
      h('div', { className: 'dh-agent-icon', 'aria-hidden': 'true' }, '✓'),
      h('h1', null, state.already ? 'You’ve already applied' : 'Application received'),
      h('p', { className: 'dh-agent-lead' }, state.already
        ? `Your application for ${f.email.trim()} is waiting for approval. We’ll email you as soon as it’s approved, usually within 1 working day.`
        : `Thank you, ${f.name.trim()}. Our team will check your details, usually within 1 working day, and may call or WhatsApp you. We’ll email ${f.email.trim()} as soon as your account is approved.`),
      h('p', { className: 'dh-agent-notice' }, 'You can sign in once you receive the “account approved” email. Sign-in codes are not sent before that.'),
      h('button', { type: 'button', className: secondary, onClick: onSignIn }, 'Go to agent sign-in')));
    return shell(
      h('button', { type: 'button', className: 'dh-agent-back', onClick: onBack }, '← Back'),
      h('section', { className: 'dh-agent-card' },
        h('p', { className: 'dh-agent-eyebrow' }, 'Agent portal'),
        tabs('apply', () => {}, onSignIn),
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
          state.approved && h('p', { role: 'alert', className: 'dh-agent-notice' }, 'This email already has an approved agent account. ',
            h('button', { type: 'button', className: 'dh-agent-link', onClick: onSignIn }, 'Sign in instead →')),
          state.message && h('p', { role: 'alert', className: 'dh-agent-error' }, state.message),
          h('button', { type: 'submit', className: primary, disabled: state.busy }, state.busy ? 'Sending…' : 'Send application'))));
  }

  /** Uploads one photo with the same checks as listing photos; returns its Cloudinary address. */
  async function uploadPhoto(file) {
    const problem = validatePropertyFile(file);
    if (problem) throw new Error(problem);
    return (await uploadPropertyFile(file)).url;
  }

  const AGENT_LANGUAGES = ['English', 'Sinhala', 'Tamil', 'Hindi', 'Mandarin', 'Arabic', 'Russian', 'German', 'French', 'Japanese'];
  function ProfileEditor({ session, profile, onSaved }) {
    const [f, setF] = React.useState({ bio: profile.bio || '', areas: (profile.areas || []).join(', '), logo: profile.logo || '',
      videoViewings: profile.videoViewings === true, languages: Array.isArray(profile.languages) ? profile.languages : [] });
    const toggleLanguage = l => setF(o => ({ ...o, languages: o.languages.includes(l) ? o.languages.filter(x => x !== l) : [...o.languages, l] }));
    const [state, setState] = React.useState({ busy: false, message: '', ok: false });
    const pick = React.useRef(null);
    const a = session.agent || {};
    const upload = async e => {
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      setState({ busy: true, message: 'Uploading logo…', ok: false });
      try { const url = await uploadPhoto(file); setF(o => ({ ...o, logo: url })); setState({ busy: false, message: 'Logo uploaded. Press Save to keep it.', ok: true }); }
      catch (error) { setState({ busy: false, message: error.message || 'The logo could not be uploaded.', ok: false }); }
    };
    const save = async e => {
      e.preventDefault(); setState({ busy: true, message: '', ok: false });
      try {
        await agentCall('profile', { session: session.session, bio: f.bio, areas: f.areas.split(',').map(x => x.trim()).filter(Boolean), logo: f.logo,
          videoViewings: f.videoViewings, languages: f.languages });
        setState({ busy: false, message: 'Profile saved. Buyers can see it now.', ok: true }); onSaved();
      } catch (error) { setState({ busy: false, message: error.message, ok: false }); }
    };
    return h('form', { className: 'dh-agent-panel', onSubmit: save },
      h('div', { className: 'dh-agent-panel-head' }, h('h2', { className: 'dh-agent-h2' }, 'Your public profile'),
        a.id && h('a', { className: 'dh-agent-link', href: './#agent=' + a.id, target: '_blank', rel: 'noopener' }, 'View public profile ↗')),
      h('div', { className: 'dh-agent-logo-row' },
        h('span', { className: 'dh-agent-logo' }, f.logo ? h('img', { src: f.logo, alt: '' }) : String(a.agency || '?').slice(0, 2).toUpperCase()),
        h('input', { ref: pick, type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, onChange: upload }),
        h('button', { type: 'button', className: secondary, onClick: () => pick.current && pick.current.click(), disabled: state.busy }, f.logo ? 'Change logo' : 'Add logo'),
        f.logo && h('button', { type: 'button', className: 'dh-agent-link', onClick: () => setF(o => ({ ...o, logo: '' })) }, 'Remove')),
      h('div', { className: 'dh-agent-field' }, h('label', { htmlFor: 'dh-agent-bio' }, 'About your agency'),
        h('textarea', { id: 'dh-agent-bio', rows: 3, maxLength: 600, value: f.bio, onChange: e => setF(o => ({ ...o, bio: e.target.value })), placeholder: 'What you specialise in and how long you have worked…' })),
      h('div', { className: 'dh-agent-field' }, h('label', { htmlFor: 'dh-agent-areas' }, 'Areas you specialise in (separate with commas)'),
        h('input', { id: 'dh-agent-areas', value: f.areas, onChange: e => setF(o => ({ ...o, areas: e.target.value })), placeholder: 'Colombo 05, Colombo 07, Rajagiriya' })),
      h('fieldset', { className: 'dh-agent-field dh-agent-choices' }, h('legend', null, 'Languages you can speak with buyers'),
        h('div', { className: 'dh-agent-chips' }, AGENT_LANGUAGES.map(l => h('label', { key: l, className: 'dh-agent-chip' + (f.languages.includes(l) ? ' is-on' : '') },
          h('input', { type: 'checkbox', checked: f.languages.includes(l), onChange: () => toggleLanguage(l) }), l)))),
      h('label', { className: 'dh-agent-check' },
        h('input', { type: 'checkbox', checked: f.videoViewings, onChange: e => setF(o => ({ ...o, videoViewings: e.target.checked })) }),
        h('span', null, h('strong', null, 'Offer video viewings'), h('span', { className: 'dh-agent-check-note' }, 'Host live video tours for buyers who are unable to visit in person. A “Video viewings” badge will appear on your public profile.'))),
      state.message && h('p', { role: 'status', className: state.ok ? 'dh-agent-notice' : 'dh-agent-error' }, state.message),
      h('button', { type: 'submit', className: primary, disabled: state.busy }, state.busy ? 'Saving…' : 'Save profile'));
  }

  function PostComposer({ session, listings, onPosted }) {
    const [f, setF] = React.useState({ kind: 'post', caption: '', photo: '', listingRef: '' });
    const [state, setState] = React.useState({ busy: false, message: '', ok: false });
    const pick = React.useRef(null);
    const live = listings.filter(l => l.status === 'published');
    const upload = async e => {
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      setState({ busy: true, message: 'Uploading photo…', ok: false });
      try { const url = await uploadPhoto(file); setF(o => ({ ...o, photo: url })); setState({ busy: false, message: '', ok: false }); }
      catch (error) { setState({ busy: false, message: error.message || 'The photo could not be uploaded.', ok: false }); }
    };
    const publish = async e => {
      e.preventDefault();
      if (!f.caption.trim() && !f.photo) { setState({ busy: false, message: 'Write something or add a photo.', ok: false }); return; }
      setState({ busy: true, message: '', ok: false });
      try {
        await agentCall('posts', { session: session.session, kind: 'post', caption: f.caption, photo: f.photo, listingRef: f.listingRef });
        setF({ kind: 'post', caption: '', photo: '', listingRef: '' });
        setState({ busy: false, message: 'Post is live on your profile.', ok: true }); onPosted();
      } catch (error) { setState({ busy: false, message: error.message, ok: false }); }
    };
    return h('form', { className: 'dh-agent-panel', onSubmit: publish },
      h('h2', { className: 'dh-agent-h2' }, 'New post'),
      h('div', { className: 'dh-agent-field' }, h('label', { htmlFor: 'dh-agent-caption' }, 'Caption'),
        h('textarea', { id: 'dh-agent-caption', rows: 3, maxLength: 500, value: f.caption, onChange: e => setF(o => ({ ...o, caption: e.target.value })),
          placeholder: 'Just listed: 2-bedroom apartment near the park…' })),
      h('div', { className: 'dh-agent-logo-row' },
        f.photo ? h('img', { className: 'dh-agent-post-photo', src: f.photo, alt: '' }) : null,
        h('input', { ref: pick, type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, onChange: upload }),
        h('button', { type: 'button', className: secondary, onClick: () => pick.current && pick.current.click(), disabled: state.busy }, f.photo ? 'Change photo' : 'Add photo'),
        f.photo && h('button', { type: 'button', className: 'dh-agent-link', onClick: () => setF(o => ({ ...o, photo: '' })) }, 'Remove')),
      live.length > 0 && h('div', { className: 'dh-agent-field' }, h('label', { htmlFor: 'dh-agent-link-listing' }, 'Link to one of your live listings (optional)'),
        h('select', { id: 'dh-agent-link-listing', value: f.listingRef, onChange: e => setF(o => ({ ...o, listingRef: e.target.value })) },
          h('option', { value: '' }, 'No listing'), live.map(l => h('option', { key: l.reference, value: l.reference }, `${l.reference} · ${l.title}`)))),
      h('p', { className: 'dh-agent-meta' }, 'Posts go live straight away. Links are removed, and DwellHunt may take down anything that breaks the rules.'),
      state.message && h('p', { role: 'status', className: state.ok ? 'dh-agent-notice' : 'dh-agent-error' }, state.message),
      h('button', { type: 'submit', className: primary, disabled: state.busy }, state.busy ? 'Publishing…' : 'Publish post'));
  }

  function MyPosts({ session, posts, onChanged }) {
    const [busy, setBusy] = React.useState('');
    if (!posts.length) return null;
    const remove = async id => { setBusy(id); try { await agentCall('posts/delete', { session: session.session, postId: id }); onChanged(); } catch { /* the list refreshes on the next load */ } setBusy(''); };
    return h('div', { className: 'dh-agent-panel' }, h('h2', { className: 'dh-agent-h2' }, 'Your posts'),
      h('ul', { className: 'dh-agent-list' }, posts.filter(p => p.kind !== 'story').map(p => h('li', { key: p.id },
        h('div', null, h('p', { className: 'dh-agent-title' }, p.caption || '(photo)'),
          h('p', { className: 'dh-agent-meta' }, `Post · ${niceDate(p.at)}`)),
        h('button', { type: 'button', className: 'dh-agent-link', disabled: busy === p.id, onClick: () => remove(p.id) }, busy === p.id ? 'Deleting…' : 'Delete')))));
  }

  /** "Connect Telegram": a one-time link to the DwellHunt Agents bot, shown only once that bot is set up. */
  function TelegramConnect({ session, telegram }) {
    const [state, setState] = React.useState({ busy: false, link: '', message: '' });
    if (!telegram || !telegram.available) return null;
    const getLink = reconnect => {
      setState({ busy: true, link: '', message: '' });
      agentCall('telegram', { session: session.session, reconnect })
        .then(r => setState({ busy: false, link: r.link || '', message: r.status === 'connected' ? 'Telegram is already connected.' : r.link ? '' : 'Telegram is not available right now.' }))
        .catch(error => setState({ busy: false, link: '', message: error.message }));
    };
    return h('div', { className: 'dh-agent-telegram' },
      h('p', null, telegram.connected ? '✅ Telegram connected. New enquiries and listing updates arrive in the DwellHunt Agents bot.'
        : 'Get new enquiries instantly in Telegram, with buttons to record what happened, plus listing approvals and renewal reminders.'),
      state.link
        ? h('a', { className: primary, href: state.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open Telegram to connect')
        : h('button', { type: 'button', className: telegram.connected ? 'dh-agent-link' : secondary, disabled: state.busy, onClick: () => getLink(telegram.connected) },
            state.busy ? 'Getting your link…' : telegram.connected ? 'Connect a different Telegram account' : 'Connect Telegram'),
      state.link && h('p', { className: 'dh-agent-meta' }, 'Tap Start in Telegram. The link works once and expires in 7 days.'),
      state.message && h('p', { className: 'dh-agent-meta', role: 'status' }, state.message));
  }

  function Dashboard({ session, onCreate, onSignedOut, onChangePassword }) {
    const [data, setData] = React.useState({ loading: true, listings: [], posts: [], profile: null, telegram: null, passwordSet: false, message: '' });
    const [tick, setTick] = React.useState(0);
    const refresh = () => setTick(t => t + 1);
    React.useEffect(() => {
      let live = true;
      agentCall('me', { session: session.session })
        .then(r => { if (live) setData({ loading: false, listings: r.listings || [], posts: r.posts || [], profile: r.profile || { bio: '', areas: [], logo: '' }, telegram: r.telegram || null, passwordSet: r.passwordSet === true, message: '' }); })
        .catch(error => { if (!live) return; if (error.code === 'SIGNED_OUT') { clearAgentSession(); onSignedOut(); } else setData(o => ({ ...o, loading: false, message: error.message })); });
      return () => { live = false; };
    }, [session.session, tick]);
    const signOut = () => { agentCall('signout', { session: session.session }).catch(() => {}); clearAgentSession(); onSignedOut(); };
    // Setting a password always needs a fresh emailed code, so this starts the code sign-in.
    const changePassword = () => { agentCall('signout', { session: session.session }).catch(() => {}); clearAgentSession(); onChangePassword(); };
    const a = session.agent || {};
    return shell(
      h('section', { className: 'dh-agent-card' },
        h('div', { className: 'dh-agent-dash-head' },
          h('div', null, h('p', { className: 'dh-agent-eyebrow' }, 'Agent portal · ', verifiedBadge(h, 'sm')),
            h('h1', null, a.name || 'Your dashboard'), h('p', { className: 'dh-agent-lead' }, `${a.agency || ''}${a.id ? ' · ' + a.id : ''}`)),
          h('div', { className: 'dh-agent-dash-actions' },
            h('button', { type: 'button', className: primary, onClick: onCreate }, '+ New listing'),
            !data.loading && h('button', { type: 'button', className: secondary, onClick: changePassword }, data.passwordSet ? 'Change password' : 'Create password'),
            h('button', { type: 'button', className: secondary, onClick: signOut }, 'Sign out'))),
        !data.loading && h(TelegramConnect, { session, telegram: data.telegram }),
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
                l.status === 'pending review' && l.sentAt ? h('small', null, 'sent ' + niceDate(l.sentAt)) : null))))),
      !data.loading && data.profile && h('div', { className: 'dh-agent-panels' },
        h(PostComposer, { session, listings: data.listings, onPosted: refresh }),
        h(MyPosts, { session, posts: data.posts, onChanged: refresh }),
        h(ProfileEditor, { key: 'profile', session, profile: data.profile, onSaved: refresh })));
  }

  function AgentPortal({ onBack }) {
    const [session, setSession] = React.useState(() => loadAgentSession());
    const [view, setView] = React.useState(() => loadAgentSession() ? 'dashboard'
      : /^#agents=signin/.test(location.hash) || isKnown() ? 'signin' : 'apply');
    const [draft, setDraft] = React.useState(null);
    const [start, setStart] = React.useState('password');
    React.useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [view, !!draft]);
    const signedOut = (next = 'password') => { setStart(next); setSession(null); setDraft(null); setView('signin'); };
    if (session && draft) return h(OwnerListing, { draft, onDraftChange: setDraft, agent: session, onStart: () => { setDraft(null); setView('dashboard'); } });
    if (session && view === 'create') return h(OwnerStart, { agent: session.agent, onAgencyPortal: () => setView('dashboard'),
      onContinue: (purpose, category) => {
        const a = session.agent || {};
        // The agent's verified identity is used by the backend; these fill the owner form's contact step.
        setDraft({ ...createOwnerDraft({ listingRole: 'owner', listingPurpose: purpose, propertyCategory: category }),
          ownerName: a.name || '', email: a.email || '', ...phoneParts(a.phone), preferredContact: 'whatsapp', step: 1 });
      } });
    if (session && view === 'dashboard') return h(Dashboard, { session, onCreate: () => setView('create'), onSignedOut: () => signedOut(), onChangePassword: () => signedOut('email') });
    if (view === 'apply') return h(Apply, { onSignIn: () => setView('signin'), onBack });
    return h(SignIn, { start, onBack, onApply: () => setView('apply'), onSignedIn: s => { setSession(s); setView('dashboard'); } });
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
