-- =============================================================================
-- Order-to-Dispatch Workflow Engine — Phase 2: self-running + role-routed
-- =============================================================================
-- Additive on top of Phase 0/1. Adds:
--  - wf_resolve_assignee: role -> department -> owner_email assignee resolution
--  - wf_reconcile_one (CREATE OR REPLACE): spawn now routes to the resolved
--    department assignee instead of always the SO owner
--  - wf_stage_def.owner_role_code seed (which role owns each stage)
--  - wf_reconcile_dirty(): drain the wf_dirty doorbell queue
--  - wf_complete_task(): complete a stage task + reconcile atomically (UI action)
--  - doorbell triggers on ppc_wo / dispatch_plan -> enqueue wf_dirty (near-instant)
--  - pg_cron jobs: 3-min full sweep + 1-min dirty drain
-- Only additive touch to a hot table is the ppc_wo doorbell trigger (a single
-- INSERT...SELECT that is a no-op for WOs not linked to a workflow).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Assignee resolution: role-holder -> department member -> fallback (SO owner)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wf_resolve_assignee(
  p_role_code  text,
  p_department text,
  p_fallback   text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1) an active employee holding the stage's role
    (SELECT e.email
       FROM public.employees e
       JOIN public.roles r ON r.id = e.role_id
      WHERE p_role_code IS NOT NULL
        AND r.code = p_role_code
        AND e.is_active = true
        AND COALESCE(e.email,'') <> ''
      ORDER BY e.email
      LIMIT 1),
    -- 2) any active employee in the stage's department
    (SELECT e.email
       FROM public.employees e
      WHERE p_department IS NOT NULL
        AND lower(trim(e.department)) = lower(trim(p_department))
        AND e.is_active = true
        AND COALESCE(e.email,'') <> ''
      ORDER BY e.email
      LIMIT 1),
    -- 3) the sales order owner
    p_fallback
  );
$$;

