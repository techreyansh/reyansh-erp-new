-- CRM in-app notifications (accountability loop).
-- When a rep is made the action owner of a next action, or added as a
-- collaborator, they get an in-app notification here. Separate from the
-- task_notifications outbox (which is task-FK'd + drained by an edge worker);
-- this is a lightweight in-app feed read by the CRM bell.
-- Additive + scoped RLS (recipient-only). Inserts happen ONLY via the
-- SECURITY DEFINER RPCs in the next migration, so no INSERT grant to clients.
BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_notification (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email text NOT NULL,
  type            text NOT NULL,            -- 'next_action_assigned' | 'collaborator_added'
  pipeline_id     uuid REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  title           text,
  body            text,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_notification_recipient
  ON public.crm_notification (lower(recipient_email), created_at DESC);

ALTER TABLE public.crm_notification ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.crm_notification TO authenticated;

-- Scoped: a user sees ONLY their own notifications (no USING(true)).
DO $rls$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='crm_notification'
      AND policyname='crm_notification_own_or_super'
  ) THEN
    CREATE POLICY crm_notification_own_or_super ON public.crm_notification
      FOR ALL TO authenticated
      USING (public.is_super_admin() OR lower(recipient_email) = public.rbac_current_email())
      WITH CHECK (public.is_super_admin() OR lower(recipient_email) = public.rbac_current_email());
  END IF;
END $rls$;

-- In-app feed for the current user (newest 50).
CREATE OR REPLACE FUNCTION public.my_crm_notifications()
RETURNS SETOF public.crm_notification
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.crm_notification
  WHERE lower(recipient_email) = public.rbac_current_email()
  ORDER BY created_at DESC
  LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION public.my_crm_notifications() TO authenticated;

-- Mark some/all of my notifications read.
CREATE OR REPLACE FUNCTION public.crm_notification_mark_read(p_ids uuid[] DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.crm_notification SET read_at = now()
  WHERE lower(recipient_email) = public.rbac_current_email()
    AND read_at IS NULL
    AND (p_ids IS NULL OR id = ANY(p_ids));
$$;
GRANT EXECUTE ON FUNCTION public.crm_notification_mark_read(uuid[]) TO authenticated;

COMMIT;
