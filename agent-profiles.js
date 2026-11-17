/* Public agent profiles and posts (homepage "Verified agents" strip + "#agent=AG-…" profile page).
 * Data comes from the Worker's read-only /agents/public routes; agent email and phone are never public.
 * "Contact" sends a DwellHunt lead (lead-turnstile.js adds the human check) that the backend emails to the agent. */
const isAgentId = id => /^AG-\d{4}-\d{4}$/.test(String(id || ''));
export function agentFromHash(hash) {
  const m = /^#agent=(AG-\d{4}-\d{4})$/.exec(decodeURIComponent(String(hash || '')));
  return m ? m[1] : '';
}
export function initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'; }
export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return m <= 1 ? 'just now' : `${m} minutes ago`;
  const hrs = Math.round(m / 60); if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
  const d = Math.round(hrs / 24); return d === 1 ? 'yesterday' : `${d} days ago`;
}
const safeImage = url => typeof url === 'string' && /^https:\/\/res\.cloudinary\.com\//.test(url) ? url : '';
const base = () => String((window.DWELLHUNT_VIEWING || {}).agentApiUrl || '').replace(/\/$/, '');
let listPromise = null;
export function loadAgents(fetchImpl = fetch) {
  if (!base()) return Promise.resolve([]);
  listPromise ||= fetchImpl(base() + '/public', { headers: { Accept: 'application/json' } })
    .then(r => { if (!r.ok) throw new Error('agents'); return r.json(); }).then(b => (b && Array.isArray(b.agents) ? b.agents : []).filter(a => isAgentId(a.id)))
    .catch(() => { listPromise = null; return []; });
  return listPromise;
}
export function loadAgent(id, fetchImpl = fetch) {
  if (!base() || !isAgentId(id)) return Promise.resolve(null);
  return fetchImpl(base() + '/public/one?id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
    .then(r => r.ok ? r.json() : null).then(b => b && b.ok && b.agent ? b.agent : null).catch(() => null);
}
const price = l => Number(l.price) > 0 ? `${l.currency || 'LKR'} ${Number(l.price).toLocaleString('en-US')}${l.purpose === 'buy' ? '' : ' / month'}` : 'Price on request';

export function createAgentProfiles(React) {
  const h = React.createElement;
  const openAgent = id => { location.hash = 'agent=' + id; };
  const avatar = (a, size = 'md') => h('span', { className: `dh-ap-avatar dh-ap-avatar-${size}`, 'aria-hidden': 'true' },
    safeImage(a.logo) ? h('img', { src: a.logo, alt: '' }) : initials(a.agency || a.name));

  /** "Verified agents": agents with live listings; each opens that agent's profile. */
  function AgentStrip() {
    const [agents, setAgents] = React.useState([]);
    React.useEffect(() => { let live = true; loadAgents().then(list => { if (live) setAgents(list); }); return () => { live = false; }; }, []);
    const shown = agents.filter(a => a.listingCount > 0).slice(0, 20);
    if (!shown.length) return null;
    return h('section', { className: 'dh-section dh-ap-strip', 'aria-labelledby': 'dh-ap-strip-title' },
      h('div', { className: 'dh-ap-strip-head' }, h('p', { className: 'dh-eyebrow' }, 'Verified agents'), h('h2', { id: 'dh-ap-strip-title' }, 'Agents on DwellHunt')),
      h('div', { className: 'dh-ap-strip-row' }, shown.map(a => h('button', { key: a.id, type: 'button', className: 'dh-ap-strip-item',
        onClick: () => openAgent(a.id), 'aria-label': `View ${a.agency}’s profile` }, avatar(a), h('span', null, a.agency)))));
  }

  function Contact({ agent }) {
    const [f, setF] = React.useState({ name: '', email: '', phone: '', message: '', consent: false });
    const [state, setState] = React.useState({ phase: 'idle', message: '' });
    const honeypot = React.useRef(null);
    const set = k => e => setF(o => ({ ...o, [k]: k === 'consent' ? e.target.checked : e.target.value }));
    const submit = async e => {
      e.preventDefault();
      if (honeypot.current && honeypot.current.value) { setState({ phase: 'done', message: '' }); return; }
      if (!f.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) || !f.message.trim() || !f.consent) { setState({ phase: 'error', message: 'Please add your name, email and a message, and tick the consent box.' }); return; }
      const url = (window.DWELLHUNT_VIEWING || {}).leadUrl;
      if (!url) { setState({ phase: 'error', message: 'Messages are being set up. Please try again later.' }); return; }
      setState({ phase: 'sending', message: '' });
      const at = new Date();
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          customer_name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), enquiry_type: 'general', property: `Agent profile: ${agent.agency}`,
          property_id: agent.id, agency_id: '', location: (agent.areas || [])[0] || '', budget: '', message: f.message.trim(), preferred_date: '',
          source: 'DwellHunt Website', submittedAt: at.toISOString(), lead_id: 'enq-' + at.getTime(), consent: true, consent_at: at.toISOString() }) });
        if (!r.ok) throw new Error('send');
        setState({ phase: 'done', message: '' });
      } catch { setState({ phase: 'error', message: 'Your message could not be sent. Please try again.' }); }
    };
    if (state.phase === 'done') return h('div', { className: 'dh-ap-contact', role: 'status' }, h('strong', null, 'Message sent'), h('p', null, `${agent.agency} will contact you soon. We’ve emailed you a confirmation.`));
    return h('form', { className: 'dh-ap-contact', onSubmit: submit, noValidate: true },
      h('h3', null, `Contact ${agent.agency}`),
      h('div', { className: 'dh-ap-row' }, h('label', null, 'Your name', h('input', { value: f.name, onChange: set('name'), autoComplete: 'name' })),
        h('label', null, 'Email', h('input', { type: 'email', value: f.email, onChange: set('email'), autoComplete: 'email' }))),
      h('label', null, 'Phone / WhatsApp (optional)', h('input', { type: 'tel', value: f.phone, onChange: set('phone'), autoComplete: 'tel' })),
      h('label', null, 'Message', h('textarea', { rows: 3, value: f.message, onChange: set('message'), placeholder: 'What are you looking for?' })),
      h('label', { className: 'dh-ap-consent' }, h('input', { type: 'checkbox', checked: f.consent, onChange: set('consent') }),
        h('span', null, `I agree that DwellHunt and ${agent.agency} may use these details to reply to me.`)),
      h('div', { className: 'dh-hp', 'aria-hidden': 'true' }, h('label', null, 'Leave empty', h('input', { ref: honeypot, type: 'text', tabIndex: -1, autoComplete: 'off', defaultValue: '' }))),
      state.message && h('p', { className: 'dh-ap-error', role: 'alert' }, state.message),
      h('button', { type: 'submit', className: 'dh-button', disabled: state.phase === 'sending' }, state.phase === 'sending' ? 'Sending…' : 'Send message'));
  }

  /** Full profile page shown over the homepage when the address ends in #agent=AG-…. */
  function AgentProfileOverlay() {
    const [id, setId] = React.useState(() => agentFromHash(location.hash));
    const [agent, setAgent] = React.useState(null);
    const [state, setState] = React.useState('idle');
    React.useEffect(() => { const sync = () => setId(agentFromHash(location.hash)); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
    React.useEffect(() => {
      if (!id) { setAgent(null); return; }
      let live = true; setState('loading');
      loadAgent(id).then(a => { if (!live) return; setAgent(a); setState(a ? 'ready' : 'missing'); });
      document.body.style.overflow = 'hidden';
      return () => { live = false; document.body.style.overflow = ''; };
    }, [id]);
    if (!id) return null;
    const close = () => history.replaceState(null, '', location.pathname + location.search) || setId('');
    const openListing = ref => { location.hash = 'owner-listing=' + ref; };
    return h('div', { className: 'dh-ap-backdrop dh-ap-page-backdrop', onClick: e => { if (e.target === e.currentTarget) close(); } },
      h('div', { className: 'dh-ap-page', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dh-ap-name' },
        h('button', { type: 'button', className: 'dh-ap-close', onClick: close, 'aria-label': 'Close' }, '×'),
        state === 'loading' && h('p', { role: 'status' }, 'Loading profile…'),
        state === 'missing' && h('p', { role: 'status' }, 'This agent profile is not available.'),
        agent && h(React.Fragment, null,
          h('header', { className: 'dh-ap-head' }, avatar(agent, 'lg'),
            h('div', null, h('h2', { id: 'dh-ap-name' }, agent.agency),
              h('p', { className: 'dh-ap-verified' }, '✓ Verified agent', agent.name ? ` · ${agent.name}` : ''),
              agent.areas && agent.areas.length > 0 && h('p', { className: 'dh-ap-areas' }, agent.areas.join(' · ')))),
          agent.bio && h('p', { className: 'dh-ap-bio' }, agent.bio),
          h('div', { className: 'dh-ap-section' }, h('h3', null, `Live listings (${(agent.listings || []).length})`),
            (agent.listings || []).length ? h('ul', { className: 'dh-ap-listings' }, agent.listings.map(l => h('li', { key: l.reference },
              h('button', { type: 'button', className: 'dh-ap-link', onClick: () => openListing(l.reference) }, l.title), h('span', null, price(l)))))
              : h('p', { className: 'dh-ap-muted' }, 'No live listings right now.')),
          agent.posts && agent.posts.length > 0 && h('div', { className: 'dh-ap-section' }, h('h3', null, 'Posts'),
            h('div', { className: 'dh-ap-posts' }, agent.posts.map(p => h('article', { key: p.id, className: 'dh-ap-post' },
              safeImage(p.photo) && h('img', { src: p.photo, alt: '', loading: 'lazy' }),
              p.caption && h('p', null, p.caption),
              h('small', null, timeAgo(p.at), p.listingRef ? ' · ' : '', p.listingRef ? h('button', { type: 'button', className: 'dh-ap-link', onClick: () => openListing(p.listingRef) }, 'See listing') : null))))),
          h(Contact, { agent }))));
  }
  return { AgentStrip, AgentProfileOverlay };
}
