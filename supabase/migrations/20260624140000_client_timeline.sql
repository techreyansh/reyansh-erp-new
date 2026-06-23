-- Client Pipeline — unified chronological timeline. One RPC unions every event
-- source for an account so a manager sees the whole history without opening
-- individual records: activities (calls/meetings/WA/emails/notes), stage moves,
-- quotations, orders (cycle), invoices, payments, complaints, KIT messages.
create or replace function public.crm_client_timeline(p_account_id uuid, p_customer_code text default null)
returns jsonb language sql security definer set search_path to 'public' as $function$
with ev as (
  select a.activity_at at, coalesce(a.activity_type,'note') kind,
         coalesce(nullif(a.subject,''), initcap(coalesce(a.activity_type,'Note'))) title, a.body detail, a.owner_email owner
  from public.crm_pipeline_activity a where a.pipeline_id = p_account_id
  union all
  select h.moved_at, 'stage', 'Stage: '||coalesce(h.from_stage,'—')||' → '||coalesce(h.to_stage,'—'), h.note, h.moved_by_email
  from public.crm_pipeline_history h where h.pipeline_id = p_account_id
  union all
  select coalesce(q.quote_date::timestamptz, q.created_at), 'quotation',
         'Quotation '||coalesce(q.quote_number,'')||' ('||coalesce(q.status,'')||')', 'Total '||coalesce(q.total::text,'—'), q.owner_email
  from public.crm_quotations q where q.account_id = p_account_id
  union all
  select coalesce(o.order_date::timestamptz, o.updated_at, o.created_at), 'order',
         'Order '||coalesce(o.order_number,'')||' · '||coalesce(o.cycle_stage,''), 'Amount '||coalesce(o.amount::text,'—'), o.owner_email
  from public.crm_order_cycle o where p_customer_code is not null and lower(o.customer_code) = lower(p_customer_code)
  union all
  select i.invoice_date::timestamptz, 'invoice', 'Invoice '||coalesce(i.invoice_number,''), 'Amount '||coalesce(i.amount::text,'—'), i.owner_email
  from public.finance_invoices i where p_customer_code is not null and lower(i.customer_code) = lower(p_customer_code)
  union all
  select p.paid_on::timestamptz, 'payment', 'Payment received ('||coalesce(p.method,'')||')', 'Amount '||coalesce(p.amount::text,'—'), p.created_by_email
  from public.ar_payments p join public.finance_invoices fi on fi.id = p.invoice_id
  where p_customer_code is not null and lower(fi.customer_code) = lower(p_customer_code)
  union all
  select c.created_at, 'complaint', 'Complaint: '||coalesce(c.subject,'')||' ('||coalesce(c.severity,'')||')', c.description, c.owner_email
  from public.crm_complaints c where c.account_id = p_account_id
  union all
  select coalesce(k.sent_at, k.created_at), 'kit',
         'KIT '||coalesce(k.channel,'')||' '||coalesce(k.direction,'')||coalesce(' · '||nullif(k.subject,''),''), k.body, k.owner_email
  from public.kit_messages k where k.account_id = p_account_id
)
select coalesce(jsonb_agg(jsonb_build_object('at',at,'kind',kind,'title',title,'detail',detail,'owner',owner) order by at desc), '[]'::jsonb)
from ev where at is not null;
$function$;
grant execute on function public.crm_client_timeline(uuid,text) to authenticated;
