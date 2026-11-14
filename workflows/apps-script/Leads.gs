/* DwellHunt website enquiries (replaces the archived n8n lead workflow).
 * Reached only through the authenticated gateway: action "lead" (new enquiry), "lead_digest" (evening
 * summary of COLD leads) and Telegram button presses arriving through action "telegram".
 * The Cloudflare Worker has already checked the origin, Turnstile, the honeypot field and contact details.
 * Leads live in DwellHunt_Leads of the context's spreadsheet (LIVE_SPREADSHEET_ID in production).
 * Notification failures never lose the lead. */
var DH_LEAD_SHEET = 'DwellHunt_Leads';
var DH_LEAD_SCORE_VERSION = 'v2';
var DH_LEAD_COLUMNS = ['Date', 'Lead ID', 'Customer Name', 'Phone', 'Email', 'Customer Type', 'Property', 'Property ID',
  'Preferred Location', 'Budget', 'Preferred Date', 'Message', 'Source', 'Consent At', 'Lead Status',
  'Ai lead score', 'Ai lead priority', 'Ai lead reason', 'Ai next action', 'Ai analyzed at',
  'Telegram Sent', 'Confirmation Email Sent', 'Score Version', 'Alert Key', 'Status Updated At'];
var DH_LEAD_DISPOSABLE = /@(mailinator|guerrillamail|10minutemail|temp-?mail|yopmail|trashmail|sharklasers|getnada|dispostable|maildrop|fakeinbox)\./i;
var DH_LEAD_LOW_INTENT = /\b(just (browsing|looking|curious|checking)|not urgent|no rush|not in a (hurry|rush)|maybe (later|next year|someday)|next year)\b/i;
var DH_LEAD_STYLE = { HOT: ['🔥', 'HOT LEAD', 'Reply within 1 hour'], WARM: ['🟡', 'WARM LEAD', 'Reply today'],
  COLD: ['🔵', 'COLD LEAD', 'Reply within 2 days'] };
var DH_LEAD_DIGEST_HOUR = 18; // Sri Lanka time
var DH_LEAD_DIGEST_PENDING = 'digest pending';

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

/** Scores only what the buyer did; property details sent automatically by the page earn nothing.
 *  `reason` (with points) is kept in the sheet; `labels` (plain words) are shown to the agent. */
function dhLeadScore_(lead, signals) {
  if (/(https?:\/\/|www\.)/i.test(lead.message) || DH_LEAD_DISPOSABLE.test(lead.email))
    return { score: 0, priority: 'SPAM', reason: 'Link in message or disposable email address', labels: [],
      next: 'No follow-up; review only if it looks genuine.' };
  let score = 0;
  const reasons = [], labels = [];
  const add = (points, reason, label) => { score += points; reasons.push(reason + ' (' + (points > 0 ? '+' : '') + points + ')'); if (label) labels.push(label); };
  const tour = lead.enquiryType === 'schedule_tour';
  if (tour) add(20, 'Chose Schedule Tour', 'Viewing request');
  if (!signals.template) add(20, 'Wrote their own message', 'Wrote own message');
  if (tour && signals.daysAhead !== null)
    add(signals.daysAhead <= 7 ? 15 : signals.daysAhead <= 30 ? 8 : 3, 'Viewing date in ' + signals.daysAhead + ' day(s)',
      signals.daysAhead === 0 ? 'Viewing today' : 'Viewing in ' + signals.daysAhead + (signals.daysAhead === 1 ? ' day' : ' days'));
  if (lead.phone) add(10, 'Gave a phone/WhatsApp number', 'Gave phone');
  if (signals.hasBooking) add(25, 'Already booked a virtual viewing', null);
  if (signals.earlierEnquiry) add(10, 'Enquired before', null);
  if (!signals.template && DH_LEAD_LOW_INTENT.test(lead.message)) add(-20, 'Message signals low urgency', 'Low urgency wording');
  score = Math.max(0, Math.min(100, score));
  const priority = score >= 60 ? 'HOT' : score >= 30 ? 'WARM' : 'COLD';
  const next = priority === 'HOT' ? 'Call or WhatsApp today and confirm the viewing.'
    : priority === 'WARM' ? 'Reply with the details they asked for.' : 'Send the property details.';
  return { score, priority, reason: reasons.join('; ') || 'Default message only, no extra signals', labels, next };
}

