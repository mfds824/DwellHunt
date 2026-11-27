// Phase A owner listing model: a private owner lists ONE property; DwellHunt verifies it and stays in the middle.
// Owner drafts never enter the marketplace's public property store. Public data is built only by publicOwnerListing().
export const OWNER_DRAFT_KEY = 'dwellhunt_owner_draft_v2';
export const MAX_PROPERTY_PHOTOS = 8;
export const PHOTO_LIMIT_MESSAGE = 'You can add up to 8 photos.';
export const OWNER_STEPS = ['Your details', 'Location', 'Property details', 'Price & terms', 'Photos & description', 'Visibility', 'Review & send'];
export const CATEGORY_LABELS = { house: 'House', annex: 'Annex', room: 'Room / boarding', apartment: 'Apartment', villa: 'Villa', commercial: 'Commercial space', land: 'Land' };
// Which questions each category needs.
export const CATEGORY_RULES = {
  apartment: { rooms: true, floorArea: true, building: true, apartment: true },
  house: { rooms: true, floorArea: true, land: true, floors: true, outdoor: true },
  villa: { rooms: true, floorArea: true, land: true, floors: true, outdoor: true },
  annex: { rooms: true, floorArea: true, annex: true },
  room: { roomOnly: true, rentOnly: true },
  commercial: { floorArea: true, commercial: true },
  land: { landOnly: true, land: true },
};
export const APARTMENT_TYPES = [['studio', 'Studio'], ['standard', 'Standard apartment'], ['duplex', 'Duplex'], ['penthouse', 'Penthouse']];
export const COMMERCIAL_TYPES = [['office', 'Office'], ['shop', 'Shop / retail'], ['warehouse', 'Warehouse / storage'], ['other', 'Other commercial']];
export const LAND_TYPES = [['residential', 'Residential'], ['commercial', 'Commercial'], ['agricultural', 'Agricultural / estate']];
export const ANNEX_POSITIONS = [['upstairs', 'Upper floor of a house'], ['ground', 'Ground floor, attached to a house'], ['detached', 'Separate building on the same land']];
/** The main view from the property (optional; land listings have none). */
export const VIEWS = [['sea', 'Sea view'], ['lake', 'Lake view'], ['city', 'City view'], ['golf', 'Golf course view'], ['garden', 'Garden view'],
  ['pool', 'Pool view'], ['mountain', 'Mountain view'], ['paddy', 'Paddy field view']];
export const KITCHEN_TYPES = [['own', 'Own kitchen'], ['pantry', 'Pantry / kitchenette'], ['shared', 'Shared with the main house'], ['none', 'No kitchen']];
export const SALE_SCOPES = [['with-house', 'Sold together with the main house'], ['annex-only', 'Annex only, with its own deed or land share']];
export const TENANT_TYPES = [['family', 'Families'], ['professionals', 'Working professionals'], ['students', 'Students'], ['foreigners', 'Foreigners / expats']];
export const rulesFor = category => CATEGORY_RULES[category] || {};

export function createOwnerDraft(selection) {
  return {
    version: 2, id: crypto.randomUUID(), status: 'draft', step: 0, deviceSavingEnabled: false,
    selection: { listingRole: 'owner', listingPurpose: selection.listingPurpose, propertyCategory: selection.propertyCategory },
    ownerName: '', email: '', phoneCountry: 'LK', countryCode: '+94', phoneNumber: '', phone: '', preferredContact: '',
    district: '', city: '', street: '', building: '', unit: '', publicBuildingName: false,
    apartmentType: '', commercialType: '', landType: '',
    annexPosition: '', separateEntrance: '', kitchenType: '', ownerOnPremises: '', saleScope: '',
    title: '', bedrooms: '', bathrooms: '', bathroomType: '', floorArea: '', floorUnit: 'sqft', furnishing: '', condition: '',
    parking: '', parkingType: '', floorNumber: '', balcony: false, view: '', sharedFacilities: [], maintenance: '', maintenancePeriod: 'month',
    landArea: '', landUnit: 'perches', floors: '', garden: false, pool: false, features: [],
    currency: 'LKR', price: '', negotiable: false, saleAvailability: '',
    rentalType: 'long-term', billingPeriod: 'month', minimumDuration: '', advanceMonths: '', securityDeposit: '',
    tenantTypes: [], petsAllowed: '', separateMeters: '', maintenanceIncluded: false, noticePeriod: '',
    checkInTime: '', availableFrom: '', availabilityNote: '', utilities: [], charges: '', unusualConfirmed: false,
    photos: [], floorPlan: null, description: '',
    publicName: '', locationPrecision: 'area', videoViewing: false,
    authorized: false, accurate: false, photoPermission: false, consent: false,
  };
}
const has = value => String(value ?? '').trim().length > 0;
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
const validPhone = value => /^\+[1-9]\d{6,14}$/.test(String(value).replace(/[\s()-]/g, ''));
export function combineOwnerPhone(countryCode, phoneNumber) {
  const code = String(countryCode).trim();
  let digits = String(phoneNumber).replace(/[\s()-]/g, '');
  if (code === '+94') digits = digits.replace(/^0/, '');
  return code + digits;
}
const number = (value, min = 0) => has(value) && Number.isFinite(Number(value)) && Number(value) >= min;
const integer = (value, min = 0) => number(value, min) && Number.isInteger(Number(value));
export function validatePhotoCount(existing, incoming = 0) {
  return existing + incoming > MAX_PROPERTY_PHOTOS ? PHOTO_LIMIT_MESSAGE : '';
}
export function safeUploadUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'res.cloudinary.com'; } catch { return false; }
}
const sale = d => d.selection.listingPurpose === 'buy';
const shortStay = d => !sale(d) && d.rentalType === 'short-stay';

