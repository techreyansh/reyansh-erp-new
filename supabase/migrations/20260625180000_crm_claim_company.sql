-- =====================================================================
-- CRM — claim a hidden company by name (UNOWNED-ONLY policy)
-- =====================================================================
-- Follow-up to the duplicate-company-name fix. The crm_pipeline unique index
-- on lower(coalesce(company_name,'')) blocks inserting a second row with an
-- existing name. When that name belongs to a row hidden from the caller by
-- RLS (owned by someone else), the insert fails with a confusing unique
-- violation. This lets a user self-claim that company — but ONLY when it
-- currently has no owner (owner_email IS NULL / blank). An actively-owned
-- company still routes to an admin for reassignment.
--
-- SECURITY DEFINER so it can see + update rows the caller's RLS would hide,
-- but the unowned-only gate keeps the privilege escalation safe: a user can
-- only ever take ownership of a company nobody else owns.
-- Returns jsonb { ok, reason?, message?, id?, company_name?, owner_email? };
-- logical failures return ok:false rather than raising (callers check .ok).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.crm_claim_company(p_company_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me  text := public.rbac_current_email();
  v_row public.crm_pipeline;
BEGIN
  SELECT * INTO v_row
  FROM public.crm_pipeline
  WHERE lower(coalesce(company_name, '')) = lower(trim(p_company_name))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF lower(coalesce(v_row.owner_email, '')) = v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_yours');
  END IF;

  -- UNOWNED-ONLY GATE: an actively-owned company can't be self-claimed.
  IF v_row.owner_email IS NOT NULL AND trim(v_row.owner_email) <> '' THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'owned',
      'message', 'This company is assigned to someone else — ask an admin to reassign it.');
  END IF;

  UPDATE public.crm_pipeline
     SET owner_email = v_me, updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'company_name', v_row.company_name,
    'owner_email', v_row.owner_email);
END $$;

GRANT EXECUTE ON FUNCTION public.crm_claim_company(text) TO authenticated;
