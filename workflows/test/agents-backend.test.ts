import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';

const read = (f: string) => readFileSync(new URL('../apps-script/' + f, import.meta.url), 'utf8');
const source = ['Code.gs', 'Leads.gs', 'OwnerListings.gs', 'OwnerTelegram.gs', 'Agents.gs', 'AgentProfiles.gs'].map(read).join('\n');

function fakeSheet() {
  const rows: any[][] = [];
  return {
    rows,
    getLastRow: () => rows.length,
    appendRow: (r: any[]) => { rows.push(r.map(v => v)); },
    getRange: (row: number, column: number, nr = 1, nc = 1) => ({
      getDisplayValues: () => rows.slice(row - 1, row - 1 + nr).map(r => r.slice(column - 1, column - 1 + nc).map(v => String(v ?? ''))),
      setValue: (v: any) => { rows[row - 1][column - 1] = v; },
      setValues: (vs: any[][]) => { vs.forEach((r, i) => { r.forEach((v, j) => { rows[row - 1 + i][column - 1 + j] = v; }); }); },
    }),
  };
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
    Utilities: {
      formatDate: (d: Date, _tz: string, f: string) => f === 'yyMM' ? '2611' : d.toISOString().slice(0, 10),
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_a: string, s: string) => [...createHash('sha256').update(s).digest()].map(b => (b > 127 ? b - 256 : b)),
    },
    UrlFetchApp: { fetch: () => { throw Error('Unexpected external request'); } },
  };
  runInNewContext(source, context);
  context.sheet = (name: string, cols: string[]) => { const s = sheets[name] ||= fakeSheet(); if (!s.rows.length) s.rows.push(cols); return s; };
  context.tg = (method: string, data: any) => { telegram.push({ method, data }); return {}; };
  context.log = (_id: string, code: string) => logs.push(code);
  context.DH_VIEWING_CONTEXT_ = environment === 'production' ? 'production' : '';
  return { c: context, telegram, mail, logs, sheets };
}

const application = { name: 'Kamal Silva', agency: 'Lanka Homes Realty', email: 'Kamal@Agency.example.test', phone: '+94 77 123 4567', registrationNo: 'REA-123', consent: true };
const callback = (data: string, from = '8394706632') => ({ id: 'cb', data, from: { id: Number(from) }, message: { message_id: 9, chat: { id: Number(from) } } });
const codeFrom = (mail: any[]) => /code is:\s+(\d{6})/.exec(mail.at(-1).body)![1];

function approvedAgent() {
  const h = harness();
  h.c.dhAgentSignup_({ ...application });
  const buttons = h.telegram[0].data.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
  h.c.dhAgentAction_(callback(buttons[0]));
  return h;
}
function signIn(h: ReturnType<typeof harness>) {
  h.c.dhAgentCode_({ email: application.email });
  return h.c.dhAgentVerify_({ email: application.email, code: codeFrom(h.mail) });
}

test('an agent application is stored as pending, alerts the admin and emails the applicant once', () => {
  const { c, telegram, mail, sheets } = harness();
  const r = c.dhAgentSignup_({ ...application });
  assert.deepEqual({ ...r }, { httpStatus: 200, status: 'pending', duplicate: false });
  const row = sheets.DwellHunt_Agents.rows[1], col = (n: string) => c.DH_AGENT_COLUMNS.indexOf(n);
  assert.equal(row[col('Agent ID')], 'AG-2611-0001'); assert.equal(row[col('Status')], 'pending');
  assert.equal(row[col('Email')], 'kamal@agency.example.test'); assert.equal(row[col('Phone')], "'+94771234567");
  assert.match(telegram[0].data.text, /NEW AGENT APPLICATION[\s\S]*Lanka Homes Realty[\s\S]*REA-123/);
  assert.deepEqual([...telegram[0].data.reply_markup.inline_keyboard.flat().map((b: any) => b.text)], ['✅ Approve agent', '❌ Reject']);
  assert.equal(mail.length, 1); assert.match(mail[0].subject, /agent application/);
  const again = c.dhAgentSignup_({ ...application });
  assert.equal(again.duplicate, true); assert.equal(telegram.length, 1); assert.equal(mail.length, 1);
  assert.throws(() => c.dhAgentSignup_({ ...application, email: 'x@y.test', phone: '0771234567' }), /INVALID_REQUEST/);
  assert.throws(() => c.dhAgentSignup_({ ...application, email: 'z@y.test', consent: false }), /INVALID_REQUEST/);
});

