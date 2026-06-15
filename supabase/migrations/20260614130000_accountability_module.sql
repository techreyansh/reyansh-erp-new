-- Accountability Module — weekly weighted scorecards (Phase 1).
-- Adapted to Supabase: uuid PKs, identity via auth.users, calc engine as RPCs, RLS.
-- KPI catalog seeded from KPI_SEED.json (9 roles, 83 KPIs, weights sum to 100/role).

create extension if not exists pgcrypto;

-- ============ 1. Roles ============
create table if not exists public.acc_roles (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  is_hod boolean default true,
  sort_order int default 0
);

-- ============ 2. KPI catalog ============
create table if not exists public.acc_role_kpis (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.acc_roles(id) on delete cascade,
  code text not null,
  name text not null,
  unit text not null,
  weight numeric(5,2) not null,
  direction text not null check (direction in ('HIGHER','LOWER','BINARY')),
  default_target numeric(14,4),
  calc_basis text,
  sort_order int default 0,
  is_active boolean default true,
  unique(role_id, code)
);

-- ============ 3. Employees (identity via Supabase auth.users) ============
create table if not exists public.acc_employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  role_id uuid not null references public.acc_roles(id),
  system_role text not null default 'HOD' check (system_role in ('HOD','PROCESS_COORD','PLANT_HEAD','DIRECTOR')),
  reports_to_id uuid references public.acc_employees(id),
  joined_on date,
  is_active boolean default true,
  is_demo boolean default false
);
create index if not exists idx_acc_employees_role on public.acc_employees(role_id);
create index if not exists idx_acc_employees_user on public.acc_employees(user_id);

-- ============ 4. Weeks ============
create table if not exists public.acc_weeks (
  id uuid primary key default gen_random_uuid(),
  iso_year int not null,
  iso_week int not null,
  week_start date not null,
  week_end date not null,
  is_locked boolean default false,
  locked_by uuid references auth.users(id),
  locked_at timestamptz,
  unique(iso_year, iso_week)
);

-- ============ 5. Scorecards ============
create table if not exists public.acc_scorecards (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.acc_employees(id),
  week_id uuid not null references public.acc_weeks(id),
  status text not null default 'DRAFT' check (status in ('DRAFT','TARGETS_SET','IN_PROGRESS','SUBMITTED','LOCKED')),
  final_score_pct numeric(6,2),
  band text,
  weight_base numeric(6,2),
  hod_comment text,
  reviewer_comment text,
  submitted_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(employee_id, week_id)
);
create index if not exists idx_acc_scorecards_week on public.acc_scorecards(week_id);

-- ============ 6. Scorecard KPIs (snapshotted) ============
create table if not exists public.acc_scorecard_kpis (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references public.acc_scorecards(id) on delete cascade,
  role_kpi_id uuid not null references public.acc_role_kpis(id),
  name_snapshot text,
  weight_snapshot numeric(5,2) not null,
  direction_snapshot text not null,
  unit_snapshot text not null,
  sort_order int default 0,
  target_value numeric(14,4),
  actual_value numeric(14,4),
  achievement_pct numeric(6,2),
  weighted_score numeric(8,4),
  note text,
  unique(scorecard_id, role_kpi_id)
);

