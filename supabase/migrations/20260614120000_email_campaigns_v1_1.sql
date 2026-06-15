-- Email Campaigns v1.1 — open tracking + reply detection.
--   * track_opens flag on campaigns (off by default: keep plain-text deliverability
--     unless the user opts into the HTML tracking pixel)
--   * index to match inbound Gmail replies back to active enrollments by thread id
-- Idempotent.

BEGIN;

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS track_opens boolean NOT NULL DEFAULT false;

-- email-poll-replies matches inbox threadIds against active enrollments.
CREATE INDEX IF NOT EXISTS idx_email_enrollments_thread
  ON public.email_enrollments(gmail_thread_id)
  WHERE gmail_thread_id IS NOT NULL AND status = 'active';

COMMIT;
