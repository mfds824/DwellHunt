// Verified owner and agent listings on the homepage. Data comes from the Worker's read-only feed; contact always goes through DwellHunt.
// Agent listings (listedBy "agent") get an enquiry form: the lead is saved and scored by DwellHunt and emailed to the agent.
import { verifiedBadge } from './verified-badge.js?v=20261124-vb2';
import { createListingPage, monthlyPayment } from "./listing-page.js?v=20261124-vb2";
import { createCountryCodePicker } from "./country-code-picker.js?v=20261123-cc1";
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
  const text = kind === 'video'
    ? `Hi DwellHunt, I would like a video viewing of ${l.title} (ref ${l.reference}). My preferred dates are: `
    : kind === 'viewing'
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
/** Owner rentals get the enquiry form too; DwellHunt screens each enquiry and forwards it to the owner. */
export const hasEnquiryForm = l => isAgentListing(l) || (!!l && l.purpose !== 'buy');
/** The lead the listing enquiry form sends (same shape as the property-page enquiry form). A chosen date makes it a viewing request;
 * a video choice (only on listings whose owner offers video viewings) makes it a video viewing request. */
export function agentEnquiryPayload(l, f, at = new Date()) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(f.date || '')) ? f.date : '';
  const video = !!(l && l.videoViewing) && !isAgentListing(l) && f.viewing === 'video';
  return { customer_name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), enquiry_type: video ? 'video_viewing' : date ? 'schedule_tour' : 'general', property: l.title,
    property_id: l.reference, agency_id: '', location: (l.location && l.location.city) || '', budget: '', message: f.message.trim(),
    preferred_date: date, source: 'DwellHunt Website', submittedAt: at.toISOString(), lead_id: 'enq-' + at.getTime(), consent: true, consent_at: at.toISOString() };
}
/* Video viewing booking (owner listings that offer video viewings). The owner's free 30-minute times come from the Worker
 * as UTC start times and are shown in the buyer's own time zone, with the Sri Lanka time alongside. */
