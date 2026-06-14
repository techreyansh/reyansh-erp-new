-- =============================================================================
-- RBAC — CEO / super-admin full-access bypass (per-person model preserved)
--
-- The access model stays per-employee (employee_permissions is still the source
-- of truth for normal staff). This migration ONLY adds a safety bypass so a
-- super-admin (an email in allowed_admins, or a CEO-roled user) is never locked
-- out and always sees every module — regardless of employee_permissions rows.
--
-- It rewrites get_my_rbac_access(), rbac_employee_can() and
-- rbac_current_employee_is_ceo() to OR-in public.is_super_admin().
-- Nothing else about authorization changes.
--
-- Idempotent / safe to re-run.
-- =============================================================================

-- Make sure the CEO's login email(s) are recognised as super-admins.
INSERT INTO public.allowed_admins (email)
SELECT v
FROM (VALUES
  ('reyanshinternational63@gmail.com')
) AS t(v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.allowed_admins a WHERE lower(trim(a.email)) = lower(trim(t.v))
);

-- -----------------------------------------------------------------------------
-- get_my_rbac_access — super-admin sees all modules with all actions.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_rbac_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH flags AS (
    SELECT public.is_super_admin() AS is_admin
  ),
  me AS (
    SELECT
      e.id, e.email, e.full_name, e.phone, e.department, e.role_id, e.is_active,
      r.role_name, r.name, r.code
    FROM public.employees e
    LEFT JOIN public.roles r ON r.id = e.role_id
    WHERE e.email = public.rbac_current_email()
    LIMIT 1
  ),
  module_access AS (
    SELECT
      m.id, m.module_key, m.module_name, m.route_path, m.icon,
      ((SELECT is_admin FROM flags) OR COALESCE(ep.can_view,   false)) AS can_view,
      ((SELECT is_admin FROM flags) OR COALESCE(ep.can_create, false)) AS can_create,
      ((SELECT is_admin FROM flags) OR COALESCE(ep.can_edit,   false)) AS can_edit,
      ((SELECT is_admin FROM flags) OR COALESCE(ep.can_delete, false)) AS can_delete
    FROM public.modules m
    LEFT JOIN me ON true
    LEFT JOIN public.employee_permissions ep
      ON ep.employee_id = me.id AND ep.module_id = m.id
  )
  SELECT jsonb_build_object(
    'authorized',
      ((SELECT is_admin FROM flags) OR EXISTS (SELECT 1 FROM me WHERE is_active = true)),
    'reason', CASE
      WHEN (SELECT is_admin FROM flags) THEN null
      WHEN NOT EXISTS (SELECT 1 FROM me) THEN 'not_found'
      WHEN EXISTS (SELECT 1 FROM me WHERE is_active = false) THEN 'inactive'
      ELSE null
    END,
    'employee', COALESCE((
      SELECT to_jsonb(me) - 'role_id'
      FROM me
      WHERE is_active = true OR (SELECT is_admin FROM flags)
    ), 'null'::jsonb),
    'role', COALESCE((
      SELECT jsonb_build_object(
        'id', role_id,
        'role_name', COALESCE(role_name, name, code),
        'name', COALESCE(name, role_name, code),
        'code', code
      )
      FROM me
      WHERE is_active = true OR (SELECT is_admin FROM flags)
    ), 'null'::jsonb),
    'modules', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'module_key', module_key,
          'module_name', module_name,
          'route_path', route_path,
          'icon', icon,
          'can_view', can_view,
          'can_create', can_create,
          'can_edit', can_edit,
          'can_delete', can_delete
        )
        ORDER BY module_key
      )
      FROM module_access
      WHERE can_view = true
    ), '[]'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- rbac_employee_can — super-admin can do everything.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_employee_can(p_module_key text, p_action text DEFAULT 'view')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT e.id AS employee_id
    FROM public.employees e
    WHERE e.email = public.rbac_current_email()
      AND e.is_active = true
    LIMIT 1
  ),
  resolved AS (
    SELECT
      COALESCE(ep.can_view,   false) AS can_view,
      COALESCE(ep.can_create, false) AS can_create,
      COALESCE(ep.can_edit,   false) AS can_edit,
      COALESCE(ep.can_delete, false) AS can_delete
    FROM me
    JOIN public.modules m ON m.module_key = p_module_key
    LEFT JOIN public.employee_permissions ep
      ON ep.employee_id = me.employee_id AND ep.module_id = m.id
  )
  SELECT public.is_super_admin() OR CASE lower(COALESCE(p_action, 'view'))
    WHEN 'view'   THEN COALESCE((SELECT can_view   FROM resolved), false)
    WHEN 'create' THEN COALESCE((SELECT can_create FROM resolved), false)
    WHEN 'edit'   THEN COALESCE((SELECT can_edit   FROM resolved), false)
    WHEN 'delete' THEN COALESCE((SELECT can_delete FROM resolved), false)
    ELSE false
  END;
$$;

-- -----------------------------------------------------------------------------
-- rbac_current_employee_is_ceo — robust: any super-admin counts as CEO.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_current_employee_is_ceo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin() OR COALESCE(EXISTS (
    SELECT 1
    FROM public.employees e
    JOIN public.employee_permissions ep ON ep.employee_id = e.id
    JOIN public.modules m ON m.id = ep.module_id
    WHERE e.email = public.rbac_current_email()
      AND e.is_active = true
      AND m.module_key = 'employees'
      AND ep.can_delete = true
  ), false);
$$;
