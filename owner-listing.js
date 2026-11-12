import { OWNER_STEPS, OWNER_BLOCKERS, CATEGORY_LABELS, APARTMENT_TYPES, createOwnerDraft, validateOwnerStep, validateOwnerDraft, publicOwnerListing, saveOwnerDraft, loadOwnerDraft, OWNER_DRAFT_KEY, combineOwnerPhone, validatePhotoCount, PHOTO_REMOVAL_MESSAGE } from './owner-listing-model.js';
import { uploadPropertyFile, validatePropertyFile } from './property-upload.js';
import { createCountryCodePicker } from './country-code-picker.js';
import { createPriceInput } from './price-input.js';
import { suggestOwnerTitles, titleFactsKey } from './title-suggestions.js';
import { draftOwnerDescription, descriptionFactsKey, descriptionBlocks, listingKeyFacts, DESCRIPTION_AI_AVAILABLE, DESCRIPTION_AI_REASON } from './description-draft.js';

export function createOwnerListing(React) {
  const h = React.createElement;
  const CountryCodePicker = createCountryCodePicker(React);
  const PriceInput = createPriceInput(React);
  const primary = 'px-6 py-3 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs disabled:opacity-40';
  const secondary = 'px-5 py-2.5 rounded-xl border border-stone-200 text-xs font-bold text-stone-700 hover:bg-stone-50';
  const control = 'w-full px-4 py-3 rounded-xl bg-stone-50 border border-stone-200 text-xs sm:text-sm text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-700';
  const featureOptions = ['24-hour security', 'Backup power', 'Solar power', 'Air conditioning', 'Lift access', 'Wheelchair access', 'Internet connection'];
  const sharedOptions = ['Shared pool', 'Gym', 'Residents’ lounge', 'Children’s play area', 'Visitor parking'];
  const districts = ['Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha', 'Hambantota', 'Jaffna', 'Kalutara', 'Kandy', 'Kegalle', 'Kilinochchi', 'Kurunegala', 'Mannar', 'Matale', 'Matara', 'Monaragala', 'Mullaitivu', 'Nuwara Eliya', 'Polonnaruwa', 'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya'];
  const button = (label, onClick, className = secondary, rest = {}) => h('button', { type: 'button', className, onClick, ...rest }, label);
  return function OwnerListing({ draft, onDraftChange, selection, onStart, onSelectionRestore }) {
    const d = draft;
    const [errors, setErrors] = React.useState({});
    const [saveEnabled, setSaveEnabled] = React.useState(!!draft.deviceSavingEnabled);
    const [saveState, setSaveState] = React.useState(draft.deviceSavingEnabled ? 'Saving on this device…' : 'This form is not saved on this device');
    const [resume, setResume] = React.useState(null);
    const [notice, setNotice] = React.useState('');
    const [management, setManagement] = React.useState(false);
    const [fileError, setFileError] = React.useState('');
    const [photoMessage, setPhotoMessage] = React.useState('');
    const [descriptionDraft, setDescriptionDraft] = React.useState(null);
    const [descriptionApproved, setDescriptionApproved] = React.useState(false);
    const [descriptionMessage, setDescriptionMessage] = React.useState('');
    const [titleSuggestions, setTitleSuggestions] = React.useState(null);
    const [titleMessage, setTitleMessage] = React.useState('');
    const files = React.useRef(new Map());
    const jobs = React.useRef(new Map());
    const heading = React.useRef(null);
    const latest = React.useRef(d); latest.current = d;
    const savePermission = React.useRef(!!draft.deviceSavingEnabled);
    const photoPicker = React.useRef(null), floorPlanPicker = React.useRef(null);
    const photoSlots = React.useRef(new Set(d.photos.map(photo => photo.id)));
    React.useEffect(() => { photoSlots.current = new Set(d.photos.map(photo => photo.id)); }, [d.photos]);
    const patch = changes => onDraftChange(value => ({ ...value, ...changes }));
    const change = (key, value) => {
      onDraftChange(old => {
        const next = { ...old, [key]: value };
        if (key === 'countryCode' || key === 'phoneNumber') next.phone = combineOwnerPhone(next.countryCode, next.phoneNumber);
        if (key === 'publicCountryCode' || key === 'publicPhoneNumber') next.publicPhone = combineOwnerPhone(next.publicCountryCode, next.publicPhoneNumber);
        return next;
      });
      setErrors(old => { const next = { ...old }; delete next[key]; if (key === 'publicBuildingName') { delete next.title; delete next.description; } return next; });
    };
    const go = step => { patch({ step }); setErrors({}); setNotice(''); setManagement(false); };
    React.useEffect(() => {
      if (d.selection.listingPurpose !== selection.listingPurpose || d.selection.propertyCategory !== selection.propertyCategory) patch({ selection: { ...selection } });
    }, [selection.listingPurpose, selection.propertyCategory]);
    React.useEffect(() => {
      try { const saved = loadOwnerDraft(localStorage); if (saved?.draft.id !== d.id) setResume(saved); } catch { setNotice('A saved draft could not be read. Your current form is still available.'); }
      return () => {
        const active = [...jobs.current.values()];
        active.forEach(controller => controller.abort()); jobs.current.clear();
        onDraftChange(old => ({ ...old, photos: old.photos.map(p => p.status === 'uploading' ? { ...p, status: 'failed', error: 'Upload interrupted. Choose the file again to retry.' } : p),
          floorPlan: old.floorPlan?.status === 'uploading' ? { ...old.floorPlan, status: 'failed', error: 'Upload interrupted. Choose the file again to retry.' } : old.floorPlan }));
      };
    }, []);
    React.useEffect(() => { heading.current?.focus(); }, [d.step, management]);
    React.useEffect(() => {
      if (!saveEnabled) return;
      setSaveState('Saving on this device…');
      const timer = setTimeout(() => {
        try { const saved = saveOwnerDraft(localStorage, d); setSaveState(`Saved on this device at ${new Date(saved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`); }
        catch { setSaveState('Not saved — browser storage is unavailable or full. Keep this page open and retry.'); }
      }, 400);
      return () => clearTimeout(timer);
    }, [d, saveEnabled]);
    // Persist an opted-in draft on navigation/unmount, not just after the debounce.
    React.useEffect(() => {
      if (!saveEnabled) return;
      const flush = () => { if (savePermission.current) try { saveOwnerDraft(localStorage, latest.current); } catch { /* no false saved indicator */ } };
      window.addEventListener('pagehide', flush);
      return () => { window.removeEventListener('pagehide', flush); flush(); };
    }, [saveEnabled]);
    const field = (key, label, { type = 'text', optional = false, options, hint, action, ...extra } = {}) => {
      const id = `dh-owner-${key}`, error = errors[key];
      const inputProps = { id, name: key, value: d[key], required: !optional, className: control,
        'aria-invalid': !!error, 'aria-describedby': [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined,
        onChange: event => change(key, event.target.value), ...extra };
      return h('div', { key, className: 'dh-owner-field' },
        action ? h('div', { className: 'dh-owner-title-heading' },
          h('label', { htmlFor: id, className: 'block text-xs font-bold text-stone-700' }, `${label} ${optional ? '(optional)' : '(required)'}`), action) :
          h('label', { htmlFor: id, className: 'block text-xs font-bold text-stone-700 mb-2' }, `${label} ${optional ? '(optional)' : '(required)'}`),
        options ? h('select', inputProps, h('option', { value: '' }, 'Choose…'), options.map(option => {
          const [value, text] = Array.isArray(option) ? option : [option, option]; return h('option', { key: value, value }, text);
        })) : type === 'textarea' ? h('textarea', { ...inputProps, rows: 5 }) : h('input', { ...inputProps, type }),
        hint && h('p', { id: `${id}-hint`, className: 'dh-owner-hint' }, hint),
        error && h('p', { id: `${id}-error`, className: 'dh-owner-error' }, error));
    };
    const check = (key, label, hint) => h('div', { key, className: 'dh-owner-field' },
      h('label', { className: 'dh-owner-checkbox' }, h('input', { type: 'checkbox', name: key, checked: d[key], onChange: e => change(key, e.target.checked) }), h('span', null, label)),
      hint && h('p', { className: 'dh-owner-hint' }, hint), errors[key] && h('p', { className: 'dh-owner-error' }, errors[key]));
    const checks = (key, label, options, hint) => h('fieldset', { key, className: 'dh-owner-field dh-listing-group' },
      h('legend', { className: 'block text-xs font-bold text-stone-700 mb-2' }, label),
      h('div', { className: 'dh-owner-checks' }, options.map(option => {
        const [value, text] = Array.isArray(option) ? option : [option, option];
        return h('label', { key: value, className: 'dh-owner-checkbox' }, h('input', { type: 'checkbox', checked: d[key].includes(value), onChange: e => change(key, e.target.checked ? [...d[key], value] : d[key].filter(item => item !== value)) }), text);
      })), hint && h('p', { className: 'dh-owner-hint' }, hint), errors[key] && h('p', { className: 'dh-owner-error' }, errors[key]));
    const grid = (...children) => h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-4' }, ...children);
    const note = text => h('p', { className: 'dh-owner-note' }, text);
    const apartment = selection.propertyCategory === 'apartment', sale = selection.listingPurpose === 'buy';
    const currentTitleFacts = titleFactsKey({ ...d, selection });
    const suggestionsStale = titleSuggestions && titleSuggestions.facts !== currentTitleFacts;
    const projectPermission = () => check('publicBuildingName', 'Allow my building/project name to appear publicly (optional)', 'This permission applies to the project name only. It does not publish your street address or unit number.');
    const titleField = () => h(React.Fragment, null,
      field('title', 'Listing title', { action: button('✨ Suggest titles', () => {
        const titles = suggestOwnerTitles({ ...d, selection });
        setTitleSuggestions({ facts: currentTitleFacts, titles });
        setTitleMessage(`${titles.length === 1 ? 'A title suggestion is' : 'Three title suggestions are'} ready. Edit it and choose “Use this title”, or keep writing your own.`);
      }) }),
      apartment && d.building && projectPermission(),
      titleMessage && h('p', { role: 'status', className: 'dh-owner-hint' }, titleMessage),
      titleSuggestions && h('section', { className: 'dh-owner-title-suggestions', 'aria-label': 'Editable title suggestions' },
        h('p', { className: 'dh-owner-hint' }, 'Built on this device from your entered facts and public location setting. No AI service is used. Review each title before choosing it.'),
        h('p', { className: 'dh-owner-hint' }, apartment ? 'Format: Project name – Bedroom count-Bedroom Apartment type. Studios omit the bedroom count. Only entered facts are used; the title remains editable.' : 'Creative names are suggested marketing titles, not official property names. You can edit or remove them.'),
        apartment && d.building && !d.publicBuildingName && h('p', { className: 'dh-owner-hint' }, 'Your project name is currently private and is excluded. Enable the separate project-name permission above, then suggest the title again to include it.'),
        suggestionsStale && h('p', { role: 'status', className: 'dh-owner-note' }, 'Property facts or location visibility have changed. Choose “Suggest titles” again before using a suggestion.'),
        titleSuggestions.titles.map((title, index) => h('div', { key: index, className: 'dh-owner-title-option' },
          h('label', { htmlFor: `dh-owner-title-suggestion-${index}`, className: 'block text-xs font-bold text-stone-700' }, `Suggestion ${index + 1}`),
          h('input', { id: `dh-owner-title-suggestion-${index}`, type: 'text', className: control, value: title,
            onChange: event => setTitleSuggestions(old => ({ ...old, titles: old.titles.map((value, item) => item === index ? event.target.value : value) })) }),
          button('Use this title', () => { change('title', title.trim()); setTitleMessage('Title applied. You can still edit it in the listing-title field.'); }, secondary,
            { disabled: !!suggestionsStale || !title.trim(), 'aria-label': `Use title suggestion ${index + 1}` })))));
    const keyFacts = () => h('ul', { className: 'dh-owner-key-facts', 'aria-label': 'Property key facts' }, listingKeyFacts(d).map((fact, index) =>
      h('li', { key: fact.label }, index > 0 && h('span', { 'aria-hidden': true }, '·'), h('span', { 'aria-hidden': true }, fact.icon), h('span', null, fact.label))));
    const descriptionContent = value => h('div', { className: 'dh-owner-description' }, descriptionBlocks(value).map((block, index) => block.type === 'list' ?
      h('ul', { key: index, className: 'dh-owner-description-features' }, block.items.map((item, itemIndex) => h('li', { key: itemIndex }, item))) : h('p', { key: index }, block.text)));
    const currentDescriptionFacts = descriptionFactsKey({ ...d, selection });
    const descriptionStale = descriptionDraft && (descriptionDraft.facts !== currentDescriptionFacts || descriptionDraft.original !== d.description);
    const descriptionField = () => h(React.Fragment, null,
      field('description', 'Property description', { type: 'textarea', hint: 'Describe only facts you know. Check your description for information you intend to keep private.',
        action: button('✨ Draft description', () => {
          setDescriptionDraft({ text: draftOwnerDescription({ ...d, selection }), original: d.description, facts: currentDescriptionFacts });
          setDescriptionApproved(false); setDescriptionMessage('A fact-based draft is ready to preview. Your current description is unchanged.');
        }) }),
      descriptionMessage && h('p', { role: 'status', className: 'dh-owner-hint' }, descriptionMessage),
      descriptionDraft && h('section', { className: 'dh-owner-description-assistant', 'aria-label': 'Description draft assistant' },
        h('h3', { className: 'font-bold text-stone-900' }, 'Draft from entered facts'),
        h('p', { id: 'dh-description-ai-status', className: 'dh-owner-hint' }, DESCRIPTION_AI_REASON),
        button('AI drafting unavailable', undefined, secondary, { disabled: !DESCRIPTION_AI_AVAILABLE, 'aria-describedby': 'dh-description-ai-status' }),
        h('label', { htmlFor: 'dh-owner-description-proposal', className: 'block text-xs font-bold text-stone-700' }, 'Edit the proposed description'),
        h('textarea', { id: 'dh-owner-description-proposal', rows: 9, className: control, value: descriptionDraft.text,
          onChange: event => { const value = event.target.value; setDescriptionDraft(old => ({ ...old, text: value })); setDescriptionApproved(false); } }),
        h('section', { className: 'dh-owner-description-preview', 'aria-label': 'Draft description preview' }, keyFacts(), descriptionContent(descriptionDraft.text)),
        descriptionStale && note('Your property facts, privacy choices or current description changed. Choose “Draft description” again before approving a replacement.'),
        h('label', { className: 'dh-owner-checkbox' }, h('input', { type: 'checkbox', checked: descriptionApproved, disabled: !!descriptionStale,
          onChange: event => setDescriptionApproved(event.target.checked) }), d.description ? 'I have reviewed this draft and approve replacing my current description.' : 'I have reviewed and approve this description.'),
        h('div', { className: 'dh-owner-edit-links' },
          button(d.description ? 'Replace description with this draft' : 'Use this description', () => {
            if (!descriptionApproved || descriptionStale || !descriptionDraft.text.trim()) return;
            change('description', descriptionDraft.text.trim()); setDescriptionDraft(null); setDescriptionApproved(false); setDescriptionMessage('Approved description applied. You can continue editing it above.');
          }, primary, { disabled: !descriptionApproved || !!descriptionStale || !descriptionDraft.text.trim() }),
          button('Keep my current description', () => { setDescriptionDraft(null); setDescriptionApproved(false); setDescriptionMessage('Your current description is unchanged.'); }))));
    const updateUpload = (id, values) => onDraftChange(old => ({ ...old,
      photos: old.photos.map(p => p.id === id ? { ...p, ...values } : p),
      floorPlan: old.floorPlan?.id === id ? { ...old.floorPlan, ...values } : old.floorPlan,
    }));
    const startUpload = async (item, file) => {
      if (jobs.current.has(item.id)) return;
      const controller = new AbortController(); jobs.current.set(item.id, controller);
      updateUpload(item.id, { status: 'uploading', progress: 0, error: '' });
      try {
        const result = await uploadPropertyFile(file, { signal: controller.signal, onProgress: progress => updateUpload(item.id, { progress }) });
        updateUpload(item.id, { status: 'ready', progress: 100, url: result.url, publicId: result.publicId, error: '' }); files.current.delete(item.id);
      } catch (error) { updateUpload(item.id, { status: 'failed', error: error.message, progress: 0 }); }
      finally { jobs.current.delete(item.id); }
    };
    const pickFiles = (event, kind = 'photo', retryItem = null) => {
      const picked = [...event.target.files]; event.target.value = '';
      const limitError = kind === 'photo' && !retryItem ? validatePhotoCount(Math.max(latest.current.photos.length, photoSlots.current.size), picked.length) : '';
      if (limitError) { setFileError(limitError); return; }
      if (!retryItem && kind === 'floorPlan' && d.floorPlan) { setFileError('Remove the existing floor plan before choosing another.'); return; }
      setFileError(''); setPhotoMessage('');
      const items = [];
      for (const file of picked) {
        const error = validatePropertyFile(file);
        if (error) { setFileError(`${file.name}: ${error}`); continue; }
        const item = retryItem || { id: crypto.randomUUID(), name: file.name, kind, status: 'uploading', progress: 0, url: '', error: '' };
        items.push({ item, file }); files.current.set(item.id, file);
        if (kind === 'photo') photoSlots.current.add(item.id);
      }
      onDraftChange(old => ({ ...old,
        photos: kind === 'photo' && !retryItem ? [...old.photos, ...items.map(x => x.item)] : old.photos,
        floorPlan: kind === 'floorPlan' && items.length ? items[0].item : old.floorPlan,
      }));
      for (const { item, file } of items) startUpload(item, file);
    };
    const removeUpload = item => {
      jobs.current.get(item.id)?.abort(); files.current.delete(item.id);
      photoSlots.current.delete(item.id);
      onDraftChange(old => ({ ...old, photos: old.photos.filter(p => p.id !== item.id), floorPlan: old.floorPlan?.id === item.id ? null : old.floorPlan }));
      setPhotoMessage(item.url ? PHOTO_REMOVAL_MESSAGE : item.status === 'uploading' ? 'Removed from this draft. An interrupted upload may still be stored by the photo service.' : 'Removed from this draft.');
    };
    const reorder = (id, move) => onDraftChange(old => {
      const photos = [...old.photos], index = photos.findIndex(p => p.id === id);
      const target = move === 'cover' ? 0 : index + move;
      if (index < 0 || target < 0 || target >= photos.length) return old;
      photos.splice(target, 0, photos.splice(index, 1)[0]); return { ...old, photos };
    });
    const uploadTile = (item, index) => h('li', { key: item.id, className: 'dh-owner-photo' },
      item.status === 'ready' ? h('img', { src: item.url, alt: item.kind === 'photo' ? `Property photo ${index + 1}` : 'Owner’s uploaded floor plan' }) : h('div', { className: 'dh-owner-photo-placeholder' }, item.status === 'uploading' ? 'Uploading your image…' : 'Upload needs attention'),
      h('strong', null, item.name), item.kind === 'photo' && h('span', { className: 'dh-owner-hint' }, index === 0 ? 'Cover photo' : `Photo ${index + 1}`),
      item.status === 'uploading' && h('div', { role: 'status' }, h('progress', { value: item.progress, max: 100, 'aria-label': `Upload progress for ${item.name}` }), ` ${item.progress}% transferred${item.progress === 100 ? ' · awaiting confirmation' : ''}`),
      item.status === 'failed' && h(React.Fragment, null, h('p', { className: 'dh-owner-error', role: 'alert' }, item.error),
        files.current.has(item.id) ? button(`Retry ${item.name}`, () => startUpload(item, files.current.get(item.id)), secondary) :
          h('label', { className: 'dh-owner-checkbox' }, 'Choose the same file again to retry uploading', h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', onChange: e => pickFiles(e, item.kind, item) }))),
      h('div', { className: 'dh-owner-photo-actions' }, item.kind === 'photo' && h(React.Fragment, null,
        button('Move earlier', () => reorder(item.id, -1), secondary, { disabled: index === 0, 'aria-label': `Move ${item.name} earlier` }),
        button('Move later', () => reorder(item.id, 1), secondary, { disabled: index === d.photos.length - 1, 'aria-label': `Move ${item.name} later` }),
        button(index === 0 ? 'Cover selected' : 'Use as cover', () => reorder(item.id, 'cover'), secondary, { disabled: index === 0, 'aria-label': `Use ${item.name} as cover` })),
        button(item.kind === 'photo' ? 'Remove photo' : 'Remove floor plan', () => removeUpload(item), secondary, { 'aria-label': `Remove ${item.name}` })));
    const publicData = publicOwnerListing({ ...d, selection });
    const priceText = p => `${p.currency} ${p.price ? p.price.toLocaleString() : '—'}${p.purpose === 'rent' ? ` / ${p.billingPeriod || 'billing period not set'}` : ''}`;
    const locationText = p => [p.location.address, p.location.building, p.location.city, p.location.district].filter(Boolean).join(', ');
    const publicPreview = compact => h('section', { className: compact ? 'dh-owner-public-card' : 'dh-owner-full-preview', 'aria-label': compact ? 'Customer-facing listing card preview' : 'Customer-facing full listing preview' },
      publicData.photos[0] ? h('img', { className: 'dh-owner-cover', src: publicData.photos[0].url, alt: publicData.title || 'Your uploaded cover photo' }) : h('div', { className: 'dh-owner-photo-placeholder' }, 'Your uploaded cover photo will appear here'),
      h('div', { className: 'dh-owner-preview-content' }, h('p', { className: 'text-xs font-bold text-emerald-900' }, `${sale ? 'For sale' : 'For rent'} · ${CATEGORY_LABELS[selection.propertyCategory]}`),
        h('h3', { className: 'text-xl font-bold text-stone-900' }, publicData.title || 'Your listing title'),
        h('p', { className: 'font-bold text-emerald-900' }, priceText(publicData)), h('p', null, locationText(publicData) || 'Your public location'),
        keyFacts(),
        compact ? h('p', null, `Listed by ${publicData.contact.displayName || 'your public display name'}`) : h(React.Fragment, null,
          descriptionContent(publicData.description || 'Your property description'),
          h('dl', { className: 'dh-owner-specs' },
            ...Object.entries({ 'Furnishing': publicData.furnishing, 'Condition': publicData.condition, 'Parking spaces': d.parking,
              ...(apartment ? { 'Apartment type': APARTMENT_TYPES.find(([id]) => id === d.apartmentType)?.[1], 'Floor number': d.floorNumber, 'Balcony': publicData.balcony ? 'Yes' : 'No', 'Shared facilities': publicData.sharedFacilities.join(', '),
                'Maintenance': publicData.maintenance === null ? 'Not specified' : `${d.currency} ${publicData.maintenance} / ${d.maintenancePeriod}` } : {
                'Land area': `${d.landArea || '—'} ${d.landUnit}`, 'Number of floors': d.floors, 'Garden': publicData.garden ? 'Yes' : 'No', 'Pool': publicData.pool ? 'Yes' : 'No' }),
              'Features': publicData.features.join(', '),
              ...(sale ? { 'Negotiable': publicData.negotiable ? 'Yes' : 'No', 'Availability': publicData.availability } : {
                'Rental type': publicData.rentalType, 'Minimum duration': `${d.minimumDuration || '—'} ${d.durationUnit}`, 'Deposit / advance': `${d.currency} ${d.deposit || '—'}`,
                'Included utilities': d.utilities.join(', '), 'Additional charges': d.charges, 'Available from': d.availableFrom, 'Availability note': d.availabilityNote }),
            }).map(([key, value]) => h('div', { key }, h('dt', null, key), h('dd', null, String(value ?? '') || 'Not specified')))),
          h('div', { className: 'dh-owner-preview-gallery' }, publicData.photos.slice(1).map((photo, index) => h('img', { key: photo.url + index, src: photo.url, alt: `Property photo ${index + 2}` }))),
          publicData.floorPlan && h('div', null, h('h4', { className: 'font-bold' }, 'Floor plan'), h('img', { className: 'dh-owner-floor-plan', src: publicData.floorPlan, alt: 'Property floor plan' })),
          h('h4', { className: 'font-bold' }, 'Public contact'), h('p', null, publicData.contact.displayName || 'Choose a public display name'),
          ...['email', 'phone', 'whatsapp'].filter(key => publicData.contact[key]).map(key => h('p', { key }, `${key === 'whatsapp' ? 'WhatsApp' : key}: ${publicData.contact[key]}`)),
          note('Preview only. This listing is not public. Owner enquiry delivery will be available after a secure owner listing service is connected.'))));
    const sections = [
      () => h(React.Fragment, null, note('These details are private. Public display details are chosen separately later.'), grid(
        field('ownerName', 'Owner’s name', { autoComplete: 'name' }), field('email', 'Email', { type: 'email', autoComplete: 'email' }),
        h('div', { className: 'dh-owner-phone-fields' },
          h('div', { className: 'dh-owner-field' },
            h(CountryCodePicker, { country: d.phoneCountry || (d.countryCode === '+94' ? 'LK' : 'manual'), code: d.countryCode, error: errors.countryCode,
              onSelect: (country, code) => {
                onDraftChange(old => ({ ...old, phoneCountry: country, countryCode: code, phone: combineOwnerPhone(code, old.phoneNumber) }));
                setErrors(old => { const next = { ...old }; delete next.countryCode; return next; });
              } }),
            d.phoneCountry === 'manual' && field('countryCode', 'Manual country code', { type: 'tel', autoComplete: 'tel-country-code', placeholder: '+94' })),
          field('phoneNumber', 'Phone number', { type: 'tel', autoComplete: 'tel-national', inputMode: 'tel', hint: 'Enter without the country code. A leading 0 is accepted for Sri Lankan numbers.' })),
        field('preferredContact', 'Preferred contact method', { options: [['email', 'Email'], ['phone', 'Phone call'], ['whatsapp', 'WhatsApp']] }))),
      () => h(React.Fragment, null, note('Street address stays private unless you choose exact public location later. Project-name display has its own separate permission.'), grid(
        field('district', 'District', { options: districts }), field('city', 'City / area'), field('street', 'Street address', { autoComplete: 'street-address' }),
        apartment && field('building', 'Building / project name'), apartment && field('apartmentType', 'Apartment type', { optional: true, options: APARTMENT_TYPES,
          hint: ({ studio: 'Example: an open-plan living and sleeping space.', standard: 'Example: a single-level apartment with separate rooms.', duplex: 'Example: an apartment arranged over two levels.', penthouse: 'Example: a top-floor apartment.' })[d.apartmentType] || 'For example: Studio, Standard apartment, Duplex or Penthouse.' })), apartment && projectPermission()),
      () => h(React.Fragment, null, grid(
        field('bedrooms', 'Bedrooms', { type: 'number', min: 0, step: 1 }), field('bathrooms', 'Bathrooms', { type: 'number', min: 0, step: 1 }),
        field('floorArea', 'Floor area', { type: 'number', min: 0.01, step: 'any' }), field('floorUnit', 'Floor area unit', { options: [['sqft', 'Square feet (sqft)'], ['sqm', 'Square metres (sqm)']] }),
        field('furnishing', 'Furnishing', { options: [['unfurnished', 'Unfurnished'], ['semi-furnished', 'Partly furnished'], ['fully-furnished', 'Fully furnished']] }),
        field('condition', 'Property condition', { options: ['New', 'Good condition', 'Needs renovation', 'Under construction'] }),
        field('parking', 'Parking spaces', { type: 'number', min: 0, step: 1 }),
        apartment ? field('floorNumber', 'Floor number', { type: 'number', min: -10, step: 1, hint: 'Use 0 for ground floor; negative values for basement floors.' }) : field('landArea', 'Land area', { type: 'number', min: 0.01, step: 'any' }),
        apartment ? field('maintenance', `Maintenance charges (${d.currency})`, { type: 'number', optional: true, min: 0, step: 'any' }) : field('landUnit', 'Land area unit', { options: [['perches', 'Perches'], ['sqft', 'Square feet'], ['sqm', 'Square metres'], ['acres', 'Acres']] }),
        apartment ? field('maintenancePeriod', 'Maintenance billing period', { options: [['month', 'Per month'], ['year', 'Per year']] }) : field('floors', 'Number of floors', { type: 'number', min: 1, step: 1 })),
        apartment ? h(React.Fragment, null, check('balcony', 'Balcony'), checks('sharedFacilities', 'Shared facilities (optional)', sharedOptions)) : h(React.Fragment, null, check('garden', 'Garden'), check('pool', 'Private swimming pool')),
        checks('features', 'Features and facilities (optional)', apartment ? featureOptions : [...featureOptions, 'Terrace', 'Outdoor dining area', 'Private driveway'])),
      () => h(React.Fragment, null, grid(field('currency', 'Currency', { options: ['LKR', 'USD', 'GBP', 'AED'] }),
        sale ? h(PriceInput, { value: String(d.price), onChange: value => change('price', value), currency: d.currency, label: 'Asking price', error: errors.price, className: control }) : field('price', 'Rental amount', { type: 'number', min: 0.01, step: 'any' })),
        sale ? h(React.Fragment, null, check('negotiable', 'Price is negotiable'), field('saleAvailability', 'Availability', { options: ['Available now', 'Available on agreement', 'Under construction — completion date to be agreed'] })) :
          h(React.Fragment, null, grid(field('rentalType', 'Rental type', { options: [['long-term', 'Long-term rental'], ['short-stay', 'Short stay']] }),
            field('billingPeriod', 'Billing period', { options: d.rentalType === 'short-stay' ? [['night', 'Per night'], ['week', 'Per week']] : [['month', 'Per month'], ['year', 'Per year']] }),
            field('minimumDuration', 'Minimum lease / stay duration', { type: 'number', min: 1, step: 1 }),
            field('durationUnit', 'Duration unit', { options: d.rentalType === 'short-stay' ? [['nights', 'Nights'], ['weeks', 'Weeks']] : [['months', 'Months'], ['years', 'Years']] }),
            field('deposit', `Deposit / advance (${d.currency})`, { type: 'number', min: 0, step: 'any', hint: 'Enter zero if no deposit or advance is required.' }),
            field('availableFrom', 'Available from', { type: 'date' })),
            checks('utilities', 'Included utilities (optional)', ['Water', 'Electricity', 'Internet', 'Gas', 'Cleaning']), field('charges', 'Additional charges', { type: 'textarea', optional: true }),
            d.rentalType === 'short-stay' && h(React.Fragment, null, note(OWNER_BLOCKERS.shortStay), field('availabilityNote', 'Short-stay availability details', { type: 'textarea', hint: 'Describe known date ranges and how the guest should confirm availability with you.' })))),
      () => h(React.Fragment, null, titleField(),
        h('section', { className: 'space-y-6', 'aria-labelledby': 'dh-owner-photos-label' },
          h('h3', { id: 'dh-owner-photos-label', className: 'block text-xs font-bold text-stone-700' }, 'Property photos (required)'),
          note('Use daylight, keep the camera level and cover the main rooms. Show the actual property truthfully; avoid stock photos or edits that hide defects.'),
          h('p', { id: 'dh-owner-upload-notice', className: 'dh-owner-hint' }, 'Selected images upload immediately to the photo service, even while this listing is a draft. Choose photos you have permission to share. JPG, PNG or WebP; 5 MB per image; up to 8 property photos. Check images for private details.'),
          button('Upload photos', () => photoPicker.current?.click(), primary, { 'aria-describedby': 'dh-owner-upload-notice' }),
          h('input', { ref: photoPicker, hidden: true, id: 'dh-owner-photos', type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, 'aria-label': 'Choose property photos', onChange: pickFiles }),
          h('p', { className: 'dh-owner-hint' }, `${d.photos.length} of 8 photo slots used`),
          fileError && h('p', { className: 'dh-owner-error', role: 'alert' }, fileError), errors.photos && h('p', { className: 'dh-owner-error' }, errors.photos),
          h('ol', { className: 'dh-owner-photos', 'aria-label': 'Property photos in display order' }, d.photos.map(uploadTile)),
          photoMessage && h('p', { role: 'status', className: 'dh-owner-note' }, photoMessage),
          h('p', { className: 'dh-owner-hint' }, 'Secure deletion from the photo service is not connected. Removing an uploaded image here removes it from this draft only.')),
        h('section', { className: 'space-y-6', 'aria-label': 'Optional floor plan' },
          h('h3', { className: 'block text-xs font-bold text-stone-700' }, 'Floor plan image (optional)'),
          h('p', { id: 'dh-owner-floorplan-notice', className: 'dh-owner-hint' }, 'Your selected floor plan image uploads immediately to the same photo service. JPG, PNG or WebP; up to 5 MB. The floor plan does not use a property-photo slot.'),
          button('Upload floor plan', () => floorPlanPicker.current?.click(), secondary, { disabled: !!d.floorPlan, 'aria-describedby': 'dh-owner-floorplan-notice' }),
          h('input', { ref: floorPlanPicker, hidden: true, id: 'dh-owner-floorplan', type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Choose floor plan image', onChange: e => pickFiles(e, 'floorPlan') }),
          d.floorPlan && h('ul', { className: 'dh-owner-photos' }, uploadTile(d.floorPlan, 0)), errors.floorPlan && h('p', { className: 'dh-owner-error' }, errors.floorPlan)),
        descriptionField()),
      () => h(React.Fragment, null, note('Only the public fields previewed below would be shown to customers. Your private owner name, owner email, owner phone, unit number and enquiry destination are excluded.'),
        field('publicName', 'Public display name'), checks('publicMethods', 'Public contact methods (choose at least one)', [['email', 'Email'], ['phone', 'Phone call'], ['whatsapp', 'WhatsApp']]),
        d.publicMethods.includes('email') && field('publicEmail', 'Public email', { type: 'email', hint: 'This email will be visible to customers.' }),
        (d.publicMethods.includes('phone') || d.publicMethods.includes('whatsapp')) && h('div', { className: 'dh-owner-phone-fields' },
          h('div', { className: 'dh-owner-field' },
            h(CountryCodePicker, { idPrefix: 'dh-public-phone', label: 'Public country code', searchLabel: 'Search public phone country or calling code',
              country: d.publicPhoneCountry, code: d.publicCountryCode, error: errors.publicCountryCode,
              onSelect: (country, code) => {
                onDraftChange(old => ({ ...old, publicPhoneCountry: country, publicCountryCode: code, publicPhone: combineOwnerPhone(code, old.publicPhoneNumber) }));
                setErrors(old => { const next = { ...old }; delete next.publicCountryCode; return next; });
              } }),
            d.publicPhoneCountry === 'manual' && field('publicCountryCode', 'Manual public country code', { type: 'tel', autoComplete: 'off', placeholder: '+94' })),
          field('publicPhoneNumber', 'Public phone / WhatsApp number', { type: 'tel', autoComplete: 'off', inputMode: 'tel', hint: 'This number will be public. Enter without the country code; a leading 0 is accepted for Sri Lankan numbers.' })),
        field('enquiryDestination', 'Private enquiry delivery email', { type: 'email', hint: 'Saved for future routing only. Enquiry delivery for owner listings is not connected.' }),
        apartment && projectPermission(),
        field('locationPrecision', 'Public location precision', { options: [['district', 'District only'], ['area', 'City / area and district'], ['exact', 'Exact street address']], hint: 'Controls address precision only. Project-name permission is separate. Unit number is always excluded.' }),
        d.locationPrecision === 'exact' && note('You chose to show the street address publicly. This does not publish the unit number or grant project-name permission.'),
        check('marketingConsent', 'Send me property news and offers (optional)', 'Optional and separate from listing enquiries. No marketing service is connected; nothing is sent.'),
        h('h3', { className: 'font-bold text-stone-900' }, 'What customers would see'), publicPreview(false)),
      () => h(React.Fragment, null, note('Review your draft. Nothing in this preview has been submitted or made public.'),
        h('div', { className: 'dh-owner-edit-links' }, OWNER_STEPS.slice(0, 6).map((name, step) => button(`Edit ${name.toLowerCase()}`, () => go(step), secondary, { key: step }))),
        ...validateOwnerDraft(d).map(section => h('div', { className: 'dh-owner-error-summary', key: section.step }, h('strong', null, `${OWNER_STEPS[section.step]} needs attention`),
          h('ul', null, Object.values(section.errors).map(error => h('li', { key: error }, error))), button('Edit this section', () => go(section.step)))),
        publicPreview(true), h('h3', { className: 'font-bold text-stone-900' }, 'Full listing preview'), publicPreview(false),
        h('fieldset', { className: 'dh-listing-group space-y-6' }, h('legend', { className: 'font-bold text-stone-900 mb-2' }, 'Confirmations required before future submission'),
          check('authorized', 'I am authorized to advertise this property.'), check('accurate', 'The information is accurate to my knowledge.'), check('photoPermission', 'I have permission to use the uploaded photos.')),
        h('div', { className: 'dh-owner-note', id: 'dh-owner-submission-blocker' }, OWNER_BLOCKERS.submission),
        button('Review submission unavailable', undefined, primary, { disabled: true, 'aria-describedby': 'dh-owner-submission-blocker' }),
        note('There is no submission reference number yet. Keep or resume the draft on this device while the owner review service is being connected.')),
    ];
    const continueStep = event => {
      event.preventDefault();
      const found = validateOwnerStep({ ...d, selection }, d.step); setErrors(found);
      if (Object.keys(found).length) { requestAnimationFrame(() => document.querySelector('.dh-owner [aria-invalid="true"], .dh-owner-error-summary')?.focus()); return; }
      go(Math.min(6, d.step + 1));
    };
    const restore = () => {
      if (!resume) return;
      [...jobs.current.values()].forEach(controller => controller.abort()); jobs.current.clear(); files.current.clear(); photoSlots.current = new Set(resume.draft.photos.map(photo => photo.id));
      onSelectionRestore(resume.draft.selection); onDraftChange({ ...resume.draft, deviceSavingEnabled: true }); savePermission.current = true; setSaveEnabled(true); setResume(null); setErrors({}); setNotice('Saved draft resumed. It is still a draft, not a submission.');
    };
    const managementPanel = () => h('div', { className: 'space-y-6' }, note('Your current listing is a draft on this device. No owner account or secure listing service is connected.'),
      h('p', { className: 'font-bold text-emerald-900' }, `Draft · ${d.title || 'Untitled property'} · ${sale ? 'For sale' : 'For rent'}`),
      button('Continue editing this draft', () => setManagement(false), primary),
      h('p', { id: 'dh-owner-management-blocker', className: 'dh-owner-note' }, OWNER_BLOCKERS.management),
      h('div', { className: 'dh-owner-edit-links' }, ['View submission status', 'Correct requested information', 'Edit a submitted listing', 'Update published availability', 'Pause published listing', 'Mark sold / rented', 'View owner enquiries'].map(label => button(label, undefined, secondary, { key: label, disabled: true, 'aria-describedby': 'dh-owner-management-blocker' }))));
    return h('div', { className: 'dh-owner py-12 bg-stone-50 min-h-screen' }, h('div', { className: 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8' },
      h('div', { className: 'text-center max-w-xl mx-auto mb-10' }, h('span', { className: 'inline-flex px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 text-xs font-bold mb-2' }, 'PROPERTY OWNER LISTING'),
        h('h1', { className: 'text-3xl sm:text-4xl font-black text-stone-900 tracking-tight' }, 'List your property'),
        h('p', { className: 'text-stone-500 text-xs sm:text-sm mt-1' }, `${sale ? 'For sale' : 'For rent'} · ${CATEGORY_LABELS[selection.propertyCategory]}`)),
      h('div', { className: 'dh-owner-draft-bar bg-white rounded-2xl p-4 border border-stone-200/90 shadow-2xs mb-8' },
        h('div', null, h('strong', { className: 'text-xs text-emerald-900' }, 'Draft only'), h('p', { role: 'status', 'aria-live': 'polite', className: 'dh-owner-hint' }, saveState)),
        button(management ? 'Return to form' : 'My draft & listing status', () => setManagement(!management)),
        button('Preview draft', () => go(6)),
        h('label', { className: 'dh-owner-checkbox' }, h('input', { type: 'checkbox', checked: saveEnabled, onChange: e => { savePermission.current = e.target.checked; setSaveEnabled(e.target.checked); patch({ deviceSavingEnabled: e.target.checked }); if (!e.target.checked) setSaveState('Automatic saving paused; any earlier saved copy remains on this device.'); } }), 'Save this draft on this device'),
        h('p', { className: 'dh-owner-hint' }, 'Device saving includes private contact and address details. Only enable it on a trusted personal browser. Anyone using this browser profile can open the saved draft. One draft is saved per browser; saving this form replaces the previous saved copy. This is not a secure owner account.'),
        saveEnabled && button('Save draft now', () => { try { const saved = saveOwnerDraft(localStorage, d); setSaveState(`Saved on this device at ${new Date(saved).toLocaleTimeString()}`); } catch { setSaveState('Not saved — browser storage is unavailable or full. Keep this page open and retry.'); } }),
        button('Remove saved copy from this device', () => { savePermission.current = false; setSaveEnabled(false); patch({ deviceSavingEnabled: false }); try { localStorage.removeItem(OWNER_DRAFT_KEY); if (localStorage.getItem(OWNER_DRAFT_KEY)) throw new Error(); setResume(null); setSaveState('Saved copy removed. Current form remains open and unsaved.'); } catch { setSaveState('Could not remove the saved copy. Use browser storage settings to remove it.'); } })),
      resume && h('div', { className: 'dh-owner-note mb-8' }, h('p', null, `A draft from ${new Date(resume.savedAt).toLocaleString()} is saved in this browser. Resuming replaces the currently open form and restores its purpose and category.`), button('Resume saved owner draft', restore)),
      notice && h('p', { role: 'status', className: 'dh-owner-note mb-8' }, notice),
      !management && h('nav', { 'aria-label': 'Owner listing progress', className: 'dh-owner-progress bg-white rounded-2xl p-4 border border-stone-200/90 shadow-2xs mb-8' }, OWNER_STEPS.map((name, step) =>
        button(`${step + 2}. ${name}`, () => go(step), step === d.step ? 'dh-owner-step dh-owner-step-active' : 'dh-owner-step', { key: name, 'aria-current': step === d.step ? 'step' : undefined }))),
      h('section', { className: 'bg-white rounded-3xl p-6 sm:p-10 border border-stone-200/90 shadow-sm' },
        h('h2', { ref: heading, tabIndex: -1, className: 'text-xl font-bold text-stone-900 mb-4' }, management ? 'My draft & listing status' : OWNER_STEPS[d.step]),
        management ? managementPanel() : h('form', { noValidate: true, onSubmit: continueStep, className: 'space-y-6' },
          Object.keys(errors).length > 0 && h('div', { role: 'alert', className: 'dh-owner-error-summary', tabIndex: -1 }, 'Please check the highlighted fields. Your entered information has been retained.'),
          sections[d.step](), h('div', { className: 'dh-owner-navigation pt-4 flex justify-between' },
            button(d.step === 0 ? 'Back to listing choices' : 'Back', () => d.step === 0 ? onStart() : go(d.step - 1)),
            d.step < 6 && Object.keys(errors).length > 0 && button('Continue as draft', () => go(d.step + 1), secondary),
            d.step < 6 && h('button', { type: 'submit', className: primary }, d.step === 5 ? 'Review your listing' : 'Continue'))))));
  };
}
