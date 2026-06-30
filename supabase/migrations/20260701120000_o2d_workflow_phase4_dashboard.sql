-- O2D Workflow Engine — Phase 4A: CEO Control Tower aggregate RPC.
-- A single read-only portfolio roll-up over wf_instance / wf_stage_run for the
-- CEO control tower page. Additive: no schema changes, just a new function.
-- Mirrors profit_summary conventions (stable security definer, search_path,
-- is_super_admin() gate, returns one jsonb blob the page destructures).

create or replace function public.wf_dashboard(
  p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v       jsonb;
  v_from  date := coalesce(p_from, current_date - 30);
  v_to    date := coalesce(p_to, current_date);
begin
  -- CEO-only at the DB layer (same guard the profitability engine uses).
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;

  with inst as (
    select
      i.*,
      (current_date - i.started_at::date) as age_days,
      exists (
        select 1 from wf_stage_run r
        where r.instance_id = i.id
          and r.status in ('blocked','ready','in_progress')
          and r.due_date is not null and r.due_date < current_date
      ) as overdue
    from wf_instance i
  ),
  active as (
    select * from inst where status in ('active','blocked')
  ),
  -- de-dupe the stage catalogue across order_type so a stage_key has one label.
  stagedef as (
    select stage_key, min(sequence) as seq, max(label) as label
    from wf_stage_def group by stage_key
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),

    'kpis', jsonb_build_object(
      'active',              (select count(*) from active),
      'blocked',             (select count(*) from active where status = 'blocked'),
      'overdue',             (select count(*) from active where overdue),
      'avg_age_days',        (select round(coalesce(avg(age_days), 0), 1) from active),
      'completed_in_range',  (select count(*) from wf_instance
                                where status = 'completed'
                                  and closed_at::date between v_from and v_to),
      'overdue_stages',      (select count(*)
                                from wf_stage_run r join active a on a.id = r.instance_id
                                where r.status in ('blocked','ready','in_progress')
                                  and r.due_date is not null and r.due_date < current_date)
    ),

    -- Bottleneck view: which stage are active orders parked on right now.
    'by_stage', coalesce((
      select jsonb_agg(jsonb_build_object(
               'stage_key', x.current_stage,
               'label',     coalesce(sd.label, x.current_stage),
               'sequence',  coalesce(sd.seq, 999),
               'count',     x.cnt,
               'overdue',   x.od
             ) order by coalesce(sd.seq, 999))
      from (
        select current_stage, count(*) cnt, count(*) filter (where overdue) od
        from active group by current_stage
      ) x
      left join stagedef sd on sd.stage_key = x.current_stage
    ), '[]'::jsonb),

    -- Where the open work sits, by department (open stage runs).
    'by_department', coalesce((
      select jsonb_agg(jsonb_build_object(
               'department', coalesce(y.dept, 'Unassigned'),
               'open',       y.opn,
               'overdue',    y.od
             ) order by y.opn desc)
      from (
        select r.department dept,
               count(*) opn,
               count(*) filter (where r.due_date is not null and r.due_date < current_date) od
        from wf_stage_run r join active a on a.id = r.instance_id
        where r.status in ('blocked','ready','in_progress')
        group by r.department
      ) y
    ), '[]'::jsonb),

    -- Stuck-orders table: every active order, oldest first.
    'aging', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sales_order_id',      a.sales_order_id,
               'so_number',           a.so_number,
               'company_name',        a.company_name,
               'owner_email',         a.owner_email,
               'order_type',          a.order_type,
               'status',              a.status,
               'current_stage',       a.current_stage,
               'current_stage_label', coalesce(sd.label, a.current_stage),
               'age_days',            a.age_days,
               'days_in_stage', (
                 select (current_date - coalesce(r.started_at, r.created_at)::date)
                 from wf_stage_run r
                 where r.instance_id = a.id and r.stage_key = a.current_stage
                 limit 1),
               'overdue',             a.overdue
             ) order by a.age_days desc)
      from active a
      left join stagedef sd on sd.stage_key = a.current_stage
    ), '[]'::jsonb)
  ) into v;

  return v;
end $fn$;

grant execute on function public.wf_dashboard(date, date) to authenticated;
