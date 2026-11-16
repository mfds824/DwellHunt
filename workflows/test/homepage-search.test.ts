import { test } from 'node:test';
import assert from 'node:assert/strict';
const { budgetValue, budgetError, selectedBudgetPreset, budgetSummary, filterHomeListings, sortHomeListings, comparisonPriceLKR } = await import(new URL('../website/homepage-search.js', import.meta.url).href);
const { createHomepage } = await import(new URL('../website/homepage.js', import.meta.url).href);
const filters = { purpose: 'buy', category: 'all', location: '', bedrooms: 'any', minPrice: '', maxPrice: '', savedOnly: false };
const listings = [
  { id: 'a', country: 'Sri Lanka', purpose: 'buy', category: 'apartment', city: 'Colombo', bedrooms: 3, price: 75000000, createdAt: '2026-01-01', featured: true },
  { id: 'b', country: 'Sri Lanka', purpose: 'buy', category: 'villa', city: 'Galle', bedrooms: 2, price: 25000000, createdAt: '2026-02-01', featured: true },
  { id: 'c', country: 'Sri Lanka', purpose: 'rent', category: 'apartment', city: 'Colombo', bedrooms: 2, price: 450000 },
];
test('budget units, presets, editable matches and empty limits are consistent', () => {
  assert.equal(budgetValue('25.5', 'buy'), 25500000); assert.equal(budgetValue('250', 'rent'), 250000);
  assert.equal(budgetValue('', 'buy'), null);
  assert.equal(selectedBudgetPreset('25.0', '50', 'buy'), '25to50');
  assert.equal(selectedBudgetPreset('30', '50', 'buy'), ''); assert.equal(selectedBudgetPreset('', '', 'buy'), '');
  assert.equal(selectedBudgetPreset('250', '500', 'rent'), '250to500');
  assert.match(budgetSummary('', '', 'buy'), /Any minimum.*No maximum/);
  assert.match(budgetSummary('250', '500', 'rent'), /250,000.*500,000.*month/);
  assert.match(budgetError('51', '50', 'buy'), /must not exceed/); assert.ok(budgetError('-1', '', 'buy'));
  assert.equal(budgetError('50', '50', 'buy'), '');
});
test('matching counts apply all filters and include explicit budget boundaries', () => {
  assert.equal(filterHomeListings(listings, filters).length, 2);
  assert.equal(filterHomeListings(listings, { ...filters, maxPrice: '25' }).length, 0);
  assert.deepEqual(filterHomeListings(listings, { ...filters, minPrice: '25', maxPrice: '50' }).map((p:any) => p.id), ['b']);
  assert.equal(filterHomeListings(listings, { ...filters, minPrice: '60', maxPrice: '50' }).length, 0);
  assert.deepEqual(filterHomeListings(listings, { ...filters, savedOnly: true }, (id:string) => id === 'b').map((p:any) => p.id), ['b']);
  assert.equal(filterHomeListings(listings, { ...filters, category: 'apartment', location: 'Galle' }).length, 0);
  assert.equal(filterHomeListings(listings, { ...filters, purpose: 'rent', minPrice: '250', maxPrice: '500' }).length, 1);
});
test('rental prices compare in LKR per month; sorting does not mutate filters or inventory', () => {
  const rentals = [
    { id: 'month', purpose: 'rent', price: 450000 }, { id: 'year', purpose: 'rent', price: 2400000, billingPeriod: 'year' },
    { id: 'week', purpose: 'rent', price: 60000, billingPeriod: 'week' }, { id: 'night', purpose: 'rent', price: 10000, billingPeriod: 'night' },
    { id: 'unknown', purpose: 'rent', price: 10, billingPeriod: 'stay' }, { id: 'foreign', purpose: 'rent', price: 5, currency: 'USD' },
  ];
  assert.equal(comparisonPriceLKR(rentals[1]), 200000); assert.equal(comparisonPriceLKR(rentals[4]), null); assert.equal(comparisonPriceLKR(rentals[5]), null);
  assert.deepEqual(sortHomeListings(rentals, 'price_asc').map((p:any) => p.id), ['year', 'week', 'night', 'month', 'unknown', 'foreign']);
  assert.deepEqual(sortHomeListings(rentals, 'price_desc').map((p:any) => p.id), ['month', 'night', 'week', 'year', 'unknown', 'foreign']);
  assert.equal(rentals[0].id, 'month');
  assert.deepEqual(sortHomeListings(listings.slice(0, 2), 'newest').map((p:any) => p.id), ['b', 'a']);
});
function homeHarness() {
  const state:any[] = []; let cursor = 0;
  const React = { createElement: (type:any, props:any, ...children:any[]) => ({ type, props: props || {}, children: children.flat(Infinity).filter(v => v !== null && v !== false && v !== undefined) }),
    useState: (initial:any) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value:any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; }, useEffect: () => {} };
  const store = { properties: listings, isPropertySaved: () => false, comparePropertyIds: [], savedPropertyIds: [], currency: 'LKR' };
  const { Home } = createHomepage(React, () => store, {}, () => null, () => 'price');
  let tree:any;
  const render = () => { cursor = 0; tree = Home(); };
  const nodes = (node:any = tree):any[] => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap((child:any) => nodes(child))];
  return { render, nodes, byId: (id:string) => nodes().find(n => n.props.id === id), button: (label:string) => nodes().find(n => n.type === 'button' && n.children.includes(label)), results: () => nodes().find(n => n.props.id === 'dh-sort') };
}
test('homepage preset edits, reset, validation, counts and sorting retain independent filters', () => {
  const ui = homeHarness(); ui.render(); ui.button('25–50M').props.onClick(); ui.render();
  assert.equal(ui.byId('dh-min-price').props.value, '25'); assert.equal(ui.byId('dh-max-price').props.value, '50'); assert.equal(ui.button('25–50M').props['aria-pressed'], true);
  ui.byId('dh-min-price').props.onChange({ target: { value: '30' } }); ui.render(); assert.equal(ui.button('25–50M').props['aria-pressed'], false);
  ui.byId('dh-min-price').props.onChange({ target: { value: '60' } }); ui.render(); assert.equal(ui.button('Explore listings').props.disabled, true); assert.ok(ui.byId('dh-budget-error'));
  ui.button('Reset').props.onClick(); ui.render(); assert.equal(ui.byId('dh-min-price').props.value, ''); assert.equal(ui.byId('dh-max-price').props.value, ''); assert.equal(ui.results().props.count, 1);
  ui.byId('dh-type').props.onChange({ target: { value: 'all' } }); ui.render(); assert.equal(ui.results().props.count, 2);
  ui.results().props.onSort('price_asc'); ui.render(); assert.equal(ui.results().props.sortBy, 'price_asc'); assert.equal(ui.byId('dh-type').props.value, 'all');
  ui.button('Rent').props.onClick(); ui.render(); ui.button('250–500k').props.onClick(); ui.render(); assert.equal(ui.results().props.count, 1); assert.equal(ui.byId('dh-min-price').props.value, '250');
  ui.button('Buy').props.onClick(); ui.render(); assert.equal(ui.byId('dh-min-price').props.value, '');
  assert.equal(ui.nodes().filter(n => n.props.type === 'range').length, 0); assert.equal(ui.nodes().filter(n => n.props.className === 'dh-layout-toggle').length, 0);
});

