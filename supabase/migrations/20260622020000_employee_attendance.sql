-- Per-employee daily attendance, keyed by employee_id (uuid) to match the
-- current employee model. One row per (employee, date). Permissive RLS to match
-- the app's existing HR tables (employee_documents_all); access is gated at the
-- module level (Employee Management = CEO/HR). Scope by role for hardening later.

CREATE TABLE IF NOT EXISTS public.employee_attendance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date        date NOT NULL,
  status      text NOT NULL DEFAULT 'present'
              CHECK (status IN ('present','absent','half_day','leave','holiday','week_off')),
  check_in    text,
  check_out   text,
  note        text,
  marked_by_email text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_emp_attendance_emp_date
  ON public.employee_attendance (employee_id, date);

ALTER TABLE public.employee_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_attendance_all ON public.employee_attendance;
CREATE POLICY employee_attendance_all ON public.employee_attendance
  FOR ALL USING (true) WITH CHECK (true);
