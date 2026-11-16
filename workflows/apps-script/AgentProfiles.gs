/* DwellHunt public agent profiles, posts and 24-hour stories (built on Agents.gs).
 * Signed-in agents edit one profile (bio, areas, logo) and publish posts or stories, which go live at once; the
 * DwellHunt admin gets a Telegram note with a Remove button (callback P|postId|key|x). Buyers see public profiles
 * and the stories strip; agent email and phone are never public, and "Contact" goes through the DwellHunt lead form.
 * Gateway actions: agent_profile_save, agent_post, agent_post_delete (session), agents_public, agent_public (read-only). */
var DH_PROFILE_SHEET = 'DwellHunt_Agent_Profiles';
var DH_PROFILE_COLUMNS = ['Agent ID', 'Bio', 'Areas', 'Logo URL', 'Updated At'];
var DH_POST_SHEET = 'DwellHunt_Agent_Posts';
var DH_POST_COLUMNS = ['Date', 'Post ID', 'Agent ID', 'Kind', 'Caption', 'Photo URL', 'Listing Ref', 'Status', 'Expires At', 'Review Key', 'Telegram Sent', 'Removed At'];
var DH_POSTS_PER_DAY = 20, DH_STORY_HOURS = 24;

function dhProfileSheet_() { return sheet(DH_PROFILE_SHEET, DH_PROFILE_COLUMNS); }
function dhPostSheet_() { return sheet(DH_POST_SHEET, DH_POST_COLUMNS); }
function dhPostCol_(name) { return DH_POST_COLUMNS.indexOf(name); }
/** Plain text only: no tags, no web links (links in posts are a spam magnet). */
function dhPublicText_(value, max) {
  return clean(String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' '), max)
    .replace(/[<>]/g, '').replace(/\b(https?:\/\/|www\.)\S+/gi, '').replace(/[ \t]+/g, ' ').trim();
}
function dhProfileOf_(agentId) {
  const r = dhAgentRows_(dhProfileSheet_(), DH_PROFILE_COLUMNS).find(x => x[0] === agentId);
  return r ? { bio: r[1], areas: r[2] ? r[2].split('|').filter(Boolean) : [], logo: dhOwnerSafeUrl_(r[3]) ? r[3] : '' } : { bio: '', areas: [], logo: '' };
}

function dhAgentProfileSave_(p) {
  const agent = dhAgentSession_(p.session).agent;
  const bio = dhPublicText_(p.bio, 600);
  const areas = (Array.isArray(p.areas) ? p.areas : []).map(a => dhPublicText_(a, 40)).filter(Boolean).slice(0, 8);
  const logo = p.logo === '' || p.logo == null ? '' : String(p.logo);
  if (logo && !dhOwnerSafeUrl_(logo)) fail('INVALID_REQUEST', 422, ['logo']);
  const s = dhProfileSheet_(), rows = dhAgentRows_(s, DH_PROFILE_COLUMNS), i = rows.findIndex(r => r[0] === agent.id);
  const values = [agent.id, bio, areas.join('|'), logo, now()].map(safeCell);
  if (i < 0) s.appendRow(values); else s.getRange(i + 2, 1, 1, values.length).setValues([values]);
  return { httpStatus: 200, status: 'saved' };
}

