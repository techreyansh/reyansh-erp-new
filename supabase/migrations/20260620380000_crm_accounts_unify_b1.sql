-- PART B / Stage 1: unify clients + prospects on ONE master (evolve crm_pipeline
-- in place — keeps id + customer_code so AR/PPC/analytics/collaborators stay
-- intact, and keeps owner/collaborator RLS). Adds the two-axis lifecycle
-- (account_type x prospect_stage x client_stage), the client/prospect master
-- fields, child tables, an in-place convert RPC, and v_clients/v_prospects views.
BEGIN;

-- 0) Snapshots (trivial rollback anchor).
CREATE TABLE IF NOT EXISTS public._backup_crm_pipeline_20260620 AS SELECT * FROM public.crm_pipeline;
CREATE TABLE IF NOT EXISTS public._backup_clients2_20260620 AS SELECT * FROM public.clients2;

-- 1) Lifecycle + master fields on crm_pipeline (the master).
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS account_type text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS prospect_stage text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS client_stage text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS converted_from uuid REFERENCES public.crm_pipeline(id) ON DELETE SET NULL;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS converted_at timestamptz;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS gstin text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS pan text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS business_type text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS customer_category text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS payment_terms text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS credit_limit numeric;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS credit_period text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS delivery_terms text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS rating text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS lead_source text;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS probability integer;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS expected_value numeric;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS expected_close_date date;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS total_orders integer;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS total_value numeric;
ALTER TABLE public.crm_pipeline ADD COLUMN IF NOT EXISTS last_contact_date date;

-- 2) Classify account_type + map the legacy 9-stage onto the 8 prospect stages / client lifecycle.
-- Classify STRICTLY by code prefix (PC/P = prospect, C = client). The 82 legacy
-- "recurring" rows were seeded from ALL of clients2 incl. PC-prospects, so kind
-- must NOT drive this. Null/other code (imported leads) -> prospect.
UPDATE public.crm_pipeline SET account_type = CASE
    WHEN upper(trim(COALESCE(customer_code,''))) LIKE 'PC%' THEN 'prospect'
    WHEN upper(trim(COALESCE(customer_code,''))) LIKE 'P%'  THEN 'prospect'
    WHEN upper(trim(COALESCE(customer_code,''))) LIKE 'C%'  THEN 'client'
    ELSE 'prospect' END
  WHERE account_type IS NULL;

UPDATE public.crm_pipeline SET prospect_stage = CASE stage
    WHEN 'cold_call' THEN 'lead'
    WHEN 'data_shared' THEN 'contacted'
    WHEN 'rfq_samples' THEN 'sample_sent'
    WHEN 'quotation' THEN 'quotation_sent'
    WHEN 'counter_samples' THEN 'negotiation'
    WHEN 'sample_approval' THEN 'negotiation'
    WHEN 'qc_audit' THEN 'negotiation'
    WHEN 'pilot_lot' THEN 'negotiation'
    WHEN 'recurring_client' THEN 'converted'
    ELSE 'lead' END
  WHERE prospect_stage IS NULL;

UPDATE public.crm_pipeline SET client_stage = 'active'
  WHERE account_type = 'client' AND client_stage IS NULL;
UPDATE public.crm_pipeline SET lead_source = COALESCE(lead_source, source) WHERE lead_source IS NULL;

-- 3) CHECK constraints (added after backfill so existing rows pass).
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_pipeline_account_type_check') THEN
    ALTER TABLE public.crm_pipeline ADD CONSTRAINT crm_pipeline_account_type_check
      CHECK (account_type IN ('prospect','client','converted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_pipeline_prospect_stage_check') THEN
    ALTER TABLE public.crm_pipeline ADD CONSTRAINT crm_pipeline_prospect_stage_check
      CHECK (prospect_stage IS NULL OR prospect_stage IN
        ('lead','contacted','meeting_scheduled','qualified','sample_sent','quotation_sent','negotiation','converted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_pipeline_client_stage_check') THEN
    ALTER TABLE public.crm_pipeline ADD CONSTRAINT crm_pipeline_client_stage_check
      CHECK (client_stage IS NULL OR client_stage IN
        ('active','repeat_business','key_account','dormant'));
  END IF;
END $c$;
CREATE INDEX IF NOT EXISTS idx_crm_pipeline_account_type ON public.crm_pipeline(account_type);

-- 4) Child tables (FK -> crm_pipeline(id) ON DELETE CASCADE). Rename legacy quotation tables to avoid name clash.
ALTER TABLE IF EXISTS public.crm_quotations RENAME TO crm_quotations_legacy;
ALTER TABLE IF EXISTS public.crm_quotation_items RENAME TO crm_quotation_items_legacy;

CREATE TABLE IF NOT EXISTS public.crm_account_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  full_name text, designation text, department text, phone text, email text,
  is_primary boolean DEFAULT false, notes text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.crm_account_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  address_type text CHECK (address_type IN ('billing','shipping')) DEFAULT 'billing',
  line1 text, line2 text, city text, state text, state_code text, pincode text, country text,
  gstin text, is_default boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.crm_account_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  doc_type text, file_name text, storage_path text, uploaded_by_email text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.crm_account_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  product text, qty numeric, sent_on date, status text CHECK (status IN ('sent','received','approved','rejected')) DEFAULT 'sent',
  feedback text, owner_email text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.crm_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_pipeline(id) ON DELETE CASCADE,
  quote_number text, quote_date date, valid_until date,
  status text CHECK (status IN ('draft','sent','negotiation','accepted','rejected','expired')) DEFAULT 'draft',
  subtotal numeric, tax_amount numeric, total numeric, currency text DEFAULT 'INR',
  owner_email text, notes text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.crm_quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.crm_quotations(id) ON DELETE CASCADE,
  product text, description text, qty numeric, unit_price numeric, line_total numeric);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_account_contacts','crm_account_addresses','crm_account_documents','crm_account_samples','crm_quotations','crm_quotation_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $rls$;

-- 5) Convert prospect -> client IN PLACE (no duplicate; children stay attached).
CREATE OR REPLACE FUNCTION public.crm_convert_to_client(p_account_id uuid, p_client_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_row public.crm_pipeline;
BEGIN
  v_code := COALESCE(NULLIF(p_client_code,''),
    'C' || lpad(((SELECT COALESCE(max(NULLIF(regexp_replace(customer_code,'[^0-9]','','g'),'')::int),10000)
                  FROM public.crm_pipeline WHERE upper(trim(COALESCE(customer_code,''))) LIKE 'C%') + 1)::text, 5, '0'));
  UPDATE public.crm_pipeline SET
    account_type = 'client', client_stage = 'active', prospect_stage = 'converted',
    customer_code = COALESCE(NULLIF(customer_code,''), v_code),
    kind = 'recurring', won_at = COALESCE(won_at, now()), converted_at = now(), updated_at = now()
  WHERE id = p_account_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account % not found', p_account_id; END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'customer_code', v_row.customer_code, 'account_type', v_row.account_type);
END;
$$;
GRANT EXECUTE ON FUNCTION public.crm_convert_to_client(uuid, text) TO authenticated;

-- 6) Client / Prospect views (security_invoker so the master RLS still applies).
CREATE OR REPLACE VIEW public.v_clients WITH (security_invoker = true) AS
  SELECT * FROM public.crm_pipeline WHERE account_type IN ('client','converted');
CREATE OR REPLACE VIEW public.v_prospects WITH (security_invoker = true) AS
  SELECT * FROM public.crm_pipeline WHERE account_type = 'prospect';
GRANT SELECT ON public.v_clients, public.v_prospects TO authenticated;

COMMIT;
