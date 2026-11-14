import {test} from 'node:test';import assert from 'node:assert/strict';
import {database,syntheticDraft,OWNER,OTHER,REVIEWER} from './listing-lifecycle-fixture';
import {prepareSubmission} from '../src/listings/validation';import {fingerprint} from '../src/listings/policy';
import {handleListingRequest} from '../src/listings/api';import {listingSheetRecord} from '../src/listings/sheets';import {processListingOutbox} from '../src/listings/outbox';
type Repo=Awaited<ReturnType<typeof database>>;
const cfg={LISTINGS_ENABLED:'true',AGENT_LISTINGS_ENABLED:'true',LISTING_PUBLICATION_ENABLED:'true',LISTING_SITE_URL:'https://mfds824.github.io/DwellHunt/',WEBSITE_ORIGIN:'https://mfds824.github.io'};
const draft=()=>{const d=syntheticDraft();d.selection.listingRole='agent';return d;};
const profile=(r:Repo,actor=OWNER,agencyId='')=>r.rpc<any>('dh_listing_agent_profile',{p_actor:actor,p_email:actor===OWNER?'approved-owner@example.test':'assigned-agent@example.test',p_profile:{name:actor===OWNER?'Synthetic Agent One':'Synthetic Agent Two',phone:actor===OWNER?'+94770000001':'+94770000002',agencyId,verified:true,reviewer:true,user_id:OTHER}});
async function submit(r:Repo,actor=OWNER,synthetic=true,d=draft()){
 const p=prepareSubmission(d,'approved-owner@example.test');const args={p_actor:actor,p_action:'submit',p_listing_id:null,p_request_key:crypto.randomUUID(),p_expected_version:0,p_payload:p.draft,p_public:p.publicSnapshot,p_hash:await fingerprint(p),p_synthetic:synthetic,p_url:null};return {args,draft:d,receipt:await r.rpc<any>('dh_listing_command',args)};
}
async function action(r:Repo,row:any,name:string,actor=REVIEWER,payload:any={},pub:any={}){return r.rpc<any>('dh_listing_command',{p_actor:actor,p_action:name,p_listing_id:row.listingId,p_request_key:crypto.randomUUID(),p_expected_version:row.version,p_payload:payload,p_public:pub,p_hash:await fingerprint({name,payload,nonce:crypto.randomUUID()}),p_synthetic:true,p_url:'https://mfds824.github.io/DwellHunt/?listing='+row.listingId});}
const get=(r:Repo,id:string,actor=OWNER)=>r.rpc<any>('dh_listing_get',{p_actor:actor,p_listing_id:id});
const publish=async(r:Repo,row:any)=>action(r,await action(r,row,'approve'),'publish');

test('agent profiles cannot mint verification or membership; identity, idempotent submission and private access are server-bound',async()=>{
 const r=await database();try{
 await assert.rejects(submit(r),/AGENT_PROFILE_REQUIRED/);const p=await profile(r);assert.equal(p.profile.verified,false);assert.equal(p.accountId,OWNER);assert.notEqual(p.profile.agentId,OWNER);
 await assert.rejects(profile(r,OWNER,'invented-agency'),/AGENCY_MEMBERSHIP_REQUIRED/);
 const d=draft();Object.assign(d,{ownerId:OTHER,agentId:OTHER,agencyId:'forged',reviewer:true,status:'published',verified:true,publicName:'Forged identity',publicEmail:'forged@example.test'});
 const s=await submit(r,OWNER,true,d);const retry=await Promise.all(Array.from({length:8},()=>r.rpc<any>('dh_listing_command',s.args)));assert.ok(retry.every(row=>row.listingId===s.receipt.listingId));
 const stored=await get(r,s.receipt.listingId);assert.equal(stored.submittingAgentId,p.profile.agentId);assert.equal(stored.assignedAgentId,p.profile.agentId);assert.equal(stored.reviewer,false);assert.equal(stored.draft.publicName,p.profile.name);
 await assert.rejects(action(r,stored,'approve',OWNER),/FORBIDDEN/);await assert.rejects(get(r,stored.listingId,OTHER),/FORBIDDEN/);
 assert.equal((await r.db.query<any>('select count(*)::int n from dwellhunt_listing_private.listings')).rows[0].n,1);assert.equal((await r.db.query<any>('select count(*)::int n from dwellhunt_listing_private.acceptances')).rows[0].n,1);assert.deepEqual(await r.rpc('dh_listings_public'),[]);
 }finally{await r.db.close();}
});

