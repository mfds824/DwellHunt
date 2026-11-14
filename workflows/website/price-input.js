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
export function priceSummary(raw, currency) {
  if (!/^\d*(?:\.\d*)?$/.test(String(raw)) || !/\d/.test(raw)) return 'Enter an amount to see its value.';
  const integer = BigInt(raw.split('.')[0] || '0');
  if (integer >= 1000000000n) return `${currency} ${divided(raw, 9)} billion · ${divided(raw, 6)} million`;
  if (integer >= 1000000n) return `${currency} ${divided(raw, 6)} million`;
  return `${currency} ${divided(raw, 0)}`;
}
export function createPriceInput(React) {
  const h = React.createElement;
  return function PriceInput({ value, onChange, currency, label, error, className }) {
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
      h('label', { htmlFor: 'dh-owner-price', className: 'block text-xs font-bold text-stone-700 mb-2' }, `${label} (required)`),
      h('input', { ref: input, id: 'dh-owner-price', name: 'price', type: 'text', inputMode: 'decimal', value: formatPriceInput(value), className, required: true,
        'aria-invalid': !!error, 'aria-describedby': `dh-owner-price-summary${error ? ' dh-owner-price-error' : ''}`,
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
      h('p', { id: 'dh-owner-price-summary', className: 'dh-owner-hint dh-owner-price-summary', role: 'status', 'aria-live': 'polite' }, priceSummary(value, currency)),
      error && h('p', { id: 'dh-owner-price-error', className: 'dh-owner-error' }, error));
  };
}
