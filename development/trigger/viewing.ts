import {schemaTask,AbortTaskRunError} from '@trigger.dev/sdk';
import {reference} from '../backend/triggerdev/jobs.ts';
import type {JobKind,Repository} from '../backend/triggerdev/store.ts';
import {createJobs} from '../backend/triggerdev/jobs.ts';
import {configuration} from '../backend/triggerdev/config.ts';
// There is deliberately no default Google, database, email or Cloud transport binding.
export function localJobRunner(repo:Repository,notifyMock:(id:string,key:string)=>Promise<void>,now:()=>number){
  return createJobs(configuration('development',true),repo,notifyMock,now);
}
function unbound(kind:JobKind){
  return schemaTask({id:'dwellhunt-'+kind,schema:reference,
    queue:{name:'dwellhunt-mock-only',concurrencyLimit:1},maxDuration:30,retry:{maxAttempts:1},
    run:async()=>{throw new AbortTaskRunError('LIVE_BINDING_NOT_CONFIGURED');}
  });
}
export const bookingIntake=unbound('booking-intake');
export const statusUpdate=unbound('status-update');
export const notification=unbound('notification');

export async function runMockSmoke(input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).join(',')!=='fixture'||(input as {fixture?:unknown}).fixture!=='dwellhunt-local-only')throw new AbortTaskRunError('INVALID_MOCK_FIXTURE');
  return {mock:true,bookingsSubmitted:0,notificationsSent:0};
}
export const mockSmoke=schemaTask({id:'dwellhunt-local-mock-smoke',schema:(value:unknown)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!=='fixture'||(value as {fixture?:unknown}).fixture!=='dwellhunt-local-only')throw new AbortTaskRunError('INVALID_MOCK_FIXTURE');
  return {fixture:'dwellhunt-local-only'};
},
  maxDuration:10,retry:{maxAttempts:1},run:runMockSmoke});
