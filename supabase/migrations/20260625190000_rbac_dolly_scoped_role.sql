-- Tighten Dolly (pcripl51@gmail.com) the ONLY way the additive RBAC model allows:
-- a dedicated narrow role. get_my_rbac_access() unions is_super_admin OR
-- employee_permissions OR role_module_permissions, so you cannot subtract access
-- per-employee. The prior employee-level delete (20260625170000) was therefore a
-- no-op against her effective access — PROCESS_COORDINATOR grants the modules at the
-- ROLE level.
--
-- FIX: create 'Process Coordinator (Scoped)' with exactly the 5 approved modules and
-- repoint her employees.role_id to it. PROCESS_COORDINATOR is left UNTOUCHED — zero
-- blast radius on any other coordinator (Dolly-specific, per the user's intent).
--
-- KEEP: dashboard, dispatch, production, purchase, tasks.
-- Idempotent: ON CONFLICT upserts; re-running is harmless.

DO $$
DECLARE
  v_role uuid;
  v_emp  uuid;
  v_modules text;
BEGIN
  -- 1) create (or reuse) the scoped role
  INSERT INTO public.roles (name, code, role_name, description, is_system_role)
  VALUES ('Process Coordinator (Scoped)', 'PROCESS_COORDINATOR_SCOPED',
          'Process Coordinator (Scoped)',
          'Process coordinator limited to dashboard, dispatch, production, purchase, tasks.', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_role;
  IF v_role IS NULL THEN
    SELECT id INTO v_role FROM public.roles WHERE code = 'PROCESS_COORDINATOR_SCOPED';
  END IF;

  -- 2) grant exactly the 5 modules: view everywhere; create+edit on the operational
  --    ones (dispatch/production/purchase/tasks); dashboard view-only; never delete.
  INSERT INTO public.role_module_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
  SELECT v_role, m.id,
         true,
         (m.module_key <> 'dashboard'),
         (m.module_key <> 'dashboard'),
         false
  FROM public.modules m
  WHERE m.module_key IN ('dashboard','dispatch','production','purchase','tasks')
  ON CONFLICT (role_id, module_id) DO UPDATE
    SET can_view   = EXCLUDED.can_view,
        can_create = EXCLUDED.can_create,
        can_edit   = EXCLUDED.can_edit,
        can_delete = EXCLUDED.can_delete;

  -- 3) repoint Dolly (employees.role_id is the column get_my_rbac_access reads)
  UPDATE public.employees SET role_id = v_role, updated_at = now()
   WHERE lower(email) = 'pcripl51@gmail.com';
  SELECT id INTO v_emp FROM public.employees WHERE lower(email) = 'pcripl51@gmail.com';

  -- 4) self-check at apply time: her effective modules (employee UNION role grants)
  IF v_emp IS NULL THEN
    RAISE NOTICE 'dolly_scoped_role: employee pcripl51@gmail.com not found — no repoint done.';
  ELSE
    SELECT string_agg(m.module_key, ', ' ORDER BY m.module_key) INTO v_modules
    FROM public.modules m
    WHERE EXISTS (SELECT 1 FROM public.employee_permissions ep
                   WHERE ep.employee_id = v_emp AND ep.module_id = m.id AND ep.can_view)
       OR EXISTS (SELECT 1 FROM public.role_module_permissions rmp
                   WHERE rmp.role_id = v_role AND rmp.module_id = m.id AND rmp.can_view);
    RAISE NOTICE 'dolly_scoped_role: EFFECTIVE modules now [%] (expected: dashboard, dispatch, production, purchase, tasks)', COALESCE(v_modules, '(none)');
  END IF;
END $$;
