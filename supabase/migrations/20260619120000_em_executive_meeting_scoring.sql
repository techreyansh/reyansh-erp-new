-- =============================================================================
-- EM "Executive Meeting" — Accountability Scoring ENGINE
-- =============================================================================
-- Adds deadline-shift tracking to public.tasks, a per-slip reschedule log,
-- quarterly recurrence for task_templates, and a weekly per-person scoring RPC
-- with a 50/30/20 rubric (Tasks / Checklist / Reschedule discipline), plus a
-- roster RPC over the accountability employee register.
--
-- Fully idempotent: every object uses IF NOT EXISTS / OR REPLACE / guarded DO
-- blocks, so re-running the whole file is safe.
--
-- Real-schema notes (verified, NOT guessed):
--   * public.tasks         : assigned_email text, assigned_to uuid, due_date date,
--                            task_status text ('pending'|'in_progress'|'completed'|'blocked'),
--                            priority, department, updated_at. assigned_email was
--                            added by erp_rbac_tasks_complete.sql / database_audit.sql.
--   * public.task_instances: email column is assigned_to_email; due_date is timestamptz;
--                            status ('pending'|'submitted'|'approved'|'rejected'); is_late bool.
--   * public.task_templates: task_type CHECK ('daily','weekly','monthly') — inline,
--                            so auto-named task_templates_task_type_check.
--   * public.acc_employees : email, employee_code, user_id, full_name, is_active.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- =============================================================================
-- PART A — Deadline-shift tracking on public.tasks
-- =============================================================================

alter table public.tasks add column if not exists original_due_date date;
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.tasks add column if not exists reschedule_count integer not null default 0;
alter table public.tasks add column if not exists difficulty smallint not null default 1; -- 1=small,2=medium,3=large

create index if not exists idx_tasks_original_due_date on public.tasks (original_due_date);
create index if not exists idx_tasks_completed_at on public.tasks (completed_at);

-- Per-slip reschedule log.
create table if not exists public.task_reschedules (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  old_due_date date,
  new_due_date date,
  changed_by_email text,
  changed_at timestamptz default now(),
  reason text
);

create index if not exists idx_task_reschedules_task on public.task_reschedules (task_id);
create index if not exists idx_task_reschedules_changed_at on public.task_reschedules (changed_at);

-- BEFORE INSERT: anchor original_due_date to the first due_date.
create or replace function public.tasks_set_original_due_date()
returns trigger
language plpgsql
as $func$
begin
  new.original_due_date := coalesce(new.original_due_date, new.due_date);
  return new;
end;
$func$;

drop trigger if exists trg_tasks_set_original_due_date on public.tasks;
create trigger trg_tasks_set_original_due_date
before insert on public.tasks
for each row execute function public.tasks_set_original_due_date();

-- BEFORE UPDATE: log reschedules, bump count, keep earliest original, stamp completion.
create or replace function public.tasks_track_reschedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  -- Deadline shifted -> record the slip and keep the earliest original due date.
  if new.due_date is distinct from old.due_date then
    insert into public.task_reschedules (task_id, old_due_date, new_due_date, changed_by_email)
    values (old.id, old.due_date, new.due_date, public.current_user_email());

    new.reschedule_count := coalesce(old.reschedule_count, 0) + 1;
    new.original_due_date := coalesce(old.original_due_date, old.due_date);
  end if;

  -- Auto-stamp completion the first time the task transitions to 'completed'.
  if new.task_status = 'completed'
     and old.task_status is distinct from 'completed'
     and new.completed_at is null then
    new.completed_at := now();
  end if;

  return new;
end;
$func$;

drop trigger if exists trg_tasks_track_reschedule on public.tasks;
create trigger trg_tasks_track_reschedule
before update on public.tasks
for each row execute function public.tasks_track_reschedule();

-- =============================================================================
-- PART B — Quarterly recurrence for task_templates
-- =============================================================================
-- Drop the existing task_type CHECK (whatever its name) and re-add allowing
-- daily / weekly / monthly / quarterly. Guarded so it never errors on re-run
-- and never breaks existing rows (all existing values stay valid).
do $btype$
declare
  v_conname text;
begin
  -- Find any CHECK constraint on task_templates that governs task_type.
  for v_conname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'task_templates'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%task_type%'
  loop
    execute format('alter table public.task_templates drop constraint %I', v_conname);
  end loop;

  -- (Re-)add the widened constraint only if it is not already present.
  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'task_templates'
      and con.conname = 'task_templates_task_type_check'
  ) then
    alter table public.task_templates
      add constraint task_templates_task_type_check
      check (task_type in ('daily', 'weekly', 'monthly', 'quarterly'));
  end if;
end;
$btype$;