/** Figures that are possible but unusual. The owner must confirm them; they never block on their own. */
export function unusualFigures(d) {
  const warnings = [], price = Number(d.price), lkr = d.currency === 'LKR', rules = rulesFor(d.selection.propertyCategory);
  if (lkr && number(d.price, 0.01)) {
    if (sale(d)) {
      if (price < 1_000_000) warnings.push('The sale price is below LKR 1,000,000.');
      if (price > 2_000_000_000) warnings.push('The sale price is above LKR 2 billion.');
    } else if (shortStay(d)) {
      if (price < 2_000) warnings.push('The nightly rate is below LKR 2,000.');
      if (price > 300_000) warnings.push('The nightly rate is above LKR 300,000.');
    } else {
      const monthly = d.billingPeriod === 'year' ? price / 12 : d.billingPeriod === 'quarter' ? price / 3 : price;
      if (monthly < 10_000) warnings.push('The rent is below LKR 10,000 a month.');
      if (monthly > 3_000_000) warnings.push('The rent is above LKR 3,000,000 a month.');
    }
  }
  if (rules.floorArea && number(d.floorArea, 0.01)) {
    const sqft = d.floorUnit === 'sqm' ? Number(d.floorArea) * 10.764 : Number(d.floorArea);
    if (sqft < 150) warnings.push('The floor area is under 150 sqft.');
    if (sqft > 50_000) warnings.push('The floor area is over 50,000 sqft.');
  }
  if (!sale(d) && !shortStay(d) && integer(d.advanceMonths) && Number(d.advanceMonths) > 12) warnings.push('The advance is more than 12 months.');
  return warnings;
}

