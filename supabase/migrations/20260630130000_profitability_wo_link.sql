-- Profitability V1.2 Phase B: carry sales_order_line through the demand→plan→floor
-- chain so released work orders stamp ppc_wo.so_line_id → per-order Actual GP.
-- (ppc_wo.so_line_id already added in 20260630120000.) Other WO paths (manual,
-- CRM cycle, cable) have no real SO line and stay null = product-grain.
BEGIN;

alter table public.daily_production_plan
  add column if not exists demand_id uuid,
  add column if not exists so_id uuid,
  add column if not exists so_line_id uuid;

-- Auto-commit: copy each source demand's so_line_id/so_id onto the plan row.
create or replace function public.mes_auto_commit_plan(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_inserted int := 0;
  v_demands int := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', false, 'message', 'No rows to commit.');
  end if;

  insert into public.daily_production_plan
    (plan_date, product_id, product_name, planned_qty, department_id, shift_id, priority, status, notes, created_by_email,
     demand_id, so_line_id, so_id)
  select r.plan_date, r.product_id, nullif(trim(r.product_name), ''), r.planned_qty,
         r.department_id, r.shift_id, coalesce(nullif(r.priority, ''), 'normal'), 'planned',
         r.notes, v_email,
         r.demand_id, pd.so_line_id, pd.so_id
  from jsonb_to_recordset(p_rows) as r(
    demand_id uuid, plan_date date, product_id uuid, product_name text,
    planned_qty numeric, department_id uuid, shift_id uuid, priority text, notes text
  )
  left join public.production_demand pd on pd.id = r.demand_id
  where coalesce(r.planned_qty, 0) > 0;
  get diagnostics v_inserted = row_count;

  with alloc as (
    select r.demand_id, sum(r.planned_qty) as qty
    from jsonb_to_recordset(p_rows) as r(demand_id uuid, planned_qty numeric)
    where r.demand_id is not null and coalesce(r.planned_qty, 0) > 0
    group by r.demand_id
  ), upd as (
    update public.production_demand d
       set planned_qty = coalesce(d.planned_qty, 0) + a.qty,
           status = case when d.status = 'pending' then 'planned' else d.status end,
           updated_at = now()
      from alloc a where d.id = a.demand_id
    returning d.id
  )
  select count(*) into v_demands from upd;

  return jsonb_build_object('ok', true, 'plans_created', v_inserted, 'demands_updated', v_demands);
end $$;
grant execute on function public.mes_auto_commit_plan(jsonb) to authenticated;

-- Release to floor: after creating the WO, stamp its so_line_id from the plan.
create or replace function public.mes_release_plan_to_floor(p_plan_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid; v_pname text; v_qty numeric; v_due date; v_existing uuid;
  v_item uuid; v_res jsonb; v_wo_id uuid; v_soline uuid;
begin
  select product_id, product_name, planned_qty, plan_date, work_order_id, so_line_id
    into v_pid, v_pname, v_qty, v_due, v_existing, v_soline
  from public.daily_production_plan where id = p_plan_id;
  if not found then raise exception 'plan not found'; end if;
  if v_existing is not null then
    return jsonb_build_object('ok', false, 'message', 'Already released to the floor.');
  end if;
  if coalesce(v_qty, 0) <= 0 then
    return jsonb_build_object('ok', false, 'message', 'Set a quantity on the plan first.');
  end if;

  if v_pid is not null then
    select ppc_item_id into v_item from public.product where id = v_pid;
    if v_item is null then v_item := public.product_ensure_item(v_pid); end if;
  end if;
  if v_item is null then
    insert into public.ppc_items (code, name, item_type, uom)
    values ('PLN-' || left(p_plan_id::text, 8), coalesce(nullif(trim(v_pname), ''), 'Power Cord'), 'power_cord', 'pcs')
    on conflict (lower(code)) do update set name = excluded.name
    returning id into v_item;
  end if;

  v_res := public.ppc_create_work_order(v_item, v_qty, null, v_due);
  v_wo_id := (v_res->>'id')::uuid;

  -- per-order link: carry the plan's sales-order line onto the work order
  if v_wo_id is not null and v_soline is not null then
    update public.ppc_wo set so_line_id = v_soline where id = v_wo_id;
  end if;

  update public.daily_production_plan
     set work_order_id = v_wo_id, status = 'in_production'
   where id = p_plan_id;

  return jsonb_build_object('ok', true, 'work_order_id', v_wo_id, 'wo_number', v_res->>'wo_number', 'stage_count', v_res->>'stage_count');
end $$;
grant execute on function public.mes_release_plan_to_floor(uuid) to authenticated;

COMMIT;
