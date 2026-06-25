-- EM follow-ups:
--  (1) Fix public.acc_sync_employees() — the prior version read a non-existent
--      jsonb 'record' column. public.employees_data is FLAT-COLUMN with quoted
--      PascalCase columns ("EmployeeCode","EmployeeName","Email","Designation",
--      "Department","JoiningDate","Status"). Rewrite to read those flat columns.
--  (2) Add week-lock RPCs over public.acc_weeks (em_lock_week / em_unlock_week /
--      em_week_status).
-- Idempotent: CREATE OR REPLACE only, plus guarded column-type change.

-- ---------------------------------------------------------------------------
-- (1) acc_sync_employees() — flat-column employees_data -> acc_employees
-- ---------------------------------------------------------------------------
-- acc_employees real columns: id, user_id, full_name, role_id, system_role,
--   reports_to_id, joined_on, is_active, is_demo, email, employee_code.
-- Inserts only rows whose Email is not null and not '' and not already present
-- in acc_employees (matched on lower(email)). Returns count of rows inserted.
create or replace function public.acc_sync_employees()
returns integer
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_count integer := 0;
begin
  with src as (
    select
      lower(trim(ed."Email"))                       as email,
      nullif(trim(ed."EmployeeCode"), '')           as employee_code,
      nullif(trim(ed."EmployeeName"), '')           as full_name,
      ed."JoiningDate"                              as joined_on,
      coalesce(
        lower(coalesce(ed."Status", '')) = 'active' or ed."Status" is null,
        true
      )                                             as is_active,
      case
        when ed."Designation" ilike '%ceo%'      or ed."Designation" ilike '%director%' then 'DIRECTOR'
        when ed."Designation" ilike '%coordinat%'                                       then 'PROCESS_COORD'
        when ed."Designation" ilike '%plant%'                                           then 'PLANT_HEAD'
        else 'HOD'
      end                                           as system_role
    from public.employees_data ed
    where ed."Email" is not null
      and trim(ed."Email") <> ''
  ),
  ins as (
    insert into public.acc_employees
      (email, employee_code, full_name, joined_on, is_active, system_role, is_demo)
    select
      s.email, s.employee_code, s.full_name, s.joined_on,
      s.is_active, s.system_role, false
    from src s
    where not exists (
      select 1 from public.acc_employees e
      where lower(e.email) = s.email
    )
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end;
$func$;

grant execute on function public.acc_sync_employees() to authenticated;

-- ---------------------------------------------------------------------------
-- (2) Week-lock RPCs over public.acc_weeks
-- ---------------------------------------------------------------------------
-- acc_weeks real columns: id, iso_year, iso_week, week_start, week_end,
--   is_locked, locked_by, locked_at, unique(iso_year, iso_week).
-- The week-start column is "week_start"; weeks are keyed by a Monday date.
-- public.acc_ensure_week(p_date date default current_date) returns
--   public.acc_weeks and get-or-creates the row whose week_start is
--   date_trunc('week', p_date)::date (Monday).
--
-- locked_by was originally uuid -> auth.users(id), but these RPCs record the
-- caller's EMAIL (public.current_user_email() returns text). Convert the
-- column to text (dropping the FK) so the email can be stored. Guarded so the
-- migration is idempotent and a no-op if already text.
do $mig$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'acc_weeks'
      and column_name  = 'locked_by'
      and data_type    = 'uuid'
  ) then
    alter table public.acc_weeks drop constraint if exists acc_weeks_locked_by_fkey;
    alter table public.acc_weeks alter column locked_by type text using locked_by::text;
  end if;
end;
$mig$;

-- Lock the week for the given Monday (ensures the row exists first).
create or replace function public.em_lock_week(p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_week public.acc_weeks;
  v_email text := public.current_user_email();
begin
  v_week := public.acc_ensure_week(p_week_start);

  update public.acc_weeks
     set is_locked = true,
         locked_by = v_email,
         locked_at = now()
   where id = v_week.id
   returning * into v_week;

  return jsonb_build_object(
    'locked',    true,
    'locked_by', v_week.locked_by,
    'locked_at', v_week.locked_at
  );
end;
$func$;

-- Unlock the week for the given Monday (clears locked_by / locked_at).
create or replace function public.em_unlock_week(p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_week public.acc_weeks;
begin
  v_week := public.acc_ensure_week(p_week_start);

  update public.acc_weeks
     set is_locked = false,
         locked_by = null,
         locked_at = null
   where id = v_week.id
   returning * into v_week;

  return jsonb_build_object(
    'locked',    false,
    'locked_by', v_week.locked_by,
    'locked_at', v_week.locked_at
  );
end;
$func$;

-- Report lock status for the given Monday (locked=false if no row exists).
create or replace function public.em_week_status(p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_week public.acc_weeks;
begin
  select * into v_week
  from public.acc_weeks
  where week_start = date_trunc('week', p_week_start)::date
  limit 1;

  if not found then
    return jsonb_build_object(
      'locked',    false,
      'locked_by', null,
      'locked_at', null
    );
  end if;

  return jsonb_build_object(
    'locked',    coalesce(v_week.is_locked, false),
    'locked_by', v_week.locked_by,
    'locked_at', v_week.locked_at
  );
end;
$func$;

grant execute on function public.em_lock_week(date)   to authenticated;
grant execute on function public.em_unlock_week(date) to authenticated;
grant execute on function public.em_week_status(date) to authenticated;
