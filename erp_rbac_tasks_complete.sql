-- Fix employee task visibility: store assigned_email and match RLS by login email
-- Run in Supabase SQL Editor (idempotent)

BEGIN;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assigned_email text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assigned_name text;

-- Backfill from employees for existing rows
UPDATE public.tasks t
SET
  assigned_email = lower(trim(e.email)),
  assigned_name = COALESCE(t.assigned_name, e.full_name)
FROM public.employees e
WHERE t.assigned_to = e.id
  AND (t.assigned_email IS NULL OR trim(t.assigned_email) = '');

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_email
  ON public.tasks (lower(trim(assigned_email)));

-- Employee status-only RPC (email-safe)
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

-- RLS: employees see own tasks by email; CEO/admin see all via tasks edit permission
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

COMMIT;
