-- RLS hardening — Slice 2: invoices.
-- finance_invoices was wide-open via fin_inv_all (USING true) — drop it. Reads
-- gated to accounts/crm/sales (CRM-360 financial tab + sales collections keep
-- working; production/store/etc blocked); writes gated to accounts (Invoicing is
-- an accounts-module feature; ar_create_invoice is SECURITY DEFINER so it bypasses
-- RLS regardless). The older role-code policy `finance_invoice_access`
-- (FINANCE/ACCOUNTS_EXECUTIVE) is LEFT IN PLACE as a belt-and-suspenders fallback
-- so finance-role users can't be locked out — permissive policies OR together.
-- finance_invoice_line is touched only by the Invoicing (accounts) screen → gate
-- to accounts. Idempotent.

-- Invoice headers -------------------------------------------------------------
DROP POLICY IF EXISTS fin_inv_all ON public.finance_invoices;
DROP POLICY IF EXISTS fin_inv_read ON public.finance_invoices;
DROP POLICY IF EXISTS fin_inv_write ON public.finance_invoices;

CREATE POLICY fin_inv_read ON public.finance_invoices
  FOR SELECT TO authenticated
  USING (public.is_super_admin()
         OR public.rbac_employee_can('accounts','view')
         OR public.rbac_employee_can('crm','view')
         OR public.rbac_employee_can('sales','view'));

CREATE POLICY fin_inv_write ON public.finance_invoices
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('accounts','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('accounts','edit'));

-- Invoice line items (accounts only — only the Invoicing screen reads/writes) ---
DROP POLICY IF EXISTS finv_line_all ON public.finance_invoice_line;
DROP POLICY IF EXISTS finv_line_read ON public.finance_invoice_line;
DROP POLICY IF EXISTS finv_line_write ON public.finance_invoice_line;

CREATE POLICY finv_line_read ON public.finance_invoice_line
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('accounts','view'));

CREATE POLICY finv_line_write ON public.finance_invoice_line
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('accounts','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('accounts','edit'));
