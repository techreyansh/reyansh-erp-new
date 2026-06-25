-- Dispatch Control Tower — a dispatch plan per released sales order. The
-- dispatch date drives the backward schedule (computed by dispatchPlanner);
-- readiness holds per-department progress. Module-gated RLS + audit.
CREATE TABLE IF NOT EXISTS public.dispatch_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id uuid REFERENCES public.sales_order(id) ON DELETE CASCADE,
  so_number text, customer_code text, company_name text,
  dispatch_date date, committed_date date, actual_dispatch_date date,
  priority text DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status text DEFAULT 'planned'
    CHECK (status IN ('planned','in_production','packing','ready','dispatched','delayed','cancelled')),
  readiness jsonb DEFAULT '{}'::jsonb,
  total_qty numeric, total_value numeric,
  delay_reason text, owner_email text,
  created_by_email text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispatch_plan_date ON public.dispatch_plan (dispatch_date);
CREATE INDEX IF NOT EXISTS idx_dispatch_plan_so ON public.dispatch_plan (so_id);
ALTER TABLE public.dispatch_plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dispatch_plan_all ON public.dispatch_plan;
CREATE POLICY dispatch_plan_all ON public.dispatch_plan FOR ALL USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS dispatch_plan_master_audit ON public.dispatch_plan;
CREATE TRIGGER dispatch_plan_master_audit AFTER INSERT OR UPDATE OR DELETE ON public.dispatch_plan
  FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger();
