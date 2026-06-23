-- "View as user" — super-admin-only read of any employee's effective access map
-- (super-admin OR role OR per-person). Read-only preview; no impersonation.
create or replace function public.rbac_access_for(p_email text)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  with caller as (select public.is_super_admin() as ok),
  tgt as (
    select e.id, e.email, e.full_name, e.department, e.role_id, e.is_active,
           r.code, coalesce(r.role_name, r.name, r.code) as role_name
    from public.employees e left join public.roles r on r.id = e.role_id
    where lower(e.email) = lower(p_email) limit 1
  ),
  adm as (
    select (exists (select 1 from public.allowed_admins a where lower(a.email) = lower(p_email))
            or coalesce((select code from tgt), '') = 'CEO') as v
  ),
  modacc as (
    select m.module_key, m.module_name,
      ((select v from adm) or coalesce(ep.can_view,false)   or coalesce(rmp.can_view,false))   as cv,
      ((select v from adm) or coalesce(ep.can_create,false) or coalesce(rmp.can_create,false)) as cc,
      ((select v from adm) or coalesce(ep.can_edit,false)   or coalesce(rmp.can_edit,false))   as ce,
      ((select v from adm) or coalesce(ep.can_delete,false) or coalesce(rmp.can_delete,false)) as cd
    from public.modules m
    left join tgt on true
    left join public.employee_permissions ep on ep.employee_id = tgt.id and ep.module_id = m.id
    left join public.role_module_permissions rmp on rmp.role_id = tgt.role_id and rmp.module_id = m.id
  )
  select case when not (select ok from caller) then jsonb_build_object('error','forbidden')
  else jsonb_build_object(
    'employee', (select to_jsonb(t) - 'role_id' from tgt t),
    'is_admin', (select v from adm),
    'modules', coalesce((select jsonb_agg(jsonb_build_object(
      'module_key', module_key, 'module_name', module_name,
      'can_view', cv, 'can_create', cc, 'can_edit', ce, 'can_delete', cd) order by module_key)
      from modacc where cv = true), '[]'::jsonb)
  ) end;
$function$;
grant execute on function public.rbac_access_for(text) to authenticated;
