-- =====================================================================
-- NPD Phase 3 — samples, quality/inspection, customer feedback + release
-- =====================================================================
-- Additive. All keyed to npd_project with a `revision` discriminator so a
-- Customer-Feedback -> rework loop doesn't pile undistinguished samples/
-- feedback (review fix). RLS USING(true) module-gated, matching npd_project.
-- Production release flips the product status (no data copy — the product /
-- costing / docs already live in their own tables).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.npd_sample (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.npd_project(id) ON DELETE CASCADE,
  revision      int NOT NULL DEFAULT 0,
  sample_no     text,
  status        text NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','in_development','built','dispatched','approved','rejected')),
  built_at      date,
  dispatched_at date,
  notes         text,
  created_by_email text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_npd_sample_project ON public.npd_sample (project_id);

CREATE TABLE IF NOT EXISTS public.npd_quality_check (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.npd_project(id) ON DELETE CASCADE,
  sample_id     uuid REFERENCES public.npd_sample(id) ON DELETE SET NULL,
  revision      int NOT NULL DEFAULT 0,
  test_type     text,                               -- dimensional|electrical|visual|other
  parameter     text,
  spec_value    text,
  measured_value text,
  result        text NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','pass','fail')),
  checked_by_email text,
  checked_at    timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_npd_quality_project ON public.npd_quality_check (project_id);

CREATE TABLE IF NOT EXISTS public.npd_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.npd_project(id) ON DELETE CASCADE,
  revision      int NOT NULL DEFAULT 0,
  sent_at       date,
  feedback_at   date,
  outcome       text NOT NULL DEFAULT 'pending'
                CHECK (outcome IN ('pending','approved','approved_with_changes','rejected','resample')),
  comments      text,
  recorded_by_email text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_npd_feedback_project ON public.npd_feedback (project_id);

ALTER TABLE public.npd_sample        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npd_quality_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npd_feedback      ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY npd_sample_all  ON public.npd_sample        FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY npd_qc_all      ON public.npd_quality_check FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY npd_fb_all      ON public.npd_feedback      FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.npd_sample, public.npd_quality_check, public.npd_feedback TO authenticated;

-- Production release: flip the linked product to 'production' + advance the
-- project (no data copy — the product already exists). Requires the project to
-- be Approved with a linked product.
CREATE OR REPLACE FUNCTION public.npd_release_to_production(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prod uuid; v_stage text; v_email text := COALESCE(NULLIF(current_setting('request.jwt.claims', true)::json->>'email',''), 'system');
BEGIN
  SELECT product_id, stage INTO v_prod, v_stage FROM public.npd_project WHERE id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'project not found'; END IF;
  IF v_prod IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Link a product before releasing to production.'); END IF;
  IF v_stage NOT IN ('approved','production_release') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'The project must be Approved before production release.');
  END IF;
  UPDATE public.product SET status = 'production', updated_at = now() WHERE id = v_prod;
  UPDATE public.npd_project SET status = 'approved', stage = 'production_release', stage_entered_at = now(), updated_at = now() WHERE id = p_project_id;
  IF v_stage <> 'production_release' THEN
    INSERT INTO public.npd_stage_history (project_id, from_stage, to_stage, moved_by_email, note)
    VALUES (p_project_id, v_stage, 'production_release', v_email, 'released to production');
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.npd_release_to_production(uuid) TO authenticated;
