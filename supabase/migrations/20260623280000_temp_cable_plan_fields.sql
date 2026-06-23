-- Cable Planning Workbench correction: planner-entered Core OD, Wastage %,
-- Laying Loss % (3/4-core), and report language for operator job cards.
alter table public.temp_cable_plans
  add column if not exists core_od numeric,
  add column if not exists wastage_pct numeric default 2,
  add column if not exists laying_loss_pct numeric default 2,
  add column if not exists report_language text default 'bilingual';
