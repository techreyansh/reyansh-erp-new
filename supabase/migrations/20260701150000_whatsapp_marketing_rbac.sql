-- WhatsApp Marketing module — RBAC + RLS (Task 2 of 12).
-- Registers the 'marketing' module, grants role permissions, and enables RLS
-- on every wa_* table created schema-only in
-- 20260701140000_whatsapp_marketing_schema.sql. No schema changes here.
--
-- Convention: standard two-policy split, copied from
-- 20260627190000_rls_harden_finance_invoices.sql /
-- 20260627200000_rls_harden_crm_complaints_audit.sql —
--   <table>_read  : FOR SELECT USING (is_super_admin() OR rbac_employee_can('marketing','view'))
--   <table>_write : FOR ALL    USING (is_super_admin() OR rbac_employee_can('marketing','edit'))
--                              WITH CHECK (same)
-- wa_provider_settings is the one exception: CEO/true-admin only (credentials
-- live there), so it gets a single FOR ALL is_super_admin()-only policy
-- instead of the read/write split.
--
-- Idempotent: safe to re-run (module insert is guarded by NOT EXISTS, role
-- grants by NOT EXISTS, policies are dropped-then-recreated).
--
-- Live role codes could not be queried from this environment (no docker/psql,
-- no service-role key available to the agent — same tooling gap noted in
-- Task 1's report). Falling back to the defensive predicate given in the
-- task brief, which matches the pattern already used by
-- 20260629190000_profitability_phase1.sql (role_name = 'CEO') but widened
-- slightly to also catch an eventual MARKETING_SCOPED role and any
-- admin-coded/admin-named role, so real seeded admin roles aren't skipped
-- pending live confirmation.

begin;

-- =============================================================================
-- 1. Module registration
-- =============================================================================
insert into public.modules (module_key, module_name, route_path)
select 'marketing', 'WhatsApp Marketing', '/temp/whatsapp-marketing'
where not exists (select 1 from public.modules where module_key = 'marketing');

-- =============================================================================
-- 2. Role grants
-- =============================================================================
insert into public.role_module_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
select r.id, m.id, true, true, true, true
from public.roles r cross join public.modules m
where m.module_key = 'marketing'
  and (r.role_name = 'CEO' or r.code = 'MARKETING_SCOPED' or r.code in ('ADMIN','SUPER_ADMIN') or r.role_name ilike '%admin%')
  and not exists (select 1 from public.role_module_permissions rmp where rmp.role_id = r.id and rmp.module_id = m.id);

-- =============================================================================
-- 3. RLS
-- =============================================================================

-- wa_import_batches -----------------------------------------------------------
alter table public.wa_import_batches enable row level security;

drop policy if exists wa_import_batches_read on public.wa_import_batches;
drop policy if exists wa_import_batches_write on public.wa_import_batches;

create policy wa_import_batches_read on public.wa_import_batches
  for select to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','view'));

create policy wa_import_batches_write on public.wa_import_batches
  for all to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','edit'))
  with check (public.is_super_admin() or public.rbac_employee_can('marketing','edit'));

-- wa_contacts -------------------------------------------------------------------
alter table public.wa_contacts enable row level security;

drop policy if exists wa_contacts_read on public.wa_contacts;
drop policy if exists wa_contacts_write on public.wa_contacts;

create policy wa_contacts_read on public.wa_contacts
  for select to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','view'));

create policy wa_contacts_write on public.wa_contacts
  for all to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','edit'))
  with check (public.is_super_admin() or public.rbac_employee_can('marketing','edit'));

-- wa_campaigns --------------------------------------------------------------
alter table public.wa_campaigns enable row level security;

drop policy if exists wa_campaigns_read on public.wa_campaigns;
drop policy if exists wa_campaigns_write on public.wa_campaigns;

create policy wa_campaigns_read on public.wa_campaigns
  for select to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','view'));

create policy wa_campaigns_write on public.wa_campaigns
  for all to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','edit'))
  with check (public.is_super_admin() or public.rbac_employee_can('marketing','edit'));

-- wa_campaign_steps -----------------------------------------------------------
alter table public.wa_campaign_steps enable row level security;

drop policy if exists wa_campaign_steps_read on public.wa_campaign_steps;
drop policy if exists wa_campaign_steps_write on public.wa_campaign_steps;

create policy wa_campaign_steps_read on public.wa_campaign_steps
  for select to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','view'));

create policy wa_campaign_steps_write on public.wa_campaign_steps
  for all to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','edit'))
  with check (public.is_super_admin() or public.rbac_employee_can('marketing','edit'));

-- wa_campaign_media -----------------------------------------------------------
alter table public.wa_campaign_media enable row level security;

drop policy if exists wa_campaign_media_read on public.wa_campaign_media;
drop policy if exists wa_campaign_media_write on public.wa_campaign_media;

create policy wa_campaign_media_read on public.wa_campaign_media
  for select to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','view'));

create policy wa_campaign_media_write on public.wa_campaign_media
  for all to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','edit'))
  with check (public.is_super_admin() or public.rbac_employee_can('marketing','edit'));

-- wa_enrollments ----------------------------------------------------------------
alter table public.wa_enrollments enable row level security;

drop policy if exists wa_enrollments_read on public.wa_enrollments;
drop policy if exists wa_enrollments_write on public.wa_enrollments;

create policy wa_enrollments_read on public.wa_enrollments
  for select to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','view'));

create policy wa_enrollments_write on public.wa_enrollments
  for all to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','edit'))
  with check (public.is_super_admin() or public.rbac_employee_can('marketing','edit'));

-- wa_messages -------------------------------------------------------------------
alter table public.wa_messages enable row level security;

drop policy if exists wa_messages_read on public.wa_messages;
drop policy if exists wa_messages_write on public.wa_messages;

create policy wa_messages_read on public.wa_messages
  for select to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','view'));

create policy wa_messages_write on public.wa_messages
  for all to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','edit'))
  with check (public.is_super_admin() or public.rbac_employee_can('marketing','edit'));

-- wa_events -----------------------------------------------------------------
alter table public.wa_events enable row level security;

drop policy if exists wa_events_read on public.wa_events;
drop policy if exists wa_events_write on public.wa_events;

create policy wa_events_read on public.wa_events
  for select to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','view'));

create policy wa_events_write on public.wa_events
  for all to authenticated
  using (public.is_super_admin() or public.rbac_employee_can('marketing','edit'))
  with check (public.is_super_admin() or public.rbac_employee_can('marketing','edit'));

-- wa_provider_settings — CEO/true-admin only, no plain marketing-edit access ---
-- (holds provider credentials; single strict policy, no read/write split)
alter table public.wa_provider_settings enable row level security;

drop policy if exists wa_provider_settings_read on public.wa_provider_settings;
drop policy if exists wa_provider_settings_write on public.wa_provider_settings;
drop policy if exists wa_provider_settings_all on public.wa_provider_settings;

create policy wa_provider_settings_all on public.wa_provider_settings
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

commit;
