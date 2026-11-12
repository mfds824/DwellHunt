import { COUNTRY_CODES } from './country-calling-codes.js';
// Owner drafts never enter the marketplace's public property store.
export const OWNER_DRAFT_KEY = 'dwellhunt_owner_draft_v1';
export const MAX_PROPERTY_PHOTOS = 8;
export const PHOTO_LIMIT_MESSAGE = 'You can upload up to 8 photos';
export const PHOTO_REMOVAL_MESSAGE = 'Removed from this draft; the uploaded copy is still stored.';
export function validatePhotoCount(existing, incoming = 0) {
  return existing + incoming > MAX_PROPERTY_PHOTOS ? PHOTO_LIMIT_MESSAGE : '';
}
export const OWNER_STEPS = ['Your details', 'Property location', 'Property details', 'Price & availability', 'Photos & description', 'Contact & visibility', 'Review your listing'];
export const OWNER_BLOCKERS = Object.freeze({
  submission: 'Submission is unavailable: owner sign-in, private listing storage and a review service are not connected. This draft has not been submitted or published.',
  management: 'Account-based listing status, corrections, availability updates, pausing, sold/rented status and owner enquiries require owner sign-in and an ownership-protected listing service. These are not connected.',
  shortStay: 'No booking calendar is connected. The date and availability note below are listing information only; they do not reserve dates or confirm a booking.',
});
export const CATEGORY_LABELS = { apartment: 'Apartments & condominiums', villa: 'Villas', house: 'Luxury houses' };
export const APARTMENT_TYPES = [['studio', 'Studio'], ['standard', 'Standard apartment'], ['duplex', 'Duplex'], ['penthouse', 'Penthouse']];
export function createOwnerDraft(selection) {
  return {
    version: 1, id: crypto.randomUUID(), status: 'draft', step: 0, deviceSavingEnabled: false, selection: { ...selection },
    ownerName: '', email: '', phoneCountry: 'LK', countryCode: '+94', phoneNumber: '', phone: '', preferredContact: '',
    district: '', city: '', street: '', building: '', publicBuildingName: false, unit: '', apartmentType: '',
    title: '', bedrooms: '', bathrooms: '', floorArea: '', floorUnit: 'sqft', furnishing: '', condition: '', parking: '',
    floorNumber: '', balcony: false, sharedFacilities: [], maintenance: '', maintenancePeriod: 'month',
    landArea: '', landUnit: 'perches', floors: '', garden: false, pool: false, features: [],
    currency: 'LKR', price: '', priceInput: '', negotiable: false, saleAvailability: '', rentalType: '', billingPeriod: '',
    minimumDuration: '', durationUnit: '', deposit: '', utilities: [], charges: '', availableFrom: '', availabilityNote: '',
    photos: [], floorPlan: null, description: '', publicName: '', publicMethods: [], publicEmail: '', publicPhone: '',
    publicPhoneCountry: 'LK', publicCountryCode: '+94', publicPhoneNumber: '',
    enquiryDestination: '', locationPrecision: 'area', marketingConsent: false,
    authorized: false, accurate: false, photoPermission: false,
  };
}
const has = value => String(value ?? '').trim().length > 0;
const email = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const phone = value => /^\+[1-9]\d{6,14}$/.test(String(value).replace(/[\s()-]/g, ''));
export function combineOwnerPhone(countryCode, phoneNumber) {
  const code = String(countryCode).trim();
  let digits = String(phoneNumber).replace(/[\s()-]/g, '');
  if (code === '+94') digits = digits.replace(/^0/, '');
  return code + digits;
}
const number = (value, min = 0) => has(value) && Number.isFinite(Number(value)) && Number(value) >= min;
const integer = (value, min = 0) => number(value, min) && Number.isInteger(Number(value));
export function validateOwnerStep(d, step) {
  const errors = {};
  const required = (key, label) => { if (!has(d[key])) errors[key] = `${label} is required.`; };
  const positive = (key, label) => { if (!number(d[key], 0.01)) errors[key] = `Enter a ${label.toLowerCase()} greater than zero.`; };
  const whole = (key, label, min = 0) => { if (!integer(d[key], min)) errors[key] = `Enter ${label.toLowerCase()} as a whole number${min ? ` of at least ${min}` : ' of zero or more'}.`; };
  if (step === 0) {
    required('ownerName', 'Owner’s name');
    if (!email(d.email)) errors.email = 'Enter a valid email address.';
    if (!/^\+[1-9]\d{0,2}$/.test(d.countryCode)) errors.countryCode = 'Enter a country code starting with +, for example +94.';
    if (!/^\d[\d\s()-]*$/.test(d.phoneNumber) || !phone(combineOwnerPhone(d.countryCode, d.phoneNumber))) errors.phoneNumber = 'Enter the phone number separately, without its country code.';
    required('preferredContact', 'Preferred contact method');
  }
  if (step === 1) {
    for (const [key, label] of [['district', 'District'], ['city', 'City / area'], ['street', 'Street address']]) required(key, label);
    if (d.selection.propertyCategory === 'apartment') required('building', 'Building / project name');
  }
  if (step === 2) {
    whole('bedrooms', 'Bedrooms'); whole('bathrooms', 'Bathrooms');
    positive('floorArea', 'Floor area'); required('floorUnit', 'Floor area unit'); whole('parking', 'Parking spaces');
    required('furnishing', 'Furnishing'); required('condition', 'Property condition');
    if (d.selection.propertyCategory === 'apartment') {
      whole('floorNumber', 'Floor number', -10);
      if (has(d.maintenance) && !number(d.maintenance)) errors.maintenance = 'Enter a maintenance charge of zero or more.';
      if (has(d.maintenance)) required('maintenancePeriod', 'Maintenance billing period');
    } else { positive('landArea', 'Land area'); required('landUnit', 'Land area unit'); whole('floors', 'Number of floors', 1); }
  }
  if (step === 3) {
    positive('price', d.selection.listingPurpose === 'buy' ? 'Asking price' : 'Rental amount'); required('currency', 'Currency');
    if (d.selection.listingPurpose === 'buy') required('saleAvailability', 'Availability');
    else {
      required('rentalType', 'Rental type'); required('billingPeriod', 'Billing period');
      whole('minimumDuration', 'Minimum lease / stay duration', 1); required('durationUnit', 'Duration unit');
      if (d.rentalType === 'long-term' && d.billingPeriod && !['month', 'year'].includes(d.billingPeriod)) errors.billingPeriod = 'Choose monthly or yearly billing for a long-term rental.';
      if (d.rentalType === 'short-stay' && d.billingPeriod && !['night', 'week'].includes(d.billingPeriod)) errors.billingPeriod = 'Choose nightly or weekly billing for a short stay.';
      if (d.rentalType === 'short-stay' && d.durationUnit && !['nights', 'weeks'].includes(d.durationUnit)) errors.durationUnit = 'Choose nights or weeks for a short stay.';
      if (d.rentalType === 'long-term' && d.durationUnit && !['months', 'years'].includes(d.durationUnit)) errors.durationUnit = 'Choose months or years for a long-term lease.';
      if (!number(d.deposit)) errors.deposit = 'Enter the deposit / advance, or zero if none.';
      const parsed = Date.parse(d.availableFrom);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.availableFrom) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== d.availableFrom) errors.availableFrom = 'Choose a valid available-from date.';
      if (d.rentalType === 'short-stay') required('availabilityNote', 'Short-stay availability details');
    }
  }
  if (step === 4) {
    required('title', 'Listing title');
    if (d.selection.propertyCategory === 'apartment' && !d.publicBuildingName && String(d.building).trim().length > 2) {
      const name = String(d.building).trim().toLocaleLowerCase();
      if (String(d.title).toLocaleLowerCase().includes(name)) errors.title = 'Your title contains the private project name. Remove it or allow the project name to appear publicly.';
      if (String(d.description).toLocaleLowerCase().includes(name)) errors.description = 'Your description contains the private project name. Remove it or allow the project name to appear publicly.';
    }
    if (!d.photos.some(p => p.status === 'ready' && p.url)) errors.photos = 'Upload at least one actual property photo.';
    if (d.photos.some(p => p.status !== 'ready')) errors.photos = 'Finish or remove failed / incomplete photo uploads before continuing.';
    if (validatePhotoCount(d.photos.length)) errors.photos = PHOTO_LIMIT_MESSAGE;
    if (d.floorPlan && d.floorPlan.status !== 'ready') errors.floorPlan = 'Finish or remove the incomplete floor plan.';
    required('description', 'Property description');
  }
  if (step === 5) {
    required('publicName', 'Public display name');
    if (!d.publicMethods.length) errors.publicMethods = 'Choose at least one public contact method.';
    if (d.publicMethods.includes('email') && !email(d.publicEmail)) errors.publicEmail = 'Enter the email you want to display publicly.';
    if (d.publicMethods.includes('phone') || d.publicMethods.includes('whatsapp')) {
      if (!/^\+[1-9]\d{0,2}$/.test(d.publicCountryCode)) errors.publicCountryCode = 'Choose or enter a public country code, for example +94.';
      if (!/^\d[\d\s()-]*$/.test(d.publicPhoneNumber) || !phone(combineOwnerPhone(d.publicCountryCode, d.publicPhoneNumber))) errors.publicPhoneNumber = 'Enter the public phone number without its country code.';
    }
    if (!email(d.enquiryDestination)) errors.enquiryDestination = 'Enter a valid private email for future enquiry delivery.';
    if (!['district', 'area', 'exact'].includes(d.locationPrecision)) errors.locationPrecision = 'Choose a public location precision.';
  }
  return errors;
}
export function validateOwnerDraft(d, confirmations = false) {
  const sections = OWNER_STEPS.slice(0, 6).map((_, step) => ({ step, errors: validateOwnerStep(d, step) })).filter(section => Object.keys(section.errors).length);
  if (confirmations) {
    const errors = {};
    for (const key of ['authorized', 'accurate', 'photoPermission']) if (!d[key]) errors[key] = 'Confirmation is required.';
    if (Object.keys(errors).length) sections.push({ step: 6, errors });
  }
  return sections;
}
// Whitelist public fields. Never spread the draft or owner record into a listing.
export function publicOwnerListing(d) {
  const apartment = d.selection.propertyCategory === 'apartment';
  const sale = d.selection.listingPurpose === 'buy';
  const location = { district: d.district, ...(d.locationPrecision !== 'district' ? { city: d.city } : {}) };
  if (d.locationPrecision === 'exact') {
    location.address = d.street;
  }
  if (apartment && d.publicBuildingName) location.building = d.building;
  return {
    title: d.title, purpose: d.selection.listingPurpose, category: d.selection.propertyCategory,
    location, price: Number(d.price), currency: d.currency,
    ...(sale ? { negotiable: d.negotiable, availability: d.saleAvailability } : {
      rentalType: d.rentalType, billingPeriod: d.billingPeriod, minimumDuration: Number(d.minimumDuration), durationUnit: d.durationUnit,
      deposit: Number(d.deposit), includedUtilities: [...d.utilities], additionalCharges: d.charges,
      availableFrom: d.availableFrom, availabilityNote: d.availabilityNote,
    }),
    bedrooms: Number(d.bedrooms), bathrooms: Number(d.bathrooms), floorArea: Number(d.floorArea), floorUnit: d.floorUnit,
    furnishing: d.furnishing, condition: d.condition, parking: Number(d.parking), features: [...d.features],
    ...(apartment ? { apartmentType: d.apartmentType, floorNumber: Number(d.floorNumber), balcony: d.balcony, sharedFacilities: [...d.sharedFacilities],
      maintenance: has(d.maintenance) ? Number(d.maintenance) : null, maintenancePeriod: d.maintenancePeriod } : {
      landArea: Number(d.landArea), landUnit: d.landUnit, floors: Number(d.floors), garden: d.garden, pool: d.pool,
    }),
    photos: d.photos.filter(p => p.status === 'ready').map((p, index) => ({ url: p.url, alt: `Property photo ${index + 1}` })),
    floorPlan: d.floorPlan?.status === 'ready' ? d.floorPlan.url : null, description: d.description,
    contact: { displayName: d.publicName, ...(d.publicMethods.includes('email') ? { email: d.publicEmail } : {}),
      ...(d.publicMethods.includes('phone') ? { phone: d.publicPhone } : {}),
      ...(d.publicMethods.includes('whatsapp') ? { whatsapp: d.publicPhone } : {}) },
  };
}
export function saveOwnerDraft(storage, draft) {
  const record = { version: 1, savedAt: new Date().toISOString(), draft: { ...draft, status: 'draft',
    price: draft.price === '' ? '' : Number(draft.price), priceInput: String(draft.price) } };
  const serialized = JSON.stringify(record);
  storage.setItem(OWNER_DRAFT_KEY, serialized);
  if (storage.getItem(OWNER_DRAFT_KEY) !== serialized) throw new Error('Draft storage could not be verified.');
  return record.savedAt;
}
export function loadOwnerDraft(storage) {
  const raw = storage.getItem(OWNER_DRAFT_KEY);
  if (!raw) return null;
  const record = JSON.parse(raw), d = record?.draft;
  if (record.version !== 1 || d?.status !== 'draft' || d?.version !== 1 || !d.id || d.selection?.listingRole !== 'owner' ||
      !['buy', 'rent'].includes(d.selection.listingPurpose) || !Object.hasOwn(CATEGORY_LABELS, d.selection.propertyCategory)) throw new Error('This saved draft is not supported.');
  const clean = { ...createOwnerDraft(d.selection) };
  // Only known fields are loaded; don't accept a published status or extra account fields.
  for (const key of Object.keys(clean)) if (Object.hasOwn(d, key) && typeof d[key] === typeof clean[key]) clean[key] = d[key];
  if (typeof d.price === 'number' && Number.isFinite(d.price)) {
    clean.price = typeof d.priceInput === 'string' && /^\d*(?:\.\d*)?$/.test(d.priceInput) && Number(d.priceInput) === d.price ? d.priceInput : String(d.price);
  }
  if (d.price === null && typeof d.priceInput === 'string' && /^\d*(?:\.\d*)?$/.test(d.priceInput)) clean.price = d.priceInput;
  if (!Object.hasOwn(d, 'phoneNumber') && d.phone) {
    const saved = String(d.phone).replace(/[\s()-]/g, '');
    const prefix = [...new Set(COUNTRY_CODES.map(country => country.code))].sort((a, b) => b.length - a.length).find(code => saved.startsWith(code));
    clean.countryCode = prefix || '';
    clean.phoneNumber = prefix ? saved.slice(prefix.length) : saved.replace(/^\+/, '');
  }
  // Retain the legacy combined value for compatibility; edits keep it in sync.
  if (clean.countryCode && clean.phoneNumber) clean.phone = combineOwnerPhone(clean.countryCode, clean.phoneNumber);
  if (!COUNTRY_CODES.some(country => country.iso === d.phoneCountry && country.code === clean.countryCode)) {
    const matching = COUNTRY_CODES.filter(country => country.code === clean.countryCode);
    clean.phoneCountry = matching.length === 1 ? matching[0].iso : 'manual';
  }
  if ((!Object.hasOwn(d, 'publicPhoneNumber') || !d.publicPhoneNumber) && d.publicPhone) {
    const saved = String(d.publicPhone).replace(/[\s()-]/g, '');
    const prefix = saved.startsWith('+') ? [...new Set(COUNTRY_CODES.map(country => country.code))].sort((a, b) => b.length - a.length).find(code => saved.startsWith(code)) : '+94';
    clean.publicCountryCode = prefix || '';
    clean.publicPhoneNumber = saved.startsWith('+') ? (prefix ? saved.slice(prefix.length) : saved.slice(1)) : saved;
  }
  if (clean.publicCountryCode && clean.publicPhoneNumber) clean.publicPhone = combineOwnerPhone(clean.publicCountryCode, clean.publicPhoneNumber);
  if (!COUNTRY_CODES.some(country => country.iso === d.publicPhoneCountry && country.code === clean.publicCountryCode)) {
    const matching = COUNTRY_CODES.filter(country => country.code === clean.publicCountryCode);
    clean.publicPhoneCountry = matching.length === 1 ? matching[0].iso : 'manual';
  }
  for (const key of ['features', 'sharedFacilities', 'utilities', 'publicMethods', 'photos']) if (!Array.isArray(clean[key])) throw new Error('The saved draft is damaged.');
  clean.step = Math.max(0, Math.min(6, Number.isInteger(d.step) ? d.step : 0));
  clean.selection = { listingRole: 'owner', listingPurpose: d.selection.listingPurpose, propertyCategory: d.selection.propertyCategory };
  for (const key of ['features', 'sharedFacilities', 'utilities', 'publicMethods']) if (clean[key].some(value => typeof value !== 'string')) throw new Error('The saved draft is damaged.');
  clean.photos = clean.photos.map(p => ({ id: String(p.id), name: String(p.name), publicId: String(p.publicId || ''), kind: 'photo',
    status: p.status === 'ready' && safeUploadUrl(p.url) ? 'ready' : 'failed', url: safeUploadUrl(p.url) ? p.url : '',
    progress: p.status === 'ready' ? 100 : 0, error: p.status === 'ready' ? '' : 'Choose this file again to retry the upload.' }));
  if (clean.floorPlan) clean.floorPlan = { id: String(clean.floorPlan.id), name: String(clean.floorPlan.name), publicId: String(clean.floorPlan.publicId || ''), kind: 'floorPlan',
    url: safeUploadUrl(clean.floorPlan.url) ? clean.floorPlan.url : '', status: safeUploadUrl(clean.floorPlan.url) ? 'ready' : 'failed',
    progress: safeUploadUrl(clean.floorPlan.url) ? 100 : 0, error: safeUploadUrl(clean.floorPlan.url) ? '' : 'Choose this file again to retry the upload.' };
  return { ...record, draft: clean };
}
export function safeUploadUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'res.cloudinary.com'; } catch { return false; }
}
