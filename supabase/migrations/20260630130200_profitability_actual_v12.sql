-- Profitability V1.2 engine: profit_actual_summary gains by_customer, by_order
-- (per-order where ppc_wo.so_line_id is set), and material_factors (copper/PVC/
-- component expected-vs-actual variance). Plus component-grain demo consumption.
BEGIN;

create or replace function public.profit_actual_summary(
  p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;

  with flt as (
    select nullif(p_filters->>'product_family','') f_fam, nullif(p_filters->>'product_category','') f_cat
  ),
  exp as (
    select l.product_id, sum(l.line_value) exp_rev, sum(l.qty) exp_qty,
           sum(l.qty * coalesce(cr.mat,0)) exp_mat, sum(l.qty * coalesce(cr.conv,0)) exp_conv
    from public.sales_order_line l
    join public.sales_order so on so.id = l.so_id and so.status <> 'cancelled'
       and so.created_at::date between p_from and p_to
    left join lateral (
      select coalesce(pin.m, rel.m) mat, coalesce(pin.c, rel.c) conv from (select 1) o
      left join lateral (select cv.material_cost/nullif(cv.qty_basis,0) m,
        (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0) c
        from public.costing_version cv where cv.id = l.costing_version_id) pin on true
      left join lateral (select cv.material_cost/nullif(cv.qty_basis,0) m,
        (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0) c
        from public.costing_version cv where cv.product_id = l.product_id and cv.status='released'
        order by cv.version_number desc limit 1) rel on true) cr on true
    group by l.product_id
  ),
  wo as (
    select pr.id product_id, sum(w.produced_qty) act_qty from public.ppc_wo w
    join public.product pr on pr.ppc_item_id = w.item_id
    where w.created_at::date between p_from and p_to and w.status in ('qc','done') group by pr.id
  ),
  mat as (
    select pr.id product_id, sum(-l.value_delta) act_mat from public.ppc_wo w
    join public.product pr on pr.ppc_item_id = w.item_id
    join public.inv_ledger l on l.ref_type='work_order' and l.ref_id = w.id::text and l.movement_type='MFG_CONSUME'
    where w.created_at::date between p_from and p_to group by pr.id
  ),
  rev as (
    select pr.id product_id, sum(fl.amount) act_rev from public.finance_invoice_line fl
    join public.finance_invoices fi on fi.id = fl.invoice_id
       and coalesce(fi.invoice_date, fi.created_at::date) between p_from and p_to
    join public.product pr on pr.product_code = fl.product_code group by pr.id
  ),
  stdc as (
    select pr.id product_id,
      (select (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0)
       from public.costing_version cv where cv.product_id = pr.id and cv.status='released'
       order by cv.version_number desc limit 1) conv_pu
    from public.product pr
  ),
  rows as (
    select p.id product_id, p.product_code code, p.product_name name, p.product_family family, p.product_category category,
      p.customer_code cust, coalesce(cp.company_name, p.customer_code) cust_name,
      coalesce(exp.exp_rev,0) exp_rev, coalesce(exp.exp_mat,0) exp_mat, coalesce(exp.exp_conv,0) exp_conv,
      coalesce(exp.exp_rev,0)-coalesce(exp.exp_mat,0)-coalesce(exp.exp_conv,0) exp_gp,
      coalesce(rev.act_rev,0) act_rev, coalesce(mat.act_mat,0) act_mat, coalesce(wo.act_qty,0) act_qty,
      round(coalesce(wo.act_qty,0)*coalesce(stdc.conv_pu,0),2) act_conv,
      (mat.act_mat is not null or rev.act_rev is not null) has_actual
    from public.product p
    left join exp on exp.product_id=p.id left join wo on wo.product_id=p.id
    left join mat on mat.product_id=p.id left join rev on rev.product_id=p.id
    left join stdc on stdc.product_id=p.id
    left join public.crm_pipeline cp on cp.customer_code = p.customer_code, flt
    where (exp.exp_rev is not null or mat.act_mat is not null or rev.act_rev is not null)
      and (flt.f_fam is null or p.product_family=flt.f_fam) and (flt.f_cat is null or p.product_category=flt.f_cat)
  ),
  fin as (
    select r.*, round(r.act_rev-r.act_mat-r.act_conv,2) act_gp,
      case when r.exp_rev>0 then round(r.exp_gp/r.exp_rev*100,1) else null end exp_gm,
      case when r.act_rev>0 then round((r.act_rev-r.act_mat-r.act_conv)/r.act_rev*100,1) else null end act_gm,
      round((r.act_rev-r.act_mat-r.act_conv)-r.exp_gp,2) gp_var,
      round(r.act_rev-r.exp_rev,2) rev_var, round(r.act_mat-r.exp_mat,2) mat_var
    from rows r
  ),
  finl as (
    select f.*, case when f.exp_gm is null or f.act_gm is null then 'na'
      when f.act_gm >= f.exp_gm-0.5 then 'green' when f.act_gm >= f.exp_gm-5 then 'yellow' else 'red' end light
    from fin f
  ),
  -- per-order: actuals attributed via ppc_wo.so_line_id
  ord as (
    select so.id so_id, so.so_number, so.customer_code, max(so.company_name) company,
      sum(l.line_value) exp_rev,
      sum(l.qty * coalesce((select cv.material_cost/nullif(cv.qty_basis,0) from public.costing_version cv
            where cv.id = coalesce(l.costing_version_id,
              (select id from public.costing_version where product_id=l.product_id and status='released' order by version_number desc limit 1))),0)) exp_mat,
      coalesce((select sum(-il.value_delta) from public.inv_ledger il join public.ppc_wo w on il.ref_id=w.id::text
                where il.ref_type='work_order' and il.movement_type='MFG_CONSUME'
                  and w.so_line_id in (select id from public.sales_order_line where so_id=so.id)),0) act_mat,
      coalesce((select sum(fl.amount) from public.finance_invoice_line fl join public.finance_invoices fi on fi.id=fl.invoice_id
                where fi.sales_order_id = so.id),0) act_rev
    from public.sales_order so join public.sales_order_line l on l.so_id=so.id
    where so.status<>'cancelled' and so.created_at::date between p_from and p_to
    group by so.id, so.so_number, so.customer_code
  ),
  -- material factors: expected (costing by group) vs actual (consumption by item.material_group)
  expf as (
    select public.prof_material_group(cl.material_code) grp, sum(cl.amount * l.qty / nullif(cv.qty_basis,0)) amt
    from public.sales_order_line l
    join public.sales_order so on so.id=l.so_id and so.status<>'cancelled' and so.created_at::date between p_from and p_to
    join public.costing_version cv on cv.id = coalesce(l.costing_version_id,
      (select id from public.costing_version where product_id=l.product_id and status='released' order by version_number desc limit 1))
    join public.costing_line cl on cl.costing_id=cv.id and cl.section='material' and cl.material_code is not null
    group by public.prof_material_group(cl.material_code)
  ),
  actf as (
    select coalesce(i.material_group,'other') grp, sum(-l.value_delta) amt
    from public.inv_ledger l join public.ppc_items i on i.id=l.item_id
    join public.ppc_wo w on l.ref_type='work_order' and l.ref_id=w.id::text and w.created_at::date between p_from and p_to
    where l.movement_type='MFG_CONSUME' group by coalesce(i.material_group,'other')
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from',p_from,'to',p_to),
    'kpis', (select jsonb_build_object(
        'exp_gp', coalesce(round(sum(exp_gp),2),0), 'act_gp', coalesce(round(sum(act_gp) filter (where has_actual),2),0),
        'gp_var', coalesce(round(sum(gp_var) filter (where has_actual),2),0),
        'mat_var', coalesce(round(sum(mat_var) filter (where has_actual),2),0),
        'rev_var', coalesce(round(sum(rev_var) filter (where has_actual),2),0),
        'products_with_actual', count(*) filter (where has_actual), 'products_total', count(*)) from finl),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'family',family,
        'exp_gp',exp_gp,'act_gp',act_gp,'exp_gm',exp_gm,'act_gm',act_gm,'gp_var',gp_var,'mat_var',mat_var,'rev_var',rev_var,
        'exp_mat',exp_mat,'act_mat',act_mat,'exp_rev',exp_rev,'act_rev',act_rev,'act_qty',act_qty,'light',light,'has_actual',has_actual) order by gp_var) from finl), '[]'::jsonb),
    'by_customer', coalesce((select jsonb_agg(x order by x.gp_var) from (
        select cust code, max(cust_name) name, round(sum(exp_gp),2) exp_gp, round(sum(act_gp) filter (where has_actual),2) act_gp,
          round(sum(gp_var) filter (where has_actual),2) gp_var, round(sum(mat_var) filter (where has_actual),2) mat_var,
          bool_or(has_actual) has_actual from finl group by cust) x), '[]'::jsonb),
    'by_order', coalesce((select jsonb_agg(jsonb_build_object('so_number',so_number,'company',company,
        'exp_gp',round(exp_rev-exp_mat,2), 'act_rev',round(act_rev,2),'act_mat',round(act_mat,2),
        'act_gp', case when act_rev>0 or act_mat>0 then round(act_rev-act_mat,2) else null end,
        'gp_var', case when act_rev>0 or act_mat>0 then round((act_rev-act_mat)-(exp_rev-exp_mat),2) else null end,
        'has_actual', (act_rev>0 or act_mat>0)) order by so_number) from ord), '[]'::jsonb),
    'material_factors', coalesce((select jsonb_agg(jsonb_build_object('group',grp,'expected',round(coalesce(e.amt,0),2),
        'actual',round(coalesce(a.amt,0),2),'variance',round(coalesce(a.amt,0)-coalesce(e.amt,0),2)) order by grp)
      from expf e full join actf a using (grp) where grp is not null), '[]'::jsonb),
    'needs_actual', coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'exp_rev',exp_rev) order by exp_rev desc)
        from finl where not has_actual and exp_rev>0), '[]'::jsonb)
  ) into v;
  return v;
