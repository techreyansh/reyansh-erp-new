-- Profitability demo data: CEO-triggered load/clear of a realistic gross-profit
-- dataset (5 products w/ released costings, 4 customers, ~36 sales orders across
-- ~4 months, varied margins incl. loss-makers). Tagged PICDEMO-* / PIC-DEMO-*
-- for one-click removal. CEO (is_super_admin) only.
BEGIN;

create or replace function public.profit_seed_demo()
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_cust  text[] := array['PICDEMOC1','PICDEMOC2','PICDEMOC3','PICDEMOC4'];
  v_cname text[] := array['Acme Appliances','Bharat Electricals','Crystal Devices','Deepak Industries'];
  v_owner text[] := array['abhishek@reyanshelectronics.com','crmripl49@gmail.com','pcripl51@gmail.com','abhishek@reyanshelectronics.com'];
  -- product specs: code,name,family,category,type, copper,pvc, labour,machine,overhead,financial, sp
  v_pid uuid[]; v_cv uuid[]; v_pcode text[]; v_sp numeric[];
  i int; o int; ci int; pi int;
  v_p uuid; v_c uuid; v_mat numeric; v_conv numeric;
  v_qty numeric; v_price numeric; v_factor numeric; v_date date; v_so uuid; v_son text;
  specs jsonb := '[
    {"code":"PICDEMO-1","name":"Demo Power Cord 1.5m","fam":"Power Cords","cat":"Power Cord","typ":"power_cord","cu":35,"pvc":25,"lab":12,"mac":8,"ovh":3,"fin":2,"sp":120},
    {"code":"PICDEMO-2","name":"Demo Power Cord 2m","fam":"Power Cords","cat":"Power Cord","typ":"power_cord","cu":48,"pvc":32,"lab":14,"mac":10,"ovh":4,"fin":2,"sp":135},
    {"code":"PICDEMO-3","name":"Demo 3-core Cable","fam":"Cables","cat":"Cable","typ":"cable","cu":130,"pvc":70,"lab":20,"mac":12,"ovh":5,"fin":3,"sp":300},
    {"code":"PICDEMO-4","name":"Demo Wiring Harness","fam":"Harnesses","cat":"Harness","typ":"harness","cu":90,"pvc":60,"lab":35,"mac":15,"ovh":6,"fin":4,"sp":235},
    {"code":"PICDEMO-5","name":"Demo Thin-Margin Cord","fam":"Power Cords","cat":"Power Cord","typ":"power_cord","cu":60,"pvc":40,"lab":28,"mac":14,"ovh":5,"fin":3,"sp":145}
  ]'::jsonb;
  spec jsonb;
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;
  if exists (select 1 from public.product where product_code like 'PICDEMO-%') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- customers
  for i in 1..4 loop
    insert into public.crm_pipeline (company_name, customer_code, kind, account_type, owner_email, is_active)
    values (v_cname[i], v_cust[i], 'recurring', 'client', v_owner[i], true);
  end loop;

  -- products + released costing (+ COPPER/PVC material lines for the breakdown)
  for i in 0..4 loop
    spec := specs->i;
    v_mat  := (spec->>'cu')::numeric + (spec->>'pvc')::numeric;
    v_conv := (spec->>'lab')::numeric + (spec->>'mac')::numeric + (spec->>'ovh')::numeric + (spec->>'fin')::numeric;
    insert into public.product (product_code, product_name, customer_code, company_name, product_family, product_category, product_type, status)
    values (spec->>'code', spec->>'name', v_cust[(i % 4)+1], v_cname[(i % 4)+1], spec->>'fam', spec->>'cat', spec->>'typ', 'production')
    returning id into v_p;
    insert into public.costing_version (product_id, version_number, status, material_cost, labour_cost, machine_cost,
        overhead_cost, financial_cost, total_cost, net_selling_price, qty_basis, uom, product_name)
    values (v_p, 1, 'released', v_mat, (spec->>'lab')::numeric, (spec->>'mac')::numeric, (spec->>'ovh')::numeric,
        (spec->>'fin')::numeric, v_mat+v_conv, (spec->>'sp')::numeric, 1, 'piece', spec->>'name')
    returning id into v_c;
    insert into public.costing_line (costing_id, section, category, material_code, qty, rate, amount) values
      (v_c, 'material', 'Copper', 'COPPER', 1, (spec->>'cu')::numeric, (spec->>'cu')::numeric),
      (v_c, 'material', 'PVC', 'PVC_INS', 1, (spec->>'pvc')::numeric, (spec->>'pvc')::numeric);
    v_pid  := array_append(v_pid, v_p);
    v_cv   := array_append(v_cv, v_c);
    v_pcode := array_append(v_pcode, spec->>'code');
    v_sp   := array_append(v_sp, (spec->>'sp')::numeric);
  end loop;

  -- ~36 sales orders spread over the last ~108 days
  for o in 1..36 loop
    ci := ((o-1) % 4) + 1;            -- customer
    pi := ((o-1) % 5) + 1;            -- product
    v_date := current_date - ((36 - o) * 3);
    v_qty  := 40 + ((o % 6) * 25);
    -- price factor: most profitable, every 7th is a loss (below cost)
    v_factor := case when (o % 7) = 0 then 0.82 when (o % 3) = 0 then 1.05 else 1.18 end;
    v_price := round(v_sp[pi] * v_factor, 2);
    v_son := 'PIC-DEMO-' || lpad(o::text, 3, '0');
    insert into public.sales_order (so_number, customer_code, company_name, owner_email, status, total_qty, total_value, created_at, released_at)
    values (v_son, v_cust[ci], v_cname[ci], v_owner[ci], 'released', v_qty, round(v_qty*v_price,2), v_date, v_date)
    returning id into v_so;
    insert into public.sales_order_line (so_id, product_id, product_code, product_name, qty, uom, unit_price, line_value, costing_version_id, sequence)
    values (v_so, v_pid[pi], v_pcode[pi], (specs->(pi-1)->>'name'), v_qty, 'pc', v_price, round(v_qty*v_price,2), v_cv[pi], 1);
  end loop;

  return jsonb_build_object('ok', true, 'products', 5, 'customers', 4, 'orders', 36);
end $fn$;
revoke all on function public.profit_seed_demo() from public, anon;
grant execute on function public.profit_seed_demo() to authenticated;

create or replace function public.profit_clear_demo()
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;
  delete from public.sales_order_line where so_id in (select id from public.sales_order where so_number like 'PIC-DEMO-%');
  delete from public.sales_order where so_number like 'PIC-DEMO-%';
  delete from public.costing_line where costing_id in
    (select id from public.costing_version where product_id in (select id from public.product where product_code like 'PICDEMO-%'));
  delete from public.profit_product_cost_override where product_id in (select id from public.product where product_code like 'PICDEMO-%');
  delete from public.costing_version where product_id in (select id from public.product where product_code like 'PICDEMO-%');
  delete from public.product where product_code like 'PICDEMO-%';
  delete from public.crm_pipeline where customer_code like 'PICDEMOC%';
  return jsonb_build_object('ok', true);
end $fn$;
revoke all on function public.profit_clear_demo() from public, anon;
grant execute on function public.profit_clear_demo() to authenticated;

COMMIT;
