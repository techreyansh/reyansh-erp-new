-- KIT (Keep In Touch) — a channel-agnostic COMMUNICATION ENGINE on top of the
-- unified CRM master (crm_pipeline + crm_account_contacts). No duplicate contact
-- DB; CRM is the source. Engine supports whatsapp/email/sms/push/portal; every
-- logged message mirrors into the CRM activity timeline (single history).
-- Includes templates, an automation-workflow foundation, contact intelligence,
-- and a dashboard. Real channel APIs (WhatsApp Business, Gmail) wire in later.
BEGIN;

-- 1) Templates (per channel + category). Variables filled from CRM context.
CREATE TABLE IF NOT EXISTS public.kit_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','sms','push','portal')),
  category text NOT NULL,
  name text NOT NULL,
  subject text,
  body text NOT NULL,
  is_active boolean DEFAULT true,
  created_by_email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2) Messages — the channel-agnostic engine log / outbox.
CREATE TABLE IF NOT EXISTS public.kit_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.crm_account_contacts(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','sms','push','portal')),
  template_id uuid REFERENCES public.kit_templates(id) ON DELETE SET NULL,
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  recipient text,            -- phone / email actually used
  subject text,
  body text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','scheduled','sent','delivered','read','failed','skipped')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  owner_email text,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kit_messages_account ON public.kit_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_kit_messages_created ON public.kit_messages(created_at DESC);

-- 3) Automation workflows — FOUNDATION ONLY (not executed yet).
CREATE TABLE IF NOT EXISTS public.kit_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  trigger_type text,                 -- new_prospect | quotation_sent | no_interaction | no_orders | birthday | festival | manual
  trigger_config jsonb DEFAULT '{}'::jsonb,
  steps jsonb DEFAULT '[]'::jsonb,    -- [{wait_days, channel, template_id}] etc.
  is_active boolean DEFAULT false,
  created_by_email text,
  created_at timestamptz DEFAULT now()
);

DO $rls$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kit_templates','kit_messages','kit_workflows'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $rls$;

-- 4) Log a KIT message + mirror into the CRM timeline (single history).
CREATE OR REPLACE FUNCTION public.kit_log_message(
  p_account_id uuid, p_channel text, p_subject text DEFAULT NULL, p_body text DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_template_id uuid DEFAULT NULL, p_recipient text DEFAULT NULL,
  p_scheduled_for timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text := public.rbac_current_email(); v_id uuid; v_status text; v_acttype text;
BEGIN
  v_status := CASE WHEN p_scheduled_for IS NOT NULL AND p_scheduled_for > now() THEN 'scheduled' ELSE 'sent' END;
  INSERT INTO public.kit_messages(account_id, contact_id, channel, template_id, recipient, subject, body, status, scheduled_for, sent_at, owner_email)
  VALUES (p_account_id, p_contact_id, p_channel, p_template_id, p_recipient, p_subject, p_body, v_status, p_scheduled_for,
          CASE WHEN v_status='sent' THEN now() END, v_email)
  RETURNING id INTO v_id;
  -- mirror into CRM activity timeline (only for already-sent)
  IF v_status = 'sent' AND p_account_id IS NOT NULL THEN
    v_acttype := CASE p_channel WHEN 'whatsapp' THEN 'whatsapp' WHEN 'email' THEN 'email' ELSE 'note' END;
    INSERT INTO public.crm_pipeline_activity(pipeline_id, activity_type, subject, body, owner_email, activity_at, status)
    VALUES (p_account_id, v_acttype, COALESCE(NULLIF(p_subject,''), initcap(p_channel)||' message'), p_body, v_email, now(), 'completed');
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'status', v_status);
END;
$$;
GRANT EXECUTE ON FUNCTION public.kit_log_message(uuid,text,text,text,uuid,uuid,text,timestamptz) TO authenticated;

