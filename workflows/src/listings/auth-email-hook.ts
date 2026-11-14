type AuthEmailHookConfig={
 SUPABASE_SEND_EMAIL_HOOK_SECRET?:string;
 LISTING_SUPABASE_URL?:string;
 WEBSITE_ORIGIN?:string;
 APPS_SCRIPT_EXEC_URL?:string;
 APPS_SCRIPT_AUTH_BODY_JSON?:string;
 APPS_SCRIPT_AUTH_HEADERS_JSON?:string;
};

type AuthEmailPayload={
 user?:{email?:unknown;new_email?:unknown};
 email_data?:{
  token?:unknown;token_hash?:unknown;token_new?:unknown;token_hash_new?:unknown;
  redirect_to?:unknown;site_url?:unknown;email_action_type?:unknown;
 };
};

const MAX_BODY=32_768,MAX_CLOCK_SKEW_MS=5*60_000;
const ACTIONS=new Set(['signup','magiclink','recovery','invite','email_change','reauthentication']);

function json(body:unknown,status:number){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
function decodeBase64(value:string){
 const binary=atob(value);const bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return bytes;
}
function safeUrl(value:unknown,allowedOrigin:string){
 if(typeof value!=='string'||!value)return null;
 try{const parsed=new URL(value);return parsed.protocol==='https:'&&parsed.origin===allowedOrigin&&!parsed.username&&!parsed.password?parsed.href:null;}
 catch{return null;}
}
async function verifySignature(request:Request,body:string,secret:string,now:number){
 const id=request.headers.get('webhook-id')||'',timestamp=request.headers.get('webhook-timestamp')||'',signature=request.headers.get('webhook-signature')||'';
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!/^\d{10,13}$/.test(timestamp))return null;
 const seconds=Number(timestamp);const timeMs=timestamp.length===13?seconds:Number(timestamp)*1000;
 if(!Number.isSafeInteger(timeMs)||Math.abs(now-timeMs)>MAX_CLOCK_SKEW_MS)return null;
 const secretMatch=/^v1,whsec_([A-Za-z0-9+/]+={0,2})$/.exec(secret);
 if(!secretMatch)return null;
 let keyBytes:Uint8Array;try{keyBytes=decodeBase64(secretMatch[1]);}catch{return null;}
 if(keyBytes.length<16)return null;
 const keyMaterial=new Uint8Array(keyBytes).buffer as ArrayBuffer;
 const key=await crypto.subtle.importKey('raw',keyMaterial,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=new TextEncoder().encode(`${id}.${timestamp}.${body}`);
 const expected=new Uint8Array(await crypto.subtle.sign('HMAC',key,signed));
 for(const candidate of signature.split(/\s+/)){
  const match=/^v1,([A-Za-z0-9+/]+={0,2})$/.exec(candidate);if(!match)continue;
  let got:Uint8Array;try{got=decodeBase64(match[1]);}catch{continue;}
  if(got.length!==expected.length)continue;
  let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected[i]^got[i];
  if(mismatch===0)return id;
 }
 return null;
}
function object(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function html(value:string){return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
function emailSubject(action:string){
 return ({signup:'Confirm your DwellHunt account',magiclink:'Your DwellHunt sign-in code',recovery:'Reset your DwellHunt password',invite:'You are invited to DwellHunt',email_change:'Confirm your email address',reauthentication:'Verify your DwellHunt account'} as Record<string,string>)[action]||'DwellHunt account verification';
}
function buildMessage(email:string,action:string,token:string,tokenHash:string,authBase:string,redirectTo:string){
 if(!tokenHash&&!token)throw new Error('AUTH_EMAIL_TOKEN_REQUIRED');
 const query=new URLSearchParams();
 if(tokenHash){query.set('token',tokenHash);query.set('type',action==='email_change'?'email_change':action);query.set('redirect_to',redirectTo);}
 const link=tokenHash?`${authBase}/auth/v1/verify?${query.toString()}`:'';
 const code=token?`<p>Your one-time code is <strong>${html(token)}</strong>.</p>`:'';
 const button=link?`<p><a href="${html(link)}">Continue to DwellHunt</a></p>`:'';
 const greeting=`<p>This message was requested for <strong>${html(email)}</strong>.</p>`;
 const htmlBody=`<!doctype html><html><body><h2>${html(emailSubject(action))}</h2>${greeting}${code}${button}<p>If you did not request this, you can ignore this message.</p></body></html>`;
 const textBody=[emailSubject(action),`Account: ${email}`,token?`One-time code: ${token}`:'',link?`Continue: ${link}`:'','If you did not request this, ignore this message.'].filter(Boolean).join('\n\n');
 return {to:email,subject:emailSubject(action),htmlBody,textBody};
}
function messagesFor(payload:AuthEmailPayload,config:AuthEmailHookConfig){
 const user=object(payload.user),data=object(payload.email_data),action=data.email_action_type;
 if(typeof action!=='string'||!ACTIONS.has(action))throw new Error('AUTH_EMAIL_ACTION_UNSUPPORTED');
 const email=typeof user.email==='string'?user.email.trim().toLowerCase():'';
 if(!/^[^\s@\r\n]{1,128}@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(email))throw new Error('AUTH_EMAIL_RECIPIENT_INVALID');
 const origin=new URL(config.WEBSITE_ORIGIN||'').origin;
 const redirectTo=data.redirect_to!==undefined&&data.redirect_to!==''?safeUrl(data.redirect_to,origin):safeUrl(data.site_url,origin);
 if(action!=='reauthentication'&&!redirectTo)throw new Error('AUTH_EMAIL_REDIRECT_INVALID');
 const authBase=new URL(config.LISTING_SUPABASE_URL||'');
 if(authBase.protocol!=='https:')throw new Error('AUTH_EMAIL_PROVIDER_INVALID');
 const base=authBase.origin.replace(/\/$/,'');
 const token=typeof data.token==='string'?data.token:'';
 const tokenHash=typeof data.token_hash==='string'?data.token_hash:'';
 const messages=[];
 if(action==='email_change'&&typeof user.new_email==='string'){
  const next=user.new_email.trim().toLowerCase();
  if(!/^[^\s@\r\n]{1,128}@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(next))throw new Error('AUTH_EMAIL_RECIPIENT_INVALID');
  if(typeof data.token_new==='string'&&typeof data.token_hash_new==='string'){
   messages.push(buildMessage(email,action,token,String(data.token_hash_new),base,redirectTo||origin));
   messages.push(buildMessage(next,action,data.token_new,tokenHash,base,redirectTo||origin));
  }else{
   messages.push(buildMessage(next,action,token,tokenHash,base,redirectTo||origin));
  }
 }else{
  messages.push(buildMessage(email,String(action),token,tokenHash,base,redirectTo||origin));
 }
 return messages;
}

export async function handleSupabaseSendEmailHook(request:Request,config:AuthEmailHookConfig,fetcher:typeof fetch=fetch,now=Date.now()):Promise<Response>{
 if(request.method!=='POST')return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return json({ok:false,code:'JSON_REQUIRED'},415);
 const secret=config.SUPABASE_SEND_EMAIL_HOOK_SECRET;
 if(!secret)return json({ok:false,code:'HOOK_NOT_CONFIGURED'},503);
 let body:string;try{body=await request.text();}catch{return json({ok:false,code:'INVALID_BODY'},400);}
 if(new TextEncoder().encode(body).byteLength>MAX_BODY)return json({ok:false,code:'PAYLOAD_TOO_LARGE'},413);
 const hookId=await verifySignature(request,body,secret,now);
 if(!hookId)return json({ok:false,code:'UNAUTHORIZED'},401);
 let event:AuthEmailPayload;try{event=JSON.parse(body) as AuthEmailPayload;}catch{return json({ok:false,code:'INVALID_JSON'},400);}
 let messages:ReturnType<typeof buildMessage>[];
 try{messages=messagesFor(event,config);}catch(error){return json({ok:false,code:error instanceof Error?error.message:'INVALID_AUTH_EMAIL'},400);}
 const endpoint=config.APPS_SCRIPT_EXEC_URL,auth=config.APPS_SCRIPT_AUTH_BODY_JSON;
 if(!endpoint||!auth)return json({ok:false,code:'MAIL_GATEWAY_NOT_CONFIGURED'},503);
 try{
  const url=new URL(endpoint);if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!url.pathname.endsWith('/exec'))throw new Error();
  const authBody:unknown=JSON.parse(auth);if(!authBody||typeof authBody!=='object'||Array.isArray(authBody)||'action'in authBody||'payload'in authBody)throw new Error();
  const headersValue:unknown=JSON.parse(config.APPS_SCRIPT_AUTH_HEADERS_JSON||'{}');
  if(!headersValue||typeof headersValue!=='object'||Array.isArray(headersValue)||Object.keys(headersValue).some(k=>['content-type','host','content-length'].includes(k.toLowerCase()))||Object.values(headersValue).some(v=>typeof v!=='string'))throw new Error();
  const response=await fetcher(url,{method:'POST',headers:{...headersValue as Record<string,string>,'Content-Type':'application/json'},body:JSON.stringify({...authBody as Record<string,unknown>,action:'auth_email_send',payload:{hookId,messages}}),signal:AbortSignal.timeout(20_000)});
  if(!response.ok)return json({ok:false,code:'MAIL_DELIVERY_UNAVAILABLE'},503);
  const result=object(await response.json());if(result.ok!==true||result.outcome!=='Delivered')return json({ok:false,code:'MAIL_DELIVERY_UNAVAILABLE'},503);
  return json({},200);
 }catch{return json({ok:false,code:'MAIL_DELIVERY_UNAVAILABLE'},503);}
}

