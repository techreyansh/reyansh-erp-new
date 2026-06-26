-- Follow-up/Task ownership hardening (server side):
--  1) crm_assign_owner now TRANSFERS open follow-ups (activities) to the new owner,
--     so reassigning an account moves its pending work — not just the card.
--  2) New activities inherit the parent account's owner when not supplied, so a
--     follow-up always belongs to the account owner.
--  3) Backfill: existing open activities with no owner inherit their account owner.

CREATE OR REPLACE FUNCTION public.crm_assign_owner(
  p_pipeline_id uuid,
  p_owner_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row     public.crm_pipeline%ROWTYPE;
  v_current text;
BEGIN
  SELECT owner_email INTO v_current FROM public.crm_pipeline WHERE id = p_pipeline_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline % not found', p_pipeline_id;
  END IF;

  IF NOT (
    public.is_super_admin()
    OR v_current IS NULL
    OR lower(coalesce(v_current,'')) = public.rbac_current_email()
  ) THEN
    RAISE EXCEPTION 'Not permitted to reassign owner';
  END IF;

  UPDATE public.crm_pipeline
     SET owner_email = lower(p_owner_email),
         updated_at  = now()
   WHERE id = p_pipeline_id
   RETURNING * INTO v_row;

  -- Transfer OPEN follow-ups (not completed/cancelled) to the new owner. Closed
  -- activities stay attributed to whoever did them (audit trail).
  UPDATE public.crm_pipeline_activity
     SET owner_email = lower(p_owner_email)
   WHERE pipeline_id = p_pipeline_id
     AND coalesce(status, 'open') NOT IN ('completed', 'cancelled');

  RETURN to_jsonb(v_row);
END;
$fn$;

-- A new activity inherits the account owner (then the current user) when no owner
-- is supplied — so follow-ups always belong to the account's owner.
CREATE OR REPLACE FUNCTION public.crm_activity_default_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_email IS NULL THEN
    SELECT owner_email INTO NEW.owner_email FROM public.crm_pipeline WHERE id = NEW.pipeline_id;
    IF NEW.owner_email IS NULL THEN
      NEW.owner_email := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crm_activity_default_owner ON public.crm_pipeline_activity;
CREATE TRIGGER trg_crm_activity_default_owner
  BEFORE INSERT ON public.crm_pipeline_activity
  FOR EACH ROW EXECUTE FUNCTION public.crm_activity_default_owner();

-- Backfill: open activities with no owner take their account's owner. Closed ones
-- are left as-is (history). NULL-owner activities on NULL-owner accounts stay
-- unassigned (they surface only in the manager 'Unassigned' view, not in anyone's
-- personal list).
UPDATE public.crm_pipeline_activity a
   SET owner_email = p.owner_email
  FROM public.crm_pipeline p
 WHERE a.pipeline_id = p.id
   AND a.owner_email IS NULL
   AND p.owner_email IS NOT NULL
   AND coalesce(a.status, 'open') NOT IN ('completed', 'cancelled');
