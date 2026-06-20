-- CRM consolidation (Phase 0): make crm_pipeline the single master.
-- 1) Reconcile legacy clients2 + prospects_clients records missing from the master
--    (STRICT code classifier: ^C[0-9]+$ -> client, ^P C?[0-9]+$ -> prospect, else SKIP
--    so malformed junk like 'cli0022' is never promoted to a client).
-- 2) Auto-assign P-codes (P10001+) to coded-less prospects so the C/P/PC convention holds.
-- 3) Extend client statuses (+ growth_account, inactive).
-- 4) Additive order-cycle history log (+ make crm_move_order_cycle record moves) + backfill.
-- 5) New crm_complaints + crm_saved_views tables.
-- All additive / reversible; legacy tables kept as backup, not dropped.
BEGIN;

-- snapshots ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._backup_crm_pipeline_20260621 AS TABLE public.crm_pipeline;
CREATE TABLE IF NOT EXISTS public._backup_clients2_20260621 AS TABLE public.clients2;
CREATE TABLE IF NOT EXISTS public._backup_prospects_clients_20260621 AS TABLE public.prospects_clients;

-- 1) RECONCILE missing legacy records --------------------------------------
-- Union both legacy tables, dedupe by code, strict-classify, insert those not
-- already in the master. Junk codes (not matching the strict patterns) are skipped.
WITH legacy AS (
  SELECT "ClientCode" AS code, "ClientName" AS name, "Industry" AS industry, "City" AS city,
         "GSTIN" AS gstin, "PANNumber" AS pan, "BusinessType" AS biztype,
         "PaymentTerms" AS payterms, "Website" AS website, created_at
  FROM public.clients2
  UNION ALL
  SELECT "ClientCode", "ClientName", "Industry", "City", "GSTIN", "PANNumber",
         "BusinessType", "PaymentTerms", "Website", created_at
  FROM public.prospects_clients
),
classified AS (
  SELECT DISTINCT ON (upper(btrim(code)))
         btrim(code) AS code, name, industry, city, gstin, pan, biztype, payterms, website,
         CASE WHEN btrim(code) ~ '^C[0-9]+$'    THEN 'client'
              WHEN btrim(code) ~ '^P[C]?[0-9]+$' THEN 'prospect' END AS acct
  FROM legacy
  WHERE code IS NOT NULL AND btrim(code) <> '' AND COALESCE(btrim(name),'') <> ''
  ORDER BY upper(btrim(code)), created_at NULLS LAST
)
INSERT INTO public.crm_pipeline
  (company_name, customer_code, account_type, kind, stage,
   prospect_stage, client_stage, industry, city, gstin, pan, business_type, payment_terms, website, is_active)
SELECT c.name, c.code, c.acct,
       CASE WHEN c.acct='client' THEN 'recurring' ELSE 'prospect' END,
       CASE WHEN c.acct='client' THEN 'recurring_client' ELSE 'cold_call' END,
       CASE WHEN c.acct='prospect' THEN 'lead' END,
       CASE WHEN c.acct='client'   THEN 'active' END,
       NULLIF(c.industry,''), NULLIF(c.city,''), NULLIF(c.gstin,''), NULLIF(c.pan,''),
       NULLIF(c.biztype,''), NULLIF(c.payterms,''), NULLIF(c.website,''), true
FROM classified c
WHERE c.acct IS NOT NULL
  AND upper(btrim(c.code)) NOT IN (
        SELECT upper(btrim(customer_code)) FROM public.crm_pipeline WHERE customer_code IS NOT NULL AND btrim(customer_code) <> '')
ON CONFLICT (lower(COALESCE(company_name, ''::text))) DO UPDATE
  -- company already in the master but lacked its code -> attach the legacy code (no duplicate row)
  SET customer_code = COALESCE(NULLIF(btrim(public.crm_pipeline.customer_code), ''), EXCLUDED.customer_code),
      account_type  = COALESCE(public.crm_pipeline.account_type, EXCLUDED.account_type),
      updated_at    = now();

