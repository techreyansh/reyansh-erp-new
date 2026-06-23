-- Client Pipeline redesign — FOUNDATION.
-- 12 DB-constrained operational stages + a stage-definition table (labels,
-- order, colour, per-stage action sets, next-action requirement), mandatory
-- next-action columns, and crm_client_cards() — one RPC that powers the kanban
-- cards (stage, owner, health, revenue, outstanding, last-contact, next-action,
-- is_unmanaged) so the board needs no N+1 round-trips.

-- 1) Mandatory next-action columns (action text + date already exist).
alter table public.crm_pipeline
  add column if not exists next_action_owner_email text,
  add column if not exists next_action_priority text default 'normal',
  add column if not exists current_status text;

-- 2) Constrain the 12 client operational stages.
update public.crm_pipeline set pipeline_stage = 'active'
  where account_type = 'client' and (pipeline_stage is null or btrim(pipeline_stage) = '');
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'crm_pipeline_pipeline_stage_check') then
    alter table public.crm_pipeline drop constraint crm_pipeline_pipeline_stage_check;
  end if;
end $$;
alter table public.crm_pipeline add constraint crm_pipeline_pipeline_stage_check
  check (pipeline_stage is null or pipeline_stage in (
    'active','follow_up','quotation','order_expected','order_received','production',
    'dispatch_pending','invoice_raised','payment_followup','repeat_opportunity','dormant','lost'));

-- 3) Stage-definition table (single source of truth; admins can extend later).
create table if not exists public.crm_client_stage_def (
  stage_key text primary key,
  label text not null,
  sort_order int not null,
  color text,
  requires_next_action boolean default true,
  action_set jsonb default '[]'::jsonb
);
alter table public.crm_client_stage_def enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='crm_client_stage_def' and policyname='csd_read') then
    create policy csd_read on public.crm_client_stage_def for select using (true);
  end if;
end $$;

-- Seed the 12 stages + the user's exact per-stage action lists.
insert into public.crm_client_stage_def (stage_key,label,sort_order,color,requires_next_action,action_set) values
('active','Active',10,'#2e7d32',true,'[{"key":"call","label":"Call Client","kind":"call"},{"key":"whatsapp","label":"Send WhatsApp","kind":"whatsapp"},{"key":"note","label":"Add Note","kind":"note"},{"key":"forecast","label":"Ask for Forecast","kind":"activity"}]'),
('follow_up','Follow-Up Required',20,'#ed6c02',true,'[{"key":"call","label":"Call Client","kind":"call"},{"key":"whatsapp","label":"Send WhatsApp","kind":"whatsapp"},{"key":"email","label":"Send Email","kind":"email"},{"key":"meeting","label":"Schedule Meeting","kind":"meeting"},{"key":"note","label":"Add Note","kind":"note"}]'),
('quotation','Quotation Under Discussion',30,'#0288d1',true,'[{"key":"revquote","label":"Send Revised Quote","kind":"activity"},{"key":"pricing","label":"Discuss Pricing","kind":"call"},{"key":"review","label":"Schedule Review Call","kind":"meeting"},{"key":"feedback","label":"Record Feedback","kind":"note"}]'),
('order_expected','Order Expected',40,'#0288d1',true,'[{"key":"confirm","label":"Confirm Order","kind":"call"},{"key":"reminder","label":"Send Reminder","kind":"whatsapp"},{"key":"askpo","label":"Ask for PO","kind":"email"},{"key":"forecast","label":"Ask for Forecast","kind":"activity"}]'),
('order_received','Order Received',50,'#7b1fa2',true,'[{"key":"createso","label":"Create Sales Order","kind":"navigate","to":"/sales-orders"},{"key":"uploadpo","label":"Upload PO","kind":"navigate","to":"/po-ingestion"},{"key":"assignppc","label":"Assign To PPC","kind":"navigate","to":"/ppc"},{"key":"prodnotes","label":"Add Production Notes","kind":"note"}]'),
('production','Production Running',60,'#7b1fa2',true,'[{"key":"track","label":"Track Production","kind":"navigate","to":"/ppc"},{"key":"update","label":"Update Customer","kind":"whatsapp"},{"key":"dispatchdate","label":"Check Dispatch Date","kind":"activity"}]'),
('dispatch_pending','Dispatch Pending',70,'#c2185b',true,'[{"key":"coordinate","label":"Coordinate Dispatch","kind":"navigate","to":"/dispatch"},{"key":"sharedetails","label":"Share Dispatch Details","kind":"whatsapp"},{"key":"confirmdelivery","label":"Confirm Delivery","kind":"call"}]'),
('invoice_raised','Invoice Raised',80,'#5d4037',true,'[{"key":"sendinvoice","label":"Send Invoice","kind":"email"},{"key":"confirmreceipt","label":"Confirm Receipt","kind":"call"},{"key":"verifyacc","label":"Verify Accounts Contact","kind":"note"}]'),
('payment_followup','Payment Follow-Up',90,'#d32f2f',true,'[{"key":"callacc","label":"Call Accounts Team","kind":"call"},{"key":"statement","label":"Send Statement","kind":"email"},{"key":"reminder","label":"Send Reminder","kind":"whatsapp"},{"key":"commitment","label":"Record Payment Commitment","kind":"activity"},{"key":"escalate","label":"Escalate Payment","kind":"escalate"}]'),
('repeat_opportunity','Repeat Order Opportunity',100,'#2e7d32',true,'[{"key":"forecast","label":"Ask for July Forecast","kind":"activity"},{"key":"reorder","label":"Propose Reorder","kind":"call"},{"key":"newproducts","label":"Share New Products","kind":"whatsapp"},{"key":"visit","label":"Schedule Plant Visit","kind":"meeting"}]'),
('dormant','Dormant',110,'#757575',true,'[{"key":"reengage","label":"Re-engage Call","kind":"call"},{"key":"offer","label":"Send Offer","kind":"whatsapp"},{"key":"visit","label":"Schedule Visit","kind":"meeting"},{"key":"note","label":"Add Note","kind":"note"}]'),
('lost','Lost / Inactive',120,'#9e9e9e',false,'[{"key":"reason","label":"Log Lost Reason","kind":"note"},{"key":"winback","label":"Win-back Attempt","kind":"call"}]')
on conflict (stage_key) do update set
  label=excluded.label, sort_order=excluded.sort_order, color=excluded.color,
  requires_next_action=excluded.requires_next_action, action_set=excluded.action_set;

