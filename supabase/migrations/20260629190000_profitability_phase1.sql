-- Profitability Intelligence Center — V1 (Gross Profit). CEO-only.
-- Tables (cost-head master, manual cost override, expense log) + the profit_summary
-- engine over sales_order_line / finance_invoice_line × costing. Confidential:
-- every table + RPC is locked to is_super_admin() (CEO). Mirrors NPD module
-- registration + inv_item_merge_log RLS.
BEGIN;

-- ---------- 1. Cost-head master (configurable; nothing hardcoded) ----------
create table if not exists public.cost_head (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  cost_group text not null default 'material'        -- material | conversion | expense | other
    check (cost_group in ('material','conversion','expense','other')),
  costing_section text,                               -- material|labour|machine|overhead|financial (maps to costing_version)
  is_enabled boolean not null default true,
  sort_order int not null default 100,
  created_by text, created_at timestamptz not null default now()
);

-- ---------- 2. Manual per-product cost override (for uncosted products) ----------
create table if not exists public.profit_product_cost_override (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product(id) on delete cascade unique,
  material_per_unit numeric not null default 0,
  conversion_per_unit numeric not null default 0,
  breakdown jsonb,                                    -- optional {cost_head_code: amount}
  note text, updated_by text, updated_at timestamptz not null default now()
);

-- ---------- 3. Manual expense log (stored for reporting; no allocation in V1) ----------
create table if not exists public.expense_entry (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  period_month text,                                 -- 'YYYY-MM' (derived on save)
  expense_type text not null default 'factory'       -- factory | admin | selling | other
    check (expense_type in ('factory','admin','selling','other')),
  cost_head_id uuid references public.cost_head(id) on delete set null,
  amount numeric not null default 0,
  note text, created_by text, created_at timestamptz not null default now()
);

