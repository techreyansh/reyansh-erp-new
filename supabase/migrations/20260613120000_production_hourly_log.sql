-- Production hourly log — normalized "long" storage for hourly/daily production sheets.
--
-- Source sheets are wide matrices (metrics × time-slots, lines stacked). We unpivot
-- them to ONE ROW PER line × time-slot so the data is queryable and AI-analyzable.
-- Derived values (% achievement, totals, plant rollup) are NOT stored — they are
-- computed on read.
--
-- Uploads (Excel/CSV/photos) are parsed/extracted into these rows. Each upload batch
-- is grouped by upload_batch_id for traceability.

create extension if not exists "pgcrypto";

-- One row per upload event (file or photo batch) for provenance.
create table if not exists public.production_log_uploads (
  id            uuid primary key default gen_random_uuid(),
  source_name   text,                       -- original filename or "photo"
  source_kind   text,                       -- 'excel' | 'csv' | 'image' | 'manual'
  department    text,                       -- assembly | cable | molding | ...
  log_date      date,
  row_count     integer default 0,
  raw           jsonb,                       -- raw parsed/extracted payload (audit)
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

-- One row per line × time-slot.
create table if not exists public.production_hourly_log (
  id               uuid primary key default gen_random_uuid(),
  upload_batch_id  uuid references public.production_log_uploads(id) on delete set null,
  log_date         date not null,
  department       text not null default 'assembly',
  line_no          text not null,
  line_leader      text,
  model            text,
  manpower         integer,
  time_slot        text not null,           -- "09-10", "11:15-12:15", ...
  slot_index       integer,                 -- ordering within the day (0-based)
  target           numeric(18,2) default 0,
  achieved         numeric(18,2) default 0,
  downtime_minutes numeric(18,2) default 0,
  reason           text,                     -- e.g. "MATERIAL FINISH"
  source_name      text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);

create index if not exists idx_prod_hourly_date    on public.production_hourly_log (log_date);
create index if not exists idx_prod_hourly_dept    on public.production_hourly_log (department);
create index if not exists idx_prod_hourly_line    on public.production_hourly_log (line_no);
create index if not exists idx_prod_hourly_batch   on public.production_hourly_log (upload_batch_id);
create index if not exists idx_prod_hourly_date_dept on public.production_hourly_log (log_date, department);

-- RLS: authenticated users (the production team) can read/write. Tighten later to
-- the PRODUCTION rbac module if you want per-role control (see moduleAccess.js).
alter table public.production_hourly_log  enable row level security;
alter table public.production_log_uploads enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'production_hourly_log' and policyname = 'prod_hourly_rw') then
    create policy prod_hourly_rw on public.production_hourly_log
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'production_log_uploads' and policyname = 'prod_uploads_rw') then
    create policy prod_uploads_rw on public.production_log_uploads
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Convenience view: per line/day rollup with derived % achievement.
create or replace view public.production_hourly_rollup as
select
  log_date,
  department,
  line_no,
  max(line_leader)  as line_leader,
  max(model)        as model,
  max(manpower)     as manpower,
  sum(target)       as total_target,
  sum(achieved)     as total_achieved,
  case when sum(target) > 0
       then round((sum(achieved) - sum(target)) / sum(target) * 100, 2)
       else 0 end   as achievement_variance_pct,
  sum(downtime_minutes) as total_downtime_minutes
from public.production_hourly_log
group by log_date, department, line_no;
