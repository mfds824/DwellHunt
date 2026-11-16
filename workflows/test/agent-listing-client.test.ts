import {test} from 'node:test';import assert from 'node:assert/strict';
const model=await import(new URL('../website/owner-listing-model.js',import.meta.url).href);
const {prefillAgentDraft}=await import(new URL('../website/agent-listing.js',import.meta.url).href);
const {activeListing}=await import(new URL('../website/listing-public.js',import.meta.url).href);
const {createListingService}=await import(new URL('../website/listing-service.js',import.meta.url).href);
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const memory=()=>{const map=new Map();return {getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>map.set(k,v)};};
test('owner and agent draft keys isolate roles and signed-in accounts, recover failed uploads and preserve property-specific content',()=>{
 const storage=memory(),owner=model.createOwnerDraft({listingRole:'owner',listingPurpose:'buy',propertyCategory:'apartment'});
 owner.title='Private owner draft';model.saveOwnerDraft(storage,owner);
 const agent=model.createOwnerDraft({listingRole:'agent',listingPurpose:'rent',propertyCategory:'villa'});agent.draftAccountId=A;agent.title='Private agent draft';agent.step=4;agent.photos=[{id:'interrupted',status:'uploading',name:'local-only.jpg',url:''}];
 model.saveOwnerDraft(storage,agent);assert.equal(model.loadOwnerDraft(storage).draft.title,owner.title);assert.equal(model.loadOwnerDraft(storage,{role:'agent',accountId:B}),null);
 const saved=model.loadOwnerDraft(storage,{role:'agent',accountId:A}).draft;assert.equal(saved.title,agent.title);assert.equal(saved.step,4);assert.equal(saved.photos[0].status,'failed');
 storage.setItem(model.listingDraftKey({listingRole:'agent'},B),storage.getItem(model.listingDraftKey({listingRole:'agent'},A))!);assert.throws(()=>model.loadOwnerDraft(storage,{role:'agent',accountId:B}),/not supported/);
 assert.throws(()=>model.saveOwnerDraft(storage,{...agent,draftAccountId:''}),/Sign in/);
 const profile={name:'Synthetic Agent',email:'synthetic@example.test',phone:'+94770000001'};
 const filled=prefillAgentDraft(agent,profile,A);assert.equal(filled.title,agent.title);assert.equal(filled.selection.propertyCategory,'villa');assert.equal(filled.price,agent.price);assert.equal(filled.publicEmail,profile.email);assert.equal(filled.countryCode,'+94');
 assert.equal(JSON.stringify(model.publicOwnerListing(filled)).includes(A),false);
});
test('managed agent public records obey status, expiry and synthetic exclusion just like owner records',()=>{
 const p={id:'DHL-'+A,listingRole:'agent',status:'published',expiresAt:'2027-01-01T00:00:00Z'};assert.equal(activeListing(p,0),true);assert.equal(activeListing({...p,synthetic:true},0),false);assert.equal(activeListing({...p,status:'submitted'},0),false);assert.equal(activeListing(p,Date.parse(p.expiresAt)),false);
});
test('shared sign-in service announces account changes without storing tokens in profile or listing payloads',async()=>{
 const calls:any[]=[];let changes=0;
 const client=createListingService({enabled:true,agentEnabled:true,apiUrl:'https://listing.example.test',supabaseUrl:'https://auth.example.test',publishableKey:'sb_publishable_synthetic'},async(url:string,options:any)=>{
 calls.push({url,body:options.body?JSON.parse(options.body):null});return Response.json(url.endsWith('/verify')?{access_token:'synthetic-memory-token',expires_in:3600}:url.endsWith('/user')?{id:A,email:'agent@example.test',email_confirmed_at:'today'}:{ok:true,profile:{name:'Synthetic Agent'},memberships:[],listings:[]});
 });
 const unsubscribe=client.subscribe(()=>changes++);await client.verifyCode('agent@example.test','123456');assert.equal(client.account().id,A);assert.equal(client.agentReady,true);
 await client.saveAgentProfile({name:'Synthetic Agent',phone:'+94770000001'});await client.dashboard();client.signOut();assert.equal(client.account(),null);assert.equal(changes,2);assert.equal(JSON.stringify(calls.filter(c=>c.url.includes('/listings'))).includes('synthetic-memory-token'),false);unsubscribe();
});


test('shared agent form validation preserves all categories and sale/monthly/nightly price conventions',()=>{
 for(const category of ['apartment','villa','house'])for(const purpose of ['buy','rent'])for(const rentalType of purpose==='buy'?['']:['long-term','short-stay']){
  const d=model.createOwnerDraft({listingRole:'agent',listingPurpose:purpose,propertyCategory:category});
  Object.assign(d,{price:'125000',currency:'LKR',saleAvailability:'Available now',rentalType,billingPeriod:rentalType==='short-stay'?'night':'month',minimumDuration:'2',durationUnit:rentalType==='short-stay'?'nights':'months',deposit:'0',availableFrom:'2026-12-01',availabilityNote:'Confirm dates with the assigned agent.'});
  assert.deepEqual(model.validateOwnerStep(d,3),{});
  const pub=model.publicOwnerListing(d);assert.equal(pub.category,category);assert.equal(pub.purpose,purpose);assert.equal(pub.price,125000);if(purpose==='rent')assert.equal(pub.billingPeriod,d.billingPeriod);
 }
});
