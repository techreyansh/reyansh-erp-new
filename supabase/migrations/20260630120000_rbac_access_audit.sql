-- Per-user access AUDIT — super-admin-only read of EVERY employee's effective
-- access in one bundle, with the SOURCE of each grant (role vs per-person
-- override) so over-provisioning is visible at a glance. Read-only; no writes.
-- Models public.rbac_access_for(text) (the single-user "View as user" read),
-- but loops all non-archived employees and keeps role/override separate.
create or replace function public.rbac_access_audit()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with caller as (select public.is_super_admin() as ok),
  emps as (
    select e.id, e.email, e.full_name, e.department, e.role_id, e.is_active,
           r.code as role_code, coalesce(r.role_name, r.name, r.code) as role_name,
           (exists (select 1 from public.allowed_admins a where lower(a.email) = lower(e.email))
            or coalesce(r.code, '') = 'CEO') as is_admin
    from public.employees e
    left join public.roles r on r.id = e.role_id
    where e.archived_at is null
  ),
  -- one row per (employee x module): role grant and override grant kept apart
  cells as (
    select em.id as employee_id, em.is_admin,
      m.module_key, m.module_name,
      coalesce(rmp.can_view,false)   as role_view,   coalesce(ep.can_view,false)   as ovr_view,
      coalesce(rmp.can_create,false) as role_create, coalesce(ep.can_create,false) as ovr_create,
      coalesce(rmp.can_edit,false)   as role_edit,   coalesce(ep.can_edit,false)   as ovr_edit,
      coalesce(rmp.can_delete,false) as role_delete, coalesce(ep.can_delete,false) as ovr_delete
    from emps em
    cross join public.modules m
    left join public.employee_permissions ep on ep.employee_id = em.id and ep.module_id = m.id
    left join public.role_module_permissions rmp on rmp.role_id = em.role_id and rmp.module_id = m.id
  )
  select case when not (select ok from caller) then jsonb_build_object('error','forbidden')
  else jsonb_build_object('users', coalesce((
    select jsonb_agg(jsonb_build_object(
      'employee', jsonb_build_object(
        'id', em.id, 'email', em.email, 'full_name', em.full_name,
        'department', em.department, 'role_code', em.role_code,
        'role_name', em.role_name, 'is_active', em.is_active),
      'is_admin', em.is_admin,
      'modules', coalesce((
        select jsonb_agg(jsonb_build_object(
          'module_key', c.module_key, 'module_name', c.module_name,
          'can_view',   (c.is_admin or c.role_view   or c.ovr_view),
          'can_create', (c.is_admin or c.role_create or c.ovr_create),
          'can_edit',   (c.is_admin or c.role_edit   or c.ovr_edit),
          'can_delete', (c.is_admin or c.role_delete or c.ovr_delete),
          'source', case
            when c.is_admin then 'super_admin'
            when (c.role_view or c.role_create or c.role_edit or c.role_delete)
             and (c.ovr_view  or c.ovr_create  or c.ovr_edit  or c.ovr_delete) then 'role+override'
            when (c.ovr_view  or c.ovr_create  or c.ovr_edit  or c.ovr_delete) then 'override'
            else 'role' end
        ) order by c.module_key)
        from cells c
        where c.employee_id = em.id
          and (c.is_admin
               or c.role_view or c.ovr_view
               or c.role_create or c.ovr_create
               or c.role_edit or c.ovr_edit
               or c.role_delete or c.ovr_delete)
      ), '[]'::jsonb),
      -- modules granted ONLY by a per-person override (not the role, not admin):
      -- the over-provisioning signal.
      'overrides_beyond_role', (
        select count(*) from cells c
        where c.employee_id = em.id and not c.is_admin
          and (c.ovr_view or c.ovr_create or c.ovr_edit or c.ovr_delete)
          and not (c.role_view or c.role_create or c.role_edit or c.role_delete)
      )
    ) order by em.is_active desc, em.full_name)
    from emps em), '[]'::jsonb))
  end;
$function$;
grant execute on function public.rbac_access_audit() to authenticated;
