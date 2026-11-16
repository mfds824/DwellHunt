export const isManagedListing = p => ['owner', 'agent'].includes(p?.listingRole);
// The only bridge from private owner forms to the existing marketplace renderer.
import { publicOwnerListing } from './owner-listing-model.js';
const numeric = value => value === '' || value == null || !Number.isFinite(Number(value)) ? undefined : Number(value);
export function ownerListingAdapter(d, status = 'draft') {
  const p = publicOwnerListing(d);
  return {
    id: d.id, status: ['draft', 'submitted', 'published'].includes(status) ? status : 'draft', listingRole: d.selection.listingRole === 'agent' ? 'agent' : 'owner',
    title: p.title || 'Untitled property', purpose: p.purpose, category: p.category === 'house' ? 'mansion' : p.category,
    projectName: p.location.building, apartmentType: p.apartmentType,
    address: [p.location.address, p.location.building].filter(Boolean).join(', '), city: p.location.city || '', district: p.location.district || '', country: 'Sri Lanka',
    coordinates: p.location.position || null, publicLocation: p.location,
    price: numeric(d.price), currency: p.currency, billingPeriod: p.billingPeriod, isNegotiable: p.negotiable,
    bedrooms: numeric(d.bedrooms), bathrooms: numeric(d.bathrooms), parkingSpaces: numeric(d.parking),
    floorArea: numeric(d.floorArea), floorUnit: p.floorUnit,
    floorAreaSqFt: numeric(d.floorArea) === undefined ? undefined : Number(d.floorArea) * (d.floorUnit === 'sqm' ? 10.7639104167 : 1),
    landAreaPerches: !numeric(d.landArea) ? undefined : Number(d.landArea) * ({ perches: 1, sqft: 1 / 272.25, sqm: 10.7639104167 / 272.25, acres: 160 }[d.landUnit] || 0),
    furnishedStatus: p.furnishing || '', condition: p.condition, description: p.description,
    features: [...new Set([...p.features, ...(p.sharedFacilities || []), ...(p.balcony ? ['Balcony'] : []), ...(p.garden ? ['Garden'] : []), ...(p.pool ? ['Private swimming pool'] : [])])],
    images: p.photos.map(photo => photo.url), floorPlanUrl: p.floorPlan || undefined,
    contact: p.contact, nearbyEssentials: p.nearbyEssentials, details: {
      'Apartment type': p.apartmentType, 'Property condition': p.condition, 'Floor number': numeric(d.floorNumber),
      'Availability': p.availability || p.availableFrom, 'Availability details': p.availabilityNote,
      'Minimum duration': p.minimumDuration ? `${p.minimumDuration} ${p.durationUnit}` : undefined,
      'Deposit / advance': numeric(d.deposit) !== undefined && p.purpose === 'rent' ? `${p.currency} ${p.deposit}` : undefined,
      'Included utilities': p.includedUtilities?.join(', '), 'Additional charges': p.additionalCharges,
      'Maintenance': p.maintenance != null ? `${p.currency} ${p.maintenance} / ${p.maintenancePeriod || 'period not provided'}` : undefined,
    }, verified: false, featured: false,
  };
}
export function isPublicListing(p) {
  if (p.synthetic === true) return false;
  return isManagedListing(p) ? p.status === 'published' : !p.status || p.status === 'published';
}
export function listingPrice(p, displayCurrency, legacyFormatter) {
  if (!isManagedListing(p)) return legacyFormatter(p.price, displayCurrency, p.purpose);
  if (!Number.isFinite(p.price)) return 'Price not provided';
  const enteredAmount = `${p.currency || 'LKR'} ${p.price.toLocaleString('en-US', { maximumFractionDigits: 8 })}`;
  const originalAmount = p.currency === 'LKR' ? legacyFormatter(p.price, displayCurrency, p.purpose) : '';
  const amount = originalAmount ? originalAmount.replace(/\/mo$/, '') : enteredAmount;
  return p.purpose === 'rent' ? `${amount} / ${{ night: 'night', week: 'week', month: 'month', year: 'year' }[p.billingPeriod] || 'period not provided'}` : amount;
}