-- 2) P-CODE the coded-less prospects (P10001+, after reconcile so new PC rows keep their codes)
WITH to_code AS (
  SELECT id, 'P' || (10000 + row_number() OVER (ORDER BY created_at NULLS LAST, id))::text AS newcode
  FROM public.crm_pipeline
  WHERE account_type = 'prospect' AND (customer_code IS NULL OR btrim(customer_code) = '')
)
UPDATE public.crm_pipeline p SET customer_code = t.newcode, updated_at = now()
FROM to_code t WHERE p.id = t.id;

-- 3) EXTEND client statuses (+ growth_account, inactive) --------------------
ALTER TABLE public.crm_pipeline DROP CONSTRAINT IF EXISTS crm_pipeline_client_stage_check;
ALTER TABLE public.crm_pipeline ADD CONSTRAINT crm_pipeline_client_stage_check
  CHECK (client_stage IS NULL OR client_stage = ANY (ARRAY[
    'active','repeat_business','key_account','growth_account','dormant','inactive']));

-- 4) ORDER-CYCLE HISTORY (additive) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_order_cycle_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_cycle_id uuid REFERENCES public.crm_order_cycle(id) ON DELETE CASCADE,
  from_stage text, to_stage text, moved_by_email text, note text,
  moved_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_oc_history_cycle ON public.crm_order_cycle_history(order_cycle_id, moved_at);
ALTER TABLE public.crm_order_cycle_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_oc_history_all ON public.crm_order_cycle_history;
CREATE POLICY crm_oc_history_all ON public.crm_order_cycle_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- backfill one "created" row per existing cycle (idempotent)
INSERT INTO public.crm_order_cycle_history(order_cycle_id, from_stage, to_stage, moved_by_email, note, moved_at)
SELECT oc.id, NULL, oc.cycle_stage, oc.owner_email, 'backfill: opened', COALESCE(oc.stage_entered_at, oc.created_at, now())
FROM public.crm_order_cycle oc
WHERE NOT EXISTS (SELECT 1 FROM public.crm_order_cycle_history h WHERE h.order_cycle_id = oc.id);

-- make the move RPC also LOG the transition (workflow logic itself unchanged)
CREATE OR REPLACE FUNCTION public.crm_move_order_cycle(p_id uuid, p_to_stage text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_row public.crm_order_cycle%ROWTYPE; v_old text;
BEGIN
  IF p_to_stage NOT IN ('order_taking','order_received','production','dispatch','payment_followup','closed') THEN
    RAISE EXCEPTION 'Invalid cycle stage: %', p_to_stage;
  END IF;
  SELECT cycle_stage INTO v_old FROM public.crm_order_cycle WHERE id = p_id;
  UPDATE public.crm_order_cycle
     SET cycle_stage = p_to_stage,
         notes = CASE WHEN p_note IS NULL OR p_note = '' THEN notes
                      ELSE COALESCE(notes || E'\n', '') || p_note END
   WHERE id = p_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order cycle % not found', p_id; END IF;
  INSERT INTO public.crm_order_cycle_history(order_cycle_id, from_stage, to_stage, moved_by_email, note)
  VALUES (p_id, v_old, p_to_stage, public.rbac_current_email(), NULLIF(p_note,''));
  RETURN to_jsonb(v_row);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.crm_move_order_cycle(uuid, text, text) TO authenticated;

-- 5) COMPLAINTS + SAVED VIEWS ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  customer_code text, subject text NOT NULL, description text,
  severity text DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','closed')),
  owner_email text, created_by text, created_at timestamptz DEFAULT now(), resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_crm_complaints_account ON public.crm_complaints(account_id);
ALTER TABLE public.crm_complaints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_complaints_all ON public.crm_complaints;
CREATE POLICY crm_complaints_all ON public.crm_complaints FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.crm_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL, module text NOT NULL CHECK (module IN ('clients','prospects')),
  name text NOT NULL, filters jsonb DEFAULT '{}'::jsonb, sort jsonb DEFAULT '{}'::jsonb,
  is_shared boolean DEFAULT false, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_saved_views_user ON public.crm_saved_views(lower(user_email), module);
ALTER TABLE public.crm_saved_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_saved_views_rw ON public.crm_saved_views;
CREATE POLICY crm_saved_views_rw ON public.crm_saved_views FOR ALL TO authenticated
  USING (is_shared OR lower(user_email) = lower(public.rbac_current_email()))
  WITH CHECK (lower(user_email) = lower(public.rbac_current_email()));

COMMIT;
