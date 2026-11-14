import { APARTMENT_TYPES } from './owner-listing-model.js';

const text = value => String(value ?? '').trim().replace(/\s+/g, ' ');
export function titleFactsKey(draft) {
  return JSON.stringify([
    draft.selection.propertyCategory, draft.selection.listingPurpose, draft.apartmentType,
    draft.building, draft.publicBuildingName, draft.city, draft.district, draft.locationPrecision, draft.bedrooms,
    draft.features, draft.sharedFacilities, draft.garden, draft.pool, draft.balcony,
  ]);
}
export function suggestOwnerTitles(draft) {
  const category = draft.selection.propertyCategory;
  const apartment = category === 'apartment';
  const subtype = apartment ? APARTMENT_TYPES.find(([id]) => id === draft.apartmentType)?.[1] : undefined;
  if (apartment) {
    const type = ({ Studio: 'Studio Apartment', Duplex: 'Duplex', Penthouse: 'Penthouse' })[subtype] || 'Apartment';
    const bedrooms = subtype !== 'Studio' && /^\d+$/.test(text(draft.bedrooms)) && Number.isSafeInteger(Number(draft.bedrooms)) && Number(draft.bedrooms) > 0 ? `${Number(draft.bedrooms)}-Bedroom ` : '';
    const project = draft.publicBuildingName && text(draft.building) ? `${text(draft.building)} – ` : '';
    // There is one factual title in this exact format; don't invent or duplicate variants.
    return [`${project}${bedrooms}${type}`];
  }
  const propertyType = apartment ? ({ Studio: 'Studio', Duplex: 'Duplex', Penthouse: 'Penthouse' }[subtype] || 'Apartment') : category === 'villa' ? 'Villa' : 'House';
  // A studio is presented as a studio, never as a contradictory bedroom count.
  const bedrooms = subtype !== 'Studio' && /^\d+$/.test(text(draft.bedrooms)) && Number.isSafeInteger(Number(draft.bedrooms)) && Number(draft.bedrooms) > 0 ? `${Number(draft.bedrooms)}-bedroom ` : '';
  const base = `${bedrooms}${propertyType}`;
  // A generated public title must respect the owner's chosen location precision.
  const location = draft.locationPrecision === 'district' ? text(draft.district) : text(draft.city) || text(draft.district);
  const building = apartment && draft.locationPrecision === 'exact' ? text(draft.building) : '';
  const purpose = draft.selection.listingPurpose === 'rent' ? 'For rent' : 'For sale';
  const features = [...new Set([
    ...(draft.features || []).map(text),
    ...(apartment ? [...(draft.sharedFacilities || []).map(text), draft.balcony ? 'balcony' : ''] : [draft.garden ? 'garden' : '', draft.pool ? 'private pool' : '']),
  ].filter(Boolean))];
  const featureOrder = ['private pool', 'garden', 'balcony', 'shared pool', 'terrace', 'outdoor dining area', 'gym', 'solar power', 'backup power', '24-hour security', 'air conditioning', 'lift access', 'wheelchair access', 'private driveway', 'internet connection'];
  const rank = feature => { const index = featureOrder.indexOf(feature.toLowerCase()); return index < 0 ? featureOrder.length : index; };
  features.sort((a, b) => rank(a) - rank(b));
  const naturalFeature = feature => {
    if (!feature) return '';
    const lower = feature.toLowerCase();
    return ['private pool', 'garden', 'balcony', 'shared pool', 'terrace', 'gym', 'private driveway'].includes(lower) ? `a ${lower}` : featureOrder.includes(lower) ? lower : feature;
  };
  // Keep entire facts intact: omit an overlong optional phrase rather than truncate a name.
  const limit = 96;
  const append = (headline, phrase) => phrase && headline.length + phrase.length <= limit ? headline + phrase : headline;
  const place = headline => {
    const choices = [building && location ? ` at ${building} in ${location}` : '', building ? ` at ${building}` : '', location ? ` in ${location}` : ''].filter(Boolean);
    return headline + (choices.find(phrase => headline.length + phrase.length <= limit) || '');
  };
  const creativeName = apartment && draft.locationPrecision !== 'district' && text(draft.city) ? 'City Retreat' : category === 'villa' ? 'Everyday Retreat' : 'The Home Edit';
  const article = /^[aeiou]/i.test(propertyType) ? 'An' : 'A';
  const first = place(`${creativeName}: ${article} ${propertyType}`);
  let second = append(base, features[0] ? ` with ${naturalFeature(features[0])}` : '');
  second = append(second, location ? ` in ${location}` : ` ${purpose.toLowerCase()}`);
  let third = place(`A New Chapter: ${propertyType} Living`);
  third = append(third, features[1] ? ` with ${naturalFeature(features[1])}` : '');
  return [
    first,
    second,
    third,
  ];
}
