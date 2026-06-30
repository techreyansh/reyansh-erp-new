-- =============================================================================
-- Order-to-Dispatch Workflow Engine — Phase 0 RPCs
-- =============================================================================
-- wf_create_instance(p_so, p_order_type) — idempotent; seeds one wf_stage_run
--   per applicable stage, marks the sales_order head stage done, then reconciles.
-- wf_reconcile(p_instance) — the heartbeat: SENSE -> GATE -> SPAWN -> ROLLUP,
--   bounded-loop to convergence, idempotent. p_instance NULL = sweep all active.
-- wf_link_wo(...) — engine-owned correlation insert (closes order-blind gap).
-- wf_so_status_rank(text) — ordinal for the sales_order status machine.
--
-- All SECURITY DEFINER (bypass RLS), set search_path, granted to authenticated
-- + service_role. Mirrors the conventions of the task-checklist system.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Ordinal rank of the sales_order status machine (for 'so_status' >= checks).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wf_so_status_rank(p_status text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_status,''))
    WHEN 'draft' THEN 1
    WHEN 'pending_review' THEN 2
    WHEN 'approved' THEN 3
    WHEN 'released' THEN 4
    WHEN 'in_planning' THEN 5
    WHEN 'in_production' THEN 6
    WHEN 'partially_dispatched' THEN 7
    WHEN 'dispatched' THEN 8
    WHEN 'closed' THEN 9
    WHEN 'completed' THEN 9
    ELSE 0          -- cancelled / unknown
  END;
$$;

-- -----------------------------------------------------------------------------
-- wf_link_wo — record that a work order belongs to an instance's stage.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wf_link_wo(
  p_stage_run_id uuid,
  p_wo_id        uuid,
  p_link_kind    text DEFAULT 'ppc',
  p_demand_id    uuid DEFAULT NULL,
  p_plan_id      uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst uuid;
  v_id   uuid;
