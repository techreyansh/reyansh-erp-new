-- Production module — RBAC role + mobile capabilities (mirrors store_role_caps).
-- PRODUCTION_OPERATOR role granted the 'production' module + production.* caps so
-- /app shows the Production tile + screens. Also extends the CEO test grant.
-- Idempotent.

DO $$
DECLARE
  v_role uuid;
  v_caps int := 0;
BEGIN
  INSERT INTO public.roles (name, code, role_name, description, is_system_role)
  VALUES ('Production Operator', 'PRODUCTION_OPERATOR', 'Production Operator',
          'Mobile production operator — log output against work-order stages.', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_role;
  IF v_role IS NULL THEN
    SELECT id INTO v_role FROM public.roles WHERE code = 'PRODUCTION_OPERATOR';
  END IF;

  INSERT INTO public.role_module_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
  SELECT v_role, m.id, true, true, true, false
  FROM public.modules m
  WHERE m.module_key = 'production'
  ON CONFLICT (role_id, module_id) DO UPDATE
    SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
        can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete;

  INSERT INTO public.mobile_role_capabilities (role_code, capability)
  SELECT 'PRODUCTION_OPERATOR', cap
  FROM (VALUES ('production.log'), ('production.lookup')) AS c(cap)
  ON CONFLICT (role_code, capability) DO NOTHING;
  GET DIAGNOSTICS v_caps = ROW_COUNT;
  RAISE NOTICE 'production_role_caps: PRODUCTION_OPERATOR ready (% new production.* caps).', v_caps;
END $$;

-- DEV/TEST: let the CEO role see the Production tile too (removable later:
--   DELETE FROM public.mobile_role_capabilities WHERE role_code='CEO' AND capability LIKE 'production.%';)
INSERT INTO public.mobile_role_capabilities (role_code, capability)
SELECT 'CEO', cap
FROM (VALUES ('production.log'), ('production.lookup')) AS c(cap)
ON CONFLICT (role_code, capability) DO NOTHING;
