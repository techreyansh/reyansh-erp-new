-- Profitability Center V1.1 — dual GP (Expected vs Actual). CEO-only.
-- Expected GP = costing standard (existing profit_summary). Actual GP = actual
-- revenue (invoices) − actual material (inv_ledger MFG_CONSUME, real weighted-avg
-- COGS) − STANDARD conversion (no rupee actuals on the floor; labeled). Product
-- grain (+ per-order where the new ppc_wo.so_line_id is set going forward).
BEGIN;

-- Forward WO → sales-order link (old WOs stay null = product-grain only).
alter table public.ppc_wo
  add column if not exists so_line_id uuid references public.sales_order_line(id) on delete set null,
  add column if not exists production_demand_id uuid;

create or replace function public.profit_actual_summary(
  p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;

  with flt as (
    select nullif(p_filters->>'product_family','') f_fam,
           nullif(p_filters->>'product_category','') f_cat
  ),
  -- EXPECTED (standard) from sales_order_line in range, reusing the cost resolution
  exp as (
    select l.product_id, sum(l.line_value) exp_rev, sum(l.qty) exp_qty,
           sum(l.qty * coalesce(cr.mat,0)) exp_mat,
           sum(l.qty * coalesce(cr.conv,0)) exp_conv
    from public.sales_order_line l
    join public.sales_order so on so.id = l.so_id and so.status <> 'cancelled'
       and so.created_at::date between p_from and p_to
    left join lateral (
      select coalesce(pin.m, rel.m) mat, coalesce(pin.c, rel.c) conv
      from (select 1) o
      left join lateral (select cv.material_cost/nullif(cv.qty_basis,0) m,
        (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0) c
        from public.costing_version cv where cv.id = l.costing_version_id) pin on true
      left join lateral (select cv.material_cost/nullif(cv.qty_basis,0) m,
        (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0) c
        from public.costing_version cv where cv.product_id = l.product_id and cv.status='released'
        order by cv.version_number desc limit 1) rel on true
    ) cr on true
    group by l.product_id
  ),
  -- ACTUAL produced qty per product (via ppc_item_id), finished WOs in range
  wo as (
    select pr.id product_id, sum(w.produced_qty) act_qty
    from public.ppc_wo w
    join public.product pr on pr.ppc_item_id = w.item_id
    where w.created_at::date between p_from and p_to and w.status in ('qc','done')
    group by pr.id
  ),
  -- ACTUAL material cost (real weighted-avg COGS) from ledger MFG_CONSUME for those WOs
  mat as (
    select pr.id product_id, sum(-l.value_delta) act_mat
    from public.ppc_wo w
    join public.product pr on pr.ppc_item_id = w.item_id
    join public.inv_ledger l on l.ref_type='work_order' and l.ref_id = w.id::text and l.movement_type='MFG_CONSUME'
    where w.created_at::date between p_from and p_to
    group by pr.id
  ),
  -- ACTUAL revenue from invoices (by product_code), in range
  rev as (
    select pr.id product_id, sum(fl.amount) act_rev
    from public.finance_invoice_line fl
    join public.finance_invoices fi on fi.id = fl.invoice_id
       and coalesce(fi.invoice_date, fi.created_at::date) between p_from and p_to
    join public.product pr on pr.product_code = fl.product_code
    group by pr.id
  ),
  -- standard conversion per unit (latest released) for the actual qty
  stdc as (
    select pr.id product_id,
      (select (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0)
       from public.costing_version cv where cv.product_id = pr.id and cv.status='released'
       order by cv.version_number desc limit 1) conv_pu
    from public.product pr
  ),
  rows as (
    select p.id product_id, p.product_code code, p.product_name name, p.product_family family, p.product_category category,
      coalesce(exp.exp_rev,0) exp_rev, coalesce(exp.exp_mat,0) exp_mat, coalesce(exp.exp_conv,0) exp_conv,
      coalesce(exp.exp_rev,0) - coalesce(exp.exp_mat,0) - coalesce(exp.exp_conv,0) exp_gp, coalesce(exp.exp_qty,0) exp_qty,
      coalesce(rev.act_rev,0) act_rev, coalesce(mat.act_mat,0) act_mat, coalesce(wo.act_qty,0) act_qty,
      round(coalesce(wo.act_qty,0) * coalesce(stdc.conv_pu,0), 2) act_conv,
      (mat.act_mat is not null or rev.act_rev is not null) has_actual
    from public.product p
    left join exp on exp.product_id = p.id
    left join wo  on wo.product_id = p.id
    left join mat on mat.product_id = p.id
    left join rev on rev.product_id = p.id
    left join stdc on stdc.product_id = p.id, flt
    where (exp.exp_rev is not null or mat.act_mat is not null or rev.act_rev is not null)
      and (flt.f_fam is null or p.product_family = flt.f_fam)
      and (flt.f_cat is null or p.product_category = flt.f_cat)
  ),
  calc as (
    select r.*,
      round(r.act_rev - r.act_mat - r.act_conv, 2) act_gp,
      case when r.exp_rev>0 then round(r.exp_gp/r.exp_rev*100,1) else null end exp_gm,
      case when r.act_rev>0 then round((r.act_rev-r.act_mat-r.act_conv)/r.act_rev*100,1) else null end act_gm
    from rows r
  ),
  fin as (
    select c.*,
      round(c.act_gp - c.exp_gp, 2) gp_var,
      round(c.act_rev - c.exp_rev, 2) rev_var,
      round(c.act_mat - c.exp_mat, 2) mat_var,
      case when c.exp_gm is null or c.act_gm is null then 'na'
           when c.act_gm >= c.exp_gm - 0.5 then 'green'
           when c.act_gm >= c.exp_gm - 5 then 'yellow' else 'red' end light
    from calc c
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'kpis', (select jsonb_build_object(
        'exp_gp', coalesce(round(sum(exp_gp),2),0), 'act_gp', coalesce(round(sum(act_gp) filter (where has_actual),2),0),
        'gp_var', coalesce(round(sum(act_gp) filter (where has_actual) - sum(exp_gp) filter (where has_actual),2),0),
        'mat_var', coalesce(round(sum(mat_var) filter (where has_actual),2),0),
        'rev_var', coalesce(round(sum(rev_var) filter (where has_actual),2),0),
        'products_with_actual', count(*) filter (where has_actual),
        'products_total', count(*)) from fin),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'family', family,
        'exp_gp', exp_gp, 'act_gp', act_gp, 'exp_gm', exp_gm, 'act_gm', act_gm,
        'gp_var', gp_var, 'mat_var', mat_var, 'rev_var', rev_var,
        'exp_mat', exp_mat, 'act_mat', act_mat, 'exp_rev', exp_rev, 'act_rev', act_rev,
        'act_qty', act_qty, 'light', light, 'has_actual', has_actual) order by gp_var) from fin), '[]'::jsonb),
    'top_negative', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'gp_var', gp_var, 'light', light) order by gp_var)
        from fin where has_actual and gp_var < 0 limit 8), '[]'::jsonb),
    'top_positive', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'gp_var', gp_var, 'light', light) order by gp_var desc)
        from fin where has_actual and gp_var > 0 limit 8), '[]'::jsonb),
    'needs_actual', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'exp_rev', exp_rev) order by exp_rev desc)
        from fin where not has_actual and exp_rev > 0), '[]'::jsonb)
  ) into v;
  return v;
end $fn$;
revoke all on function public.profit_actual_summary(date,date,jsonb) from public, anon;
grant execute on function public.profit_actual_summary(date,date,jsonb) to authenticated;

COMMIT;