-- ============ 7. Action items ============
create table if not exists public.acc_action_items (
  id uuid primary key default gen_random_uuid(),
  raised_week_id uuid references public.acc_weeks(id),
  owner_employee_id uuid not null references public.acc_employees(id),
  raised_by uuid references auth.users(id),
  title text not null,
  detail text,
  due_date date not null,
  status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','CLOSED','ESCALATED')),
  closure_note text,
  closed_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_acc_actions_owner on public.acc_action_items(owner_employee_id);
create index if not exists idx_acc_actions_status on public.acc_action_items(status);

-- ============ 8. Recognition ============
create table if not exists public.acc_weekly_recognition (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null unique references public.acc_weeks(id),
  star_scorecard_id uuid references public.acc_scorecards(id),
  focus_scorecard_id uuid references public.acc_scorecards(id),
  citation text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz default now()
);
create table if not exists public.acc_monthly_recognition (
  id uuid primary key default gen_random_uuid(),
  iso_year int not null,
  iso_month int not null,
  champion_employee_id uuid references public.acc_employees(id),
  champion_avg_pct numeric(6,2),
  runner_up_id uuid references public.acc_employees(id),
  citation text,
  unique(iso_year, iso_month)
);

-- ============ 9. Audit log ============
create table if not exists public.acc_audit_log (
  id bigserial primary key,
  at timestamptz default now(),
  user_id uuid references auth.users(id),
  entity text, entity_id uuid, action text, payload jsonb
);

-- ============ Calc engine (server-side) ============
-- Achievement per KPI: 0..1.20, or NULL when not measured.
create or replace function public.acc_kpi_achievement(p_direction text, p_target numeric, p_actual numeric)
returns numeric language plpgsql immutable as $func$
begin
  if p_direction = 'BINARY' then
    if p_actual is null then return null; end if;
    return case when p_actual >= 1 then 1.00 else 0 end;
  end if;
  if p_target is null or p_actual is null then return null; end if;
  if p_direction = 'HIGHER' then
    if p_target = 0 then return 0; end if;
    return least(p_actual / p_target, 1.20);
  elsif p_direction = 'LOWER' then
    if p_actual = 0 then return 1.20; end if;
    return least(p_target / p_actual, 1.20);
  end if;
  return null;
end; $func$;

-- Recompute one scorecard: per-KPI achievement + weighted, then re-normalised final + band.
create or replace function public.acc_recompute_scorecard(p_scorecard uuid)
returns void language plpgsql as $func$
declare v_sw numeric; v_w numeric; v_final numeric; v_band text;
begin
  update public.acc_scorecard_kpis sk
  set achievement_pct = public.acc_kpi_achievement(sk.direction_snapshot, sk.target_value, sk.actual_value),
      weighted_score = case
        when public.acc_kpi_achievement(sk.direction_snapshot, sk.target_value, sk.actual_value) is null then null
        else public.acc_kpi_achievement(sk.direction_snapshot, sk.target_value, sk.actual_value) * sk.weight_snapshot / 100 end
  where sk.scorecard_id = p_scorecard;

  select coalesce(sum(achievement_pct * weight_snapshot),0), coalesce(sum(weight_snapshot),0)
    into v_sw, v_w
  from public.acc_scorecard_kpis
  where scorecard_id = p_scorecard and achievement_pct is not null;

  if v_w > 0 then v_final := round((v_sw / v_w) * 100, 2); else v_final := null; end if;
  if v_final is null then v_band := null;
  elsif v_final >= 85 then v_band := 'GREEN';
  elsif v_final >= 70 then v_band := 'AMBER';
  else v_band := 'RED'; end if;

  update public.acc_scorecards
  set final_score_pct = v_final, band = v_band, weight_base = nullif(v_w,0), updated_at = now()
  where id = p_scorecard;
end; $func$;

-- Get/create the ISO week (Mon..Sat) for a date.
create or replace function public.acc_ensure_week(p_date date default current_date)
returns public.acc_weeks language plpgsql as $func$
declare v_y int; v_w int; v_start date; v_row public.acc_weeks;
begin
  v_y := extract(isoyear from p_date)::int;
  v_w := extract(week from p_date)::int;
  v_start := date_trunc('week', p_date)::date;
  insert into public.acc_weeks (iso_year, iso_week, week_start, week_end)
  values (v_y, v_w, v_start, v_start + 5)
  on conflict (iso_year, iso_week) do nothing;
  select * into v_row from public.acc_weeks where iso_year = v_y and iso_week = v_w;
  return v_row;
end; $func$;

-- Caller's system role (for RLS + UI).
create or replace function public.acc_my_role()
returns text language sql stable security definer as $func$
  select system_role from public.acc_employees where user_id = auth.uid() and is_active limit 1;
$func$;

-- Self-register the current auth user as an employee (admin/onboarding helper).
create or replace function public.acc_register_me(p_full_name text, p_role_code text, p_system_role text default 'HOD')
returns uuid language plpgsql security definer as $func$
declare v_role uuid; v_emp uuid;
begin
  select id into v_role from public.acc_roles where code = p_role_code;
  if v_role is null then raise exception 'Unknown role code %', p_role_code; end if;
  insert into public.acc_employees (user_id, full_name, role_id, system_role)
  values (auth.uid(), p_full_name, v_role, p_system_role)
  returning id into v_emp;
  return v_emp;
end; $func$;

-- Auto-create DRAFT scorecards + snapshot KPIs for all active employees for a week.
create or replace function public.acc_create_week_scorecards(p_week uuid)
returns int language plpgsql as $func$
declare v_count int := 0; r record; v_sc uuid;
begin
  for r in select id as emp_id, role_id from public.acc_employees where is_active loop
    insert into public.acc_scorecards (employee_id, week_id, status)
    values (r.emp_id, p_week, 'DRAFT')
    on conflict (employee_id, week_id) do nothing;
    select id into v_sc from public.acc_scorecards where employee_id = r.emp_id and week_id = p_week;
    insert into public.acc_scorecard_kpis (scorecard_id, role_kpi_id, name_snapshot, weight_snapshot, direction_snapshot, unit_snapshot, sort_order, target_value)
    select v_sc, k.id, k.name, k.weight, k.direction, k.unit, k.sort_order, k.default_target
    from public.acc_role_kpis k where k.role_id = r.role_id and k.is_active
    on conflict (scorecard_id, role_kpi_id) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $func$;

-- Get-or-create the caller's scorecard for the current week (returns its id).
create or replace function public.acc_my_current_scorecard()
returns uuid language plpgsql security definer as $func$
declare v_emp uuid; v_role uuid; v_week uuid; v_sc uuid;
begin
  select id, role_id into v_emp, v_role from public.acc_employees where user_id = auth.uid() and is_active limit 1;
  if v_emp is null then return null; end if;
  select id into v_week from public.acc_ensure_week(current_date);
  insert into public.acc_scorecards (employee_id, week_id, status) values (v_emp, v_week, 'DRAFT')
  on conflict (employee_id, week_id) do nothing;
  select id into v_sc from public.acc_scorecards where employee_id = v_emp and week_id = v_week;
  insert into public.acc_scorecard_kpis (scorecard_id, role_kpi_id, name_snapshot, weight_snapshot, direction_snapshot, unit_snapshot, sort_order, target_value)
  select v_sc, k.id, k.name, k.weight, k.direction, k.unit, k.sort_order, k.default_target
  from public.acc_role_kpis k where k.role_id = v_role and k.is_active
  on conflict (scorecard_id, role_kpi_id) do nothing;
  return v_sc;
end; $func$;

-- ============ RLS ============
-- Phase 1: RLS on (authenticated only). Catalog readable by all; finer per-role
-- write rules are enforced via the RPCs (security definer) + app; tighten later
-- to the brief's permission matrix.
do $rls$
declare t text;
begin
  foreach t in array array['acc_roles','acc_role_kpis','acc_employees','acc_weeks','acc_scorecards','acc_scorecard_kpis','acc_action_items','acc_weekly_recognition','acc_monthly_recognition','acc_audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t||'_rw', t);
  end loop;
end $rls$;

-- ============ Seed: roles + KPI catalog ============
insert into public.acc_roles (code, name, is_hod, sort_order) values
('PROD_CABLE','Production Manager — Cable',true,1),
  ('PROD_MOULD','Production Manager — Moulding',true,2),
  ('LINE_LEAD','Line Leader',true,3),
  ('STORE','Store Person',true,4),
  ('NPD','New Product Development',true,5),
  ('PURCHASE','Purchase Department',true,6),
  ('PROC_COORD','Process Coordinator',true,7),
  ('CR_REP','Customer Relationship Rep',true,8),
  ('MAINT','Maintenance Department',true,9)
on conflict (code) do nothing;

insert into public.acc_role_kpis (role_id, code, name, unit, weight, direction, default_target, calc_basis, sort_order)
select r.id, v.code, v.name, v.unit, v.weight, v.direction, v.default_target, v.calc_basis, v.sort_order
from (values
('PROD_CABLE','PLAN_ADH','Production Plan Adherence (meters achieved vs plan)','%',20,'HIGHER',NULL,'Total achieved meters / Total planned meters across all machines',1),
  ('PROD_CABLE','OEE','OEE — Availability × Performance × Quality','%',15,'HIGHER',0.75,'Daily OEE across all cable lines, weekly average',2),
  ('PROD_CABLE','FPY','First Pass Yield / Rejection Control','%',15,'LOWER',0.015,'Rejected meters / total produced meters; target rejection ≤ 1.5%',3),
  ('PROD_CABLE','WASTAGE','Copper / PVC Wastage vs Standard','%',10,'LOWER',0.02,'Actual wastage % vs standard allowance per the BOM',4),
  ('PROD_CABLE','DOWNTIME','Unplanned Downtime (hours)','hrs',10,'LOWER',6,'Total unplanned breakdown hours in the week; target ≤ 6 hrs',5),
  ('PROD_CABLE','OTD_NEXT','On-time Delivery to Next Process / Customer','%',10,'HIGHER',0.95,'Jobs delivered on schedule to Moulding / FG store',6),
  ('PROD_CABLE','AUDIT_5S','5S & Housekeeping Audit Score','%',5,'HIGHER',0.85,'Weekly 5S audit by Process Coordinator',7),
  ('PROD_CABLE','SAFETY','Safety — Zero Reportable Incidents','Y/N',5,'BINARY',1,'Any LTI, near-miss > level 2, or PPE violation = miss',8),
  ('PROD_CABLE','REPORTING','Daily Production Report Submission (on time)','%',5,'HIGHER',1,'Reports submitted before 9:30 AM next day / 6 days',9),
  ('PROD_CABLE','DISCIPLINE','Team Discipline & Attendance','%',5,'HIGHER',0.95,'Operator attendance %, indiscipline cases handled',10),
  ('PROD_MOULD','PLAN_ADH','Moulding Plan Adherence (pieces vs plan)','%',20,'HIGHER',NULL,'Total pieces produced / planned pieces, all moulding machines',1),
  ('PROD_MOULD','OEE','OEE — Moulding Lines','%',15,'HIGHER',0.75,'Weekly average OEE across all moulding presses',2),
  ('PROD_MOULD','REJECTION','Rejection Rate (moulding defects)','%',15,'LOWER',0.01,'Defective pieces / total produced; target ≤ 1%',3),
  ('PROD_MOULD','CYCLE_TIME','Cycle Time Adherence vs Standard','%',10,'HIGHER',0.95,'Actual cycle time vs standard cycle time per cavity',4),
  ('PROD_MOULD','TOOL_DOWNTIME','Mould / Tool Downtime (hours)','hrs',10,'LOWER',8,'Time lost in mould change, repair, breakdown; target ≤ 8 hrs',5),
  ('PROD_MOULD','MAT_WASTE','Material Wastage (PVC compound / scrap)','%',10,'LOWER',0.025,'Sprue + runner + reject scrap vs total consumption',6),
  ('PROD_MOULD','OTD_ASSY','On-time Supply to Assembly / FG','%',5,'HIGHER',0.95,'Moulded parts delivered on schedule to next stage',7),
  ('PROD_MOULD','AUDIT_5S','5S, Housekeeping & Tool Storage','%',5,'HIGHER',0.85,'Weekly 5S audit, mould storage discipline',8),
  ('PROD_MOULD','SAFETY','Safety — Zero Reportable Incidents','Y/N',5,'BINARY',1,'No LTI, no PPE violation in the week',9),
  ('PROD_MOULD','REPORTING','Daily Reporting & Shift Handover Quality','%',5,'HIGHER',1,'Reports submitted on time, shift handover register complete',10),
  ('LINE_LEAD','SHIFT_OUT','Shift Output vs Plan','%',25,'HIGHER',0.95,'Pieces / meters produced in shift vs shift plan',1),
  ('LINE_LEAD','REJECTION','Line-Level Rejection / Rework','%',15,'LOWER',0.015,'Rejection at his/her line; target ≤ 1.5%',2),
  ('LINE_LEAD','ATTENDANCE','Operator Attendance & Discipline','%',10,'HIGHER',0.95,'Operators present vs allocated, indiscipline cases handled',3),
  ('LINE_LEAD','MTTR_LINE','Quick Response to Line Stoppage (MTTR-line)','%',10,'HIGHER',0.9,'Stoppages resolved < 15 min vs total stoppages',4),
  ('LINE_LEAD','INDENT_ACC','Material Indenting Accuracy','%',10,'HIGHER',0.95,'Indents matching actual consumption, no last-minute shortages',5),
  ('LINE_LEAD','AUDIT_5S','5S Compliance at Line','%',10,'HIGHER',0.85,'Weekly 5S audit score for his/her line',6),
  ('LINE_LEAD','REPORTING','Production Reporting Discipline','%',10,'HIGHER',1,'Hourly production log filled correctly; no missing entries',7),
  ('LINE_LEAD','SKILL_DEV','Skill Development of Operators','tasks',5,'HIGHER',1,'Operators cross-trained / SOPs followed; target 1 cross-training/week',8),
  ('LINE_LEAD','SAFETY_PPE','Safety Adherence (PPE, behaviour)','%',5,'HIGHER',1,'PPE compliance %, safety toolbox talks attended',9),
  ('STORE','INV_ACC','Inventory Accuracy (physical vs system)','%',25,'HIGHER',0.98,'Cycle count match rate; target ≥ 98%',1),
  ('STORE','STOCKOUT','Stock-out Incidents (critical / running items)','count',15,'LOWER',0,'Stock-outs of A/B class items; target = 0',2),
  ('STORE','GRN_TAT','GRN Posting TAT (hrs from receipt)','hrs',10,'LOWER',4,'Avg hours from receipt to GRN posting; target ≤ 4 hrs',3),
  ('STORE','ISSUE_TAT','Issue Slip / Material Issue TAT','min',10,'LOWER',30,'Avg time to issue material against indent; target ≤ 30 min',4),
  ('STORE','FIFO','FIFO Compliance','%',10,'HIGHER',0.95,'Audit of issues — oldest stock issued first',5),
  ('STORE','LABELING','Material Identification & Labeling','%',10,'HIGHER',0.95,'Bins/racks properly labeled, batch/heat numbers visible',6),
  ('STORE','AUDIT_5S','Store 5S & Housekeeping','%',10,'HIGHER',0.85,'Weekly 5S audit of store and racks',7),
  ('STORE','DAMAGE','Damage / Loss / Shortage in week (₹)','INR',5,'LOWER',0,'Value of damages or shortages reported',8),
  ('STORE','RECON','Daily Stock Reconciliation Submitted on Time','%',5,'HIGHER',1,'Daily stock report submitted to plant head before 10 AM',9),
  ('NPD','SAMPLES','New Samples Developed vs Target','%',20,'HIGHER',1,'Samples completed in week / weekly target',1),
  ('NPD','FIRST_APPR','Sample First-Time Approval Rate','%',15,'HIGHER',0.7,'Samples approved in first attempt by customer / total samples',2),
  ('NPD','TAT_NPD','NPD Turnaround Time (drawing → sample)','days',15,'LOWER',7,'Avg days from receipt of drawing to dispatched sample; target ≤ 7 days',3),
  ('NPD','PPAP','PPAP / Documentation Completion','%',15,'HIGHER',0.9,'PPAP elements completed for projects in pipeline',4),
  ('NPD','DRAW_TAT','Customer Drawing Review TAT (hrs)','hrs',10,'LOWER',24,'Avg hours from drawing receipt to feedback/RFQ',5),
  ('NPD','BOM_ACC','BOM & Cost Sheet Accuracy','%',10,'HIGHER',0.95,'BOMs released without rework / total BOMs released',6),
  ('NPD','FMEA','DFMEA / PFMEA Update Discipline','%',5,'HIGHER',0.9,'FMEA documents updated for new products on time',7),
  ('NPD','TOOLING_OTD','Tooling / Mould Delivery On-time','%',5,'HIGHER',0.9,'Tools / moulds developed and delivered on agreed date',8),
  ('NPD','TRACKER','Project Tracker Update Discipline','%',5,'HIGHER',1,'NPD tracker updated daily / weekly',9),
  ('PURCHASE','VENDOR_OTD','On-Time Delivery from Vendors','%',20,'HIGHER',0.95,'POs delivered on/before due date / total POs in week',1),
  ('PURCHASE','COST_SAVE','Cost Savings vs Budget / Last Buy','%',15,'HIGHER',0.02,'₹ saved vs budgeted rate or last purchase rate; weekly value',2),
  ('PURCHASE','VENDOR_QUALITY','Vendor Quality (Incoming Rejection)','%',15,'LOWER',0.01,'Rejected GRN qty / Total received qty; target ≤ 1%',3),
  ('PURCHASE','PO_TAT','PO Release TAT (indent → PO, hrs)','hrs',10,'LOWER',24,'Avg hours from approved indent to PO release; target ≤ 24 hrs',4),
  ('PURCHASE','INDENT_FILL','Indent Fulfillment Rate','%',10,'HIGHER',0.95,'Indents fully closed in week / indents raised',5),
  ('PURCHASE','STOCKOUT_DELAY','Stock-out due to Purchase Delay (count)','count',10,'LOWER',0,'Production stoppages attributable to late material; target = 0',6),
  ('PURCHASE','VENDOR_BASE','Vendor Base Development (new vendors)','count',5,'HIGHER',1,'New approved vendors added / week; target ≥ 1',7),
  ('PURCHASE','PRICE_TRACK','Price Tracking vs LME / Market Index','%',5,'HIGHER',1,'Copper, PVC, plug rates updated weekly; documented',8),
  ('PURCHASE','PAYMENT_DOCS','Payment & Documentation Compliance','%',10,'HIGHER',0.95,'GRN, bills, vendor reconciliation done on time',9),
  ('PROC_COORD','PLAN_QUALITY','Weekly Production Plan Accuracy','%',20,'HIGHER',0.9,'Plan vs actual achieved at company level; quality of planning',1),
  ('PROC_COORD','CROSS_DEPT','Inter-Department Coordination Issues Closed','%',15,'HIGHER',0.9,'Cross-dept issues raised vs closed in same week',2),
  ('PROC_COORD','MIS','Daily / Weekly MIS Report Submission','%',15,'HIGHER',1,'Plant MIS, OEE, dispatch reports submitted on time',3),
  ('PROC_COORD','ECN','ECN / Process Change Documentation','%',10,'HIGHER',1,'All process changes documented and circulated within 24 hrs',4),
  ('PROC_COORD','AUDIT_READY','Audit / Compliance Readiness','%',10,'HIGHER',0.9,'Internal/customer audit prep, NC closure',5),
  ('PROC_COORD','CUST_SYNC','Customer Schedule vs Plan Sync','%',10,'HIGHER',0.95,'Customer schedules updated in plan within 24 hrs',6),
  ('PROC_COORD','ACTION_CLOSE','Action Item Closure (from weekly review)','%',10,'HIGHER',0.85,'Actions closed on time / actions owned',7),
  ('PROC_COORD','AUDIT_5S','5S Master Audit (factory-wide)','%',5,'HIGHER',0.85,'Weekly factory-wide 5S audit conducted and reported',8),
  ('PROC_COORD','ESCALATION','Escalation TAT to Plant Head','%',5,'HIGHER',0.95,'Critical issues escalated within agreed SLA',9),
  ('CR_REP','PO_ACK_TAT','Order Acknowledgement TAT (hrs)','hrs',15,'LOWER',4,'Avg hours from PO receipt to formal acknowledgement; target ≤ 4 hrs',1),
  ('CR_REP','CUST_OTD','On-Time Dispatch to Customer','%',20,'HIGHER',0.95,'Orders dispatched on/before due date / total orders',2),
  ('CR_REP','COMPLAINT_TAT','Customer Complaint Resolution TAT (days)','days',15,'LOWER',5,'Avg days to close customer complaints; target ≤ 5 days',3),
  ('CR_REP','QUERY_TAT','Customer Query Response Time (hrs)','hrs',10,'LOWER',2,'Avg hours to first response on queries; target ≤ 2 hrs',4),
  ('CR_REP','COLLECTION','Outstanding Payment Follow-up / Collection %','%',15,'HIGHER',0.85,'Collected ₹ / due ₹ in the week',5),
  ('CR_REP','CONVERSION','New Inquiry Conversion Rate','%',5,'HIGHER',0.25,'Inquiries converted to orders / inquiries received',6),
  ('CR_REP','PULSE','Customer Satisfaction Pulse (weekly check-ins)','%',10,'HIGHER',1,'% of top 10 customers contacted with feedback log',7),
  ('CR_REP','SAMPLE_OTD','Sample Dispatch On-time','%',5,'HIGHER',0.95,'Samples dispatched on agreed date / total promised',8),
  ('CR_REP','CRM_DISC','CRM / Order Tracker Update Discipline','%',5,'HIGHER',1,'Order tracker updated daily, no missing entries',9),
  ('MAINT','UPTIME','Machine Uptime (%) — Plant Level','%',20,'HIGHER',0.92,'Total running hours / available hours, all machines',1),
  ('MAINT','MTTR','MTTR — Mean Time to Repair (hrs)','hrs',15,'LOWER',1.5,'Avg hours to restore machine after breakdown; target ≤ 1.5 hrs',2),
  ('MAINT','MTBF','MTBF — Mean Time Between Failures (hrs)','hrs',10,'HIGHER',80,'Avg running hours between failures; target ≥ 80 hrs',3),
  ('MAINT','PM_PLAN','Preventive Maintenance Plan Adherence','%',15,'HIGHER',0.95,'PM jobs completed on schedule / planned PM jobs',4),
  ('MAINT','BD_RESPONSE','Breakdown Response Time (minutes)','min',10,'LOWER',10,'Avg time from call to technician on site; target ≤ 10 min',5),
  ('MAINT','SPARES_AVAIL','Critical Spares Availability','%',10,'HIGHER',0.95,'Critical spares in stock vs min level',6),
  ('MAINT','REPEAT_BD','Repeat Breakdown Rate (same root cause)','%',10,'LOWER',0.1,'Repeat failures / total failures; target ≤ 10%',7),
  ('MAINT','ENERGY','Energy / Utility Consumption Tracking','%',5,'HIGHER',1,'Weekly KWH / DG / compressor data captured and reviewed',8),
  ('MAINT','SAFETY_MAINT','Safety from Maintenance Activity','Y/N',5,'BINARY',1,'Zero incidents from maintenance work — LOTO, electrical safety',9)
) as v(role_code, code, name, unit, weight, direction, default_target, calc_basis, sort_order)
join public.acc_roles r on r.code = v.role_code
on conflict (role_id, code) do nothing;
