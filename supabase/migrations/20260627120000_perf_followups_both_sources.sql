-- Performance FOLLOW-UPS category, v2: count BOTH follow-up sources and apply a
-- backlog penalty.
--   * Source A = crm_pipeline.next_action (the "next action" a rep owns).
--   * Source B = crm_pipeline_activity.next_follow_up_date (logged follow-ups).
-- v1 only counted source B, so the follow-ups reps actually work (next_action)
-- never affected the score. Now both count, owned strictly by the employee.
--
-- Model (per person, for the week ending v_end):
--   due = every OPEN follow-up that should be handled by week-end (date <= v_end),
--         which includes still-open OVERDUE backlog from earlier weeks.
--   ok  = open follow-ups that are NOT yet overdue (date >= today) — i.e. on track.
--   Overdue-and-still-open follow-ups sit in `due` but not `ok`, dragging the
--   score down until you DO them (completing clears the date → leaves the set) or
--   RESCHEDULE them (date moves to the future → counts as on-track). So the score
--   moves live as follow-ups change. Weight unchanged at 20%.

CREATE OR REPLACE FUNCTION public.perf_person_week_score(p_email text, p_week_start date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_end date := p_week_start + 6;
  v_today date := current_date;
  v_due int; v_done int; v_ontime int;
  v_chk_due int; v_chk_ok int;
  v_wf_due int; v_wf_ok int;
  v_fu_due int; v_fu_ok int; v_na_due int; v_na_ok int; v_fa_due int; v_fa_ok int;
  v_prod_n int; v_prod_out numeric; v_prod_scrap numeric;
  c_work numeric; c_ontime numeric; c_chk numeric; c_wf numeric; c_fu numeric; c_prod numeric;
  w_work numeric := 0.30; w_ontime numeric := 0.20; w_chk numeric := 0.15; w_wf numeric := 0.10;
  w_fu numeric := 0.20; w_prod numeric := 0.15;
  num numeric := 0; den numeric := 0; v_score numeric; v_band text;
  v_rev public.perf_reviews;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE task_status='completed'),
         count(*) FILTER (WHERE task_status='completed' AND completed_at IS NOT NULL
                          AND completed_at::date <= COALESCE(original_due_date, due_date::date) AND COALESCE(reschedule_count,0)=0)
    INTO v_due, v_done, v_ontime
  FROM public.tasks
  WHERE lower(assigned_email)=v_email
    AND COALESCE(original_due_date, due_date::date) BETWEEN p_week_start AND v_end;
  c_work   := CASE WHEN v_due>0 THEN round(v_done::numeric*100/v_due,1) END;
  c_ontime := CASE WHEN v_due>0 THEN round(v_ontime::numeric*100/v_due,1) END;

  SELECT count(*), count(*) FILTER (WHERE status='approved' AND is_late=false)
    INTO v_chk_due, v_chk_ok
  FROM public.task_instances
  WHERE lower(coalesce(assigned_to_email,''))=v_email AND due_date::date BETWEEN p_week_start AND v_end;
  c_chk := CASE WHEN v_chk_due>0 THEN round(v_chk_ok::numeric*100/v_chk_due,1) END;

  SELECT count(*), count(*) FILTER (WHERE status='done' AND completed_at IS NOT NULL AND completed_at::date <= COALESCE(due_date, completed_at::date))
    INTO v_wf_due, v_wf_ok
  FROM public.perf_workflow_steps
  WHERE lower(coalesce(owner_email,''))=v_email AND due_date BETWEEN p_week_start AND v_end;
  c_wf := CASE WHEN v_wf_due>0 THEN round(v_wf_ok::numeric*100/v_wf_due,1) END;

  -- FOLLOW-UPS source A: crm_pipeline.next_action (open = next_action_date NOT NULL).
  SELECT count(*) FILTER (WHERE next_action_date <= v_end),
         count(*) FILTER (WHERE next_action_date <= v_end AND next_action_date >= v_today)
    INTO v_na_due, v_na_ok
  FROM public.crm_pipeline
  WHERE lower(coalesce(owner_email,''))=v_email AND next_action_date IS NOT NULL;

  -- FOLLOW-UPS source B: crm_pipeline_activity (open = date set, not completed/cancelled).
  SELECT count(*) FILTER (WHERE next_follow_up_date <= v_end AND coalesce(status,'open') NOT IN ('completed','cancelled')),
         count(*) FILTER (WHERE next_follow_up_date <= v_end AND next_follow_up_date >= v_today AND coalesce(status,'open') NOT IN ('completed','cancelled'))
    INTO v_fa_due, v_fa_ok
  FROM public.crm_pipeline_activity
  WHERE lower(coalesce(owner_email,''))=v_email AND next_follow_up_date IS NOT NULL;

  v_fu_due := COALESCE(v_na_due,0) + COALESCE(v_fa_due,0);
  v_fu_ok  := COALESCE(v_na_ok,0)  + COALESCE(v_fa_ok,0);
  c_fu := CASE WHEN v_fu_due>0 THEN round(v_fu_ok::numeric*100/v_fu_due,1) END;

  SELECT count(*), COALESCE(sum(output_qty),0), COALESCE(sum(scrap_qty),0)
    INTO v_prod_n, v_prod_out, v_prod_scrap
  FROM public.ppc_wo_stage
  WHERE lower(coalesce(operator_email,''))=v_email AND status='done'
    AND completed_at IS NOT NULL AND completed_at::date BETWEEN p_week_start AND v_end;
  c_prod := CASE WHEN (v_prod_out + v_prod_scrap) > 0
                 THEN round(v_prod_out*100/(v_prod_out + v_prod_scrap),1) END;

  SELECT * INTO v_rev FROM public.perf_reviews WHERE lower(employee_email)=v_email AND week_start=p_week_start;

  IF c_work   IS NOT NULL THEN num := num + w_work*c_work;     den := den + w_work; END IF;
  IF c_ontime IS NOT NULL THEN num := num + w_ontime*c_ontime; den := den + w_ontime; END IF;
  IF c_chk    IS NOT NULL THEN num := num + w_chk*c_chk;       den := den + w_chk; END IF;
  IF c_wf     IS NOT NULL THEN num := num + w_wf*c_wf;         den := den + w_wf; END IF;
  IF c_fu     IS NOT NULL THEN num := num + w_fu*c_fu;         den := den + w_fu; END IF;
  IF c_prod   IS NOT NULL THEN num := num + w_prod*c_prod;     den := den + w_prod; END IF;

  v_score := CASE WHEN den>0 THEN round(num/den) ELSE NULL END;
  v_band := CASE WHEN v_score IS NULL THEN 'no_data'
                 WHEN v_score>=90 THEN 'outstanding' WHEN v_score>=75 THEN 'rising_star'
                 WHEN v_score>=60 THEN 'consistent' ELSE 'needs_attention' END;

  RETURN jsonb_build_object(
    'email', v_email, 'week_start', p_week_start, 'score', v_score, 'band', v_band,
    'categories', jsonb_build_object(
      'work_completed', jsonb_build_object('pct', c_work, 'weight', 30, 'due', v_due, 'done', v_done),
      'on_time',        jsonb_build_object('pct', c_ontime, 'weight', 20, 'on_time', v_ontime),
      'checklist',      jsonb_build_object('pct', c_chk, 'weight', 15, 'due', v_chk_due, 'ok', v_chk_ok),
      'workflow',       jsonb_build_object('pct', c_wf, 'weight', 10, 'due', v_wf_due, 'ok', v_wf_ok),
      'followups',      jsonb_build_object('pct', c_fu, 'weight', 20, 'due', v_fu_due, 'ok', v_fu_ok,
                          'overdue', GREATEST(v_fu_due - v_fu_ok, 0)),
      'production',     jsonb_build_object('pct', c_prod, 'weight', 15, 'stages', v_prod_n, 'output', v_prod_out, 'scrap', v_prod_scrap)),
    'locked', COALESCE(v_rev.locked,false), 'manager_remarks', v_rev.manager_remarks);
END;
$$;
GRANT EXECUTE ON FUNCTION public.perf_person_week_score(text, date) TO authenticated;