test('only the admin chat with the right key can approve; approval emails the agent a sign-in link', () => {
  const { c, telegram, mail } = harness();
  c.dhAgentSignup_({ ...application });
  const [approve] = telegram[0].data.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
  assert.throws(() => c.dhAgentAction_(callback(approve, '111')), /UNAUTHORIZED_AGENT/);
  assert.throws(() => c.dhAgentAction_(callback(approve.replace(/\|[a-f0-9]{12}\|/, '|000000000000|'))), /UNAUTHORIZED_AGENT/);
  assert.equal(c.dhAgentAction_(callback(approve)).status, 'agent_approved');
  assert.match(mail.at(-1).subject, /approved/); assert.match(mail.at(-1).body, /#agents/);
  assert.equal(c.dhAgentAction_(callback(approve)).ignored, true);
});

test('sign-in codes: unknown and pending emails get the same reply, wrong codes count, the 5th wrong try locks', () => {
  const h = harness();
  h.c.dhAgentSignup_({ ...application });
  const before = h.mail.length;
  assert.deepEqual({ ...h.c.dhAgentCode_({ email: 'nobody@example.test' }) }, { httpStatus: 200, status: 'sent' });
  assert.deepEqual({ ...h.c.dhAgentCode_({ email: application.email }) }, { httpStatus: 200, status: 'sent' });
  assert.equal(h.mail.length, before, 'pending agents receive no code');
  const a = approvedAgent();
  a.c.dhAgentCode_({ email: application.email });
  const good = codeFrom(a.mail), bad = good === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.throws(() => a.c.dhAgentVerify_({ email: application.email, code: bad }), /INVALID_CODE/);
  assert.throws(() => a.c.dhAgentVerify_({ email: application.email, code: bad }), /CODE_LOCKED/);
  assert.throws(() => a.c.dhAgentVerify_({ email: application.email, code: good }), /CODE_LOCKED/);
  const auth = a.sheets.DwellHunt_Agent_Auth.rows.slice(1);
  assert.ok(auth.every((r: any[]) => !String(r).includes(good)), 'the code itself is never stored');
});

test('a correct code signs in once, the session shows only that agent, and sign-out ends it', () => {
  const h = approvedAgent();
  const r = signIn(h);
  assert.equal(r.status, 'signed_in'); assert.match(r.session, /^[a-f0-9]{64}$/);
  assert.equal(r.agent.agency, 'Lanka Homes Realty');
  assert.throws(() => h.c.dhAgentVerify_({ email: application.email, code: '123456' }), /CODE_EXPIRED|INVALID_CODE/);
  assert.ok(h.sheets.DwellHunt_Agent_Auth.rows.every((row: any[]) => !row.includes(r.session)), 'only a hash of the session is stored');
  const me = h.c.dhAgentMe_({ session: r.session });
  assert.equal(me.agent.id, 'AG-2611-0001'); assert.deepEqual([...me.listings], []);
  assert.throws(() => h.c.dhAgentMe_({ session: 'f'.repeat(64) }), /SIGNED_OUT/);
  h.c.dhAgentSignOut_({ session: r.session });
  assert.throws(() => h.c.dhAgentMe_({ session: r.session }), /SIGNED_OUT/);
});

test('suspending an agent ends their sessions; an expired code is refused', () => {
  const h = approvedAgent();
  const { session } = signIn(h);
  const suspend = h.telegram.at(-1).data;
  const key = /\|([a-f0-9]{12})\|/.exec(h.telegram[0].data.reply_markup.inline_keyboard[0][0].callback_data)![1];
  h.c.dhAgentAction_(callback('A|AG-2611-0001|' + key + '|x'));
  assert.throws(() => h.c.dhAgentMe_({ session }), /SIGNED_OUT/);
  assert.ok(suspend);
  h.c.dhAgentAction_(callback('A|AG-2611-0001|' + key + '|a'));
  h.c.dhAgentCode_({ email: application.email });
  const auth = h.sheets.DwellHunt_Agent_Auth.rows, last = auth[auth.length - 1];
  last[h.c.DH_AGENT_AUTH_COLUMNS.indexOf('Expires At')] = new Date(Date.now() - 1000).toISOString();
  assert.throws(() => h.c.dhAgentVerify_({ email: application.email, code: codeFrom(h.mail) }), /CODE_EXPIRED/);
});

const photo = { url: 'https://res.cloudinary.com/demo/image/upload/p1.jpg', alt: 'x' };
const listing = (session: string) => ({
  session, selection: { listingRole: 'owner', listingPurpose: 'buy', propertyCategory: 'villa' },
  owner: { name: 'Somebody Else', email: 'forged@example.test', phone: '+94700000000', preferredContact: 'email' },
  privateLocation: { district: 'Colombo', city: 'Colombo 07', street: '1 Private Road', building: '', unit: '' },
  publicListing: { title: 'Modern Villa for Sale in Colombo 07', purpose: 'buy', category: 'villa', price: 250000000, currency: 'LKR',
    location: { district: 'Colombo', city: 'Colombo 07' }, description: 'Bright villa near the park.', photos: [photo],
    contact: { via: 'DwellHunt', displayName: 'Fake Name' } },
  confirmations: { authorized: true, accurate: true, photoPermission: true }, consent: true, draftId: 'agent-draft-1',
});

test('an agent listing joins the owner review queue under the verified agent identity and appears on the dashboard', () => {
  const h = approvedAgent();
  const { session } = signIn(h);
  const before = h.telegram.length;
  const r = h.c.dhAgentListing_(listing(session));
  assert.equal(r.reference, 'OL-2611-0001');
  const s = h.sheets.DwellHunt_Owner_Listings, col = (n: string) => h.c.DH_OWNER_COLUMNS.indexOf(n), row = s.rows[1];
  assert.equal(row[col('Email')], 'kamal@agency.example.test', 'forged owner email replaced by the agent');
  assert.equal(row[col('Listed By')], 'agent'); assert.equal(row[col('Agent ID')], 'AG-2611-0001');
  const pub = JSON.parse(row[col('Public Listing')]);
  assert.equal(pub.listedBy, 'agent'); assert.equal(pub.contact.displayName, 'Lanka Homes Realty');
  assert.doesNotMatch(JSON.stringify(pub), /Kamal|771234567|kamal@/);
  assert.match(h.telegram[before].data.text, /NEW AGENT LISTING[\s\S]*Lanka Homes Realty[\s\S]*AG-2611-0001[\s\S]*authorised to advertise/);
  assert.match(h.mail.at(-1).body, /agent dashboard/);
  const me = h.c.dhAgentMe_({ session });
  assert.equal(me.listings.length, 1); assert.equal(me.listings[0].status, 'pending review');
  assert.throws(() => h.c.dhAgentListing_(listing('0'.repeat(64))), /SIGNED_OUT/);
  assert.throws(() => h.c.dhOwnerListing_({ ...listing(session), selection: { listingRole: 'agent', listingPurpose: 'buy', propertyCategory: 'villa' } }), /INVALID_REQUEST/,
    'the agent role cannot be claimed without a session');
});

test('a buyer enquiry about an agent listing is emailed to that agent; owner listings are not', () => {
  const h = approvedAgent();
  const { session } = signIn(h);
  h.c.dhAgentListing_(listing(session));
  const lead = { name: 'Buyer One', email: 'buyer@example.test', phone: '+94771111111', propertyId: 'OL-2611-0001', message: 'Is it available?', preferredDate: '' };
  const before = h.mail.length;
  h.c.dhAgentForwardLead_(lead, { priority: 'WARM' }, 'lead1');
  assert.equal(h.mail.length, before + 1); assert.equal(h.mail.at(-1).to, 'kamal@agency.example.test');
  assert.match(h.mail.at(-1).body, /Buyer One[\s\S]*buyer@example.test[\s\S]*Is it available\?/);
  assert.equal(h.c.dhAgentForwardLead_({ ...lead, propertyId: 'prop-demo' }, { priority: 'WARM' }, 'lead2'), '');
  assert.equal(h.mail.length, before + 1);
});

test('Development never alerts Telegram and only emails the Development test address', () => {
  const { c, telegram, mail, logs } = harness('development');
  c.dhAgentSignup_({ ...application });
  assert.equal(telegram.length, 0); assert.equal(mail.length, 0);
  assert.ok(logs.includes('DEV_AGENT_TELEGRAM_SKIPPED') && logs.includes('DEV_AGENT_EMAIL_SKIPPED'));
});

test('the gateway router accepts the agent actions and routes A| buttons to agent review', () => {
  const code = read('Code.gs');
  for (const action of ['agent_signup', 'agent_code', 'agent_verify', 'agent_me', 'agent_signout', 'agent_listing']) assert.match(code, new RegExp("'" + action + "'"));
  assert.match(code, /indexOf\('A\|'\)===0\)return dhAgentAction_\(q\)/);
});

