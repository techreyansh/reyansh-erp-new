-- Link tasks to a CRM account so the Client/Prospect 360 "Tasks" tab can show and
-- create account-scoped tasks. Additive + nullable: existing tasks are unaffected.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.crm_pipeline(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_account_id
  ON public.tasks(account_id) WHERE account_id IS NOT NULL;
