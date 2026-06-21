-- Cable Production Planning — Phase 1 (Foundation).
-- Unifies planning onto the relational work-order layer:
--   * cable_master      — the single Cable Master (specs; ODs/weight auto-computed
--                         in the UI via the cablePlanner engine, stored here).
--   * ppc_machines      — extended into a real Machine Master + seeded M1-M4 from
--                         src/services/cablePlanner/machineConfig.DEFAULT_MACHINES.
--   * cable_production_plan — relational plan header (replaces the sheet usage).
--   * cable_create_work_order(payload) — Release a plan -> real ppc_wo + routed
--                         ppc_wo_stage (machine-assigned) + ppc_wo_material (MRP).
-- Reuses existing ppc_advance_stage/ppc_issue_material/ppc_record_qc for execution.
BEGIN;

-- 1) CABLE MASTER ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cable_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cable_code text NOT NULL,
  cable_name text,
  item_id uuid REFERENCES public.ppc_items(id) ON DELETE SET NULL,
  cores int DEFAULT 1,
  flat_round text DEFAULT 'round' CHECK (flat_round IN ('flat','round')),
  strand_construction text,                 -- e.g. "30/0.25"
  copper_area_sqmm numeric,
  conductor_od numeric,
  core_od numeric,
  finished_od numeric,
  colour_combination jsonb DEFAULT '[]'::jsonb,
  insulation_thickness numeric DEFAULT 0.6,
  sheath_thickness numeric DEFAULT 0.9,
  voltage text,
  standard_length_m numeric,
  weight_per_meter numeric,
  is_power_cord boolean DEFAULT false,
  cord_length numeric,
  is_active boolean DEFAULT true,
  notes text,
  created_by text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cable_master_code_uq ON public.cable_master(lower(cable_code));
ALTER TABLE public.cable_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cable_master_all ON public.cable_master;
CREATE POLICY cable_master_all ON public.cable_master FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) MACHINE MASTER (extend ppc_machines + seed M1-M4) ---------------------
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS stage text;     -- bunching|core|laying|sheathing|cutting
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS speed_m_per_hr numeric;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS changeover_min numeric;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS scrap_pct numeric;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS lay_reduction_pct numeric DEFAULT 0;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS shift_start_hour int DEFAULT 9;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS shift_hours int DEFAULT 8;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS days_per_week int DEFAULT 6;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS drum_capacity_m numeric;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS core_capacity_m numeric;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS laying_drum_capacity_m numeric;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS is_available boolean DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS ppc_machines_code_uq ON public.ppc_machines(code) WHERE code IS NOT NULL;

-- seed the 4 cable machines from cablePlanner.DEFAULT_MACHINES (idempotent by code)
INSERT INTO public.ppc_machines (code, name, machine_type, stage, speed_m_per_hr, changeover_min, scrap_pct, lay_reduction_pct, shift_start_hour, shift_hours, days_per_week, status, is_available)
SELECT * FROM (VALUES
  ('M1','Bunching M/C','bunching','bunching',500,30,2,0,9,8,6,'idle',true),
  ('M2','Core Extruder','extruder','core',700,45,3,0,9,8,6,'idle',true),
  ('M3','Laying M/C','laying','laying',600,30,1,2,9,8,6,'idle',true),
  ('M4','Sheathing Extruder','extruder','sheathing',500,60,5,0,9,8,6,'idle',true)
) v(code,name,machine_type,stage,speed_m_per_hr,changeover_min,scrap_pct,lay_reduction_pct,shift_start_hour,shift_hours,days_per_week,status,is_available)
WHERE NOT EXISTS (SELECT 1 FROM public.ppc_machines m WHERE m.code = v.code);

-- 3) CABLE PRODUCTION PLAN (relational header) -----------------------------
CREATE TABLE IF NOT EXISTS public.cable_production_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code text,
  cable_id uuid REFERENCES public.cable_master(id) ON DELETE SET NULL,
  cable_code text, product_name text,
  customer_code text, customer_name text, sales_order_number text,
  qty numeric DEFAULT 0,                 -- pieces (power cord) or metres (bulk)
  length_m numeric,                      -- per-piece length (power cord)
  total_length_m numeric,                -- production metres
  due_date date,
  priority text DEFAULT 'medium',
  status text DEFAULT 'draft' CHECK (status IN ('draft','planned','released','in_progress','completed','cancelled')),
  routing jsonb DEFAULT '[]'::jsonb,     -- computed stage route
  materials jsonb DEFAULT '[]'::jsonb,   -- computed MRP (copper/PVC)
  work_order_id uuid REFERENCES public.ppc_wo(id) ON DELETE SET NULL,
  owner_email text, created_by text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cable_plan_code_uq ON public.cable_production_plan(plan_code) WHERE plan_code IS NOT NULL;
