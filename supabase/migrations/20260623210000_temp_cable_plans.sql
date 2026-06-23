-- TEMPORARY module: standalone Cable Planning Workbench. Manual-input planning
-- sheets, intentionally NOT integrated with ERP masters (bridge tool). One table.
create table if not exists public.temp_cable_plans (
  id uuid primary key default gen_random_uuid(),
  plan_number text unique not null,
  customer_name text, product_name text, cable_description text,
  order_qty numeric, required_length numeric, delivery_date date, priority text default 'normal', remarks text,
  cores integer, shape text, conductor_size numeric, strand_construction text,
  num_strands integer, core_colours text, finished_od numeric, cable_length numeric,
  plan jsonb,                 -- computed routing/geometry/departments/material
  planner_email text, status text default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_tcp_created on public.temp_cable_plans (created_at desc);
alter table public.temp_cable_plans enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='temp_cable_plans' and policyname='tcp_all') then
    create policy tcp_all on public.temp_cable_plans for all using (true) with check (true);
  end if;
end $$;
