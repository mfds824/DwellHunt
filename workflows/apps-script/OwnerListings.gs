/* DwellHunt owner listings (Phase A): a private owner sends ONE property for review; the DwellHunt team verifies it
 * by phone/WhatsApp plus one proof of ownership, then publishes it for one calendar month. DwellHunt stays in the
 * middle: the owner's contact details are never part of the public listing.
 * Gateway actions: "owner_listing" (new submission, after the Worker's Turnstile/honeypot checks) and
 * "owner_listings_public" (published listings for the website). Review buttons arrive through action "telegram"
 * with callback data O|reference|key|op. Expiry and reminders run from dhLeadMaintenance_ via dhOwnerMaintenance_. */
var DH_OWNER_SHEET = 'DwellHunt_Owner_Listings';
var DH_OWNER_COLUMNS = ['Date', 'Reference', 'Status', 'Owner Name', 'Email', 'Phone', 'Preferred Contact', 'Purpose', 'Category',
  'Title', 'Price', 'Currency', 'Price Period', 'District', 'City', 'Street', 'Building', 'Unit', 'Photo Count', 'Public Listing',
  'Draft ID', 'Review Key', 'Telegram Sent', 'Owner Email Sent', 'Decided At', 'Published At', 'Expires At', 'Reminders Sent', 'Notes'];
var DH_OWNER_CATEGORIES = ['house', 'annex', 'room', 'apartment', 'villa', 'commercial', 'land'];
var DH_OWNER_CATEGORY_LABELS = { house: 'House', annex: 'Annex', room: 'Room / boarding', apartment: 'Apartment', villa: 'Villa', commercial: 'Commercial space', land: 'Land' };

