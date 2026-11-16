begin;
create or replace function public.dh_listing_uncertain()
returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(data),'[]'::jsonb) from (
  select jsonb_build_object('jobId',o.id,'key',o.dedupe_key,'attemptId',
   (select f.id from dwellhunt_listing_private.followups f where f.job_id=o.id and f.outcome='Uncertain' order by f.contacted_at desc limit 1)) data
  from dwellhunt_listing_private.outbox o where state='uncertain' and kind='renewal_reminder' order by available_at limit 10
 ) q;
$$;
create or replace function public.dh_listing_reconcile(p_job uuid,p_outcome text,p_receipt text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare job dwellhunt_listing_private.outbox;attempt uuid;
begin
 select * into job from dwellhunt_listing_private.outbox where id=p_job and state='uncertain' for update;
 if not found then return false;end if;
 if p_outcome not in ('Delivered','Not found','Failed') then return false;end if;
 select id into attempt from dwellhunt_listing_private.followups where job_id=p_job and outcome='Uncertain' order by contacted_at desc limit 1;
 if attempt is null then return false;end if;
 perform public.dh_listing_delivery_result(p_job,attempt,case when p_outcome='Delivered' then 'Delivered' else 'Failed' end,p_receipt);
 update dwellhunt_listing_private.outbox set state=case when p_outcome='Delivered' then 'done' else 'pending' end,
  available_at=clock_timestamp()+interval '5 minutes',finished_at=case when p_outcome='Delivered' then clock_timestamp() else null end where id=p_job;
 return true;
end;$$;
revoke execute on function public.dh_listing_uncertain(),public.dh_listing_reconcile(uuid,text,text) from public,anon,authenticated;
grant execute on function public.dh_listing_uncertain(),public.dh_listing_reconcile(uuid,text,text) to service_role;
commit;
