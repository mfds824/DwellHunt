/* DwellHunt owner Telegram (Phase A3). Verified owners connect with a one-time link (t.me/<bot>?start=<code>, 7 days).
 * DwellHunt stays in the middle: the team forwards screened enquiries and viewing requests with admin commands, the
 * owner answers with buttons or by typing, and everything the owner types goes to the team, never to a buyer.
 * Owners never see the team's Telegram ID. Anyone else who messages the bot gets a short friendly reply.
 * Sending rule: in Production tg() only allows the admin chat, or DH_TG_VERIFIED_CHAT_ for one send that this file
 * has just verified (a connected owner's chat, or the private chat that is talking to the bot right now). */
var DH_TG_VERIFIED_CHAT_ = '';
var DH_OWNER_TG_SHEET = 'DwellHunt_Owner_Telegram';
var DH_OWNER_TG_COLUMNS = ['Reference', 'Connect Code', 'Code Expires', 'Chat ID', 'Telegram Name', 'Connected At', 'Status', 'Last Message At'];
var DH_WHATSAPP_URL = 'https://wa.me/94770153678';

function dhOwnerTgSheet_() { return sheet(DH_OWNER_TG_SHEET, DH_OWNER_TG_COLUMNS); }
function dhOwnerTgCol_(name) { return DH_OWNER_TG_COLUMNS.indexOf(name); }
function dhOwnerTgRows_(s) {
  return s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, DH_OWNER_TG_COLUMNS.length).getDisplayValues().map(r => r.map(v => String(v).replace(/^'/, ''))) : [];
}
/** The username of the bot whose token this script uses, asked from Telegram once and then remembered. */
// The token decides the bot, so no saved name can point owners at a different bot.
function dhBotUsername_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('TELEGRAM_BOT_USERNAME_FROM_TOKEN');
  if (cached) return cached;
  const me = tg('getMe', {});
  if (!me || !/^[A-Za-z0-9_]{5,32}$/.test(me.username || '')) throw new Error('TELEGRAM_FAILED');
  props.setProperty('TELEGRAM_BOT_USERNAME_FROM_TOKEN', me.username);
  return me.username;
}

/** Sends to one chat that the caller has verified; the permission lasts for this single call only. */
function dhTgSendVerified_(chatId, text, markup) {
  if (dhTelegramDisabled_()) { log('', 'DEV_OWNER_TELEGRAM_SKIPPED'); return false; }
  DH_TG_VERIFIED_CHAT_ = String(chatId);
  try {
    const data = { chat_id: String(chatId), text: String(text).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true };
    if (markup) data.reply_markup = markup;
    tg('sendMessage', data); return true;
  } catch (e) { log('', 'OWNER_TG_SEND_FAILED'); return false; }
  finally { DH_TG_VERIFIED_CHAT_ = ''; }
}
function dhAdminSend_(text, markup) {
  if (dhTelegramDisabled_()) return;
  try { const data = { chat_id: dhLeadChat_(), text: String(text).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }; if (markup) data.reply_markup = markup; tg('sendMessage', data); }
  catch (e) { log('', 'ADMIN_TG_SEND_FAILED'); }
}

/** New one-time connect link for a listing (replaces any unused link). Returns '' if the owner is already connected. */
function dhOwnerConnectLink_(reference, force) {
  const s = dhOwnerTgSheet_(), col = dhOwnerTgCol_, rows = dhOwnerTgRows_(s);
  const index = rows.findIndex(r => r[col('Reference')] === reference);
  if (index >= 0 && rows[index][col('Status')] === 'connected' && !force) return '';
  const code = 'c' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  if (index < 0) s.appendRow([reference, code, expires, '', '', '', 'link sent', ''].map(safeCell));
  else {
    const row = index + 2;
    s.getRange(row, col('Connect Code') + 1).setValue(code);
    s.getRange(row, col('Code Expires') + 1).setValue(expires);
    if (rows[index][col('Status')] !== 'connected') s.getRange(row, col('Status') + 1).setValue('link sent');
  }
  return 'https://t.me/' + dhBotUsername_() + '?start=' + code;
}

/** The connected chat for a listing, or ''. */
function dhOwnerChat_(reference) {
  const col = dhOwnerTgCol_;
  const r = dhOwnerTgRows_(dhOwnerTgSheet_()).find(x => x[col('Reference')] === reference && x[col('Status')] === 'connected' && x[col('Chat ID')]);
  return r ? r[col('Chat ID')] : '';
}
/** Message a listing's owner on Telegram if they are connected. */
function dhOwnerNotify_(reference, text, markup) {
  try { const chat = dhOwnerChat_(reference); return chat ? dhTgSendVerified_(chat, text, markup) : false; }
  catch (e) { log(reference, 'OWNER_NOTIFY_FAILED'); return false; }
}
function dhOwnerOwnerButtons_(reference, status) {
  const b = (text, op) => ({ text, callback_data: 'M|' + reference + '|' + op });
  return status === 'published' || status === 'expired' ? { inline_keyboard: [[b('🔁 Renew 1 month', 'n'), b('🏁 Rented / sold', 'x')]] } : undefined;
}
function dhOwnerListingRow_(reference) {
  const col = dhOwnerCol_, r = dhOwnerRows_(dhOwnerSheet_()).find(x => x[col('Reference')] === reference);
  if (!r) return null;
  let pub = {}; try { pub = JSON.parse(r[col('Public Listing')]); } catch (e) { pub = { title: r[col('Title')] }; }
  return { reference, status: r[col('Status')], expires: r[col('Expires At')], key: r[col('Review Key')], title: pub.title || r[col('Title')], pub };
}
function dhOwnerWelcome_(name, listings) {
  const h = dhLeadHtml_;
  return ['👋 <b>Welcome' + (name ? ', ' + h(name) : '') + '!</b>', '',
    'You are now connected to DwellHunt for:', listings.map(l => '🏠 ' + h(l.title) + ' (' + h(l.reference) + ')').join('\n'), '',
    '<b>How it works</b>',
    '📩 When a buyer or tenant enquires, DwellHunt checks them first, then sends the enquiry here.',
    '📅 Viewing requests come with buttons: ✅ Accept, 🕑 Suggest another time or ❌ Decline.',
    '💬 To reply to DwellHunt, just type a message here.',
    '📋 /mylistings shows your listings, when they end, and buttons to renew or mark them rented or sold.',
    '❓ /help shows this message again.', '',
    '🔒 Your phone number stays private. Buyers never see it.'].join('\n');
}
function dhStrangerReply_() {
  const site = cfg('WEBSITE_URL', 'https://mfds824.github.io/DwellHunt/').replace(/\/?$/, '/');
  return ['👋 Hi! This is the DwellHunt assistant.', '',
    '🏠 Looking for a home? Browse verified listings at ' + site, '📝 Want to list your property? It is free: ' + site,
    '💬 For anything else, message our team on WhatsApp: ' + DH_WHATSAPP_URL, '',
    'Already listed with us? Open the Telegram link from your “listing is now live” email to connect.'].join('\n');
}

/** Entry point for text messages sent to the bot. */
function dhTelegramMessage_(m) {
  if (!m || !m.chat || m.chat.type !== 'private' || (m.from && m.from.is_bot)) return { ignored: true };
  const chat = String(m.chat.id), text = typeof m.text === 'string' ? m.text.trim().slice(0, 2000) : '';
  const start = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})$/.exec(text);
  if (start) return dhOwnerConnect_(chat, start[1], m.from || {});
  if (chat === String(dhLeadChat_()) && (!m.from || String(m.from.id) === chat)) return dhAdminCommand_(text);
  const col = dhOwnerTgCol_;
  const mine = dhOwnerTgRows_(dhOwnerTgSheet_()).filter(r => r[col('Chat ID')] === chat && r[col('Status')] === 'connected')
    .map(r => dhOwnerListingRow_(r[col('Reference')])).filter(Boolean);
  if (!mine.length) { dhTgSendVerified_(chat, dhStrangerReply_()); return { status: 'stranger_replied' }; }
  const h = dhLeadHtml_;
  if (/^\/(start|help)\b/.test(text)) { dhTgSendVerified_(chat, dhOwnerWelcome_('', mine)); return { status: 'owner_help' }; }
  if (/^\/mylistings\b/.test(text)) {
    mine.forEach(l => {
      const live = l.status === 'published' ? '🟢 Live until ' + h(dhOwnerDateText_(l.expires)) : l.status === 'expired' ? '⌛ Ended' : '⚪ ' + h(l.status);
      dhTgSendVerified_(chat, '🏠 <b>' + h(l.title) + '</b>\n' + h(l.reference) + ' · ' + live, dhOwnerOwnerButtons_(l.reference, l.status));
    });
    return { status: 'owner_listings_shown' };
  }
  if (!text) { dhTgSendVerified_(chat, 'Please send text messages here. For photos or documents, use WhatsApp: ' + DH_WHATSAPP_URL); return { status: 'owner_non_text' }; }
  const refs = mine.map(l => l.reference);
  dhAdminSend_('💬 <b>Owner message</b> · ' + h(refs.join(', ')) + '\n' + h(mine[0].title) + '\n\n' + h(text) + '\n\nReply: /reply ' + h(refs[0]) + ' your message');
  dhTgSendVerified_(chat, '✅ Thanks, your message has been passed to the DwellHunt team.');
  dhOwnerTgTouch_(chat);
  return { status: 'owner_message_forwarded' };
}
function dhOwnerTgTouch_(chat) {
  const s = dhOwnerTgSheet_(), col = dhOwnerTgCol_;
  dhOwnerTgRows_(s).forEach((r, i) => { if (r[col('Chat ID')] === chat) s.getRange(i + 2, col('Last Message At') + 1).setValue(now()); });
}

