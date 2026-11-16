import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const { COUNTRY_CODES } = await import(new URL('../website/country-calling-codes.js', import.meta.url).href);
const { createCountryCodePicker } = await import(new URL('../website/country-code-picker.js', import.meta.url).href);
const model = await import(new URL('../website/owner-listing-model.js', import.meta.url).href);

test('every country has a valid calling code, distinct country identifier and locally bundled flag', () => {
  assert.equal(COUNTRY_CODES.length, 245);
  assert.equal(new Set(COUNTRY_CODES.map((country: any) => country.iso)).size, COUNTRY_CODES.length);
  for (const country of COUNTRY_CODES) {
    assert.match(country.code, /^\+[1-9]\d{0,2}$/);
    assert.ok(country.name);
    assert.ok(existsSync(new URL('../website/' + country.flag.slice(2), import.meta.url)), country.iso);
  }
  assert.equal(COUNTRY_CODES.find((c: any) => c.iso === 'LK').code, '+94');
  assert.equal(COUNTRY_CODES.find((c: any) => c.iso === 'US').code, '+1');
  assert.equal(COUNTRY_CODES.find((c: any) => c.iso === 'CA').code, '+1');
});

test('search, shared calling codes, keyboard choice, flags and manual selection work independently of the phone number', () => {
  let cursor = 0, selected: any;
  const state: any[] = [];
  const React = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (initial: any) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useRef: (initial: any) => { const index = cursor++; return state[index] ||= { current: initial }; }, useEffect() {},
  };
  const Picker = createCountryCodePicker(React);
  function nodes() {
    cursor = 0; const output: any[] = [];
    function visit(node: any) { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === 'object') { output.push(node); visit(node.props?.children); } }
    visit(Picker({ country: 'LK', code: '+94', onSelect: (iso: string, code: string) => { selected = { iso, code }; } })); return output;
  }
  const open = () => nodes().find(n => n.type === 'button').props.onClick();
  open();
  assert.equal(nodes().filter(n => n.props?.role === 'option').length, 246);
  nodes().find(n => n.props?.role === 'combobox').props.onChange({ target: { value: 'Canada' } });
  const canada = nodes().find(n => n.props?.role === 'option' && n.props.id === 'dh-country-CA');
  assert.ok(canada); assert.ok(nodes().some(n => n.type === 'img' && n.props.src.endsWith('/ca.svg')));
  nodes().find(n => n.props?.role === 'combobox').props.onKeyDown({ key: 'Enter', preventDefault() {} });
  assert.deepEqual(selected, { iso: 'CA', code: '+1' });
  open(); nodes().find(n => n.props?.role === 'combobox').props.onChange({ target: { value: '+971' } });
  assert.ok(nodes().some(n => n.props?.id === 'dh-country-AE'));
  nodes().find(n => n.props?.id === 'dh-country-manual').props.onClick();
  assert.deepEqual(selected, { iso: 'manual', code: '+94' });
});

test('drafts retain the chosen country when two countries share a calling code', () => {
  const d = model.createOwnerDraft({ listingRole: 'owner', listingPurpose: 'buy', propertyCategory: 'villa' });
  Object.assign(d, { phoneCountry: 'CA', countryCode: '+1', phoneNumber: '4165550123', phone: '+14165550123' });
  let stored = '';
  const storage = { setItem: (_key: string, value: string) => { stored = value; }, getItem: () => stored };
  model.saveOwnerDraft(storage, d);
  const result = model.loadOwnerDraft(storage).draft;
  assert.equal(result.phoneCountry, 'CA'); assert.equal(result.phone, '+14165550123');
});
