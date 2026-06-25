-- BUGFIX: the employees table had RLS policies for INSERT/SELECT/UPDATE but
-- NONE for DELETE, so every delete was silently denied (PostgREST returned
-- success while removing 0 rows). Add a DELETE policy matching the existing
-- RBAC model (super admin OR the employees 'delete' permission), mirroring the
-- UPDATE policy. Dependent rows cascade via FK.

DROP POLICY IF EXISTS rbac_employees_admin_delete ON public.employees;
CREATE POLICY rbac_employees_admin_delete ON public.employees
  FOR DELETE TO authenticated
  USING (public.rbac_employee_can('employees', 'delete'));