/** Opens DwellHunt_Leads, adding any newer header columns to a tab created by an earlier version. */
function dhLeadSheet_() {
  const existing = SpreadsheetApp.openById(cfg('SPREADSHEET_ID')).getSheetByName(DH_LEAD_SHEET);
  if (existing) {
    const width = existing.getLastColumn();
    if (width >= 20 && width < DH_LEAD_COLUMNS.length &&
        JSON.stringify(existing.getRange(1, 1, 1, width).getDisplayValues()[0]) === JSON.stringify(DH_LEAD_COLUMNS.slice(0, width)))
      existing.getRange(1, width + 1, 1, DH_LEAD_COLUMNS.length - width).setValues([DH_LEAD_COLUMNS.slice(width)]);
  }
  return sheet(DH_LEAD_SHEET, DH_LEAD_COLUMNS);
}

function dhLeadCol_(name) { return DH_LEAD_COLUMNS.indexOf(name); }
/** Sheet rows as text, without the apostrophe safeCell adds in front of values such as "+94…". */
function dhLeadRows_(s) {
  return s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, DH_LEAD_COLUMNS.length).getDisplayValues()
    .map(r => r.map(v => String(v).replace(/^'(?=[=+@\-])/, ''))) : [];
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
  const col = dhLeadCol_;
  const dayAgo = Date.now() - 86400000;
  const mine = dhLeadRows_(s).filter(r => lead.email ? r[col('Email')].toLowerCase() === lead.email : r[col('Phone')] === lead.phone);
  const recent = mine.filter(r => Date.parse(r[col('Date')]) > dayAgo);
  // A repeat of the same enquiry within a day is acknowledged without a second row, alert or email.
  if (recent.some(r => r[col('Property ID')] === lead.propertyId)) return { httpStatus: 200, status: 'received', duplicate: true };
  if (recent.length >= 5) fail('RATE_LIMITED', 429);

  let hasBooking = false;
  if (lead.email) {
    try { hasBooking = all().some(b => String(b.email || '').toLowerCase() === lead.email); }
    catch (e) { log('', 'LEAD_HISTORY_UNAVAILABLE'); }
  }
  const signals = { template: dhLeadIsTemplate_(lead.message, lead.property), daysAhead: dhLeadDaysAhead_(lead.preferredDate),
    hasBooking, earlierEnquiry: mine.length > 0 };
  const scored = dhLeadScore_(lead, signals);
  const spam = scored.priority === 'SPAM', cold = scored.priority === 'COLD';
  const at = now();
  const id = 'lead' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  const key = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  const record = {
    'Date': at, 'Lead ID': id, 'Customer Name': lead.name, 'Phone': lead.phone, 'Email': lead.email,
    'Customer Type': lead.enquiryType, 'Property': lead.property, 'Property ID': lead.propertyId,
    'Preferred Location': lead.location, 'Budget': lead.budget, 'Preferred Date': lead.preferredDate,
    'Message': lead.message, 'Source': lead.source, 'Consent At': at, 'Lead Status': spam ? 'spam' : 'new',
    'Ai lead score': scored.score, 'Ai lead priority': scored.priority, 'Ai lead reason': scored.reason,
    'Ai next action': scored.next, 'Ai analyzed at': at,
    'Telegram Sent': spam ? 'not sent (spam)' : cold ? DH_LEAD_DIGEST_PENDING : '',
    'Confirmation Email Sent': spam ? 'not sent (spam)' : '', 'Score Version': DH_LEAD_SCORE_VERSION,
    'Alert Key': spam ? '' : key, 'Status Updated At': '',
  };
  s.appendRow(DH_LEAD_COLUMNS.map(k => safeCell(record[k])));
  if (spam) return { httpStatus: 200, status: 'received', duplicate: false };
  const row = s.getLastRow();
  const mark = (column, value) => { try { s.getRange(row, col(column) + 1).setValue(value); } catch (e) { log(id, 'LEAD_MARK_FAILED'); } };

  // COLD leads wait for the evening digest instead of an instant ping.
  if (!cold) mark('Telegram Sent', dhLeadTelegram_(lead, scored, signals, id, key));
  mark('Confirmation Email Sent', dhLeadEmail_(lead, id));
  return { httpStatus: 200, status: 'received', duplicate: false };
}

/** The chat that receives lead alerts in this context. */
function dhLeadChat_() {
  return DH_VIEWING_CONTEXT_ === 'production' ? cfg('LIVE_TELEGRAM_ID')
    : dhIsDevelopment_() ? cfg('DEV_TEST_TELEGRAM_ID') : cfg('OPS_CHAT_ID');
}
function dhLeadHtml_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function dhLeadWhatsApp_(phone) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  return digits.length >= 8 && digits.length <= 15 ? ' · <a href="https://wa.me/' + digits + '">WhatsApp ↗</a>' : '';
}
function dhLeadNiceDate_(date) {
  try { return Utilities.formatDate(new Date(date + 'T12:00:00+05:30'), 'Asia/Colombo', 'EEE, d MMM yyyy'); } catch (e) { return date; }
}

/** Tidy HTML alert for HOT and WARM leads: priority first, then property, customer, message and next step. */
function dhLeadAlertText_(lead, scored, signals) {
  const style = DH_LEAD_STYLE[scored.priority];
  const h = dhLeadHtml_;
  const message = signals.template ? '💬 <i>Sent the standard message only</i>'
    : '💬 "' + h(lead.message.length > 300 ? lead.message.slice(0, 297) + '…' : lead.message) + '"';
  const tour = lead.enquiryType === 'schedule_tour';
  const sections = [
    [style[0] + ' <b>' + style[1] + '</b> · ' + style[2]],
    ['🏠 <b>' + h(lead.property || 'General enquiry') + '</b>',
      tour ? '📅 Wants a viewing' + (lead.preferredDate ? ': ' + h(dhLeadNiceDate_(lead.preferredDate)) : ' (no date chosen)') : '',
      signals.hasBooking ? '🔁 Returning customer · has a virtual viewing booked'
        : signals.earlierEnquiry ? '🔁 Returning customer · enquired before' : ''],
    ['👤 ' + h(lead.name), lead.phone ? '📱 ' + h(lead.phone) + dhLeadWhatsApp_(lead.phone) : '', lead.email ? '✉️ ' + h(lead.email) : ''],
    [message],
    [scored.labels.length ? '✅ ' + h(scored.labels.join(' · ')) : '', '👉 ' + h(scored.next)],
    ['🕒 ' + Utilities.formatDate(new Date(), 'Asia/Colombo', 'd MMM, h:mm a')],
  ];
  return sections.map(lines => lines.filter(Boolean).join('\n')).filter(Boolean).join('\n\n').slice(0, 4000);
}

function dhLeadButtons_(id, key) {
  return { inline_keyboard: [[{ text: '✅ Contacted', callback_data: 'L|' + id + '|' + key + '|c' },
    { text: '❌ Not interested', callback_data: 'L|' + id + '|' + key + '|n' }]] };
}

function dhLeadTelegram_(lead, scored, signals, id, key) {
  if (dhTelegramDisabled_()) { log(id, 'DEV_LEAD_TELEGRAM_SKIPPED'); return 'skipped'; }
  try {
    tg('sendMessage', { chat_id: dhLeadChat_(), text: dhLeadAlertText_(lead, scored, signals), parse_mode: 'HTML',
      disable_web_page_preview: true, reply_markup: dhLeadButtons_(id, key) });
    return now();
  } catch (e) { log(id, 'LEAD_TELEGRAM_FAILED'); return 'failed'; }
}

/** Handles the "Contacted" / "Not interested" buttons on a lead alert (callback data L|leadId|key|op). */
function dhLeadAction_(q) {
  const parts = String(q.data || '').split('|'), id = parts[1], key = parts[2], op = parts[3];
  const chat = String(dhLeadChat_());
  const fromChat = q.message && q.message.chat ? String(q.message.chat.id) : '';
  // Private chats must be pressed by that same person; group chats by any member of that group.
  if (fromChat !== chat || (Number(chat) > 0 && String(q.from && q.from.id) !== chat)) fail('UNAUTHORIZED_AGENT', 403);
  const s = dhLeadSheet_(), col = dhLeadCol_;
  const rows = dhLeadRows_(s);
  const index = rows.findIndex(r => r[col('Lead ID')] === id);
  if (index < 0 || !rows[index][col('Alert Key')] || !equal(key, rows[index][col('Alert Key')])) fail('UNAUTHORIZED_AGENT', 403);
  const current = rows[index][col('Lead Status')];
  const label = status => status === 'contacted' ? '✅ Marked as contacted' : '❌ Marked as not interested';
  if (op === 's') { ack(q, 'Already saved: ' + current); return { ignored: true }; }
  const status = op === 'c' ? 'contacted' : op === 'n' ? 'not interested' : fail('INVALID_AGENT_ACTION', 400);
  if (current === status) { ack(q, 'Already saved.'); return { ignored: true }; }
  const row = index + 2;
  s.getRange(row, col('Lead Status') + 1).setValue(status);
  s.getRange(row, col('Status Updated At') + 1).setValue(now());
  try {
    tg('editMessageReplyMarkup', { chat_id: fromChat, message_id: q.message.message_id,
      reply_markup: { inline_keyboard: [[{ text: label(status), callback_data: 'L|' + id + '|' + key + '|s' }]] } });
  } catch (e) { log(id, 'LEAD_BUTTON_UPDATE_FAILED'); }
  ack(q, 'Saved: ' + status);
  return { status: 'lead_' + status.replace(' ', '_') };
}

/** Once a day after 18:00 Sri Lanka time, sends one summary of COLD leads waiting for the digest. */
function dhLeadDigest_() {
  const props = PropertiesService.getScriptProperties();
  const flag = (DH_VIEWING_CONTEXT_ === 'production' ? 'LIVE_' : '') + 'LEAD_DIGEST_DATE';
  const today = Utilities.formatDate(new Date(), 'Asia/Colombo', 'yyyy-MM-dd');
  if (Number(Utilities.formatDate(new Date(), 'Asia/Colombo', 'H')) < DH_LEAD_DIGEST_HOUR || props.getProperty(flag) === today)
    return { processed: 0, errors: 0, skipped: true };
  const s = dhLeadSheet_(), col = dhLeadCol_;
  const pending = dhLeadRows_(s).map((r, i) => ({ r, row: i + 2 })).filter(x => x.r[col('Telegram Sent')] === DH_LEAD_DIGEST_PENDING);
  if (!pending.length) { props.setProperty(flag, today); return { processed: 0, errors: 0 }; }
  const at = now();
  if (dhTelegramDisabled_()) {
    pending.forEach(x => s.getRange(x.row, col('Telegram Sent') + 1).setValue('skipped'));
    props.setProperty(flag, today); log('', 'DEV_LEAD_DIGEST_SKIPPED'); return { processed: pending.length, errors: 0 };
  }
  const h = dhLeadHtml_, shown = pending.slice(0, 25);
  const entries = shown.map(x => {
    const r = x.r;
    const contact = r[col('Phone')] ? '📱 ' + h(r[col('Phone')]) + dhLeadWhatsApp_(r[col('Phone')]) : '✉️ ' + h(r[col('Email')]);
    return '• <b>' + h(r[col('Customer Name')]) + '</b> — ' + h(r[col('Property')] || 'General enquiry') + '\n   ' + contact;
  });
  const more = pending.length > shown.length ? '\n\n…and ' + (pending.length - shown.length) + ' more in the DwellHunt_Leads sheet.' : '';
  const text = '🔵 <b>Cold leads today</b> · ' + pending.length + ' new\n\n' + entries.join('\n\n') + more
    + '\n\n👉 Reply within 2 days. Update Lead Status in the DwellHunt_Leads sheet.';
  try {
    tg('sendMessage', { chat_id: dhLeadChat_(), text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) { log('', 'LEAD_DIGEST_FAILED'); return { processed: 0, errors: 1 }; }
  pending.forEach(x => s.getRange(x.row, col('Telegram Sent') + 1).setValue('in digest ' + at));
  props.setProperty(flag, today);
  return { processed: pending.length, errors: 0 };
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
