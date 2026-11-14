import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source=readFileSync(new URL('../website/viewing-ui.js',import.meta.url),'utf8');
const endpoint='https://dwellhunt-viewing-api-dev.countdracula-11537.workers.dev';
const bookingId='dh'+'a'.repeat(32);
async function harness(responses: {status:number;body:unknown}[], management=false, publicSite=false) {
  const token='b'.repeat(64);
  const dom=new JSDOM('<button data-dh-viewing-id="demo-id" data-dh-viewing-title="Demo villa">View</button>',{
    url:(publicSite?'https://mfds824.github.io/DwellHunt/':'https://development.dwellhunt-viewing-dev.pages.dev/')+(management?'#dwellhunt-booking='+bookingId+'&token='+token:''),runScripts:'outside-only'});
  const w=dom.window as any;
  let options:any,response='fresh-mock-1',interval:(()=>void)|undefined,resets=0,throwRead=false;
  const calls:{url:string;payload:any}[]=[];
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  w.setInterval=(fn:()=>void)=>{interval=fn;return 1;};w.clearInterval=()=>{interval=undefined;};
  w.AbortSignal=AbortSignal;
  w.DWELLHUNT_VIEWING={testMode:publicSite,bookingUrl:endpoint+'/api/dwellhunt/bookings',buyerActionsUrl:endpoint+'/api/dwellhunt/buyer-actions',turnstileSiteKey:'mock-public-key'};
  w.turnstile={render:(_host:unknown,o:any)=>{options=o;o.callback(response);return 0;},
    getResponse:()=>{if(throwRead)throw Error('mock read failure');return response;},
    reset:()=>{resets++;response='fresh-mock-'+(resets+1);options.callback(response);},remove:()=>{}};
  w.fetch=async(url:string,init:any)=>{calls.push({url,payload:JSON.parse(init.body)});const r=responses.shift();if(!r)throw Error('Unexpected extra submission');return Response.json(r.body,{status:r.status});};
  w.eval(source);
  if(!management)w.document.querySelector('button[data-dh-viewing-id]').click();
  await new Promise(resolve=>setImmediate(resolve));
  const dialog=w.document.querySelector('#dh-viewing'),form=dialog.querySelector('form');
  if(!management) for(const [name,value] of Object.entries({customer_name:'Mock Buyer',email:'test@example.test',whatsapp:'+94770000000',country:'Sri Lanka',buyer_timezone:'Asia/Colombo',preferred_date:'2026-11-12',preferred_time:'18:00'}))form.elements[name].value=value;
  form.elements.consent.checked=true;
  return {dom,w,dialog,form,calls,get options(){return options;},get resets(){return resets;},
    tick:()=>interval?.(),makeReadFail:()=>{throwRead=true;},fresh:()=>options.callback('fresh-mock-new'),
    submit:async()=>{form.querySelector('[type=submit]').click();await new Promise(resolve=>setImmediate(resolve));}};
}

test('successful submission preserves its message, avoids CAPTCHA reset, and auto-closes after five seconds',async()=>{
  const h=await harness([{status:202,body:{ok:true,booking_id:bookingId,status:'pending_approval'}}]);
  try {
    await h.submit();
    assert.match(h.dialog.querySelector('[role=status]').textContent,/Viewing request received/);
    assert.equal(h.resets,0);assert.equal(h.calls.length,1);
    assert.equal(h.options['response-field'],false);
    assert.equal(h.calls[0].payload.auto_close,undefined);
    for(let i=0;i<4;i++)h.tick();assert.ok(h.w.document.querySelector('#dh-viewing'));
    h.tick();assert.equal(h.w.document.querySelector('#dh-viewing'),null);
    assert.match(h.w.document.querySelector('#dh-viewing-toast').textContent,/Viewing request received/);
  } finally {h.dom.window.close();}
});

