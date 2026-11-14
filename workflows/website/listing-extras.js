import { listingPrice } from './listing-adapter.js';
import { NEARBY_CATEGORIES } from './listing-location.js';
import { contactListingUrl } from './listing-public.js';

export function createListingExtras(React, icons) {
  const h = React.createElement;
  const box = 'bg-white rounded-3xl p-6 sm:p-8 border border-stone-200/90 shadow-2xs';
  const action = 'flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs';
  function OwnerBadge({ property: p }) {
    return h('div', { className: 'flex items-center space-x-2 text-stone-600' },
      h(icons.person, { className: 'w-4 h-4 text-emerald-800' }),
      h('span', { className: 'font-semibold truncate max-w-[140px]' }, p.contact?.displayName || (p.listingRole === 'agent' ? 'Listing agent' : 'Property owner')));
  }
  function OwnerContact({ property: p, preview = false }) {
    const contact = p.contact || {};
    return h('aside', { className: 'bg-white rounded-3xl p-6 border border-stone-200/90 shadow-md sticky top-28', 'aria-label': p.listingRole === 'agent' ? 'Assigned agent contact' : 'Property owner contact' },
      h('div', { className: 'flex items-center space-x-3.5 pb-5 border-b border-stone-100' },
        h('div', { className: 'w-14 h-14 rounded-2xl bg-emerald-900 text-white flex items-center justify-center' }, h(icons.person, { className: 'w-6 h-6' })),
        h('div', null, h('h4', { className: 'font-extrabold text-stone-900 text-sm' }, contact.displayName || (p.listingRole === 'agent' ? 'Listing agent' : 'Property owner')), h('p', { className: 'text-xs text-emerald-800 font-semibold' }, p.listingRole === 'agent' ? (p.agencyName || 'Independent agent') : 'Listed by property owner'))),
      h('div', { className: 'grid grid-cols-1 gap-2.5 my-4' }, ['whatsapp', 'phone', 'email'].filter(key => contact[key]).map(key => {
        const who = p.listingRole === 'agent' ? 'agent' : 'owner';
        const label = { whatsapp: 'WhatsApp '+who, phone: 'Call '+who, email: 'Email '+who }[key];
        const href = contactListingUrl(p, key);
        return preview ? h('div', { key, className: action }, `${label}: ${contact[key]}`) : h('a', { key, className: action, href, ...(key === 'whatsapp' ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, label);
      })),
      preview && h('p', { className: 'text-xs text-stone-500 leading-relaxed' }, 'Draft preview only. Contact details above are the permitted public details; no enquiry or viewing request is sent.'),
      h('p', { className: 'text-xs text-stone-500 mt-4' }, p.listingRole === 'agent' ? 'These links contact the assigned agent. Integrated enquiry tracking and viewing requests are not connected for managed agent listings.' : 'Owner enquiry routing and viewing requests require the connected owner-listing service.'));
  }
  function AdditionalFacts({ property: p }) {
    const entries = Object.entries(p.details || {}).filter(([, value]) => value !== '' && value !== undefined && value !== null);
    if (!entries.length) return null;
    return h('section', { className: box }, h('h3', { className: 'font-bold text-sm text-stone-900 mb-4 pb-3 border-b border-stone-100' }, 'Property Details & Availability'),
      h('dl', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs' }, entries.map(([label, value]) => h('div', { key: label },
        h('dt', { className: 'text-stone-500 mb-1' }, label), h('dd', { className: 'font-semibold text-stone-900' }, String(value))))));
  }
  function Nearby({ property: p }) {
    if (!p.nearbyEssentials?.length) return null;
    return h('section', { className: box }, h('h3', { className: 'font-bold text-base text-stone-900 mb-4' }, 'Nearby essentials'),
      h('p', { className: 'text-xs text-stone-500 mb-4' }, 'Straight-line distances. These do not establish route safety, access, opening hours or travel times.'),
      h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-4' }, p.nearbyEssentials.map((place, index) => h('div', { key: index, className: 'p-3 rounded-2xl bg-stone-50 border border-stone-100 text-xs' },
        h('p', { className: 'font-semibold text-stone-800' }, place.name),
        h('p', { className: 'text-stone-600 mt-1' }, `${NEARBY_CATEGORIES.find(([id]) => id === place.category)?.[1] || 'Place'} · ${place.approximate ? 'Approx. ' : ''}${(place.distanceMetres / 1000).toFixed(1)} km straight-line`),
        h('p', { className: 'text-stone-500 mt-1' }, `${place.manual ? 'Owner-added · unverified' : place.source} · Retrieved ${new Date(place.updatedAt).toLocaleDateString('en-GB')}`),
        h('a', { href: place.mapUrl, target: '_blank', rel: 'noopener noreferrer', className: 'text-emerald-800 underline' }, 'View place on map'),
        place.sourceUrl && h('a', { href: place.sourceUrl, target: '_blank', rel: 'noopener noreferrer', className: 'text-emerald-800 underline ml-3' }, 'Source')))));
  }
  function EmptyPhoto() { return h('div', { className: 'dh-listing-empty-photo', role: 'img', 'aria-label': 'No property photos supplied' }, 'No property photos supplied'); }
  function mapPopup(p, price) {
    const box = document.createElement('div'); box.style.cssText = 'width:220px;font-family:system-ui,sans-serif';
    if (p.images[0]) { const img = document.createElement('img'); img.src = p.images[0]; img.alt = p.title; img.style.cssText = 'width:100%;height:120px;object-fit:cover;border-radius:8px'; box.append(img); }
    for (const value of [price, p.title, [p.city, p.district].filter(Boolean).join(', '), p.coordinates?.approximate ? 'Approximate area — not the property pin' : '']) {
      if (!value) continue; const line = document.createElement('p'); line.textContent = value; box.append(line);
    }
    return box;
  }
  return { mapPopup, OwnerBadge, OwnerContact, AdditionalFacts, Nearby, EmptyPhoto, price: listingPrice };
}
