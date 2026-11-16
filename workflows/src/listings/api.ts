import {ListingRepository,type ListingRuntimeConfig} from './repository';
import {ListingError,object,prepareSubmission} from './validation';
import {UUID,fingerprint} from './policy';
export interface ListingApiConfig extends ListingRuntimeConfig {WEBSITE_ORIGIN?:string;LISTING_PUBLICATION_ENABLED?:string}
export type Repository=Pick<ListingRepository,'rpc'|'authenticate'>;
const prefix='/api/dwellhunt/listings';
const ID=/^(?:TEST-)?DHL-[0-9a-f-]{36}$/i;
function response(body:unknown,status=200,origin?:string){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin}:{})}});}
export async function activePublicListing(repo:Repository,id:string):Promise<Record<string,unknown>>{
  if(!ID.test(id))throw new ListingError('NOT_FOUND',404);
  const records=await repo.rpc<Record<string,unknown>[]>('dh_listings_public',{p_listing_id:id});
  if(records.length!==1)throw new ListingError('LISTING_NOT_AVAILABLE',404);return records[0];
}
async function boundedJson(request:Request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ListingError('JSON_REQUIRED',415);
 const reader=request.body?.getReader();if(!reader)throw new ListingError('INVALID_REQUEST');const chunks:Uint8Array[]=[];let length=0;
 while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>131072){await reader.cancel();throw new ListingError('PAYLOAD_TOO_LARGE',413);}chunks.push(item.value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return object(JSON.parse(new TextDecoder().decode(bytes)));}catch{throw new ListingError('INVALID_JSON');}
}
export async function handleListingRequest(request:Request,config:ListingApiConfig,repo:Repository=new ListingRepository(config)):Promise<Response>{
 const origin=request.headers.get('Origin');const allowed=origin&&origin===config.WEBSITE_ORIGIN?origin:undefined;let stage='route';
 try{
  if(origin&&origin!==config.WEBSITE_ORIGIN)throw new ListingError('ORIGIN_DENIED',403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...(allowed?{'Access-Control-Allow-Origin':allowed}:{}),'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Vary':'Origin'}});
  if(config.LISTINGS_ENABLED!=='true')throw new ListingError('LISTING_WORKFLOW_NOT_ACTIVE',503);
  const url=new URL(request.url),path=url.pathname;
  if(path===prefix+'/health'&&request.method==='GET')return response({ok:true,configured:!!config.LISTING_SUPABASE_URL&&!!config.LISTING_SUPABASE_SECRET_KEY,publicationEnabled:config.LISTING_PUBLICATION_ENABLED==='true',syntheticOnly:config.LISTING_TEST_MODE==='true',agentEnabled:config.AGENT_LISTINGS_ENABLED==='true'},200,allowed);
  if(path===prefix+'/public'&&request.method==='GET'){
   const listings=await repo.rpc('dh_listings_public',{p_listing_id:null});
   return response({ok:true,serverNow:new Date().toISOString(),listings},200,allowed);
  }
  const publicMatch=path.match(/^\/api\/dwellhunt\/listings\/public\/([^/]+)(?:\/(contact|viewing))?$/);
  if(publicMatch&&request.method==='GET'){
   const listing=await activePublicListing(repo,decodeURIComponent(publicMatch[1]));
   if(publicMatch[2]==='viewing')throw new ListingError(listing.listingRole==='agent'?'AGENT_VIEWING_NOT_CONNECTED':'OWNER_VIEWING_NOT_CONNECTED',409);
   if(publicMatch[2]==='contact'){
    const contact=object(listing.contact),channel=url.searchParams.get('channel');
    if(!channel||!['email','phone','whatsapp'].includes(channel)||typeof contact[channel]!=='string')throw new ListingError('CONTACT_NOT_PERMITTED',403);
    const value=String(contact[channel]);let target:string;
    if(channel==='email'){if(!/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(value))throw new ListingError('CONTACT_NOT_PERMITTED',403);target='mailto:'+value;}
    else{if(!/^\+[1-9]\d{7,14}$/.test(value))throw new ListingError('CONTACT_NOT_PERMITTED',403);target=channel==='phone'?'tel:'+value:'https://wa.me/'+value.slice(1);}
    return new Response(null,{status:303,headers:{Location:target,'Cache-Control':'no-store',...(allowed?{'Access-Control-Allow-Origin':allowed}:{})}});
   }
   return response({ok:true,serverNow:new Date().toISOString(),listing},200,allowed);
  }
  stage='authenticate';const owner=await repo.authenticate(request.headers.get('Authorization'));
  const agentProfilePath=path===prefix+'/agent/profile';
  if(agentProfilePath || path===prefix+'/agent/dashboard'){
   if(config.AGENT_LISTINGS_ENABLED!=='true')throw new ListingError('AGENT_WORKFLOW_NOT_ACTIVE',503);
   if(agentProfilePath && request.method==='GET')return response({ok:true,...await repo.rpc<Record<string,unknown>>('dh_listing_agent_profile',{p_actor:owner.id})},200,allowed);
   if(agentProfilePath && request.method==='POST'){
    const input=await boundedJson(request);
    if(typeof input.name!=='string'||input.name.trim().length<2||input.name.length>120||typeof input.phone!=='string'||!/^\+[1-9]\d{7,14}$/.test(input.phone))throw new ListingError('VALIDATION_REQUIRED');
    const profile={name:input.name.trim(),phone:input.phone,agencyId:typeof input.agencyId==='string'?input.agencyId.slice(0,100):'',agencyClaim:typeof input.agencyClaim==='string'?input.agencyClaim.slice(0,200):''};
    return response({ok:true,...await repo.rpc<Record<string,unknown>>('dh_listing_agent_profile',{p_actor:owner.id,p_email:owner.email,p_profile:profile})},200,allowed);
   }
   if(request.method==='GET')return response({ok:true,listings:await repo.rpc('dh_listing_dashboard',{p_actor:owner.id,p_offset:Math.max(0,Number(url.searchParams.get('offset'))||0)})},200,allowed);
   throw new ListingError('METHOD_NOT_ALLOWED',405);
  }
  const enquiries=path.match(/^\/api\/dwellhunt\/listings\/([^/]+)\/enquiries$/);
  if(enquiries && request.method==='GET'){
   if(!ID.test(enquiries[1]))throw new ListingError('NOT_FOUND',404);
   return response({ok:true,...await repo.rpc<Record<string,unknown>>('dh_listing_enquiries',{p_actor:owner.id,p_listing_id:enquiries[1]})},200,allowed);
  }
  const draftMatch=path.match(/^\/api\/dwellhunt\/listings\/by-draft\/([^/]+)$/),recordMatch=path.match(/^\/api\/dwellhunt\/listings\/([^/]+)$/);
  if(request.method==='GET'&&(draftMatch||recordMatch)){
   const value=decodeURIComponent((draftMatch||recordMatch)![1]);if(draftMatch?!UUID.test(value):!ID.test(value))throw new ListingError('NOT_FOUND',404);
   return response({ok:true,listing:await repo.rpc('dh_listing_get',{p_actor:owner.id,p_listing_id:recordMatch?value:null,p_draft_id:draftMatch?value:null})},200,allowed);
  }
  if(request.method!=='POST')throw new ListingError('METHOD_NOT_ALLOWED',405);
  stage='parse_request';const body=await boundedJson(request);if(typeof body.requestKey!=='string'||!UUID.test(body.requestKey))throw new ListingError('REQUEST_KEY_REQUIRED');
  const actionMatch=path.match(/^\/api\/dwellhunt\/listings\/([^/]+)\/actions\/([a-z_]+)$/);
  const action=path===prefix?'submit':actionMatch?.[2];const listingId=actionMatch?decodeURIComponent(actionMatch[1]):null;
  if(!action||(listingId&&!ID.test(listingId)))throw new ListingError('NOT_FOUND',404);
  if(!['submit','edit','approve','needs_changes','decline','publish','renew','pause','resume','withdraw','sold','rented','followup','resolve_notification','reassign'].includes(action))throw new ListingError('INVALID_ACTION');
  let payload:Record<string,unknown>={},publicSnapshot:Record<string,unknown>={};
  if(action==='submit'||action==='edit'){
   stage='prepare_submission';
   if(object(object(body.draft).selection).listingRole==='agent' && config.AGENT_LISTINGS_ENABLED!=='true')throw new ListingError('AGENT_WORKFLOW_NOT_ACTIVE',503);
   const prepared=prepareSubmission(body.draft,owner.email);payload=prepared.draft;publicSnapshot=prepared.publicSnapshot;
  }else if(action==='renew'){
   if(body.priceConfirmed!==true||body.available!==true||body.renewalConsent!==true||body.authorityConfirmed!==true||typeof body.price!=='number'||!Number.isFinite(body.price)||body.price<=0||!['LKR','USD','GBP','AED'].includes(String(body.currency)))throw new ListingError('RENEWAL_CONFIRMATION_REQUIRED');
   payload={priceConfirmed:true,available:true,renewalConsent:true,authorityConfirmed:true,price:body.price,currency:body.currency};
  }else if(action==='reassign'){
   if(typeof body.assignedAgentId!=='string'||!UUID.test(body.assignedAgentId))throw new ListingError('INVALID_AGENT');
   payload={assignedAgentId:body.assignedAgentId,reason:typeof body.reason==='string'?body.reason.slice(0,2000):''};
  }else if(action==='resolve_notification'){
   if(typeof body.jobId!=='string'||!UUID.test(body.jobId)||!['Delivered','Suppressed'].includes(String(body.outcome))||typeof body.evidence!=='string'||body.evidence.trim().length<10)throw new ListingError('DELIVERY_RESOLUTION_REQUIRED');
   payload={jobId:body.jobId,outcome:body.outcome,evidence:body.evidence.slice(0,1000)};
  }else if(action==='followup'){
   for(const key of ['reason','channel','outcome'])if(typeof body[key]!=='string'||!String(body[key]).trim()||String(body[key]).length>200)throw new ListingError('INVALID_FOLLOWUP');
   if(!['email','phone','whatsapp','internal'].includes(String(body.channel)))throw new ListingError('INVALID_FOLLOWUP');
   const next=body.nextFollowupAt;if(next!==undefined&&next!==''&&(typeof next!=='string'||!Number.isFinite(Date.parse(next))))throw new ListingError('INVALID_FOLLOWUP');
   payload={reason:body.reason,channel:body.channel,outcome:body.outcome,nextFollowupAt:next||'',notes:typeof body.notes==='string'?body.notes.slice(0,2000):''};
  }else payload={reason:typeof body.reason==='string'?body.reason.slice(0,2000):''};
  if(action!=='submit'&&(!Number.isInteger(body.expectedVersion)||Number(body.expectedVersion)<1))throw new ListingError('VERSION_REQUIRED');
  let publicationUrl:string|null=null;
  if(action==='publish'){
   if(config.LISTING_PUBLICATION_ENABLED!=='true'||!config.LISTING_SITE_URL)throw new ListingError('PUBLICATION_NOT_CONFIGURED',503);
   const target=new URL(config.LISTING_SITE_URL);if(target.protocol!=='https:'||target.username||target.password)throw new ListingError('PUBLICATION_NOT_CONFIGURED',503);
   target.searchParams.set('listing',listingId!);publicationUrl=target.href;
  }
  stage='fingerprint';const hash=await fingerprint({action,listingId,expectedVersion:body.expectedVersion||0,payload,publicSnapshot});
  stage='database_command';
  const result=await repo.rpc<Record<string,unknown>>('dh_listing_command',{p_actor:owner.id,p_action:action,p_listing_id:listingId,
   p_request_key:body.requestKey,p_expected_version:body.expectedVersion||0,p_payload:payload,p_public:publicSnapshot,p_hash:hash,
   p_synthetic:config.LISTING_TEST_MODE==='true',p_url:publicationUrl});
  if(typeof result.listingId!=='string'||typeof result.submittedAt!=='string'||typeof result.status!=='string')throw new ListingError('STORAGE_CONFIRMATION_MISSING',503);
  return response({ok:true,listing:result,sheetSync:'pending'},action==='submit'&&result.duplicate!==true?201:200,allowed);
 }catch(error){
  if(!(error instanceof ListingError))console.error(JSON.stringify({event:'listing-request-failed',stage,errorType:error instanceof Error?error.name:'unknown'}));
  const e=error instanceof ListingError?error:new ListingError('LISTING_SERVICE_UNAVAILABLE',503);
  return response({ok:false,code:e.code,...(e.fields?{fields:e.fields}:{})},e.status,allowed);
 }
}
