/** Explicit synthetic acceptance check against the configured Auth/Postgres.
 * No messages, public listings, credential output or scheduled work. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {syntheticDraft} from '../test/listing-lifecycle-fixture';
import {handleListingRequest} from '../src/listings/api';
import {ListingRepository} from '../src/listings/repository';
if(!process.argv.includes('--synthetic'))throw Error('Explicit --synthetic required');
const url=process.env.LISTING_SUPABASE_URL!,key=process.env.LISTING_SUPABASE_SECRET_KEY!,publishable=process.env.LISTING_SUPABASE_PUBLISHABLE_KEY!;
if(!url||!key||!publishable)throw Error('Missing server configuration');
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
const evidence:Record<string,unknown>={mode:'local HTTP handler with deployed Supabase Auth and Postgres',synthetic:true,messagesSent:0};
let actor:string|undefined;
try{
 const creation=await fetch(url+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({
  email:'dwellhunt-synthetic-'+crypto.randomUUID()+'@example.invalid',password:randomBytes(40).toString('base64url'),email_confirm:true,user_metadata:{synthetic:true,acceptance:'listing-storage-20261113'}
 }),signal:AbortSignal.timeout(15000)});
 if(!creation.ok)throw Error('SYNTHETIC_AUTH_CREATE_FAILED_'+creation.status);
 const user=await creation.json() as any;actor=user.id;evidence.actorId=actor;
 // Admin-generated one-time login for this synthetic identity; no email is sent.
 const generated=await fetch(url+'/auth/v1/admin/generate_link',{method:'POST',headers,body:JSON.stringify({type:'magiclink',email:user.email}),signal:AbortSignal.timeout(15000)});
 if(!generated.ok)throw Error('SYNTHETIC_LOGIN_CREATE_FAILED_'+generated.status);
 const link=await generated.json() as any;
 const verified=await fetch(url+'/auth/v1/verify',{method:'POST',headers:{apikey:publishable,'Content-Type':'application/json'},body:JSON.stringify({token_hash:link.hashed_token||link.properties?.hashed_token,type:'email'}),signal:AbortSignal.timeout(15000)});
 if(!verified.ok)throw Error('SYNTHETIC_LOGIN_VERIFY_FAILED_'+verified.status);
 const session=await verified.json() as any;if(!session.access_token)throw Error('NO_TEST_SESSION');
 const config={...process.env,LISTINGS_ENABLED:'true',LISTING_PUBLICATION_ENABLED:'false',LISTING_TEST_MODE:'true',LISTING_TEST_OWNER_IDS:actor,WEBSITE_ORIGIN:'https://mfds824.github.io'};
 const repo=new ListingRepository(config),draft=syntheticDraft();draft.renewalEmailConsent=false;const requestKey=crypto.randomUUID();
 const request=()=>new Request('https://dwellhunt-listings-api.countdracula-11537.workers.dev/api/dwellhunt/listings',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',Origin:config.WEBSITE_ORIGIN},body:JSON.stringify({draft,requestKey})});
 const initial=await handleListingRequest(request(),config,repo);assert.equal(initial.status,201);const saved=await initial.json() as any;
 evidence.listingId=saved.listing.listingId;evidence.submittedAt=saved.listing.submittedAt;assert.match(saved.listing.listingId,/^TEST-DHL-/);assert.ok(Date.parse(saved.listing.submittedAt));
 const retries=await Promise.all(Array.from({length:5},()=>handleListingRequest(request(),config,repo)));
 for(const response of retries){assert.equal(response.status,200);assert.equal((await response.json() as any).listing.listingId,saved.listing.listingId);}
 evidence.concurrentRetriesDeduplicated=true;
 const record=await repo.rpc<any>('dh_listing_get',{p_actor:actor,p_listing_id:saved.listing.listingId});assert.equal(record.status,'submitted');assert.equal(record.history.length,1);evidence.oneSubmissionAudit=true;
 const publicRecords=await repo.rpc<any[]>('dh_listings_public',{p_listing_id:saved.listing.listingId});assert.deepEqual(publicRecords,[]);evidence.excludedFromPublic=true;
 await assert.rejects(repo.rpc('dh_listing_get',{p_actor:crypto.randomUUID(),p_listing_id:saved.listing.listingId}),/FORBIDDEN/);evidence.otherActorDenied=true;
 const approval=await handleListingRequest(new Request(request().url+'/'+saved.listing.listingId+'/actions/approve',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',Origin:config.WEBSITE_ORIGIN},body:JSON.stringify({requestKey:crypto.randomUUID(),expectedVersion:1})}),config,repo);assert.equal(approval.status,403);evidence.ownerCannotApprove=true;
 evidence.result='passed';
}catch(error){evidence.result='failed';evidence.code=error instanceof Error?error.message.slice(0,100):'UNEXPECTED';process.exitCode=1;}
finally{
 if(actor){const banned=await fetch(url+'/auth/v1/admin/users/'+actor,{method:'PUT',headers,body:JSON.stringify({ban_duration:'876000h'}),signal:AbortSignal.timeout(15000)});evidence.testIdentityDisabled=banned.ok;}
 mkdirSync('dist',{recursive:true});writeFileSync('dist/listing-storage-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
