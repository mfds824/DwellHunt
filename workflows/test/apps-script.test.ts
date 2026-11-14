import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../apps-script/doPost.gs', import.meta.url), 'utf8');
function harness(options: { auth?: string; bookingError?: Error; releaseFails?: boolean } = {}) {
  let calls = 0;
  const logs: string[] = [];
  const context = {
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (body: string) => ({
      setMimeType: () => JSON.parse(body),
    }) },
    cfg: () => 'test-only-secret', equal: (a: unknown, b: unknown) => a === b,
    fail: (code: string, status: number) => { throw Object.assign(new Error(code), {publicCode: code, httpStatus: status}); },
    LockService: { getScriptLock: () => ({ tryLock: () => true, hasLock: () => true,
      releaseLock: () => { if (options.releaseFails) throw new Error('private cleanup details'); } }) },
    log: (_id: string, code: string) => logs.push(code),
    intake: () => { calls++; if (options.bookingError) throw options.bookingError;
      return { httpStatus: 202, booking_id: 'mock-only' }; },
  };
  runInNewContext(source, context);
  const handler = (context as unknown as { doPost: (e: unknown) => Record<string, unknown> }).doPost;
  return { invoke: () => handler({postData: {contents: JSON.stringify({gatewaySecret: options.auth ?? 'test-only-secret', action: 'intake', payload: {}})}}), logs, calls: () => calls };
}

test('Apps Script rejects incorrect gateway authentication before booking code', () => {
  const h = harness({auth: 'wrong'});
  assert.equal(h.invoke().code, 'UNAUTHORIZED');
  assert.equal(h.calls(), 0);
});
test('Apps Script retains business rejection and does not reveal raw exception text', () => {
  const publicError = Object.assign(new Error('private text'), {publicCode: 'HUMAN_VERIFICATION_FAILED', httpStatus: 403});
  assert.equal(harness({bookingError: publicError}).invoke().httpStatus, 403);
  const h = harness({bookingError: new Error('private token and buyer details')});
  assert.equal(h.invoke().diagnostic_code, 'GATEWAY_UNEXPECTED_ERROR');
  assert.doesNotMatch(JSON.stringify(h.logs), /private|token|buyer/);
});
test('Apps Script reports allowlisted internal failures and protects results from cleanup errors', () => {
  const h = harness({bookingError: new Error('CALENDAR_ACCESS_FAILED'), releaseFails: true});
  assert.equal(h.invoke().diagnostic_code, 'CALENDAR_ACCESS_FAILED');
  assert.ok(h.logs.includes('LOCK_RELEASE_FAILED'));
  assert.equal(harness({releaseFails: true}).invoke().booking_id, 'mock-only');
});

