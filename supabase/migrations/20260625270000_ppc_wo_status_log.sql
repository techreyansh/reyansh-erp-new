-- R4 (Order Tracking): who-changed-WO-status-when audit log.
-- A trigger on ppc_wo captures EVERY status change (creation, stage rollups,
-- finish, cancel) regardless of which RPC made it — no per-RPC wiring needed.

CREATE TABLE IF NOT EXISTS public.ppc_wo_status_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id            uuid NOT NULL REFERENCES public.ppc_wo(id) ON DELETE CASCADE,
  old_status       text,
  new_status       text NOT NULL,
  changed_by_email text,
  changed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppc_wo_status_log_wo
  ON public.ppc_wo_status_log (wo_id, changed_at DESC);

ALTER TABLE public.ppc_wo_status_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ppc_wo_status_log_read ON public.ppc_wo_status_log;
CREATE POLICY ppc_wo_status_log_read ON public.ppc_wo_status_log
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.ppc_wo_status_log TO authenticated;

CREATE OR REPLACE FUNCTION public.ppc_wo_log_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.ppc_wo_status_log (wo_id, old_status, new_status, changed_by_email)
    VALUES (NEW.id, NULL, NEW.status, (auth.jwt() ->> 'email'));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.ppc_wo_status_log (wo_id, old_status, new_status, changed_by_email)
    VALUES (NEW.id, OLD.status, NEW.status, (auth.jwt() ->> 'email'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ppc_wo_status_log ON public.ppc_wo;
CREATE TRIGGER trg_ppc_wo_status_log
  AFTER INSERT OR UPDATE OF status ON public.ppc_wo
  FOR EACH ROW EXECUTE FUNCTION public.ppc_wo_log_status_change();
