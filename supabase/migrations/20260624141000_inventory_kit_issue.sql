-- =====================================================================
-- Inventory — one-click kit issue + ledger-based single-line issue
-- =====================================================================
-- Closes the deferred P1.3 RM-kitting gap: issuing work-order materials now
-- posts to the perpetual ledger (MFG_CONSUME), not the old ppc_stock path.
--
--   inv_issue_kit(wo_id, allow_partial)  — issue the WHOLE kit at one go.
--       Pre-checks shortages; with allow_partial=false (default) it issues
--       NOTHING if any component is short (atomic) and returns the shortfall.
--   inv_issue_kit_line(wo_material_id, qty) — issue one kit line to the ledger.
--
-- Both keep ppc_wo_material.qty_issued in sync (work-order kitting bookkeeping)
-- and consume from the location where the component currently holds stock.
-- Additive only.
-- =====================================================================

-- Issue a single work-order material line to the ledger.
CREATE OR REPLACE FUNCTION public.inv_issue_kit_line(
  p_wo_material_id uuid,
  p_qty            numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item uuid; v_wo uuid; v_req numeric; v_iss numeric; v_loc uuid; v_code text;
BEGIN
  SELECT m.item_id, m.work_order_id, m.qty_required, m.qty_issued, i.code
    INTO v_item, v_wo, v_req, v_iss, v_code
  FROM public.ppc_wo_material m JOIN public.ppc_items i ON i.id = m.item_id
  WHERE m.id = p_wo_material_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'inv_issue_kit_line: material line % not found', p_wo_material_id; END IF;
  IF COALESCE(p_qty,0) <= 0 THEN RAISE EXCEPTION 'inv_issue_kit_line: quantity must be positive'; END IF;

  SELECT location_id INTO v_loc FROM public.inv_balance
    WHERE item_id = v_item ORDER BY on_hand DESC LIMIT 1;
  IF v_loc IS NULL THEN v_loc := public.inv_location_id('STORE'); END IF;

  PERFORM public.inv_post_movement(v_item, v_loc, 'MFG_CONSUME', -abs(p_qty), NULL,
    'work_order', v_wo::text, concat('kit issue ', v_code), false);
  UPDATE public.ppc_wo_material SET qty_issued = COALESCE(qty_issued,0) + abs(p_qty) WHERE id = p_wo_material_id;

  RETURN jsonb_build_object('ok', true, 'item', v_code, 'qty', abs(p_qty));
END $$;

-- Issue the entire kit for a work order in one action.
CREATE OR REPLACE FUNCTION public.inv_issue_kit(
  p_wo_id        uuid,
  p_allow_partial boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_loc uuid; v_avail numeric; v_remaining numeric; v_to_issue numeric;
  v_issued jsonb := '[]'::jsonb; v_short jsonb := '[]'::jsonb; v_has_short boolean := false;
BEGIN
  -- Pass 1: shortage check (location with the most on-hand per component).
  FOR r IN
    SELECT m.item_id, m.qty_required, m.qty_issued, i.code, i.name
    FROM public.ppc_wo_material m JOIN public.ppc_items i ON i.id = m.item_id
    WHERE m.work_order_id = p_wo_id
  LOOP
    v_remaining := COALESCE(r.qty_required,0) - COALESCE(r.qty_issued,0);
    IF v_remaining <= 0 THEN CONTINUE; END IF;
    SELECT on_hand INTO v_avail FROM public.inv_balance
      WHERE item_id = r.item_id ORDER BY on_hand DESC LIMIT 1;
    v_avail := COALESCE(v_avail, 0);
    IF v_avail < v_remaining THEN
      v_has_short := true;
      v_short := v_short || jsonb_build_object('code', r.code, 'name', r.name, 'required', v_remaining, 'available', v_avail);
    END IF;
  END LOOP;

  IF v_has_short AND NOT p_allow_partial THEN
    RETURN jsonb_build_object('ok', false, 'wo_id', p_wo_id, 'issued', '[]'::jsonb,
      'shortages', v_short, 'message', 'Insufficient stock for one or more components — nothing issued.');
  END IF;

  -- Pass 2: issue.
  FOR r IN
    SELECT m.id, m.item_id, m.qty_required, m.qty_issued, i.code
    FROM public.ppc_wo_material m JOIN public.ppc_items i ON i.id = m.item_id
    WHERE m.work_order_id = p_wo_id
  LOOP
    v_remaining := COALESCE(r.qty_required,0) - COALESCE(r.qty_issued,0);
    IF v_remaining <= 0 THEN CONTINUE; END IF;
    SELECT location_id, on_hand INTO v_loc, v_avail FROM public.inv_balance
      WHERE item_id = r.item_id ORDER BY on_hand DESC LIMIT 1;
    IF v_loc IS NULL THEN v_loc := public.inv_location_id('STORE'); END IF;
    v_avail := COALESCE(v_avail, 0);
    v_to_issue := CASE WHEN p_allow_partial THEN LEAST(v_remaining, v_avail) ELSE v_remaining END;
    IF v_to_issue <= 0 THEN CONTINUE; END IF;
    PERFORM public.inv_post_movement(r.item_id, v_loc, 'MFG_CONSUME', -v_to_issue, NULL,
      'work_order', p_wo_id::text, 'kit issue', false);
    UPDATE public.ppc_wo_material SET qty_issued = COALESCE(qty_issued,0) + v_to_issue WHERE id = r.id;
    v_issued := v_issued || jsonb_build_object('code', r.code, 'qty', v_to_issue);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'wo_id', p_wo_id, 'issued', v_issued, 'shortages', v_short);
END $$;

GRANT EXECUTE ON FUNCTION public.inv_issue_kit_line(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_issue_kit(uuid, boolean)      TO authenticated;
