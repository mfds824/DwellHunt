import {test} from 'node:test';import assert from 'node:assert/strict';
// @ts-ignore browser ESM module
import {createListingService} from '../website/listing-service.js';
import {ListingRepository} from '../src/listings/repository';
// @ts-ignore browser ESM module
import {activeListing} from '../website/listing-public.js';
// @ts-ignore browser ESM module
import {ownerListingAdapter} from '../website/listing-adapter.js';
// @ts-ignore browser ESM module
import {createOwnerDraft} from '../website/owner-listing-model.js';
// @ts-ignore browser ESM module
import {filterHomeListings} from '../website/homepage-search.js';
const config={enabled:true,apiUrl:'https://listings.example.test',supabaseUrl:'https://auth.example.test',publishableKey:'sb_publishable_fake_test_only'};
test('client sends no mail automatically, keeps tokens out of drafts, preserves retry key and rejects unconfirmed success',async()=>{
 const calls:{url:string;body:any;headers:any}[]=[];
 const fetcher=async(url:string,options:any)=>{const body=options.body?JSON.parse(options.body):null;calls.push({url,body,headers:options.headers});return Response.json(url.endsWith('/verify')?{access_token:'fake-memory-only',expires_in:3600,user:{id:'owner',email_confirmed_at:'today'}}:url.endsWith('/user')?{id:'owner',email:'approved@example.test',email_confirmed_at:'today'}:url.endsWith('/listings')?{ok:true,listing:{listingId:'TEST-ID',submittedAt:'2026-11-13T00:00:00Z'}}:{});};
 const service=createListingService(config,fetcher);assert.equal(calls.length,0);await assert.rejects(service.submit({id:'draft'},'stable'),/SIGN_IN_REQUIRED/);
 await service.sendCode('approved@example.test');assert.equal(calls.length,1);await service.verifyCode('approved@example.test','123456');
 const draft={id:'draft',title:'Preserved'};await service.submit(draft,'stable');await service.submit(draft,'stable');const submissions=calls.filter(call=>call.url.endsWith('/listings'));assert.equal(submissions[0].body.requestKey,submissions[1].body.requestKey);assert.equal(JSON.stringify(draft).includes('fake-memory'),false);assert.equal(draft.title,'Preserved');
 service.signOut();await assert.rejects(service.submit(draft,'stable'),/SIGN_IN_REQUIRED/);
});

test('client restores a verified Supabase magic-link session from the redirect fragment and removes tokens from the URL',async()=>{
 let replaced='';const browserWindow:any={location:{hash:'#access_token=one-time-token&expires_in=3600&token_type=bearer',pathname:'/DwellHunt/',search:''},history:{replaceState:(_state:any,_title:string,url:string)=>{replaced=url;}}};
 const calls:any[]=[];const client=createListingService(config,async(url:string,options:any)=>{calls.push({url,options});return Response.json({id:'owner',email:'approved@example.test',email_confirmed_at:'today',is_anonymous:false});},browserWindow);
 assert.equal(await client.restoreRedirectSession(),true);assert.equal(client.signedIn(),true);assert.equal(replaced,'/DwellHunt/');assert.equal(calls[0].url,'https://auth.example.test/auth/v1/user');assert.equal(calls[0].options.headers.Authorization,'Bearer one-time-token');
});

test('public client drops expired and synthetic listings and never treats a device draft as published',()=>{
 const p={id:'DHL-11111111-1111-4111-8111-111111111111',listingRole:'owner',status:'published',expiresAt:'2026-12-01T00:00:00Z'};
 assert.equal(activeListing(p,Date.parse('2026-11-30T23:59:59Z')),true);assert.equal(activeListing(p,Date.parse(p.expiresAt)),false);assert.equal(activeListing({...p,synthetic:true},0),false);assert.equal(activeListing({...p,status:'submitted'},0),false);assert.equal(activeListing({...p,expiresAt:undefined},0),false);
});

test('public house category maps to the existing marketplace category without changing owner form values',()=>{
 const draft=createOwnerDraft({listingRole:'owner',listingPurpose:'buy',propertyCategory:'house'}),listing=ownerListingAdapter(draft,'published');
 assert.equal(draft.selection.propertyCategory,'house');assert.equal(listing.category,'mansion');
 assert.equal(filterHomeListings([listing],{purpose:'buy',category:'mansion',minPrice:'',maxPrice:'',bedrooms:'any'}).length,1);
});

test('public feed uses a server-anchored expiry clock and rejects malformed responses',async()=>{
 const stamp='2001-01-01T00:00:00Z';
 const client=createListingService(config,async()=>Response.json({serverNow:stamp,listings:[]}));
 assert.deepEqual(await client.publicListings(),[]);assert.ok(Math.abs(client.serverTime()-Date.parse(stamp))<1000);
 const broken=createListingService(config,async()=>Response.json({listings:[]}));await assert.rejects(broken.publicListings(),/INVALID_PUBLIC_RESPONSE/);
});
test('authentication verifies server identity, confirmed email and approved synthetic owner, ignoring metadata role',async()=>{
 const c={LISTING_SUPABASE_URL:'https://auth.example.test',LISTING_SUPABASE_SECRET_KEY:'sb_secret_fake',LISTING_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fake',LISTING_TEST_MODE:'true',LISTING_TEST_OWNER_IDS:'approved'};
 let user:any={id:'approved',email:'approved@example.test',email_confirmed_at:'today',user_metadata:{role:'reviewer'}};
 const r=new ListingRepository(c,(async()=>Response.json(user))as typeof fetch);
 await assert.rejects(r.authenticate(null),/SIGN_IN_REQUIRED/);assert.deepEqual(await r.authenticate('Bearer fake'),{id:'approved',email:'approved@example.test'});
 user={...user,is_anonymous:true};await assert.rejects(r.authenticate('Bearer fake'),/VERIFIED_OWNER_REQUIRED/);user={...user,is_anonymous:false,id:'other'};await assert.rejects(r.authenticate('Bearer fake'),/APPROVED_TEST_OWNER_REQUIRED/);
});
test('default repository fetch keeps the Worker global this binding',async()=>{
 const prior=globalThis.fetch;let bound=false;
 (globalThis as any).fetch=function(this:unknown){bound=this===globalThis;return Promise.resolve(Response.json({id:'approved',email:'approved@example.test',email_confirmed_at:'today'}));};
 try{
  const repository=new ListingRepository({LISTING_SUPABASE_URL:'https://auth.example.test',LISTING_SUPABASE_SECRET_KEY:'sb_secret_fake',LISTING_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fake'});
  await repository.authenticate('Bearer fake');assert.equal(bound,true);
 }finally{globalThis.fetch=prior;}
});
