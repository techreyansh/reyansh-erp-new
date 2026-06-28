-- Accountability propagation — atomic next-action save + collaborator add.
-- Setting an action owner now: (1) saves the next action, (2) auto-adds that
-- owner as a collaborator (so existing collaborator visibility surfaces it on
-- their pipeline + worklist), (3) notifies them. All in one SECURITY DEFINER
-- round-trip so it can never half-apply. Permission gate mirrors the
-- crm_pipeline_update RLS (owner / unassigned / collaborator / super-admin).
BEGIN;

CREATE OR REPLACE FUNCTION public.crm_set_next_action(
  p_id       uuid,
  p_action   text,
  p_date     date,
  p_owner    text,
  p_priority text DEFAULT 'normal',
  p_status   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor      text := public.rbac_current_email();
  v_owner_lc   text := lower(nullif(btrim(coalesce(p_owner,'')), ''));
  v_acct_owner text;
  v_company    text;
  v_rows       int;
BEGIN
  -- Permission gate (mirror crm_pipeline_update).
  IF NOT (
      public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.crm_pipeline p
                 WHERE p.id = p_id
                   AND (lower(coalesce(p.owner_email,'')) = v_actor OR p.owner_email IS NULL))
      OR public.crm_is_collaborator(p_id)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.crm_pipeline SET
    next_action             = p_action,
    next_action_date        = p_date,
    next_action_owner_email = nullif(btrim(coalesce(p_owner,'')), ''),
    next_action_priority    = coalesce(p_priority, 'normal'),
    current_status          = CASE WHEN p_status IS NULL THEN current_status ELSE p_status END,
    updated_at              = now()
  WHERE id = p_id
  RETURNING owner_email, company_name INTO v_acct_owner, v_company;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'not_found_or_forbidden';
  END IF;

  -- Action owner differs from the account owner -> grant visibility + notify.
  IF v_owner_lc IS NOT NULL AND v_owner_lc <> lower(coalesce(v_acct_owner,'')) THEN
    INSERT INTO public.crm_pipeline_collaborators (pipeline_id, email, added_by_email)
    VALUES (p_id, v_owner_lc, v_actor)
    ON CONFLICT (pipeline_id, lower(email)) DO NOTHING;

    -- Notify the assignee only when someone ELSE assigned them.
    IF v_owner_lc <> v_actor THEN
      INSERT INTO public.crm_notification (recipient_email, type, pipeline_id, title, body)
      VALUES (
        v_owner_lc, 'next_action_assigned', p_id,
        'New action: ' || coalesce(v_company, 'account'),
        coalesce(nullif(btrim(coalesce(p_action,'')),''), '(no detail)')
          || CASE WHEN p_date IS NOT NULL THEN ' · due ' || p_date::text ELSE '' END
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('id', p_id, 'ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.crm_set_next_action(uuid,text,date,text,text,text) TO authenticated;

-- Manual collaborator add (the "Collaborators (co-working)" picker).
-- Must be a definer RPC: the scoped crm_notification RLS forbids a client from
-- inserting a notification addressed to ANOTHER user, so the add + notify both
-- run here.
CREATE OR REPLACE FUNCTION public.crm_add_collaborator(p_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor    text := public.rbac_current_email();
  v_email_lc text := lower(nullif(btrim(coalesce(p_email,'')), ''));
  v_company  text;
  v_owner    text;
BEGIN
  IF v_email_lc IS NULL THEN RAISE EXCEPTION 'empty_email'; END IF;

  IF NOT (
      public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.crm_pipeline p
                 WHERE p.id = p_id
                   AND (lower(coalesce(p.owner_email,'')) = v_actor OR p.owner_email IS NULL))
      OR public.crm_is_collaborator(p_id)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT company_name, owner_email INTO v_company, v_owner
  FROM public.crm_pipeline WHERE id = p_id;

  INSERT INTO public.crm_pipeline_collaborators (pipeline_id, email, added_by_email)
  VALUES (p_id, v_email_lc, v_actor)
  ON CONFLICT (pipeline_id, lower(email)) DO NOTHING;

  -- Notify the new collaborator (unless they added themselves or own it).
  IF v_email_lc <> v_actor AND v_email_lc <> lower(coalesce(v_owner,'')) THEN
    INSERT INTO public.crm_notification (recipient_email, type, pipeline_id, title, body)
    VALUES (
      v_email_lc, 'collaborator_added', p_id,
      'Added to: ' || coalesce(v_company, 'account'),
      'You are now collaborating on this account.'
    );
  END IF;

  RETURN jsonb_build_object('id', p_id, 'ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.crm_add_collaborator(uuid,text) TO authenticated;

COMMIT;
