-- RLS hardening — Slice 6: module-gate the ~67 legacy "sheet" tables.
--
-- Slice 5 (20260627230000) revoked ANON access: it replaced each table's open
-- "Allow all anon" policy with "Allow all authenticated" FOR ALL USING(true) and
-- REVOKEd anon table grants. That left "any logged-in user can read+write every
-- table". This slice makes it finer-grained per OWNING module, matching the
-- Slices 1–4 pattern: is_super_admin() OR rbac_employee_can('<module>','<action>').
--
-- WRITES  → always gated to the owning module's 'edit'.
-- READS   → "Hybrid": broad (USING(true)) for operational/cross-cutting tables,
--           gated to owner 'view' only for sensitive HR / finance / audit tables.
-- Policy names follow the convention: <table>_read (SELECT) + <table>_write (ALL).
-- Idempotent (DROP IF EXISTS, re-runnable). Each relation is guarded by relkind:
-- only ordinary/partitioned TABLES ('r'/'p') can carry RLS policies, so VIEWS and
-- other relation types in SHEET_TABLE_NAMES (e.g. employees_data is a view) are
-- skipped and reported via RAISE NOTICE for separate follow-up. Anon grants were
-- already revoked in Slice 5, so no REVOKE is repeated here.

-- Session-local helper: returns relkind of a public relation, or NULL if absent.
CREATE OR REPLACE FUNCTION pg_temp._s6_relkind(rel text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT c.relkind::text FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = rel;
$$;

DO $$
DECLARE
  rec text[];
  t text; owner text; rmode text; rk text;
  skipped text[] := '{}';
  -- [physical_table, owner_module, read_mode]  read_mode ∈ broad | gated
  -- Uniform single-owner tables only. Dual-owner / special-clause tables
  -- (users, clients2, prospects_clients, audit_log, whatsapp_logs,
  --  schedule_payment, release_payment) are handled as explicit blocks below.
  tabs text[][] := ARRAY[
    -- sales -----------------------------------------------------------------
    ['client_orders_data','sales','broad'],
    ['client_payments_data','sales','broad'],
    ['client_quotations_data','sales','broad'],
    ['client_notifications_data','sales','broad'],
    ['sales_flow_data','sales','broad'],
    ['sales_flow_steps_data','sales','broad'],
    ['log_and_qualify_leads_data','sales','broad'],
    ['initial_call_data','sales','broad'],
    ['send_quotation_data','sales','broad'],
    ['send_quotation','sales','broad'],
    ['approve_payment_terms_data','sales','broad'],
    ['sample_submission_data','sales','broad'],
    ['get_approval_for_sample_data','sales','broad'],
    ['approve_strategic_deals_data','sales','broad'],
    ['evaluate_high_value_prospects_data','sales','broad'],
    ['check_feasibility_data','sales','broad'],
    ['confirm_standard_and_compliance','sales','broad'],
    ['products','sales','broad'],
    ['po_master','sales','broad'],
    -- purchase --------------------------------------------------------------
    ['vendors_data','purchase','broad'],
    ['purchase_flow_data','purchase','broad'],
    ['purchase_flow_steps_data','purchase','broad'],
    ['follow_up_quotations_data','purchase','broad'],
    ['comparative_statement_data','purchase','broad'],
    ['sheet_approve_quotation_data','purchase','broad'],
    ['request_sample_data','purchase','broad'],
    ['inspect_material_data','purchase','broad'],
    ['material_approval','purchase','broad'],
    ['place_po_data','purchase','broad'],
    ['return_history_data','purchase','broad'],
    ['generate_grn_data','purchase','broad'],
    ['rfq_data','purchase','broad'],
    ['sort_vendor_data','purchase','broad'],
    ['follow_up_delivery_data','purchase','broad'],
    ['return_material_data','purchase','broad'],
    ['inspect_sample_data','purchase','broad'],
    ['po_items','purchase','broad'],
    -- inventory -------------------------------------------------------------
    ['stock_data','inventory','broad'],
    ['material_inward_data','inventory','broad'],
    ['material_issue_data','inventory','broad'],
    ['company_bom_data','inventory','broad'],
    ['company_material_issue_data','inventory','broad'],
    ['finished_goods','inventory','broad'],
    ['fg_material_inward','inventory','broad'],
    ['fg_material_outward','inventory','broad'],
    -- production ------------------------------------------------------------
    ['cable_products','production','broad'],
    ['cable_production_plans','production','broad'],
    ['machine_schedules','production','broad'],
    ['bom_templates','production','broad'],
    ['power_cord_master','production','broad'],
    ['production_monitoring','production','broad'],
    ['mold_compatibility_matrix','production','broad'],
    ['production_orders','production','broad'],
    ['machine_status_log','production','broad'],
    -- dispatch --------------------------------------------------------------
    ['dispatches','dispatch','broad'],
    ['daily_capacity','dispatch','broad'],
    -- employees (HR — sensitive reads gated) --------------------------------
    ['employees_data','employees','gated'],
    ['performance_data','employees','gated'],
    ['attendance_data','employees','gated'],
    ['employee_tasks_data','employees','broad'],
    -- dashboard -------------------------------------------------------------
    ['notifications_data','dashboard','broad']
  ];
BEGIN
  FOREACH rec SLICE 1 IN ARRAY tabs LOOP
    t := rec[1]; owner := rec[2]; rmode := rec[3];
    rk := pg_temp._s6_relkind(t);
    CONTINUE WHEN rk IS NULL;                       -- relation absent
    IF rk NOT IN ('r','p') THEN                     -- view/matview/etc: can't hold RLS
      skipped := array_append(skipped, t || ' (relkind=' || rk || ')');
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS "Allow all authenticated" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_write', t);

    IF rmode = 'gated' THEN
      EXECUTE format($f$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (public.is_super_admin() OR public.rbac_employee_can(%L,'view'))$f$,
        t||'_read', t, owner);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
        t||'_read', t);
    END IF;

    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can(%L,'edit'))
      WITH CHECK (public.is_super_admin() OR public.rbac_employee_can(%L,'edit'))$f$,
      t||'_write', t, owner, owner);
  END LOOP;

  IF array_length(skipped, 1) > 0 THEN
    RAISE NOTICE 'Slice6: skipped non-table relations (NOT gated — need separate handling on their base tables): %',
      array_to_string(skipped, ', ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Special-clause tables (kept OUT of the array; dual-owner / carve-out writes).
-- Each is guarded to only act on a real TABLE; views are reported, not gated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE rk text; skipped text[] := '{}';
BEGIN
  -- users: read MUST stay broad — AuthContext role enrichment reads users on
  -- every login (src/context/AuthContext.js). Write → employees.edit.
  rk := pg_temp._s6_relkind('users');
  IF rk IN ('r','p') THEN
    DROP POLICY IF EXISTS "Allow all authenticated" ON public.users;
    DROP POLICY IF EXISTS users_read  ON public.users;
    DROP POLICY IF EXISTS users_write ON public.users;
    CREATE POLICY users_read ON public.users FOR SELECT TO authenticated USING (true);
    CREATE POLICY users_write ON public.users FOR ALL TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('employees','edit'))
      WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('employees','edit'));
  ELSIF rk IS NOT NULL THEN skipped := array_append(skipped, 'users ('||rk||')'); END IF;

  -- clients2 (logical "clients"): created/edited by both Sales pages and CRM
  -- pipeline. Read broad (CRM-360 reads it). Write → sales OR crm.
  rk := pg_temp._s6_relkind('clients2');
  IF rk IN ('r','p') THEN
    DROP POLICY IF EXISTS "Allow all authenticated" ON public.clients2;
    DROP POLICY IF EXISTS clients2_read  ON public.clients2;
    DROP POLICY IF EXISTS clients2_write ON public.clients2;
    CREATE POLICY clients2_read ON public.clients2 FOR SELECT TO authenticated USING (true);
    CREATE POLICY clients2_write ON public.clients2 FOR ALL TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('sales','edit') OR public.rbac_employee_can('crm','edit'))
      WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('sales','edit') OR public.rbac_employee_can('crm','edit'));
  ELSIF rk IS NOT NULL THEN skipped := array_append(skipped, 'clients2 ('||rk||')'); END IF;

  -- prospects_clients: written by /prospects-clients (sales) AND CRM pipeline.
  rk := pg_temp._s6_relkind('prospects_clients');
  IF rk IN ('r','p') THEN
    DROP POLICY IF EXISTS "Allow all authenticated" ON public.prospects_clients;
    DROP POLICY IF EXISTS prospects_clients_read  ON public.prospects_clients;
    DROP POLICY IF EXISTS prospects_clients_write ON public.prospects_clients;
    CREATE POLICY prospects_clients_read ON public.prospects_clients FOR SELECT TO authenticated USING (true);
    CREATE POLICY prospects_clients_write ON public.prospects_clients FOR ALL TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('sales','edit') OR public.rbac_employee_can('crm','edit'))
      WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('sales','edit') OR public.rbac_employee_can('crm','edit'));
  ELSIF rk IS NOT NULL THEN skipped := array_append(skipped, 'prospects_clients ('||rk||')'); END IF;

  -- schedule_payment / release_payment: finance data written inside the purchase
  -- flow. Read gated to accounts OR purchase 'view'; write → accounts OR purchase.
  rk := pg_temp._s6_relkind('schedule_payment');
  IF rk IN ('r','p') THEN
    DROP POLICY IF EXISTS "Allow all authenticated" ON public.schedule_payment;
    DROP POLICY IF EXISTS schedule_payment_read  ON public.schedule_payment;
    DROP POLICY IF EXISTS schedule_payment_write ON public.schedule_payment;
    CREATE POLICY schedule_payment_read ON public.schedule_payment FOR SELECT TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('accounts','view') OR public.rbac_employee_can('purchase','view'));
    CREATE POLICY schedule_payment_write ON public.schedule_payment FOR ALL TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('accounts','edit') OR public.rbac_employee_can('purchase','edit'))
      WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('accounts','edit') OR public.rbac_employee_can('purchase','edit'));
  ELSIF rk IS NOT NULL THEN skipped := array_append(skipped, 'schedule_payment ('||rk||')'); END IF;

  rk := pg_temp._s6_relkind('release_payment');
  IF rk IN ('r','p') THEN
    DROP POLICY IF EXISTS "Allow all authenticated" ON public.release_payment;
    DROP POLICY IF EXISTS release_payment_read  ON public.release_payment;
    DROP POLICY IF EXISTS release_payment_write ON public.release_payment;
    CREATE POLICY release_payment_read ON public.release_payment FOR SELECT TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('accounts','view') OR public.rbac_employee_can('purchase','view'));
    CREATE POLICY release_payment_write ON public.release_payment FOR ALL TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('accounts','edit') OR public.rbac_employee_can('purchase','edit'))
      WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('accounts','edit') OR public.rbac_employee_can('purchase','edit'));
  ELSIF rk IS NOT NULL THEN skipped := array_append(skipped, 'release_payment ('||rk||')'); END IF;

  -- audit_log: app-unused (demo only). Read gated to settings; write super-admin.
  rk := pg_temp._s6_relkind('audit_log');
  IF rk IN ('r','p') THEN
    DROP POLICY IF EXISTS "Allow all authenticated" ON public.audit_log;
    DROP POLICY IF EXISTS audit_log_read  ON public.audit_log;
    DROP POLICY IF EXISTS audit_log_write ON public.audit_log;
    CREATE POLICY audit_log_read ON public.audit_log FOR SELECT TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('settings','view'));
    CREATE POLICY audit_log_write ON public.audit_log FOR ALL TO authenticated
      USING (public.is_super_admin())
      WITH CHECK (public.is_super_admin());
  ELSIF rk IS NOT NULL THEN skipped := array_append(skipped, 'audit_log ('||rk||')'); END IF;

  -- whatsapp_logs: operational append-log written directly by ~13 components
  -- (src/services/whatsappLogService.js), NOT trigger-written. Keep read+write
  -- broad-authenticated to avoid breaking logging; renamed to _read/_write.
  rk := pg_temp._s6_relkind('whatsapp_logs');
  IF rk IN ('r','p') THEN
    DROP POLICY IF EXISTS "Allow all authenticated" ON public.whatsapp_logs;
    DROP POLICY IF EXISTS whatsapp_logs_read  ON public.whatsapp_logs;
    DROP POLICY IF EXISTS whatsapp_logs_write ON public.whatsapp_logs;
    CREATE POLICY whatsapp_logs_read ON public.whatsapp_logs FOR SELECT TO authenticated USING (true);
    CREATE POLICY whatsapp_logs_write ON public.whatsapp_logs FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  ELSIF rk IS NOT NULL THEN skipped := array_append(skipped, 'whatsapp_logs ('||rk||')'); END IF;

  IF array_length(skipped, 1) > 0 THEN
    RAISE NOTICE 'Slice6 (special blocks): skipped non-table relations: %', array_to_string(skipped, ', ');
  END IF;
END $$;

DROP FUNCTION IF EXISTS pg_temp._s6_relkind(text);
