-- Checklist module extension:
--   1. Add two cadences requested by the business: "first working day of the
--      week" and "first working day of the month" (weekly_first_day /
--      monthly_first_day).  Stored as task_templates.task_type values so the
--      whole existing pipeline (instances, submit/approve, EM 30% scoring,
--      user_scores) keeps working unchanged.
--   2. Rewrite generate_task_instances_for_date to handle the new cadences AND
--      the previously-unhandled 'quarterly' value (latent bug: a quarterly
--      template produced a NULL period_start_date and aborted the generator).
--   3. Add a horizon generator + a nightly pg_cron job so each person's
--      checklist auto-populates on their dashboard without a manual click.
BEGIN;

-- 1) Widen the task_type CHECK (drop whatever it's currently named, re-add).
do $btype$
declare v_conname text;
begin
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

  alter table public.task_templates
    add constraint task_templates_task_type_check
    check (task_type in ('daily','weekly','monthly','quarterly',
                         'weekly_first_day','monthly_first_day'));
end;
$btype$;

-- 2) Generator: one CASE per cadence. "First working day" = the period's first
--    day shifted off Sat/Sun onto Monday. Postgres date_trunc('week') is Monday
--    (already a working day) so weekly_first_day's due lands on Monday.
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
      END AS period_start_date,
      CASE
        WHEN tt.task_type = 'daily' THEN p_target_date
        WHEN tt.task_type IN ('weekly','weekly_first_day') THEN (date_trunc('week', p_target_date)::date + 6)
        WHEN tt.task_type IN ('monthly','monthly_first_day') THEN ((date_trunc('month', p_target_date) + INTERVAL '1 month - 1 day')::date)
        WHEN tt.task_type = 'quarterly' THEN ((date_trunc('quarter', p_target_date) + INTERVAL '3 months - 1 day')::date)
      END AS period_end_date,
      CASE
        WHEN tt.task_type = 'daily'
          THEN (p_target_date::timestamp + TIME '23:59:59')
        WHEN tt.task_type = 'weekly'
          THEN ((date_trunc('week', p_target_date)::date + 6)::timestamp + TIME '23:59:59')
        -- first working day of the week = Monday (date_trunc('week') is Monday)
        WHEN tt.task_type = 'weekly_first_day'
          THEN (date_trunc('week', p_target_date)::date::timestamp + TIME '23:59:59')
        WHEN tt.task_type = 'monthly'
          THEN (((date_trunc('month', p_target_date) + INTERVAL '1 month - 1 day')::date)::timestamp + TIME '23:59:59')
        -- first working day of the month: shift the 1st off Sat/Sun onto Monday
        WHEN tt.task_type = 'monthly_first_day'
          THEN ((CASE extract(dow FROM date_trunc('month', p_target_date)::date)
                   WHEN 6 THEN date_trunc('month', p_target_date)::date + 2
                   WHEN 0 THEN date_trunc('month', p_target_date)::date + 1
                   ELSE date_trunc('month', p_target_date)::date
                 END)::timestamp + TIME '23:59:59')
        WHEN tt.task_type = 'quarterly'
          THEN (((date_trunc('quarter', p_target_date) + INTERVAL '3 months - 1 day')::date)::timestamp + TIME '23:59:59')
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
      p.template_id,
      p.assigned_to_user_id,
      p.assigned_to_email,
      p.period_start_date,
      p.period_end_date,
      p.due_date,
      'pending'
    FROM prepared p
    ON CONFLICT (template_id, assignee_key, period_start_date) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN COALESCE(v_inserted, 0);
END;
$$;

-- 3) Horizon generator: materialise today..+N days so weekly/monthly items show
--    up under "upcoming" before they're due. Idempotent (ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION public.generate_task_instances_horizon(p_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_i integer;
BEGIN
  FOR v_i IN 0..GREATEST(COALESCE(p_days, 0), 0) LOOP
    v_total := v_total + public.generate_task_instances_for_date((CURRENT_DATE + v_i)::date);
  END LOOP;
  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_task_instances_for_date(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_task_instances_horizon(integer) TO authenticated;

COMMIT;

-- 4) Nightly auto-generation (pg_cron, idempotent). ~23:45 IST = 18:15 UTC.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'checklist-generate-daily') then
      perform cron.unschedule('checklist-generate-daily');
    end if;
    perform cron.schedule('checklist-generate-daily', '15 18 * * *',
      'select public.generate_task_instances_horizon(7);');
  end if;
end;
$cron$;