function dhOwnerSheet_() { return sheet(DH_OWNER_SHEET, DH_OWNER_COLUMNS); }
function dhOwnerCol_(name) { return DH_OWNER_COLUMNS.indexOf(name); }
function dhOwnerRows_(s) {
  return s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, DH_OWNER_COLUMNS.length).getDisplayValues().map(r => r.map(v => String(v).replace(/^'/, ''))) : [];
}
function dhOwnerSafeUrl_(value) { return typeof value === 'string' && /^https:\/\/res\.cloudinary\.com\/[^\s"'<>]+$/.test(value) && value.length <= 400; }
function dhOwnerPricePeriod_(pub) { return pub.purpose === 'buy' ? '' : pub.billingPeriod === 'night' ? 'night' : pub.billingPeriod === 'year' ? 'year' : 'month'; }
function dhOwnerPriceText_(pub) {
  const period = dhOwnerPricePeriod_(pub);
  return pub.currency + ' ' + Number(pub.price).toLocaleString('en-US') + (period ? ' / ' + period : '');
}

/** Rebuilds the public listing from known fields only and removes the owner's private details from free text. */
function dhOwnerPublicListing_(input, owner, privateLocation) {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const hidden = [owner.name, owner.email, owner.phone, owner.phone.replace(/^\+94/, '0'), privateLocation.unit,
    p.location && p.location.address ? '' : privateLocation.street, p.location && p.location.building ? '' : privateLocation.building]
    .map(v => String(v || '').trim()).filter(v => v.length >= 3);
  const scrub = (value, max) => {
    let t = clean(String(value == null ? '' : value).replace(/\r\n/g, '\n'), max).replace(/[<>]/g, '');
    hidden.forEach(h => { t = t.replace(new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[private detail omitted]'); });
    return t;
  };
  const multiline = (value, max) => scrub(String(value == null ? '' : value).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' '), max);
  const n = value => value === null || value === '' || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
  const list = (value, max) => Array.isArray(value) ? value.slice(0, max).map(v => scrub(v, 60)).filter(Boolean) : [];
  const bool = value => value === true;
  const out = {
    title: scrub(p.title, 120), purpose: p.purpose === 'buy' ? 'buy' : 'rent',
    category: DH_OWNER_CATEGORIES.indexOf(p.category) >= 0 ? p.category : '',
    location: { district: scrub(p.location && p.location.district, 40) },
    price: n(p.price), currency: ['LKR', 'USD', 'GBP', 'AED'].indexOf(p.currency) >= 0 ? p.currency : 'LKR',
    description: multiline(p.description, 4000), features: list(p.features, 20),
    photos: (Array.isArray(p.photos) ? p.photos : []).filter(x => x && dhOwnerSafeUrl_(x.url)).slice(0, 8).map((x, i) => ({ url: x.url, alt: 'Property photo ' + (i + 1) })),
    floorPlan: dhOwnerSafeUrl_(p.floorPlan) ? p.floorPlan : null,
    contact: { via: 'DwellHunt', displayName: scrub(p.contact && p.contact.displayName, 40) || 'Private owner' },
  };
  if (p.location && p.location.city) out.location.city = scrub(p.location.city, 60);
  if (p.location && p.location.address) out.location.address = scrub(p.location.address, 120);
  if (p.location && p.location.building) out.location.building = scrub(p.location.building, 80);
  ['bedrooms', 'bathrooms', 'floorArea', 'landArea', 'floors', 'parking', 'floorNumber', 'maintenance', 'minimumNights', 'minimumLeaseMonths',
    'advanceMonths', 'securityDeposit', 'noticePeriodMonths'].forEach(k => { if (p[k] !== undefined) out[k] = n(p[k]); });
  ['floorUnit', 'landUnit', 'furnishing', 'condition', 'parkingType', 'apartmentType', 'commercialType', 'landType', 'bathroomType',
    'availability', 'rentalType', 'billingPeriod', 'checkInTime', 'availableFrom', 'petsAllowed', 'separateMeters', 'maintenancePeriod']
    .forEach(k => { if (p[k] !== undefined) out[k] = scrub(p[k], 40); });
  ['negotiable', 'balcony', 'garden', 'pool', 'maintenanceIncluded'].forEach(k => { if (p[k] !== undefined) out[k] = bool(p[k]); });
  ['sharedFacilities', 'tenantTypes', 'includedUtilities'].forEach(k => { if (p[k] !== undefined) out[k] = list(p[k], 12); });
  if (p.additionalCharges !== undefined) out.additionalCharges = multiline(p.additionalCharges, 500);
  if (p.availabilityNote !== undefined) out.availabilityNote = multiline(p.availabilityNote, 500);
  return out;
}

function dhOwnerListing_(p) {
  const owner = p.owner || {}, sel = p.selection || {}, conf = p.confirmations || {}, loc = p.privateLocation || {};
  const o = { name: clean(owner.name, 120), email: clean(owner.email, 254).toLowerCase(), phone: clean(owner.phone, 20).replace(/[\s()-]/g, ''),
    preferredContact: ['whatsapp', 'phone', 'email'].indexOf(owner.preferredContact) >= 0 ? owner.preferredContact : 'whatsapp' };
  const priv = { district: clean(loc.district, 40), city: clean(loc.city, 60), street: clean(loc.street, 160), building: clean(loc.building, 80), unit: clean(loc.unit, 20) };
  const invalid = [];
  if (!o.name) invalid.push('owner.name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) invalid.push('owner.email');
  if (!/^\+[1-9]\d{6,14}$/.test(o.phone)) invalid.push('owner.phone');
  if (sel.listingRole !== 'owner' || ['buy', 'rent'].indexOf(sel.listingPurpose) < 0 || DH_OWNER_CATEGORIES.indexOf(sel.propertyCategory) < 0) invalid.push('selection');
  if (sel.propertyCategory === 'room' && sel.listingPurpose === 'buy') invalid.push('selection');
  if (conf.authorized !== true || conf.accurate !== true || conf.photoPermission !== true || p.consent !== true) invalid.push('confirmations');
  if (!priv.district || !priv.city) invalid.push('privateLocation');
  const pub = dhOwnerPublicListing_(p.publicListing, o, priv);
  if (!pub.title) invalid.push('publicListing.title');
  if (!(pub.price > 0)) invalid.push('publicListing.price');
  if (!pub.photos.length) invalid.push('publicListing.photos');
  if (pub.purpose !== sel.listingPurpose || pub.category !== sel.propertyCategory) invalid.push('publicListing.selection');
  if (invalid.length) fail('INVALID_REQUEST', 422, invalid);

  const s = dhOwnerSheet_(), col = dhOwnerCol_, rows = dhOwnerRows_(s);
  const draftId = clean(p.draftId, 60);
  const mine = rows.filter(r => r[col('Email')].toLowerCase() === o.email);
  // A retried send of the same draft returns the existing reference instead of creating a second listing.
  const same = draftId && mine.find(r => r[col('Draft ID')] === draftId);
  if (same) return { httpStatus: 200, status: 'received', duplicate: true, reference: same[col('Reference')] };
  if (mine.filter(r => Date.parse(r[col('Date')]) > Date.now() - 86400000).length >= 3) fail('RATE_LIMITED', 429);

  const at = now(), month = Utilities.formatDate(new Date(), 'Asia/Colombo', 'yyMM');
  const sequence = rows.filter(r => r[col('Reference')].indexOf('OL-' + month + '-') === 0).length + 1;
  const reference = 'OL-' + month + '-' + ('000' + sequence).slice(-4);
  const key = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  const record = {
    'Date': at, 'Reference': reference, 'Status': 'pending review', 'Owner Name': o.name, 'Email': o.email, 'Phone': "'" + o.phone,
    'Preferred Contact': o.preferredContact, 'Purpose': pub.purpose, 'Category': pub.category, 'Title': pub.title, 'Price': pub.price,
    'Currency': pub.currency, 'Price Period': dhOwnerPricePeriod_(pub), 'District': priv.district, 'City': priv.city, 'Street': priv.street,
    'Building': priv.building, 'Unit': priv.unit ? "'" + priv.unit : '', 'Photo Count': pub.photos.length, 'Public Listing': JSON.stringify(pub),
    'Draft ID': draftId, 'Review Key': key, 'Telegram Sent': '', 'Owner Email Sent': '', 'Decided At': '', 'Published At': '',
    'Expires At': '', 'Reminders Sent': '', 'Notes': '',
  };
  s.appendRow(DH_OWNER_COLUMNS.map(k => safeCell(record[k])));
  const row = s.getLastRow();
  const mark = (column, value) => { try { s.getRange(row, col(column) + 1).setValue(value); } catch (e) { log(reference, 'OWNER_MARK_FAILED'); } };
  mark('Telegram Sent', dhOwnerReviewAlert_(reference, key, o, priv, pub));
  mark('Owner Email Sent', dhOwnerEmail_(o, reference, 'received', pub));
  return { httpStatus: 200, status: 'received', duplicate: false, reference };
}

function dhOwnerButtons_(reference, key, status) {
  const b = (text, op) => ({ text, callback_data: 'O|' + reference + '|' + key + '|' + op });
  if (status === 'pending review' || status === 'changes requested')
    return { inline_keyboard: [[b('✅ Verified – publish', 'p')], [b('✏️ Ask for changes', 'c'), b('❌ Reject', 'r')]] };
  const label = { published: '✅ Published', rejected: '❌ Rejected', expired: '⌛ Expired', withdrawn: '🏁 Closed' }[status] || status;
  const rows = [[b(label, 's')]];
  if (status === 'published') rows.push([b('🔁 Renew 1 month', 'n'), b('🏁 Mark rented / sold', 'x')]);
  if (status === 'expired') rows.push([b('🔁 Renew 1 month', 'n')]);
  return { inline_keyboard: rows };
}

function dhOwnerReviewAlert_(reference, key, o, priv, pub) {
  if (dhTelegramDisabled_()) { log(reference, 'DEV_OWNER_TELEGRAM_SKIPPED'); return 'skipped'; }
  try {
    const h = dhLeadHtml_;
    const where = [pub.location.city, pub.location.district].filter(Boolean).join(', ');
    const privateWhere = [priv.street, priv.building, priv.unit].filter(Boolean).join(', ');
    const lines = [
      '🏠 <b>NEW OWNER LISTING</b> · ' + h(reference), '',
      (pub.purpose === 'buy' ? 'Sale' : pub.rentalType === 'short-stay' ? 'Short stay' : 'Rent') + ' · ' + h(DH_OWNER_CATEGORY_LABELS[pub.category]) + ' · <b>' + h(dhOwnerPriceText_(pub)) + '</b>',
      '<b>' + h(pub.title) + '</b>',
      '📍 ' + h(where) + (privateWhere ? '\n🔒 Private address: ' + h(privateWhere) : ''), '',
      '👤 ' + h(o.name), '📱 ' + h(o.phone) + dhLeadWhatsApp_(o.phone), '✉️ ' + h(o.email),
      'Prefers: ' + ({ whatsapp: 'WhatsApp', phone: 'Phone call', email: 'Email' })[o.preferredContact], '',
      '📷 ' + pub.photos.length + ' photo' + (pub.photos.length === 1 ? '' : 's') + ' · <a href="' + h(pub.photos[0].url) + '">cover photo</a>', '',
      '👉 Verify before publishing: call or WhatsApp the owner, and ask for one proof of ownership (utility bill, deed page or rates notice) by WhatsApp.',
    ];
    tg('sendMessage', { chat_id: dhLeadChat_(), text: lines.join('\n').slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: dhOwnerButtons_(reference, key, 'pending review') });
    return now();
  } catch (e) { log(reference, 'OWNER_TELEGRAM_FAILED'); return 'failed'; }
}

function dhOwnerEmail_(o, reference, kind, pub, extra) {
  if (DH_VIEWING_CONTEXT_ !== 'production' && dhIsDevelopment_() && o.email !== cfg('DEV_TEST_EMAIL', '').toLowerCase()) { log(reference, 'DEV_OWNER_EMAIL_SKIPPED'); return 'skipped'; }
  const site = cfg('WEBSITE_URL').replace(/\/$/, '');
  const copy = {
    received: ['We received your listing ' + reference, 'Thank you for listing “' + pub.title + '” with DwellHunt. Your reference number is ' + reference + '.\n\nWhat happens next:\n1. Within 1 working day our team will call or WhatsApp you to verify the listing.\n2. We will ask you to share one proof of ownership, such as a utility bill, a deed page or a rates notice, by WhatsApp.\n3. Once verified, your listing goes live for 1 month. We will remind you before it ends.\n\nYour phone number and email are never shown on the website. Enquiries come to DwellHunt first, and we pass genuine ones to you.'],
    published: ['Your listing ' + reference + ' is now live', 'Good news: “' + pub.title + '” is verified and now live on DwellHunt until ' + (extra || '') + '.\n\nView it here: ' + site + '/#owner-listing=' + encodeURIComponent(reference) + '\n\nEnquiries and viewing requests come to DwellHunt first. We check them and pass genuine ones to you.'],
    changes: ['Your listing ' + reference + ' needs a few changes', 'Thank you for listing “' + pub.title + '”. Before it can go live, a few details need updating. Our team will contact you shortly to explain what is needed.'],
    rejected: ['About your listing ' + reference, 'Thank you for listing “' + pub.title + '” with DwellHunt. Unfortunately we are unable to publish this listing. If you think this is a mistake, please reply to this email or message us on WhatsApp.'],
    reminder: ['Your listing ' + reference + ' ends on ' + (extra || ''), 'Your DwellHunt listing “' + pub.title + '” ends on ' + (extra || '') + '. To keep it live for another month, simply reply to this email or message us on WhatsApp. If it is already rented or sold, let us know and we will close it.'],
    expired: ['Your listing ' + reference + ' has ended', 'Your DwellHunt listing “' + pub.title + '” has ended and is no longer shown. To list it again, reply to this email or message us on WhatsApp.'],
  }[kind];
  try {
    const body = 'Hi ' + o.name + ',\n\n' + copy[1] + '\n\nDwellHunt';
    const html = '<p>Hi ' + esc(o.name) + ',</p>' + copy[1].split('\n\n').map(part => '<p>' + esc(part).replace(/\n/g, '<br>') + '</p>').join('') + '<p>DwellHunt</p>';
    MailApp.sendEmail({ to: o.email, subject: copy[0], body, htmlBody: html, name: 'DwellHunt' });
    return now();
  } catch (e) { log(reference, 'OWNER_EMAIL_FAILED'); return 'failed'; }
}

function dhOwnerAddMonth_(fromMs) {
  const start = new Date(fromMs), end = new Date(fromMs);
  end.setMonth(end.getMonth() + 1);
  if (end.getDate() !== start.getDate()) end.setDate(0); // month-end clamp, e.g. 31 Jan -> 28/29 Feb
  return end;
}
function dhOwnerDateText_(iso) { try { return Utilities.formatDate(new Date(iso), 'Asia/Colombo', 'd MMM yyyy'); } catch (e) { return iso; } }

/** Review buttons on the admin alert: p publish, c ask for changes, r reject, n renew, x close (rented/sold), s status. */
function dhOwnerAction_(q) {
  const parts = String(q.data || '').split('|'), reference = parts[1], key = parts[2], op = parts[3];
  const chat = String(dhLeadChat_()), fromChat = q.message && q.message.chat ? String(q.message.chat.id) : '';
  if (fromChat !== chat || (Number(chat) > 0 && String(q.from && q.from.id) !== chat)) fail('UNAUTHORIZED_AGENT', 403);
  const s = dhOwnerSheet_(), col = dhOwnerCol_, rows = dhOwnerRows_(s);
  const index = rows.findIndex(r => r[col('Reference')] === reference);
  if (index < 0 || !rows[index][col('Review Key')] || !equal(key, rows[index][col('Review Key')])) fail('UNAUTHORIZED_AGENT', 403);
  const r = rows[index], row = index + 2, current = r[col('Status')];
  const o = { name: r[col('Owner Name')], email: r[col('Email')] };
  let pub = {};
  try { pub = JSON.parse(r[col('Public Listing')]); } catch (e) { pub = { title: r[col('Title')] }; }
  if (op === 's') { ack(q, 'Status: ' + current); return { ignored: true }; }
  const allowed = { p: ['pending review', 'changes requested'], c: ['pending review'], r: ['pending review', 'changes requested'],
    n: ['published', 'expired'], x: ['published'] }[op];
  if (!allowed) fail('INVALID_AGENT_ACTION', 400);
  if (allowed.indexOf(current) < 0) { ack(q, 'Already ' + current + '.'); return { ignored: true }; }
  const set = (column, value) => s.getRange(row, col(column) + 1).setValue(value);
  const at = now();
  let status = current, email = '';
  if (op === 'p' || op === 'n') {
    const base = op === 'n' && current === 'published' && Date.parse(r[col('Expires At')]) > Date.now() ? Date.parse(r[col('Expires At')]) : Date.now();
    const expires = dhOwnerAddMonth_(base).toISOString();
    status = 'published'; set('Status', status); set('Expires At', expires); set('Reminders Sent', '');
    if (op === 'p') { set('Published At', at); set('Decided At', at); }
    email = dhOwnerEmail_(o, reference, 'published', pub, dhOwnerDateText_(expires));
  } else if (op === 'c') { status = 'changes requested'; set('Status', status); set('Decided At', at); email = dhOwnerEmail_(o, reference, 'changes', pub); }
  else if (op === 'r') { status = 'rejected'; set('Status', status); set('Decided At', at); email = dhOwnerEmail_(o, reference, 'rejected', pub); }
  else if (op === 'x') { status = 'withdrawn'; set('Status', status); set('Decided At', at); }
  set('Notes', (r[col('Notes')] ? r[col('Notes')] + '\n' : '') + at + ' ' + status + (email && email !== 'skipped' && email !== 'failed' ? ' (owner emailed)' : email === 'failed' ? ' (owner email FAILED)' : ''));
  try { tg('editMessageReplyMarkup', { chat_id: fromChat, message_id: q.message.message_id, reply_markup: dhOwnerButtons_(reference, key, status) }); }
  catch (e) { log(reference, 'OWNER_BUTTON_UPDATE_FAILED'); }
  ack(q, 'Saved: ' + status);
  return { status: 'owner_' + status.replace(/ /g, '_') };
}

/** Published, unexpired listings for the website. Only the sanitised public JSON leaves this function. */
function dhOwnerListingsPublic_() {
  const rows = dhOwnerRows_(dhOwnerSheet_()), col = dhOwnerCol_, nowMs = Date.now();
  const listings = rows.filter(r => r[col('Status')] === 'published' && Date.parse(r[col('Expires At')]) > nowMs).map(r => {
    let pub = null;
    try { pub = JSON.parse(r[col('Public Listing')]); } catch (e) { pub = null; }
    return pub && { ...pub, reference: r[col('Reference')], publishedAt: r[col('Published At')], expiresAt: r[col('Expires At')], verified: true };
  }).filter(Boolean);
  return { httpStatus: 200, listings };
}

/** Daily: reminders 7 and 2 days before expiry (owner email + admin Telegram with Renew), then expiry. */
function dhOwnerMaintenance_() {
  const s = dhOwnerSheet_(), col = dhOwnerCol_, rows = dhOwnerRows_(s), nowMs = Date.now();
  let processed = 0;
  rows.forEach((r, i) => {
    if (r[col('Status')] !== 'published') return;
    const expires = Date.parse(r[col('Expires At')]);
    if (!Number.isFinite(expires)) return;
    const row = i + 2, reference = r[col('Reference')], o = { name: r[col('Owner Name')], email: r[col('Email')] };
    let pub = {}; try { pub = JSON.parse(r[col('Public Listing')]); } catch (e) { pub = { title: r[col('Title')] }; }
    const sent = String(r[col('Reminders Sent')] || '');
    if (expires <= nowMs) {
      s.getRange(row, col('Status') + 1).setValue('expired');
      dhOwnerEmail_(o, reference, 'expired', pub);
      dhOwnerAdminNote_(reference, r[col('Review Key')], '⌛ <b>Listing ended</b> · ' + dhLeadHtml_(reference) + '\n' + dhLeadHtml_(pub.title || ''), 'expired');
      processed++; return;
    }
    const days = (expires - nowMs) / 86400000;
    const due = days <= 2 ? '2d' : days <= 7 ? '7d' : '';
    if (due && sent.indexOf(due) < 0) {
      dhOwnerEmail_(o, reference, 'reminder', pub, dhOwnerDateText_(r[col('Expires At')]));
      dhOwnerAdminNote_(reference, r[col('Review Key')], '⏰ <b>Listing ends ' + dhLeadHtml_(dhOwnerDateText_(r[col('Expires At')])) + '</b> · ' + dhLeadHtml_(reference) + '\n' + dhLeadHtml_(pub.title || '') + '\nThe owner has been emailed. Renew if they want another month.', 'published');
      s.getRange(row, col('Reminders Sent') + 1).setValue(sent ? sent + ',' + due : due);
      processed++;
    }
  });
  return processed;
}
function dhOwnerAdminNote_(reference, key, text, status) {
  if (dhTelegramDisabled_()) return;
  try { tg('sendMessage', { chat_id: dhLeadChat_(), text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: dhOwnerButtons_(reference, key, status) }); }
  catch (e) { log(reference, 'OWNER_TELEGRAM_FAILED'); }
}
