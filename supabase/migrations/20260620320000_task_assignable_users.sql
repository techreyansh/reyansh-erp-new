-- Person-first task assignment: one RPC returning every active user with their
-- name, department, phone (for WhatsApp) and live OPEN-TASK COUNT (workload), so
-- the picker can show "who's free / who's swamped". Name prefers the
-- profile-editable employees_data.EmployeeName. No schema/trigger changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.task_assignable_users()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.full_name), '[]'::jsonb)
  FROM (
    SELECT
      lower(u.email) AS email,
      COALESCE(NULLIF(e."EmployeeName",''), NULLIF(u.full_name,''), split_part(u.email,'@',1)) AS full_name,
      COALESCE(e."Department", r.name) AS department,
      r.name AS role,
      NULLIF(e."Phone",'') AS phone,
      (SELECT count(*) FROM public.tasks tk
        WHERE lower(tk.assigned_email) = lower(u.email)
          AND tk.task_status IN ('pending','in_progress','blocked'))::int AS open_tasks
    FROM public.users u
    LEFT JOIN public.roles r ON r.id = u.role_id
    LEFT JOIN public.employees_data e ON lower(e."Email") = lower(u.email)
    WHERE u.is_active IS NOT FALSE
  ) t;
$$;
GRANT EXECUTE ON FUNCTION public.task_assignable_users() TO authenticated;

COMMIT;
