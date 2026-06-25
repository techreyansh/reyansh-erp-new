-- RBAC tighten: Process Coordinator "Dolly" (pcripl51@gmail.com) — employee-level revoke.
--
-- WHY: Dolly was over-provisioned with 10 per-employee module grants in
-- public.employee_permissions. The PROCESS_COORDINATOR role itself has ZERO
-- role-level grants (role_module_permissions), so trimming her employee_permissions
-- affects ONLY her — no other Process Coordinator is touched.
--
-- get_my_rbac_access() unions is_super_admin OR employee_permissions OR
-- role_module_permissions, returning modules where can_view = true. Deleting these
-- 5 employee_permissions rows removes them from her effective access.
--
-- DECISION (locked by the user):
--   KEEP   : dashboard, dispatch, purchase, production, tasks
--   REMOVE : crm, inventory, quality, reports, sales
--
-- IDEMPOTENT / ADDITIVE-SAFE: the DELETE is a no-op if the rows are already gone
-- (or if the employee does not exist — the scalar sub-select returns NULL and the
-- DELETE matches nothing). Re-running this migration is harmless.

DO $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.employee_permissions
  WHERE employee_id = (
          SELECT id FROM public.employees
          WHERE lower(email) = 'pcripl51@gmail.com'
        )
    AND module_id IN (
          SELECT id FROM public.modules
          WHERE module_key IN ('crm', 'inventory', 'quality', 'reports', 'sales')
        );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'rbac_tighten_dolly_pc: deleted % employee_permissions row(s) for pcripl51@gmail.com (expected up to 5).', v_deleted;
END $$;

-- Self-check: print her EFFECTIVE modules (employee grants UNION role grants where
-- can_view) so a role-level grant that survives the employee-level delete is visible
-- at apply time. Expected exactly: dashboard, dispatch, production, purchase, tasks.
DO $$
DECLARE
  v_emp uuid;
  v_role uuid;
  v_modules text;
  v_leak text;
BEGIN
  SELECT id, role_id INTO v_emp, v_role FROM public.employees WHERE lower(email) = 'pcripl51@gmail.com';
  IF v_emp IS NULL THEN
    RAISE NOTICE 'rbac_tighten_dolly_pc: employee pcripl51@gmail.com not found — nothing to verify.';
    RETURN;
  END IF;

  SELECT string_agg(m.module_key, ', ' ORDER BY m.module_key) INTO v_modules
  FROM public.modules m
  WHERE EXISTS (SELECT 1 FROM public.employee_permissions ep WHERE ep.employee_id = v_emp AND ep.module_id = m.id AND ep.can_view)
     OR EXISTS (SELECT 1 FROM public.role_module_permissions rmp WHERE rmp.role_id = v_role AND rmp.module_id = m.id AND rmp.can_view);

  RAISE NOTICE 'rbac_tighten_dolly_pc EFFECTIVE modules now: [%]', COALESCE(v_modules, '(none)');

  -- flag any removed module that still resolves (would mean a role-level grant survived)
  SELECT string_agg(m.module_key, ', ' ORDER BY m.module_key) INTO v_leak
  FROM public.modules m
  WHERE m.module_key IN ('crm','inventory','quality','reports','sales')
    AND EXISTS (SELECT 1 FROM public.role_module_permissions rmp WHERE rmp.role_id = v_role AND rmp.module_id = m.id AND rmp.can_view);
  IF v_leak IS NOT NULL THEN
    RAISE WARNING 'rbac_tighten_dolly_pc: these removed modules STILL granted at ROLE level (needs separate role-level decision): [%]', v_leak;
  END IF;
END $$;

-- VERIFY (run in SQL editor; expect exactly: dashboard, dispatch, production, purchase, tasks):
-- SELECT m.module_key FROM public.employee_permissions ep
--   JOIN public.modules m ON m.id = ep.module_id
--  WHERE ep.employee_id = (SELECT id FROM public.employees WHERE lower(email)='pcripl51@gmail.com')
--    AND ep.can_view = true ORDER BY m.module_key;