ALTER TABLE public.cable_production_plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cable_plan_all ON public.cable_production_plan;
CREATE POLICY cable_plan_all ON public.cable_production_plan FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4) RELEASE A PLAN -> WORK ORDER ------------------------------------------
-- payload = {
--   plan_id?, item_id?, cable_code, product_name, qty, due_date, priority,
--   customer_code, customer_name, sales_order_number,
--   stages:    [{ stage_name, sequence, machine_stage }],     -- cablePlanner routing
--   materials: [{ code, name, qty_required }]                 -- cablePlanner MRP
-- }
CREATE OR REPLACE FUNCTION public.cable_create_work_order(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_item uuid := NULLIF(payload->>'item_id','')::uuid;
  v_code text := payload->>'cable_code';
  v_won  text;
  v_wo   public.ppc_wo;
  v_email text := public.rbac_current_email();
  st jsonb; mt jsonb; v_mid uuid; v_mitem uuid; v_n_stage int := 0; v_n_mat int := 0;
BEGIN
  -- resolve / create the cable's ppc_item (item_id NOT NULL on ppc_wo)
  IF v_item IS NULL AND v_code IS NOT NULL THEN
    SELECT item_id INTO v_item FROM public.cable_master WHERE lower(cable_code)=lower(v_code);
  END IF;
  IF v_item IS NULL THEN
    INSERT INTO public.ppc_items(code, name, item_type, uom)
    VALUES (COALESCE(v_code, 'CBL-'||substr(gen_random_uuid()::text,1,8)),
            COALESCE(payload->>'product_name', v_code, 'Cable'),
            CASE WHEN COALESCE((payload->>'is_power_cord')::boolean,false) THEN 'power_cord' ELSE 'cable' END, 'm')
    ON CONFLICT (lower(code)) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_item;
    IF v_code IS NOT NULL THEN UPDATE public.cable_master SET item_id = v_item WHERE lower(cable_code)=lower(v_code) AND item_id IS NULL; END IF;
  END IF;

  -- generate WO number WO-YYMMDD-NNN
  SELECT 'WO-'||to_char(now(),'YYMMDD')||'-'||lpad((count(*)+1)::text,3,'0')
    INTO v_won FROM public.ppc_wo WHERE wo_number LIKE 'WO-'||to_char(now(),'YYMMDD')||'-%';

  INSERT INTO public.ppc_wo(wo_number, item_id, qty, status, priority, due_date,
      customer_code, customer_name, source_order_number, source_kind, owner_email, notes)
  VALUES (v_won, v_item, COALESCE((payload->>'qty')::numeric,1), 'released',
      COALESCE(payload->>'priority','medium'), NULLIF(payload->>'due_date','')::date,
      payload->>'customer_code', payload->>'customer_name', payload->>'sales_order_number',
      'cable_plan', v_email, 'Auto-created from cable production plan')
  RETURNING * INTO v_wo;

  -- routed stages, machine-assigned from the Machine Master
  FOR st IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'stages','[]'::jsonb)) LOOP
    SELECT id INTO v_mid FROM public.ppc_machines WHERE stage = st->>'machine_stage' AND COALESCE(is_available,true) ORDER BY code LIMIT 1;
    INSERT INTO public.ppc_wo_stage(work_order_id, stage_name, sequence, machine_id, status)
    VALUES (v_wo.id, st->>'stage_name', COALESCE((st->>'sequence')::int, v_n_stage), v_mid, 'pending');
    v_n_stage := v_n_stage + 1;
  END LOOP;

  -- material kit from the MRP (upsert raw-material items by code)
  FOR mt IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'materials','[]'::jsonb)) LOOP
    IF COALESCE(mt->>'code','') = '' THEN CONTINUE; END IF;
    INSERT INTO public.ppc_items(code, name, item_type, uom)
    VALUES (mt->>'code', COALESCE(mt->>'name', mt->>'code'), 'raw_material', 'kg')
    ON CONFLICT (lower(code)) DO UPDATE SET name = COALESCE(public.ppc_items.name, EXCLUDED.name)
    RETURNING id INTO v_mitem;
    INSERT INTO public.ppc_wo_material(work_order_id, item_id, qty_required)
    VALUES (v_wo.id, v_mitem, COALESCE((mt->>'qty_required')::numeric,0));
    v_n_mat := v_n_mat + 1;
  END LOOP;

  -- mark the plan released
  IF NULLIF(payload->>'plan_id','') IS NOT NULL THEN
    UPDATE public.cable_production_plan
      SET status='released', work_order_id=v_wo.id, updated_at=now()
      WHERE id = (payload->>'plan_id')::uuid;
  END IF;

  RETURN jsonb_build_object('wo_id', v_wo.id, 'wo_number', v_won, 'item_id', v_item,
                            'stages', v_n_stage, 'materials', v_n_mat);
END $fn$;
GRANT EXECUTE ON FUNCTION public.cable_create_work_order(jsonb) TO authenticated;

COMMIT;
