import { test } from 'node:test';
import assert from 'node:assert/strict';
const model = await import(new URL('../website/owner-listing-model.js', import.meta.url).href);
const upload = await import(new URL('../website/property-upload.js', import.meta.url).href);
const { createOwnerListing } = await import(new URL('../website/owner-listing.js', import.meta.url).href);

function valid(category = 'villa', purpose = 'buy', rentalType = 'long-term') {
  return { ...model.createOwnerDraft({ listingRole: 'owner', listingPurpose: purpose, propertyCategory: category }),
    ownerName: 'Private Owner Marker', email: 'private-owner@example.test', countryCode: '+94', phoneNumber: '770000000', phone: '+94770000000', preferredContact: 'email',
    district: 'Colombo', city: 'Review Area', street: 'Private Street Marker', building: 'Private Building Marker', unit: 'Private Unit Marker', latitude: '6.9', longitude: '79.8', privateLocation: { lat: 6.912345, lng: 79.876543, confirmed: true },
    title: 'Owner supplied property title', bedrooms: '3', bathrooms: '2', floorArea: '1500', parking: '0', furnishing: 'unfurnished', condition: 'Good condition',
    floorNumber: '0', landArea: '12', floors: '2', price: '100000', saleAvailability: 'Available now', rentalType,
    billingPeriod: rentalType === 'short-stay' ? 'night' : 'month', minimumDuration: '1', durationUnit: rentalType === 'short-stay' ? 'nights' : 'months',
    deposit: '0', availableFrom: '2026-12-01', availabilityNote: 'Contact owner for December dates; no calendar booking.',
    description: 'Only owner supplied facts.', photos: [{ id: 'photo1', name: 'Private File Name Marker.jpg', url: 'https://res.cloudinary.com/xx8yy8mw/image/upload/example.jpg', status: 'ready', kind: 'photo' }],
    publicName: 'Public Listing Name', publicMethods: ['email'], publicEmail: 'public-contact@example.test', enquiryDestination: 'private-delivery@example.test',
    authorized: true, accurate: true, photoPermission: true,
  };
}
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }

test('owner sale, long-term rent and short-stay drafts validate across all three categories without invented defaults', () => {
  for (const category of ['apartment', 'villa', 'house']) for (const [purpose, rentalType] of [['buy', 'long-term'], ['rent', 'long-term'], ['rent', 'short-stay']]) {
    const blank = model.createOwnerDraft({ listingRole: 'owner', listingPurpose: purpose, propertyCategory: category });
    for (const key of ['ownerName', 'title', 'price', 'bedrooms', 'bathrooms', 'floorArea', 'parking', 'description']) assert.equal(blank[key], '');
    assert.deepEqual(blank.photos, []); assert.deepEqual(blank.features, []); assert.equal(blank.marketingConsent, false);
    assert.ok(model.validateOwnerDraft(blank, true).length > 0);
    assert.deepEqual(model.validateOwnerDraft(valid(category, purpose, rentalType), true), []);
  }
});

test('conditional validation enforces apartment, rental type and upload consistency', () => {
  const d = valid('apartment', 'rent');
  d.building = ''; d.floorNumber = ''; d.landArea = '';
  assert.ok(model.validateOwnerStep(d, 1).building);
  assert.ok(model.validateOwnerStep(d, 2).floorNumber);
  assert.equal(model.validateOwnerStep(d, 2).landArea, undefined);
  d.billingPeriod = 'night'; d.durationUnit = 'nights';
  assert.ok(model.validateOwnerStep(d, 3).billingPeriod); assert.ok(model.validateOwnerStep(d, 3).durationUnit);
  d.photos[0].status = 'failed'; assert.ok(model.validateOwnerStep(d, 4).photos);
  d.photos[0].status = 'ready'; d.floorPlan = { status: 'uploading' }; assert.ok(model.validateOwnerStep(d, 4).floorPlan);
});

