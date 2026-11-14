-- Apply to the existing Supabase Postgres database, never to a replacement spreadsheet.
-- Application servers call these RPCs with a server-only service key after verifying Auth.
begin;
create schema if not exists dwellhunt_listing_private;
revoke all on schema dwellhunt_listing_private from public, anon, authenticated;

create table if not exists dwellhunt_listing_private.reviewers (
  user_id uuid primary key references auth.users(id), enabled boolean not null default true
);
create table if not exists dwellhunt_listing_private.listings (
  id text primary key, owner_id uuid not null references auth.users(id), client_draft_id uuid not null,
  status text not null check (status in ('submitted','needs_changes','approved','declined','published','paused','expired','withdrawn','sold','rented')),
  version integer not null default 1, synthetic boolean not null default false,
  private_payload jsonb not null, public_snapshot jsonb not null, submission_hash text not null,
  submitted_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz, first_published_at timestamptz, published_url text,
  cycle_id uuid, cycle_number integer not null default 0, cycle_started_at timestamptz, expires_at timestamptz,
  availability_confirmed_at timestamptz, delivery_job_id uuid,
  unique(owner_id,client_draft_id)
);
create table if not exists dwellhunt_listing_private.cycles (
  id uuid primary key, listing_id text not null references dwellhunt_listing_private.listings(id),
  number integer not null, started_at timestamptz not null, expires_at timestamptz not null,
  owner_confirmed_at timestamptz, confirmed_price numeric, owner_actor uuid references auth.users(id),
  unique(listing_id,number), check(expires_at > started_at)
);
create table if not exists dwellhunt_listing_private.audit (
  id uuid primary key default gen_random_uuid(), listing_id text not null references dwellhunt_listing_private.listings(id),
  actor text not null, action text not null, from_status text, to_status text,
  version integer not null, at timestamptz not null default clock_timestamp(), details jsonb not null default '{}'
);
create table if not exists dwellhunt_listing_private.requests (
  actor uuid not null references auth.users(id), request_key uuid not null, request_hash text not null,
  result jsonb not null, primary key(actor,request_key)
);
create table if not exists dwellhunt_listing_private.outbox (
  id uuid primary key default gen_random_uuid(), dedupe_key text unique not null,
  kind text not null check(kind in ('sheets_listing','sheets_followup','renewal_reminder')),
  listing_id text not null references dwellhunt_listing_private.listings(id), reference_id uuid,
  payload jsonb not null default '{}', state text not null default 'pending' check(state in ('pending','processing','done','cancelled','uncertain')),
  attempts integer not null default 0, available_at timestamptz not null default clock_timestamp(),
  lease_token uuid, leased_until timestamptz, last_error text, finished_at timestamptz
);
create index if not exists dh_listing_outbox_due on dwellhunt_listing_private.outbox(state,available_at);
create index if not exists dh_listing_expiry on dwellhunt_listing_private.listings(status,expires_at);
create table if not exists dwellhunt_listing_private.followups (
  id uuid primary key default gen_random_uuid(), listing_id text not null references dwellhunt_listing_private.listings(id),
  cycle_id uuid, job_id uuid, attempt_number integer, contacted_at timestamptz not null default clock_timestamp(),
  reason text not null, channel text not null, actor text not null, outcome text not null,
  next_followup_at timestamptz, notes text not null default '', provider_receipt text,
  unique(job_id,attempt_number)
);

alter table dwellhunt_listing_private.reviewers enable row level security;
alter table dwellhunt_listing_private.listings enable row level security;
alter table dwellhunt_listing_private.cycles enable row level security;
alter table dwellhunt_listing_private.audit enable row level security;
alter table dwellhunt_listing_private.requests enable row level security;
alter table dwellhunt_listing_private.outbox enable row level security;
alter table dwellhunt_listing_private.followups enable row level security;
revoke all on all tables in schema dwellhunt_listing_private from public,anon,authenticated;

create or replace function dwellhunt_listing_private.expiry(p_start timestamptz)
returns timestamptz language sql immutable set search_path='' as $$
 select ((p_start at time zone 'Asia/Colombo') + interval '1 month') at time zone 'Asia/Colombo';
$$;
create or replace function dwellhunt_listing_private.queue_sheet(p_id text,p_version integer)
returns void language sql set search_path='' as $$
 insert into dwellhunt_listing_private.outbox(dedupe_key,kind,listing_id)
 values('listing:'||p_id||':'||p_version,'sheets_listing',p_id) on conflict(dedupe_key) do nothing;
