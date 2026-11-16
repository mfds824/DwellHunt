import {sheetDate} from './policy';
import {object} from './validation';
export const LISTING_FORMULA_COLUMNS=['Expires at','Days remaining','Publication action','Followup action','7-day reminder due','2-day reminder due'];
export const LISTING_STAFF_COLUMNS=['Reviewer','Review notes','Next followup at','Last contacted at','Renewal decision'];
const labels:Record<string,string>={submitted:'Submitted',needs_changes:'Needs changes',approved:'Approved',declined:'Declined',published:'Published',paused:'Paused',expired:'Expired',withdrawn:'Withdrawn',sold:'Sold',rented:'Rented'};
export function listingSheetRecord(value:unknown):Record<string,unknown>{
 const r=object(value),p=object(r.private_payload),selection=object(p.selection);
 // Explicit whitelist: no coordinates, identity documents, tokens, photo metadata,
 // routing secrets, arbitrary payload keys or spreadsheet formula strings.
 const agentFields=selection.listingRole==='agent'?{'Submitting agent ID':r.submitting_agent_id||'','Assigned agent ID':r.assigned_agent_id||'','Agency ID':r.agency_id||'',
  'Lifecycle version':r.version,'Renewal count':Math.max(0,Number(r.cycle_number||0)-1),'Review status':labels[String(r.review_status||r.status)],'Expires at':sheetDate(r.expires_at as string|null)}:{};
 return {...agentFields,'Listing ID':r.id,'Submitted at':sheetDate(String(r.submitted_at)),'Listing title':p.title,
  'Lister role':selection.listingRole,'Purpose':selection.listingPurpose==='buy'?'For sale':'For rent',
  'Category':({apartment:'Apartments & condominiums',villa:'Villas',house:'Luxury houses'} as Record<string,string>)[String(selection.propertyCategory)],
  'City or area':p.city,'Lister name':p.ownerName,'Email':p.email,'Phone':p.phone,
  'Status':labels[String(r.status)],'Approved at':sheetDate(r.approved_at as string|null),
  'First published at':sheetDate(r.first_published_at as string|null),'Cycle started at':sheetDate(r.cycle_started_at as string|null),
  'Availability confirmed at':sheetDate(r.availability_confirmed_at as string|null),'Publication URL':r.published_url||'',
  'Authority confirmed':p.authorized===true,'Facts confirmed':p.accurate===true,'Photo rights confirmed':p.photoPermission===true,
  'Sheet sync status':'Synced','Updated at':sheetDate(String(r.updated_at))};
}
export function followupSheetRecord(value:unknown):Record<string,unknown>{
 const f=object(value);return {'Followup ID':f.id,'Listing ID':f.listing_id,'Contacted at':sheetDate(String(f.contacted_at)),
  'Reason':f.reason,'Channel':f.channel,'Assignee':f.actor,'Outcome':f.outcome,
  'Next followup at':sheetDate(f.next_followup_at as string|null),'Notes':f.notes||''};
}
