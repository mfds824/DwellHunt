import {queue,schedules,task,tasks} from '@trigger.dev/sdk';
import {ListingRepository,type ListingRuntimeConfig} from '../src/listings/repository';
import {runListingMaintenance} from '../src/listings/maintenance';
import {callGateway} from '../src/gateway';
const listingQueue=queue({name:'dwellhunt-listing-outbox',concurrencyLimit:1});
const configured=()=>process.env.LISTING_AUTOMATION_ENABLED==='true';
const repository=()=>new ListingRepository(process.env as ListingRuntimeConfig);
async function drain(){
 const result=await runListingMaintenance(repository(),callGateway);
 if(result.processed>0)await tasks.trigger('dwellhunt-listing-outbox',{}, {idempotencyKey:'listing-drain:'+crypto.randomUUID()});
 return result;
}
export const listingOutbox=task({id:'dwellhunt-listing-outbox',queue:listingQueue,retry:{maxAttempts:3,minTimeoutInMs:5000,maxTimeoutInMs:30000},
 run:async()=>configured()?drain():{skipped:true,reason:'Listing automation not activated'}});
export const listingMaintenance=schedules.task({id:'dwellhunt-listing-maintenance',queue:listingQueue,
 cron:process.env.LISTING_NATIVE_SCHEDULES==='true'?{pattern:'*/5 * * * *',timezone:'Asia/Colombo',environments:['PRODUCTION']}:undefined,retry:{maxAttempts:3},
 run:async()=>{if(!configured())return {skipped:true,reason:'Listing automation not activated'};return drain();}});
