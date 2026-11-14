import {ListingRepository} from './repository';
import {ListingError,object} from './validation';
import {listingSheetRecord,followupSheetRecord} from './sheets';
import type {GatewayAction,Payload} from '../gateway';
type Rpc=Pick<ListingRepository,'rpc'>;
export type ListingGateway=(action:GatewayAction,payload:Payload)=>Promise<Payload>;
export interface OutboxJob extends Record<string,unknown>{id:string;kind:string;lease_token:string}
export async function reconcileListingDeliveries(repo:Rpc,gateway:ListingGateway){
 const jobs=await repo.rpc<Array<{jobId:string;key:string}>>('dh_listing_uncertain');let resolved=0;
 for(const job of jobs){
  try{const result=await gateway('listing_reminder_lookup',{idempotencyKey:job.key});
   if(result.ok===true&&['Delivered','Not found','Failed'].includes(String(result.outcome))){
    if(await repo.rpc('dh_listing_reconcile',{p_job:job.jobId,p_outcome:result.outcome,p_receipt:result.receipt||null}))resolved++;
   }
  }catch{/* No replay or private error logging; the durable uncertain record remains. */}
 }
 return {checked:jobs.length,resolved};
}
export async function processListingOutbox(repo:Rpc,gateway:ListingGateway,limit=1){
 const jobs=await repo.rpc<OutboxJob[]>('dh_listing_claim',{p_limit:limit});const results:Record<string,unknown>[]=[];
 for(const job of jobs){
  let delivery:Record<string,unknown>|null=null;
  try{
   const data=await repo.rpc<Record<string,unknown>>('dh_listing_job_data',{p_job:job.id,p_lease:job.lease_token});
   if(job.kind==='sheets_listing'||job.kind==='sheets_followup'){
    const result=await gateway('listing_sheet_sync',{tab:job.kind==='sheets_listing'?'Listings':'Followups',
     ...(job.kind==='sheets_listing'?{revision:object(data.listing).version}:{}),
     record:job.kind==='sheets_listing'?listingSheetRecord(data.listing):followupSheetRecord(data.followup)});
    if(result.ok!==true)throw new ListingError('SHEET_SYNC_RETRY',503);
    await repo.rpc('dh_listing_finish_job',{p_job:job.id,p_lease:job.lease_token,p_outcome:'done',p_error:null});
    results.push({id:job.id,outcome:'synced'});continue;
   }
   if(job.kind!=='renewal_reminder')throw new ListingError('INVALID_JOB');
   delivery=await repo.rpc<Record<string,unknown>>('dh_listing_begin_delivery',{p_job:job.id,p_lease:job.lease_token});
   if(delivery.eligible!==true){await repo.rpc('dh_listing_finish_job',{p_job:job.id,p_lease:job.lease_token,p_outcome:'cancelled',p_error:null});results.push({id:job.id,outcome:'suppressed'});continue;}
   // A provider receipt lookup is safe after a timeout/crash. Never blindly resend
   // an Uncertain result; the Apps Script provider persists ambiguity before sending.
   let result=await gateway('listing_reminder_lookup',{idempotencyKey:delivery.idempotencyKey});
   if(result.ok!==true)throw new ListingError('REMINDER_LOOKUP_UNAVAILABLE',503);
   if(result.outcome==='Not found')result=await gateway('listing_reminder',delivery);
   const outcome=result.ok===true&&['Delivered','Failed','Uncertain'].includes(String(result.outcome))?String(result.outcome):'Uncertain';
   await repo.rpc('dh_listing_delivery_result',{p_job:job.id,p_attempt:delivery.attemptId,p_outcome:outcome,p_receipt:typeof result.receipt==='string'?result.receipt:null});
   await repo.rpc('dh_listing_finish_job',{p_job:job.id,p_lease:job.lease_token,p_outcome:outcome==='Delivered'?'done':outcome==='Failed'?'retry':'uncertain',p_error:outcome==='Delivered'?null:'REMINDER_'+outcome.toUpperCase()});
   results.push({id:job.id,outcome});
  }catch(error){
   const code=error instanceof ListingError?error.code:'DEPENDENCY_UNAVAILABLE';
   if(delivery?.eligible===true){
    try{await repo.rpc('dh_listing_delivery_result',{p_job:job.id,p_attempt:delivery.attemptId,p_outcome:'Uncertain',p_receipt:null});}catch{}
    await repo.rpc('dh_listing_finish_job',{p_job:job.id,p_lease:job.lease_token,p_outcome:'uncertain',p_error:code});
   }else await repo.rpc('dh_listing_finish_job',{p_job:job.id,p_lease:job.lease_token,p_outcome:'retry',p_error:code});
   results.push({id:job.id,outcome:delivery?.eligible===true?'uncertain':'retry',code});
  }
 }
 return {processed:results.length,results};
}