export function validateOwnerStep(d, step) {
  const errors = {}, rules = rulesFor(d.selection.propertyCategory);
  const required = (key, label) => { if (!has(d[key])) errors[key] = `${label} is required.`; };
  const positive = (key, label) => { if (!number(d[key], 0.01)) errors[key] = `Enter the ${label.toLowerCase()} as a number greater than zero.`; };
  const whole = (key, label, min = 0, max = Infinity) => {
    if (!integer(d[key], min) || Number(d[key]) > max) errors[key] = `Enter the ${label.toLowerCase()} as a whole number${max < Infinity ? ` from ${min} to ${max}` : min ? ` of at least ${min}` : ''}.`;
  };
  if (step === 0) {
    required('ownerName', 'Your name');
    if (!validEmail(d.email)) errors.email = 'Enter a valid email address.';
    if (!/^\+[1-9]\d{0,2}$/.test(d.countryCode)) errors.countryCode = 'Choose a country code, for example +94.';
    if (!/^\d[\d\s()-]*$/.test(d.phoneNumber) || !validPhone(combineOwnerPhone(d.countryCode, d.phoneNumber))) errors.phoneNumber = 'Enter your phone number without the country code.';
    required('preferredContact', 'How we should contact you');
  }
  if (step === 1) {
    required('district', 'District'); required('city', 'City / area');
    if (!rules.landOnly) required('street', 'Street address');
    if (rules.building) required('building', 'Apartment project name');
  }
  if (step === 2) {
    if (rules.rooms) { whole('bedrooms', 'Bedrooms', 0, 30); whole('bathrooms', 'Bathrooms', 0, 30); }
    if (rules.roomOnly) required('bathroomType', 'Bathroom');
    if (rules.floorArea) { positive('floorArea', 'Floor area'); required('floorUnit', 'Floor area unit'); }
    if (rules.land) { positive('landArea', 'Land area'); required('landUnit', 'Land area unit'); }
    if (rules.floors) whole('floors', 'Number of floors', 1, 100);
    if (rules.landOnly) required('landType', 'Land type');
    if (!rules.landOnly) { required('furnishing', 'Furnishing'); required('condition', 'Property condition'); }
    if (!rules.landOnly && !rules.roomOnly) whole('parking', 'Parking spaces', 0, 100);
    if (rules.annex) {
      const choose = (key, message) => { if (!has(d[key])) errors[key] = message; };
      choose('annexPosition', 'Choose where the annex is.'); choose('separateEntrance', 'Choose the type of entrance.'); choose('kitchenType', 'Choose the kitchen type.');
      if (sale(d)) { choose('saleScope', 'Choose what the sale includes.'); positive('landArea', 'Land area'); required('landUnit', 'Land area unit'); }
    }
    if (rules.apartment) {
      whole('floorNumber', 'Floor number', -10, 150);
      if (has(d.maintenance) && !number(d.maintenance)) errors.maintenance = 'Enter the maintenance charge as zero or more.';
    }
  }
  if (step === 3) {
    required('currency', 'Currency');
    positive('price', sale(d) ? 'Asking price' : shortStay(d) ? 'Nightly rate' : 'Rent');
    if (rules.rentOnly && sale(d)) errors.price = 'Rooms can only be listed for rent.';
    if (sale(d)) required('saleAvailability', 'Availability');
    else if (shortStay(d)) {
      whole('minimumDuration', 'Minimum nights', 1, 365);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.checkInTime))) errors.checkInTime = 'Choose a check-in time.';
    } else {
      required('billingPeriod', 'Rent is paid');
      whole('minimumDuration', 'Minimum lease in months', 1, 120);
      whole('advanceMonths', 'Advance (months)', 0, 24);
      if (has(d.securityDeposit) && !number(d.securityDeposit)) errors.securityDeposit = 'Enter the security deposit as zero or more.';
      if (has(d.noticePeriod) && !integer(d.noticePeriod, 0)) errors.noticePeriod = 'Enter the notice period in whole months.';
      const parsed = Date.parse(d.availableFrom);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.availableFrom) || !Number.isFinite(parsed)) errors.availableFrom = 'Choose the date it becomes available.';
    }
    if (!Object.keys(errors).length && unusualFigures(d).length && !d.unusualConfirmed) errors.unusualConfirmed = 'Please confirm these figures are correct.';
  }
  if (step === 4) {
    required('title', 'Listing title');
    if (rules.building && !d.publicBuildingName && String(d.building).trim().length > 2 &&
        String(d.title).toLocaleLowerCase().includes(String(d.building).trim().toLocaleLowerCase()))
      errors.title = 'Your title includes the apartment project name, which you’re keeping private. Remove it, or choose to show the project name in the Visibility step.';
    else if (titleProblem(d)) errors.title = titleProblem(d);
    const usable = d.photos.filter(p => p.status === 'selected' || (p.status === 'ready' && safeUploadUrl(p.url)));
    if (!usable.length) errors.photos = 'Add at least one photo of the actual property.';
    if (d.photos.some(p => p.status === 'failed')) errors.photos = 'Remove or re-add the photos marked “needs attention”.';
    if (validatePhotoCount(d.photos.length)) errors.photos = PHOTO_LIMIT_MESSAGE;
    required('description', 'Property description');
  }
  if (step === 5) {
    if (!['district', 'area', 'exact'].includes(d.locationPrecision)) errors.locationPrecision = 'Choose how much of the location to show.';
  }
  return errors;
}
export function validateOwnerDraft(d, confirmations = false) {
  const sections = OWNER_STEPS.slice(0, 6).map((_, step) => ({ step, errors: validateOwnerStep(d, step) })).filter(section => Object.keys(section.errors).length);
  if (confirmations) {
    const errors = {};
    for (const key of ['authorized', 'accurate', 'photoPermission', 'consent']) if (!d[key]) errors[key] = 'Please confirm this to send your listing.';
    if (Object.keys(errors).length) sections.push({ step: 6, errors });
  }
  return sections;
}