function dhAgentPost_(p) {
  const agent = dhAgentSession_(p.session).agent;
  const kind = p.kind === 'story' ? 'story' : 'post';
  const caption = dhPublicText_(p.caption, 500), photo = p.photo ? String(p.photo) : '';
  const invalid = [];
  if (!caption && !photo) invalid.push('caption');
  if (photo && !dhOwnerSafeUrl_(photo)) invalid.push('photo');
  if (kind === 'story' && !photo) invalid.push('photo');
  let listingRef = clean(p.listingRef, 20);
  if (listingRef) {
    const oc = dhOwnerCol_, own = dhOwnerRows_(dhOwnerSheet_()).find(r => r[oc('Reference')] === listingRef && r[oc('Agent ID')] === agent.id);
    if (!own) listingRef = '';
  }
  if (invalid.length) fail('INVALID_REQUEST', 422, invalid);
  const s = dhPostSheet_(), col = dhPostCol_, rows = dhAgentRows_(s, DH_POST_COLUMNS);
  if (rows.filter(r => r[col('Agent ID')] === agent.id && Date.parse(r[col('Date')]) > Date.now() - 86400000).length >= DH_POSTS_PER_DAY) fail('RATE_LIMITED', 429);
  const id = 'PS-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), key = Utilities.getUuid().replace(/-/g, '').slice(0, 12), at = now();
  const expires = kind === 'story' ? new Date(Date.now() + DH_STORY_HOURS * 3600000).toISOString() : '';
  s.appendRow([at, id, agent.id, kind, caption, photo, listingRef, 'live', expires, key, '', ''].map(safeCell));
  const row = s.getLastRow();
  let sent = 'skipped';
  if (!dhTelegramDisabled_()) {
    try {
      const h = dhLeadHtml_;
      tg('sendMessage', { chat_id: dhLeadChat_(), parse_mode: 'HTML', disable_web_page_preview: true,
        text: ['📣 <b>NEW AGENT ' + (kind === 'story' ? 'STORY' : 'POST') + '</b> · ' + h(agent.agency) + ' (' + h(agent.id) + ')', '',
          h(caption || '(photo only)'), photo ? '📷 <a href="' + h(photo) + '">photo</a>' : '', listingRef ? '🏠 ' + h(listingRef) : '', '',
          'It is live now. Remove it if it breaks the rules.'].filter(x => x !== '').join('\n'),
        reply_markup: { inline_keyboard: [[{ text: '🗑 Remove', callback_data: 'P|' + id + '|' + key + '|x' }]] } });
      sent = now();
    } catch (e) { log(id, 'POST_TELEGRAM_FAILED'); sent = 'failed'; }
  }
  try { s.getRange(row, col('Telegram Sent') + 1).setValue(sent); } catch (e) { log(id, 'POST_MARK_FAILED'); }
  return { httpStatus: 200, status: 'posted', reference: id };
}

function dhPostRemove_(s, index, by) {
  const col = dhPostCol_;
  s.getRange(index + 2, col('Status') + 1).setValue('removed');
  s.getRange(index + 2, col('Removed At') + 1).setValue(now() + ' (' + by + ')');
}
function dhAgentPostDelete_(p) {
  const agent = dhAgentSession_(p.session).agent;
  const s = dhPostSheet_(), col = dhPostCol_, rows = dhAgentRows_(s, DH_POST_COLUMNS);
  const i = rows.findIndex(r => r[col('Post ID')] === clean(p.postId, 20) && r[col('Agent ID')] === agent.id);
  if (i < 0) fail('NOT_FOUND', 404);
  if (rows[i][col('Status')] === 'live') dhPostRemove_(s, i, 'agent');
  return { httpStatus: 200, status: 'removed' };
}
/** Admin Remove button. Only the DwellHunt admin chat with the right key may use it. */
function dhPostAction_(q) {
  const parts = String(q.data || '').split('|'), id = parts[1], key = parts[2];
  const chat = String(dhLeadChat_()), fromChat = q.message && q.message.chat ? String(q.message.chat.id) : '';
  if (fromChat !== chat || (Number(chat) > 0 && String(q.from && q.from.id) !== chat)) fail('UNAUTHORIZED_AGENT', 403);
  const s = dhPostSheet_(), col = dhPostCol_, rows = dhAgentRows_(s, DH_POST_COLUMNS);
  const i = rows.findIndex(r => r[col('Post ID')] === id);
  if (i < 0 || !equal(key, rows[i][col('Review Key')])) fail('UNAUTHORIZED_AGENT', 403);
  if (rows[i][col('Status')] === 'live') dhPostRemove_(s, i, 'admin');
  try { tg('editMessageReplyMarkup', { chat_id: fromChat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: '🗑 Removed', callback_data: 'P|' + id + '|' + key + '|s' }]] } }); }
  catch (e) { log(id, 'POST_BUTTON_UPDATE_FAILED'); }
  ack(q, 'Removed');
  return { status: 'post_removed' };
}

