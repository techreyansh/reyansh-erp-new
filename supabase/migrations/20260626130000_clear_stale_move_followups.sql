-- Clear stale follow-ups created by stage moves. The move dialog used to stamp
-- next_follow_up_date on the auto-generated "Moved to <stage>" log activity, so
-- every stage move lingered in My Follow-ups as if it were a pending task. Those
-- logs are completed records, not follow-ups — close them.
UPDATE public.crm_pipeline_activity
   SET next_follow_up_date = NULL,
       status = 'completed'
 WHERE subject LIKE 'Moved to %'
   AND next_follow_up_date IS NOT NULL
   AND coalesce(status, 'open') <> 'completed';
