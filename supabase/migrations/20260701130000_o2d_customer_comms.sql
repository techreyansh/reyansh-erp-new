-- O2D Workflow Engine — Phase 4b: customer milestone push comms.
-- Customer-facing email/WhatsApp at order milestones. Additive: a contact
-- resolver, a customer outbox table, and a wf_event-driven enqueue trigger.
-- The send side is the existing supabase/functions/task-notify worker (extended
-- to drain this table); a cron POSTs it (set up out-of-band, see
-- O2D_CUSTOMER_COMMS_SETUP.md). Nothing here turns on employee notifications.

-- ---------------------------------------------------------------------------
-- 1) Contact resolver: customer_code -> primary (email, phone, name).
--    crm_account_contacts (is_primary) with COALESCE fallback to crm_pipeline.
--    No DB guarantee of a single is_primary row, so order defensively.
-- ---------------------------------------------------------------------------
create or replace function public.wf_resolve_customer_contact(p_customer_code text)
returns table (email text, phone text, contact_name text)
language sql stable security definer set search_path = public as $$
  select
    coalesce(ac.email,     p.email)                        as email,
    coalesce(ac.phone,     p.phone)                        as phone,
    coalesce(ac.full_name, p.contact_person, p.company_name) as contact_name
  from public.crm_pipeline p
  left join lateral (
    select email, phone, full_name
    from public.crm_account_contacts
    where account_id = p.id
    order by is_primary desc nulls last, created_at
    limit 1
  ) ac on true
  where p.customer_code = p_customer_code
  limit 1;
$$;
grant execute on function public.wf_resolve_customer_contact(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Customer comms outbox. Same generic shape as task_notifications, but keyed
--    to the order/milestone (not a task), plus WhatsApp template fields.
-- ---------------------------------------------------------------------------
create table if not exists public.wf_customer_comms (
  id              uuid primary key default gen_random_uuid(),
  instance_id     uuid references public.wf_instance(id) on delete cascade,
  so_number       text,
  customer_code   text,
  milestone       text not null
                    check (milestone in ('order_confirmed','in_production','dispatched')),
  channel         text not null check (channel in ('email','whatsapp')),
  recipient_email text,
  recipient_phone text,
  recipient_name  text,
  subject         text,
  body            text,
  template_name   text,                       -- WhatsApp business-initiated template
  template_params jsonb not null default '[]'::jsonb,
  scheduled_for   timestamptz not null default now(),
  status          text not null default 'pending'
                    check (status in ('pending','sent','failed','skipped','cancelled')),
  attempts        int not null default 0,
  sent_at         timestamptz,
  error           text,
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  created_at      timestamptz not null default now()
);
create index if not exists idx_wf_customer_comms_status_sched
  on public.wf_customer_comms (status, scheduled_for);
create index if not exists idx_wf_customer_comms_instance
  on public.wf_customer_comms (instance_id);

-- RLS: CEO-only for staff reads (recipients are customers, not app users); the
-- service-role drain worker bypasses RLS entirely.
alter table public.wf_customer_comms enable row level security;
do $rls$ begin
  if not exists (select 1 from pg_policies
                 where tablename='wf_customer_comms' and policyname='wf_customer_comms_super') then
    create policy wf_customer_comms_super on public.wf_customer_comms
      for all to authenticated
      using (public.is_super_admin()) with check (public.is_super_admin());
  end if;
end $rls$;
grant select, insert, update on public.wf_customer_comms to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Enqueue trigger on wf_event. Each milestone maps to ONE specific event so
--    the timing reads right to a customer (in_production fires when the order
--    ENTERS production, not when production finishes). Idempotent + forward-only.
-- ---------------------------------------------------------------------------
create or replace function public.wf_customer_comms_enqueue()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_milestone text;
  v_inst      record;
  v_c         record;
  v_subject   text;
  v_body      text;
  v_seller    text := 'Reyansh International';
begin
  -- cheap early-out: only three (event_type, stage_key) pairs are milestones.
  if    NEW.event_type = 'stage_done'    and NEW.stage_key = 'sales_order'         then v_milestone := 'order_confirmed';
  elsif NEW.event_type = 'stage_started' and NEW.stage_key = 'production_planning' then v_milestone := 'in_production';
  elsif NEW.event_type = 'stage_done'    and NEW.stage_key = 'dispatch'            then v_milestone := 'dispatched';
  else return NEW;
  end if;

  select * into v_inst from public.wf_instance where id = NEW.instance_id;
  if not found or v_inst.customer_code is null then return NEW; end if;

  select * into v_c from public.wf_resolve_customer_contact(v_inst.customer_code);
  if v_c.email is null and v_c.phone is null then return NEW; end if;

  -- inline message (same style as tasks_enqueue_notifications)
  v_subject := case v_milestone
    when 'order_confirmed' then 'Order ' || coalesce(v_inst.so_number,'') || ' confirmed'
    when 'in_production'   then 'Your order ' || coalesce(v_inst.so_number,'') || ' is now in production'
    when 'dispatched'      then 'Order ' || coalesce(v_inst.so_number,'') || ' has been dispatched'
  end;
  v_body := 'Dear ' || coalesce(v_c.contact_name,'Customer') || ',' || E'\n\n' ||
    case v_milestone
      when 'order_confirmed' then 'We have received and confirmed your order ' || coalesce(v_inst.so_number,'') || '. We will keep you updated as it moves through production.'
      when 'in_production'   then 'Good news — your order ' || coalesce(v_inst.so_number,'') || ' has entered production.'
      when 'dispatched'      then 'Your order ' || coalesce(v_inst.so_number,'') || ' has been dispatched. Thank you for your business.'
    end ||
    E'\n\nRegards,\n' || v_seller;

  -- email row
  if v_c.email is not null then
    insert into public.wf_customer_comms
      (instance_id, so_number, customer_code, milestone, channel, recipient_email, recipient_name, subject, body, idempotency_key)
    values
      (NEW.instance_id, v_inst.so_number, v_inst.customer_code, v_milestone, 'email', v_c.email, v_c.contact_name, v_subject, v_body,
       NEW.instance_id::text || ':' || v_milestone || ':email')
    on conflict (idempotency_key) do nothing;
  end if;

  -- whatsapp row (business-initiated -> template; params [name, so_number])
  if v_c.phone is not null then
    insert into public.wf_customer_comms
      (instance_id, so_number, customer_code, milestone, channel, recipient_phone, recipient_name, subject, body, template_name, template_params, idempotency_key)
    values
      (NEW.instance_id, v_inst.so_number, v_inst.customer_code, v_milestone, 'whatsapp', v_c.phone, v_c.contact_name, v_subject, v_body,
       'order_' || v_milestone,
       jsonb_build_array(coalesce(v_c.contact_name,'Customer'), coalesce(v_inst.so_number,'')),
       NEW.instance_id::text || ':' || v_milestone || ':whatsapp')
    on conflict (idempotency_key) do nothing;
  end if;

  return NEW;
end $$;

drop trigger if exists trg_wf_customer_comms_enqueue on public.wf_event;
create trigger trg_wf_customer_comms_enqueue
  after insert on public.wf_event
  for each row execute function public.wf_customer_comms_enqueue();
