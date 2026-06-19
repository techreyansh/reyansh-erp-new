-- =====================================================================
-- 20260619160000_crm_pipeline.sql
-- Pipeline-driven CRM with per-user ownership (CEO/super-admin sees all).
-- Idempotent: IF NOT EXISTS / OR REPLACE / guarded DO blocks.
-- Reuses existing helpers: public.is_super_admin(), public.rbac_current_email().
-- DO NOT EXECUTE STANDALONE PIECES — run from the first line.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- PART 1: public.crm_pipeline  (one row per company relationship)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_pipeline (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name      text NOT NULL,
  customer_code     text,                              -- links to clients2/prospects_clients "ClientCode" (nullable for brand-new prospects)
  kind              text NOT NULL DEFAULT 'prospect'
                      CHECK (kind IN ('prospect','recurring')),
  stage             text NOT NULL DEFAULT 'cold_call'
                      CHECK (stage IN ('cold_call','data_shared','rfq_samples','quotation',
                                       'counter_samples','sample_approval','qc_audit',
                                       'pilot_lot','recurring_client')),
  owner_email       text,
  contact_person    text,
  phone             text,
  email             text,
  source            text,
  value             numeric DEFAULT 0,
  next_action       text,
  next_action_date  date,
  notes             text,
  won_at            timestamptz,
  is_active         boolean NOT NULL DEFAULT true,
  stage_entered_at  timestamptz NOT NULL DEFAULT now(),
  created_by_email  text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_pipeline_kind_stage_idx ON public.crm_pipeline (kind, stage);
CREATE INDEX IF NOT EXISTS crm_pipeline_owner_email_idx ON public.crm_pipeline (owner_email);
-- dedupe guard on normalized company name
CREATE UNIQUE INDEX IF NOT EXISTS crm_pipeline_company_name_uniq
  ON public.crm_pipeline (lower(coalesce(company_name,'')));

-- ---------------------------------------------------------------------
-- PART 2: public.crm_pipeline_history  (stage transition log)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_pipeline_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id     uuid REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  from_stage      text,
  to_stage        text,
  moved_by_email  text,
  note            text,
  moved_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_pipeline_history_pipeline_id_idx
  ON public.crm_pipeline_history (pipeline_id);

-- ---------------------------------------------------------------------
-- PART 3: public.crm_pipeline_activity  (touchpoints / follow-ups)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_pipeline_activity (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id         uuid REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  activity_type       text CHECK (activity_type IN ('call','email','meeting','note','sample','quotation','whatsapp')),
  subject             text,
  body                text,
  owner_email         text,
  activity_at         timestamptz DEFAULT now(),
  next_follow_up_date date,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_pipeline_activity_pipeline_id_idx
  ON public.crm_pipeline_activity (pipeline_id);
CREATE INDEX IF NOT EXISTS crm_pipeline_activity_next_follow_up_idx
  ON public.crm_pipeline_activity (next_follow_up_date);

-- ---------------------------------------------------------------------
-- PART 4: public.crm_order_cycle  (per-order repeat-customer cycle)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_order_cycle (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code     text,
  company_name      text,
  order_number      text,
  order_ref         bigint,                            -- client_orders_data.id
  cycle_stage       text NOT NULL DEFAULT 'order_taking'
                      CHECK (cycle_stage IN ('order_taking','order_received','dispatch',
                                             'keep_informed','invoicing','payment_followup','closed')),
  owner_email       text,
  amount            numeric DEFAULT 0,
  order_date        date,
  notes             text,
  stage_entered_at  timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_order_cycle_customer_code_idx ON public.crm_order_cycle (customer_code);
CREATE INDEX IF NOT EXISTS crm_order_cycle_cycle_stage_idx ON public.crm_order_cycle (cycle_stage);

-- =====================================================================
-- PART 5: TRIGGERS
-- =====================================================================

-- BEFORE INSERT on crm_pipeline: default owner/creator email, set stage_entered_at
CREATE OR REPLACE FUNCTION public.crm_pipeline_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.owner_email IS NULL THEN
    NEW.owner_email := public.rbac_current_email();
  END IF;
  IF NEW.created_by_email IS NULL THEN
    NEW.created_by_email := public.rbac_current_email();
  END IF;
  NEW.stage_entered_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_pipeline_before_insert ON public.crm_pipeline;
CREATE TRIGGER trg_crm_pipeline_before_insert
  BEFORE INSERT ON public.crm_pipeline
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_before_insert();

-- BEFORE UPDATE on crm_pipeline: on stage change, reset timers + handle won/recurring
CREATE OR REPLACE FUNCTION public.crm_pipeline_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_entered_at := now();
    NEW.updated_at := now();
    IF NEW.stage = 'recurring_client' THEN
      NEW.kind   := 'recurring';
      NEW.won_at := COALESCE(OLD.won_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_pipeline_before_update ON public.crm_pipeline;
CREATE TRIGGER trg_crm_pipeline_before_update
  BEFORE UPDATE ON public.crm_pipeline
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_before_update();

-- AFTER UPDATE on crm_pipeline: log stage transitions to history
CREATE OR REPLACE FUNCTION public.crm_pipeline_after_update()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.crm_pipeline_history (pipeline_id, from_stage, to_stage, moved_by_email, moved_at)
    VALUES (NEW.id, OLD.stage, NEW.stage, public.rbac_current_email(), now());
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_pipeline_after_update ON public.crm_pipeline;
CREATE TRIGGER trg_crm_pipeline_after_update
  AFTER UPDATE ON public.crm_pipeline
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_after_update();

-- BEFORE UPDATE on crm_order_cycle: on cycle_stage change, reset timers
CREATE OR REPLACE FUNCTION public.crm_order_cycle_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.cycle_stage IS DISTINCT FROM OLD.cycle_stage THEN
    NEW.stage_entered_at := now();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_order_cycle_before_update ON public.crm_order_cycle;
CREATE TRIGGER trg_crm_order_cycle_before_update
  BEFORE UPDATE ON public.crm_order_cycle
  FOR EACH ROW EXECUTE FUNCTION public.crm_order_cycle_before_update();

-- =====================================================================
-- PART 6: RLS  (ownership: super-admin sees all; owner sees own; null = claimable)
-- =====================================================================

ALTER TABLE public.crm_pipeline          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_pipeline_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_pipeline_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_order_cycle       ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_pipeline          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_pipeline_history  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_pipeline_activity TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_order_cycle       TO authenticated;

-- ---- crm_pipeline policies ----
DROP POLICY IF EXISTS crm_pipeline_select ON public.crm_pipeline;
CREATE POLICY crm_pipeline_select ON public.crm_pipeline
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR lower(coalesce(owner_email,'')) = public.rbac_current_email()
    OR owner_email IS NULL
  );

DROP POLICY IF EXISTS crm_pipeline_insert ON public.crm_pipeline;
CREATE POLICY crm_pipeline_insert ON public.crm_pipeline
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS crm_pipeline_update ON public.crm_pipeline;
CREATE POLICY crm_pipeline_update ON public.crm_pipeline
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR lower(coalesce(owner_email,'')) = public.rbac_current_email()
    OR owner_email IS NULL
  )
  WITH CHECK (true);

DROP POLICY IF EXISTS crm_pipeline_delete ON public.crm_pipeline;
CREATE POLICY crm_pipeline_delete ON public.crm_pipeline
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR lower(coalesce(owner_email,'')) = public.rbac_current_email()
    OR owner_email IS NULL
  );

-- ---- crm_order_cycle policies ----
DROP POLICY IF EXISTS crm_order_cycle_select ON public.crm_order_cycle;
CREATE POLICY crm_order_cycle_select ON public.crm_order_cycle
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR lower(coalesce(owner_email,'')) = public.rbac_current_email()
    OR owner_email IS NULL
  );