test('public preview excludes private contact, delivery, unit, filenames and imprecise-location coordinates', () => {
  const d = valid('apartment', 'rent');
  for (const precision of ['district', 'area']) {
    d.locationPrecision = precision; const output = model.publicOwnerListing(d); const json = JSON.stringify(output);
    for (const marker of ['Private Owner Marker', 'private-owner@', '+94770000000', 'Private Street Marker', 'Private Unit Marker', 'Private Building Marker', 'private-delivery@', 'Private File Name Marker']) assert.equal(json.includes(marker), false, marker);
    assert.equal(output.location.coordinates, undefined);
    assert.equal(output.location.city, precision === 'area' ? d.city : undefined);
    assert.equal(output.contact.email, d.publicEmail);
    assert.equal(output.contact.phone, undefined);
    assert.equal(output.landArea, undefined);
  }
  d.locationPrecision = 'exact'; const exact = model.publicOwnerListing(d);
  assert.equal(exact.location.address, d.street); assert.equal(exact.location.coordinates, undefined);
  assert.equal(JSON.stringify(exact).includes(d.unit), false);
  assert.equal(exact.verified, undefined); assert.equal(exact.agencyId, undefined); assert.equal(exact.aiValuation, undefined);
  d.publicMethods = []; assert.deepEqual(model.publicOwnerListing(d).contact, { displayName: d.publicName });
});

test('draft saving confirms storage, restores choices and progress, handles interrupted uploads and reports storage failures', () => {
  const mem = storage(), d = valid('house', 'rent', 'short-stay'); d.step = 4;
  d.photos.push({ id: 'interrupted', name: 'Retry.jpg', status: 'uploading', progress: 40, url: '' });
  assert.ok(model.saveOwnerDraft(mem, d));
  const loaded = model.loadOwnerDraft(mem).draft;
  assert.equal(loaded.step, 4); assert.equal(loaded.selection.propertyCategory, 'house'); assert.equal(loaded.selection.listingPurpose, 'rent');
  assert.equal(loaded.latitude, undefined); assert.equal(loaded.longitude, undefined);
  assert.equal(loaded.ownerName, d.ownerName); assert.equal(loaded.photos[1].status, 'failed');
  assert.match(loaded.photos[1].error, /again/);
  assert.equal(mem.getItem('dwellhunt_properties'), null);
  assert.throws(() => model.saveOwnerDraft({ setItem() { throw Error('Quota'); } }, d), /Quota/);
  assert.throws(() => model.saveOwnerDraft({ setItem() {}, getItem() { return null; } }, d), /verified/);
  mem.setItem(model.OWNER_DRAFT_KEY, '{broken'); assert.throws(() => model.loadOwnerDraft(mem));
});

test('uploaded URLs are restricted to HTTPS Cloudinary results', () => {
  for (const url of ['http://res.cloudinary.com/x', 'javascript:alert(1)', 'https://example.test/private.png', '']) assert.equal(model.safeUploadUrl(url), false);
  assert.equal(model.safeUploadUrl('https://res.cloudinary.com/example/image/upload/photo.jpg'), true);
});

test('owner phone has an editable suggested country code and separate number, preserving international drafts', () => {
  const blank = model.createOwnerDraft({ listingRole: 'owner', listingPurpose: 'buy', propertyCategory: 'villa' });
  assert.equal(blank.countryCode, '+94'); assert.equal(blank.phoneNumber, '');
  assert.equal(model.combineOwnerPhone('+94', '077 123 4567'), '+94771234567');
  assert.equal(model.combineOwnerPhone('+44', '7700 900123'), '+447700900123');
  const d = valid(); d.countryCode = '+44'; d.phoneNumber = '7700900123';
  assert.deepEqual(model.validateOwnerStep(d, 0), {});
  d.countryCode = '44'; assert.ok(model.validateOwnerStep(d, 0).countryCode);
  d.countryCode = '+94'; d.phoneNumber = '+94771234567'; assert.ok(model.validateOwnerStep(d, 0).phoneNumber);
  for (const [combined, code, number] of [['+94771234567', '+94', '771234567'], ['+447700900123', '+44', '7700900123']]) {
    const legacy = valid(); delete legacy.countryCode; delete legacy.phoneNumber; legacy.phone = combined;
    const mem = storage(); model.saveOwnerDraft(mem, legacy);
    const loaded = model.loadOwnerDraft(mem).draft;
    assert.equal(loaded.countryCode, code); assert.equal(loaded.phoneNumber, number); assert.equal(loaded.phone, combined);
  }
});

