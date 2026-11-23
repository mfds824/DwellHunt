/* Public agent profiles and posts (homepage "Verified agents" strip + "#agent=AG-…" profile page).
 * Data comes from the Worker's read-only /agents/public routes; agent email and phone are never public.
 * "Contact" sends a DwellHunt lead (lead-turnstile.js adds the human check) that the backend emails to the agent. */
import { verifiedBadge } from './verified-badge.js?v=20261124-vb2';
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
const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;
export function listingFacts(l) {
  return [Number(l.bedrooms) > 0 ? plural(l.bedrooms, 'bed') : '', Number(l.bathrooms) > 0 ? plural(l.bathrooms, 'bath') : '',
    Number(l.floorArea) > 0 ? `${Number(l.floorArea).toLocaleString('en-US')} ${l.floorUnit || 'sqft'}` : ''].filter(Boolean).join(' · ');
}
export function listingPlace(l) { const x = l.location || {}; return [x.building, x.city || x.district].filter(Boolean).join(', '); }
/** The listing a profile was opened from (its "#owner-listing=…" address), so the visitor can go back to it. */
export function listingFromUrl(url) {
  const m = /#owner-listing=([A-Z]{2}-\d{4}-\d{4})$/.exec(decodeURIComponent(String(url || '')));
  return m ? m[1] : '';
}

/** "Speaks English, Sinhala and Tamil", or '' when the agent has not said. */
export function languageLine(list) {
  const l = (Array.isArray(list) ? list : []).filter(x => typeof x === 'string' && x);
  if (!l.length) return '';
  return 'Speaks ' + (l.length === 1 ? l[0] : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]);
}
const FEATURE_ICONS = {
  video: ['M15 10l4.553 -2.276a1 1 0 0 1 1.447 .894v6.764a1 1 0 0 1 -1.447 .894l-4.553 -2.276v-4z', 'M3 8a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z'],
  area: ['M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0', 'M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z'],
  agency: ['M3 21h18', 'M5 21v-14l8 -4v18', 'M19 21v-10l-6 -4', 'M9 9v.01', 'M9 12v.01', 'M9 15v.01', 'M9 18v.01'],
};
function feature(h, key, icon, label, title) {
  return h('span', { key, className: 'dh-ap-feature', title },
    h('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
      FEATURE_ICONS[icon].map((d, i) => h('path', { key: i, d }))), label);
}
/** One small "DwellHunt Verified" badge, then only the features the agent chose (video viewings, specialist areas)
 * or DwellHunt confirmed (registered agency). */
