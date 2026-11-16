import { MAP_SETUP_BLOCKER, NEARBY_CATEGORIES, validPosition, publicPosition, locationKey, updatePrivateLocation, confirmPrivateLocation, mapsConnection, requestMapService, normalizePlaces, ownerTileOptions } from './listing-location.js';

export function createOwnerLocationPicker(React, L) {
  const h = React.createElement;
  const buttonClass = 'px-5 py-2.5 rounded-xl border border-stone-200 text-xs font-bold text-stone-700 hover:bg-stone-50';
  const control = 'w-full px-4 py-3 rounded-xl bg-stone-50 border border-stone-200 text-sm text-stone-900';
  return function OwnerLocationPicker({ draft: d, onChange }) {
    const [open, setOpen] = React.useState(false), [query, setQuery] = React.useState(''), [suggestions, setSuggestions] = React.useState([]);
    const [status, setStatus] = React.useState(''), [loading, setLoading] = React.useState(false);
    const host = React.useRef(null), map = React.useRef(null), marker = React.useRef(null), placePin = React.useRef(null), current = React.useRef({ draft: d, onChange }), request = React.useRef(null), epoch = React.useRef(0);
    current.current = { draft: d, onChange };
    const connection = mapsConnection(typeof window !== 'undefined' ? window.DWELLHUNT_MAPS || {} : {});
    const button = (label, onClick, rest = {}) => h('button', { type: 'button', className: buttonClass, onClick, ...rest }, label);
    const position = d.privateLocation || { lat: '', lng: '', confirmed: false };
    const move = patch => { request.current?.abort(); epoch.current++; setLoading(false); setStatus('Location changed. Confirm the corrected pin before looking up nearby places.'); onChange(old => updatePrivateLocation(old, patch)); };
    React.useEffect(() => {
      if (!open || !host.current || !L) return;
      const initial = validPosition(current.current.draft.privateLocation) ? current.current.draft.privateLocation : { lat: 7.5, lng: 80.7 };
      const m = L.map(host.current, { scrollWheelZoom: false }).setView([Number(initial.lat), Number(initial.lng)], validPosition(current.current.draft.privateLocation) ? 16 : 7);
      map.current = m;
      const tileOptions = ownerTileOptions();
      const tiles = L.tileLayer(tileOptions.url, { attribution: tileOptions.attribution, maxZoom: 19 });
      tiles.on('tileerror', () => setStatus('Map tiles could not load. You can still enter coordinates manually and keep all form details.')); tiles.addTo(m);
      const icon = L.divIcon({ className: 'dh-property-pin', html: '<span aria-hidden="true">●</span>', iconSize: [30, 30], iconAnchor: [15, 15] });
      const place = point => {
        if (!marker.current) marker.current = L.marker([point.lat, point.lng], { draggable: true, icon, title: 'Property location — drag to correct', keyboard: true }).addTo(m).on('dragend', () => commit(marker.current.getLatLng()));
        else marker.current.setLatLng([point.lat, point.lng]);
      };
      const commit = point => {
        place(point); request.current?.abort(); epoch.current++;
        current.current.onChange(old => updatePrivateLocation(old, { lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)) }));
        setStatus('Pin moved. Confirm this property location to use it.'); setLoading(false);
      };
      placePin.current = place;
      m.on('click', event => commit(event.latlng));
      if (validPosition(current.current.draft.privateLocation)) place(current.current.draft.privateLocation);
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null; observer?.observe(host.current);
      return () => { observer?.disconnect(); m.remove(); map.current = null; marker.current = null; placePin.current = null; };
    }, [open]);
    React.useEffect(() => {
      if (map.current && validPosition(position)) {
        placePin.current?.({ lat: Number(position.lat), lng: Number(position.lng) });
        map.current.panTo([Number(position.lat), Number(position.lng)]);
      }
    }, [position.lat, position.lng]);
    React.useEffect(() => () => { request.current?.abort(); epoch.current++; }, []);
    const run = async nearby => {
      request.current?.abort(); const controller = new AbortController(); request.current = controller; const version = ++epoch.current;
      setLoading(true); setStatus(nearby ? 'Finding nearby essentials…' : 'Searching for addresses…');
      const key = locationKey(d);
      try {
        const body = nearby ? { position: publicPosition(d), categories: NEARBY_CATEGORIES.map(([id]) => id) } : { query: query.trim(), country: 'LK' };
        const data = await requestMapService(nearby ? connection.nearbyUrl : connection.searchUrl, body, { signal: controller.signal });
        if (version !== epoch.current || controller.signal.aborted) return;
        if (nearby) {
          const normalized = normalizePlaces(data.results, publicPosition(d), key, new Date().toISOString(), { persistAllowed: data.persistenceAllowed === true, expiresAt: data.expiresAt });
          onChange(old => locationKey(old) === key ? { ...old, nearby: normalized } : old);
          setStatus(normalized.results.length ? 'Review these sourced places before approving them for display.' : 'No matching place found.');
        } else {
          if (!Array.isArray(data.results)) throw new Error('The address service returned an invalid result.');
          const items = data.results.filter(p => validPosition(p) && typeof p.label === 'string').slice(0, 8);
          setSuggestions(items); setStatus(items.length ? 'Choose a suggestion, correct the pin if needed, then confirm.' : 'No matching place found.');
        }
      } catch (error) { if (!controller.signal.aborted && version === epoch.current) setStatus(error.message || 'Lookup failed. Your entered details are retained.'); }
      finally { if (version === epoch.current) setLoading(false); }
    };
    return h('section', { className: 'dh-owner-location space-y-6', 'aria-label': 'Precise property location' },
      h('h3', { className: 'font-bold text-stone-900' }, 'Property map location'),
      h('p', { className: 'dh-owner-note' }, 'The selected map area is sent to the tile provider when you open the map. Searching sends your address query to the configured map provider. Nearby lookup sends only your chosen public map position. Exact coordinates remain private when you show an approximate area; nearby distances can also reveal location information.'),
      h('label', { className: 'block text-xs font-bold' }, 'Search address or building', h('input', { className: control, value: query, onChange: e => setQuery(e.target.value), placeholder: 'Building or address in Sri Lanka', autoComplete: 'off' })),
      button('Search address', () => run(false), { disabled: !connection.searchUrl || loading || query.trim().length < 3 }),
      (!connection.searchUrl || !connection.nearbyUrl) && h('p', { className: 'dh-owner-hint', role: 'status' }, MAP_SETUP_BLOCKER),
      !!suggestions.length && h('ul', { 'aria-label': 'Address suggestions' }, suggestions.map((p, i) => h('li', { key: i }, button(p.label, () => { move({ lat: Number(p.lat), lng: Number(p.lng) }); setOpen(true); setSuggestions([]); })))),
      !open ? button('Open property map', () => setOpen(true)) : h('div', { ref: host, className: 'dh-owner-pin-map', 'aria-label': 'Property location map — click to place or drag the pin' }),
      h('p', { className: 'dh-owner-hint' }, 'Click or tap the map to place a pin, or drag it to correct the location. Use manual coordinates if the map is unavailable. Search results are never confirmed automatically.'),
      h('details', null, h('summary', { className: 'text-xs font-bold cursor-pointer' }, 'Manual latitude / longitude (optional)'),
        h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4' }, ['lat', 'lng'].map(key => h('label', { key, className: 'text-xs font-bold' }, key === 'lat' ? 'Latitude' : 'Longitude',
          h('input', { type: 'number', step: 'any', min: key === 'lat' ? -90 : -180, max: key === 'lat' ? 90 : 180, className: control, value: position[key], onChange: e => move({ [key]: e.target.value }) }))))),
      button(position.confirmed ? 'Property location confirmed' : 'Confirm this property location', () => { try { onChange(old => confirmPrivateLocation(old)); setStatus('Property location confirmed. Nearby lookups use the public position selected below.'); } catch (error) { setStatus(error.message); } }, { disabled: !validPosition(position) || !!position.confirmed, 'aria-pressed': !!position.confirmed }),
      h('label', { className: 'block text-xs font-bold' }, 'Public map visibility', h('select', { className: control, value: d.locationPrecision === 'exact' ? 'exact' : 'area', onChange: e => { request.current?.abort(); epoch.current++; setLoading(false); onChange(old => ({ ...old, locationPrecision: e.target.value, nearby: null })); setStatus('Public visibility changed. Refresh nearby results from the new public position.'); } },
        h('option', { value: 'area' }, 'Show approximate area'), h('option', { value: 'exact' }, 'Show exact location'))),
      h('p', { className: 'dh-owner-hint' }, d.locationPrecision === 'exact' ? 'Confirmed coordinates and street address will be public. Unit numbers stay private.' : 'The public pin represents an approximate area, not the property. Distances use this approximate public position.'),
      button('Find nearby essentials', () => run(true), { disabled: !position.confirmed || !connection.nearbyUrl || loading }),
      status && h('p', { role: 'status', className: 'dh-owner-note' }, status),
      d.nearby?.key === locationKey(d) && h('div', { className: 'space-y-4' }, NEARBY_CATEGORIES.map(([category, label]) => h('section', { key: category }, h('h4', { className: 'font-bold text-sm' }, label),
        !d.nearby.results.some(p => p.category === category && !p.rejected) && h('p', { className: 'dh-owner-hint' }, 'No matching place found'),
        d.nearby.results.filter(p => p.category === category && !p.rejected).map(p => h('div', { key: p.id, className: 'dh-owner-note' },
          h('p', null, `${p.name} · ${(p.distanceMetres / 1000).toFixed(1)} km straight-line${p.approximate ? ' (approximate)' : ''}`),
          h('p', { className: 'dh-owner-hint' }, `${p.source} · ${p.evidence} · ${d.nearby.updatedAt}`),
          button(p.approved ? 'Approved for public display' : 'Approve this place', () => onChange(old => ({ ...old, nearby: { ...old.nearby, results: old.nearby.results.map(item => item.id === p.id ? { ...item, approved: true } : item) } }))),
          button('Report incorrect match / hide', () => onChange(old => ({ ...old, nearby: { ...old.nearby, results: old.nearby.results.map(item => item.id === p.id ? { ...item, approved: false, rejected: true } : item) } })))))))));
  };
}