test('photo integration reports progress, rejects failures and supports a fresh retry without mutating form data', async () => {
  const file = new File(['image'], 'actual.jpg', { type: 'image/jpeg' });
  const d = valid(); const snapshot = JSON.stringify(d); const percentages: number[] = [];
  function fake(status: number, body: unknown) {
    const xhr: any = { upload: {}, status, responseText: JSON.stringify(body), open(method: string, url: string) { assert.equal(method, 'POST'); assert.equal(url, upload.CLOUDINARY_UPLOAD_URL); },
      send(form: FormData) { assert.equal(form.get('upload_preset'), upload.CLOUDINARY_UPLOAD_PRESET); this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 }); this.onload(); }, abort() { this.onabort(); } };
    return xhr;
  }
  await assert.rejects(upload.uploadPropertyFile(file, { xhrFactory: () => fake(500, { error: 'private-provider-error' }) }), /did not confirm/);
  const result = await upload.uploadPropertyFile(file, { xhrFactory: () => fake(200, { secure_url: 'https://res.cloudinary.com/xx8yy8mw/image/upload/actual.jpg' }), onProgress: (n: number) => percentages.push(n) });
  assert.match(result.url, /^https:/); assert.deepEqual(percentages, [50]); assert.equal(JSON.stringify(d), snapshot);
  await assert.rejects(upload.uploadPropertyFile(new File(['bad'], 'fake.pdf', { type: 'application/pdf' })), /JPG/);
  assert.match(upload.validatePropertyFile({ type: 'image/jpeg', size: 6 * 1024 * 1024 }), /5 MB/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(upload.uploadPropertyFile(file, { signal: controller.signal, xhrFactory: () => fake(200, {}) }), /cancelled/);
});

