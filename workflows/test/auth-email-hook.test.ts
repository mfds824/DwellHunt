import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {handleSupabaseSendEmailHook} from '../src/listings/auth-email-hook';

const key=Buffer.from('dwellhunt-no-domain-auth-hook-test-key-01');
const secret='v1,whsec_'+key.toString('base64');
const config={SUPABASE_SEND_EMAIL_HOOK_SECRET:secret,LISTING_SUPABASE_URL:'https://rnbeqdffsbxjziklgtpj.supabase.co',
 WEBSITE_ORIGIN:'https://mfds824.github.io',APPS_SCRIPT_EXEC_URL:'https://script.google.com/macros/s/test/exec',APPS_SCRIPT_AUTH_BODY_JSON:'{"gatewaySecret":"test-secret"}'};
function request(payload:unknown,now:number,overrides:Record<string,string>={}){
 const body=JSON.stringify(payload),id='msg_dwellhunt_test_01',timestamp=String(Math.floor(now/1000));
 const signature=createHmac('sha256',key).update(`${id}.${timestamp}.${body}`).digest('base64');
 return new Request('https://dwellhunt-listings-api.example.workers.dev/hooks/supabase/send-email',{method:'POST',headers:{'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':`v1,${signature}`,...overrides},body});
}
const signup={user:{email:'synthetic@example.test'},email_data:{email_action_type:'magiclink',token:'123456',token_hash:'test-token-hash',redirect_to:'https://mfds824.github.io/DwellHunt/',site_url:'https://mfds824.github.io/DwellHunt/'}};

test('signed Supabase auth email reaches the existing gateway with only the needed email fields',async()=>{
 const now=Date.now();let sentUrl='';const sent:{body:Record<string,unknown>|null}={body:null};
 const response=await handleSupabaseSendEmailHook(request(signup,now),config,async(input,init)=>{
  sentUrl=String(input);sent.body=JSON.parse(String(init?.body));return Response.json({ok:true,outcome:'Delivered'});
 },now);
 assert.equal(response.status,200);assert.equal(sentUrl,config.APPS_SCRIPT_EXEC_URL);
 assert.equal(sent.body?.action,'auth_email_send');
 const payload=sent.body?.payload as {hookId:string;messages:Array<{to:string;subject:string;textBody:string;htmlBody:string}>};
 assert.equal(payload.messages.length,1);assert.equal(payload.messages[0].to,'synthetic@example.test');
 assert.match(payload.messages[0].textBody,/123456/);assert.match(payload.messages[0].textBody,/auth\/v1\/verify/);
 assert.match(payload.messages[0].textBody,/redirect_to=https%3A%2F%2Fmfds824\.github\.io%2FDwellHunt%2F/);
 assert.equal(JSON.stringify(sent.body).includes(secret),false);
});

test('invalid signature and stale signed events cannot trigger email delivery',async()=>{
 const now=Date.now();let calls=0;
 const send=async(r:Request)=>handleSupabaseSendEmailHook(r,config,async()=>{calls++;return Response.json({ok:true,outcome:'Delivered'});},now);
 assert.equal((await send(request(signup,now,{'webhook-signature':'v1,AAAA'}))).status,401);
 assert.equal((await send(request(signup,now-6*60_000))).status,401);
 assert.equal(calls,0);
});

test('Auth email refuses an external redirect and unsupported action before sending',async()=>{
 const now=Date.now();let calls=0;
 const send=async(payload:unknown)=>handleSupabaseSendEmailHook(request(payload,now),config,async()=>{calls++;return Response.json({ok:true,outcome:'Delivered'});},now);
 assert.equal((await send({...signup,email_data:{...signup.email_data,redirect_to:'https://attacker.example/steal'}})).status,400);
 assert.equal((await send({...signup,email_data:{...signup.email_data,email_action_type:'admin_action'}})).status,400);
 assert.equal(calls,0);
});

test('secure email change maps separate OTPs only to the current and requested addresses',async()=>{
 const now=Date.now();const sent:{body:Record<string,unknown>|null}={body:null};
 const payload={user:{email:'old@example.test',new_email:'new@example.test'},email_data:{email_action_type:'email_change',token:'111111',token_hash:'new-hash',
  token_new:'222222',token_hash_new:'old-hash',redirect_to:'https://mfds824.github.io/DwellHunt/',site_url:'https://mfds824.github.io/DwellHunt/'}};
 const response=await handleSupabaseSendEmailHook(request(payload,now),config,async(_input,init)=>{sent.body=JSON.parse(String(init?.body));return Response.json({ok:true,outcome:'Delivered'});},now);
 assert.equal(response.status,200);
 const messages=(sent.body?.payload as {messages:Array<{to:string;textBody:string}>}).messages;
 assert.deepEqual(messages.map(x=>x.to),['old@example.test','new@example.test']);
 assert.match(messages[0].textBody,/old-hash/);assert.match(messages[1].textBody,/new-hash/);
});