-- =============================================================================
-- PART C — Weekly per-person scoring RPC
-- =============================================================================
-- Rubric weights: Tasks 0.50, Checklist 0.30, Reschedule 0.20.
-- Final = round( sum(w_i * pillar_i) / sum(w_i where pillar_i not null) ),
-- renormalised over the non-null pillars. Band: >=85 GREEN, >=70 AMBER, else RED.
create or replace function public.em_person_week_score(p_email text, p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_email      text := lower(trim(coalesce(p_email, '')));
  v_week_end   date := p_week_start + 6;

  -- Weights
  w_tasks      numeric := 0.50;
  w_checklist  numeric := 0.30;
  w_reschedule numeric := 0.20;

  -- Tasks pillar
  v_tasks_num  numeric := 0;   -- sum(credit * difficulty)
  v_tasks_den  numeric := 0;   -- sum(difficulty)
  v_tasks_pillar numeric;      -- null when no tasks in window

  -- Say/Do + counts
  v_total_committed     integer := 0;
  v_completed_committed integer := 0;
  v_done       integer := 0;
  v_late       integer := 0;
  v_not_done   integer := 0;
  v_rescheduled integer := 0;

  -- Checklist pillar
  v_chk_due          integer := 0;
  v_chk_on_schedule  integer := 0;
  v_checklist_pillar numeric;  -- null when nothing due

  -- Reschedule pillar
  v_slips    integer := 0;
  v_penalty  numeric := 0;
  v_resched_pillar numeric;

  -- Final
  v_num   numeric := 0;
  v_den   numeric := 0;
  v_final integer;
  v_band  text;
  v_say_do integer;

  -- JSON arrays
  v_work_done       jsonb := '[]'::jsonb;
  v_work_not_done   jsonb := '[]'::jsonb;
  v_rescheduled_arr jsonb := '[]'::jsonb;
begin
  if v_email = '' then
    return jsonb_build_object('error', 'empty email');
  end if;

  -- ---------------------------------------------------------------------------
  -- TASKS PILLAR (weight 0.50)
  -- Window key = coalesce(original_due_date, due_date), so rescheduling OUT of
  -- the week does not let a task escape scoring.
  -- ---------------------------------------------------------------------------
  with scoped as (
    select
      t.id,
      t.title,
      t.due_date,
      t.original_due_date,
      t.task_status,
      coalesce(t.reschedule_count, 0)                          as reschedule_count,
      greatest(coalesce(t.difficulty, 1), 1)                   as difficulty,
      t.completed_at,
      case
        when t.task_status = 'completed' then
          case
            when coalesce(t.reschedule_count, 0) > 0 then 0.6  -- rescheduled-then-done
            when t.completed_at is null
                 or t.completed_at::date <= t.due_date then 1.0 -- on-time
            else 0.5                                            -- late
          end
        else 0.0                                                -- not done
      end as credit,
      case
        when t.task_status = 'completed' and coalesce(t.reschedule_count, 0) > 0 then 'rescheduled_done'
        when t.task_status = 'completed'
             and (t.completed_at is null or t.completed_at::date <= t.due_date) then 'on_time'
        when t.task_status = 'completed' then 'late'
        else 'not_done'
      end as outcome
    from public.tasks t
    where lower(t.assigned_email) = v_email
      and coalesce(t.original_due_date, t.due_date) between p_week_start and v_week_end
  )
  select
    coalesce(sum(credit * difficulty), 0),
    coalesce(sum(difficulty), 0),
    count(*),
    count(*) filter (where task_status = 'completed'),
    count(*) filter (where outcome in ('on_time')),
    count(*) filter (where outcome = 'late'),
    count(*) filter (where outcome = 'not_done'),
    count(*) filter (where outcome = 'rescheduled_done'),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id, 'title', title, 'due_date', due_date,
          'original_due_date', original_due_date, 'outcome', outcome
        ) order by due_date
      ) filter (where task_status = 'completed'),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id, 'title', title, 'due_date', due_date,
          'original_due_date', original_due_date, 'outcome', outcome
        ) order by due_date
      ) filter (where task_status <> 'completed'),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id, 'title', title, 'due_date', due_date,
          'original_due_date', original_due_date, 'outcome', outcome
        ) order by due_date
      ) filter (where reschedule_count > 0),
      '[]'::jsonb
    )
  into
    v_tasks_num, v_tasks_den, v_total_committed, v_completed_committed,
    v_done, v_late, v_not_done, v_rescheduled,
    v_work_done, v_work_not_done, v_rescheduled_arr
  from scoped;

  -- v_done holds on-time, non-rescheduled completions (mutually exclusive with
  -- v_late and v_rescheduled). v_completed_committed = v_done + v_late + v_rescheduled.

  if v_total_committed = 0 then
    v_tasks_pillar := null;
  else
    v_tasks_pillar := (v_tasks_num / nullif(v_tasks_den, 0)) * 100;
  end if;

  -- ---------------------------------------------------------------------------
  -- CHECKLIST PILLAR (weight 0.30)
  -- task_instances email column = assigned_to_email; due_date is timestamptz.
  -- ---------------------------------------------------------------------------
  select
    count(*),
    count(*) filter (where ti.status = 'approved' and ti.is_late = false)
  into v_chk_due, v_chk_on_schedule
  from public.task_instances ti
  where lower(trim(coalesce(ti.assigned_to_email, ''))) = v_email
    and ti.due_date::date between p_week_start and v_week_end;

  if v_chk_due = 0 then
    v_checklist_pillar := null;
  else
    v_checklist_pillar := (v_chk_on_schedule::numeric / nullif(v_chk_due, 0)) * 100;
  end if;

  -- ---------------------------------------------------------------------------
  -- RESCHEDULE PILLAR (weight 0.20)
  -- Per-slip count = task_reschedules committed this week on this person's tasks.
  -- Escalating cumulative penalty: 1st slip 10, 2nd 25, 3rd+ 50 each.
  --   n=1 -> 10 ; n=2 -> 35 ; n=3 -> 85 ; +50 per extra slip.
  -- ---------------------------------------------------------------------------
  select count(*)
  into v_slips
  from public.task_reschedules tr
  join public.tasks t on t.id = tr.task_id
  where lower(t.assigned_email) = v_email
    and tr.changed_at::date between p_week_start and v_week_end;

  if v_slips <= 0 then
    v_penalty := 0;
  elsif v_slips = 1 then
    v_penalty := 10;
  elsif v_slips = 2 then
    v_penalty := 35;
  else
    -- 1st(10) + 2nd(25) + (n-2)*50  =  35 + (n-2)*50
    v_penalty := 35 + (v_slips - 2) * 50;
  end if;

  v_resched_pillar := greatest(0, 100 - v_penalty);  -- n=0 -> 100

  -- ---------------------------------------------------------------------------
  -- FINAL — renormalise over non-null pillars.
  -- ---------------------------------------------------------------------------
  if v_tasks_pillar is not null then
    v_num := v_num + w_tasks * v_tasks_pillar;
    v_den := v_den + w_tasks;
  end if;
  if v_checklist_pillar is not null then
    v_num := v_num + w_checklist * v_checklist_pillar;
    v_den := v_den + w_checklist;
  end if;
  -- Reschedule pillar is always non-null (defaults to 100).
  v_num := v_num + w_reschedule * v_resched_pillar;
  v_den := v_den + w_reschedule;

  if v_den > 0 then
    v_final := round(v_num / v_den)::integer;
  else
    v_final := null;
  end if;

  if v_final is null then
    v_band := null;
  elsif v_final >= 85 then
    v_band := 'GREEN';
  elsif v_final >= 70 then
    v_band := 'AMBER';
  else
    v_band := 'RED';
  end if;

  -- say/do = completed committed / total committed.
  if v_total_committed > 0 then
    v_say_do := round((v_completed_committed::numeric / nullif(v_total_committed, 0)) * 100)::integer;
  else
    v_say_do := null;
  end if;

  return jsonb_build_object(
    'email', v_email,
    'week_start', p_week_start,
    'week_end', v_week_end,
    'final_score', v_final,
    'band', v_band,
    'say_do', v_say_do,
    'pillars', jsonb_build_object(
      'tasks', jsonb_build_object('weight', w_tasks, 'score',
        case when v_tasks_pillar is null then null else round(v_tasks_pillar, 2) end),
      'checklist', jsonb_build_object('weight', w_checklist, 'score',
        case when v_checklist_pillar is null then null else round(v_checklist_pillar, 2) end),
      'reschedule', jsonb_build_object('weight', w_reschedule, 'score',
        round(v_resched_pillar, 2), 'slips', v_slips, 'penalty', v_penalty)
    ),
    'counts', jsonb_build_object(
      'done', v_done,
      'late', v_late,
      'not_done', v_not_done,
      'rescheduled', v_rescheduled,
      'checklist_due', v_chk_due,
      'checklist_on_schedule', v_chk_on_schedule
    ),
    'work_done', v_work_done,
    'work_not_done', v_work_not_done,
    'rescheduled', v_rescheduled_arr
  );
end;
$func$;

-- =============================================================================
-- PART D — Roster RPC over the accountability employee register
-- =============================================================================
create or replace function public.em_roster(p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_out jsonb := '[]'::jsonb;
  r record;
  v_score jsonb;
begin
  for r in
    select e.id, e.full_name, e.email, e.employee_code
    from public.acc_employees e
    where e.is_active
      and e.email is not null
      and trim(e.email) <> ''
    order by e.full_name
  loop
    v_score := public.em_person_week_score(r.email, p_week_start);

    -- Skip gracefully if the per-person call returned an error payload.
    if v_score ? 'error' then
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'employee_id', r.id,
      'name', r.full_name,
      'email', r.email,
      'employee_code', r.employee_code,
      'final_score', v_score -> 'final_score',
      'band', v_score -> 'band'
    );
  end loop;

  return v_out;
end;
$func$;

-- =============================================================================
-- PART E — Grants (functions are security definer; they bypass RLS for reads)
-- =============================================================================
revoke all on function public.em_person_week_score(text, date) from public;
grant execute on function public.em_person_week_score(text, date) to authenticated;

revoke all on function public.em_roster(date) from public;
grant execute on function public.em_roster(date) to authenticated;

commit;
