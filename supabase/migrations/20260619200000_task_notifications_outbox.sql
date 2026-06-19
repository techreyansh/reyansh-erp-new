-- =====================================================================
-- 20260619200000_task_notifications_outbox.sql
-- Transactional notification outbox for task assignments.
--
-- Purpose
--   When a task is assigned (public.tasks.assigned_email present) we enqueue
--   outbox rows in public.task_notifications. A separate edge-function worker
--   (service-role, bypasses RLS) drains pending rows and dispatches them over
--   email / whatsapp. Reminder rows (T-24h, due-today, overdue) are scheduled
--   ahead of time and re-synced / cancelled when the task is completed or its
--   due_date changes.
--
-- Idempotency
--   Fully re-runnable: IF NOT EXISTS / CREATE OR REPLACE / guarded DO blocks.
--   Wrapped in a single BEGIN/COMMIT transaction.
--
-- IMPORTANT: This migration does NOT modify or drop the existing EM scoring
--   triggers on public.tasks:
--     - trg_tasks_set_original_due_date  (EM deadline tracking)  -- untouched
--     - trg_tasks_track_reschedule       (EM reschedule logging)  -- untouched
--   It ADDS two new triggers with distinct names:
--     - trg_tasks_enqueue_notifications  (AFTER INSERT)
--     - trg_tasks_sync_notifications     (AFTER UPDATE)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Outbox table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('email','whatsapp')),
  kind            text NOT NULL CHECK (kind IN ('assigned','reminder_t24','due_today','overdue')),
  recipient_email text,
  recipient_phone text,
  recipient_name  text,
  subject         text,
  body            text,
  scheduled_for   timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed','skipped','cancelled')),
  attempts        int NOT NULL DEFAULT 0,
  sent_at         timestamptz,
  error           text,
  payload         jsonb DEFAULT '{}'::jsonb,
  idempotency_key text UNIQUE,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_notifications_status_sched
  ON public.task_notifications (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_task_notifications_task_id
  ON public.task_notifications (task_id);
CREATE INDEX IF NOT EXISTS idx_task_notifications_recipient_email
  ON public.task_notifications (recipient_email);

-- ---------------------------------------------------------------------
-- 2) Helper: resolve a recipient phone from public.employees by email
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.task_resolve_phone(p_email text)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT e.phone
  FROM public.employees e
  WHERE lower(trim(e.email)) = lower(trim(p_email))
  LIMIT 1;
$fn$;

-- ---------------------------------------------------------------------
-- 3) AFTER INSERT: enqueue notifications for a newly assigned task
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tasks_enqueue_notifications()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_phone   text;
  v_subject text;
  v_body    text;
  v_t24     timestamptz;
  v_due     timestamptz;
  v_over    timestamptz;
BEGIN
  -- Nothing to enqueue without a recipient email.
  IF NEW.assigned_email IS NULL OR trim(NEW.assigned_email) = '' THEN
    RETURN NEW;
  END IF;

  v_phone := public.task_resolve_phone(NEW.assigned_email);

  v_subject := 'New task: ' || coalesce(NEW.title, '(untitled)');
  v_body :=
    'You have been assigned a new task.' || E'\n\n' ||
    'Title: '    || coalesce(NEW.title, '(untitled)')                    || E'\n' ||
    'Due date: ' || coalesce(NEW.due_date::text, 'no due date')          || E'\n' ||
    'Priority: ' || coalesce(NEW.priority::text, 'normal')               || E'\n\n' ||
    'Open it here: /my-tasks';

  -- 'assigned' notifications fire immediately on both channels.
  INSERT INTO public.task_notifications (
    task_id, channel, kind, recipient_email, recipient_phone, recipient_name,
    subject, body, scheduled_for, idempotency_key
  )
  VALUES
    (NEW.id, 'email',    'assigned', NEW.assigned_email, v_phone, NEW.assigned_name,
     v_subject, v_body, now(), NEW.id || ':assigned:email'),
    (NEW.id, 'whatsapp', 'assigned', NEW.assigned_email, v_phone, NEW.assigned_name,
     v_subject, v_body, now(), NEW.id || ':assigned:whatsapp')
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- Reminder schedule (only when a due date exists).
  IF NEW.due_date IS NOT NULL THEN
    v_t24  := NEW.due_date::timestamptz - interval '24 hours';
    v_due  := NEW.due_date::timestamptz + interval '8 hours';
    v_over := NEW.due_date::timestamptz + interval '32 hours';

    -- reminder_t24
    IF v_t24 > now() THEN
      INSERT INTO public.task_notifications (
        task_id, channel, kind, recipient_email, recipient_phone, recipient_name,
        subject, body, scheduled_for, idempotency_key
      )
      VALUES
        (NEW.id, 'email',    'reminder_t24', NEW.assigned_email, v_phone, NEW.assigned_name,
         'Reminder: ' || coalesce(NEW.title,'(untitled)') || ' is due in 24 hours',
         v_body, v_t24, NEW.id || ':reminder_t24:email'),
        (NEW.id, 'whatsapp', 'reminder_t24', NEW.assigned_email, v_phone, NEW.assigned_name,
         'Reminder: ' || coalesce(NEW.title,'(untitled)') || ' is due in 24 hours',
         v_body, v_t24, NEW.id || ':reminder_t24:whatsapp')
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- due_today
    IF v_due > now() THEN
      INSERT INTO public.task_notifications (
        task_id, channel, kind, recipient_email, recipient_phone, recipient_name,
        subject, body, scheduled_for, idempotency_key
      )
      VALUES
        (NEW.id, 'email',    'due_today', NEW.assigned_email, v_phone, NEW.assigned_name,
         'Due today: ' || coalesce(NEW.title,'(untitled)'),
         v_body, v_due, NEW.id || ':due_today:email'),
        (NEW.id, 'whatsapp', 'due_today', NEW.assigned_email, v_phone, NEW.assigned_name,
         'Due today: ' || coalesce(NEW.title,'(untitled)'),
         v_body, v_due, NEW.id || ':due_today:whatsapp')
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- overdue
    IF v_over > now() THEN
      INSERT INTO public.task_notifications (
        task_id, channel, kind, recipient_email, recipient_phone, recipient_name,
        subject, body, scheduled_for, idempotency_key
      )
      VALUES
        (NEW.id, 'email',    'overdue', NEW.assigned_email, v_phone, NEW.assigned_name,
         'Overdue: ' || coalesce(NEW.title,'(untitled)'),
         v_body, v_over, NEW.id || ':overdue:email'),
        (NEW.id, 'whatsapp', 'overdue', NEW.assigned_email, v_phone, NEW.assigned_name,
         'Overdue: ' || coalesce(NEW.title,'(untitled)'),
         v_body, v_over, NEW.id || ':overdue:whatsapp')
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_tasks_enqueue_notifications ON public.tasks;
CREATE TRIGGER trg_tasks_enqueue_notifications
AFTER INSERT ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_enqueue_notifications();