// Render the real owner component with deterministic hooks, without a remote backend.
function ownerHarness(initial = valid()) {
  let draft = initial, cursor = 0;
  const state: any[] = [];
  const React: any = {
    Fragment: 'fragment', createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (value: any) => { const index = cursor++; if (!(index in state)) state[index] = value; return [state[index], (next: any) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; },
    useRef: (value: any) => { const index = cursor++; return state[index] ||= { current: value }; }, useEffect() {},
  };
  const Owner = createOwnerListing(React, { ListingCard: 'shared-listing-card', ListingPage: 'shared-listing-page' });
  const nodes = () => {
    cursor = 0; const output: any[] = [];
    const walk = (value: any) => { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') { output.push(value); walk(value.props?.children); } };
    walk(Owner({ draft, selection: draft.selection, onDraftChange: (value: any) => { draft = typeof value === 'function' ? value(draft) : value; }, onStart() {}, onSelectionRestore() {} })); return output;
  };
  const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : String(value ?? '');
  const button = (name: string) => nodes().find(n => n.type === 'button' && text(n) === name);
  return { nodes, button, get draft() { return draft; } };
}
test('editing either phone field updates the compatible combined number without changing other owner details', () => {
  const d = valid(); const h = ownerHarness(d);
  h.nodes().find(n => n.props?.name === 'phoneNumber').props.onChange({ target: { value: '0771234567' } });
  assert.equal(h.draft.phone, '+94771234567');
  h.nodes().find(n => typeof n.type === 'function' && n.type.name === 'CountryCodePicker').props.onSelect('GB', '+44');
  h.nodes().find(n => n.props?.name === 'phoneNumber').props.onChange({ target: { value: '7700900123' } });
  assert.equal(h.draft.phone, '+447700900123'); assert.equal(h.draft.ownerName, d.ownerName);
  assert.equal(h.draft.phoneCountry, 'GB');
  h.nodes().find(n => typeof n.type === 'function' && n.type.name === 'CountryCodePicker').props.onSelect('manual', '+44');
  h.nodes().find(n => n.props?.name === 'countryCode').props.onChange({ target: { value: '+49' } });
  assert.equal(h.draft.phone, '+497700900123');
});
test('review submission and all account management actions are unavailable; no mock reference or publication is created', () => {
  const h = ownerHarness();
  h.button('8. Review your listing').props.onClick();
  const submit = h.button('Review submission unavailable'); assert.equal(submit.props.disabled, true); assert.equal(submit.props.onClick, undefined);
  assert.equal(h.draft.status, 'draft'); assert.equal(h.draft.reference, undefined);
  h.button('My draft & listing status').props.onClick();
  for (const name of ['View submission status', 'Correct requested information', 'Edit a submitted listing', 'Update published availability', 'Pause published listing', 'Mark sold / rented', 'View owner enquiries']) {
    assert.equal(h.button(name).props.disabled, true); assert.equal(h.button(name).props.onClick, undefined);
  }
});

test('owner UI shows only category and purpose specific inputs and retains entered fields through Back', () => {
  for (const category of ['apartment', 'villa', 'house']) for (const purpose of ['buy', 'rent']) {
    const d = valid(category, purpose); d.step = 2; const h = ownerHarness(d);
    const names = h.nodes().filter(n => ['input', 'select'].includes(n.type)).map(n => n.props.name);
    assert.equal(names.includes('floorNumber'), category === 'apartment'); assert.equal(names.includes('landArea'), category !== 'apartment');
    assert.equal(names.includes('title'), false);
    h.nodes().find(n => n.props?.name === 'bedrooms').props.onChange({ target: { value: '4' } });
    h.button('Back').props.onClick(); assert.equal(h.draft.bedrooms, '4');
    h.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(h.draft.step, 2); assert.equal(h.draft.bedrooms, '4');
  }
});

test('apartment type replaces the unit field and listing title belongs to photos and description', () => {
  const d = valid('apartment'); d.step = 1; const h = ownerHarness(d);
  assert.equal(h.nodes().some(n => n.props?.name === 'unit'), false);
  const type = h.nodes().find(n => n.props?.name === 'apartmentType'); assert.ok(type);
  type.props.onChange({ target: { value: 'duplex' } }); assert.equal(h.draft.apartmentType, 'duplex');
  assert.equal(model.publicOwnerListing(h.draft).apartmentType, 'duplex');
  h.button('8. Review your listing').props.onClick(); h.button('Edit photos & description').props.onClick();
  assert.ok(h.nodes().some(n => n.props?.name === 'title'));
  h.nodes().find(n => n.props?.name === 'title').props.onChange({ target: { value: 'Retained title in photos' } });
  h.button('Back').props.onClick(); assert.equal(h.draft.title, 'Retained title in photos');
  const empty = valid(); empty.title = '';
  assert.equal(model.validateOwnerStep(empty, 2).title, undefined); assert.ok(model.validateOwnerStep(empty, 4).title);
});

test('photo order, cover and removal controls change only draft photos and retain entered information', () => {
  const d = valid(); d.step = 4;
  d.photos.push({ ...d.photos[0], id: 'photo2', name: 'Second photo.jpg', url: 'https://res.cloudinary.com/xx8yy8mw/image/upload/second.jpg' });
  const h = ownerHarness(d);
  h.nodes().find(n => n.type === 'button' && n.props['aria-label'] === 'Use Second photo.jpg as cover').props.onClick();
  assert.equal(h.draft.photos[0].id, 'photo2'); assert.equal(h.draft.photos[1].id, 'photo1');
  h.nodes().find(n => n.type === 'button' && n.props['aria-label'] === 'Move Second photo.jpg later').props.onClick();
  assert.equal(h.draft.photos[0].id, 'photo1');
  h.nodes().find(n => n.type === 'button' && n.props['aria-label'] === 'Remove Second photo.jpg').props.onClick();
  assert.equal(h.draft.photos.length, 1); assert.equal(h.draft.title, d.title); assert.equal(h.draft.ownerName, d.ownerName);
});

test('title suggestions are editable and require an explicit choice; changed facts disable stale choices', () => {
  const d = valid('apartment'); d.step = 4; const h = ownerHarness(d);
  const original = d.title;
  h.button('✨ Suggest titles').props.onClick();
  assert.equal(h.draft.title, original);
  assert.equal(h.nodes().filter(n => n.type === 'input' && /^dh-owner-title-suggestion-/.test(n.props.id || '')).length, 1);
  h.nodes().find(n => n.props?.id === 'dh-owner-title-suggestion-0').props.onChange({ target: { value: 'Owner edited title' } });
  assert.equal(h.draft.title, original);
  h.nodes().find(n => n.props?.['aria-label'] === 'Use title suggestion 1').props.onClick();
  assert.equal(h.draft.title, 'Owner edited title');
  h.nodes().find(n => n.props?.name === 'title').props.onChange({ target: { value: 'My own title' } });
  h.button('✨ Suggest titles').props.onClick(); assert.equal(h.draft.title, 'My own title');
  h.button('Back').props.onClick(); h.button('8. Review your listing').props.onClick(); h.button('Edit property details').props.onClick();
  h.nodes().find(n => n.props?.name === 'bedrooms').props.onChange({ target: { value: '4' } });
  h.button('8. Review your listing').props.onClick(); h.button('Edit photos & description').props.onClick();
  assert.equal(h.nodes().find(n => n.props?.['aria-label'] === 'Use title suggestion 1').props.disabled, true);
  assert.equal(h.draft.title, 'My own title');
  h.button('✨ Suggest titles').props.onClick();
  assert.equal(h.nodes().find(n => n.props?.['aria-label'] === 'Use title suggestion 1').props.disabled, false);
});

test('photos are limited to eight including existing slots, with no separate upload-consent checkbox', () => {
  const d = valid(); d.step = 4;
  d.photos = Array.from({ length: 7 }, (_, index) => ({ ...d.photos[0], id: `photo-${index}` }));
  const h = ownerHarness(d);
  assert.ok(h.button('Upload photos')); assert.equal(h.button('Upload photos').props.disabled, undefined);
  const picker = h.nodes().find(n => n.props?.id === 'dh-owner-photos');
  assert.equal(picker.props.hidden, true);
  picker.props.onChange({ target: { files: [{ name: 'one.jpg' }, { name: 'two.jpg' }], value: 'selected' } });
  assert.equal(h.draft.photos.length, 7);
  assert.ok(h.nodes().some(n => n.props?.role === 'alert' && JSON.stringify(n.props.children).includes('You can upload up to 8 photos')));
  assert.equal(model.validatePhotoCount(7, 1), ''); assert.equal(model.validatePhotoCount(7, 2), 'You can upload up to 8 photos');
  d.photos = Array.from({ length: 9 }, (_, index) => ({ ...d.photos[0], id: String(index) }));
  assert.equal(model.validateOwnerStep(d, 4).photos, 'You can upload up to 8 photos');
});

test('removal explicitly reports the retained provider copy and leaves other draft fields intact', () => {
  const d = valid(); d.step = 4; const h = ownerHarness(d);
  h.nodes().find(n => n.type === 'button' && n.props['aria-label'] === `Remove ${d.photos[0].name}`).props.onClick();
  assert.equal(h.draft.photos.length, 0); assert.equal(h.draft.description, d.description);
  assert.ok(h.nodes().some(n => n.props?.role === 'status' && JSON.stringify(n.props.children).includes('Removed from this draft; the uploaded copy is still stored.')));
});

test('description drafts require editable preview and explicit approval before replacing text', () => {
  const d = valid(); d.step = 4; const h = ownerHarness(d); const before = d.description;
  h.button('✨ Draft description').props.onClick();
  assert.equal(h.draft.description, before);
  assert.equal(h.button('AI drafting unavailable').props.disabled, true);
  assert.equal(h.button('Replace description with this draft').props.disabled, true);
  h.nodes().find(n => n.props?.id === 'dh-owner-description-proposal').props.onChange({ target: { value: 'Edited introduction.\n\n• Owner-confirmed feature' } });
  h.nodes().find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props.disabled === false).props.onChange({ target: { checked: true } });
  assert.equal(h.button('Replace description with this draft').props.disabled, false);
  h.button('Replace description with this draft').props.onClick();
  assert.equal(h.draft.description, 'Edited introduction.\n\n• Owner-confirmed feature');
  h.button('✨ Draft description').props.onClick(); h.button('Keep my current description').props.onClick();
  assert.equal(h.draft.description, 'Edited introduction.\n\n• Owner-confirmed feature');
});

test('all draft stages are accessible without clearing validation or enabling submission', () => {
  const d = model.createOwnerDraft({ listingRole: 'owner', listingPurpose: 'buy', propertyCategory: 'villa' });
  const h = ownerHarness(d);
  assert.equal(h.button('7. Contact & visibility').props.disabled, undefined);
  h.button('7. Contact & visibility').props.onClick(); assert.equal(h.draft.step, 5);
  h.button('8. Review your listing').props.onClick(); assert.equal(h.draft.step, 6);
  assert.equal(h.button('Review submission unavailable').props.disabled, true);
  h.button('2. Your details').props.onClick();
  // Inline validation still runs, but the owner can continue a draft explicitly.
  const previousRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (() => 0) as any;
  try { h.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); } finally { globalThis.requestAnimationFrame = previousRAF; }
  h.button('Continue as draft').props.onClick(); assert.equal(h.draft.step, 1);
});

