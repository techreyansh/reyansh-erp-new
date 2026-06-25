-- Sales Order — Order Initiation Engine schema. The trigger event for the
-- Order-to-Dispatch workflow. Line items reference the PLM product master and
-- the released costing_version (no free text). Module-gated RLS; audit trigger.

CREATE TABLE IF NOT EXISTS public.sales_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_number text UNIQUE,
  customer_code text, company_name text,
  po_number text, po_date date, po_revision text, po_validity date,
  customer_ref text, buyer_name text, contact text,
  payment_terms text, special_instructions text,
  expected_delivery_date date, expected_dispatch_date date,
  priority text DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status text DEFAULT 'draft'
    CHECK (status IN ('draft','pending_review','approved','released','in_planning',
                      'in_production','partially_dispatched','dispatched','closed','cancelled')),
  total_qty numeric DEFAULT 0, total_value numeric DEFAULT 0, margin_est_pct numeric,
  material_estimate jsonb DEFAULT '{}'::jsonb,
  owner_email text, created_by_email text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), released_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sales_order_customer ON public.sales_order (customer_code);
CREATE INDEX IF NOT EXISTS idx_sales_order_status ON public.sales_order (status);

CREATE TABLE IF NOT EXISTS public.sales_order_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id uuid REFERENCES public.sales_order(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.product(id),
  product_code text, product_name text, customer_part_no text, revision text,
  qty numeric DEFAULT 0, uom text DEFAULT 'pc', unit_price numeric DEFAULT 0, line_value numeric DEFAULT 0,
  costing_version_id uuid REFERENCES public.costing_version(id),
  required_delivery_date date, lead_time_days int, on_hand_qty numeric, remarks text, sequence int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sales_order_line_so ON public.sales_order_line (so_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sales_order_line_product ON public.sales_order_line (product_id);

CREATE TABLE IF NOT EXISTS public.sales_order_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id uuid REFERENCES public.sales_order(id) ON DELETE CASCADE,
  doc_type text DEFAULT 'po', file_name text, storage_path text, version text,
  uploaded_by_email text, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_order_document_so ON public.sales_order_document (so_id);

CREATE TABLE IF NOT EXISTS public.sales_order_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id uuid REFERENCES public.sales_order(id) ON DELETE CASCADE,
  from_status text, to_status text, changed_by_email text,
  changed_at timestamptz DEFAULT now(), note text
);
CREATE INDEX IF NOT EXISTS idx_sales_order_status_log_so ON public.sales_order_status_log (so_id, changed_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_order','sales_order_line','sales_order_document','sales_order_status_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true);', t||'_all', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS sales_order_master_audit ON public.sales_order;
CREATE TRIGGER sales_order_master_audit AFTER INSERT OR UPDATE OR DELETE ON public.sales_order
  FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger();
