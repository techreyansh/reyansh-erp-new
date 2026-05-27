import { supabase } from '../lib/supabaseClient';

const EMPLOYEE_SELECT = `
  id,
  email,
  full_name,
  phone,
  department,
  role_id,
  is_active,
  created_at,
  updated_at,
  roles:role_id (
    id,
    role_name,
    name,
    code
  )
`;

export async function listRoles() {
  const { data, error } = await supabase
    .from('roles')
    .select('id, role_name, name, code, description, is_system_role')
    .order('role_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listModules() {
  const { data, error } = await supabase
    .from('modules')
    .select('id, module_key, module_name, route_path, icon')
    .order('module_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listEmployees() {
  const { data, error } = await supabase
    .from('employees')
    .select(EMPLOYEE_SELECT)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveEmployee(employee) {
  const payload = {
    email: String(employee.email || '').trim().toLowerCase(),
    full_name: employee.full_name || null,
    phone: employee.phone || null,
    department: employee.department || null,
    role_id: employee.role_id || null,
    is_active: employee.is_active !== false,
  };

  if (!payload.email) throw new Error('Employee email is required.');

  if (employee.id) {
    const { data, error } = await supabase
      .from('employees')
      .update(payload)
      .eq('id', employee.id)
      .select(EMPLOYEE_SELECT)
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('employees')
    .insert(payload)
    .select(EMPLOYEE_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function setEmployeeActive(employeeId, isActive) {
  const { error } = await supabase
    .from('employees')
    .update({ is_active: isActive })
    .eq('id', employeeId);
  if (error) throw error;
}

export async function listEmployeePermissionOverrides(employeeId) {
  if (!employeeId) return [];
  const { data, error } = await supabase
    .from('employee_permissions')
    .select(`
      id,
      employee_id,
      module_id,
      can_view,
      can_create,
      can_edit,
      can_delete,
      modules:module_id (
        id,
        module_key,
        module_name
      )
    `)
    .eq('employee_id', employeeId);
  if (error) throw error;
  return data || [];
}

export async function upsertEmployeePermission(employeeId, moduleId, permission) {
  const payload = {
    employee_id: employeeId,
    module_id: moduleId,
    can_view: Boolean(permission.can_view),
    can_create: Boolean(permission.can_create),
    can_edit: Boolean(permission.can_edit),
    can_delete: Boolean(permission.can_delete),
  };

  const { error } = await supabase
    .from('employee_permissions')
    .upsert(payload, { onConflict: 'employee_id,module_id' });
  if (error) throw error;
}

export async function deleteEmployeePermissionOverride(permissionId) {
  const { error } = await supabase
    .from('employee_permissions')
    .delete()
    .eq('id', permissionId);
  if (error) throw error;
}

export async function listRoleModulePermissions() {
  const { data, error } = await supabase
    .from('role_module_permissions')
    .select(`
      id,
      role_id,
      module_id,
      can_view,
      can_create,
      can_edit,
      can_delete,
      roles:role_id (
        id,
        role_name,
        name,
        code
      ),
      modules:module_id (
        id,
        module_key,
        module_name
      )
    `);
  if (error) throw error;
  return data || [];
}
