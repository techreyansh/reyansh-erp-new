-- Email Campaigns module — backend foundation
-- A self-contained outbound-email engine that lives under the CRM module:
--   * email_contacts        : unified audience (CRM + CSV import + manual), deduped by email
--   * email_campaigns       : a sequence with an AI brief/tone + sending guardrails
--   * email_campaign_steps  : ordered steps, each a {delay, goal} the AI writes copy toward
--   * email_enrollments     : a contact's run through a campaign (current step, next_send_at)
--   * email_messages        : generated + sent log AND the human review queue
--   * email_accounts        : linked Gmail sending accounts (offline OAuth refresh token)
--   * email_events          : open/reply/bounce audit trail
--
-- Reuses helpers from 20260424220000_crm_ppc_workflow_backend.sql:
--   public.current_user_is_admin(), public.current_user_role_code()
-- Edge Functions talk to these tables with the service role (bypasses RLS).
-- Idempotent: safe to re-run.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Roles allowed to operate the email/marketing module.
-- Mirrors the CRM role set so the same team that owns leads owns outreach.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_can_email()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_is_admin()
     OR public.current_user_role_code() IN
        ('SALES_EXECUTIVE', 'CUSTOMER_RELATIONS_MANAGER', 'SALES', 'CRM', 'MARKETING');
$$;

-- ---------------------------------------------------------------------------
-- 1. email_contacts — the audience
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  first_name       text,
  last_name        text,
  full_name        text,
  company          text,
  title            text,
  phone            text,
  -- where this contact came from
  source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual', 'import', 'crm', 'customer')),
  crm_lead_id      uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  import_batch_id  uuid,
  -- free-form data the AI can use to personalize (industry, last_order, city, etc.)
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags             text[] NOT NULL DEFAULT '{}',
  -- deliverability / consent
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'unsubscribed', 'bounced', 'complained')),
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  unsubscribed_at  timestamptz,
  bounced_at       timestamptz,
  last_contacted_at timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- one row per email address (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_contacts_email
  ON public.email_contacts (lower(email));
CREATE INDEX IF NOT EXISTS idx_email_contacts_status ON public.email_contacts(status);
CREATE INDEX IF NOT EXISTS idx_email_contacts_source ON public.email_contacts(source);
CREATE INDEX IF NOT EXISTS idx_email_contacts_crm_lead ON public.email_contacts(crm_lead_id);
CREATE INDEX IF NOT EXISTS idx_email_contacts_tags ON public.email_contacts USING gin(tags);

-- ---------------------------------------------------------------------------
-- 2. email_import_batches — provenance for CSV uploads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_import_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text,
  filename      text,
  total_rows    integer NOT NULL DEFAULT 0,
  imported_rows integer NOT NULL DEFAULT 0,
  skipped_rows  integer NOT NULL DEFAULT 0,
  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- late FK now that the batch table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'email_contacts_import_batch_fk'
  ) THEN
    ALTER TABLE public.email_contacts
      ADD CONSTRAINT email_contacts_import_batch_fk
      FOREIGN KEY (import_batch_id)
      REFERENCES public.email_import_batches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. email_accounts — linked Gmail sender (offline OAuth)
--    refresh_token enables the scheduler to send in the background.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid(),
  email            text NOT NULL,
  display_name     text,
  provider         text NOT NULL DEFAULT 'gmail',
  refresh_token    text,
  access_token     text,
  token_expires_at timestamptz,
  scopes           text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'connected'
                     CHECK (status IN ('connected', 'expired', 'revoked', 'error')),
  -- rolling counter for the daily send cap (reset by the scheduler each day)
  sent_today       integer NOT NULL DEFAULT 0,
  sent_today_date  date,
  last_error       text,
  connected_at     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);
CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON public.email_accounts(user_id);

