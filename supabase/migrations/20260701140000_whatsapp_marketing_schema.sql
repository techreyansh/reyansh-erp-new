-- WhatsApp Marketing module — core schema (Task 1 of 12).
-- A self-contained outbound-WhatsApp engine, modeled on the email_campaigns
-- module (20260613130000_email_campaigns.sql) but keyed on WhatsApp numbers:
--   wa_import_batches  : provenance for CSV/Excel/paste imports
--   wa_contacts         : unified audience, deduped by lower(whatsapp_number)
--   wa_provider_settings: one row per configured BSP (meta_cloud/twilio/...)
--   wa_campaigns        : a drip sequence with business-hours guardrails
--   wa_campaign_steps    : ordered steps in a sequence
--   wa_campaign_media    : media attachments per campaign/step (Storage refs)
--   wa_enrollments       : a contact's run through a campaign
--   wa_messages          : per-send log, provider status, and the Live Monitor
--   wa_events            : inbound/outbound delivery + reply audit trail
--
-- This migration is schema-only: NO RLS and NO RBAC module registration here.
-- Task 2 (a follow-up migration) enables RLS with the standard two-policy
-- split (rbac_employee_can('marketing', 'view'|'edit')) on every table below
-- except wa_provider_settings (CEO/is_super_admin()-only), and registers the
-- 'marketing' module + role grants. Every table here is left RLS-free but
-- otherwise fully shaped so that follow-up can be a pure "enable + policy"
-- migration with no schema changes.
--
-- Reuses helpers already live in this project: public.rbac_employee_can(),
-- public.is_super_admin(), public.rbac_current_email() (see
-- 20260623150000_rbac_honor_role_perms.sql). No new helper functions needed.
-- Idempotent: safe to re-run.

begin;

create extension if not exists pgcrypto;

