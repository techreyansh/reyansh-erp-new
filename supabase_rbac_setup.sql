-- =============================================================================
-- Reyansh ERP RBAC + Task Allocation Setup
-- Run in Supabase SQL Editor after replacing the bootstrap CEO email below.
-- This file is idempotent and additive: it does not drop existing ERP tables.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- Bootstrap: replace this email before production execution.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rbac_bootstrap_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.rbac_bootstrap_config (key, value)
VALUES ('ceo_email', 'REPLACE_WITH_CEO_EMAIL@example.com')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_normalize_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := lower(trim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rbac_current_email()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(trim(COALESCE(
    auth.jwt() ->> 'email',
    auth.jwt() -> 'user_metadata' ->> 'email',
    ''
  )));
$$;

REVOKE ALL ON FUNCTION public.rbac_current_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rbac_current_email() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Roles: preserve existing role schema and add requested columns if missing.
-- Existing deployments use public.roles(name, code); this file adds role_name.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  code text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS role_name text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS is_system_role boolean NOT NULL DEFAULT false;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.roles
SET
  role_name = COALESCE(role_name, name, code),
  name = COALESCE(name, role_name, code),
  code = COALESCE(code, upper(regexp_replace(COALESCE(role_name, name), '[^a-zA-Z0-9]+', '_', 'g')))
WHERE role_name IS NULL OR name IS NULL OR code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_role_name_lower ON public.roles (lower(trim(role_name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_code_unique ON public.roles (code);

DROP TRIGGER IF EXISTS trg_roles_touch_updated_at ON public.roles;
CREATE TRIGGER trg_roles_touch_updated_at
BEFORE UPDATE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.rbac_touch_updated_at();

INSERT INTO public.roles (role_name, name, code, description, is_system_role)
VALUES
  ('CEO', 'CEO', 'CEO', 'Full ERP ownership and unrestricted access.', true),
  ('Admin', 'Admin', 'ADMIN', 'Administrative access for employees and tasks.', true),
  ('Sales', 'Sales', 'SALES', 'Sales workflow, CRM, leads, orders, and tasks.', true),
  ('CRM', 'CRM', 'CRM', 'Customer relationship management and lead operations.', true),
  ('Production', 'Production', 'PRODUCTION', 'Production planning and execution.', true),
  ('Inventory', 'Inventory', 'INVENTORY', 'Inventory and stock operations.', true),
  ('Accounts', 'Accounts', 'ACCOUNTS', 'Accounts and finance operations.', true),
  ('HR', 'HR', 'HR', 'Employee and HR operations.', true),
  ('Dispatch', 'Dispatch', 'DISPATCH', 'Dispatch and logistics operations.', true),
  ('Manager', 'Manager', 'MANAGER', 'Department manager access.', true)
ON CONFLICT (code) DO UPDATE SET
  role_name = COALESCE(public.roles.role_name, EXCLUDED.role_name),
  name = COALESCE(public.roles.name, EXCLUDED.name),
  description = COALESCE(public.roles.description, EXCLUDED.description),
  is_system_role = public.roles.is_system_role OR EXCLUDED.is_system_role;

-- -----------------------------------------------------------------------------
-- Employees
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  full_name text,
  phone text,
  department text,
  role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_email_lower ON public.employees (lower(trim(email)));
CREATE INDEX IF NOT EXISTS idx_employees_role_id ON public.employees (role_id);
CREATE INDEX IF NOT EXISTS idx_employees_department ON public.employees (department);
CREATE INDEX IF NOT EXISTS idx_employees_active ON public.employees (is_active);

DROP TRIGGER IF EXISTS trg_employees_normalize_email ON public.employees;
CREATE TRIGGER trg_employees_normalize_email
BEFORE INSERT OR UPDATE OF email ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.rbac_normalize_email();

DROP TRIGGER IF EXISTS trg_employees_touch_updated_at ON public.employees;
CREATE TRIGGER trg_employees_touch_updated_at
BEFORE UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.rbac_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Modules
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text UNIQUE NOT NULL,
  module_name text NOT NULL,
  route_path text,
  icon text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modules_module_key ON public.modules (module_key);

INSERT INTO public.modules (module_key, module_name, route_path, icon)
VALUES
  ('dashboard', 'Dashboard', '/home', 'dashboard'),
  ('crm', 'CRM', '/crm/leads', 'crm'),
  ('sales', 'Sales', '/sales-flow', 'sales'),
  ('production', 'Production', '/ppc/production-plan', 'production'),
  ('inventory', 'Inventory', '/inventory', 'inventory'),
  ('dispatch', 'Dispatch', '/dispatch', 'dispatch'),
  ('accounts', 'Accounts', '/costing', 'accounts'),
  ('employees', 'Employees', '/employee-dashboard', 'employees'),
  ('tasks', 'Tasks', '/tasks', 'tasks'),
  ('reports', 'Reports', '/ppc/reports', 'reports'),
  ('settings', 'Settings', '/settings', 'settings')
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon;

-- -----------------------------------------------------------------------------
-- Role permissions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_module_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  can_view boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  UNIQUE (role_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_role_module_permissions_role ON public.role_module_permissions (role_id);
CREATE INDEX IF NOT EXISTS idx_role_module_permissions_module ON public.role_module_permissions (module_id);

-- -----------------------------------------------------------------------------
-- Employee permission overrides
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  can_view boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  UNIQUE (employee_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_permissions_employee ON public.employee_permissions (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_permissions_module ON public.employee_permissions (module_id);

-- -----------------------------------------------------------------------------
-- Simple RBAC tasks
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  assigned_to uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  assigned_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date date,
  task_status text NOT NULL DEFAULT 'pending' CHECK (task_status IN ('pending', 'in_progress', 'completed', 'blocked')),
  department text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON public.tasks (assigned_by);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks (task_status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks (due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_department ON public.tasks (department);

DROP TRIGGER IF EXISTS trg_tasks_touch_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_touch_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.rbac_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Seed initial CEO employee from bootstrap config.
-- -----------------------------------------------------------------------------
INSERT INTO public.employees (email, full_name, department, role_id, is_active)
SELECT
  lower(trim(cfg.value)),
  'CEO',
  'Executive',
  r.id,
  true
FROM public.rbac_bootstrap_config cfg
JOIN public.roles r ON r.code = 'CEO'
WHERE cfg.key = 'ceo_email'
  AND cfg.value <> 'REPLACE_WITH_CEO_EMAIL@example.com'
ON CONFLICT (email) DO UPDATE SET
  role_id = EXCLUDED.role_id,
  is_active = true;

-- -----------------------------------------------------------------------------
-- Permission seed helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_seed_role_permissions(
  p_role_code text,
  p_module_keys text[],
  p_can_create boolean DEFAULT false,
  p_can_edit boolean DEFAULT false,
  p_can_delete boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM public.roles WHERE code = p_role_code LIMIT 1;
  IF v_role_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.role_module_permissions (
    role_id, module_id, can_view, can_create, can_edit, can_delete
  )
  SELECT
    v_role_id,
    m.id,
    true,
    p_can_create,
    p_can_edit,
    p_can_delete
  FROM public.modules m
  WHERE m.module_key = ANY (p_module_keys)
  ON CONFLICT (role_id, module_id) DO UPDATE SET
    can_view = EXCLUDED.can_view,
    can_create = EXCLUDED.can_create,
    can_edit = EXCLUDED.can_edit,
    can_delete = EXCLUDED.can_delete;
END;
$$;

SELECT public.rbac_seed_role_permissions('CEO', ARRAY['dashboard','crm','sales','production','inventory','dispatch','accounts','employees','tasks','reports','settings'], true, true, true);
SELECT public.rbac_seed_role_permissions('ADMIN', ARRAY['dashboard','employees','tasks','reports','settings'], true, true, false);
SELECT public.rbac_seed_role_permissions('SALES', ARRAY['dashboard','sales','crm','tasks'], true, true, false);
SELECT public.rbac_seed_role_permissions('CRM', ARRAY['dashboard','crm','sales','tasks'], true, true, false);
SELECT public.rbac_seed_role_permissions('PRODUCTION', ARRAY['dashboard','production','inventory','dispatch','tasks'], true, true, false);
SELECT public.rbac_seed_role_permissions('INVENTORY', ARRAY['dashboard','inventory','dispatch','tasks'], true, true, false);
SELECT public.rbac_seed_role_permissions('ACCOUNTS', ARRAY['dashboard','accounts','reports','tasks'], true, true, false);
SELECT public.rbac_seed_role_permissions('HR', ARRAY['dashboard','employees','tasks','reports'], true, true, false);
SELECT public.rbac_seed_role_permissions('DISPATCH', ARRAY['dashboard','dispatch','inventory','tasks'], true, true, false);
SELECT public.rbac_seed_role_permissions('MANAGER', ARRAY['dashboard','crm','sales','production','inventory','dispatch','tasks','reports'], true, true, false);

-- -----------------------------------------------------------------------------
-- Access helper functions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM public.employees e
  WHERE e.email = public.rbac_current_email()
    AND e.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.rbac_current_employee_role_code()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT upper(COALESCE(r.code, r.role_name, r.name))
  FROM public.employees e
  JOIN public.roles r ON r.id = e.role_id
  WHERE e.email = public.rbac_current_email()
    AND e.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.rbac_current_employee_is_ceo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.rbac_current_employee_role_code() IN ('CEO', 'SUPER_ADMIN'), false);
$$;

CREATE OR REPLACE FUNCTION public.rbac_current_employee_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.rbac_current_employee_role_code() IN ('CEO', 'SUPER_ADMIN', 'ADMIN'), false);
$$;

CREATE OR REPLACE FUNCTION public.rbac_employee_can(p_module_key text, p_action text DEFAULT 'view')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT e.id AS employee_id, e.role_id
    FROM public.employees e
    WHERE e.email = public.rbac_current_email()
      AND e.is_active = true
    LIMIT 1
  ),
  resolved AS (
    SELECT
      m.module_key,
      COALESCE(ep.can_view, rmp.can_view, false) AS can_view,
      COALESCE(ep.can_create, rmp.can_create, false) AS can_create,
      COALESCE(ep.can_edit, rmp.can_edit, false) AS can_edit,
      COALESCE(ep.can_delete, rmp.can_delete, false) AS can_delete
    FROM me
    JOIN public.modules m ON m.module_key = p_module_key
    LEFT JOIN public.role_module_permissions rmp
      ON rmp.role_id = me.role_id AND rmp.module_id = m.id
    LEFT JOIN public.employee_permissions ep
      ON ep.employee_id = me.employee_id AND ep.module_id = m.id
  )
  SELECT CASE lower(COALESCE(p_action, 'view'))
    WHEN 'view' THEN COALESCE((SELECT can_view FROM resolved), false)
    WHEN 'create' THEN COALESCE((SELECT can_create FROM resolved), false)
    WHEN 'edit' THEN COALESCE((SELECT can_edit FROM resolved), false)
    WHEN 'delete' THEN COALESCE((SELECT can_delete FROM resolved), false)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_rbac_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT
      e.id,
      e.email,
      e.full_name,
      e.phone,
      e.department,
      e.role_id,
      e.is_active,
      r.role_name,
      r.name,
      r.code
    FROM public.employees e
    LEFT JOIN public.roles r ON r.id = e.role_id
    WHERE e.email = public.rbac_current_email()
    LIMIT 1
  ),
  module_access AS (
    SELECT
      m.id,
      m.module_key,
      m.module_name,
      m.route_path,
      m.icon,
      COALESCE(ep.can_view, rmp.can_view, false) AS can_view,
      COALESCE(ep.can_create, rmp.can_create, false) AS can_create,
      COALESCE(ep.can_edit, rmp.can_edit, false) AS can_edit,
      COALESCE(ep.can_delete, rmp.can_delete, false) AS can_delete
    FROM me
    CROSS JOIN public.modules m
    LEFT JOIN public.role_module_permissions rmp
      ON rmp.role_id = me.role_id AND rmp.module_id = m.id
    LEFT JOIN public.employee_permissions ep
      ON ep.employee_id = me.id AND ep.module_id = m.id
  )
  SELECT jsonb_build_object(
    'authorized', EXISTS (SELECT 1 FROM me WHERE is_active = true),
    'reason', CASE
      WHEN NOT EXISTS (SELECT 1 FROM me) THEN 'not_found'
      WHEN EXISTS (SELECT 1 FROM me WHERE is_active = false) THEN 'inactive'
      ELSE null
    END,
    'employee', COALESCE((
      SELECT to_jsonb(me) - 'role_id'
      FROM me
      WHERE is_active = true
    ), 'null'::jsonb),
    'role', COALESCE((
      SELECT jsonb_build_object(
        'id', role_id,
        'role_name', COALESCE(role_name, name, code),
        'name', COALESCE(name, role_name, code),
        'code', code
      )
      FROM me
      WHERE is_active = true
    ), 'null'::jsonb),
    'modules', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'module_key', module_key,
          'module_name', module_name,
          'route_path', route_path,
          'icon', icon,
          'can_view', can_view,
          'can_create', can_create,
          'can_edit', can_edit,
          'can_delete', can_delete
        )
        ORDER BY module_key
      )
      FROM module_access
      WHERE can_view = true
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.rbac_current_employee_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rbac_current_employee_role_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rbac_current_employee_is_ceo() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rbac_current_employee_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rbac_employee_can(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_rbac_access() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rbac_current_employee_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rbac_current_employee_role_code() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rbac_current_employee_is_ceo() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rbac_current_employee_is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rbac_employee_can(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_rbac_access() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_module_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rbac_roles_select_authenticated" ON public.roles;
CREATE POLICY "rbac_roles_select_authenticated"
  ON public.roles FOR SELECT TO authenticated
  USING (public.rbac_current_employee_id() IS NOT NULL);

DROP POLICY IF EXISTS "rbac_roles_ceo_manage" ON public.roles;
CREATE POLICY "rbac_roles_ceo_manage"
  ON public.roles FOR ALL TO authenticated
  USING (public.rbac_current_employee_is_ceo())
  WITH CHECK (public.rbac_current_employee_is_ceo());

DROP POLICY IF EXISTS "rbac_employees_select_self_or_admin" ON public.employees;
CREATE POLICY "rbac_employees_select_self_or_admin"
  ON public.employees FOR SELECT TO authenticated
  USING (
    email = public.rbac_current_email()
    OR public.rbac_current_employee_is_admin()
  );

DROP POLICY IF EXISTS "rbac_employees_admin_insert" ON public.employees;
CREATE POLICY "rbac_employees_admin_insert"
  ON public.employees FOR INSERT TO authenticated
  WITH CHECK (
    public.rbac_current_employee_is_admin()
    AND (
      public.rbac_current_employee_is_ceo()
      OR role_id IS NULL
      OR role_id NOT IN (SELECT id FROM public.roles WHERE code IN ('CEO', 'SUPER_ADMIN'))
    )
  );

DROP POLICY IF EXISTS "rbac_employees_admin_update" ON public.employees;
CREATE POLICY "rbac_employees_admin_update"
  ON public.employees FOR UPDATE TO authenticated
  USING (public.rbac_current_employee_is_admin())
  WITH CHECK (
    public.rbac_current_employee_is_admin()
    AND (
      public.rbac_current_employee_is_ceo()
      OR role_id IS NULL
      OR role_id NOT IN (SELECT id FROM public.roles WHERE code IN ('CEO', 'SUPER_ADMIN'))
    )
  );

DROP POLICY IF EXISTS "rbac_modules_select_allowed" ON public.modules;
CREATE POLICY "rbac_modules_select_allowed"
  ON public.modules FOR SELECT TO authenticated
  USING (
    public.rbac_current_employee_is_admin()
    OR public.rbac_employee_can(module_key, 'view')
  );

DROP POLICY IF EXISTS "rbac_modules_ceo_manage" ON public.modules;
CREATE POLICY "rbac_modules_ceo_manage"
  ON public.modules FOR ALL TO authenticated
  USING (public.rbac_current_employee_is_ceo())
  WITH CHECK (public.rbac_current_employee_is_ceo());

DROP POLICY IF EXISTS "rbac_role_permissions_select" ON public.role_module_permissions;
CREATE POLICY "rbac_role_permissions_select"
  ON public.role_module_permissions FOR SELECT TO authenticated
  USING (public.rbac_current_employee_id() IS NOT NULL);

DROP POLICY IF EXISTS "rbac_role_permissions_ceo_manage" ON public.role_module_permissions;
CREATE POLICY "rbac_role_permissions_ceo_manage"
  ON public.role_module_permissions FOR ALL TO authenticated
  USING (public.rbac_current_employee_is_ceo())
  WITH CHECK (public.rbac_current_employee_is_ceo());

DROP POLICY IF EXISTS "rbac_employee_permissions_select" ON public.employee_permissions;
CREATE POLICY "rbac_employee_permissions_select"
  ON public.employee_permissions FOR SELECT TO authenticated
  USING (
    public.rbac_current_employee_is_admin()
    OR employee_id = public.rbac_current_employee_id()
  );

DROP POLICY IF EXISTS "rbac_employee_permissions_ceo_manage" ON public.employee_permissions;
CREATE POLICY "rbac_employee_permissions_ceo_manage"
  ON public.employee_permissions FOR ALL TO authenticated
  USING (public.rbac_current_employee_is_ceo())
  WITH CHECK (public.rbac_current_employee_is_ceo());

DROP POLICY IF EXISTS "rbac_tasks_select_own_or_admin" ON public.tasks;
CREATE POLICY "rbac_tasks_select_own_or_admin"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    assigned_to = public.rbac_current_employee_id()
    OR assigned_by = public.rbac_current_employee_id()
    OR public.rbac_current_employee_is_admin()
  );

DROP POLICY IF EXISTS "rbac_tasks_admin_insert" ON public.tasks;
CREATE POLICY "rbac_tasks_admin_insert"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    public.rbac_current_employee_is_admin()
    AND assigned_by = public.rbac_current_employee_id()
  );

DROP POLICY IF EXISTS "rbac_tasks_admin_update" ON public.tasks;
CREATE POLICY "rbac_tasks_admin_update"
  ON public.tasks FOR UPDATE TO authenticated
  USING (public.rbac_current_employee_is_admin())
  WITH CHECK (public.rbac_current_employee_is_admin());

DROP POLICY IF EXISTS "rbac_tasks_employee_status_update" ON public.tasks;
CREATE POLICY "rbac_tasks_employee_status_update"
  ON public.tasks FOR UPDATE TO authenticated
  USING (assigned_to = public.rbac_current_employee_id())
  WITH CHECK (assigned_to = public.rbac_current_employee_id());

DROP POLICY IF EXISTS "rbac_tasks_admin_delete" ON public.tasks;
CREATE POLICY "rbac_tasks_admin_delete"
  ON public.tasks FOR DELETE TO authenticated
  USING (public.rbac_current_employee_is_admin());

-- Keep anonymous users out explicitly.
REVOKE ALL ON public.roles FROM anon;
REVOKE ALL ON public.employees FROM anon;
REVOKE ALL ON public.modules FROM anon;
REVOKE ALL ON public.role_module_permissions FROM anon;
REVOKE ALL ON public.employee_permissions FROM anon;
REVOKE ALL ON public.tasks FROM anon;

GRANT SELECT ON public.roles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.employees TO authenticated;
GRANT SELECT ON public.modules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_module_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;

COMMIT;

-- =============================================================================
-- Rollback notes:
-- 1. Disable frontend RBAC usage before rollback.
-- 2. Drop only new tables/functions if required:
--    DROP TABLE public.tasks, public.employee_permissions, public.role_module_permissions,
--      public.modules, public.employees, public.rbac_bootstrap_config CASCADE;
--    DROP FUNCTION public.get_my_rbac_access(), public.rbac_employee_can(text,text), ...;
-- Existing ERP users/roles/allowed_admins/task-compliance tables are intentionally preserved.
-- =============================================================================
