-- RBAC FIX: get_my_rbac_access & rbac_employee_can resolved module access ONLY
-- from per-person employee_permissions (+ super-admin), IGNORING the configured
-- role_module_permissions. Effect: assigning a role granted nothing, and every
-- new hire had zero access until manually provisioned. Fix is ADDITIVE — access
-- is now (super-admin) OR (role default) OR (per-person override). Never removes.
create or replace function public.get_my_rbac_access()
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with flags as (select public.is_super_admin() as is_admin),
  me as (
    select e.id, e.email, e.full_name, e.phone, e.department, e.role_id, e.is_active,
           r.role_name, r.name, r.code
    from public.employees e left join public.roles r on r.id = e.role_id
    where e.email = public.rbac_current_email() limit 1
  ),
  module_access as (
    select m.id, m.module_key, m.module_name, m.route_path, m.icon,
      ((select is_admin from flags) or coalesce(ep.can_view,false)   or coalesce(rmp.can_view,false))   as can_view,
      ((select is_admin from flags) or coalesce(ep.can_create,false) or coalesce(rmp.can_create,false)) as can_create,
      ((select is_admin from flags) or coalesce(ep.can_edit,false)   or coalesce(rmp.can_edit,false))   as can_edit,
      ((select is_admin from flags) or coalesce(ep.can_delete,false) or coalesce(rmp.can_delete,false)) as can_delete
    from public.modules m
    left join me on true
    left join public.employee_permissions ep on ep.employee_id = me.id and ep.module_id = m.id
    left join public.role_module_permissions rmp on rmp.role_id = me.role_id and rmp.module_id = m.id
  )
  select jsonb_build_object(
    'authorized', ((select is_admin from flags) or exists (select 1 from me where is_active = true)),
    'reason', case when (select is_admin from flags) then null
      when not exists (select 1 from me) then 'not_found'
      when exists (select 1 from me where is_active = false) then 'inactive' else null end,
    'employee', coalesce((select to_jsonb(me) - 'role_id' from me where is_active = true or (select is_admin from flags)), 'null'::jsonb),
    'role', coalesce((select jsonb_build_object('id', role_id, 'role_name', coalesce(role_name,name,code),
        'name', coalesce(name,role_name,code), 'code', code) from me where is_active = true or (select is_admin from flags)), 'null'::jsonb),
    'modules', coalesce((select jsonb_agg(jsonb_build_object('id',id,'module_key',module_key,'module_name',module_name,
        'route_path',route_path,'icon',icon,'can_view',can_view,'can_create',can_create,'can_edit',can_edit,'can_delete',can_delete)
        order by module_key) from module_access where can_view = true), '[]'::jsonb)
  );
$function$;

create or replace function public.rbac_employee_can(p_module_key text, p_action text default 'view')
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  with me as (
    select e.id as employee_id, e.role_id from public.employees e
    where e.email = public.rbac_current_email() and e.is_active = true limit 1
  ),
  resolved as (
    select
      coalesce(ep.can_view,false)   or coalesce(rmp.can_view,false)   as can_view,
      coalesce(ep.can_create,false) or coalesce(rmp.can_create,false) as can_create,
      coalesce(ep.can_edit,false)   or coalesce(rmp.can_edit,false)   as can_edit,
      coalesce(ep.can_delete,false) or coalesce(rmp.can_delete,false) as can_delete
    from me
    join public.modules m on m.module_key = p_module_key
    left join public.employee_permissions ep on ep.employee_id = me.employee_id and ep.module_id = m.id
    left join public.role_module_permissions rmp on rmp.role_id = me.role_id and rmp.module_id = m.id
  )
  select public.is_super_admin() or case lower(coalesce(p_action,'view'))
    when 'view' then coalesce((select can_view from resolved),false)
    when 'create' then coalesce((select can_create from resolved),false)
    when 'edit' then coalesce((select can_edit from resolved),false)
    when 'delete' then coalesce((select can_delete from resolved),false)
    else false end;
$function$;