export const buyerTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Colombo'; } catch { return 'Asia/Colombo'; } };
const fmt = (iso, zone, opts) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...opts }).format(new Date(iso)); } catch { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', ...opts }).format(new Date(iso)); } };
export const slotDay = (iso, zone) => fmt(iso, zone, { weekday: 'short', day: 'numeric', month: 'short' });
export const slotTime = (iso, zone) => fmt(iso, zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Free times grouped by the buyer's local day: [{ day, slots: [iso] }]. */
export function groupSlots(slots, zone) {
  const days = [];
  slots.forEach(iso => { const day = slotDay(iso, zone), last = days[days.length - 1]; if (last && last.day === day) last.slots.push(iso); else days.push({ day, slots: [iso] }); });
  return days;
}
export const VR_QUESTIONS = (sale) => [
  ['timeline', sale ? 'When do you plan to buy?' : 'When do you want to move in?', [['now', 'Within a month'], ['1-3', 'In 1-3 months'], ['3-6', 'In 3-6 months'], ['later', 'Later / just looking']]],
  sale ? ['payment', 'How will you pay?', [['cash', 'Cash / own funds'], ['loan-approved', 'Home loan approved'], ['loan-applying', 'Applying for a loan'], ['not-yet', 'Not decided yet']]]
    : ['occupants', 'Who will live there?', [['family', 'A family'], ['couple', 'A couple'], ['single', 'One person'], ['sharing', 'Friends sharing'], ['company', 'A company / staff']]],
  ['budget', 'Does the price fit your budget?', [['yes', 'Yes'], ['close', 'It is close'], ['no', 'It is above my budget']]],
];
/** "+94" and "077 123 4567" become "+94771234567": spaces dropped, and a leading 0 of the local number too. */
export function whatsappNumber(code, number) {
  const local = String(number || '').replace(/\D/g, '').replace(/^0+/, '');
  return local ? String(code || '').replace(/[^\d+]/g, '') + local : '';
}
export function videoRequestPayload(l, f, zone) {
  const sale = l.purpose === 'buy', answers = { timeline: f.timeline, budget: f.budget };
  answers[sale ? 'payment' : 'occupants'] = sale ? f.payment : f.occupants;
  return { reference: l.reference, slot: f.slot, name: f.name.trim(), email: f.email.trim(), whatsapp: whatsappNumber(f.code, f.whatsapp), timezone: zone,
    answers, message: f.message.trim(), rules: f.rules === true, consent: f.consent === true, website: f.website || '' };
}
const slotCache = {};
/** { phase: 'loading' | 'ready', slots } for a listing; an empty list when video booking is not open. */
export function useOwnerSlots(React, reference) {
  const [state, setState] = React.useState(() => slotCache[reference] ? { phase: 'ready', slots: slotCache[reference] } : { phase: reference ? 'loading' : 'ready', slots: [] });
  React.useEffect(() => {
    const url = (window.DWELLHUNT_VIEWING || {}).ownerSlotsUrl;
    if (!reference || slotCache[reference]) return undefined;
    if (!url) { setState({ phase: 'ready', slots: [] }); return undefined; }
    let live = true;
    fetch(url + '?ref=' + encodeURIComponent(reference), { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : { slots: [] }).catch(() => ({ slots: [] }))
      .then(body => { const slots = Array.isArray(body.slots) ? body.slots.filter(s => typeof s === 'string' && Date.parse(s) > Date.now()) : [];
        slotCache[reference] = slots; if (live) setState({ phase: 'ready', slots }); });
    return () => { live = false; };
  }, [reference]);
  return state;
}
const VR_ERRORS = { SLOT_TAKEN: 'Sorry, that time was just taken. Please pick another time.', ALREADY_REQUESTED: 'You have already asked for a video viewing of this home. Check your email for the details.',
  TOO_MANY_REQUESTS: 'You have several open video viewing requests. Please wait for an answer before asking for more.', NOT_OPEN: 'Video viewings are not open for this home right now. Please send an enquiry instead.',
  LISTING_NOT_AVAILABLE: 'Video viewings are not open for this home right now. Please send an enquiry instead.', HUMAN_VERIFICATION_REQUIRED: 'The security check did not complete. Please try again.' };

export function createVideoBooking(React) {
  const h = React.createElement;
  const CountryCodePicker = createCountryCodePicker(React);
  return function VideoBooking({ listing: l, slots, onBack }) {
    const sale = l.purpose === 'buy', zone = buyerTimeZone(), colombo = zone === 'Asia/Colombo';
    const days = React.useMemo(() => groupSlots(slots, zone), [slots, zone]);
    const [day, setDay] = React.useState(0);
    const [f, setF] = React.useState({ slot: '', name: '', email: '', country: 'LK', code: '+94', whatsapp: '', timeline: '', payment: '', occupants: '', budget: '', message: '', rules: false, consent: false });
    const [state, setState] = React.useState({ phase: 'idle', message: '' });
    const honeypot = React.useRef(null);
    const set = key => event => setF(old => ({ ...old, [key]: key === 'rules' || key === 'consent' ? event.target.checked : event.target.value }));
    const when = iso => `${slotDay(iso, zone)}, ${slotTime(iso, zone)}${colombo ? '' : ` your time (${slotTime(iso, 'Asia/Colombo')} in Sri Lanka)`}`;
    const submit = async event => {
      event.preventDefault();
      const questions = VR_QUESTIONS(sale);
      if (!f.slot) { setState({ phase: 'error', message: 'Please choose a time.' }); return; }
      if (!f.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) || whatsappNumber(f.code, f.whatsapp).replace(/\D/g, '').length < 8) { setState({ phase: 'error', message: 'Please add your name, email and WhatsApp number.' }); return; }
      if (questions.some(([key]) => !f[key])) { setState({ phase: 'error', message: 'Please answer the three short questions.' }); return; }
      if (!f.rules || !f.consent) { setState({ phase: 'error', message: 'Please tick both boxes at the end.' }); return; }
      const url = (window.DWELLHUNT_VIEWING || {}).viewingRequestUrl;
      if (!url) { setState({ phase: 'error', message: VR_ERRORS.NOT_OPEN }); return; }
      setState({ phase: 'sending', message: '' });
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(videoRequestPayload(l, { ...f, website: honeypot.current ? honeypot.current.value : '' }, zone)) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.ok !== true) { if (body.code === 'SLOT_TAKEN') delete slotCache[l.reference]; throw new Error(body.code || 'send'); }
        setState({ phase: 'done', message: '' });
      } catch (error) { setState({ phase: 'error', message: VR_ERRORS[error.message] || 'Your request could not be sent. Please try again, or send an enquiry instead.' }); }
    };
    if (state.phase === 'done') return h('div', { className: 'dh-ol-enquiry dh-ol-enquiry-done', role: 'status' },
      h('strong', null, 'Video viewing requested'),
      h('p', null, `You asked for ${when(f.slot)}. The owner will answer within 12 hours, and we will email you the video call link if they accept. We've emailed you a confirmation.`));
    const current = days[Math.min(day, days.length - 1)];
    return h('form', { className: 'dh-ol-enquiry dh-vb', onSubmit: submit, noValidate: true, 'aria-labelledby': 'dh-vb-title' },
      h('h3', { id: 'dh-vb-title' }, 'Book a video viewing'),
      h('p', { className: 'dh-ol-enquiry-note' }, 'The owner shows you the home on a 30-minute video call. Pick a time, answer three short questions, and the owner confirms within 12 hours.'),
      h('p', { className: 'dh-vb-zone' }, colombo ? 'Times are Sri Lanka time.' : `Times are shown in your time zone (${zone}).`),
      h('div', { className: 'dh-vb-days', role: 'tablist', 'aria-label': 'Day' }, days.map((d, n) => h('button', { key: d.day, type: 'button', role: 'tab',
        'aria-selected': n === day ? 'true' : 'false', className: 'dh-vb-day', onClick: () => setDay(n) }, d.day))),
      current && h('div', { className: 'dh-vb-times' }, current.slots.map(iso => h('button', { key: iso, type: 'button', className: 'dh-vb-time',
        'aria-pressed': f.slot === iso ? 'true' : 'false', title: colombo ? '' : `${slotTime(iso, 'Asia/Colombo')} in Sri Lanka`, onClick: () => setF(old => ({ ...old, slot: iso })) }, slotTime(iso, zone)))),
      f.slot && h('p', { className: 'dh-vb-picked', role: 'status' }, '✓ ', when(f.slot)),
      h('div', { className: 'dh-ol-enquiry-row' },
        h('label', null, 'Your name', h('input', { value: f.name, onChange: set('name'), autoComplete: 'name', required: true })),
        h('label', null, 'Email', h('input', { type: 'email', value: f.email, onChange: set('email'), autoComplete: 'email', required: true }))),
      h('div', { className: 'dh-vb-phone' },
        h(CountryCodePicker, { country: f.country, code: f.code, idPrefix: 'dh-vb', label: 'Country code', required: false,
          hint: f.country === 'LK' ? 'Sri Lanka (+94) is chosen for you.' : 'Your WhatsApp country.',
          onSelect: (country, code) => setF(old => ({ ...old, country, code: country === 'manual' ? old.code : code })) }),
        f.country === 'manual' && h('label', null, 'Country code', h('input', { type: 'tel', value: f.code, onChange: set('code'), placeholder: '+94', inputMode: 'tel' })),
        h('label', null, 'WhatsApp number', h('input', { type: 'tel', value: f.whatsapp, onChange: set('whatsapp'), autoComplete: 'tel-national', inputMode: 'tel',
          placeholder: f.code === '+94' ? '77 123 4567' : 'Phone number', required: true }))),
      VR_QUESTIONS(sale).map(([key, legend, options]) => h('fieldset', { key, className: 'dh-ol-enquiry-viewing dh-vb-q' }, h('legend', null, legend),
        options.map(([value, label]) => h('label', { key: value }, h('input', { type: 'radio', name: 'dh-vb-' + key, value, checked: f[key] === value, onChange: set(key) }), h('span', null, label))))),
      h('label', null, 'Anything the owner should know? (optional)', h('textarea', { rows: 2, value: f.message, onChange: set('message'), maxLength: 600 })),
      h('label', { className: 'dh-ol-enquiry-consent' }, h('input', { type: 'checkbox', checked: f.rules, onChange: set('rules') }),
        h('span', null, 'I will not record the call. I understand DwellHunt never asks for an advance or deposit before I (or someone I trust) visit in person and a lawyer checks the deed.')),
      h('label', { className: 'dh-ol-enquiry-consent' }, h('input', { type: 'checkbox', checked: f.consent, onChange: set('consent') }),
        h('span', null, 'I agree that DwellHunt may use these details to arrange the viewing. The owner sees my first name and answers, not my phone or email.')),
      h('div', { className: 'dh-hp', 'aria-hidden': 'true' }, h('label', null, 'Leave empty', h('input', { ref: honeypot, type: 'text', tabIndex: -1, autoComplete: 'off', defaultValue: '' }))),
      state.message && h('p', { className: 'dh-ol-enquiry-error', role: 'alert' }, state.message),
      h('button', { type: 'submit', className: 'dh-button', disabled: state.phase === 'sending' }, state.phase === 'sending' ? 'Sending…' : 'Request this time'),
      onBack && h('button', { type: 'button', className: 'dh-text-button dh-vb-back', onClick: onBack }, 'None of these times work? Send an enquiry instead'));
  };
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
  const VideoBooking = createVideoBooking(React);
  function AgentEnquiry({ listing: l }) {
    const owner = !isAgentListing(l);
    const agency = (l.contact && l.contact.displayName) || (owner ? 'the owner' : 'the agent');
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    const video = owner && l.videoViewing === true;
    const [f, setF] = React.useState({ name: '', email: '', phone: '', date: '', viewing: 'in-person', consent: false,
      message: owner ? `Hello, I'm interested in renting "${l.title}". Is it still available?` : `Hello, I'm interested in "${l.title}". Please send me more details.` });
    const [state, setState] = React.useState({ phase: 'idle', message: '' });
    const honeypot = React.useRef(null);
    // With free times from the owner, "Video call" opens the booking form; "None of these times work?" comes back here.
    const times = useOwnerSlots(React, video ? l.reference : '');
    const [pickTimes, setPickTimes] = React.useState(true);
    const set = key => event => setF(old => ({ ...old, [key]: key === 'consent' ? event.target.checked : event.target.value }));
    if (video && f.viewing === 'video' && pickTimes && times.slots.length) return h('div', null,
      h('button', { type: 'button', className: 'dh-text-button dh-vb-back', onClick: () => setF(old => ({ ...old, viewing: 'in-person' })) }, '← View in person or ask a question instead'),
      h(VideoBooking, { listing: l, slots: times.slots, onBack: () => setPickTimes(false) }));
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
      h('strong', null, 'Enquiry sent'), h('p', null, owner
        ? 'DwellHunt will check your enquiry and ask the owner if it’s still available, then contact you. We’ve emailed you a confirmation.'
        : `${agency} will contact you soon. We’ve emailed you a confirmation.`));
    return h('form', { className: 'dh-ol-enquiry', onSubmit: submit, noValidate: true, 'aria-labelledby': 'dh-ol-enquiry-title' },
      h('h3', { id: 'dh-ol-enquiry-title' }, owner ? 'Send an enquiry about this home' : `Send an enquiry to ${agency}`),
      h('div', { className: 'dh-ol-enquiry-row' },
        h('label', null, 'Your name', h('input', { value: f.name, onChange: set('name'), autoComplete: 'name', required: true })),
        h('label', null, 'Email', h('input', { type: 'email', value: f.email, onChange: set('email'), autoComplete: 'email', required: true }))),
      h('label', null, 'Phone / WhatsApp (optional)', h('input', { type: 'tel', value: f.phone, onChange: set('phone'), autoComplete: 'tel' })),
      video && h('fieldset', { className: 'dh-ol-enquiry-viewing' }, h('legend', null, 'How would you like to view it?'),
        [['in-person', 'In person'], ['video', 'Video call with the owner']].map(([value, label]) => h('label', { key: value },
          h('input', { type: 'radio', name: 'dh-ol-viewing', value, checked: f.viewing === value, onChange: set('viewing') }), h('span', null, label)))),
      owner && h('label', null, f.viewing === 'video' ? 'Preferred video call date (optional)' : 'Preferred viewing date (optional)',
        h('input', { type: 'date', min: today, value: f.date, onChange: set('date') })),
      video && f.viewing === 'video' && h('p', { className: 'dh-ol-enquiry-note' }, 'The owner walks you through the home on a Google Meet video call. DwellHunt agrees the time with the owner and emails you the link.'),
      h('label', null, 'Message', h('textarea', { rows: 3, value: f.message, onChange: set('message') })),
      h('label', { className: 'dh-ol-enquiry-consent' }, h('input', { type: 'checkbox', checked: f.consent, onChange: set('consent') }),
        h('span', null, owner ? 'I agree that DwellHunt may use these details to reply. DwellHunt shares my first name and message with the owner, not my phone or email.'
          : `I agree that DwellHunt and ${agency} may use these details to reply to this enquiry.`)),
      h('div', { className: 'dh-hp', 'aria-hidden': 'true' }, h('label', null, 'Leave empty', h('input', { ref: honeypot, type: 'text', tabIndex: -1, autoComplete: 'off', defaultValue: '' }))),
      state.message && h('p', { className: 'dh-ol-enquiry-error', role: 'alert' }, state.message),
      h('button', { type: 'submit', className: 'dh-button', disabled: state.phase === 'sending' }, state.phase === 'sending' ? 'Sending…' : 'Send enquiry'));
  }
  const useSlots = reference => useOwnerSlots(React, reference);
  const ListingPage = createListingPage(React, { AgentEnquiry, VideoBooking, useSlots, hasEnquiryForm, CATEGORY, safeImage, ownerPriceText, ownerPlace, ownerFacts, ownerEnquiryUrl, isAgentListing });

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
          l.purpose === 'buy' && (l.currency || 'LKR') === 'LKR' && Number(l.price) > 0 &&
            h('p', { className: 'dh-monthly-estimate' }, `≈ LKR ${Math.round(monthlyPayment(Number(l.price) * 0.8, 12, 20)).toLocaleString('en-US')} / month with a home loan`),
          ownerFacts(l).length > 0 && h('p', null, ownerFacts(l).join(' · ')),
          isAgentListing(l) && l.agentId
            ? h('p', { className: 'dh-agency' }, 'Listed by ', h('button', { type: 'button', className: 'dh-ap-link', onClick: () => { location.hash = 'agent=' + l.agentId; } },
                (l.contact && l.contact.displayName) || 'a verified agent'), ' ', verifiedBadge(h, 'sm'))
            : h('p', { className: 'dh-agency' }, listerLabel(l)),
          h('div', { className: 'dh-card-actions' },
            h('button', { type: 'button', className: 'dh-text-button', onClick: () => show(l.reference) }, 'View details'),
            hasEnquiryForm(l) ? h('button', { type: 'button', className: 'dh-text-button', onClick: () => show(l.reference) }, 'Enquire')
              : h('a', { className: 'dh-text-button', href: ownerEnquiryUrl(l), target: '_blank', rel: 'noopener noreferrer' }, 'Enquire')))))),
      current && h(ListingPage, { listing: current, others: listings.filter(o => o.reference !== current.reference), onClose: () => show(''), onOpen: show }),
      open && !current && h('p', { className: 'dh-results-note', role: 'status' }, 'That listing is no longer available. Browse the other owner listings above.'));
  };
}