-- ---------------------------------------------------------------------------
-- 4. email_campaigns — a sequence definition
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  description        text,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  -- overall context fed to the AI on every generation
  ai_brief           text,            -- what we sell / who we are / the offer
  ai_tone            text DEFAULT 'professional, warm, concise',
  ai_signature       text,            -- sign-off block appended/realized by the AI
  -- sending
  sending_account_id uuid REFERENCES public.email_accounts(id) ON DELETE SET NULL,
  from_name          text,
  -- guardrails
  daily_send_cap     integer NOT NULL DEFAULT 200,
  send_window_start  smallint NOT NULL DEFAULT 9   CHECK (send_window_start BETWEEN 0 AND 23),
  send_window_end    smallint NOT NULL DEFAULT 18  CHECK (send_window_end BETWEEN 0 AND 23),
  send_on_weekends   boolean NOT NULL DEFAULT false,
  review_before_send boolean NOT NULL DEFAULT true,  -- AI draft must be approved first
  stop_on_reply      boolean NOT NULL DEFAULT true,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON public.email_campaigns(status);

-- ---------------------------------------------------------------------------
-- 5. email_campaign_steps — ordered steps in a sequence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_campaign_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  step_order    integer NOT NULL,           -- 1-based
  -- delay measured from the previous step's send (step 1 = from enrollment)
  delay_days    integer NOT NULL DEFAULT 0 CHECK (delay_days >= 0),
  delay_hours   integer NOT NULL DEFAULT 0 CHECK (delay_hours >= 0),
  -- what this email should accomplish; the AI writes fresh copy toward it
  goal          text NOT NULL,
  subject_hint  text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, step_order)
);
CREATE INDEX IF NOT EXISTS idx_email_steps_campaign ON public.email_campaign_steps(campaign_id);

-- ---------------------------------------------------------------------------
-- 6. email_enrollments — a contact running through a campaign
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_enrollments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES public.email_contacts(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'completed', 'paused', 'replied',
                                    'unsubscribed', 'bounced', 'failed')),
  current_step  integer NOT NULL DEFAULT 0,     -- last step number sent; 0 = none yet
  next_send_at  timestamptz NOT NULL DEFAULT now(),
  last_sent_at  timestamptz,
  gmail_thread_id text,                          -- keep the whole sequence in one thread
  replied_at    timestamptz,
  enrolled_by   uuid,
  enrolled_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);
