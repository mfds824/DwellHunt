// Verified owner and agent listings on the homepage. Data comes from the Worker's read-only feed; contact always goes through DwellHunt.
// Agent listings (listedBy "agent") get an enquiry form: the lead is saved and scored by DwellHunt and emailed to the agent.
const WHATSAPP = 'https://wa.me/94770153678?text=';
const CATEGORY = { house: 'House', annex: 'Annex', room: 'Room', apartment: 'Apartment', villa: 'Villa', commercial: 'Commercial space', land: 'Land' };
const safeImage = url => typeof url === 'string' && /^https:\/\/res\.cloudinary\.com\//.test(url) ? url : '';
const number = value => Number(value).toLocaleString('en-US');

export function ownerPriceText(l) {
  const period = l.purpose === 'buy' ? '' : l.billingPeriod === 'night' ? ' / night' : l.billingPeriod === 'year' ? ' / year' : ' / month';
  return Number(l.price) > 0 ? `${l.currency || 'LKR'} ${number(l.price)}${period}` : 'Price on request';
}
export function ownerFacts(l) {
  const facts = [];
  if (Number(l.bedrooms) > 0) facts.push(`${l.bedrooms} bed${Number(l.bedrooms) === 1 ? '' : 's'}`);
  if (Number(l.bathrooms) > 0) facts.push(`${l.bathrooms} bath${Number(l.bathrooms) === 1 ? '' : 's'}`);
  if (Number(l.floorArea) > 0) facts.push(`${number(l.floorArea)} ${l.floorUnit || 'sqft'}`);
  if (Number(l.landArea) > 0) facts.push(`${number(l.landArea)} ${l.landUnit || 'perches'}`);
  return facts;
}
export function ownerPlace(l) {
  const loc = l.location || {};
  return [loc.building, loc.address, loc.city, loc.district].filter(Boolean).join(', ');
}
export function ownerEnquiryUrl(l, kind = 'enquiry') {
  const text = kind === 'viewing'
    ? `Hi DwellHunt, I would like to view ${l.title} (ref ${l.reference}). My preferred dates are: `
    : `Hi DwellHunt, I am interested in ${l.title} (ref ${l.reference}). `;
  return WHATSAPP + encodeURIComponent(text);
}
/** Keeps only well-formed listings from the feed, newest first. */
export function cleanFeed(body) {
  const list = body && body.ok === true && Array.isArray(body.listings) ? body.listings : [];
  return list.filter(l => l && typeof l.reference === 'string' && /^OL-\d{4}-\d{4}$/.test(l.reference) && typeof l.title === 'string' &&
    Array.isArray(l.photos) && l.photos.some(p => safeImage(p && p.url)))
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}
export const isAgentListing = l => !!l && l.listedBy === 'agent';
export function listerLabel(l) { return `Listed by ${(l.contact && l.contact.displayName) || 'Private owner'} · ✓ Verified ${isAgentListing(l) ? 'agent' : 'owner'}`; }
/** The lead the agent-listing enquiry form sends (same shape as the property-page enquiry form). */
export function agentEnquiryPayload(l, f, at = new Date()) {
  return { customer_name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), enquiry_type: 'general', property: l.title,
    property_id: l.reference, agency_id: '', location: (l.location && l.location.city) || '', budget: '', message: f.message.trim(),
    preferred_date: '', source: 'DwellHunt Website', submittedAt: at.toISOString(), lead_id: 'enq-' + at.getTime(), consent: true, consent_at: at.toISOString() };
}
export function referenceFromHash(hash) {
  const match = /^#owner-listing=(OL-\d{4}-\d{4})$/.exec(decodeURIComponent(String(hash || '')));
  return match ? match[1] : '';
}

let feedPromise = null;
function loadFeed() {
  const url = (window.DWELLHUNT_VIEWING || {}).ownerListingsFeedUrl;
  if (!url) return Promise.resolve([]);
  feedPromise ||= fetch(url, { headers: { Accept: 'application/json' } }).then(r => { if (!r.ok) throw new Error('feed'); return r.json(); }).then(cleanFeed).catch(() => { feedPromise = null; return []; });
  return feedPromise;
}

