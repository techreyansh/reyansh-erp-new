-- Make Quality + Purchase first-class, separately-gateable modules.
insert into modules (id, module_key, module_name, route_path, icon)
select gen_random_uuid(), 'purchase', 'Purchase', '/purchase-flow', 'purchase'
where not exists (select 1 from modules where module_key='purchase');
insert into modules (id, module_key, module_name, route_path, icon)
select gen_random_uuid(), 'quality', 'Quality', '/quality', 'quality'
where not exists (select 1 from modules where module_key='quality');

-- Purchase: copy each role's INVENTORY grant so current access is preserved.
insert into role_module_permissions (id, role_id, module_id, can_view, can_create, can_edit, can_delete)
select gen_random_uuid(), rmp.role_id, (select id from modules where module_key='purchase'),
       rmp.can_view, rmp.can_create, rmp.can_edit, rmp.can_delete
from role_module_permissions rmp
join modules m on m.id=rmp.module_id and m.module_key='inventory'
where not exists (select 1 from role_module_permissions x
  where x.role_id=rmp.role_id and x.module_id=(select id from modules where module_key='purchase'));

-- Quality: QUALITY full, PRODUCTION/PC/MANAGER view+edit.
insert into role_module_permissions (id, role_id, module_id, can_view, can_create, can_edit, can_delete)
select gen_random_uuid(), r.id, (select id from modules where module_key='quality'),
  true, (r.code='QUALITY'), (r.code in ('QUALITY','PRODUCTION','PC','MANAGER')), (r.code='QUALITY')
from roles r where r.code in ('QUALITY','PRODUCTION','PC','MANAGER')
and not exists (select 1 from role_module_permissions x
  where x.role_id=r.id and x.module_id=(select id from modules where module_key='quality'));

-- CEO explicit grants on both (also super-admin).
insert into role_module_permissions (id, role_id, module_id, can_view, can_create, can_edit, can_delete)
select gen_random_uuid(), r.id, m.id, true, true, true, true
from roles r cross join modules m
where r.code='CEO' and m.module_key in ('purchase','quality')
and not exists (select 1 from role_module_permissions x where x.role_id=r.id and x.module_id=m.id);
