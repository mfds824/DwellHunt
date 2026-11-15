// Verified owner listings on the homepage. Data comes from the Worker's read-only feed; contact always goes through DwellHunt.
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
          h('p', { className: 'dh-ol-badge' }, '✓ Verified by DwellHunt'),
          h('h2', { id: 'dh-ol-title' }, l.title),
          h('p', { className: 'dh-price' }, ownerPriceText(l)),
          h('p', null, ownerPlace(l)),
          ownerFacts(l).length > 0 && h('p', { className: 'dh-ol-facts' }, ownerFacts(l).join(' · ')),
          h('div', { className: 'dh-card-actions' },
            h('a', { className: 'dh-button', href: ownerEnquiryUrl(l), target: '_blank', rel: 'noopener noreferrer' }, 'Enquire on WhatsApp'),
            h('a', { className: 'dh-text-button', href: ownerEnquiryUrl(l, 'viewing'), target: '_blank', rel: 'noopener noreferrer' }, 'Request a viewing')),
          h('p', { className: 'dh-ol-note' }, `Listed by ${(l.contact && l.contact.displayName) || 'Private owner'}. DwellHunt verified this owner and handles every enquiry, so the owner’s contact details stay private. Ref ${l.reference}.`),
          h('dl', { className: 'dh-ol-specs' }, rows.flatMap(([k, v]) => [h('dt', { key: k + 't' }, k), h('dd', { key: k + 'd' }, v)])),
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
    return h('section', { className: 'dh-section dh-owner-feed', id: 'dh-owner-listings', 'aria-labelledby': 'dh-owner-feed-title' },
      h('div', { className: 'dh-section-heading' },
        h('div', null, h('p', { className: 'dh-eyebrow' }, 'Direct from owners'), h('h2', { id: 'dh-owner-feed-title' }, 'Listed by owners, verified by DwellHunt.')),
        h('p', null, 'Every owner was checked by phone with proof of ownership. Enquire through DwellHunt and we will connect you.')),
      h('div', { className: 'dh-property-grid' }, listings.slice(0, 12).map(l => h('article', { key: l.reference, className: 'dh-property' },
        h('div', { className: 'dh-property-photo' },
          h('img', { src: safeImage(l.photos[0].url), alt: l.title, loading: 'lazy', width: 600, height: 450 }),
          h('span', { className: 'dh-purpose-badge' }, l.purpose === 'buy' ? 'For sale' : 'For rent')),
        h('div', { className: 'dh-property-body' },
          h('h3', null, h('button', { type: 'button', className: 'dh-title-link', onClick: () => show(l.reference) }, l.title)),
          h('p', null, ownerPlace(l)),
          h('p', { className: 'dh-price' }, ownerPriceText(l)),
          ownerFacts(l).length > 0 && h('p', null, ownerFacts(l).join(' · ')),
          h('p', { className: 'dh-agency' }, `Listed by ${(l.contact && l.contact.displayName) || 'Private owner'} · ✓ Verified by DwellHunt`),
          h('div', { className: 'dh-card-actions' },
            h('button', { type: 'button', className: 'dh-text-button', onClick: () => show(l.reference) }, 'View details'),
            h('a', { className: 'dh-text-button', href: ownerEnquiryUrl(l), target: '_blank', rel: 'noopener noreferrer' }, 'Enquire')))))),
      current && h(Detail, { listing: current, onClose: () => show('') }),
      open && !current && h('p', { className: 'dh-results-note', role: 'status' }, 'That listing is no longer available. Browse the other owner listings above.'));
  };
}
