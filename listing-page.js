// Full-page listing view for verified owner and agent listings (opened from the homepage feed at #owner-listing=OL-…).
// Layout: photo collage + lightbox, price and key facts, highlights, facts & features, cost estimate, map, lister card,
// and a sticky contact card. All contact still goes through DwellHunt (the agent enquiry form or DwellHunt's WhatsApp).
const LABEL = {
  furnishing: { unfurnished: 'Unfurnished', 'semi-furnished': 'Partly furnished', 'fully-furnished': 'Fully furnished' },
  parkingType: { covered: 'covered', open: 'open', garage: 'garage', street: 'street' },
  rentalType: { 'long-term': 'Long-term rental', 'short-term': 'Short-term rental' },
};
const ANNEX = {
  position: { upstairs: 'Upper floor of a house', ground: 'Ground floor, attached to a house', detached: 'Separate building on the same land' },
  kitchen: { own: 'Own kitchen', pantry: 'Pantry / kitchenette', shared: 'Shared with the main house', none: 'No kitchen' },
  scope: { 'with-house': 'The annex and the main house', 'annex-only': 'The annex only, with its own deed or land share' },
};
const number = value => Number(value).toLocaleString('en-US');
const yesNo = value => value === true || value === 'yes' ? 'Yes' : value === false || value === 'no' ? 'No' : '';
const titleCase = text => String(text || '').replace(/(^|[\s,(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const words = list => (Array.isArray(list) ? list : []).map(item => titleCase(String(item).replace(/-/g, ' '))).filter(Boolean);
/** The most useful guide for this listing (guides/ on the same site). */
export function guideFor(l) {
  if (l.category === 'annex') return l.purpose === 'buy' ? ['buying-an-annex-sri-lanka', 'Buying an annex: deed, land share and approvals']
    : ['renting-an-annex-colombo', 'Renting an annex: 10 things to check'];
  if (l.purpose !== 'buy') return ['rent-advance-and-deposit-sri-lanka', 'Rent advance and security deposit, explained'];
  return l.category === 'apartment' ? ['freehold-vs-leasehold-apartments', 'Freehold vs leasehold apartments'] : ['certificate-of-conformity', 'What is a Certificate of Conformity (CoC)?'];
}
export function ordinal(n) {
  const v = Math.abs(Math.trunc(Number(n))); const s = v % 100 >= 11 && v % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th';
  return v + s;
}
/** Monthly instalment for a loan of `principal` at `ratePct` % a year over `years` (standard amortising formula). */
export function monthlyPayment(principal, ratePct, years) {
  const p = Number(principal), n = Math.round(Number(years) * 12), r = Number(ratePct) / 1200;
  if (!(p > 0) || !(n > 0) || !(r >= 0)) return 0;
  if (r === 0) return p / n;
  const f = Math.pow(1 + r, n);
  return (p * r * f) / (f - 1);
}
/** What a tenant pays before moving in: the advance (months of rent) plus the security deposit. */
export function moveInCost(l) {
  const rent = Number(l.price) || 0, months = Number(l.advanceMonths) || 0, deposit = Number(l.securityDeposit) || 0;
  return { advance: rent * months, months, deposit, total: rent * months + deposit };
}
export function pricePerArea(l) {
  return l.purpose === 'buy' && Number(l.price) > 0 && Number(l.floorArea) > 0 ? Math.round(Number(l.price) / Number(l.floorArea)) : 0;
}
export function listedAgo(iso, now = Date.now()) {
  const t = Date.parse(iso || ''); if (!t) return '';
  const days = Math.max(0, Math.floor((now - t) / 864e5));
  return days === 0 ? 'Listed today' : days === 1 ? 'Listed 1 day ago' : `Listed ${days} days ago`;
}
export function availableText(l, now = new Date()) {
  if (l.availability) return String(l.availability);
  if (!l.availableFrom) return '';
  const d = new Date(l.availableFrom + 'T00:00:00');
  if (isNaN(d)) return '';
  return d <= now ? 'Available now' : 'Available from ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
/** Grouped "Facts & features" rows; empty values are dropped and empty groups removed. */
export function factGroups(l, category = {}) {
  const money = v => `${l.currency || 'LKR'} ${number(v)}`;
  const area = Number(l.floorArea) > 0 ? `${number(l.floorArea)} ${l.floorUnit || 'sqft'}` : '';
  const parking = Number(l.parking) > 0 ? `${l.parking} space${Number(l.parking) === 1 ? '' : 's'}${l.parkingType ? ' (' + (LABEL.parkingType[l.parkingType] || l.parkingType) + ')' : ''}` : '';
  const maintenance = l.maintenanceIncluded ? 'Included in rent' : Number(l.maintenance) > 0 ? `${money(l.maintenance)} / ${l.maintenancePeriod || 'month'}` : '';
  const groups = [
    ['Interior', [
      ['Bedrooms', Number(l.bedrooms) > 0 ? String(l.bedrooms) : l.apartmentType === 'studio' ? 'Studio' : ''],
      ['Bathrooms', Number(l.bathrooms) > 0 ? String(l.bathrooms) : ''],
      ['Floor area', area],
      ['Furnishing', LABEL.furnishing[l.furnishing] || (l.furnishing ? titleCase(l.furnishing) : '')],
      ['Balcony', yesNo(l.balcony)],
      ['Condition', l.condition ? String(l.condition) : ''],
    ]],
    ['Property', [
      ['Type', [category[l.category] || titleCase(l.category || 'Property'), l.apartmentType && l.apartmentType !== 'studio' ? titleCase(l.apartmentType) : l.apartmentType === 'studio' ? 'Studio' : ''].filter(Boolean).join(' · ')],
      ['Floor', Number(l.floorNumber) > 0 ? `${ordinal(l.floorNumber)} floor` : Number(l.floorNumber) === 0 && l.floorNumber !== null && l.floorNumber !== undefined ? 'Ground floor' : ''],
      ['Land area', Number(l.landArea) > 0 ? `${number(l.landArea)} ${l.landUnit || 'perches'}` : ''],
      ['Parking', parking],
      ['Position', ANNEX.position[l.annexPosition] || ''],
      ['Entrance', l.separateEntrance === 'yes' ? 'Own separate entrance' : l.separateEntrance === 'no' ? 'Shared with the main house' : ''],
      ['Kitchen', ANNEX.kitchen[l.kitchenType] || ''],
      ['Owner lives on site', l.ownerOnPremises === 'yes' ? 'Yes, in the main house' : l.ownerOnPremises === 'no' ? 'No' : ''],
      ['Shared facilities', words(l.sharedFacilities).join(', ')],
      ['Separate meters', yesNo(l.separateMeters)],
    ]],
    [l.purpose === 'buy' ? 'Sale terms' : 'Rental terms', l.purpose === 'buy' ? [
      ['Price', Number(l.price) > 0 ? money(l.price) : 'On request'],
      ['Sale includes', ANNEX.scope[l.saleScope] || ''],
      ['Negotiable', l.negotiable ? 'Yes' : ''],
      ['Price per ' + (l.floorUnit || 'sqft'), pricePerArea(l) ? money(pricePerArea(l)) : ''],
      ['Availability', availableText(l)],
      ['Viewings', l.videoViewing ? 'In person or by video call' : ''],
    ] : [
      ['Rental type', LABEL.rentalType[l.rentalType] || ''],
      ['Available', availableText(l)],
      ['Viewings', l.videoViewing ? 'In person or by video call' : ''],
      ['Minimum lease', Number(l.minimumLeaseMonths) > 0 ? `${l.minimumLeaseMonths} months` : ''],
      ['Minimum stay', Number(l.minimumNights) > 0 ? `${l.minimumNights} nights` : ''],
      ['Advance', l.billingPeriod !== 'night' && l.advanceMonths !== undefined && l.advanceMonths !== null ? (Number(l.advanceMonths) === 0 ? 'None' : `${l.advanceMonths} months`) : ''],
      ['Security deposit', Number(l.securityDeposit) > 0 ? money(l.securityDeposit) : ''],
      ['Notice period', Number(l.noticePeriodMonths) > 0 ? `${l.noticePeriodMonths} month${Number(l.noticePeriodMonths) === 1 ? '' : 's'}` : ''],
      ['Maintenance', maintenance],
      ['Utilities included', words(l.includedUtilities).join(', ')],
      ['Suitable for', words(l.tenantTypes).join(', ')],
      ['Pets', l.petsAllowed === 'yes' ? 'Allowed' : l.petsAllowed === 'no' ? 'Not allowed' : ''],
      ['Other charges', l.additionalCharges ? String(l.additionalCharges) : ''],
    ]],
  ];
  return groups.map(([title, rows]) => [title, rows.filter(([, v]) => v)]).filter(([, rows]) => rows.length);
}

export const REPORT_REASONS = [['unavailable', 'Already rented or sold'], ['price', 'Wrong price'], ['photos', 'Photos are not of this property'],
  ['fake', 'Looks fake or a scam'], ['details', 'Wrong details or location'], ['other', 'Something else']];
/** Checks a report before it is sent. Returns an error message, or '' when it is ready. */
export function reportProblem(f) {
  if (!REPORT_REASONS.some(([id]) => id === f.reason)) return 'Choose what is wrong with this listing.';
  if (f.reason === 'other' && !String(f.note || '').trim()) return 'Tell us briefly what is wrong.';
  if (String(f.note || '').length > 500) return 'Please keep the note under 500 characters.';
  return '';
}

export function createListingPage(React, d) {
  const h = React.createElement;

  /** Anonymous "Report this listing". lead-turnstile.js adds the human check when this posts to listingReportUrl. */
  function ReportListing({ listing: l }) {
    const [open, setOpen] = React.useState(false);
    const [f, setF] = React.useState({ reason: '', note: '' });
    const [state, setState] = React.useState({ phase: 'idle', message: '' });
    const honeypot = React.useRef(null);
    if (!open) return h('button', { type: 'button', className: 'dh-lp-report-link', onClick: () => setOpen(true) }, '🚩 Report this listing');
    if (state.phase === 'done') return h('div', { className: 'dh-lp-report', role: 'status' }, h('strong', null, 'Thank you, report sent'),
      h('p', null, 'DwellHunt will check this listing with the lister. We don’t share who reported it.'));
    const submit = async e => {
      e.preventDefault();
      if (honeypot.current && honeypot.current.value) { setState({ phase: 'done', message: '' }); return; }
      const problem = reportProblem(f);
      if (problem) { setState({ phase: 'error', message: problem }); return; }
      const url = (window.DWELLHUNT_VIEWING || {}).listingReportUrl;
      if (!url) { setState({ phase: 'error', message: 'Reports are not available right now. Please tell us on WhatsApp.' }); return; }
      setState({ phase: 'sending', message: '' });
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference: l.reference, reason: f.reason, note: f.note.trim() }) });
        if (r.status === 404) { setState({ phase: 'error', message: 'This listing is no longer live, so it can’t be reported.' }); return; }
        if (!r.ok) throw new Error('send');
        setState({ phase: 'done', message: '' });
      } catch { setState({ phase: 'error', message: 'Your report could not be sent. Please try again.' }); }
    };
    return h('form', { className: 'dh-lp-report', onSubmit: submit, noValidate: true, 'aria-labelledby': 'dh-lp-report-title' },
      h('h3', { id: 'dh-lp-report-title' }, 'Report this listing'),
      h('p', null, 'Tell DwellHunt if something looks wrong. Reports are anonymous.'),
      h('fieldset', null, h('legend', null, 'What’s wrong?'),
        REPORT_REASONS.map(([id, label]) => h('label', { key: id, className: 'dh-lp-report-option' },
          h('input', { type: 'radio', name: 'dh-lp-report-reason', value: id, checked: f.reason === id, onChange: () => setF(o => ({ ...o, reason: id })) }), label))),
      h('label', { className: 'dh-lp-report-note' }, f.reason === 'other' ? 'What’s wrong?' : 'Anything else? (optional)',
        h('textarea', { rows: 3, maxLength: 500, value: f.note, onChange: e => setF(o => ({ ...o, note: e.target.value })) })),
      h('div', { className: 'dh-hp', 'aria-hidden': 'true' }, h('label', null, 'Leave empty', h('input', { ref: honeypot, type: 'text', tabIndex: -1, autoComplete: 'off', defaultValue: '' }))),
      state.message && h('p', { className: 'dh-ol-enquiry-error', role: 'alert' }, state.message),
      h('div', { className: 'dh-lp-report-actions' },
        h('button', { type: 'submit', className: 'dh-button', disabled: state.phase === 'sending' }, state.phase === 'sending' ? 'Sending…' : 'Send report'),
        h('button', { type: 'button', className: 'dh-text-button', onClick: () => { setOpen(false); setState({ phase: 'idle', message: '' }); } }, 'Cancel')));
  }
  const money = (l, v) => `${l.currency || 'LKR'} ${number(Math.round(v))}`;

  function Lightbox({ photos, start, title, onClose }) {
    const [i, setI] = React.useState(start);
    const box = React.useRef(null);
    const go = step => setI(old => (old + step + photos.length) % photos.length);
    React.useEffect(() => {
      box.current?.focus();
      const key = e => { if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
      document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true);
    }, []);
    return h('div', { className: 'dh-lp-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photos', tabIndex: -1, ref: box },
      h('div', { className: 'dh-lp-lightbox-bar' }, h('span', null, `${i + 1} / ${photos.length}`),
        h('button', { type: 'button', onClick: onClose, 'aria-label': 'Close photos' }, '×')),
      h('img', { src: photos[i].url, alt: `${title} — ${photos[i].label || 'photo ' + (i + 1)}` }),
      photos.length > 1 && h('button', { type: 'button', className: 'dh-lp-lb-prev', onClick: () => go(-1), 'aria-label': 'Previous photo' }, '‹'),
      photos.length > 1 && h('button', { type: 'button', className: 'dh-lp-lb-next', onClick: () => go(1), 'aria-label': 'Next photo' }, '›'),
      h('div', { className: 'dh-lp-thumbs' }, photos.map((p, n) => h('button', { key: n, type: 'button', className: n === i ? 'is-on' : '', onClick: () => setI(n), 'aria-label': `Show ${p.label || 'photo ' + (n + 1)}` },
        h('img', { src: p.url, alt: '', loading: 'lazy' })))));
  }

  function Calculator({ listing: l }) {
    const [down, setDown] = React.useState(20), [rate, setRate] = React.useState(12), [years, setYears] = React.useState(20);
    const price = Number(l.price) || 0;
    const loan = price * (1 - down / 100);
    const monthly = monthlyPayment(loan, rate, years);
    const field = (label, value, set, min, max, step, suffix) => h('label', null, h('span', null, label),
      h('span', { className: 'dh-lp-calc-input' }, h('input', { type: 'number', inputMode: 'decimal', value, min, max, step, onChange: e => { const v = Number(e.target.value); if (v >= min && v <= max) set(v); } }), h('em', null, suffix)));
    return h('div', { className: 'dh-lp-calc' },
      h('div', { className: 'dh-lp-calc-result' }, h('small', null, 'Estimated monthly loan payment'), h('strong', null, money(l, monthly)),
        h('span', null, `Down payment ${money(l, price - loan)} · Loan ${money(l, loan)}`)),
      h('div', { className: 'dh-lp-calc-fields' },
        field('Down payment', down, setDown, 0, 100, 5, '%'), field('Interest rate', rate, setRate, 0, 40, 0.25, '% a year'), field('Loan term', years, setYears, 1, 35, 1, 'years')),
      h('p', { className: 'dh-lp-fine' }, 'A rough estimate to help you plan, not a loan offer. Ask your bank for its current rates and fees.'));
  }

  function MoveIn({ listing: l }) {
    const c = moveInCost(l);
    if (!c.total) return null;
    return h('div', { className: 'dh-lp-calc' },
      h('div', { className: 'dh-lp-calc-result' }, h('small', null, 'Paid before moving in'), h('strong', null, money(l, c.total))),
      h('dl', { className: 'dh-lp-costs' },
        c.months > 0 && [h('dt', { key: 'a' }, `Advance (${c.months} month${c.months === 1 ? '' : 's'} of rent)`), h('dd', { key: 'b' }, money(l, c.advance))],
        c.deposit > 0 && [h('dt', { key: 'c' }, 'Security deposit (refundable)'), h('dd', { key: 'd' }, money(l, c.deposit))]),
      h('p', { className: 'dh-lp-fine' }, 'Based on the terms in this listing. Confirm the final amounts before you pay anything.'));
  }

  function ContactCard({ listing: l }) {
    const agent = d.isAgentListing(l);
    const name = (l.contact && l.contact.displayName) || (agent ? 'the agent' : 'the owner');
    // Sale listings have no enquiry form: with free times from the owner, they show the video booking form instead of the WhatsApp link.
    const saleVideo = !agent && l.videoViewing === true && !d.hasEnquiryForm(l);
    const times = d.useSlots ? d.useSlots(saleVideo ? l.reference : '') : { slots: [] };
    const booking = saleVideo && d.VideoBooking && times.slots.length > 0;
    return h('div', { className: 'dh-lp-contact', id: 'dh-lp-contact' },
      h('p', { className: 'dh-lp-contact-price' }, d.ownerPriceText(l)),
      booking && h(d.VideoBooking, { listing: l, slots: times.slots }),
      d.hasEnquiryForm(l) ? h(d.AgentEnquiry, { listing: l }) : h('div', { className: 'dh-lp-contact-owner' },
        h('h3', null, `Contact ${name} through DwellHunt`),
        h('p', null, 'DwellHunt verified this owner and passes your message on, so their phone number stays private.')),
      h('div', { className: 'dh-lp-contact-actions' },
        h('a', { className: d.hasEnquiryForm(l) ? 'dh-text-button' : 'dh-button', href: d.ownerEnquiryUrl(l), target: '_blank', rel: 'noopener noreferrer' }, d.hasEnquiryForm(l) ? 'Or ask DwellHunt on WhatsApp' : 'Enquire on WhatsApp'),
        h('a', { className: 'dh-text-button', href: d.ownerEnquiryUrl(l, 'viewing'), target: '_blank', rel: 'noopener noreferrer' }, 'Request a viewing'),
        saleVideo && !booking &&
          h('a', { className: 'dh-text-button', href: d.ownerEnquiryUrl(l, 'video'), target: '_blank', rel: 'noopener noreferrer' }, 'Request a video viewing')),
      h('p', { className: 'dh-lp-fine' }, `Ref ${l.reference}`));
  }

  return function ListingPage({ listing: l, others = [], onClose, onOpen }) {
    const page = React.useRef(null);
    const [lightbox, setLightbox] = React.useState(-1);
    const [shared, setShared] = React.useState('');
    const photos = l.photos.map((p, n) => ({ url: d.safeImage(p && p.url), label: (p && p.caption) || `photo ${n + 1}` })).filter(p => p.url);
    const plan = d.safeImage(l.floorPlan);
    const gallery = plan ? [...photos, { url: plan, label: 'floor plan' }] : photos;
    const agent = d.isAgentListing(l);
    const lister = (l.contact && l.contact.displayName) || (agent ? 'A DwellHunt agent' : 'Private owner');
    const place = titleCase(d.ownerPlace(l));
    const mapQuery = [l.location && l.location.building, l.location && l.location.address, l.location && l.location.city, l.location && l.location.district, 'Sri Lanka'].filter(Boolean).join(', ');
    const chips = [
      [d.CATEGORY[l.category] || 'Property', l.apartmentType ? titleCase(l.apartmentType) : ''],
      [LABEL.furnishing[l.furnishing] || '', ''],
      [l.separateEntrance === 'yes' ? 'Separate entrance' : '', ''],
      [l.kitchenType === 'own' ? 'Own kitchen' : '', ''],
      [Number(l.parking) > 0 ? `${l.parking} parking` : '', l.parkingType ? LABEL.parkingType[l.parkingType] || l.parkingType : ''],
      [Number(l.floorNumber) > 0 ? `${ordinal(l.floorNumber)} floor` : '', ''],
      [pricePerArea(l) ? `${money(l, pricePerArea(l))}` : '', pricePerArea(l) ? 'per ' + (l.floorUnit || 'sqft') : ''],
      [availableText(l), ''],
      [listedAgo(l.publishedAt), 'on DwellHunt'],
    ].filter(([a]) => a);
    const facts = [
      Number(l.bedrooms) > 0 ? [l.bedrooms, Number(l.bedrooms) === 1 ? 'bed' : 'beds'] : l.apartmentType === 'studio' ? ['Studio', ''] : null,
      Number(l.bathrooms) > 0 ? [l.bathrooms, Number(l.bathrooms) === 1 ? 'bath' : 'baths'] : null,
      Number(l.floorArea) > 0 ? [number(l.floorArea), l.floorUnit || 'sqft'] : null,
      Number(l.landArea) > 0 ? [number(l.landArea), l.landUnit || 'perches'] : null,
    ].filter(Boolean);

    React.useEffect(() => {
      const previous = document.activeElement; page.current?.focus(); page.current?.scrollTo?.(0, 0);
      const key = e => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('keydown', key); document.body.style.overflow = 'hidden'; document.body.classList.add('dh-lp-open');
      return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; document.body.classList.remove('dh-lp-open'); previous?.focus?.(); };
    }, [l.reference]);

    const share = async () => {
      const url = location.origin + location.pathname + '#owner-listing=' + l.reference;
      try {
        if (navigator.share) { await navigator.share({ title: l.title, url }); return; }
        await navigator.clipboard.writeText(url); setShared('Link copied');
      } catch { setShared(''); }
      setTimeout(() => setShared(''), 2500);
    };
    const tile = (p, n, extra = '') => h('button', { key: n, type: 'button', className: 'dh-lp-tile ' + extra, onClick: () => setLightbox(n), 'aria-label': `Open ${p.label}` },
      h('img', { src: p.url, alt: n === 0 ? l.title : `${l.title} — ${p.label}`, loading: n === 0 ? 'eager' : 'lazy' }),
      p.label === 'floor plan' && h('span', { className: 'dh-lp-tile-tag' }, 'Floor plan'));

    return h('div', { className: 'dh-lp', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dh-lp-title', tabIndex: -1, ref: page },
      h('div', { className: 'dh-lp-bar' },
        h('button', { type: 'button', className: 'dh-lp-back', onClick: onClose }, '← Back to listings'),
        h('div', { className: 'dh-lp-bar-actions' },
          shared && h('span', { role: 'status', className: 'dh-lp-shared' }, shared),
          h('button', { type: 'button', onClick: share }, 'Share'),
          h('button', { type: 'button', onClick: onClose, 'aria-label': 'Close listing', className: 'dh-lp-x' }, '×'))),
      h('div', { className: 'dh-lp-wrap' },
        gallery.length > 0 && h('div', { className: `dh-lp-gallery dh-lp-gallery-${Math.min(gallery.length, 5)}` },
          gallery.slice(0, 5).map((p, n) => tile(p, n, (n === 0 ? 'is-main ' : '') + (p.label === 'floor plan' ? 'is-plan' : ''))),
          h('button', { type: 'button', className: 'dh-lp-all', onClick: () => setLightbox(0) }, gallery.length === 1 ? 'View photo' : `See all ${gallery.length} photos`)),
        h('div', { className: 'dh-lp-grid' },
          h('main', { className: 'dh-lp-main' },
            h('p', { className: 'dh-lp-status' }, h('span', { className: 'dh-lp-dot', 'aria-hidden': 'true' }), l.purpose === 'buy' ? 'For sale' : 'For rent',
              l.negotiable && h('span', { className: 'dh-lp-pill' }, 'Price negotiable'),
              h('span', { className: 'dh-lp-pill is-verified' }, agent ? '✓ Verified agent' : '✓ Verified owner')),
            h('div', { className: 'dh-lp-headline' },
              h('p', { className: 'dh-lp-price' }, d.ownerPriceText(l)),
              facts.length > 0 && h('ul', { className: 'dh-lp-facts' }, facts.map(([v, u], n) => h('li', { key: n }, h('strong', null, v), u ? ' ' + u : '')))),
            h('h1', { id: 'dh-lp-title', className: 'dh-lp-title' }, l.title),
            h('p', { className: 'dh-lp-address' }, place),
            chips.length > 0 && h('ul', { className: 'dh-lp-chips' }, chips.map(([a, b], n) => h('li', { key: n }, h('strong', null, a), b && h('span', null, b)))),

            h('section', { className: 'dh-lp-section' },
              h('h2', null, 'Facts & features'),
              h('div', { className: 'dh-lp-groups' }, factGroups(l, d.CATEGORY).map(([title, rows]) => h('div', { key: title, className: 'dh-lp-group' },
                h('h3', null, title),
                h('dl', null, rows.flatMap(([k, v]) => [h('dt', { key: k + 't' }, k), h('dd', { key: k + 'd' }, v)]))))),
              Array.isArray(l.features) && l.features.length > 0 && h('div', { className: 'dh-lp-group dh-lp-features' },
                h('h3', null, 'Features'), h('ul', { className: 'dh-lp-tags' }, l.features.map(f => h('li', { key: f }, f))))),

            plan && h('section', { className: 'dh-lp-section' },
              h('h2', null, 'Floor plan'),
              h('button', { type: 'button', className: 'dh-lp-plan', onClick: () => setLightbox(gallery.length - 1) }, h('img', { src: plan, alt: `Floor plan of ${l.title}`, loading: 'lazy' }))),

            Number(l.price) > 0 && h('section', { className: 'dh-lp-section' },
              h('h2', null, l.purpose === 'buy' ? 'Monthly cost estimate' : 'Move-in cost'),
              l.purpose === 'buy' ? h(Calculator, { listing: l }) : h(MoveIn, { listing: l })),

            h('section', { className: 'dh-lp-section' },
              h('h2', null, 'Location'),
              h('p', { className: 'dh-lp-address' }, place),
              h('div', { className: 'dh-lp-map' }, h('iframe', { title: `Map of ${place}`, loading: 'lazy', referrerPolicy: 'no-referrer',
                src: 'https://maps.google.com/maps?q=' + encodeURIComponent(mapQuery) + '&z=14&output=embed' })),
              h('a', { className: 'dh-text-button', href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapQuery), target: '_blank', rel: 'noopener noreferrer' }, 'Open in Google Maps')),

            h('section', { className: 'dh-lp-section' },
              h('h2', null, 'Listed by'),
              h('div', { className: 'dh-lp-lister' },
                h('span', { className: 'dh-lp-avatar', 'aria-hidden': 'true' }, String(lister).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')),
                h('div', null, h('strong', null, lister), h('p', null, agent ? '✓ Verified agent · enquiries go through DwellHunt' : '✓ Verified owner · DwellHunt handles every enquiry'),
                  agent && l.agentId && h('button', { type: 'button', className: 'dh-ap-link', onClick: () => { location.hash = 'agent=' + l.agentId; } }, `View ${lister}’s profile →`))),
              h('details', { className: 'dh-ol-verified' }, h('summary', null, agent ? 'What does “verified agent” mean?' : 'What does “verified owner” mean?'),
                h('p', null, agent ? 'DwellHunt checked this agent’s details before approving their account, and reviews each of their listings before it goes live. This is not a legal title check.'
                  : 'DwellHunt spoke to the owner by phone and saw one proof of ownership, such as a utility bill, rates notice or deed page. This is not a legal title check.')),
              h('p', { className: 'dh-ol-diligence' }, 'DwellHunt checks who is listing a property but does not guarantee title, boundaries or approvals. Before paying any money, have a lawyer check the deed and do a title search.'),
              h('p', { className: 'dh-lp-guide' }, 'Guide: ', h('a', { href: './guides/' + guideFor(l)[0] + '.html' }, guideFor(l)[1] + ' →')),
              h('p', { className: 'dh-lp-fine' }, [listedAgo(l.publishedAt), `Ref ${l.reference}`].filter(Boolean).join(' · ')),
              h(ReportListing, { key: l.reference, listing: l })),

            others.length > 0 && h('section', { className: 'dh-lp-section' },
              h('h2', null, 'More verified listings'),
              h('div', { className: 'dh-lp-others' }, others.slice(0, 3).map(o => h('button', { key: o.reference, type: 'button', className: 'dh-lp-other', onClick: () => onOpen(o.reference) },
                h('img', { src: d.safeImage(o.photos[0] && o.photos[0].url), alt: '', loading: 'lazy' }),
                h('strong', null, d.ownerPriceText(o)), h('span', null, d.ownerFacts(o).join(' · ')), h('span', null, titleCase(d.ownerPlace(o)))))))),

          h('aside', { className: 'dh-lp-aside' }, h(ContactCard, { listing: l })))),
      h('div', { className: 'dh-lp-mobilebar' },
        h('span', null, h('strong', null, d.ownerPriceText(l))),
        h('a', { className: 'dh-button', href: '#dh-lp-contact', onClick: e => { e.preventDefault(); document.getElementById('dh-lp-contact')?.scrollIntoView({ behavior: 'smooth' }); } }, agent ? 'Contact agent' : 'Enquire')),
      lightbox >= 0 && h(Lightbox, { photos: gallery, start: lightbox, title: l.title, onClose: () => setLightbox(-1) }));
  };
}
