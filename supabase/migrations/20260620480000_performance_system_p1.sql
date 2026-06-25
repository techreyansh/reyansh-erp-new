-- Performance Review System (rebuild of MIS/EM) — Phase 1: DB + scoring engine.
-- Roster comes from public.employees (the SINGLE master) — no duplicate records.
-- 6-category weekly score (Work40/OnTime25/Checklist15/Workflow10/Meeting5/Manager5)
-- with weight renormalization over categories that have data.
BEGIN;

-- 1) Manager evaluation + meeting participation + weekly lock (one row / employee / week).
CREATE TABLE IF NOT EXISTS public.perf_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_email text NOT NULL,
  week_start date NOT NULL,
  meeting_participation int,          -- 0..100 (null -> excluded from score)
  manager_eval int,                   -- 0..100 (null -> excluded)
  manager_remarks text,
  locked boolean DEFAULT false,
  locked_by text, locked_at timestamptz,
  updated_by text, updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_perf_reviews_emp_week ON public.perf_reviews(lower(employee_email), week_start);

-- 2) Commitments (what an employee commits to next week; reviewed next meeting).
CREATE TABLE IF NOT EXISTS public.perf_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_email text NOT NULL,
  week_start date NOT NULL,            -- the week the commitment is FOR
  title text NOT NULL,
  due_date date,
  status text DEFAULT 'committed' CHECK (status IN ('committed','delivered','missed','carried_over')),
  delivered_at timestamptz,
  created_by text, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_perf_commitments_emp_week ON public.perf_commitments(lower(employee_email), week_start);

-- 3) Workflow accountability (multi-step processes with per-step owners + SLAs).
CREATE TABLE IF NOT EXISTS public.perf_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, description text,
  steps jsonb DEFAULT '[]'::jsonb,     -- [{seq, name, owner_role}]
  is_active boolean DEFAULT true, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.perf_workflow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid REFERENCES public.perf_workflows(id) ON DELETE CASCADE,
  reference text, title text, status text DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.perf_workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid REFERENCES public.perf_workflow_instances(id) ON DELETE CASCADE,
  seq int, name text, owner_email text, due_date date, completed_at timestamptz,
  status text DEFAULT 'pending' CHECK (status IN ('pending','done','blocked')), created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_perf_wf_steps_owner ON public.perf_workflow_steps(lower(owner_email));

