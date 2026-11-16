import { COUNTRY_CODES } from './country-calling-codes.js';

export function createCountryCodePicker(React) {
  const h = React.createElement;
  return function CountryCodePicker({ country, code, onSelect, error, idPrefix = 'dh-owner', label = 'Country code', searchLabel = 'Search country or calling code' }) {
    const optionPrefix = idPrefix === 'dh-owner' ? 'dh-country' : `${idPrefix}-country`;
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [active, setActive] = React.useState(0);
    const trigger = React.useRef(null), search = React.useRef(null), list = React.useRef(null);
    const selected = COUNTRY_CODES.find(item => item.iso === country && item.code === code);
    const term = query.trim().toLocaleLowerCase();
    const matches = COUNTRY_CODES.filter(item => !term || `${item.name} ${item.code} ${item.iso}`.toLocaleLowerCase().includes(term));
    const options = [...matches, { iso: 'manual', name: 'Enter a country code manually', code: '' }];
    const choose = item => {
      onSelect(item.iso, item.iso === 'manual' ? code : item.code);
      setOpen(false); setQuery(''); setActive(0); trigger.current?.focus();
    };
    React.useEffect(() => { if (open) search.current?.focus(); }, [open]);
    React.useEffect(() => { if (open) list.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
    const keyDown = event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); const direction = event.key === 'ArrowDown' ? 1 : -1;
        setActive(index => (index + direction + options.length) % options.length);
      } else if (event.key === 'Home' && event.ctrlKey) { event.preventDefault(); setActive(0); }
      else if (event.key === 'End' && event.ctrlKey) { event.preventDefault(); setActive(options.length - 1); }
      else if (event.key === 'Enter') { event.preventDefault(); choose(options[active] || options[0]); }
      else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    return h('div', { className: 'dh-country-picker dh-owner-field', onBlur: event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    } },
      h('label', { id: `${idPrefix}-country-label`, htmlFor: `${idPrefix}-country-picker`, className: 'block text-xs font-bold text-stone-700 mb-2' }, `${label} (required)`),
      h('button', {
        id: `${idPrefix}-country-picker`, ref: trigger, type: 'button', className: 'dh-country-trigger',
        'aria-labelledby': `${idPrefix}-country-label ${idPrefix}-country-value`, 'aria-haspopup': 'listbox', 'aria-expanded': open,
        'aria-controls': `${idPrefix}-country-list`, 'aria-invalid': !!error,
        'aria-describedby': error ? `${idPrefix}-country-error` : `${idPrefix}-country-hint`,
        onClick: () => { setOpen(value => !value); setQuery(''); setActive(0); },
        onKeyDown: event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); setActive(0); } },
      }, selected && h('img', { src: selected.flag, alt: '', className: 'dh-country-flag' }),
      h('span', { id: `${idPrefix}-country-value`, 'aria-label': selected ? `${selected.name} ${code}` : `Manual country code ${code}` }, code || 'Other'),
      h('span', { 'aria-hidden': true, className: 'dh-country-chevron' }, '▾')),
      open && h('div', { className: 'dh-country-popover' },
        h('input', {
          ref: search, type: 'search', role: 'combobox', value: query, placeholder: 'Search country or code',
          className: 'dh-country-search', 'aria-label': searchLabel, 'aria-expanded': true,
          'aria-autocomplete': 'list', 'aria-controls': `${idPrefix}-country-list`, 'aria-activedescendant': `${optionPrefix}-${options[active]?.iso || 'manual'}`,
          onChange: event => { setQuery(event.target.value); setActive(0); }, onKeyDown: keyDown,
        }),
        h('div', { ref: list, id: `${idPrefix}-country-list`, role: 'listbox', 'aria-label': 'Country calling codes', className: 'dh-country-list' },
          options.map((item, index) => h('div', {
            id: `${optionPrefix}-${item.iso}`, key: item.iso, role: 'option', 'aria-selected': country === item.iso,
            'data-option-index': index, className: `dh-country-option${index === active ? ' dh-country-option-active' : ''}`,
            onMouseDown: event => event.preventDefault(), onClick: () => choose(item), onMouseMove: () => setActive(index),
          }, item.flag && h('img', { src: item.flag, alt: '', className: 'dh-country-flag', loading: 'lazy' }),
          h('span', { className: 'dh-country-name' }, item.name), h('span', { className: 'dh-country-code' }, item.code)))),
        h('p', { role: 'status', className: 'dh-owner-hint' }, `${matches.length} ${matches.length === 1 ? 'country' : 'countries'} found`)),
      h('p', { id: `${idPrefix}-country-hint`, className: 'dh-owner-hint' }, 'Choose your country or enter a code manually.'),
      error && h('p', { id: `${idPrefix}-country-error`, className: 'dh-owner-error' }, error));
  };
}
