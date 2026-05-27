-- =============================================================================
-- ERP RBAC Regression Repair
-- Purpose:
--   Restore pre-RBAC CRUD behavior for existing ERP operational tables while
--   keeping RBAC as a page/module access layer.
--
-- Safe model:
--   - Login/email authorization still comes from public.employees.
--   - Page visibility still comes from public.employee_permissions.
--   - Existing ERP data tables get authenticated CRUD compatibility policies
--     for active employees so old module queries keep working.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Helper: authenticated ERP users only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erp_current_employee_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.rbac_current_employee_id() IS NOT NULL, false);
$$;

REVOKE ALL ON FUNCTION public.erp_current_employee_is_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erp_current_employee_is_active() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Ensure task table foreign keys exist. These are idempotent and only added
-- when missing.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.tasks') IS NOT NULL AND to_regclass('public.employees') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'tasks_assigned_to_employees_fkey'
        AND conrelid = 'public.tasks'::regclass
    ) THEN
      ALTER TABLE public.tasks
        ADD CONSTRAINT tasks_assigned_to_employees_fkey
        FOREIGN KEY (assigned_to)
        REFERENCES public.employees(id)
        ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'tasks_assigned_by_employees_fkey'
        AND conrelid = 'public.tasks'::regclass
    ) THEN
      ALTER TABLE public.tasks
        ADD CONSTRAINT tasks_assigned_by_employees_fkey
        FOREIGN KEY (assigned_by)
        REFERENCES public.employees(id)
        ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Keep RBAC tables permission-based, but make sure active users can read their
-- own employee row and module/permission metadata needed by the app.
-- -----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.employee_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "erp_active_users_read_roles" ON public.roles;
CREATE POLICY "erp_active_users_read_roles"
  ON public.roles FOR SELECT TO authenticated
  USING (public.erp_current_employee_is_active());

DROP POLICY IF EXISTS "erp_active_users_read_modules" ON public.modules;
CREATE POLICY "erp_active_users_read_modules"
  ON public.modules FOR SELECT TO authenticated
  USING (public.erp_current_employee_is_active());

DROP POLICY IF EXISTS "erp_active_users_read_employee_permissions" ON public.employee_permissions;
CREATE POLICY "erp_active_users_read_employee_permissions"
  ON public.employee_permissions FOR SELECT TO authenticated
  USING (public.erp_current_employee_is_active());

DROP POLICY IF EXISTS "erp_active_users_read_employees" ON public.employees;
CREATE POLICY "erp_active_users_read_employees"
  ON public.employees FOR SELECT TO authenticated
  USING (public.erp_current_employee_is_active());

DROP POLICY IF EXISTS "erp_manage_employees_by_permission" ON public.employees;
CREATE POLICY "erp_manage_employees_by_permission"
  ON public.employees FOR ALL TO authenticated
  USING (public.rbac_employee_can('employees', 'edit'))
  WITH CHECK (public.rbac_employee_can('employees', 'edit'));

DROP POLICY IF EXISTS "erp_manage_employee_permissions_by_permission" ON public.employee_permissions;
CREATE POLICY "erp_manage_employee_permissions_by_permission"
  ON public.employee_permissions FOR ALL TO authenticated
  USING (public.rbac_employee_can('employees', 'edit'))
  WITH CHECK (public.rbac_employee_can('employees', 'edit'));

DROP POLICY IF EXISTS "erp_tasks_select_compat" ON public.tasks;
CREATE POLICY "erp_tasks_select_compat"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    public.rbac_employee_can('tasks', 'view')
    OR assigned_to = public.rbac_current_employee_id()
    OR assigned_by = public.rbac_current_employee_id()
  );

DROP POLICY IF EXISTS "erp_tasks_insert_compat" ON public.tasks;
CREATE POLICY "erp_tasks_insert_compat"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    public.rbac_employee_can('tasks', 'create')
    AND assigned_by = public.rbac_current_employee_id()
  );

DROP POLICY IF EXISTS "erp_tasks_update_compat" ON public.tasks;
CREATE POLICY "erp_tasks_update_compat"
  ON public.tasks FOR UPDATE TO authenticated
  USING (
    public.rbac_employee_can('tasks', 'edit')
    OR assigned_to = public.rbac_current_employee_id()
  )
  WITH CHECK (
    public.rbac_employee_can('tasks', 'edit')
    OR assigned_to = public.rbac_current_employee_id()
  );

DROP POLICY IF EXISTS "erp_tasks_delete_compat" ON public.tasks;
CREATE POLICY "erp_tasks_delete_compat"
  ON public.tasks FOR DELETE TO authenticated
  USING (public.rbac_employee_can('tasks', 'delete'));

-- -----------------------------------------------------------------------------
-- Restore CRUD compatibility for existing ERP operational tables.
-- This intentionally excludes RBAC control tables, because those stay governed
-- by the permission-specific policies above.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  q_table text;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND c.relname NOT IN (
        'roles',
        'employees',
        'modules',
        'employee_permissions',
        'role_module_permissions',
        'rbac_bootstrap_config',
        'tasks'
      )
  LOOP
    q_table := format('%I.%I', r.schema_name, r.table_name);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO authenticated', q_table);

    EXECUTE format('DROP POLICY IF EXISTS erp_authenticated_select_compat ON %s', q_table);
    EXECUTE format(
      'CREATE POLICY erp_authenticated_select_compat ON %s FOR SELECT TO authenticated USING (public.erp_current_employee_is_active())',
      q_table
    );

    EXECUTE format('DROP POLICY IF EXISTS erp_authenticated_insert_compat ON %s', q_table);
    EXECUTE format(
      'CREATE POLICY erp_authenticated_insert_compat ON %s FOR INSERT TO authenticated WITH CHECK (public.erp_current_employee_is_active())',
      q_table
    );

    EXECUTE format('DROP POLICY IF EXISTS erp_authenticated_update_compat ON %s', q_table);
    EXECUTE format(
      'CREATE POLICY erp_authenticated_update_compat ON %s FOR UPDATE TO authenticated USING (public.erp_current_employee_is_active()) WITH CHECK (public.erp_current_employee_is_active())',
      q_table
    );

    EXECUTE format('DROP POLICY IF EXISTS erp_authenticated_delete_compat ON %s', q_table);
    EXECUTE format(
      'CREATE POLICY erp_authenticated_delete_compat ON %s FOR DELETE TO authenticated USING (public.erp_current_employee_is_active())',
      q_table
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Sequence grants for inserts on serial-backed legacy tables.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT sequence_schema, sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
  LOOP
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE %I.%I TO authenticated',
      r.sequence_schema,
      r.sequence_name
    );
  END LOOP;
END $$;

COMMIT;

-- Verification helpers:
-- SELECT public.erp_current_employee_is_active();
-- SELECT public.get_my_rbac_access();
