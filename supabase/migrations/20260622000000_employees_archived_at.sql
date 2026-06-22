-- Archive support for employees: a soft "archived" state distinct from the
-- is_active deactivation. Archived employees are hidden from the directory by
-- default but kept for history; un-archive restores them.
-- Idempotent and additive — safe to run on the live employees table.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.employees.archived_at IS
  'When the employee was archived (hidden from directory). NULL = active record. Distinct from is_active (access deactivation).';

CREATE INDEX IF NOT EXISTS idx_employees_archived_at
  ON public.employees (archived_at);
