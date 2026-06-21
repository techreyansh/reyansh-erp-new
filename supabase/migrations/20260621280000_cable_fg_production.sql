-- Cable Production Planning — Phase 5 integration: finished-goods production.
-- Closes the loop "work order done -> finished cable in stock -> dispatchable".
-- ppc_advance_stage moves a fully-built WO to status 'qc' + produced_qty but
-- never books the output into ppc_stock, so completed cables never become
-- dispatchable inventory. This adds cable_finish_work_order() to do exactly that,
-- once, mirroring ppc_receive_stock's audit-meta pattern. Dispatch decrement
-- already exists (ppc_dispatch_stock). Additive + idempotent.
BEGIN;

-- Idempotency markers: when/how much of a WO's output was booked into FG stock.
ALTER TABLE public.ppc_wo ADD COLUMN IF NOT EXISTS fg_stocked_at  timestamptz;
ALTER TABLE public.ppc_wo ADD COLUMN IF NOT EXISTS fg_stocked_qty numeric;

-- Complete a cable work order and book its finished output into FG stock.
-- Marks the WO 'done' (unless cancelled), then produces p_qty (default the WO's
-- produced_qty, else its planned qty) into ppc_stock for the WO's item — exactly
-- once, guarded by fg_stocked_at. The ppc_stock audit trigger reads ppc.txn_meta
-- and logs a 'production' transaction referencing the work order.
CREATE OR REPLACE FUNCTION public.cable_finish_work_order(
  p_wo_id uuid, p_qty numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item uuid; v_status text; v_planned numeric; v_produced numeric;
  v_already timestamptz; v_wo_number text; v_qty numeric; v_on numeric;
  v_email text := public.current_user_email();
BEGIN
  SELECT item_id, status, qty, produced_qty, fg_stocked_at, wo_number
    INTO v_item, v_status, v_planned, v_produced, v_already, v_wo_number
  FROM public.ppc_wo WHERE id = p_wo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cable_finish_work_order: WO % not found', p_wo_id; END IF;
  IF v_status = 'cancelled' THEN RAISE EXCEPTION 'cable_finish_work_order: WO is cancelled'; END IF;
  IF v_item IS NULL THEN RAISE EXCEPTION 'cable_finish_work_order: WO has no item to stock'; END IF;

  v_qty := COALESCE(p_qty, NULLIF(v_produced, 0), v_planned, 0);

  UPDATE public.ppc_wo
     SET status       = 'done',
         produced_qty = COALESCE(NULLIF(v_produced, 0), v_qty),
         updated_at   = now()
   WHERE id = p_wo_id;

  IF v_already IS NULL AND v_qty > 0 THEN
    PERFORM set_config('ppc.txn_meta', json_build_object(
      'type','production','reference_type','work_order','reference_id',p_wo_id::text,
      'notes',concat('FG from ', COALESCE(v_wo_number, p_wo_id::text)),
      'created_by',v_email)::text, true);
    INSERT INTO public.ppc_stock(item_id, on_hand) VALUES (v_item, v_qty)
      ON CONFLICT (item_id) DO UPDATE
        SET on_hand = public.ppc_stock.on_hand + EXCLUDED.on_hand, updated_at = now()
      RETURNING on_hand INTO v_on;
    UPDATE public.ppc_wo SET fg_stocked_at = now(), fg_stocked_qty = v_qty WHERE id = p_wo_id;
  ELSE
    SELECT on_hand INTO v_on FROM public.ppc_stock WHERE item_id = v_item;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'wo_id', p_wo_id, 'item_id', v_item, 'produced', v_qty,
    'on_hand', COALESCE(v_on, 0), 'already_stocked', v_already IS NOT NULL);
END;
$$;
GRANT EXECUTE ON FUNCTION public.cable_finish_work_order(uuid, numeric) TO authenticated;

COMMIT;
