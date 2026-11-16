import { test } from 'node:test';
import assert from 'node:assert/strict';
const { createOwnerDraft } = await import(new URL('../website/owner-listing-model.js', import.meta.url).href);
const assistant = await import(new URL('../website/description-draft.js', import.meta.url).href);

test('fact-based descriptions cover entered details, charges and availability without private data', () => {
  const d = createOwnerDraft({ listingRole: 'owner', listingPurpose: 'rent', propertyCategory: 'apartment' });
  Object.assign(d, { ownerName: 'Private Owner', email: 'private@example.test', phone: '+94770000000', street: 'Private Street', building: 'Private Building', unit: 'Private Unit',
    city: 'Public Area', district: 'Public District', bedrooms: '3', bathrooms: '2', parking: '1', floorArea: '1500', furnishing: 'fully-furnished',
    features: ['Backup power'], sharedFacilities: ['Gym'], currency: 'LKR', price: '150000', rentalType: 'long-term', billingPeriod: 'month', minimumDuration: '6', durationUnit: 'months',
    maintenance: '5000', deposit: '300000', utilities: ['Water'], charges: 'Cleaning 2000', availableFrom: '2026-12-01' });
  const draft = assistant.draftOwnerDescription(d);
  for (const fact of ['3-bedroom apartment', 'Public Area', '2 bathrooms', '1 parking space', '1,500 sqft', 'Fully furnished', 'Backup power', 'Gym', 'LKR 150,000 per month', 'LKR 5,000 per month', '300,000', 'Water', 'Cleaning 2000', '2026-12-01']) assert.ok(draft.includes(fact), fact);
  for (const value of ['Private Owner', 'private@example.test', '+94770000000', 'Private Street', 'Private Building', 'Private Unit', 'verified', 'ocean view', 'pool']) assert.equal(draft.includes(value), false, value);
  assert.deepEqual(assistant.listingKeyFacts(d).map((fact: any) => fact.label), ['3 bedrooms', '2 bathrooms', '1 parking space', '1,500 sqft']);
  assert.ok(assistant.descriptionBlocks(draft).some((block: any) => block.type === 'list'));
  d.locationPrecision = 'district'; assert.equal(assistant.draftOwnerDescription(d).includes('Public Area'), false);
  d.locationPrecision = 'exact'; assert.equal(assistant.draftOwnerDescription(d).includes('Private Building'), false); d.publicBuildingName = true; assert.ok(assistant.draftOwnerDescription(d).includes('Private Building'));
});

test('missing facts are omitted, sensitive values in notes are redacted, and AI remains unavailable', () => {
  const d = createOwnerDraft({ listingRole: 'owner', listingPurpose: 'rent', propertyCategory: 'villa' });
  const sparse = assistant.draftOwnerDescription(d);
  assert.equal(sparse, 'Explore this villa, offered for rent.');
  assert.deepEqual(assistant.listingKeyFacts(d), []);
  Object.assign(d, { email: 'private@example.test', phone: '+94771234567', charges: 'Contact private@example.test or +94771234567 for charges.' });
  const redacted = assistant.draftOwnerDescription(d);
  assert.equal(redacted.includes(d.email), false); assert.equal(redacted.includes(d.phone), false);
  assert.equal(assistant.DESCRIPTION_AI_AVAILABLE, false); assert.match(assistant.DESCRIPTION_AI_REASON, /not connected/);
  const key = assistant.descriptionFactsKey(d); d.deviceSavingEnabled = true; d.step = 5; d.description = 'My text';
  assert.equal(assistant.descriptionFactsKey(d), key); d.pool = true; assert.notEqual(assistant.descriptionFactsKey(d), key);
});
