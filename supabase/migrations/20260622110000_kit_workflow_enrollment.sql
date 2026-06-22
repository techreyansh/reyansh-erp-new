-- KIT workflow automation: contact enrollments + step progress.
create table if not exists public.kit_workflow_enrollment (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.kit_workflows(id) on delete cascade,
  account_id text not null,
  company_name text,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  current_step integer not null default 0,
  next_due_date date,
  owner_email text,
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  last_action_at timestamptz,
  notes text,
  unique (workflow_id, account_id)
);
create index if not exists idx_kwe_due on public.kit_workflow_enrollment (status, next_due_date);
create index if not exists idx_kwe_workflow on public.kit_workflow_enrollment (workflow_id);

alter table public.kit_workflow_enrollment enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='kit_workflow_enrollment' and policyname='kwe_all') then
    create policy kwe_all on public.kit_workflow_enrollment for all using (true) with check (true);
  end if;
end $$;