-- ---------- RLS: CEO (is_super_admin) only, full access; everyone else nothing ----------
do $$
declare t text;
begin
  foreach t in array array['cost_head','profit_product_cost_override','expense_entry'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_ceo', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t||'_ceo', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- Seed cost heads (CEO can edit/disable/add later) ----------
insert into public.cost_head (code, name, cost_group, costing_section, sort_order) values
  ('COPPER','Copper','material','material',10),
  ('PVC','PVC','material','material',20),
  ('PLUG','Plug components','material','material',30),
  ('TERMINAL','Terminal','material','material',40),
  ('PACKING','Packing material','material','material',50),
  ('LABOUR','Labour','conversion','labour',60),
  ('POWER','Power','conversion','machine',70),
  ('MACHINE','Machine cost','conversion','machine',80),
  ('CONSUMABLES','Consumables','conversion','overhead',90),
  ('REJECTION','Rejection','conversion','overhead',100),
  ('FREIGHT','Freight','expense','financial',110),
  ('OTHER_DIRECT','Other direct cost','other',null,120)
on conflict (code) do nothing;

-- ---------- Module registration — CEO only ----------
insert into public.modules (module_key, module_name, route_path)
select 'profitability', 'Profitability Intelligence', '/profitability'
where not exists (select 1 from public.modules where module_key = 'profitability');

insert into public.role_module_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
select r.id, m.id, true, true, true, true
from public.roles r cross join public.modules m
where m.module_key = 'profitability' and r.role_name = 'CEO'
  and not exists (select 1 from public.role_module_permissions rmp where rmp.role_id = r.id and rmp.module_id = m.id);

-- ---------- 4. Engine: profit_summary (CEO only) ----------
create or replace function public.profit_summary(
  p_from date, p_to date, p_basis text default 'ordered', p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;

  with flt as (
    select nullif(p_filters->>'customer_code','') f_cust,
           nullif(p_filters->>'product_id','')::uuid f_prod,
           nullif(p_filters->>'product_family','') f_fam,
           nullif(p_filters->>'product_category','') f_cat,
           lower(nullif(p_filters->>'sales_exec','')) f_exec,
           nullif(p_filters->>'rev_min','')::numeric f_rmin,
           nullif(p_filters->>'rev_max','')::numeric f_rmax
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
           cr.mat_per_unit, cr.conv_per_unit, cr.cost_source, cr.resolved_cv
    from src s
    left join public.product p on p.id = s.product_id
    left join lateral (
      select coalesce(pin.m, ovr.m, rel.m) mat_per_unit,
             coalesce(pin.c, ovr.c, rel.c) conv_per_unit,
             coalesce(pin.cv, rel.cv) resolved_cv,
             case when pin.m is not null then 'costing' when ovr.m is not null then 'override'
                  when rel.m is not null then 'released' else 'uncosted' end cost_source
      from (select 1) one
      left join lateral (select cv.id cv, cv.material_cost/nullif(cv.qty_basis,0) m,
                (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0) c
                from public.costing_version cv where cv.id = s.costing_version_id) pin on true
      left join lateral (select o.material_per_unit m, o.conversion_per_unit c
                from public.profit_product_cost_override o where o.product_id = s.product_id) ovr on true
      left join lateral (select cv.id cv, cv.material_cost/nullif(cv.qty_basis,0) m,
                (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0) c
                from public.costing_version cv where cv.product_id = s.product_id and cv.status='released'
                order by cv.version_number desc limit 1) rel on true
    ) cr on true
  ),
  fact as (
    select f.*,
      round(f.qty * coalesce(f.mat_per_unit,0), 2) material,
      round(f.qty * coalesce(f.conv_per_unit,0), 2) conversion,
      case when f.mat_per_unit is null then null
           else round(f.revenue - f.qty*coalesce(f.mat_per_unit,0) - f.qty*coalesce(f.conv_per_unit,0), 2) end gp,
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
        'gross_profit', coalesce(round(sum(gp),2),0),
        'gm_pct', case when sum(revenue) filter (where not uncosted) > 0
                    then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else 0 end,
        'orders', count(distinct order_id), 'lines', count(*),
        'uncosted_revenue', coalesce(round(sum(revenue) filter (where uncosted),2),0),
        'uncosted_lines', count(*) filter (where uncosted)) from fact),
    'by_customer', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select customer_code code, max(company_name) name, round(sum(revenue),2) revenue,
               round(sum(material),2) material, round(sum(conversion),2) conversion,
               round(sum(gp),2) gross_profit,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               round(sum(qty),2) qty, count(distinct order_id) orders, count(distinct product_id) products
        from fact group by customer_code) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select product_id, max(product_code) code, max(product_name) name, max(product_family) family,
               max(product_category) category, round(sum(revenue),2) revenue, round(sum(material),2) material,
               round(sum(conversion),2) conversion, round(sum(gp),2) gross_profit,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               round(sum(qty),2) qty, count(distinct customer_code) customers
        from fact group by product_id) x), '[]'::jsonb),
    'by_family', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select coalesce(product_family,'—') name, round(sum(revenue),2) revenue, round(sum(gp),2) gross_profit,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct
        from fact group by product_family) x), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select coalesce(product_category,'—') name, round(sum(revenue),2) revenue, round(sum(gp),2) gross_profit,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct
        from fact group by product_category) x), '[]'::jsonb),
    'by_sales_exec', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select case when sales_exec='' then '—' else sales_exec end name, round(sum(revenue),2) revenue,
               round(sum(gp),2) gross_profit,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               count(distinct order_id) orders
        from fact group by sales_exec) x), '[]'::jsonb),
    'by_order', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select order_id, max(so_number) so_number, max(customer_code) customer_code, max(company_name) company_name,
               round(sum(revenue),2) revenue, round(sum(material),2) material, round(sum(conversion),2) conversion,
               round(sum(gp),2) gross_profit,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct
        from fact group by order_id) x), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object(
          'month', ym, 'revenue', revenue, 'gross_profit', gross_profit, 'gm_pct', gm_pct) order by ym) from (
        select to_char(txn_date,'YYYY-MM') ym, round(sum(revenue),2) revenue, round(sum(gp),2) gross_profit,
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
