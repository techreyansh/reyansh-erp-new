-- Co-working on a lead: a lead keeps its primary owner_email but can have
-- multiple COLLABORATORS who work it through stages and see it on their
-- dashboards. Widens crm_pipeline visibility to include collaborators.
BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_pipeline_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  email text NOT NULL,
  added_by_email text,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_collab_unique ON public.crm_pipeline_collaborators(pipeline_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_crm_collab_email ON public.crm_pipeline_collaborators(lower(email));
ALTER TABLE public.crm_pipeline_collaborators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_collab_all ON public.crm_pipeline_collaborators;
CREATE POLICY crm_collab_all ON public.crm_pipeline_collaborators
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- SECURITY DEFINER check (avoids RLS recursion when used inside crm_pipeline policy).
CREATE OR REPLACE FUNCTION public.crm_is_collaborator(p_pipeline_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_pipeline_collaborators
    WHERE pipeline_id = p_pipeline_id AND lower(email) = public.rbac_current_email()
  );
$$;
GRANT EXECUTE ON FUNCTION public.crm_is_collaborator(uuid) TO authenticated;

-- Widen visibility: super-admin OR owner OR unassigned OR collaborator.
DROP POLICY IF EXISTS crm_pipeline_select ON public.crm_pipeline;
CREATE POLICY crm_pipeline_select ON public.crm_pipeline FOR SELECT TO authenticated
  USING (is_super_admin()
      OR lower(COALESCE(owner_email,'')) = rbac_current_email()
      OR owner_email IS NULL
      OR public.crm_is_collaborator(id));

DROP POLICY IF EXISTS crm_pipeline_update ON public.crm_pipeline;
CREATE POLICY crm_pipeline_update ON public.crm_pipeline FOR UPDATE TO authenticated
  USING (is_super_admin()
      OR lower(COALESCE(owner_email,'')) = rbac_current_email()
      OR owner_email IS NULL
      OR public.crm_is_collaborator(id))
  WITH CHECK (is_super_admin()
      OR lower(COALESCE(owner_email,'')) = rbac_current_email()
      OR owner_email IS NULL
      OR public.crm_is_collaborator(id));

COMMIT;
