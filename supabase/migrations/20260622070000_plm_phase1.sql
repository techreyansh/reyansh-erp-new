-- PLM Phase 1 — the single product master + folded Costing engine.
-- `product` is the ERP's source of truth for "what we make"; it REFERENCES
-- cable_master/power_cord_master for specs (no duplication). Costing tables
-- reference product.id directly (no separate customer_product). Permissive,
-- module-gated RLS (profit-data read-scoping is a noted follow-up).

-- ===== PRODUCT MASTER =====================================================
CREATE TABLE IF NOT EXISTS public.product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text UNIQUE,
  customer_code text,                 -- → crm_pipeline.customer_code (null = catalog)
  company_name text,
  customer_part_no text,
  internal_part_no text,
  product_family text,                -- "Power Cords" | "Cables" | "Harnesses"
  product_category text,
  product_type text DEFAULT 'cable',  -- 'cable'|'power_cord'|'harness'|'custom'
  product_name text,
  status text DEFAULT 'development'
    CHECK (status IN ('development','sample','approved','production','inactive','obsolete')),
  current_revision text,
  -- specification
  voltage_rating text, current_rating text, length_mm numeric, weight_g numeric,
  dimensions text, packaging_standard text, tech_spec jsonb DEFAULT '{}'::jsonb,
  -- spec references (no duplication)
  cable_master_id uuid REFERENCES public.cable_master(id),
  power_cord_master_id uuid,
  -- targets & productivity
  target_per_hour numeric, target_per_shift numeric, target_per_day numeric,
  target_per_month numeric, cycle_time_sec numeric,
  -- manpower & machine
  operators_reqd int, inspectors_reqd int, packers_reqd int,
  machine_reqs jsonb DEFAULT '{}'::jsonb,
  -- quality & moulding (editable jsonb)
  quality jsonb DEFAULT '{}'::jsonb,
  moulding jsonb DEFAULT '{}'::jsonb,
  -- governance
  created_by_email text, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_product_customer ON public.product (customer_code);
CREATE INDEX IF NOT EXISTS idx_product_status ON public.product (status);
CREATE INDEX IF NOT EXISTS idx_product_family ON public.product (product_family);

CREATE TABLE IF NOT EXISTS public.product_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.product(id) ON DELETE CASCADE,
  revision text, status text,
  changed_by_email text, changed_at timestamptz DEFAULT now(),
  change_reason text, snapshot jsonb
);
CREATE INDEX IF NOT EXISTS idx_product_revision_p ON public.product_revision (product_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.product_process_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.product(id) ON DELETE CASCADE,
  sequence int DEFAULT 0, step_name text, department text, machine text,
  standard_time_sec numeric, manpower int, notes text
);
CREATE INDEX IF NOT EXISTS idx_product_process_p ON public.product_process_step (product_id, sequence);

CREATE TABLE IF NOT EXISTS public.product_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.product(id) ON DELETE CASCADE,
  doc_type text, file_name text, storage_path text, version text,
  uploaded_by_email text, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_document_p ON public.product_document (product_id);

-- (BOM↔product link deferred to Phase 3 auto-costing — the BOM table is
--  bom_template/company_bom_data; wired then once the join approach is confirmed.)

