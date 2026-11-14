// Exact coordinates stay in the private draft. Public requests use publicPosition only.
export const MAP_SETUP_BLOCKER = 'Address search and nearby places need a connected server-side maps/places provider. No lookup service or billable account has been enabled.';
export const NEARBY_CATEGORIES = [['private_hospital', 'Private hospital'], ['walking', 'Walking & jogging'], ['supermarket', 'Supermarket']];
export function validPosition(p) {
  return !!p && p.lat !== '' && p.lng !== '' && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180;
}
export function publicPosition(d) {
  const p = d.privateLocation;
  if (!p?.confirmed || !validPosition(p)) return null;
  const exact = d.locationPrecision === 'exact';
  // A ~2 km grid cell, independent of nearby place results. Never use private distances.
  const round = n => Math.round(Number(n) / 0.02) * 0.02;
  return { lat: exact ? Number(p.lat) : Number(round(p.lat).toFixed(2)), lng: exact ? Number(p.lng) : Number(round(p.lng).toFixed(2)), approximate: !exact, ...(exact ? {} : { radiusMetres: 1600 }) };
}
export function locationKey(d) {
  const p = publicPosition(d);
  return p ? JSON.stringify([p.lat, p.lng, p.approximate]) : '';
}
export function updatePrivateLocation(d, patch) {
  return { ...d, privateLocation: { ...d.privateLocation, ...patch, confirmed: false }, nearby: null };
}
export function confirmPrivateLocation(d) {
  if (!validPosition(d.privateLocation)) throw new Error('Enter a valid latitude and longitude or place the pin on the map.');
  return { ...d, privateLocation: { lat: Number(d.privateLocation.lat), lng: Number(d.privateLocation.lng), confirmed: true }, nearby: null };
}
export function distanceMetres(a, b) {
  const rad = n => n * Math.PI / 180;
  const v = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(1 - v)));
}
export function safeMapLink(p) {
  return validPosition(p) ? `https://www.openstreetmap.org/?mlat=${Number(p.lat)}&mlon=${Number(p.lng)}#map=16/${Number(p.lat)}/${Number(p.lng)}` : '';
}
export function normalizePlaces(raw, origin, key, now = new Date().toISOString(), rights = {}) {
  if (!Array.isArray(raw) || !validPosition(origin)) throw new Error('The map service returned an invalid result.');
  return { key, updatedAt: now, persistAllowed: rights.persistAllowed === true, expiresAt: Number.isFinite(Date.parse(rights.expiresAt)) ? rights.expiresAt : '', results: raw.slice(0, 30).filter(p =>
    p && typeof p.name === 'string' && p.name.trim() && validPosition(p) &&
    NEARBY_CATEGORIES.some(([id]) => id === p.category) &&
    typeof p.source === 'string' && p.source && typeof p.evidence === 'string' && p.evidence &&
    (p.category !== 'private_hospital' || p.ownership === 'private') &&
    (p.category !== 'walking' || ['park', 'footway', 'track', 'recreation_ground'].includes(p.placeType))
  ).map((p, i) => ({ id: String(p.id || i), name: p.name.trim().slice(0, 180), category: p.category,
    lat: Number(p.lat), lng: Number(p.lng), distanceMetres: distanceMetres(origin, p), distanceType: 'straight-line',
    source: p.source.slice(0, 200), evidence: p.evidence.slice(0, 400), sourceUrl: safeSourceUrl(p.sourceUrl),
    ownership: p.ownership === 'private' ? 'private' : undefined, placeType: p.placeType,
    manual: p.manual === true, approved: false, rejected: false, approximate: !!origin.approximate })) };
}
export function safeSourceUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function publicNearby(d) {
  if (!d.nearby || d.nearby.key !== locationKey(d) || (d.nearby.expiresAt && Date.parse(d.nearby.expiresAt) <= Date.now())) return [];
  return d.nearby.results.filter(p => p.approved && !p.rejected).map(p => ({
    name: p.name, category: p.category, distanceMetres: p.distanceMetres, distanceType: 'straight-line',
    approximate: !!publicPosition(d)?.approximate, mapUrl: safeMapLink(p), source: p.source,
    sourceUrl: safeSourceUrl(p.sourceUrl), updatedAt: d.nearby.updatedAt, manual: !!p.manual,
  }));
}
export function mapsConnection(config = {}) {
  const endpoint = path => {
    if (typeof config[path] !== 'string' || !config[path].trim()) return null;
    try { const u = new URL(config[path], typeof location !== 'undefined' ? location.origin : 'http://localhost');
      const same = typeof location !== 'undefined' && u.origin === location.origin;
      if ((u.protocol !== 'https:' && !same) || u.username || u.password || u.search || u.hash) return null;
      // Cross-origin endpoints must be explicitly paired with a server-approved origin.
      return same || config.serverOrigin === u.origin ? u.href : null;
    } catch { return null; }
  };
  return { searchUrl: endpoint('searchUrl'), nearbyUrl: endpoint('nearbyUrl') };
}
export async function requestMapService(url, body, { signal, fetcher = fetch } = {}) {
  if (!url) throw new Error(MAP_SETUP_BLOCKER);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  try {
    const response = await fetcher(url, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(response.status === 429 ? 'The map service limit was reached. Keep your details and try again later.' : 'The map service is unavailable. Your entered information is retained.');
    return await response.json();
  } catch (error) {
    if (timedOut) throw new Error('The map service timed out. Your entered information is retained. Try again later.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

// Default for the local owner map: normal browser tile caching and visible attribution.
// Replace with the chosen production provider before higher-volume use; never prefetch tiles.
export function ownerTileOptions() {
  return { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' };
}
