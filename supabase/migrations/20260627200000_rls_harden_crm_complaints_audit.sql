-- RLS hardening — Slice 3: CRM complaints + activity audit → 'crm' module.
-- Both were FOR ALL USING(true). crm_complaints is read only by the CRM-360
-- (client360Service.js:22); crm_activity_audit is read by crmPipelineService and
-- written by the crm_activity_audit_trg() trigger which is SECURITY DEFINER (so it
-- bypasses RLS — gating writes can't break activity edits). Gate both to crm:
-- read=view, write=edit, + is_super_admin bypass. Idempotent.

-- Customer complaints ---------------------------------------------------------
DROP POLICY IF EXISTS crm_complaints_all ON public.crm_complaints;
DROP POLICY IF EXISTS crm_complaints_read ON public.crm_complaints;
DROP POLICY IF EXISTS crm_complaints_write ON public.crm_complaints;

CREATE POLICY crm_complaints_read ON public.crm_complaints
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('crm','view'));

CREATE POLICY crm_complaints_write ON public.crm_complaints
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('crm','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('crm','edit'));

-- Activity audit trail (writes come from a SECURITY DEFINER trigger) -----------
DROP POLICY IF EXISTS crm_activity_audit_all ON public.crm_activity_audit;
DROP POLICY IF EXISTS crm_activity_audit_read ON public.crm_activity_audit;
DROP POLICY IF EXISTS crm_activity_audit_write ON public.crm_activity_audit;

CREATE POLICY crm_activity_audit_read ON public.crm_activity_audit
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('crm','view'));

CREATE POLICY crm_activity_audit_write ON public.crm_activity_audit
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.rbac_employee_can('crm','edit'))
  WITH CHECK (public.is_super_admin() OR public.rbac_employee_can('crm','edit'));
