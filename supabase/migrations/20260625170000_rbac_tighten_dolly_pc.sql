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

-- VERIFY (run in SQL editor; expect exactly: dashboard, dispatch, production, purchase, tasks):
-- SELECT m.module_key FROM public.employee_permissions ep
--   JOIN public.modules m ON m.id = ep.module_id
--  WHERE ep.employee_id = (SELECT id FROM public.employees WHERE lower(email)='pcripl51@gmail.com')
--    AND ep.can_view = true ORDER BY m.module_key;
