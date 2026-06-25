-- Production demand generated when a sales order is RELEASED — one row per SO
-- line. Feeds production planning; planned_qty tracks fulfilment. Module-gated RLS.
CREATE TABLE IF NOT EXISTS public.production_demand (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id uuid REFERENCES public.sales_order(id) ON DELETE CASCADE,
  so_line_id uuid REFERENCES public.sales_order_line(id) ON DELETE CASCADE,
  so_number text, customer_code text, company_name text,
  product_id uuid REFERENCES public.product(id),
  product_code text, product_name text,
  qty numeric DEFAULT 0, uom text DEFAULT 'pc', planned_qty numeric DEFAULT 0,
  required_date date, priority text DEFAULT 'medium',
  status text DEFAULT 'pending' CHECK (status IN ('pending','planned','in_production','done','cancelled')),
  owner_email text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_production_demand_status ON public.production_demand (status, required_date);
CREATE INDEX IF NOT EXISTS idx_production_demand_so ON public.production_demand (so_id);
ALTER TABLE public.production_demand ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS production_demand_all ON public.production_demand;
CREATE POLICY production_demand_all ON public.production_demand FOR ALL USING (true) WITH CHECK (true);
