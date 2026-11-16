// Verified owner and agent listings on the homepage. Data comes from the Worker's read-only feed; contact always goes through DwellHunt.
// Agent listings (listedBy "agent") get an enquiry form: the lead is saved and scored by DwellHunt and emailed to the agent.
import { createListingPage } from "./listing-page.js?v=20261117-lp1";
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
  const ListingPage = createListingPage(React, { AgentEnquiry, CATEGORY, safeImage, ownerPriceText, ownerPlace, ownerFacts, ownerEnquiryUrl, isAgentListing });

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
      current && h(ListingPage, { listing: current, others: listings.filter(o => o.reference !== current.reference), onClose: () => show(''), onOpen: show }),
      open && !current && h('p', { className: 'dh-results-note', role: 'status' }, 'That listing is no longer available. Browse the other owner listings above.'));
  };
}
