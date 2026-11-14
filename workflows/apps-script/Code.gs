/* DwellHunt: NEW standalone Apps Script project. Never edit the canonical state sheet. */
const CRM = 'booking_id|created_at|property_id|property_title|property_url|customer_name|email|whatsapp|country|buyer_timezone|preferred_date|preferred_time|viewing_datetime_utc|viewing_datetime_sri_lanka|agent_id|agent_email|booking_status|google_meet_link|calendar_event_id|reminder_24h_sent|reminder_1h_sent|viewing_completed|customer_feedback|follow_up_status|last_updated'.split('|');
const PROPS = 'property_id|property_title|property_url|active|agent_id|agent_email|calendar_id|telegram_chat_id|telegram_user_ids'.split('|');
const ACTIVE = ['pending_approval','approved','awaiting_meeting_setup','confirmed','cancelling'];
var DH_VIEWING_CONTEXT_ = '';
function cfg(k,d) {
  if(DH_VIEWING_CONTEXT_==='production' && k==='DWELLHUNT_ENVIRONMENT') return 'production';
  const isolated=['SPREADSHEET_ID','ALLOWED_HOSTNAME','WEBSITE_URL','POST_CURSOR','REMINDER_CURSOR'];
  const key=DH_VIEWING_CONTEXT_==='production' && isolated.includes(k)?'LIVE_'+k:k;
  const v=PropertiesService.getScriptProperties().getProperty(key);
  if(v!==null)return v;if(d!==undefined)return d;throw new Error('CONFIG_'+key);
}
function now(){return new Date().toISOString();}
function hash(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s)).map(x=>('0'+((x+256)%256).toString(16)).slice(-2)).join('');}
function token(){return hash(Utilities.getUuid()+Utilities.getUuid());}
function fail(code,status,fields){const e=new Error(code);e.publicCode=code;e.httpStatus=status||400;e.fields=fields;throw e;}
function equal(a,b){a=String(a||'');b=String(b||'');let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0;}
function sheet(name,cols){const book=SpreadsheetApp.openById(cfg('SPREADSHEET_ID'));let s=book.getSheetByName(name);if(!s){s=book.insertSheet(name);s.getRange(1,1,1,cols.length).setValues([cols]);s.setFrozenRows(1);}if(JSON.stringify(s.getRange(1,1,1,cols.length).getDisplayValues()[0])!==JSON.stringify(cols))throw new Error('SCHEMA_'+name);return s;}
function setup(){sheet('DwellHunt_Virtual_Viewings',CRM);sheet('DH_Viewing_State',['booking_id','state_json']);sheet('DH_Viewing_Properties',PROPS);sheet('DH_Viewing_Log',['timestamp','booking_id','code']);google('get','/users/me/calendarList');MailApp.getRemainingDailyQuota();}
function all(){const s=sheet('DH_Viewing_State',['booking_id','state_json']);if(s.getLastRow()<2)return [];return s.getRange(2,1,s.getLastRow()-1,2).getValues().map((v,i)=>{const b=JSON.parse(v[1]);b._row=i+2;return b;});}
function safeCell(v){if(typeof v==='boolean')return v;const s=String(v==null?'':v);return /^[=+@\-\t\r]/.test(s)?"'"+s:s;}
function mirror(b){const s=sheet('DwellHunt_Virtual_Viewings',CRM);let row=0;if(s.getLastRow()>1){const i=s.getRange(2,1,s.getLastRow()-1,1).getDisplayValues().findIndex(x=>x[0]===b.booking_id);if(i>=0)row=i+2;}s.getRange(row||s.getLastRow()+1,1,1,CRM.length).setNumberFormat('@').setValues([CRM.map(k=>safeCell(b[k]))]);}
// Canonical state is committed first; the visible CRM is a repairable projection.
function save(b){if(terminal(b)&&!b._closedAt)b._closedAt=now();b.last_updated=now();const s=sheet('DH_Viewing_State',['booking_id','state_json']);b._row=b._row||s.getLastRow()+1;s.getRange(b._row,1,1,2).setValues([[b.booking_id,JSON.stringify(b)]]);SpreadsheetApp.flush();try{mirror(b);}catch(e){log(b.booking_id,'CRM_PROJECTION_FAILED');}}
function log(id,code){try{sheet('DH_Viewing_Log',['timestamp','booking_id','code']).appendRow([now(),id||'',String(code).slice(0,100)]);}catch(e){}}
// Only authenticated server calls may invoke backend actions. Mutations share a ScriptLock.
function doPost(e) {
  var result = dhHandlePost_(e);
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function dhHandlePost_(e) {
  var lock, previousViewingContext=DH_VIEWING_CONTEXT_;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string' ||
        e.postData.contents.length > 40000) fail('INVALID_BODY', 400);
    var p;
    try { p = JSON.parse(e.postData.contents); }
    catch (parseError) { fail('INVALID_JSON', 400); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail('INVALID_JSON', 400);
    if (!equal(p.gatewaySecret, cfg('GATEWAY_SECRET'))) fail('UNAUTHORIZED', 401);
    if(p.environment && !['development','production'].includes(p.environment))fail('INVALID_ENVIRONMENT',400);
    if(p.environment==='production' && !['intake','telegram','customer_action','reminders','followup','viewing_health'].includes(p.action))fail('INVALID_ACTION',400);
    DH_VIEWING_CONTEXT_=p.environment==='production'?'production':'';
    lock = LockService.getScriptLock();
    if (!lock.tryLock(1500)) fail('BUSY_RETRY', 503);
    var r;
    if (p.action === 'intake') r = intake(p.payload || {});
    else if (p.action === 'telegram') r = agentAction(p.payload || {});
    else if (p.action === 'customer_action') r = customerAction(p.payload || {});
    else if (p.action === 'reminders') r = tick(false);
    else if (p.action === 'followup') r = tick(true);
    else if (p.action === 'viewing_health') r = viewingHealth();
    else if (p.action === 'listing_tracking_health') r = dhListingHealth_();
    else if (p.action === 'listing_sheet_sync') r = dhListingUpsert_(p.payload || {});
    else if (p.action === 'listing_reminder') r = dhListingReminder_(p.payload || {}, false);
    else if (p.action === 'listing_reminder_lookup') r = dhListingReminder_(p.payload || {}, true);
    else if (p.action === 'auth_email_send') r = dhAuthEmail_(p.payload || {});
    else fail('INVALID_ACTION', 400);
    return Object.assign({ok: true, httpStatus: 200}, r);
  } catch (error) {
    var isPublic = error && typeof error.publicCode === 'string' &&
      /^[A-Z][A-Z0-9_]{0,79}$/.test(error.publicCode);
    var diagnostic = dhDiagnosticCode_(error);
    // Neither raw messages, stack traces, requests nor credentials are recorded.
    try { log('', isPublic ? error.publicCode : diagnostic); } catch (loggingError) {}
    return {
      ok: false,
      httpStatus: isPublic && error.httpStatus >= 400 && error.httpStatus <= 599 ? error.httpStatus : 503,
      code: isPublic ? error.publicCode : 'SERVICE_UNAVAILABLE',
      diagnostic_code: isPublic ? undefined : diagnostic,
      fields: isPublic ? error.fields : undefined
    };
  } finally {
    DH_VIEWING_CONTEXT_=previousViewingContext;
    // A cleanup exception must not replace the booking result or rejection.
    if (lock) {
      try { if (lock.hasLock()) lock.releaseLock(); }
      catch (releaseError) {
        try { log('', 'LOCK_RELEASE_FAILED'); } catch (loggingError) {}
      }
    }
  }
}

