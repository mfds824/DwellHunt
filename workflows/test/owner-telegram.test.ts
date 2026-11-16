import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (f: string) => readFileSync(new URL('../apps-script/' + f, import.meta.url), 'utf8');
const source = ['Code.gs', 'Leads.gs', 'OwnerListings.gs', 'OwnerTelegram.gs'].map(read).join('\n');
const ADMIN = '8394706632', OWNER = '5550001', STRANGER = '7770002';

function fakeSheet() {
  const rows: any[][] = [];
  return {
    rows, getLastRow: () => rows.length, appendRow: (r: any[]) => { rows.push([...r]); },
    getRange: (row: number, column: number, nr = 1, nc = 1) => ({
      getDisplayValues: () => rows.slice(row - 1, row - 1 + nr).map(r => r.slice(column - 1, column - 1 + nc).map(v => String(v ?? ''))),
      setValue: (v: any) => { rows[row - 1][column - 1] = v; },
    }),
  };
}

/** Production context with the REAL tg() send guard; only the Telegram HTTP call itself is faked. */
function harness() {
  const store: Record<string, string> = { LIVE_TELEGRAM_ID: ADMIN, LIVE_WEBSITE_URL: 'https://site.example.test/', TELEGRAM_BOT_TOKEN: 'test-token' };
  const sent: { method: string; data: any }[] = [], mail: any[] = [], logs: string[] = [];
  const sheets: Record<string, any> = {};
  let uuid = 0;
  const context: any = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => store[k] ?? null, setProperty: (k: string, v: string) => { store[k] = v; } }) },
    MailApp: { sendEmail: (m: any) => { mail.push(m); } },
    Utilities: { formatDate: (d: Date, _tz: string, f: string) => f === 'yyMM' ? '2611' : d.toISOString().slice(0, 10),
      getUuid: () => { uuid++; return `${String(uuid).padStart(8, '0')}-1111-2222-3333-444455556666`; } },
    UrlFetchApp: { fetch: (url: string, opts: any) => {
      assert.match(url, /^https:\/\/api\.telegram\.org\/bottest-token\//);
      sent.push({ method: url.split('/').pop()!, data: JSON.parse(opts.payload) });
      return { getContentText: () => JSON.stringify({ ok: true, result: url.endsWith('/getMe') ? { username: 'DwellHuntViewingStagingBot' } : {} }) };
    } },
  };
  runInNewContext(source, context);
  context.sheet = (name: string, cols: string[]) => { const s = sheets[name] ||= fakeSheet(); if (!s.rows.length) s.rows.push(cols); return s; };
  context.log = (_id: string, code: string) => logs.push(code);
  context.DH_VIEWING_CONTEXT_ = 'production';
  const messages = (chat: string) => sent.filter(x => x.method === 'sendMessage' && x.data.chat_id === chat).map(x => x.data);
  return { c: context, sent, mail, logs, sheets, messages };
}

const photo = { url: 'https://res.cloudinary.com/demo/image/upload/p1.jpg' };
const submission = { selection: { listingRole: 'owner', listingPurpose: 'rent', propertyCategory: 'apartment' },
  owner: { name: 'Nimal Perera', email: 'nimal@example.test', phone: '+94771234567', preferredContact: 'whatsapp' },
  privateLocation: { district: 'Colombo', city: 'Colombo 05', street: '12 Private Lane', building: '', unit: '' },
  publicListing: { title: '2-Bedroom Apartment for Rent in Colombo 05', purpose: 'rent', category: 'apartment', price: 150000, currency: 'LKR',
    billingPeriod: 'month', location: { district: 'Colombo', city: 'Colombo 05' }, photos: [photo], contact: { via: 'DwellHunt', displayName: 'Private owner' } },
  confirmations: { authorized: true, accurate: true, photoPermission: true }, consent: true, draftId: 'draft-1' };
const msg = (chat: string, text: string, extra: any = {}) => ({ message: { message_id: 1, text, chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat), first_name: 'Nimal', is_bot: false }, ...extra } });
const press = (chat: string, data: string) => ({ callback_query: { id: 'cb', data, from: { id: Number(chat) }, message: { message_id: 9, text: 'original message', chat: { id: Number(chat) } } } });

