-- R2 (Order Tracking): a SECURITY DEFINER path to cancel a cable work order.
-- The UI had no way to reach the 'cancelled' status. Guards: not-found, already
-- cancelled (idempotent), and a completed ('done') WO cannot be cancelled.

CREATE OR REPLACE FUNCTION public.ppc_cancel_work_order(p_wo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.ppc_wo WHERE id = p_wo_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Work order not found';
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'status', 'cancelled');
  END IF;
  IF v_status = 'done' THEN
    RAISE EXCEPTION 'A completed work order cannot be cancelled';
  END IF;

  UPDATE public.ppc_wo
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_wo_id;

  RETURN jsonb_build_object('ok', true, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.ppc_cancel_work_order(uuid) TO authenticated;
