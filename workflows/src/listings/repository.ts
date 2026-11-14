import {ListingError,object} from './validation';
export interface ListingRuntimeConfig {
 LISTINGS_ENABLED?:string; LISTING_SUPABASE_URL?:string; LISTING_SUPABASE_SECRET_KEY?:string;
 LISTING_SUPABASE_PUBLISHABLE_KEY?:string; LISTING_SITE_URL?:string; LISTING_TEST_MODE?:string;
 LISTING_TEST_OWNER_IDS?:string; AGENT_LISTINGS_ENABLED?:string; LISTING_AUTOMATION_ENABLED?:string;
}
export interface VerifiedOwner {id:string;email:string}
export class ListingRepository {
 private fetcher:typeof fetch;
 constructor(private config:ListingRuntimeConfig,fetcher?:typeof fetch){this.fetcher=fetcher||globalThis.fetch.bind(globalThis);}
 private endpoint(path:string){
  const value=this.config.LISTING_SUPABASE_URL;if(!value||!this.config.LISTING_SUPABASE_SECRET_KEY)throw new ListingError('LISTING_STORAGE_NOT_CONFIGURED',503);
  const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new ListingError('LISTING_STORAGE_NOT_CONFIGURED',503);
  return url.origin+path;
 }
 async authenticate(token:string|null):Promise<VerifiedOwner>{
  if(!token?.startsWith('Bearer '))throw new ListingError('SIGN_IN_REQUIRED',401);
  const r=await this.fetcher(this.endpoint('/auth/v1/user'),{headers:{apikey:this.config.LISTING_SUPABASE_PUBLISHABLE_KEY||this.config.LISTING_SUPABASE_SECRET_KEY!,Authorization:token},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new ListingError('SIGN_IN_REQUIRED',401);const user=object(await r.json());
  if(typeof user.id!=='string'||typeof user.email!=='string'||!user.email_confirmed_at||user.is_anonymous===true)throw new ListingError('VERIFIED_OWNER_REQUIRED',403);
  if(this.config.LISTING_TEST_MODE==='true'&&!(this.config.LISTING_TEST_OWNER_IDS||'').split(',').map(s=>s.trim()).includes(user.id))throw new ListingError('APPROVED_TEST_OWNER_REQUIRED',403);
  return {id:user.id,email:user.email};
 }
 async rpc<T>(name:string,args:Record<string,unknown>={}):Promise<T>{
  if(!/^dh_listing[a-z_]*$/.test(name))throw new ListingError('INVALID_RPC',500);
  const key=this.config.LISTING_SUPABASE_SECRET_KEY!;
  let response:Response;
  try{response=await this.fetcher(this.endpoint('/rest/v1/rpc/'+name),{method:'POST',headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});}
  catch(error){const failure=error instanceof Error?error:null,cause=failure?.cause;const providerCode=cause&&typeof cause==='object'&&'code'in cause&&typeof cause.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(cause.code)?cause.code:null;
   console.error(JSON.stringify({event:'listing-rpc-failed',procedure:name,phase:'request',errorType:failure?.name||'unknown',reason:failure?.message.slice(0,160)||'unknown',providerCode}));
   throw new ListingError('LISTING_STORAGE_UNAVAILABLE',503);}
  if(!response.ok){
    let code='LISTING_STORAGE_UNAVAILABLE',providerCode='unknown';try{const error=object(await response.json());const m=String(error.message||'');providerCode=typeof error.code==='string'?error.code:'unknown';const known=['FORBIDDEN','NOT_FOUND','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','DRAFT_ALREADY_SUBMITTED','DELIVERY_IN_PROGRESS','INVALID_TRANSITION','RENEWAL_REQUIRED','PRICE_REVIEW_REQUIRED','RENEWAL_CONFIRMATION_REQUIRED','VALIDATION_REQUIRED','LEASE_LOST','AGENT_PROFILE_REQUIRED','AGENT_PROFILE_DISABLED','AGENCY_MEMBERSHIP_REQUIRED','INVALID_SELECTION','REVISION_REVIEW_REQUIRED'];code=known.find(c=>m===c)||code;}catch{}
    console.error(JSON.stringify({event:'listing-rpc-failed',procedure:name,status:response.status,providerCode}));
    const status=['FORBIDDEN','AGENCY_MEMBERSHIP_REQUIRED','AGENT_PROFILE_DISABLED'].includes(code)?403:code==='NOT_FOUND'?404:code==='LISTING_STORAGE_UNAVAILABLE'?503:409;throw new ListingError(code,status);
  }
  return await response.json() as T;
 }
}
