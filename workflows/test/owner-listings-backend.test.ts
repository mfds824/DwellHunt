import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (f: string) => readFileSync(new URL('../apps-script/' + f, import.meta.url), 'utf8');
const source = ['Code.gs', 'Leads.gs', 'OwnerListings.gs', 'OwnerTelegram.gs'].map(read).join('\n');

function fakeSheet() {
  const rows: any[][] = [];
  const s: any = {
    rows,
    getLastRow: () => rows.length,
    appendRow: (r: any[]) => { rows.push(r.map(v => v)); },
    getRange: (row: number, column: number, nr = 1, nc = 1) => ({
      getDisplayValues: () => rows.slice(row - 1, row - 1 + nr).map(r => r.slice(column - 1, column - 1 + nc).map(v => String(v ?? ''))),
      setValue: (v: any) => { rows[row - 1][column - 1] = v; },
      setValues: (vs: any[][]) => { vs.forEach((r, i) => { rows[row - 1 + i] = r; }); },
    }),
  };
  return s;
}

function harness(environment: 'production' | 'development' = 'production') {
  const store: Record<string, string> = environment === 'production'
    ? { LIVE_TELEGRAM_ID: '8394706632', LIVE_WEBSITE_URL: 'https://site.example.test/' }
    : { DWELLHUNT_ENVIRONMENT: 'development', DEV_DISABLE_TELEGRAM: 'true', DEV_TEST_EMAIL: 'test@example.test', WEBSITE_URL: 'https://site.example.test' };
  const telegram: any[] = [], mail: any[] = [], logs: string[] = [];
  const sheets: Record<string, any> = {};
  const context: any = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => store[k] ?? null, setProperty: (k: string, v: string) => { store[k] = v; } }) },
    MailApp: { sendEmail: (m: any) => { mail.push(m); } },
    Utilities: { formatDate: (d: Date, _tz: string, f: string) => f === 'yyMM' ? '2611' : d.toISOString().slice(0, 10), getUuid: () => '1234abcd-5678-90ef-aaaa-bbbbccccdddd' },
    UrlFetchApp: { fetch: () => { throw Error('Unexpected external request'); } },
  };
  runInNewContext(source, context);
  const header = (name: string, cols: string[]) => { const s = sheets[name] ||= fakeSheet(); if (!s.rows.length) s.rows.push(cols); return s; };
  context.sheet = header;
  context.tg = (method: string, data: any) => { telegram.push({ method, data }); return method === 'getMe' ? { username: 'DwellHuntViewingStagingBot' } : {}; };
  context.log = (_id: string, code: string) => logs.push(code);
  context.DH_VIEWING_CONTEXT_ = environment === 'production' ? 'production' : '';
  return { c: context, telegram, mail, logs, sheets, store };
}

const photo = { url: 'https://res.cloudinary.com/demo/image/upload/p1.jpg', alt: 'x' };
function submission(extra: Record<string, any> = {}) {
  return {
    selection: { listingRole: 'owner', listingPurpose: 'rent', propertyCategory: 'apartment' },
    owner: { name: 'Nimal Perera', email: 'nimal@example.test', phone: '+94771234567', preferredContact: 'whatsapp' },
    privateLocation: { district: 'Colombo', city: 'Colombo 05', street: '12 Private Lane', building: 'Havelock Heights', unit: '7B' },
    publicListing: { title: '2-Bedroom Apartment for Rent in Colombo 05', purpose: 'rent', category: 'apartment', price: 150000, currency: 'LKR',
      billingPeriod: 'month', rentalType: 'long-term', location: { district: 'Colombo', city: 'Colombo 05' },
      description: 'Call Nimal Perera on +94771234567. <script>x</script>', photos: [photo, { url: 'https://evil.example/x.jpg' }],
      contact: { via: 'DwellHunt', displayName: 'Private owner' }, advanceMonths: 6, injected: '=HYPERLINK("x")' },
    confirmations: { authorized: true, accurate: true, photoPermission: true }, consent: true, draftId: 'draft-1', ...extra,
  };
}
const callback = (data: string, from = '8394706632') => ({ id: 'cb', data, from: { id: Number(from) }, message: { message_id: 7, chat: { id: Number(from) } } });