export function profileBadges(h, agent) {
  const areas = (agent.areas || []).filter(Boolean);
  return [verifiedBadge(h, 'sm', 'v'),
    agent.videoViewings === true && feature(h, 'video', 'video', 'Video viewings', 'This agent can show the property on a live video call.'),
    areas.length > 0 && feature(h, 'area', 'area', 'Specialises in ' + areas.slice(0, 2).join(', ') + (areas.length > 2 ? ` +${areas.length - 2}` : ''), areas.join(', ')),
    agent.registeredAgency === true && feature(h, 'agency', 'agency', 'Registered agency', 'This agency is registered with DwellHunt.'),
  ].filter(Boolean);
}

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
      h('div', { className: 'dh-ap-row' }, h('label', null, 'Your name', h('input', { value: f.name, onChange: set('name'), autoComplete: 'name', autoFocus: true })),
        h('label', null, 'Email', h('input', { type: 'email', value: f.email, onChange: set('email'), autoComplete: 'email' }))),
      h('label', null, 'Phone / WhatsApp (optional)', h('input', { type: 'tel', value: f.phone, onChange: set('phone'), autoComplete: 'tel' })),
      h('label', null, 'Message', h('textarea', { rows: 3, value: f.message, onChange: set('message'), placeholder: 'What are you looking for?' })),
      h('label', { className: 'dh-ap-consent' }, h('input', { type: 'checkbox', checked: f.consent, onChange: set('consent') }),
        h('span', null, `I agree that DwellHunt and ${agent.agency} may use these details to reply to me.`)),
      h('div', { className: 'dh-hp', 'aria-hidden': 'true' }, h('label', null, 'Leave empty', h('input', { ref: honeypot, type: 'text', tabIndex: -1, autoComplete: 'off', defaultValue: '' }))),
      state.message && h('p', { className: 'dh-ap-error', role: 'alert' }, state.message),
      h('button', { type: 'submit', className: 'dh-button', disabled: state.phase === 'sending' }, state.phase === 'sending' ? 'Sending…' : 'Send message'));
  }

  /** The profile reads as a profile first; the message form opens only when the visitor asks for it. */
  function ContactPanel({ agent }) {
    const [open, setOpen] = React.useState(false);
    if (open) return h(Contact, { agent });
    return h('div', { className: 'dh-ap-cta' },
      h('button', { type: 'button', className: 'dh-button', onClick: () => setOpen(true) }, `Contact ${agent.agency}`),
      h('p', { className: 'dh-ap-muted' }, `Your message goes to ${agent.agency} through DwellHunt.`));
  }

  function ListingCard({ listing: l, onOpen }) {
    const photo = safeImage(l.photos && l.photos[0] && l.photos[0].url);
    const facts = listingFacts(l), place = listingPlace(l);
    return h('button', { type: 'button', className: 'dh-ap-card', onClick: () => onOpen(l.reference) },
      photo ? h('img', { src: photo, alt: '', loading: 'lazy' }) : h('span', { className: 'dh-ap-card-nophoto', 'aria-hidden': 'true' }),
      h('span', { className: 'dh-ap-card-body' },
        h('strong', null, l.title),
        h('span', { className: 'dh-ap-card-price' }, price(l)),
        facts && h('span', null, facts),
        place && h('span', { className: 'dh-ap-card-place' }, place)));
  }

  /** Full profile page shown over the homepage when the address ends in #agent=AG-…. */
  function AgentProfileOverlay() {
    const [id, setId] = React.useState(() => agentFromHash(location.hash));
    const [agent, setAgent] = React.useState(null);
    const [state, setState] = React.useState('idle');
    const [from, setFrom] = React.useState('');
    React.useEffect(() => {
      const sync = e => { const next = agentFromHash(location.hash); if (next) setFrom(listingFromUrl(e && e.oldURL)); setId(next); };
      window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync);
    }, []);
    React.useEffect(() => {
      if (!id) { setAgent(null); return; }
      let live = true; setState('loading');
      loadAgent(id).then(a => { if (!live) return; setAgent(a); setState(a ? 'ready' : 'missing'); });
      document.body.style.overflow = 'hidden';
      return () => { live = false; document.body.style.overflow = ''; };
    }, [id]);
    if (!id) return null;
    const openListing = ref => { location.hash = 'owner-listing=' + ref; };
    // Opened from a listing: closing goes back to that listing instead of dropping the visitor on the homepage.
    const close = () => { if (from) { setFrom(''); openListing(from); return; } history.replaceState(null, '', location.pathname + location.search); setId(''); };
    return h('div', { className: 'dh-ap-backdrop dh-ap-page-backdrop', onClick: e => { if (e.target === e.currentTarget) close(); } },
      h('div', { className: 'dh-ap-page', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dh-ap-name' },
        h('button', { type: 'button', className: 'dh-ap-close', onClick: close, 'aria-label': from ? 'Close and go back to the listing' : 'Close' }, '×'),
        from && h('button', { type: 'button', className: 'dh-ap-back', onClick: close }, '← Back to listing'),
        state === 'loading' && h('p', { role: 'status' }, 'Loading profile…'),
        state === 'missing' && h('p', { role: 'status' }, 'This agent profile is not available.'),
        agent && h(React.Fragment, null,
          h('header', { className: 'dh-ap-head' }, avatar(agent, 'lg'),
            h('div', { className: 'dh-ap-head-text' }, h('h2', { id: 'dh-ap-name' }, agent.name || agent.agency),
              agent.name && agent.agency && h('p', { className: 'dh-ap-agency' }, agent.agency),
              h('p', { className: 'dh-ap-areas' }, h('b', null, (agent.listings || []).length), ` active listing${(agent.listings || []).length === 1 ? '' : 's'}`),
              h('div', { className: 'dh-ap-badges' }, profileBadges(h, agent)),
              languageLine(agent.languages) && h('p', { className: 'dh-ap-langs' }, languageLine(agent.languages)))),
          agent.bio && h('p', { className: 'dh-ap-bio' }, agent.bio),
          h('div', { className: 'dh-ap-section' }, h('h3', null, `Live listings (${(agent.listings || []).length})`),
            (agent.listings || []).length ? h('div', { className: 'dh-ap-cards' }, agent.listings.map(l => h(ListingCard, { key: l.reference, listing: l, onOpen: openListing })))
              : h('p', { className: 'dh-ap-muted' }, 'No live listings right now.')),
          agent.posts && agent.posts.length > 0 && h('div', { className: 'dh-ap-section' }, h('h3', null, 'Posts'),
            h('div', { className: 'dh-ap-posts' }, agent.posts.map(p => h('article', { key: p.id, className: 'dh-ap-post' },
              safeImage(p.photo) && h('img', { src: p.photo, alt: '', loading: 'lazy' }),
              p.caption && h('p', null, p.caption),
              h('small', null, timeAgo(p.at), p.listingRef ? ' · ' : '', p.listingRef ? h('button', { type: 'button', className: 'dh-ap-link', onClick: () => openListing(p.listingRef) }, 'See listing') : null))))),
          h(ContactPanel, { agent }))));
  }
  return { AgentStrip, AgentProfileOverlay };
}