-- 4) crm_client_cards(owner) — per-client card payload for the board.
create or replace function public.crm_client_cards(p_owner_email text default null)
returns jsonb language sql security definer set search_path to 'public' as $function$
with health as (select h from jsonb_array_elements(public.crm_client_health()) h),
hp as (
  select lower(h->>'customer_code') code,
         nullif(h->>'health_score','')::numeric health_score,
         h->>'band' band,
         coalesce((h->>'value_12mo')::numeric,0) revenue,
         coalesce((h->>'overdue_balance')::numeric,0) overdue_balance,
         coalesce((h->>'open_complaints')::int,0) open_complaints,
         coalesce((h->>'order_count')::int,0) order_count,
         h->'components' components
  from health),
ar as (
  select lower(customer_code) code, sum(balance) outstanding,
         sum(case when ar_status='overdue' then balance else 0 end) overdue
  from public.v_ar_invoices where coalesce(ar_status,'') <> 'paid' group by lower(customer_code)),
la as (select pipeline_id, max(activity_at) last_at from public.crm_pipeline_activity group by pipeline_id)
select coalesce(jsonb_agg(jsonb_build_object(
  'id', p.id, 'customer_code', p.customer_code, 'company_name', p.company_name,
  'owner_email', p.owner_email, 'pipeline_stage', coalesce(p.pipeline_stage,'active'), 'client_stage', p.client_stage,
  'industry', p.industry, 'city', p.city,
  'next_action', p.next_action, 'next_action_date', p.next_action_date,
  'next_action_owner_email', p.next_action_owner_email,
  'next_action_priority', coalesce(p.next_action_priority,'normal'), 'current_status', p.current_status,
  'health_score', hp.health_score, 'band', hp.band, 'health_components', hp.components,
  'revenue', coalesce(hp.revenue,0),
  'outstanding', coalesce(ar.outstanding, hp.overdue_balance, 0),
  'overdue', coalesce(ar.overdue, hp.overdue_balance, 0),
  'open_complaints', coalesce(hp.open_complaints,0), 'order_count', coalesce(hp.order_count,0),
  'last_activity_at', la.last_at,
  'days_since_contact', (current_date - coalesce(la.last_at::date, p.last_contact_date))::int,
  'is_unmanaged', (p.next_action is null or btrim(coalesce(p.next_action,''))='')
) order by (p.next_action is null or btrim(coalesce(p.next_action,''))='') desc, p.company_name), '[]'::jsonb)
from public.crm_pipeline p
left join hp on hp.code = lower(p.customer_code)
left join ar on ar.code = lower(p.customer_code)
left join la on la.pipeline_id = p.id
where p.account_type='client'
  and (p_owner_email is null or lower(coalesce(p.owner_email,''))=lower(p_owner_email) or p.owner_email is null
       or exists (select 1 from public.crm_pipeline_collaborators c where c.pipeline_id=p.id and lower(c.email)=lower(p_owner_email)));
$function$;

grant execute on function public.crm_client_cards(text) to authenticated;
