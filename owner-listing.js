import { OWNER_STEPS, CATEGORY_LABELS, APARTMENT_TYPES, COMMERCIAL_TYPES, LAND_TYPES, TENANT_TYPES, ANNEX_POSITIONS, KITCHEN_TYPES, SALE_SCOPES, rulesFor, createOwnerDraft, validateOwnerStep,
  validateOwnerDraft, publicOwnerListing, ownerSubmission, unusualFigures, saveOwnerDraft, loadOwnerDraft, OWNER_DRAFT_KEY, combineOwnerPhone,
  validatePhotoCount, safeUploadUrl } from './owner-listing-model.js?v=20261123-pn1';
import { uploadPropertyFile, validatePropertyFile } from './property-upload.js';
import { createCountryCodePicker } from './country-code-picker.js';
import { createPriceInput } from './price-input.js';
import { suggestOwnerTitles, titleFactsKey } from './title-suggestions.js?v=20261123-pn1';
import { draftOwnerDescription, descriptionFactsKey, descriptionBlocks, listingKeyFacts } from './description-draft.js?v=20261123-pn1';

const primary = 'px-6 py-3 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs disabled:opacity-40';
const secondary = 'px-5 py-2.5 rounded-xl border border-stone-200 text-xs font-bold text-stone-700 hover:bg-stone-50';
const control = 'w-full px-4 py-3 rounded-xl bg-stone-50 border border-stone-200 text-xs sm:text-sm text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-700';
const DISTRICTS = ['Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha', 'Hambantota', 'Jaffna', 'Kalutara', 'Kandy', 'Kegalle', 'Kilinochchi', 'Kurunegala', 'Mannar', 'Matale', 'Matara', 'Monaragala', 'Mullaitivu', 'Nuwara Eliya', 'Polonnaruwa', 'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya'];
const FEATURES = ['24-hour security', 'Backup power', 'Solar power', 'Air conditioning', 'Hot water', 'Lift access', 'Wheelchair access', 'Internet connection', 'Servant / maid room'];
const SHARED = ['Shared pool', 'Gym', 'Residents’ lounge', 'Children’s play area', 'Visitor parking'];
const WHATSAPP_URL = 'https://wa.me/94770153678?text=' + encodeURIComponent('Hi DwellHunt, I would like to list a property development.');

/** Turns a backend reply into a friendly message. */
export function submissionMessage(code) {
  return ({
    HUMAN_VERIFICATION_REQUIRED: 'The security check expired or failed. Please complete it again and press Send.',
    RATE_LIMITED: 'We have already received several listings from you today. Please try again tomorrow or message us on WhatsApp.',
    INVALID_REQUEST: 'Some details need checking. Please review the sections marked below.',
    PAYLOAD_TOO_LARGE: 'This listing is too large to send. Shorten the description and try again.',
    SIGNED_OUT: 'Your agent sign-in has ended. Your listing is still here — sign in again in a new tab, then press Send.',
  })[code] || 'We could not send your listing just now. Your details are still here — please try again in a few minutes.';
}
/** Sends the reviewed listing to DwellHunt. Throws an Error whose message is safe to show. */
export async function sendOwnerListing(url, submission, token, honeypot, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ...submission, turnstile_token: token, website: honeypot }) });
  } catch { throw Object.assign(new Error(submissionMessage('NETWORK')), { code: 'NETWORK' }); }
  let body = {};
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok || body.ok !== true || !body.reference) throw Object.assign(new Error(submissionMessage(body.code)), { code: body.code || 'SERVICE_UNAVAILABLE', fields: body.fields });
  return { reference: String(body.reference), duplicate: body.duplicate === true };
}

