export function formatPriceInput(raw) {
  const [whole, fraction] = String(raw ?? '').split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
}
const significantCount = text => (text.match(/[\d.]/g) || []).length;
function cursorAfter(display, count) {
  if (!count) return 0;
  let seen = 0;
  for (let index = 0; index < display.length; index++) if (/[\d.]/.test(display[index]) && ++seen === count) return index + 1;
  return display.length;
}
export function formatPriceEdit(text, start, end = start) {
  const raw = text.replace(/[,\s]/g, '');
  if (!/^\d*(?:\.\d*)?$/.test(raw)) return null;
  const display = formatPriceInput(raw);
  return { raw, display, start: cursorAfter(display, significantCount(text.slice(0, start))), end: cursorAfter(display, significantCount(text.slice(0, end))) };
}
export function deletePriceSeparator(display, position, key) {
  if (key === 'Backspace' && display[position - 1] === ',' && position > 1) {
    const text = display.slice(0, position - 2) + display.slice(position - 1);
    return formatPriceEdit(text, position - 2);
  }
  if (key === 'Delete' && display[position] === ',' && position + 1 < display.length) {
    const text = display.slice(0, position + 1) + display.slice(position + 2);
    return formatPriceEdit(text, position);
  }
  return null;
}
// Decimal-string arithmetic preserves the entered precision in the live summary.
function divided(raw, places) {
  const [whole = '', fraction = ''] = raw.split('.');
  const digits = (whole || '0') + fraction;
  const point = (whole || '0').length - places;
  const result = point <= 0 ? '0.' + '0'.repeat(-point) + digits : digits.slice(0, point) + '.' + digits.slice(point);
  const [integer, decimals = ''] = result.split('.');
  const trimmed = decimals.replace(/0+$/, '');
  return formatPriceInput(integer.replace(/^0+(?=\d)/, '') + (trimmed ? '.' + trimmed : ''));
}
// The amount in words, as Sri Lankans say prices: lakhs below one million ("One lakh fifty thousand rupees"), then
// millions with any lakhs left over ("One million rupees", "Twenty-five million five lakh rupees"). Other currencies use ordinary English words. Cents are left out.
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function upTo999(n) {
  const hundred = Math.floor(n / 100), rest = n % 100;
  const tail = rest < 20 ? ONES[rest] : TENS[Math.floor(rest / 10)] + (rest % 10 ? '-' + ONES[rest % 10] : '');
  return [hundred ? ONES[hundred] + ' hundred' : '', tail].filter(Boolean).join(' ');
}
function english(n) { // up to 999,999,999,999
  const out = [];
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) if (n >= size) { out.push(upTo999(Math.floor(n / size)) + ' ' + name); n %= size; }
  if (n) out.push(upTo999(n));
  return out.join(' ');
}
function lakhs(n) { // below one million
  const lakh = Math.floor(n / 100000), thousand = Math.floor((n % 100000) / 1000), rest = n % 1000;
  return [lakh ? upTo999(lakh) + ' lakh' : '', thousand ? upTo999(thousand) + ' thousand' : '', rest ? upTo999(rest) : ''].filter(Boolean).join(' ');
}
const CURRENCY_WORDS = { LKR: 'rupees', USD: 'US dollars', GBP: 'pounds', AED: 'dirhams' };
export function priceInWords(raw, currency = 'LKR') {
  const n = Math.floor(Number(String(raw ?? '').replace(/[,\s]/g, '')));
  if (!Number.isFinite(n) || n <= 0 || n >= 1e12) return '';
  const text = currency !== 'LKR' ? english(n) : n < 1e6 ? lakhs(n) : english(Math.floor(n / 1e6)) + ' million' + (n % 1e6 ? ' ' + lakhs(n % 1e6) : '');
  return text.charAt(0).toUpperCase() + text.slice(1) + ' ' + (CURRENCY_WORDS[currency] || currency);
}
export function priceSummary(raw, currency) {
  if (!/^\d*(?:\.\d*)?$/.test(String(raw)) || !/\d/.test(raw)) return 'Enter an amount to see its value.';
  const integer = BigInt(raw.split('.')[0] || '0');
  const words = priceInWords(raw, currency), said = words ? ' · ' + words : '';
  if (integer >= 1000000000n) return `${currency} ${divided(raw, 9)} billion · ${divided(raw, 6)} million` + said;
  if (integer >= 1000000n) return `${currency} ${divided(raw, 6)} million` + said;
  return `${currency} ${divided(raw, 0)}` + said;
}
export function createPriceInput(React) {
  const h = React.createElement;
  // id / name let one form use several price boxes (sale price, rent, nightly rate, deposit).
  return function PriceInput({ value, onChange, currency, label, error, className, id = 'dh-owner-price', name = 'price', required = true, hint }) {
    const input = React.useRef(null), cursor = React.useRef(null);
    React.useLayoutEffect(() => {
      if (cursor.current && input.current === document.activeElement) input.current.setSelectionRange(cursor.current.start, cursor.current.end);
      cursor.current = null;
    });
    const apply = (element, edit) => {
      if (!edit) return;
      cursor.current = { start: edit.start, end: edit.end };
      element.value = edit.display;
      element.setSelectionRange(edit.start, edit.end);
      onChange(edit.raw);
    };
    return h('div', { className: 'dh-owner-field' },
      h('label', { htmlFor: id, className: 'block text-xs font-bold text-stone-700 mb-2' }, required ? `${label} (required)` : `${label} (optional)`),
      h('input', { ref: input, id, name, type: 'text', inputMode: 'decimal', value: formatPriceInput(value), className, required,
        'aria-invalid': !!error, 'aria-describedby': `${id}-summary${error ? ` ${id}-error` : ''}`,
        onChange: event => {
          const element = event.target;
          const edit = formatPriceEdit(element.value, element.selectionStart, element.selectionEnd);
          if (edit) apply(element, edit);
          else { const position = element.selectionStart; element.value = formatPriceInput(value); element.setSelectionRange(Math.max(0, position - 1), Math.max(0, position - 1)); }
        },
        onKeyDown: event => {
          const element = event.currentTarget;
          if (element.selectionStart !== element.selectionEnd) return;
          const edit = deletePriceSeparator(element.value, element.selectionStart, event.key);
          if (edit) { event.preventDefault(); apply(element, edit); }
        } }),
      h('p', { id: `${id}-summary`, className: 'dh-owner-hint dh-owner-price-summary', role: 'status', 'aria-live': 'polite' }, priceSummary(value, currency)),
      hint && h('p', { className: 'dh-owner-hint' }, hint),
      error && h('p', { id: `${id}-error`, className: 'dh-owner-error' }, error));
  };
}