-- 5) Contact intelligence view (per account) — last touchpoints + engagement.
CREATE OR REPLACE VIEW public.v_kit_contacts WITH (security_invoker = true) AS
WITH last_act AS (
  SELECT pipeline_id,
    max(activity_at) FILTER (WHERE activity_type='call')     AS last_call,
    max(activity_at) FILTER (WHERE activity_type='meeting')  AS last_meeting,
    max(activity_at) FILTER (WHERE activity_type='whatsapp') AS last_whatsapp,
    max(activity_at) FILTER (WHERE activity_type='email')    AS last_email,
    max(activity_at) AS last_touch, count(*) AS interactions
  FROM public.crm_pipeline_activity GROUP BY pipeline_id
)
SELECT p.id AS account_id, p.company_name, p.account_type, p.prospect_stage, p.client_stage,
  p.customer_category, p.owner_email, p.phone, p.email, p.industry, p.city, p.lead_source,
  ((p.phone IS NOT NULL AND p.phone <> '')
    OR EXISTS (SELECT 1 FROM public.crm_account_contacts ct WHERE ct.account_id=p.id AND ct.phone IS NOT NULL AND ct.phone<>'')) AS whatsapp_enabled,
  ((p.email IS NOT NULL AND p.email <> '')
    OR EXISTS (SELECT 1 FROM public.crm_account_contacts ct WHERE ct.account_id=p.id AND ct.email IS NOT NULL AND ct.email<>'')) AS email_enabled,
  la.last_call, la.last_meeting, la.last_whatsapp, la.last_email, la.last_touch,
  COALESCE(la.interactions,0) AS interactions,
  CASE WHEN la.last_touch IS NULL THEN NULL ELSE (current_date - la.last_touch::date) END AS days_since_touch,
  -- engagement 0..100: recency (60%) + frequency (40%)
  GREATEST(0, LEAST(100, round(
    0.6 * GREATEST(0, 100 - COALESCE(current_date - la.last_touch::date, 120)) +
    0.4 * LEAST(100, COALESCE(la.interactions,0) * 12)
  )))::int AS engagement_score,
  (la.last_touch IS NULL OR (current_date - la.last_touch::date) > 30) AS needs_followup,
  (p.account_type='client' AND (la.last_touch IS NULL OR (current_date - la.last_touch::date) > 60)) AS at_risk
FROM public.crm_pipeline p
LEFT JOIN last_act la ON la.pipeline_id = p.id;
GRANT SELECT ON public.v_kit_contacts TO authenticated;

-- 6) Dashboard.
CREATE OR REPLACE FUNCTION public.kit_dashboard()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'total_contacts',    (SELECT count(*) FROM public.crm_pipeline),
    'whatsapp_enabled',  (SELECT count(*) FROM public.v_kit_contacts WHERE whatsapp_enabled),
    'email_enabled',     (SELECT count(*) FROM public.v_kit_contacts WHERE email_enabled),
    'no_communication',  (SELECT count(*) FROM public.v_kit_contacts WHERE last_touch IS NULL),
    'messages_this_month',(SELECT count(*) FROM public.kit_messages WHERE created_at >= date_trunc('month', now())),
    'open_followups',    (SELECT count(*) FROM public.crm_pipeline_activity WHERE status='open' AND next_follow_up_date IS NOT NULL),
    'needs_attention',   (SELECT count(*) FROM public.v_kit_contacts WHERE needs_followup),
    'at_risk',           (SELECT count(*) FROM public.v_kit_contacts WHERE at_risk),
    'avg_engagement',    (SELECT COALESCE(round(avg(engagement_score)),0) FROM public.v_kit_contacts)
  );
$$;
GRANT EXECUTE ON FUNCTION public.kit_dashboard() TO authenticated;

-- 7) Seed default templates (the categories requested).
INSERT INTO public.kit_templates (channel, category, name, subject, body)
SELECT * FROM (VALUES
  ('whatsapp','intro','Introduction', NULL, 'Hi {contact}, this is {me} from Reyansh International. We manufacture wires, power cords and wiring harnesses. Would love to explore how we can support {company}.'),
  ('whatsapp','follow_up','Follow-up', NULL, 'Hi {contact}, following up on our earlier conversation regarding {company}''s requirements. Any updates we can help with?'),
  ('whatsapp','sample_follow','Sample Follow-up', NULL, 'Hi {contact}, hope the samples reached you. Any feedback on the {industry} application we discussed for {company}?'),
  ('whatsapp','quotation_follow','Quotation Follow-up', NULL, 'Hi {contact}, just checking on the quotation we shared for {company}. Happy to revise on specs or pricing.'),
  ('whatsapp','payment_reminder','Payment Reminder', NULL, 'Hi {contact}, a gentle reminder regarding the pending payment for {company}. Kindly advise on the status.'),
  ('whatsapp','festival','Festival Greetings', NULL, 'Warm festive greetings to you and the {company} team from all of us at Reyansh International!'),
  ('whatsapp','check_in','Check-in', NULL, 'Hi {contact}, hope all is well at {company}. Any upcoming sourcing requirements where we can support your team?'),
  ('email','company_intro','Company Introduction','Reyansh International — Wires, Cords & Harnesses','Dear {contact},%0AReyansh International manufactures electrical cables, power cords and wiring harnesses for OEMs. We would value the opportunity to support {company}.'),
  ('email','product_intro','Product Introduction','Product capabilities for {company}','Dear {contact},%0ASharing our product range relevant to your {industry} applications.'),
  ('email','follow_up','Follow-up','Following up — {company}','Dear {contact},%0AFollowing up on our discussion. Please let me know how we can take this forward.'),
  ('email','quotation_follow','Quotation Follow-up','Your quotation — {company}','Dear {contact},%0AChecking in on the quotation shared. Happy to assist with any clarifications.')
) AS v(channel,category,name,subject,body)
WHERE NOT EXISTS (SELECT 1 FROM public.kit_templates t WHERE t.category = v.category AND t.channel = v.channel);

COMMIT;