function dhDiagnosticCode_(error) {
  var message = error && typeof error.message === 'string' ? error.message : '';
  var allowed = [
    'PROPERTY_CONFIG', 'CALENDAR_ACCESS_FAILED', 'EVENT_IDENTITY_MISMATCH',
    'TELEGRAM_FAILED', 'UNKNOWN_EMAIL_TEMPLATE'
  ];
  if (allowed.indexOf(message) !== -1) return message;
  if (/^GOOGLE_[1-5][0-9]{2}$/.test(message)) return message;
  var config = ['GATEWAY_SECRET', 'SPREADSHEET_ID', 'TURNSTILE_SECRET',
    'ALLOWED_HOSTNAME', 'TELEGRAM_BOT_TOKEN', 'OPS_CHAT_ID', 'WEBSITE_URL'];
  for (var i = 0; i < config.length; i++) {
    if (message === 'CONFIG_' + config[i]) return 'CONFIG_' + config[i];
  }
  if (error && ['TypeError', 'ReferenceError', 'SyntaxError'].indexOf(error.name) !== -1)
    return 'GATEWAY_' + error.name.toUpperCase();
  return 'GATEWAY_UNEXPECTED_ERROR';
}
function output(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
function clean(v,max){return typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';}
function timezone(tz){try{if(!tz||!(tz==='UTC'||tz.includes('/')))throw 0;new Intl.DateTimeFormat('en',{timeZone:tz}).format(new Date());}catch(e){fail('TIMEZONE_CLARIFICATION_REQUIRED',422,['buyer_timezone']);}return tz;}
function localStamp(ms,tz){return Utilities.formatDate(new Date(ms),tz,"yyyy-MM-dd'T'HH:mm");}
// Enumerate nearby zone offsets, then round-trip wall time: detect DST folds and gaps.
function localToUtc(date,time,tz,selected){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))fail('INVALID_LOCAL_DATETIME',422);const target=date+'T'+time,base=Date.parse(target+':00Z');if(!Number.isFinite(base)||new Date(base).toISOString().slice(0,16)!==target)fail('INVALID_LOCAL_DATETIME',422);const offsets=new Set();for(let h=-48;h<=48;h+=6)offsets.add(Utilities.formatDate(new Date(base+h*3600000),tz,'Z'));const matches=[];offsets.forEach(o=>{const offset=(o[0]==='-'?-1:1)*(Number(o.slice(1,3))*60+Number(o.slice(3,5))),ms=base-offset*60000;if(localStamp(ms,tz)===target)matches.push({ms,offset});});if(!matches.length)fail('NONEXISTENT_LOCAL_TIME',422,['preferred_time']);const supplied=selected!==undefined&&selected!==null&&selected!=='';if(matches.length>1&&!supplied)fail('AMBIGUOUS_LOCAL_TIME',422,['utc_offset_minutes']);const chosen=supplied?matches.find(x=>x.offset===Number(selected)):matches[0];if(!chosen)fail('INVALID_UTC_OFFSET',422,['utc_offset_minutes']);return new Date(chosen.ms).toISOString();}
function verifyHuman(p,action){if(p.website)fail('INVALID_REQUEST',400);if(typeof p.turnstile_token!=='string'||p.turnstile_token.length>2048)fail('HUMAN_VERIFICATION_REQUIRED',403);const r=JSON.parse(UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'post',payload:{secret:cfg('TURNSTILE_SECRET'),response:p.turnstile_token},muteHttpExceptions:true}).getContentText());const githubTest=dhIsDevelopment_()&&cfg('DEV_TEST_WEBSITE_HOSTNAME','')==='mfds824.github.io'&&r.hostname==='mfds824.github.io';if(!r.success||(!githubTest&&r.hostname!==cfg('ALLOWED_HOSTNAME'))||r.action!==action)fail('HUMAN_VERIFICATION_FAILED',403);}
function property(id){if(DH_VIEWING_CONTEXT_==='production'&&!cfg('LIVE_PROPERTY_IDS','').split(',').includes(id))fail('PROPERTY_UNAVAILABLE',404);const s=sheet('DH_Viewing_Properties',PROPS);if(s.getLastRow()<2)fail('PROPERTY_UNAVAILABLE',404);const row=s.getRange(2,1,s.getLastRow()-1,PROPS.length).getDisplayValues().find(x=>x[0]===id&&x[3].toLowerCase()==='true');if(!row)fail('PROPERTY_UNAVAILABLE',404);const p=Object.fromEntries(PROPS.map((k,i)=>[k,row[i]]));if(!/^https:\/\//.test(p.property_url)||!p.agent_email.includes('@')||!p.calendar_id||(!dhTelegramDisabled_()&&(!p.telegram_chat_id||!p.telegram_user_ids)))throw new Error('PROPERTY_CONFIG');return p;}
// Never trust browser property titles, URLs or agent/calendar routing.
function intake(p){const email=clean(p.email,254).toLowerCase(),name=clean(p.customer_name,120),phone=clean(p.whatsapp,32),country=clean(p.country,80),id=clean(p.property_id,80);if(!name||!country||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\+[1-9]\d{7,14}$/.test(phone)||!id||p.consent!==true)fail('INVALID_REQUEST',422,['customer_name','email','whatsapp','country','property_id','consent']);const tz=timezone(clean(p.buyer_timezone,80)),date=clean(p.preferred_date,10),time=clean(p.preferred_time,5),utc=localToUtc(date,time,tz,p.utc_offset_minutes),start=Date.parse(utc),key=clean(p.idempotency_key,100),notes=clean(p.notes,1500);if(!/^[A-Za-z0-9_-]{16,100}$/.test(key))fail('INVALID_IDEMPOTENCY_KEY',422);const fingerprint=hash(JSON.stringify([id,email,name,phone,country,tz,utc,notes,true]));verifyHuman(p,'booking');const bookings=all(),old=bookings.find(b=>b._key===hash(key));if(old){if(old._fingerprint!==fingerprint)fail('IDEMPOTENCY_KEY_REUSED',409);return {booking_id:old.booking_id,status:old.booking_status,duplicate:true};}const duplicate=bookings.find(b=>b.email===email&&b.property_id===id&&b.viewing_datetime_utc===utc&&ACTIVE.includes(b.booking_status));if(duplicate)return {booking_id:duplicate.booking_id,status:duplicate.booking_status,duplicate:true};if(start<Date.now()+3600000||start>Date.now()+90*86400000)fail('OUTSIDE_BOOKING_WINDOW',422);const local=Utilities.formatDate(new Date(start),'Asia/Colombo','HH:mm'),mins=Number(local.slice(0,2))*60+Number(local.slice(3));if(mins<Number(cfg('VIEWING_START_MINUTES','1020'))||mins+30>Number(cfg('VIEWING_END_MINUTES','1320')))fail('OUTSIDE_VIEWING_HOURS',422);if(bookings.filter(b=>b._emailHash===hash(email)&&Date.parse(b.created_at)>Date.now()-86400000).length>=5||bookings.filter(b=>Date.parse(b.created_at)>Date.now()-60000).length>=20)fail('RATE_LIMITED',429);const pr=property(id);if(dhIsDevelopment_()){dhAssertDevelopmentRouting_(email,pr.agent_email,pr.calendar_id);}else if(DH_VIEWING_CONTEXT_==='production'){dhAssertLiveRouting_(email,pr.agent_email,pr.calendar_id);}const b={booking_id:'dh'+Utilities.getUuid().replace(/-/g,''),created_at:now(),property_id:id,property_title:pr.property_title,property_url:pr.property_url,customer_name:name,email,whatsapp:phone,country,buyer_timezone:tz,preferred_date:date,preferred_time:time,viewing_datetime_utc:utc,viewing_datetime_sri_lanka:Utilities.formatDate(new Date(start),'Asia/Colombo','yyyy-MM-dd HH:mm Z'),agent_id:pr.agent_id,agent_email:pr.agent_email,booking_status:'pending_approval',google_meet_link:'',calendar_event_id:'',reminder_24h_sent:false,reminder_1h_sent:false,viewing_completed:false,customer_feedback:'',follow_up_status:'pending',_key:hash(key),_fingerprint:fingerprint,_emailHash:hash(email),_calendar:pr.calendar_id,_chat:pr.telegram_chat_id,_users:(pr.telegram_user_ids||'').split(',').map(x=>x.trim()).filter(Boolean),_nonce:token().slice(0,12),_manage:token(),_notes:notes,_consentAt:now(),_sent:{},_jobs:['received','agent_pending'],_approvalExpires:new Date(Math.min(Date.now()+86400000,start-1800000)).toISOString()};if(!available(b,bookings)){b.booking_status='reschedule_requested';b._jobs=['alternative'];}save(b);return {httpStatus:202,booking_id:b.booking_id,status:b.booking_status,message:b.booking_status==='pending_approval'?'Request received; agent approval is pending.':'Requested time is unavailable. Please select another time.'};}
function overlap(a,b,c,d){return a<d&&c<b;}
function available(b,bookings){const start=Date.parse(b.viewing_datetime_utc),end=start+1800000;if(bookings.some(x=>x.booking_id!==b.booking_id&&x._calendar===b._calendar&&ACTIVE.includes(x.booking_status)&&overlap(start,end,Date.parse(x.viewing_datetime_utc),Date.parse(x.viewing_datetime_utc)+1800000)))return false;const r=google('post','/freeBusy',{timeMin:new Date(start).toISOString(),timeMax:new Date(end).toISOString(),items:[{id:b._calendar}]}),cal=r.calendars&&r.calendars[b._calendar];if(!cal||cal.errors)throw new Error('CALENDAR_ACCESS_FAILED');return !cal.busy.some(x=>overlap(start,end,Date.parse(x.start),Date.parse(x.end)));}
function google(method,path,body,allowed){const options={method,headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true};if(body){options.contentType='application/json';options.payload=JSON.stringify(body);}const r=UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3'+path,options),code=r.getResponseCode();if((allowed||[]).includes(code))return {httpCode:code};if(code<200||code>=300)throw new Error('GOOGLE_'+code);return r.getContentText()?JSON.parse(r.getContentText()):{};}
function tg(method,data){if(DH_VIEWING_CONTEXT_==='production'&&method==='sendMessage'&&String(data.chat_id)!==cfg('LIVE_TELEGRAM_ID'))fail('PRODUCTION_ROUTING_REQUIRED',403);if(dhIsDevelopment_()&&method==='sendMessage'&&String(data.chat_id)!==cfg('DEV_TEST_TELEGRAM_ID'))fail('DEV_TEST_ROUTING_REQUIRED',403);const r=UrlFetchApp.fetch('https://api.telegram.org/bot'+cfg('TELEGRAM_BOT_TOKEN')+'/'+method,{method:'post',contentType:'application/json',payload:JSON.stringify(data),muteHttpExceptions:true}),j=JSON.parse(r.getContentText());if(!j.ok)throw new Error('TELEGRAM_FAILED');return j.result;}
function buttons(b,actions){return {inline_keyboard:[actions.map(([label,a])=>({text:label,callback_data:a+'|'+b.booking_id+'|'+b._nonce}))]};}
function ack(q,text){try{tg('answerCallbackQuery',{callback_query_id:q.id,text});}catch(e){log('','CALLBACK_ACK_FAILED');}}
function enqueue(b,job){if(!b._sent[job]&&!b._jobs.includes(job))b._jobs.push(job);}
function agentAction(update){const q=update.callback_query;if(!q)return {ignored:true};const parts=String(q.data||'').split('|'),action=parts[0],b=all().find(x=>x.booking_id===parts[1]);if(!b||!equal(parts[2],b._nonce)||!q.message||String(q.message.chat.id)!==b._chat||!b._users.includes(String(q.from.id)))fail('UNAUTHORIZED_AGENT',403);if(['a','r','s'].includes(action)){if(b.booking_status!=='pending_approval'){ack(q,'Already processed.');return {ignored:true};}if(Date.now()>Date.parse(b._approvalExpires)){b.booking_status='expired';enqueue(b,'expired');save(b);ack(q,'Request expired.');return {status:'expired'};}b._approvedBy=String(q.from.id);b._decidedAt=now();b.booking_status=action==='a'?'approved':action==='r'?'rejected':'reschedule_requested';if(action!=='a')enqueue(b,action==='r'?'rejected':'alternative');}else if(action==='c'){if(b.booking_status==='completed'){ack(q,'Already completed.');return {ignored:true};}if(b.booking_status!=='confirmed'||Date.now()<Date.parse(b.viewing_datetime_utc)+1800000)fail('INVALID_COMPLETION_STATE',409);b.booking_status='completed';b.viewing_completed=true;b._completedAt=now();b.follow_up_status='awaiting_feedback';enqueue(b,'feedback');}else if(action==='x'){if(!ACTIVE.includes(b.booking_status)){ack(q,'Already closed.');return {ignored:true};}b.booking_status='cancelling';}else if(action==='m'){if(b.booking_status!=='awaiting_meeting_setup')fail('INVALID_MEETING_RETRY_STATE',409);b._retryMeet=true;}else fail('INVALID_AGENT_ACTION',400);save(b);ack(q,'Saved: '+b.booking_status.replace(/_/g,' '));return {status:b.booking_status};}
function eventPath(b){return '/calendars/'+encodeURIComponent(b._calendar)+'/events/'+b.booking_id;}
function getEvent(b){return google('get',eventPath(b),null,[404,410]);}
// GET the deterministic event before free/busy: a retry must recognize its own event.
// Invitation PATCH can repeat if interrupted before _invited is saved.
function reconcileCalendar(b,bookings){let ev=getEvent(b);if(ev.httpCode===410||ev.status==='cancelled'){b.booking_status='cancelled';enqueue(b,'cancelled');save(b);return;}if(ev.httpCode===404){if(Date.parse(b.viewing_datetime_utc)<Date.now()+300000||!available(b,bookings)){b.booking_status='reschedule_requested';enqueue(b,'alternative');save(b);return;}b.booking_status='awaiting_meeting_setup';save(b);const body={id:b.booking_id,summary:'DwellHunt virtual viewing - '+b.property_title,description:'Booking '+b.booking_id+'\n'+b.property_url,start:{dateTime:b.viewing_datetime_utc,timeZone:'Asia/Colombo'},end:{dateTime:new Date(Date.parse(b.viewing_datetime_utc)+1800000).toISOString(),timeZone:'Asia/Colombo'},attendees:[...new Set([b.email,b.agent_email])].map(email=>({email})),conferenceData:{createRequest:{requestId:b.booking_id,conferenceSolutionKey:{type:'hangoutsMeet'}}},extendedProperties:{private:{dwellhuntBookingId:b.booking_id}},reminders:{useDefault:false}};ev=google('post','/calendars/'+encodeURIComponent(b._calendar)+'/events?conferenceDataVersion=1&sendUpdates=none',body,[409]);if(ev.httpCode===409)ev=getEvent(b);}if(!ev.extendedProperties||!ev.extendedProperties.private||ev.extendedProperties.private.dwellhuntBookingId!==b.booking_id)throw new Error('EVENT_IDENTITY_MISMATCH');if(Date.parse(ev.start.dateTime)!==Date.parse(b.viewing_datetime_utc)||Date.parse(ev.end.dateTime)!==Date.parse(b.viewing_datetime_utc)+1800000){b.booking_status='cancelling';save(b);log(b.booking_id,'EXTERNAL_RESCHEDULE_BLOCKED');return;}b.calendar_event_id=ev.id;if(Date.parse(b.viewing_datetime_utc)<=Date.now()){b.booking_status='cancelling';save(b);return;}const status=ev.conferenceData&&ev.conferenceData.createRequest&&ev.conferenceData.createRequest.status&&ev.conferenceData.createRequest.status.statusCode;if(status==='failure'&&b._retryMeet){b._retryMeet=false;save(b);google('patch',eventPath(b)+'?conferenceDataVersion=1&sendUpdates=none',{conferenceData:{createRequest:{requestId:token(),conferenceSolutionKey:{type:'hangoutsMeet'}}}});return;}const video=ev.conferenceData&&ev.conferenceData.entryPoints&&ev.conferenceData.entryPoints.find(x=>x.entryPointType==='video'&&/^https:\/\/meet\.google\.com\//.test(x.uri));if(status!=='success'||!video){b.booking_status='awaiting_meeting_setup';if(status==='failure')enqueue(b,'agent_meet_failed');save(b);return;}b.google_meet_link=video.uri;if(!b._invited){google('patch',eventPath(b)+'?sendUpdates=all',{description:'Booking '+b.booking_id+'\n'+b.property_url+'\nGoogle Meet: '+video.uri});b._invited=true;save(b);}b.booking_status='confirmed';enqueue(b,'confirmed');enqueue(b,'agent_confirmed');save(b);}
function cancel(b){const ev=getEvent(b);if(!ev.httpCode&&ev.status!=='cancelled')google('delete',eventPath(b)+'?sendUpdates=all',null,[404,410]);b.booking_status='cancelled';b.follow_up_status='closed';enqueue(b,'cancelled');save(b);}
function customerAction(p){verifyHuman(p,'manage');const b=all().find(x=>x.booking_id===clean(p.booking_id,40));if(!b||!equal(p.manage_token,b._manage)||b._redacted||Date.now()>Date.parse(b.viewing_datetime_utc)+30*86400000)fail('INVALID_OR_EXPIRED_LINK',403);if(p.operation==='cancel'){if(['cancelled','cancelling'].includes(b.booking_status))return {status:b.booking_status};if(!ACTIVE.includes(b.booking_status))fail('INVALID_CANCELLATION_STATE',409);b.booking_status='cancelling';b._cancelledBy='buyer';save(b);return {httpStatus:202,status:'cancelling'};}if(p.operation!=='feedback'||b.booking_status!=='completed')fail('VIEWING_NOT_COMPLETED',409);const intent=clean(p.intent,40),text=clean(p.feedback,1500);if(!['offer','physical_visit','another_property','more_information','not_interested'].includes(intent))fail('INVALID_FEEDBACK_INTENT',422);const fp=hash(intent+'|'+text);if(b._feedbackFingerprint){if(b._feedbackFingerprint!==fp)fail('FEEDBACK_ALREADY_SUBMITTED',409);return {status:'feedback_received',duplicate:true};}b._feedbackFingerprint=fp;b.customer_feedback=JSON.stringify({intent,feedback:text,at:now()});b._intent=intent;b.follow_up_status=intent==='not_interested'?'closed':'scheduled';b._followupDue=new Date(Date.now()+86400000).toISOString();enqueue(b,'agent_feedback');if(intent!=='not_interested')enqueue(b,'feedback_ack');save(b);return {status:'feedback_received'};}
function terminal(b){return ['completed','cancelled','rejected','reschedule_requested','expired'].includes(b.booking_status);}
// Rotating cursor prevents later rows starving behind earlier failures/backlog.
// Jobs are isolated: failed email delivery must not block the Telegram approval request.
function tick(post){const deadline=Date.now()+40000,bookings=dhWorkflowBookings_(),ck=post?'POST_CURSOR':'REMINDER_CURSOR',cursor=Number(cfg(ck,'0'))%Math.max(1,bookings.length);let processed=0,errors=0;for(let n=0;n<bookings.length&&Date.now()<deadline;n++){const index=(cursor+n)%bookings.length,b=bookings[index];PropertiesService.getScriptProperties().setProperty(DH_VIEWING_CONTEXT_==='production'?'LIVE_'+ck:ck,String(index+1));try{if(b._redacted)continue;if(!post){if(b.booking_status==='pending_approval'&&Date.now()>Date.parse(b._approvalExpires)){b.booking_status='expired';enqueue(b,'expired');save(b);}if(['approved','awaiting_meeting_setup'].includes(b.booking_status))reconcileCalendar(b,bookings);if(b.booking_status==='cancelling')cancel(b);if(b.booking_status==='confirmed'){const ev=getEvent(b);if(ev.httpCode||ev.status==='cancelled'){b.booking_status='cancelled';enqueue(b,'cancelled');save(b);}else if(Date.parse(ev.start.dateTime)!==Date.parse(b.viewing_datetime_utc)||Date.parse(ev.end.dateTime)!==Date.parse(b.viewing_datetime_utc)+1800000){b.booking_status='cancelling';save(b);}else{const delta=Date.parse(b.viewing_datetime_utc)-Date.now();if(delta>3600000&&delta<=86400000&&Date.parse(b.created_at)<=Date.parse(b.viewing_datetime_utc)-86400000&&!b.reminder_24h_sent)enqueue(b,'reminder24');if(delta>0&&delta<=3600000&&!b.reminder_1h_sent)enqueue(b,'reminder1');}}}else{if(b.booking_status==='confirmed'&&Date.now()>Date.parse(b.viewing_datetime_utc)+1800000)enqueue(b,'agent_complete');if(b.booking_status==='completed'&&b.follow_up_status!=='closed'&&!b._sent.followup&&Date.now()>Date.parse(b._followupDue||new Date(Date.parse(b._completedAt)+2*86400000).toISOString()))enqueue(b,'followup');}save(b);for(const job of [...b._jobs]){if(Date.now()>deadline)break;try{deliver(b,job);}catch(e){errors++;log(b.booking_id,'DELIVERY_FAILED');if(!b._lastAlert||Date.now()-Date.parse(b._lastAlert)>3600000){b._lastAlert=now();save(b);alertOps('Delivery needs attention for '+b.booking_id);}}}mirror(b);processed++;const closedAt=b._closedAt||b._completedAt||b._decidedAt||b._approvalExpires;if(post&&terminal(b)&&Date.now()>Date.parse(closedAt)+Number(cfg('RETENTION_DAYS','90'))*86400000)redact(b);}catch(e){errors++;log(b.booking_id,'WORKER_OPERATION_FAILED');if(!b._lastAlert||Date.now()-Date.parse(b._lastAlert)>3600000){b._lastAlert=now();save(b);alertOps('Booking '+b.booking_id+' needs attention. Check state and Trigger.dev.');}}}pruneLogs();return {processed,errors};}
function redact(b){for(const k of ['customer_name','email','whatsapp','country','customer_feedback','_notes','_manage','_emailHash','_intent'])b[k]='';b._jobs=[];b._users=[];b._redacted=true;save(b);log(b.booking_id,'RETENTION_REDACTED');}
function pruneLogs(){const s=sheet('DH_Viewing_Log',['timestamp','booking_id','code']);if(s.getLastRow()<2)return;const dates=s.getRange(2,1,s.getLastRow()-1,1).getDisplayValues();let count=0;for(const row of dates){if(Date.parse(row[0])<Date.now()-30*86400000)count++;else break;}if(count)s.deleteRows(2,count);}
function alertOps(text){if(dhTelegramDisabled_()){log('','DEV_OPS_ALERT_SKIPPED');return;}try{tg('sendMessage',{chat_id:cfg('OPS_CHAT_ID'),text:'DWELLHUNT SYSTEM ALERT\n'+text});}catch(e){log('','OPS_ALERT_FAILED');}}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function manageUrl(b){return cfg('WEBSITE_URL').replace(/\/$/,'')+'/#dwellhunt-booking='+encodeURIComponent(b.booking_id)+'&token='+b._manage;}
function emailTemplate(b,job){const copy={received:['Viewing request received','Thank you for your request. Agent approval is pending. This appointment is not yet confirmed.'],confirmed:['Your virtual viewing is confirmed','Your agent approved the appointment and your Google Meet meeting is ready.'],rejected:['Update on your viewing request','Your agent could not approve this request. Please choose another time or contact DwellHunt.'],alternative:['Please choose another viewing time','The requested time could not be booked. Submit a new request for another time; the previous request will not be confirmed.'],reminder24:['Your viewing is tomorrow','This is your 24-hour viewing reminder.'],reminder1:['Your viewing starts soon','This is your 1-hour viewing reminder.'],feedback:['How was your DwellHunt viewing?','Your agent recorded the viewing as completed. Tell us whether you would like to make an offer, arrange a physical visit, view another property, or receive further information.'],followup:['Your next step with DwellHunt','Would you like help taking the next step? Reply to this email and your property agent will assist you.'],feedback_ack:['Thank you for your feedback','We shared your next-step preference with your agent.'],cancelled:['Viewing cancelled','Your viewing has been cancelled. You can submit a new booking request at any time.'],expired:['Viewing request expired','Your request expired before approval. Please submit a new request for another time.']}[job];if(!copy)throw new Error('UNKNOWN_EMAIL_TEMPLATE');const buyer=Utilities.formatDate(new Date(b.viewing_datetime_utc),b.buyer_timezone,'yyyy-MM-dd HH:mm Z')+' ('+b.buyer_timezone+')',meeting=['confirmed','reminder24','reminder1'].includes(job)?'<p><a href="'+esc(b.google_meet_link)+'">Join Google Meet</a> - 30 minutes</p>':'';const html='<div style="font-family:Arial,sans-serif;max-width:620px;color:#15332c"><h1 style="color:#146b50">DwellHunt</h1><h2>'+esc(copy[0])+'</h2><p>Hello '+esc(b.customer_name)+',</p><p>'+esc(copy[1])+'</p><p><a href="'+esc(b.property_url)+'">'+esc(b.property_title)+'</a><br>Booking: '+esc(b.booking_id)+'</p><p>Your time: '+esc(buyer)+'<br>Sri Lanka: '+esc(b.viewing_datetime_sri_lanka)+' (Asia/Colombo)</p>'+meeting+'<p><a href="'+esc(manageUrl(b))+'">Manage booking / submit feedback</a></p><p>To reschedule, cancel the current booking and submit a new request.</p><p>DwellHunt - Sri Lankan property, wherever you are.<br>Reply to reach your agent. Keep your private management link secure.</p></div>';return {subject:'DwellHunt - '+copy[0],html,text:copy[0]+'\nHello '+b.customer_name+'\n'+copy[1]+'\n'+b.property_title+'\n'+b.property_url+'\nBooking: '+b.booking_id+'\nYour time: '+buyer+'\nSri Lanka: '+b.viewing_datetime_sri_lanka+'\n'+(meeting?b.google_meet_link+'\n':'')+'Manage booking / feedback: '+manageUrl(b)};}
// Notifications are at least once. There is a crash window between remote send and save.
// Validate current state immediately before sending and persist flags only after success.
function deliver(b,job){if(dhIsDevelopment_())dhAssertDevelopmentRouting_(b.email,b.agent_email,b._calendar);else if(DH_VIEWING_CONTEXT_==='production')dhAssertLiveRouting_(b.email,b.agent_email,b._calendar);if(b._sent[job]){b._jobs=b._jobs.filter(x=>x!==job);save(b);return;}const valid={received:['pending_approval','approved','awaiting_meeting_setup','confirmed'],agent_pending:['pending_approval'],confirmed:['confirmed'],agent_confirmed:['confirmed'],reminder24:['confirmed'],reminder1:['confirmed'],agent_complete:['confirmed'],feedback:['completed'],followup:['completed'],feedback_ack:['completed'],agent_feedback:['completed'],rejected:['rejected'],alternative:['reschedule_requested'],expired:['expired'],cancelled:['cancelled'],agent_meet_failed:['awaiting_meeting_setup']};if(!valid[job]||!valid[job].includes(b.booking_status)||(job==='reminder24'&&Date.parse(b.viewing_datetime_utc)-Date.now()<=3600000)||(job==='reminder1'&&Date.parse(b.viewing_datetime_utc)<=Date.now())||(job==='followup'&&b.follow_up_status==='closed')){b._jobs=b._jobs.filter(x=>x!==job);save(b);return;}if(job.startsWith('agent_')&&dhTelegramDisabled_()){b._sent[job]='disabled-development';b._jobs=b._jobs.filter(x=>x!==job);save(b);log(b.booking_id,'DEV_TELEGRAM_SKIPPED');return;}if(job.startsWith('agent_')){let text,markup;if(job==='agent_pending'){text='DWELLHUNT - NEW VIRTUAL VIEWING REQUEST\nProperty: '+b.property_title+'\nBuyer: '+b.customer_name+'\nEmail: '+b.email+'\nWhatsApp: '+b.whatsapp+'\nCountry: '+b.country+'\nBuyer Time: '+b.preferred_date+' '+b.preferred_time+' ('+b.buyer_timezone+')\nSri Lanka Time: '+b.viewing_datetime_sri_lanka+'\nBooking ID: '+b.booking_id+'\nStatus: Pending Approval\nNotes: '+b._notes;markup=buttons(b,[['Approve','a'],['Reject','r'],['Request Reschedule','s']]);}else if(job==='agent_confirmed'){text='DWELLHUNT - CONFIRMED\n'+b.booking_id+'\n'+b.property_title+'\nSri Lanka: '+b.viewing_datetime_sri_lanka+'\n'+b.google_meet_link;markup=buttons(b,[['Cancel viewing','x']]);}else if(job==='agent_complete'){text='DWELLHUNT - DID THIS VIEWING TAKE PLACE?\n'+b.booking_id+'\n'+b.property_title+'\nConfirm only after the live viewing took place.';markup=buttons(b,[['Confirm completed','c'],['Cancel / did not take place','x']]);}else if(job==='agent_meet_failed'){text='DWELLHUNT - MEETING SETUP FAILED\n'+b.booking_id+'\nNot confirmed. Fix Calendar/Meet permissions, then retry.';markup=buttons(b,[['Retry Meet setup','m'],['Cancel','x']]);}else{text='DWELLHUNT - '+(['offer','physical_visit'].includes(b._intent)?'HIGH-INTENT BUYER':'BUYER FEEDBACK')+'\n'+b.booking_id+'\n'+b.property_title+'\n'+b.customer_feedback;}const data={chat_id:b._chat,text};if(markup)data.reply_markup=markup;tg('sendMessage',data);}else{const t=emailTemplate(b,job);MailApp.sendEmail({to:b.email,subject:t.subject,body:t.text,htmlBody:t.html,name:'DwellHunt',replyTo:b.agent_email});}b._sent[job]=now();b._jobs=b._jobs.filter(x=>x!==job);if(job==='reminder24')b.reminder_24h_sent=true;if(job==='reminder1')b.reminder_1h_sent=true;if(job==='followup')b.follow_up_status='sent';save(b);}
// A NEW dedicated bot is required: Telegram supports only one webhook per bot.
function registerTelegramWebhook(){return tg('setWebhook',{url:cfg('TELEGRAM_WEBHOOK_URL'),secret_token:cfg('TELEGRAM_WEBHOOK_SECRET'),allowed_updates:['callback_query'],drop_pending_updates:false});}

// Fail closed unless BOTH explicit Development settings are present.
function dhTelegramDisabled_() {
  return dhIsDevelopment_() &&
    cfg('DEV_DISABLE_TELEGRAM','false') === 'true';
}

function dhIsDevelopment_() {
  return cfg('DWELLHUNT_ENVIRONMENT','') === 'development';
}

function dhWorkflowBookings_() {
  var bookings=all();
  if(dhIsDevelopment_()) bookings.forEach(function(b) {
    if(!b._redacted) dhAssertDevelopmentRouting_(b.email,b.agent_email,b._calendar);
  });
  if(DH_VIEWING_CONTEXT_==='production')bookings.forEach(function(b){if(!b._redacted)dhAssertLiveRouting_(b.email,b.agent_email,b._calendar);});
  return bookings;
}

function dhAssertDevelopmentOperator_() {
  if(!dhIsDevelopment_()) fail('DEV_ONLY_OPERATION',403);
  var expected=cfg('DEV_OPERATOR_EMAIL').trim().toLowerCase();
  if(!expected || Session.getActiveUser().getEmail().toLowerCase()!==expected ||
      Session.getEffectiveUser().getEmail().toLowerCase()!==expected)
    fail('UNAUTHORIZED_DEV_OPERATOR',403);
}

function developmentAutomationReadiness() {
  dhAssertDevelopmentOperator_();
  var me=tg('getMe',{}),chat=tg('getChat',{chat_id:cfg('DEV_TEST_TELEGRAM_ID')});
  var webhook=tg('getWebhookInfo',{});
  var report={check:'development-automation',bot_matches:me.username==='DwellHuntViewingStagingBot',
    private_test_chat:chat.type==='private' && String(chat.id)===cfg('DEV_TEST_TELEGRAM_ID'),
    webhook_matches:webhook.url===cfg('TELEGRAM_WEBHOOK_URL'),
    pending_updates:webhook.pending_update_count,telegram_disabled:dhTelegramDisabled_(),
    ops_chat_matches:cfg('OPS_CHAT_ID')===cfg('DEV_TEST_TELEGRAM_ID'),
    webhook_error_present:!!webhook.last_error_message};
  console.log(JSON.stringify(report));
  return report;
}

function developmentEnableTelegramRouting() {
  dhAssertDevelopmentOperator_();
  var report=developmentAutomationReadiness();
  if(!report.bot_matches || !report.private_test_chat || !report.webhook_matches ||
      !report.ops_chat_matches) fail('DEV_AUTOMATION_NOT_READY',409);
  var book=SpreadsheetApp.openById(cfg('SPREADSHEET_ID'));
  if(book.getName()!=='DwellHunt Viewing STAGING Database') fail('DEV_REGISTRY_REQUIRED',403);
  var s=book.getSheetByName('DH_Viewing_Properties');
  if(!s || s.getLastRow()<2) fail('PROPERTY_UNAVAILABLE',404);
  var rows=s.getRange(2,1,s.getLastRow()-1,PROPS.length).getDisplayValues();
  var selected=[];
  rows.forEach(function(row,i) {
    if(['prop-cinnamon-gardens-villa','prop-galle-face-penthouse'].includes(row[0])) {
      dhAssertDevelopmentRouting_(cfg('DEV_TEST_EMAIL'),row[5],row[6]);
      selected.push(i+2);
    }
  });
  if(!selected.length) fail('PROPERTY_UNAVAILABLE',404);
  var bookings=dhWorkflowBookings_(),chat=cfg('DEV_TEST_TELEGRAM_ID');
  selected.forEach(function(row){s.getRange(row,8,1,2).setValues([[chat,chat]]);});
  bookings.forEach(function(b){if(!b._redacted){b._chat=chat;b._users=[chat];save(b);}});
  PropertiesService.getScriptProperties().setProperty('DEV_DISABLE_TELEGRAM','false');
  log('','DEV_TELEGRAM_ENABLED');
  console.log(JSON.stringify({telegram_enabled:true,test_properties:selected.length,
    test_records_routed:bookings.length}));
}

// Read-only editor check. No calls to sheet(), save(), tick(), email or Telegram.
function developmentReadinessCheck() {
  var props = PropertiesService.getScriptProperties();
  var required = ['SPREADSHEET_ID','GATEWAY_SECRET','TURNSTILE_SECRET','ALLOWED_HOSTNAME',
    'WEBSITE_URL','DEV_TEST_EMAIL','DEV_TEST_CALENDAR_ID','DEV_OPERATOR_EMAIL'];
  var report = {check:'development-readiness',development_mode:dhIsDevelopment_(),telegram_disabled:dhTelegramDisabled_(),
    missing_settings:required.filter(function(k) { return !props.getProperty(k); })};
  try {
    var book = SpreadsheetApp.openById(cfg('SPREADSHEET_ID'));
    report.staging_registry = book.getName() === 'DwellHunt Viewing STAGING Database';
    report.schemas = {};
    var schemas = [['DwellHunt_Virtual_Viewings',CRM],['DH_Viewing_State',['booking_id','state_json']],
      ['DH_Viewing_Properties',PROPS],['DH_Viewing_Log',['timestamp','booking_id','code']]];
    schemas.forEach(function(pair) {
      var s=book.getSheetByName(pair[0]);
      report.schemas[pair[0]]=!!s && JSON.stringify(s.getRange(1,1,1,pair[1].length)
        .getDisplayValues()[0])===JSON.stringify(pair[1]);
    });
    var registry=book.getSheetByName('DH_Viewing_Properties');
    report.demo_properties=[];
    if(registry && report.schemas.DH_Viewing_Properties && registry.getLastRow()>1) {
      var rows=registry.getRange(2,1,registry.getLastRow()-1,PROPS.length).getDisplayValues();
      rows.filter(function(row){return ['prop-cinnamon-gardens-villa','prop-galle-face-penthouse']
        .includes(row[0]);}).forEach(function(row) {
        report.demo_properties.push({property_id:row[0],active:row[3].toLowerCase()==='true',
          https_url:/^https:\/\//.test(row[2]),test_agent_matches:!!props.getProperty('DEV_TEST_EMAIL') &&
            row[5].toLowerCase()===props.getProperty('DEV_TEST_EMAIL').trim().toLowerCase(),
          test_calendar_matches:!!props.getProperty('DEV_TEST_CALENDAR_ID') &&
            row[6]===props.getProperty('DEV_TEST_CALENDAR_ID').trim()});
      });
    }
    report.state_records=book.getSheetByName('DH_Viewing_State') ?
      Math.max(0,book.getSheetByName('DH_Viewing_State').getLastRow()-1) : null;
    if(report.staging_registry && props.getProperty('DEV_TEST_CALENDAR_ID')) {
      var start=new Date(),end=new Date(start.getTime()+1800000);
      var calendar=props.getProperty('DEV_TEST_CALENDAR_ID');
      var response=google('post','/freeBusy',{timeMin:start.toISOString(),timeMax:end.toISOString(),items:[{id:calendar}]});
      var cal=response.calendars && response.calendars[calendar];
      report.calendar_read_access=!!cal && !cal.errors;
      var calendarInfo=google('get','/calendars/'+encodeURIComponent(calendar));
      report.calendar_meet_supported=!!(calendarInfo.conferenceProperties &&
        (calendarInfo.conferenceProperties.allowedConferenceSolutionTypes||[]).includes('hangoutsMeet'));
      try {
        var listed=google('get','/users/me/calendarList/'+encodeURIComponent(calendar));
        report.calendar_write_role=['owner','writer'].includes(listed.accessRole);
      } catch(calendarListError) {
        report.calendar_write_role_unverified=true;
      }
    }
    report.email_quota_available=MailApp.getRemainingDailyQuota()>0;
    try {
      report.operator_matches=!!props.getProperty('DEV_OPERATOR_EMAIL') &&
        Session.getActiveUser().getEmail().toLowerCase()===props.getProperty('DEV_OPERATOR_EMAIL').trim().toLowerCase();
    } catch(identityError) { report.operator_identity_permission_required=true; }
  } catch(error) { report.diagnostic_code=dhDiagnosticCode_(error); }
  console.log(JSON.stringify(report));
  return report;
}

function dhAssertDevelopmentRouting_(buyerEmail, agentEmail, calendarId) {
  var email = cfg('DEV_TEST_EMAIL').trim().toLowerCase();
  var calendar = cfg('DEV_TEST_CALENDAR_ID').trim();
  if (!email || !calendar || String(buyerEmail).toLowerCase() !== email ||
      String(agentEmail).toLowerCase() !== email || calendarId !== calendar)
    fail('DEV_TEST_ROUTING_REQUIRED', 403);
}

// Editor-only manual test controls. No public gateway action invokes these.
// DEV_BOOKING_ID must identify an EXISTING test booking; these never create one.
function dhDevelopmentBooking_() {
  if (!dhIsDevelopment_()) fail('DEV_ONLY_OPERATION', 403);
  var operator = cfg('DEV_OPERATOR_EMAIL').trim().toLowerCase();
  var active = Session.getActiveUser().getEmail().toLowerCase();
  var effective = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!operator || active !== operator || effective !== operator)
    fail('UNAUTHORIZED_DEV_OPERATOR', 403);
  var id = cfg('DEV_BOOKING_ID');
  var b = all().find(function(row) { return row.booking_id === id; });
  if (!b || b._redacted) fail('BOOKING_NOT_FOUND', 404);
  dhAssertDevelopmentRouting_(b.email, b.agent_email, b._calendar);
  // Recheck current registry availability and routing before approval/delivery.
  var pr = property(b.property_id);
  dhAssertDevelopmentRouting_(b.email, pr.agent_email, pr.calendar_id);
  return b;
}

function dhWithDevelopmentLock_(operation) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) fail('BUSY_RETRY', 503);
  try { return operation(dhDevelopmentBooking_()); }
  finally {
    try { lock.releaseLock(); }
    catch (error) { try { log('', 'LOCK_RELEASE_FAILED'); } catch (loggingError) {} }
  }
}

function developmentApproveTestBooking() {
  return dhWithDevelopmentLock_(function(b) {
    if (b.booking_status !== 'pending_approval') fail('INVALID_APPROVAL_STATE',409);
    if (Date.now() >= Date.parse(b._approvalExpires)) fail('APPROVAL_EXPIRED',409);
    b._approvedBy = 'development:' + Session.getActiveUser().getEmail();
    b._decidedAt = now();
    b.booking_status = 'approved';
    save(b);
    return {ok:true, booking_id:b.booking_id, status:b.booking_status};
  });
}

function developmentInspectTestBooking() {
  var b=dhDevelopmentBooking_();
  var report={booking_id:b.booking_id,status:b.booking_status,
    pending_jobs:b._jobs.slice(),sent_jobs:Object.keys(b._sent),
    calendar_event_id:b.calendar_event_id||null,meet_link_present:!!b.google_meet_link};
  var crm=SpreadsheetApp.openById(cfg('SPREADSHEET_ID')).getSheetByName('DwellHunt_Virtual_Viewings');
  var crmRow=crm && crm.getLastRow()>1 ? crm.getRange(2,1,crm.getLastRow()-1,CRM.length)
    .getDisplayValues().find(function(row){return row[0]===b.booking_id;}) : null;
  report.crm_record_present=!!crmRow;
  report.crm_status_matches=!!crmRow && crmRow[CRM.indexOf('booking_status')]===b.booking_status;
  if(b.calendar_event_id) {
    var ev=getEvent(b);
    report.event_exists=!ev.httpCode && ev.status!=='cancelled';
    report.event_matches_booking=!!(ev.extendedProperties && ev.extendedProperties.private &&
      ev.extendedProperties.private.dwellhuntBookingId===b.booking_id);
    report.event_time_matches=!!(ev.start && ev.end &&
      Date.parse(ev.start.dateTime)===Date.parse(b.viewing_datetime_utc) &&
      Date.parse(ev.end.dateTime)===Date.parse(b.viewing_datetime_utc)+1800000);
    report.only_test_attendees=!!ev.attendees && ev.attendees.length>0 &&
      ev.attendees.every(function(person){return String(person.email).toLowerCase()===cfg('DEV_TEST_EMAIL').trim().toLowerCase();});
    report.meet_ready=!!(ev.conferenceData && ev.conferenceData.createRequest &&
      ev.conferenceData.createRequest.status && ev.conferenceData.createRequest.status.statusCode==='success');
    report.invitation_requested=b._invited===true;
  }
  console.log(JSON.stringify(report));
  return report;
}

// Explicitly run for ONE existing test booking; no schedules or bulk tick().
// After a delivery error inspect its outcome before running again (at-least-once email).
function developmentProcessTestBooking() {
  return dhWithDevelopmentLock_(function(b) {
    if (['approved','awaiting_meeting_setup'].includes(b.booking_status))
      reconcileCalendar(b, all());
    var jobs = b._jobs.slice();
    for (var i=0; i<jobs.length; i++) deliver(b,jobs[i]);
    return {ok:true, booking_id:b.booking_id, status:b.booking_status,
      calendar_created:!!b.calendar_event_id, email_jobs_sent:Object.keys(b._sent)
        .filter(function(job) { return !job.startsWith('agent_'); })};
  });
}

function dhAssertLiveRouting_(buyerEmail,agentEmail,calendarId){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(buyerEmail))||String(agentEmail).trim().toLowerCase()!==cfg('LIVE_AGENT_EMAIL').trim().toLowerCase()||calendarId!==cfg('LIVE_CALENDAR_ID'))fail('PRODUCTION_ROUTING_REQUIRED',403);
}
function viewingHealth(){
  const ids=cfg('LIVE_PROPERTY_IDS','').split(',').filter(Boolean);
  if(DH_VIEWING_CONTEXT_!=='production'||!ids.length)fail('PRODUCTION_CONFIG_REQUIRED',503);
  const book=SpreadsheetApp.openById(cfg('SPREADSHEET_ID'));
  if(book.getId()!==cfg('LIVE_SPREADSHEET_ID'))fail('PRODUCTION_CONFIG_REQUIRED',503);
  [['DwellHunt_Virtual_Viewings',CRM],['DH_Viewing_State',['booking_id','state_json']],['DH_Viewing_Properties',PROPS],['DH_Viewing_Log',['timestamp','booking_id','code']]].forEach(function(def){const sh=book.getSheetByName(def[0]);if(!sh||JSON.stringify(sh.getRange(1,1,1,def[1].length).getDisplayValues()[0])!==JSON.stringify(def[1]))fail('PRODUCTION_SCHEMA_REQUIRED',503);});
  ids.forEach(function(id){const p=property(id);dhAssertLiveRouting_('readiness@example.test',p.agent_email,p.calendar_id);if(p.telegram_chat_id!==cfg('LIVE_TELEGRAM_ID')||p.telegram_user_ids!==cfg('LIVE_TELEGRAM_ID'))fail('PRODUCTION_ROUTING_REQUIRED',503);});
  const cal=cfg('LIVE_CALENDAR_ID'),info=google('get','/calendars/'+encodeURIComponent(cal)),listed=google('get','/users/me/calendarList/'+encodeURIComponent(cal));
  const writable=['owner','writer'].includes(listed.accessRole),meet=!!(info.conferenceProperties&&(info.conferenceProperties.allowedConferenceSolutionTypes||[]).includes('hangoutsMeet'));
  if(!writable||!meet||cfg('ALLOWED_HOSTNAME')!=='mfds824.github.io'||MailApp.getRemainingDailyQuota()<1)fail('PRODUCTION_CONFIG_REQUIRED',503);
  return {ok:true,httpStatus:200,mode:'production',property_ids:ids,calendar_write_access:writable,meet_supported:meet,email_quota_available:true,state_records:Math.max(0,book.getSheetByName('DH_Viewing_State').getLastRow()-1)};
}
