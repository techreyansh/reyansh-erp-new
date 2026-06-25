-- Demand-driven Purchase Requisition raised from MRP shortfalls.
create table if not exists public.purchase_requisition (
  id uuid primary key default gen_random_uuid(),
  pr_number text unique not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','converted','cancelled')),
  source text not null default 'mrp',
  notes text,
  total_estimated numeric default 0,
  created_by_email text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz
);
create table if not exists public.purchase_requisition_line (
  id uuid primary key default gen_random_uuid(),
  pr_id uuid not null references public.purchase_requisition(id) on delete cascade,
  material_code text,
  material_name text,
  uom text,
  required_qty numeric default 0,
  on_hand numeric,
  shortfall_qty numeric default 0,
  order_qty numeric default 0,
  est_rate numeric default 0,
  est_amount numeric default 0,
  stock_item_code text,
  sequence integer default 0
);
create index if not exists idx_prl_pr on public.purchase_requisition_line (pr_id);
create index if not exists idx_pr_status on public.purchase_requisition (status, created_at desc);

alter table public.purchase_requisition enable row level security;
alter table public.purchase_requisition_line enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='purchase_requisition' and policyname='pr_all') then
    create policy pr_all on public.purchase_requisition for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='purchase_requisition_line' and policyname='prl_all') then
    create policy prl_all on public.purchase_requisition_line for all using (true) with check (true);
  end if;
end $$;