DO $rls$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['perf_reviews','perf_commitments','perf_workflows','perf_workflow_instances','perf_workflow_steps'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $rls$;

-- 4) Roster from the single employee master.
CREATE OR REPLACE FUNCTION public.perf_roster()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.full_name), '[]'::jsonb) FROM (
    SELECT lower(email) AS email, full_name, COALESCE(employee_code,'') AS employee_code,
           department, designation, reporting_manager
    FROM public.employees WHERE is_active IS NOT FALSE
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.perf_roster() TO authenticated;

-- 5) The scoring engine: 6 categories, renormalized over present data.
CREATE OR REPLACE FUNCTION public.perf_person_week_score(p_email text, p_week_start date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_end date := p_week_start + 6;
  v_due int; v_done int; v_ontime int;
  v_chk_due int; v_chk_ok int;
  v_wf_due int; v_wf_ok int;
  c_work numeric; c_ontime numeric; c_chk numeric; c_wf numeric; c_meet numeric; c_mgr numeric;
  w_work numeric := 0.40; w_ontime numeric := 0.25; w_chk numeric := 0.15; w_wf numeric := 0.10; w_meet numeric := 0.05; w_mgr numeric := 0.05;
  num numeric := 0; den numeric := 0; v_score numeric; v_band text;
  v_rev public.perf_reviews;
BEGIN
  -- TASKS due in the week (by original/effective due date)
  SELECT count(*) , count(*) FILTER (WHERE task_status='completed'),
         count(*) FILTER (WHERE task_status='completed' AND completed_at IS NOT NULL
                          AND completed_at::date <= COALESCE(original_due_date, due_date::date) AND COALESCE(reschedule_count,0)=0)
    INTO v_due, v_done, v_ontime
  FROM public.tasks
  WHERE lower(assigned_email)=v_email
    AND COALESCE(original_due_date, due_date::date) BETWEEN p_week_start AND v_end;
  c_work   := CASE WHEN v_due>0 THEN round(v_done::numeric*100/v_due,1) END;
  c_ontime := CASE WHEN v_due>0 THEN round(v_ontime::numeric*100/v_due,1) END;

  -- CHECKLIST (task_instances approved on-schedule)
  SELECT count(*), count(*) FILTER (WHERE status='approved' AND is_late=false)
    INTO v_chk_due, v_chk_ok
  FROM public.task_instances
  WHERE lower(coalesce(assigned_to_email,''))=v_email AND due_date::date BETWEEN p_week_start AND v_end;
  c_chk := CASE WHEN v_chk_due>0 THEN round(v_chk_ok::numeric*100/v_chk_due,1) END;

  -- WORKFLOW steps owned, due in week, done on time
  SELECT count(*), count(*) FILTER (WHERE status='done' AND completed_at IS NOT NULL AND completed_at::date <= COALESCE(due_date, completed_at::date))
    INTO v_wf_due, v_wf_ok
  FROM public.perf_workflow_steps
  WHERE lower(coalesce(owner_email,''))=v_email AND due_date BETWEEN p_week_start AND v_end;
  c_wf := CASE WHEN v_wf_due>0 THEN round(v_wf_ok::numeric*100/v_wf_due,1) END;

  -- MEETING + MANAGER from the review row
  SELECT * INTO v_rev FROM public.perf_reviews WHERE lower(employee_email)=v_email AND week_start=p_week_start;
  c_meet := v_rev.meeting_participation;
  c_mgr  := v_rev.manager_eval;

  -- renormalize over categories that have data
  IF c_work   IS NOT NULL THEN num := num + w_work*c_work;     den := den + w_work; END IF;
  IF c_ontime IS NOT NULL THEN num := num + w_ontime*c_ontime; den := den + w_ontime; END IF;
  IF c_chk    IS NOT NULL THEN num := num + w_chk*c_chk;       den := den + w_chk; END IF;
  IF c_wf     IS NOT NULL THEN num := num + w_wf*c_wf;         den := den + w_wf; END IF;
  IF c_meet   IS NOT NULL THEN num := num + w_meet*c_meet;     den := den + w_meet; END IF;
  IF c_mgr    IS NOT NULL THEN num := num + w_mgr*c_mgr;       den := den + w_mgr; END IF;

  v_score := CASE WHEN den>0 THEN round(num/den) ELSE NULL END;
  v_band := CASE WHEN v_score IS NULL THEN 'no_data'
                 WHEN v_score>=90 THEN 'outstanding' WHEN v_score>=75 THEN 'rising_star'
                 WHEN v_score>=60 THEN 'consistent' ELSE 'needs_attention' END;

  RETURN jsonb_build_object(
    'email', v_email, 'week_start', p_week_start, 'score', v_score, 'band', v_band,
    'categories', jsonb_build_object(
      'work_completed', jsonb_build_object('pct', c_work, 'weight', 40, 'due', v_due, 'done', v_done),
      'on_time',        jsonb_build_object('pct', c_ontime, 'weight', 25, 'on_time', v_ontime),
      'checklist',      jsonb_build_object('pct', c_chk, 'weight', 15, 'due', v_chk_due, 'ok', v_chk_ok),
      'workflow',       jsonb_build_object('pct', c_wf, 'weight', 10, 'due', v_wf_due, 'ok', v_wf_ok),
      'meeting',        jsonb_build_object('pct', c_meet, 'weight', 5),
      'manager',        jsonb_build_object('pct', c_mgr, 'weight', 5)),
    'locked', COALESCE(v_rev.locked,false), 'manager_remarks', v_rev.manager_remarks);
END;
$$;
GRANT EXECUTE ON FUNCTION public.perf_person_week_score(text, date) TO authenticated;

-- 6) Week summary for the meeting dashboard (all employees + trend vs prior week).
CREATE OR REPLACE FUNCTION public.perf_week_summary(p_week_start date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH roster AS (SELECT lower(email) email, full_name, department, designation FROM public.employees WHERE is_active IS NOT FALSE)
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.score DESC NULLS LAST), '[]'::jsonb) FROM (
    SELECT r.email, r.full_name, r.department, r.designation,
           (public.perf_person_week_score(r.email, p_week_start)->>'score')::int AS score,
           (public.perf_person_week_score(r.email, p_week_start)->>'band') AS band,
           (public.perf_person_week_score(r.email, p_week_start - 7)->>'score')::int AS prev_score
    FROM roster r
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.perf_week_summary(date) TO authenticated;

-- 7) Department dashboard for a week.
CREATE OR REPLACE FUNCTION public.perf_department_dashboard(p_week_start date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH scores AS (
    SELECT lower(e.email) email, e.full_name, e.department,
           (public.perf_person_week_score(lower(e.email), p_week_start)->>'score')::int AS score
    FROM public.employees e WHERE e.is_active IS NOT FALSE)
  SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.team_score DESC NULLS LAST), '[]'::jsonb) FROM (
    SELECT COALESCE(department,'Unassigned') AS department,
           count(*) AS members,
           round(avg(score)) AS team_score,
           count(*) FILTER (WHERE score < 60) AS needs_attention,
           (SELECT jsonb_agg(row_to_json(tp)) FROM (
              SELECT full_name, score FROM scores s2 WHERE COALESCE(s2.department,'Unassigned')=COALESCE(s.department,'Unassigned')
              ORDER BY score DESC NULLS LAST LIMIT 3) tp) AS top_performers
    FROM scores s GROUP BY department
  ) d;
$$;
GRANT EXECUTE ON FUNCTION public.perf_department_dashboard(date) TO authenticated;

COMMIT;
