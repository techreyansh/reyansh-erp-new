-- Accountability Module — interconnect with the ERP employee master + live scoring.
-- Goal: every ERP employee is auto-listed in the Accountability Module (no manual
-- self-registration required), each person sees their own live score + action items
-- on their dashboard, and scores recompute server-side and stream over realtime.

-- ============ 1. Link acc_employees to the ERP master ============
-- Identity was auth-only before. Add email + employee_code so we can match the HR
-- master (employees_data) and back-fill user_id on first login. Role becomes
-- nullable so unmapped staff can still be listed and assigned a role later.
alter table public.acc_employees add column if not exists email text;
alter table public.acc_employees add column if not exists employee_code text;
alter table public.acc_employees alter column role_id drop not null;

create unique index if not exists acc_employees_email_uniq
  on public.acc_employees (lower(email)) where email is not null;
create unique index if not exists acc_employees_code_uniq
  on public.acc_employees (employee_code) where employee_code is not null;

-- ============ 2. Role auto-mapping (Designation/Department -> acc_role) ============
create or replace function public.acc_role_id_for(p_desig text, p_dept text)
returns uuid language sql stable as $func$
  select id from public.acc_roles where code = (
    case
      when p_desig ilike '%mould%' or p_desig ilike '%mold%' or p_dept ilike '%mould%' or p_dept ilike '%mold%' then 'PROD_MOULD'
      when p_desig ilike '%cable%' or p_dept ilike '%cable%' then 'PROD_CABLE'
      when p_desig ilike '%line lead%' or p_desig ilike '%line leader%' or p_desig ilike '%supervisor%' or p_desig ilike '%foreman%' then 'LINE_LEAD'
      when p_desig ilike '%store%' or p_dept ilike '%store%' or p_desig ilike '%warehouse%' or p_desig ilike '%inventory%' then 'STORE'
      when p_desig ilike '%npd%' or p_desig ilike '%new product%' or p_desig ilike '%develop%' or p_dept ilike '%npd%' or p_desig ilike '%design%' then 'NPD'
      when p_desig ilike '%purchase%' or p_desig ilike '%procure%' or p_dept ilike '%purchase%' or p_dept ilike '%procure%' then 'PURCHASE'
      when p_desig ilike '%process co%' or p_desig ilike '%ppc%' or p_desig ilike '%planning%' or p_desig ilike '%coordinat%' then 'PROC_COORD'
      when p_desig ilike '%customer%' or p_desig ilike '%crm%' or p_desig ilike '%sales%' or p_desig ilike '%client%' or p_dept ilike '%sales%' or p_dept ilike '%crm%' then 'CR_REP'
      when p_desig ilike '%maint%' or p_dept ilike '%maint%' or p_desig ilike '%mechanic%' or p_desig ilike '%electric%' or p_desig ilike '%technician%' then 'MAINT'
      when p_desig ilike '%production%' or p_dept ilike '%production%' then 'PROD_CABLE'
      else null
    end);
$func$;

-- ============ 3. Caller resolution (by auth uid, else by email; back-fill uid) ============
create or replace function public.acc_resolve_me()
returns uuid language plpgsql security definer as $func$
declare v_emp uuid; v_email text;
begin
  select id into v_emp from public.acc_employees where user_id = auth.uid() and is_active limit 1;
  if v_emp is not null then return v_emp; end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_email = '' then return null; end if;
  update public.acc_employees set user_id = auth.uid()
    where lower(email) = v_email and user_id is null and is_active
    returning id into v_emp;
  if v_emp is not null then return v_emp; end if;
  select id into v_emp from public.acc_employees where lower(email) = v_email and is_active limit 1;
  return v_emp;
end; $func$;

-- System role of the caller (email-aware now).
create or replace function public.acc_my_role()
returns text language plpgsql stable security definer as $func$
declare v_emp uuid; v_role text;
begin
  v_emp := public.acc_resolve_me();
  if v_emp is null then return null; end if;
  select system_role into v_role from public.acc_employees where id = v_emp;
  return v_role;
end; $func$;

-- Get-or-create the caller's current-week scorecard (re-snapshots KPIs each call,
-- so a later role assignment self-heals an empty scorecard). Email-aware.
create or replace function public.acc_my_current_scorecard()
returns uuid language plpgsql security definer as $func$
declare v_emp uuid; v_role uuid; v_week uuid; v_sc uuid;
begin
  v_emp := public.acc_resolve_me();
  if v_emp is null then return null; end if;
  select role_id into v_role from public.acc_employees where id = v_emp;
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

