import {handleListingRequest,type ListingApiConfig} from '../src/listings/api';
import {ListingError} from '../src/listings/validation';
import {runCloudflareListingMaintenance,type ListingCronConfig} from './listings-maintenance';
import {handleSupabaseSendEmailHook} from '../src/listings/auth-email-hook';
// Separate entry keeps booking, Telegram, viewing maintenance and unrelated frontend work out of this release.
type ListingWorkerEnvironment=ListingApiConfig&ListingCronConfig&{SUPABASE_SEND_EMAIL_HOOK_SECRET?:string};
type ScheduledControllerLike={cron:string;scheduledTime:number};
type ScheduledContextLike={waitUntil(promise:Promise<unknown>):void};

export default {
 fetch(request:Request,env:ListingWorkerEnvironment):Promise<Response>{
  if(new URL(request.url).pathname==='/hooks/supabase/send-email')
   return handleSupabaseSendEmailHook(request,env,globalThis.fetch.bind(globalThis));
  return handleListingRequest(request,env);
 },
 scheduled(_event:ScheduledControllerLike,env:ListingWorkerEnvironment,ctx:ScheduledContextLike){
  ctx.waitUntil((async()=>{
   try{
    const result=await runCloudflareListingMaintenance(env);
    if(!('skipped'in result))console.log(JSON.stringify({event:'listing-maintenance-complete',processed:result.processed,
     expired:result.lifecycle.expired||0,reconciled:result.reconciliation.resolved}));
   }catch(error){
    const code=error instanceof ListingError?error.code:'DEPENDENCY_UNAVAILABLE';
    console.error(JSON.stringify({event:'listing-maintenance-failed',code}));
   }
  })());
 },
};
