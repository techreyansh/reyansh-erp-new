-- Client Pipeline — Payment Follow-Up tracking + Payment Dashboard.
-- Per-invoice collection fields + ar_payment_dashboard() (outstanding, due this
-- week, overdue, critical, aging, forecast, top debtors, invoice list).
alter table public.finance_invoices
  add column if not exists payment_commitment_date date,
  add column if not exists collection_status text default 'pending',
  add column if not exists collection_owner_email text,
  add column if not exists collection_notes text;

create or replace function public.ar_payment_dashboard()
returns jsonb language sql security definer set search_path to 'public' as $function$
with inv as (
  select v.*, f.payment_commitment_date, f.collection_status, f.collection_owner_email
  from public.v_ar_invoices v join public.finance_invoices f on f.id = v.id
  where coalesce(v.ar_status,'') <> 'paid')
select jsonb_build_object(
  'total_outstanding', coalesce((select sum(balance) from inv),0),
  'invoice_count', (select count(*) from inv),
  'due_this_week', coalesce((select sum(balance) from inv where due_date between current_date and current_date+7),0),
  'overdue_amount', coalesce((select sum(balance) from inv where coalesce(days_past_due,0) > 0),0),
  'overdue_count', (select count(*) from inv where coalesce(days_past_due,0) > 0),
  'critical_amount', coalesce((select sum(balance) from inv where coalesce(days_past_due,0) > 60),0),
  'critical_count', (select count(*) from inv where coalesce(days_past_due,0) > 60),
  'aging', jsonb_build_object(
    'current', coalesce((select sum(balance) from inv where coalesce(days_past_due,0) <= 0),0),
    'd1_30', coalesce((select sum(balance) from inv where days_past_due between 1 and 30),0),
    'd31_60', coalesce((select sum(balance) from inv where days_past_due between 31 and 60),0),
    'd61_90', coalesce((select sum(balance) from inv where days_past_due between 61 and 90),0),
    'd90_plus', coalesce((select sum(balance) from inv where days_past_due > 90),0)),
  'forecast', (select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'amount', amt) order by wk),'[]'::jsonb)
    from (select date_trunc('week', payment_commitment_date)::date wk, sum(balance) amt
          from inv where payment_commitment_date is not null group by 1) g),
  'top_debtors', (select coalesce(jsonb_agg(jsonb_build_object('customer_code',code,'customer_name',nm,'outstanding',os,'max_dpd',dpd) order by os desc),'[]'::jsonb)
    from (select customer_code code, max(customer_name) nm, sum(balance) os, max(days_past_due) dpd
          from inv group by customer_code order by sum(balance) desc limit 12) t),
  'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'invoice_number',invoice_number,'invoice_date',invoice_date,'amount',amount,'balance',balance,
      'due_date',due_date,'days_past_due',days_past_due,'ar_status',ar_status,'customer_code',customer_code,
      'customer_name',customer_name,'owner_email',owner_email,'payment_commitment_date',payment_commitment_date,
      'collection_status',coalesce(collection_status,'pending'),'collection_owner_email',collection_owner_email)
      order by days_past_due desc nulls last),'[]'::jsonb) from inv)
);
$function$;

create or replace function public.ar_update_collection(p_invoice uuid, p_commitment date default null, p_status text default null, p_owner text default null, p_notes text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update public.finance_invoices set
    payment_commitment_date = coalesce(p_commitment, payment_commitment_date),
    collection_status = coalesce(p_status, collection_status),
    collection_owner_email = coalesce(p_owner, collection_owner_email),
    collection_notes = coalesce(p_notes, collection_notes),
    updated_at = now()
  where id = p_invoice;
end $function$;

grant execute on function public.ar_payment_dashboard() to authenticated;
grant execute on function public.ar_update_collection(uuid,date,text,text,text) to authenticated;