export function createOwnerFeed(React) {
  const h = React.createElement;
  /** Enquiry form for agent listings. lead-turnstile.js adds the human check when this posts to leadUrl. */
  function AgentEnquiry({ listing: l }) {
    const agency = (l.contact && l.contact.displayName) || 'the agent';
    const [f, setF] = React.useState({ name: '', email: '', phone: '', message: `Hello, I'm interested in "${l.title}". Please send me more details.`, consent: false });
    const [state, setState] = React.useState({ phase: 'idle', message: '' });
    const honeypot = React.useRef(null);
    const set = key => event => setF(old => ({ ...old, [key]: key === 'consent' ? event.target.checked : event.target.value }));
    const submit = async event => {
      event.preventDefault();
      if (honeypot.current && honeypot.current.value) { setState({ phase: 'done', message: '' }); return; }
      if (!f.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) || !f.consent) { setState({ phase: 'error', message: 'Please add your name and email, and tick the consent box.' }); return; }
      const url = (window.DWELLHUNT_VIEWING || {}).leadUrl;
      if (!url) { setState({ phase: 'error', message: 'Enquiries are being set up. Please use WhatsApp for now.' }); return; }
      let times = [];
      try { times = JSON.parse(localStorage.getItem('dwellhunt_enquiry_times') || '[]').filter(t => typeof t === 'number' && Date.now() - t < 6e5); } catch { /* no storage */ }
      if (times.length >= 5) { setState({ phase: 'error', message: 'You have sent several enquiries in a few minutes. Please wait a little and try again.' }); return; }
      try { localStorage.setItem('dwellhunt_enquiry_times', JSON.stringify([...times, Date.now()])); } catch { /* no storage */ }
      setState({ phase: 'sending', message: '' });
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(agentEnquiryPayload(l, f)) });
        if (!response.ok) throw new Error('send');
        setState({ phase: 'done', message: '' });
      } catch { setState({ phase: 'error', message: 'Your enquiry could not be sent. Please try again, or use WhatsApp.' }); }
    };
    if (state.phase === 'done') return h('div', { className: 'dh-ol-enquiry dh-ol-enquiry-done', role: 'status' },
      h('strong', null, 'Enquiry sent'), h('p', null, `${agency} will contact you soon. We’ve emailed you a confirmation.`));
    return h('form', { className: 'dh-ol-enquiry', onSubmit: submit, noValidate: true, 'aria-labelledby': 'dh-ol-enquiry-title' },
      h('h3', { id: 'dh-ol-enquiry-title' }, `Send an enquiry to ${agency}`),
      h('div', { className: 'dh-ol-enquiry-row' },
        h('label', null, 'Your name', h('input', { value: f.name, onChange: set('name'), autoComplete: 'name', required: true })),
        h('label', null, 'Email', h('input', { type: 'email', value: f.email, onChange: set('email'), autoComplete: 'email', required: true }))),
      h('label', null, 'Phone / WhatsApp (optional)', h('input', { type: 'tel', value: f.phone, onChange: set('phone'), autoComplete: 'tel' })),
      h('label', null, 'Message', h('textarea', { rows: 3, value: f.message, onChange: set('message') })),
      h('label', { className: 'dh-ol-enquiry-consent' }, h('input', { type: 'checkbox', checked: f.consent, onChange: set('consent') }),
        h('span', null, `I agree that DwellHunt and ${agency} may use these details to reply to this enquiry.`)),
      h('div', { className: 'dh-hp', 'aria-hidden': 'true' }, h('label', null, 'Leave empty', h('input', { ref: honeypot, type: 'text', tabIndex: -1, autoComplete: 'off', defaultValue: '' }))),
      state.message && h('p', { className: 'dh-ol-enquiry-error', role: 'alert' }, state.message),
      h('button', { type: 'submit', className: 'dh-button', disabled: state.phase === 'sending' }, state.phase === 'sending' ? 'Sending…' : 'Send enquiry'));
  }
  function Detail({ listing: l, onClose }) {
    const [photo, setPhoto] = React.useState(0);
    const dialog = React.useRef(null);
    const photos = l.photos.map(p => safeImage(p.url)).filter(Boolean);
    React.useEffect(() => {
      const previous = document.activeElement; dialog.current?.focus();
      const key = event => { if (event.key === 'Escape') onClose(); };
      document.addEventListener('keydown', key); document.body.style.overflow = 'hidden';
      return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; previous?.focus?.(); };
    }, []);
    const rows = [
      ['Type', CATEGORY[l.category] || 'Property'], ['Price', ownerPriceText(l)], ['Location', ownerPlace(l)],
      l.furnishing && ['Furnishing', ({ unfurnished: 'Unfurnished', 'semi-furnished': 'Partly furnished', 'fully-furnished': 'Fully furnished' })[l.furnishing] || String(l.furnishing)],
      l.availableFrom && ['Available from', l.availableFrom],
      Number(l.minimumLeaseMonths) > 0 && ['Minimum lease', `${l.minimumLeaseMonths} months`],
      Number(l.minimumNights) > 0 && ['Minimum stay', `${l.minimumNights} nights`],
      l.advanceMonths !== undefined && l.advanceMonths !== null && l.purpose !== 'buy' && l.billingPeriod !== 'night' && ['Advance', Number(l.advanceMonths) === 0 ? 'None' : `${l.advanceMonths} months`],
      Number(l.securityDeposit) > 0 && ['Security deposit', `${l.currency || 'LKR'} ${number(l.securityDeposit)}`],
    ].filter(Boolean);
    return h('div', { className: 'dh-ol-backdrop', onClick: event => { if (event.target === event.currentTarget) onClose(); } },
      h('div', { className: 'dh-ol-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dh-ol-title', tabIndex: -1, ref: dialog },
        h('button', { type: 'button', className: 'dh-ol-close', onClick: onClose, 'aria-label': 'Close' }, '×'),
        photos.length > 0 && h('div', { className: 'dh-ol-gallery' },
          h('img', { src: photos[photo], alt: `${l.title} — photo ${photo + 1} of ${photos.length}` }),
          photos.length > 1 && h('div', { className: 'dh-ol-gallery-nav' },
            h('button', { type: 'button', onClick: () => setPhoto((photo + photos.length - 1) % photos.length), 'aria-label': 'Previous photo' }, '‹'),
            h('span', null, `${photo + 1} / ${photos.length}`),
            h('button', { type: 'button', onClick: () => setPhoto((photo + 1) % photos.length), 'aria-label': 'Next photo' }, '›'))),
        h('div', { className: 'dh-ol-body' },
          h('p', { className: 'dh-ol-badge' }, isAgentListing(l) ? '✓ Verified agent' : '✓ Verified owner'),
          h('h2', { id: 'dh-ol-title' }, l.title),
          h('p', { className: 'dh-price' }, ownerPriceText(l)),
          h('p', null, ownerPlace(l)),
          ownerFacts(l).length > 0 && h('p', { className: 'dh-ol-facts' }, ownerFacts(l).join(' · ')),
          isAgentListing(l) && l.agentId && h('p', null, h('button', { type: 'button', className: 'dh-ap-link', onClick: () => { location.hash = 'agent=' + l.agentId; } },
            `View ${(l.contact && l.contact.displayName) || 'the agent'}’s profile →`)),
          isAgentListing(l) && h(AgentEnquiry, { listing: l }),
          h('div', { className: 'dh-card-actions' },
            h('a', { className: isAgentListing(l) ? 'dh-text-button' : 'dh-button', href: ownerEnquiryUrl(l), target: '_blank', rel: 'noopener noreferrer' }, isAgentListing(l) ? 'Or ask DwellHunt on WhatsApp' : 'Enquire on WhatsApp'),
            h('a', { className: 'dh-text-button', href: ownerEnquiryUrl(l, 'viewing'), target: '_blank', rel: 'noopener noreferrer' }, 'Request a viewing')),
          h('p', { className: 'dh-ol-note' }, isAgentListing(l)
            ? `Listed by ${(l.contact && l.contact.displayName) || 'a DwellHunt agent'}, an agent verified by DwellHunt. Enquiries sent here are emailed to the agent, and DwellHunt keeps a copy. Ref ${l.reference}.`
            : `Listed by ${(l.contact && l.contact.displayName) || 'Private owner'}. DwellHunt verified this owner and handles every enquiry, so the owner’s contact details stay private. Ref ${l.reference}.`),
          h('dl', { className: 'dh-ol-specs' }, rows.flatMap(([k, v]) => [h('dt', { key: k + 't' }, k), h('dd', { key: k + 'd' }, v)])),
          isAgentListing(l)
            ? h('details', { className: 'dh-ol-verified' }, h('summary', null, 'What does “verified agent” mean?'),
                h('p', null, 'DwellHunt checked this agent’s details before approving their account, and reviews each of their listings before it goes live. This is not a legal title check.'))
            : h('details', { className: 'dh-ol-verified' }, h('summary', null, 'What does “verified owner” mean?'),
                h('p', null, 'DwellHunt spoke to the owner by phone and saw one proof of ownership, such as a utility bill, rates notice or deed page. This is not a legal title check.')),
          h('p', { className: 'dh-ol-diligence' }, 'DwellHunt checks who is listing a property but does not guarantee title, boundaries or approvals. Before paying any money, have a lawyer check the deed and do a title search.'),
          l.description && h('div', { className: 'dh-ol-description' }, String(l.description).split(/\n{2,}/).map((part, i) => h('p', { key: i }, part))),
          Array.isArray(l.features) && l.features.length > 0 && h('p', null, h('strong', null, 'Features: '), l.features.join(', ')))));
  }

  return function OwnerFeed() {
    const [listings, setListings] = React.useState([]);
    const [open, setOpen] = React.useState(() => referenceFromHash(location.hash));
    React.useEffect(() => { let live = true; loadFeed().then(list => { if (live) setListings(list); }); return () => { live = false; }; }, []);
    React.useEffect(() => {
      const sync = () => setOpen(referenceFromHash(location.hash));
      window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync);
    }, []);
    const show = reference => { history.replaceState(null, '', reference ? '#owner-listing=' + reference : location.pathname + location.search); setOpen(reference); };
    const current = open && listings.find(l => l.reference === open);
    if (!listings.length) return null;
    const anyAgent = listings.some(isAgentListing);
    return h('section', { className: 'dh-section dh-owner-feed', id: 'dh-owner-listings', 'aria-labelledby': 'dh-owner-feed-title' },
      h('div', { className: 'dh-section-heading' },
        h('div', null, h('p', { className: 'dh-eyebrow' }, anyAgent ? 'Verified listings' : 'Direct from owners'),
          h('h2', { id: 'dh-owner-feed-title' }, anyAgent ? 'Listed by owners and agents, verified by DwellHunt.' : 'Listed by owners, verified by DwellHunt.')),
        h('p', null, anyAgent ? 'We check every owner and agent before their listings go live. Enquire through DwellHunt and we will connect you.'
          : 'We checked each owner by phone and saw a proof of ownership. Enquire through DwellHunt and we will connect you.')),
      h('div', { className: 'dh-property-grid' }, listings.slice(0, 12).map(l => h('article', { key: l.reference, className: 'dh-property' },
        h('div', { className: 'dh-property-photo' },
          h('img', { src: safeImage(l.photos[0].url), alt: l.title, loading: 'lazy', width: 600, height: 450 }),
          h('span', { className: 'dh-purpose-badge' }, l.purpose === 'buy' ? 'For sale' : 'For rent')),
        h('div', { className: 'dh-property-body' },
          h('h3', null, h('button', { type: 'button', className: 'dh-title-link', onClick: () => show(l.reference) }, l.title)),
          h('p', null, ownerPlace(l)),
          h('p', { className: 'dh-price' }, ownerPriceText(l)),
          ownerFacts(l).length > 0 && h('p', null, ownerFacts(l).join(' · ')),
          isAgentListing(l) && l.agentId
            ? h('p', { className: 'dh-agency' }, 'Listed by ', h('button', { type: 'button', className: 'dh-ap-link', onClick: () => { location.hash = 'agent=' + l.agentId; } },
                (l.contact && l.contact.displayName) || 'a verified agent'), ' · ✓ Verified agent')
            : h('p', { className: 'dh-agency' }, listerLabel(l)),
          h('div', { className: 'dh-card-actions' },
            h('button', { type: 'button', className: 'dh-text-button', onClick: () => show(l.reference) }, 'View details'),
            isAgentListing(l) ? h('button', { type: 'button', className: 'dh-text-button', onClick: () => show(l.reference) }, 'Enquire')
              : h('a', { className: 'dh-text-button', href: ownerEnquiryUrl(l), target: '_blank', rel: 'noopener noreferrer' }, 'Enquire')))))),
      current && h(Detail, { listing: current, onClose: () => show('') }),
      open && !current && h('p', { className: 'dh-results-note', role: 'status' }, 'That listing is no longer available. Browse the other owner listings above.'));
  };
}
