import { test } from 'node:test';
import assert from 'node:assert/strict';
const { suggestOwnerTitles, titleFactsKey } = await import(new URL('../website/title-suggestions.js', import.meta.url).href);
const { createOwnerDraft, publicOwnerListing } = await import(new URL('../website/owner-listing-model.js', import.meta.url).href);

function apartment() {
  const d = createOwnerDraft({ listingRole: 'owner', listingPurpose: 'buy', propertyCategory: 'apartment' });
  return Object.assign(d, { building: 'Altair', apartmentType: 'standard', bedrooms: '3', city: 'Public Area', street: 'Private Street', unit: 'Private Unit' });
}
test('apartment titles use the exact project, bedroom and type format only after explicit permission', () => {
  const d = apartment();
  assert.deepEqual(suggestOwnerTitles(d), ['3-Bedroom Apartment']);
  d.locationPrecision = 'exact'; assert.deepEqual(suggestOwnerTitles(d), ['3-Bedroom Apartment']);
  d.publicBuildingName = true; d.locationPrecision = 'area';
  assert.deepEqual(suggestOwnerTitles(d), ['Altair \u2013 3-Bedroom Apartment']);
  d.building = 'Capitol TwinPeaks'; d.apartmentType = 'duplex'; d.bedrooms = '2';
  assert.deepEqual(suggestOwnerTitles(d), ['Capitol TwinPeaks \u2013 2-Bedroom Duplex']);
});
test('studios omit bedroom counts without inventing missing project names', () => {
  const d = apartment(); d.apartmentType = 'studio'; d.publicBuildingName = true; d.bedrooms = '1';
  assert.deepEqual(suggestOwnerTitles(d), ['Altair \u2013 Studio Apartment']);
  d.building = ''; assert.deepEqual(suggestOwnerTitles(d), ['Studio Apartment']);
  d.apartmentType = 'penthouse'; d.bedrooms = ''; assert.deepEqual(suggestOwnerTitles(d), ['Penthouse']);
});
test('project permission never grants exact-address or unit visibility, and exact address never grants project permission', () => {
  const d = apartment(); d.publicBuildingName = true;
  let output = publicOwnerListing(d);
  assert.equal(output.location.building, 'Altair'); assert.equal(output.location.address, undefined);
  assert.equal(JSON.stringify(output).includes(d.unit), false);
  const key = titleFactsKey(d); d.publicBuildingName = false; d.locationPrecision = 'exact';
  assert.notEqual(titleFactsKey(d), key);
  output = publicOwnerListing(d);
  assert.equal(output.location.address, d.street); assert.equal(output.location.building, undefined);
  assert.equal(suggestOwnerTitles(d).join(' ').includes(d.building), false);
});
test('permission changes refresh suggestions and private project names are flagged in existing text rather than silently deleted', () => {
  const d = apartment();
  const before = titleFactsKey(d); d.publicBuildingName = true;
  assert.notEqual(titleFactsKey(d), before);
  d.publicBuildingName = false; d.building = 'A deliberately long official project name '.repeat(4);
  assert.equal(suggestOwnerTitles(d)[0], '3-Bedroom Apartment');
  d.publicBuildingName = true; assert.ok(suggestOwnerTitles(d)[0].startsWith(d.building.trim()));
});
test('villa and house headlines retain their three editable fact-based variants', () => {
  const d = createOwnerDraft({ listingRole: 'owner', listingPurpose: 'rent', propertyCategory: 'villa' });
  assert.equal(new Set(suggestOwnerTitles(d)).size, 3);
  Object.assign(d, { bedrooms: '3', pool: true, garden: true, city: 'Review Area', features: ['Backup power'] });
  assert.equal(suggestOwnerTitles(d)[1], '3-bedroom Villa with a private pool in Review Area');
  for (const invented of ['Oceanfront', 'Sky', 'Penthouse', 'verified']) assert.equal(suggestOwnerTitles(d).join(' ').includes(invented), false);
});
