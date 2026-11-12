import { APARTMENT_TYPES, publicOwnerListing } from './owner-listing-model.js';
import { formatPriceInput } from './price-input.js';

export const DESCRIPTION_AI_AVAILABLE = false;
export const DESCRIPTION_AI_REASON = 'AI drafting is not connected. This assistant builds a draft locally from your entered facts; no information is sent to an AI service.';
const text = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const enteredNumber = value => text(value) !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
const count = (value, singular, plural = singular + 's') => `${Number(value).toLocaleString('en-US')} ${Number(value) === 1 ? singular : plural}`;
const furnishingLabels = { unfurnished: 'Unfurnished', 'semi-furnished': 'Partly furnished', 'fully-furnished': 'Fully furnished' };
export function listingKeyFacts(d) {
  const facts = [];
  if (enteredNumber(d.bedrooms)) facts.push({ icon: '🛏', label: count(d.bedrooms, 'bedroom') });
  if (enteredNumber(d.bathrooms)) facts.push({ icon: '🛁', label: count(d.bathrooms, 'bathroom') });
  if (enteredNumber(d.parking)) facts.push({ icon: '🚗', label: count(d.parking, 'parking space') });
  if (enteredNumber(d.floorArea) && Number(d.floorArea) > 0 && d.floorUnit) facts.push({ icon: '📐', label: `${Number(d.floorArea).toLocaleString('en-US')} ${d.floorUnit}` });
  return facts;
}
function privateTextRemoved(value, d) {
  let result = text(value);
  const privateValues = [d.ownerName, d.email, d.phone, d.enquiryDestination,
    ...(d.locationPrecision === 'exact' ? [] : [d.street]), ...(!d.publicBuildingName ? [d.building] : []),
    ...(d.locationPrecision === 'district' ? [d.city] : [])].map(text).filter(value => value.length >= 3);
  for (const privateValue of privateValues) result = result.replace(new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[private detail omitted]');
  return result;
}
export function descriptionFactsKey(d) {
  const keys = ['selection', 'apartmentType', 'publicBuildingName', 'locationPrecision', 'district', 'city', 'building', 'street', 'bedrooms', 'bathrooms', 'parking', 'floorArea', 'floorUnit',
    'furnishing', 'condition', 'features', 'sharedFacilities', 'garden', 'pool', 'balcony', 'currency', 'price', 'negotiable', 'maintenance', 'maintenancePeriod',
    'saleAvailability', 'rentalType', 'billingPeriod', 'minimumDuration', 'durationUnit', 'deposit', 'utilities', 'charges', 'availableFrom', 'availabilityNote',
    'ownerName', 'email', 'phone', 'enquiryDestination'];
  return JSON.stringify(keys.map(key => d[key]));
}
export function draftOwnerDescription(d) {
  const apartment = d.selection.propertyCategory === 'apartment', sale = d.selection.listingPurpose === 'buy';
  const publicData = publicOwnerListing(d);
  const subtype = APARTMENT_TYPES.find(([id]) => id === d.apartmentType)?.[1];
  const type = apartment ? ({ Studio: 'studio apartment', Duplex: 'duplex apartment', Penthouse: 'penthouse' }[subtype] || 'apartment') : d.selection.propertyCategory === 'villa' ? 'villa' : 'luxury house';
  const location = [publicData.location.building, publicData.location.address, publicData.location.city, publicData.location.district].map(text).filter(Boolean).join(', ');
  const bedrooms = enteredNumber(d.bedrooms) && Number(d.bedrooms) > 0 ? `${Number(d.bedrooms)}-bedroom ` : '';
  const introduction = `Explore this ${bedrooms}${type}${location ? ' in ' + location : ''}, offered ${sale ? 'for sale' : 'for rent'}.`;
  const bullets = listingKeyFacts(d).map(fact => fact.label);
  if (d.furnishing) bullets.push(`Furnishing: ${furnishingLabels[d.furnishing] || text(d.furnishing)}`);
  if (d.condition) bullets.push(`Condition: ${text(d.condition)}`);
  const amenities = [...new Set([...(d.features || []), ...(apartment ? d.sharedFacilities || [] : []),
    apartment && d.balcony ? 'Balcony' : '', !apartment && d.garden ? 'Garden' : '', !apartment && d.pool ? 'Private pool' : ''].map(text).filter(Boolean))];
  if (amenities.length) bullets.push(`Features: ${amenities.join(', ')}`);
  if (enteredNumber(d.price) && Number(d.price) > 0 && d.currency) bullets.push(`${sale ? 'Asking price' : 'Rental amount'}: ${d.currency} ${formatPriceInput(String(d.price))}${!sale && d.billingPeriod ? ' per ' + d.billingPeriod : ''}`);
  if (sale && d.negotiable) bullets.push('Price is negotiable');
  if (apartment && enteredNumber(d.maintenance)) bullets.push(`Maintenance charges: ${d.currency} ${formatPriceInput(String(d.maintenance))}${d.maintenancePeriod ? ' per ' + d.maintenancePeriod : ''}`);
  if (sale && d.saleAvailability) bullets.push(`Availability: ${text(d.saleAvailability)}`);
  if (!sale) {
    if (d.rentalType) bullets.push(`Rental type: ${d.rentalType === 'short-stay' ? 'Short stay' : 'Long-term rental'}`);
    if (enteredNumber(d.minimumDuration) && d.durationUnit) bullets.push(`Minimum lease / stay: ${d.minimumDuration} ${d.durationUnit}`);
    if (enteredNumber(d.deposit)) bullets.push(`Deposit / advance: ${d.currency} ${formatPriceInput(String(d.deposit))}`);
    if (d.utilities?.length) bullets.push(`Included utilities: ${d.utilities.map(text).join(', ')}`);
    if (d.charges) bullets.push(`Additional charges: ${privateTextRemoved(d.charges, d)}`);
    if (d.availableFrom) bullets.push(`Available from: ${text(d.availableFrom)}`);
    if (d.rentalType === 'short-stay' && d.availabilityNote) bullets.push(`Availability details: ${privateTextRemoved(d.availabilityNote, d)}`);
  }
  return introduction + (bullets.length ? '\n\n' + bullets.map(bullet => '• ' + bullet).join('\n') : '');
}
export function descriptionBlocks(value) {
  const blocks = [];
  for (const line of String(value || '').split(/\r?\n/)) {
    if (/^\s*[•*-]\s+/.test(line)) {
      const item = line.replace(/^\s*[•*-]\s+/, '');
      if (blocks.at(-1)?.type === 'list') blocks.at(-1).items.push(item);
      else blocks.push({ type: 'list', items: [item] });
    } else if (line.trim()) {
      if (blocks.at(-1)?.type === 'paragraph') blocks.at(-1).text += '\n' + line;
      else blocks.push({ type: 'paragraph', text: line });
    } else if (blocks.at(-1)?.type === 'paragraph') blocks.push({ type: 'break' });
  }
  return blocks.filter(block => block.type !== 'break');
}