end $fn$;
revoke all on function public.profit_actual_summary(date,date,jsonb) from public, anon;
grant execute on function public.profit_actual_summary(date,date,jsonb) to authenticated;

-- Component-grain demo consumption so the copper/PVC factor split is demonstrable.
create or replace function public.profit_seed_actual_demo()
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_loc uuid; v_p record; v_item uuid; v_wo uuid; v_inv uuid; v_soline uuid;
  v_cu uuid; v_pvc uuid; v_overrun numeric; v_qty numeric; v_cuu numeric; v_pvcu numeric; v_sp numeric; n int := 0;
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;
  select id into v_loc from public.inv_location order by code limit 1;
  if v_loc is null then raise exception 'no inv_location'; end if;
  -- generic copper / pvc items (tagged), for component-grain consumption
  select id into v_cu  from public.ppc_items where code='COPPER' limit 1;
  select id into v_pvc from public.ppc_items where code='PVC_INS' limit 1;

  for v_p in
    select p.id, p.product_code, p.product_name, cv.net_selling_price sp,
           (select sum(amount) from public.costing_line cl where cl.costing_id=cv.id and cl.material_code='COPPER') cu,
           (select sum(amount) from public.costing_line cl where cl.costing_id=cv.id and cl.material_code='PVC_INS') pvc
    from public.product p join public.costing_version cv on cv.product_id=p.id and cv.status='released'
    where p.product_code in ('PICDEMO-1','PICDEMO-3')
  loop
    n := n+1; v_qty := 400; v_sp := v_p.sp; v_cuu := coalesce(v_p.cu,0); v_pvcu := coalesce(v_p.pvc,0);
    v_overrun := case when v_p.product_code='PICDEMO-3' then 1.20 else 1.00 end;  -- PICDEMO-3 over-consumes copper

    insert into public.ppc_items (code, name, item_type, uom)
    values (v_p.product_code||'-ITM', v_p.product_name, 'finished_good', 'pcs') returning id into v_item;
    update public.product set ppc_item_id = v_item where id = v_p.id;
    select l.id into v_soline from public.sales_order_line l where l.product_id=v_p.id limit 1;
    insert into public.ppc_wo (wo_number, item_id, qty, status, produced_qty, so_line_id, created_at)
    values ('PIC-DEMO-WO-'||n, v_item, v_qty, 'done', v_qty, v_soline, current_date-10) returning id into v_wo;

    -- component-grain consumption: copper (overrun on PICDEMO-3) + pvc
    if v_cu is not null then
      insert into public.inv_ledger (item_id, location_id, movement_type, qty_delta, qty_after, valuation_rate, value_delta, value_after, ref_type, ref_id, reason, posted_at)
      values (v_cu, v_loc, 'MFG_CONSUME', -v_qty, 0, round(v_cuu*v_overrun,2), -round(v_qty*v_cuu*v_overrun,2), 0, 'work_order', v_wo::text, 'PIC demo copper', current_date-9);
    end if;
    if v_pvc is not null then
      insert into public.inv_ledger (item_id, location_id, movement_type, qty_delta, qty_after, valuation_rate, value_delta, value_after, ref_type, ref_id, reason, posted_at)
      values (v_pvc, v_loc, 'MFG_CONSUME', -v_qty, 0, round(v_pvcu,2), -round(v_qty*v_pvcu,2), 0, 'work_order', v_wo::text, 'PIC demo pvc', current_date-9);
    end if;

    insert into public.finance_invoices (invoice_number, customer_code, customer_name, invoice_date, amount, status)
    values ('PIC-DEMO-INV-'||n, 'PICDEMOC1', 'Acme Appliances', current_date-8, round(v_qty*v_sp,2), 'ISSUED') returning id into v_inv;
    insert into public.finance_invoice_line (invoice_id, product_code, product_name, qty, rate, taxable_value, amount)
    values (v_inv, v_p.product_code, v_p.product_name, v_qty, v_sp, round(v_qty*v_sp,2), round(v_qty*v_sp,2));
  end loop;
  return jsonb_build_object('ok', true, 'products', n);
end $fn$;
grant execute on function public.profit_seed_actual_demo() to authenticated;

COMMIT;