test('public phone picker defaults to Sri Lanka and normalizes its number independently of private owner contact', () => {
  const d = valid(); d.step = 5; d.publicMethods = ['whatsapp'];
  const h = ownerHarness(d); const originalPrivate = d.phone;
  let picker = h.nodes().find(n => typeof n.type === 'function' && n.type.name === 'CountryCodePicker');
  assert.equal(picker.props.idPrefix, 'dh-public-phone'); assert.equal(picker.props.country, 'LK'); assert.equal(picker.props.code, '+94');
  h.nodes().find(n => n.props?.name === 'publicPhoneNumber').props.onChange({ target: { value: '0771234567' } });
  assert.equal(h.draft.publicPhone, '+94771234567'); assert.equal(h.draft.phone, originalPrivate);
  assert.equal(model.validateOwnerStep(h.draft, 5).publicPhoneNumber, undefined);
  picker = h.nodes().find(n => typeof n.type === 'function' && n.type.name === 'CountryCodePicker'); picker.props.onSelect('GB', '+44');
  h.nodes().find(n => n.props?.name === 'publicPhoneNumber').props.onChange({ target: { value: '7700900123' } });
  assert.equal(model.publicOwnerListing(h.draft).contact.whatsapp, '+447700900123'); assert.equal(h.draft.phone, originalPrivate);
  picker = h.nodes().find(n => typeof n.type === 'function' && n.type.name === 'CountryCodePicker'); picker.props.onSelect('manual', '+44');
  assert.ok(h.nodes().find(n => n.props?.name === 'publicCountryCode'));
});

