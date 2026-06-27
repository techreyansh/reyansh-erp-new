-- RLS hardening — Slice 3b: remaining wide-open crm_* child tables → 'crm' module.
-- All were single FOR ALL USING(true) policies. Readers are CRM services
-- (crmPipelineService, client360Service) or SECURITY DEFINER RPCs (bypass RLS),
-- so gating to crm is low-risk. Pattern: read=view, write=edit, + is_super_admin.
-- crm_quotations/items also read by CostControl price-impact (accounts) → read
-- gated to crm OR accounts. crm_client_stage_def is a read-only lookup (no write
-- policy). EXCLUDES crm_order_cycle (already owner-gated). Idempotent.

DO $$
DECLARE
  t text;
  -- tables gated purely to crm, with their existing wide-open policy name
  crm_tabs text[][] := ARRAY[
    ['crm_account_addresses','crm_account_addresses_all'],
    ['crm_account_contacts','crm_account_contacts_all'],
    ['crm_account_documents','crm_account_documents_all'],
    ['crm_account_samples','crm_account_samples_all'],
    ['crm_activities','crm_activities_authenticated_rw'],
    ['crm_call_logs','crm_call_logs_authenticated_rw'],
    ['crm_interactions','crm_interactions_authenticated_rw'],
    ['crm_notes','crm_notes_authenticated_rw'],
    ['crm_opportunities','crm_opportunities_authenticated_rw'],
    ['crm_order_taking','crm_order_taking_authenticated_rw'],
    ['crm_payments','crm_payments_authenticated_rw'],
    ['crm_order_cycle_history','crm_oc_history_all'],
    ['crm_pipeline_collaborators','crm_collab_all'],
    ['crm_rep_targets','crm_rep_targets_all'],
    ['crm_tasks','crm_tasks_authenticated_rw']
  ];
  rec text[];
BEGIN
  FOREACH rec SLICE 1 IN ARRAY crm_tabs LOOP
    t := rec[1];
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rec[2], t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_write', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('crm','view'))$f$, t||'_read', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.is_super_admin() OR public.rbac_employee_can('crm','edit'))
      WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('crm','edit'))$f$, t||'_write', t);
  END LOOP;
END $$;

-- Quotations: read by CRM-360 AND CostControl (accounts); write by CRM ----------
DROP POLICY IF EXISTS crm_quotations_all ON public.crm_quotations;
DROP POLICY IF EXISTS crm_quotations_read ON public.crm_quotations;
DROP POLICY IF EXISTS crm_quotations_write ON public.crm_quotations;
CREATE POLICY crm_quotations_read ON public.crm_quotations FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('crm','view') OR public.rbac_employee_can('accounts','view'));
CREATE POLICY crm_quotations_write ON public.crm_quotations FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('crm','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('crm','edit'));

DROP POLICY IF EXISTS crm_quotation_items_all ON public.crm_quotation_items;
DROP POLICY IF EXISTS crm_quotation_items_read ON public.crm_quotation_items;
DROP POLICY IF EXISTS crm_quotation_items_write ON public.crm_quotation_items;
CREATE POLICY crm_quotation_items_read ON public.crm_quotation_items FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('crm','view') OR public.rbac_employee_can('accounts','view'));
CREATE POLICY crm_quotation_items_write ON public.crm_quotation_items FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('crm','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('crm','edit'));

-- Stage-definition lookup: read-only gate (no write policy = writes stay
-- definer/migration-only) -----------------------------------------------------
DROP POLICY IF EXISTS csd_read ON public.crm_client_stage_def;
DROP POLICY IF EXISTS crm_client_stage_def_read ON public.crm_client_stage_def;
CREATE POLICY crm_client_stage_def_read ON public.crm_client_stage_def FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('crm','view'));