test('location search accepts Colombo zone spellings, area names and suggestion labels', async () => {
  const { normalizeLocation, locationQuery, locationSuggestions, matchesLocation, COLOMBO_AREAS } = await import(new URL('../website/homepage-search.js', import.meta.url).href);
  assert.equal(COLOMBO_AREAS.length, 15);
  for (const text of ['Colombo 7', 'colombo-07', 'Col 7', 'COLOMBO 07 (Cinnamon Gardens)']) assert.equal(normalizeLocation(text), 'colombo 07');
  assert.equal(normalizeLocation('Colombo 15'), 'colombo 15');
  assert.equal(locationQuery('Colombo 03 (Kollupitiya)'), 'Colombo 03');
  const suggestions = locationSuggestions(['Galle', 'Colombo 03', 'Kandy']);
  assert.equal(suggestions[0], 'Colombo 01 (Fort)');
  assert.equal(suggestions[14], 'Colombo 15 (Mattakkuliya)');
  assert.deepEqual(suggestions.slice(15), ['Galle', 'Kandy']);
  const homes = [
    { city: 'Colombo 07', district: 'Colombo', address: 'Cinnamon Gardens', title: 'Villa' },
    { city: 'Colombo 03', district: 'Colombo', address: 'Galle Road', title: 'Flat' },
    { city: 'Galle', district: 'Galle', address: 'Lighthouse Street', title: 'House' },
  ];
  const cities = homes.map(p => p.city);
  const find = (q: string) => homes.filter(p => matchesLocation(p, q, cities)).map(p => p.city);
  assert.deepEqual(find('colombo 7'), ['Colombo 07']);
  assert.deepEqual(find('Kollupitiya'), ['Colombo 03']);
  assert.deepEqual(find('Galle'), ['Galle']);
  assert.deepEqual(find('colombo'), ['Colombo 07', 'Colombo 03']);
  assert.deepEqual(find(''), ['Colombo 07', 'Colombo 03', 'Galle']);
});
