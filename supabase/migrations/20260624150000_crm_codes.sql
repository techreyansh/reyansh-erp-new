-- =====================================================================
-- CRM codes — auto-generate (race-safe) + safe edit + unique index
-- =====================================================================
-- One prefix-anchored generator (fixes the old global-strip regex that
-- corrupted MAX on alpha codes). Race-safe minting via advisory lock inside
-- a single insert RPC. Edit blocks when the code is referenced by downstream
-- orders/invoices/work-orders (soft FKs — orphan protection). Unique partial
-- index is safe: prod has 0 duplicate non-blank codes (verified).
-- New clients = C#####, new prospects = PC##### (both start at 10001).
-- =====================================================================

-- 1. Shared next-code generator. Anchors on the prefix, ignores non-numeric
--    suffixes, never below 10001 (consistent with existing C-series).
CREATE OR REPLACE FUNCTION public.crm_next_code(p_prefix text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT upper(p_prefix) || lpad((
    GREATEST(
      COALESCE(max(
        CASE WHEN substring(upper(customer_code) FROM char_length(p_prefix) + 1) ~ '^[0-9]+$'
             THEN substring(upper(customer_code) FROM char_length(p_prefix) + 1)::bigint
        END), 0),
      10000) + 1)::text, 5, '0')
  FROM public.crm_pipeline
  WHERE upper(customer_code) LIKE upper(p_prefix) || '%';
$$;
GRANT EXECUTE ON FUNCTION public.crm_next_code(text) TO authenticated;

-- 2. Race-safe create: mint the code (if none supplied) + insert + return,
--    all under one advisory lock so concurrent creates can't collide.
CREATE OR REPLACE FUNCTION public.crm_add_company(p_payload jsonb)
RETURNS public.crm_pipeline LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind   text := COALESCE(NULLIF(p_payload->>'account_type',''), 'prospect');
  v_prefix text := CASE WHEN v_kind = 'client' THEN 'C' ELSE 'PC' END;
  v_code   text := NULLIF(trim(COALESCE(p_payload->>'customer_code','')), '');
  v_email  text := COALESCE(NULLIF(current_setting('request.jwt.claims', true)::json->>'email',''),
                            p_payload->>'owner_email');
  v_row    public.crm_pipeline;
BEGIN
  IF COALESCE(trim(p_payload->>'company_name'),'') = '' THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('crm_code_' || v_prefix));
  IF v_code IS NULL THEN
    v_code := public.crm_next_code(v_prefix);
  END IF;
  INSERT INTO public.crm_pipeline (
    company_name, contact_person, phone, email, source, value,
    prospect_stage, account_type, kind, owner_email, is_active, customer_code)
  VALUES (
    trim(p_payload->>'company_name'),
    NULLIF(p_payload->>'contact_person',''),
    NULLIF(p_payload->>'phone',''),
    NULLIF(p_payload->>'email',''),
    NULLIF(p_payload->>'source',''),
    NULLIF(p_payload->>'value','')::numeric,
    NULLIF(p_payload->>'prospect_stage',''),
    v_kind,
    COALESCE(NULLIF(p_payload->>'kind',''), v_kind),
    v_email,
    COALESCE((p_payload->>'is_active')::boolean, true),
    v_code)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
GRANT EXECUTE ON FUNCTION public.crm_add_company(jsonb) TO authenticated;

-- 3. Safe edit: validate prefix↔kind, BLOCK if the old code is referenced by
--    any downstream order/invoice/work-order (RLS-bypassing count), else update.
CREATE OR REPLACE FUNCTION public.crm_set_code(p_account_id uuid, p_new_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old text; v_kind text; v_new text := upper(trim(p_new_code)); v_used int;
BEGIN
  SELECT customer_code, account_type INTO v_old, v_kind FROM public.crm_pipeline WHERE id = p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'crm_set_code: account not found'; END IF;
  IF v_new = '' THEN RAISE EXCEPTION 'Code cannot be empty'; END IF;
  IF v_kind = 'client'  AND v_new NOT LIKE 'C%' THEN
    RETURN jsonb_build_object('ok', false, 'blocked', false, 'message', 'Client codes must start with C.');
  END IF;
  IF v_kind <> 'client' AND v_new NOT LIKE 'P%' THEN
    RETURN jsonb_build_object('ok', false, 'blocked', false, 'message', 'Prospect codes must start with P.');
  END IF;
  IF v_old IS NOT NULL AND v_old <> '' AND v_old <> v_new THEN
    SELECT (SELECT count(*) FROM public.crm_order_cycle  WHERE customer_code = v_old)
         + (SELECT count(*) FROM public.finance_invoices WHERE customer_code = v_old)
         + (SELECT count(*) FROM public.ppc_wo           WHERE customer_code = v_old)
      INTO v_used;
    IF v_used > 0 THEN
      RETURN jsonb_build_object('ok', false, 'blocked', true, 'refs', v_used,
        'message', format('This code is on %s order/invoice/work-order record(s) and can''t be changed.', v_used));
    END IF;
  END IF;
  UPDATE public.crm_pipeline SET customer_code = v_new WHERE id = p_account_id;
  RETURN jsonb_build_object('ok', true, 'customer_code', v_new);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'blocked', false, 'message', format('Code %s is already in use.', v_new));
END $$;
GRANT EXECUTE ON FUNCTION public.crm_set_code(uuid, text) TO authenticated;

-- 4. Unique index (safe — prod verified 0 duplicate non-blank codes).
CREATE UNIQUE INDEX IF NOT EXISTS crm_pipeline_customer_code_uniq
  ON public.crm_pipeline (customer_code)
  WHERE customer_code IS NOT NULL AND customer_code <> '';
