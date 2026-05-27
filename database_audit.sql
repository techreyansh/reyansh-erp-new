-- ERP Supabase schema audit (idempotent, non-destructive)
-- Run in Supabase SQL Editor after supabase_rbac_setup.sql and erp_rbac_tasks_complete.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Required RBAC tables
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employees') THEN
    RAISE NOTICE 'MISSING: public.employees — run supabase_rbac_setup.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'roles') THEN
    RAISE NOTICE 'MISSING: public.roles';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'modules') THEN
    RAISE NOTICE 'MISSING: public.modules';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employee_permissions') THEN
    RAISE NOTICE 'MISSING: public.employee_permissions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tasks') THEN
    RAISE NOTICE 'MISSING: public.tasks';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Task columns for email-based visibility
-- ---------------------------------------------------------------------------
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assigned_email text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assigned_name text;

-- Backfill assigned_email from employees (safe to re-run)
UPDATE public.tasks t
SET
  assigned_email = lower(trim(e.email)),
  assigned_name = COALESCE(t.assigned_name, e.full_name)
FROM public.employees e
WHERE t.assigned_to = e.id
  AND (t.assigned_email IS NULL OR trim(t.assigned_email) = '');

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_email
  ON public.tasks (lower(trim(assigned_email)));

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to
  ON public.tasks (assigned_to);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by
  ON public.tasks (assigned_by);

CREATE INDEX IF NOT EXISTS idx_employees_email_lower
  ON public.employees (lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_employee_permissions_employee
  ON public.employee_permissions (employee_id);

-- ---------------------------------------------------------------------------
-- 4. RLS enabled check
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN ('employees', 'roles', 'modules', 'employee_permissions', 'tasks')
      AND NOT c.relrowsecurity
  LOOP
    RAISE NOTICE 'RLS DISABLED on public.% — enable RLS in supabase_rbac_setup.sql', r.table_name;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Employee task status RPC (email-scoped)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_my_task_status(p_task_id uuid, p_status text)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.tasks;
BEGIN
  IF p_status NOT IN ('pending', 'in_progress', 'completed', 'blocked') THEN
    RAISE EXCEPTION 'Invalid task status: %', p_status;
  END IF;

  UPDATE public.tasks
  SET task_status = p_status,
      updated_at = now()
  WHERE id = p_task_id
    AND lower(trim(COALESCE(assigned_email, ''))) = public.rbac_current_email()
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Task not found or not assigned to you';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_task_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_task_status(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Task RLS policies (email + admin edit)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "rbac_tasks_select_own_or_admin" ON public.tasks;
CREATE POLICY "rbac_tasks_select_own_or_admin"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    lower(trim(COALESCE(assigned_email, ''))) = public.rbac_current_email()
    OR assigned_to = public.rbac_current_employee_id()
    OR assigned_by = public.rbac_current_employee_id()
    OR public.rbac_employee_can('tasks', 'edit')
  );

DROP POLICY IF EXISTS "rbac_tasks_employee_status_update" ON public.tasks;
CREATE POLICY "rbac_tasks_employee_status_update"
  ON public.tasks FOR UPDATE TO authenticated
  USING (
    lower(trim(COALESCE(assigned_email, ''))) = public.rbac_current_email()
    OR assigned_to = public.rbac_current_employee_id()
  )
  WITH CHECK (
    lower(trim(COALESCE(assigned_email, ''))) = public.rbac_current_email()
    OR assigned_to = public.rbac_current_employee_id()
  );

-- ---------------------------------------------------------------------------
-- 7. Orphan / data quality report (read-only)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  orphan_tasks int;
  missing_email int;
  inactive_assignees int;
BEGIN
  SELECT count(*) INTO orphan_tasks
  FROM public.tasks t
  WHERE t.assigned_to IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = t.assigned_to);

  SELECT count(*) INTO missing_email
  FROM public.tasks
  WHERE assigned_to IS NOT NULL
    AND (assigned_email IS NULL OR trim(assigned_email) = '');

  SELECT count(*) INTO inactive_assignees
  FROM public.tasks t
  JOIN public.employees e ON e.id = t.assigned_to
  WHERE e.is_active = false;

  RAISE NOTICE 'Audit: orphan assigned_to rows = %', orphan_tasks;
  RAISE NOTICE 'Audit: tasks missing assigned_email = %', missing_email;
  RAISE NOTICE 'Audit: tasks assigned to inactive employees = %', inactive_assignees;
END $$;

COMMIT;
