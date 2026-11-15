import { test } from 'node:test';
import assert from 'node:assert/strict';
const model = await import(new URL('../owner-phase-a/owner-listing-model.js', import.meta.url).href);
const titles = await import(new URL('../owner-phase-a/title-suggestions.js', import.meta.url).href);
const descriptions = await import(new URL('../owner-phase-a/description-draft.js', import.meta.url).href);

const photo = { id: 'p1', name: 'kitchen.jpg', kind: 'photo', status: 'ready', url: 'https://res.cloudinary.com/demo/image/upload/p1.jpg', error: '' };
function filled(category: string, purpose = 'rent', rentalType = 'long-term') {
  return { ...model.createOwnerDraft({ listingPurpose: purpose, propertyCategory: category }),
    ownerName: 'Nimal Perera', email: 'Nimal@Example.test', countryCode: '+94', phoneNumber: '0771234567', preferredContact: 'whatsapp',
    district: 'Colombo', city: 'Colombo 05', street: '12 Private Lane', building: 'Havelock Heights', unit: '7B',
    apartmentType: 'standard', commercialType: 'office', landType: 'residential',
    title: 'Bright family home', bedrooms: '2', bathrooms: '2', bathroomType: 'attached', floorArea: '1100', floorUnit: 'sqft',
    furnishing: 'semi-furnished', condition: 'Good condition', parking: '1', parkingType: 'covered', floorNumber: '4',
    landArea: '10', landUnit: 'perches', floors: '2', currency: 'LKR', price: purpose === 'buy' ? '45000000' : rentalType === 'short-stay' ? '15000' : '150000',
    saleAvailability: 'Available now', rentalType, billingPeriod: rentalType === 'short-stay' ? 'night' : 'month', minimumDuration: rentalType === 'short-stay' ? '2' : '12',
    advanceMonths: '6', securityDeposit: '150000', noticePeriod: '1', checkInTime: '14:00', availableFrom: '2026-12-01',
    tenantTypes: ['family'], petsAllowed: 'no', separateMeters: 'yes', description: 'Quiet street close to schools.',
    photos: [photo], locationPrecision: 'area', authorized: true, accurate: true, photoPermission: true, consent: true };
}

test('every category validates with only the questions it needs', () => {
  for (const category of Object.keys(model.CATEGORY_LABELS)) {
    const purposes = category === 'room' ? ['rent'] : ['rent', 'buy'];
    for (const purpose of purposes) {
      const d = filled(category, purpose);
      assert.deepEqual(model.validateOwnerDraft(d, true), [], `${category}/${purpose} should be complete`);
    }
  }
  const land = { ...filled('land', 'buy'), bedrooms: '', bathrooms: '', floorArea: '', furnishing: '', condition: '', parking: '', street: '' };
  assert.deepEqual(model.validateOwnerDraft(land), [], 'land needs no rooms, floor area, furnishing, parking or street');
  const room = { ...filled('room'), bedrooms: '', bathrooms: '', parking: '', floorArea: '' };
  assert.deepEqual(model.validateOwnerDraft(room), []);
  assert.match(model.validateOwnerStep({ ...filled('room'), bathroomType: '' }, 2).bathroomType, /Bathroom/);
  assert.match(model.validateOwnerStep(filled('room', 'buy'), 3).price, /only be listed for rent/);
  assert.match(model.validateOwnerStep({ ...filled('apartment'), building: '' }, 1).building, /Building/);
});

test('long-term rent asks Sri Lankan terms; short stay asks nightly terms', () => {
  const rent = filled('house');
  assert.match(model.validateOwnerStep({ ...rent, advanceMonths: '' }, 3).advanceMonths, /advance/i);
  assert.match(model.validateOwnerStep({ ...rent, advanceMonths: '30' }, 3).advanceMonths, /0 to 24/);
  assert.match(model.validateOwnerStep({ ...rent, availableFrom: '' }, 3).availableFrom, /available/);
  const stay = filled('villa', 'rent', 'short-stay');
  assert.deepEqual(model.validateOwnerStep(stay, 3), {});
  assert.match(model.validateOwnerStep({ ...stay, checkInTime: '' }, 3).checkInTime, /check-in/);
  const pub = model.publicOwnerListing(stay);
  assert.equal(pub.billingPeriod, 'night'); assert.equal(pub.minimumNights, 2); assert.equal('advanceMonths' in pub, false);
  const longTerm = model.publicOwnerListing(rent);
  assert.equal(longTerm.advanceMonths, 6); assert.equal(longTerm.securityDeposit, 150000); assert.equal(longTerm.separateMeters, 'yes');
});