$$;
create or replace function dwellhunt_listing_private.receipt(p dwellhunt_listing_private.listings)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('listingId',p.id,'status',p.status,'version',p.version,'submittedAt',p.submitted_at,
  'firstPublishedAt',p.first_published_at,'cycleId',p.cycle_id,'cycleStartedAt',p.cycle_started_at,
  'expiresAt',p.expires_at,'publicationUrl',p.published_url,'synthetic',p.synthetic);
$$;

create or replace function public.dh_listing_command(
 p_actor uuid,p_action text,p_listing_id text,p_request_key uuid,p_expected_version integer,
 p_payload jsonb,p_public jsonb,p_hash text,p_synthetic boolean default false,p_url text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r dwellhunt_listing_private.listings; prior text; response jsonb; saved dwellhunt_listing_private.requests;
 reviewer boolean; moment timestamptz:=clock_timestamp(); cycle uuid; previous_cycle uuid; confirmation numeric;
begin
 if p_actor is null or p_request_key is null or length(p_hash)<>64 then raise exception 'INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_request_key::text,0));
 select * into saved from dwellhunt_listing_private.requests where actor=p_actor and request_key=p_request_key;
 if found then
  if saved.request_hash<>p_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return saved.result||jsonb_build_object('duplicate',true);
 end if;
 select exists(select 1 from dwellhunt_listing_private.reviewers where user_id=p_actor and enabled) into reviewer;
 if p_action='submit' then
  if p_payload->'selection'->>'listingRole' is distinct from 'owner' or p_payload->'authorized' is distinct from 'true'::jsonb or
    p_payload->'accurate' is distinct from 'true'::jsonb or p_payload->'photoPermission' is distinct from 'true'::jsonb or
    jsonb_typeof(p_public)<>'object' or not (p_payload ? 'id') then raise exception 'VALIDATION_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||(p_payload->>'id'),0));
  select * into r from dwellhunt_listing_private.listings where owner_id=p_actor and client_draft_id=(p_payload->>'id')::uuid for update;
  if found then
   if r.submission_hash<>p_hash then raise exception 'DRAFT_ALREADY_SUBMITTED'; end if;
   response:=dwellhunt_listing_private.receipt(r)||jsonb_build_object('duplicate',true);
  else
   insert into dwellhunt_listing_private.listings(id,owner_id,client_draft_id,status,synthetic,private_payload,public_snapshot,submission_hash)
   values((case when p_synthetic then 'TEST-DHL-' else 'DHL-' end)||gen_random_uuid()::text,p_actor,(p_payload->>'id')::uuid,
    'submitted',p_synthetic,p_payload,p_public,p_hash) returning * into r;
   insert into dwellhunt_listing_private.audit(listing_id,actor,action,to_status,version) values(r.id,p_actor::text,'submit',r.status,r.version);
   perform dwellhunt_listing_private.queue_sheet(r.id,r.version);
   response:=dwellhunt_listing_private.receipt(r)||jsonb_build_object('duplicate',false);
  end if;
 else
  select * into r from dwellhunt_listing_private.listings where id=p_listing_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.owner_id<>p_actor and not reviewer then raise exception 'FORBIDDEN'; end if;
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
   if not reviewer then raise exception 'FORBIDDEN'; end if;
   if r.status<>'submitted' then raise exception 'INVALID_TRANSITION'; end if;
   r.status:=case p_action when 'approve' then 'approved' when 'decline' then 'declined' else 'needs_changes' end;
   if r.status='approved' then r.approved_at:=moment; end if;
  elsif p_action='publish' then
   if not reviewer then raise exception 'FORBIDDEN'; end if;
   if r.status<>'approved' or p_url is null or p_url !~ '^https://' then raise exception 'INVALID_TRANSITION'; end if;
   if r.first_published_at is null then
    cycle:=gen_random_uuid();r.cycle_number:=1;r.cycle_id:=cycle;r.cycle_started_at:=moment;
    r.expires_at:=dwellhunt_listing_private.expiry(moment);r.first_published_at:=moment;
    insert into dwellhunt_listing_private.cycles(id,listing_id,number,started_at,expires_at)
    values(cycle,r.id,1,moment,r.expires_at);
   elsif r.expires_at<=moment then raise exception 'RENEWAL_REQUIRED'; end if;
   r.status:='published';r.published_url:=p_url;
  elsif p_action='edit' then
   if r.owner_id<>p_actor then raise exception 'FORBIDDEN'; end if;
   if r.status in ('withdrawn','sold','rented','declined') then raise exception 'INVALID_TRANSITION'; end if;
   if p_payload->'authorized' is distinct from 'true'::jsonb or p_payload->'accurate' is distinct from 'true'::jsonb or p_payload->'photoPermission' is distinct from 'true'::jsonb then raise exception 'VALIDATION_REQUIRED'; end if;
   if (p_payload->>'id')::uuid is distinct from r.client_draft_id then raise exception 'INVALID_DRAFT_ID';end if;
   r.private_payload:=p_payload;r.public_snapshot:=p_public;r.submission_hash:=p_hash;r.status:='submitted';r.approved_at:=null;
  elsif p_action='renew' then
   if r.owner_id<>p_actor then raise exception 'FORBIDDEN'; end if;
   if r.first_published_at is null or r.status not in ('published','paused','expired','approved') then raise exception 'INVALID_TRANSITION'; end if;
   if p_payload->'priceConfirmed' is distinct from 'true'::jsonb or p_payload->'available' is distinct from 'true'::jsonb or p_payload->'renewalConsent' is distinct from 'true'::jsonb then raise exception 'RENEWAL_CONFIRMATION_REQUIRED'; end if;
   confirmation:=(p_payload->>'price')::numeric;
   -- Price changes require a fresh review; renewal cannot silently publish revised facts.
   if confirmation is distinct from (r.private_payload->>'price')::numeric or p_payload->>'currency' is distinct from r.private_payload->>'currency' then raise exception 'PRICE_REVIEW_REQUIRED'; end if;
   cycle:=gen_random_uuid();r.cycle_number:=r.cycle_number+1;r.cycle_id:=cycle;r.cycle_started_at:=moment;
   r.expires_at:=dwellhunt_listing_private.expiry(moment);r.status:='published';r.availability_confirmed_at:=moment;
   insert into dwellhunt_listing_private.cycles(id,listing_id,number,started_at,expires_at,owner_confirmed_at,confirmed_price,owner_actor)
   values(cycle,r.id,r.cycle_number,moment,r.expires_at,moment,confirmation,p_actor);
  elsif p_action='pause' then
   if r.owner_id<>p_actor or r.status<>'published' then raise exception 'INVALID_TRANSITION'; end if;r.status:='paused';
  elsif p_action='resume' then
   if r.owner_id<>p_actor or r.status<>'paused' or r.expires_at<=moment then raise exception 'INVALID_TRANSITION'; end if;r.status:='published';
  elsif p_action in ('withdraw','sold','rented') then
   if r.owner_id<>p_actor then raise exception 'FORBIDDEN'; end if;
   r.status:=case p_action when 'withdraw' then 'withdrawn' else p_action end;
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
   availability_confirmed_at=r.availability_confirmed_at,delivery_job_id=r.delivery_job_id,updated_at=moment where id=r.id;
  insert into dwellhunt_listing_private.audit(listing_id,actor,action,from_status,to_status,version,details)
  values(r.id,p_actor::text,p_action,prior,r.status,r.version,jsonb_build_object('previousCycle',previous_cycle,'cycleId',r.cycle_id,'reason',left(p_payload->>'reason',2000),
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
declare r dwellhunt_listing_private.listings; reviewer boolean;
begin
 select exists(select 1 from dwellhunt_listing_private.reviewers where user_id=p_actor and enabled) into reviewer;
 select * into r from dwellhunt_listing_private.listings where (p_listing_id is not null and id=p_listing_id)
  or (p_draft_id is not null and owner_id=p_actor and client_draft_id=p_draft_id);
 if not found then raise exception 'NOT_FOUND'; end if;
 if r.owner_id<>p_actor and not reviewer then raise exception 'FORBIDDEN'; end if;
 return dwellhunt_listing_private.receipt(r)||jsonb_build_object('draft',r.private_payload,'reviewer',reviewer,
  'history',(select coalesce(jsonb_agg(to_jsonb(a) order by a.at),'[]'::jsonb) from dwellhunt_listing_private.audit a where a.listing_id=r.id));
end;$$;

create or replace function public.dh_listings_public(p_listing_id text default null)
returns jsonb language sql security definer stable set search_path='' as $$
 select coalesce(jsonb_agg(public_snapshot||jsonb_build_object('id',id,'status','published','firstPublishedAt',first_published_at,
  'expiresAt',expires_at,'cycleId',cycle_id,'publicationUrl',published_url,'createdAt',first_published_at,'updatedAt',updated_at)),'[]'::jsonb)
 from dwellhunt_listing_private.listings where status='published' and not synthetic and first_published_at is not null and expires_at>statement_timestamp()
 and (p_listing_id is null or id=p_listing_id);
$$;

create or replace function public.dh_listing_tick()
returns jsonb language plpgsql security definer set search_path='' as $$
declare r dwellhunt_listing_private.listings; moment timestamptz:=clock_timestamp(); d integer; expired_count integer:=0;
begin
 for r in select * from dwellhunt_listing_private.listings where status in ('published','paused') and expires_at<=moment for update skip locked loop
  update dwellhunt_listing_private.listings set status='expired',version=version+1,updated_at=moment where id=r.id and cycle_id=r.cycle_id;
  insert into dwellhunt_listing_private.audit(listing_id,actor,action,from_status,to_status,version,details)
  values(r.id,'system','expire',r.status,'expired',r.version+1,jsonb_build_object('cycleId',r.cycle_id));
  update dwellhunt_listing_private.outbox set state='cancelled',finished_at=moment where listing_id=r.id and kind='renewal_reminder' and state='pending';
  perform dwellhunt_listing_private.queue_sheet(r.id,r.version+1);expired_count:=expired_count+1;
 end loop;
 for r in select * from dwellhunt_listing_private.listings where status='published' and expires_at>moment
  and private_payload->>'renewalEmailConsent'='true' for update skip locked loop
  d:=case when moment>=r.expires_at-interval '2 days' and moment<r.expires_at-interval '1 day' then 2
   when moment>=r.expires_at-interval '7 days' and moment<r.expires_at-interval '2 days' then 7 else null end;
  if d is not null then
   insert into dwellhunt_listing_private.outbox(dedupe_key,kind,listing_id,reference_id,payload)
   values('renewal:'||r.id||':'||r.cycle_id||':'||d,'renewal_reminder',r.id,r.cycle_id,jsonb_build_object('days',d)) on conflict(dedupe_key) do nothing;
  end if;
 end loop;
 return jsonb_build_object('expired',expired_count);
end;$$;

create or replace function public.dh_listing_claim(p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path='' as $$
declare output jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('dwellhunt-listing-outbox',0));
 -- A process can die after acquiring the delivery guard and before recording its
 -- provider result. Recover it by receipt lookup, never by re-dispatching a stale job.
 update dwellhunt_listing_private.followups f set outcome='Uncertain'
 where f.outcome='Dispatching' and exists(select 1 from dwellhunt_listing_private.outbox o
  join dwellhunt_listing_private.listings l on l.delivery_job_id=o.id
  where o.id=f.job_id and o.kind='renewal_reminder' and o.state='processing' and o.leased_until<clock_timestamp());
 update dwellhunt_listing_private.outbox o set state='uncertain',last_error='DELIVERY_PROCESS_INTERRUPTED',leased_until=null
 where o.kind='renewal_reminder' and o.state='processing' and o.leased_until<clock_timestamp()
  and exists(select 1 from dwellhunt_listing_private.listings l where l.delivery_job_id=o.id);
 if exists(select 1 from dwellhunt_listing_private.outbox where state='processing' and leased_until>clock_timestamp()) then return '[]'::jsonb;end if;
 with eligible as (select id from dwellhunt_listing_private.outbox where available_at<=clock_timestamp() and
  (state='pending' or (state='processing' and leased_until<clock_timestamp())) order by available_at limit least(p_limit,1) for update skip locked),
 changed as (update dwellhunt_listing_private.outbox o set state='processing',attempts=attempts+1,
  lease_token=gen_random_uuid(),leased_until=clock_timestamp()+interval '2 minutes' from eligible e where o.id=e.id returning o.*)
 select coalesce(jsonb_agg(to_jsonb(changed)),'[]'::jsonb) into output from changed;
 return output;
end;$$;

create or replace function public.dh_listing_job_data(p_job uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job dwellhunt_listing_private.outbox; r dwellhunt_listing_private.listings; f dwellhunt_listing_private.followups;
begin
 select * into job from dwellhunt_listing_private.outbox where id=p_job and lease_token=p_lease and state='processing';
 if not found then raise exception 'LEASE_LOST'; end if;
 select * into r from dwellhunt_listing_private.listings where id=job.listing_id;
 if job.kind='sheets_followup' then select * into f from dwellhunt_listing_private.followups where id=job.reference_id;end if;
 return jsonb_build_object('job',to_jsonb(job),'listing',to_jsonb(r),'followup',to_jsonb(f));
end;$$;

create or replace function public.dh_listing_finish_job(p_job uuid,p_lease uuid,p_outcome text,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update dwellhunt_listing_private.outbox set state=case p_outcome when 'done' then 'done' when 'cancelled' then 'cancelled' when 'uncertain' then 'uncertain' else 'pending' end,
  finished_at=case when p_outcome in ('done','cancelled','uncertain') then clock_timestamp() else null end,
  available_at=clock_timestamp()+least(interval '6 hours',interval '30 seconds'*power(2,least(attempts,9))),
  last_error=left(p_error,200),leased_until=null
 where id=p_job and lease_token=p_lease and state='processing';return found;
end;$$;

-- A delivery guard serializes renewal/withdrawal with dispatch. Unknown provider outcomes
-- retain the guard until a receipt lookup resolves them: never blindly resend a message.
create or replace function public.dh_listing_begin_delivery(p_job uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job dwellhunt_listing_private.outbox;r dwellhunt_listing_private.listings;f dwellhunt_listing_private.followups;d integer;moment timestamptz:=clock_timestamp();
begin
 select * into job from dwellhunt_listing_private.outbox where id=p_job and lease_token=p_lease and state='processing' for update;
 if not found or job.kind<>'renewal_reminder' then raise exception 'LEASE_LOST';end if;
 select * into r from dwellhunt_listing_private.listings where id=job.listing_id for update;
 d:=(job.payload->>'days')::integer;
 if r.status<>'published' or r.cycle_id is distinct from job.reference_id or r.expires_at<=moment or r.private_payload->>'renewalEmailConsent' is distinct from 'true'
  or (d=7 and moment>=r.expires_at-interval '2 days') or (d=2 and moment>=r.expires_at-interval '1 day') then return jsonb_build_object('eligible',false);end if;
 if r.delivery_job_id is not null and r.delivery_job_id<>job.id then raise exception 'DELIVERY_IN_PROGRESS';end if;
 update dwellhunt_listing_private.listings set delivery_job_id=job.id where id=r.id;
 insert into dwellhunt_listing_private.followups(listing_id,cycle_id,job_id,attempt_number,reason,channel,actor,outcome)
 values(r.id,r.cycle_id,job.id,job.attempts,'Renewal reminder: '||d||' days','email','system','Dispatching')
 on conflict(job_id,attempt_number) do update set outcome=dwellhunt_listing_private.followups.outcome returning * into f;
 return jsonb_build_object('eligible',true,'attemptId',f.id,'recipient',r.private_payload->>'__verifiedOwnerEmail',
  'listingId',r.id,'title',r.public_snapshot->>'title','expiresAt',r.expires_at,'cycleId',r.cycle_id,'synthetic',r.synthetic,'idempotencyKey',job.dedupe_key);
end;$$;

create or replace function public.dh_listing_delivery_result(p_job uuid,p_attempt uuid,p_outcome text,p_receipt text default null)
returns void language plpgsql security definer set search_path='' as $$
declare f dwellhunt_listing_private.followups;
begin
 if p_outcome not in ('Delivered','Failed','Uncertain','Suppressed') then raise exception 'INVALID_OUTCOME';end if;
 update dwellhunt_listing_private.followups set outcome=p_outcome,provider_receipt=p_receipt,
  next_followup_at=case when p_outcome='Failed' then clock_timestamp()+interval '5 minutes' else null end
 where id=p_attempt and job_id=p_job returning * into f;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_outcome<>'Uncertain' then update dwellhunt_listing_private.listings set delivery_job_id=null where id=f.listing_id and delivery_job_id=p_job;end if;
 insert into dwellhunt_listing_private.outbox(dedupe_key,kind,listing_id,reference_id)
 values('followup:'||f.id||':'||p_outcome,'sheets_followup',f.listing_id,f.id) on conflict(dedupe_key) do nothing;
end;$$;

revoke all on all functions in schema dwellhunt_listing_private from public,anon,authenticated;
revoke execute on function public.dh_listing_command(uuid,text,text,uuid,integer,jsonb,jsonb,text,boolean,text),
 public.dh_listing_get(uuid,text,uuid),public.dh_listings_public(text),public.dh_listing_tick(),public.dh_listing_claim(integer),
 public.dh_listing_job_data(uuid,uuid),public.dh_listing_finish_job(uuid,uuid,text,text),public.dh_listing_begin_delivery(uuid,uuid),
 public.dh_listing_delivery_result(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.dh_listing_command(uuid,text,text,uuid,integer,jsonb,jsonb,text,boolean,text),
 public.dh_listing_get(uuid,text,uuid),public.dh_listings_public(text),public.dh_listing_tick(),public.dh_listing_claim(integer),
 public.dh_listing_job_data(uuid,uuid),public.dh_listing_finish_job(uuid,uuid,text,text),public.dh_listing_begin_delivery(uuid,uuid),
 public.dh_listing_delivery_result(uuid,uuid,text,text) to service_role;
-- Public reads go through the API too, so expiry and site policy have one authoritative gate.
commit;