test('publishing an agent listing sends the agent version of the "now live" email, without the owner Telegram link', () => {
  const h = approvedAgent();
  const { session } = signIn(h);
  h.c.dhAgentListing_(listing(session));
  const alert = h.telegram.find(m => m.data && /NEW AGENT LISTING/.test(m.data.text || ''));
  h.c.agentAction({ callback_query: callback(alert.data.reply_markup.inline_keyboard[0][0].callback_data) });
  const live = h.mail.at(-1);
  assert.match(live.subject, /is now live/);
  assert.match(live.body, /emailed to you[\s\S]*#agents/);
  assert.doesNotMatch(live.body, /Telegram/);
  assert.equal(h.sheets.DwellHunt_Owner_Telegram, undefined, 'no owner Telegram link was created');
});

const cloud = 'https://res.cloudinary.com/demo/image/upload/logo.jpg';
test('an agent profile is public without contact details, and text is cleaned', () => {
  const h = approvedAgent();
  const { session } = signIn(h);
  h.c.dhAgentProfileSave_({ session, bio: 'Colombo apartments <b>since 2014</b>. See https://spam.example.test now', areas: ['Colombo 05', 'Rajagiriya', ''], logo: cloud });
  assert.throws(() => h.c.dhAgentProfileSave_({ session, bio: 'x', logo: 'https://evil.example.test/a.jpg' }), /INVALID_REQUEST/);
  const pub = h.c.dhAgentPublic_({ id: 'AG-2611-0001' }).agent;
  assert.equal(pub.agency, 'Lanka Homes Realty'); assert.equal(pub.logo, cloud); assert.deepEqual([...pub.areas], ['Colombo 05', 'Rajagiriya']);
  assert.doesNotMatch(pub.bio, /<b>|https?:|spam/);
  assert.doesNotMatch(JSON.stringify(pub), /kamal@agency|771234567/, 'no email or phone on the public profile');
  assert.throws(() => h.c.dhAgentPublic_({ id: 'AG-2611-0099' }), /NOT_FOUND/);
});

test('posts and stories go live at once, the admin gets a Remove button, and stories expire after 24 hours', () => {
  const h = approvedAgent();
  const { session } = signIn(h);
  assert.throws(() => h.c.dhAgentPost_({ session, kind: 'story', caption: 'No photo' }), /INVALID_REQUEST/);
  const post = h.c.dhAgentPost_({ session, kind: 'post', caption: 'Open viewing on Saturday' });
  const story = h.c.dhAgentPost_({ session, kind: 'story', caption: 'Just listed', photo: cloud });
  assert.equal(post.status, 'posted');
  const note = h.telegram.filter(m => /NEW AGENT (POST|STORY)/.test(m.data && m.data.text || ''));
  assert.equal(note.length, 2); assert.equal(note[0].data.reply_markup.inline_keyboard[0][0].text, '🗑 Remove');
  let pub = h.c.dhAgentPublic_({ id: 'AG-2611-0001' }).agent;
  assert.equal(pub.posts.length, 1); assert.equal(pub.stories.length, 1);
  const list = h.c.dhAgentsPublic_().agents;
  assert.equal(list.length, 1); assert.equal(list[0].stories.length, 1);
  const rows = h.sheets.DwellHunt_Agent_Posts.rows, col = (n: string) => h.c.DH_POST_COLUMNS.indexOf(n);
  rows.find((r: any[]) => r[col('Post ID')] === story.reference)[col('Expires At')] = new Date(Date.now() - 1000).toISOString();
  pub = h.c.dhAgentPublic_({ id: 'AG-2611-0001' }).agent;
  assert.equal(pub.stories.length, 0, 'an expired story is hidden');
  h.c.agentAction({ callback_query: callback(note[0].data.reply_markup.inline_keyboard[0][0].callback_data) });
  assert.equal(h.c.dhAgentPublic_({ id: 'AG-2611-0001' }).agent.posts.length, 0, 'the admin Remove button hides the post');
  assert.throws(() => h.c.agentAction({ callback_query: callback(note[0].data.reply_markup.inline_keyboard[0][0].callback_data, '111') }), /UNAUTHORIZED_AGENT/);
});

test('an agent can delete only their own posts, and the dashboard lists them with the profile', () => {
  const h = approvedAgent();
  const { session } = signIn(h);
  const post = h.c.dhAgentPost_({ session, kind: 'post', caption: 'Market tip' });
  const me = h.c.dhAgentMe_({ session });
  assert.equal(me.posts.length, 1); assert.equal(me.posts[0].caption, 'Market tip'); assert.equal(typeof me.profile.bio, 'string');
  assert.throws(() => h.c.dhAgentPostDelete_({ session, postId: 'PS-unknown' }), /NOT_FOUND/);
  h.c.dhAgentPostDelete_({ session, postId: post.reference });
  assert.equal(h.c.dhAgentMe_({ session }).posts.length, 0);
});

test('a Contact enquiry from a public profile is emailed to that agent', () => {
  const h = approvedAgent();
  signIn(h);
  const before = h.mail.length;
  h.c.dhAgentForwardLead_({ name: 'Buyer', email: 'b@example.test', phone: '', propertyId: 'AG-2611-0001', message: 'Do you have villas?', preferredDate: '' }, { priority: 'WARM' }, 'lead9');
  assert.equal(h.mail.length, before + 1);
  assert.match(h.mail.at(-1).subject, /from your DwellHunt profile/); assert.match(h.mail.at(-1).body, /Do you have villas\?/);
});
