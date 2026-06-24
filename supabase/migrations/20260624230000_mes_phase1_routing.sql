-- =====================================================================
-- Power Cord MES — Phase 1: Assembly Operation Master + configurable routing
-- =====================================================================
-- 1) assembly_operation: the catalogue of operations (cutting, pin weld,
--    crimp, sleeve, molding, testing, packing...) with std time/UPH/manpower.
-- 2) product_process_step.operation_id links a routing step to the catalogue.
-- 3) ppc_create_work_order: prefer the product's CONFIGURED route
--    (product_process_step) over the hardcoded item_type arrays. The hardcoded
--    arrays remain as fallback, so live cable production is unaffected.
-- Additive + a safe RPC refactor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.assembly_operation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_code text UNIQUE,
  name           text NOT NULL,
  category       text DEFAULT 'assembly'
                 CHECK (category IN ('cutting','assembly','molding','testing','packing','other')),
  std_time_sec   numeric,
  uph            numeric,                -- units per hour (per operator/station)
  manpower_reqd  numeric,
  tools_reqd     text,
  quality_critical boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  notes          text,
  created_by_email text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.assembly_operation ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY assembly_operation_all ON public.assembly_operation FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assembly_operation TO authenticated;

-- link a routing step to a catalogue operation (nullable — free-text steps still allowed)
ALTER TABLE public.product_process_step
  ADD COLUMN IF NOT EXISTS operation_id uuid REFERENCES public.assembly_operation(id) ON DELETE SET NULL;

-- Seed the standard power-cord operations (idempotent on operation_code)
INSERT INTO public.assembly_operation (operation_code, name, category, std_time_sec, manpower_reqd, quality_critical)
SELECT v.code, v.name, v.cat, v.t, 1, v.qc
FROM (VALUES
  ('cutting','Cable Cutting','cutting',20,false),
  ('sheath_removal','Sheath Removal','assembly',15,false),
  ('core_stripping','Core Stripping','assembly',18,false),
  ('pin_welding','Pin Welding','assembly',25,true),
  ('pin_crimping','Pin Crimping','assembly',22,true),
  ('terminal_crimping','Terminal Crimping','assembly',20,true),
  ('sleeve_fitting','Sleeve Fitting','assembly',12,false),
  ('heat_shrink','Heat Shrink','assembly',14,false),
  ('fiberglass_tube','Fiberglass Tube','assembly',16,false),
  ('tinning','Tinning','assembly',18,false),
  ('connector_assembly','Connector Assembly','assembly',30,true),
  ('inner_molding','Inner Molding','molding',45,true),
  ('outer_molding','Outer Molding','molding',50,true),
  ('grommet_molding','Grommet Molding','molding',40,false),
  ('folding','Folding','packing',10,false),
  ('hv_testing','HV Testing','testing',15,true),
  ('visual_inspection','Visual Inspection','testing',12,true),
  ('poly_packing','Poly Packing','packing',10,false),
  ('individual_packing','Individual Packing','packing',12,false),
  ('master_packing','Master Packing','packing',20,false)
) AS v(code,name,cat,t,qc)
WHERE NOT EXISTS (SELECT 1 FROM public.assembly_operation a WHERE a.operation_code = v.code);

-- ---------------------------------------------------------------------
-- ppc_create_work_order — now prefers the product's configured route.
-- (Full body reproduced with ONLY the routing-resolution block changed.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ppc_create_work_order(
  p_item_id uuid,
  p_qty     numeric,
  p_line_id uuid    DEFAULT NULL,
  p_due     date    DEFAULT NULL,
  p_stages  text[]  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_wo_id      uuid;
  v_wo_number  text;
  v_item_type  text;
  v_email      text;
  v_qty        numeric := COALESCE(p_qty, 1);
  v_stages     text[];
  v_seq_no     int;
  v_stage      text;
  v_idx        int := 0;
  v_stage_cnt  int := 0;
  v_mat_cnt    int := 0;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'ppc_create_work_order: p_item_id is required';
  END IF;

  SELECT item_type INTO v_item_type FROM public.ppc_items WHERE id = p_item_id;
  IF v_item_type IS NULL THEN
    RAISE EXCEPTION 'ppc_create_work_order: item % not found', p_item_id;
  END IF;

  v_email := public.rbac_current_email();

  SELECT COUNT(*) + 1 INTO v_seq_no
  FROM public.ppc_wo
  WHERE created_at >= date_trunc('day', now())
    AND created_at <  date_trunc('day', now()) + interval '1 day';

  v_wo_number := 'WO-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_seq_no::text, 3, '0');

  INSERT INTO public.ppc_wo (wo_number, item_id, qty, line_id, status, due_date, owner_email)
  VALUES (v_wo_number, p_item_id, v_qty, p_line_id, 'planned', p_due, v_email)
  RETURNING id INTO v_wo_id;

  -- resolve routing stages: explicit > configured per-product route > hardcoded
  IF p_stages IS NOT NULL AND array_length(p_stages, 1) IS NOT NULL THEN
    v_stages := p_stages;
  ELSE
    SELECT array_agg(pps.step_name ORDER BY pps.sequence)
      INTO v_stages
    FROM public.product p
    JOIN public.product_process_step pps ON pps.product_id = p.id
    WHERE p.ppc_item_id = p_item_id
      AND COALESCE(pps.step_name, '') <> '';
    IF v_stages IS NULL OR array_length(v_stages, 1) IS NULL THEN
      v_stages := CASE v_item_type
        WHEN 'cable'      THEN ARRAY['Drawing','Bunching','Insulation','Sheathing','Testing']
        WHEN 'power_cord' THEN ARRAY['Cutting','Stripping','Crimping','Moulding','Testing']
        WHEN 'harness'    THEN ARRAY['Cutting','Stripping','Crimping','Assembly','Continuity Test']
        ELSE                   ARRAY['Production','QC']
      END;
    END IF;
  END IF;

  FOREACH v_stage IN ARRAY v_stages
  LOOP
    INSERT INTO public.ppc_wo_stage (work_order_id, stage_name, sequence, status)
    VALUES (v_wo_id, v_stage, v_idx, 'pending');
    v_idx := v_idx + 1;
  END LOOP;
  v_stage_cnt := v_idx;

  INSERT INTO public.ppc_wo_material (work_order_id, item_id, qty_required, qty_issued)
  SELECT
    v_wo_id,
    b.component_item_id,
    (b.qty_per * (1 + COALESCE(b.scrap_pct, 0) / 100.0) * v_qty)::numeric,
    0
  FROM public.ppc_bom b
  WHERE b.parent_item_id = p_item_id;

  GET DIAGNOSTICS v_mat_cnt = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',          true,
    'id',          v_wo_id,
    'wo_number',   v_wo_number,
    'item_id',     p_item_id,
    'item_type',   v_item_type,
    'qty',         v_qty,
    'stage_count', v_stage_cnt,
    'material_count', v_mat_cnt
  );
END
$fn$;
