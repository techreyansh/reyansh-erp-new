// Per-user access audit — read-only, super-admin only. Returns EVERY employee's
// effective access (modules + grant source) in one call, for the cross-employee
// audit grid. NOT impersonation: no session, no data beyond the access map.
import { supabase } from '../lib/supabaseClient';

/** All employees' effective access with grant source (super-admin only). */
export async function getAudit() {
  const { data, error } = await supabase.rpc('rbac_access_audit');
  if (error) throw error;
  if (data?.error) return { error: data.error };
  return { users: data?.users || [] };
}

const accessAuditService = { getAudit };
export default accessAuditService;
