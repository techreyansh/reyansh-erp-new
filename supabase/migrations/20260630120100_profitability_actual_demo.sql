-- Actual-GP demo data (CEO): for 2 existing PICDEMO products, create a finished
-- work order + real MFG_CONSUME ledger rows + an invoice, so the Expected-vs-Actual
-- engine has actuals to show — one at-standard (green) and one with a material
-- overrun (red). Tagged for one-click clear. Requires profit_seed_demo() first.
BEGIN;

create or replace function public.profit_seed_actual_demo()
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_loc uuid; v_p record; v_item uuid; v_wo uuid; v_inv uuid; v_soline uuid;
  v_overrun numeric; v_qty numeric; v_matpu numeric; v_sp numeric; n int := 0;
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;
  select id into v_loc from public.inv_location order by code limit 1;
  if v_loc is null then raise exception 'no inv_location'; end if;

  for v_p in
    select p.id, p.product_code, p.product_name,
           cv.material_cost matpu, cv.net_selling_price sp
    from public.product p
    join public.costing_version cv on cv.product_id = p.id and cv.status='released'
    where p.product_code in ('PICDEMO-1','PICDEMO-3')
  loop
    n := n + 1;
    v_qty := 400;
    v_matpu := v_p.matpu;
    v_sp := v_p.sp;
    -- PICDEMO-3 overruns material by 20% (red); PICDEMO-1 at standard (green)
    v_overrun := case when v_p.product_code = 'PICDEMO-3' then 1.20 else 1.00 end;

    -- ppc_item for the product (link product.ppc_item_id)
    insert into public.ppc_items (code, name, item_type, uom)
    values (v_p.product_code || '-ITM', v_p.product_name, 'finished_good', 'pcs')
    returning id into v_item;
    update public.product set ppc_item_id = v_item where id = v_p.id;

    -- a finished work order, linked to one of the product's sales-order lines
    select l.id into v_soline from public.sales_order_line l where l.product_id = v_p.id limit 1;
    insert into public.ppc_wo (wo_number, item_id, qty, status, produced_qty, so_line_id, created_at)
    values ('PIC-DEMO-WO-' || n, v_item, v_qty, 'done', v_qty, v_soline, current_date - 10)
    returning id into v_wo;

    -- actual material consumption (real COGS) — MFG_CONSUME, value at the overrun rate
    insert into public.inv_ledger (item_id, location_id, movement_type, qty_delta, qty_after,
        valuation_rate, value_delta, value_after, ref_type, ref_id, reason, posted_at)
    values (v_item, v_loc, 'MFG_CONSUME', -v_qty, 0,
        round(v_matpu*v_overrun,2), -round(v_qty*v_matpu*v_overrun,2), 0,
        'work_order', v_wo::text, 'PIC demo consumption', current_date - 9);

    -- actual revenue: an invoice for the product (at list SP)
    insert into public.finance_invoices (invoice_number, customer_code, customer_name, invoice_date, amount, status)
    values ('PIC-DEMO-INV-' || n, 'PICDEMOC1', 'Acme Appliances', current_date - 8, round(v_qty*v_sp,2), 'NEW')
    returning id into v_inv;
    insert into public.finance_invoice_line (invoice_id, product_code, product_name, qty, rate, taxable_value, amount)
    values (v_inv, v_p.product_code, v_p.product_name, v_qty, v_sp, round(v_qty*v_sp,2), round(v_qty*v_sp,2));
  end loop;

  return jsonb_build_object('ok', true, 'products', n);
end $fn$;
revoke all on function public.profit_seed_actual_demo() from public, anon;
grant execute on function public.profit_seed_actual_demo() to authenticated;

-- Extend the clear to remove the actual-demo rows too.
create or replace function public.profit_clear_demo()
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;
  -- actual-demo artifacts
  delete from public.finance_invoice_line where invoice_id in (select id from public.finance_invoices where invoice_number like 'PIC-DEMO-INV-%');
  delete from public.finance_invoices where invoice_number like 'PIC-DEMO-INV-%';
  delete from public.inv_ledger where ref_id in (select id::text from public.ppc_wo where wo_number like 'PIC-DEMO-WO-%');
  delete from public.ppc_wo where wo_number like 'PIC-DEMO-WO-%';
  delete from public.ppc_items where code like 'PICDEMO-%-ITM';
  -- core demo
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
