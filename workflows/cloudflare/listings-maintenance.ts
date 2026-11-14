import {ListingRepository,type ListingRuntimeConfig} from '../src/listings/repository';
import {runListingMaintenance,type ListingMaintenanceRepository} from '../src/listings/maintenance';
import type {ListingGateway} from '../src/listings/outbox';
import type {GatewayAction,Payload} from '../src/gateway';

export interface ListingCronConfig extends ListingRuntimeConfig {
 LISTING_AUTOMATION_ENABLED?:string;
 APPS_SCRIPT_EXEC_URL?:string;
 APPS_SCRIPT_AUTH_BODY_JSON?:string;
 APPS_SCRIPT_AUTH_HEADERS_JSON?:string;
}

function parseObject(value:string,label:string):Record<string,unknown>{
 let parsed:unknown;try{parsed=JSON.parse(value);}catch{throw new Error(`Invalid ${label}`);}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error(`Invalid ${label}`);
 return parsed as Record<string,unknown>;
}

function gatewayFor(config:ListingCronConfig){
 return async(action:GatewayAction,payload:Payload):Promise<Payload>=>{
  const urlValue=config.APPS_SCRIPT_EXEC_URL,authValue=config.APPS_SCRIPT_AUTH_BODY_JSON;
  if(!urlValue||!authValue)throw new Error('LISTING_GATEWAY_NOT_CONFIGURED');
  const url=new URL(urlValue);
  if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!url.pathname.endsWith('/exec'))throw new Error('LISTING_GATEWAY_NOT_CONFIGURED');
  const auth=parseObject(authValue,'gateway authentication');
  const extraHeaders=parseObject(config.APPS_SCRIPT_AUTH_HEADERS_JSON||'{}','gateway headers');
  if('action'in auth||'payload'in auth||Object.keys(extraHeaders).some(k=>['content-type','host','content-length'].includes(k.toLowerCase()))||Object.values(extraHeaders).some(v=>typeof v!=='string'))
   throw new Error('LISTING_GATEWAY_CONFIG_INVALID');
  const response=await fetch(url,{method:'POST',headers:{...extraHeaders as Record<string,string>,'Content-Type':'application/json'},
   body:JSON.stringify({...auth,action,payload}),signal:AbortSignal.timeout(60_000)});
  if(!response.ok)throw new Error('LISTING_GATEWAY_UNAVAILABLE');
  const contentType=response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()||'';
  if(contentType!=='application/json'&&!contentType.endsWith('+json'))throw new Error('LISTING_GATEWAY_INVALID_RESPONSE');
  let result:unknown;try{result=await response.json();}catch{throw new Error('LISTING_GATEWAY_INVALID_RESPONSE');}
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('LISTING_GATEWAY_INVALID_RESPONSE');
  return result as Payload;
 };
}

export async function runCloudflareListingMaintenance(config:ListingCronConfig,repo?:ListingMaintenanceRepository,gateway?:ListingGateway){
 if(config.LISTING_AUTOMATION_ENABLED!=='true')return {skipped:true,reason:'Listing automation not activated'};
 return runListingMaintenance(repo||new ListingRepository(config),gateway||gatewayFor(config));
}