test('unusual figures must be confirmed before continuing, but never silently block', () => {
  const cheap = { ...filled('apartment'), price: '2' };
  assert.ok(model.unusualFigures(cheap).some((w: string) => /below LKR 10,000/.test(w)));
  assert.match(model.validateOwnerStep(cheap, 3).unusualConfirmed, /confirm/);
  assert.deepEqual(model.validateOwnerStep({ ...cheap, unusualConfirmed: true }, 3), {});
  assert.ok(model.unusualFigures({ ...filled('apartment'), floorArea: '2' }).some((w: string) => /under 150 sqft/.test(w)));
  assert.ok(model.unusualFigures({ ...filled('house'), advanceMonths: '18' }).some((w: string) => /more than 12 months/.test(w)));
  assert.deepEqual(model.unusualFigures({ ...filled('apartment'), currency: 'USD', price: '900' }), []);
  assert.deepEqual(model.unusualFigures(filled('apartment')), []);
});

test('the public listing never includes the owner contact, street, unit or a private building name', () => {
  const d = { ...filled('apartment'), title: 'Havelock Heights flat, call 0771234567', description: 'Owner Nimal Perera at 12 Private Lane, unit 7B.' };
  const pub = model.publicOwnerListing(d);
  const json = JSON.stringify(pub);
  for (const secret of ['Nimal Perera', 'nimal@example.test', '0771234567', '12 Private Lane', 'Havelock Heights']) assert.ok(!json.toLowerCase().includes(secret.toLowerCase()), secret);
  assert.equal(pub.contact.via, 'DwellHunt'); assert.equal(pub.contact.displayName, 'Private owner');
  assert.deepEqual(pub.location, { district: 'Colombo', city: 'Colombo 05' });
  const shown = model.publicOwnerListing({ ...d, publicBuildingName: true, locationPrecision: 'exact', publicName: 'Nimal' });
  assert.equal(shown.location.building, 'Havelock Heights'); assert.equal(shown.location.address, '12 Private Lane');
  assert.equal(model.publicOwnerListing({ ...d, locationPrecision: 'district' }).location.city, undefined);
  assert.match(model.validateOwnerStep({ ...d, title: 'Havelock Heights 2BR' }, 4).title, /building name/);
});

test('the review submission separates private owner details from the public listing', () => {
  const s = model.ownerSubmission(filled('apartment'));
  assert.deepEqual(s.owner, { name: 'Nimal Perera', email: 'nimal@example.test', phone: '+94771234567', preferredContact: 'whatsapp' });
  assert.equal(s.privateLocation.street, '12 Private Lane'); assert.equal(s.privateLocation.unit, '7B');
  assert.equal(s.selection.listingRole, 'owner'); assert.equal(s.consent, true);
  assert.equal(JSON.stringify(s.publicListing).includes('12 Private Lane'), false);
});

test('photos must be chosen, and only uploaded photos reach the public listing', () => {
  const d = filled('house');
  assert.match(model.validateOwnerStep({ ...d, photos: [] }, 4).photos, /at least one photo/);
  assert.deepEqual(model.validateOwnerStep({ ...d, photos: [{ id: 'x', name: 'a.jpg', kind: 'photo', status: 'selected', url: '', error: '' }] }, 4), {});
  assert.match(model.validateOwnerStep({ ...d, photos: [{ ...photo, status: 'failed' }] }, 4).photos, /needs attention/);
  assert.deepEqual(model.publicOwnerListing({ ...d, photos: [{ ...photo, url: 'https://evil.example/x.jpg' }] }).photos, []);
});

test('saved drafts keep entered facts but drop photos that were never uploaded', () => {
  const values = new Map<string, string>();
  const store = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  const d = { ...filled('apartment'), photos: [photo, { id: 'local', name: 'b.jpg', kind: 'photo', status: 'selected', url: '', previewUrl: 'blob:x', error: '' }] };
  model.saveOwnerDraft(store, d);
  const loaded = model.loadOwnerDraft(store).draft;
  assert.equal(loaded.city, 'Colombo 05'); assert.deepEqual(loaded.tenantTypes, ['family']);
  assert.equal(loaded.photos.length, 1); assert.equal(loaded.photos[0].url, photo.url);
  values.set(model.OWNER_DRAFT_KEY, JSON.stringify({ version: 1, draft: {} }));
  assert.throws(() => model.loadOwnerDraft(store), /not supported/);
});

test('title suggestions fit each category and never contain private details', () => {
  assert.equal(titles.suggestOwnerTitles(filled('apartment'))[0], '2-Bedroom Apartment for Rent in Colombo 05');
  assert.equal(titles.suggestOwnerTitles({ ...filled('land', 'buy'), landArea: '20' })[0], '20-Perch Residential Land for Sale in Colombo 05');
  assert.ok(titles.suggestOwnerTitles(filled('room')).includes('Room for Rent in Colombo 05 (Attached Bathroom)'));
  assert.equal(titles.suggestOwnerTitles(filled('commercial'))[0], 'Office Space for Rent in Colombo 05');
  assert.equal(titles.suggestOwnerTitles(filled('annex'))[0], '2-Bedroom Annex for Rent in Colombo 05');
  for (const t of titles.suggestOwnerTitles({ ...filled('apartment'), features: ['Havelock Heights view'] })) assert.ok(!/Havelock/.test(t));
  assert.ok(titles.suggestOwnerTitles({ ...filled('apartment'), publicBuildingName: true }).includes('Havelock Heights – 2-Bedroom Apartment'));
});

