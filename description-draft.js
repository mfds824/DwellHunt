import { APARTMENT_TYPES, COMMERCIAL_TYPES, LAND_TYPES, TENANT_TYPES, ANNEX_POSITIONS, KITCHEN_TYPES, SALE_SCOPES, rulesFor, publicOwnerListing, publicText } from './owner-listing-model.js?v=20261121-vv1';
import { formatPriceInput } from './price-input.js';

// Builds a fact-based description draft on the owner's device. No AI service is used and nothing is sent.
export const DESCRIPTION_AI_AVAILABLE = false;
const text = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const entered = value => text(value) !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
const count = (value, singular, plural = singular + 's') => `${Number(value).toLocaleString('en-US')} ${Number(value) === 1 ? singular : plural}`;
const furnishingLabels = { unfurnished: 'Unfurnished', 'semi-furnished': 'Partly furnished', 'fully-furnished': 'Fully furnished' };
const label = (list, id) => list.find(([value]) => value === id)?.[1] || '';
export function listingKeyFacts(d) {
  const rules = rulesFor(d.selection.propertyCategory), facts = [];
  if (rules.rooms && entered(d.bedrooms)) facts.push({ icon: '🛏', label: count(d.bedrooms, 'bedroom') });
  if (rules.rooms && entered(d.bathrooms)) facts.push({ icon: '🛁', label: count(d.bathrooms, 'bathroom') });
  if (rules.roomOnly && d.bathroomType) facts.push({ icon: '🛁', label: d.bathroomType === 'attached' ? 'Attached bathroom' : 'Shared bathroom' });
  if (!rules.landOnly && !rules.roomOnly && entered(d.parking)) facts.push({ icon: '🚗', label: count(d.parking, 'parking space') });
  if (rules.floorArea && Number(d.floorArea) > 0) facts.push({ icon: '📐', label: `${Number(d.floorArea).toLocaleString('en-US')} ${d.floorUnit}` });
  if ((rules.land || (rules.annex && d.selection.listingPurpose === 'buy')) && Number(d.landArea) > 0) facts.push({ icon: '🌳', label: `${Number(d.landArea).toLocaleString('en-US')} ${d.landUnit}` });
  return facts;
}
export function descriptionFactsKey(d) {
  return JSON.stringify(Object.keys(d).filter(key => !['step', 'photos', 'floorPlan', 'description', 'title', 'deviceSavingEnabled'].includes(key)).map(key => d[key]));
}
export function draftOwnerDescription(d) {
  const rules = rulesFor(d.selection.propertyCategory), sale = d.selection.listingPurpose === 'buy', shortStay = !sale && d.rentalType === 'short-stay';
  const p = publicOwnerListing(d);
  const type = rules.apartment ? (label(APARTMENT_TYPES, d.apartmentType) || 'apartment').toLowerCase()
    : rules.commercial ? (label(COMMERCIAL_TYPES, d.commercialType) || 'commercial space').toLowerCase()
    : rules.landOnly ? `${(label(LAND_TYPES, d.landType) || 'plot of').toLowerCase()} land`
    : ({ house: 'house', villa: 'villa', annex: 'annex', room: 'room' })[d.selection.propertyCategory];
  const location = [p.location.building, p.location.address, p.location.city, p.location.district].map(text).filter(Boolean).join(', ');
  const bedrooms = rules.rooms && Number(d.bedrooms) > 0 && d.apartmentType !== 'studio' ? `${Number(d.bedrooms)}-bedroom ` : '';
  const intro = `A ${bedrooms}${type}${location ? ' in ' + location : ''}, offered ${sale ? 'for sale' : shortStay ? 'for short stays' : 'for rent'} by its owner and verified by DwellHunt.`;
  const bullets = listingKeyFacts(d).map(fact => fact.label);
  if (!rules.landOnly && d.furnishing) bullets.push(`Furnishing: ${furnishingLabels[d.furnishing] || text(d.furnishing)}`);
  if (!rules.landOnly && d.condition) bullets.push(`Condition: ${text(d.condition)}`);
  if (rules.annex && d.annexPosition) bullets.push(label(ANNEX_POSITIONS, d.annexPosition));
  if (rules.annex && d.separateEntrance) bullets.push(d.separateEntrance === 'yes' ? 'Own separate entrance' : 'Shared entrance with the main house');
  if (rules.annex && d.kitchenType) bullets.push(`Kitchen: ${label(KITCHEN_TYPES, d.kitchenType)}`);
  if (rules.annex && sale && d.saleScope) bullets.push(label(SALE_SCOPES, d.saleScope));
  if (rules.annex && !sale && d.ownerOnPremises === 'yes') bullets.push('The owner lives in the main house');
  if (rules.apartment && entered(d.floorNumber)) bullets.push(`Floor: ${Number(d.floorNumber) === 0 ? 'Ground floor' : d.floorNumber}`);
  const amenities = [...new Set([...(d.features || []), ...(rules.apartment ? d.sharedFacilities || [] : []), rules.apartment && d.balcony ? 'Balcony' : '',
    rules.outdoor && d.garden ? 'Garden' : '', rules.outdoor && d.pool ? 'Private pool' : ''].map(text).filter(Boolean))];
  if (amenities.length) bullets.push(`Features: ${amenities.join(', ')}`);
  if (Number(d.price) > 0) bullets.push(`${sale ? 'Asking price' : shortStay ? 'Nightly rate' : 'Rent'}: ${d.currency} ${formatPriceInput(String(d.price))}${!sale && !shortStay ? (d.billingPeriod === 'year' ? ' per year' : ' per month') : ''}`);
  if (sale && d.negotiable) bullets.push('Price is negotiable');
  if (sale && d.saleAvailability) bullets.push(`Availability: ${text(d.saleAvailability)}`);
  if (shortStay) {
    if (entered(d.minimumDuration)) bullets.push(`Minimum stay: ${count(d.minimumDuration, 'night')}`);
    if (d.checkInTime) bullets.push(`Check-in from ${d.checkInTime}`);
  } else if (!sale) {
    if (entered(d.minimumDuration)) bullets.push(`Minimum lease: ${count(d.minimumDuration, 'month')}`);
    if (entered(d.advanceMonths)) bullets.push(Number(d.advanceMonths) === 0 ? 'No advance required' : `Advance: ${count(d.advanceMonths, 'month')}`);
    if (entered(d.securityDeposit) && Number(d.securityDeposit) > 0) bullets.push(`Security deposit: ${d.currency} ${formatPriceInput(String(d.securityDeposit))}`);
    if (rules.apartment && d.maintenanceIncluded) bullets.push('Maintenance charges included in the rent');
    if (d.separateMeters === 'yes') bullets.push('Separate electricity and water meters');
    if (d.petsAllowed === 'yes') bullets.push('Pets allowed'); else if (d.petsAllowed === 'no') bullets.push('No pets');
    if (d.tenantTypes?.length) bullets.push(`Suits: ${d.tenantTypes.map(id => label(TENANT_TYPES, id).toLowerCase()).join(', ')}`);
    if (d.availableFrom) bullets.push(`Available from ${text(d.availableFrom)}`);
  }
  if (d.utilities?.length) bullets.push(`Included: ${d.utilities.map(text).join(', ')}`);
  if (d.charges) bullets.push(`Other charges: ${publicText(d.charges, d)}`);
  return intro + (bullets.length ? '\n\n' + bullets.map(bullet => '• ' + bullet).join('\n') : '');
}
export function descriptionBlocks(value) {
  const blocks = [];
  for (const line of String(value || '').split(/\r?\n/)) {
    if (/^\s*[•*-]\s+/.test(line)) {
      const item = line.replace(/^\s*[•*-]\s+/, '');
      if (blocks.at(-1)?.type === 'list') blocks.at(-1).items.push(item); else blocks.push({ type: 'list', items: [item] });
    } else if (line.trim()) {
      if (blocks.at(-1)?.type === 'paragraph') blocks.at(-1).text += '\n' + line; else blocks.push({ type: 'paragraph', text: line });
    } else if (blocks.at(-1)?.type === 'paragraph') blocks.push({ type: 'break' });
  }
  return blocks.filter(block => block.type !== 'break');
}
