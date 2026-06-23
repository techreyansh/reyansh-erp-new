// "View as user" — read-only access preview (super-admin only). Shows what any
// employee can access (modules + the nav they'd see). NOT impersonation: no
// session is created, no data is exposed beyond the access map.
import { supabase } from '../lib/supabaseClient';

export async function listEmployees() {
  const { data, error } = await supabase
    .from('employees')
    .select('email, full_name, department, is_active, roles(code, role_name)')
    .order('is_active', { ascending: false });
  if (error) throw error;
  return (data || []).map((e) => ({
    email: e.email, full_name: e.full_name, department: e.department, is_active: e.is_active,
    role_code: e.roles?.code || null, role_name: e.roles?.role_name || e.roles?.code || '—',
  }));
}

/** Effective access map for an employee (super-admin OR role OR per-person). */
export async function getAccess(email) {
  const { data, error } = await supabase.rpc('rbac_access_for', { p_email: email });
  if (error) throw error;
  return data; // { employee, is_admin, modules[] } or { error: 'forbidden' }
}

const accessPreviewService = { listEmployees, getAccess };
export default accessPreviewService;
