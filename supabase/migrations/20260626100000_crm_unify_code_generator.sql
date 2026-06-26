-- =====================================================================
-- CRM codes — unify on ONE race-safe generator (crm_next_code)
-- =====================================================================
-- The codes feature (20260624150000) introduced crm_next_code + crm_add_company
-- (advisory-lock + insert-and-return). But crm_convert_to_client still minted
-- C-codes with its OWN inline logic, which (a) raced crm_add_company on the same
-- C-number space and (b) used the global-strip regex `regexp_replace(code,'[^0-9]')`
-- that corrupts MAX on any alpha code (e.g. C100A2 -> 1002). This rewires convert
-- to mint through crm_next_code('C') under the SAME advisory lock key
-- (hashtext('crm_code_C')) that crm_add_company uses, so creation + conversion
-- can no longer collide. Pure CREATE OR REPLACE — additive, idempotent.
--
-- Semantics preserved exactly: an existing non-blank code wins; else the explicit
-- override; else a freshly minted (now race-safe, prefix-anchored) C-code.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.crm_convert_to_client(p_account_id uuid, p_client_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing text;
  v_code     text;
  v_row      public.crm_pipeline;
BEGIN
  SELECT NULLIF(trim(COALESCE(customer_code,'')), '') INTO v_existing
  FROM public.crm_pipeline WHERE id = p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account % not found', p_account_id; END IF;

  -- Precedence (unchanged): existing code > explicit override > freshly minted.
  IF v_existing IS NOT NULL THEN
    v_code := v_existing;
  ELSE
    v_code := NULLIF(trim(COALESCE(p_client_code,'')), '');
    IF v_code IS NULL THEN
      -- Same lock key as crm_add_company('C') so create + convert serialize.
      PERFORM pg_advisory_xact_lock(hashtext('crm_code_C'));
      v_code := public.crm_next_code('C');
    END IF;
  END IF;

  UPDATE public.crm_pipeline SET
    account_type = 'client', client_stage = 'active', prospect_stage = 'converted',
    customer_code = v_code,
    kind = 'recurring', won_at = COALESCE(won_at, now()),
    converted_at = now(), updated_at = now()
  WHERE id = p_account_id RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id,
    'customer_code', v_row.customer_code, 'account_type', v_row.account_type);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'blocked', false,
    'message', format('Code %s is already in use.', v_code));
END;
$$;
GRANT EXECUTE ON FUNCTION public.crm_convert_to_client(uuid, text) TO authenticated;
