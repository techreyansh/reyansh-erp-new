-- Employee leave requests + approval workflow, keyed by employee_id (uuid).
-- Permissive RLS to match the app's HR tables; access gated at module level.

CREATE TABLE IF NOT EXISTS public.employee_leave_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type  text NOT NULL DEFAULT 'casual'
              CHECK (leave_type IN ('casual','sick','earned','unpaid','other')),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  days        numeric NOT NULL DEFAULT 1,
  reason      text,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by_email text,
  decided_at  timestamptz,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emp_leave_emp
  ON public.employee_leave_requests (employee_id, start_date);

ALTER TABLE public.employee_leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_leave_all ON public.employee_leave_requests;
CREATE POLICY employee_leave_all ON public.employee_leave_requests
  FOR ALL USING (true) WITH CHECK (true);