function dhOwnerConnect_(chat, code, from) {
  const s = dhOwnerTgSheet_(), col = dhOwnerTgCol_, rows = dhOwnerTgRows_(s);
  const index = rows.findIndex(r => r[col('Connect Code')] && equal(code, r[col('Connect Code')]));
  const r = index >= 0 ? rows[index] : null;
  const listing = r && dhOwnerListingRow_(r[col('Reference')]);
  if (!r || !(Date.parse(r[col('Code Expires')]) > Date.now()) || !listing || ['published', 'expired'].indexOf(listing.status) < 0) {
    dhTgSendVerified_(chat, '⚠️ This link has expired or was already used. Message DwellHunt on WhatsApp for a new one: ' + DH_WHATSAPP_URL);
    log('', 'OWNER_CONNECT_REJECTED');
    return { status: 'owner_connect_rejected' };
  }
  const row = index + 2, name = clean(from.first_name, 40).replace(/[<>]/g, '');
  s.getRange(row, col('Connect Code') + 1).setValue('');
  s.getRange(row, col('Code Expires') + 1).setValue('');
  s.getRange(row, col('Chat ID') + 1).setValue("'" + chat);
  s.getRange(row, col('Telegram Name') + 1).setValue(safeCell(name));
  s.getRange(row, col('Connected At') + 1).setValue(now());
  s.getRange(row, col('Status') + 1).setValue('connected');
  const mine = dhOwnerTgRows_(s).filter(x => x[col('Chat ID')] === chat && x[col('Status')] === 'connected')
    .map(x => dhOwnerListingRow_(x[col('Reference')])).filter(Boolean);
  dhTgSendVerified_(chat, dhOwnerWelcome_(name, mine));
  dhAdminSend_('🔗 <b>Owner connected on Telegram</b> · ' + dhLeadHtml_(listing.reference) + '\n' + dhLeadHtml_(listing.title) +
    '\n\n/fwd ' + dhLeadHtml_(listing.reference) + ' enquiry text\n/view ' + dhLeadHtml_(listing.reference) + ' viewing details\n/reply ' + dhLeadHtml_(listing.reference) + ' message');
  return { status: 'owner_connected' };
}

