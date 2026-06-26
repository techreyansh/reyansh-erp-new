-- "A new action supersedes the previous one." When a new activity is logged on an
-- account, auto-complete the prior OPEN activities so only the latest stays active
-- (and the older follow-ups stop lingering as Open/Overdue). Enforced as a trigger
-- so it applies everywhere a new activity is created.

CREATE OR REPLACE FUNCTION public.crm_activity_supersede_prior()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.crm_pipeline_activity
     SET status = 'completed',
         next_follow_up_date = NULL
   WHERE pipeline_id = NEW.pipeline_id
     AND id <> NEW.id
     AND coalesce(status, 'open') NOT IN ('completed', 'cancelled')
     AND coalesce(activity_at, created_at) <= coalesce(NEW.activity_at, NEW.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_activity_supersede ON public.crm_pipeline_activity;
CREATE TRIGGER trg_crm_activity_supersede
  AFTER INSERT ON public.crm_pipeline_activity
  FOR EACH ROW EXECUTE FUNCTION public.crm_activity_supersede_prior();

-- One-time backfill: collapse every account to a single active follow-up — keep
-- the most recently logged open activity, complete the rest.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY pipeline_id
           ORDER BY coalesce(activity_at, created_at) DESC, id DESC
         ) AS rn
    FROM public.crm_pipeline_activity
   WHERE coalesce(status, 'open') NOT IN ('completed', 'cancelled')
)
UPDATE public.crm_pipeline_activity a
   SET status = 'completed',
       next_follow_up_date = NULL
  FROM ranked r
 WHERE a.id = r.id
   AND r.rn > 1;
