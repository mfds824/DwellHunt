import { isManagedListing } from './listing-adapter.js';
import { listingService } from './listing-service.js';
export function activeListing(property, now = Date.now()) {
  return isManagedListing(property) && property.status === 'published' && property.synthetic !== true &&
    /^DHL-[0-9a-f-]{36}$/i.test(property.id || '') && Date.parse(property.expiresAt) > now;
}
export function contactListingUrl(property, channel) {
  return listingService.publicUrl('/public/' + encodeURIComponent(property.id) + '/contact') + '?channel=' + encodeURIComponent(channel);
}
export function usePublicListings(React, original, onDeepLink, service = listingService) {
  const [live, setLive] = React.useState([]), [now, setNow] = React.useState(Date.now());
  const navigate = React.useRef(onDeepLink); navigate.current = onDeepLink;
  const linked = React.useRef(false);
  React.useEffect(() => {
    if (!service.ready) return;
    let alive = true;
    async function refresh() {
      try {
        const rows = await service.publicListings(); if (!alive) return;
        const time = service.serverTime();
        const current = rows.filter(row => activeListing(row, time)); setLive(current); setNow(time);
        const id = new URLSearchParams(window.location.search).get('listing');
        if (!linked.current && id && current.some(row => row.id === id)) { linked.current = true; navigate.current(id); }
      } catch { if (alive) setLive([]); } // Never present cached owner records as authoritative.
    }
    refresh(); const poll = setInterval(refresh, 15000), clock = setInterval(() => setNow(service.serverTime()), 1000);
    const focus = () => refresh(); window.addEventListener('focus', focus);
    return () => { alive = false; clearInterval(poll); clearInterval(clock); window.removeEventListener('focus', focus); };
  }, [service]);
  return [...original.filter(p => !isManagedListing(p) && !/^(TEST-)?DHL-/.test(p.id || '')), ...live.filter(p => activeListing(p, now))];
}
