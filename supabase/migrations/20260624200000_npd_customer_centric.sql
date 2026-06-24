-- =====================================================================
-- NPD customer-centric redesign — Phase 1/2 schema
-- =====================================================================
-- Developments originate from a CRM customer (already linked by customer_code).
-- Add the richer Development-Request type + opportunity link so the "New
-- Development Request" flow from a client/prospect profile carries intent.
-- Additive.
-- =====================================================================

ALTER TABLE public.npd_project
  ADD COLUMN IF NOT EXISTS development_type text,   -- drawing_based|sample_based|modification|cost_reduction|new_product
  ADD COLUMN IF NOT EXISTS opportunity      text,   -- free link to a CRM opportunity / enquiry ref
  ADD COLUMN IF NOT EXISTS account_id       uuid;   -- crm_pipeline.id of the originating customer (hard handle alongside customer_code)

CREATE INDEX IF NOT EXISTS idx_npd_project_account ON public.npd_project (account_id);