function publishedAndConnected() {
  const h = harness();
  const { reference } = h.c.dhOwnerListing_(submission);
  const key = h.sheets.DwellHunt_Owner_Listings.rows[1][h.c.DH_OWNER_COLUMNS.indexOf('Review Key')];
  h.c.agentAction(press(ADMIN, `O|${reference}|${key}|p`));
  const link = /https:\/\/t\.me\/DwellHuntViewingStagingBot\?start=([A-Za-z0-9_-]+)/.exec(h.mail.at(-1).body)!;
  return { ...h, reference, key, code: link[1] };
}

test('publishing emails the owner a one-time Telegram link and shows it to the admin', () => {
  const { mail, messages, code, reference } = publishedAndConnected();
  assert.match(mail.at(-1).subject, /is now live/);
  assert.match(mail.at(-1).body, /works once and expires in 7 days/);
  assert.ok(code.length >= 30);
  assert.ok(messages(ADMIN).some(m => m.text.includes('Owner Telegram link') && m.text.includes(code) && m.text.includes(reference)));
  assert.doesNotMatch(mail.at(-1).body, new RegExp(ADMIN), 'the admin Telegram ID is never shared');
});

test('an owner connects once with the link and gets instructions; a reused or wrong link is refused', () => {
  const h = publishedAndConnected();
  assert.equal(h.c.agentAction(msg(OWNER, '/start ' + h.code)).status, 'owner_connected');
  const welcome = h.messages(OWNER).at(-1).text;
  assert.match(welcome, /Welcome, Nimal[\s\S]*2-Bedroom Apartment[\s\S]*Accept[\s\S]*\/mylistings[\s\S]*phone number stays private/);
  assert.ok(h.messages(ADMIN).some(m => /Owner connected on Telegram/.test(m.text)));
  assert.equal(h.c.agentAction(msg(STRANGER, '/start ' + h.code)).status, 'owner_connect_rejected', 'one-time');
  assert.match(h.messages(STRANGER).at(-1).text, /expired or was already used/);
  assert.equal(h.c.agentAction(msg(STRANGER, '/start cWRONGCODE12345678')).status, 'owner_connect_rejected');
});

test('expired links and unpublished listings cannot be connected', () => {
  const h = publishedAndConnected();
  const s = h.sheets.DwellHunt_Owner_Telegram, col = h.c.DH_OWNER_TG_COLUMNS;
  s.rows[1][col.indexOf('Code Expires')] = new Date(Date.now() - 1000).toISOString();
  assert.equal(h.c.agentAction(msg(OWNER, '/start ' + h.code)).status, 'owner_connect_rejected');
  const p = harness();
  p.c.dhOwnerListing_(submission);
  assert.equal(p.c.dhAdminCommand_('/link OL-2611-0001').status, 'admin_link_refused');
  assert.match(p.messages(ADMIN).at(-1).text, /Publish it first/);
});

test('strangers get a friendly reply; groups and bots are ignored; the guard blocks unverified chats', () => {
  const h = publishedAndConnected();
  assert.equal(h.c.agentAction(msg(STRANGER, 'hello')).status, 'stranger_replied');
  assert.match(h.messages(STRANGER).at(-1).text, /DwellHunt assistant[\s\S]*wa\.me\/94770153678/);
  assert.equal(h.c.agentAction({ message: { text: 'hi', chat: { id: -100, type: 'group' }, from: { id: 1 } } }).ignored, true);
  assert.equal(h.c.agentAction({ message: { text: 'hi', chat: { id: 5, type: 'private' }, from: { id: 5, is_bot: true } } }).ignored, true);
  assert.throws(() => h.c.tg('sendMessage', { chat_id: STRANGER, text: 'x' }), /PRODUCTION_ROUTING_REQUIRED/);
  assert.equal(h.c.DH_TG_VERIFIED_CHAT_, '', 'permission is cleared after each send');
});

