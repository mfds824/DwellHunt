import { APARTMENT_TYPES, COMMERCIAL_TYPES, LAND_TYPES, rulesFor, publicText } from './owner-listing-model.js';

// Factual title suggestions built on the owner's device from entered facts only. No AI service is used.
const text = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const titleCase = value => text(value).replace(/\b\w/g, c => c.toUpperCase());
export function titleFactsKey(d) {
  return JSON.stringify([d.selection.propertyCategory, d.selection.listingPurpose, d.apartmentType, d.commercialType, d.landType,
    d.building, d.publicBuildingName, d.city, d.district, d.locationPrecision, d.bedrooms, d.bathroomType, d.floorArea, d.floorUnit,
    d.landArea, d.landUnit, d.features, d.sharedFacilities, d.garden, d.pool, d.balcony, d.rentalType]);
}
function propertyType(d) {
  const category = d.selection.propertyCategory;
  if (category === 'apartment') return ({ studio: 'Studio Apartment', duplex: 'Duplex Apartment', penthouse: 'Penthouse' })[d.apartmentType] || 'Apartment';
  if (category === 'commercial') return ({ office: 'Office Space', shop: 'Shop', warehouse: 'Warehouse' })[d.commercialType] || 'Commercial Space';
  if (category === 'land') return `${(LAND_TYPES.find(([id]) => id === d.landType)?.[1] || '').split(' /')[0]} Land`.trim();
  return ({ house: 'House', villa: 'Villa', annex: 'Annex', room: 'Room' })[category] || 'Property';
}
export function suggestOwnerTitles(d) {
  const rules = rulesFor(d.selection.propertyCategory);
  const location = d.locationPrecision === 'district' ? text(d.district) : text(d.city) || text(d.district);
  const purpose = d.selection.listingPurpose === 'buy' ? 'for Sale' : d.rentalType === 'short-stay' ? 'for Short Stays' : 'for Rent';
  const bedrooms = rules.rooms && d.apartmentType !== 'studio' && /^\d+$/.test(text(d.bedrooms)) && Number(d.bedrooms) > 0 ? `${Number(d.bedrooms)}-Bedroom ` : '';
  const size = rules.landOnly && Number(d.landArea) > 0 ? `${Number(d.landArea).toLocaleString('en-US')}-${d.landUnit === 'perches' ? 'Perch' : titleCase(d.landUnit)} ` : '';
  const base = `${size}${bedrooms}${propertyType(d)}`;
  const where = location ? ` in ${location}` : '';
  const features = [...new Set([...(d.features || []), ...(rules.apartment ? d.sharedFacilities || [] : []),
    rules.apartment && d.balcony ? 'Balcony' : '', rules.outdoor && d.pool ? 'Private Pool' : '', rules.outdoor && d.garden ? 'Garden' : ''].map(text).filter(Boolean))];
  const titles = [`${base} ${purpose}${where}`];
  if (features[0]) titles.push(`${base} with ${titleCase(features[0])}${where}`);
  if (rules.roomOnly && d.bathroomType) titles.push(`Room ${purpose}${where} (${d.bathroomType === 'attached' ? 'Attached' : 'Shared'} Bathroom)`);
  if (rules.commercial && Number(d.floorArea) > 0) titles.push(`${base} ${purpose}${where} · ${Number(d.floorArea).toLocaleString('en-US')} ${d.floorUnit}`);
  if (rules.building && d.publicBuildingName && text(d.building)) titles.push(`${text(d.building)} – ${base}`);
  // Never suggest a title containing a private detail; keep each within 96 characters.
  return [...new Set(titles.map(title => publicText(title, d)).filter(title => !title.includes('[private detail omitted]') && title.length <= 96))].slice(0, 3);
}
