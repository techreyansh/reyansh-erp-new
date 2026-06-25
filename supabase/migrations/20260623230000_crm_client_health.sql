-- Client health score (0-100) — Phase 1 of the Client Management redesign.
-- Composite of: order recency, contact recency, overdue payments, open
-- complaints, order frequency. Built on crm_customer_analytics + AR + complaints.
create or replace function public.crm_client_health()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with base as (
    select (e.value->>'client_code') as code, (e.value->>'company_name') as company,
      (e.value->>'owner_email') as owner, coalesce((e.value->>'order_count')::int,0) as order_count,
      coalesce((e.value->>'recency_days')::numeric, 9999) as recency_days,
      coalesce(e.value->>'due_status','') as due_status, coalesce((e.value->>'value_12mo')::numeric,0) as value_12mo
    from jsonb_array_elements(public.crm_customer_analytics()) e
  ),
  ar as (select customer_code, coalesce(sum(balance) filter (where days_past_due>0),0) as overdue_bal
         from public.v_ar_invoices group by customer_code),
  comp as (select customer_code, count(*) as open_complaints from public.crm_complaints
           where lower(coalesce(status,'')) not in ('resolved','closed') group by customer_code),
  scored as (
    select b.*, coalesce(ar.overdue_bal,0) as overdue_bal, coalesce(comp.open_complaints,0) as open_complaints,
      (case b.due_status when 'ok' then 100 when 'new' then 80 when 'due_soon' then 80 when 'due' then 55 when 'overdue' then 25 else 70 end) as s_order,
      (case when b.recency_days<=30 then 100 when b.recency_days<=60 then 75 when b.recency_days<=90 then 50 else 20 end) as s_contact,
      (case when coalesce(ar.overdue_bal,0)<=0 then 100 when ar.overdue_bal<50000 then 70 when ar.overdue_bal<200000 then 45 else 20 end) as s_pay,
      (case when coalesce(comp.open_complaints,0)=0 then 100 when comp.open_complaints=1 then 60 else 30 end) as s_comp,
      (case when b.order_count>=10 then 100 when b.order_count>=5 then 80 when b.order_count>=2 then 60 when b.order_count=1 then 40 else 20 end) as s_freq
    from base b left join ar on ar.customer_code=b.code left join comp on comp.customer_code=b.code
  ),
  final as (
    select *, round(s_order*0.30 + s_contact*0.20 + s_pay*0.20 + s_comp*0.15 + s_freq*0.15) as health from scored
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_code', code, 'company_name', company, 'owner_email', owner, 'health_score', health,
    'band', case when health>=70 then 'green' when health>=40 then 'yellow' else 'red' end,
    'order_count', order_count, 'recency_days', recency_days, 'due_status', due_status,
    'overdue_balance', overdue_bal, 'open_complaints', open_complaints, 'value_12mo', value_12mo,
    'components', jsonb_build_object('order_recency',s_order,'contact',s_contact,'payments',s_pay,'complaints',s_comp,'frequency',s_freq)
  ) order by health asc), '[]'::jsonb) from final;
$function$;
grant execute on function public.crm_client_health() to authenticated;