BEGIN
  SELECT instance_id INTO v_inst FROM public.wf_stage_run WHERE id = p_stage_run_id;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'wf_link_wo: stage_run % not found', p_stage_run_id;
  END IF;

  INSERT INTO public.wf_wo_link (stage_run_id, instance_id, demand_id, plan_id, wo_id, link_kind)
  VALUES (p_stage_run_id, v_inst, p_demand_id, p_plan_id, p_wo_id,
          CASE WHEN p_link_kind IN ('ppc','cable') THEN p_link_kind ELSE 'ppc' END)
  ON CONFLICT (stage_run_id, wo_id) DO NOTHING
  RETURNING id INTO v_id;

  INSERT INTO public.wf_event (instance_id, stage_key, event_type, detail, actor_email)
  SELECT v_inst, sr.stage_key, 'wo_linked',
         jsonb_build_object('wo_id', p_wo_id, 'link_kind', p_link_kind),
         public.current_user_email()
  FROM public.wf_stage_run sr WHERE sr.id = p_stage_run_id;

  RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- wf_create_instance — idempotent per sales_order.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wf_create_instance(
  p_so         uuid,
  p_order_type text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst   uuid;
  v_type   text;
  v_so     public.sales_order;
BEGIN
  -- Already have a workflow for this SO? Return it (idempotent).
  SELECT id INTO v_inst FROM public.wf_instance WHERE sales_order_id = p_so;
  IF v_inst IS NOT NULL THEN
    RETURN v_inst;
  END IF;

  SELECT * INTO v_so FROM public.sales_order WHERE id = p_so;
  IF v_so.id IS NULL THEN
    RAISE EXCEPTION 'wf_create_instance: sales_order % not found', p_so;
  END IF;

  v_type := upper(coalesce(p_order_type, 'POWER_CORD'));
  IF v_type NOT IN ('CABLE_ONLY','POWER_CORD') THEN
    v_type := 'POWER_CORD';
  END IF;

  INSERT INTO public.wf_instance
    (sales_order_id, so_number, order_type, status, current_stage,
     customer_code, company_name, owner_email)
  VALUES
    (p_so, v_so.so_number, v_type, 'active', 'sales_order',
     v_so.customer_code, v_so.company_name, v_so.owner_email)
  ON CONFLICT (sales_order_id) DO NOTHING
  RETURNING id INTO v_inst;

  IF v_inst IS NULL THEN
    -- Lost a race; return whoever won.
    SELECT id INTO v_inst FROM public.wf_instance WHERE sales_order_id = p_so;
    RETURN v_inst;
  END IF;

  -- Seed one stage_run per applicable stage_def.
  INSERT INTO public.wf_stage_run
    (instance_id, stage_key, sequence, label, department, owner_role_code,
     status, watch_signal, watch_param, actuator_rpc, actuator_kind, due_date)
  SELECT
    v_inst, d.stage_key, d.sequence, d.label, d.department, d.owner_role_code,
    CASE WHEN d.stage_key = 'sales_order' THEN 'done' ELSE 'blocked' END,
    d.watch_signal, d.watch_param, d.actuator_rpc, d.actuator_kind,
    (CURRENT_DATE + (coalesce(d.sla_days,0))::int)
  FROM public.wf_stage_def d
  WHERE d.is_active = true
    AND d.order_type IN ('ALL', v_type)
  ON CONFLICT (instance_id, stage_key) DO NOTHING;

  -- The head 'sales_order' stage is satisfied at creation (instance exists
  -- because the SO was released).
  UPDATE public.wf_stage_run
     SET watch_satisfied = true, completed_at = now()
   WHERE instance_id = v_inst AND stage_key = 'sales_order';

  INSERT INTO public.wf_event (instance_id, stage_key, event_type, detail, actor_email)
  VALUES (v_inst, 'sales_order', 'instance_created',
          jsonb_build_object('order_type', v_type, 'so_number', v_so.so_number),
          public.current_user_email());

  -- First gate + spawn.
  PERFORM public.wf_reconcile(v_inst);

  RETURN v_inst;
END;
$$;

-- -----------------------------------------------------------------------------
-- wf_reconcile_one — settle a single instance to convergence.
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
          -- auto-close the human task mirror (if any, not already completed)
          IF sr.task_id IS NOT NULL THEN
            UPDATE public.tasks
               SET task_status = 'completed', completed_at = now()
             WHERE id = sr.task_id AND task_status <> 'completed';
          END IF;
          INSERT INTO public.wf_event (instance_id, stage_key, event_type, actor_email)
          VALUES (p_inst, sr.stage_key, 'stage_done', public.current_user_email());

          -- Closure stage completing closes the sales order itself.
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
      -- predecessors that exist as stage_runs in this instance and are not done
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

    -- ---- SPAWN: a ready stage with no task gets a department task -----------
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
         v_owner, 'medium', 2, sr.due_date, 'pending', sr.department, sr.id)
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
        -- lost the spawn race; delete the orphan task we just made
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
-- wf_reconcile — single instance, or sweep all active when p_instance is NULL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wf_reconcile(p_instance uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int := 0;
  v_id    uuid;
BEGIN
  IF p_instance IS NOT NULL THEN
    RETURN public.wf_reconcile_one(p_instance);
  END IF;
  FOR v_id IN SELECT id FROM public.wf_instance WHERE status = 'active' LOOP
    v_total := v_total + public.wf_reconcile_one(v_id);
  END LOOP;
  RETURN v_total;
END;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.wf_so_status_rank(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wf_so_status_rank(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.wf_link_wo(uuid, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wf_link_wo(uuid, uuid, text, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.wf_create_instance(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wf_create_instance(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.wf_reconcile_one(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wf_reconcile_one(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.wf_reconcile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wf_reconcile(uuid) TO authenticated, service_role;

COMMIT;
