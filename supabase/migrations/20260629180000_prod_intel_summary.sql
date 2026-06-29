-- Production Intelligence Center: one analytics RPC over the real shop-floor
-- capture (stage_execution_log job cards → ppc_wo_stage → ppc_wo). Returns a
-- single jsonb bundle of KPIs + trend + paretos + throughput + late WOs for the
-- date range, optionally filtered by line / product. SECURITY DEFINER; the page
-- is RBAC production-gated. OEE/utilization/yield are intentionally absent (no
-- machine-status / attendance instrumentation exists yet).
BEGIN;

create or replace function public.prod_intel_summary(
  p_from date, p_to date, p_line uuid default null, p_product uuid default null)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with sel as (
    select s.*, st.stage_name, st.work_order_id as wo_id, w.item_id, w.line_id, w.due_date
    from public.stage_execution_log s
    join public.ppc_wo_stage st on st.id = s.stage_id
    join public.ppc_wo w        on w.id = s.work_order_id
    where s.logged_at::date between p_from and p_to
      and (p_line is null or w.line_id = p_line)
      and (p_product is null or w.item_id = p_product)
  ),
  k as (
    select
      coalesce(sum(output_qty),0) as units,
      coalesce(sum(reject_qty),0) as scrap,
      coalesce(sum(downtime_min),0) as downtime_min,
      count(*) as entries
    from sel
  ),
  wo_done as (  -- WOs whose final stage completed within the range
    select w.id, w.due_date, max(st.completed_at) as completed_at
    from public.ppc_wo w
    join public.ppc_wo_stage st on st.work_order_id = w.id
    where (p_line is null or w.line_id = p_line)
      and (p_product is null or w.item_id = p_product)
    group by w.id, w.due_date
    having max(st.completed_at) is not null
       and max(st.completed_at)::date between p_from and p_to
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'kpis', jsonb_build_object(
      'units', (select units from k),
      'scrap', (select scrap from k),
      'scrap_rate', case when (select units+scrap from k) > 0
                         then round((select scrap from k)::numeric / (select units+scrap from k) * 100, 1) else 0 end,
      'downtime_hrs', round((select downtime_min from k)::numeric / 60, 1),
      'entries', (select entries from k),
      'wip', (select count(*) from public.ppc_wo w
              where w.status in ('planned','released','in_progress','qc')
                and (p_line is null or w.line_id = p_line)
                and (p_product is null or w.item_id = p_product)),
      'on_time_pct', (select case when count(*) > 0
                        then round(count(*) filter (where completed_at::date <= due_date and due_date is not null)::numeric
                                   / nullif(count(*) filter (where due_date is not null),0) * 100, 1) else null end
                      from wo_done),
      'completed_wos', (select count(*) from wo_done),
      'mold_alerts', (select count(*) from public.molding_master
                      where status = 'active' and coalesce(tool_life_shots,0) > 0
                        and shots_done / nullif(tool_life_shots,0) >= 0.85)
    ),
    'trend', coalesce((select jsonb_agg(jsonb_build_object(
        'date', d, 'output', o, 'reject', r) order by d)
      from (select logged_at::date as d, sum(output_qty) o, sum(reject_qty) r
            from sel group by logged_at::date) t), '[]'::jsonb),
    'output_by_product', coalesce((select jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'units', u) order by u desc)
      from (select i.code, i.name, sum(sel.output_qty) u
            from sel join public.ppc_items i on i.id = sel.item_id
            group by i.code, i.name order by sum(sel.output_qty) desc limit 12) t), '[]'::jsonb),
    'defect_pareto', coalesce((select jsonb_agg(jsonb_build_object(
        'name', name, 'count', c, 'qty', q) order by q desc)
      from (select dc.name, count(*) c, sum(sel.reject_qty) q
            from sel join public.defect_code dc on dc.id = sel.defect_code_id
            group by dc.name order by sum(sel.reject_qty) desc) t), '[]'::jsonb),
    'downtime_pareto', coalesce((select jsonb_agg(jsonb_build_object(
        'name', name, 'minutes', m) order by m desc)
      from (select dr.name, sum(sel.downtime_min) m
            from sel join public.downtime_reason dr on dr.id = sel.downtime_reason_id
            group by dr.name order by sum(sel.downtime_min) desc) t), '[]'::jsonb),
    'stage_throughput', coalesce((select jsonb_agg(jsonb_build_object(
        'stage', stage_name, 'output', o, 'reject', r) order by o desc)
      from (select stage_name, sum(output_qty) o, sum(reject_qty) r
            from sel group by stage_name) t), '[]'::jsonb),
    'late_wos', coalesce((select jsonb_agg(jsonb_build_object(
        'wo_number', wo_number, 'product', pname, 'due_date', due_date,
        'status', status, 'completed_at', completed_at) order by due_date)
      from (
        select w.wo_number, i.name as pname, w.due_date, w.status, wd.completed_at
        from public.ppc_wo w
        join public.ppc_items i on i.id = w.item_id
        left join wo_done wd on wd.id = w.id
        where w.due_date is not null and w.due_date between p_from and p_to
          and (p_line is null or w.line_id = p_line)
          and (p_product is null or w.item_id = p_product)
          and (w.status <> 'done' or wd.completed_at::date > w.due_date)
          and w.status <> 'cancelled'
        order by w.due_date limit 20) t), '[]'::jsonb)
  );
$function$;
grant execute on function public.prod_intel_summary(date,date,uuid,uuid) to authenticated;

COMMIT;
