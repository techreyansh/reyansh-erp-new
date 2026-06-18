-- CRM-advanced + FG-billing tables (MISSING from prod)
-- ---------------------------------------------------------------------------
-- These nine tables are referenced by the app but were never migrated.
--
-- IMPORTANT — data shape:
--   The app reaches these tables through src/lib/db.js (via src/services/
--   sheetService.js -> crmService.js, and FGToBilling.js). db.js writes the
--   CANONICAL "sheet" shape: each row is { id, created_at, sort_order,
--   record jsonb }, where `record` holds the actual business fields. The flat
--   column layout is only a legacy fallback in db.js, so we create the wrapped
--   jsonb shape that db.js writes by default (insertTableRow -> {sort_order, record}).
--
--   The PascalCase / spaced keys the code stores INSIDE `record` (for reference):
--     crm_opportunities : OpportunityId, ClientCode, ClientName, Title,
--                         Description, Value, Currency, Stage, Probability,
--                         ExpectedCloseDate, ActualCloseDate, Source, AssignedTo,
--                         Products, Notes, Status, CreatedBy, CreatedAt, UpdatedAt,
--                         LastContactDate, NextFollowUpDate, LogId
--     crm_activities    : ActivityId, ClientCode, OpportunityId, Type, Subject,
--                         Description, ActivityDate, Duration, AssignedTo, Status,
--                         Priority, Outcome, NextAction, CreatedBy, CreatedAt, UpdatedAt
--     crm_interactions  : InteractionId, ClientCode, OpportunityId, Type, Direction,
--                         Subject, Content, From, To, DateTime, Duration, Status,
--                         Attachments, CreatedBy, CreatedAt
--     crm_tasks         : TaskId, ClientCode, OpportunityId, Title, Description,
--                         DueDate, Priority, Status, AssignedTo, CompletedDate,
--                         ReminderDate, CreatedBy, CreatedAt, UpdatedAt
--     crm_notes         : NoteId, ClientCode, OpportunityId, Title, Content,
--                         Category, Tags, CreatedBy, CreatedAt, UpdatedAt
--     crm_order_taking  : OrderId, ClientCode, ClientName, Date, Amount, Currency,
--                         Status, Products, Notes, CreatedBy, CreatedAt, UpdatedAt
--     crm_call_logs     : CallLogId, ClientCode, ClientName, DateTime, Direction,
--                         Duration, PhoneNumber, Status, Notes, Outcome, NextAction,
--                         CreatedBy, CreatedAt
--     crm_payments      : PaymentId, ClientCode, ClientName, Date, Amount, Currency,
--                         Method, Status, Reference, Notes, OpportunityId, CreatedBy,
--                         CreatedAt, UpdatedAt
--     fg_billing        : "Bill Number", "Bill Date", "Client Code", "Client Name",
--                         "Vehicle Number", "SO Number", "SO Date", "Items",
--                         "Subtotal", "Tax Rate", "Tax Amount", "Total Amount",
--                         "Status", "Created By", "Created Date", "Completed Date"
--
-- Security model: copies the email_campaigns / accountability RLS pattern —
--   enable RLS, grant to authenticated, and a permissive FOR ALL policy for
--   authenticated (covers select/insert/update/delete) so the app can read/write
--   under a logged-in PostgREST session.
--
-- Idempotent: every CREATE is "create table if not exists"; policies are
-- dropped-then-created; safe to re-run.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===========================================================================
-- 1. crm_opportunities
-- ===========================================================================
create table if not exists public.crm_opportunities (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sort_order integer,
  record     jsonb not null default '{}'::jsonb
);

-- ===========================================================================
-- 2. crm_activities
-- ===========================================================================
create table if not exists public.crm_activities (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sort_order integer,
  record     jsonb not null default '{}'::jsonb
);

-- ===========================================================================
-- 3. crm_interactions
-- ===========================================================================
create table if not exists public.crm_interactions (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sort_order integer,
  record     jsonb not null default '{}'::jsonb
);

-- ===========================================================================
-- 4. crm_tasks
-- ===========================================================================
create table if not exists public.crm_tasks (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sort_order integer,
  record     jsonb not null default '{}'::jsonb
);

-- ===========================================================================
-- 5. crm_notes
-- ===========================================================================
create table if not exists public.crm_notes (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sort_order integer,
  record     jsonb not null default '{}'::jsonb
);

-- ===========================================================================
-- 6. crm_order_taking
-- ===========================================================================
create table if not exists public.crm_order_taking (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sort_order integer,
  record     jsonb not null default '{}'::jsonb
);

-- ===========================================================================
-- 7. crm_call_logs
-- ===========================================================================
create table if not exists public.crm_call_logs (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sort_order integer,
  record     jsonb not null default '{}'::jsonb
);

-- ===========================================================================
-- 8. crm_payments
-- ===========================================================================
create table if not exists public.crm_payments (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sort_order integer,
  record     jsonb not null default '{}'::jsonb
);

-- ===========================================================================
-- 9. fg_billing
-- ===========================================================================
create table if not exists public.fg_billing (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sort_order integer,
  record     jsonb not null default '{}'::jsonb
);

-- Helpful sort_order index (the read path orders by sort_order).
create index if not exists idx_crm_opportunities_sort on public.crm_opportunities(sort_order);
create index if not exists idx_crm_activities_sort     on public.crm_activities(sort_order);
create index if not exists idx_crm_interactions_sort   on public.crm_interactions(sort_order);
create index if not exists idx_crm_tasks_sort          on public.crm_tasks(sort_order);
create index if not exists idx_crm_notes_sort          on public.crm_notes(sort_order);
create index if not exists idx_crm_order_taking_sort   on public.crm_order_taking(sort_order);
create index if not exists idx_crm_call_logs_sort      on public.crm_call_logs(sort_order);
create index if not exists idx_crm_payments_sort       on public.crm_payments(sort_order);
create index if not exists idx_fg_billing_sort         on public.fg_billing(sort_order);

-- ===========================================================================
-- Grants + Row Level Security
-- Mirrors the email_campaigns / accountability migrations: grant to the
-- authenticated role and a permissive FOR ALL policy so a logged-in session
-- can read/write through PostgREST.
-- ===========================================================================
do $rls$
declare t text;
begin
  foreach t in array array[
    'crm_opportunities','crm_activities','crm_interactions','crm_tasks',
    'crm_notes','crm_order_taking','crm_call_logs','crm_payments','fg_billing'
  ] loop
    -- PostgREST roles
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    -- enable RLS
    execute format('alter table public.%I enable row level security', t);

    -- permissive policy for authenticated (covers select/insert/update/delete)
    execute format('drop policy if exists %I on public.%I', t||'_authenticated_rw', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t||'_authenticated_rw', t
    );
  end loop;
end $rls$;

COMMIT;