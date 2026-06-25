-- =====================================================================
-- MES Phase 2-4 — masters + daily planning
-- =====================================================================
-- molding / packing / A-B side config / shift / department / workstation
-- masters + daily_production_plan. RLS follows the app pattern (permissive +
-- app module-gating); module-gated under Production. Additive.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.molding_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mold_number text UNIQUE, customer_code text,
  product_id uuid REFERENCES public.product(id) ON DELETE SET NULL,
  mold_type text DEFAULT 'inner' CHECK (mold_type IN ('inner','outer','grommet')),
  tool_life_shots numeric, cycle_time_sec numeric, cavity_count int DEFAULT 1,
  machine_compat text, location text,
  status text DEFAULT 'active' CHECK (status IN ('active','maintenance','retired')),
  shots_done numeric DEFAULT 0, notes text,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.packing_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE, name text NOT NULL,
  packing_type text DEFAULT 'master' CHECK (packing_type IN ('poly','individual','master')),
  cycle_time_sec numeric, manpower_reqd numeric, min_batch_qty numeric,
  box_dimensions text, box_weight_g numeric, label_required boolean DEFAULT false, barcode_required boolean DEFAULT false,
  notes text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

-- One table for A & B side (DRY — B is a mirror of A), discriminated by `side`.
CREATE TABLE IF NOT EXISTS public.assembly_side_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.product(id) ON DELETE CASCADE,
  side text NOT NULL DEFAULT 'A' CHECK (side IN ('A','B')),
  plug_type text, pin_type text, terminal_type text, sleeve_type text,
  cycle_time_sec numeric, quality_notes text, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assembly_side_product ON public.assembly_side_config (product_id, side);

CREATE TABLE IF NOT EXISTS public.shift_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE, name text NOT NULL, start_hour numeric, end_hour numeric,
  shift_hours numeric, days_per_week int DEFAULT 6,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.department (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE, name text NOT NULL, manager_email text,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workstation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE, name text NOT NULL,
  department_id uuid REFERENCES public.department(id) ON DELETE SET NULL,
  machine_id uuid REFERENCES public.ppc_machines(id) ON DELETE SET NULL,
  stage text, capacity_per_hour numeric, operators int,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_production_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date date NOT NULL, product_id uuid REFERENCES public.product(id) ON DELETE SET NULL,
  product_name text, department_id uuid REFERENCES public.department(id) ON DELETE SET NULL,
  shift_id uuid REFERENCES public.shift_master(id) ON DELETE SET NULL,
  planned_qty numeric, manpower_assigned numeric,
  priority text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text DEFAULT 'planned' CHECK (status IN ('planned','in_production','done','cancelled')),
  notes text, created_by_email text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_plan_date ON public.daily_production_plan (plan_date);

-- RLS (app pattern: permissive + module-gated in app)
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['molding_master','packing_master','assembly_side_config','shift_master','department','workstation','daily_production_plan']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t||'_all', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Seed shifts + departments for demonstrability
INSERT INTO public.shift_master (code, name, start_hour, end_hour, shift_hours, days_per_week)
SELECT * FROM (VALUES ('A','Day Shift',9,17,8,6),('B','Evening Shift',17,1,8,6)) v(c,n,s,e,h,d)
WHERE NOT EXISTS (SELECT 1 FROM public.shift_master m WHERE m.code = v.c);
INSERT INTO public.department (code, name)
SELECT * FROM (VALUES ('CUT','Cutting'),('ASM','Assembly'),('MLD','Molding'),('PCK','Packing'),('QC','Quality')) v(c,n)
WHERE NOT EXISTS (SELECT 1 FROM public.department d WHERE d.code = v.c);
