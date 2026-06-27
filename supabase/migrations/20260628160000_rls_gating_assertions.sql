-- RLS gating assertions — verifies the Slice 1-7 module-gating invariants.
--
-- Read-only and idempotent: changes no data, safe to re-run. It impersonates
-- test principals (by setting the JWT email claim that is_super_admin() /
-- rbac_employee_can() read) and RAISES if a gating invariant is violated, so a
-- clean apply is proof the policy logic is sound. No employee emails are printed.
--
-- Invariants checked:
--   1. A non-privileged user (no employee row) is NOT a super-admin.
--   2. That user has NO edit/view on any gated module  → gated writes/reads denied.
--   3. A real 'production' editor DOES resolve production.edit = true
--      → legitimate staff are not over-blocked by the new policies.

DO $$
DECLARE
  v_nonpriv text := 'nobody-noaccess@example.invalid';
  v_prod_email text;
  v_sales_email text;
BEGIN
  -- ---- Invariant 1 & 2: non-privileged user is fully denied -----------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('email', v_nonpriv,
                      'sub', '00000000-0000-0000-0000-000000000000')::text, true);

  IF public.is_super_admin() THEN
    RAISE EXCEPTION 'RLS QA FAIL: a non-privileged principal resolves is_super_admin()=true';
  END IF;

  IF public.rbac_employee_can('production','edit')
     OR public.rbac_employee_can('sales','edit')
     OR public.rbac_employee_can('npd','edit')
     OR public.rbac_employee_can('employees','view')
     OR public.rbac_employee_can('accounts','edit') THEN
    RAISE EXCEPTION 'RLS QA FAIL: a non-privileged principal has unexpected module permission';
  END IF;
  RAISE NOTICE 'RLS QA OK: non-privileged principal has no super-admin and no gated module access (writes/sensitive reads will be denied)';

  -- ---- Invariant 3: a real production editor is NOT over-blocked -------------
  SELECT min(e.email) INTO v_prod_email
  FROM public.employee_permissions ep
  JOIN public.modules m ON m.id = ep.module_id AND m.module_key = 'production'
  JOIN public.employees e ON e.id = ep.employee_id AND e.is_active
  WHERE ep.can_edit;

  IF v_prod_email IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('email', v_prod_email)::text, true);
    IF NOT public.rbac_employee_can('production','edit') THEN
      RAISE EXCEPTION 'RLS QA FAIL: a production editor resolves production.edit=false (over-blocked)';
    END IF;
    RAISE NOTICE 'RLS QA OK: a real production editor resolves production.edit=true (not over-blocked)';
  ELSE
    RAISE NOTICE 'RLS QA NOTE: no active production editor in employee_permissions to test (skipped invariant 3)';
  END IF;

  -- ---- Bonus: a real sales editor can write product config (Slice 7 OR-gate) -
  SELECT min(e.email) INTO v_sales_email
  FROM public.employee_permissions ep
  JOIN public.modules m ON m.id = ep.module_id AND m.module_key = 'sales'
  JOIN public.employees e ON e.id = ep.employee_id AND e.is_active
  WHERE ep.can_edit;

  IF v_sales_email IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('email', v_sales_email)::text, true);
    IF NOT public.rbac_employee_can('sales','edit') THEN
      RAISE EXCEPTION 'RLS QA FAIL: a sales editor resolves sales.edit=false (Product Master writes would break)';
    END IF;
    RAISE NOTICE 'RLS QA OK: a real sales editor resolves sales.edit=true (Product Master product-config writes preserved)';
  ELSE
    RAISE NOTICE 'RLS QA NOTE: no active sales editor in employee_permissions to test (skipped sales invariant)';
  END IF;

  -- Reset the impersonated claim.
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;