test('a valid owner listing is stored privately, alerts the admin with review buttons and emails the owner', () => {
  const { c, telegram, mail, sheets } = harness();
  const r = c.dhOwnerListing_(submission());
  assert.deepEqual({ ...r }, { httpStatus: 200, status: 'received', duplicate: false, reference: 'OL-2611-0001' });
  const s = sheets.DwellHunt_Owner_Listings, cols = c.DH_OWNER_COLUMNS, row = s.rows[1];
  assert.equal(row[cols.indexOf('Status')], 'pending review');
  assert.equal(row[cols.indexOf('Phone')], "'+94771234567");
  const pub = JSON.parse(row[cols.indexOf('Public Listing')]);
  assert.equal(pub.photos.length, 1, 'non-Cloudinary photo dropped');
  assert.equal('injected' in pub, false, 'unknown fields dropped');
  assert.doesNotMatch(JSON.stringify(pub), /Nimal Perera|771234567|Private Lane|Havelock|<script>/);
  assert.equal(telegram.length, 1);
  assert.equal(telegram[0].data.chat_id, '8394706632');
  assert.match(telegram[0].data.text, /NEW OWNER LISTING[\s\S]*OL-2611-0001[\s\S]*Private address: 12 Private Lane, Havelock Heights, 7B[\s\S]*proof of ownership/);
  const buttons = telegram[0].data.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
  assert.deepEqual([...buttons], ['O|OL-2611-0001|1234abcd5678|p', 'O|OL-2611-0001|1234abcd5678|c', 'O|OL-2611-0001|1234abcd5678|r']);
  assert.equal(mail.length, 1); assert.equal(mail[0].to, 'nimal@example.test');
  assert.match(mail[0].subject, /OL-2611-0001/); assert.match(mail[0].body, /proof of ownership[\s\S]*never shown on the website/);
});

test('invalid submissions are rejected with field names; retries and floods are handled', () => {
  const { c, telegram } = harness();
  const bad = (p: any) => { try { c.dhOwnerListing_(p); return 'accepted'; } catch (e: any) { return e.publicCode + ':' + (e.fields || []).join(','); } };
  assert.match(bad(submission({ consent: false })), /INVALID_REQUEST:.*confirmations/);
  assert.match(bad(submission({ owner: { name: 'A', email: 'nope', phone: '0771234567' } })), /owner\.email,owner\.phone/);
  assert.match(bad(submission({ selection: { listingRole: 'agent', listingPurpose: 'rent', propertyCategory: 'apartment' } })), /selection/);
  assert.match(bad(submission({ selection: { listingRole: 'owner', listingPurpose: 'buy', propertyCategory: 'room' } })), /selection/);
  assert.match(bad({ ...submission(), publicListing: { ...submission().publicListing, photos: [] } }), /publicListing\.photos/);
  assert.match(bad({ ...submission(), publicListing: { ...submission().publicListing, price: 0 } }), /publicListing\.price/);
  assert.equal(telegram.length, 0);
  const first = c.dhOwnerListing_(submission());
  const retry = c.dhOwnerListing_(submission());
  assert.equal(retry.reference, first.reference); assert.equal(retry.duplicate, true);
  c.dhOwnerListing_(submission({ draftId: 'draft-2' })); c.dhOwnerListing_(submission({ draftId: 'draft-3' }));
  assert.equal(bad(submission({ draftId: 'draft-4' })), 'RATE_LIMITED:');
});

