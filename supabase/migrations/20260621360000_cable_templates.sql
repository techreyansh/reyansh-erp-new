-- Cable templates (UX overhaul Wave 3): Routing & BOM templates.
-- Editable, named defaults the planner can pick — the engine's routing/MRP MATH
-- is unchanged; these are stored INPUTS (a template the user maintains), not a
-- new calculation. steps/lines kept as jsonb (header+lines in one row) so they
-- ride the generic master framework. Additive + audited.
BEGIN;

CREATE TABLE IF NOT EXISTS public.routing_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text, name text, description text,
  steps jsonb DEFAULT '[]'::jsonb,          -- [{stage}] in run order
  is_active boolean DEFAULT true, archived_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS routing_template_code_uq ON public.routing_template (lower(code)) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.bom_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text, name text, basis text DEFAULT 'per_meter',
  lines jsonb DEFAULT '[]'::jsonb,          -- [{material_code, kind, qty_per_meter}]
  is_active boolean DEFAULT true, archived_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bom_template_code_uq ON public.bom_template (lower(code)) WHERE code IS NOT NULL;

-- Seed the two canonical routings the engine already derives, as editable defaults.
INSERT INTO public.routing_template (code, name, description, steps)
SELECT 'STD-CABLE', 'Standard multi-core cable', 'Bunching → Core → Laying → Sheathing',
       '[{"stage":"bunching"},{"stage":"core"},{"stage":"laying"},{"stage":"sheathing"}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.routing_template WHERE lower(code)='std-cable');
INSERT INTO public.routing_template (code, name, description, steps)
SELECT 'PWR-CORD', 'Power cord', 'Core → Sheathing → Cutting',
       '[{"stage":"core"},{"stage":"sheathing"},{"stage":"cutting"}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.routing_template WHERE lower(code)='pwr-cord');

INSERT INTO public.bom_template (code, name, basis, lines)
SELECT 'STD-PVC', 'Standard PVC cable BOM', 'per_meter',
       '[{"material_code":"CO001","kind":"conductor","qty_per_meter":0},{"material_code":"PV003","kind":"insulation","qty_per_meter":0},{"material_code":"PV001","kind":"sheath","qty_per_meter":0}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.bom_template WHERE lower(code)='std-pvc');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['routing_template','bom_template'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger()', t, t);
  END LOOP;
END $$;

COMMIT;
