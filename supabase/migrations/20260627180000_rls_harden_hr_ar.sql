-- RLS hardening — Slice 1: HR documents + payment receipts.
-- These were FOR ALL USING(true): any authenticated employee could read all HR
-- documents (contracts/payroll/bank) and all payment receipts via PostgREST.
-- Gate them to the right module via the existing public.rbac_employee_can()
-- (CEO-bypass built in) + an is_super_admin() allowlist bypass. Reads = 'view',
-- writes = 'edit'. Both are safe to gate with ZERO app breakage:
--   * employee_documents is read only by EmployeeProfile.js (employees module).
--   * ar_payments has no direct client reads; it's written by the
--     ar_record_payment SECURITY DEFINER RPC (bypasses RLS) and the collections
--     view v_ar_invoices reads finance_invoices only (not ar_payments).
-- Idempotent (DROP POLICY IF EXISTS). RLS is already enabled on both tables.

-- HR documents → 'employees' module --------------------------------------------
DROP POLICY IF EXISTS employee_documents_all ON public.employee_documents;
DROP POLICY IF EXISTS employee_documents_read ON public.employee_documents;
DROP POLICY IF EXISTS employee_documents_write ON public.employee_documents;

CREATE POLICY employee_documents_read ON public.employee_documents
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('employees','view'));

CREATE POLICY employee_documents_write ON public.employee_documents
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('employees','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('employees','edit'));

-- Payment receipts → 'accounts' module -----------------------------------------
DROP POLICY IF EXISTS ar_payments_all ON public.ar_payments;
DROP POLICY IF EXISTS ar_payments_read ON public.ar_payments;
DROP POLICY IF EXISTS ar_payments_write ON public.ar_payments;

CREATE POLICY ar_payments_read ON public.ar_payments
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('accounts','view'));

CREATE POLICY ar_payments_write ON public.ar_payments
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('accounts','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('accounts','edit'));
