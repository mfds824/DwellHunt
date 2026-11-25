/* Public agent profiles and posts (homepage "Verified agents" strip + "#agent=AG-…" profile page).
 * Data comes from the Worker's read-only /agents/public routes; agent email and phone are never public.
 * Buyers enquire from each listing (through DwellHunt); the profile itself has no contact form. */
import { verifiedBadge, checkMark } from './verified-badge.js?v=20261126-sp3';
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
const POST_TOPIC_LABELS = { listed: 'Just listed', price: 'Price reduced', viewing: 'Viewing slots open', closed: 'Rented / sold', tip: 'Market tip' };
const PERIOD = { night: ' / night', quarter: ' / quarter', year: ' / year' };
const price = l => Number(l.price) > 0 ? `${l.currency || 'LKR'} ${Number(l.price).toLocaleString('en-US')}${l.purpose === 'buy' ? '' : PERIOD[l.billingPeriod] || ' / month'}` : 'Price on request';
const TYPE_LABELS = { house: 'House', annex: 'Annex', room: 'Room', apartment: 'Apartment', villa: 'Villa', commercial: 'Commercial', land: 'Land' };
/** Filter and sort a profile's listings: purpose (all / rent / buy), type, and order (newest, price up, price down). */
export function profileListings(list, { purpose = 'all', type = 'all', sort = 'newest' } = {}) {
  const rows = (list || []).filter(l => (purpose === 'all' || l.purpose === purpose) && (type === 'all' || l.category === type));
  const value = l => Number(l.price) || 0;
  return rows.sort(sort === 'price-up' ? (a, b) => value(a) - value(b) : sort === 'price-down' ? (a, b) => value(b) - value(a)
    : (a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}
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

  function ListingCard({ listing: l, onOpen }) {
    const photo = safeImage(l.photos && l.photos[0] && l.photos[0].url);
    const facts = listingFacts(l), place = listingPlace(l);
    return h('button', { type: 'button', className: 'dh-ap-card', onClick: () => onOpen(l.reference) },
      h('span', { className: 'dh-ap-card-photo' },
        photo ? h('img', { src: photo, alt: '', loading: 'lazy' }) : h('span', { className: 'dh-ap-card-nophoto', 'aria-hidden': 'true' }),
        h('span', { className: 'dh-ap-card-purpose' }, l.purpose === 'buy' ? 'For sale' : 'For rent')),
      h('span', { className: 'dh-ap-card-body' },
        h('span', { className: 'dh-ap-card-price' }, price(l)),
        h('span', { className: 'dh-ap-card-facts' }, [TYPE_LABELS[l.category], facts].filter(Boolean).join(' · ')),
        h('strong', null, l.title),
        place && h('span', { className: 'dh-ap-card-place' }, place),
        checkMark(h, l)));
  }

  /** Active properties with All / Rent / Sale, a type filter and a sort order. */
  function ProfileListings({ listings, onOpen }) {
    const [f, setF] = React.useState({ purpose: 'all', type: 'all', sort: 'newest' });
    const shown = profileListings(listings, f);
    const count = purpose => listings.filter(l => purpose === 'all' || l.purpose === purpose).length;
    const types = [...new Set(listings.map(l => l.category).filter(c => TYPE_LABELS[c]))];
    const set = (key, value) => setF(o => ({ ...o, [key]: value }));
    if (!listings.length) return h('p', { className: 'dh-ap-muted' }, 'No live listings right now.');
    return h(React.Fragment, null,
      h('div', { className: 'dh-ap-filters' },
        h('div', { className: 'dh-ap-tabs', role: 'group', 'aria-label': 'Rent or sale' },
          [['all', 'All'], ['rent', 'Rent'], ['buy', 'Sale']].map(([value, label]) => h('button', { key: value, type: 'button',
            className: f.purpose === value ? 'is-on' : '', 'aria-pressed': f.purpose === value, onClick: () => set('purpose', value) }, `${label} (${count(value)})`))),
        types.length > 1 && h('select', { 'aria-label': 'Property type', value: f.type, onChange: e => set('type', e.target.value) },
          h('option', { value: 'all' }, 'Any type'), types.map(t => h('option', { key: t, value: t }, TYPE_LABELS[t]))),
        h('select', { 'aria-label': 'Sort', value: f.sort, onChange: e => set('sort', e.target.value) },
          h('option', { value: 'newest' }, 'Newest first'), h('option', { value: 'price-up' }, 'Price: low to high'), h('option', { value: 'price-down' }, 'Price: high to low'))),
      h('p', { className: 'dh-ap-showing', role: 'status' }, shown.length ? `Showing ${shown.length} of ${listings.length} ${listings.length === 1 ? 'property' : 'properties'}` : 'No properties match these filters.'),
      shown.length > 0 && h('div', { className: 'dh-ap-cards' }, shown.map(l => h(ListingCard, { key: l.reference, listing: l, onOpen }))));
  }

  /** A long introduction is cut short with "Read more", as on Bayut. */
  function AboutText({ text }) {
    const [open, setOpen] = React.useState(false);
    const long = text.length > 260;
    return h('p', { className: 'dh-ap-bio' }, long && !open ? text.slice(0, 240).replace(/\s+\S*$/, '') + '… ' : text + ' ',
      long && h('button', { type: 'button', className: 'dh-ap-link', onClick: () => setOpen(v => !v) }, open ? 'Read less' : 'Read more'));
  }

  /** A post: its topic, then the listing's own details (never typed into the post), the agent's message and a link to the listing. */
  function PostCard({ post: p, agency, onOpen }) {
    const l = p.listing, photo = safeImage(p.photo) || (l && safeImage(l.photo));
    const facts = l ? [Number(l.bedrooms) > 0 ? plural(l.bedrooms, 'bed') : '', Number(l.bathrooms) > 0 ? plural(l.bathrooms, 'bath') : '',
      Number(l.floorArea) > 0 ? `${Number(l.floorArea).toLocaleString('en-US')} ${l.floorUnit || 'sqft'}` : '', l.place].filter(Boolean).join(' · ') : '';
    return h('article', { className: 'dh-ap-post' },
      photo && h('img', { src: photo, alt: l ? l.title : '', loading: 'lazy' }),
      h('div', { className: 'dh-ap-post-body' },
        POST_TOPIC_LABELS[p.topic] && h('span', { className: 'dh-ap-post-topic' + (p.topic === 'closed' ? ' is-closed' : '') }, POST_TOPIC_LABELS[p.topic]),
        l && h('strong', { className: 'dh-ap-post-title' }, l.title),
        l && Number(l.price) > 0 && h('span', { className: 'dh-ap-post-price' }, `${l.currency || 'LKR'} ${Number(l.price).toLocaleString('en-US')}${l.pricePeriod ? ' / ' + l.pricePeriod : ''}`),
        facts && h('span', { className: 'dh-ap-post-facts' }, facts),
        p.caption && h('p', null, p.caption),
        h('small', null, [agency, timeAgo(p.at)].filter(Boolean).join(' · '),
          l && l.live ? h('button', { type: 'button', className: 'dh-ap-link', onClick: () => onOpen(l.reference) }, 'View listing →') : null)));
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
    const listings = agent ? agent.listings || [] : [], areas = agent ? (agent.areas || []).filter(Boolean) : [];
    const rent = listings.filter(l => l.purpose !== 'buy').length, sale = listings.length - rent;
    // A full page over the site: cover band, the agent's details, then About, listings and posts.
    return h('div', { className: 'dh-ap-full', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dh-ap-name' },
      h('div', { className: 'dh-ap-topbar' },
        h('button', { type: 'button', className: 'dh-ap-topbar-back', onClick: close }, from ? '← Back to listing' : '← Back to DwellHunt'),
        h('button', { type: 'button', className: 'dh-ap-close', onClick: close, 'aria-label': from ? 'Close and go back to the listing' : 'Close' }, '×')),
      state === 'loading' && h('p', { role: 'status', className: 'dh-ap-full-status' }, 'Loading profile…'),
      state === 'missing' && h('p', { role: 'status', className: 'dh-ap-full-status' }, 'This agent profile is not available.'),
      agent && h('div', { className: 'dh-ap-full-inner' },
        h('div', { className: 'dh-ap-cover', 'aria-hidden': 'true' }, h('span', null, 'DwellHunt Verified agent')),
        h('header', { className: 'dh-ap-hero' },
          avatar(agent, 'xl'),
          h('div', { className: 'dh-ap-hero-text' },
            h('h2', { id: 'dh-ap-name' }, agent.name || agent.agency),
            agent.name && agent.agency && h('p', { className: 'dh-ap-agency' }, agent.agency),
            h('p', { className: 'dh-ap-stats' }, h('b', null, listings.length), ` active ${listings.length === 1 ? 'property' : 'properties'}`,
              [rent ? ` · ${rent} for rent` : '', sale ? ` · ${sale} for sale` : ''].join('')),
            h('div', { className: 'dh-ap-badges' }, profileBadges(h, agent)))),
        h('div', { className: 'dh-ap-layout' },
          h('main', { className: 'dh-ap-main' },
            h('section', { className: 'dh-ap-box' }, h('h3', null, `About ${agent.name || agent.agency}`),
              agent.bio ? h(AboutText, { text: agent.bio }) : h('p', { className: 'dh-ap-muted' }, 'This agent has not added an introduction yet.'),
              languageLine(agent.languages) && h('p', { className: 'dh-ap-speaks' }, languageLine(agent.languages)),
              h('dl', { className: 'dh-ap-facts' },
                [['Agency', agent.agency], ['Specialises in', areas.join(', ')],
                 ['Video viewings', agent.videoViewings ? 'Available on a live video call' : ''], ['Verification', 'DwellHunt Verified agent']]
                  .filter(([, v]) => v).flatMap(([k, v]) => [h('dt', { key: k + 't' }, k), h('dd', { key: k + 'd' }, v)]))),
            h('section', { className: 'dh-ap-box' }, h('h3', null, 'Active properties'), h(ProfileListings, { listings, onOpen: openListing })),
            agent.posts && agent.posts.length > 0 && h('section', { className: 'dh-ap-box' }, h('h3', null, 'Posts'),
              h('div', { className: 'dh-ap-posts' }, agent.posts.map(p => h(PostCard, { key: p.id, post: p, agency: agent.agency, onOpen: openListing }))))))));
  }
  return { AgentStrip, AgentProfileOverlay };
}
