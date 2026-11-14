/* DwellHunt website enquiries (replaces the archived n8n lead workflow).
 * Reached only through the authenticated gateway action "lead"; the Cloudflare Worker has already
 * checked the origin, Turnstile, the honeypot field and that an email or phone is present.
 * Stores the lead in DwellHunt_Leads of the context's spreadsheet (LIVE_SPREADSHEET_ID in production),
 * then sends a Telegram alert and a buyer confirmation. Notification failures never lose the lead. */
var DH_LEAD_SHEET = 'DwellHunt_Leads';
var DH_LEAD_COLUMNS = ['Date', 'Lead ID', 'Customer Name', 'Phone', 'Email', 'Customer Type', 'Property', 'Property ID',
  'Preferred Location', 'Budget', 'Preferred Date', 'Message', 'Source', 'Consent At', 'Lead Status',
  'Ai lead score', 'Ai lead priority', 'Ai lead reason', 'Ai next action', 'Ai analyzed at',
  'Telegram Sent', 'Confirmation Email Sent'];

/** The same fixed scoring rules the n8n workflow used, despite its "AI" name. */
function dhLeadScore_(lead) {
  let score = 0;
  const reasons = [];
  const add = (points, reason) => { score += points; reasons.push(reason); };
  if (lead.budget && lead.budget !== '0') add(20, 'Budget provided');
  if (lead.location) add(15, 'Location specified');
  if (lead.property) add(15, 'Property specified');
  if (['buy', 'rent', 'purchase', 'lease', 'schedule_tour'].some(w => lead.enquiryType.toLowerCase().includes(w))) add(10, 'Clear enquiry type');
  if (/\b(urgent|asap|immediately|today|this week|ready to buy|ready to rent)\b/i.test(lead.message)) add(30, 'High urgency');
  else if (/\b(soon|next month|viewing|visit|schedule)\b/i.test(lead.message) || lead.preferredDate) add(15, 'Moderate urgency');
  add(10, 'Contact information available');
  const priority = score >= 75 ? 'HOT' : score >= 40 ? 'WARM' : 'COLD';
  const next = priority === 'HOT' ? 'Contact customer promptly and arrange a viewing.'
    : priority === 'WARM' ? 'Send matching properties and follow up.' : 'Request missing requirements and nurture lead.';
  return { score, priority, reason: reasons.join('; '), next };
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

  const s = sheet(DH_LEAD_SHEET, DH_LEAD_COLUMNS);
  const contact = lead.email || lead.phone;
  const dayAgo = Date.now() - 86400000;
  const rows = s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, DH_LEAD_COLUMNS.length).getDisplayValues() : [];
  const col = name => DH_LEAD_COLUMNS.indexOf(name);
  const recent = rows.filter(r => Date.parse(r[col('Date')]) > dayAgo &&
    (lead.email ? r[col('Email')].toLowerCase() === lead.email : r[col('Phone')] === lead.phone));
  // A repeat of the same enquiry within a day is acknowledged without a second row, alert or email.
  if (recent.some(r => r[col('Property ID')] === lead.propertyId)) return { httpStatus: 200, status: 'received', duplicate: true };
  if (recent.length >= 5) fail('RATE_LIMITED', 429);

  const scored = dhLeadScore_(lead);
  const at = now();
  const id = 'lead' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  const record = {
    'Date': at, 'Lead ID': id, 'Customer Name': lead.name, 'Phone': lead.phone, 'Email': lead.email,
    'Customer Type': lead.enquiryType, 'Property': lead.property, 'Property ID': lead.propertyId,
    'Preferred Location': lead.location, 'Budget': lead.budget, 'Preferred Date': lead.preferredDate,
    'Message': lead.message, 'Source': lead.source, 'Consent At': at, 'Lead Status': 'new',
    'Ai lead score': scored.score, 'Ai lead priority': scored.priority, 'Ai lead reason': scored.reason,
    'Ai next action': scored.next, 'Ai analyzed at': at, 'Telegram Sent': '', 'Confirmation Email Sent': '',
  };
  s.appendRow(DH_LEAD_COLUMNS.map(k => safeCell(record[k])));
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
    const lines = scored.priority === 'HOT'
      ? ['DWELLHUNT - HOT LEAD', 'Name: ' + lead.name, 'Email: ' + (lead.email || '-'), 'WhatsApp/Phone: ' + (lead.phone || '-'),
        'Property: ' + (lead.property || '-'), 'Type: ' + lead.enquiryType, 'Budget: ' + (lead.budget || '-'),
        'Preferred date: ' + (lead.preferredDate || '-'), 'Score: ' + scored.score, 'Next: ' + scored.next, 'Message: ' + (lead.message || '-')]
      : ['DwellHunt ' + scored.priority + ' lead: ' + lead.name, (lead.email || lead.phone) + (lead.property ? ' | ' + lead.property : ''),
        'Type: ' + lead.enquiryType + (lead.preferredDate ? ' | Date: ' + lead.preferredDate : ''), 'Message: ' + (lead.message || '-')];
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
