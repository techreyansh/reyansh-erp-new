-- Fix: submit_task_instance crashed with
--   record "v_row" has no field "required_proof"
-- because v_row is declared as public.task_instances (which has NO required_proof
-- column — that field lives on task_templates), yet the function did
--   SELECT ti.*, tt.required_proof INTO v_row   (extra column into a fixed rowtype)
-- and then read v_row.required_proof. This broke EVERY task submission.
--
-- Correct approach: load the instance row into v_row (ti.* only), and look up the
-- template's required_proof into its own scalar variable. LEFT JOIN-style lookup
-- so a missing template degrades to "no proof required" instead of "not found".

CREATE OR REPLACE FUNCTION public.submit_task_instance(
  p_task_instance_id uuid,
  p_submission_link text DEFAULT NULL,
  p_submission_notes text DEFAULT NULL
)
RETURNS public.task_instances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.task_instances;
  v_required boolean;
BEGIN
  -- Instance row (task_instances rowtype — no required_proof field here).
  SELECT ti.* INTO v_row
  FROM public.task_instances ti
  WHERE ti.id = p_task_instance_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Task instance not found';
  END IF;

  -- required_proof lives on the template; look it up separately.
  SELECT COALESCE(tt.required_proof, false) INTO v_required
  FROM public.task_templates tt
  WHERE tt.id = v_row.template_id;
  v_required := COALESCE(v_required, false);

  IF v_required AND COALESCE(trim(p_submission_link), '') = '' THEN
    RAISE EXCEPTION 'Proof link/file is required for this task';
  END IF;

  IF v_row.status = 'approved' THEN
    RAISE EXCEPTION 'Approved task cannot be resubmitted';
  END IF;

  UPDATE public.task_instances
  SET
    submission_link = NULLIF(trim(COALESCE(p_submission_link, '')), ''),
    submission_notes = p_submission_notes,
    submitted_at = now(),
    status = 'submitted',
    is_late = now() > due_date,
    rejection_reason = NULL
  WHERE id = p_task_instance_id
  RETURNING * INTO v_row;

  INSERT INTO public.task_audit_log (
    task_instance_id, action, actor_user_id, actor_email, payload
  ) VALUES (
    p_task_instance_id,
    'TASK_SUBMITTED',
    auth.uid(),
    public.current_user_email(),
    jsonb_build_object('submission_link', p_submission_link, 'submission_notes', p_submission_notes)
  );

  RETURN v_row;
END;
$$;