test('legacy public numbers resume with separate country fields without copying private owner details', () => {
  const mem = storage(), d = valid();
  for (const [combined, code, national] of [['0771234567', '+94', '0771234567'], ['+447700900123', '+44', '7700900123']]) {
    delete d.publicCountryCode; delete d.publicPhoneNumber; delete d.publicPhoneCountry; d.publicPhone = combined;
    model.saveOwnerDraft(mem, d); const loaded = model.loadOwnerDraft(mem).draft;
    assert.equal(loaded.publicCountryCode, code); assert.equal(loaded.publicPhoneNumber, national);
    assert.equal(loaded.publicPhone, model.combineOwnerPhone(code, national)); assert.equal(loaded.phone, d.phone);
  }
});

test('project permission is an independent optional checkbox and old private names are flagged in titles', () => {
  const d = valid('apartment'); d.step = 4; d.building = 'Altair'; d.title = 'Altair – Studio Apartment';
  const h = ownerHarness(d);
  assert.ok(model.validateOwnerStep(h.draft, 4).title);
  h.nodes().find(n => n.props?.name === 'publicBuildingName').props.onChange({ target: { checked: true } });
  assert.equal(h.draft.publicBuildingName, true); assert.equal(h.draft.locationPrecision, 'area');
  assert.equal(model.validateOwnerStep(h.draft, 4).title, undefined);
  assert.equal(model.publicOwnerListing(h.draft).location.address, undefined);
});

test('Preview draft uses the shared original detail component, retains form state and disables public draft actions', () => {
  const h = ownerHarness(); const title = h.draft.title;
  h.button('Preview draft').props.onClick();
  const page = h.nodes().find(n => n.type === 'shared-listing-page');
  assert.ok(page); assert.equal(page.props.preview, true); assert.equal(page.props.property.title, title);
  assert.equal(page.props.property.contact.displayName, h.draft.publicName);
  assert.equal(page.props.property.agencyId, undefined);
  page.props.onBack(); assert.ok(h.button('Preview draft')); assert.equal(h.draft.title, title);
});
