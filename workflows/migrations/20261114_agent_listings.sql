-- Additive agent extension to the existing owner lifecycle. No replacement storage.
begin;
create table dwellhunt_listing_private.agencies (
 id text primary key, name text not null, enabled boolean not null default true
);
create table dwellhunt_listing_private.agent_profiles (
 user_id uuid primary key references auth.users(id), agent_id uuid unique not null default gen_random_uuid(),
 name text not null, email text not null, phone text not null, agency_id text references dwellhunt_listing_private.agencies(id),
 agency_claim text not null default '', verified boolean not null default false, enabled boolean not null default true,
 updated_at timestamptz not null default clock_timestamp()
);
create table dwellhunt_listing_private.agency_memberships (
 user_id uuid not null references auth.users(id),agency_id text not null references dwellhunt_listing_private.agencies(id),
 enabled boolean not null default false, verified_at timestamptz, primary key(user_id,agency_id)
);
alter table dwellhunt_listing_private.listings
 add submitting_agent_id uuid references dwellhunt_listing_private.agent_profiles(agent_id),
 add assigned_agent_id uuid references dwellhunt_listing_private.agent_profiles(agent_id),
 add agency_id text references dwellhunt_listing_private.agencies(id),add property_key text,
 add pending_private jsonb,add pending_public jsonb,add review_status text check(review_status in ('submitted','needs_changes','approved','declined')),
 add review_notes text not null default '';
create index dh_listing_property_key on dwellhunt_listing_private.listings(property_key);
-- Private likely-match flags. Only reviewers can inspect candidate references.
create table dwellhunt_listing_private.duplicate_flags (
 listing_id text not null references dwellhunt_listing_private.listings(id),candidate_id text not null references dwellhunt_listing_private.listings(id),
 primary key(listing_id,candidate_id)
);
create table dwellhunt_listing_private.acceptances (
 id uuid primary key default gen_random_uuid(),listing_id text not null references dwellhunt_listing_private.listings(id),
 actor uuid not null references auth.users(id),request_key uuid not null,action text not null,policy_version text not null,
 confirmations jsonb not null,accepted_at timestamptz not null default clock_timestamp(),unique(actor,request_key)
);
alter table dwellhunt_listing_private.agencies enable row level security;
alter table dwellhunt_listing_private.agent_profiles enable row level security;
alter table dwellhunt_listing_private.agency_memberships enable row level security;
alter table dwellhunt_listing_private.duplicate_flags enable row level security;
alter table dwellhunt_listing_private.acceptances enable row level security;
revoke all on all tables in schema dwellhunt_listing_private from public,anon,authenticated;

create function dwellhunt_listing_private.agent_member(p_actor uuid,p_agency text)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from dwellhunt_listing_private.agency_memberships m join dwellhunt_listing_private.agencies a on a.id=m.agency_id
 where m.user_id=p_actor and m.agency_id=p_agency and m.enabled and m.verified_at is not null and a.enabled);
$$;
create function dwellhunt_listing_private.can_manage(p_actor uuid,r dwellhunt_listing_private.listings)
returns boolean language sql stable set search_path='' as $$
 select case when r.submitting_agent_id is null then r.owner_id=p_actor else exists(
  select 1 from dwellhunt_listing_private.agent_profiles a where a.user_id=p_actor and a.enabled
  and (r.owner_id=p_actor or r.assigned_agent_id=a.agent_id)
  and (r.agency_id is null or dwellhunt_listing_private.agent_member(p_actor,r.agency_id))) end;
$$;
create function dwellhunt_listing_private.agent_eligible(r dwellhunt_listing_private.listings)
returns boolean language sql stable set search_path='' as $$
 select r.submitting_agent_id is null or exists(select 1 from dwellhunt_listing_private.agent_profiles a
 where a.agent_id=r.assigned_agent_id and a.enabled and (r.agency_id is null or dwellhunt_listing_private.agent_member(a.user_id,r.agency_id)));
