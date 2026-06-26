-- READ-ONLY probe: name the specific demo-matched rows so the operator can confirm
-- which are truly demo (a real "Crompton" customer must NOT be deleted). No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT code, name FROM public.ppc_items WHERE code ILIKE 'DEMO%' OR name ILIKE '%demo%' LOOP
    RAISE NOTICE 'DEMO_ITEM | % | %', r.code, r.name;
  END LOOP;
  FOR r IN SELECT id, company_name, account_type, owner_email, created_at FROM public.crm_pipeline
           WHERE company_name ILIKE '%demo%' OR company_name ILIKE '%test%' OR company_name ILIKE '%crompton%' LOOP
    RAISE NOTICE 'DEMO_CRM | % | name=% | type=% | owner=% | created=%', r.id, r.company_name, r.account_type, COALESCE(r.owner_email,'(none)'), r.created_at;
  END LOOP;
END $$;
