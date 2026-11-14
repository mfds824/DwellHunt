import assert from 'node:assert/strict';
import {ListingRepository} from '../src/listings/repository';
import {calendarMonthExpiry,fingerprint} from '../src/listings/policy';

// Reviewer account to verify; set locally (e.g. in .env), never committed.
const reviewerEmail=(process.env.LISTING_REVIEWER_EMAIL||'').trim().toLowerCase();
if(!reviewerEmail)throw Error('Set LISTING_REVIEWER_EMAIL to the reviewer account email');
const listingId='TEST-DHL-eb31cf44-6751-453c-b873-77560bfb236f';
const base=process.env.LISTING_SUPABASE_URL!,key=process.env.LISTING_SUPABASE_SECRET_KEY!;
if(!base||!key)throw Error('Missing server configuration');
const repo=new ListingRepository({...process.env,LISTINGS_ENABLED:'true'});
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
const evidence:Record<string,unknown>={synthetic:true,listingId,publicationEnabledInWorker:false,publicResultsExpected:false};

async function listUsers(){
 const result=await fetch(base+'/auth/v1/admin/users?page=1&per_page=1000',{headers,signal:AbortSignal.timeout(15000)});
 if(!result.ok)throw Error('AUTH_ADMIN_READ_FAILED_'+result.status);
 const body=await result.json() as {users?:Array<{id:string;email?:string}>};
 const reviewer=body.users?.find(user=>user.email?.toLowerCase()===reviewerEmail);
 if(!reviewer)throw Error('REVIEWER_AUTH_USER_NOT_FOUND');
 return reviewer.id;
}

async function command(actor:string,action:string,version:number,reason:string,url:string|null=null){
 const payload={reason},publicSnapshot={},requestKey=crypto.randomUUID();
 const p_hash=await fingerprint({action,listingId,expectedVersion:version,payload,publicSnapshot});
 return repo.rpc<Record<string,unknown>>('dh_listing_command',{p_actor:actor,p_action:action,p_listing_id:listingId,
  p_request_key:requestKey,p_expected_version:version,p_payload:payload,p_public:publicSnapshot,p_hash,p_synthetic:true,p_url:url});
}

const reviewer=await listUsers();
let record=await repo.rpc<any>('dh_listing_get',{p_actor:reviewer,p_listing_id:listingId});
assert.equal(record.reviewer,true);assert.equal(record.status,'submitted');
const owner=String(record.history?.[0]?.actor||'');assert.match(owner,/^[0-9a-f-]{36}$/i);
const approved=await command(reviewer,'approve',record.version,'Synthetic acceptance reviewer approval');
assert.equal(approved.status,'approved');
const publishUrl=new URL(process.env.LISTING_SITE_URL||'https://mfds824.github.io/DwellHunt/');publishUrl.searchParams.set('listing',listingId);
const published=await command(reviewer,'publish',Number(approved.version),'Synthetic acceptance publication',publishUrl.href);
assert.equal(published.status,'published');assert.equal(published.synthetic,true);
record=await repo.rpc<any>('dh_listing_get',{p_actor:reviewer,p_listing_id:listingId});
assert.equal(record.reviewer,true);assert.equal(record.firstPublishedAt!==null,true);
const expectedExpiry=calendarMonthExpiry(String(record.firstPublishedAt));
assert.ok(Math.abs(Date.parse(expectedExpiry)-Date.parse(String(record.expiresAt)))<=1000,'one calendar month expiry');
const publicRows=await repo.rpc<Array<{id:string}>>('dh_listings_public',{p_listing_id:null});
assert.ok(!publicRows.some(row=>row.id===listingId));
evidence.approved=true;evidence.publishedInternally=true;evidence.firstPublishedAt=record.firstPublishedAt;
evidence.expiresAt=record.expiresAt;evidence.monthlyExpiryMatches=true;evidence.syntheticExcludedFromPublic=true;
const start={firstPublishedAt:record.firstPublishedAt,expiresAt:record.expiresAt,cycleId:record.cycleId};
let changed=await command(owner,'pause',Number(record.version),'Synthetic acceptance pause');
assert.equal(changed.status,'paused');record=await repo.rpc<any>('dh_listing_get',{p_actor:reviewer,p_listing_id:listingId});
assert.deepEqual({firstPublishedAt:record.firstPublishedAt,expiresAt:record.expiresAt,cycleId:record.cycleId},start);
changed=await command(owner,'resume',Number(record.version),'Synthetic acceptance resume');assert.equal(changed.status,'published');
record=await repo.rpc<any>('dh_listing_get',{p_actor:reviewer,p_listing_id:listingId});
assert.deepEqual({firstPublishedAt:record.firstPublishedAt,expiresAt:record.expiresAt,cycleId:record.cycleId},start);
changed=await command(owner,'withdraw',Number(record.version),'Synthetic acceptance cleanup');assert.equal(changed.status,'withdrawn');
record=await repo.rpc<any>('dh_listing_get',{p_actor:reviewer,p_listing_id:listingId});assert.equal(record.status,'withdrawn');
evidence.pauseAndResumePreservedPeriod=true;evidence.ownerWithdrawalPassed=true;evidence.finalStatus='withdrawn';
evidence.result='passed';console.log(JSON.stringify(evidence));
