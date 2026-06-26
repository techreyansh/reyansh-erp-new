-- Access tightening (Intern + Marketing over-provisioned) + the one safe demo
-- delete (DEMO-PC15). Additive RBAC model: to restrict, assign a NARROWER role +
-- clear any employee-level grants so the effective set = the scoped role only.
-- Mirrors 20260625190000 (Dolly). Crompton prospects are KEPT (real). Idempotent.

DO $$
DECLARE
  v_role uuid;
  v_emp  uuid;
  v_mods text;
BEGIN
  -- 1) INTERN_SCOPED — dashboard, tasks, crm, sales only.
  INSERT INTO public.roles (name, code, role_name, description, is_system_role)
  VALUES ('Intern (Scoped)', 'INTERN_SCOPED', 'Intern (Scoped)', 'Scoped intern — CRM/sales support only.', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_role;
  IF v_role IS NULL THEN SELECT id INTO v_role FROM public.roles WHERE code = 'INTERN_SCOPED'; END IF;

  INSERT INTO public.role_module_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
  SELECT v_role, m.id, true, true, true, false
  FROM public.modules m
  WHERE m.module_key IN ('dashboard','tasks','crm','sales')
  ON CONFLICT (role_id, module_id) DO UPDATE
    SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create, can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete;

  SELECT id INTO v_emp FROM public.employees WHERE lower(email) = 'dishachaudhari2306@gmail.com';
  IF v_emp IS NOT NULL THEN
    DELETE FROM public.employee_permissions WHERE employee_id = v_emp;  -- clear leaked employee-level grants
    UPDATE public.employees SET role_id = v_role, updated_at = now() WHERE id = v_emp;
    SELECT string_agg(m.module_key, ', ' ORDER BY m.module_key) INTO v_mods
    FROM public.modules m WHERE EXISTS (SELECT 1 FROM public.role_module_permissions rmp WHERE rmp.role_id = v_role AND rmp.module_id = m.id AND rmp.can_view);
    RAISE NOTICE 'TIGHTEN | dishachaudhari2306 EFFECTIVE = [%]', COALESCE(v_mods, '(none)');
  ELSE
    RAISE NOTICE 'TIGHTEN | dishachaudhari2306 not found';
  END IF;

  -- 2) MARKETING_SCOPED — crm, sales, dashboard, reports, tasks.
  INSERT INTO public.roles (name, code, role_name, description, is_system_role)
  VALUES ('Marketing (Scoped)', 'MARKETING_SCOPED', 'Marketing (Scoped)', 'Marketing — CRM/sales/reporting only.', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_role;
  IF v_role IS NULL THEN SELECT id INTO v_role FROM public.roles WHERE code = 'MARKETING_SCOPED'; END IF;

  INSERT INTO public.role_module_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete)
  SELECT v_role, m.id, true, true, true, false
  FROM public.modules m
  WHERE m.module_key IN ('crm','sales','dashboard','reports','tasks')
  ON CONFLICT (role_id, module_id) DO UPDATE
    SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create, can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete;

  SELECT id INTO v_emp FROM public.employees WHERE lower(email) = 'marketing@reyanshelectronics.com';
  IF v_emp IS NOT NULL THEN
    DELETE FROM public.employee_permissions WHERE employee_id = v_emp;
    UPDATE public.employees SET role_id = v_role, updated_at = now() WHERE id = v_emp;
    SELECT string_agg(m.module_key, ', ' ORDER BY m.module_key) INTO v_mods
    FROM public.modules m WHERE EXISTS (SELECT 1 FROM public.role_module_permissions rmp WHERE rmp.role_id = v_role AND rmp.module_id = m.id AND rmp.can_view);
    RAISE NOTICE 'TIGHTEN | marketing@reyanshelectronics EFFECTIVE = [%]', COALESCE(v_mods, '(none)');
  ELSE
    RAISE NOTICE 'TIGHTEN | marketing@reyanshelectronics not found';
  END IF;

  -- 3) Demo cleanup — only the unambiguous DEMO-PC15 product (Crompton prospects kept).
  -- Guarded: clear likely child rows then the item; any FK surprise just skips the
  -- delete so the RBAC tightening above still commits.
  BEGIN
    DELETE FROM public.ppc_item_vendors WHERE item_id IN (SELECT id FROM public.ppc_items WHERE code = 'DEMO-PC15');
    DELETE FROM public.ppc_stock        WHERE item_id IN (SELECT id FROM public.ppc_items WHERE code = 'DEMO-PC15');
    DELETE FROM public.ppc_items WHERE code = 'DEMO-PC15';
    RAISE NOTICE 'DEMO CLEANUP | DEMO-PC15 removed';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'DEMO CLEANUP | DEMO-PC15 skipped (dependent rows): %', SQLERRM;
  END;
END $$;
