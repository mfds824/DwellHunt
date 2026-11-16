import { createOwnerListing } from './owner-listing.js';
import { createOwnerDraft, loadOwnerDraft, CATEGORY_LABELS } from './owner-listing-model.js';
import { createListingSubmission } from './listing-submission.js';
import { listingService } from './listing-service.js';
import { COUNTRY_CODES } from './country-calling-codes.js';

export const LISTING_STATUS_LABELS = Object.freeze({ draft:'Draft',submitted:'Pending review',needs_changes:'Changes requested',declined:'Rejected',approved:'Approved',published:'Published',paused:'Paused',expired:'Expired',withdrawn:'Withdrawn',sold:'Sold',rented:'Let' });
export function prefillAgentDraft(draft, profile, accountId) {
  const next = {...draft, selection:{...draft.selection, listingRole:'agent'}, draftAccountId:accountId};
  const code = [...new Set(COUNTRY_CODES.map(c => c.code))].sort((a,b) => b.length-a.length).find(c => profile.phone.startsWith(c)) || '';
  const countries = COUNTRY_CODES.filter(c => c.code===code);
  const defaults = {ownerName:profile.name,email:profile.email,phone:profile.phone,countryCode:code,phoneNumber:profile.phone.slice(code.length),phoneCountry:countries.length===1?countries[0].iso:'manual',preferredContact:'email',
    publicName:profile.name,publicEmail:profile.email,publicPhone:profile.phone,publicCountryCode:code,publicPhoneNumber:profile.phone.slice(code.length),publicPhoneCountry:countries.length===1?countries[0].iso:'manual',enquiryDestination:profile.email};
  for (const [key,value] of Object.entries(defaults)) if (!next[key] || (['countryCode','phoneCountry','publicCountryCode','publicPhoneCountry'].includes(key) && !draft.phoneNumber && !draft.publicPhoneNumber)) next[key]=value;
  if (!next.publicMethods.length) next.publicMethods=['email'];
  return next;
}
export function createAgentListing(React, options = {}, service = listingService) {
  const h=React.createElement, SharedForm=createOwnerListing(React,{...options,service}), SignIn=createListingSubmission(React,service);
  const primary='px-6 py-3 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-xs disabled:opacity-40';
  const secondary='px-5 py-2.5 rounded-xl border border-stone-200 text-xs font-bold text-stone-700 hover:bg-stone-50 disabled:opacity-40';
  const inputClass='w-full px-4 py-3 rounded-xl bg-stone-50 border border-stone-200 text-sm text-stone-900';
  return function AgentListing({selection,onStart}) {
    const [account,setAccount]=React.useState(service.account?.() || null),[profile,setProfile]=React.useState(null),[memberships,setMemberships]=React.useState([]);
    const [identityReady,setIdentityReady]=React.useState(false);
    const [previewRequested,setPreviewRequested]=React.useState(false);
    const [page,setPage]=React.useState('profile'),[draft,setDraft]=React.useState(null),[record,setRecord]=React.useState(null),[listings,setListings]=React.useState([]);
    const [offset,setOffset]=React.useState(0),[message,setMessage]=React.useState(''),[busy,setBusy]=React.useState(false);
    const [name,setName]=React.useState(''),[phone,setPhone]=React.useState(''),[agencyId,setAgencyId]=React.useState(''),[agencyClaim,setAgencyClaim]=React.useState('');
    const session=React.useRef(account?.id);session.current=account?.id;
    const authDraft=React.useMemo(()=>createOwnerDraft({...selection,listingRole:'agent'}),[]);
    React.useEffect(()=>service.subscribe?.(()=>{
      const current=service.account();
      if(current?.id!==session.current){setIdentityReady(false);setDraft(null);setRecord(null);setProfile(null);setListings([]);setMemberships([]);setName('');setPhone('');setAgencyId('');setAgencyClaim('');setPage('profile');}
      setAccount(current);
    }),[]);
    const run=async fn=>{if(busy)return;setBusy(true);setMessage('');const actor=service.account?.()?.id;try{await fn(actor);}catch(error){
      setMessage(({FORBIDDEN:'You do not have access to this listing.',AGENCY_MEMBERSHIP_REQUIRED:'This agency membership is not verified or has been revoked. Choose independent agent or contact the reviewer.',AGENT_PROFILE_DISABLED:'This agent profile is disabled.',VALIDATION_REQUIRED:'Enter your name and an international contact number.',AGENT_WORKFLOW_NOT_ACTIVE:'Agent submissions are not activated in this environment.'})[error.code] || 'The request could not be confirmed. Your current draft is retained. Refresh before retrying.');
    }finally{setBusy(false);if(!service.signedIn()){setAccount(null);setDraft(null);setRecord(null);}}};
    const load=()=>run(async actor=>{const data=await service.agentProfile();if(service.account()?.id!==actor)return;setAccount(service.account());setProfile(data.profile);setMemberships(data.memberships || []);setName(data.profile?.name||'');setPhone(data.profile?.phone||'');setAgencyId(data.profile?.agencyId||'');setAgencyClaim(data.profile?.agencyClaim||'');setIdentityReady(true);setPage(data.profile?'dashboard':'profile');if(data.profile){const list=await service.dashboard(0);if(service.account()?.id===actor){setListings(list.listings);setOffset(0);}}});
    React.useEffect(()=>{ if(account?.id) load(); },[account?.id]);
    const refresh=(next=offset)=>run(async actor=>{const list=await service.dashboard(next);if(service.account()?.id!==actor)return;setListings(list.listings);setOffset(next);});
    const begin=(saved=null,loaded=null,preview=false)=>{const current=service.account();if(!current || !profile)return;let d=saved || createOwnerDraft({...selection,listingRole:'agent'});d=prefillAgentDraft(d,profile,current.id);setDraft(d);setRecord(loaded);setPreviewRequested(preview);setPage('form');};
    const edit=(r,preview=false)=>run(async actor=>{const result=await service.get(r.listingId);if(service.account()?.id!==actor)return;begin({...result.listing.draft,submissionListingId:r.listingId},result.listing,preview);});
    const button=(label,onClick,main=false,disabled=false)=>h('button',{type:'button',onClick,className:main?primary:secondary,disabled:busy||disabled},label);
    const field=(id,label,value,change,extra={})=>h('div',null,h('label',{htmlFor:id,className:'block text-xs font-bold text-stone-700 mb-2'},label),h('input',{id,value,onChange:e=>change(e.target.value),className:inputClass,...extra}));
    const layout=body=>h('section',{className:'dh-owner py-12 bg-stone-50 min-h-screen'},h('div',{className:'max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6',style:{overflowWrap:'anywhere'}},
      h('h1',{className:'text-3xl font-black text-stone-900'},'Agent listings'),h('p',{className:'text-sm text-stone-600'},'Your profile, properties and review progress.'),button('Back to listing choices',onStart),body,message&&h('p',{role:'status',className:'dh-owner-note'},message)));
    if(!service.ready || !service.agentReady)return layout(h('p',{className:'dh-owner-note'},'Secure agent onboarding and management are not activated in this environment. The owner workflow and existing website remain available. No agent listing has been submitted or published.'));
    if(!account)return layout(h(SignIn,{draft:authDraft,onDraftChange:()=>{},authenticationOnly:true}));
    if(!identityReady)return layout(h(React.Fragment,null,h('p',{role:'status',className:'dh-owner-note'},'Loading your agent profile…'),button('Retry profile connection',load)));
    if(page==='form' && draft)return h(SharedForm,{key:account.id+':'+draft.id,draft,selection:draft.selection,accountId:account.id,initialRecord:record,startPreview:previewRequested,
      onDraftChange:update=>{if(service.account()?.id===account.id)setDraft(old=>typeof update==='function'?update(old):update);},onSelectionRestore:()=>{},onStart:()=>setPage('dashboard'),onDashboard:()=>{setPage('dashboard');refresh(0);}});
    if(page==='manage' && record)return layout(h(React.Fragment,null,button('Back to dashboard',()=>{setPage('dashboard');refresh(0);}),button('Edit or respond to corrections',()=>edit(record),false,record.editable===false),
      h(SignIn,{key:record.listingId,draft:prefillAgentDraft({...record.draft,submissionListingId:record.listingId},profile,account.id),initialRecord:record,management:true,onDraftChange:()=>{}}),
      h('p',{className:'dh-owner-note'},'Managed-listing enquiry tracking and virtual-viewing requests are not connected. Existing bookings keep their original routing and history.')));
    if(page==='profile')return layout(h('form',{className:'bg-white rounded-3xl p-6 border border-stone-200 space-y-5',onSubmit:e=>{e.preventDefault();run(async actor=>{const data=await service.saveAgentProfile({name,phone,agencyId,agencyClaim});if(service.account()?.id!==actor)return;setProfile(data.profile);setMemberships(data.memberships||[]);setPage('dashboard');const list=await service.dashboard(0);if(service.account()?.id===actor){setListings(list.listings);setOffset(0);}});}},
      field('dh-agent-name','Agent name',name,setName,{required:true,maxLength:120}),field('dh-agent-email','Verified professional email',account.email,()=>{},{readOnly:true,type:'email'}),field('dh-agent-phone','WhatsApp / contact number',phone,setPhone,{required:true,type:'tel',placeholder:'+94771234567',pattern:'\\+[1-9][0-9]{7,14}'}),
      h('label',{className:'block text-xs font-bold text-stone-700'},'Agency affiliation',h('select',{className:inputClass,value:agencyId,onChange:e=>setAgencyId(e.target.value),'aria-label':'Agency affiliation'},h('option',{value:''},'Independent agent'),memberships.map(m=>h('option',{key:m.agencyId,value:m.agencyId},m.name)))),
      field('dh-agent-claim','Unverified agency claim (optional)',agencyClaim,setAgencyClaim,{maxLength:200}),h('p',{className:'dh-owner-hint'},'Typing an agency name does not grant membership. Only trusted, current memberships can be selected or shown publicly. Your professional email is the verified sign-in email.'),
      profile&&h('p',null,`Existing verification status: ${profile.verified?'verified':'unverified'}.`),h('button',{type:'submit',className:primary,disabled:busy},'Save agent profile'),profile&&button('Cancel',()=>setPage('dashboard'))));
    return layout(h(React.Fragment,null,
      h('div',{className:'dh-owner-edit-links'},button('Edit agent profile',()=>setPage('profile')),button('Create listing',()=>begin(),true),
        button('Continue saved draft',()=>{try{const saved=loadOwnerDraft(localStorage,{role:'agent',accountId:account.id});if(saved)begin(saved.draft);else setMessage('No saved draft for this signed-in account.');}catch{setMessage('The saved draft could not be read. No other account draft was opened.');}}),button('Refresh listings',()=>refresh()),button('Sign out',()=>service.signOut())),
      h('p',{className:'dh-owner-hint'},'Agent drafts are separate from owner drafts and are scoped to the signed-in account. Device copies remain readable to anyone with access to this browser; save only on a trusted device.'),
      !listings.length&&h('p',{className:'dh-owner-note'},'No authorised listings on this page. Create a listing or continue your draft.'),
      ...listings.map(r=>h('article',{key:r.listingId,className:'bg-white rounded-3xl p-6 border border-stone-200 space-y-3'},
        h('h2',{className:'text-lg font-bold'},r.title),h('p',{className:'text-xs text-stone-500'},r.listingId),h('p',null,`${r.purpose==='buy'?'Sale':'Rental'} · ${CATEGORY_LABELS[r.category]||r.category} · ${LISTING_STATUS_LABELS[r.status]||r.status}`),
        r.reviewStatus&&h('p',null,'Revision: '+(LISTING_STATUS_LABELS[r.reviewStatus]||r.reviewStatus)),r.reviewNotes&&h('p',{className:'dh-owner-note'},r.reviewNotes),
        h('p',null,`Assigned agent: ${r.assignedAgent||'Not assigned'} · Agency: ${r.agency||'Independent'}`),h('p',null,`Published: ${r.firstPublishedAt?new Date(r.firstPublishedAt).toLocaleString('en-GB',{timeZone:'Asia/Colombo'}):'Not published'} · Expires: ${r.expiresAt?new Date(r.expiresAt).toLocaleString('en-GB',{timeZone:'Asia/Colombo'}):'Not started'}`),
        button('Manage listing',()=>run(async actor=>{const result=await service.get(r.listingId);if(service.account()?.id!==actor)return;setRecord(result.listing);setPage('manage');})),button('Preview listing',()=>edit(r,true)),!['withdrawn','sold','rented','declined'].includes(r.status)&&button('Edit / correct listing',()=>edit(r)),
        r.publicationUrl&&h('a',{href:r.publicationUrl,className:'text-emerald-900 underline'},'Public preview'))),
      h('div',{className:'dh-owner-edit-links'},button('Previous page',()=>refresh(Math.max(0,offset-50)),false,offset===0),button('Next page',()=>refresh(offset+50),false,listings.length<50))));
  };
}
