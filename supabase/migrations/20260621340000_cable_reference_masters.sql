-- Cable reference masters (UX overhaul Wave 2): Colour / Size / Material.
-- Turns previously hardcoded/implicit lists into real, user-maintainable masters
-- with the standard {is_active, archived_at} + audit-trigger shape. Additive;
-- seeded idempotently; production logic untouched (these are reference data).
BEGIN;

-- 1) COLOUR MASTER (was a hardcoded 8-item array in CableMaster) -------------
CREATE TABLE IF NOT EXISTS public.colour_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text, name text, hex text,
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true, archived_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS colour_master_code_uq ON public.colour_master (lower(code)) WHERE code IS NOT NULL;
INSERT INTO public.colour_master (code, name, hex, sort_order)
SELECT * FROM (VALUES
  ('RED','Red','#ef4444',1),('BLK','Black','#111827',2),('YEL','Yellow','#eab308',3),
  ('GRN','Green','#22c55e',4),('BLU','Blue','#3b82f6',5),('BRN','Brown','#92400e',6),
  ('GRY','Grey','#9ca3af',7),('WHT','White','#e5e7eb',8),('GNY','Green-Yellow','#84cc16',9),
  ('ORG','Orange','#f97316',10)
) v(code,name,hex,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.colour_master m WHERE lower(m.code)=lower(v.code));

-- 2) SIZE MASTER (standard conductor sizes + typical strand constructions) ----
CREATE TABLE IF NOT EXISTS public.size_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text, copper_area_sqmm numeric, strand_construction text, label text,
  is_active boolean DEFAULT true, archived_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS size_master_code_uq ON public.size_master (lower(code)) WHERE code IS NOT NULL;
INSERT INTO public.size_master (code, copper_area_sqmm, strand_construction, label)
SELECT * FROM (VALUES
  ('0.5',0.5,'16/0.20','0.5 sq mm'),('0.75',0.75,'24/0.20','0.75 sq mm'),
  ('1.0',1.0,'32/0.20','1.0 sq mm'),('1.5',1.5,'30/0.25','1.5 sq mm'),
  ('2.5',2.5,'50/0.25','2.5 sq mm'),('4.0',4.0,'56/0.30','4.0 sq mm'),
  ('6.0',6.0,'84/0.30','6.0 sq mm')
) v(code,copper_area_sqmm,strand_construction,label)
WHERE NOT EXISTS (SELECT 1 FROM public.size_master m WHERE lower(m.code)=lower(v.code));

-- 3) MATERIAL MASTER (raw-material reference for cables) ----------------------
CREATE TABLE IF NOT EXISTS public.material_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text, name text,
  material_type text DEFAULT 'other',     -- conductor|insulation|sheath|filler|other
  uom text DEFAULT 'kg', density numeric, default_unit_cost numeric, notes text,
  is_active boolean DEFAULT true, archived_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS material_master_code_uq ON public.material_master (lower(code)) WHERE code IS NOT NULL;
INSERT INTO public.material_master (code, name, material_type, uom, density)
SELECT * FROM (VALUES
  ('CO001','Copper (bare)','conductor','kg',8.96),
  ('PV003','PVC Insulation compound','insulation','kg',1.40),
  ('PV001','PVC Sheath compound','sheath','kg',1.40)
) v(code,name,material_type,uom,density)
WHERE NOT EXISTS (SELECT 1 FROM public.material_master m WHERE lower(m.code)=lower(v.code));

-- RLS + audit triggers for all three -----------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['colour_master','size_master','material_master'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger()', t, t);
  END LOOP;
END $$;

COMMIT;
