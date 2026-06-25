-- Store module — RBAC role + mobile capabilities.
-- Creates a STORE_KEEPER role granted the 'inventory' module (so /app shows the
-- Store tile via get_my_rbac_access) and seeds the 6 store.* mobile capabilities
-- (so the screens show via get_my_capabilities). PROCESS_COORDINATOR and other
-- roles are untouched. Admin assigns employees to STORE_KEEPER (employees.role_id).
-- Mirrors 20260625190000_rbac_dolly_scoped_role.sql. Idempotent.

DO $$
DECLARE
  v_role uuid;
  v_caps int := 0;
BEGIN
  -- 1) role
  INSERT INTO public.roles (name, code, role_name, description, is_system_role)
  VALUES ('Store Keeper', 'STORE_KEEPER', 'Store Keeper',
          'Mobile store keeper — inventory capture (issue/receipt/adjust/transfer/scan/lookup).', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_role;
  IF v_role IS NULL THEN
    SELECT id INTO v_role FROM public.roles WHERE code = 'STORE_KEEPER';
  END IF;

  -- 2) grant the inventory module (view + create + edit, no delete)
  INSERT INTO public.role_module_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
  SELECT v_role, m.id, true, true, true, false
  FROM public.modules m
  WHERE m.module_key = 'inventory'
  ON CONFLICT (role_id, module_id) DO UPDATE
    SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
        can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete;

  -- 3) seed the 6 store.* mobile capabilities
  INSERT INTO public.mobile_role_capabilities (role_code, capability)
  SELECT 'STORE_KEEPER', cap
  FROM (VALUES ('store.issue'),('store.receipt'),('store.adjust'),
               ('store.transfer'),('store.scan'),('store.lookup')) AS c(cap)
  ON CONFLICT (role_code, capability) DO NOTHING;
  GET DIAGNOSTICS v_caps = ROW_COUNT;

  RAISE NOTICE 'store_role_caps: STORE_KEEPER ready (inventory module granted, % new store.* caps).', v_caps;
END $$;

-- Rollback (manual):
--   DELETE FROM public.mobile_role_capabilities WHERE role_code = 'STORE_KEEPER';
--   DELETE FROM public.role_module_permissions
--     WHERE role_id = (SELECT id FROM public.roles WHERE code='STORE_KEEPER');
--   DELETE FROM public.roles WHERE code = 'STORE_KEEPER';  -- only if no employees still point at it