test('trusted agency membership grants no cross-agent/admin privilege and revoked membership immediately closes public eligibility',async()=>{
 const r=await database();try{
 await r.db.exec("insert into dwellhunt_listing_private.agencies(id,name) values('agency-existing','Existing Test Agency'),('agency-other','Other Test Agency')");
 await r.db.query('insert into dwellhunt_listing_private.agency_memberships(user_id,agency_id,enabled,verified_at) values($1,$3,true,clock_timestamp()),($2,$3,true,clock_timestamp())',[OWNER,OTHER,'agency-existing']);
 await profile(r,OWNER,'agency-existing');const other=await profile(r,OTHER,'agency-existing');const s=await submit(r,OWNER,false);const row=await publish(r,s.receipt);
 const pub=await r.rpc<any[]>('dh_listings_public');assert.equal(pub.length,1);assert.equal(pub[0].agencyName,'Existing Test Agency');assert.equal(pub[0].verified,false);
 await assert.rejects(get(r,row.listingId,OTHER),/FORBIDDEN/);await assert.rejects(action(r,row,'reassign',OTHER,{assignedAgentId:other.profile.agentId}),/FORBIDDEN/);await assert.rejects(profile(r,OTHER,'agency-other'),/AGENCY_MEMBERSHIP_REQUIRED/);
 await r.db.query('update dwellhunt_listing_private.agency_memberships set enabled=false where user_id=$1',[OWNER]);await assert.rejects(get(r,row.listingId),/FORBIDDEN/);await assert.rejects(action(r,row,'withdraw',OWNER),/FORBIDDEN/);await assert.rejects(r.rpc('dh_listing_command',s.args),/FORBIDDEN/);assert.deepEqual(await r.rpc('dh_listings_public'),[]);
 assert.equal((await handleListingRequest(new Request('https://api.test/api/dwellhunt/listings/public/'+row.listingId+'/contact?channel=email'),cfg,r)).status,404);
 }finally{await r.db.close();}
});

test('agent revisions preserve approved public facts through correction/rejection; renewal requires fresh authority and preserves lifecycle history',async()=>{
 const r=await database();try{
 await profile(r);const s=await submit(r,OWNER,false);let row=await publish(r,s.receipt);const expiry=row.expiresAt,cycle=row.cycleId,first=row.firstPublishedAt;
 const p=prepareSubmission({...s.draft,price:'27000000',title:'Synthetic revision for review only'},'approved-owner@example.test');
 row=await action(r,row,'edit',OWNER,p.draft,p.publicSnapshot);assert.equal(row.status,'published');assert.equal(row.reviewStatus,'submitted');assert.equal((await r.rpc<any[]>('dh_listings_public'))[0].price,25000000);
 row=await action(r,row,'needs_changes',REVIEWER,{reason:'Correct the description'});assert.equal((await get(r,row.listingId)).reviewNotes,'Correct the description');
 row=await action(r,row,'edit',OWNER,p.draft,p.publicSnapshot);row=await action(r,row,'decline');assert.equal(row.status,'published');assert.equal(row.reviewStatus,'declined');
 row=await action(r,row,'edit',OWNER,p.draft,p.publicSnapshot);row=await action(r,row,'approve');row=await action(r,row,'publish');assert.equal(row.expiresAt,expiry);assert.equal(row.cycleId,cycle);assert.equal((await r.rpc<any[]>('dh_listings_public'))[0].price,27000000);
 const renewal={price:27000000,currency:'LKR',priceConfirmed:true,available:true,renewalConsent:true};await assert.rejects(action(r,row,'renew',OWNER,renewal),/RENEWAL_CONFIRMATION_REQUIRED/);
 row=await action(r,row,'renew',OWNER,{...renewal,authorityConfirmed:true});assert.notEqual(row.cycleId,cycle);assert.equal(row.firstPublishedAt,first);const accepted=await r.db.query<any>("select policy_version,confirmations from dwellhunt_listing_private.acceptances where action='renew'");assert.equal(accepted.rows[0].confirmations.authorityConfirmed,true);
 row=await action(r,row,'withdraw',OWNER);assert.equal(row.status,'withdrawn');assert.deepEqual(await r.rpc('dh_listings_public'),[]);assert.equal((await handleListingRequest(new Request('https://api.test/api/dwellhunt/listings/public/'+row.listingId+'/viewing'),cfg,r)).status,404);
 }finally{await r.db.close();}
});

