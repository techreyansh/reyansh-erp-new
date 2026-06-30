-- NPD Intelligence: one analytics RPC over the New Product Development module
-- (npd_project + npd_stage_history + npd_feedback/quality_check/dispatch).
-- Returns a single jsonb bundle of KPIs + funnel + stage-aging + outcome mix +
-- throughput trend + engineer load + delayed list. SECURITY DEFINER; the page
-- is RBAC npd-gated. Snapshot metrics (funnel/aging/delayed/by_engineer) reflect
-- current state; range metrics (throughput/approved/approval-rate) honor p_from/p_to.
BEGIN;

create or replace function public.npd_intel_summary(
  p_from date, p_to date, p_engineer text default null, p_dev_type text default null)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with proj as (  -- projects matching the engineer / development-type filters
    select p.* from public.npd_project p
    where (p_engineer is null or p.npd_engineer_email = p_engineer)
      and (p_dev_type is null or p.development_type = p_dev_type)
  ),
  hist as (  -- per-project stage timeline; time in to_stage = next_at - moved_at
    select h.project_id, h.to_stage, h.moved_at,
           lead(h.moved_at) over (partition by h.project_id order by h.moved_at) as next_at
    from public.npd_stage_history h
    join proj p on p.id = h.project_id
  ),
  appr as (  -- first approval per project (rework loops can re-approve)
    select distinct on (h.project_id) h.project_id, h.moved_at, p.created_at
    from public.npd_stage_history h
    join proj p on p.id = h.project_id
    where h.to_stage = 'approved'
    order by h.project_id, h.moved_at
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'kpis', jsonb_build_object(
      'active', (select count(*) from proj where status = 'active'),
      'approved_in_range', (select count(*) from appr where moved_at::date between p_from and p_to),
      'delayed', (select count(*) from proj
                  where status = 'active' and target_date is not null and target_date < now()::date),
      'awaiting_feedback', (select count(*) from proj where stage = 'customer_feedback' and status = 'active'),
      'overdue_feedback', (select count(*) from public.npd_dispatch d join proj p on p.id = d.project_id
                           where d.feedback_status = 'overdue'
                              or (d.feedback_status = 'pending' and d.feedback_due_date is not null
                                  and d.feedback_due_date < now()::date)),
      'avg_turnaround_days', (select round(avg(extract(epoch from (moved_at - created_at)) / 86400)::numeric, 1)
                              from appr),
      'approval_rate', (select case when count(*) filter (where status in ('approved','rejected')) > 0
                          then round(count(*) filter (where status = 'approved')::numeric
                                     / count(*) filter (where status in ('approved','rejected')) * 100, 1)
                          else null end from proj),
      'sample_pass_rate', (select case when count(*) > 0
                            then round(count(*) filter (where q.result = 'pass')::numeric / count(*) * 100, 1)
                            else null end
                           from public.npd_quality_check q join proj p on p.id = q.project_id
                           where q.result in ('pass','fail'))
    ),
    'funnel', coalesce((select jsonb_agg(jsonb_build_object('stage', stage, 'count', c) order by ord)
      from (select stage, count(*) c, public.npd_stage_order(stage) ord
            from proj where status = 'active' group by stage) t), '[]'::jsonb),
    'stage_aging', coalesce((select jsonb_agg(jsonb_build_object('stage', to_stage, 'avg_days', avg_days) order by ord)
      from (select to_stage, public.npd_stage_order(to_stage) ord,
                   round(avg(extract(epoch from (coalesce(next_at, now()) - moved_at)) / 86400)::numeric, 1) as avg_days
            from hist group by to_stage) t), '[]'::jsonb),
    'outcome_mix', coalesce((select jsonb_agg(jsonb_build_object('outcome', outcome, 'count', c) order by c desc)
      from (select f.outcome, count(*) c from public.npd_feedback f join proj p on p.id = f.project_id
            group by f.outcome) t), '[]'::jsonb),
    'throughput_trend', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'approved', c) order by m)
      from (select to_char(date_trunc('month', moved_at), 'YYYY-MM') as m, count(*) c
            from appr where moved_at::date between p_from and p_to
            group by date_trunc('month', moved_at)) t), '[]'::jsonb),
    'by_engineer', coalesce((select jsonb_agg(jsonb_build_object('engineer', eng, 'count', c) order by c desc)
      from (select coalesce(npd_engineer_email, '(unassigned)') eng, count(*) c
            from proj where status = 'active' group by npd_engineer_email
            order by count(*) desc limit 12) t), '[]'::jsonb),
    'delayed_list', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'project_no', project_no, 'product', product_name, 'customer', company_name,
        'stage', stage, 'engineer', npd_engineer_email, 'target_date', target_date,
        'days_overdue', (now()::date - target_date)) order by target_date)
      from (select * from proj
            where status = 'active' and target_date is not null and target_date < now()::date
            order by target_date limit 25) t), '[]'::jsonb)
  );
$function$;
grant execute on function public.npd_intel_summary(date,date,text,text) to authenticated;

COMMIT;