var DH_ADMIN_HELP_ = ['🛠 <b>Owner listing commands</b>', '',
  '/fwd OL-2611-0001 text: send a screened enquiry to the owner (buttons: still available / not available)',
  '/view OL-2611-0001 details: send a viewing request (buttons: accept / suggest another time / decline)',
  '/reply OL-2611-0001 text: send the owner a message from DwellHunt',
  '/link OL-2611-0001: make a new one-time Telegram link for the owner',
  '/owners: list connected owners'].join('\n');

function dhAdminCommand_(text) {
  const h = dhLeadHtml_;
  const m = /^\/(fwd|view|reply|link)(?:@\w+)?\s+(OL-\d{4}-\d{4})\s*([\s\S]*)$/i.exec(text);
  if (/^\/owners\b/.test(text)) {
    const col = dhOwnerTgCol_;
    const rows = dhOwnerTgRows_(dhOwnerTgSheet_()).filter(r => r[col('Status')] === 'connected');
    dhAdminSend_(rows.length ? '🔗 <b>Connected owners</b>\n' + rows.map(r => '• ' + h(r[col('Reference')]) + ' · ' + h(r[col('Telegram Name')] || 'owner')).join('\n') : 'No owners are connected yet.');
    return { status: 'admin_owners' };
  }
  if (!m) { if (/^\//.test(text)) dhAdminSend_(DH_ADMIN_HELP_); return { status: 'admin_help' }; }
  const cmd = m[1].toLowerCase(), reference = m[2].toUpperCase(), body = m[3].trim().slice(0, 1500);
  const listing = dhOwnerListingRow_(reference);
  if (!listing) { dhAdminSend_('⚠️ ' + h(reference) + ' was not found.'); return { status: 'admin_not_found' }; }
  if (cmd === 'link') {
    if (['published', 'expired'].indexOf(listing.status) < 0) { dhAdminSend_('⚠️ ' + h(reference) + ' is ' + h(listing.status) + '. Publish it first.'); return { status: 'admin_link_refused' }; }
    const link = dhOwnerConnectLink_(reference, true);
    dhAdminSend_('🔗 New one-time link for ' + h(reference) + ' (expires in 7 days):\n' + h(link));
    return { status: 'admin_link' };
  }
  if (!body) { dhAdminSend_('⚠️ Add the text after the reference, e.g. /' + cmd + ' ' + h(reference) + ' …'); return { status: 'admin_missing_text' }; }
  const chat = dhOwnerChat_(reference);
  if (!chat) { dhAdminSend_('⚠️ The owner of ' + h(reference) + ' has not connected Telegram yet. /link ' + h(reference) + ' makes a link to send them.'); return { status: 'admin_not_connected' }; }
  const b = (label, op) => ({ text: label, callback_data: 'M|' + reference + '|' + op });
  let sent;
  if (cmd === 'fwd') sent = dhTgSendVerified_(chat, '📩 <b>New enquiry</b> · ' + h(listing.title) + '\n\n' + h(body) + '\n\nDwellHunt has checked this enquiry. Is the property still available?',
    { inline_keyboard: [[b('✅ Still available', 'a'), b('❌ Not available', 'u')]] });
  else if (cmd === 'view') sent = dhTgSendVerified_(chat, '📅 <b>Viewing request</b> · ' + h(listing.title) + '\n\n' + h(body),
    { inline_keyboard: [[b('✅ Accept', 'y'), b('❌ Decline', 'd')], [b('🕑 Suggest another time', 't')]] });
  else sent = dhTgSendVerified_(chat, '💬 <b>Message from DwellHunt</b>\n\n' + h(body));
  dhAdminSend_(sent ? '✅ Sent to the owner of ' + h(reference) + '.' : '⚠️ Could not reach the owner of ' + h(reference) + ' on Telegram. Try WhatsApp.');
  return { status: sent ? 'admin_' + cmd + '_sent' : 'admin_send_failed' };
}

/** Buttons pressed by an owner: a/u enquiry answer, y/t/d viewing answer, n renew, x rented or sold, s status. */
function dhOwnerTgAction_(q) {
  const parts = String(q.data || '').split('|'), reference = parts[1], op = parts[2];
  const fromChat = q.message && q.message.chat ? String(q.message.chat.id) : '';
  const chat = /^OL-\d{4}-\d{4}$/.test(reference || '') ? dhOwnerChat_(reference) : '';
  if (!chat || fromChat !== chat || String(q.from && q.from.id) !== chat) fail('UNAUTHORIZED_AGENT', 403);
  const listing = dhOwnerListingRow_(reference);
  if (!listing) fail('UNAUTHORIZED_AGENT', 403);
  const h = dhLeadHtml_, original = String(q.message.text || '').slice(0, 1500);
  const done = label => { try { tg('editMessageReplyMarkup', { chat_id: fromChat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: label, callback_data: 'M|' + reference + '|s' }]] } }); } catch (e) { log(reference, 'OWNER_BUTTON_UPDATE_FAILED'); } };
  const head = h(reference) + ' · ' + h(listing.title);
  if (op === 's') { ack(q, 'Already answered.'); return { ignored: true }; }
  if (op === 'a' || op === 'u') {
    done(op === 'a' ? '✅ You said: still available' : '❌ You said: not available');
    dhAdminSend_((op === 'a' ? '✅ <b>Owner: still available</b> · ' : '❌ <b>Owner: not available</b> · ') + head + '\n\n' + h(original));
    if (op === 'u') dhTgSendVerified_(chat, 'Thanks for letting us know. Is it rented or sold? Tap below to take the listing down.', { inline_keyboard: [[{ text: '🏁 Take my listing down', callback_data: 'M|' + reference + '|x' }]] });
    ack(q, 'Thanks, DwellHunt has been told.');
    return { status: op === 'a' ? 'owner_still_available' : 'owner_not_available' };
  }
  if (op === 'y' || op === 'd' || op === 't') {
    done(op === 'y' ? '✅ You accepted this viewing' : op === 'd' ? '❌ You declined this viewing' : '🕑 You asked for another time');
    dhAdminSend_({ y: '✅ <b>Owner ACCEPTED the viewing</b> · ', d: '❌ <b>Owner declined the viewing</b> · ', t: '🕑 <b>Owner wants another time</b> · ' }[op] + head + '\n\n' + h(original) +
      (op === 't' ? '\n\nThe owner was asked to type the times that suit them.' : '\n\nPlease confirm with the buyer.'));
    if (op === 't') dhTgSendVerified_(chat, 'Please type the days and times that suit you, and DwellHunt will arrange it with the visitor.');
    ack(q, 'Thanks, DwellHunt has been told.');
    return { status: { y: 'owner_viewing_accepted', d: 'owner_viewing_declined', t: 'owner_viewing_other_time' }[op] };
  }
  if (op === 'n' || op === 'x') {
    const result = dhOwnerApply_(reference, op, 'owner');
    if (result.ignored) { ack(q, 'This listing is ' + result.status + '.'); return { ignored: true }; }
    done(op === 'n' ? '🔁 Renewed until ' + dhOwnerDateText_(result.expires) : '🏁 Listing closed');
    dhTgSendVerified_(chat, op === 'n' ? '🔁 Done! <b>' + h(listing.title) + '</b> stays live until ' + h(dhOwnerDateText_(result.expires)) + '.'
      : '🏁 Done. <b>' + h(listing.title) + '</b> is no longer shown. Congratulations, and thank you for using DwellHunt!');
    dhAdminSend_((op === 'n' ? '🔁 <b>Owner renewed</b> · ' : '🏁 <b>Owner closed the listing (rented / sold)</b> · ') + head);
    ack(q, op === 'n' ? 'Renewed.' : 'Closed.');
    return { status: op === 'n' ? 'owner_renewed' : 'owner_closed' };
  }
  fail('INVALID_AGENT_ACTION', 400);
}