test('likely duplicates are private reviewer flags, never an automatic rejection or cross-account information leak',async()=>{
 const r=await database();try{await profile(r);await profile(r,OTHER);const a=await submit(r),b=await submit(r,OTHER);assert.equal(b.receipt.status,'submitted');assert.deepEqual((await get(r,b.receipt.listingId,OTHER)).duplicateCandidates,[]);assert.deepEqual((await get(r,b.receipt.listingId,REVIEWER)).duplicateCandidates,[a.receipt.listingId]);assert.equal((await publish(r,b.receipt)).status,'published');
 const dashboard=await r.rpc<any[]>('dh_listing_dashboard',{p_actor:OTHER});assert.equal(dashboard.length,1);assert.equal(dashboard[0].listingId,b.receipt.listingId);assert.equal(JSON.stringify(dashboard).includes('PRIVATE TEST ADDRESS'),false);
 }finally{await r.db.close();}
});

test('explicit reviewer reassignment preserves submitter and audit; existing reminder outbox targets the responsible verified agent',async()=>{
 const r=await database();try{
 const one=await profile(r),two=await profile(r,OTHER);let row=await publish(r,(await submit(r,OWNER,false)).receipt);
 await assert.rejects(action(r,row,'reassign',OWNER,{assignedAgentId:two.profile.agentId}),/FORBIDDEN/);row=await action(r,row,'reassign',REVIEWER,{assignedAgentId:two.profile.agentId,reason:'Explicit synthetic reassignment'});assert.equal(row.submittingAgentId,one.profile.agentId);assert.equal(row.assignedAgentId,two.profile.agentId);
 const pub=await r.rpc<any[]>('dh_listings_public');assert.equal(pub[0].contact.email,'assigned-agent@example.test');assert.equal(JSON.stringify(pub).includes(OTHER),false);assert.equal(pub[0].agentId,undefined);assert.ok((await get(r,row.listingId,OTHER)).history.some((a:any)=>a.action==='reassign'&&a.actor===REVIEWER));
 await r.db.exec("update dwellhunt_listing_private.outbox set state='done'");await r.db.query("update dwellhunt_listing_private.listings set expires_at=clock_timestamp()+interval '6 days' where id=$1",[row.listingId]);await r.rpc('dh_listing_tick');await r.rpc('dh_listing_tick');let recipient='';
 await processListingOutbox(r,async(action,payload)=>{if(action==='listing_reminder_lookup')return {ok:true,outcome:'Not found'};recipient=String(payload.recipient);return {ok:true,outcome:'Delivered',receipt:'synthetic-no-mail'};});assert.equal(recipient,'assigned-agent@example.test');assert.equal((await r.rpc<any>('dh_listing_enquiries',{p_actor:OTHER,p_listing_id:row.listingId})).connected,false);
 }finally{await r.db.close();}
});

