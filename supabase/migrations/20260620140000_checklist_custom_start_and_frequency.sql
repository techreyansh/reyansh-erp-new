-- Checklist module: custom START DATE (anchor) + custom FREQUENCY (every N
-- day/week/month). Additive — existing templates (start_date NULL, preset
-- task_type) behave exactly as before.
BEGIN;

-- New columns on the template.
ALTER TABLE public.task_templates ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.task_templates ADD COLUMN IF NOT EXISTS recurrence_unit text;
ALTER TABLE public.task_templates ADD COLUMN IF NOT EXISTS recurrence_interval integer DEFAULT 1;

-- recurrence_unit only meaningful for the 'custom' cadence.
do $u$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_templates_recurrence_unit_check'
  ) then
    alter table public.task_templates
      add constraint task_templates_recurrence_unit_check
      check (recurrence_unit is null or recurrence_unit in ('day','week','month'));
  end if;
end;
$u$;

-- Allow the 'custom' task_type (re-add the widened CHECK).
do $btype$
declare v_conname text;
begin
  for v_conname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'task_templates'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%task_type%'
  loop
    execute format('alter table public.task_templates drop constraint %I', v_conname);
  end loop;
  alter table public.task_templates
    add constraint task_templates_task_type_check
    check (task_type in ('daily','weekly','monthly','quarterly',
                         'weekly_first_day','monthly_first_day','custom'));
end;
$btype$;

-- Generator: gate every template by start_date; add the 'custom' branch
-- (every N day/week/month anchored on start_date).
CREATE OR REPLACE FUNCTION public.generate_task_instances_for_date(
  p_target_date date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH expanded AS (
    SELECT
      tt.id AS template_id,
      tt.task_type,
      COALESCE(tt.assigned_user_id, u.id) AS assigned_to_user_id,
      lower(trim(COALESCE(tt.assigned_email, u.email))) AS assigned_to_email,
      CASE
        WHEN tt.task_type = 'daily' THEN p_target_date
        WHEN tt.task_type IN ('weekly','weekly_first_day') THEN date_trunc('week', p_target_date)::date
        WHEN tt.task_type IN ('monthly','monthly_first_day') THEN date_trunc('month', p_target_date)::date
        WHEN tt.task_type = 'quarterly' THEN date_trunc('quarter', p_target_date)::date
        WHEN tt.task_type = 'custom' THEN
          CASE WHEN tt.start_date IS NOT NULL AND p_target_date >= tt.start_date AND (
                (tt.recurrence_unit = 'day'
                   AND (p_target_date - tt.start_date) % GREATEST(COALESCE(tt.recurrence_interval,1),1) = 0)
             OR (tt.recurrence_unit = 'week'
                   AND (p_target_date - tt.start_date) % (7 * GREATEST(COALESCE(tt.recurrence_interval,1),1)) = 0)
             OR (tt.recurrence_unit = 'month'
                   AND (((extract(year FROM p_target_date) - extract(year FROM tt.start_date)) * 12
                        + (extract(month FROM p_target_date) - extract(month FROM tt.start_date)))::int
                        % GREATEST(COALESCE(tt.recurrence_interval,1),1)) = 0
                   AND extract(day FROM p_target_date) = LEAST(
                         extract(day FROM tt.start_date),
                         extract(day FROM (date_trunc('month', p_target_date) + INTERVAL '1 month - 1 day'))))
              ) THEN p_target_date ELSE NULL END
      END AS period_start_date,
      CASE
        WHEN tt.task_type = 'daily' THEN p_target_date
        WHEN tt.task_type IN ('weekly','weekly_first_day') THEN (date_trunc('week', p_target_date)::date + 6)
        WHEN tt.task_type IN ('monthly','monthly_first_day') THEN ((date_trunc('month', p_target_date) + INTERVAL '1 month - 1 day')::date)
        WHEN tt.task_type = 'quarterly' THEN ((date_trunc('quarter', p_target_date) + INTERVAL '3 months - 1 day')::date)
        WHEN tt.task_type = 'custom' THEN p_target_date
      END AS period_end_date,
      CASE
        WHEN tt.task_type = 'daily'
          THEN (p_target_date::timestamp + TIME '23:59:59')
        WHEN tt.task_type = 'weekly'
          THEN ((date_trunc('week', p_target_date)::date + 6)::timestamp + TIME '23:59:59')
        WHEN tt.task_type = 'weekly_first_day'
          THEN (date_trunc('week', p_target_date)::date::timestamp + TIME '23:59:59')
        WHEN tt.task_type = 'monthly'
          THEN (((date_trunc('month', p_target_date) + INTERVAL '1 month - 1 day')::date)::timestamp + TIME '23:59:59')
        WHEN tt.task_type = 'monthly_first_day'
          THEN ((CASE extract(dow FROM date_trunc('month', p_target_date)::date)
                   WHEN 6 THEN date_trunc('month', p_target_date)::date + 2
                   WHEN 0 THEN date_trunc('month', p_target_date)::date + 1
                   ELSE date_trunc('month', p_target_date)::date
                 END)::timestamp + TIME '23:59:59')
        WHEN tt.task_type = 'quarterly'
          THEN (((date_trunc('quarter', p_target_date) + INTERVAL '3 months - 1 day')::date)::timestamp + TIME '23:59:59')
        WHEN tt.task_type = 'custom'
          THEN (p_target_date::timestamp + TIME '23:59:59')
      END AS due_date
    FROM public.task_templates tt
    LEFT JOIN public.roles r ON r.code = tt.assigned_role_code
    LEFT JOIN public.users u
      ON (
        (tt.assigned_user_id IS NULL AND tt.assigned_email IS NULL AND tt.assigned_role_code IS NOT NULL AND u.role_id = r.id)
        OR (tt.assigned_user_id = u.id)
        OR (tt.assigned_email IS NOT NULL AND lower(trim(u.email)) = lower(trim(tt.assigned_email)))
      )
    WHERE tt.is_active = true
      AND (tt.start_date IS NULL OR p_target_date >= tt.start_date)
  ), prepared AS (
    SELECT *
    FROM expanded
    WHERE assigned_to_email IS NOT NULL
      AND assigned_to_email <> ''
      AND period_start_date IS NOT NULL
  ), inserted AS (
    INSERT INTO public.task_instances (
      template_id, assigned_to_user_id, assigned_to_email,
      period_start_date, period_end_date, due_date, status
    )
    SELECT
      p.template_id, p.assigned_to_user_id, p.assigned_to_email,
      p.period_start_date, p.period_end_date, p.due_date, 'pending'
    FROM prepared p
    ON CONFLICT (template_id, assignee_key, period_start_date) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN COALESCE(v_inserted, 0);
END;
$$;

COMMIT;
