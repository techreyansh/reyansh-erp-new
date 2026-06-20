-- PART B / Stage 3 (DB): make CRM activities first-class & editable.
-- Adds outcome/status/completed_at/updated_at to crm_pipeline_activity and an
-- audit trail (crm_activity_audit) capturing every edit/delete. RLS already
-- permits owners; edit/delete happen via normal table DML from the UI.
BEGIN;

ALTER TABLE public.crm_pipeline_activity ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE public.crm_pipeline_activity ADD COLUMN IF NOT EXISTS status text DEFAULT 'open';
ALTER TABLE public.crm_pipeline_activity ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.crm_pipeline_activity ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
DO $s$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_activity_status_check') THEN
    ALTER TABLE public.crm_pipeline_activity ADD CONSTRAINT crm_activity_status_check
      CHECK (status IS NULL OR status IN ('open','completed','cancelled'));
  END IF;
END $s$;
CREATE INDEX IF NOT EXISTS idx_crm_activity_followup ON public.crm_pipeline_activity(next_follow_up_date);

-- Audit trail for edits/deletes.
CREATE TABLE IF NOT EXISTS public.crm_activity_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid,
  pipeline_id uuid,
  action text NOT NULL,                 -- 'updated' | 'deleted'
  changed_by_email text,
  changed_at timestamptz DEFAULT now(),
  before_data jsonb,
  after_data jsonb
);
CREATE INDEX IF NOT EXISTS idx_crm_activity_audit_activity ON public.crm_activity_audit(activity_id);
ALTER TABLE public.crm_activity_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_activity_audit_all ON public.crm_activity_audit;
CREATE POLICY crm_activity_audit_all ON public.crm_activity_audit FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.crm_activity_audit_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text := public.rbac_current_email();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      NEW.updated_at := now();
      INSERT INTO public.crm_activity_audit(activity_id, pipeline_id, action, changed_by_email, before_data, after_data)
      VALUES (OLD.id, OLD.pipeline_id, 'updated', v_email, to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.crm_activity_audit(activity_id, pipeline_id, action, changed_by_email, before_data)
    VALUES (OLD.id, OLD.pipeline_id, 'deleted', v_email, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_activity_audit_upd ON public.crm_pipeline_activity;
CREATE TRIGGER trg_crm_activity_audit_upd BEFORE UPDATE ON public.crm_pipeline_activity
  FOR EACH ROW EXECUTE FUNCTION public.crm_activity_audit_trg();
DROP TRIGGER IF EXISTS trg_crm_activity_audit_del ON public.crm_pipeline_activity;
CREATE TRIGGER trg_crm_activity_audit_del AFTER DELETE ON public.crm_pipeline_activity
  FOR EACH ROW EXECUTE FUNCTION public.crm_activity_audit_trg();

COMMIT;
