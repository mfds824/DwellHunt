import {test} from 'node:test';import assert from 'node:assert/strict';
import {database,syntheticDraft,OWNER,OTHER,REVIEWER} from './listing-lifecycle-fixture';
import {prepareSubmission} from '../src/listings/validation';
import {fingerprint,calendarMonthExpiry,sheetDate} from '../src/listings/policy';
import {handleListingRequest} from '../src/listings/api';
import {processListingOutbox,reconcileListingDeliveries} from '../src/listings/outbox';
import type {Payload} from '../src/gateway';
const config={LISTINGS_ENABLED:'true',LISTING_PUBLICATION_ENABLED:'true',LISTING_SITE_URL:'https://mfds824.github.io/DwellHunt/',WEBSITE_ORIGIN:'https://mfds824.github.io'};
async function submit(repo:Awaited<ReturnType<typeof database>>,synthetic=true){
 const draft=syntheticDraft(),p=prepareSubmission(draft,'approved-owner@example.test');
 const args={p_actor:OWNER,p_action:'submit',p_listing_id:null,p_request_key:crypto.randomUUID(),p_expected_version:0,p_payload:p.draft,p_public:p.publicSnapshot,p_hash:await fingerprint(p),p_synthetic:synthetic,p_url:null};
 return {draft,args,receipt:await repo.rpc<Record<string,unknown>>('dh_listing_command',args)};
}
async function action(repo:Awaited<ReturnType<typeof database>>,record:Record<string,unknown>,name:string,actor=REVIEWER,payload:Payload={}){
 return repo.rpc<Record<string,unknown>>('dh_listing_command',{p_actor:actor,p_action:name,p_listing_id:record.listingId,p_request_key:crypto.randomUUID(),p_expected_version:record.version,p_payload:payload,p_public:{},p_hash:await fingerprint({name,payload,nonce:crypto.randomUUID()}),p_synthetic:true,p_url:'https://mfds824.github.io/DwellHunt/?listing='+record.listingId});
}
test('actual PostgreSQL submission transaction returns durable receipt, owner binding, audit and outbox, despite concurrent retry requests',async()=>{
 const r=await database();try{
 const s=await submit(r);const responses=await Promise.all(Array.from({length:12},()=>r.rpc<Record<string,unknown>>('dh_listing_command',s.args)));
 assert.ok(responses.every(v=>v.listingId===s.receipt.listingId&&v.duplicate===true));
 const counts=await r.db.query<{records:number,audits:number,jobs:number}>(`select (select count(*)::int from dwellhunt_listing_private.listings) records,(select count(*)::int from dwellhunt_listing_private.audit) audits,(select count(*)::int from dwellhunt_listing_private.outbox) jobs`);
 assert.deepEqual(counts.rows[0],{records:1,audits:1,jobs:1});
 const owned=await r.rpc<Record<string,unknown>>('dh_listing_get',{p_actor:OWNER,p_listing_id:s.receipt.listingId});assert.equal(owned.status,'submitted');
 await assert.rejects(r.rpc('dh_listing_get',{p_actor:OTHER,p_listing_id:s.receipt.listingId}),/FORBIDDEN/);
 await assert.rejects(r.rpc('dh_listing_command',{...s.args,p_hash:'f'.repeat(64)}),/IDEMPOTENCY_CONFLICT/);
 const anotherKey=await r.rpc<Record<string,unknown>>('dh_listing_command',{...s.args,p_request_key:crypto.randomUUID()});assert.equal(anotherKey.listingId,s.receipt.listingId);
 }finally{await r.db.close();}
});
test('verified ownership and reviewer roles guard all transitions; sheet or user metadata cannot authorize approval',async()=>{
 const r=await database();try{
 let record=(await submit(r)).receipt;
 await assert.rejects(action(r,record,'approve',OWNER),/FORBIDDEN/);await assert.rejects(action(r,record,'withdraw',OTHER),/FORBIDDEN/);
 record=await action(r,record,'needs_changes');assert.equal(record.status,'needs_changes');
 await assert.rejects(action(r,record,'publish'),/INVALID_TRANSITION/);
 const p=prepareSubmission(syntheticDraft(),'approved-owner@example.test');const stored=await r.rpc<Record<string,unknown>>('dh_listing_get',{p_actor:OWNER,p_listing_id:record.listingId});p.draft.id=(stored.draft as Record<string,unknown>).id as string;
 record=await r.rpc('dh_listing_command',{p_actor:OWNER,p_action:'edit',p_listing_id:record.listingId,p_request_key:crypto.randomUUID(),p_expected_version:record.version,p_payload:p.draft,p_public:p.publicSnapshot,p_hash:await fingerprint(p),p_synthetic:true,p_url:null});
 record=await action(r,record,'approve');record=await action(r,record,'publish');assert.equal(record.status,'published');
 assert.deepEqual(await r.rpc('dh_listings_public'),[],'Synthetic test never enters public search, even with a Published test lifecycle');
 await r.db.exec('set role authenticated');await assert.rejects(r.db.query('select public.dh_listing_get($1,$2)',[OWNER,record.listingId]),/permission denied/);await r.db.exec('reset role');
 }finally{await r.db.close();}
});
test('public projection and contact routes expire at query time even before maintenance; internal records remain',async()=>{
 const r=await database();try{
 let record=(await submit(r,false)).receipt;record=await action(r,record,'approve');record=await action(r,record,'publish');
 const pub=await r.rpc<Record<string,unknown>[]>('dh_listings_public');assert.equal(pub.length,1);const json=JSON.stringify(pub);
 for(const privateValue of ['PRIVATE TEST ADDRESS','PRIVATE TEST UNIT','PRIVATE TEST PROJECT','private-routing@','approved-owner@','6.912345','79.876543','private-photo-name'])assert.equal(json.includes(privateValue),false,privateValue);
 await r.db.query('update dwellhunt_listing_private.listings set expires_at=clock_timestamp()-interval \'1 second\' where id=$1',[record.listingId]);
 assert.deepEqual(await r.rpc('dh_listings_public'),[]);
 const response=await handleListingRequest(new Request('https://api.example.test/api/dwellhunt/listings/public/'+record.listingId+'/contact?channel=email'),config,r);assert.equal(response.status,404);
 assert.equal((await r.rpc<Record<string,unknown>>('dh_listing_get',{p_actor:OWNER,p_listing_id:record.listingId})).status,'published','The schedule has not run yet');
 await r.rpc('dh_listing_tick');assert.equal((await r.rpc<Record<string,unknown>>('dh_listing_get',{p_actor:OWNER,p_listing_id:record.listingId})).status,'expired');
 }finally{await r.db.close();}
});
test('SQL and JavaScript calendar-month policy agree on Colombo month ends and leap years',async()=>{
 const r=await database();try{
 const cases=[['2025-01-31T04:30:00.000Z','2025-02-28T04:30:00.000Z'],['2024-01-31T04:30:00.000Z','2024-02-29T04:30:00.000Z'],['2024-02-29T10:00:00.000Z','2024-03-29T10:00:00.000Z'],['2026-12-31T19:00:00.000Z','2027-01-31T19:00:00.000Z']];
 for(const [start,expected] of cases){assert.equal(calendarMonthExpiry(start),expected);const q=await r.db.query<{expiry:Date}>('select dwellhunt_listing_private.expiry($1::timestamptz) expiry',[start]);assert.equal(new Date(q.rows[0].expiry).toISOString(),expected);}
 assert.equal(Number(sheetDate('2026-11-12T18:30:00Z'))%1,0,'Midnight Colombo is an integer spreadsheet date');
 }finally{await r.db.close();}
});
test('pause, resume and ordinary re-review do not restart expiry; renewal confirms price/availability and preserves cycle history',async()=>{
 const r=await database();try{
 let record=(await submit(r)).receipt;record=await action(r,record,'approve');record=await action(r,record,'publish');const first=record.firstPublishedAt,cycle=record.cycleId,expiry=record.expiresAt;
 record=await action(r,record,'pause',OWNER);record=await action(r,record,'resume',OWNER);assert.equal(record.expiresAt,expiry);assert.equal(record.cycleId,cycle);
 await assert.rejects(action(r,record,'renew',OWNER,{price:25000000}),/RENEWAL_CONFIRMATION_REQUIRED/);
 await assert.rejects(action(r,record,'renew',OWNER,{price:26000000,currency:'LKR',priceConfirmed:true,available:true,renewalConsent:true,authorityConfirmed:true}),/PRICE_REVIEW_REQUIRED/);
 record=await action(r,record,'renew',OWNER,{price:25000000,currency:'LKR',priceConfirmed:true,available:true,renewalConsent:true,authorityConfirmed:true});
 assert.equal(record.firstPublishedAt,first);assert.notEqual(record.cycleId,cycle);assert.equal((await r.db.query<{n:number}>('select count(*)::int n from dwellhunt_listing_private.cycles')).rows[0].n,2);
 await r.rpc('dh_listing_tick');assert.equal((await r.rpc<Record<string,unknown>>('dh_listing_get',{p_actor:OWNER,p_listing_id:record.listingId})).cycleId,record.cycleId);
 }finally{await r.db.close();}
});
test('sheet outage leaves the committed submission intact and a retry updates one keyed row with no private location fields',async()=>{
 const r=await database();try{
 const s=await submit(r);let fail=true;const rows=new Map<string,Payload>();
 const gateway=async(_action:string,payload:Payload)=>{if(fail)throw new Error('Synthetic sheet outage');const record=payload.record as Payload;const json=JSON.stringify(record);assert.equal(json.includes('6.912345'),false);assert.equal(json.includes('PRIVATE TEST ADDRESS'),false);rows.set(String(record['Listing ID']),record);return {ok:true};};
 const first=await processListingOutbox(r,gateway);assert.equal(first.results[0].outcome,'retry');assert.equal((await r.rpc<Record<string,unknown>>('dh_listing_get',{p_actor:OWNER,p_listing_id:s.receipt.listingId})).status,'submitted');
 fail=false;await r.db.exec("update dwellhunt_listing_private.outbox set available_at=clock_timestamp()-interval '1 second'");
 await processListingOutbox(r,gateway);assert.equal(rows.size,1);assert.equal((await r.db.query<{state:string}>('select state from dwellhunt_listing_private.outbox')).rows[0].state,'done');
 }finally{await r.db.close();}
});
test('ambiguous reminders are not resent; receipt recovery releases the renewal guard; stale cycles are suppressed',async()=>{
 const r=await database();try{
 let record=(await submit(r)).receipt;record=await action(r,record,'approve');record=await action(r,record,'publish');
 await r.db.exec("update dwellhunt_listing_private.outbox set state='done'");await r.db.query("update dwellhunt_listing_private.listings set expires_at=clock_timestamp()+interval '6 days' where id=$1",[record.listingId]);
 await r.rpc('dh_listing_tick');await r.rpc('dh_listing_tick');assert.equal((await r.db.query<{n:number}>("select count(*)::int n from dwellhunt_listing_private.outbox where kind='renewal_reminder'")).rows[0].n,1);
 let sends=0;const gateway=async(action:string)=>{if(action==='listing_reminder_lookup')return {ok:true,outcome:'Not found'};sends++;throw new Error('Synthetic ambiguous provider timeout');};
 await processListingOutbox(r,gateway);assert.equal(sends,1);
 await assert.rejects(action(r,record,'renew',OWNER,{price:25000000,currency:'LKR',priceConfirmed:true,available:true,renewalConsent:true,authorityConfirmed:true}),/DELIVERY_IN_PROGRESS/);
 await reconcileListingDeliveries(r,async()=>({ok:true,outcome:'Delivered',receipt:'synthetic-receipt'}));assert.equal(sends,1);
 record=await action(r,record,'renew',OWNER,{price:25000000,currency:'LKR',priceConfirmed:true,available:true,renewalConsent:true,authorityConfirmed:true});
 assert.equal(record.status,'published');assert.equal((await r.db.query<{n:number}>("select count(*)::int n from dwellhunt_listing_private.followups where outcome='Delivered'")).rows[0].n,1);
 }finally{await r.db.close();}
});