test('admin forwards an enquiry and a viewing request; owner buttons and replies come back to the admin', () => {
  const h = publishedAndConnected();
  h.c.agentAction(msg(OWNER, '/start ' + h.code));
  assert.equal(h.c.agentAction(msg(ADMIN, '/fwd OL-2611-0001 Family of four, moving in January, budget fits.')).status, 'admin_fwd_sent');
  const enquiry = h.messages(OWNER).at(-1);
  assert.match(enquiry.text, /New enquiry[\s\S]*Family of four/);
  assert.deepEqual(enquiry.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data), ['M|OL-2611-0001|a', 'M|OL-2611-0001|u']);
  assert.equal(h.c.agentAction(press(OWNER, 'M|OL-2611-0001|a')).status, 'owner_still_available');
  assert.match(h.messages(ADMIN).at(-1).text, /Owner: still available/);
  h.c.agentAction(msg(ADMIN, '/view OL-2611-0001 Saturday 10:00, Mr Silva'));
  assert.match(h.messages(OWNER).at(-1).text, /Viewing request[\s\S]*Saturday 10:00/);
  assert.equal(h.c.agentAction(press(OWNER, 'M|OL-2611-0001|t')).status, 'owner_viewing_other_time');
  assert.match(h.messages(OWNER).at(-1).text, /type the days and times/);
  assert.equal(h.c.agentAction(msg(OWNER, 'Sunday after 3pm works')).status, 'owner_message_forwarded');
  assert.match(h.messages(ADMIN).at(-1).text, /Owner message[\s\S]*Sunday after 3pm works[\s\S]*\/reply OL-2611-0001/);
  h.c.agentAction(msg(ADMIN, '/reply OL-2611-0001 Sunday 4pm is confirmed.'));
  assert.match(h.messages(OWNER).at(-1).text, /Message from DwellHunt[\s\S]*Sunday 4pm/);
  assert.throws(() => h.c.agentAction(press(STRANGER, 'M|OL-2611-0001|y')), /UNAUTHORIZED_AGENT/, 'only the connected owner can answer');
  assert.ok(!h.messages(OWNER).some(m => m.text.includes(ADMIN)), 'the admin ID is never shown to the owner');
});

test('admin commands explain themselves and refuse owners who are not connected', () => {
  const h = publishedAndConnected();
  h.c.agentAction(msg(ADMIN, '/fwd OL-2611-0001 hello'));
  assert.match(h.messages(ADMIN).at(-1).text, /has not connected Telegram yet/);
  h.c.agentAction(msg(ADMIN, '/help'));
  assert.match(h.messages(ADMIN).at(-1).text, /\/fwd[\s\S]*\/view[\s\S]*\/reply[\s\S]*\/link/);
  h.c.agentAction(msg(ADMIN, '/link OL-2611-0001'));
  assert.match(h.messages(ADMIN).at(-1).text, /New one-time link/);
  h.c.agentAction(msg(ADMIN, '/fwd OL-2611-9999 hi'));
  assert.match(h.messages(ADMIN).at(-1).text, /was not found/);
});

test('owners renew or close from Telegram, see /mylistings, and get reminders there', () => {
  const h = publishedAndConnected();
  h.c.agentAction(msg(OWNER, '/start ' + h.code));
  h.c.agentAction(msg(OWNER, '/mylistings'));
  const card = h.messages(OWNER).at(-1);
  assert.match(card.text, /Live until/);
  assert.deepEqual(card.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data), ['M|OL-2611-0001|n', 'M|OL-2611-0001|x']);
  const s = h.sheets.DwellHunt_Owner_Listings, col = h.c.DH_OWNER_COLUMNS;
  s.rows[1][col.indexOf('Expires At')] = new Date(Date.now() + 1.5 * 86400000).toISOString();
  h.c.dhOwnerMaintenance_();
  assert.match(h.messages(OWNER).at(-1).text, /ends on[\s\S]*Tap Renew/);
  assert.equal(h.c.agentAction(press(OWNER, 'M|OL-2611-0001|n')).status, 'owner_renewed');
  assert.ok(Date.parse(s.rows[1][col.indexOf('Expires At')]) > Date.now() + 28 * 86400000);
  assert.match(h.messages(ADMIN).at(-1).text, /Owner renewed/);
  assert.equal(h.c.agentAction(press(OWNER, 'M|OL-2611-0001|x')).status, 'owner_closed');
  assert.equal(s.rows[1][col.indexOf('Status')], 'withdrawn');
  assert.equal(h.c.dhOwnerListingsPublic_().listings.length, 0);
  assert.equal(h.c.agentAction(press(OWNER, 'M|OL-2611-0001|n')).ignored, true, 'a closed listing cannot be renewed by the owner');
});

test('the public feed and the agent dashboard skip the script lock; every other action still takes it', () => {
  const code = read('Code.gs');
  assert.match(code, /\['owner_listings_public', 'agent_me', 'agents_public', 'agent_public'\]\.indexOf\(p\.action\) < 0 && !lock\.tryLock\(1500\)/);
});