test('a fresh CAPTCHA callback cannot erase an error and retries retain the same request key',async()=>{
  const h=await harness([{status:403,body:{ok:false,code:'HUMAN_VERIFICATION_FAILED'}},
    {status:202,body:{ok:true,booking_id:bookingId,status:'pending_approval'}}]);
  try {
    const hidden=h.w.document.createElement('input');hidden.name='cf-turnstile-response';hidden.type='hidden';hidden.value='first-ephemeral';h.form.append(hidden);
    await h.submit();assert.equal(h.resets,1);
    assert.match(h.dialog.querySelector('[role=status]').textContent,/Verification was rejected/);
    h.fresh();assert.match(h.dialog.querySelector('[role=status]').textContent,/Verification was rejected/);
    hidden.value='next-ephemeral';h.form.elements.auto_close.checked=false;
    await h.submit();assert.equal(h.calls.length,2);
    assert.equal(h.calls[0].payload.idempotency_key,h.calls[1].payload.idempotency_key);
    assert.equal(h.calls[1].payload['cf-turnstile-response'],undefined);
    assert.notEqual(h.calls[0].payload.turnstile_token,h.calls[1].payload.turnstile_token);
    for(let i=0;i<6;i++)h.tick();assert.ok(h.w.document.querySelector('#dh-viewing'));
  } finally {h.dom.window.close();}
});

test('Keep open cancels the successful-request countdown',async()=>{
  const h=await harness([{status:202,body:{ok:true,booking_id:bookingId,status:'pending_approval'}}]);
  try {await h.submit();h.dialog.querySelector('.dh-keep-open').click();for(let i=0;i<6;i++)h.tick();assert.ok(h.w.document.querySelector('#dh-viewing'));}
  finally {h.dom.window.close();}
});

test('CAPTCHA read failures remain visible and never send a request',async()=>{
  const h=await harness([]);
  try {h.makeReadFail();await h.submit();assert.equal(h.calls.length,0);assert.match(h.dialog.querySelector('[role=status]').textContent,/could not be read/);}
  finally {h.dom.window.close();}
});

test('fresh verification clears only stale CAPTCHA hints without erasing submission results',async()=>{
  const h=await harness([]);
  try {h.options['expired-callback']();assert.match(h.dialog.querySelector('[role=status]').textContent,/expired/);
    h.fresh();assert.equal(h.dialog.querySelector('.dh-result').hidden,true);assert.equal(h.calls.length,0);}
  finally {h.dom.window.close();}
});

test('private management links clear the URL token and send it only with fresh manage verification',async()=>{
  const h=await harness([{status:202,body:{ok:true,status:'cancelling'}}],true);
  try {assert.equal(h.w.location.hash,'');assert.equal(h.options.action,'manage');await h.submit();
    assert.equal(h.calls[0].url,endpoint+'/api/dwellhunt/buyer-actions');
    assert.equal(h.calls[0].payload.manage_token,'b'.repeat(64));
    assert.equal(h.calls[0].payload.turnstile_token,'fresh-mock-1');
    assert.ok(!h.dialog.textContent.includes('b'.repeat(64)));
  } finally {h.dom.window.close();}
});


test('GitHub Pages test form shows its restriction and retains the repository base path',async()=>{
  const h=await harness([{status:202,body:{ok:true,booking_id:bookingId,status:'pending_approval'}}],false,true);
  try {assert.match(h.dialog.querySelector('.dh-test-notice').textContent,/verified DwellHunt test contact/);await h.submit();
    assert.equal(h.calls[0].payload.property_url,'https://mfds824.github.io/DwellHunt/');
    assert.equal(h.calls[0].url,endpoint+'/api/dwellhunt/bookings');
    assert.equal(h.form.elements.auto_close.checked,true);
  } finally {h.dom.window.close();}
});


test('Live configuration limits UI entry to the explicitly launched property',async()=>{
 const h=await harness([]);try{h.dialog.close();h.w.DWELLHUNT_VIEWING={...h.w.DWELLHUNT_VIEWING,availablePropertyIds:['approved-live-property']};h.w.document.querySelector('[data-dh-viewing-id]').click();assert.equal(h.w.document.querySelector('#dh-viewing'),null);assert.match(h.w.document.querySelector('#dh-viewing-toast').textContent,/not available/);assert.equal(h.calls.length,0);}finally{h.dom.window.close();}
});