-- =============================================================================
-- Tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. wa_import_batches — provenance for CSV/Excel/paste uploads
-- ---------------------------------------------------------------------------
create table if not exists public.wa_import_batches (
  id             uuid primary key default gen_random_uuid(),
  name           text,
  filename       text,
  source         text check (source in ('csv', 'excel', 'paste', 'manual')),
  total_rows     int default 0,
  imported_rows  int default 0,
  skipped_rows   int default 0,
  notes          text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. wa_contacts — the audience, deduped by WhatsApp number
-- ---------------------------------------------------------------------------
create table if not exists public.wa_contacts (
  id               uuid primary key default gen_random_uuid(),
  company          text,
  contact_name     text not null,
  whatsapp_number  text not null,
  email            text,
  owner_email      text,
  tags             text[] not null default '{}',
  source           text not null default 'manual'
                     check (source in ('manual', 'csv', 'excel', 'paste',
                                       'crm_customer', 'crm_prospect',
                                       'client_group', 'custom_list', 'api')),
  attributes       jsonb not null default '{}'::jsonb,
  -- V1.5 seam: will eventually link back to a CRM account, but nothing reads
  -- or writes this in V1 — deliberately no FK so this module stays decoupled.
  crm_account_id   uuid,
  opt_out          boolean not null default false,
  import_batch_id  uuid references public.wa_import_batches(id) on delete set null,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- one row per WhatsApp number (case-insensitive)
create unique index if not exists wa_contacts_number_uidx
  on public.wa_contacts (lower(whatsapp_number));
create index if not exists wa_contacts_tags_gin_idx
  on public.wa_contacts using gin (tags);
create index if not exists wa_contacts_owner_email_idx
  on public.wa_contacts (owner_email);

-- ---------------------------------------------------------------------------
-- 3. wa_provider_settings — configured BSPs (Meta Cloud API, Twilio, ...)
-- ---------------------------------------------------------------------------
create table if not exists public.wa_provider_settings (
  id                     uuid primary key default gen_random_uuid(),
  provider_key           text not null
                           check (provider_key in ('meta_cloud', 'twilio', 'interakt',
                                                    'aisensy', 'wati', '360dialog')),
  label                  text,
  is_active              boolean not null default false,
  credentials            jsonb not null default '{}'::jsonb,
  sender_number          text,
  mode                   text not null default 'live'
                           check (mode in ('live', 'sandbox')),
  rate_limit_per_minute  int not null default 60,
  last_health_check_at   timestamptz,
  health_status          text,
  health_reason          text,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. wa_campaigns — a drip sequence definition
-- ---------------------------------------------------------------------------
create table if not exists public.wa_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  description           text,
  category              text,
  owner_email           text,
  status                text not null default 'draft'
                          check (status in ('draft', 'scheduled', 'running', 'paused',
                                            'completed', 'stopped', 'failed')),
  start_at              timestamptz,
  business_hours_start  smallint not null default 9  check (business_hours_start between 0 and 23),
  business_hours_end    smallint not null default 18 check (business_hours_end between 0 and 23),
  working_days_only     boolean not null default true,
  provider_id           uuid references public.wa_provider_settings(id) on delete set null,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists wa_campaigns_status_idx on public.wa_campaigns (status);

-- ---------------------------------------------------------------------------
-- 5. wa_campaign_steps — ordered steps in a sequence
-- ---------------------------------------------------------------------------
create table if not exists public.wa_campaign_steps (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.wa_campaigns(id) on delete cascade,
  step_order   int not null,
  delay_type   text not null default 'immediate'
                 check (delay_type in ('immediate', 'after_days')),
  delay_days   int not null default 0 check (delay_days >= 0),
  body_text    text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (campaign_id, step_order)
);
create index if not exists wa_campaign_steps_campaign_idx
  on public.wa_campaign_steps (campaign_id);

-- ---------------------------------------------------------------------------
-- 6. wa_campaign_media — media attachments (Supabase Storage refs)
-- ---------------------------------------------------------------------------
create table if not exists public.wa_campaign_media (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.wa_campaigns(id) on delete cascade,
  step_id      uuid references public.wa_campaign_steps(id) on delete set null,
  storage_path text not null,
  file_name    text,
  mime_type    text,
  category     text check (category in ('image', 'video', 'document', 'audio', 'other')),
  sort_order   int not null default 0,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists wa_campaign_media_campaign_idx
  on public.wa_campaign_media (campaign_id);

-- ---------------------------------------------------------------------------
-- 7. wa_enrollments — a contact's run through a campaign
-- ---------------------------------------------------------------------------
create table if not exists public.wa_enrollments (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.wa_campaigns(id) on delete cascade,
  contact_id     uuid not null references public.wa_contacts(id) on delete cascade,
  status         text not null default 'active'
                   check (status in ('active', 'completed', 'paused', 'failed', 'opted_out')),
  current_step   int not null default 0,
  next_send_at   timestamptz,
  last_sent_at   timestamptz,
  enrolled_by    uuid,
  enrolled_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
-- the scheduler's hot query: active enrollments that are due
create index if not exists wa_enrollments_due_idx
  on public.wa_enrollments (next_send_at)
  where status = 'active';
create index if not exists wa_enrollments_campaign_idx on public.wa_enrollments (campaign_id);
create index if not exists wa_enrollments_contact_idx on public.wa_enrollments (contact_id);

-- ---------------------------------------------------------------------------
-- 8. wa_messages — per-send log, provider status, Live Monitor source
-- ---------------------------------------------------------------------------
create table if not exists public.wa_messages (
  id                  uuid primary key default gen_random_uuid(),
  enrollment_id       uuid references public.wa_enrollments(id) on delete cascade,
  campaign_id         uuid references public.wa_campaigns(id) on delete cascade,
  contact_id          uuid references public.wa_contacts(id) on delete set null,
  step_id             uuid references public.wa_campaign_steps(id) on delete set null,
  step_order          int,
  recipient_number    text,
  body_text           text,
  media               jsonb,
  status              text not null default 'scheduled'
                        check (status in ('scheduled', 'queued', 'sending', 'sent',
                                          'delivered', 'read', 'failed', 'retry_pending')),
  provider_message_id text,
  error               text,
  retry_count         int not null default 0,
  scheduled_for       timestamptz,
  queued_at           timestamptz,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  failed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists wa_messages_status_idx on public.wa_messages (status);
create index if not exists wa_messages_campaign_idx on public.wa_messages (campaign_id);
create index if not exists wa_messages_scheduled_created_idx
  on public.wa_messages (created_at)
  where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- 9. wa_events — inbound/outbound delivery + reply audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.wa_events (
  id                  uuid primary key default gen_random_uuid(),
  message_id          uuid references public.wa_messages(id) on delete set null,
  contact_id          uuid references public.wa_contacts(id) on delete set null,
  campaign_id         uuid references public.wa_campaigns(id) on delete set null,
  direction           text not null check (direction in ('inbound', 'outbound')),
  type                text not null check (type in ('sent', 'delivered', 'read',
                                                      'failed', 'reply', 'other')),
  provider_message_id text,
  from_number         text,
  raw_payload         jsonb not null,
  created_at          timestamptz not null default now()
);
create index if not exists wa_events_campaign_idx on public.wa_events (campaign_id);
create index if not exists wa_events_inbound_idx
  on public.wa_events (created_at)
  where direction = 'inbound';

-- =============================================================================
-- Triggers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- updated_at touch trigger (shared) — mirrors public.email_touch_updated_at()
-- ---------------------------------------------------------------------------
create or replace function public.wa_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'wa_contacts', 'wa_provider_settings', 'wa_campaigns',
    'wa_enrollments', 'wa_messages'
  ] loop
    execute format('drop trigger if exists trg_%s_touch on public.%I;', t, t);
    execute format(
      'create trigger trg_%s_touch before update on public.%I
         for each row execute function public.wa_touch_updated_at();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- When a message flips to 'sent', advance its enrollment to the next active
-- step (or complete the enrollment if there is none). Mirrors
-- public.email_advance_enrollment_on_send() so both the scheduler's auto-send
-- and any manual "mark as sent" move the enrollment forward identically.
-- ---------------------------------------------------------------------------
create or replace function public.wa_advance_enrollment_on_send()
returns trigger
language plpgsql
as $$
declare
  v_next public.wa_campaign_steps%rowtype;
  v_found boolean := false;
begin
  if new.enrollment_id is null then
    return new;
  end if;

  -- find the next active step after the one just sent
  select * into v_next
  from public.wa_campaign_steps s
  where s.campaign_id = new.campaign_id
    and s.step_order > coalesce(new.step_order, 0)
    and s.is_active = true
  order by s.step_order asc
  limit 1;
  v_found := found;

  if v_found then
    update public.wa_enrollments e
    set current_step = coalesce(new.step_order, e.current_step),
        next_send_at = case when v_next.delay_type = 'immediate'
                             then now()
                             else now() + make_interval(days => v_next.delay_days) end,
        last_sent_at = now(),
        status = case when e.status in ('paused', 'failed', 'opted_out')
                       then e.status else 'active' end,
        updated_at = now()
    where e.id = new.enrollment_id;
  else
    -- no more active steps: the sequence is finished for this contact
    update public.wa_enrollments e
    set current_step = coalesce(new.step_order, e.current_step),
        last_sent_at = now(),
        status = case when e.status in ('paused', 'failed', 'opted_out')
                       then e.status else 'completed' end,
        next_send_at = null,
        updated_at = now()
    where e.id = new.enrollment_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_wa_message_sent on public.wa_messages;
create trigger trg_wa_message_sent
after update of status on public.wa_messages
for each row
when (new.status = 'sent' and old.status is distinct from new.status)
execute function public.wa_advance_enrollment_on_send();

-- =============================================================================
-- RPCs — SECURITY DEFINER, gated by rbac_employee_can() (belt-and-suspenders
-- alongside the RLS that Task 2 adds; rbac_employee_can() already folds in
-- is_super_admin(), so no separate CEO check is needed here).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- wa_upsert_contact — upsert keyed on lower(whatsapp_number). Merges rather
-- than clobbers: existing non-null values win over incoming nulls, tags union,
-- attributes shallow-merge. Mirrors public.email_upsert_contact().
-- ---------------------------------------------------------------------------
create or replace function public.wa_upsert_contact(
  p_company         text,
  p_contact_name    text,
  p_whatsapp_number text,
  p_email           text default null,
  p_owner_email     text default null,
  p_tags            text[] default '{}',
  p_source          text default 'manual',
  p_attributes      jsonb default '{}'::jsonb,
  p_import_batch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_id uuid;
begin
  if not public.rbac_employee_can('marketing', 'edit') then
    raise exception 'not_authorized';
  end if;

  if p_whatsapp_number is null or length(trim(p_whatsapp_number)) = 0 then
    raise exception 'invalid whatsapp_number: %', p_whatsapp_number;
  end if;

  insert into public.wa_contacts as c
    (company, contact_name, whatsapp_number, email, owner_email, tags,
     source, attributes, import_batch_id, created_by)
  values
    (p_company, p_contact_name, trim(p_whatsapp_number), p_email, p_owner_email,
     coalesce(p_tags, '{}'), coalesce(p_source, 'manual'), coalesce(p_attributes, '{}'::jsonb),
     p_import_batch_id, auth.uid())
  -- targets the expression unique index wa_contacts_number_uidx created above
  on conflict (lower(whatsapp_number)) do update set
     company         = coalesce(excluded.company, c.company),
     contact_name     = coalesce(excluded.contact_name, c.contact_name),
     email            = coalesce(excluded.email, c.email),
     owner_email      = coalesce(excluded.owner_email, c.owner_email),
     tags             = (select array(select distinct unnest(c.tags || excluded.tags))),
     attributes       = c.attributes || coalesce(excluded.attributes, '{}'::jsonb),
     import_batch_id  = coalesce(c.import_batch_id, excluded.import_batch_id),
     updated_at       = now()
  returning c.id into v_id;

  return v_id;
end $fn$;
revoke all on function public.wa_upsert_contact(text, text, text, text, text, text[], text, jsonb, uuid) from public, anon;
grant execute on function public.wa_upsert_contact(text, text, text, text, text, text[], text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- wa_enroll_contacts — enroll a set of contacts into a campaign (skips dups
-- and opted-out contacts). next_send_at = campaign.start_at if it's still in
-- the future, else now() (so campaigns already past their start fire immediately).
-- ---------------------------------------------------------------------------
create or replace function public.wa_enroll_contacts(
  p_campaign_id uuid,
  p_contact_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_count int := 0;
  v_start_at timestamptz;
begin
  if not public.rbac_employee_can('marketing', 'edit') then
    raise exception 'not_authorized';
  end if;

  select start_at into v_start_at from public.wa_campaigns where id = p_campaign_id;

  insert into public.wa_enrollments (campaign_id, contact_id, next_send_at, enrolled_by)
  select p_campaign_id, c.id,
         case when v_start_at is not null and v_start_at > now() then v_start_at else now() end,
         auth.uid()
  from public.wa_contacts c
  where c.id = any(p_contact_ids)
    and c.opt_out = false
  on conflict (campaign_id, contact_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $fn$;
revoke all on function public.wa_enroll_contacts(uuid, uuid[]) from public, anon;
grant execute on function public.wa_enroll_contacts(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- wa_dashboard_counts — headline numbers for the WhatsApp Marketing dashboard.
-- delivery_success_rate is computed all-time (not a rolling window) — simplest
-- correct choice for V1; revisit if a trailing-N-days view is needed later.
-- ---------------------------------------------------------------------------
create or replace function public.wa_dashboard_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v jsonb;
begin
  if not public.rbac_employee_can('marketing', 'view') then
    raise exception 'not_authorized';
  end if;

  select jsonb_build_object(
    'campaigns_by_status', (
      select jsonb_object_agg(s.status, coalesce(c.cnt, 0))
      from unnest(array['draft', 'scheduled', 'running', 'paused',
                         'completed', 'stopped', 'failed']) as s(status)
      left join (
        select status, count(*) as cnt from public.wa_campaigns group by status
      ) c on c.status = s.status
    ),
    'messages_sent_today', (
      select count(*) from public.wa_messages where sent_at::date = current_date
    ),
    'messages_scheduled_today', (
      select count(*) from public.wa_messages where scheduled_for::date = current_date
    ),
    'delivery_success_rate', (
      select case when count(*) filter (where sent_at is not null) > 0
                  then round(100.0 * count(*) filter (where delivered_at is not null)
                             / count(*) filter (where sent_at is not null), 1)
                  else 0 end
      from public.wa_messages
    ),
    'replies_received_today', (
      select count(*) from public.wa_events
      where direction = 'inbound' and created_at::date = current_date
    ),
    'replies_received_total', (
      select count(*) from public.wa_events where direction = 'inbound'
    ),
    'pending_messages', (
      select count(*) from public.wa_messages
      where status in ('scheduled', 'queued', 'sending', 'retry_pending')
    )
  ) into v;

  return v;
end $fn$;
revoke all on function public.wa_dashboard_counts() from public, anon;
grant execute on function public.wa_dashboard_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- wa_provider_status — the single active provider's connection status.
-- Never returns the `credentials` column.
-- ---------------------------------------------------------------------------
create or replace function public.wa_provider_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_row public.wa_provider_settings%rowtype;
begin
  if not public.rbac_employee_can('marketing', 'view') then
    raise exception 'not_authorized';
  end if;

  select * into v_row from public.wa_provider_settings where is_active = true limit 1;

  if not found then
    return jsonb_build_object('connected', false);
  end if;

  return jsonb_build_object(
    'connected', true,
    'provider_key', v_row.provider_key,
    'sender_number', v_row.sender_number,
    'mode', v_row.mode,
    'last_health_check_at', v_row.last_health_check_at,
    'health_status', v_row.health_status,
    'health_reason', v_row.health_reason
  );
end $fn$;
revoke all on function public.wa_provider_status() from public, anon;
grant execute on function public.wa_provider_status() to authenticated;

commit;