test('agent HTTP boundaries enforce role/photo/location constraints, gate activation and protect RLS; sheet projection is an explicit agent allowlist',async()=>{
 const r=await database();try{
 const request=(path:string,body:unknown)=>new Request('https://api.test/api/dwellhunt/listings'+path,{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(body)});
 const save=await handleListingRequest(request('/agent/profile',{name:'Synthetic API Agent',phone:'+94770000001',userId:OTHER,reviewer:true,verified:true,email:'forged@example.test'}),cfg,r);assert.equal(save.status,200);const p=await save.json() as any;assert.equal(p.profile.email,'approved-owner@example.test');assert.equal(p.profile.verified,false);
 const d=draft(),body={draft:d,requestKey:crypto.randomUUID(),ownerId:OTHER,status:'published',reviewer:true};const first=await handleListingRequest(request('',body),cfg,r);assert.equal(first.status,201);const receipt=(await first.json() as any).listing;assert.equal(receipt.status,'submitted');
 assert.equal((await handleListingRequest(request('',{draft:{...d,photos:Array(9).fill(d.photos[0])},requestKey:crypto.randomUUID()}),cfg,r)).status,400);assert.equal((await handleListingRequest(request('',{draft:{...d,privateLocation:undefined},requestKey:crypto.randomUUID()}),cfg,r)).status,400);assert.equal((await handleListingRequest(request('',body),{...cfg,AGENT_LISTINGS_ENABLED:'false'},r)).status,503);
 assert.equal((await handleListingRequest(request('/'+receipt.listingId+'/actions/approve',{requestKey:crypto.randomUUID(),expectedVersion:1,reviewer:true}),cfg,r)).status,403);
 const raw=await r.db.query<any>('select * from dwellhunt_listing_private.listings where id=$1',[receipt.listingId]);const projected=listingSheetRecord(raw.rows[0]);assert.ok(projected['Submitting agent ID']);assert.equal(projected['Lister role'],'agent');assert.equal(projected['Lifecycle version'],1);assert.equal(JSON.stringify(projected).includes('PRIVATE TEST ADDRESS'),false);
 await r.db.exec('set role authenticated');await assert.rejects(r.db.query('select public.dh_listing_agent_profile($1)',[OWNER]),/permission denied/);await assert.rejects(r.db.query('select * from dwellhunt_listing_private.agent_profiles'),/permission denied/);await r.db.exec('reset role');
 }finally{await r.db.close();}
});

test('agent late-expiry protection, old reminder leases, renewal races and both reminder windows reuse the canonical cycle',async()=>{
 const r=await database();try{
 await profile(r);let row=await publish(r,(await submit(r)).receipt);
 await r.db.exec("update dwellhunt_listing_private.outbox set state='done'");await r.db.query("update dwellhunt_listing_private.listings set expires_at=clock_timestamp()+interval '6 days' where id=$1",[row.listingId]);
 await r.rpc('dh_listing_tick');await r.rpc('dh_listing_tick');const jobs=await r.rpc<any[]>('dh_listing_claim',{p_limit:1});assert.equal(jobs.length,1);const job=jobs[0];assert.equal(job.kind,'renewal_reminder');
 const oldCycle=row.cycleId;row=await action(r,row,'renew',OWNER,{price:25000000,currency:'LKR',priceConfirmed:true,available:true,renewalConsent:true,authorityConfirmed:true});assert.notEqual(row.cycleId,oldCycle);
 assert.equal((await r.rpc<any>('dh_listing_begin_delivery',{p_job:job.id,p_lease:job.lease_token})).eligible,false);await r.rpc('dh_listing_tick');assert.equal((await get(r,row.listingId)).status,'published');
 await r.db.exec("update dwellhunt_listing_private.outbox set state='done'");await r.db.query("update dwellhunt_listing_private.listings set expires_at=clock_timestamp()+interval '36 hours' where id=$1",[row.listingId]);await r.rpc('dh_listing_tick');await r.rpc('dh_listing_tick');
 const due=await r.db.query<any>("select count(*)::int n from dwellhunt_listing_private.outbox where kind='renewal_reminder' and state='pending' and payload->>'days'='2'");assert.equal(due.rows[0].n,1);
 row=await action(r,row,'sold',OWNER);assert.equal(row.status,'sold');assert.equal((await r.db.query<any>("select count(*)::int n from dwellhunt_listing_private.outbox where kind='renewal_reminder' and state='pending'")).rows[0].n,0);
 const next=await submit(r,OWNER,true);let expired=await publish(r,next.receipt);await r.db.query("update dwellhunt_listing_private.listings set expires_at=clock_timestamp()-interval '1 second' where id=$1",[expired.listingId]);await r.rpc('dh_listing_tick');assert.equal((await get(r,expired.listingId)).status,'expired');
 }finally{await r.db.close();}
});
