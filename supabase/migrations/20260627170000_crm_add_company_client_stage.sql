-- Add-client support: crm_add_company now sets client_stage when creating a
-- client (account_type='client'), so the new row is returned by crm_client_cards
-- and lands in the Client Pipeline. Previously it only set prospect_stage, so a
-- client created here had client_stage=NULL and never showed up as a client.
-- Prospect behaviour is unchanged (client_stage stays NULL for prospects).
-- Keeps the existing advisory-lock + crm_next_code('C'/'PC') minting.

CREATE OR REPLACE FUNCTION public.crm_add_company(p_payload jsonb)
RETURNS public.crm_pipeline LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind         text := COALESCE(NULLIF(p_payload->>'account_type',''), 'prospect');
  v_prefix       text := CASE WHEN v_kind = 'client' THEN 'C' ELSE 'PC' END;
  v_code         text := NULLIF(trim(COALESCE(p_payload->>'customer_code','')), '');
  v_email        text := COALESCE(NULLIF(current_setting('request.jwt.claims', true)::json->>'email',''),
                                  p_payload->>'owner_email');
  v_client_stage text := CASE WHEN v_kind = 'client'
                              THEN COALESCE(NULLIF(p_payload->>'client_stage',''), 'active')
                              ELSE NULL END;
  -- legacy `kind` column only allows 'prospect' | 'recurring' (clients = 'recurring').
  -- Derive it from account_type so an 'client' payload can't violate the CHECK.
  v_kindcol      text := CASE WHEN v_kind = 'client' THEN 'recurring' ELSE 'prospect' END;
  v_row          public.crm_pipeline;
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
    prospect_stage, client_stage, account_type, kind, owner_email, is_active, customer_code)
  VALUES (
    trim(p_payload->>'company_name'),
    NULLIF(p_payload->>'contact_person',''),
    NULLIF(p_payload->>'phone',''),
    NULLIF(p_payload->>'email',''),
    NULLIF(p_payload->>'source',''),
    NULLIF(p_payload->>'value','')::numeric,
    NULLIF(p_payload->>'prospect_stage',''),
    v_client_stage,
    v_kind,
    v_kindcol,
    v_email,
    COALESCE((p_payload->>'is_active')::boolean, true),
    v_code)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
GRANT EXECUTE ON FUNCTION public.crm_add_company(jsonb) TO authenticated;