test('description drafts describe Sri Lankan rental terms factually', () => {
  const text = descriptions.draftOwnerDescription(filled('apartment'));
  assert.match(text, /offered for rent by its owner and verified by DwellHunt/);
  for (const part of ['Advance: 6 months', 'Security deposit: LKR 150,000', 'Separate electricity and water meters', 'No pets', 'Suits: families', 'Minimum lease: 12 months'])
    assert.ok(text.includes(part), part);
  assert.ok(!/Private Lane|Havelock/.test(text));
  assert.match(descriptions.draftOwnerDescription(filled('villa', 'rent', 'short-stay')), /Minimum stay: 2 nights[\s\S]*Check-in from 14:00/);
});

const form = await import(new URL('../owner-phase-a/owner-listing.js', import.meta.url).href);
test('sending a listing returns the reference, or a friendly message that keeps the draft', async () => {
  let sent: any;
  const ok = async (_url: string, init: any) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true, httpStatus: 200, status: 'received', reference: 'OL-2611-0001' }), { status: 200 }); };
  const result = await form.sendOwnerListing('https://api.example.test/api/dwellhunt/owner-listings', model.ownerSubmission(filled('house')), 'tok', '', ok);
  assert.equal(result.reference, 'OL-2611-0001');
  assert.equal(sent.turnstile_token, 'tok'); assert.equal(sent.website, ''); assert.equal(sent.owner.phone, '+94771234567');
  const denied = async () => new Response(JSON.stringify({ ok: false, code: 'HUMAN_VERIFICATION_REQUIRED' }), { status: 403 });
  await assert.rejects(form.sendOwnerListing('u', {}, 't', '', denied), /security check/);
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(form.sendOwnerListing('u', {}, 't', '', offline), /still here/);
  const html = async () => new Response('<html>', { status: 502 });
  await assert.rejects(form.sendOwnerListing('u', {}, 't', '', html), /still here/);
  assert.equal(typeof form.createOwnerStart, 'function'); assert.equal(typeof form.createOwnerListing, 'function');
});

const feed = await import(new URL('../owner-phase-a/owner-listings-feed.js', import.meta.url).href);
test('the public feed keeps only well-formed verified listings and routes every enquiry through DwellHunt', () => {
  const good = { reference: 'OL-2611-0001', title: 'Flat', purpose: 'rent', price: 150000, currency: 'LKR', billingPeriod: 'month', bedrooms: 2, floorArea: 1100, floorUnit: 'sqft',
    location: { city: 'Colombo 05', district: 'Colombo' }, photos: [{ url: 'https://res.cloudinary.com/demo/image/upload/a.jpg' }], publishedAt: '2026-11-02' };
  const newer = { ...good, reference: 'OL-2611-0002', publishedAt: '2026-11-10' };
  const listings = feed.cleanFeed({ ok: true, listings: [good, newer, { ...good, reference: 'bad' }, { ...good, reference: 'OL-2611-0003', photos: [{ url: 'https://evil.example/x.jpg' }] }] });
  assert.deepEqual(listings.map((l: any) => l.reference), ['OL-2611-0002', 'OL-2611-0001']);
  assert.deepEqual(feed.cleanFeed({ ok: false }), []);
  assert.equal(feed.ownerPriceText(good), 'LKR 150,000 / month');
  assert.equal(feed.ownerPriceText({ ...good, purpose: 'buy', price: 45000000 }), 'LKR 45,000,000');
  assert.equal(feed.ownerPriceText({ ...good, billingPeriod: 'night', price: 15000 }), 'LKR 15,000 / night');
  assert.deepEqual(feed.ownerFacts(good), ['2 beds', '1,100 sqft']);
  assert.equal(feed.ownerPlace(good), 'Colombo 05, Colombo');
  const url = decodeURIComponent(feed.ownerEnquiryUrl(good, 'viewing'));
  assert.match(url, /^https:\/\/wa\.me\/94770153678\?text=Hi DwellHunt, I would like to view Flat \(ref OL-2611-0001\)/);
  assert.equal(feed.referenceFromHash('#owner-listing=OL-2611-0001'), 'OL-2611-0001');
  assert.equal(feed.referenceFromHash('#owner-listing=<script>'), '');
  assert.equal(feed.referenceFromHash('#dh-listings'), '');
});
