-- DYNAMIC COSTING — Phase 1: turn material_rate into a full Rate Master and add
-- a rate-change audit log. Recompute itself runs in the JS costingEngine (single
-- source of truth for the margin math); this schema is its backbone.
alter table public.material_rate
  add column if not exists rate_type text not null default 'material',  -- material|labour|machine|power|packing|overhead_pct|finance_pct|margin_pct
  add column if not exists previous_rate numeric,
  add column if not exists approval_status text not null default 'approved', -- draft|pending|approved
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists updated_by_email text;

-- categorise the existing seeded rates
update public.material_rate set rate_type='material'
  where material_code in ('COPPER','PVC_INS','PVC_SHEATH','PIN_6A','PIN_16A','CONNECTOR','TERMINAL','SLEEVE','LABEL','PACKING') and rate_type is distinct from 'material';

-- seed the operational (non-material) master rates if absent
insert into public.material_rate (material_code, material_name, rate, uom, rate_type, effective_from, source)
select v.code, v.name, v.rate::numeric, v.uom, v.rtype, '2026-06-23'::date, 'manual'
from (values
  ('LABOUR_RATE','Labour rate','12','%','labour'),
  ('MACHINE_HR','Machine hour rate','350','/hr','machine'),
  ('POWER_UNIT','Power / unit','9','/unit','power'),
  ('OVERHEAD_PCT','Overhead','8','%','overhead_pct'),
  ('FINANCE_PCT','Finance cost','2','%','finance_pct'),
  ('MARGIN_PCT','Target margin','20','%','margin_pct')
) as v(code,name,rate,uom,rtype)
where not exists (select 1 from public.material_rate m where m.material_code=v.code);

create table if not exists public.rate_change_log (
  id uuid primary key default gen_random_uuid(),
  rate_code text not null,
  rate_type text,
  old_rate numeric,
  new_rate numeric,
  pct_change numeric,
  reason text,
  changed_by_email text,
  changed_at timestamptz not null default now(),
  affected_versions integer default 0
);
create index if not exists idx_rcl_code on public.rate_change_log (rate_code, changed_at desc);

alter table public.rate_change_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='rate_change_log' and policyname='rcl_all') then
    create policy rcl_all on public.rate_change_log for all using (true) with check (true);
  end if;
end $$;

-- costing_version: stamp when it was last recosted + against which rate snapshot
alter table public.costing_version
  add column if not exists recosted_at timestamptz,
  add column if not exists rate_basis_date date;
