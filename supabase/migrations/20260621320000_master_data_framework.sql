-- Master-Data Framework (UX overhaul Wave 0): generic audit trail + archive.
-- Gives every master Create/Edit/Duplicate/Archive/Delete with a never-silent
-- change log. Additive only; does NOT touch production logic.
--   * master_audit_log: who/when/old/new/action/reason per master change.
--   * master_audit_trigger(): generic AFTER trigger — auto-captures every
--     insert/update/delete on any attached table (reads archived_at via jsonb so
--     it works on any table). Attached to cable_master + ppc_machines.
--   * archived_at columns: soft-delete (Archive) distinct from hard Delete.
--   * master_audit_set_reason(): annotate the latest audit row with a reason
--     (PostgREST can't share a txn-local GUC, so the UI calls this right after a
--     destructive action).
BEGIN;

CREATE TABLE IF NOT EXISTS public.master_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name        text NOT NULL,
  record_id         text,
  action            text NOT NULL,              -- insert|update|archive|restore|delete
  changed_by_email  text,
  changed_at        timestamptz DEFAULT now(),
  old_value         jsonb,
  new_value         jsonb,
  reason            text
);
CREATE INDEX IF NOT EXISTS master_audit_log_tr_idx
  ON public.master_audit_log (table_name, record_id, changed_at DESC);
ALTER TABLE public.master_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_audit_all ON public.master_audit_log;
CREATE POLICY master_audit_all ON public.master_audit_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.master_audit_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_action text;
  v_rid text;
BEGIN
  BEGIN v_email := public.current_user_email(); EXCEPTION WHEN OTHERS THEN v_email := NULL; END;
  IF TG_OP = 'INSERT' THEN
    v_action := 'insert'; v_rid := v_new->>'id';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete'; v_rid := v_old->>'id';
  ELSE
    v_rid := v_new->>'id';
    v_action := CASE
      WHEN (v_new->>'archived_at') IS NOT NULL AND (v_old->>'archived_at') IS NULL THEN 'archive'
      WHEN (v_new->>'archived_at') IS NULL AND (v_old->>'archived_at') IS NOT NULL THEN 'restore'
      ELSE 'update' END;
  END IF;
  INSERT INTO public.master_audit_log(table_name, record_id, action, changed_by_email, old_value, new_value)
    VALUES (TG_TABLE_NAME, v_rid, v_action, v_email, v_old, v_new);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

-- Annotate the latest audit row for a record with a reason (called by the UI
-- immediately after an archive/delete/edit that collected one).
CREATE OR REPLACE FUNCTION public.master_audit_set_reason(p_table text, p_record_id text, p_reason text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.master_audit_log SET reason = p_reason
  WHERE id = (SELECT id FROM public.master_audit_log
              WHERE table_name = p_table AND record_id = p_record_id
              ORDER BY changed_at DESC LIMIT 1);
$$;
GRANT EXECUTE ON FUNCTION public.master_audit_set_reason(text, text, text) TO authenticated;

-- Archive support (soft delete) on the two existing masters.
ALTER TABLE public.cable_master ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.ppc_machines ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DROP TRIGGER IF EXISTS trg_audit_cable_master ON public.cable_master;
CREATE TRIGGER trg_audit_cable_master AFTER INSERT OR UPDATE OR DELETE ON public.cable_master
  FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger();
DROP TRIGGER IF EXISTS trg_audit_ppc_machines ON public.ppc_machines;
CREATE TRIGGER trg_audit_ppc_machines AFTER INSERT OR UPDATE OR DELETE ON public.ppc_machines
  FOR EACH ROW EXECUTE FUNCTION public.master_audit_trigger();

COMMIT;