-- ---------------------------------------------------------------------
-- 4) AFTER UPDATE: keep pending reminders in sync with task changes
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tasks_sync_notifications()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_t24  timestamptz;
  v_due  timestamptz;
  v_over timestamptz;
BEGIN
  -- (a) Task just completed -> cancel pending reminder rows.
  IF NEW.task_status = 'completed'
     AND coalesce(OLD.task_status, '') <> 'completed' THEN
    UPDATE public.task_notifications
       SET status = 'cancelled'
     WHERE task_id = NEW.id
       AND status = 'pending'
       AND kind IN ('reminder_t24','due_today','overdue');
  END IF;

  -- (b) Due date changed (and is non-null) -> recompute pending reminder times.
  IF NEW.due_date IS DISTINCT FROM OLD.due_date AND NEW.due_date IS NOT NULL THEN
    v_t24  := NEW.due_date::timestamptz - interval '24 hours';
    v_due  := NEW.due_date::timestamptz + interval '8 hours';
    v_over := NEW.due_date::timestamptz + interval '32 hours';

    -- Reschedule each pending reminder to its recomputed time.
    UPDATE public.task_notifications
       SET scheduled_for = CASE kind
                             WHEN 'reminder_t24' THEN v_t24
                             WHEN 'due_today'    THEN v_due
                             WHEN 'overdue'      THEN v_over
                           END
     WHERE task_id = NEW.id
       AND status = 'pending'
       AND kind IN ('reminder_t24','due_today','overdue');

    -- Cancel any pending reminder whose recomputed time is now in the past.
    UPDATE public.task_notifications
       SET status = 'cancelled'
     WHERE task_id = NEW.id
       AND status = 'pending'
       AND kind IN ('reminder_t24','due_today','overdue')
       AND scheduled_for <= now();
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_tasks_sync_notifications ON public.tasks;
CREATE TRIGGER trg_tasks_sync_notifications
AFTER UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_sync_notifications();

-- ---------------------------------------------------------------------
-- 5) Row Level Security
--    A user sees their own notifications; service-role bypasses RLS.
-- ---------------------------------------------------------------------
ALTER TABLE public.task_notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.task_notifications TO authenticated;

DO $rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'task_notifications'
      AND policyname = 'task_notifications_own_or_super'
  ) THEN
    CREATE POLICY task_notifications_own_or_super
      ON public.task_notifications
      FOR ALL
      TO authenticated
      USING (
        public.is_super_admin()
        OR lower(coalesce(recipient_email, '')) = public.rbac_current_email()
      )
      WITH CHECK (
        public.is_super_admin()
        OR lower(coalesce(recipient_email, '')) = public.rbac_current_email()
      );
  END IF;
END;
$rls$;

-- ---------------------------------------------------------------------
-- 6) RPC: my_task_notifications() — in-app bell feed
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_task_notifications()
RETURNS SETOF public.task_notifications
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT *
  FROM public.task_notifications
  WHERE lower(coalesce(recipient_email, '')) = public.rbac_current_email()
  ORDER BY scheduled_for DESC
  LIMIT 50;
$fn$;

GRANT EXECUTE ON FUNCTION public.my_task_notifications() TO authenticated;

COMMIT;
