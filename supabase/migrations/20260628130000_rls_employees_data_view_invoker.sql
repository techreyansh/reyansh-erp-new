-- RLS hardening — Slice 6b: close the employees_data HR-PII read bypass.
--
-- Slice 6 skipped public.employees_data because it is a VIEW (relkind=v) and
-- views cannot carry RLS policies. The view (created in 20260620360000) is a
-- compat shim that SELECTs every column of public.employees — including
-- sensitive PII: salary_grade, bank_name, account_number, ifsc_code, upi_id,
-- date_of_birth, address. The base table public.employees is ALREADY correctly
-- gated (policy rbac_employees_select_self_or_admin:
--   USING (email = rbac_current_email() OR rbac_employee_can('employees','view')))
-- but a normal (non-security_invoker) view runs as its OWNER, so reading through
-- employees_data BYPASSES that RLS and exposes all employees' PII to any logged-in
-- user.
--
-- Fix: make the view security_invoker (same pattern this repo already uses for
-- v_clients / v_prospects), so reads through it enforce the employees RLS — each
-- user sees their own row, employees-module viewers see all. Writes are unaffected
-- (they go through the INSTEAD OF employees_data_view_dml trigger, SECURITY
-- DEFINER). authenticated already holds GRANT SELECT on public.employees
-- (supabase_rbac_setup.sql:659), which security_invoker requires.
--
-- App view-readers are all self-scoped (ProfilePage .ilike('Email', user.email);
-- Header own ProfilePhoto) or HR pages whose users hold employees access
-- (EmployeeProfile, EmployeeManagement) — so no feature relies on the view
-- returning all rows to a non-HR user.

DO $$
BEGIN
  IF (SELECT c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'employees_data') = 'v' THEN
    EXECUTE 'ALTER VIEW public.employees_data SET (security_invoker = true)';
  END IF;
END $$;

-- employees_data_legacy: the OLD physical sheet table (renamed from employees_data
-- in 20260620360000) still holds historical HR rows incl. bank/salary PII. Slice 5
-- left it "Allow all authenticated" (any logged-in user can read it). It has NO app
-- usage. Gate read to employees-module view (+super-admin); lock writes to
-- super-admin (retired table — nothing should write it).
DO $$
BEGIN
  IF (SELECT c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'employees_data_legacy') IN ('r','p') THEN
    EXECUTE 'ALTER TABLE public.employees_data_legacy ENABLE ROW LEVEL SECURITY';
    DROP POLICY IF EXISTS "Allow all authenticated"        ON public.employees_data_legacy;
    DROP POLICY IF EXISTS employees_data_legacy_read       ON public.employees_data_legacy;
    DROP POLICY IF EXISTS employees_data_legacy_write      ON public.employees_data_legacy;
    CREATE POLICY employees_data_legacy_read ON public.employees_data_legacy
      FOR SELECT TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('employees','view'));
    CREATE POLICY employees_data_legacy_write ON public.employees_data_legacy
      FOR ALL TO authenticated
      USING (public.is_super_admin())
      WITH CHECK (public.is_super_admin());
  END IF;
END $$;
