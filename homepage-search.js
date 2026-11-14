export const SORT_OPTIONS = [['newest', 'Newest listings'], ['price_asc', 'Price: Low to high'], ['price_desc', 'Price: High to low']];
export const SALE_BUDGETS = [
  { id: 'under25', label: 'Under 25M', min: '', max: '25' },
  { id: '25to50', label: '25–50M', min: '25', max: '50' },
  { id: '50to100', label: '50–100M', min: '50', max: '100' },
  { id: '100plus', label: '100M+', min: '100', max: '' },
];
export const RENT_BUDGETS = [
  { id: 'under100', label: 'Under 100k', min: '', max: '100' },
  { id: '100to250', label: '100–250k', min: '100', max: '250' },
  { id: '250to500', label: '250–500k', min: '250', max: '500' },
  { id: '500plus', label: '500k+', min: '500', max: '' },
];
export const budgetPresets = purpose => purpose === 'rent' ? RENT_BUDGETS : SALE_BUDGETS;
export const budgetScale = purpose => purpose === 'rent' ? 1000 : 1000000;
export const budgetValue = (value, purpose) => value === '' ? null : Number(value) * budgetScale(purpose);
export function budgetError(minimum, maximum, purpose) {
  const min = budgetValue(minimum, purpose), max = budgetValue(maximum, purpose);
  if ([min, max].some(value => value !== null && (!Number.isFinite(value) || value < 0))) return 'Enter a budget of zero or more.';
  if (min !== null && max !== null && min > max) return 'Minimum budget must not exceed maximum budget.';
  return '';
}
export function selectedBudgetPreset(minimum, maximum, purpose) {
  const same = (a, b) => a === '' || b === '' ? a === b : Number(a) === Number(b);
  return budgetPresets(purpose).find(preset => same(preset.min, minimum) && same(preset.max, maximum))?.id || '';
}
export function budgetSummary(minimum, maximum, purpose) {
  const number = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 8 });
  const amount = value => purpose === 'rent' ? `LKR ${number(Number(value) * 1000)}` : `LKR ${number(value)} million`;
  return `${minimum === '' ? 'Any minimum' : amount(minimum)} – ${maximum === '' ? 'No maximum' : amount(maximum)}${purpose === 'rent' ? ' / month' : ''}`;
}
export function rentalPeriod(p) {
  // The original inventory stores monthly rent without a separate period field.
  return p.billingPeriod || 'month';
}
export function comparisonPriceLKR(p) {
  const foreign = p.currency && p.currency !== 'LKR';
  if (foreign && (p.priceLKR == null || p.priceLKR === '')) return null;
  const price = foreign ? Number(p.priceLKR) : Number(p.price);
  if (!Number.isFinite(price) || price < 0 || p.price === '' || p.price == null) return null;
  if (p.purpose !== 'rent') return price;
  const factor = { month: 1, monthly: 1, year: 1 / 12, yearly: 1 / 12, week: 52 / 12, weekly: 52 / 12, night: 365 / 12, nightly: 365 / 12, day: 365 / 12, daily: 365 / 12 }[rentalPeriod(p)];
  return factor ? price * factor : null;
}
// Colombo postal zones, offered as search suggestions even before listings exist there.
export const COLOMBO_AREAS = [
  ['01', 'Fort'], ['02', 'Slave Island'], ['03', 'Kollupitiya'], ['04', 'Bambalapitiya'], ['05', 'Havelock Town'],
  ['06', 'Wellawatte'], ['07', 'Cinnamon Gardens'], ['08', 'Borella'], ['09', 'Dematagoda'], ['10', 'Maradana'],
  ['11', 'Pettah'], ['12', 'Hulftsdorp'], ['13', 'Kotahena'], ['14', 'Grandpass'], ['15', 'Mattakkuliya'],
].map(([zone, area]) => ({ zone: `Colombo ${zone}`, area, label: `Colombo ${zone} (${area})` }));
/** Lower-cases, drops "(area)" notes and punctuation, and writes "Colombo 7", "col 7" or "Colombo-07" as "colombo 07". */
export function normalizeLocation(text) {
  return String(text || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:colombo|col|cmb)\s*0?(1[0-5]|[1-9])\b/g, (_, n) => `colombo ${n.padStart(2, '0')}`)
    .replace(/\s+/g, ' ').trim();
}
/** The text to keep after a suggestion is chosen: "Colombo 07 (Cinnamon Gardens)" becomes "Colombo 07". */
export const locationQuery = text => String(text || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
/** Suggestions: every Colombo zone plus the other places that have listings. */
export function locationSuggestions(cities) {
  const zones = new Set(COLOMBO_AREAS.map(a => normalizeLocation(a.zone)));
  const others = [...new Set(cities.filter(Boolean))].filter(city => !zones.has(normalizeLocation(city))).sort();
  return [...COLOMBO_AREAS.map(a => a.label), ...others];
}
export function matchesLocation(p, query, cities = []) {
  const q = normalizeLocation(query);
  if (!q) return true;
  // A full place name that has listings (e.g. "Galle") matches that city only, not "Galle Road" addresses.
  if (cities.some(city => normalizeLocation(city) === q)) return normalizeLocation(p.city) === q;
  const area = COLOMBO_AREAS.find(a => normalizeLocation(a.area) === q);
  const text = normalizeLocation([p.city, p.district, p.address, p.title].filter(Boolean).join(' | '));
  return text.includes(q) || (!!area && text.includes(normalizeLocation(area.zone)));
}
export function filterHomeListings(properties, filters, isSaved = () => false) {
  if (budgetError(filters.minPrice, filters.maxPrice, filters.purpose)) return [];
  const min = budgetValue(filters.minPrice, filters.purpose), max = budgetValue(filters.maxPrice, filters.purpose);
  const under = selectedBudgetPreset(filters.minPrice, filters.maxPrice, filters.purpose).startsWith('under');
  const cities = [...new Set(properties.map(p => p.city).filter(Boolean))];
  return properties.filter(p => {
    const price = comparisonPriceLKR(p);
    return p.purpose === filters.purpose &&
      (filters.category === 'all' || p.category === filters.category) &&
      (!filters.savedOnly || isSaved(p.id)) && matchesLocation(p, filters.location, cities) &&
      (filters.bedrooms === 'any' || Number(p.bedrooms) >= Number(filters.bedrooms)) &&
      (min === null || price !== null && price >= min) && (max === null || price !== null && (under ? price < max : price <= max));
  });
}
const created = p => { const value = Date.parse(p.createdAt || p.updatedAt || ''); return Number.isFinite(value) ? value : 0; };
export function sortHomeListings(properties, sortBy) {
  return [...properties].sort((a, b) => {
    if (sortBy === 'newest') return created(b) - created(a);
    const left = comparisonPriceLKR(a), right = comparisonPriceLKR(b);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return sortBy === 'price_desc' ? right - left : left - right;
  });
}