$$;
create function dwellhunt_listing_private.agent_public(p_public jsonb,p dwellhunt_listing_private.agent_profiles,p_agency text)
returns jsonb language sql stable set search_path='' as $$
 select (p_public - 'agencyId' - 'agentId' - 'ownerId' - 'reviewer' - 'verified' - 'agencyName' - 'agentName') || jsonb_build_object(
  'listingRole','agent','verified',false,'agentName',p.name,
  'agencyName',case when dwellhunt_listing_private.agent_member(p.user_id,p_agency) then (select a.name from dwellhunt_listing_private.agencies a where a.id=p_agency) end,
  'contact',jsonb_build_object('displayName',p.name) ||
   case when p_public->'contact' ? 'email' then jsonb_build_object('email',p.email) else '{}'::jsonb end ||
   case when p_public->'contact' ? 'phone' then jsonb_build_object('phone',p.phone) else '{}'::jsonb end ||
   case when p_public->'contact' ? 'whatsapp' then jsonb_build_object('whatsapp',p.phone) else '{}'::jsonb end);
$$;

-- This RPC is server-role only. The API passes verified Auth identity and email;
-- clients cannot set verification, user IDs, enabled flags or memberships.
create function public.dh_listing_agent_profile(p_actor uuid,p_email text default null,p_profile jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p dwellhunt_listing_private.agent_profiles; agency text;
begin
 if p_actor is null then raise exception 'FORBIDDEN';end if;
 if p_profile is not null then
  if length(trim(coalesce(p_profile->>'name','')))<2 or length(p_profile->>'name')>120 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or coalesce(p_profile->>'phone','') !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'VALIDATION_REQUIRED';end if;
  agency:=nullif(p_profile->>'agencyId','');
  if agency is not null and not dwellhunt_listing_private.agent_member(p_actor,agency) then raise exception 'AGENCY_MEMBERSHIP_REQUIRED';end if;
  select * into p from dwellhunt_listing_private.agent_profiles where user_id=p_actor for update;
  if found and not p.enabled then raise exception 'AGENT_PROFILE_DISABLED';end if;
  insert into dwellhunt_listing_private.agent_profiles(user_id,name,email,phone,agency_id,agency_claim)
   values(p_actor,trim(p_profile->>'name'),lower(p_email),p_profile->>'phone',agency,left(coalesce(p_profile->>'agencyClaim',''),200))
   on conflict(user_id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,agency_id=excluded.agency_id,agency_claim=excluded.agency_claim,updated_at=clock_timestamp();
 end if;
 select * into p from dwellhunt_listing_private.agent_profiles where user_id=p_actor;
 return jsonb_build_object('accountId',p_actor,'profile',case when p.user_id is not null then jsonb_build_object('agentId',p.agent_id,'name',p.name,'email',p.email,'phone',p.phone,
  'agencyId',p.agency_id,'agencyClaim',p.agency_claim,'verified',p.verified,'enabled',p.enabled) end,
  'memberships',(select coalesce(jsonb_agg(jsonb_build_object('agencyId',m.agency_id,'name',a.name)),'[]'::jsonb)
   from dwellhunt_listing_private.agency_memberships m join dwellhunt_listing_private.agencies a on a.id=m.agency_id
   where m.user_id=p_actor and dwellhunt_listing_private.agent_member(p_actor,m.agency_id)));
end;$$;

create or replace function dwellhunt_listing_private.receipt(p dwellhunt_listing_private.listings)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('listingId',p.id,'status',p.status,'reviewStatus',p.review_status,'reviewNotes',p.review_notes,'version',p.version,
  'submittedAt',p.submitted_at,'firstPublishedAt',p.first_published_at,'cycleId',p.cycle_id,'cycleStartedAt',p.cycle_started_at,
  'expiresAt',p.expires_at,'publicationUrl',p.published_url,'synthetic',p.synthetic,'submittingAgentId',p.submitting_agent_id,
  'assignedAgentId',p.assigned_agent_id,'agencyId',p.agency_id);
$$;

create or replace function public.dh_listing_command(
 p_actor uuid,p_action text,p_listing_id text,p_request_key uuid,p_expected_version integer,
 p_payload jsonb,p_public jsonb,p_hash text,p_synthetic boolean default false,p_url text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r dwellhunt_listing_private.listings; prior text; response jsonb; saved dwellhunt_listing_private.requests;
 profile dwellhunt_listing_private.agent_profiles; target dwellhunt_listing_private.agent_profiles; agent_role boolean; property_fingerprint text;
 reviewer boolean; moment timestamptz:=clock_timestamp(); cycle uuid; previous_cycle uuid; confirmation numeric;
begin
 if p_actor is null or p_request_key is null or length(p_hash)<>64 then raise exception 'INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_request_key::text,0));
 select * into saved from dwellhunt_listing_private.requests where actor=p_actor and request_key=p_request_key;
 if found then
  if saved.request_hash<>p_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  select * into r from dwellhunt_listing_private.listings where id=saved.result->>'listingId';
  if r.submitting_agent_id is not null and not dwellhunt_listing_private.can_manage(p_actor,r)
   and not exists(select 1 from dwellhunt_listing_private.reviewers rv where rv.user_id=p_actor and rv.enabled) then raise exception 'FORBIDDEN';end if;
  return saved.result||jsonb_build_object('duplicate',true);
 end if;
 select exists(select 1 from dwellhunt_listing_private.reviewers where user_id=p_actor and enabled) into reviewer;
 select * into profile from dwellhunt_listing_private.agent_profiles where user_id=p_actor and enabled for share;
 if p_action='submit' then
  if coalesce(p_payload->'selection'->>'listingRole','') not in ('owner','agent') or p_payload->'authorized' is distinct from 'true'::jsonb or
    p_payload->'accurate' is distinct from 'true'::jsonb or p_payload->'photoPermission' is distinct from 'true'::jsonb or
    jsonb_typeof(p_public)<>'object' or not (p_payload ? 'id') then raise exception 'VALIDATION_REQUIRED'; end if;
  agent_role:=p_payload->'selection'->>'listingRole'='agent';
  if agent_role and profile.user_id is null then raise exception 'AGENT_PROFILE_REQUIRED';end if;
  if agent_role and profile.agency_id is not null and not dwellhunt_listing_private.agent_member(p_actor,profile.agency_id) then raise exception 'AGENCY_MEMBERSHIP_REQUIRED';end if;
  if agent_role then
   p_public:=dwellhunt_listing_private.agent_public(p_public,profile,profile.agency_id);
   p_payload:=p_payload||jsonb_build_object('ownerName',profile.name,'email',profile.email,'phone',profile.phone,'publicName',profile.name,'publicEmail',profile.email,'publicPhone',profile.phone,'__verifiedOwnerEmail',profile.email);
  end if;
  property_fingerprint:=md5(lower(regexp_replace(concat_ws('|',p_payload->>'district',p_payload->>'city',p_payload->>'street',p_payload->>'building'),'\s+',' ','g')));
  perform pg_advisory_xact_lock(hashtextextended(property_fingerprint,0));
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||(p_payload->>'id'),0));
  select * into r from dwellhunt_listing_private.listings where owner_id=p_actor and client_draft_id=(p_payload->>'id')::uuid for update;
  if found then
   if r.submission_hash<>p_hash then raise exception 'DRAFT_ALREADY_SUBMITTED'; end if;
   response:=dwellhunt_listing_private.receipt(r)||jsonb_build_object('duplicate',true);
  else
   insert into dwellhunt_listing_private.listings(id,owner_id,client_draft_id,status,synthetic,private_payload,public_snapshot,submission_hash)
   values((case when p_synthetic then 'TEST-DHL-' else 'DHL-' end)||gen_random_uuid()::text,p_actor,(p_payload->>'id')::uuid,
    'submitted',p_synthetic,p_payload,p_public,p_hash) returning * into r;
   update dwellhunt_listing_private.listings set submitting_agent_id=case when agent_role then profile.agent_id end,
    assigned_agent_id=case when agent_role then profile.agent_id end,agency_id=case when agent_role then profile.agency_id end,
    property_key=property_fingerprint where id=r.id returning * into r;
   -- Qualified local variable below avoids column ambiguity.
   insert into dwellhunt_listing_private.duplicate_flags(listing_id,candidate_id)
    select r.id,l.id from dwellhunt_listing_private.listings l where l.id<>r.id and l.property_key=property_fingerprint
     and l.status not in ('declined','withdrawn','sold','rented') on conflict do nothing;
   insert into dwellhunt_listing_private.acceptances(listing_id,actor,request_key,action,policy_version,confirmations)
    values(r.id,p_actor,p_request_key,'submit','listing-confirmations-v1',jsonb_build_object('authorized',true,'accurate',true,'photoPermission',true));
   insert into dwellhunt_listing_private.audit(listing_id,actor,action,to_status,version) values(r.id,p_actor::text,'submit',r.status,r.version);
   perform dwellhunt_listing_private.queue_sheet(r.id,r.version);
   response:=dwellhunt_listing_private.receipt(r)||jsonb_build_object('duplicate',false);
  end if;
 else
  select * into r from dwellhunt_listing_private.listings where id=p_listing_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not dwellhunt_listing_private.can_manage(p_actor,r) and not reviewer then raise exception 'FORBIDDEN'; end if;
  if p_expected_version is distinct from r.version then raise exception 'VERSION_CONFLICT'; end if;
  if r.delivery_job_id is not null and p_action not in ('followup','resolve_notification') then raise exception 'DELIVERY_IN_PROGRESS'; end if;
  prior:=r.status; previous_cycle:=r.cycle_id;
  if p_action='resolve_notification' then
   if not reviewer then raise exception 'FORBIDDEN'; end if;
   if r.delivery_job_id is null or r.delivery_job_id::text is distinct from p_payload->>'jobId' or
    p_payload->>'outcome' not in ('Delivered','Suppressed') or length(coalesce(p_payload->>'evidence',''))<10 then raise exception 'DELIVERY_RESOLUTION_REQUIRED';end if;
   update dwellhunt_listing_private.followups set outcome=p_payload->>'outcome',notes='Reviewer reconciliation: '||left(p_payload->>'evidence',1000)
    where job_id=r.delivery_job_id and outcome in ('Uncertain','Dispatching');
   insert into dwellhunt_listing_private.outbox(dedupe_key,kind,listing_id,reference_id)
    select 'followup:'||f.id||':resolved','sheets_followup',r.id,f.id from dwellhunt_listing_private.followups f where f.job_id=r.delivery_job_id on conflict(dedupe_key) do nothing;
   update dwellhunt_listing_private.outbox set state=case when p_payload->>'outcome'='Delivered' then 'done' else 'cancelled' end,
    finished_at=moment where id=r.delivery_job_id and state='uncertain';
   if not found then raise exception 'DELIVERY_RESOLUTION_REQUIRED';end if;r.delivery_job_id:=null;
  elsif p_action in ('approve','needs_changes','decline') then
   if not reviewer or r.owner_id=p_actor or profile.agent_id=r.assigned_agent_id then raise exception 'FORBIDDEN'; end if;
   if coalesce(r.review_status,r.status)<>'submitted' then raise exception 'INVALID_TRANSITION'; end if;
   r.review_notes:=coalesce(p_payload->>'reason','');
   if r.review_status is not null then
    r.review_status:=case p_action when 'approve' then 'approved' when 'decline' then 'declined' else 'needs_changes' end;
   else r.status:=case p_action when 'approve' then 'approved' when 'decline' then 'declined' else 'needs_changes' end;end if;
   if p_action='approve' then r.approved_at:=moment;end if;
  elsif p_action='publish' then
   if not reviewer or r.owner_id=p_actor or profile.agent_id=r.assigned_agent_id then raise exception 'FORBIDDEN'; end if;
   if coalesce(r.review_status,r.status)<>'approved' or p_url is null or p_url !~ '^https://' then raise exception 'INVALID_TRANSITION'; end if;
   if r.review_status='approved' then
    r.private_payload:=r.pending_private;r.public_snapshot:=r.pending_public;
    r.pending_private:=null;r.pending_public:=null;r.review_status:=null;
    if r.expires_at<=moment then r.status:='expired';end if;
   else
   if r.first_published_at is null then
    cycle:=gen_random_uuid();r.cycle_number:=1;r.cycle_id:=cycle;r.cycle_started_at:=moment;
    r.expires_at:=dwellhunt_listing_private.expiry(moment);r.first_published_at:=moment;
    insert into dwellhunt_listing_private.cycles(id,listing_id,number,started_at,expires_at)
    values(cycle,r.id,1,moment,r.expires_at);
   elsif r.expires_at<=moment then raise exception 'RENEWAL_REQUIRED'; end if;
   r.status:='published';
   end if;r.published_url:=p_url;
  elsif p_action='edit' then
   if not dwellhunt_listing_private.can_manage(p_actor,r) then raise exception 'FORBIDDEN'; end if;
   if r.status in ('withdrawn','sold','rented','declined') then raise exception 'INVALID_TRANSITION'; end if;
   if p_payload->'authorized' is distinct from 'true'::jsonb or p_payload->'accurate' is distinct from 'true'::jsonb or p_payload->'photoPermission' is distinct from 'true'::jsonb then raise exception 'VALIDATION_REQUIRED'; end if;
   if (p_payload->>'id')::uuid is distinct from r.client_draft_id then raise exception 'INVALID_DRAFT_ID';end if;
   if p_payload->'selection'->>'listingRole' is distinct from r.private_payload->'selection'->>'listingRole' then raise exception 'INVALID_SELECTION';end if;
   if r.assigned_agent_id is not null then
    select * into target from dwellhunt_listing_private.agent_profiles where agent_id=r.assigned_agent_id;
    p_public:=dwellhunt_listing_private.agent_public(p_public,target,r.agency_id);
    p_payload:=p_payload||jsonb_build_object('publicName',target.name,'publicEmail',target.email,'publicPhone',target.phone);
   end if;
   property_fingerprint:=md5(lower(regexp_replace(concat_ws('|',p_payload->>'district',p_payload->>'city',p_payload->>'street',p_payload->>'building'),'\s+',' ','g')));
   perform pg_advisory_xact_lock(hashtextextended(property_fingerprint,0));r.property_key:=property_fingerprint;
   insert into dwellhunt_listing_private.duplicate_flags(listing_id,candidate_id)
    select r.id,l.id from dwellhunt_listing_private.listings l where l.id<>r.id and l.property_key=property_fingerprint
    and l.status not in ('declined','withdrawn','sold','rented') on conflict do nothing;
   if r.first_published_at is not null then r.pending_private:=p_payload;r.pending_public:=p_public;r.review_status:='submitted';
   else r.private_payload:=p_payload;r.public_snapshot:=p_public;r.status:='submitted';end if;
   r.submission_hash:=p_hash;if r.first_published_at is null then r.approved_at:=null;end if;r.review_notes:='';
   insert into dwellhunt_listing_private.acceptances(listing_id,actor,request_key,action,policy_version,confirmations)
    values(r.id,p_actor,p_request_key,'edit','listing-confirmations-v1',jsonb_build_object('authorized',true,'accurate',true,'photoPermission',true));
  elsif p_action='renew' then
   if not dwellhunt_listing_private.can_manage(p_actor,r) then raise exception 'FORBIDDEN'; end if;
   if r.first_published_at is null or r.status not in ('published','paused','expired','approved') then raise exception 'INVALID_TRANSITION'; end if;
   if p_payload->'priceConfirmed' is distinct from 'true'::jsonb or p_payload->'available' is distinct from 'true'::jsonb or p_payload->'renewalConsent' is distinct from 'true'::jsonb or p_payload->'authorityConfirmed' is distinct from 'true'::jsonb then raise exception 'RENEWAL_CONFIRMATION_REQUIRED'; end if;
   if r.review_status is not null then raise exception 'REVISION_REVIEW_REQUIRED';end if;
   insert into dwellhunt_listing_private.acceptances(listing_id,actor,request_key,action,policy_version,confirmations)
    values(r.id,p_actor,p_request_key,'renew','listing-confirmations-v1',jsonb_build_object('authorityConfirmed',true,'priceConfirmed',true,'available',true));
   confirmation:=(p_payload->>'price')::numeric;
   -- Price changes require a fresh review; renewal cannot silently publish revised facts.
   if confirmation is distinct from (r.private_payload->>'price')::numeric or p_payload->>'currency' is distinct from r.private_payload->>'currency' then raise exception 'PRICE_REVIEW_REQUIRED'; end if;
   cycle:=gen_random_uuid();r.cycle_number:=r.cycle_number+1;r.cycle_id:=cycle;r.cycle_started_at:=moment;
   r.expires_at:=dwellhunt_listing_private.expiry(moment);r.status:='published';r.availability_confirmed_at:=moment;
   insert into dwellhunt_listing_private.cycles(id,listing_id,number,started_at,expires_at,owner_confirmed_at,confirmed_price,owner_actor)
   values(cycle,r.id,r.cycle_number,moment,r.expires_at,moment,confirmation,p_actor);
  elsif p_action='pause' then
   if not dwellhunt_listing_private.can_manage(p_actor,r) or r.status<>'published' then raise exception 'INVALID_TRANSITION'; end if;r.status:='paused';
  elsif p_action='resume' then
   if not dwellhunt_listing_private.can_manage(p_actor,r) or r.status<>'paused' or r.expires_at<=moment then raise exception 'INVALID_TRANSITION'; end if;r.status:='published';
  elsif p_action in ('withdraw','sold','rented') then
   if not dwellhunt_listing_private.can_manage(p_actor,r) then raise exception 'FORBIDDEN'; end if;
   if (p_action='sold' and r.private_payload->'selection'->>'listingPurpose'<>'buy') or (p_action='rented' and r.private_payload->'selection'->>'listingPurpose'<>'rent') then raise exception 'INVALID_TRANSITION';end if;
   r.status:=case p_action when 'withdraw' then 'withdrawn' else p_action end;
  elsif p_action='reassign' then
   if not reviewer or r.owner_id=p_actor or r.submitting_agent_id is null then raise exception 'FORBIDDEN';end if;
   select * into target from dwellhunt_listing_private.agent_profiles where agent_id=(p_payload->>'assignedAgentId')::uuid and enabled for share;
   if not found or (r.agency_id is not null and not dwellhunt_listing_private.agent_member(target.user_id,r.agency_id)) then raise exception 'AGENCY_MEMBERSHIP_REQUIRED';end if;
   if target.user_id=p_actor then raise exception 'FORBIDDEN';end if;
   r.assigned_agent_id:=target.agent_id;r.public_snapshot:=dwellhunt_listing_private.agent_public(r.public_snapshot,target,r.agency_id);
   if r.pending_public is not null then r.pending_public:=dwellhunt_listing_private.agent_public(r.pending_public,target,r.agency_id);end if;
  elsif p_action='followup' then
   if not reviewer then raise exception 'FORBIDDEN'; end if;
   insert into dwellhunt_listing_private.followups(listing_id,cycle_id,reason,channel,actor,outcome,next_followup_at,notes)
   values(r.id,r.cycle_id,p_payload->>'reason',p_payload->>'channel',p_actor::text,p_payload->>'outcome',nullif(p_payload->>'nextFollowupAt','')::timestamptz,coalesce(p_payload->>'notes','')) returning id into cycle;
   insert into dwellhunt_listing_private.outbox(dedupe_key,kind,listing_id,reference_id) values('followup:'||cycle,'sheets_followup',r.id,cycle);
  else raise exception 'INVALID_ACTION'; end if;
  r.version:=r.version+1;r.updated_at:=moment;
  update dwellhunt_listing_private.listings set status=r.status,version=r.version,private_payload=r.private_payload,public_snapshot=r.public_snapshot,
   submission_hash=r.submission_hash,approved_at=r.approved_at,first_published_at=r.first_published_at,published_url=r.published_url,
   cycle_id=r.cycle_id,cycle_number=r.cycle_number,cycle_started_at=r.cycle_started_at,expires_at=r.expires_at,
   availability_confirmed_at=r.availability_confirmed_at,delivery_job_id=r.delivery_job_id,
   assigned_agent_id=r.assigned_agent_id,property_key=r.property_key,pending_private=r.pending_private,pending_public=r.pending_public,review_status=r.review_status,review_notes=r.review_notes,updated_at=moment where id=r.id;
  insert into dwellhunt_listing_private.audit(listing_id,actor,action,from_status,to_status,version,details)
  values(r.id,p_actor::text,p_action,prior,r.status,r.version,jsonb_build_object('assignedAgentId',r.assigned_agent_id,'previousCycle',previous_cycle,'cycleId',r.cycle_id,'reason',left(p_payload->>'reason',2000),
   'notificationJob',case when p_action='resolve_notification' then p_payload->>'jobId' end,
   'resolutionEvidence',case when p_action='resolve_notification' then left(p_payload->>'evidence',1000) end));
  if r.status<>'published' or p_action='renew' then
   update dwellhunt_listing_private.outbox set state='cancelled',finished_at=moment
    where listing_id=r.id and kind='renewal_reminder' and state='pending';
  end if;
  perform dwellhunt_listing_private.queue_sheet(r.id,r.version);
  response:=dwellhunt_listing_private.receipt(r)||jsonb_build_object('duplicate',false);
 end if;
 insert into dwellhunt_listing_private.requests(actor,request_key,request_hash,result) values(p_actor,p_request_key,p_hash,response);
 return response;
end;$$;

create or replace function public.dh_listing_get(p_actor uuid,p_listing_id text default null,p_draft_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r dwellhunt_listing_private.listings; reviewer boolean; manager boolean;
begin
 select exists(select 1 from dwellhunt_listing_private.reviewers where user_id=p_actor and enabled) into reviewer;
 select * into r from dwellhunt_listing_private.listings where (p_listing_id is not null and id=p_listing_id)
  or (p_draft_id is not null and owner_id=p_actor and client_draft_id=p_draft_id);
 if not found then raise exception 'NOT_FOUND';end if;
 manager:=dwellhunt_listing_private.can_manage(p_actor,r);
 if not manager and not reviewer then raise exception 'FORBIDDEN';end if;
 return dwellhunt_listing_private.receipt(r)||jsonb_build_object('draft',coalesce(r.pending_private,r.private_payload),
  'currentPrice',r.private_payload->'price','currentCurrency',r.private_payload->>'currency',
  'editable',manager,'reviewer',reviewer and r.owner_id<>p_actor and not exists(select 1 from dwellhunt_listing_private.agent_profiles a where a.user_id=p_actor and a.agent_id=r.assigned_agent_id),
  'assignedAgent',(select a.name from dwellhunt_listing_private.agent_profiles a where a.agent_id=r.assigned_agent_id),
  'agency',(select a.name from dwellhunt_listing_private.agencies a where a.id=r.agency_id),
  'duplicateCandidates',case when reviewer then (select coalesce(jsonb_agg(d.candidate_id),'[]'::jsonb) from dwellhunt_listing_private.duplicate_flags d where d.listing_id=r.id) else '[]'::jsonb end,
  'history',(select coalesce(jsonb_agg(to_jsonb(a) order by a.at),'[]'::jsonb) from dwellhunt_listing_private.audit a where a.listing_id=r.id));
end;$$;

create function public.dh_listing_dashboard(p_actor uuid,p_offset integer default 0)
returns jsonb language sql security definer stable set search_path='' as $$
 select coalesce(jsonb_agg(dwellhunt_listing_private.receipt(r)||jsonb_build_object(
  'title',r.private_payload->>'title','purpose',r.private_payload->'selection'->>'listingPurpose','category',r.private_payload->'selection'->>'propertyCategory',
  'assignedAgent',(select a.name from dwellhunt_listing_private.agent_profiles a where a.agent_id=r.assigned_agent_id),
  'agency',(select a.name from dwellhunt_listing_private.agencies a where a.id=r.agency_id))), '[]'::jsonb)
 from (select l.* from dwellhunt_listing_private.listings l where
  dwellhunt_listing_private.can_manage(p_actor,l) or exists(select 1 from dwellhunt_listing_private.reviewers rv where rv.user_id=p_actor and rv.enabled)
  order by l.submitted_at desc,l.id limit 50 offset greatest(0,least(coalesce(p_offset,0),100000))) r;
$$;

create or replace function public.dh_listings_public(p_listing_id text default null)
returns jsonb language sql security definer stable set search_path='' as $$
 select coalesce(jsonb_agg(public_snapshot||jsonb_build_object('id',id,'status','published','firstPublishedAt',first_published_at,
  'expiresAt',expires_at,'cycleId',cycle_id,'publicationUrl',published_url,'createdAt',first_published_at,'updatedAt',updated_at)),'[]'::jsonb)
 from dwellhunt_listing_private.listings l where status='published' and not synthetic and first_published_at is not null and expires_at>statement_timestamp()
 and dwellhunt_listing_private.agent_eligible(l) and (p_listing_id is null or id=p_listing_id);
$$;

-- Enquiry/event history for managed listings has no connected writer yet. Do not
-- fabricate records, repurpose booking IDs or copy customers from legacy mock data.
create function public.dh_listing_enquiries(p_actor uuid,p_listing_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.dh_listing_get(p_actor,p_listing_id,null);
 return jsonb_build_object('connected',false,'enquiries','[]'::jsonb,'reason','MANAGED_ENQUIRY_TRACKING_NOT_CONNECTED');
end;$$;

create or replace function public.dh_listing_begin_delivery(p_job uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job dwellhunt_listing_private.outbox;r dwellhunt_listing_private.listings;f dwellhunt_listing_private.followups;d integer;moment timestamptz:=clock_timestamp();
begin
 select * into job from dwellhunt_listing_private.outbox where id=p_job and lease_token=p_lease and state='processing' for update;
 if not found or job.kind<>'renewal_reminder' then raise exception 'LEASE_LOST';end if;
 select * into r from dwellhunt_listing_private.listings where id=job.listing_id for update;
 d:=(job.payload->>'days')::integer;
 if not dwellhunt_listing_private.agent_eligible(r) or r.status<>'published' or r.cycle_id is distinct from job.reference_id or r.expires_at<=moment or r.private_payload->>'renewalEmailConsent' is distinct from 'true'
  or (d=7 and moment>=r.expires_at-interval '2 days') or (d=2 and moment>=r.expires_at-interval '1 day') then return jsonb_build_object('eligible',false);end if;
 if r.delivery_job_id is not null and r.delivery_job_id<>job.id then raise exception 'DELIVERY_IN_PROGRESS';end if;
 update dwellhunt_listing_private.listings set delivery_job_id=job.id where id=r.id;
 insert into dwellhunt_listing_private.followups(listing_id,cycle_id,job_id,attempt_number,reason,channel,actor,outcome)
 values(r.id,r.cycle_id,job.id,job.attempts,'Renewal reminder: '||d||' days','email','system','Dispatching')
 on conflict(job_id,attempt_number) do update set outcome=dwellhunt_listing_private.followups.outcome returning * into f;
 return jsonb_build_object('eligible',true,'attemptId',f.id,'recipient',case when r.assigned_agent_id is not null then (select a.email from dwellhunt_listing_private.agent_profiles a where a.agent_id=r.assigned_agent_id and a.enabled) else r.private_payload->>'__verifiedOwnerEmail' end,
  'listingId',r.id,'title',r.public_snapshot->>'title','expiresAt',r.expires_at,'cycleId',r.cycle_id,'synthetic',r.synthetic,'idempotencyKey',job.dedupe_key);
end;$$;


-- Backfill only the new private match key, preserving all existing records and statuses.
update dwellhunt_listing_private.listings set property_key=md5(lower(regexp_replace(concat_ws('|',private_payload->>'district',private_payload->>'city',private_payload->>'street',private_payload->>'building'),'\s+',' ','g'))) where property_key is null;
revoke all on all functions in schema dwellhunt_listing_private from public,anon,authenticated;
revoke execute on function public.dh_listing_agent_profile(uuid,text,jsonb), public.dh_listing_dashboard(uuid,integer), public.dh_listing_enquiries(uuid,text) from public,anon,authenticated;
grant execute on function public.dh_listing_agent_profile(uuid,text,jsonb), public.dh_listing_dashboard(uuid,integer), public.dh_listing_enquiries(uuid,text) to service_role;
commit;