test('only the admin can review; publishing makes it public for one month, and decisions email the owner', () => {
  const { c, telegram, mail } = harness();
  const { reference } = c.dhOwnerListing_(submission());
  assert.equal(c.dhOwnerListingsPublic_().listings.length, 0, 'pending listings are not public');
  assert.throws(() => c.agentAction({ callback_query: callback('O|' + reference + '|1234abcd5678|p', '555') }), /UNAUTHORIZED_AGENT/);
  assert.throws(() => c.agentAction({ callback_query: callback('O|' + reference + '|wrongkey0000|p') }), /UNAUTHORIZED_AGENT/);
  const r = c.agentAction({ callback_query: callback('O|' + reference + '|1234abcd5678|p') });
  assert.equal(r.status, 'owner_published');
  const pub = c.dhOwnerListingsPublic_().listings;
  assert.equal(pub.length, 1); assert.equal(pub[0].reference, reference); assert.equal(pub[0].verified, true);
  assert.doesNotMatch(JSON.stringify(pub), /nimal@|771234567|Private Lane/);
  const days = (Date.parse(pub[0].expiresAt) - Date.now()) / 86400000;
  assert.ok(days > 27 && days < 32, String(days));
  assert.match(mail.at(-1).subject, /is now live/); assert.match(mail.at(-1).body, /#owner-listing=OL-2611-0001/);
  const edited = telegram.filter(t => t.method === 'editMessageReplyMarkup').at(-1).data.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
  assert.deepEqual([...edited], ['✅ Published', '🔁 Renew 1 month', '🏁 Mark rented / sold']);
  const again = c.agentAction({ callback_query: callback('O|' + reference + '|1234abcd5678|p') });
  assert.equal(again.ignored, true, 'double tap is ignored');
  c.agentAction({ callback_query: callback('O|' + reference + '|1234abcd5678|x') });
  assert.equal(c.dhOwnerListingsPublic_().listings.length, 0, 'closed listings disappear');
});

test('ask for changes and reject send the owner a matching email; lead buttons still route to leads', () => {
  const { c, mail } = harness();
  const a = c.dhOwnerListing_(submission());
  c.agentAction({ callback_query: callback('O|' + a.reference + '|1234abcd5678|c') });
  assert.match(mail.at(-1).subject, /needs a few changes/);
  c.agentAction({ callback_query: callback('O|' + a.reference + '|1234abcd5678|r') });
  assert.match(mail.at(-1).subject, /About your listing/);
  let routed = '';
  c.dhLeadAction_ = (q: any) => { routed = q.data; return { ok: true }; };
  c.agentAction({ callback_query: callback('L|x|y|c') });
  assert.equal(routed, 'L|x|y|c');
});

test('daily maintenance sends 7- and 2-day reminders once each, then expires the listing', () => {
  const { c, mail, telegram, sheets } = harness();
  const { reference } = c.dhOwnerListing_(submission());
  c.agentAction({ callback_query: callback('O|' + reference + '|1234abcd5678|p') });
  const s = sheets.DwellHunt_Owner_Listings, cols = c.DH_OWNER_COLUMNS, setExpiry = (ms: number) => { s.rows[1][cols.indexOf('Expires At')] = new Date(Date.now() + ms).toISOString(); };
  const before = mail.length;
  assert.equal(c.dhOwnerMaintenance_(), 0, 'nothing due a month out');
  setExpiry(6 * 86400000); assert.equal(c.dhOwnerMaintenance_(), 1); assert.equal(c.dhOwnerMaintenance_(), 0, 'not sent twice');
  setExpiry(1.5 * 86400000); assert.equal(c.dhOwnerMaintenance_(), 1);
  assert.equal(mail.length - before, 2); assert.match(mail.at(-1).subject, /ends on/);
  assert.match(telegram.at(-1).data.text, /Listing ends/);
  c.agentAction({ callback_query: callback('O|' + reference + '|1234abcd5678|n') });
  const renewed = (Date.parse(s.rows[1][cols.indexOf('Expires At')]) - Date.now()) / 86400000;
  assert.ok(renewed > 29, 'renew adds a month to the current end date');
  assert.equal(s.rows[1][cols.indexOf('Reminders Sent')], '');
  setExpiry(-1000); assert.equal(c.dhOwnerMaintenance_(), 1);
  assert.equal(s.rows[1][cols.indexOf('Status')], 'expired');
  assert.match(mail.at(-1).subject, /has ended/);
  assert.equal(c.dhOwnerListingsPublic_().listings.length, 0);
});

test('Development never alerts Telegram and only emails the Development test address', () => {
  const { c, telegram, mail, logs } = harness('development');
  c.dhOwnerListing_(submission());
  assert.equal(telegram.length, 0); assert.equal(mail.length, 0);
  assert.ok(logs.includes('DEV_OWNER_TELEGRAM_SKIPPED') && logs.includes('DEV_OWNER_EMAIL_SKIPPED'));
  c.dhOwnerListing_(submission({ draftId: 'd2', owner: { name: 'Test', email: 'test@example.test', phone: '+94771234567', preferredContact: 'email' } }));
  assert.equal(mail.length, 1);
});

test('the gateway router accepts the two owner actions in production', () => {
  const code = read('Code.gs');
  assert.match(code, /'owner_listing','owner_listings_public'(,'agents?_[a-z_]+')*\]\.includes\(p\.action\)/);
  assert.match(code, /p\.action === 'owner_listing'\) r = dhOwnerListing_/);
  assert.match(code, /p\.action === 'owner_listings_public'\) r = dhOwnerListingsPublic_\(\)/);
  assert.match(read('Leads.gs'), /dhOwnerMaintenance_\(\)/);
});
