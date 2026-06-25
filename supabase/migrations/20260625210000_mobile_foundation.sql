-- =====================================================================
-- Factory Ops App — Platform Foundation (mobile)
-- Additive. Backs the mobile capability layer + the throwaway _demo stub.
--   1) mobile_role_capabilities : role_code -> capability grants
--   2) get_my_capabilities()    : caps for the caller's role (jsonb array)
--   3) mobile_ping_log + mobile_ping(): idempotent stub RPC proving replay-safety
-- Mirrors the style of the RBAC / MES migrations (SECURITY DEFINER, search_path,
-- GRANT authenticated, idempotent guards). Seeds NOTHING.
-- DO NOT auto-apply: apply via Supabase CLI / SQL editor when the mobile app ships.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Capability grants per role.
--    role_code matches roles.code (e.g. 'CEO', 'STORE_MANAGER', ...).
--    capability is a free-form mobile capability key (e.g. 'demo.submit',
--    'store.receive', 'quality.hold'). UNIQUE so re-granting is a no-op.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mobile_role_capabilities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code   text NOT NULL,
  capability  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_code, capability)
);
ALTER TABLE public.mobile_role_capabilities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY mobile_role_capabilities_read ON public.mobile_role_capabilities
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON public.mobile_role_capabilities TO authenticated;

-- ---------------------------------------------------------------------
-- 2) get_my_capabilities() — caps for the calling user's role.
--    Resolves auth.uid()/email -> employees.role_id -> roles.code ->
--    mobile_role_capabilities. Returns a jsonb array of capability strings.
--    SECURITY DEFINER so it can read across the RBAC tables under RLS.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_capabilities()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email     text;
  v_role_code text;
  v_caps      jsonb;
BEGIN
  -- Identify the caller using the SAME helper get_my_rbac_access + all RLS use,
  -- so capability resolution is identical to module resolution.
  v_email := public.rbac_current_email();
  IF v_email IS NULL OR v_email = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  -- employees.role_id -> roles.code
  SELECT r.code
    INTO v_role_code
    FROM public.employees e
    JOIN public.roles r ON r.id = e.role_id
   WHERE lower(e.email) = v_email
   LIMIT 1;

  IF v_role_code IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(DISTINCT mrc.capability), '[]'::jsonb)
    INTO v_caps
    FROM public.mobile_role_capabilities mrc
   WHERE mrc.role_code = v_role_code;

  RETURN coalesce(v_caps, '[]'::jsonb);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_my_capabilities() TO authenticated;

-- ---------------------------------------------------------------------
-- 3) Stub: mobile_ping_log + mobile_ping() — proves idempotent offline replay.
--    idempotency_key is UNIQUE; the RPC INSERTs ON CONFLICT DO NOTHING and
--    reports whether the row already existed (deduped:true). A replayed intent
--    therefore never double-posts. THROWAWAY — drop with the _demo module.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mobile_ping_log (
  idempotency_key text PRIMARY KEY,
  posted_by       text,
  ping_value      numeric,
  posted_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mobile_ping_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY mobile_ping_log_read ON public.mobile_ping_log
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON public.mobile_ping_log TO authenticated;

CREATE OR REPLACE FUNCTION public.mobile_ping(
  p_idempotency_key text,
  p_value           numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email     text;
  v_row_count integer := 0;
BEGIN
  v_email := coalesce(public.rbac_current_email(), auth.jwt() ->> 'email', 'unknown');

  INSERT INTO public.mobile_ping_log (idempotency_key, posted_by, ping_value)
  VALUES (p_idempotency_key, v_email, p_value)
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  -- v_row_count = 0 means the key already existed → this was a replay (deduped).
  RETURN jsonb_build_object('ok', true, 'deduped', v_row_count = 0);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.mobile_ping(text, numeric) TO authenticated;

-- =====================================================================
-- Rollback (run manually if reverting the foundation):
--   DROP FUNCTION IF EXISTS public.mobile_ping(text, numeric);
--   DROP TABLE    IF EXISTS public.mobile_ping_log;
--   DROP FUNCTION IF EXISTS public.get_my_capabilities();
--   DROP TABLE    IF EXISTS public.mobile_role_capabilities;
-- =====================================================================
