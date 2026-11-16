import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCloudflareListingMaintenance} from '../cloudflare/listings-maintenance';
import type {ListingMaintenanceRepository} from '../src/listings/maintenance';

test('Cloudflare schedule stays inert until the listing automation flag is explicitly enabled',async()=>{
 let rpcCalls=0,gatewayCalls=0;
 const repo={async rpc<T>():Promise<T>{rpcCalls++;throw new Error('disabled schedule must not access storage');}} as ListingMaintenanceRepository;
 const result=await runCloudflareListingMaintenance({LISTING_AUTOMATION_ENABLED:'false'},repo,async()=>{gatewayCalls++;return{ok:true};});
 assert.deepEqual(result,{skipped:true,reason:'Listing automation not activated'});
 assert.equal(rpcCalls,0);assert.equal(gatewayCalls,0);
});

test('enabled Cloudflare schedule reconciles deliveries, ticks expiry and drains the durable outbox',async()=>{
 const calls:string[]=[];
 const repo={async rpc<T>(name:string):Promise<T>{
  calls.push(name);
  const value=name==='dh_listing_uncertain'?[]:name==='dh_listing_tick'?{expired:0}:name==='dh_listing_claim'?[]:{};
  return value as T;
 }} as ListingMaintenanceRepository;
 const result=await runCloudflareListingMaintenance({LISTING_AUTOMATION_ENABLED:'true'},repo,async()=>({ok:true}));
 assert.deepEqual(calls,['dh_listing_uncertain','dh_listing_tick','dh_listing_claim']);
 assert.ok(!('skipped'in result));assert.equal(result.processed,0);assert.deepEqual(result.lifecycle,{expired:0});
});