export function createOwnerStart(React) {
  const h = React.createElement;
  const choice = (name, value, current, set, text, disabled = false) => h('label', { key: value, 'data-selected': current === value,
    className: `dh-listing-choice p-3.5 rounded-2xl border text-center transition-all ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${current === value ? 'bg-emerald-50/70 text-emerald-950 border-emerald-700 ring-2 ring-emerald-600/20' : 'bg-stone-50 text-emerald-900 border-emerald-700 hover:bg-emerald-50'}` },
    h('input', { type: 'radio', name, value, checked: current === value, disabled, onChange: () => set(value), className: 'sr-only' }), h('span', { className: 'font-bold text-sm' }, text),
    current === value && h('span', { className: 'dh-listing-check', 'aria-hidden': 'true' }, '✓'));
  /** agent (optional): a signed-in agent starting a new listing; onAgencyPortal then returns to their dashboard. */
  return function OwnerStart({ onContinue, onAgencyPortal, agent }) {
    const [purpose, setPurpose] = React.useState('');
    const [category, setCategory] = React.useState('');
    React.useEffect(() => { if (purpose === 'buy' && category === 'room') setCategory(''); }, [purpose]);
    return h('div', { className: 'dh-owner py-12 bg-stone-50 min-h-screen' }, h('div', { className: 'max-w-3xl mx-auto px-4 sm:px-6 lg:px-8' },
      h('div', { className: 'text-center max-w-xl mx-auto mb-10' },
        h('span', { className: 'inline-flex px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 text-xs font-bold mb-2' }, agent ? 'AGENT LISTING · ' + String(agent.agency || '').toUpperCase() : 'FREE FOR PROPERTY OWNERS'),
        h('h1', { className: 'text-3xl sm:text-4xl font-black text-stone-900 tracking-tight' }, agent ? 'New listing' : 'List your property'),
        h('p', { className: 'text-stone-500 text-sm mt-2' }, agent ? 'Choose rent or sale and the property type. DwellHunt reviews every listing before it goes live for 1 month.'
          : 'Tell us about your home in 7 short steps. DwellHunt checks every listing, keeps your phone number private and screens enquiries for you.')),
      h('section', { className: 'bg-white rounded-3xl p-6 sm:p-10 border border-stone-200/90 shadow-sm space-y-8' },
        h('fieldset', { className: 'space-y-3' }, h('legend', { className: 'text-xs font-bold text-stone-700 uppercase tracking-wider mb-2' }, 'I want to'),
          h('div', { className: 'grid grid-cols-2 gap-3' }, choice('owner-purpose', 'rent', purpose, setPurpose, 'Rent it out'), choice('owner-purpose', 'buy', purpose, setPurpose, 'Sell it'))),
        h('fieldset', { className: 'space-y-3' }, h('legend', { className: 'text-xs font-bold text-stone-700 uppercase tracking-wider mb-2' }, 'Property type'),
          h('div', { className: 'grid grid-cols-3 gap-3' }, Object.entries(CATEGORY_LABELS)
            // House, Room / boarding, Commercial space and Land are no longer offered to owners; their labels stay for saved drafts.
            .filter(([value]) => !['house', 'room', 'commercial', 'land'].includes(value)).map(([value, text]) =>
            choice('owner-category', value, category, setCategory, text)))),
        h('div', { className: 'flex flex-wrap items-center justify-between gap-4' },
          h('span', { className: 'dh-owner-hint', role: 'status' }, purpose && category ? `${purpose === 'buy' ? 'Selling' : 'Renting out'} · ${CATEGORY_LABELS[category]}` : 'Choose both options to continue'),
          h('button', { type: 'button', className: primary, disabled: !purpose || !category, onClick: () => onContinue(purpose, category) }, 'Continue')),
        // Agents and development listings are offered on the "Who's listing today?" page, so owners see only their own form.
        agent && h('div', { className: 'dh-owner-note' }, h('button', { type: 'button', className: 'underline font-bold', onClick: onAgencyPortal }, '← Back to your dashboard')))));
  };
}