DROP POLICY IF EXISTS crm_order_cycle_insert ON public.crm_order_cycle;
CREATE POLICY crm_order_cycle_insert ON public.crm_order_cycle
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS crm_order_cycle_update ON public.crm_order_cycle;
CREATE POLICY crm_order_cycle_update ON public.crm_order_cycle
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR lower(coalesce(owner_email,'')) = public.rbac_current_email()
    OR owner_email IS NULL
  )
  WITH CHECK (true);

DROP POLICY IF EXISTS crm_order_cycle_delete ON public.crm_order_cycle;
CREATE POLICY crm_order_cycle_delete ON public.crm_order_cycle
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR lower(coalesce(owner_email,'')) = public.rbac_current_email()
    OR owner_email IS NULL
  );

-- ---- crm_pipeline_history policies (inherit visibility from parent pipeline) ----
DROP POLICY IF EXISTS crm_pipeline_history_all ON public.crm_pipeline_history;
CREATE POLICY crm_pipeline_history_all ON public.crm_pipeline_history
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.crm_pipeline p
      WHERE p.id = pipeline_id
        AND (lower(coalesce(p.owner_email,'')) = public.rbac_current_email() OR p.owner_email IS NULL)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.crm_pipeline p
      WHERE p.id = pipeline_id
        AND (lower(coalesce(p.owner_email,'')) = public.rbac_current_email() OR p.owner_email IS NULL)
    )
  );

