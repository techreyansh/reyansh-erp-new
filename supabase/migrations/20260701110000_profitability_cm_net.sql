-- Profitability V2 Phase 1: extend profit_summary with Contribution Margin
-- (Revenue − Material − VARIABLE conversion[=labour]) per grain, and a company
-- Net Profit block (ΣCM − Σfixed conversion[=machine+overhead+financial] −
-- Σoperating expenses[expense_entry, period]). Fixed/expense layers are company-
-- grain. CEO-only.
BEGIN;

create or replace function public.profit_summary(
  p_from date, p_to date, p_basis text default 'ordered', p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare v jsonb; v_exp numeric; v_exp_break jsonb;
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;

  -- operating expenses for the period (company-grain, for Net)
  select coalesce(sum(amount),0) into v_exp from public.expense_entry
    where coalesce(period_month, to_char(entry_date,'YYYY-MM'))
          between to_char(p_from,'YYYY-MM') and to_char(p_to,'YYYY-MM');
  select coalesce(jsonb_agg(jsonb_build_object('type', expense_type, 'amount', round(amt,2)) order by amt desc), '[]'::jsonb)
    into v_exp_break from (
      select expense_type, sum(amount) amt from public.expense_entry
      where coalesce(period_month, to_char(entry_date,'YYYY-MM')) between to_char(p_from,'YYYY-MM') and to_char(p_to,'YYYY-MM')
      group by expense_type) t;

  with flt as (
    select nullif(p_filters->>'customer_code','') f_cust, nullif(p_filters->>'product_id','')::uuid f_prod,
           nullif(p_filters->>'product_family','') f_fam, nullif(p_filters->>'product_category','') f_cat,
           lower(nullif(p_filters->>'sales_exec','')) f_exec,
           nullif(p_filters->>'rev_min','')::numeric f_rmin, nullif(p_filters->>'rev_max','')::numeric f_rmax
  ),
  src as (
    select l.id line_id, l.qty, l.line_value revenue, l.product_id, l.costing_version_id,
           so.customer_code, so.company_name, lower(coalesce(so.owner_email,'')) sales_exec,
           so.created_at::date txn_date, so.so_number, so.id order_id
    from public.sales_order_line l join public.sales_order so on so.id = l.so_id
    where p_basis = 'ordered' and so.created_at::date between p_from and p_to and so.status <> 'cancelled'
    union all
    select fl.id, fl.qty, fl.taxable_value revenue,
           (select pp.id from public.product pp where pp.product_code = fl.product_code limit 1),
           null::uuid, fi.customer_code, fi.customer_name, lower(coalesce(fi.owner_email,'')),
           coalesce(fi.invoice_date, fi.created_at::date), fi.invoice_number, fi.id
    from public.finance_invoice_line fl join public.finance_invoices fi on fi.id = fl.invoice_id
    where p_basis = 'realized' and coalesce(fi.invoice_date, fi.created_at::date) between p_from and p_to
  ),
  fact0 as (
    select s.*, p.product_name, p.product_code, p.product_family, p.product_category,
           cr.mat_per_unit, cr.conv_per_unit, cr.var_per_unit, cr.cost_source, cr.resolved_cv
    from src s
    left join public.product p on p.id = s.product_id
    left join lateral (
      select coalesce(pin.m, ovr.m, rel.m) mat_per_unit,
             coalesce(pin.c, ovr.c, rel.c) conv_per_unit,
             coalesce(pin.vc, ovr.vc, rel.vc) var_per_unit,
             coalesce(pin.cv, rel.cv) resolved_cv,
             case when pin.m is not null then 'costing' when ovr.m is not null then 'override'
                  when rel.m is not null then 'released' else 'uncosted' end cost_source
      from (select 1) one
      left join lateral (select cv.id cv, cv.material_cost/nullif(cv.qty_basis,0) m,
                (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0) c,
                cv.labour_cost/nullif(cv.qty_basis,0) vc
                from public.costing_version cv where cv.id = s.costing_version_id) pin on true
      left join lateral (select o.material_per_unit m, o.conversion_per_unit c, o.conversion_per_unit vc
                from public.profit_product_cost_override o where o.product_id = s.product_id) ovr on true
      left join lateral (select cv.id cv, cv.material_cost/nullif(cv.qty_basis,0) m,
                (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0) c,
                cv.labour_cost/nullif(cv.qty_basis,0) vc
                from public.costing_version cv where cv.product_id = s.product_id and cv.status='released'
                order by cv.version_number desc limit 1) rel on true
    ) cr on true
  ),
  fact as (
    select f.*,
      round(f.qty * coalesce(f.mat_per_unit,0), 2) material,
      round(f.qty * coalesce(f.conv_per_unit,0), 2) conversion,
      round(f.qty * coalesce(f.var_per_unit,0), 2) variable_conv,
      round(f.qty * (coalesce(f.conv_per_unit,0) - coalesce(f.var_per_unit,0)), 2) fixed_conv,
      case when f.mat_per_unit is null then null
           else round(f.revenue - f.qty*coalesce(f.mat_per_unit,0) - f.qty*coalesce(f.conv_per_unit,0), 2) end gp,
      case when f.mat_per_unit is null then null
           else round(f.revenue - f.qty*coalesce(f.mat_per_unit,0) - f.qty*coalesce(f.var_per_unit,0), 2) end contribution,
      (f.mat_per_unit is null) uncosted
    from fact0 f, flt
    where (flt.f_cust is null or f.customer_code = flt.f_cust)
      and (flt.f_prod is null or f.product_id = flt.f_prod)
      and (flt.f_fam  is null or f.product_family = flt.f_fam)
      and (flt.f_cat  is null or f.product_category = flt.f_cat)
      and (flt.f_exec is null or f.sales_exec = flt.f_exec)
      and (flt.f_rmin is null or f.revenue >= flt.f_rmin)
      and (flt.f_rmax is null or f.revenue <= flt.f_rmax)
  )
  select jsonb_build_object(
    'basis', p_basis, 'range', jsonb_build_object('from', p_from, 'to', p_to),
    'kpis', (select jsonb_build_object(
        'revenue', coalesce(round(sum(revenue),2),0),
        'material', coalesce(round(sum(material),2),0),
        'conversion', coalesce(round(sum(conversion),2),0),
        'variable_conv', coalesce(round(sum(variable_conv),2),0),
        'fixed_conv', coalesce(round(sum(fixed_conv),2),0),
        'gross_profit', coalesce(round(sum(gp),2),0),
        'contribution', coalesce(round(sum(contribution),2),0),
        'gm_pct', case when sum(revenue) filter (where not uncosted) > 0
                    then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else 0 end,
        'cm_pct', case when sum(revenue) filter (where not uncosted) > 0
                    then round(sum(contribution)/sum(revenue) filter (where not uncosted)*100,1) else 0 end,
        'orders', count(distinct order_id), 'lines', count(*),
        'uncosted_revenue', coalesce(round(sum(revenue) filter (where uncosted),2),0),
        'uncosted_lines', count(*) filter (where uncosted)) from fact),
    -- company Net P&L (CM − fixed conversion − operating expenses)
    'net', (select jsonb_build_object(
        'revenue', coalesce(round(sum(revenue),2),0),
        'gross_profit', coalesce(round(sum(gp),2),0),
        'contribution', coalesce(round(sum(contribution),2),0),
        'fixed_conv', coalesce(round(sum(fixed_conv),2),0),
        'operating_expenses', round(v_exp,2),
        'expense_breakdown', v_exp_break,
        'net_profit', coalesce(round(sum(contribution) - sum(fixed_conv) - v_exp, 2), 0),
        'net_margin', case when sum(revenue) filter (where not uncosted) > 0
                      then round((sum(contribution)-sum(fixed_conv)-v_exp)/sum(revenue) filter (where not uncosted)*100,1) else 0 end
      ) from fact),
    'by_customer', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select customer_code code, max(company_name) name, round(sum(revenue),2) revenue,
               round(sum(material),2) material, round(sum(conversion),2) conversion,
               round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(contribution)/sum(revenue) filter (where not uncosted)*100,1) else null end cm_pct,
               round(sum(qty),2) qty, count(distinct order_id) orders, count(distinct product_id) products
        from fact group by customer_code) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select product_id, max(product_code) code, max(product_name) name, max(product_family) family,
               max(product_category) category, round(sum(revenue),2) revenue, round(sum(material),2) material,
               round(sum(conversion),2) conversion, round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(contribution)/sum(revenue) filter (where not uncosted)*100,1) else null end cm_pct,
               round(sum(qty),2) qty, count(distinct customer_code) customers
        from fact group by product_id) x), '[]'::jsonb),
    'by_family', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select coalesce(product_family,'—') name, round(sum(revenue),2) revenue, round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct
        from fact group by product_family) x), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select coalesce(product_category,'—') name, round(sum(revenue),2) revenue, round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct
        from fact group by product_category) x), '[]'::jsonb),
    'by_sales_exec', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select case when sales_exec='' then '—' else sales_exec end name, round(sum(revenue),2) revenue,
               round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               count(distinct order_id) orders
        from fact group by sales_exec) x), '[]'::jsonb),
    'by_order', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select order_id, max(so_number) so_number, max(customer_code) customer_code, max(company_name) company_name,
               round(sum(revenue),2) revenue, round(sum(material),2) material, round(sum(conversion),2) conversion,
               round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct
        from fact group by order_id) x), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object(
          'month', ym, 'revenue', revenue, 'gross_profit', gross_profit, 'contribution', contribution, 'gm_pct', gm_pct) order by ym) from (
        select to_char(txn_date,'YYYY-MM') ym, round(sum(revenue),2) revenue, round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct
        from fact group by to_char(txn_date,'YYYY-MM')) t), '[]'::jsonb),
    'needs_costing', coalesce((select jsonb_agg(x order by x.revenue desc) from (
        select product_id, max(product_code) code, max(product_name) name, round(sum(revenue),2) revenue, count(*) lines
        from fact where uncosted group by product_id) x), '[]'::jsonb),
    'material_breakdown', coalesce((select jsonb_agg(x order by x.amount desc) from (
        select cl.material_code code, round(sum(cl.amount * f.qty / nullif(cv.qty_basis,0)),2) amount
        from fact f join public.costing_version cv on cv.id = f.resolved_cv
        join public.costing_line cl on cl.costing_id = f.resolved_cv and cl.section='material' and cl.material_code is not null
        group by cl.material_code) x), '[]'::jsonb)
  ) into v;
  return v;
end $fn$;
revoke all on function public.profit_summary(date,date,text,jsonb) from public, anon;
grant execute on function public.profit_summary(date,date,text,jsonb) to authenticated;

COMMIT;