-- Get-or-create the current-week scorecard for the employee identified by email
-- (used by manager / dashboard views that show a specific person).
create or replace function public.acc_scorecard_for_email(p_email text)
returns uuid language plpgsql security definer as $func$
declare v_emp uuid; v_role uuid; v_week uuid; v_sc uuid;
begin
  if p_email is null or p_email = '' then return null; end if;
  select id, role_id into v_emp, v_role from public.acc_employees
    where lower(email) = lower(p_email) and is_active limit 1;
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

-- ============ 4. Sync the whole ERP employee master into the register ============
-- Idempotent: inserts new staff, refreshes name/email/code and back-fills user_id
-- + an auto-mapped role where one is still missing. Never overwrites a role that
-- has already been assigned manually.
create or replace function public.acc_sync_employees()
returns int language plpgsql security definer as $func$
declare r record; v_count int := 0; v_role uuid; v_uid uuid; v_existing uuid;
        v_email text; v_code text; v_name text; v_status text;
begin
  for r in select record from public.employees_data loop
    v_name   := coalesce(nullif(trim(r.record ->> 'EmployeeName'), ''), nullif(trim(r.record ->> 'Name'), ''));
    v_code   := nullif(trim(r.record ->> 'EmployeeCode'), '');
    v_email  := lower(nullif(trim(r.record ->> 'Email'), ''));
    v_status := coalesce(r.record ->> 'Status', 'Active');
    if v_name is null and v_code is null then continue; end if;

    v_role := public.acc_role_id_for(coalesce(r.record ->> 'Designation', ''), coalesce(r.record ->> 'Department', ''));

    select id into v_existing from public.acc_employees
      where (v_code is not null and employee_code = v_code)
         or (v_email is not null and lower(email) = v_email)
      limit 1;

    v_uid := null;
    if v_email is not null then
      select id into v_uid from auth.users where lower(email) = v_email limit 1;
    end if;

    if v_existing is null then
      insert into public.acc_employees (full_name, employee_code, email, role_id, user_id, is_active, system_role)
      values (coalesce(v_name, v_code), v_code, v_email, v_role, v_uid,
              v_status !~* 'inactive|resign|left|terminat|exit', 'HOD');
      v_count := v_count + 1;
    else
      update public.acc_employees set
        full_name     = coalesce(v_name, full_name),
        employee_code = coalesce(v_code, employee_code),
        email         = coalesce(v_email, email),
        user_id       = coalesce(user_id, v_uid),
        role_id       = coalesce(role_id, v_role)
      where id = v_existing;
    end if;
  end loop;
  return v_count;
end; $func$;

-- ============ 5. Assign / change a person's accountability role ============
create or replace function public.acc_assign_role(p_employee uuid, p_role_code text, p_system_role text default null)
returns void language plpgsql security definer as $func$
declare v_role uuid;
begin
  select id into v_role from public.acc_roles where code = p_role_code;
  if v_role is null then raise exception 'Unknown role code %', p_role_code; end if;
  update public.acc_employees
    set role_id = v_role, system_role = coalesce(p_system_role, system_role)
  where id = p_employee;
end; $func$;

-- ============ 6. Roster: every employee + current-week score/band ============
create or replace function public.acc_roster()
returns table (
  employee_id uuid, full_name text, email text, employee_code text,
  role_code text, role_name text, system_role text, is_active boolean,
  has_login boolean, score numeric, band text, status text
) language sql security definer as $func$
  with wk as (
    select id from public.acc_weeks
    where week_start = date_trunc('week', current_date)::date
    limit 1
  )
  select e.id, e.full_name, e.email, e.employee_code,
         r.code, r.name, e.system_role, e.is_active,
         (e.user_id is not null),
         sc.final_score_pct, sc.band, sc.status
  from public.acc_employees e
  left join public.acc_roles r on r.id = e.role_id
  left join wk on true
  left join public.acc_scorecards sc on sc.employee_id = e.id and sc.week_id = wk.id
  order by e.is_active desc, coalesce(sc.final_score_pct, -1) asc, e.full_name;
$func$;

-- ============ 7. Live: stream scorecard changes to open dashboards ============
-- REPLICA IDENTITY FULL so realtime UPDATE events carry employee_id and the
-- per-employee subscription filter (employee_id=eq.X) matches reliably.
alter table public.acc_scorecards replica identity full;

do $rt$
begin
  begin
    alter publication supabase_realtime add table public.acc_scorecards;
  exception when duplicate_object then null; when others then null; end;
  begin
    alter publication supabase_realtime add table public.acc_scorecard_kpis;
  exception when duplicate_object then null; when others then null; end;
  begin
    alter publication supabase_realtime add table public.acc_action_items;
  exception when duplicate_object then null; when others then null; end;
end $rt$;
