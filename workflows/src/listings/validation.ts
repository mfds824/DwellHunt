import {createOwnerDraft,validateOwnerDraft,type OwnerDraft} from '../../website/owner-listing-model.js';
import {ownerListingAdapter} from '../../website/listing-adapter.js';
import {UUID} from './policy';
export class ListingError extends Error { constructor(public code:string,public status=400,public fields?:Record<string,string>){super(code);} }
export function object(value:unknown):Record<string,unknown>{
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new ListingError('INVALID_REQUEST');
  return value as Record<string,unknown>;
}
export function prepareSubmission(value:unknown,verifiedEmail:string):{draft:OwnerDraft;publicSnapshot:Record<string,unknown>}{
  const input=object(value),selection=object(input.selection);
  if(!['owner','agent'].includes(String(selection.listingRole))||!['buy','rent'].includes(String(selection.listingPurpose))||!['apartment','villa','house'].includes(String(selection.propertyCategory)))throw new ListingError('INVALID_SELECTION');
  if(typeof input.id!=='string'||!UUID.test(input.id))throw new ListingError('INVALID_DRAFT_ID');
  const draft=createOwnerDraft({listingRole:String(selection.listingRole),listingPurpose:String(selection.listingPurpose),propertyCategory:String(selection.propertyCategory)});
  // Allowlist the existing form schema. Uploaded identity files, client identities,
  // timestamps, review decisions, API keys and status fields cannot be supplied here.
  for(const [key,defaultValue] of Object.entries(draft)){
    if(key.startsWith('submission')||['selection','privateLocation','photos','floorPlan','nearby','id','status','version','step','deviceSavingEnabled','priceInput','draftAccountId'].includes(key))continue;
    const v=input[key];
    if(typeof defaultValue==='string'&&typeof v==='string'){
      if(v.length>(key==='description'?20000:2000))throw new ListingError('FIELD_TOO_LONG',400,{[key]:'This field is too long.'});draft[key]=v.trim();
    }else if(typeof defaultValue==='boolean'&&typeof v==='boolean')draft[key]=v;
    else if(Array.isArray(defaultValue)&&Array.isArray(v)){
      if(v.length>50||v.some(s=>typeof s!=='string'||s.length>200))throw new ListingError('INVALID_FIELD',400,{[key]:'Choose valid options.'});draft[key]=v;
    }
  }
  draft.id=input.id;draft.renewalEmailConsent=input.renewalEmailConsent===true;draft.__verifiedOwnerEmail=verifiedEmail;
  // Device persistence stores a numeric price; live edits use a decimal string.
  if(typeof input.price==='number'&&Number.isFinite(input.price))draft.price=String(input.price);
  // Existing released forms do not yet include the separately reviewed map picker.
  // Coordinates are optional, but a supplied position must be explicitly confirmed.
  if(input.privateLocation!==undefined){const point=object(input.privateLocation);draft.privateLocation={lat:point.lat,lng:point.lng,confirmed:point.confirmed===true};}
  const photo=(v:unknown)=>{const p=object(v);if(typeof p.url!=='string'||!/^https:\/\/res\.cloudinary\.com\//.test(p.url)||p.url.length>2000||p.status!=='ready')throw new ListingError('INVALID_PHOTO');return {id:String(p.id||crypto.randomUUID()),url:p.url,status:'ready',kind:'photo',name:'',publicId:''};};
  if(!Array.isArray(input.photos)||input.photos.length>8)throw new ListingError('PHOTO_LIMIT',400,{photos:'You can upload up to 8 photos'});
  draft.photos=input.photos.map(photo);draft.floorPlan=input.floorPlan?{...photo(input.floorPlan),kind:'floorPlan'}:null;
  if((draft.publicMethods as string[]).some(x=>!['email','phone','whatsapp'].includes(x)))throw new ListingError('INVALID_CONTACT_METHOD');
  const errors=validateOwnerDraft(draft,true).reduce<Record<string,string>>((all,s)=>({...all,...s.errors}),{});
  if(input.privateLocation===undefined)delete errors.privateLocation;
  if(Object.keys(errors).length)throw new ListingError('VALIDATION_REQUIRED',400,errors);
  // Provider nearby data is intentionally excluded until a trusted server maps adapter exists.
  draft.nearby=null;
  if(selection.listingRole==='agent' && (!draft.privateLocation || (draft.privateLocation as Record<string,unknown>).confirmed!==true))throw new ListingError('VALIDATION_REQUIRED',400,{privateLocation:'Confirm the precise property location.'});
  const publicSnapshot=ownerListingAdapter(draft,'published');
  // Lifecycle fields are supplied only from the canonical database record.
  delete publicSnapshot.status;delete publicSnapshot.id;
  return {draft,publicSnapshot};
}
