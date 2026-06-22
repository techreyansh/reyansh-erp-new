-- Costing & Pricing module — Phase 1 schema.
-- Customer → customer_product → costing_version → costing_line, with central
-- material_rate, reusable costing_template, and costing_status_log. Reuses the
-- existing master_audit_trigger() for field-level change history on versions.
-- Permissive RLS gated at module level (matches the app's other domain tables);
-- profit-data hardening (role-scoped read) is a noted follow-up.

-- 1) central, dated material rates -----------------------------------------
CREATE TABLE IF NOT EXISTS public.material_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_code text NOT NULL,
  material_name text,
  rate numeric NOT NULL DEFAULT 0,
  uom text DEFAULT 'kg',
  effective_from date DEFAULT current_date,
  effective_to date,
  source text DEFAULT 'manual',
  created_by_email text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_material_rate_code ON public.material_rate (material_code, effective_from DESC);

-- 2) costing templates (cost structure + external roll-up format) -----------
CREATE TABLE IF NOT EXISTS public.costing_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  product_kind text,
  sections jsonb DEFAULT '[]'::jsonb,
  external_format jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_by_email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  archived_at timestamptz
);

-- 3) customer product library ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code text,
  company_name text,
  product_kind text DEFAULT 'cable',
  product_ref_id uuid,
  product_code text NOT NULL,
  product_name text,
  drawing_no text,
  drawing_url text,
  current_revision text,
  status text DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by_email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (customer_code, product_code)
);
CREATE INDEX IF NOT EXISTS idx_customer_product_customer ON public.customer_product (customer_code);

-- 4) costing version (one revision; draft→released) -------------------------
CREATE TABLE IF NOT EXISTS public.costing_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  costing_no text,
  customer_product_id uuid REFERENCES public.customer_product(id) ON DELETE CASCADE,
  customer_code text,
  product_name text,
  revision text,
  version_number int DEFAULT 1,
  mode text DEFAULT 'manual' CHECK (mode IN ('auto','manual')),
  template_id uuid REFERENCES public.costing_template(id),
  status text DEFAULT 'draft' CHECK (status IN ('draft','reviewed','approved','released','superseded')),
  effective_date date,
  material_cost numeric DEFAULT 0,
  labour_cost numeric DEFAULT 0,
  machine_cost numeric DEFAULT 0,
  overhead_cost numeric DEFAULT 0,
  financial_cost numeric DEFAULT 0,
  total_cost numeric DEFAULT 0,
  target_margin_pct numeric DEFAULT 0,
  net_selling_price numeric DEFAULT 0,
  contribution_pct numeric DEFAULT 0,
  gross_margin_pct numeric DEFAULT 0,
  net_margin_pct numeric DEFAULT 0,
  qty_basis numeric DEFAULT 1,
  uom text DEFAULT 'piece',
  created_by_email text,
  reviewed_by_email text,
  approved_by_email text,
  approved_at timestamptz,
  released_at timestamptz,
  change_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (customer_product_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_costing_version_cp ON public.costing_version (customer_product_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_costing_version_status ON public.costing_version (status);

-- 5) costing line (every cost component) ------------------------------------
CREATE TABLE IF NOT EXISTS public.costing_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  costing_id uuid REFERENCES public.costing_version(id) ON DELETE CASCADE,
  section text CHECK (section IN ('material','labour','machine','overhead','financial','profit')),
  category text,
  material_code text,
  qty numeric DEFAULT 0,
  uom text,
  rate numeric DEFAULT 0,
  rate_overridden boolean DEFAULT false,
  amount numeric DEFAULT 0,
  is_percentage boolean DEFAULT false,
  pct_basis text,
  sequence int DEFAULT 0,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_costing_line_costing ON public.costing_line (costing_id, sequence);

-- 6) approval status log ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.costing_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  costing_id uuid REFERENCES public.costing_version(id) ON DELETE CASCADE,
  from_status text,
  to_status text,
  changed_by_email text,
  changed_at timestamptz DEFAULT now(),
  reason text
);
CREATE INDEX IF NOT EXISTS idx_costing_status_log_costing ON public.costing_status_log (costing_id, changed_at DESC);

-- RLS: permissive, module-gated (consistent with other domain tables) -------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['material_rate','costing_template','customer_product','costing_version','costing_line','costing_status_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true);', t||'_all', t);
  END LOOP;
END $$;

-- field-level audit on versions
DROP TRIGGER IF EXISTS costing_version_master_audit ON public.costing_version;
CREATE TRIGGER costing_version_master_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.costing_version
  FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger();

-- Seed: starting material rates (editable in the Rate Master) ---------------
INSERT INTO public.material_rate (material_code, material_name, rate, uom, source)
SELECT * FROM (VALUES
  ('COPPER','Copper conductor',745,'kg','manual'),
  ('PVC_INS','PVC insulation compound',110,'kg','manual'),
  ('PVC_SHEATH','PVC sheathing compound',105,'kg','manual'),
  ('PIN_6A','6A pin/plug',14,'pc','manual'),
  ('PIN_16A','16A pin/plug',22,'pc','manual'),
  ('TERMINAL','Terminal',8,'pc','manual'),
  ('CONNECTOR','Connector',25,'pc','manual'),
  ('SLEEVE','Sleeve',3,'pc','manual'),
  ('LABEL','Label',1,'pc','manual'),
  ('PACKING','Packing material',12,'set','manual')
) AS v(material_code, material_name, rate, uom, source)
WHERE NOT EXISTS (SELECT 1 FROM public.material_rate m WHERE m.material_code = v.material_code);

-- Seed: starting templates (sections + a default external format) -----------
INSERT INTO public.costing_template (name, product_kind, sections, external_format)
SELECT v.name, v.kind, v.sections::jsonb, v.ext::jsonb FROM (VALUES
  ('Power Cord Costing','power_cord',
    '["material","labour","machine","overhead","financial","profit"]',
    '{"option":"A","buckets":[{"label":"Material","from":["material"]},{"label":"Conversion","from":["labour","machine","overhead","financial"]},{"label":"Packing","from":["material:Packing"]}]}'),
  ('Cable Costing','cable',
    '["material","labour","machine","overhead","financial","profit"]',
    '{"option":"B","buckets":[{"label":"Copper","from":["material:Copper"]},{"label":"PVC","from":["material:PVC"]},{"label":"Accessories","from":["material:Pins","material:Terminals"]},{"label":"Packing","from":["material:Packing"]}]}'),
  ('Wiring Harness Costing','harness',
    '["material","labour","machine","overhead","financial","profit"]',
    '{"option":"A","buckets":[{"label":"Material","from":["material"]},{"label":"Conversion","from":["labour","machine","overhead","financial"]},{"label":"Packing","from":["material:Packing"]}]}'),
  ('Export Costing','cable',
    '["material","labour","machine","overhead","financial","profit"]',
    '{"option":"C","buckets":[{"label":"FOB Material","from":["material"]},{"label":"Processing","from":["labour","machine"]},{"label":"Overheads & Logistics","from":["overhead","financial"]}]}'),
  ('OEM Costing','cable',
    '["material","labour","machine","overhead","financial","profit"]',
    '{"option":"A","buckets":[{"label":"Material","from":["material"]},{"label":"Conversion","from":["labour","machine","overhead","financial"]}]}')
) AS v(name, kind, sections, ext)
WHERE NOT EXISTS (SELECT 1 FROM public.costing_template t WHERE t.name = v.name);
