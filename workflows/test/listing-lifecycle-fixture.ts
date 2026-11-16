import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createOwnerDraft} from '../website/owner-listing-model.js';
import {ListingError} from '../src/listings/validation';
export const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',REVIEWER='33333333-3333-4333-8333-333333333333';
export function syntheticDraft(){return Object.assign(createOwnerDraft({listingRole:'owner',listingPurpose:'buy',propertyCategory:'apartment'}),{
 ownerName:'SYNTHETIC TEST OWNER',email:'approved-owner@example.test',phone:'+94770000000',countryCode:'+94',phoneNumber:'770000000',preferredContact:'email',
 district:'Colombo',city:'Synthetic test area',street:'PRIVATE TEST ADDRESS',unit:'PRIVATE TEST UNIT',building:'PRIVATE TEST PROJECT',apartmentType:'standard',
 privateLocation:{lat:6.912345,lng:79.876543,confirmed:true},title:'SYNTHETIC TEST — not a public listing',bedrooms:'2',bathrooms:'1',floorArea:'1000',floorUnit:'sqft',parking:'1',
 floorNumber:'0',furnishing:'unfurnished',condition:'Good condition',price:'25000000',saleAvailability:'Available now',
 description:'Synthetic test data, excluded from public search.',photos:[{id:'test-photo',name:'private-photo-name.jpg',url:'https://res.cloudinary.com/xx8yy8mw/image/upload/synthetic-only.jpg',status:'ready',kind:'photo'}],
 publicName:'Synthetic public contact',publicMethods:['email'],publicEmail:'public@example.test',enquiryDestination:'private-routing@example.test',
 authorized:true,accurate:true,photoPermission:true,renewalEmailConsent:true});}
export async function database(){
 const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);');
 for(const f of ['20261113_listing_lifecycle.sql','20261113_listing_delivery_recovery.sql','20261114_agent_listings.sql'])await db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 await db.query('insert into auth.users(id) values ($1),($2),($3)',[OWNER,OTHER,REVIEWER]);
 await db.query('insert into dwellhunt_listing_private.reviewers(user_id) values ($1)',[REVIEWER]);
 const rpc=async<T>(name:string,args:Record<string,unknown>={}):Promise<T>=>{
  if(!/^dh_listing[a-z_]*$/.test(name))throw Error('Invalid test RPC');
  const keys=Object.keys(args);try{const r=await db.query<{data:T}>('select public.'+name+'('+keys.map((k,i)=>k+' => $'+(i+1)).join(',')+') as data',keys.map(k=>args[k]&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]));return r.rows[0].data;}
  catch(error){const code=(error as Error).message;throw new ListingError(code,code==='FORBIDDEN'?403:code==='NOT_FOUND'?404:409);}
 };
 return {db,rpc,authenticate:async(token:string|null)=>{if(!token)throw new ListingError('SIGN_IN_REQUIRED',401);return {id:token==='Bearer reviewer'?REVIEWER:token==='Bearer other'?OTHER:OWNER,email:'approved-owner@example.test'};}};
}
