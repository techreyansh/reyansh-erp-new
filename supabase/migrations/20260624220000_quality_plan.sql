-- =====================================================================
-- Quality Plan (control plan) module
-- =====================================================================
-- The reusable inspection plan for a product: what characteristic to check, the
-- spec, method, where in the process, frequency and sample size, and the
-- reaction if it fails. Keyed to product_id, so it travels with the product to
-- production on NPD release (no copy). Companion to product_process_step
-- (routing). Additive.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.product_quality_plan (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES public.product(id) ON DELETE CASCADE,
  sequence        int NOT NULL DEFAULT 0,
  stage           text DEFAULT 'in_process'  CHECK (stage IN ('incoming','in_process','final','dispatch')),
  characteristic  text,                       -- what is measured (e.g. conductor dia, insulation thickness)
  specification   text,                       -- the spec / tolerance
  method          text,                       -- gauge / instrument / test method
  frequency       text,                       -- per lot / hourly / 100% / sample
  sample_size     text,
  reaction_plan   text,                       -- what to do on a fail
  created_by_email text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_quality_plan_product ON public.product_quality_plan (product_id, sequence);

ALTER TABLE public.product_quality_plan ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY pqp_all ON public.product_quality_plan FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_quality_plan TO authenticated;
