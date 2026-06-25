-- Team Management view (A Phase 4): per-salesperson client-book metrics.
create or replace function public.crm_team_performance()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with agg as (
    select p.owner_email,
      count(*) filter (where account_type='client') as clients,
      count(*) filter (where account_type='client' and client_stage='dormant') as dormant,
      count(*) filter (where account_type='client' and client_stage='key_account') as key_accounts,
      count(*) filter (where account_type='prospect') as prospects,
      count(*) filter (where account_type in ('client','converted') and converted_at is not null) as converted,
      coalesce(sum(coalesce(annual_potential, value, expected_value, 0)) filter (where account_type='client'),0) as pipeline_value
    from public.crm_pipeline p where p.owner_email is not null group by p.owner_email
  ),
  fu as (
    select pl.owner_email, count(*) as followups_due
    from public.crm_pipeline_activity a join public.crm_pipeline pl on pl.id = a.pipeline_id
    where a.next_follow_up_date is not null and a.next_follow_up_date <= current_date
      and coalesce(a.status,'open') <> 'completed'
    group by pl.owner_email
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'owner_email', a.owner_email, 'clients', a.clients, 'dormant', a.dormant, 'key_accounts', a.key_accounts,
    'prospects', a.prospects, 'converted', a.converted, 'pipeline_value', a.pipeline_value,
    'followups_due', coalesce(fu.followups_due,0),
    'conversion_rate', case when (a.prospects + a.converted) > 0 then round(a.converted::numeric/(a.prospects+a.converted)*100,1) else 0 end
  ) order by a.clients desc, a.pipeline_value desc), '[]'::jsonb)
  from agg a left join fu on fu.owner_email = a.owner_email;
$function$;
grant execute on function public.crm_team_performance() to authenticated;
