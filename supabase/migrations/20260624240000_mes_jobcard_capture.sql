-- =====================================================================
-- MES — Job-card capture loop (the adoption-proving slice) + Phase 1 bug fix
-- =====================================================================
-- Review-driven: prove operators post real job cards against live ppc_wo_stage
-- before building the rest of the MES. Append-only stage_execution_log (one row
-- per operator entry) so concurrent operators never clobber; stage row actuals
-- roll up as SUM over the log. Plus the Phase 1 correctness fix.
-- =====================================================================

-- FIX (Phase 1 bug): product.ppc_item_id must be UNIQUE or the routing resolver
-- (array_agg over product_process_step) is non-deterministic. 0 dups confirmed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_ppc_item ON public.product (ppc_item_id) WHERE ppc_item_id IS NOT NULL;

-- Downtime reason catalogue (tappable chips on the job card)
CREATE TABLE IF NOT EXISTS public.downtime_reason (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE, name text NOT NULL,
  category text DEFAULT 'other' CHECK (category IN ('material','machine','manpower','method','other')),
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
-- Defect code registry
CREATE TABLE IF NOT EXISTS public.defect_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE, name text NOT NULL, category text,
  severity text DEFAULT 'minor' CHECK (severity IN ('minor','major','critical')),
  corrective_action text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only operator entries. Stage actuals = SUM over this log.
CREATE TABLE IF NOT EXISTS public.stage_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.ppc_wo(id) ON DELETE CASCADE,
  stage_id      uuid NOT NULL REFERENCES public.ppc_wo_stage(id) ON DELETE CASCADE,
  operator_name text,
  machine_id    uuid REFERENCES public.ppc_machines(id) ON DELETE SET NULL,
  output_qty    numeric NOT NULL DEFAULT 0,
  reject_qty    numeric NOT NULL DEFAULT 0,
  downtime_min  numeric NOT NULL DEFAULT 0,
  downtime_reason_id uuid REFERENCES public.downtime_reason(id) ON DELETE RESTRICT,
  defect_code_id uuid REFERENCES public.defect_code(id) ON DELETE RESTRICT,
  note          text,
  logged_at     timestamptz NOT NULL DEFAULT now(),
  created_by_email text
);
CREATE INDEX IF NOT EXISTS idx_stage_exec_stage ON public.stage_execution_log (stage_id, logged_at);

ALTER TABLE public.downtime_reason     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defect_code         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_execution_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY downtime_reason_all ON public.downtime_reason FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY defect_code_all ON public.defect_code FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY stage_exec_all ON public.stage_execution_log FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.downtime_reason, public.defect_code, public.stage_execution_log TO authenticated;

-- Seed downtime reasons + defect codes
INSERT INTO public.downtime_reason (code, name, category)
SELECT v.code, v.name, v.cat FROM (VALUES
  ('material_shortage','Material shortage','material'),('machine_breakdown','Machine breakdown','machine'),
  ('power_cut','Power cut','machine'),('changeover','Changeover / setup','method'),
  ('mold_change','Mold change','method'),('quality_hold','Quality hold','method'),
  ('no_manpower','No manpower','manpower'),('maintenance','Maintenance','machine'),('other','Other','other')
) AS v(code,name,cat) WHERE NOT EXISTS (SELECT 1 FROM public.downtime_reason d WHERE d.code=v.code);
INSERT INTO public.defect_code (code, name, category, severity)
SELECT v.code, v.name, v.cat, v.sev FROM (VALUES
  ('pin_loose','Pin loose','assembly','major'),('insulation_cut','Insulation cut','assembly','major'),
  ('wrong_polarity','Wrong polarity','assembly','critical'),('molding_flash','Molding flash','molding','minor'),
  ('short_circuit','Short circuit','testing','critical'),('continuity_fail','Continuity fail','testing','critical'),
  ('cosmetic','Cosmetic defect','visual','minor'),('other','Other','other','minor')
) AS v(code,name,cat,sev) WHERE NOT EXISTS (SELECT 1 FROM public.defect_code d WHERE d.code=v.code);

-- Post a job card: append a log row + roll the stage actuals up from the log.
-- SECURITY DEFINER so the rollup + future quality gate live server-side.
CREATE OR REPLACE FUNCTION public.ppc_post_jobcard(
  p_stage_id uuid, p_output numeric, p_reject numeric DEFAULT 0, p_downtime numeric DEFAULT 0,
  p_downtime_reason uuid DEFAULT NULL, p_defect uuid DEFAULT NULL, p_operator text DEFAULT NULL,
  p_machine uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo uuid; v_out numeric; v_rej numeric; v_dt numeric;
  v_email text := COALESCE(NULLIF(current_setting('request.jwt.claims', true)::json->>'email',''), 'floor');
BEGIN
  SELECT work_order_id INTO v_wo FROM public.ppc_wo_stage WHERE id = p_stage_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'stage not found'; END IF;
  INSERT INTO public.stage_execution_log (work_order_id, stage_id, operator_name, machine_id, output_qty, reject_qty, downtime_min, downtime_reason_id, defect_code_id, note, created_by_email)
  VALUES (v_wo, p_stage_id, p_operator, p_machine, COALESCE(p_output,0), COALESCE(p_reject,0), COALESCE(p_downtime,0), p_downtime_reason, p_defect, p_note, v_email);
  SELECT SUM(output_qty), SUM(reject_qty), SUM(downtime_min) INTO v_out, v_rej, v_dt
  FROM public.stage_execution_log WHERE stage_id = p_stage_id;
  UPDATE public.ppc_wo_stage
     SET output_qty = v_out, scrap_qty = v_rej,
         operator_name = COALESCE(p_operator, operator_name),
         machine_id = COALESCE(p_machine, machine_id),
         started_at = COALESCE(started_at, now()),
         status = CASE WHEN status = 'pending' THEN 'running' ELSE status END
   WHERE id = p_stage_id;
  RETURN jsonb_build_object('ok', true, 'output_total', v_out, 'reject_total', v_rej, 'downtime_total', v_dt);
END $$;
GRANT EXECUTE ON FUNCTION public.ppc_post_jobcard(uuid, numeric, numeric, numeric, uuid, uuid, text, uuid, text) TO authenticated;