// Known private values can't leak through a title, description or note the owner typed.
export function publicText(value, d) {
  const key = v => String(v ?? '').trim().toLocaleLowerCase();
  // A place the listing already shows is not private, e.g. the city Kandy in Kandy district.
  const shown = [d.district, ...(d.locationPrecision === 'district' ? [] : [d.city])].map(key).filter(Boolean);
  const hidden = [d.ownerName, d.email, d.phone, d.phoneNumber, d.unit,
    ...(d.locationPrecision === 'exact' ? [] : [d.street]), ...(!d.publicBuildingName ? [d.building] : []),
    ...(d.locationPrecision === 'district' ? [d.city] : [])].map(v => String(v ?? '').trim()).filter(v => v.length >= 3 && !shown.includes(key(v)));
  // Names match as whole words, so an owner called Ann does not hide part of "Annex".
  const words = [d.ownerName, d.unit].map(key);
  let text = String(value ?? '');
  for (const item of hidden) {
    const pattern = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(words.includes(key(item)) ? new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'giu') : new RegExp(pattern, 'gi'), '[private detail omitted]');
  }
  return text;
}
export const hasContactDetails = value => /(?:\d[\s().-]?){9,}/.test(String(value ?? '')) || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(String(value ?? ''));
/** Why this title cannot be published with the owner's current privacy choices, or an empty string. */
export function titleProblem(d) {
  const title = String(d.title ?? ''), city = String(d.city ?? '').trim();
  if (hasContactDetails(title)) return 'Please remove the phone number or email from your title. Enquiries come through DwellHunt.';
  if (!title.includes('[private detail omitted]') && publicText(title, d) === title) return '';
  if (d.locationPrecision === 'district' && city && publicText(title, { ...d, locationPrecision: 'area' }) === title)
    return `Your title names “${city}”, but you chose to show the district only. Choose a new title, or show your city / area in the Visibility step.`;
  return 'Your title includes a private detail, such as your name, unit number or street. Choose a new title or remove it.';
}
const num = value => has(value) ? Number(value) : null;
// Whitelist public fields. Never spread the draft or owner record into a listing.
export function publicOwnerListing(d) {
  const rules = rulesFor(d.selection.propertyCategory), rent = !sale(d);
  const location = { district: d.district, ...(d.locationPrecision !== 'district' ? { city: d.city } : {}) };
  if (d.locationPrecision === 'exact' && !rules.landOnly) location.address = d.street;
  if (rules.building && d.publicBuildingName) location.building = d.building;
  return {
    title: publicText(d.title, d), purpose: d.selection.listingPurpose, category: d.selection.propertyCategory,
    location, price: num(d.price), currency: d.currency,
    ...(sale(d) ? { negotiable: d.negotiable, availability: d.saleAvailability } : shortStay(d) ? {
      rentalType: 'short-stay', billingPeriod: 'night', minimumNights: num(d.minimumDuration), checkInTime: d.checkInTime,
      availabilityNote: publicText(d.availabilityNote, d), includedUtilities: [...d.utilities],
    } : {
      rentalType: 'long-term', billingPeriod: d.billingPeriod, minimumLeaseMonths: num(d.minimumDuration), advanceMonths: num(d.advanceMonths),
      securityDeposit: num(d.securityDeposit), noticePeriodMonths: num(d.noticePeriod), availableFrom: d.availableFrom,
      tenantTypes: [...d.tenantTypes], petsAllowed: d.petsAllowed, separateMeters: d.separateMeters,
      includedUtilities: [...d.utilities], additionalCharges: publicText(d.charges, d),
    }),
    ...(rules.rooms ? { bedrooms: num(d.bedrooms), bathrooms: num(d.bathrooms) } : {}),
    ...(rules.roomOnly ? { bathroomType: d.bathroomType } : {}),
    ...(rules.floorArea ? { floorArea: num(d.floorArea), floorUnit: d.floorUnit } : {}),
    ...(rules.land ? { landArea: num(d.landArea), landUnit: d.landUnit } : {}),
    ...(rules.floors ? { floors: num(d.floors) } : {}),
    ...(rules.landOnly ? { landType: d.landType } : { furnishing: d.furnishing, condition: d.condition }),
    ...(!rules.landOnly && !rules.roomOnly ? { parking: num(d.parking), parkingType: d.parkingType } : {}),
    ...(rules.apartment ? { apartmentType: d.apartmentType, floorNumber: num(d.floorNumber), balcony: d.balcony,
      sharedFacilities: [...d.sharedFacilities], maintenance: num(d.maintenance), maintenancePeriod: d.maintenancePeriod,
      ...(rent ? { maintenanceIncluded: d.maintenanceIncluded } : {}) } : {}),
    ...(rules.outdoor ? { garden: d.garden, pool: d.pool } : {}),
    ...(!rules.landOnly && VIEWS.some(([id]) => id === d.view) ? { view: d.view } : {}),
    ...(rules.annex ? { annexPosition: d.annexPosition, separateEntrance: d.separateEntrance, kitchenType: d.kitchenType,
      ...(rent ? { ownerOnPremises: d.ownerOnPremises } : { saleScope: d.saleScope, landArea: num(d.landArea), landUnit: d.landUnit }) } : {}),
    ...(rules.commercial ? { commercialType: d.commercialType } : {}),
    features: d.features.map(value => publicText(value, d)),
    photos: d.photos.filter(p => p.status === 'ready' && safeUploadUrl(p.url)).map((p, index) => ({ url: p.url, alt: `Property photo ${index + 1}` })),
    floorPlan: d.floorPlan?.status === 'ready' && safeUploadUrl(d.floorPlan.url) ? d.floorPlan.url : null,
    description: publicText(d.description, d),
    // Every private owner's listing is viewed by video first (the owner hosts the call); agents arrange their own viewings.
    ...(d.selection.listingRole !== 'agent' ? { videoViewing: true } : {}),
    // Owner listings always show "Private owner"; the owner's name is never shown.
    contact: { via: 'DwellHunt', displayName: 'Private owner' },
  };
}
/** Everything DwellHunt needs to review the listing. Private details are kept apart from the public listing. */
export function ownerSubmission(d) {
  return {
    selection: { ...d.selection },
    owner: { name: d.ownerName.trim(), email: d.email.trim().toLowerCase(), phone: combineOwnerPhone(d.countryCode, d.phoneNumber), preferredContact: d.preferredContact },
    privateLocation: { district: d.district, city: d.city, street: d.street, building: d.building, unit: d.unit },
    publicListing: publicOwnerListing(d),
    confirmations: { authorized: d.authorized, accurate: d.accurate, photoPermission: d.photoPermission },
    consent: d.consent === true, draftId: d.id,
  };
}

