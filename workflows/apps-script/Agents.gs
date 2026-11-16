/* DwellHunt agent accounts. Agents apply, the DwellHunt team approves them in Telegram, and approved agents sign in
 * with a 6-digit code sent by email (no passwords are stored). A signed-in agent sees their own listings and sends new
 * ones into the same review queue as owners (OwnerListings.gs). Buyer enquiries about an agent's listing are saved in
 * DwellHunt_Leads as usual and then emailed to that agent (dhAgentForwardLead_).
 * Gateway actions: agent_signup, agent_code, agent_verify, agent_me, agent_signout, agent_listing.
 * Telegram review buttons arrive through action "telegram" with callback data A|agentId|key|op. */
var DH_AGENT_SHEET = 'DwellHunt_Agents';
var DH_AGENT_COLUMNS = ['Date', 'Agent ID', 'Status', 'Name', 'Agency', 'Email', 'Phone', 'Registration No', 'Review Key',
  'Decided At', 'Telegram Sent', 'Email Sent', 'Last Sign In', 'Notes'];
var DH_AGENT_AUTH_SHEET = 'DwellHunt_Agent_Auth';
var DH_AGENT_AUTH_COLUMNS = ['Created', 'Agent ID', 'Kind', 'Secret Hash', 'Expires At', 'Attempts', 'Used At'];
var DH_AGENT_CODE_MINUTES = 10, DH_AGENT_CODE_TRIES = 5, DH_AGENT_CODES_PER_HOUR = 5, DH_AGENT_SESSION_DAYS = 30;

