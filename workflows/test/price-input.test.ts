import { test } from 'node:test';
import assert from 'node:assert/strict';
const prices = await import(new URL('../website/price-input.js', import.meta.url).href);
const model = await import(new URL('../website/owner-listing-model.js', import.meta.url).href);

test('asking prices group every three digits and preserve entered decimals and trailing decimal points', () => {
  for (const [raw, display] of [['75000000', '75,000,000'], ['2000000000', '2,000,000,000'], ['75000000.50', '75,000,000.50'], ['1200.', '1,200.'], ['', ''], ['.05', '.05']]) assert.equal(prices.formatPriceInput(raw), display);
  assert.equal(prices.priceSummary('75000000', 'LKR'), 'LKR 75 million');
  assert.equal(prices.priceSummary('2000000000', 'LKR'), 'LKR 2 billion · 2,000 million');
  assert.equal(prices.priceSummary('2500000000', 'USD'), 'USD 2.5 billion · 2,500 million');
  assert.equal(prices.priceSummary('75000000.50', 'LKR'), 'LKR 75.0000005 million');
  assert.equal(prices.priceSummary('75000.50', 'LKR'), 'LKR 75,000.5');
});
test('mid-number edits, ranges, grouping boundaries and deletions preserve logical cursor positions', () => {
  const inserted = prices.formatPriceEdit('751,000,000.50', 3);
  assert.equal(inserted.raw, '751000000.50'); assert.equal(inserted.display, '751,000,000.50'); assert.equal(inserted.start, 3);
  const expanded = prices.formatPriceEdit('75000000.50', 4, 7);
  assert.equal(expanded.display, '75,000,000.50'); assert.equal(expanded.start, 5); assert.equal(expanded.end, 9);
  assert.equal(prices.deletePriceSeparator('1,234', 2, 'Backspace').raw, '234');
  assert.equal(prices.deletePriceSeparator('1,234', 1, 'Delete').raw, '134');
  assert.equal(prices.formatPriceEdit('-7500', 5), null); assert.equal(prices.formatPriceEdit('75.5.0', 6), null);
});
test('draft persistence stores a comma-free numeric price while restoring exact editable decimal text', () => {
  let record = '';
  const storage = { setItem: (_key: string, value: string) => { record = value; }, getItem: () => record };
  const d = model.createOwnerDraft({ listingRole: 'owner', listingPurpose: 'buy', propertyCategory: 'apartment' });
  for (const raw of ['75000000.50', '2000000000', '1200.', '.']) {
    d.price = raw; model.saveOwnerDraft(storage, d);
    const stored = JSON.parse(record);
    assert.equal(typeof stored.draft.priceInput, 'string'); assert.equal(stored.draft.priceInput, raw);
    if (raw !== '.') { assert.equal(typeof stored.draft.price, 'number'); assert.equal(stored.draft.price, Number(raw)); }
    assert.equal(model.loadOwnerDraft(storage).draft.price, raw);
  }
});
