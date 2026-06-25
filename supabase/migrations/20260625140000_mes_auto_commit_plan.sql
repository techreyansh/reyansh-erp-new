-- =====================================================================
-- MES — atomically commit an auto-planned set (Phase 4 daily auto-planner)
-- =====================================================================
-- The planner computes draft daily_production_plan rows client-side (pure,
-- due-date driven, capped by the shared molding pool). This RPC writes the
-- whole approved set in ONE transaction: insert the plan rows AND bump each
-- source production_demand's planned_qty / status together, so a partial
-- failure can't leave demand and plans out of sync. Additive.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.mes_auto_commit_plan(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := auth.jwt() ->> 'email';
  v_inserted int := 0;
  v_demands int := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'No rows to commit.');
  END IF;

  -- 1) insert the draft daily plan rows (status 'planned', ready to release)
  INSERT INTO public.daily_production_plan
    (plan_date, product_id, product_name, planned_qty, department_id, shift_id, priority, status, notes, created_by_email)
  SELECT r.plan_date, r.product_id, NULLIF(trim(r.product_name), ''), r.planned_qty,
         r.department_id, r.shift_id, COALESCE(NULLIF(r.priority, ''), 'normal'), 'planned',
         r.notes, v_email
  FROM jsonb_to_recordset(p_rows) AS r(
    demand_id uuid, plan_date date, product_id uuid, product_name text,
    planned_qty numeric, department_id uuid, shift_id uuid, priority text, notes text
  )
  WHERE COALESCE(r.planned_qty, 0) > 0;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- 2) bump the source demand's planned_qty + advance status (pending -> planned)
  WITH alloc AS (
    SELECT r.demand_id, SUM(r.planned_qty) AS qty
    FROM jsonb_to_recordset(p_rows) AS r(demand_id uuid, planned_qty numeric)
    WHERE r.demand_id IS NOT NULL AND COALESCE(r.planned_qty, 0) > 0
    GROUP BY r.demand_id
  ), upd AS (
    UPDATE public.production_demand d
       SET planned_qty = COALESCE(d.planned_qty, 0) + a.qty,
           status = CASE WHEN d.status = 'pending' THEN 'planned' ELSE d.status END,
           updated_at = now()
      FROM alloc a
     WHERE d.id = a.demand_id
    RETURNING d.id
  )
  SELECT count(*) INTO v_demands FROM upd;

  RETURN jsonb_build_object('ok', true, 'plans_created', v_inserted, 'demands_updated', v_demands);
END $$;
GRANT EXECUTE ON FUNCTION public.mes_auto_commit_plan(jsonb) TO authenticated;