-- -----------------------------------------------------------------------------
-- wf_reconcile_one — re-defined: SPAWN routes to the resolved assignee.
-- (Identical to Phase 1 except the one assigned_email expression in SPAWN.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wf_reconcile_one(p_inst uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed   int := 0;
  v_total     int := 0;
  v_iter      int := 0;
  v_so        uuid;
  v_type      text;
  v_owner     text;
  sr          public.wf_stage_run;
  v_sat       boolean;
  v_task      uuid;
  v_open_pred int;
  v_open_all  int;
BEGIN
  SELECT sales_order_id, order_type, owner_email
    INTO v_so, v_type, v_owner
  FROM public.wf_instance WHERE id = p_inst;
  IF v_so IS NULL THEN
    RETURN 0;
  END IF;

  LOOP
    v_iter := v_iter + 1;
    v_changed := 0;

    -- ---- SENSE: only active stages (ready / in_progress) can complete --------
    FOR sr IN
      SELECT * FROM public.wf_stage_run
      WHERE instance_id = p_inst AND status IN ('ready','in_progress')
      ORDER BY sequence
    LOOP
      v_sat := false;

      IF sr.watch_signal = 'so_status' THEN
        SELECT public.wf_so_status_rank(so.status)
                 >= public.wf_so_status_rank(sr.watch_param->>'status')
          INTO v_sat
        FROM public.sales_order so WHERE so.id = v_so;

      ELSIF sr.watch_signal = 'manual' THEN
        v_sat := sr.task_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.tasks t
          WHERE t.id = sr.task_id AND t.task_status = 'completed');

      ELSIF sr.watch_signal = 'dispatch_status' THEN
        IF coalesce(sr.watch_param->>'mode','exists') = 'equals' THEN
          v_sat := EXISTS (SELECT 1 FROM public.dispatch_plan dp
                           WHERE dp.so_id = v_so
                             AND dp.status = (sr.watch_param->>'status'));
        ELSE
          v_sat := EXISTS (SELECT 1 FROM public.dispatch_plan dp WHERE dp.so_id = v_so);
        END IF;

      ELSIF sr.watch_signal = 'kit_issued' THEN
        v_sat := EXISTS (SELECT 1 FROM public.wf_wo_link l
                         WHERE l.instance_id = p_inst AND l.wo_id IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM public.wf_wo_link l
            JOIN public.ppc_wo_material m ON m.work_order_id = l.wo_id
            WHERE l.instance_id = p_inst
              AND coalesce(m.qty_issued,0) < coalesce(m.qty_required,0));

      ELSIF sr.watch_signal = 'wo_status_done' THEN
        v_sat := EXISTS (SELECT 1 FROM public.wf_wo_link l
                         WHERE l.instance_id = p_inst AND l.wo_id IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM public.wf_wo_link l
            JOIN public.ppc_wo w ON w.id = l.wo_id
            WHERE l.instance_id = p_inst AND w.status <> 'done');

      ELSIF sr.watch_signal = 'wo_status_qc' THEN
        v_sat := EXISTS (SELECT 1 FROM public.wf_wo_link l
                         WHERE l.instance_id = p_inst AND l.wo_id IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM public.wf_wo_link l
            JOIN public.ppc_wo w ON w.id = l.wo_id
            WHERE l.instance_id = p_inst AND w.status NOT IN ('qc','done'));

      ELSIF sr.watch_signal = 'fg_stocked' THEN
        v_sat := EXISTS (SELECT 1 FROM public.wf_wo_link l
                         WHERE l.instance_id = p_inst AND l.wo_id IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM public.wf_wo_link l
            JOIN public.ppc_wo w ON w.id = l.wo_id
            WHERE l.instance_id = p_inst
              AND (w.status <> 'done' OR w.fg_stocked_at IS NULL));
      END IF;

      IF v_sat THEN
        UPDATE public.wf_stage_run
           SET status = 'done', watch_satisfied = true, completed_at = now()
         WHERE id = sr.id AND status IN ('ready','in_progress');
        IF FOUND THEN
          v_changed := v_changed + 1;
          IF sr.task_id IS NOT NULL THEN
            UPDATE public.tasks
               SET task_status = 'completed', completed_at = now()
             WHERE id = sr.task_id AND task_status <> 'completed';
          END IF;
          INSERT INTO public.wf_event (instance_id, stage_key, event_type, actor_email)
          VALUES (p_inst, sr.stage_key, 'stage_done', public.current_user_email());

          IF sr.stage_key = 'closure' THEN
            UPDATE public.sales_order SET status = 'closed', updated_at = now()
             WHERE id = v_so AND status <> 'closed';
            INSERT INTO public.sales_order_status_log (so_id, from_status, to_status, changed_by_email, note)
            SELECT v_so, so.status, 'closed', public.current_user_email(), 'O2D workflow closure'
            FROM public.sales_order so WHERE so.id = v_so AND so.status <> 'closed';
          END IF;
        END IF;
      END IF;
    END LOOP;

    -- ---- GATE: unblock a blocked stage when all predecessors are done --------
    FOR sr IN
      SELECT * FROM public.wf_stage_run
      WHERE instance_id = p_inst AND status = 'blocked'
      ORDER BY sequence
    LOOP
      SELECT count(*) INTO v_open_pred
      FROM public.wf_stage_dep dep
      JOIN public.wf_stage_run pr
        ON pr.instance_id = p_inst AND pr.stage_key = dep.depends_on
      WHERE dep.stage_key = sr.stage_key
        AND dep.order_type IN ('ALL', v_type)
        AND pr.status NOT IN ('done','skipped');

      IF v_open_pred = 0 THEN
        UPDATE public.wf_stage_run SET status = 'ready' WHERE id = sr.id AND status = 'blocked';
        IF FOUND THEN
          v_changed := v_changed + 1;
          INSERT INTO public.wf_event (instance_id, stage_key, event_type, actor_email)
          VALUES (p_inst, sr.stage_key, 'unblocked', public.current_user_email());
        END IF;
      END IF;
    END LOOP;

    -- ---- SPAWN: a ready stage with no task gets a routed department task -----
    FOR sr IN
      SELECT * FROM public.wf_stage_run
      WHERE instance_id = p_inst AND status = 'ready' AND task_id IS NULL
      ORDER BY sequence
    LOOP
      INSERT INTO public.tasks
        (title, description, assigned_email, priority, difficulty, due_date,
         task_status, department, stage_run_id)
      VALUES
        (coalesce(sr.label, sr.stage_key) || ' — ' ||
           coalesce((SELECT so_number FROM public.wf_instance WHERE id = p_inst), ''),
         'Auto-generated by the Order-to-Dispatch workflow engine.',
         public.wf_resolve_assignee(sr.owner_role_code, sr.department, v_owner),
         'medium', 2, sr.due_date, 'pending', sr.department, sr.id)
      RETURNING id INTO v_task;

      UPDATE public.wf_stage_run
         SET task_id = v_task, status = 'in_progress', started_at = now()
       WHERE id = sr.id AND task_id IS NULL;

      IF FOUND THEN
        v_changed := v_changed + 1;
        UPDATE public.wf_instance SET current_stage = sr.stage_key WHERE id = p_inst;
        INSERT INTO public.wf_event (instance_id, stage_key, event_type, detail, actor_email)
        VALUES (p_inst, sr.stage_key, 'stage_started',
                jsonb_build_object('task_id', v_task), public.current_user_email());
      ELSE
        DELETE FROM public.tasks WHERE id = v_task;
      END IF;
    END LOOP;

    v_total := v_total + v_changed;
    EXIT WHEN v_changed = 0 OR v_iter >= 50;
  END LOOP;

  -- ---- ROLLUP: instance completes when no stage remains open ----------------
  SELECT count(*) INTO v_open_all
  FROM public.wf_stage_run
  WHERE instance_id = p_inst AND status NOT IN ('done','skipped','cancelled');

  IF v_open_all = 0 THEN
    UPDATE public.wf_instance
       SET status = 'completed', closed_at = now(), current_stage = 'closure'
     WHERE id = p_inst AND status <> 'completed';
    IF FOUND THEN
      INSERT INTO public.wf_event (instance_id, stage_key, event_type, actor_email)
      VALUES (p_inst, 'closure', 'instance_completed', public.current_user_email());
    END IF;
  END IF;

  RETURN v_total;
END;
$$;

-- -----------------------------------------------------------------------------
-- Seed owner_role_code per stage (config-as-data; routes to real staff today,
-- auto-refines as dedicated role-holders are added).
-- -----------------------------------------------------------------------------
UPDATE public.wf_stage_def SET owner_role_code = CASE stage_key
  WHEN 'sales_order'         THEN 'CRM'
  WHEN 'dispatch_planning'   THEN 'PROCESS_COORDINATOR_SCOPED'
  WHEN 'production_planning'  THEN 'PROCESS_COORDINATOR_SCOPED'
  WHEN 'store_issue'         THEN 'PRODUCTION'
  WHEN 'cable'               THEN 'PRODUCTION'
  WHEN 'assembly'            THEN 'PRODUCTION'
  WHEN 'molding'             THEN 'PRODUCTION'
  WHEN 'packing'             THEN 'PRODUCTION'
  WHEN 'fg'                  THEN 'PRODUCTION'
  WHEN 'dispatch'            THEN 'PROCESS_COORDINATOR_SCOPED'
  WHEN 'closure'             THEN 'CRM'
  ELSE owner_role_code END;

-- -----------------------------------------------------------------------------
-- wf_reconcile_dirty — drain the doorbell queue and reconcile those instances.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wf_reconcile_dirty()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    uuid;
  v_total int := 0;
BEGIN
  FOR v_id IN
    WITH drained AS (DELETE FROM public.wf_dirty RETURNING instance_id)
    SELECT DISTINCT instance_id FROM drained WHERE instance_id IS NOT NULL
  LOOP
    v_total := v_total + public.wf_reconcile_one(v_id);
  END LOOP;
  RETURN v_total;
END;
$$;

-- -----------------------------------------------------------------------------
-- wf_complete_task — UI action: complete a stage task + reconcile atomically.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wf_complete_task(p_task_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sr    uuid;
  v_inst  uuid;
  v_email text;
BEGIN
  SELECT stage_run_id, assigned_email INTO v_sr, v_email
  FROM public.tasks WHERE id = p_task_id;

  IF NOT (public.current_user_is_admin_fallback()
          OR lower(trim(coalesce(v_email,''))) = public.current_user_email()) THEN
    RAISE EXCEPTION 'wf_complete_task: not authorized for task %', p_task_id;
  END IF;

  UPDATE public.tasks SET task_status = 'completed', completed_at = now()
   WHERE id = p_task_id;

  IF v_sr IS NOT NULL THEN
    SELECT instance_id INTO v_inst FROM public.wf_stage_run WHERE id = v_sr;
    IF v_inst IS NOT NULL THEN
      RETURN public.wf_reconcile_one(v_inst);
    END IF;
  END IF;
  RETURN 0;
END;
$$;

-- -----------------------------------------------------------------------------
-- Doorbell triggers — enqueue affected instances into wf_dirty (no-op for WOs
-- / plans not linked to any workflow). Mirror the ppc_wo_status_log footprint.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wf_ppc_wo_doorbell()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.fg_stocked_at IS NOT DISTINCT FROM OLD.fg_stocked_at THEN
    RETURN NEW;  -- nothing the engine watches changed
  END IF;
  INSERT INTO public.wf_dirty (instance_id, reason)
  SELECT DISTINCT l.instance_id, 'ppc_wo:' || coalesce(NEW.status,'')
  FROM public.wf_wo_link l
  WHERE l.wo_id = NEW.id AND l.instance_id IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wf_ppc_wo_doorbell ON public.ppc_wo;
CREATE TRIGGER trg_wf_ppc_wo_doorbell
  AFTER INSERT OR UPDATE OF status, fg_stocked_at ON public.ppc_wo
  FOR EACH ROW EXECUTE FUNCTION public.wf_ppc_wo_doorbell();

CREATE OR REPLACE FUNCTION public.wf_dispatch_plan_doorbell()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.wf_dirty (instance_id, reason)
  SELECT i.id, 'dispatch_plan:' || coalesce(NEW.status,'')
  FROM public.wf_instance i
  WHERE i.sales_order_id = NEW.so_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wf_dispatch_plan_doorbell ON public.dispatch_plan;
CREATE TRIGGER trg_wf_dispatch_plan_doorbell
  AFTER INSERT OR UPDATE OF status ON public.dispatch_plan
  FOR EACH ROW EXECUTE FUNCTION public.wf_dispatch_plan_doorbell();

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.wf_resolve_assignee(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wf_resolve_assignee(text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.wf_reconcile_dirty() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wf_reconcile_dirty() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.wf_complete_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wf_complete_task(uuid) TO authenticated, service_role;

COMMIT;

-- -----------------------------------------------------------------------------
-- pg_cron jobs (OUTSIDE the transaction; idempotent unschedule-if-exists).
--  - sweep: safety net every 3 min over all active instances
--  - dirty: near-instant drain of the doorbell queue every minute
-- -----------------------------------------------------------------------------
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'wf-reconcile-sweep') then
      perform cron.unschedule('wf-reconcile-sweep');
    end if;
    perform cron.schedule('wf-reconcile-sweep', '*/3 * * * *', 'select public.wf_reconcile(NULL);');

    if exists (select 1 from cron.job where jobname = 'wf-reconcile-dirty') then
      perform cron.unschedule('wf-reconcile-dirty');
    end if;
    perform cron.schedule('wf-reconcile-dirty', '* * * * *', 'select public.wf_reconcile_dirty();');
  end if;
end;
$cron$;
