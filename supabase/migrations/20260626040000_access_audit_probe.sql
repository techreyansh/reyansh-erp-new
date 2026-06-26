-- READ-ONLY audit probe (no schema change, no writes). Emits each user's
-- effective modules + demo-data counts via RAISE NOTICE so the operator can read
-- them from the db-push output (psql-direct is sandbox-blocked). Idempotent.
DO $$
DECLARE
  r record;
  v_modules text;
BEGIN
  FOR r IN
    SELECT e.id, e.email, ro.name AS role, e.role_id
    FROM public.employees e
    LEFT JOIN public.roles ro ON ro.id = e.role_id
    ORDER BY e.email
  LOOP
    SELECT string_agg(m.module_key, ', ' ORDER BY m.module_key) INTO v_modules
    FROM public.modules m
    WHERE EXISTS (SELECT 1 FROM public.employee_permissions ep WHERE ep.employee_id = r.id AND ep.module_id = m.id AND ep.can_view)
       OR EXISTS (SELECT 1 FROM public.role_module_permissions rmp WHERE rmp.role_id = r.role_id AND rmp.module_id = m.id AND rmp.can_view);
    RAISE NOTICE 'AUDIT | % | role=% | modules=[%]', r.email, COALESCE(r.role, '(none)'), COALESCE(v_modules, '(none)');
  END LOOP;

  RAISE NOTICE 'DEMO | ppc_items=% | ppc_wo=% | crm=% | cable_plans=%',
    (SELECT count(*) FROM public.ppc_items WHERE code ILIKE 'DEMO%' OR name ILIKE '%demo%'),
    (SELECT count(*) FROM public.ppc_wo WHERE wo_number ILIKE '%DEMO%'),
    (SELECT count(*) FROM public.crm_pipeline WHERE company_name ILIKE '%demo%' OR company_name ILIKE '%test%' OR company_name ILIKE '%crompton%'),
    (SELECT count(*) FROM public.cable_production_plan WHERE cable_code ILIKE '%demo%' OR product_name ILIKE '%demo%');
END $$;
