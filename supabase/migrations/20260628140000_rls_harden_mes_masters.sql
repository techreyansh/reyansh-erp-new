-- RLS hardening — Slice 7: gate the Power-Cord MES / production master tables.
--
-- The shipped MES Phase 1 left ~22 master/config tables on permissive
-- "<table>_all FOR ALL USING(true) WITH CHECK(true)" policies created TO public —
-- which includes the unauthenticated anon role. Verified live: anon could read
-- ppc_machines / assembly_operation / molding_master / ppc_wo. Slice 5 missed
-- these (it only rewrote policies literally named "Allow all anon").
--
-- This slice replaces each "_all" stub with <table>_read + <table>_write:
--   reads  → broad TO authenticated USING(true)  (operational/reference data,
--            read across dashboards/planners/sales-order wizard; no PII)
--   writes → is_super_admin() OR rbac_employee_can('<module>','edit')
-- and REVOKEs anon table grants (defense-in-depth, as Slice 5 did). Shop-floor
-- write paths (ppc_create_work_order / ppc_advance_stage / ppc_issue_material /
-- ppc_post_jobcard) are SECURITY DEFINER and bypass RLS, so operator/WO flows are
-- unaffected. relkind-guarded (skips any view) and idempotent (DROP IF EXISTS).

CREATE OR REPLACE FUNCTION pg_temp._s7_relkind(rel text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT c.relkind::text FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = rel;
$$;

DO $$
DECLARE
  rec text[];
  t text; mods text[]; m text; rk text; wclause text;
  skipped text[] := '{}';
  -- [table, comma-separated write-owner module(s)]
  -- Writes gate to ANY of the listed modules' 'edit'. Reads are broad for all.
  tabs text[][] := ARRAY[
    -- production-only writers (RPC-driven or production screens) --------------
    ['ppc_items','production'],
    ['ppc_bom','production'],
    ['ppc_stock','production'],
    ['ppc_lines','production'],
    ['ppc_machines','production'],
    ['ppc_wo','production'],
    ['ppc_wo_stage','production'],
    ['ppc_wo_material','production'],
    ['ppc_wo_qc','production'],
    ['assembly_operation','production'],
    ['molding_master','production'],
    ['packing_master','production'],
    ['shift_master','production'],
    ['department','production'],
    ['workstation','production'],
    ['daily_production_plan','production'],
    ['downtime_reason','production'],
    ['defect_code','production'],
    ['stage_execution_log','production'],
    -- product-engineering config: written directly from Product Master (sales)
    -- and NPD screens too — gate to the superset so those editors don't break.
    ['assembly_side_config','production,sales,npd'],
    ['product_quality_plan','production,sales,npd']
  ];
BEGIN
  FOREACH rec SLICE 1 IN ARRAY tabs LOOP
    t := rec[1];
    rk := pg_temp._s7_relkind(t);
    CONTINUE WHEN rk IS NULL;                       -- relation absent
    IF rk NOT IN ('r','p') THEN                     -- view/matview: can't hold RLS
      skipped := array_append(skipped, t || ' (relkind=' || rk || ')');
      CONTINUE;
    END IF;

    -- build the write USING/CHECK clause from the module list
    mods := string_to_array(rec[2], ',');
    wclause := 'public.is_super_admin()';
    FOREACH m IN ARRAY mods LOOP
      wclause := wclause || format(' OR public.rbac_employee_can(%L,''edit'')', m);
    END LOOP;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_write', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t||'_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      t||'_write', t, wclause, wclause);

    -- defense-in-depth: the "_all" policy was TO public (anon-reachable); drop the
    -- anon role's table grant so it can't reach the table at all.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;

  IF array_length(skipped, 1) > 0 THEN
    RAISE NOTICE 'Slice7: skipped non-table relations (NOT gated): %', array_to_string(skipped, ', ');
  END IF;
END $$;

-- ppc_wo_status_log: trigger-written status log. Keep a broad read (lock to
-- authenticated), no write policy (writes happen via the status trigger/definer).
DO $$
DECLARE rk text;
BEGIN
  rk := pg_temp._s7_relkind('ppc_wo_status_log');
  IF rk IN ('r','p') THEN
    DROP POLICY IF EXISTS ppc_wo_status_log_all   ON public.ppc_wo_status_log;
    DROP POLICY IF EXISTS ppc_wo_status_log_read  ON public.ppc_wo_status_log;
    DROP POLICY IF EXISTS ppc_wo_status_log_write ON public.ppc_wo_status_log;
    CREATE POLICY ppc_wo_status_log_read ON public.ppc_wo_status_log
      FOR SELECT TO authenticated USING (true);
    REVOKE ALL ON public.ppc_wo_status_log FROM anon;
  END IF;
END $$;

DROP FUNCTION IF EXISTS pg_temp._s7_relkind(text);