export function saveOwnerDraft(storage, draft) {
  // Photos that were only chosen (not uploaded) can't be stored; they are re-chosen after resuming.
  const record = { version: 2, savedAt: new Date().toISOString(), draft: { ...draft, status: 'draft',
    photos: draft.photos.filter(p => p.status === 'ready' && safeUploadUrl(p.url)).map(({ previewUrl, ...p }) => p),
    floorPlan: draft.floorPlan?.status === 'ready' && safeUploadUrl(draft.floorPlan.url) ? (({ previewUrl, ...p }) => p)(draft.floorPlan) : null } };
  const serialized = JSON.stringify(record);
  storage.setItem(OWNER_DRAFT_KEY, serialized);
  if (storage.getItem(OWNER_DRAFT_KEY) !== serialized) throw new Error('Draft storage could not be verified.');
  return record.savedAt;
}
export function loadOwnerDraft(storage) {
  const raw = storage.getItem(OWNER_DRAFT_KEY);
  if (!raw) return null;
  const record = JSON.parse(raw), d = record?.draft;
  if (record?.version !== 2 || d?.version !== 2 || d?.status !== 'draft' || !d.id || !['buy', 'rent'].includes(d.selection?.listingPurpose) ||
      !Object.hasOwn(CATEGORY_LABELS, d.selection?.propertyCategory)) throw new Error('This saved draft is not supported.');
  const clean = createOwnerDraft(d.selection);
  // Only known fields of the expected type are loaded.
  for (const key of Object.keys(clean)) if (Object.hasOwn(d, key) && typeof d[key] === typeof clean[key] && !Array.isArray(clean[key])) clean[key] = d[key];
  for (const key of ['features', 'sharedFacilities', 'utilities', 'tenantTypes'])
    if (Array.isArray(d[key])) clean[key] = d[key].filter(value => typeof value === 'string');
  clean.photos = (Array.isArray(d.photos) ? d.photos : []).filter(p => p && p.status === 'ready' && safeUploadUrl(p.url))
    .slice(0, MAX_PROPERTY_PHOTOS).map(p => ({ id: String(p.id), name: String(p.name), kind: 'photo', status: 'ready', url: p.url, error: '' }));
  clean.floorPlan = d.floorPlan && d.floorPlan.status === 'ready' && safeUploadUrl(d.floorPlan.url)
    ? { id: String(d.floorPlan.id), name: String(d.floorPlan.name), kind: 'floorPlan', status: 'ready', url: d.floorPlan.url, error: '' } : null;
  clean.id = String(d.id); clean.step = Math.max(0, Math.min(6, Number.isInteger(d.step) ? d.step : 0));
  clean.selection = { listingRole: 'owner', listingPurpose: d.selection.listingPurpose, propertyCategory: d.selection.propertyCategory };
  clean.phone = combineOwnerPhone(clean.countryCode, clean.phoneNumber);
  return { ...record, draft: clean };
}