/** Live posts and unexpired stories, newest first, with the agent's public details only. */
function dhPublicPosts_(agentId) {
  const col = dhPostCol_, nowMs = Date.now();
  return dhAgentRows_(dhPostSheet_(), DH_POST_COLUMNS).filter(r => r[col('Status')] === 'live' && (!agentId || r[col('Agent ID')] === agentId) &&
      (r[col('Kind')] !== 'story' || Date.parse(r[col('Expires At')]) > nowMs))
    .reverse().map(r => ({ id: r[col('Post ID')], agentId: r[col('Agent ID')], kind: r[col('Kind')], caption: r[col('Caption')],
      photo: dhOwnerSafeUrl_(r[col('Photo URL')]) ? r[col('Photo URL')] : '', listingRef: r[col('Listing Ref')], at: r[col('Date')], expiresAt: r[col('Expires At')] }));
}
function dhPublicAgent_(r, profile) {
  const c = dhAgentCol_;
  return { id: r[c('Agent ID')], name: r[c('Name')], agency: r[c('Agency')], bio: profile.bio, areas: profile.areas, logo: profile.logo, verified: true };
}
/** Directory and stories strip: approved agents with their latest stories. */
function dhAgentsPublic_() {
  const agents = dhAgentRows_(dhAgentSheet_(), DH_AGENT_COLUMNS).filter(r => r[dhAgentCol_('Status')] === 'approved');
  const ids = agents.map(r => r[dhAgentCol_('Agent ID')]);
  const posts = dhPublicPosts_('').filter(x => ids.indexOf(x.agentId) >= 0);
  const live = dhOwnerListingsPublic_().listings;
  return { httpStatus: 200, agents: agents.map(r => {
    const a = dhPublicAgent_(r, dhProfileOf_(r[dhAgentCol_('Agent ID')]));
    a.listingCount = live.filter(l => l.agentId === a.id).length;
    a.stories = posts.filter(x => x.agentId === a.id && x.kind === 'story').slice(0, 10);
    return a;
  }) };
}
/** One public profile: details, stories, posts and live listings. */
function dhAgentPublic_(p) {
  const id = clean(p.id, 20);
  const r = dhAgentRows_(dhAgentSheet_(), DH_AGENT_COLUMNS).find(x => x[dhAgentCol_('Agent ID')] === id && x[dhAgentCol_('Status')] === 'approved');
  if (!r) fail('NOT_FOUND', 404);
  const a = dhPublicAgent_(r, dhProfileOf_(id)), posts = dhPublicPosts_(id);
  a.stories = posts.filter(x => x.kind === 'story').slice(0, 10);
  a.posts = posts.filter(x => x.kind === 'post').slice(0, 30);
  a.listings = dhOwnerListingsPublic_().listings.filter(l => l.agentId === id);
  return { httpStatus: 200, agent: a };
}
/** The signed-in agent's own profile and posts, for the dashboard. */
function dhAgentMyPosts_(agentId) {
  const col = dhPostCol_, nowMs = Date.now();
  return dhAgentRows_(dhPostSheet_(), DH_POST_COLUMNS).filter(r => r[col('Agent ID')] === agentId && r[col('Status')] === 'live')
    .reverse().slice(0, 50).map(r => ({ id: r[col('Post ID')], kind: r[col('Kind')], caption: r[col('Caption')], photo: r[col('Photo URL')],
      at: r[col('Date')], expired: r[col('Kind')] === 'story' && Date.parse(r[col('Expires At')]) <= nowMs }));
}
