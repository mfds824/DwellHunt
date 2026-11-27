import { APARTMENT_TYPES, COMMERCIAL_TYPES, LAND_TYPES, VIEWS, rulesFor, publicText, hasContactDetails } from './owner-listing-model.js?v=20261127-vv1';

// Factual title suggestions built on the owner's device from entered facts only. No AI service is used.
const text = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const titleCase = value => text(value).replace(/(^|[\s/-])(\p{Ll})/gu, (_, before, c) => before + c.toUpperCase());
// Tidy a place typed in one case ("nugegoda", "NUGEGODA"); mixed case is kept as typed.
const placeName = value => { const v = text(value); return v === v.toLowerCase() || (v === v.toUpperCase() && v.length > 3) ? titleCase(v.toLowerCase()) : v; };
export function titleFactsKey(d) {
  return JSON.stringify([d.selection.propertyCategory, d.selection.listingPurpose, d.apartmentType, d.commercialType, d.landType,
    d.building, d.publicBuildingName, d.city, d.district, d.locationPrecision, d.bedrooms, d.bathroomType, d.floorArea, d.floorUnit,
    d.landArea, d.landUnit, d.features, d.sharedFacilities, d.garden, d.pool, d.balcony, d.rentalType, d.saleScope, d.separateEntrance, d.annexPosition,
    d.furnishing, d.bathrooms, d.view, d.ownerName, d.email, d.phone, d.phoneNumber, d.unit, d.street]);
}
function propertyType(d) {
  const category = d.selection.propertyCategory;
  if (category === 'apartment') return ({ studio: 'Studio Apartment', duplex: 'Duplex Apartment', penthouse: 'Penthouse' })[d.apartmentType] || 'Apartment';
  if (category === 'commercial') return ({ office: 'Office Space', shop: 'Shop', warehouse: 'Warehouse' })[d.commercialType] || 'Commercial Space';
  if (category === 'land') return `${(LAND_TYPES.find(([id]) => id === d.landType)?.[1] || '').split(' /')[0]} Land`.trim();
  if (category === 'annex' && d.selection.listingPurpose === 'buy' && d.saleScope === 'with-house') return 'House with Annex';
  return ({ house: 'House', villa: 'Villa', annex: 'Annex', room: 'Room' })[category] || 'Property';
}
export function suggestOwnerTitles(d) {
  const rules = rulesFor(d.selection.propertyCategory);
  const district = placeName(d.district), city = d.locationPrecision === 'district' ? '' : placeName(d.city);
  // A very long place, or one holding contact details, falls back to the district.
  const location = city && city.length <= 40 && !hasContactDetails(city) ? city : district;
  const purpose = d.selection.listingPurpose === 'buy' ? 'for Sale' : d.rentalType === 'short-stay' ? 'for Short Stays' : 'for Rent';
  const houseWithAnnex = rules.annex && d.selection.listingPurpose === 'buy' && d.saleScope === 'with-house';
  const bedrooms = rules.rooms && !houseWithAnnex && d.apartmentType !== 'studio' && /^\d+$/.test(text(d.bedrooms)) && Number(d.bedrooms) > 0 ? `${Number(d.bedrooms)}-Bedroom ` : '';
  const size = rules.landOnly && Number(d.landArea) > 0 ? `${Number(d.landArea).toLocaleString('en-US')}-${d.landUnit === 'perches' ? 'Perch' : titleCase(d.landUnit)} ` : '';
  const base = `${size}${bedrooms}${propertyType(d)}`;
  const where = location ? ` in ${location}` : '';
  // A view is the most telling feature, so it comes first ("with Sea View").
  const view = rules.landOnly ? '' : (VIEWS.find(([id]) => id === d.view) || [])[1] || '';
  // Buyers look for these first: the view, then balcony, pool and garden, then building facilities, then other features.
  const features = rules.landOnly ? [] : [...new Set([view, rules.apartment && d.balcony ? 'Balcony' : '', rules.outdoor && d.pool ? 'Private Pool' : '',
    rules.outdoor && d.garden ? 'Garden' : '', ...(rules.apartment ? d.sharedFacilities || [] : []), ...(d.features || [])].map(text).filter(Boolean))];
  const add = houseWithAnnex ? 'and' : 'with', ending = `${purpose}${where}`;
  const titles = [`${base} ${ending}`];
  // The most telling facts come first; only three titles are offered.
  const upstairs = rules.annex && !houseWithAnnex && d.annexPosition === 'upstairs' ? 'Upstairs ' : '';
  const entrance = rules.annex && !houseWithAnnex && d.separateEntrance === 'yes' ? ' with Separate Entrance' : '';
  if (upstairs || entrance) titles.push(`${upstairs}${base}${entrance} ${ending}`);
  if (rules.roomOnly && d.bathroomType) titles.push(`Room ${ending} (${d.bathroomType === 'attached' ? 'Attached' : 'Shared'} Bathroom)`);
  if (rules.commercial && Number(d.floorArea) > 0) titles.push(`${base} ${ending} · ${Number(d.floorArea).toLocaleString('en-US')} ${d.floorUnit}`);
  if (rules.building && d.publicBuildingName && text(d.building)) titles.push(`${text(d.building)} – ${base} ${purpose}`);
  if (features[0]) titles.push(`${base} ${add} ${titleCase(features[0])} ${ending}`);
  const furnished = rules.landOnly ? '' : ({ 'fully-furnished': 'Fully Furnished ', 'semi-furnished': 'Partly Furnished ' })[d.furnishing] || '';
  if (furnished) titles.push(`${furnished}${base} ${ending}`);
  if (features[1]) titles.push(`${base} ${add} ${titleCase(features[1])} ${ending}`);
  // Fillers when few details are entered: the city with its district, then the bathroom count.
  if (location && location === city && district && district !== city) titles.push(`${base} ${purpose} in ${city}, ${district}`);
  if (rules.rooms && !houseWithAnnex && /^\d+$/.test(text(d.bathrooms)) && Number(d.bathrooms) > 0)
    titles.push(`${base} with ${Number(d.bathrooms)} ${Number(d.bathrooms) === 1 ? 'Bathroom' : 'Bathrooms'} ${ending}`);
  // Never suggest a title containing a private detail; keep each within 96 characters.
  return [...new Set(titles)].filter(title => publicText(title, d) === title && !hasContactDetails(title) && title.length <= 96).slice(0, 3);
}
