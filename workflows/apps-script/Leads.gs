/* DwellHunt website enquiries (replaces the archived n8n lead workflow).
 * Reached only through the authenticated gateway action "lead"; the Cloudflare Worker has already
 * checked the origin, Turnstile, the honeypot field and that an email or phone is present.
 * Stores the lead in DwellHunt_Leads of the context's spreadsheet (LIVE_SPREADSHEET_ID in production),
 * then sends a Telegram alert and a buyer confirmation. Notification failures never lose the lead. */
var DH_LEAD_SHEET = 'DwellHunt_Leads';
var DH_LEAD_SCORE_VERSION = 'v2';
var DH_LEAD_COLUMNS = ['Date', 'Lead ID', 'Customer Name', 'Phone', 'Email', 'Customer Type', 'Property', 'Property ID',
  'Preferred Location', 'Budget', 'Preferred Date', 'Message', 'Source', 'Consent At', 'Lead Status',
  'Ai lead score', 'Ai lead priority', 'Ai lead reason', 'Ai next action', 'Ai analyzed at',
  'Telegram Sent', 'Confirmation Email Sent', 'Score Version'];
var DH_LEAD_DISPOSABLE = /@(mailinator|guerrillamail|10minutemail|temp-?mail|yopmail|trashmail|sharklasers|getnada|dispostable|maildrop|fakeinbox)\./i;
var DH_LEAD_LOW_INTENT = /\b(just (browsing|looking|curious|checking)|not urgent|no rush|not in a (hurry|rush)|maybe (later|next year|someday)|next year)\b/i;

