import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {syntheticDraft} from '../test/listing-lifecycle-fixture';

const base=process.env.LISTING_CLOUDFLARE_TEST_URL||'https://dwellhunt-listings-api.countdracula-11537.workers.dev';
const url=process.env.LISTING_SUPABASE_URL!,key=process.env.LISTING_SUPABASE_SECRET_KEY!,publishable=process.env.LISTING_SUPABASE_PUBLISHABLE_KEY!;
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
const sessionPath='dist/cloudflare-listing-e2e-session.json';
const evidencePath='dist/cloudflare-listing-e2e-evidence.json';
const evidence:Record<string,unknown>={synthetic:true,messagesSent:0,publicationEnabled:false};

async function prepare(){
 if(!url||!key||!publishable)throw Error('Missing server configuration');
 const email='dwellhunt-cloudflare-test-'+crypto.randomUUID()+'@example.invalid';
 const creation=await fetch(url+'/auth/v1/admin/users',{method:'POST',headers,body:JSON.stringify({email,password:randomBytes(40).toString('base64url'),email_confirm:true,user_metadata:{synthetic:true,acceptance:'cloudflare-listing-e2e-20261113'}}),signal:AbortSignal.timeout(15000)});
 if(!creation.ok)throw Error('SYNTHETIC_AUTH_CREATE_FAILED_'+creation.status);
 const user=await creation.json() as any;
 try{
  const generated=await fetch(url+'/auth/v1/admin/generate_link',{method:'POST',headers,body:JSON.stringify({type:'magiclink',email}),signal:AbortSignal.timeout(15000)});
  if(!generated.ok)throw Error('SYNTHETIC_LOGIN_CREATE_FAILED_'+generated.status);
  const link=await generated.json() as any;
  const verified=await fetch(url+'/auth/v1/verify',{method:'POST',headers:{apikey:publishable,'Content-Type':'application/json'},body:JSON.stringify({token_hash:link.hashed_token||link.properties?.hashed_token,type:'email'}),signal:AbortSignal.timeout(15000)});
  if(!verified.ok)throw Error('SYNTHETIC_LOGIN_VERIFY_FAILED_'+verified.status);
  const login=await verified.json() as any;if(!login.access_token)throw Error('NO_TEST_SESSION');
  mkdirSync('dist',{recursive:true});writeFileSync(sessionPath,JSON.stringify({actor:user.id,email,accessToken:login.access_token}),{mode:0o600});
  console.log(JSON.stringify({prepared:true,actorId:user.id}));
 }catch(error){
  await fetch(url+'/auth/v1/admin/users/'+user.id,{method:'PUT',headers,body:JSON.stringify({ban_duration:'876000h'}),signal:AbortSignal.timeout(15000)}).catch(()=>{});
  throw error;
 }
}

async function verify(){
 const session=JSON.parse(readFileSync(sessionPath,'utf8')) as {actor:string;accessToken:string};
 const origin='https://mfds824.github.io',requestKey=crypto.randomUUID(),draft=syntheticDraft();
 draft.renewalEmailConsent=false;
 const request=()=>fetch(base+'/api/dwellhunt/listings',{method:'POST',headers:{Authorization:'Bearer '+session.accessToken,'Content-Type':'application/json',Origin:origin},body:JSON.stringify({draft,requestKey}),signal:AbortSignal.timeout(25000)});
 const first=await request();const firstBody=await first.json() as any;
 if(first.status!==201)throw Error(`DEPLOYED_SUBMISSION_FAILED_${first.status}_${String(firstBody.code||'UNKNOWN')}`);
 const saved=firstBody;
 assert.match(saved.listing.listingId,/^TEST-DHL-/);assert.ok(Date.parse(saved.listing.submittedAt));
 evidence.listingId=saved.listing.listingId;evidence.submittedAt=saved.listing.submittedAt;
 const retries=await Promise.all(Array.from({length:5},()=>request()));
 for(const retry of retries){assert.equal(retry.status,200);assert.equal((await retry.json() as any).listing.listingId,saved.listing.listingId);}
 evidence.concurrentRetriesDeduplicated=true;
 const owner=await fetch(base+'/api/dwellhunt/listings/'+encodeURIComponent(saved.listing.listingId),{headers:{Authorization:'Bearer '+session.accessToken,Origin:origin}});
 assert.equal(owner.status,200);const owned=await owner.json() as any;assert.equal(owned.listing.status,'submitted');evidence.ownerCanReadSubmission=true;
 const publicResponse=await fetch(base+'/api/dwellhunt/listings/public',{headers:{Origin:origin}});
 assert.equal(publicResponse.status,200);const publicData=await publicResponse.json() as any;
 assert.ok(!(publicData.listings||[]).some((item:any)=>item.id===saved.listing.listingId));evidence.syntheticExcludedFromPublic=true;
 evidence.result='passed';writeFileSync(evidencePath,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}

async function disable(){
 const session=JSON.parse(readFileSync(sessionPath,'utf8')) as {actor:string};
 const result=await fetch(url+'/auth/v1/admin/users/'+session.actor,{method:'PUT',headers,body:JSON.stringify({ban_duration:'876000h'}),signal:AbortSignal.timeout(15000)});
 if(!result.ok)throw Error('SYNTHETIC_AUTH_DISABLE_FAILED_'+result.status);
 let previous:Record<string,unknown>={};try{previous=JSON.parse(readFileSync(evidencePath,'utf8')) as Record<string,unknown>;}catch{}
 mkdirSync('dist',{recursive:true});writeFileSync(evidencePath,JSON.stringify({...previous,syntheticIdentityDisabled:true},null,2));
 unlinkSync(sessionPath);
 console.log(JSON.stringify({syntheticIdentityDisabled:true,listingCreated:false}));
}

if(process.argv.includes('--prepare'))await prepare();
else if(process.argv.includes('--verify'))await verify();
else if(process.argv.includes('--disable'))await disable();
else throw Error('Explicit --prepare, --verify or --disable required');