test('HTTP submission validates confirmations, accepts persisted numeric prices and returns success only after canonical storage',async()=>{
 const r=await database();try{
 const draft={...syntheticDraft(),price:25000000},key=crypto.randomUUID();
 const request=(body:unknown)=>new Request('https://listing.example.test/api/dwellhunt/listings',{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json',Origin:config.WEBSITE_ORIGIN},body:JSON.stringify(body)});
 assert.equal((await handleListingRequest(request({draft:{...draft,accurate:false},requestKey:crypto.randomUUID()}),config,r)).status,400);
 const first=await handleListingRequest(request({draft,requestKey:key}),config,r);assert.equal(first.status,201);
 const body=await first.json() as any;assert.ok(body.listing.listingId.startsWith('DHL-'));assert.ok(Date.parse(body.listing.submittedAt));
 const again=await handleListingRequest(request({draft,requestKey:key}),config,r);assert.equal(again.status,200);assert.equal((await again.json() as any).listing.listingId,body.listing.listingId);
 assert.equal((await r.db.query<{n:number}>('select count(*)::int n from dwellhunt_listing_private.listings')).rows[0].n,1);
 const outage={...r,rpc:async<T>():Promise<T>=>{throw Error('synthetic storage outage');}};
 const failed=await handleListingRequest(request({draft,requestKey:crypto.randomUUID()}),config,outage);assert.equal(failed.status,503);assert.equal((await failed.json() as any).ok,false);assert.equal(draft.title,syntheticDraft().title);
 }finally{await r.db.close();}
});

test('process death during dispatch recovers by receipt lookup even when the reminder window has passed',async()=>{
 const r=await database();try{
 let record=(await submit(r)).receipt;record=await action(r,record,'approve');record=await action(r,record,'publish');
 await r.db.exec("update dwellhunt_listing_private.outbox set state='done';update dwellhunt_listing_private.listings set expires_at=clock_timestamp()+interval '6 days'");await r.rpc('dh_listing_tick');
 const jobs=await r.rpc<any[]>('dh_listing_claim',{p_limit:1});await r.rpc('dh_listing_begin_delivery',{p_job:jobs[0].id,p_lease:jobs[0].lease_token});
 await r.db.exec("update dwellhunt_listing_private.outbox set leased_until=clock_timestamp()-interval '1 second' where state='processing';update dwellhunt_listing_private.listings set expires_at=clock_timestamp()+interval '12 hours'");
 await r.rpc('dh_listing_claim',{p_limit:1});assert.equal((await r.db.query<any>("select state from dwellhunt_listing_private.outbox where kind='renewal_reminder'")).rows[0].state,'uncertain');
 let sends=0;await reconcileListingDeliveries(r,async action=>{if(action!=='listing_reminder_lookup')sends++;return{ok:true,outcome:'Not found'};});assert.equal(sends,0);
 record=await action(r,record,'renew',OWNER,{price:25000000,currency:'LKR',priceConfirmed:true,available:true,renewalConsent:true,authorityConfirmed:true});assert.equal(record.status,'published');
 assert.equal((await r.db.query<any>("select state from dwellhunt_listing_private.outbox where kind='renewal_reminder'")).rows[0].state,'cancelled');
 }finally{await r.db.close();}
});
