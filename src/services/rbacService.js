import { supabase } from '../lib/supabaseClient';

const devLog = (...args) => {
  if (process.env.NODE_ENV === 'development') console.log(...args);
};

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
  devLog('Fetch response:', { source: 'employees', data, error });
  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }
  return data || [];
}

/** Active employees in a department (for task assignment). */
export async function listEmployeesByDepartment(department) {
  let query = supabase
    .from('employees')
    .select(EMPLOYEE_SELECT)
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  if (department) {
    query = query.eq('department', department);
  }

  const { data, error } = await query;
  devLog('Fetch response:', { source: 'employees by department', department, data, error });
  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }
  return data || [];
}

/** Persist module access matrix for one employee (allowed_modules source). */
export async function saveEmployeeModuleAccess(employeeId, modulePermissions) {
  if (!employeeId) throw new Error('Employee is required.');
  const rows = (modulePermissions || []).map((row) => ({
    employee_id: employeeId,
    module_id: row.module_id,
    can_view: Boolean(row.can_view),
    can_create: Boolean(row.can_create),
    can_edit: Boolean(row.can_edit),
    can_delete: Boolean(row.can_delete),
  }));

  if (!rows.length) {
    await revokeEmployeeAccess(employeeId);
    return;
  }

  const { error } = await supabase
    .from('employee_permissions')
    .upsert(rows, { onConflict: 'employee_id,module_id' });
  if (error) throw error;
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
    devLog('Fetch response:', { source: 'update employee', data, error });
    if (error) {
      console.error('CRUD error:', error);
      throw error;
    }
    return data;
  }

  const { data, error } = await supabase
    .from('employees')
    .insert(payload)
    .select(EMPLOYEE_SELECT)
    .single();
  devLog('Fetch response:', { source: 'insert employee', data, error });
  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }
  return data;
}

export async function setEmployeeActive(employeeId, isActive) {
  const { error } = await supabase
    .from('employees')
    .update({ is_active: isActive })
    .eq('id', employeeId);
  devLog('Fetch response:', { source: 'toggle employee active', data: { id: employeeId, isActive }, error });
  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }
}

/** Patch arbitrary columns on one employee (transfer dept, change manager…). */
export async function updateEmployeeFields(employeeId, fields) {
  if (!employeeId) throw new Error('Employee id is required.');
  const { data, error } = await supabase
    .from('employees')
    .update(fields)
    .eq('id', employeeId)
    .select(EMPLOYEE_SELECT)
    .single();
  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }
  return data;
}

/**
 * Hard-delete an employee. Removes dependent permission rows first (FK), then
 * the employee row itself. Irreversible — callers must confirm.
 */
export async function deleteEmployee(employeeId) {
  if (!employeeId) throw new Error('Employee id is required.');
  await supabase.from('employee_permissions').delete().eq('employee_id', employeeId);
  const { error } = await supabase.from('employees').delete().eq('id', employeeId);
  if (error) {
    console.error('CRUD error:', error);
    throw error;
  }
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

export async function listAllEmployeePermissions() {
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
    `);
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

export async function grantEmployeeFullAccess(employeeId, modules) {
  if (!employeeId) throw new Error('Employee is required.');
  const payload = modules.map((module) => ({
    employee_id: employeeId,
    module_id: module.id,
    can_view: true,
    can_create: true,
    can_edit: true,
    can_delete: true,
  }));
  const { error } = await supabase
    .from('employee_permissions')
    .upsert(payload, { onConflict: 'employee_id,module_id' });
  if (error) throw error;
}

export async function revokeEmployeeAccess(employeeId) {
  if (!employeeId) throw new Error('Employee is required.');
  const { error } = await supabase
    .from('employee_permissions')
    .delete()
    .eq('employee_id', employeeId);
  if (error) throw error;
}