/** Website message templates, and older ones, which carry no buyer intent of their own. */
function dhLeadIsTemplate_(message, title) {
  const n = s => String(s || '').toLowerCase().replace(/[‘’“”"'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const m = n(message);
  if (!m) return true;
  return ['Hello, I am interested in "' + title + '". Please send more details regarding title deeds and schedule a viewing.',
    'Hello, I\'m interested in "' + title + '". Please send me more details.',
    'Hello, I\'d like to arrange a viewing of "' + title + '".'].some(t => n(t) === m);
}

/** Days from today (Sri Lanka) to a YYYY-MM-DD viewing date; null when absent or in the past. */
function dhLeadDaysAhead_(date) {
  if (!date) return null;
  const today = Date.parse(Utilities.formatDate(new Date(), 'Asia/Colombo', 'yyyy-MM-dd') + 'T00:00:00Z');
  const days = Math.round((Date.parse(date + 'T00:00:00Z') - today) / 86400000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/** Scores only what the buyer did; property details sent automatically by the page earn nothing. */
function dhLeadScore_(lead, signals) {
  if (/(https?:\/\/|www\.)/i.test(lead.message) || DH_LEAD_DISPOSABLE.test(lead.email))
    return { score: 0, priority: 'SPAM', reason: 'Link in message or disposable email address', next: 'No follow-up; review only if it looks genuine.' };
  let score = 0;
  const reasons = [];
  const add = (points, reason) => { score += points; reasons.push(reason + ' (' + (points > 0 ? '+' : '') + points + ')'); };
  const tour = lead.enquiryType === 'schedule_tour';
  if (tour) add(20, 'Chose Schedule Tour');
  if (!signals.template) add(20, 'Wrote their own message');
  if (tour && signals.daysAhead !== null)
    add(signals.daysAhead <= 7 ? 15 : signals.daysAhead <= 30 ? 8 : 3, 'Viewing date in ' + signals.daysAhead + ' day(s)');
  if (lead.phone) add(10, 'Gave a phone/WhatsApp number');
  if (signals.hasBooking) add(25, 'Already booked a virtual viewing');
  if (signals.earlierEnquiry) add(10, 'Enquired before');
  if (!signals.template && DH_LEAD_LOW_INTENT.test(lead.message)) add(-20, 'Message signals low urgency');
  score = Math.max(0, Math.min(100, score));
  const priority = score >= 60 ? 'HOT' : score >= 30 ? 'WARM' : 'COLD';
  const next = priority === 'HOT' ? 'Contact customer promptly and arrange a viewing.'
    : priority === 'WARM' ? 'Reply with the requested details and follow up.' : 'Send the property details and nurture the lead.';
  return { score, priority, reason: reasons.join('; ') || 'Default message only, no extra signals', next };
}

/** Opens DwellHunt_Leads, adding the Score Version header to a sheet created before it existed. */
function dhLeadSheet_() {
  const existing = SpreadsheetApp.openById(cfg('SPREADSHEET_ID')).getSheetByName(DH_LEAD_SHEET);
  const older = DH_LEAD_COLUMNS.slice(0, -1);
  if (existing && existing.getLastColumn() === older.length &&
      JSON.stringify(existing.getRange(1, 1, 1, older.length).getDisplayValues()[0]) === JSON.stringify(older))
    existing.getRange(1, DH_LEAD_COLUMNS.length).setValue(DH_LEAD_COLUMNS[DH_LEAD_COLUMNS.length - 1]);
  return sheet(DH_LEAD_SHEET, DH_LEAD_COLUMNS);
}

function dhLead_(p) {
  const lead = {
    name: clean(p.customer_name || p.name, 120), email: clean(p.email, 254).toLowerCase(), phone: clean(p.phone, 32),
    enquiryType: clean(p.enquiry_type, 40) || 'general', property: clean(p.property, 200), propertyId: clean(p.property_id, 80),
    location: clean(p.location, 120), budget: clean(p.budget, 40), preferredDate: clean(p.preferred_date, 10),
    message: clean(p.message, 1500), source: clean(p.source, 60) || 'DwellHunt Website',
  };
  const invalid = [];
  if (!lead.name) invalid.push('customer_name');
  if (!lead.email && !lead.phone) invalid.push('email', 'phone');
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) invalid.push('email');
  if (lead.preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(lead.preferredDate)) invalid.push('preferred_date');
  if (p.consent !== true) invalid.push('consent');
  if (invalid.length) fail('INVALID_REQUEST', 422, invalid);

  const s = dhLeadSheet_();
  const dayAgo = Date.now() - 86400000;
  const rows = s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, DH_LEAD_COLUMNS.length).getDisplayValues() : [];
  const col = name => DH_LEAD_COLUMNS.indexOf(name);
  const mine = rows.filter(r => lead.email ? r[col('Email')].toLowerCase() === lead.email : r[col('Phone')] === lead.phone);
  const recent = mine.filter(r => Date.parse(r[col('Date')]) > dayAgo);
  // A repeat of the same enquiry within a day is acknowledged without a second row, alert or email.
  if (recent.some(r => r[col('Property ID')] === lead.propertyId)) return { httpStatus: 200, status: 'received', duplicate: true };
  if (recent.length >= 5) fail('RATE_LIMITED', 429);

  let hasBooking = false;
  if (lead.email) {
    try { hasBooking = all().some(b => String(b.email || '').toLowerCase() === lead.email); }
    catch (e) { log('', 'LEAD_HISTORY_UNAVAILABLE'); }
  }
  const scored = dhLeadScore_(lead, { template: dhLeadIsTemplate_(lead.message, lead.property),
    daysAhead: dhLeadDaysAhead_(lead.preferredDate), hasBooking, earlierEnquiry: mine.length > 0 });
  const spam = scored.priority === 'SPAM';
  const at = now();
  const id = 'lead' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  const record = {
    'Date': at, 'Lead ID': id, 'Customer Name': lead.name, 'Phone': lead.phone, 'Email': lead.email,
    'Customer Type': lead.enquiryType, 'Property': lead.property, 'Property ID': lead.propertyId,
    'Preferred Location': lead.location, 'Budget': lead.budget, 'Preferred Date': lead.preferredDate,
    'Message': lead.message, 'Source': lead.source, 'Consent At': at, 'Lead Status': spam ? 'spam' : 'new',
    'Ai lead score': scored.score, 'Ai lead priority': scored.priority, 'Ai lead reason': scored.reason,
    'Ai next action': scored.next, 'Ai analyzed at': at, 'Telegram Sent': spam ? 'not sent (spam)' : '',
    'Confirmation Email Sent': spam ? 'not sent (spam)' : '', 'Score Version': DH_LEAD_SCORE_VERSION,
  };
  s.appendRow(DH_LEAD_COLUMNS.map(k => safeCell(record[k])));
  if (spam) return { httpStatus: 200, status: 'received', duplicate: false };
  const row = s.getLastRow();
  const mark = (column, value) => { try { s.getRange(row, col(column) + 1).setValue(value); } catch (e) { log(id, 'LEAD_MARK_FAILED'); } };

  mark('Telegram Sent', dhLeadTelegram_(lead, scored, id));
  mark('Confirmation Email Sent', dhLeadEmail_(lead, id));
  return { httpStatus: 200, status: 'received', duplicate: false };
}

function dhLeadTelegram_(lead, scored, id) {
  if (dhTelegramDisabled_()) { log(id, 'DEV_LEAD_TELEGRAM_SKIPPED'); return 'skipped'; }
  try {
    const chat = DH_VIEWING_CONTEXT_ === 'production' ? cfg('LIVE_TELEGRAM_ID')
      : dhIsDevelopment_() ? cfg('DEV_TEST_TELEGRAM_ID') : cfg('OPS_CHAT_ID');
    const type = lead.enquiryType === 'schedule_tour' ? 'Schedule Tour' : 'Question';
    const lines = scored.priority === 'HOT'
      ? ['DWELLHUNT - HOT LEAD (score ' + scored.score + ')', 'Name: ' + lead.name, 'Email: ' + (lead.email || '-'),
        'WhatsApp/Phone: ' + (lead.phone || '-'), 'Property: ' + (lead.property || '-'), 'Type: ' + type,
        'Preferred date: ' + (lead.preferredDate || '-'), 'Why: ' + scored.reason, 'Next: ' + scored.next, 'Message: ' + (lead.message || '-')]
      : ['DwellHunt ' + scored.priority + ' lead (score ' + scored.score + '): ' + lead.name,
        (lead.email || lead.phone) + (lead.property ? ' | ' + lead.property : ''),
        'Type: ' + type + (lead.preferredDate ? ' | Date: ' + lead.preferredDate : ''), 'Why: ' + scored.reason,
        'Message: ' + (lead.message || '-')];
    tg('sendMessage', { chat_id: chat, text: lines.join('\n').slice(0, 3900) });
    return now();
  } catch (e) { log(id, 'LEAD_TELEGRAM_FAILED'); return 'failed'; }
}

function dhLeadEmail_(lead, id) {
  if (!lead.email) return 'no email';
  // Development may email only the verified test inbox.
  if (DH_VIEWING_CONTEXT_ !== 'production' && dhIsDevelopment_() && lead.email !== cfg('DEV_TEST_EMAIL', '').toLowerCase()) {
    log(id, 'DEV_LEAD_EMAIL_SKIPPED'); return 'skipped';
  }
  try {
    const about = lead.property ? ' about ' + lead.property : '';
    const text = 'Hi ' + lead.name + ',\n\nThank you for your enquiry' + about + '. The DwellHunt team has received it and will contact you shortly by email or WhatsApp.\n\n'
      + 'If you did not send this enquiry, you can ignore this email.\n\nDwellHunt';
    const html = '<p>Hi ' + esc(lead.name) + ',</p><p>Thank you for your enquiry' + esc(about) + '. The DwellHunt team has received it and will contact you shortly by email or WhatsApp.</p>'
      + '<p style="color:#666;font-size:12px">If you did not send this enquiry, you can ignore this email.</p><p>DwellHunt</p>';
    MailApp.sendEmail({ to: lead.email, subject: 'We received your DwellHunt enquiry', body: text, htmlBody: html, name: 'DwellHunt' });
    return now();
  } catch (e) { log(id, 'LEAD_EMAIL_FAILED'); return 'failed'; }
}
