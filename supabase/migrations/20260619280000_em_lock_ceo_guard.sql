-- Security fix: em_lock_week / em_unlock_week must be CEO/super-admin only
-- (the UI gated it, but the RPCs were callable by any authenticated user).
BEGIN;

CREATE OR REPLACE FUNCTION public.em_lock_week(p_week_start date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_week public.acc_weeks;
  v_email text := public.current_user_email();
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the CEO/super-admin can lock the week';
  END IF;
  v_week := public.acc_ensure_week(p_week_start);
  UPDATE public.acc_weeks
     SET is_locked = true, locked_by = v_email, locked_at = now()
   WHERE id = v_week.id
   RETURNING * INTO v_week;
  RETURN jsonb_build_object('locked', true, 'locked_by', v_week.locked_by, 'locked_at', v_week.locked_at);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.em_unlock_week(p_week_start date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_week public.acc_weeks;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the CEO/super-admin can unlock the week';
  END IF;
  v_week := public.acc_ensure_week(p_week_start);
  UPDATE public.acc_weeks
     SET is_locked = false, locked_by = null, locked_at = null
   WHERE id = v_week.id
   RETURNING * INTO v_week;
  RETURN jsonb_build_object('locked', false, 'locked_by', v_week.locked_by, 'locked_at', v_week.locked_at);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.em_lock_week(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.em_unlock_week(date) TO authenticated;

COMMIT;