export function createOwnerListing(React) {
  const h = React.createElement;
  const CountryCodePicker = createCountryCodePicker(React);
  const PriceInput = createPriceInput(React);
  const button = (label, onClick, className = secondary, rest = {}) => h('button', { type: 'button', className, onClick, ...rest }, label);
  /** agent (optional): { session, agent } of a signed-in agent; the listing is then sent to the agent route. */
  return function OwnerListing({ draft, onDraftChange, onStart, agent }) {
    const d = draft, selection = d.selection, rules = rulesFor(selection.propertyCategory);
    const sale = selection.listingPurpose === 'buy', shortStay = !sale && d.rentalType === 'short-stay';
    const [errors, setErrors] = React.useState({});
    const [saveEnabled, setSaveEnabled] = React.useState(!!d.deviceSavingEnabled);
    const [saveState, setSaveState] = React.useState('');
    const [resume, setResume] = React.useState(null);
    const [notice, setNotice] = React.useState('');
    const [fileError, setFileError] = React.useState('');
    const [titleSuggestions, setTitleSuggestions] = React.useState(null);
    const [descriptionDraft, setDescriptionDraft] = React.useState(null);
    const [send, setSend] = React.useState({ phase: 'idle', message: '', reference: '' });
    const [token, setToken] = React.useState('');
    const files = React.useRef(new Map());
    const heading = React.useRef(null), captcha = React.useRef(null), widget = React.useRef(null), honeypot = React.useRef(null);
    const photoPicker = React.useRef(null), floorPlanPicker = React.useRef(null);
    const latest = React.useRef(d); latest.current = d;
    const patch = changes => onDraftChange(value => ({ ...value, ...changes }));
    const change = (key, value) => {
      onDraftChange(old => { const next = { ...old, [key]: value }; if (key === 'countryCode' || key === 'phoneNumber') next.phone = combineOwnerPhone(next.countryCode, next.phoneNumber); return next; });
      setErrors(old => { const next = { ...old }; delete next[key]; if (key === 'publicBuildingName') delete next.title; return next; });
    };
    const go = step => { patch({ step }); setErrors({}); setNotice(''); };
    React.useEffect(() => { try { const saved = loadOwnerDraft(localStorage); if (saved && saved.draft.id !== d.id) setResume(saved); } catch { /* an old or damaged copy is ignored */ } }, []);
    React.useEffect(() => { heading.current?.focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); }, [d.step, send.phase === 'done']);
    React.useEffect(() => {
      if (!saveEnabled || send.phase === 'done') return;
      const timer = setTimeout(() => {
        try { const at = saveOwnerDraft(localStorage, latest.current); setSaveState(`Saved on this browser at ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`); }
        catch { setSaveState('Could not save on this browser. Keep this page open.'); }
      }, 400);
      return () => clearTimeout(timer);
    }, [d, saveEnabled]);
    React.useEffect(() => () => { for (const p of [...latest.current.photos, latest.current.floorPlan].filter(Boolean)) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); }, []);
    // Cloudflare human check on the review step (action "owner_listing").
    React.useEffect(() => {
      if (d.step !== 6 || send.phase === 'done' || !captcha.current) return;
      const config = window.DWELLHUNT_VIEWING || {};
      if (!config.turnstileSiteKey) return;
      let cancelled = false;
      const load = () => window.turnstile ? Promise.resolve(window.turnstile) : new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
        s.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('unavailable')); s.onerror = reject; document.head.append(s);
      });
      load().then(api => {
        if (cancelled || !captcha.current) return;
        widget.current = api.render(captcha.current, { sitekey: config.turnstileSiteKey, action: 'owner_listing', theme: 'light', size: 'flexible',
          callback: value => setToken(value), 'expired-callback': () => setToken(''), 'error-callback': () => setToken('') });
      }).catch(() => setSend(old => ({ ...old, message: 'The security check could not load. Refresh the page and try again.' })));
      return () => { cancelled = true; try { if (widget.current !== null && window.turnstile) window.turnstile.remove(widget.current); } catch { /* ignore */ } widget.current = null; setToken(''); };
    }, [d.step, send.phase === 'done']);

    const field = (key, label, { type = 'text', optional = false, options, hint, action, ...extra } = {}) => {
      const id = `dh-owner-${key}`, error = errors[key];
      const props = { id, name: key, value: d[key], required: !optional, className: control, 'aria-invalid': !!error,
        'aria-describedby': [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined, onChange: event => change(key, event.target.value), ...extra };
      const labelText = `${label}${optional ? ' (optional)' : ''}`;
      return h('div', { key, className: 'dh-owner-field' },
        action ? h('div', { className: 'dh-owner-title-heading' }, h('label', { htmlFor: id, className: 'block text-xs font-bold text-stone-700' }, labelText), action)
          : h('label', { htmlFor: id, className: 'block text-xs font-bold text-stone-700 mb-2' }, labelText),
        options ? h('select', props, h('option', { value: '' }, 'Choose…'), options.map(option => { const [value, text] = Array.isArray(option) ? option : [option, option]; return h('option', { key: value, value }, text); }))
          : type === 'textarea' ? h('textarea', { ...props, rows: 5 }) : h('input', { ...props, type }),
        hint && h('p', { id: `${id}-hint`, className: 'dh-owner-hint' }, hint), error && h('p', { id: `${id}-error`, className: 'dh-owner-error' }, error));
    };
    const check = (key, label, hint) => h('div', { key, className: 'dh-owner-field' },
      h('label', { className: 'dh-owner-checkbox' }, h('input', { type: 'checkbox', name: key, checked: !!d[key], onChange: e => change(key, e.target.checked) }), h('span', null, label)),
      hint && h('p', { className: 'dh-owner-hint' }, hint), errors[key] && h('p', { className: 'dh-owner-error' }, errors[key]));
    const checks = (key, label, options) => h('fieldset', { key, className: 'dh-owner-field dh-listing-group' },
      h('legend', { className: 'block text-xs font-bold text-stone-700 mb-2' }, label),
      h('div', { className: 'dh-owner-checks' }, options.map(option => { const [value, text] = Array.isArray(option) ? option : [option, option];
        return h('label', { key: value, className: 'dh-owner-checkbox' }, h('input', { type: 'checkbox', checked: d[key].includes(value),
          onChange: e => change(key, e.target.checked ? [...d[key], value] : d[key].filter(item => item !== value)) }), text); })));
    const grid = (...children) => h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-4' }, ...children);
    const note = text => h('p', { className: 'dh-owner-note' }, text);

    // Photos are kept on this device until "Send for review"; nothing is uploaded before then.
    const pickFiles = (event, kind = 'photo') => {
      const picked = [...event.target.files]; event.target.value = '';
      if (kind === 'photo') { const limit = validatePhotoCount(latest.current.photos.length, picked.length); if (limit) { setFileError(limit); return; } }
      if (kind === 'floorPlan' && latest.current.floorPlan) { setFileError('Remove the current floor plan before choosing another.'); return; }
      setFileError('');
      const items = [];
      for (const file of picked) {
        const error = validatePropertyFile(file);
        if (error) { setFileError(`${file.name}: ${error}`); continue; }
        const item = { id: crypto.randomUUID(), name: file.name, kind, status: 'selected', url: '', previewUrl: URL.createObjectURL(file), error: '' };
        files.current.set(item.id, file); items.push(item);
      }
      onDraftChange(old => ({ ...old, photos: kind === 'photo' ? [...old.photos, ...items] : old.photos, floorPlan: kind === 'floorPlan' && items.length ? items[0] : old.floorPlan }));
      setErrors(old => { const next = { ...old }; delete next.photos; return next; });
    };
    const removeFile = item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); files.current.delete(item.id);
      onDraftChange(old => ({ ...old, photos: old.photos.filter(p => p.id !== item.id), floorPlan: old.floorPlan?.id === item.id ? null : old.floorPlan }));
    };
    const reorder = (id, move) => onDraftChange(old => {
      const photos = [...old.photos], index = photos.findIndex(p => p.id === id), target = move === 'cover' ? 0 : index + move;
      if (index < 0 || target < 0 || target >= photos.length) return old;
      photos.splice(target, 0, photos.splice(index, 1)[0]); return { ...old, photos };
    });
    const tile = (item, index) => h('li', { key: item.id, className: 'dh-owner-photo' },
      item.previewUrl || item.url ? h('img', { src: item.previewUrl || item.url, alt: item.kind === 'photo' ? `Property photo ${index + 1}` : 'Floor plan' }) : h('div', { className: 'dh-owner-photo-placeholder' }, 'Add this photo again'),
      h('strong', null, item.name), item.kind === 'photo' && h('span', { className: 'dh-owner-hint' }, index === 0 ? 'Cover photo' : `Photo ${index + 1}`),
      item.status === 'uploading' && h('p', { role: 'status', className: 'dh-owner-hint' }, 'Uploading…'),
      item.status === 'failed' && h('p', { className: 'dh-owner-error', role: 'alert' }, item.error || 'This photo needs attention. Remove it and add it again.'),
      h('div', { className: 'dh-owner-photo-actions' }, item.kind === 'photo' && h(React.Fragment, null,
        button('Move earlier', () => reorder(item.id, -1), secondary, { disabled: index === 0 }), button('Move later', () => reorder(item.id, 1), secondary, { disabled: index === d.photos.length - 1 }),
        button(index === 0 ? 'Cover photo' : 'Make cover', () => reorder(item.id, 'cover'), secondary, { disabled: index === 0 })),
        button('Remove', () => removeFile(item), secondary, { 'aria-label': `Remove ${item.name}` })));

    const preview = publicOwnerListing({ ...d, photos: d.photos.map(p => p.previewUrl && !p.url ? { ...p, status: 'ready', url: 'https://res.cloudinary.com/preview' } : p) });
    const previewPhotos = d.photos.map(p => p.previewUrl || p.url).filter(Boolean);
    const priceText = () => `${d.currency} ${d.price ? Number(d.price).toLocaleString('en-US') : '—'}${sale ? '' : shortStay ? ' / night' : d.billingPeriod === 'year' ? ' / year' : ' / month'}`;
    const locationText = [preview.location.address, preview.location.building, preview.location.city, preview.location.district].filter(Boolean).join(', ');
    const keyFacts = () => h('ul', { className: 'dh-owner-key-facts' }, listingKeyFacts(d).map((fact, i) => h('li', { key: fact.label }, i > 0 && h('span', { 'aria-hidden': true }, '·'), h('span', { 'aria-hidden': true }, fact.icon), h('span', null, fact.label))));
    const description = value => h('div', { className: 'dh-owner-description' }, descriptionBlocks(value).map((b, i) => b.type === 'list'
      ? h('ul', { key: i, className: 'dh-owner-description-features' }, b.items.map((item, j) => h('li', { key: j }, item))) : h('p', { key: i }, b.text)));
    const publicCard = () => h('section', { className: 'dh-owner-full-preview', 'aria-label': 'How your listing will look' },
      previewPhotos[0] ? h('img', { className: 'dh-owner-cover', src: previewPhotos[0], alt: 'Cover photo' }) : h('div', { className: 'dh-owner-photo-placeholder' }, 'Your cover photo appears here'),
      h('div', { className: 'dh-owner-preview-content' },
        h('p', { className: 'text-xs font-bold text-emerald-900' }, `${sale ? 'For sale' : shortStay ? 'Short stay' : 'For rent'} · ${CATEGORY_LABELS[selection.propertyCategory]}`),
        h('h3', { className: 'text-xl font-bold text-stone-900' }, preview.title || 'Your listing title'),
        h('p', { className: 'font-bold text-emerald-900' }, priceText()), h('p', null, locationText || 'Location'), keyFacts(),
        description(preview.description || 'Your description'),
        h('p', { className: 'dh-owner-hint' }, `Listed by ${preview.contact.displayName} · Verified by DwellHunt · Enquiries through DwellHunt`)));

    const terms = () => sale ? h(React.Fragment, null,
        grid(field('currency', 'Currency', { options: ['LKR', 'USD', 'GBP', 'AED'] }),
          h(PriceInput, { value: String(d.price), onChange: value => change('price', value), currency: d.currency, label: 'Asking price', error: errors.price, className: control })),
        check('negotiable', 'The price is negotiable'),
        field('saleAvailability', 'Availability', { options: ['Available now', 'Available on agreement', 'Under construction'] }))
      : h(React.Fragment, null,
        field('rentalType', 'Type of rental', { options: [['long-term', 'Long-term rental (months or years)'], ['short-stay', 'Short stay (nightly)']] }),
        shortStay ? grid(field('currency', 'Currency', { options: ['LKR', 'USD', 'GBP', 'AED'] }), field('price', `Nightly rate (${d.currency})`, { type: 'number', min: 1, step: 'any', inputMode: 'decimal' }),
            field('minimumDuration', 'Minimum nights', { type: 'number', min: 1, step: 1 }), field('checkInTime', 'Check-in from', { type: 'time' }))
          : h(React.Fragment, null, grid(field('currency', 'Currency', { options: ['LKR', 'USD', 'GBP', 'AED'] }),
            field('price', `Rent (${d.currency})`, { type: 'number', min: 1, step: 'any', inputMode: 'decimal' }),
            field('billingPeriod', 'Rent is paid', { options: [['month', 'Monthly'], ['year', 'Yearly']] }),
            field('minimumDuration', 'Minimum lease (months)', { type: 'number', min: 1, step: 1 }),
            field('advanceMonths', 'Advance (months of rent)', { type: 'number', min: 0, max: 24, step: 1, hint: 'Rent paid in advance before moving in. Enter 0 if none.' }),
            field('securityDeposit', `Refundable security deposit (${d.currency})`, { type: 'number', min: 0, step: 'any', optional: true }),
            field('noticePeriod', 'Notice period (months)', { type: 'number', min: 0, step: 1, optional: true }),
            field('availableFrom', 'Available from', { type: 'date' })),
            checks('tenantTypes', 'Suitable for (optional)', TENANT_TYPES),
            grid(field('petsAllowed', 'Pets', { optional: true, options: [['yes', 'Pets allowed'], ['no', 'No pets'], ['ask', 'Ask the owner']] }),
              field('separateMeters', 'Electricity & water meters', { optional: true, options: [['yes', 'Separate meters'], ['no', 'Shared meters'], ['partly', 'Separate for one of them']] })),
            rules.apartment && check('maintenanceIncluded', 'Maintenance charges are included in the rent')),
        checks('utilities', 'Included in the price (optional)', ['Water', 'Electricity', 'Internet', 'Gas', 'Cleaning']),
        field(shortStay ? 'availabilityNote' : 'charges', shortStay ? 'Availability notes' : 'Other charges', { type: 'textarea', optional: true,
          hint: shortStay ? 'For example blocked dates or seasonal rates. Guests confirm dates with DwellHunt.' : 'For example garbage collection or parking fees.' }));
    const sections = [
      () => h(React.Fragment, null, note('Only DwellHunt sees these details. Your phone number and email are never shown on the website.'), grid(
        field('ownerName', 'Your name', { autoComplete: 'name' }), field('email', 'Email', { type: 'email', autoComplete: 'email' }),
        h('div', { className: 'dh-owner-phone-fields' },
          h('div', { className: 'dh-owner-field' }, h(CountryCodePicker, { country: d.phoneCountry || 'LK', code: d.countryCode, error: errors.countryCode,
            onSelect: (country, code) => { onDraftChange(old => ({ ...old, phoneCountry: country, countryCode: code, phone: combineOwnerPhone(code, old.phoneNumber) })); setErrors(old => { const n = { ...old }; delete n.countryCode; return n; }); } }),
            d.phoneCountry === 'manual' && field('countryCode', 'Country code', { type: 'tel', placeholder: '+94' })),
          field('phoneNumber', 'Phone / WhatsApp', { type: 'tel', autoComplete: 'tel-national', inputMode: 'tel', hint: 'We call or WhatsApp you once to verify the listing.' })),
        field('preferredContact', 'Best way to reach you', { options: [['whatsapp', 'WhatsApp'], ['phone', 'Phone call'], ['email', 'Email']] }))),
      () => h(React.Fragment, null, note('Your street address stays private. You choose what the public sees in the Visibility step.'), grid(
        field('district', 'District', { options: DISTRICTS }), field('city', 'City / area', { placeholder: 'e.g. Colombo 05, Nugegoda, Kandy' }),
        !rules.landOnly && field('street', 'Street address', { autoComplete: 'street-address' }),
        rules.building && field('building', 'Building / project name'), rules.building && field('unit', 'Unit / apartment number', { optional: true }),
        rules.apartment && field('apartmentType', 'Apartment type', { optional: true, options: APARTMENT_TYPES }),
        rules.commercial && field('commercialType', 'Type of space', { optional: true, options: COMMERCIAL_TYPES }))),
      () => h(React.Fragment, null, grid(
        rules.rooms && field('bedrooms', 'Bedrooms', { type: 'number', min: 0, step: 1 }), rules.rooms && field('bathrooms', 'Bathrooms', { type: 'number', min: 0, step: 1 }),
        rules.roomOnly && field('bathroomType', 'Bathroom', { options: [['attached', 'Attached bathroom'], ['shared', 'Shared bathroom']] }),
        rules.floorArea && field('floorArea', 'Floor area', { type: 'number', min: 1, step: 'any' }), rules.floorArea && field('floorUnit', 'Unit', { options: [['sqft', 'Square feet'], ['sqm', 'Square metres']] }),
        rules.land && field('landArea', 'Land area', { type: 'number', min: 0.01, step: 'any' }), rules.land && field('landUnit', 'Unit', { options: [['perches', 'Perches'], ['acres', 'Acres'], ['sqft', 'Square feet'], ['sqm', 'Square metres']] }),
        rules.landOnly && field('landType', 'Land type', { options: LAND_TYPES }), rules.floors && field('floors', 'Number of floors', { type: 'number', min: 1, step: 1 }),
        !rules.landOnly && field('furnishing', 'Furnishing', { options: [['unfurnished', 'Unfurnished'], ['semi-furnished', 'Partly furnished'], ['fully-furnished', 'Fully furnished']] }),
        !rules.landOnly && field('condition', 'Condition', { options: ['New', 'Good condition', 'Needs renovation', 'Under construction'] }),
        !rules.landOnly && !rules.roomOnly && field('parking', 'Parking spaces', { type: 'number', min: 0, step: 1 }),
        !rules.landOnly && !rules.roomOnly && field('parkingType', 'Parking type', { optional: true, options: [['covered', 'Covered'], ['open', 'Open'], ['street', 'On the street'], ['none', 'No parking']] }),
        rules.annex && field('annexPosition', 'Where is the annex?', { options: ANNEX_POSITIONS }),
        rules.annex && field('separateEntrance', 'Entrance', { options: [['yes', 'Own separate entrance'], ['no', 'Shared entrance with the main house']] }),
        rules.annex && field('kitchenType', 'Kitchen', { options: KITCHEN_TYPES }),
        rules.annex && !sale && field('ownerOnPremises', 'Does the owner live on the same property?', { optional: true, options: [['yes', 'Yes, in the main house'], ['no', 'No']] }),
        rules.annex && sale && field('saleScope', 'What does the sale include?', { options: SALE_SCOPES }),
        rules.annex && sale && field('landArea', d.saleScope === 'annex-only' ? 'Land share with the annex' : 'Total land area', { type: 'number', min: 0.01, step: 'any' }),
        rules.annex && sale && field('landUnit', 'Unit', { options: [['perches', 'Perches'], ['acres', 'Acres'], ['sqft', 'Square feet'], ['sqm', 'Square metres']] }),
        rules.apartment && field('floorNumber', 'Floor number', { type: 'number', min: -10, step: 1, hint: '0 = ground floor.' }),
        rules.apartment && field('maintenance', `Maintenance charge (${d.currency} per month)`, { type: 'number', min: 0, step: 'any', optional: true })),
        rules.apartment && h(React.Fragment, null, check('balcony', 'Balcony'), checks('sharedFacilities', 'Building facilities (optional)', SHARED)),
        rules.outdoor && h(React.Fragment, null, check('garden', 'Garden'), check('pool', 'Private pool')),
        !rules.landOnly && checks('features', 'Features (optional)', FEATURES)),
      () => h(React.Fragment, null, terms(),
        unusualFigures(d).length > 0 && h('div', { className: 'dh-owner-note space-y-2' }, h('strong', null, 'Please double-check:'),
          h('ul', { className: 'list-disc pl-5' }, unusualFigures(d).map(w => h('li', { key: w }, w))),
          check('unusualConfirmed', 'These figures are correct'))),
      () => h(React.Fragment, null,
        field('title', 'Listing title', { maxLength: 96, action: button('✨ Suggest titles', () => setTitleSuggestions({ facts: titleFactsKey(d), titles: suggestOwnerTitles(d) })) }),
        titleSuggestions && h('section', { className: 'dh-owner-title-suggestions', 'aria-label': 'Title suggestions' },
          titleSuggestions.facts !== titleFactsKey(d) && note('Your details changed. Press “Suggest titles” again for up-to-date suggestions.'),
          titleSuggestions.titles.map((title, i) => h('div', { key: i, className: 'dh-owner-title-option' }, h('span', null, title),
            button('Use this title', () => { change('title', title); setTitleSuggestions(null); })))),
        h('section', { className: 'space-y-4', 'aria-labelledby': 'dh-owner-photos-label' },
          h('h3', { id: 'dh-owner-photos-label', className: 'block text-xs font-bold text-stone-700' }, 'Photos'),
          note('Take photos in daylight and show every main room. Please remove family photos and personal items before you shoot. Your photos are only uploaded when you send the listing.'),
          button('Add photos', () => photoPicker.current?.click(), primary),
          h('input', { ref: photoPicker, hidden: true, type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, onChange: pickFiles }),
          h('p', { className: 'dh-owner-hint' }, `${d.photos.length} of 8 photos · JPG, PNG or WebP up to 5 MB each`),
          fileError && h('p', { className: 'dh-owner-error', role: 'alert' }, fileError), errors.photos && h('p', { className: 'dh-owner-error' }, errors.photos),
          h('ol', { className: 'dh-owner-photos' }, d.photos.map(tile)),
          h('div', { className: 'flex flex-wrap items-center gap-3' }, button('Add a floor plan (optional)', () => floorPlanPicker.current?.click(), secondary, { disabled: !!d.floorPlan }),
            h('input', { ref: floorPlanPicker, hidden: true, type: 'file', accept: 'image/jpeg,image/png,image/webp', onChange: e => pickFiles(e, 'floorPlan') })),
          d.floorPlan && h('ul', { className: 'dh-owner-photos' }, tile(d.floorPlan, 0))),
        field('description', 'Description', { type: 'textarea', hint: 'Describe what a tenant or buyer should know. Avoid personal details — we remove them from the public listing.',
          action: button('✨ Draft from my details', () => setDescriptionDraft({ text: draftOwnerDescription(d), facts: descriptionFactsKey(d) })) }),
        descriptionDraft && h('section', { className: 'dh-owner-description-assistant' },
          h('p', { className: 'dh-owner-hint' }, 'Built from the details you entered. Edit it, then use it.'),
          h('textarea', { rows: 9, className: control, value: descriptionDraft.text, onChange: e => { const text = e.target.value; setDescriptionDraft(old => ({ ...old, text })); } }),
          h('div', { className: 'dh-owner-edit-links' }, button('Use this description', () => { change('description', descriptionDraft.text.trim()); setDescriptionDraft(null); }, primary, { disabled: !descriptionDraft.text.trim() }),
            button('Cancel', () => setDescriptionDraft(null))))),
      () => h(React.Fragment, null,
        note('Enquiries and viewing requests come to DwellHunt first. We check them, then pass genuine ones to you. Your phone number and email are never shown.'),
        field('locationPrecision', 'How much of the location to show', { options: [['district', 'District only'], ['area', 'City / area and district (recommended)'], ['exact', 'Exact street address']] }),
        rules.building && check('publicBuildingName', `Show the building name “${d.building || 'building'}” on the listing`, 'Your unit number is never shown.'),
        d.selection.listingRole !== 'agent' && check('videoViewing', 'I can show the home on a video call (optional)',
          'Buyers and tenants who live far away can ask for a video viewing. DwellHunt checks each request and sends it to you first. If you agree, you start a WhatsApp or Google Meet video call and walk them through the home. Leave this unticked if you only want in-person viewings.'),
        h('h3', { className: 'font-bold text-stone-900' }, 'How your listing will look'), publicCard()),
      () => send.phase === 'done' ? null : h(React.Fragment, null,
        validateOwnerDraft(d).map(section => h('div', { className: 'dh-owner-error-summary', key: section.step }, h('strong', null, `${OWNER_STEPS[section.step]} needs attention`),
          h('ul', null, Object.values(section.errors).map(error => h('li', { key: error }, error))), button('Fix this', () => go(section.step)))),
        publicCard(),
        h('div', { className: 'dh-owner-note space-y-1' }, h('strong', null, 'What happens next'),
          h('ol', { className: 'list-decimal pl-5 space-y-1' }, h('li', null, 'You get an email with your reference number.'),
            h('li', null, 'Within 1 working day DwellHunt calls or WhatsApps you to verify the listing. We’ll ask you to share one proof of ownership, such as a utility bill or a deed page, by WhatsApp.'),
            h('li', null, 'Once verified, your listing goes live for 1 month. We’ll remind you before it ends so you can renew it.'))),
        h('fieldset', { className: 'dh-listing-group space-y-4' }, h('legend', { className: 'font-bold text-stone-900 mb-2' }, 'Please confirm'),
          check('authorized', 'I own this property, or I have the owner’s permission to list it.'), check('accurate', 'The details are accurate to the best of my knowledge.'),
          check('photoPermission', 'The photos are of this property and I have the right to use them.'),
          check('consent', 'DwellHunt may use my details to verify this listing and contact me about enquiries, as described in the privacy policy.')),
        h('div', { className: 'dh-hp', 'aria-hidden': 'true' }, h('label', null, 'Leave empty', h('input', { ref: honeypot, type: 'text', tabIndex: -1, autoComplete: 'off', defaultValue: '' }))),
        h('div', { ref: captcha, className: 'dh-captcha', 'aria-label': 'Security check' }),
        send.message && h('p', { role: 'alert', className: send.phase === 'error' ? 'dh-owner-error-summary' : 'dh-owner-note' }, send.message)),
    ];
    const sendForReview = async () => {
      const problems = validateOwnerDraft({ ...latest.current }, true);
      if (problems.length) { setErrors(Object.assign({}, ...problems.filter(s => s.step === 6).map(s => s.errors))); setSend({ phase: 'error', message: 'Please complete the items marked above.', reference: '' }); return; }
      const config = window.DWELLHUNT_VIEWING || {};
      const sendUrl = agent ? config.agentListingUrl : config.ownerListingUrl;
      if (!sendUrl) { setSend({ phase: 'error', message: 'Listing submission is being set up. Please try again later or message us on WhatsApp.', reference: '' }); return; }
      if (!token) { setSend({ phase: 'error', message: 'Please complete the security check above.', reference: '' }); return; }
      try {
        setSend({ phase: 'uploading', message: 'Uploading your photos…', reference: '' });
        let current = latest.current;
        for (const item of [...current.photos, current.floorPlan].filter(Boolean)) {
          if (item.status === 'ready' && safeUploadUrl(item.url)) continue;
          const file = files.current.get(item.id);
          if (!file) throw Object.assign(new Error(`Please remove “${item.name}” and add it again.`), { code: 'PHOTO' });
          onDraftChange(old => ({ ...old, photos: old.photos.map(p => p.id === item.id ? { ...p, status: 'uploading' } : p), floorPlan: old.floorPlan?.id === item.id ? { ...old.floorPlan, status: 'uploading' } : old.floorPlan }));
          let url;
          try { url = (await uploadPropertyFile(file)).url; }
          catch (error) {
            onDraftChange(old => ({ ...old, photos: old.photos.map(p => p.id === item.id ? { ...p, status: 'failed', error: error.message } : p) }));
            throw Object.assign(new Error(`“${item.name}” could not be uploaded. Check your connection and press Send again.`), { code: 'PHOTO' });
          }
          const done = p => p.id === item.id ? { ...p, status: 'ready', url, error: '' } : p;
          current = { ...current, photos: current.photos.map(done), floorPlan: current.floorPlan && done(current.floorPlan) };
          onDraftChange(old => ({ ...old, photos: old.photos.map(done), floorPlan: old.floorPlan && done(old.floorPlan) }));
        }
        setSend({ phase: 'sending', message: 'Sending your listing to DwellHunt…', reference: '' });
        const result = await sendOwnerListing(sendUrl, agent ? { ...ownerSubmission(current), session: agent.session } : ownerSubmission(current), token, honeypot.current?.value || '');
        try { localStorage.removeItem(OWNER_DRAFT_KEY); } catch { /* nothing saved */ }
        setSaveEnabled(false); patch({ status: 'sent', deviceSavingEnabled: false });
        setSend({ phase: 'done', message: '', reference: result.reference });
      } catch (error) {
        setToken(''); try { if (widget.current !== null) window.turnstile?.reset(widget.current); } catch { /* ignore */ }
        setSend({ phase: 'error', message: error.message, reference: '' });
      }
    };
    const continueStep = event => {
      event.preventDefault();
      if (d.step === 6) { sendForReview(); return; }
      const found = validateOwnerStep(d, d.step); setErrors(found);
      if (Object.keys(found).length) { requestAnimationFrame(() => document.querySelector('.dh-owner [aria-invalid="true"], .dh-owner-error-summary')?.focus()); return; }
      go(Math.min(6, d.step + 1));
    };
    const restore = () => { files.current.clear(); onDraftChange({ ...resume.draft, deviceSavingEnabled: true }); setSaveEnabled(true); setResume(null); setNotice('Your saved listing is back. Please add any photos that weren’t uploaded yet.'); };
    const busy = ['uploading', 'sending'].includes(send.phase);

    if (send.phase === 'done') return h('div', { className: 'dh-owner py-12 bg-stone-50 min-h-screen' }, h('div', { className: 'max-w-2xl mx-auto px-4 sm:px-6 lg:px-8' },
      h('section', { className: 'bg-white rounded-3xl p-6 sm:p-10 border border-stone-200/90 shadow-sm space-y-5 text-center' },
        h('div', { className: 'text-4xl', 'aria-hidden': true }, '✅'),
        h('h1', { ref: heading, tabIndex: -1, className: 'text-2xl sm:text-3xl font-black text-stone-900' }, 'Your listing has been sent'),
        h('p', null, 'Your reference number is'), h('p', { className: 'text-2xl font-black text-emerald-900 tracking-wider' }, send.reference),
        h('div', { className: 'dh-owner-note text-left space-y-1' }, h('strong', null, 'What happens next'),
          h('ol', { className: 'list-decimal pl-5 space-y-1' }, h('li', null, `We’ve emailed the details to ${d.email}.`),
            agent ? h('li', null, 'DwellHunt will review it, usually within 1 working day, and may contact you to confirm you are authorised to advertise it.')
              : h('li', null, 'Within 1 working day DwellHunt will call or WhatsApp you to verify the listing and ask for one proof of ownership.'),
            h('li', null, agent ? 'Once approved, it goes live for 1 month, and buyer enquiries are emailed to you.' : 'Once verified, your listing goes live for 1 month, and we pass genuine enquiries to you.'))),
        button(agent ? 'Back to your dashboard' : 'Back to DwellHunt', onStart, primary))));

    return h('div', { className: 'dh-owner py-12 bg-stone-50 min-h-screen' }, h('div', { className: 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8' },
      h('div', { className: 'text-center max-w-xl mx-auto mb-8' },
        h('span', { className: 'inline-flex px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 text-xs font-bold mb-2' }, 'FREE OWNER LISTING'),
        h('h1', { className: 'text-3xl sm:text-4xl font-black text-stone-900 tracking-tight' }, 'List your property'),
        h('p', { className: 'text-stone-500 text-xs sm:text-sm mt-1' }, `${sale ? 'For sale' : 'For rent'} · ${CATEGORY_LABELS[selection.propertyCategory]}`)),
      resume && h('div', { className: 'dh-owner-note mb-6' }, h('p', null, `You have a listing saved on this browser from ${new Date(resume.savedAt).toLocaleString()}.`), button('Continue that listing', restore)),
      notice && h('p', { role: 'status', className: 'dh-owner-note mb-6' }, notice),
      h('nav', { 'aria-label': 'Progress', className: 'dh-owner-progress bg-white rounded-2xl p-4 border border-stone-200/90 shadow-2xs mb-6' },
        h('p', { className: 'w-full text-xs font-bold text-emerald-900' }, `Step ${d.step + 1} of ${OWNER_STEPS.length}`),
        OWNER_STEPS.map((name, step) => button(`${step + 1}. ${name}`, () => go(step), step === d.step ? 'dh-owner-step dh-owner-step-active' : 'dh-owner-step', { key: name, 'aria-current': step === d.step ? 'step' : undefined, disabled: busy }))),
      h('section', { className: 'bg-white rounded-3xl p-6 sm:p-10 border border-stone-200/90 shadow-sm' },
        h('h2', { ref: heading, tabIndex: -1, className: 'text-xl font-bold text-stone-900 mb-4' }, OWNER_STEPS[d.step]),
        h('form', { noValidate: true, onSubmit: continueStep, className: 'space-y-6' },
          d.step < 6 && Object.keys(errors).length > 0 && h('div', { role: 'alert', className: 'dh-owner-error-summary', tabIndex: -1 }, 'Please check the highlighted fields.'),
          sections[d.step](),
          h('div', { className: 'dh-owner-navigation pt-4 flex justify-between' },
            button(d.step === 0 ? 'Back' : 'Previous step', () => d.step === 0 ? onStart() : go(d.step - 1), secondary, { disabled: busy }),
            h('button', { type: 'submit', className: primary, disabled: busy }, d.step === 6 ? (busy ? send.message : 'Send for review') : d.step === 5 ? 'Review & send' : 'Continue')))),
      h('div', { className: 'mt-6 text-center' }, h('label', { className: 'dh-owner-checkbox inline-flex' },
        h('input', { type: 'checkbox', checked: saveEnabled, onChange: e => { setSaveEnabled(e.target.checked); patch({ deviceSavingEnabled: e.target.checked }); if (!e.target.checked) { try { localStorage.removeItem(OWNER_DRAFT_KEY); } catch { /* ignore */ } setSaveState(''); } } }),
        'Save my progress on this browser'),
        h('p', { className: 'dh-owner-hint', role: 'status' }, saveState || 'Anyone using this browser could open it. Photos need to be added again if you come back later.'))));
  };
}

// Kept for callers that create drafts directly.
export { createOwnerDraft };
