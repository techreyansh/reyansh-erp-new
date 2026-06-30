-- O2D Workflow Engine — Phase 4B: surface order milestones in the customer portal.
-- create-or-replace portal_get_data, PRESERVING every existing key
-- (customer / orders / invoices / dispatches) byte-for-byte and ADDING one new
-- key `workflows`: per active workflow for this customer, a customer-friendly
-- 4-milestone tracker derived from wf_stage_run. No secrets, no new tables.

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
      from finance_invoices where customer_code = v_code and status <> 'cancelled'), '[]'::jsonb),
    'dispatches', coalesce((select jsonb_agg(jsonb_build_object(
      'so_number', so_number, 'dispatch_date', dispatch_date, 'status', status,
      'readiness', readiness, 'actual_dispatch_date', actual_dispatch_date) order by dispatch_date desc)
      from dispatch_plan where customer_code = v_code), '[]'::jsonb),

    -- NEW: per-order milestone tracker (collapses the internal 11-stage workflow
    -- into 4 customer-facing milestones). state: done | active | pending.
    'workflows', coalesce((select jsonb_agg(jsonb_build_object(
        'so_number', wi.so_number,
        'status', wi.status,
        'current_stage', wi.current_stage,
        'milestones', (
          -- inner query rolls the underlying stage runs up to one row per public
          -- milestone (state + completed time); outer jsonb_agg can't nest the
          -- bool_or/max aggregates, so they live one level down.
          select jsonb_agg(jsonb_build_object('label', t.label, 'state', t.state, 'at', t.at) order by t.seq)
          from (
            select m.seq, m.label,
                   case
                     -- currently being worked → active (checked first so a
                     -- partially-complete phase doesn't read as fully done)
                     when bool_or(r.status in ('ready','in_progress')) then 'active'
                     -- every stage in this phase that exists is done/skipped → done
                     when bool_or(r.status = 'done')
                          and not bool_or(r.status in ('blocked','ready','in_progress')) then 'done'
                     -- some done but others still blocked → still active
                     when bool_or(r.status = 'done') then 'active'
                     else 'pending' end as state,
                   max(r.completed_at) filter (where r.status = 'done') as at
            from (values
                    (1, 'Order confirmed', array['sales_order']),
                    (2, 'In production',    array['production_planning','store_issue','cable','assembly','molding']),
                    (3, 'Packed',           array['packing','fg']),
                    (4, 'Dispatched',       array['dispatch'])
                 ) as m(seq, label, keys)
            left join wf_stage_run r on r.instance_id = wi.id and r.stage_key = any(m.keys)
            group by m.seq, m.label
          ) t
        )
      ) order by wi.started_at desc)
      from wf_instance wi where wi.customer_code = v_code), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

grant execute on function public.portal_get_data(text) to anon, authenticated;
