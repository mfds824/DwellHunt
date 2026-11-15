/* Labels DwellHunt's demonstration properties as sample listings wherever their titles appear as headings,
 * and adds a note under the title on their detail pages. Only attributes are set (the text comes from CSS),
 * so the page's own rendering is never restructured. Remove a title from this list once it is a real listing. */
(() => {
  'use strict';
  const SAMPLE_TITLES = [
    'Azure Horizon: Galle Face Oceanfront Sky Penthouse',
    'The Dutch Governor Mansion: Restored UNESCO Heritage Villa',
    'Clearwater Residences: Modern Lakeside Apartment',
    'The Mist Pavilion: Hantana Mountain Valley Residence',
    'Mirissa Golden Sands: Prime Beachfront Resort Land',
    'World Trade Center: Grade-A Corporate HQ Floor',
    'Biyagama Hub: Modern High-Bay Logistics Distribution Center',
    'The Sky Crest: Dubai Marina Luxury Waterfront Penthouse',
    'The Glen Fall: British Colonial Heritage Tea Estate Lodge',
  ];
  const normal = text => String(text || '').replace(/\s+/g, ' ').trim();
  const isSample = text => { const t = normal(text); return SAMPLE_TITLES.some(title => t === title || t.startsWith(title)); };

  const style = document.createElement('style');
  style.textContent = `
    [data-dh-sample]::before {
      content: "Sample listing"; display: table; margin: 0 0 6px; padding: 1px 9px; border-radius: 999px;
      background: #fff4d6; color: #7a4b00; border: 1px solid #f0d58a;
      font: 700 11px/1.7 "Plus Jakarta Sans", Arial, sans-serif; letter-spacing: .02em; text-transform: none;
    }
    h1[data-dh-sample]::after {
      content: "This is a sample listing that shows how DwellHunt works. It is not available to buy or rent. Contact us for current properties.";
      display: block; margin: 12px 0 4px; padding: 10px 14px; border-radius: 12px;
      background: #fff8e6; border: 1px solid #f0d58a; color: #5c3d00;
      font: 500 14px/1.5 "Plus Jakarta Sans", Arial, sans-serif; letter-spacing: normal; text-transform: none;
    }`;
  document.head.append(style);

  function mark() {
    document.querySelectorAll('h1, h2, h3, h4').forEach(heading => {
      const sample = isSample(heading.textContent);
      if (sample && !heading.hasAttribute('data-dh-sample')) heading.setAttribute('data-dh-sample', '');
      else if (!sample && heading.hasAttribute('data-dh-sample')) heading.removeAttribute('data-dh-sample');
    });
  }
  let pending = false;
  // setTimeout rather than requestAnimationFrame, which pauses in background tabs.
  const schedule = () => { if (!pending) { pending = true; setTimeout(() => { pending = false; mark(); }, 30); } };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  schedule();
})();
