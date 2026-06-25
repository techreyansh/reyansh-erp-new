-- Allow CANCELLED invoices (matches the uppercase AR status convention) and
-- align the portal RPC to exclude cancelled invoices in the correct case.
alter table public.finance_invoices drop constraint if exists finance_invoices_status_check;
alter table public.finance_invoices add constraint finance_invoices_status_check
  check (status = any (array['DRAFT','ISSUED','PAID','PARTIAL','OVERDUE','CANCELLED']));

create or replace function public.portal_get_data(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text; v_company text; v_result jsonb;
begin
  select customer_code, company_name into v_code, v_company
  from customer_portal_access where token = p_token and is_active = true;
  if v_code is null then return jsonb_build_object('error', 'invalid_token'); end if;
  update customer_portal_access set last_accessed_at = now() where token = p_token;

  select jsonb_build_object(
    'customer', jsonb_build_object(
      'code', v_code,
      'name', coalesce(v_company, (select "ClientName" from clients2 where "ClientCode" = v_code limit 1)),
      'gstin', (select "GSTIN" from clients2 where "ClientCode" = v_code limit 1),
      'state', (select "State" from clients2 where "ClientCode" = v_code limit 1)
    ),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
      'so_number', so_number, 'status', status, 'total_value', total_value, 'po_number', po_number,
      'expected_dispatch_date', expected_dispatch_date, 'created_at', created_at) order by created_at desc)
      from sales_order where customer_code = v_code), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object(
      'invoice_number', invoice_number, 'invoice_date', invoice_date, 'amount', amount,
      'balance', balance, 'status', status, 'due_date', due_date) order by invoice_date desc)
      from finance_invoices where customer_code = v_code and status <> 'CANCELLED'), '[]'::jsonb),
    'dispatches', coalesce((select jsonb_agg(jsonb_build_object(
      'so_number', so_number, 'dispatch_date', dispatch_date, 'status', status,
      'readiness', readiness, 'actual_dispatch_date', actual_dispatch_date) order by dispatch_date desc)
      from dispatch_plan where customer_code = v_code), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
grant execute on function public.portal_get_data(text) to anon, authenticated;
