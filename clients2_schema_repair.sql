-- =============================================================================
-- clients2 Schema Repair (No Data Loss)
-- Purpose:
--   Make public.clients2 safe for frontend CRUD while preserving existing flat
--   columns like "ClientName", "ClientCode", etc.
--
-- Why:
--   Existing app data fetch works from flat columns, but older helpers expected
--   wrapper columns such as id/record/sort_order. This migration adds a stable
--   id primary key if missing, but does NOT convert or drop existing data.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION public.erp_current_employee_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.email = lower(trim(COALESCE(
      auth.jwt() ->> 'email',
      auth.jwt() -> 'user_metadata' ->> 'email',
      ''
    )))
      AND e.is_active = true
  ), false);
$$;

REVOKE ALL ON FUNCTION public.erp_current_employee_is_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erp_current_employee_is_active() TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.clients2') IS NULL THEN
    RAISE EXCEPTION 'public.clients2 does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clients2'
      AND column_name = 'id'
  ) THEN
    ALTER TABLE public.clients2
      ADD COLUMN id uuid DEFAULT gen_random_uuid();
  END IF;

  UPDATE public.clients2
  SET id = gen_random_uuid()
  WHERE id IS NULL;

  ALTER TABLE public.clients2
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

  ALTER TABLE public.clients2
    ALTER COLUMN id SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.clients2'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.clients2
      ADD CONSTRAINT clients2_pkey PRIMARY KEY (id);
  END IF;

  ALTER TABLE public.clients2 ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  ALTER TABLE public.clients2 ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
END $$;

CREATE INDEX IF NOT EXISTS idx_clients2_client_code
  ON public.clients2 ("ClientCode");

CREATE OR REPLACE FUNCTION public.clients2_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients2_touch_updated_at ON public.clients2;
CREATE TRIGGER trg_clients2_touch_updated_at
BEFORE UPDATE ON public.clients2
FOR EACH ROW
EXECUTE FUNCTION public.clients2_touch_updated_at();

ALTER TABLE public.clients2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients2_authenticated_select ON public.clients2;
CREATE POLICY clients2_authenticated_select
  ON public.clients2 FOR SELECT TO authenticated
  USING (public.erp_current_employee_is_active());

DROP POLICY IF EXISTS clients2_authenticated_insert ON public.clients2;
CREATE POLICY clients2_authenticated_insert
  ON public.clients2 FOR INSERT TO authenticated
  WITH CHECK (public.erp_current_employee_is_active());

DROP POLICY IF EXISTS clients2_authenticated_update ON public.clients2;
CREATE POLICY clients2_authenticated_update
  ON public.clients2 FOR UPDATE TO authenticated
  USING (public.erp_current_employee_is_active())
  WITH CHECK (public.erp_current_employee_is_active());

DROP POLICY IF EXISTS clients2_authenticated_delete ON public.clients2;
CREATE POLICY clients2_authenticated_delete
  ON public.clients2 FOR DELETE TO authenticated
  USING (public.erp_current_employee_is_active());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients2 TO authenticated;

COMMIT;

-- Verification:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'clients2'
-- ORDER BY ordinal_position;