const completeSource = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
test('Apps Script manifest declares the identity permission required by manual operator checks', () => {
  const manifest=JSON.parse(readFileSync(new URL('../apps-script/appsscript.json',import.meta.url),'utf8'));
  for (const scope of ['spreadsheets','calendar','script.external_request','script.send_mail','userinfo.email'])
    assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/'+scope));
  assert.equal(manifest.runtimeVersion,'V8');
});
function developmentHarness(settings: Record<string,string | undefined> = {}) {
  const row = ['demo-id','Demo','https://example.test/demo','true','test-agent',
    'test@example.test','test-calendar','',''];
  const context: Record<string, any> = {
    PropertiesService: {getScriptProperties:()=>({getProperty:(k:string)=>settings[k] ?? null})},
    SpreadsheetApp: {openById:()=>{throw Error('Unexpected real spreadsheet access');}},
    UrlFetchApp: {fetch:()=>{throw Error('Unexpected external request');}},
    MailApp: {sendEmail:()=>{throw Error('Unexpected real email');}},
    Session: {getActiveUser:()=>({getEmail:()=> 'operator@example.test'}),
      getEffectiveUser:()=>({getEmail:()=> 'operator@example.test'})},
    LockService: {getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  };
  runInNewContext(completeSource,context);
  context.sheet=()=>({getLastRow:()=>2,getRange:()=>({getDisplayValues:()=>[row]})});
  return context;
}
const developmentSettings = {DWELLHUNT_ENVIRONMENT:'development',DEV_DISABLE_TELEGRAM:'true',
  DEV_TEST_EMAIL:'test@example.test',DEV_TEST_CALENDAR_ID:'test-calendar',
  DEV_OPERATOR_EMAIL:'operator@example.test',DEV_BOOKING_ID:'existing-test'};

test('complete Apps Script retains Telegram requirements unless both Development flags are explicit', () => {
  for (const settings of [{}, {DEV_DISABLE_TELEGRAM:'true'},
    {DWELLHUNT_ENVIRONMENT:'production',DEV_DISABLE_TELEGRAM:'true'}]) {
    assert.throws(()=>developmentHarness(settings).property('demo-id'), /PROPERTY_CONFIG/);
  }
  assert.equal(developmentHarness(developmentSettings).property('demo-id').calendar_id,'test-calendar');
});
test('Development routing rejects unrelated buyer, agent, calendar and operator', () => {
  const c=developmentHarness(developmentSettings);
  assert.doesNotThrow(()=>c.dhAssertDevelopmentRouting_('test@example.test','test@example.test','test-calendar'));
  for (const args of [['other@example.test','test@example.test','test-calendar'],
    ['test@example.test','other@example.test','test-calendar'],
    ['test@example.test','test@example.test','other-calendar']])
    assert.throws(()=>c.dhAssertDevelopmentRouting_(...args), /DEV_TEST_ROUTING_REQUIRED/);
  c.Session.getActiveUser=()=>({getEmail:()=> 'other@example.test'});
  assert.throws(()=>c.developmentApproveTestBooking(), /UNAUTHORIZED_DEV_OPERATOR/);
});
test('manual Development approval and processing operate on one authorized existing record', () => {
  const c=developmentHarness(developmentSettings);
  const b={booking_id:'existing-test',property_id:'demo-id',email:'test@example.test',
    agent_email:'test@example.test',_calendar:'test-calendar',booking_status:'pending_approval',
    _approvalExpires:new Date(Date.now()+3600000).toISOString(),_jobs:['received','agent_pending'],_sent:{}};
  c.all=()=>[b]; c.save=()=>{};
  assert.equal(c.developmentApproveTestBooking().status,'approved');
  assert.throws(()=>c.developmentApproveTestBooking(), /INVALID_APPROVAL_STATE/);
  let calendarCalls=0,delivered=0;
  c.tick=()=>{throw Error('Must not process all bookings');};
  c.reconcileCalendar=(booking:typeof b)=>{assert.equal(booking.booking_id,'existing-test');calendarCalls++;};
  c.deliver=()=>{delivered++;};
  assert.equal(c.developmentProcessTestBooking().booking_id,'existing-test');
  assert.equal(calendarCalls,1); assert.equal(delivered,2);
});
test('Development Telegram skip does not send external requests or disable email delivery', () => {
  const c=developmentHarness(developmentSettings);
  const b={booking_id:'existing-test',booking_status:'pending_approval',email:'test@example.test',
    agent_email:'test@example.test',_calendar:'test-calendar',_sent:{} as Record<string,string>,_jobs:['agent_pending']};
  c.save=()=>{}; c.log=()=>{};
  c.deliver(b,'agent_pending');
  assert.equal(b._sent.agent_pending,'disabled-development');
  assert.equal(b._jobs.length,0);
  c.emailTemplate=()=>({subject:'mock',text:'mock',html:'mock'});
  let emails=0; c.MailApp.sendEmail=()=>{emails++;};
  c.deliver(b,'received'); assert.equal(emails,1);
});

test('Calendar creation deduplicates the shared buyer/agent test mailbox and reaches confirmed', () => {
  const c=developmentHarness(developmentSettings);
  const start=new Date(Date.now()+86400000).toISOString();
  const b={booking_id:'existing-test',email:'test@example.test',agent_email:'test@example.test',
    _calendar:'test-calendar',property_title:'Demo',property_url:'https://example.test/demo',
    viewing_datetime_utc:start,booking_status:'approved',_invited:true,_sent:{},_jobs:[]};
  c.getEvent=()=>({httpCode:404}); c.available=()=>true; c.save=()=>{};
  c.google=(_method:string,_path:string,body:any)=>{
    assert.equal(body.attendees.length,1);
    assert.equal(body.attendees[0].email,'test@example.test');
    return {id:b.booking_id,extendedProperties:body.extendedProperties,start:body.start,end:body.end,
      conferenceData:{createRequest:{status:{statusCode:'success'}},entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/mock-test-only'}]}};
  };
  c.reconcileCalendar(b,[b]);
  assert.equal(b.booking_status,'confirmed');
});

test('automatic Development delivery still rejects unrelated contacts when Telegram is enabled', () => {
  const c=developmentHarness({...developmentSettings,DEV_DISABLE_TELEGRAM:'false',DEV_TEST_TELEGRAM_ID:'123456'});
  let writes=0;c.save=()=>{writes++;};
  assert.throws(()=>c.deliver({email:'other@example.test',agent_email:'test@example.test',_calendar:'test-calendar'},'received'),/DEV_TEST_ROUTING_REQUIRED/);
  c.all=()=>[{email:'other@example.test',agent_email:'test@example.test',_calendar:'test-calendar'}];
  assert.throws(()=>c.dhWorkflowBookings_(),/DEV_TEST_ROUTING_REQUIRED/);
  assert.throws(()=>c.tg('sendMessage',{chat_id:'unrelated',text:'must not send'}),/DEV_TEST_ROUTING_REQUIRED/);
  assert.equal(writes,0);
});

test('Telegram activation fails before registry writes unless webhook readiness passes', () => {
  const c=developmentHarness(developmentSettings);
  c.developmentAutomationReadiness=()=>({bot_matches:true,private_test_chat:true,webhook_matches:false,ops_chat_matches:true});
  assert.throws(()=>c.developmentEnableTelegramRouting(),/DEV_AUTOMATION_NOT_READY/);
});

test('Telegram approval validates private chat, allowed user and nonce and does not approve twice', () => {
  const c=developmentHarness({...developmentSettings,DEV_DISABLE_TELEGRAM:'false'});
  const b={booking_id:'existing-test',_chat:'123456',_users:['123456'],_nonce:'mock-nonce',
    booking_status:'pending_approval',_approvalExpires:new Date(Date.now()+3600000).toISOString()};
  c.all=()=>[b];c.ack=()=>{};let saves=0;c.save=()=>{saves++;};
  const update=(user:string,chat:string,nonce:string)=>({callback_query:{data:'a|existing-test|'+nonce,message:{chat:{id:chat}},from:{id:user}}});
  for(const args of [['other','123456','mock-nonce'],['123456','other','mock-nonce'],['123456','123456','wrong']])
    assert.throws(()=>c.agentAction(update(...args as [string,string,string])),/UNAUTHORIZED_AGENT/);
  assert.equal(saves,0);
  assert.equal(c.agentAction(update('123456','123456','mock-nonce')).status,'approved');
  assert.equal(c.agentAction(update('123456','123456','mock-nonce')).ignored,true);
  assert.equal(saves,1);
});

test('an agent cannot mark a future viewing completed', () => {
  const c=developmentHarness(developmentSettings);
  c.all=()=>[{booking_id:'existing-test',_chat:'123456',_users:['123456'],_nonce:'mock-nonce',booking_status:'confirmed',viewing_datetime_utc:new Date(Date.now()+3600000).toISOString()}];
  c.save=()=>{throw Error('Must not save a false completion');};
  assert.throws(()=>c.agentAction({callback_query:{data:'c|existing-test|mock-nonce',message:{chat:{id:'123456'}},from:{id:'123456'}}}),/INVALID_COMPLETION_STATE/);
});


test('GitHub CAPTCHA hostname exception is Development-only and retains action and success checks', () => {
  let verified={success:true,hostname:'mfds824.github.io',action:'booking'};
  const make=(settings:Record<string,string>)=>{
    const c=developmentHarness({...settings,ALLOWED_HOSTNAME:'development.dwellhunt-viewing-dev.pages.dev',TURNSTILE_SECRET:'mock-secret',DEV_TEST_WEBSITE_HOSTNAME:'mfds824.github.io'});
    c.UrlFetchApp={fetch:()=>({getContentText:()=>JSON.stringify(verified)})};return c;
  };
  const c=make({DWELLHUNT_ENVIRONMENT:'development'});
  assert.doesNotThrow(()=>c.verifyHuman({turnstile_token:'mock-token'},'booking'));
  verified={...verified,hostname:'attacker.example'};assert.throws(()=>c.verifyHuman({turnstile_token:'mock-token'},'booking'),/HUMAN_VERIFICATION_FAILED/);
  verified={success:true,hostname:'mfds824.github.io',action:'manage'};assert.throws(()=>c.verifyHuman({turnstile_token:'mock-token'},'booking'),/HUMAN_VERIFICATION_FAILED/);
  verified={success:false,hostname:'mfds824.github.io',action:'booking'};assert.throws(()=>c.verifyHuman({turnstile_token:'mock-token'},'booking'),/HUMAN_VERIFICATION_FAILED/);
  verified={...verified,success:true};assert.throws(()=>make({DWELLHUNT_ENVIRONMENT:'production'}).verifyHuman({turnstile_token:'mock-token'},'booking'),/HUMAN_VERIFICATION_FAILED/);
});


test('Live context isolates storage, permits customers and pins approved agent/calendar',()=>{
  const c=developmentHarness({...developmentSettings,LIVE_SPREADSHEET_ID:'live-sheet',SPREADSHEET_ID:'test-sheet',LIVE_AGENT_EMAIL:'agent@example.test',LIVE_CALENDAR_ID:'live-calendar',LIVE_PROPERTY_IDS:'live-property'});
  assert.equal(c.cfg('SPREADSHEET_ID'),'test-sheet');c.DH_VIEWING_CONTEXT_='production';
  assert.equal(c.cfg('SPREADSHEET_ID'),'live-sheet');assert.equal(c.dhIsDevelopment_(),false);
  assert.doesNotThrow(()=>c.dhAssertLiveRouting_('customer@example.test','agent@example.test','live-calendar'));
  assert.throws(()=>c.dhAssertLiveRouting_('customer@example.test','fiction@example.test','live-calendar'),/PRODUCTION_ROUTING_REQUIRED/);
  assert.throws(()=>c.dhAssertLiveRouting_('customer@example.test','agent@example.test','test-calendar'),/PRODUCTION_ROUTING_REQUIRED/);
  assert.throws(()=>c.property('other-property'),/PROPERTY_UNAVAILABLE/);
  c.DH_VIEWING_CONTEXT_='';assert.equal(c.cfg('SPREADSHEET_ID'),'test-sheet');assert.equal(c.dhIsDevelopment_(),true);
});
test('Gateway validates authentication before accepting Production context and restores context',()=>{
  const c=developmentHarness({...developmentSettings,GATEWAY_SECRET:'mock-key'});c.output=(v:unknown)=>v;
  const r=c.dhHandlePost_({postData:{contents:JSON.stringify({gatewaySecret:'wrong',environment:'production',action:'intake',payload:{}})}});
  assert.equal(r.code,'UNAUTHORIZED');assert.equal(c.DH_VIEWING_CONTEXT_,'');
  c.intake=()=>({mode:c.cfg('DWELLHUNT_ENVIRONMENT')});
  const good=c.dhHandlePost_({postData:{contents:JSON.stringify({gatewaySecret:'mock-key',environment:'production',action:'intake',payload:{environment:'development'}})}});
  assert.equal(good.mode,'production');assert.equal(c.DH_VIEWING_CONTEXT_,'');
});