function dhAgentSheet_() { return sheet(DH_AGENT_SHEET, DH_AGENT_COLUMNS); }
function dhAgentAuthSheet_() { return sheet(DH_AGENT_AUTH_SHEET, DH_AGENT_AUTH_COLUMNS); }
function dhAgentCol_(name) { return DH_AGENT_COLUMNS.indexOf(name); }
function dhAgentAuthCol_(name) { return DH_AGENT_AUTH_COLUMNS.indexOf(name); }
function dhAgentRows_(s, cols) {
  return s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, cols.length).getDisplayValues().map(r => r.map(v => String(v).replace(/^'/, ''))) : [];
}
function dhAgentEmailOk_(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function dhAgentProfile_(r) {
  const c = dhAgentCol_;
  return { id: r[c('Agent ID')], name: r[c('Name')], agency: r[c('Agency')], email: r[c('Email')], phone: r[c('Phone')], status: r[c('Status')] };
}
function dhAgentFind_(field, value) {
  const s = dhAgentSheet_(), rows = dhAgentRows_(s, DH_AGENT_COLUMNS), i = rows.findIndex(r => r[dhAgentCol_(field)].toLowerCase() === String(value).toLowerCase());
  return i < 0 ? null : { s, row: i + 2, r: rows[i] };
}
/** Development may email only the verified test inbox; Production emails the agent. */
function dhAgentMail_(id, to, subject, text) {
  if (DH_VIEWING_CONTEXT_ !== 'production' && dhIsDevelopment_() && to !== cfg('DEV_TEST_EMAIL', '').toLowerCase()) { log(id, 'DEV_AGENT_EMAIL_SKIPPED'); return 'skipped'; }
  try {
    const html = text.split('\n\n').map(part => '<p>' + esc(part).replace(/\n/g, '<br>') + '</p>').join('');
    MailApp.sendEmail({ to, subject, body: text, htmlBody: html, name: 'DwellHunt' });
    return now();
  } catch (e) { log(id, 'AGENT_EMAIL_FAILED'); return 'failed'; }
}
function dhAgentSite_() { return cfg('WEBSITE_URL').replace(/\/$/, ''); }

/** New agent application. Repeats are answered without a second alert so the form cannot be used to flood the team. */
function dhAgentSignup_(p) {
  const a = { name: clean(p.name, 120), agency: clean(p.agency, 120), email: clean(p.email, 254).toLowerCase(),
    phone: clean(p.phone, 20).replace(/[\s()-]/g, ''), registration: clean(p.registrationNo, 40) };
  const invalid = [];
  if (a.name.length < 2) invalid.push('name');
  if (a.agency.length < 2) invalid.push('agency');
  if (!dhAgentEmailOk_(a.email)) invalid.push('email');
  if (!/^\+[1-9]\d{6,14}$/.test(a.phone)) invalid.push('phone');
  if (p.consent !== true) invalid.push('consent');
  if (invalid.length) fail('INVALID_REQUEST', 422, invalid);
  const s = dhAgentSheet_(), col = dhAgentCol_, rows = dhAgentRows_(s, DH_AGENT_COLUMNS);
  const existing = rows.find(r => r[col('Email')].toLowerCase() === a.email);
  if (existing) return { httpStatus: 200, status: existing[col('Status')] === 'approved' ? 'approved' : 'pending', duplicate: true };
  if (rows.filter(r => Date.parse(r[col('Date')]) > Date.now() - 86400000).length >= 30) fail('RATE_LIMITED', 429);
  const month = Utilities.formatDate(new Date(), 'Asia/Colombo', 'yyMM');
  const id = 'AG-' + month + '-' + ('000' + (rows.filter(r => r[col('Agent ID')].indexOf('AG-' + month + '-') === 0).length + 1)).slice(-4);
  const key = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  const record = { 'Date': now(), 'Agent ID': id, 'Status': 'pending', 'Name': a.name, 'Agency': a.agency, 'Email': a.email,
    'Phone': "'" + a.phone, 'Registration No': a.registration, 'Review Key': key, 'Decided At': '', 'Telegram Sent': '', 'Email Sent': '',
    'Last Sign In': '', 'Notes': '' };
  s.appendRow(DH_AGENT_COLUMNS.map(k => safeCell(record[k])));
  const row = s.getLastRow();
  const mark = (column, value) => { try { s.getRange(row, col(column) + 1).setValue(value); } catch (e) { log(id, 'AGENT_MARK_FAILED'); } };
  mark('Telegram Sent', dhAgentReviewAlert_(id, key, a));
  mark('Email Sent', dhAgentMail_(id, a.email, 'We received your DwellHunt agent application',
    'Hi ' + a.name + ',\n\nThank you for applying to list properties on DwellHunt as an agent with ' + a.agency + '. Your agent ID is ' + id + '.\n\n' +
    'Our team will check your details, usually within 1 working day, and may call or WhatsApp you on ' + a.phone + '. We will email you as soon as your account is approved.\n\nDwellHunt'));
  return { httpStatus: 200, status: 'pending', duplicate: false };
}

function dhAgentButtons_(id, key, status) {
  const b = (text, op) => ({ text, callback_data: 'A|' + id + '|' + key + '|' + op });
  if (status === 'pending') return { inline_keyboard: [[b('✅ Approve agent', 'a'), b('❌ Reject', 'r')]] };
  if (status === 'approved') return { inline_keyboard: [[b('✅ Approved', 's')], [b('⏸ Suspend', 'x')]] };
  if (status === 'suspended') return { inline_keyboard: [[b('⏸ Suspended', 's')], [b('▶️ Reinstate', 'a')]] };
  return { inline_keyboard: [[b('❌ Rejected', 's')]] };
}
function dhAgentReviewAlert_(id, key, a) {
  if (dhTelegramDisabled_()) { log(id, 'DEV_AGENT_TELEGRAM_SKIPPED'); return 'skipped'; }
  try {
    const h = dhLeadHtml_;
    const lines = ['🧑‍💼 <b>NEW AGENT APPLICATION</b> · ' + h(id), '', '<b>' + h(a.name) + '</b> · ' + h(a.agency),
      '📱 ' + h(a.phone) + dhLeadWhatsApp_(a.phone), '✉️ ' + h(a.email), '🪪 Registration: ' + h(a.registration || 'not given'), '',
      '👉 Before approving, check the agency and call or WhatsApp the agent. Approved agents can sign in and send listings for your review.'];
    tg('sendMessage', { chat_id: dhLeadChat_(), text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: dhAgentButtons_(id, key, 'pending') });
    return now();
  } catch (e) { log(id, 'AGENT_TELEGRAM_FAILED'); return 'failed'; }
}

/** Review buttons: a approve/reinstate, r reject, x suspend, s status. Only the DwellHunt admin chat may use them. */
function dhAgentAction_(q) {
  const parts = String(q.data || '').split('|'), id = parts[1], key = parts[2], op = parts[3];
  const chat = String(dhLeadChat_()), fromChat = q.message && q.message.chat ? String(q.message.chat.id) : '';
  if (fromChat !== chat || (Number(chat) > 0 && String(q.from && q.from.id) !== chat)) fail('UNAUTHORIZED_AGENT', 403);
  const found = dhAgentFind_('Agent ID', id);
  if (!found || !found.r[dhAgentCol_('Review Key')] || !equal(key, found.r[dhAgentCol_('Review Key')])) fail('UNAUTHORIZED_AGENT', 403);
  const current = found.r[dhAgentCol_('Status')];
  if (op === 's') { ack(q, 'Status: ' + current); return { ignored: true }; }
  const next = { a: ['pending', 'suspended'], r: ['pending'], x: ['approved'] }[op];
  if (!next) fail('INVALID_AGENT_ACTION', 400);
  if (next.indexOf(current) < 0) { ack(q, 'Already ' + current + '.'); return { ignored: true }; }
  const status = op === 'a' ? 'approved' : op === 'r' ? 'rejected' : 'suspended', at = now();
  const set = (column, value) => found.s.getRange(found.row, dhAgentCol_(column) + 1).setValue(value);
  set('Status', status); set('Decided At', at);
  const agent = dhAgentProfile_(found.r);
  let mail = '';
  if (status === 'approved') mail = dhAgentMail_(id, agent.email, 'Your DwellHunt agent account is approved',
    'Hi ' + agent.name + ',\n\nGood news: your DwellHunt agent account (' + id + ') is approved.\n\nSign in here with this email address. We will send you a 6-digit code each time, so there is no password to remember:\n' +
    dhAgentSite_() + '/#agents\n\nFrom your dashboard you can send listings for review and see when they go live. Buyer enquiries about your listings are emailed to you.\n\nDwellHunt');
  else if (status === 'rejected') mail = dhAgentMail_(id, agent.email, 'About your DwellHunt agent application',
    'Hi ' + agent.name + ',\n\nThank you for applying to DwellHunt. Unfortunately we could not approve your agent account. If you think this is a mistake, reply to this email or message us on WhatsApp.\n\nDwellHunt');
  if (status === 'suspended') dhAgentRevokeSessions_(id);
  set('Notes', (found.r[dhAgentCol_('Notes')] ? found.r[dhAgentCol_('Notes')] + '\n' : '') + at + ' ' + status +
    (mail && mail !== 'skipped' && mail !== 'failed' ? ' (agent emailed)' : mail === 'failed' ? ' (agent email FAILED)' : ''));
  try { tg('editMessageReplyMarkup', { chat_id: fromChat, message_id: q.message.message_id, reply_markup: dhAgentButtons_(id, key, status) }); }
  catch (e) { log(id, 'AGENT_BUTTON_UPDATE_FAILED'); }
  ack(q, 'Saved: ' + status);
  return { status: 'agent_' + status };
}

/** Emails a sign-in code to an approved agent. The reply never reveals whether an email address has an account. */
function dhAgentCode_(p) {
  const email = clean(p.email, 254).toLowerCase();
  if (!dhAgentEmailOk_(email)) fail('INVALID_REQUEST', 422, ['email']);
  const found = dhAgentFind_('Email', email);
  if (!found || found.r[dhAgentCol_('Status')] !== 'approved') return { httpStatus: 200, status: 'sent' };
  const agent = dhAgentProfile_(found.r), s = dhAgentAuthSheet_(), c = dhAgentAuthCol_, rows = dhAgentRows_(s, DH_AGENT_AUTH_COLUMNS);
  const recent = rows.filter(r => r[c('Agent ID')] === agent.id && r[c('Kind')] === 'code' && Date.parse(r[c('Created')]) > Date.now() - 3600000);
  if (recent.length >= DH_AGENT_CODES_PER_HOUR) { log(agent.id, 'AGENT_CODE_LIMIT'); return { httpStatus: 200, status: 'sent' }; }
  // Only the newest code works.
  rows.forEach((r, i) => { if (r[c('Agent ID')] === agent.id && r[c('Kind')] === 'code' && !r[c('Used At')]) s.getRange(i + 2, c('Used At') + 1).setValue('replaced'); });
  const code = ('00000' + (parseInt(hash(Utilities.getUuid() + Utilities.getUuid()).slice(0, 12), 16) % 1000000)).slice(-6);
  s.appendRow([now(), agent.id, 'code', hash(agent.id + '|code|' + code), new Date(Date.now() + DH_AGENT_CODE_MINUTES * 60000).toISOString(), 0, '']);
  dhAgentMail_(agent.id, agent.email, 'Your DwellHunt sign-in code: ' + code,
    'Hi ' + agent.name + ',\n\nYour DwellHunt sign-in code is:\n\n' + code + '\n\nIt works once and expires in ' + DH_AGENT_CODE_MINUTES + ' minutes. ' +
    'If you did not try to sign in, you can ignore this email; nobody can sign in without this code.\n\nDwellHunt');
  return { httpStatus: 200, status: 'sent' };
}

/** Checks a sign-in code and starts a 30-day session. Only a hash of the code and of the session token is stored. */
function dhAgentVerify_(p) {
  const email = clean(p.email, 254).toLowerCase(), code = clean(p.code, 10).replace(/\s/g, '');
  if (!dhAgentEmailOk_(email) || !/^\d{6}$/.test(code)) fail('INVALID_CODE', 401);
  const found = dhAgentFind_('Email', email);
  if (!found || found.r[dhAgentCol_('Status')] !== 'approved') fail('INVALID_CODE', 401);
  const agent = dhAgentProfile_(found.r), s = dhAgentAuthSheet_(), c = dhAgentAuthCol_, rows = dhAgentRows_(s, DH_AGENT_AUTH_COLUMNS);
  let index = -1;
  rows.forEach((r, i) => { if (r[c('Agent ID')] === agent.id && r[c('Kind')] === 'code' && !r[c('Used At')]) index = i; });
  if (index < 0 || Date.parse(rows[index][c('Expires At')]) <= Date.now()) fail('CODE_EXPIRED', 401);
  const attempts = Number(rows[index][c('Attempts')] || 0);
  if (attempts >= DH_AGENT_CODE_TRIES) fail('CODE_LOCKED', 429);
  if (!equal(hash(agent.id + '|code|' + code), rows[index][c('Secret Hash')])) {
    s.getRange(index + 2, c('Attempts') + 1).setValue(attempts + 1);
    fail(attempts + 1 >= DH_AGENT_CODE_TRIES ? 'CODE_LOCKED' : 'INVALID_CODE', attempts + 1 >= DH_AGENT_CODE_TRIES ? 429 : 401);
  }
  s.getRange(index + 2, c('Used At') + 1).setValue(now());
  const session = token(), expires = new Date(Date.now() + DH_AGENT_SESSION_DAYS * 86400000).toISOString();
  s.appendRow([now(), agent.id, 'session', hash('session|' + session), expires, 0, '']);
  found.s.getRange(found.row, dhAgentCol_('Last Sign In') + 1).setValue(now());
  return { httpStatus: 200, status: 'signed_in', session, expires, agent: { id: agent.id, name: agent.name, agency: agent.agency, email: agent.email, phone: agent.phone } };
}

/** Resolves a session token to an approved agent, or fails with SIGNED_OUT. */
function dhAgentSession_(session) {
  if (typeof session !== 'string' || !/^[a-f0-9]{64}$/.test(session)) fail('SIGNED_OUT', 401);
  const s = dhAgentAuthSheet_(), c = dhAgentAuthCol_, rows = dhAgentRows_(s, DH_AGENT_AUTH_COLUMNS), digest = hash('session|' + session);
  const index = rows.findIndex(r => r[c('Kind')] === 'session' && equal(r[c('Secret Hash')], digest));
  if (index < 0 || rows[index][c('Used At')] || Date.parse(rows[index][c('Expires At')]) <= Date.now()) fail('SIGNED_OUT', 401);
  const found = dhAgentFind_('Agent ID', rows[index][c('Agent ID')]);
  if (!found || found.r[dhAgentCol_('Status')] !== 'approved') fail('SIGNED_OUT', 401);
  return { agent: dhAgentProfile_(found.r), authRow: index + 2, auth: s };
}
function dhAgentRevokeSessions_(id) {
  const s = dhAgentAuthSheet_(), c = dhAgentAuthCol_;
  dhAgentRows_(s, DH_AGENT_AUTH_COLUMNS).forEach((r, i) => { if (r[c('Agent ID')] === id && r[c('Kind')] === 'session' && !r[c('Used At')]) s.getRange(i + 2, c('Used At') + 1).setValue('revoked'); });
}

/** The signed-in agent's profile and listings (newest first). */
function dhAgentMe_(p) {
  const agent = dhAgentSession_(p.session).agent, oc = dhOwnerCol_;
  const listings = dhOwnerRows_(dhOwnerSheet_()).filter(r => r[oc('Agent ID')] === agent.id).reverse().slice(0, 100).map(r => ({
    reference: r[oc('Reference')], title: r[oc('Title')], status: r[oc('Status')], purpose: r[oc('Purpose')], category: r[oc('Category')],
    price: r[oc('Price')], currency: r[oc('Currency')], pricePeriod: r[oc('Price Period')], city: r[oc('City')], sentAt: r[oc('Date')],
    publishedAt: r[oc('Published At')], expiresAt: r[oc('Expires At')] }));
  return { httpStatus: 200, status: 'signed_in', agent: { id: agent.id, name: agent.name, agency: agent.agency, email: agent.email, phone: agent.phone }, listings };
}
function dhAgentSignOut_(p) {
  try { const found = dhAgentSession_(p.session); found.auth.getRange(found.authRow, dhAgentAuthCol_('Used At') + 1).setValue('signed out'); } catch (e) { /* already signed out */ }
  return { httpStatus: 200, status: 'signed_out' };
}

/** A listing from a signed-in agent: the verified agent identity replaces any contact details in the form. */
function dhAgentListing_(p) {
  const agent = dhAgentSession_(p.session).agent;
  const payload = { ...p, owner: { name: agent.name, email: agent.email, phone: agent.phone, preferredContact: 'whatsapp' } };
  payload.publicListing = { ...(p.publicListing || {}), contact: { displayName: agent.agency } };
  return dhOwnerListing_(payload, agent);
}

/** Emails a saved, non-spam buyer enquiry to the agent whose listing it is about. Failures are logged, never lost. */
function dhAgentForwardLead_(lead, scored, id) {
  try {
    if (!/^OL-\d{4}-\d{4}$/.test(lead.propertyId || '')) return '';
    const oc = dhOwnerCol_, listing = dhOwnerRows_(dhOwnerSheet_()).find(r => r[oc('Reference')] === lead.propertyId);
    if (!listing || !listing[oc('Agent ID')]) return '';
    const found = dhAgentFind_('Agent ID', listing[oc('Agent ID')]);
    if (!found || found.r[dhAgentCol_('Status')] !== 'approved') return '';
    const agent = dhAgentProfile_(found.r);
    return dhAgentMail_(id, agent.email, 'New enquiry: ' + (listing[oc('Title')] || lead.propertyId) + ' (' + lead.propertyId + ')',
      'Hi ' + agent.name + ',\n\nA buyer has enquired about your DwellHunt listing ' + lead.propertyId + ' “' + listing[oc('Title')] + '”.\n\n' +
      'Name: ' + lead.name + '\nEmail: ' + (lead.email || '-') + '\nPhone / WhatsApp: ' + (lead.phone || '-') + '\nPriority: ' + scored.priority +
      (lead.preferredDate ? '\nPreferred date: ' + lead.preferredDate : '') + '\n\nMessage:\n' + (lead.message || '-') +
      '\n\nThe buyer agreed that DwellHunt and the listing agent may use these details to reply. Please contact them soon.\n\nDwellHunt');
  } catch (e) { log(id, 'AGENT_LEAD_FORWARD_FAILED'); return 'failed'; }
}