-- ---- crm_pipeline_activity policies (inherit visibility from parent pipeline) ----
DROP POLICY IF EXISTS crm_pipeline_activity_all ON public.crm_pipeline_activity;
CREATE POLICY crm_pipeline_activity_all ON public.crm_pipeline_activity
  FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.crm_pipeline p
      WHERE p.id = pipeline_id
        AND (lower(coalesce(p.owner_email,'')) = public.rbac_current_email() OR p.owner_email IS NULL)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.crm_pipeline p
      WHERE p.id = pipeline_id
        AND (lower(coalesce(p.owner_email,'')) = public.rbac_current_email() OR p.owner_email IS NULL)
    )
  );

-- =====================================================================
-- PART 7: RPCs  (SECURITY DEFINER; grant execute to authenticated)
-- =====================================================================

-- crm_move_stage: move a pipeline row to a new stage (trigger logs history)
CREATE OR REPLACE FUNCTION public.crm_move_stage(
  p_pipeline_id uuid,
  p_to_stage    text,
  p_note        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.crm_pipeline%ROWTYPE;
BEGIN
  IF p_to_stage NOT IN ('cold_call','data_shared','rfq_samples','quotation',
                        'counter_samples','sample_approval','qc_audit',
                        'pilot_lot','recurring_client') THEN
    RAISE EXCEPTION 'Invalid stage: %', p_to_stage;
  END IF;

  UPDATE public.crm_pipeline
     SET stage = p_to_stage,
         notes = CASE
                   WHEN p_note IS NULL OR p_note = '' THEN notes
                   ELSE COALESCE(notes || E'\n', '') || p_note
                 END
   WHERE id = p_pipeline_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline % not found', p_pipeline_id;
  END IF;

  -- attach note to the most recent history row written by the AFTER UPDATE trigger
  IF p_note IS NOT NULL AND p_note <> '' THEN
    UPDATE public.crm_pipeline_history h
       SET note = p_note
     WHERE h.id = (
       SELECT id FROM public.crm_pipeline_history
        WHERE pipeline_id = p_pipeline_id
        ORDER BY moved_at DESC
        LIMIT 1
     );
  END IF;

  RETURN to_jsonb(v_row);
END;
$fn$;

-- crm_move_order_cycle: move an order-cycle row to a new cycle_stage
CREATE OR REPLACE FUNCTION public.crm_move_order_cycle(
  p_id       uuid,
  p_to_stage text,
  p_note     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.crm_order_cycle%ROWTYPE;
BEGIN
  IF p_to_stage NOT IN ('order_taking','order_received','dispatch',
                        'keep_informed','invoicing','payment_followup','closed') THEN
    RAISE EXCEPTION 'Invalid cycle stage: %', p_to_stage;
  END IF;

  UPDATE public.crm_order_cycle
     SET cycle_stage = p_to_stage,
         notes = CASE
                   WHEN p_note IS NULL OR p_note = '' THEN notes
                   ELSE COALESCE(notes || E'\n', '') || p_note
                 END
   WHERE id = p_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order cycle % not found', p_id;
  END IF;

  RETURN to_jsonb(v_row);
END;
$fn$;

-- crm_assign_owner: reassign a pipeline row's owner (super-admin or current owner only)
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

  RETURN to_jsonb(v_row);
END;
$fn$;

-- crm_pipeline_seed: idempotent backfill from source masters
CREATE OR REPLACE FUNCTION public.crm_pipeline_seed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n_recurring  bigint := 0;
  n_prospects  bigint := 0;
  n_leads      bigint := 0;
  n_orders     bigint := 0;
BEGIN
  -- (a) recurring clients from clients2
  WITH ins AS (
    INSERT INTO public.crm_pipeline
      (company_name, customer_code, kind, stage, value, contact_person, phone, email, owner_email)
    SELECT c."ClientName", c."ClientCode", 'recurring', 'recurring_client',
           COALESCE(NULLIF(regexp_replace(c."TotalValue"::text, '[^0-9.]', '', 'g'), '')::numeric, 0), NULL, NULL, NULL, NULL
      FROM public.clients2 c
     WHERE c."ClientName" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_pipeline p
          WHERE p.customer_code = c."ClientCode"
             OR lower(p.company_name) = lower(c."ClientName")
       )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_recurring FROM ins;

  -- (b) prospects from prospects_clients
  WITH ins AS (
    INSERT INTO public.crm_pipeline
      (company_name, customer_code, kind, stage, value)
    SELECT pc."ClientName", pc."ClientCode", 'prospect', 'cold_call',
           COALESCE(NULLIF(regexp_replace(pc."TotalValue"::text, '[^0-9.]', '', 'g'), '')::numeric, 0)
      FROM public.prospects_clients pc
     WHERE pc."ClientName" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_pipeline p
          WHERE p.customer_code = pc."ClientCode"
             OR lower(p.company_name) = lower(pc."ClientName")
       )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_prospects FROM ins;

  -- (c) active leads from sales_flow_data (AssignedTo is a name, not email -> owner_email NULL)
  WITH ins AS (
    INSERT INTO public.crm_pipeline
      (company_name, kind, stage, contact_person, phone, email, source, owner_email)
    SELECT sf."CompanyName", 'prospect',
           CASE
             WHEN lower(coalesce(sf."CurrentStep"::text, sf."QualificationStatus", '')) LIKE '%quot%' THEN 'quotation'
             WHEN lower(coalesce(sf."CurrentStep"::text, sf."QualificationStatus", '')) LIKE '%sample%' THEN 'sample_approval'
             WHEN lower(coalesce(sf."CurrentStep"::text, sf."QualificationStatus", '')) LIKE '%feasib%' THEN 'rfq_samples'
             WHEN lower(coalesce(sf."CurrentStep"::text, sf."QualificationStatus", '')) LIKE '%rfq%'    THEN 'rfq_samples'
             ELSE 'cold_call'
           END,
           sf."FullName", sf."PhoneNumber", sf."Email", sf."LeadSource", NULL
      FROM public.sales_flow_data sf
     WHERE sf."CompanyName" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_pipeline p
          WHERE lower(p.company_name) = lower(sf."CompanyName")
       )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_leads FROM ins;

  -- (d) order cycle from client_orders_data
  WITH ins AS (
    INSERT INTO public.crm_order_cycle
      (customer_code, company_name, order_number, order_ref, cycle_stage, amount, order_date)
    SELECT o."ClientCode", c."ClientName", o."OrderNumber", o.id,
           CASE lower(coalesce(o."Status", ''))
             WHEN 'delivered'  THEN 'closed'
             WHEN 'dispatched' THEN 'dispatch'
             WHEN 'invoiced'   THEN 'invoicing'
             WHEN 'paid'       THEN 'closed'
             ELSE 'order_taking'
           END,
           COALESCE(o."TotalAmount", 0), o."OrderDate"::date
      FROM public.client_orders_data o
      LEFT JOIN public.clients2 c ON c."ClientCode" = o."ClientCode"
     WHERE NOT EXISTS (
       SELECT 1 FROM public.crm_order_cycle x WHERE x.order_ref = o.id
     )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_orders FROM ins;

  RETURN jsonb_build_object(
    'recurring',   n_recurring,
    'prospects',   n_prospects,
    'leads',       n_leads,
    'order_cycle', n_orders
  );
END;
$fn$;

-- ---- RPC grants ----
REVOKE ALL ON FUNCTION public.crm_move_stage(uuid, text, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_move_order_cycle(uuid, text, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_assign_owner(uuid, text)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_pipeline_seed()                     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.crm_move_stage(uuid, text, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_move_order_cycle(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_assign_owner(uuid, text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_seed()                    TO authenticated;

COMMIT;
