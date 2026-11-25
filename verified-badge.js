// "DwellHunt Verified": the badge for agents DwellHunt has approved (navy shield with a gold check, brand guide).
// Shown only for approved agents - the public feeds never include others - and never self-claimed.
export const VERIFIED_MEANING = 'DwellHunt Verified: DwellHunt reviewed and approved this agent, who signs in with their own email. It is not a legal or licence guarantee.';

/** DwellHunt reviewed this listing itself. Owner listings always are; a verified agent may publish without a check.
 * Feeds from before the flag existed had only checked listings. */
export const isChecked = l => !!l && l.checked !== false;
export function checkMark(h, l, key) {
  return isChecked(l) ? h('span', { key, className: 'dh-check is-checked', title: 'DwellHunt reviewed this listing before it went live.' }, '✓ Verified property')
    : null; // a listing an agent published straight away is shown as a plain listing
}

/** The badge as a React element. size: 'sm' (cards, inline) or 'md' (profile and listing headers). */
export function verifiedBadge(h, size = 'md', key) {
  return h('span', { key, className: `dh-verified dh-verified-${size}`, title: VERIFIED_MEANING, role: 'img', 'aria-label': 'DwellHunt Verified agent' },
    h('svg', { viewBox: '0 0 24 24', width: size === 'sm' ? 13 : 16, height: size === 'sm' ? 13 : 16, fill: 'none', stroke: 'currentColor',
      strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: 'dh-verified-icon' },
      h('path', { d: 'M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3' }),
      h('path', { d: 'M9 12l2 2l4 -4' })),
    h('span', null, 'DwellHunt Verified'));
}
