-- Make tasks / checklists / CRM pipeline live (realtime) for the personal dashboard.
BEGIN;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.task_instances REPLICA IDENTITY FULL;
ALTER TABLE public.crm_pipeline REPLICA IDENTITY FULL;
ALTER TABLE public.crm_pipeline_activity REPLICA IDENTITY FULL;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.task_instances; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_pipeline; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_pipeline_activity; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;
