-- Bring the CRM tracker sheet's fields into the pipeline so the user can work
-- the way they're used to: Industry, City, Product Category on crm_pipeline.
BEGIN;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS product_category text;
COMMIT;