-- ===== COSTING (folded; references product, not customer_product) =========
CREATE TABLE IF NOT EXISTS public.material_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_code text NOT NULL, material_name text, rate numeric NOT NULL DEFAULT 0,
  uom text DEFAULT 'kg', effective_from date DEFAULT current_date, effective_to date,
  source text DEFAULT 'manual', created_by_email text, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_material_rate_code ON public.material_rate (material_code, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.costing_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, product_kind text,
  sections jsonb DEFAULT '[]'::jsonb, external_format jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true, created_by_email text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.costing_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  costing_no text,
  product_id uuid REFERENCES public.product(id) ON DELETE CASCADE,
  customer_code text, product_name text, revision text,
  version_number int DEFAULT 1,
  mode text DEFAULT 'manual' CHECK (mode IN ('auto','manual')),
  template_id uuid REFERENCES public.costing_template(id),
  status text DEFAULT 'draft' CHECK (status IN ('draft','reviewed','approved','released','superseded')),
  effective_date date,
  material_cost numeric DEFAULT 0, labour_cost numeric DEFAULT 0, machine_cost numeric DEFAULT 0,
  overhead_cost numeric DEFAULT 0, financial_cost numeric DEFAULT 0, total_cost numeric DEFAULT 0,
  target_margin_pct numeric DEFAULT 0, net_selling_price numeric DEFAULT 0,
  contribution_pct numeric DEFAULT 0, gross_margin_pct numeric DEFAULT 0, net_margin_pct numeric DEFAULT 0,
  qty_basis numeric DEFAULT 1, uom text DEFAULT 'piece',
  created_by_email text, reviewed_by_email text, approved_by_email text,
  approved_at timestamptz, released_at timestamptz, change_reason text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (product_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_costing_version_p ON public.costing_version (product_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_costing_version_status ON public.costing_version (status);

CREATE TABLE IF NOT EXISTS public.costing_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  costing_id uuid REFERENCES public.costing_version(id) ON DELETE CASCADE,
  section text CHECK (section IN ('material','labour','machine','overhead','financial','profit')),
  category text, material_code text, qty numeric DEFAULT 0, uom text,
  rate numeric DEFAULT 0, rate_overridden boolean DEFAULT false, amount numeric DEFAULT 0,
  is_percentage boolean DEFAULT false, pct_basis text, sequence int DEFAULT 0, notes text
);
CREATE INDEX IF NOT EXISTS idx_costing_line_costing ON public.costing_line (costing_id, sequence);

CREATE TABLE IF NOT EXISTS public.costing_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  costing_id uuid REFERENCES public.costing_version(id) ON DELETE CASCADE,
  from_status text, to_status text, changed_by_email text,
  changed_at timestamptz DEFAULT now(), reason text
);
CREATE INDEX IF NOT EXISTS idx_costing_status_log_c ON public.costing_status_log (costing_id, changed_at DESC);

-- ===== RLS (permissive, module-gated) =====================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product','product_revision','product_process_step','product_document',
                           'material_rate','costing_template','costing_version','costing_line','costing_status_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true);', t||'_all', t);
  END LOOP;
END $$;

-- ===== Audit triggers =====================================================
DROP TRIGGER IF EXISTS product_master_audit ON public.product;
CREATE TRIGGER product_master_audit AFTER INSERT OR UPDATE OR DELETE ON public.product
  FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger();
DROP TRIGGER IF EXISTS costing_version_master_audit ON public.costing_version;
CREATE TRIGGER costing_version_master_audit AFTER INSERT OR UPDATE OR DELETE ON public.costing_version
  FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger();

-- ===== Seeds (material rates + costing templates) =========================
INSERT INTO public.material_rate (material_code, material_name, rate, uom, source)
SELECT * FROM (VALUES
  ('COPPER','Copper conductor',745,'kg','manual'),('PVC_INS','PVC insulation compound',110,'kg','manual'),
  ('PVC_SHEATH','PVC sheathing compound',105,'kg','manual'),('PIN_6A','6A pin/plug',14,'pc','manual'),
  ('PIN_16A','16A pin/plug',22,'pc','manual'),('TERMINAL','Terminal',8,'pc','manual'),
  ('CONNECTOR','Connector',25,'pc','manual'),('SLEEVE','Sleeve',3,'pc','manual'),
  ('LABEL','Label',1,'pc','manual'),('PACKING','Packing material',12,'set','manual')
) AS v(material_code, material_name, rate, uom, source)
WHERE NOT EXISTS (SELECT 1 FROM public.material_rate m WHERE m.material_code = v.material_code);

INSERT INTO public.costing_template (name, product_kind, sections, external_format)
SELECT v.name, v.kind, v.sections::jsonb, v.ext::jsonb FROM (VALUES
  ('Power Cord Costing','power_cord','["material","labour","machine","overhead","financial","profit"]',
    '{"option":"A","buckets":[{"label":"Material","from":["material"]},{"label":"Conversion","from":["labour","machine","overhead","financial"]},{"label":"Packing","from":["material:Packing"]}]}'),
  ('Cable Costing','cable','["material","labour","machine","overhead","financial","profit"]',
    '{"option":"B","buckets":[{"label":"Copper","from":["material:Copper"]},{"label":"PVC","from":["material:PVC"]},{"label":"Accessories","from":["material:Pins"]},{"label":"Packing","from":["material:Packing"]}]}'),
  ('Wiring Harness Costing','harness','["material","labour","machine","overhead","financial","profit"]',
    '{"option":"A","buckets":[{"label":"Material","from":["material"]},{"label":"Conversion","from":["labour","machine","overhead","financial"]}]}'),
  ('Export Costing','cable','["material","labour","machine","overhead","financial","profit"]',
    '{"option":"C","buckets":[{"label":"FOB Material","from":["material"]},{"label":"Processing","from":["labour","machine"]}]}'),
  ('OEM Costing','cable','["material","labour","machine","overhead","financial","profit"]',
    '{"option":"A","buckets":[{"label":"Material","from":["material"]},{"label":"Conversion","from":["labour","machine","overhead","financial"]}]}')
) AS v(name, kind, sections, ext)
WHERE NOT EXISTS (SELECT 1 FROM public.costing_template t WHERE t.name = v.name);