-- the scheduler's hot query: active enrollments that are due
CREATE INDEX IF NOT EXISTS idx_email_enrollments_due
  ON public.email_enrollments(next_send_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_email_enrollments_campaign ON public.email_enrollments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_enrollments_contact ON public.email_enrollments(contact_id);

-- ---------------------------------------------------------------------------
-- 7. email_messages — generated drafts, the review queue, and the sent log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id   uuid REFERENCES public.email_enrollments(id) ON DELETE CASCADE,
  campaign_id     uuid REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES public.email_contacts(id) ON DELETE SET NULL,
  step_id         uuid REFERENCES public.email_campaign_steps(id) ON DELETE SET NULL,
  step_order      integer,
  to_email        text,
  subject         text,
  body            text,                          -- the generated copy (text/markdown)
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending_review', 'approved', 'queued',
                                      'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  generated_by_ai boolean NOT NULL DEFAULT true,
  ai_model        text,
  edited_by       uuid,                          -- if a human tweaked the draft
  approved_by     uuid,
  approved_at     timestamptz,
  gmail_message_id text,
  gmail_thread_id  text,
  scheduled_for   timestamptz,
  sent_at         timestamptz,
  opened_at       timestamptz,
  replied_at      timestamptz,
  error           text,
  retry_count     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON public.email_messages(status);
CREATE INDEX IF NOT EXISTS idx_email_messages_campaign ON public.email_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_enrollment ON public.email_messages(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_review
  ON public.email_messages(created_at)
  WHERE status = 'pending_review';

-- ---------------------------------------------------------------------------
-- 8. email_events — open / click / reply / bounce audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid REFERENCES public.email_messages(id) ON DELETE CASCADE,
  contact_id  uuid REFERENCES public.email_contacts(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  type        text NOT NULL
                CHECK (type IN ('sent', 'delivered', 'opened', 'clicked',
                                'replied', 'bounced', 'complained', 'unsubscribed')),
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_events_message ON public.email_events(message_id);
CREATE INDEX IF NOT EXISTS idx_email_events_campaign_type ON public.email_events(campaign_id, type);

-- ---------------------------------------------------------------------------
-- updated_at touch trigger (shared)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'email_contacts','email_accounts','email_campaigns',
    'email_enrollments','email_messages'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON public.%I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.email_touch_updated_at();', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Helper RPC: upsert a contact (used by CSV import + "pull from CRM").
-- Dedups on lower(email); merges attributes; never clobbers good data with null.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_upsert_contact(
  p_email      text,
  p_first_name text DEFAULT NULL,
  p_last_name  text DEFAULT NULL,
  p_company    text DEFAULT NULL,
  p_title      text DEFAULT NULL,
  p_phone      text DEFAULT NULL,
  p_source     text DEFAULT 'manual',
  p_crm_lead_id uuid DEFAULT NULL,
  p_attributes jsonb DEFAULT '{}'::jsonb,
  p_tags       text[] DEFAULT '{}',
  p_import_batch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_email IS NULL OR position('@' in p_email) = 0 THEN
    RAISE EXCEPTION 'invalid email: %', p_email;
  END IF;

  INSERT INTO public.email_contacts AS c
    (email, first_name, last_name, full_name, company, title, phone,
     source, crm_lead_id, attributes, tags, import_batch_id, created_by)
  VALUES
    (lower(trim(p_email)), p_first_name, p_last_name,
     NULLIF(trim(concat_ws(' ', p_first_name, p_last_name)), ''),
     p_company, p_title, p_phone,
     p_source, p_crm_lead_id, COALESCE(p_attributes, '{}'::jsonb),
     COALESCE(p_tags, '{}'), p_import_batch_id, auth.uid())
  ON CONFLICT (lower(email)) DO UPDATE SET
     first_name  = COALESCE(c.first_name, EXCLUDED.first_name),
     last_name   = COALESCE(c.last_name,  EXCLUDED.last_name),
     full_name   = COALESCE(c.full_name,  EXCLUDED.full_name),
     company     = COALESCE(c.company,    EXCLUDED.company),
     title       = COALESCE(c.title,      EXCLUDED.title),
     phone       = COALESCE(c.phone,      EXCLUDED.phone),
     crm_lead_id = COALESCE(c.crm_lead_id, EXCLUDED.crm_lead_id),
     attributes  = c.attributes || COALESCE(EXCLUDED.attributes, '{}'::jsonb),
     tags        = (SELECT array(SELECT DISTINCT unnest(c.tags || EXCLUDED.tags))),
     updated_at  = now()
  RETURNING c.id INTO v_id;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- Helper RPC: enroll a set of contacts into a campaign (skips dups / opted-out).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_enroll_contacts(
  p_campaign_id uuid,
  p_contact_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.email_enrollments (campaign_id, contact_id, next_send_at, enrolled_by)
  SELECT p_campaign_id, c.id, now(), auth.uid()
  FROM public.email_contacts c
  WHERE c.id = ANY(p_contact_ids)
    AND c.status = 'active'
  ON CONFLICT (campaign_id, contact_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_import_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaign_steps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_enrollments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events          ENABLE ROW LEVEL SECURITY;

-- Marketing/CRM team manages the audience, campaigns, steps, enrollments, log.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'email_contacts','email_import_batches','email_campaigns',
    'email_campaign_steps','email_enrollments','email_messages','email_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_team_access ON public.%I;', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_team_access ON public.%I
      FOR ALL TO authenticated
      USING (public.current_user_can_email())
      WITH CHECK (public.current_user_can_email());
    $p$, t, t);
  END LOOP;
END $$;

-- email_accounts hold OAuth secrets: each user sees only their own linked accounts
-- (admins can see all, e.g. to audit a shared sender).
DROP POLICY IF EXISTS email_accounts_owner_access ON public.email_accounts;
CREATE POLICY email_accounts_owner_access ON public.email_accounts
FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.current_user_is_admin())
WITH CHECK (user_id = auth.uid() OR public.current_user_is_admin());

COMMIT;
