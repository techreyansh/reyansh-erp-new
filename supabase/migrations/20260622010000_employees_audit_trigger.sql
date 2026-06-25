-- Capture employee changes in the shared master_audit_log (who / when / old /
-- new), reusing the generic master_audit_trigger() already used by the cable
-- masters. Going forward every insert/update/delete on employees is logged and
-- surfaced in the profile's Activity tab. Idempotent.

DROP TRIGGER IF EXISTS employees_master_audit ON public.employees;
CREATE TRIGGER employees_master_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger();
