-- Link a PPC work order back to the CRM order/customer it fulfills.
BEGIN;
ALTER TABLE public.ppc_wo ADD COLUMN IF NOT EXISTS customer_code text;
ALTER TABLE public.ppc_wo ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.ppc_wo ADD COLUMN IF NOT EXISTS source_order_number text;
ALTER TABLE public.ppc_wo ADD COLUMN IF NOT EXISTS source_kind text DEFAULT 'manual';
ALTER TABLE public.ppc_wo ADD COLUMN IF NOT EXISTS crm_order_cycle_id uuid;
CREATE INDEX IF NOT EXISTS idx_ppc_wo_customer ON public.ppc_wo(customer_code);
CREATE INDEX IF NOT EXISTS idx_ppc_wo_order_cycle ON public.ppc_wo(crm_order_cycle_id);
COMMIT;
