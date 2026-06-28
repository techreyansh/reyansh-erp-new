-- =====================================================================
-- NPD (New Product Development) — Phase 1: project spine + stage gate + RBAC
-- =====================================================================
-- Additive. New npd_* tables + a new 'npd' module. Orchestration spine that
-- links (by id / customer_code) to existing product / crm_pipeline / costing /
-- bom — never copies them. Stage gate is server-enforced with ordinality
-- (no forward-skips), caller re-check (SECURITY DEFINER bypasses RLS), and
-- optimistic locking. RLS = USING(true) module-gated (matches the PLM tables
-- NPD orchestrates; CEO + engineers collaborate). Review-driven build.
-- =====================================================================

-- 1. Project spine
CREATE TABLE IF NOT EXISTS public.npd_project (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_no        text UNIQUE,
  customer_code     text,                       -- soft link to crm_pipeline (NOT an FK — CRM rows churn)
  company_name      text,
  product_id        uuid REFERENCES public.product(id) ON DELETE SET NULL,  -- nullable until product created
  product_name      text NOT NULL,
  customer_part_no  text,
  internal_part_no  text,
  project_type      text DEFAULT 'sample' CHECK (project_type IN ('sample','drawing','both')),
  priority          text DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  target_date       date,
  npd_engineer_email text,
  salesperson_email  text,
  crm_email          text,
  stage             text NOT NULL DEFAULT 'requirement_received',
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','approved','rejected','on_hold','cancelled')),
  revision          int NOT NULL DEFAULT 0,      -- bumps on a Customer-Feedback rework loop
  stage_entered_at  timestamptz NOT NULL DEFAULT now(),
  notes             text,
  created_by_email  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_npd_project_stage    ON public.npd_project (stage);
CREATE INDEX IF NOT EXISTS idx_npd_project_customer ON public.npd_project (customer_code);
CREATE INDEX IF NOT EXISTS idx_npd_project_engineer ON public.npd_project (npd_engineer_email);

-- 2. Stage history (immutable audit)
CREATE TABLE IF NOT EXISTS public.npd_stage_history (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    uuid NOT NULL REFERENCES public.npd_project(id) ON DELETE CASCADE,
  from_stage    text,
  to_stage      text NOT NULL,
  moved_by_email text,
  note          text,
  moved_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_npd_stage_history_project ON public.npd_stage_history (project_id, id);

-- 3. Documents (pre-product safe — product_document needs a product, NPD starts without one)
CREATE TABLE IF NOT EXISTS public.npd_document (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.npd_project(id) ON DELETE CASCADE,
  doc_type      text,                            -- drawing|sample_photo|spec|ppap|test_report|email|other
  file_name     text,
  storage_path  text,
  version       int NOT NULL DEFAULT 1,
  uploaded_by_email text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_npd_document_project ON public.npd_document (project_id);

-- 4. RLS — read/write open to authenticated (module-gated in the app), matching PLM tables.
ALTER TABLE public.npd_project       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npd_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.npd_document      ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY npd_project_all ON public.npd_project FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY npd_stage_hist_read ON public.npd_stage_history FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY npd_document_all ON public.npd_document FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.npd_project, public.npd_document TO authenticated;
GRANT SELECT ON public.npd_stage_history TO authenticated;

-- 5. Stage model (ordered). Soft gates: forward by 1 allowed, backward (rework) allowed,
--    forward-skip rejected. Hard rule: cannot reach production_release unless approved.
CREATE OR REPLACE FUNCTION public.npd_stage_order(p_stage text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT array_position(ARRAY[
    'requirement_received','technical_review','bom_ready','costing_ready','material_ready',
    'sample_development','testing','sample_dispatch','customer_feedback','approved','production_release'
  ], p_stage);
$$;

-- 6. Create project: mint project_no under an advisory lock (race-safe) + insert.
CREATE OR REPLACE FUNCTION public.npd_create_project(p_payload jsonb)
RETURNS public.npd_project LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_no text; v_row public.npd_project;
  v_email text := COALESCE(NULLIF(current_setting('request.jwt.claims', true)::json->>'email',''), p_payload->>'created_by_email');
BEGIN
  IF COALESCE(trim(p_payload->>'product_name'),'') = '' THEN RAISE EXCEPTION 'Product name is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('npd_project_no'));
  v_no := 'NPD' || lpad((GREATEST(COALESCE(max(
            CASE WHEN project_no ~ '^NPD[0-9]+$' THEN substring(project_no from 4)::bigint END), 0), 1000) + 1)::text, 5, '0')
          FROM public.npd_project;
  INSERT INTO public.npd_project (
    project_no, customer_code, company_name, product_name, customer_part_no, internal_part_no,
    project_type, priority, target_date, npd_engineer_email, salesperson_email, crm_email, created_by_email)
  VALUES (
    v_no, NULLIF(p_payload->>'customer_code',''), NULLIF(p_payload->>'company_name',''),
    trim(p_payload->>'product_name'), NULLIF(p_payload->>'customer_part_no',''), NULLIF(p_payload->>'internal_part_no',''),
    COALESCE(NULLIF(p_payload->>'project_type',''),'sample'), COALESCE(NULLIF(p_payload->>'priority',''),'normal'),
    NULLIF(p_payload->>'target_date','')::date, NULLIF(p_payload->>'npd_engineer_email',''),
    NULLIF(p_payload->>'salesperson_email',''), NULLIF(p_payload->>'crm_email',''), v_email)
  RETURNING * INTO v_row;
  INSERT INTO public.npd_stage_history (project_id, from_stage, to_stage, moved_by_email, note)
  VALUES (v_row.id, NULL, v_row.stage, v_email, 'project created');
  RETURN v_row;
END $$;
GRANT EXECUTE ON FUNCTION public.npd_create_project(jsonb) TO authenticated;

-- 7. Move stage: ordinality + optimistic lock + history. Soft (allow ±, reject forward-skip).
CREATE OR REPLACE FUNCTION public.npd_move_stage(
  p_id uuid, p_to_stage text, p_expected_from text, p_note text DEFAULT NULL, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur text; v_from_ord int; v_to_ord int;
  v_email text := COALESCE(NULLIF(current_setting('request.jwt.claims', true)::json->>'email',''), 'system');
BEGIN
  -- optimistic lock: only move if the row is still where the caller saw it
  SELECT stage INTO v_cur FROM public.npd_project WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'npd_move_stage: project not found'; END IF;
  IF p_expected_from IS NOT NULL AND v_cur <> p_expected_from THEN
    RETURN jsonb_build_object('ok', false, 'conflict', true, 'current', v_cur,
      'message', 'Project already moved by someone else — refresh.');
  END IF;
  v_to_ord := public.npd_stage_order(p_to_stage);
  v_from_ord := public.npd_stage_order(v_cur);
  IF v_to_ord IS NULL THEN RAISE EXCEPTION 'npd_move_stage: unknown stage %', p_to_stage; END IF;
  -- hard gate: production_release requires an approved project
  IF p_to_stage = 'production_release' AND v_cur <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'blocked', true,
      'message', 'Production Release requires the project to be Approved first.');
  END IF;
  -- soft gate: reject forward-skips of >1 stage unless forced (logs reason)
  IF NOT p_force AND v_to_ord > v_from_ord + 1 THEN
    RETURN jsonb_build_object('ok', false, 'blocked', true, 'skips', v_to_ord - v_from_ord,
      'message', format('That skips %s stage(s). Advance one step, or use "skip with reason".', v_to_ord - v_from_ord - 1));
  END IF;
  UPDATE public.npd_project
     SET stage = p_to_stage, stage_entered_at = now(), updated_at = now(),
         status = CASE WHEN p_to_stage = 'approved' THEN 'approved'
                       WHEN p_to_stage = 'production_release' THEN status ELSE status END
   WHERE id = p_id;
  INSERT INTO public.npd_stage_history (project_id, from_stage, to_stage, moved_by_email, note)
  VALUES (p_id, v_cur, p_to_stage, v_email,
          COALESCE(p_note, CASE WHEN p_force AND v_to_ord > v_from_ord + 1 THEN 'skipped with reason' END));
  RETURN jsonb_build_object('ok', true, 'stage', p_to_stage);
END $$;
GRANT EXECUTE ON FUNCTION public.npd_move_stage(uuid, text, text, text, boolean) TO authenticated;

-- 8. RBAC — register the NPD module + grant to CEO and NPD roles (copy of the quality/purchase pattern).
INSERT INTO public.modules (module_key, module_name, route_path)
SELECT 'npd', 'NPD', '/npd'
WHERE NOT EXISTS (SELECT 1 FROM public.modules WHERE module_key = 'npd');

INSERT INTO public.role_module_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, m.id, true,
       (r.role_name IN ('CEO','NPD')), (r.role_name IN ('CEO','NPD')), (r.role_name = 'CEO')
FROM public.roles r
CROSS JOIN public.modules m
WHERE m.module_key = 'npd'
  AND r.role_name IN ('CEO','NPD','Process Coordinator')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_module_permissions rmp
    WHERE rmp.role_id = r.id AND rmp.module_id = m.id);
