-- =====================================================================
-- MES — mold tool-life capture
-- =====================================================================
-- Record which mold ran a molding job-card entry, accumulate shots against the
-- mold's tool life (shots = pieces / cavities), so a mold nearing its tool life
-- can be flagged for maintenance. Additive + a safe RPC extension.
-- =====================================================================

ALTER TABLE public.stage_execution_log
  ADD COLUMN IF NOT EXISTS mold_id uuid REFERENCES public.molding_master(id) ON DELETE SET NULL;

-- Replace ppc_post_jobcard with a p_mold param that also rolls shots into the mold.
DROP FUNCTION IF EXISTS public.ppc_post_jobcard(uuid, numeric, numeric, numeric, uuid, uuid, text, uuid, text);
CREATE OR REPLACE FUNCTION public.ppc_post_jobcard(
  p_stage_id uuid, p_output numeric, p_reject numeric DEFAULT 0, p_downtime numeric DEFAULT 0,
  p_downtime_reason uuid DEFAULT NULL, p_defect uuid DEFAULT NULL, p_operator text DEFAULT NULL,
  p_machine uuid DEFAULT NULL, p_note text DEFAULT NULL, p_mold uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo uuid; v_out numeric; v_rej numeric; v_dt numeric; v_cav numeric;
  v_email text := COALESCE(NULLIF(current_setting('request.jwt.claims', true)::json->>'email',''), 'floor');
BEGIN
  SELECT work_order_id INTO v_wo FROM public.ppc_wo_stage WHERE id = p_stage_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'stage not found'; END IF;
  INSERT INTO public.stage_execution_log (work_order_id, stage_id, operator_name, machine_id, mold_id, output_qty, reject_qty, downtime_min, downtime_reason_id, defect_code_id, note, created_by_email)
  VALUES (v_wo, p_stage_id, p_operator, p_machine, p_mold, COALESCE(p_output,0), COALESCE(p_reject,0), COALESCE(p_downtime,0), p_downtime_reason, p_defect, p_note, v_email);
  SELECT SUM(output_qty), SUM(reject_qty), SUM(downtime_min) INTO v_out, v_rej, v_dt
  FROM public.stage_execution_log WHERE stage_id = p_stage_id;
  UPDATE public.ppc_wo_stage
     SET output_qty = v_out, scrap_qty = v_rej,
         operator_name = COALESCE(p_operator, operator_name), machine_id = COALESCE(p_machine, machine_id),
         started_at = COALESCE(started_at, now()),
         status = CASE WHEN status = 'pending' THEN 'running' ELSE status END
   WHERE id = p_stage_id;
  -- accumulate shots on the mold (shots = pieces / cavities)
  IF p_mold IS NOT NULL AND COALESCE(p_output,0) > 0 THEN
    SELECT GREATEST(COALESCE(cavity_count,1),1) INTO v_cav FROM public.molding_master WHERE id = p_mold;
    UPDATE public.molding_master SET shots_done = COALESCE(shots_done,0) + CEIL(p_output / v_cav) WHERE id = p_mold;
  END IF;
  RETURN jsonb_build_object('ok', true, 'output_total', v_out, 'reject_total', v_rej, 'downtime_total', v_dt);
END $$;
GRANT EXECUTE ON FUNCTION public.ppc_post_jobcard(uuid, numeric, numeric, numeric, uuid, uuid, text, uuid, text, uuid) TO authenticated;
