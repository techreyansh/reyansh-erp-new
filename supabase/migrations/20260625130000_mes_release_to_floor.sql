-- =====================================================================
-- MES — release a daily plan to the floor (plan -> work order -> Job Cards)
-- =====================================================================
-- Closes the gap: a planner's daily plan becomes a real work order in one call,
-- using the product's configured routing (falls back to hardcoded). The WO then
-- shows on the Job Cards screen for operators. Additive.
-- =====================================================================

ALTER TABLE public.daily_production_plan
  ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES public.ppc_wo(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.mes_release_plan_to_floor(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid; v_pname text; v_qty numeric; v_due date; v_existing uuid;
  v_item uuid; v_res jsonb; v_wo_id uuid;
BEGIN
  SELECT product_id, product_name, planned_qty, plan_date, work_order_id
    INTO v_pid, v_pname, v_qty, v_due, v_existing
  FROM public.daily_production_plan WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan not found'; END IF;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Already released to the floor.');
  END IF;
  IF COALESCE(v_qty, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Set a quantity on the plan first.');
  END IF;

  -- resolve the manufacturable item: prefer the linked product's ppc_item
  IF v_pid IS NOT NULL THEN
    SELECT ppc_item_id INTO v_item FROM public.product WHERE id = v_pid;
    IF v_item IS NULL THEN v_item := public.product_ensure_item(v_pid); END IF;
  END IF;
  -- else mint a power-cord item from the plan's product name
  IF v_item IS NULL THEN
    INSERT INTO public.ppc_items (code, name, item_type, uom)
    VALUES ('PLN-' || left(p_plan_id::text, 8), COALESCE(NULLIF(trim(v_pname), ''), 'Power Cord'), 'power_cord', 'pcs')
    ON CONFLICT (lower(code)) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_item;
  END IF;

  -- create the work order (configured route if the product has one, else hardcoded fallback)
  v_res := public.ppc_create_work_order(v_item, v_qty, NULL, v_due);
  v_wo_id := (v_res->>'id')::uuid;

  UPDATE public.daily_production_plan
     SET work_order_id = v_wo_id, status = 'in_production'
   WHERE id = p_plan_id;

  RETURN jsonb_build_object('ok', true, 'work_order_id', v_wo_id, 'wo_number', v_res->>'wo_number', 'stage_count', v_res->>'stage_count');
END $$;
GRANT EXECUTE ON FUNCTION public.mes_release_plan_to_floor(uuid) TO authenticated;
